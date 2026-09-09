import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  APPROVAL_SCOPES,
  SCHEMA_VERSION,
  baselineDigest,
  digestValue,
  isTimestamp,
} from "./model.mjs";
import {
  defaultScheduleRecord,
  normalizeArray,
  walkMarkdown,
} from "./helpers.mjs";
import { STORE_FILES, readOptionalJson } from "./workspace.mjs";
import { collectIssues } from "./lint.mjs";
import { generatedEntries } from "./views.mjs";
import { commitTransaction, jsonEntry } from "./transaction.mjs";

function migratedScheduleItem(item, kind, now) {
  const normalized = defaultScheduleRecord(item, kind, now);
  normalized.id = item.id;
  delete normalized._kind;
  return { ...item, ...normalized };
}

function migratedRequirement(item, now) {
  const needsApprovalConfirmation = ["approved", "implemented", "validated"].includes(item.status);
  return {
    ...item,
    id: item.id,
    title: item.title || item.id,
    description: item.description || item.title || "待确认",
    status: needsApprovalConfirmation ? "proposed" : item.status || "candidate",
    acceptance_criteria: normalizeArray(item.acceptance_criteria),
    source_ids: normalizeArray(item.source_ids),
    supersedes_id: item.supersedes_id ?? null,
    superseded_by_id: item.superseded_by_id ?? null,
    approved_by_id: needsApprovalConfirmation ? null : item.approved_by_id ?? null,
    approved_at: needsApprovalConfirmation ? null : item.approved_at ?? null,
    ...(needsApprovalConfirmation ? { legacy_approval: { status: item.status, approved_by_id: item.approved_by_id ?? null, approved_at: item.approved_at ?? null } } : {}),
    updated_at: item.updated_at || now,
  };
}

function migratedChangeRequest(item, now) {
  const needsApprovalConfirmation = ["approved", "implemented"].includes(item.status);
  return {
    ...item,
    id: item.id,
    title: item.title || item.id,
    status: needsApprovalConfirmation ? "impact_review" : item.status || "proposed",
    approval_scope: APPROVAL_SCOPES.includes(item.approval_scope) ? item.approval_scope : "scope",
    target_ids: normalizeArray(item.target_ids),
    change_items: Array.isArray(item.change_items) ? item.change_items : [],
    before: typeof item.before === "string" ? item.before : JSON.stringify(item.before ?? {}),
    after: typeof item.after === "string" ? item.after : JSON.stringify(item.after ?? {}),
    reason: item.reason || "v1 迁移保留的变更请求",
    impact: item.impact || "待复核",
    source_ids: normalizeArray(item.source_ids),
    created_at: item.created_at || now,
    approved_by_id: needsApprovalConfirmation ? null : item.approved_by_id ?? null,
    confirmed_by_user_at: needsApprovalConfirmation ? null : item.confirmed_by_user_at ?? null,
    effective_at: needsApprovalConfirmation ? null : item.effective_at ?? null,
    approved_change_digest: item.approved_change_digest ?? null,
    applied_target_ids: normalizeArray(item.applied_target_ids),
    applied_operation_ids: normalizeArray(item.applied_operation_ids),
    applied_at: item.applied_at ?? null,
    ...(needsApprovalConfirmation ? { legacy_approval: { status: item.status, approved_by_id: item.approved_by_id ?? null, confirmed_by_user_at: item.confirmed_by_user_at ?? null, effective_at: item.effective_at ?? null } } : {}),
  };
}

function migratedRegister(item, kind, now) {
  const needsApprovalConfirmation = kind === "decision" && item.status === "approved";
  const base = {
    ...item,
    id: item.id,
    title: item.title || item.id,
    description: item.description || item.title || "待确认",
    status: needsApprovalConfirmation ? "proposed" : item.status || (kind === "decision" ? "proposed" : "open"),
    source_ids: normalizeArray(item.source_ids),
    updated_at: item.updated_at || now,
  };
  if (kind === "decision") return { ...base, rationale: item.rationale ?? null, approved_by_id: needsApprovalConfirmation ? null : item.approved_by_id ?? null, approved_at: needsApprovalConfirmation ? null : item.approved_at ?? null, superseded_by_id: item.superseded_by_id ?? null, ...(needsApprovalConfirmation ? { legacy_approval: { status: item.status, approved_by_id: item.approved_by_id ?? null, approved_at: item.approved_at ?? null } } : {}) };
  return { ...base, owner: item.owner ?? null, resolution: item.resolution ?? null, ...(kind === "risk" ? { probability: item.probability ?? null, impact: item.impact ?? null, trigger: item.trigger ?? null, response: item.response ?? null, response_due: item.response_due ?? null, next_review: item.next_review ?? null } : {}) };
}

