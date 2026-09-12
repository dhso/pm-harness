import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  SCHEMA_VERSION,
  baselineDigest,
  assertTransition,
  baselineSnapshot,
  digestValue,
  makeOperationId,
  validateOperationEnvelope,
} from "./model.mjs";
import {
  clone,
  defaultScheduleRecord,
  digestFields,
  exactChange,
  nextWorkspaceId,
  normalizeArray,
  safeWorkspaceInputPath,
  sameBaseline,
  sha256Path,
  upsert,
  validateOrThrow,
} from "./helpers.mjs";
import { validateOperationContract } from "./contracts.mjs";
import {
  COLLECTIONS,
  DECISION_CONTROLLED_FIELDS,
  STORE_FILES,
  readWorkspace,
} from "./workspace.mjs";
import { addControlledChange, assertUserConfirmation, verifyApproval } from "./approval.mjs";
import { collectIssues } from "./lint.mjs";
import { generatedEntries } from "./views.mjs";
import { commitTransaction, jsonEntry, withWorkspaceLock } from "./transaction.mjs";
import { applyWorkflow } from "./workflow.mjs";
import { applyContentOperation } from "./content-operations.mjs";
import { applyCompensation, captureCompensation } from "./compensation.mjs";
import { applyRequirementOperation, REQUIREMENT_OPERATION_TYPES } from "./requirement-operations.mjs";
import { applyScheduleTransition, assertScheduleActuals } from "./schedule-lifecycle.mjs";

// 逐条比较受影响集合，产出记录级 before/after，供对话中展示待确认变更。
function diffRecords(before, after, store, collection) {
  const changes = [];
  const previous = new Map((Array.isArray(before) ? before : []).map((item) => [item.id, item]));
  for (const item of Array.isArray(after) ? after : []) {
    const old = previous.get(item.id);
    if (!old) {
      changes.push({ store, collection, id: item.id, change: "created", after: item });
      continue;
    }
    previous.delete(item.id);
    if (digestValue(old) === digestValue(item)) continue;
    const fields = [...new Set([...Object.keys(old), ...Object.keys(item)])].filter((field) => digestValue(old[field]) !== digestValue(item[field]));
    changes.push({
      store,
      collection,
      id: item.id,
      change: "updated",
      fields,
      before: Object.fromEntries(fields.map((field) => [field, old[field] ?? null])),
      after: Object.fromEntries(fields.map((field) => [field, item[field] ?? null])),
    });
  }
  for (const item of previous.values()) changes.push({ store, collection, id: item.id, change: "removed", before: item });
  return changes;
}

function diffStores(before, after, changedStores) {
  if (!before) return [];
  const changes = [];
  for (const [store, collection] of COLLECTIONS.map((item) => [item[0], item[1]])) {
    if (!changedStores.has(store)) continue;
    changes.push(...diffRecords(before[store]?.[collection], after[store]?.[collection], store, collection));
  }
  // 项目存储不是集合，单独比较标量字段。
  if (changedStores.has("project")) {
    const fields = [...new Set([...Object.keys(before.project || {}), ...Object.keys(after.project || {})])].filter((field) => digestValue(before.project?.[field]) !== digestValue(after.project?.[field]));
    if (fields.length) {
      changes.push({
        store: "project",
        collection: "project",
        id: after.project?.id || "project",
        change: "updated",
        fields,
        before: Object.fromEntries(fields.map((field) => [field, before.project?.[field] ?? null])),
        after: Object.fromEntries(fields.map((field) => [field, after.project?.[field] ?? null])),
      });
    }
  }
  return changes;
}

