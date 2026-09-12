import { addControlledChange, verifyApproval } from "./approval.mjs";
import { findDuplicateDraft, requirementReplacementSnapshot, syncRequirementReplacement, validateChangeProposal } from "./change-validation.mjs";
import { clone, digestChangeIntent, digestFields, exactChange, normalizeArray, nextWorkspaceId, replacementChange, upsert, validateOrThrow } from "./helpers.mjs";
import { assertTransition, digestValue } from "./model.mjs";
import { REQUIREMENT_IMMUTABLE_FIELDS, REQUIREMENT_LINK_FIELDS } from "./workspace.mjs";

const ACTIVE_CHANGE_STATUSES = new Set(["proposed", "impact_review", "approved"]);
const APPROVED_REQUIREMENT_STATUSES = new Set(["approved", "implemented", "validated"]);

function fail(code, details) {
  throw new Error(JSON.stringify({ code, ...details }));
}

function changeRecord(data, payload, sourceIds, now) {
  return {
    id: nextWorkspaceId(data, data.requirements.change_requests, "change_request", payload.id),
    title: payload.title,
    status: "proposed",
    approval_scope: payload.approval_scope,
    target_ids: payload.target_ids,
    change_items: payload.change_items,
    before: payload.before,
    after: payload.after,
    reason: payload.reason,
    impact: payload.impact,
    source_ids: sourceIds,
    created_at: payload.created_at || now,
    approved_by_id: null,
    confirmed_by_user_at: null,
    effective_at: null,
    approved_change_digest: null,
    applied_target_ids: [],
    applied_operation_ids: [],
    applied_at: null,
    disposition_reason: null,
    voided_at: null,
  };
}

function activeReplacementRequest(data, candidate) {
  if (candidate.approval_scope !== "requirement" || candidate.target_ids.length !== 1) return null;
  const targetId = candidate.target_ids[0];
  const replacementId = candidate.change_items.find((item) => item.target_id === targetId)?.after?.superseded_by_id;
  if (!replacementId) return null;
  return (data.requirements.change_requests || []).find((item) => {
    if (!ACTIVE_CHANGE_STATUSES.has(item.status) || item.approval_scope !== "requirement" || !item.target_ids.includes(targetId)) return false;
    return item.change_items?.find((change) => change.target_id === targetId)?.after?.superseded_by_id === replacementId;
  }) || null;
}

function proposeChange(data, payload, sourceIds, now) {
  const targetIds = normalizeArray(payload.target_ids);
  const changeItems = Array.isArray(payload.change_items) ? payload.change_items : [];
  if (!targetIds.length || targetIds.length !== changeItems.length || targetIds.some((id) => !changeItems.some((item) => item.target_id === id))) {
    fail("change_request_items_mismatch", { fix: "Provide one exact before/after change_item for every target_id" });
  }
  if (changeItems.some((item) => digestChangeIntent(item.before) === digestChangeIntent(item.after))) {
    fail("change_request_no_effect", { fix: "change_items 的 before 与 after 完全相同；变更请求必须描述真实改动" });
  }
  validateChangeProposal(data, { approvalScope: payload.approval_scope, targetIds, changeItems });
  const candidate = { ...payload, target_ids: targetIds, change_items: changeItems, source_ids: sourceIds };
  const duplicate = findDuplicateDraft(data, candidate);
  const replacementConflict = activeReplacementRequest(data, candidate);
  if (replacementConflict && replacementConflict.id !== duplicate?.id) {
    fail("active_replacement_change_conflict", { change_request_id: replacementConflict.id, fix: `同一需求替代只能有一条活跃变更请求；继续 ${replacementConflict.id}，或先用 change.void 技术作废它` });
  }
  if (duplicate) {
    try {
      validateChangeProposal(data, { approvalScope: duplicate.approval_scope, targetIds: duplicate.target_ids, changeItems: duplicate.change_items || [] });
    } catch {
      fail("invalid_duplicate_change_request", { change_request_id: duplicate.id, fix: `现有重复草案 ${duplicate.id} 不可安全应用；先用 change.void 技术作废它` });
    }
    if (["proposed", "impact_review"].includes(duplicate.status)) {
      duplicate.source_ids = normalizeArray([...(duplicate.source_ids || []), ...sourceIds]);
    }
    return { record: duplicate, reused: true };
  }
  const record = changeRecord(data, { ...payload, target_ids: targetIds, change_items: changeItems }, sourceIds, now);
  validateOrThrow("change_request", record);
  data.requirements.change_requests.push(record);
  return { record, reused: false };
}

