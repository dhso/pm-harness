import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ARCHIVE_AVAILABILITY,
  ID_PATTERNS,
  SCHEMA_VERSION,
  STATUS,
  baselineDigest,
  digestValue,
  isDate,
  isPlainObject,
  isTimestamp,
  validateRecord,
} from "./model.mjs";
import {
  ageInDays,
  digestFields,
  isWorkspaceRelativePath,
  localDate,
  sha256Path,
  text,
  validTimezone,
  walkMarkdown,
} from "./helpers.mjs";
import {
  COLLECTIONS,
  DECISION_CONTROLLED_FIELDS,
  DELIVERABLE_IMMUTABLE_FIELDS,
  REQUIREMENT_IMMUTABLE_FIELDS,
  STORE_FILES,
  readJson,
} from "./workspace.mjs";
import { generatedEntries } from "./views.mjs";
import { addEnvironmentIssues } from "./environment.mjs";
import { validateWorkspaceContract } from "./contracts.mjs";

function addIssue(issues, level, code, relativePath, message, fix = null) {
  issues.push({ level, code, path: relativePath, message, ...(fix ? { fix } : {}) });
}

function validateDatePair(issues, record, startField, endField, relativePath) {
  const start = record[startField];
  const end = record[endField];
  if (start !== null && start !== undefined && !isDate(start)) addIssue(issues, "error", "invalid_date", relativePath, `${record.id}: ${startField} must be YYYY-MM-DD`);
  if (end !== null && end !== undefined && !isDate(end)) addIssue(issues, "error", "invalid_date", relativePath, `${record.id}: ${endField} must be YYYY-MM-DD`);
  if (start && end && start > end) addIssue(issues, "error", "date_order", relativePath, `${record.id}: ${startField} is after ${endField}`);
}