export async function recordOperation(root, input, options = {}) {
  if (!options.lockHeld && !options.deferCommit) {
    return withWorkspaceLock(root, () => recordOperation(root, input, { ...options, lockHeld: true }));
  }
  const envelope = clone(input);
  if (!envelope.operation_id && envelope.type && envelope.payload) envelope.operation_id = makeOperationId(envelope.type, envelope.payload);
  const envelopeIssues = [...validateOperationEnvelope(envelope), ...validateOperationContract(envelope)];
  if (envelopeIssues.length) throw new Error(JSON.stringify({ code: "operation_validation_failed", issues: envelopeIssues }));
  const data = options.data || await readWorkspace(root);
  const rawInputHash = envelope.type === "source.register" && envelope.payload.raw_path ? await sha256Path(await safeWorkspaceInputPath(root, envelope.payload.raw_path)) : null;
  const requestHash = digestValue(rawInputHash ? { envelope, raw_input_sha256: rawInputHash } : envelope);
  const existingOperation = (data.changes.operations || []).find((item) => item.operation_id === envelope.operation_id);
  if (existingOperation) {
    if (existingOperation.request_hash && existingOperation.request_hash !== requestHash) throw new Error(JSON.stringify({ code: "operation_id_conflict", operation_id: envelope.operation_id, fix: "Use the original request or allocate a new stable operation_id" }));
    return { ok: true, idempotent: true, operation_id: envelope.operation_id, target_ids: existingOperation.target_ids, ...(existingOperation.result || {}) };
  }
  const now = new Date().toISOString();
  const changedStores = new Set();
  const extraEntries = [];
  const resultIds = [];
  let result = {};
  // 补偿快照和 dry-run 使用同一份前置状态，避免两套差异逻辑漂移。
  const beforeState = clone(data);

  if (envelope.type === "workflow.apply") {
    const workflow = await applyWorkflow(envelope, (child) => recordOperation(root, child, { ...options, data, deferCommit: true }));
    for (const key of workflow.changedStores) changedStores.add(key);
    extraEntries.push(...workflow.entries);
    resultIds.push(...workflow.targetIds);
    result = workflow.result;
  } else if (envelope.type === "project.initialize") {
    if (data.project.initialized) throw new Error("Project is already initialized; use project.update with approval instead");
    const payload = envelope.payload;
    for (const field of ["name", "objective", "timezone"]) if (!payload[field]) throw new Error(`Missing required initialization field: ${field}`);
    data.project = {
      schema_version: SCHEMA_VERSION,
      initialized: true,
      id: payload.id || "PRJ-001",
      name: payload.name,
      status: payload.status || "active",
      timezone: payload.timezone,
      objective: payload.objective,
      scope_in: normalizeArray(payload.scope_in),
      scope_out: normalizeArray(payload.scope_out),
      success_criteria: normalizeArray(payload.success_criteria),
      constraints: normalizeArray(payload.constraints),
      created_at: data.project.created_at || now,
      updated_at: now,
    };
    changedStores.add("project");
    resultIds.push(data.project.id);
    result = { project: data.project };
    extraEntries.push({ path: "project/status.md", content: `# 项目状态：${data.project.name}\n\n- 状态：${data.project.status}\n- 当前目标：${data.project.objective}\n- 最近更新：${now}\n\n## 当前重点\n\n建立初始计划和资料索引。\n\n## 阻塞与风险\n\n待完善。\n\n## 下一步\n\n整理已有资料并建立里程碑。\n` });
    extraEntries.push({ path: "memory/current.md", content: `# 当前工作记忆\n\n- 当前重点：建立 ${data.project.name} 的初始计划\n- 待确认：范围、时间、风险和交付信息\n- 下一步：整理已有资料并建立里程碑\n- 最近更新：${now}\n` });
  } else if (envelope.type === "project.update") {
    if (!data.project.initialized) throw new Error("Project must be initialized first");
    const before = clone(data.project);
    const controlled = ["objective", "scope_in", "scope_out", "success_criteria", "budget"].filter((field) => field in envelope.payload && digestValue(envelope.payload[field]) !== digestValue(before[field]));
    if (controlled.length) {
      const scopes = new Set(controlled.map((field) => field === "objective" ? "objective" : field === "budget" ? "budget" : "scope"));
      if (scopes.size > 1) throw new Error(JSON.stringify({ code: "multiple_approval_scopes", scopes: [...scopes], fix: "Split controlled project changes by approval scope" }));
      const actualChanges = [exactChange(data.project.id, before, { ...before, ...envelope.payload }, controlled)];
      for (const scope of scopes) verifyApproval(data, envelope.approval, scope, { requireChangeRequest: true, targetIds: [data.project.id], actualChanges });
    }
    if (envelope.payload.status) assertTransition("project", data.project.status, envelope.payload.status, data.project.id);
    data.project = { ...data.project, ...envelope.payload, schema_version: SCHEMA_VERSION, updated_at: now };
    changedStores.add("project");
    resultIds.push(data.project.id);
    if (controlled.length) {
      addControlledChange(data, envelope, { kind: "project_baseline", target_ids: [data.project.id], before, after: data.project, before_summary: controlled.join("、"), after_summary: "已应用批准后的项目基线变更" });
      changedStores.add("changes");
      changedStores.add("requirements");
    }
    result = { project: data.project };
  } else if (envelope.type === "stakeholder.upsert") {
    const payload = envelope.payload;
    const existing = payload.id ? data.stakeholders.stakeholders.find((item) => item.id === payload.id) : null;
    const requestedScopes = normalizeArray(payload.approval_scopes ?? existing?.approval_scopes);
    const scopesChanged = digestValue(requestedScopes) !== digestValue(existing?.approval_scopes || []);
    const statusChangedWithAuthority = Boolean(existing && payload.status && payload.status !== existing.status && requestedScopes.length);
    if (scopesChanged && (existing || requestedScopes.length) || statusChangedWithAuthority) assertUserConfirmation(envelope.approval, "stakeholder approval authority");
    const record = {
      id: nextWorkspaceId(data, data.stakeholders.stakeholders, "stakeholder", payload.id),
      name: payload.name ?? existing?.name,
      role: payload.role ?? existing?.role,
      organization: payload.organization ?? existing?.organization ?? null,
      status: payload.status || existing?.status || "active",
      approval_scopes: requestedScopes,
      source_ids: normalizeArray(payload.source_ids ?? existing?.source_ids ?? envelope.source_ids),
      updated_at: payload.updated_at || now,
    };
    validateOrThrow("stakeholder", record);
    upsert(data.stakeholders.stakeholders, record);
    if (scopesChanged || statusChangedWithAuthority) {
      addControlledChange(data, envelope, { kind: "stakeholder_authority", target_ids: [record.id], before: existing || {}, after: record, before_summary: (existing?.approval_scopes || []).join(", ") || null, after_summary: requestedScopes.join(", ") || "无审批范围" });
      changedStores.add("changes");
    }
    changedStores.add("stakeholders");
    resultIds.push(record.id);
    result = { stakeholder: record };
  } else if (envelope.type === "source.register") {
    const payload = envelope.payload;
    let rawContent = null;
    let hash = payload.sha256 || null;
    if (payload.raw_path) {
      rawContent = await readFile(await safeWorkspaceInputPath(root, payload.raw_path));
      hash = createHash("sha256").update(rawContent).digest("hex");
    }
    const duplicate = data.sources.sources.find((item) => hash && item.sha256 === hash || payload.source_locator && item.source_locator === payload.source_locator || payload.thread_id && payload.source_time && item.thread_id === payload.thread_id && item.source_time === payload.source_time && item.sender === (payload.sender || null));
    if (duplicate) {
      resultIds.push(duplicate.id);
      result = { duplicate_of: duplicate.id, source: duplicate, inbox_items_added: 0 };
    } else {
    const id = nextWorkspaceId(data, data.sources.sources, "source", payload.id);
    let archivedPath = payload.archived_path || null;
    if (rawContent) {
      const year = String(payload.source_time || now).slice(0, 4);
      const filename = path.basename(payload.raw_path).replace(/[^A-Za-z0-9._-]+/g, "-") || "source";
      archivedPath = `archive/files/${year}/${id}-${filename}`;
      extraEntries.push({ path: archivedPath, content: rawContent });
      const archiveRecord = { id: nextWorkspaceId(data, data.archive.files, "archive"), logical_id: id, source_id: id, deliverable_id: null, path: archivedPath, original_name: path.basename(payload.raw_path), type: payload.type, sha256: hash, archived_at: payload.captured_at || now, reason: payload.archive_reason || "source_evidence", superseded_by: null, availability: "local" };
      validateOrThrow("archive", archiveRecord);
      data.archive.files.push(archiveRecord);
      changedStores.add("archive");
      resultIds.push(archiveRecord.id);
    }
    const source = { id, type: payload.type, title: payload.title || id, channel: payload.channel ?? null, sender: payload.sender ?? null, stakeholder_id: payload.stakeholder_id ?? null, thread_id: payload.thread_id ?? null, source_time: payload.source_time ?? null, captured_at: payload.captured_at || now, archived_path: archivedPath, source_locator: payload.source_locator ?? null, sha256: hash, summary: payload.summary || payload.title || id };
    validateOrThrow("source", source);
    data.sources.sources.push(source);
    for (const candidate of payload.items || []) {
      const item = { id: nextWorkspaceId(data, data.inbox.items, "inbox", candidate.id), source_id: id, classification: candidate.classification, summary: candidate.summary, quote: candidate.quote ?? null, confidence: candidate.confidence ?? null, authority: candidate.authority || "unknown", related_ids: normalizeArray(candidate.related_ids), proposed_action: candidate.proposed_action ?? null, status: candidate.status || "new", created_at: source.captured_at, applied_to_ids: normalizeArray(candidate.applied_to_ids), applied_at: candidate.applied_at ?? null, disposition_reason: candidate.disposition_reason ?? null };
      validateOrThrow("inbox", item);
      data.inbox.items.push(item);
      resultIds.push(item.id);
    }
    changedStores.add("sources");
    changedStores.add("inbox");
    resultIds.unshift(id);
    result = { source, inbox_items_added: (payload.items || []).length };
    }
  } else if (envelope.type === "activity.record") {
    const payload = envelope.payload;
    const record = { id: nextWorkspaceId(data, data.activity.entries, "activity", payload.id), occurred_at: payload.occurred_at || payload.timestamp || now, action: payload.action, outcome: payload.outcome, related_ids: normalizeArray(payload.related_ids), source_ids: normalizeArray(payload.source_ids || envelope.source_ids), evidence: payload.evidence ?? null, next_action: payload.next_action ?? null, recorded_at: payload.recorded_at || now };
    validateOrThrow("activity", record);
    data.activity.entries.push(record);
    changedStores.add("activity");
    resultIds.push(record.id);
    result = { activity: record };
  } else if (["schedule.upsert", "schedule.batch-upsert"].includes(envelope.type)) {
    const batch = envelope.type === "schedule.batch-upsert";
    const inputs = batch ? envelope.payload.items : [{ collection: envelope.payload.collection, record: envelope.payload.record || envelope.payload }];
    const stagedSchedule = clone(data.schedule);
    const prepared = [];
    const seenIds = new Set();
    for (const input of inputs) {
      const collection = input.collection;
      if (!["tasks", "milestones"].includes(collection)) throw new Error(JSON.stringify({ code: "invalid_schedule_collection", collection, fix: "Use collection: tasks or milestones" }));
      const kind = collection === "tasks" ? "task" : "milestone";
      const records = stagedSchedule[collection];
      const payload = input.record;
      const existing = payload.id ? records.find((item) => item.id === payload.id) : null;
      const record = defaultScheduleRecord({ ...existing, ...payload, source_ids: payload.source_ids ?? existing?.source_ids ?? envelope.source_ids }, kind, now);
      record.id = nextWorkspaceId(data, records, kind, record.id);
      delete record._kind;
      if (seenIds.has(record.id)) throw new Error(JSON.stringify({ code: "duplicate_schedule_target", id: record.id, fix: "Each record ID may appear only once in schedule.batch-upsert" }));
      seenIds.add(record.id);
      if (existing) assertTransition(kind, existing.status, record.status, record.id);
      validateOrThrow(kind, record);
      assertScheduleActuals(record);
      prepared.push({ collection, existing, record, baselineChanged: !sameBaseline(existing, record) });
      upsert(records, record);
    }
    const baselineChanges = prepared.filter((item) => item.baselineChanged);
    const approvedBaseline = data.schedule.baseline?.status === "approved";
    if (approvedBaseline && data.schedule.baseline.digest !== baselineDigest(data.schedule)) throw new Error(JSON.stringify({ code: "approved_baseline_drift", fix: "已批准基线与摘要不一致；先恢复直接编辑，再通过已批准的变更请求写入" }));
    const usesChangeRequest = Boolean(envelope.approval?.change_request_id);
    const targetIds = baselineChanges.map((item) => item.record.id);
    const actualChanges = baselineChanges.map((item) => exactChange(item.record.id, item.existing, item.record, ["baseline_start", "baseline_end"]));
    let baselineApproval = null;
    if (baselineChanges.length && (approvedBaseline || usesChangeRequest)) baselineApproval = verifyApproval(data, envelope.approval, "schedule_baseline", { requireChangeRequest: true, targetIds, actualChanges });
    else if (baselineChanges.length && envelope.approval) baselineApproval = verifyApproval(data, envelope.approval, "schedule_baseline");
    const before = baselineSnapshot(data.schedule);
    data.schedule = stagedSchedule;
    if (baselineChanges.length && envelope.approval) {
      const revision = Number(data.schedule.baseline?.revision || 0) + 1;
      const after = baselineSnapshot(data.schedule);
      const changeRequestId = envelope.approval.change_request_id || null;
      data.schedule.baseline = { revision, status: "approved", digest: digestValue(after), approved_by_id: baselineApproval.stakeholder.id, approved_at: baselineApproval.changeRequest?.effective_at || envelope.approval.approved_at, change_request_id: changeRequestId };
      addControlledChange(data, envelope, { kind: "schedule_baseline", target_ids: targetIds, before, after, before_summary: approvedBaseline ? "修改已批准基线" : "批准初始基线", after_summary: `${targetIds.length} 个条目已按批准基线落地`, baseline_revision: revision });
      changedStores.add("changes");
      if (approvedBaseline || usesChangeRequest) changedStores.add("requirements");
    } else if (baselineChanges.length) {
      data.schedule.baseline = { ...(data.schedule.baseline || {}), revision: Number(data.schedule.baseline?.revision || 0), status: data.schedule.baseline?.status || "draft", digest: baselineDigest(data.schedule), approved_by_id: null, approved_at: null, change_request_id: null };
    }
    changedStores.add("schedule");
    resultIds.push(...prepared.map((item) => item.record.id));
    result = batch ? { schedule_items: prepared.map((item) => item.record), baseline: data.schedule.baseline } : { schedule_item: prepared[0].record, baseline: data.schedule.baseline };
  } else if (envelope.type === "schedule.transition") {
    result = applyScheduleTransition({ envelope, data, now, changedStores, resultIds });
  } else if (envelope.type === "schedule.baseline.approve") {
    if (envelope.approval?.change_request_id) throw new Error(JSON.stringify({ code: "baseline_confirmation_does_not_apply_change_request", fix: "schedule.baseline.approve 只确认已填写的草拟基线；需要按变更请求修改日期时使用 schedule.batch-upsert" }));
    const snapshot = baselineSnapshot(data.schedule);
    // 空快照与"批准了一个空对象"在哈希上无法区分，必须在入口拒绝。
    if (!snapshot.milestones.length && !snapshot.tasks.length) throw new Error(JSON.stringify({ code: "baseline_empty", fix: "先为任务或里程碑写入 baseline_start/baseline_end，再批准基线" }));
    const after = baselineDigest(data.schedule);
    const targetIds = [...data.schedule.milestones, ...data.schedule.tasks].filter((item) => item.baseline_start || item.baseline_end).map((item) => item.id);
    if (data.schedule.baseline?.status === "approved") {
      if (data.schedule.baseline.digest !== after) throw new Error(JSON.stringify({ code: "approved_baseline_drift", fix: "已批准基线与摘要不一致；不能通过重新批准覆盖直接编辑，请恢复后走变更请求" }));
      resultIds.push(...targetIds);
      result = { baseline: data.schedule.baseline, already_approved: true };
    } else {
      const approval = verifyApproval(data, envelope.approval, "schedule_baseline");
      const revision = Number(data.schedule.baseline?.revision || 0) + 1;
      data.schedule.baseline = { revision, status: "approved", digest: after, approved_by_id: approval.stakeholder.id, approved_at: envelope.approval.approved_at, change_request_id: envelope.approval.change_request_id || null };
      addControlledChange(data, envelope, { kind: "schedule_baseline", target_ids: targetIds, before: snapshot, after: snapshot, before_summary: "确认草拟基线", after_summary: "基线已批准", baseline_revision: revision });
      changedStores.add("schedule");
      changedStores.add("changes");
      resultIds.push(...targetIds);
      result = { baseline: data.schedule.baseline, already_approved: false };
    }
  } else if (REQUIREMENT_OPERATION_TYPES.has(envelope.type)) {
    result = await applyRequirementOperation({ root, envelope, data, now, changedStores, extraEntries, resultIds });
  } else if (envelope.type === "register.upsert") {
    const collection = envelope.payload.collection;
    const kind = { risks: "risk", issues: "issue", decisions: "decision" }[collection];
    if (!kind) throw new Error("register.upsert collection must be risks, issues, or decisions");
    const payload = envelope.payload.record || Object.fromEntries(Object.entries(envelope.payload).filter(([key]) => key !== "collection"));
    const existing = payload.id ? data.registers[collection].find((item) => item.id === payload.id) : null;
    const record = { ...existing, ...payload, id: nextWorkspaceId(data, data.registers[collection], kind, payload.id), status: payload.status || existing?.status || (kind === "decision" ? "proposed" : "open"), source_ids: normalizeArray(payload.source_ids || envelope.source_ids), owner: kind === "decision" ? undefined : payload.owner ?? existing?.owner ?? null, updated_at: payload.updated_at || now };
    if (kind === "decision" && existing) assertTransition("decision", existing.status, record.status, record.id);
    const approvedDecisionChanged = kind === "decision" && existing?.status === "approved" && digestFields(existing, DECISION_CONTROLLED_FIELDS) !== digestFields(record, DECISION_CONTROLLED_FIELDS);
    if (approvedDecisionChanged || kind === "decision" && existing?.status === "approved" && record.status === "superseded") {
      verifyApproval(data, envelope.approval, "decision", { requireChangeRequest: true, targetIds: [record.id], actualChanges: [exactChange(record.id, existing, record, DECISION_CONTROLLED_FIELDS)] });
      addControlledChange(data, envelope, { kind: "decision_revision", target_ids: [record.id], before: existing, after: record, before_hash: digestFields(existing, DECISION_CONTROLLED_FIELDS), after_hash: digestFields(record, DECISION_CONTROLLED_FIELDS), before_summary: existing.description, after_summary: record.description });
      changedStores.add("changes");
      changedStores.add("requirements");
    }
    if (kind === "decision" && record.status === "approved" && existing?.status !== "approved") {
      const approval = verifyApproval(data, envelope.approval, "decision");
      record.approved_by_id = approval.stakeholder.id;
      record.approved_at = envelope.approval.approved_at;
      addControlledChange(data, envelope, { kind: "decision", target_ids: [record.id], before: existing || {}, after: record, before_hash: digestFields(existing, DECISION_CONTROLLED_FIELDS), after_hash: digestFields(record, DECISION_CONTROLLED_FIELDS), before_summary: existing?.description || null, after_summary: record.description });
      changedStores.add("changes");
    }
    if (kind === "decision") delete record.owner;
    validateOrThrow(kind, record);
    upsert(data.registers[collection], record);
    changedStores.add("registers");
    resultIds.push(record.id);
    result = { [kind]: record };
  } else if (envelope.type === "operation.compensate") {
    if (!options.dryRun) assertUserConfirmation(envelope.approval, "operation compensation");
    const applied = await applyCompensation(root, data, envelope.payload.operation_id);
    for (const store of applied.changedStores) changedStores.add(store);
    extraEntries.push(...applied.entries);
    resultIds.push(...(applied.target.target_ids || []));
    result = applied.result;
    if (!options.dryRun) result.compensation.confirmed_by_user_at = envelope.approval.confirmed_by_user_at;
  } else {
    result = await applyContentOperation({ root, envelope, data, now, changedStores, extraEntries, resultIds });
  }

  const response = { ok: true, idempotent: false, operation_id: envelope.operation_id, target_ids: [...new Set(resultIds)], ...result };
  if (options.deferCommit) return { ...response, transaction: { changed_stores: [...changedStores], entries: extraEntries } };
  const uniqueExtraEntries = [...new Map(extraEntries.map((entry) => [entry.path, entry])).values()];
  const compensation = envelope.type === "operation.compensate"
    ? { version: 2, reversible: false, records: [], metadata: [], documents: [], retained_paths: [], blocked_paths: [] }
    : await captureCompensation(root, beforeState, data, changedStores, uniqueExtraEntries, result);
  data.changes.operations ||= [];
  data.changes.operations.push({ operation_id: envelope.operation_id, request_hash: requestHash, type: envelope.type, target_ids: [...new Set(resultIds)], recorded_at: now, result: clone(result), compensation });
  changedStores.add("changes");
  const pendingPaths = extraEntries.filter((item) => !item.delete).map((item) => item.path);
  const validation = await collectIssues(root, data, { checkFiles: false, checkGenerated: false, pendingPaths });
  const errors = validation.filter((item) => item.level === "error");
  if (errors.length) throw new Error(JSON.stringify({ code: "workspace_validation_failed", issues: errors }));
  // dry-run：审批、校验、状态转换都已按真实路径跑完，只是不落盘。
  // 用途是先向用户展示 before/after 再执行，不得据此跳过任何护栏。
  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      committed: false,
      operation_id: envelope.operation_id,
      type: envelope.type,
      target_ids: [...new Set(resultIds)],
      changes: diffStores(beforeState, data, changedStores),
      changed_stores: [...changedStores].sort(),
      would_write: [...new Set([...[...changedStores].map((key) => STORE_FILES[key]), ...extraEntries.map((item) => item.path)])].sort(),
      warnings: validation.filter((item) => item.level === "warning"),
      ...result,
    };
  }
  const entries = [...changedStores].map((key) => jsonEntry(STORE_FILES[key], data[key]));
  entries.push(...uniqueExtraEntries);
  entries.push(...await generatedEntries(root, data));
  // 一个 workflow 可能同时自动同步摘要、又显式提交 status/memory 更新；同一事务只保留最后一次内容。
  const uniqueEntries = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
  await commitTransaction(root, envelope.operation_id, uniqueEntries, {
    failAfter: options.failAfter,
    lockHeld: true,
  });
  return response;
}