async function upsertRequirement(context) {
  const { root, envelope, data, now, changedStores, extraEntries, resultIds } = context;
  const payload = envelope.payload;
  const existing = payload.id ? data.requirements.requirements.find((item) => item.id === payload.id) : null;
  const merged = { ...existing, ...payload };
  if (!existing && merged.supersedes_id && !data.requirements.requirements.some((item) => item.id === merged.supersedes_id)) {
    fail("invalid_supersession", { predecessor_id: merged.supersedes_id, fix: "先登记存在的旧需求，再创建带 supersedes_id 的替代候选" });
  }
  if (!existing && merged.supersedes_id && merged.status === "proposed") {
    fail("replacement_candidate_required", { predecessor_id: merged.supersedes_id, fix: "替代需求应使用 requirement.replacement.propose 原子创建；低层操作必须先以 candidate 创建" });
  }
  if (!existing && merged.supersedes_id && ["candidate", "proposed"].includes(merged.status || "candidate")) {
    const duplicate = data.requirements.requirements.find((item) => item.supersedes_id === merged.supersedes_id && ["candidate", "proposed"].includes(item.status));
    if (duplicate) fail("duplicate_replacement_candidate", { predecessor_id: merged.supersedes_id, candidate_id: duplicate.id, fix: `继续现有候选 ${duplicate.id}，或先将其驳回后再创建新的替代候选` });
  }
  const record = {
    id: nextWorkspaceId(data, data.requirements.requirements, "requirement", payload.id),
    title: merged.title,
    description: merged.description,
    owner: merged.owner ?? null,
    status: merged.status || "candidate",
    acceptance_criteria: normalizeArray(merged.acceptance_criteria),
    source_ids: normalizeArray(payload.source_ids ?? existing?.source_ids ?? envelope.source_ids),
    supersedes_id: merged.supersedes_id ?? null,
    superseded_by_id: merged.superseded_by_id ?? null,
    approved_by_id: merged.approved_by_id ?? null,
    approved_at: merged.approved_at ?? null,
    updated_at: payload.updated_at || now,
  };
  if (existing) assertTransition("requirement", existing.status, record.status, record.id);
  const existingApproved = existing && APPROVED_REQUIREMENT_STATUSES.has(existing.status);
  if (existingApproved && digestFields(existing, REQUIREMENT_IMMUTABLE_FIELDS) !== digestFields(record, REQUIREMENT_IMMUTABLE_FIELDS)) {
    fail("approved_requirement_requires_new_version", { id: record.id, fix: "Create a new REQ record and link the supersession through an approved change request" });
  }
  const approvedLinksChanged = existingApproved && digestFields(existing, REQUIREMENT_LINK_FIELDS) !== digestFields(record, REQUIREMENT_LINK_FIELDS);
  const enteringApproval = APPROVED_REQUIREMENT_STATUSES.has(record.status) && !existingApproved;
  if (enteringApproval || approvedLinksChanged) {
    const replacementApproval = enteringApproval && Boolean(record.supersedes_id);
    const predecessor = replacementApproval ? data.requirements.requirements.find((item) => item.id === record.supersedes_id) : existing;
    if (replacementApproval && (!existing || !predecessor)) fail("replacement_candidate_required", { fix: "Register the replacement as a candidate first, then propose the exact change against its predecessor" });
    const targetId = replacementApproval ? predecessor.id : record.id;
    const actualChange = replacementApproval ? replacementChange(targetId, predecessor, record, REQUIREMENT_IMMUTABLE_FIELDS) : exactChange(targetId, predecessor, record, REQUIREMENT_LINK_FIELDS);
    const approval = verifyApproval(data, envelope.approval, "requirement", { requireChangeRequest: Boolean(approvedLinksChanged || replacementApproval), targetIds: [targetId], actualChanges: [actualChange] });
    record.approved_by_id = approval.stakeholder.id;
    record.approved_at = approval.changeRequest?.effective_at || envelope.approval.approved_at;
    if (replacementApproval) {
      assertTransition("requirement", predecessor.status, "superseded", predecessor.id);
      Object.assign(predecessor, { status: "superseded", superseded_by_id: record.id, updated_at: now });
      validateOrThrow("requirement", predecessor);
      const synced = await syncRequirementReplacement(root, data, predecessor, record, now);
      if (synced.changedTasks.length) changedStores.add("schedule");
      extraEntries.push(...synced.entries);
    }
    addControlledChange(data, envelope, { kind: "requirement", target_ids: replacementApproval ? [record.id, predecessor.id] : [record.id], change_request_target_ids: replacementApproval ? [predecessor.id] : undefined, before: existing || {}, after: record, before_hash: digestFields(existing, REQUIREMENT_IMMUTABLE_FIELDS), after_hash: digestFields(record, REQUIREMENT_IMMUTABLE_FIELDS), before_summary: existing?.description || null, after_summary: record.description });
    changedStores.add("changes");
  }
  validateOrThrow("requirement", record);
  upsert(data.requirements.requirements, record);
  changedStores.add("requirements");
  resultIds.push(record.id);
  return { requirement: record };
}

