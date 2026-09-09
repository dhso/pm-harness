import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 2;

export const STATUS = Object.freeze({
  project: ["uninitialized", "active", "on_hold", "completed", "cancelled"],
  stakeholder: ["active", "inactive"],
  task: ["not_started", "in_progress", "blocked", "done", "cancelled"],
  requirement: ["candidate", "proposed", "approved", "implemented", "validated", "superseded", "rejected"],
  change_request: ["proposed", "impact_review", "approved", "rejected", "implemented"],
  register: ["open", "monitoring", "mitigated", "resolved", "accepted", "closed"],
  decision: ["proposed", "approved", "rejected", "superseded"],
  deliverable: ["requested", "drafting", "review", "approved", "delivered", "accepted", "superseded", "cancelled"],
  inbox: ["new", "triaged", "needs_confirmation", "applied", "archived", "rejected"],
  observation: ["open", "resolved", "dismissed"],
  proposal: ["proposed", "approved", "active", "rejected", "retired"],
  rule: ["active", "retired"],
  wiki: ["active", "superseded", "archived"],
});

export const APPROVAL_SCOPES = Object.freeze([
  "objective",
  "scope",
  "budget",
  "schedule_baseline",
  "requirement",
  "decision",
  "deliverable",
  "acceptance",
]);

export const SOURCE_TYPES = Object.freeze([
  "email",
  "email_screenshot",
  "chat",
  "chat_screenshot",
  "daily_note",
  "office_document",
  "text_document",
  "external_connector",
  "other",
]);

export const INBOX_CLASSIFICATIONS = Object.freeze([
  "fact",
  "feedback",
  "request",
  "decision",
  "commitment",
  "action",
  "risk",
  "issue",
  "question",
  "assumption",
]);

export const ARCHIVE_AVAILABILITY = Object.freeze(["local", "missing", "external", "deleted"]);

export const OPERATION_TYPES = Object.freeze([
  "project.initialize",
  "project.update",
  "stakeholder.upsert",
  "source.register",
  "activity.record",
  "schedule.upsert",
  "schedule.baseline.approve",
  "requirement.upsert",
  "register.upsert",
  "change.propose",
  "change.approve",
  "inbox.transition",
  "deliverable.upsert",
  "deliverable.transition",
  "wiki.register",
  "observation.record",
  "rule.propose",
  "rule.activate",
  "rule.retire",
  "workflow.apply",
]);

export const ID_PATTERNS = Object.freeze({
  project: /^PRJ-\d{3,}$/,
  stakeholder: /^STK-\d{3,}$/,
  milestone: /^MS-\d{3,}$/,
  task: /^TASK-\d{3,}$/,
  requirement: /^REQ-\d{3,}$/,
  change_request: /^CR-\d{3,}$/,
  risk: /^RISK-\d{3,}$/,
  issue: /^ISSUE-\d{3,}$/,
  decision: /^DEC-\d{3,}$/,
  source: /^SRC-\d{3,}$/,
  inbox: /^INB-\d{3,}$/,
  activity: /^ACT-\d{3,}$/,
  deliverable: /^DEL-\d{3,}$/,
  wiki: /^WIKI-\d{3,}$/,
  observation: /^OBS-\d{3,}$/,
  proposal: /^RULE-\d{3,}$/,
  rule: /^RULE-\d{3,}$/,
  archive: /^ARC-\d{3,}$/,
  change: /^CHG-\d{3,}$/,
  operation: /^OP-[A-Za-z0-9][A-Za-z0-9._-]{5,}$/,
});