function migratedDeliverable(item) {
  const inferredFormat = item.format || (item.path ? path.extname(item.path).slice(1) : "unknown") || "unknown";
  const needsApprovalConfirmation = ["approved", "delivered", "accepted"].includes(item.status);
  return {
    ...item,
    id: item.id,
    title: item.title || item.id,
    type: item.type || "other",
    format: inferredFormat,
    version: item.version || "v01",
    status: needsApprovalConfirmation ? "review" : item.status || "requested",
    path: item.path ?? null,
    content_sha256: item.content_sha256 ?? null,
    audience: item.audience || "待确认",
    purpose: item.purpose || "待确认",
    requirement_ids: normalizeArray(item.requirement_ids),
    source_ids: normalizeArray(item.source_ids),
    due_at: item.due_at ?? null,
    completed_at: item.completed_at ?? null,
    approved_by_id: needsApprovalConfirmation ? null : item.approved_by_id ?? null,
    approved_at: needsApprovalConfirmation ? null : item.approved_at ?? null,
    delivered_at: needsApprovalConfirmation ? null : item.delivered_at ?? null,
    accepted_by_id: needsApprovalConfirmation ? null : item.accepted_by_id ?? null,
    accepted_at: needsApprovalConfirmation ? null : item.accepted_at ?? null,
    acceptance_criteria: normalizeArray(item.acceptance_criteria),
    acceptance_evidence: item.acceptance_evidence ?? null,
    reviewers: normalizeArray(item.reviewers),
    supersedes_id: item.supersedes_id ?? null,
    superseded_by_id: item.superseded_by_id ?? null,
    ...(needsApprovalConfirmation ? { legacy_approval: { status: item.status, approved_by_id: item.approved_by_id ?? null, approved_at: item.approved_at ?? null, delivered_at: item.delivered_at ?? null, accepted_by_id: item.accepted_by_id ?? null, accepted_at: item.accepted_at ?? null } } : {}),
  };
}

async function migratedWikiCatalog(root, now) {
  const pages = [];
  for (const relative of await walkMarkdown(path.join(root, "knowledge", "wiki"))) {
    if (relative === ".gitkeep") continue;
    const pagePath = `knowledge/wiki/${relative}`;
    const content = await readFile(path.join(root, pagePath), "utf8");
    const info = await stat(path.join(root, pagePath));
    pages.push({
      id: `WIKI-${String(pages.length + 1).padStart(3, "0")}`,
      title: content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relative, ".md"),
      path: pagePath,
      status: "active",
      source_ids: [],
      related_ids: [],
      owner: null,
      last_reviewed_at: info.mtime?.toISOString() || now,
      review_due_at: null,
      supersedes_id: null,
      superseded_by_id: null,
    });
  }
  return pages;
}

async function migratedActivityEntries(root, now) {
  const entries = [];
  const activityRoot = path.join(root, "activity");
  if (!existsSync(activityRoot)) return entries;
  for (const entry of await readdir(activityRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)) continue;
    const content = await readFile(path.join(activityRoot, entry.name), "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^- (\d{4}-\d{2}-\d{2}T\S+)/);
      if (!match || !isTimestamp(match[1])) continue;
      const fields = {};
      for (let offset = index + 1; offset < lines.length && /^  - /.test(lines[offset]); offset += 1) {
        const field = lines[offset].match(/^  - ([^：]+)：(.*)$/);
        if (field) fields[field[1]] = field[2].trim();
      }
      const emptyToNull = (value) => !value || value === "—" ? null : value;
      entries.push({
        id: `ACT-${String(entries.length + 1).padStart(3, "0")}`,
        occurred_at: match[1],
        action: emptyToNull(fields["完成"]) || "v1 活动记录",
        outcome: emptyToNull(fields["结果"]) || "待确认",
        related_ids: emptyToNull(fields["关联"])?.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) || [],
        source_ids: [],
        evidence: emptyToNull(fields["证据"]),
        next_action: emptyToNull(fields["下一步"]),
        recorded_at: match[1] || now,
      });
    }
  }
  return entries;
}