function proposeReplacement(context) {
  const { envelope, data, now, changedStores, resultIds } = context;
  const payload = envelope.payload;
  const predecessor = data.requirements.requirements.find((item) => item.id === payload.predecessor_id);
  if (!predecessor) fail("replacement_predecessor_missing", { predecessor_id: payload.predecessor_id, fix: "使用现有的已批准需求 ID" });
  if (!APPROVED_REQUIREMENT_STATUSES.has(predecessor.status)) fail("replacement_predecessor_not_approved", { predecessor_id: predecessor.id, status: predecessor.status, fix: "只能为当前已批准、已实施或已验证的需求创建替代提案" });
  if (!Array.isArray(payload.replacement.acceptance_criteria) || !payload.replacement.acceptance_criteria.length || !payload.replacement.acceptance_criteria.every((item) => typeof item === "string" && item)) {
    fail("replacement_acceptance_criteria_invalid", { fix: "replacement.acceptance_criteria 必须是至少包含一项非空文本的数组" });
  }
  const requested = { title: payload.replacement.title, description: payload.replacement.description, acceptance_criteria: normalizeArray(payload.replacement.acceptance_criteria), ...(payload.replacement.owner != null ? { owner: payload.replacement.owner } : {}) };
  let candidate = data.requirements.requirements.find((item) => item.supersedes_id === predecessor.id && ["candidate", "proposed"].includes(item.status));
  const reusedCandidate = Boolean(candidate);
  if (candidate && digestChangeIntent(requirementReplacementSnapshot(candidate)) !== digestChangeIntent(requested)) {
    fail("active_replacement_candidate_conflict", { predecessor_id: predecessor.id, candidate_id: candidate.id, fix: `旧需求已有不同内容的活跃候选 ${candidate.id}；先明确驳回该候选后再提交新替代` });
  }
  const sourceIds = normalizeArray([...(envelope.source_ids || []), ...(payload.source_ids || [])]);
  if (!candidate) {
    candidate = { id: nextWorkspaceId(data, data.requirements.requirements, "requirement"), ...requested, owner: requested.owner ?? null, status: "proposed", source_ids: sourceIds, supersedes_id: predecessor.id, superseded_by_id: null, approved_by_id: null, approved_at: null, updated_at: now };
    validateOrThrow("requirement", candidate);
    data.requirements.requirements.push(candidate);
  } else {
    if (candidate.status === "candidate") assertTransition("requirement", candidate.status, "proposed", candidate.id);
    Object.assign(candidate, { status: "proposed", source_ids: normalizeArray([...(candidate.source_ids || []), ...sourceIds]), updated_at: now });
    validateOrThrow("requirement", candidate);
  }
  const item = replacementChange(predecessor.id, predecessor, candidate, REQUIREMENT_IMMUTABLE_FIELDS);
  const proposed = proposeChange(data, {
    title: payload.title || `替代需求：${predecessor.title} → ${candidate.title}`,
    approval_scope: "requirement",
    target_ids: [predecessor.id],
    change_items: [item],
    before: predecessor.description,
    after: candidate.description,
    reason: payload.reason,
    impact: payload.impact,
    created_at: payload.created_at,
  }, sourceIds, now);
  changedStores.add("requirements");
  resultIds.push(candidate.id, proposed.record.id);
  return { requirement: candidate, change_request: proposed.record, reused_candidate: reusedCandidate, reused_change_request: proposed.reused };
}