export const TRANSITIONS = Object.freeze({
  task: {
    not_started: ["in_progress", "blocked", "cancelled"],
    in_progress: ["blocked", "done", "cancelled"],
    blocked: ["in_progress", "done", "cancelled"],
    done: [],
    cancelled: [],
  },
  project: {
    uninitialized: ["active"],
    active: ["on_hold", "completed", "cancelled"],
    on_hold: ["active", "cancelled"],
    completed: [],
    cancelled: [],
  },
  requirement: {
    candidate: ["proposed", "rejected"],
    proposed: ["approved", "rejected"],
    approved: ["implemented", "superseded"],
    implemented: ["validated", "superseded"],
    validated: ["superseded"],
    superseded: [],
    rejected: [],
  },
  change_request: {
    proposed: ["impact_review", "approved", "rejected"],
    impact_review: ["approved", "rejected"],
    approved: ["implemented"],
    rejected: [],
    implemented: [],
  },
  deliverable: {
    requested: ["drafting", "cancelled"],
    drafting: ["review", "cancelled"],
    review: ["drafting", "approved", "cancelled"],
    approved: ["delivered", "superseded"],
    delivered: ["accepted", "superseded"],
    accepted: ["superseded"],
    superseded: [],
    cancelled: [],
  },
  proposal: {
    proposed: ["approved", "rejected"],
    approved: ["active", "rejected"],
    active: ["retired"],
    rejected: [],
    retired: [],
  },
  inbox: {
    new: ["triaged", "needs_confirmation", "applied", "archived", "rejected"],
    triaged: ["needs_confirmation", "applied", "archived", "rejected"],
    needs_confirmation: ["triaged", "applied", "archived", "rejected"],
    applied: [],
    archived: [],
    rejected: [],
  },
  decision: {
    proposed: ["approved", "rejected"],
    approved: ["superseded"],
    rejected: [],
    superseded: [],
  },
  wiki: {
    active: ["superseded", "archived"],
    superseded: ["archived"],
    archived: [],
  },
});

const COMMON_ARRAY_FIELDS = Object.freeze({
  source_ids: "stringArray",
  related_ids: "stringArray",
  requirement_ids: "stringArray",
  deliverable_ids: "stringArray",
  dependency_ids: "stringArray",
  target_ids: "stringArray",
  observation_ids: "stringArray",
  applied_to_ids: "stringArray",
  approval_scopes: "approvalScopes",
  acceptance_criteria: "stringArray",
  reviewers: "stringArray",
});