export async function migrateWorkspaceV1ToV2(root, confirmation = {}, options = {}) {
  const legacyFiles = Object.fromEntries(await Promise.all(Object.entries(STORE_FILES).map(async ([key, relative]) => [key, await readOptionalJson(root, relative, { schema_version: 1 })])));
  const existingVersions = Object.values(legacyFiles).map((item) => item?.schema_version).filter((item) => item !== undefined);
  if (existingVersions.length && existingVersions.every((item) => item === SCHEMA_VERSION)) return { ok: true, already_migrated: true, schema_version: SCHEMA_VERSION };
  if (existingVersions.some((item) => ![1, SCHEMA_VERSION].includes(item))) throw new Error(JSON.stringify({ code: "unsupported_schema_version", versions: [...new Set(existingVersions)] }));

  const projectStakeholders = Array.isArray(legacyFiles.project.stakeholders) ? legacyFiles.project.stakeholders : [];
  const baselineItemCount = [...(legacyFiles.schedule.milestones || []), ...(legacyFiles.schedule.tasks || [])].filter((item) => item.baseline_start || item.baseline_end).length;
  const wikiCount = (await walkMarkdown(path.join(root, "knowledge", "wiki"))).filter((item) => item !== ".gitkeep").length;
  const activityFileCount = existsSync(path.join(root, "activity")) ? (await readdir(path.join(root, "activity"))).filter((item) => /^\d{4}-\d{2}-\d{2}\.md$/.test(item)).length : 0;
  const controlledRecordsNeedingConfirmation = [
    ...(legacyFiles.requirements.requirements || []).filter((item) => ["approved", "implemented", "validated"].includes(item.status)),
    ...(legacyFiles.requirements.change_requests || []).filter((item) => ["approved", "implemented"].includes(item.status)),
    ...(legacyFiles.registers.decisions || []).filter((item) => item.status === "approved"),
    ...(legacyFiles.deliverables.deliverables || []).filter((item) => ["approved", "delivered", "accepted"].includes(item.status)),
    ...(legacyFiles.proposals.proposals || []).filter((item) => ["approved", "active"].includes(item.status)),
  ].length;
  const stakeholderScopesNeedingConfirmation = [...(legacyFiles.stakeholders.stakeholders || []), ...projectStakeholders.filter((item) => typeof item === "object" && item)].reduce((count, item) => count + normalizeArray(item?.approval_scopes).length, 0);
  const impact = {
    from_schema_version: 1,
    to_schema_version: SCHEMA_VERSION,
    stores_rewritten: Object.values(STORE_FILES),
    project_stakeholders_to_structure: projectStakeholders.length,
    baseline_items_needing_confirmation: baselineItemCount,
    wiki_pages_to_register: wikiCount,
    activity_files_to_import: activityFileCount,
    controlled_records_needing_confirmation: controlledRecordsNeedingConfirmation,
    stakeholder_scopes_needing_confirmation: stakeholderScopesNeedingConfirmation,
    built_in_rules_not_promoted: true,
  };
  const previewDigest = digestValue(impact);
  if (confirmation.confirmed !== true || confirmation.preview_digest !== previewDigest) {
    return { ok: false, requires_confirmation: true, preview_digest: previewDigest, impact, fix: "Review the impact, then rerun with confirmed=true and this preview_digest" };
  }

  const now = isTimestamp(confirmation.confirmed_at) ? confirmation.confirmed_at : new Date().toISOString();
  const config = {
    default_timezone: "Asia/Hong_Kong",
    upcoming_days: 7,
    recent_activity_days: 7,
    stale_task_days: 7,
    large_tracked_file_mb: 25,
    repeat_observation_threshold: 2,
    rule_review_days: 30,
    memory_current_max_bytes: 4096,
    memory_current_stale_days: 14,
    verify_archive_hash_on_lint: true,
    archive_roots: ["archive/files", "deliverables/.render", ".harness/cache", ".harness/tmp", ".harness/backups"],
    ...legacyFiles.config,
    schema_version: SCHEMA_VERSION,
  };
  const project = { ...legacyFiles.project, schema_version: SCHEMA_VERSION };
  delete project.stakeholders;
  for (const field of ["scope_in", "scope_out", "success_criteria", "constraints"]) project[field] = normalizeArray(project[field]);
  const stakeholderRecords = [...(legacyFiles.stakeholders.stakeholders || [])];
  for (const item of projectStakeholders) {
    const candidate = typeof item === "string" ? { name: item, role: "未指定" } : item;
    if (!candidate || typeof candidate !== "object") continue;
    stakeholderRecords.push(candidate);
  }
  const stakeholders = { schema_version: SCHEMA_VERSION, stakeholders: stakeholderRecords.map((item, index) => {
    const legacyScopes = normalizeArray(item.approval_scopes).filter((scope) => APPROVAL_SCOPES.includes(scope));
    return { ...item, id: item.id || `STK-${String(index + 1).padStart(3, "0")}`, name: item.name || item.role || `干系人 ${index + 1}`, role: item.role || "未指定", organization: item.organization ?? null, status: item.status || "active", approval_scopes: [], ...(legacyScopes.length ? { legacy_approval_scopes: legacyScopes } : {}), source_ids: normalizeArray(item.source_ids), updated_at: item.updated_at || now };
  }) };
  const schedule = { schema_version: SCHEMA_VERSION, milestones: (legacyFiles.schedule.milestones || []).map((item) => migratedScheduleItem(item, "milestone", now)), tasks: (legacyFiles.schedule.tasks || []).map((item) => migratedScheduleItem(item, "task", now)) };
  schedule.baseline = { revision: 0, status: baselineItemCount ? "needs_confirmation" : "draft", digest: baselineDigest(schedule), approved_by_id: null, approved_at: null, change_request_id: null };
  const requirements = { schema_version: SCHEMA_VERSION, requirements: (legacyFiles.requirements.requirements || []).map((item) => migratedRequirement(item, now)), change_requests: (legacyFiles.requirements.change_requests || []).map((item) => migratedChangeRequest(item, now)) };
  const registers = { schema_version: SCHEMA_VERSION, risks: (legacyFiles.registers.risks || []).map((item) => migratedRegister(item, "risk", now)), issues: (legacyFiles.registers.issues || []).map((item) => migratedRegister(item, "issue", now)), decisions: (legacyFiles.registers.decisions || []).map((item) => migratedRegister(item, "decision", now)) };
  const sources = { schema_version: SCHEMA_VERSION, sources: (legacyFiles.sources.sources || []).map((item) => ({ ...item, stakeholder_id: item.stakeholder_id ?? null, summary: item.summary || item.title || item.id })) };
  const inbox = { schema_version: SCHEMA_VERSION, items: (legacyFiles.inbox.items || []).map((item) => ({ ...item, authority: item.authority || "unknown", related_ids: normalizeArray(item.related_ids), applied_to_ids: normalizeArray(item.applied_to_ids), applied_at: item.applied_at ?? null, disposition_reason: item.disposition_reason ?? null })) };
  const catalog = { schema_version: SCHEMA_VERSION, pages: (legacyFiles.catalog.pages || []).length ? legacyFiles.catalog.pages : await migratedWikiCatalog(root, now) };
  const observations = { schema_version: SCHEMA_VERSION, observations: (legacyFiles.observations.observations || []).map((item) => ({ ...item, evidence: item.evidence || item.title || "v1 迁移记录", suggested_rule: item.suggested_rule ?? null, proposal_id: item.proposal_id ?? null, created_at: item.created_at || now, resolved_at: item.resolved_at ?? null })) };
  const activity = { schema_version: SCHEMA_VERSION, entries: (legacyFiles.activity.entries || []).length ? legacyFiles.activity.entries : await migratedActivityEntries(root, now) };
  const deliverables = { schema_version: SCHEMA_VERSION, deliverables: (legacyFiles.deliverables.deliverables || []).map(migratedDeliverable) };
  const proposals = { schema_version: SCHEMA_VERSION, proposals: (legacyFiles.proposals.proposals || []).map((item) => {
    const needsApprovalConfirmation = ["approved", "active"].includes(item.status);
    return { ...item, status: needsApprovalConfirmation ? "proposed" : item.status, manual_reason: item.manual_reason ?? null, approved_by: needsApprovalConfirmation ? null : item.approved_by ?? null, approved_at: needsApprovalConfirmation ? null : item.approved_at ?? null, effective_at: needsApprovalConfirmation ? null : item.effective_at ?? null, pattern_key: item.pattern_key ?? observations.observations.find((observation) => observation.proposal_id === item.id)?.pattern_key ?? null, ...(needsApprovalConfirmation ? { legacy_approval: { status: item.status, approved_by: item.approved_by ?? null, approved_at: item.approved_at ?? null, effective_at: item.effective_at ?? null } } : {}) };
  }) };
  const rules = { schema_version: SCHEMA_VERSION, rules: (legacyFiles.rules.rules || []).filter((item) => item.proposal_id && proposals.proposals.some((proposal) => proposal.id === item.proposal_id && proposal.status === "active")) };
  const archive = { schema_version: SCHEMA_VERSION, files: (legacyFiles.archive.files || []).map((item) => ({ ...item, source_id: item.source_id ?? null, deliverable_id: item.deliverable_id ?? null, superseded_by: item.superseded_by ?? null })) };
  const oldChanges = (legacyFiles.changes.changes || []).map((item, index) => ({
    ...item,
    id: item.id || `CHG-${String(index + 1).padStart(3, "0")}`,
    operation_id: item.operation_id || `OP-legacy-change-${String(index + 1).padStart(3, "0")}`,
    kind: item.kind || "legacy_v1_change",
    target_ids: normalizeArray(item.target_ids),
    before_summary: item.before_summary ?? null,
    after_summary: item.after_summary ?? null,
    before_hash: /^[a-f0-9]{64}$/i.test(item.before_hash || "") ? item.before_hash : digestValue(item.before ?? item.before_summary ?? {}),
    after_hash: /^[a-f0-9]{64}$/i.test(item.after_hash || "") ? item.after_hash : digestValue(item.after ?? item.after_summary ?? {}),
    change_request_id: item.change_request_id ?? null,
    approved_by: item.approved_by || "legacy-unverified",
    effective_at: isTimestamp(item.effective_at) ? item.effective_at : now,
    source_ids: normalizeArray(item.source_ids),
    recorded_at: isTimestamp(item.recorded_at) ? item.recorded_at : now,
    baseline_revision: Number.isInteger(item.baseline_revision) ? item.baseline_revision : null,
  }));
  const operationId = `OP-migrate-v1-v2-${previewDigest.slice(0, 12)}`;
  const changes = { schema_version: SCHEMA_VERSION, changes: oldChanges, operations: [...(legacyFiles.changes.operations || []), { operation_id: operationId, type: "workspace.migrate.v1-v2", target_ids: [], recorded_at: now, result: { schema_version: SCHEMA_VERSION, impact } }] };
  const data = { config, project, stakeholders, schedule, requirements, registers, sources, inbox, catalog, observations, activity, deliverables, proposals, rules, changes, archive };
  const validationIssues = await collectIssues(root, data, { checkFiles: false, checkGenerated: false });
  const validationErrors = validationIssues.filter((item) => item.level === "error");
  if (validationErrors.length) throw new Error(JSON.stringify({ code: "migration_validation_failed", issues: validationErrors }));
  const entries = Object.entries(STORE_FILES).map(([key, relative]) => jsonEntry(relative, data[key]));
  entries.push(...await generatedEntries(root, data));
  await commitTransaction(root, operationId, entries, options);
  return { ok: true, migrated: true, schema_version: SCHEMA_VERSION, operation_id: operationId, impact };
}