function proposeGenericChange(context) {
  const { envelope, data, now, changedStores, resultIds } = context;
  const sourceIds = normalizeArray([...(envelope.source_ids || []), ...(envelope.payload.source_ids || [])]);
  const proposed = proposeChange(data, envelope.payload, sourceIds, now);
  if (!proposed.reused || ["proposed", "impact_review"].includes(proposed.record.status)) changedStores.add("requirements");
  resultIds.push(proposed.record.id);
  return { change_request: proposed.record, reused_existing: proposed.reused };
}

function approveChange(context) {
  const { envelope, data, changedStores, resultIds } = context;
  const record = data.requirements.change_requests.find((item) => item.id === envelope.payload.id);
  if (!record) throw new Error(`Change request not found: ${envelope.payload.id}`);
  assertTransition("change_request", record.status, "approved", record.id);
  if (!record.change_items?.length || record.target_ids.some((id) => !record.change_items.some((item) => item.target_id === id))) fail("change_request_exact_change_required", { id: record.id, fix: "批准前每个 target_id 都需要一条 change_items: [{ target_id, before, after }]" });
  validateChangeProposal(data, { approvalScope: record.approval_scope, targetIds: record.target_ids, changeItems: record.change_items });
  const duplicate = findDuplicateDraft(data, record, { excludeId: record.id });
  if (duplicate) fail("duplicate_change_request", { duplicate_id: duplicate.id, fix: `先用 change.void 清理重复草案 ${duplicate.id}，再批准唯一版本` });
  const approval = verifyApproval(data, envelope.approval, record.approval_scope);
  if (Date.parse(envelope.approval.approved_at) < Date.parse(record.created_at)) fail("approval_predates_change_request", { id: record.id, created_at: record.created_at, approved_at: envelope.approval.approved_at, fix: "approval.approved_at 不得早于变更请求的 created_at；同一 workflow 中请显式设置相同或递增的时间戳" });
  const before = clone(record);
  Object.assign(record, { status: "approved", approved_by_id: approval.stakeholder.id, confirmed_by_user_at: envelope.approval.confirmed_by_user_at, effective_at: envelope.approval.approved_at, approved_change_digest: digestValue(record.change_items) });
  addControlledChange(data, envelope, { kind: "change_request_approval", target_ids: [record.id], before, after: record, before_summary: before.status, after_summary: "approved" });
  changedStores.add("requirements");
  changedStores.add("changes");
  resultIds.push(record.id);
  return { change_request: record };
}

function voidChanges(context) {
  const { envelope, data, now, changedStores, resultIds } = context;
  const ids = normalizeArray(envelope.payload.ids);
  if (!ids.length) fail("change_request_ids_required", { fix: "提供至少一个待技术作废的草案 ID" });
  if (typeof envelope.payload.reason !== "string" || !envelope.payload.reason.trim()) fail("change_request_void_reason_required", { fix: "提供技术作废原因，说明草案为何无效或重复" });
  const records = ids.map((id) => {
    const record = data.requirements.change_requests.find((item) => item.id === id);
    if (!record) fail("change_request_missing", { id, fix: "使用现有变更请求 ID" });
    if (!["proposed", "impact_review"].includes(record.status)) fail("change_request_not_voidable", { id, status: record.status, fix: "只能技术作废尚未批准的 proposed 或 impact_review 草案" });
    assertTransition("change_request", record.status, "voided", record.id);
    const voidedAt = envelope.payload.voided_at || now;
    if (Date.parse(voidedAt) < Date.parse(record.created_at)) fail("change_request_void_predates_draft", { id, created_at: record.created_at, voided_at: voidedAt, fix: "voided_at 不得早于草案 created_at" });
    Object.assign(record, { status: "voided", disposition_reason: envelope.payload.reason, voided_at: voidedAt });
    validateOrThrow("change_request", record);
    return record;
  });
  changedStores.add("requirements");
  resultIds.push(...ids);
  return { change_requests: records, disposition: "voided" };
}

export const REQUIREMENT_OPERATION_TYPES = new Set(["requirement.upsert", "requirement.replacement.propose", "change.propose", "change.approve", "change.void"]);

export async function applyRequirementOperation(context) {
  if (context.envelope.type === "requirement.upsert") return upsertRequirement(context);
  if (context.envelope.type === "requirement.replacement.propose") return proposeReplacement(context);
  if (context.envelope.type === "change.propose") return proposeGenericChange(context);
  if (context.envelope.type === "change.approve") return approveChange(context);
  if (context.envelope.type === "change.void") return voidChanges(context);
  throw new Error(`Unsupported requirement operation: ${context.envelope.type}`);
}