export const RECORD_MODELS = Object.freeze({
  stakeholder: {
    id: "stakeholder",
    required: ["id", "name", "role", "status", "approval_scopes", "source_ids", "updated_at"],
    status: "stakeholder",
    fields: { name: "string", role: "string", organization: "nullableString", status: "string", approval_scopes: "approvalScopes", legacy_approval_scopes: "stringArray", source_ids: "stringArray", updated_at: "timestamp" },
  },
  milestone: {
    id: "milestone",
    required: ["id", "title", "status", "owner", "progress", "dependency_ids", "requirement_ids", "deliverable_ids", "source_ids", "next_action", "updated_at"],
    status: "task",
    fields: { title: "string", status: "string", owner: "nullableString", progress: "progress", baseline_start: "nullableDate", baseline_end: "nullableDate", forecast_start: "nullableDate", forecast_end: "nullableDate", actual_start: "nullableDate", actual_end: "nullableDate", dependency_ids: "stringArray", requirement_ids: "stringArray", deliverable_ids: "stringArray", source_ids: "stringArray", next_action: "nullableString", evidence: "nullableString", updated_at: "timestamp" },
  },
  task: {
    id: "task",
    required: ["id", "title", "status", "owner", "progress", "dependency_ids", "requirement_ids", "deliverable_ids", "source_ids", "next_action", "updated_at"],
    status: "task",
    fields: { title: "string", status: "string", owner: "nullableString", progress: "progress", baseline_start: "nullableDate", baseline_end: "nullableDate", forecast_start: "nullableDate", forecast_end: "nullableDate", actual_start: "nullableDate", actual_end: "nullableDate", dependency_ids: "stringArray", requirement_ids: "stringArray", deliverable_ids: "stringArray", source_ids: "stringArray", next_action: "nullableString", evidence: "nullableString", updated_at: "timestamp" },
  },
  requirement: {
    id: "requirement",
    required: ["id", "title", "description", "status", "acceptance_criteria", "source_ids", "updated_at"],
    status: "requirement",
    fields: { title: "string", description: "string", status: "string", acceptance_criteria: "stringArray", source_ids: "stringArray", supersedes_id: "nullableString", superseded_by_id: "nullableString", approved_by_id: "nullableString", approved_at: "nullableTimestamp", legacy_approval: "object", updated_at: "timestamp" },
  },
  change_request: {
    id: "change_request",
    required: ["id", "title", "status", "approval_scope", "target_ids", "before", "after", "reason", "impact", "source_ids", "created_at"],
    status: "change_request",
    fields: { title: "string", status: "string", approval_scope: "approvalScope", target_ids: "stringArray", change_items: "changeItems", before: "string", after: "string", reason: "string", impact: "string", source_ids: "stringArray", created_at: "timestamp", approved_by_id: "nullableString", confirmed_by_user_at: "nullableTimestamp", effective_at: "nullableTimestamp", approved_change_digest: "nullableHash", applied_target_ids: "stringArray", applied_operation_ids: "stringArray", applied_at: "nullableTimestamp", legacy_approval: "object" },
  },
  risk: {
    id: "risk",
    required: ["id", "title", "description", "status", "owner", "source_ids", "updated_at"],
    status: "register",
    fields: { title: "string", description: "string", status: "string", owner: "nullableString", source_ids: "stringArray", probability: "nullableRiskLevel", impact: "nullableRiskLevel", trigger: "nullableString", response: "nullableString", response_due: "nullableDate", next_review: "nullableDate", resolution: "nullableString", updated_at: "timestamp" },
  },
  issue: {
    id: "issue",
    required: ["id", "title", "description", "status", "owner", "source_ids", "updated_at"],
    status: "register",
    fields: { title: "string", description: "string", status: "string", owner: "nullableString", source_ids: "stringArray", resolution: "nullableString", updated_at: "timestamp" },
  },
  decision: {
    id: "decision",
    required: ["id", "title", "description", "status", "source_ids", "updated_at"],
    status: "decision",
    fields: { title: "string", description: "string", status: "string", rationale: "nullableString", source_ids: "stringArray", approved_by_id: "nullableString", approved_at: "nullableTimestamp", superseded_by_id: "nullableString", legacy_approval: "object", updated_at: "timestamp" },
  },
  source: {
    id: "source",
    required: ["id", "type", "title", "captured_at", "summary"],
    fields: { type: "sourceType", title: "string", channel: "nullableString", sender: "nullableString", stakeholder_id: "nullableString", thread_id: "nullableString", source_time: "nullableDateOrTimestamp", captured_at: "timestamp", archived_path: "nullableString", source_locator: "nullableString", sha256: "nullableHash", summary: "string" },
  },
  inbox: {
    id: "inbox",
    required: ["id", "source_id", "classification", "summary", "authority", "related_ids", "status", "created_at"],
    status: "inbox",
    fields: { source_id: "string", classification: "inboxClassification", summary: "string", quote: "nullableString", confidence: "nullableConfidence", authority: "string", related_ids: "stringArray", proposed_action: "nullableString", status: "string", created_at: "timestamp", applied_to_ids: "stringArray", applied_at: "nullableTimestamp", disposition_reason: "nullableString" },
  },
  activity: {
    id: "activity",
    required: ["id", "occurred_at", "action", "outcome", "related_ids", "source_ids", "recorded_at"],
    fields: { occurred_at: "timestamp", action: "string", outcome: "string", related_ids: "stringArray", source_ids: "stringArray", evidence: "nullableString", next_action: "nullableString", recorded_at: "timestamp" },
  },
  deliverable: {
    id: "deliverable",
    required: ["id", "title", "type", "format", "version", "status", "audience", "purpose", "requirement_ids", "source_ids"],
    status: "deliverable",
    fields: { title: "string", type: "string", format: "string", version: "string", status: "string", path: "nullableString", content_sha256: "nullableHash", audience: "string", purpose: "string", requirement_ids: "stringArray", source_ids: "stringArray", due_at: "nullableDate", completed_at: "nullableTimestamp", approved_by_id: "nullableString", approved_at: "nullableTimestamp", delivered_at: "nullableTimestamp", accepted_by_id: "nullableString", accepted_at: "nullableTimestamp", acceptance_criteria: "stringArray", acceptance_evidence: "nullableString", reviewers: "stringArray", supersedes_id: "nullableString", superseded_by_id: "nullableString", legacy_approval: "object" },
  },
  wiki: {
    id: "wiki",
    required: ["id", "title", "path", "status", "source_ids", "related_ids", "last_reviewed_at"],
    status: "wiki",
    fields: { title: "string", path: "string", status: "string", source_ids: "stringArray", related_ids: "stringArray", owner: "nullableString", last_reviewed_at: "nullableTimestamp", review_due_at: "nullableDate", supersedes_id: "nullableString", superseded_by_id: "nullableString" },
  },
  observation: {
    id: "observation",
    required: ["id", "title", "pattern_key", "status", "evidence", "created_at"],
    status: "observation",
    fields: { title: "string", pattern_key: "string", status: "string", evidence: "string", suggested_rule: "nullableString", proposal_id: "nullableString", created_at: "timestamp", resolved_at: "nullableTimestamp" },
  },
  proposal: {
    id: "proposal",
    required: ["id", "title", "status", "observation_ids", "proposed_rule", "scope", "expected_benefit", "possible_side_effects", "evaluation_metric", "review_at"],
    status: "proposal",
    fields: { title: "string", status: "string", observation_ids: "stringArray", proposed_rule: "string", scope: "string", expected_benefit: "string", possible_side_effects: "string", evaluation_metric: "string", review_at: "dateOrTimestamp", manual_reason: "nullableString", approved_by: "nullableString", approved_at: "nullableTimestamp", effective_at: "nullableTimestamp", pattern_key: "nullableString", legacy_approval: "object" },
  },
  rule: {
    id: "rule",
    required: ["id", "text", "scope", "status", "proposal_id", "effective_at", "review_at"],
    status: "rule",
    fields: { text: "string", scope: "string", status: "string", proposal_id: "string", effective_at: "timestamp", review_at: "dateOrTimestamp", retired_at: "nullableTimestamp", pattern_key: "nullableString" },
  },
  archive: {
    id: "archive",
    required: ["id", "logical_id", "path", "original_name", "type", "sha256", "archived_at", "reason", "availability"],
    fields: { logical_id: "string", source_id: "nullableString", deliverable_id: "nullableString", path: "string", original_name: "string", type: "string", sha256: "hash", archived_at: "timestamp", reason: "string", superseded_by: "nullableString", availability: "archiveAvailability" },
  },
  change: {
    id: "change",
    required: ["id", "operation_id", "kind", "target_ids", "before_hash", "after_hash", "approved_by", "effective_at", "recorded_at"],
    fields: { operation_id: "string", kind: "string", target_ids: "stringArray", before_summary: "nullableString", after_summary: "nullableString", before_hash: "hash", after_hash: "hash", change_request_id: "nullableString", approved_by: "string", effective_at: "timestamp", source_ids: "stringArray", recorded_at: "timestamp", baseline_revision: "nullableInteger" },
  },
});

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function isTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0) && new Set(value).size === value.length;
}