function dependencyCycles(tasks) {
  const ids = new Set(tasks.map((item) => item.id));
  const graph = new Map(tasks.map((item) => [item.id, (item.dependency_ids || []).filter((id) => ids.has(id))]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(id, stack) {
    if (visiting.has(id)) {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) || []) visit(dependency, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of graph.keys()) visit(id, []);
  return cycles;
}

function validateRefs(issues, record, field, allowed, relativePath) {
  if (record[field] === undefined) return;
  if (!Array.isArray(record[field])) return;
  for (const id of record[field]) if (!allowed.has(id)) addIssue(issues, "error", "missing_reference", relativePath, `${record.id}: ${field} references missing ID ${id}`);
}

function timestampOrder(issues, record, fields, relativePath) {
  let previous = null;
  for (const field of fields) {
    const value = record[field];
    if (!value) continue;
    if (previous && Date.parse(value) < Date.parse(previous.value)) addIssue(issues, "error", "lifecycle_time_order", relativePath, `${record.id}: ${field} occurs before ${previous.field}`);
    previous = { field, value };
  }
}

function modelCollections(data, issues) {
  const allIds = new Set();
  const byKind = {};
  const ownersById = new Map();
  for (const [store, collection, kind] of COLLECTIONS) {
    const relativePath = STORE_FILES[store];
    const records = data[store]?.[collection];
    if (!Array.isArray(records)) {
      addIssue(issues, "error", "invalid_collection", relativePath, `${collection} must be an array`);
      byKind[kind] = [];
      continue;
    }
    byKind[kind] = records;
    const localIds = new Set();
    for (const record of records) {
      for (const issue of validateRecord(kind, record)) addIssue(issues, "error", issue.code, relativePath, issue.message);
      if (record?.id && localIds.has(record.id)) addIssue(issues, "error", "duplicate_id", relativePath, `Duplicate ID: ${record.id}`);
      if (record?.id) localIds.add(record.id);
      if (record?.id) {
        allIds.add(record.id);
        if (!ownersById.has(record.id)) ownersById.set(record.id, []);
        ownersById.get(record.id).push({ kind, relativePath });
      }
    }
  }
  for (const [id, owners] of ownersById) {
    if (owners.length < 2) continue;
    const kinds = owners.map((item) => item.kind).sort();
    const allowedRulePair = owners.length === 2 && kinds[0] === "proposal" && kinds[1] === "rule";
    if (!allowedRulePair) addIssue(issues, "error", "duplicate_id", owners.at(-1).relativePath, `Duplicate ID across workspace: ${id}`);
  }
  if (data.project.id) {
    if (allIds.has(data.project.id)) addIssue(issues, "error", "duplicate_id", STORE_FILES.project, `Project ID duplicates another workspace ID: ${data.project.id}`);
    allIds.add(data.project.id);
  }
  return { allIds, byKind };
}

export async function collectIssues(root, data, options = {}) {
  const issues = [];
  const pendingPaths = new Set(options.pendingPaths || []);
  // checkFiles 为旧调用方保留；新调用方应分别控制哈希与 Wiki 注册扫描。
  const checkContentHashes = options.checkContentHashes ?? options.checkFiles ?? true;
  const checkWikiRegistration = options.checkWikiRegistration ?? options.checkFiles ?? true;
  const exists = (relative) => pendingPaths.has(relative.split(path.sep).join("/")) || existsSync(path.join(root, relative));
  for (const [key, relative] of Object.entries(STORE_FILES)) {
    if (!isPlainObject(data[key])) addIssue(issues, "error", "invalid_store", relative, "Top-level store must be an object");
    else if (data[key].schema_version !== SCHEMA_VERSION) addIssue(issues, "error", "schema_version", relative, `schema_version must be ${SCHEMA_VERSION}`, "Update the file to the current workspace contract before other writes");
  }
  if (issues.some((issue) => issue.code === "invalid_store")) return issues;
  for (const issue of validateWorkspaceContract(data)) addIssue(issues, "error", issue.code, issue.path, issue.message);

  if (!STATUS.project.includes(data.project.status)) addIssue(issues, "error", "invalid_status", STORE_FILES.project, `Unsupported project status: ${data.project.status}`);
  if (!validTimezone(data.project.timezone || data.config.default_timezone)) addIssue(issues, "error", "invalid_timezone", STORE_FILES.project, "Project/default timezone must be a valid IANA timezone");
  if (!validTimezone(data.config.default_timezone)) addIssue(issues, "error", "invalid_timezone", STORE_FILES.config, "default_timezone must be a valid IANA timezone");
  for (const field of ["upcoming_days", "recent_activity_days", "stale_task_days", "large_tracked_file_mb", "repeat_observation_threshold", "rule_review_days", "memory_current_max_bytes", "memory_current_stale_days"]) {
    if (!Number.isFinite(data.config[field]) || data.config[field] <= 0) addIssue(issues, "error", "invalid_config", STORE_FILES.config, `${field} must be a positive number`);
  }
  if (!Array.isArray(data.config.archive_roots) || !data.config.archive_roots.every((item) => typeof item === "string" && item)) addIssue(issues, "error", "invalid_config", STORE_FILES.config, "archive_roots must be a non-empty string array");
  if (data.project.initialized) {
    for (const field of ["id", "name", "timezone", "objective", "scope_in", "scope_out", "success_criteria", "constraints"]) {
      if (data.project[field] === undefined || data.project[field] === "") addIssue(issues, "error", "missing_project_field", STORE_FILES.project, `Initialized project is missing ${field}`);
    }
    if (!ID_PATTERNS.project.test(data.project.id || "")) addIssue(issues, "error", "invalid_id", STORE_FILES.project, `Invalid project ID: ${text(data.project.id)}`);
    for (const field of ["scope_in", "scope_out", "success_criteria", "constraints"]) if (!Array.isArray(data.project[field]) || !data.project[field].every((item) => typeof item === "string" && item)) addIssue(issues, "error", "invalid_project_field", STORE_FILES.project, `${field} must be a string array`);
    if (!Array.isArray(data.project.success_criteria) || !data.project.success_criteria.length) addIssue(issues, "warning", "missing_success_criteria", STORE_FILES.project, "Initialized project has no success criteria");
  }
  const { allIds, byKind } = modelCollections(data, issues);
  const ids = (kind) => new Set((byKind[kind] || []).map((item) => item.id));
  const sourceIds = ids("source");
  const stakeholderIds = ids("stakeholder");
  const stakeholderById = new Map((byKind.stakeholder || []).map((item) => [item.id, item]));
  const canApprove = (id, scope) => {
    const stakeholder = stakeholderById.get(id);
    return Boolean(stakeholder && stakeholder.status === "active" && stakeholder.approval_scopes.includes(scope));
  };
  const requirementIds = ids("requirement");
  const deliverableIds = ids("deliverable");
  const taskIds = ids("task");
  const proposalIds = ids("proposal");
  const observationIds = ids("observation");
  const ruleIds = ids("rule");
  const changeRequestIds = ids("change_request");

  for (const stakeholder of byKind.stakeholder || []) validateRefs(issues, stakeholder, "source_ids", sourceIds, STORE_FILES.stakeholders);
  for (const record of [...(byKind.milestone || []), ...(byKind.task || [])]) {
    validateDatePair(issues, record, "baseline_start", "baseline_end", STORE_FILES.schedule);
    validateDatePair(issues, record, "forecast_start", "forecast_end", STORE_FILES.schedule);
    validateDatePair(issues, record, "actual_start", "actual_end", STORE_FILES.schedule);
    validateRefs(issues, record, "requirement_ids", requirementIds, STORE_FILES.schedule);
    validateRefs(issues, record, "deliverable_ids", deliverableIds, STORE_FILES.schedule);
    validateRefs(issues, record, "source_ids", sourceIds, STORE_FILES.schedule);
    for (const dependency of record.dependency_ids || []) {
      if (dependency === record.id) addIssue(issues, "error", "self_dependency", STORE_FILES.schedule, `${record.id} depends on itself`);
      else if (!taskIds.has(dependency)) addIssue(issues, "error", "missing_dependency", STORE_FILES.schedule, `${record.id} references missing task ${dependency}`);
    }
    if (!["done", "cancelled"].includes(record.status) && !record.owner) addIssue(issues, "warning", "owner_missing", STORE_FILES.schedule, `${record.id} has no accountable owner`);
    if (record.status === "done" && !record.actual_end) addIssue(issues, "error", "done_without_actual", STORE_FILES.schedule, `${record.id} is done without actual_end`);
    if (record.status === "done" && !record.evidence) addIssue(issues, "warning", "done_without_evidence", STORE_FILES.schedule, `${record.id} is done without evidence`);
    if (record.baseline_end && record.forecast_end && record.forecast_end > record.baseline_end) addIssue(issues, "info", "schedule_variance", STORE_FILES.schedule, `${record.id} forecast is later than baseline`);
    const staleDays = ageInDays(record.updated_at);
    if (!["done", "cancelled"].includes(record.status) && staleDays !== null && staleDays > Number(data.config.stale_task_days || 7)) addIssue(issues, "info", "stale_schedule_item", STORE_FILES.schedule, `${record.id} has not been updated for ${staleDays} days`);
  }
  for (const cycle of dependencyCycles(byKind.task || [])) addIssue(issues, "error", "dependency_cycle", STORE_FILES.schedule, `Task dependency cycle: ${cycle.join(" -> ")}`);

  const currentBaselineDigest = baselineDigest(data.schedule);
  const baseline = data.schedule.baseline;
  const baselineChanges = (byKind.change || []).filter((item) => item.kind === "schedule_baseline");
  for (let index = 0; index < baselineChanges.length; index += 1) {
    const revision = baselineChanges[index].baseline_revision;
    const previous = baselineChanges[index - 1]?.baseline_revision || 0;
    if (!Number.isInteger(revision) || revision <= previous) addIssue(issues, "error", "baseline_revision_nonmonotonic", STORE_FILES.changes, `${baselineChanges[index].id} revision ${revision} must be greater than ${previous}`);
  }
  if (!isPlainObject(baseline) || !Number.isInteger(baseline.revision) || !["draft", "approved"].includes(baseline.status) || baseline.digest !== currentBaselineDigest) {
    addIssue(issues, "error", "baseline_metadata_invalid", STORE_FILES.schedule, "Baseline revision, status, or digest does not match current baseline fields");
  } else if (baseline.status === "approved") {
    // 空基线通过校验只是因为空快照的摘要恰好自洽，这里补上内容层的检查。
    if (![...(byKind.milestone || []), ...(byKind.task || [])].some((item) => item.baseline_start || item.baseline_end)) {
      addIssue(issues, "error", "baseline_empty", STORE_FILES.schedule, "Baseline is approved but no task or milestone carries baseline dates");
    }
    const latest = baselineChanges.at(-1);
    if (!latest || latest.baseline_revision !== baseline.revision || latest.after_hash !== currentBaselineDigest) addIssue(issues, "error", "baseline_approval_missing", STORE_FILES.schedule, "Approved baseline has no matching latest controlled change record");
    if (!canApprove(baseline.approved_by_id, "schedule_baseline") || !isTimestamp(baseline.approved_at)) addIssue(issues, "error", "baseline_authority_invalid", STORE_FILES.schedule, "Approved baseline lacks an active stakeholder with schedule_baseline scope and a valid approval time");
  } else if ([...(byKind.milestone || []), ...(byKind.task || [])].some((item) => item.baseline_start || item.baseline_end)) {
    addIssue(issues, "warning", "baseline_confirmation_required", STORE_FILES.schedule, "Baseline dates are preserved but still need authority confirmation");
  }

  for (const source of byKind.source || []) {
    if (source.stakeholder_id && !stakeholderIds.has(source.stakeholder_id)) addIssue(issues, "error", "missing_stakeholder", STORE_FILES.sources, `${source.id} references missing stakeholder ${source.stakeholder_id}`);
    if (source.archived_path && (!isWorkspaceRelativePath(root, source.archived_path) || !source.archived_path.replaceAll("\\", "/").startsWith("archive/files/"))) addIssue(issues, "error", "invalid_archive_path", STORE_FILES.sources, `${source.id} archive path must stay under archive/files`);
    if (source.archived_path && !exists(source.archived_path)) addIssue(issues, "info", "archive_unavailable", STORE_FILES.sources, `${source.id} archive is not present on this machine: ${source.archived_path}`);
  }
  for (const item of byKind.inbox || []) {
    if (!sourceIds.has(item.source_id)) addIssue(issues, "error", "missing_source", STORE_FILES.inbox, `${item.id} references missing source ${item.source_id}`);
    validateRefs(issues, item, "related_ids", allIds, STORE_FILES.inbox);
    if (item.status === "applied" && (!(item.applied_to_ids || []).length || !item.applied_at)) addIssue(issues, "error", "inbox_application_missing", STORE_FILES.inbox, `${item.id} is applied without applied_to_ids and applied_at`);
    if (["archived", "rejected", "needs_confirmation"].includes(item.status) && !item.disposition_reason) addIssue(issues, "error", "inbox_disposition_missing", STORE_FILES.inbox, `${item.id} is ${item.status} without disposition_reason`);
  }

  for (const item of byKind.requirement || []) {
    validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.requirements);
    if (["approved", "implemented", "validated"].includes(item.status) && (!canApprove(item.approved_by_id, "requirement") || !item.approved_at)) addIssue(issues, "error", "requirement_approval_missing", STORE_FILES.requirements, `${item.id} is ${item.status} without an active approver in requirement scope and approval time`);
    if (["approved", "implemented", "validated"].includes(item.status)) {
      const approvalChange = (byKind.change || []).findLast((change) => change.kind === "requirement" && change.target_ids.includes(item.id));
      if (!approvalChange || approvalChange.after_hash !== digestFields(item, REQUIREMENT_IMMUTABLE_FIELDS)) addIssue(issues, "error", "requirement_approved_snapshot_mismatch", STORE_FILES.requirements, `${item.id} no longer matches its last approved content snapshot`);
    }
    if (item.superseded_by_id && !requirementIds.has(item.superseded_by_id)) addIssue(issues, "error", "invalid_supersession", STORE_FILES.requirements, `${item.id} references missing replacement ${item.superseded_by_id}`);
    if (item.status === "superseded" && !item.superseded_by_id) addIssue(issues, "error", "supersession_missing", STORE_FILES.requirements, `${item.id} is superseded without a replacement`);
    if (item.supersedes_id && !requirementIds.has(item.supersedes_id)) addIssue(issues, "error", "invalid_supersession", STORE_FILES.requirements, `${item.id} references missing predecessor ${item.supersedes_id}`);
    if (item.superseded_by_id && (byKind.requirement || []).find((candidate) => candidate.id === item.superseded_by_id)?.supersedes_id !== item.id) addIssue(issues, "error", "supersession_link_mismatch", STORE_FILES.requirements, `${item.id} replacement link is not reciprocal`);
  }
  for (const item of byKind.change_request || []) {
    validateRefs(issues, item, "target_ids", allIds, STORE_FILES.requirements);
    validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.requirements);
    const changeItemIds = new Set((item.change_items || []).map((change) => change.target_id));
    if (changeItemIds.size !== item.target_ids.length || item.target_ids.some((id) => !changeItemIds.has(id))) addIssue(issues, ["approved", "implemented"].includes(item.status) ? "error" : "warning", "change_request_items_mismatch", STORE_FILES.requirements, `${item.id} must contain one exact change_item per target before approval`);
    if (["approved", "implemented"].includes(item.status) && item.approved_change_digest !== digestValue(item.change_items)) addIssue(issues, "error", "change_request_approved_snapshot_mismatch", STORE_FILES.requirements, `${item.id} no longer matches the approved exact change`);
    if ((item.applied_target_ids || []).some((id) => !item.target_ids.includes(id))) addIssue(issues, "error", "change_request_application_mismatch", STORE_FILES.requirements, `${item.id} records an applied target outside its approved target set`);
    if (item.status === "implemented" && (!item.applied_at || item.target_ids.some((id) => !item.applied_target_ids.includes(id)))) addIssue(issues, "error", "change_request_application_incomplete", STORE_FILES.requirements, `${item.id} is implemented without all targets and applied_at`);
    if (["approved", "implemented"].includes(item.status) && (!canApprove(item.approved_by_id, item.approval_scope) || !item.confirmed_by_user_at || !item.effective_at)) addIssue(issues, "error", "change_approval_missing", STORE_FILES.requirements, `${item.id} lacks structured approval evidence or approval scope`);
  }

  for (const kind of ["risk", "issue", "decision"]) {
    for (const item of byKind[kind] || []) {
      validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.registers);
      if (["resolved", "closed"].includes(item.status) && !item.resolution) addIssue(issues, "warning", "resolution_missing", STORE_FILES.registers, `${item.id} is closed without a resolution`);
      if (kind === "decision" && item.status === "approved" && (!canApprove(item.approved_by_id, "decision") || !item.approved_at)) addIssue(issues, "error", "decision_approval_missing", STORE_FILES.registers, `${item.id} is approved without an active approver in decision scope`);
      if (kind === "decision" && item.status === "approved") {
        const approvalChange = (byKind.change || []).findLast((change) => ["decision", "decision_revision"].includes(change.kind) && change.target_ids.includes(item.id));
        if (!approvalChange || approvalChange.after_hash !== digestFields(item, DECISION_CONTROLLED_FIELDS)) addIssue(issues, "error", "decision_approved_snapshot_mismatch", STORE_FILES.registers, `${item.id} no longer matches its approved snapshot`);
      }
    }
  }

  for (const item of byKind.activity || []) {
    validateRefs(issues, item, "related_ids", allIds, STORE_FILES.activity);
    validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.activity);
  }

  for (const item of byKind.deliverable || []) {
    validateRefs(issues, item, "requirement_ids", requirementIds, STORE_FILES.deliverables);
    validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.deliverables);
    if (item.path && !isWorkspaceRelativePath(root, item.path)) addIssue(issues, "error", "invalid_deliverable_path", STORE_FILES.deliverables, `${item.id} path escapes the workspace: ${item.path}`);
    else if (item.path && !exists(item.path)) addIssue(issues, ["superseded", "cancelled"].includes(item.status) ? "info" : "error", "deliverable_missing", STORE_FILES.deliverables, `${item.id} path does not exist: ${item.path}`);
    if (["approved", "delivered", "accepted"].includes(item.status) && (!canApprove(item.approved_by_id, "deliverable") || !item.approved_at)) addIssue(issues, "error", "deliverable_approval_missing", STORE_FILES.deliverables, `${item.id} lacks an active approver in deliverable scope or approval time`);
    if (["approved", "delivered", "accepted"].includes(item.status)) {
      const approvalChange = (byKind.change || []).findLast((change) => change.kind === "deliverable_approval" && change.target_ids.includes(item.id));
      if (!approvalChange || approvalChange.after_hash !== digestFields(item, DELIVERABLE_IMMUTABLE_FIELDS)) addIssue(issues, "error", "deliverable_approved_snapshot_mismatch", STORE_FILES.deliverables, `${item.id} no longer matches its approved metadata snapshot`);
      if (!item.content_sha256) addIssue(issues, "error", "deliverable_content_hash_missing", STORE_FILES.deliverables, `${item.id} has no approved file hash`);
      else if (item.path && isWorkspaceRelativePath(root, item.path) && existsSync(path.join(root, item.path)) && checkContentHashes && await sha256Path(path.join(root, item.path)) !== item.content_sha256) addIssue(issues, "error", "deliverable_content_hash_mismatch", STORE_FILES.deliverables, `${item.id} file content differs from the approved hash`);
    }
    if (["delivered", "accepted"].includes(item.status) && !item.delivered_at) addIssue(issues, "error", "delivery_time_missing", STORE_FILES.deliverables, `${item.id} lacks delivered_at`);
    if (item.status === "accepted" && (!item.accepted_at || !canApprove(item.accepted_by_id, "acceptance") || !item.acceptance_evidence)) addIssue(issues, "error", "acceptance_missing", STORE_FILES.deliverables, `${item.id} lacks acceptance authority, time, or evidence`);
    timestampOrder(issues, item, ["completed_at", "approved_at", "delivered_at", "accepted_at"], STORE_FILES.deliverables);
    if (item.status === "superseded" && !item.superseded_by_id) addIssue(issues, "error", "supersession_missing", STORE_FILES.deliverables, `${item.id} is superseded without a replacement`);
    if (item.superseded_by_id && (!deliverableIds.has(item.superseded_by_id) || item.superseded_by_id === item.id)) addIssue(issues, "error", "invalid_supersession", STORE_FILES.deliverables, `${item.id} has invalid replacement ${item.superseded_by_id}`);
    if (item.supersedes_id && (!deliverableIds.has(item.supersedes_id) || item.supersedes_id === item.id)) addIssue(issues, "error", "invalid_supersession", STORE_FILES.deliverables, `${item.id} has invalid predecessor ${item.supersedes_id}`);
    if (item.superseded_by_id && (byKind.deliverable || []).find((candidate) => candidate.id === item.superseded_by_id)?.supersedes_id !== item.id) addIssue(issues, "error", "supersession_link_mismatch", STORE_FILES.deliverables, `${item.id} replacement link is not reciprocal`);
  }
  for (const start of byKind.deliverable || []) {
    const seen = new Set([start.id]);
    let next = start.superseded_by_id;
    while (next) {
      if (seen.has(next)) {
        addIssue(issues, "error", "supersession_cycle", STORE_FILES.deliverables, `Deliverable supersession cycle starts at ${start.id}`);
        break;
      }
      seen.add(next);
      next = (byKind.deliverable || []).find((item) => item.id === next)?.superseded_by_id;
    }
  }

  const catalogPaths = new Set();
  for (const item of byKind.wiki || []) {
    const normalized = item.path.replaceAll("\\", "/");
    if (!normalized.startsWith("knowledge/wiki/") || !normalized.endsWith(".md") || normalized.includes("../")) addIssue(issues, "error", "invalid_wiki_path", STORE_FILES.catalog, `${item.id} has invalid Wiki path: ${item.path}`);
    if (catalogPaths.has(normalized)) addIssue(issues, "error", "duplicate_wiki_path", STORE_FILES.catalog, `Multiple Wiki records use ${normalized}`);
    catalogPaths.add(normalized);
    if (!exists(normalized)) addIssue(issues, "error", "wiki_page_missing", STORE_FILES.catalog, `${item.id} page does not exist: ${normalized}`);
    validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.catalog);
    validateRefs(issues, item, "related_ids", allIds, STORE_FILES.catalog);
    if (item.superseded_by_id && !ids("wiki").has(item.superseded_by_id)) addIssue(issues, "error", "invalid_supersession", STORE_FILES.catalog, `${item.id} references missing Wiki replacement ${item.superseded_by_id}`);
    if (item.supersedes_id && !ids("wiki").has(item.supersedes_id)) addIssue(issues, "error", "invalid_supersession", STORE_FILES.catalog, `${item.id} references missing Wiki predecessor ${item.supersedes_id}`);
    if (item.status === "active" && !item.source_ids.length) addIssue(issues, "warning", "wiki_source_missing", STORE_FILES.catalog, `${item.id} has no registered source`);
    if (item.status === "active" && !item.last_reviewed_at) addIssue(issues, "warning", "wiki_never_reviewed", STORE_FILES.catalog, `${item.id} has never been reviewed`);
    if (item.status === "active" && item.review_due_at && item.review_due_at <= localDate(data.project.timezone || data.config.default_timezone || "UTC")) addIssue(issues, "warning", "wiki_review_overdue", STORE_FILES.catalog, `${item.id} review was due on ${item.review_due_at}`);
    if (item.status === "superseded" && !item.superseded_by_id) addIssue(issues, "error", "supersession_missing", STORE_FILES.catalog, `${item.id} is superseded without a replacement`);
    if (item.superseded_by_id && (byKind.wiki || []).find((candidate) => candidate.id === item.superseded_by_id)?.id && (byKind.wiki || []).find((candidate) => candidate.id === item.superseded_by_id)?.supersedes_id !== item.id) addIssue(issues, "error", "supersession_link_mismatch", STORE_FILES.catalog, `${item.id} replacement link is not reciprocal`);
  }
  if (checkWikiRegistration) {
    for (const file of await walkMarkdown(path.join(root, "knowledge/wiki"))) {
      if (file === ".gitkeep") continue;
      const normalized = `knowledge/wiki/${file}`;
      if (!catalogPaths.has(normalized)) addIssue(issues, "error", "wiki_not_registered", normalized, "Wiki page is not registered in knowledge/catalog.json");
    }
  }

  for (const item of byKind.observation || []) {
    if (item.proposal_id && !proposalIds.has(item.proposal_id)) addIssue(issues, "error", "missing_proposal", STORE_FILES.observations, `${item.id} references missing proposal ${item.proposal_id}`);
    const proposal = item.proposal_id ? (byKind.proposal || []).find((candidate) => candidate.id === item.proposal_id) : null;
    if (proposal && !proposal.observation_ids.includes(item.id)) addIssue(issues, "error", "proposal_observation_link_mismatch", STORE_FILES.observations, `${item.id} is not listed by ${proposal.id}`);
  }
  const groups = new Map();
  for (const item of byKind.observation || []) {
    if (["resolved", "dismissed"].includes(item.status) || item.proposal_id) continue;
    if (!groups.has(item.pattern_key)) groups.set(item.pattern_key, []);
    groups.get(item.pattern_key).push(item);
  }
  for (const [pattern, items] of groups) if (items.length >= Number(data.config.repeat_observation_threshold || 2)) addIssue(issues, "info", "rule_candidate", STORE_FILES.observations, `${items.length} observations share pattern '${pattern}'`);
  for (const item of byKind.proposal || []) {
    validateRefs(issues, item, "observation_ids", observationIds, STORE_FILES.proposals);
    if (!item.observation_ids.length && !item.manual_reason) addIssue(issues, "error", "rule_evidence_missing", STORE_FILES.proposals, `${item.id} has neither observations nor a manual reason`);
    for (const observationId of item.observation_ids) {
      const observation = (byKind.observation || []).find((candidate) => candidate.id === observationId);
      if (observation && observation.proposal_id !== item.id) addIssue(issues, "error", "proposal_observation_link_mismatch", STORE_FILES.proposals, `${item.id} lists ${observationId}, but the observation points elsewhere`);
    }
    if (["approved", "active"].includes(item.status) && (!item.approved_by || !item.approved_at)) addIssue(issues, "error", "rule_approval_missing", STORE_FILES.proposals, `${item.id} is ${item.status} without user approval`);
    if (item.status === "active" && !item.effective_at) addIssue(issues, "error", "rule_effective_time_missing", STORE_FILES.proposals, `${item.id} is active without effective_at`);
  }
  for (const item of byKind.rule || []) {
    if (!proposalIds.has(item.proposal_id) || item.proposal_id !== item.id) addIssue(issues, "error", "rule_proposal_missing", STORE_FILES.rules, `${item.id} has no matching proposal`);
    const proposal = (byKind.proposal || []).find((candidate) => candidate.id === item.proposal_id);
    if (item.status === "active" && proposal?.status !== "active") addIssue(issues, "error", "rule_state_mismatch", STORE_FILES.rules, `${item.id} is active but its proposal is not`);
    if (item.status === "active" && proposal && (item.text !== proposal.proposed_rule || item.scope !== proposal.scope || item.effective_at !== proposal.effective_at || item.review_at !== proposal.review_at)) addIssue(issues, "error", "rule_snapshot_mismatch", STORE_FILES.rules, `${item.id} differs from its approved proposal`);
  }
  for (const item of byKind.proposal || []) if (item.status === "active" && !ruleIds.has(item.id)) addIssue(issues, "error", "active_rule_missing", STORE_FILES.proposals, `${item.id} is active without a rule record`);

  for (const item of byKind.change || []) {
    validateRefs(issues, item, "target_ids", allIds, STORE_FILES.changes);
    validateRefs(issues, item, "source_ids", sourceIds, STORE_FILES.changes);
    if (item.change_request_id && !changeRequestIds.has(item.change_request_id)) addIssue(issues, "error", "change_request_missing", STORE_FILES.changes, `${item.id} references missing change request ${item.change_request_id}`);
    if (item.approved_by !== "user" && !stakeholderIds.has(item.approved_by)) addIssue(issues, "error", "change_approver_missing", STORE_FILES.changes, `${item.id} references missing approver ${item.approved_by}`);
  }

  for (const item of byKind.archive || []) {
    if (!isWorkspaceRelativePath(root, item.path) || !item.path.replaceAll("\\", "/").startsWith("archive/files/")) addIssue(issues, "error", "invalid_archive_path", STORE_FILES.archive, `${item.id} path must stay under archive/files`);
    if (!allIds.has(item.logical_id)) addIssue(issues, "warning", "archive_logical_id_missing", STORE_FILES.archive, `${item.id} references missing logical ID ${item.logical_id}`);
    if (item.source_id && !sourceIds.has(item.source_id)) addIssue(issues, "error", "archive_source_missing", STORE_FILES.archive, `${item.id} references missing source ${item.source_id}`);
    if (item.deliverable_id && !deliverableIds.has(item.deliverable_id)) addIssue(issues, "error", "archive_deliverable_missing", STORE_FILES.archive, `${item.id} references missing deliverable ${item.deliverable_id}`);
    if (!ARCHIVE_AVAILABILITY.includes(item.availability)) addIssue(issues, "error", "invalid_archive_availability", STORE_FILES.archive, `${item.id} has invalid availability`);
    if (item.availability === "local" && !exists(item.path)) addIssue(issues, "info", "archive_unavailable", STORE_FILES.archive, `${item.id} is not present on this machine`);
    if (checkContentHashes && data.config.verify_archive_hash_on_lint !== false && item.availability === "local" && isWorkspaceRelativePath(root, item.path) && existsSync(path.join(root, item.path))) {
      if (await sha256Path(path.join(root, item.path)) !== item.sha256) addIssue(issues, "error", "archive_content_hash_mismatch", STORE_FILES.archive, `${item.id} file content does not match its SHA-256`);
    }
  }
  for (const source of byKind.source || []) {
    if (!source.archived_path) continue;
    const entry = (byKind.archive || []).find((item) => item.source_id === source.id && item.path === source.archived_path);
    if (!entry) addIssue(issues, "error", "archive_index_missing", STORE_FILES.sources, `${source.id} has archived_path but no matching archive record`);
    else if (source.sha256 !== entry.sha256) addIssue(issues, "error", "archive_hash_mismatch", STORE_FILES.archive, `${entry.id} hash differs from ${source.id}`);
  }

  if (!Array.isArray(data.changes.operations)) addIssue(issues, "error", "invalid_collection", STORE_FILES.changes, "operations must be an array");
  else {
    const operationIds = new Set();
    for (const item of data.changes.operations) {
      if (!ID_PATTERNS.operation.test(item.operation_id || "")) addIssue(issues, "error", "invalid_operation_id", STORE_FILES.changes, `Invalid operation ID: ${text(item.operation_id)}`);
      if (operationIds.has(item.operation_id)) addIssue(issues, "error", "duplicate_operation_id", STORE_FILES.changes, `Duplicate operation ID: ${item.operation_id}`);
      operationIds.add(item.operation_id);
      if (!isTimestamp(item.recorded_at) || !Array.isArray(item.target_ids)) addIssue(issues, "error", "invalid_operation_record", STORE_FILES.changes, `${item.operation_id} has invalid metadata`);
      if (item.request_hash !== undefined && item.request_hash !== null && !/^[a-f0-9]{64}$/i.test(item.request_hash)) addIssue(issues, "error", "invalid_operation_record", STORE_FILES.changes, `${item.operation_id} has invalid request_hash`);
    }
  }

  if (options.checkGenerated !== false) {
    const expected = await generatedEntries(root, data, { pruneActivity: false });
    for (const entry of expected.filter((item) => !item.delete)) {
      try {
        if (await readFile(path.join(root, entry.path), "utf8") !== entry.content) addIssue(issues, "error", "generated_drift", entry.path, "Generated view is out of sync", "Run the Harness rebuild once");
      } catch {
        addIssue(issues, "error", "generated_missing", entry.path, "Generated view is missing", "Run the Harness rebuild once");
      }
    }
  }
  return issues;
}

function summarizeIssues(issues, fast = false) {
  return {
    ok: !issues.some((item) => item.level === "error"),
    ...(fast ? { mode: "fast", skipped_checks: ["file_content_hash"] } : { mode: "full" }),
    counts: {
      error: issues.filter((item) => item.level === "error").length,
      warning: issues.filter((item) => item.level === "warning").length,
      info: issues.filter((item) => item.level === "info").length,
    },
    issues,
  };
}

// fast 模式跳过逐文件 SHA-256 校验（归档与交付物内容哈希），用于任务收尾；
// maintain 与显式完整检查仍执行全量校验。
export async function lintWorkspace(root, { fast = false } = {}) {
  const data = {};
  const issues = [];
  for (const [key, relative] of Object.entries(STORE_FILES)) {
    try {
      data[key] = await readJson(root, relative);
    } catch (error) {
      addIssue(issues, "error", "invalid_json", relative, error.message);
    }
  }
  if (issues.length) return summarizeIssues(issues, fast);
  issues.push(...await collectIssues(root, data, fast ? { checkContentHashes: false, checkWikiRegistration: true } : {}));
  await addEnvironmentIssues(root, data, issues);
  return summarizeIssues(issues, fast);
}