function matchesType(value, type) {
  if (type === "string") return typeof value === "string" && value.length > 0;
  if (type === "nullableString") return value === null || typeof value === "string";
  if (type === "number") return Number.isFinite(value);
  if (type === "nullableInteger") return value === null || Number.isInteger(value);
  if (type === "progress") return Number.isFinite(value) && value >= 0 && value <= 100;
  if (type === "confidence") return Number.isFinite(value) && value >= 0 && value <= 1;
  if (type === "nullableConfidence") return value === null || matchesType(value, "confidence");
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return isPlainObject(value);
  if (type === "stringArray") return isStringArray(value);
  if (type === "date") return isDate(value);
  if (type === "nullableDate") return value === null || isDate(value);
  if (type === "timestamp") return isTimestamp(value);
  if (type === "nullableTimestamp") return value === null || isTimestamp(value);
  if (type === "dateOrTimestamp") return isDate(value) || isTimestamp(value);
  if (type === "nullableDateOrTimestamp") return value === null || isDate(value) || isTimestamp(value);
  if (type === "hash") return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  if (type === "nullableHash") return value === null || matchesType(value, "hash");
  if (type === "approvalScope") return APPROVAL_SCOPES.includes(value);
  if (type === "approvalScopes") return isStringArray(value) && value.every((item) => APPROVAL_SCOPES.includes(item));
  if (type === "sourceType") return SOURCE_TYPES.includes(value);
  if (type === "inboxClassification") return INBOX_CLASSIFICATIONS.includes(value);
  if (type === "archiveAvailability") return ARCHIVE_AVAILABILITY.includes(value);
  if (type === "nullableRiskLevel") return value === null || ["low", "medium", "high"].includes(value);
  if (type === "changeItems") return Array.isArray(value) && value.every((item) => {
    if (!isPlainObject(item) || Object.keys(item).some((key) => !["target_id", "before", "after"].includes(key))) return false;
    return typeof item.target_id === "string" && item.target_id.length > 0 && isPlainObject(item.before) && isPlainObject(item.after);
  }) && new Set(value.map((item) => item.target_id)).size === value.length;
  return true;
}

export function validateRecord(kind, record) {
  const spec = RECORD_MODELS[kind];
  const issues = [];
  if (!spec) return [{ code: "unknown_record_kind", field: null, message: `Unknown record kind: ${kind}` }];
  if (!isPlainObject(record)) return [{ code: "invalid_record", field: null, message: `${kind} must be an object` }];
  const allowedFields = new Set(["id", ...Object.keys(spec.fields || {})]);
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) issues.push({ code: "unknown_field", field, message: `${record.id || kind} contains unsupported field: ${field}` });
  }
  const idPattern = ID_PATTERNS[spec.id];
  if (!idPattern?.test(record.id || "")) issues.push({ code: "invalid_id", field: "id", message: `${kind} has invalid ID: ${record.id ?? "missing"}` });
  for (const field of spec.required || []) {
    if (!(field in record) || record[field] === undefined) issues.push({ code: "missing_field", field, message: `${record.id || kind} is missing ${field}` });
  }
  for (const [field, type] of Object.entries({ ...COMMON_ARRAY_FIELDS, ...(spec.fields || {}) })) {
    if (!(field in record) || record[field] === undefined) continue;
    if (!matchesType(record[field], type)) issues.push({ code: "invalid_field", field, message: `${record.id || kind}: ${field} must be ${type}` });
  }
  if (spec.status && record.status !== undefined && !STATUS[spec.status].includes(record.status)) {
    issues.push({ code: "invalid_status", field: "status", message: `${record.id || kind} has unsupported status: ${record.status}` });
  }
  return issues;
}

export function validateOperationEnvelope(envelope) {
  const issues = [];
  if (!isPlainObject(envelope)) return [{ code: "invalid_operation", field: null, message: "Operation must be an object" }];
  const allowedFields = new Set(["schema_version", "operation_id", "type", "actor", "reason", "source_ids", "approval", "payload"]);
  for (const field of Object.keys(envelope)) if (!allowedFields.has(field)) issues.push({ code: "unknown_field", field, message: `Operation contains unsupported field: ${field}` });
  if (envelope.schema_version !== SCHEMA_VERSION) issues.push({ code: "schema_version", field: "schema_version", message: `Operation schema_version must be ${SCHEMA_VERSION}` });
  if (!ID_PATTERNS.operation.test(envelope.operation_id || "")) issues.push({ code: "invalid_operation_id", field: "operation_id", message: "operation_id must start with OP- and contain at least six stable characters" });
  if (!OPERATION_TYPES.includes(envelope.type)) issues.push({ code: "invalid_operation_type", field: "type", message: `Unsupported operation type: ${envelope.type ?? "missing"}` });
  if (!isPlainObject(envelope.actor) || !["user", "agent", "stakeholder"].includes(envelope.actor.kind)) issues.push({ code: "invalid_actor", field: "actor", message: "actor.kind must be user, agent, or stakeholder" });
  if (typeof envelope.reason !== "string" || !envelope.reason.trim()) issues.push({ code: "missing_reason", field: "reason", message: "Operation reason is required" });
  if (!isStringArray(envelope.source_ids || [])) issues.push({ code: "invalid_source_ids", field: "source_ids", message: "source_ids must be a unique string array" });
  if (!isPlainObject(envelope.payload)) issues.push({ code: "invalid_payload", field: "payload", message: "payload must be an object" });
  return issues;
}

export function canTransition(kind, from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[kind]?.[from]?.includes(to));
}

export function nextId(records, kind) {
  const pattern = ID_PATTERNS[kind];
  const prefix = {
    stakeholder: "STK",
    milestone: "MS",
    task: "TASK",
    requirement: "REQ",
    change_request: "CR",
    risk: "RISK",
    issue: "ISSUE",
    decision: "DEC",
    source: "SRC",
    inbox: "INB",
    activity: "ACT",
    deliverable: "DEL",
    wiki: "WIKI",
    observation: "OBS",
    proposal: "RULE",
    archive: "ARC",
    change: "CHG",
  }[kind];
  if (!pattern || !prefix) throw new Error(`Cannot allocate ID for ${kind}`);
  const maximum = (records || []).reduce((max, item) => {
    const match = String(item?.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(3, "0")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function digestValue(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function baselineSnapshot(schedule) {
  const pick = (item) => ({
    id: item.id,
    baseline_start: item.baseline_start ?? null,
    baseline_end: item.baseline_end ?? null,
  });
  return {
    milestones: (schedule.milestones || []).filter((item) => item.baseline_start || item.baseline_end).map(pick).sort((left, right) => left.id.localeCompare(right.id)),
    tasks: (schedule.tasks || []).filter((item) => item.baseline_start || item.baseline_end).map(pick).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function baselineDigest(schedule) {
  return digestValue(baselineSnapshot(schedule));
}

export function makeOperationId(type, payload) {
  return `OP-${type.replaceAll(".", "-")}-${digestValue(payload).slice(0, 12)}`;
}
