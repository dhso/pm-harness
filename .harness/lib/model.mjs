import { createHash } from "node:crypto";

import {
  APPROVAL_SCOPES,
  ARCHIVE_AVAILABILITY,
  COMMON_ARRAY_FIELDS,
  ID_PATTERNS,
  INBOX_CLASSIFICATIONS,
  PREFERENCE_SCOPES,
  RECORD_MODELS,
  SOURCE_TYPES,
  STATUS,
  TRANSITIONS,
} from "./schema.mjs";
import { nearestName } from "./suggest.mjs";

// 数据形状在 schema.mjs；此处整体 re-export，调用方继续只依赖 model.mjs。
export {
  APPROVAL_SCOPES,
  ARCHIVE_AVAILABILITY,
  COMMON_ARRAY_FIELDS,
  ID_PATTERNS,
  INBOX_CLASSIFICATIONS,
  PREFERENCE_SCOPES,
  RECORD_MODELS,
  SOURCE_TYPES,
  STATUS,
  TRANSITIONS,
} from "./schema.mjs";
export { editDistance, nearestName } from "./suggest.mjs";

export const SCHEMA_VERSION = 1;

export const OPERATION_TYPES = Object.freeze([
  "project.initialize",
  "project.update",
  "status.update",
  "memory.current.update",
  "memory.preference.upsert",
  "memory.preference.retire",
  "stakeholder.upsert",
  "source.register",
  "activity.record",
  "schedule.upsert",
  "schedule.batch-upsert",
  "schedule.transition",
  "schedule.baseline.approve",
  "requirement.upsert",
  "requirement.replacement.propose",
  "register.upsert",
  "change.propose",
  "change.approve",
  "change.void",
  "inbox.transition",
  "deliverable.upsert",
  "deliverable.transition",
  "wiki.register",
  "observation.record",
  "rule.propose",
  "rule.activate",
  "rule.reject",
  "rule.retire",
  "operation.compensate",
  "workflow.apply",
]);

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
  const supportedFields = [...allowedFields].sort();
  for (const field of Object.keys(record)) {
    if (allowedFields.has(field)) continue;
    const suggestion = nearestName(field, allowedFields);
    issues.push({
      code: "unknown_field",
      field,
      message: `${record.id || kind} contains unsupported field: ${field}`,
      ...(suggestion ? { did_you_mean: suggestion } : {}),
      supported_fields: supportedFields,
      fix: suggestion ? `Rename ${field} to ${suggestion}` : `Remove ${field} or replace it with one of: ${supportedFields.join(", ")}`,
    });
  }
  const idPattern = ID_PATTERNS[spec.id];
  if (!idPattern?.test(record.id || "")) issues.push({ code: "invalid_id", field: "id", message: `${kind} has invalid ID: ${record.id ?? "missing"}`, expected_pattern: String(idPattern), fix: `Use an ID matching ${idPattern}` });
  for (const field of spec.required || []) {
    if (!(field in record) || record[field] === undefined) issues.push({ code: "missing_field", field, message: `${record.id || kind} is missing ${field}`, expected_type: spec.fields?.[field] || "string", required_fields: [...(spec.required || [])] });
  }
  for (const [field, type] of Object.entries({ ...COMMON_ARRAY_FIELDS, ...(spec.fields || {}) })) {
    if (!(field in record) || record[field] === undefined) continue;
    if (!matchesType(record[field], type)) issues.push({ code: "invalid_field", field, message: `${record.id || kind}: ${field} must be ${type}`, expected_type: type });
  }
  if (spec.status && record.status !== undefined && !STATUS[spec.status].includes(record.status)) {
    issues.push({ code: "invalid_status", field: "status", message: `${record.id || kind} has unsupported status: ${record.status}`, supported_statuses: [...STATUS[spec.status]], fix: `Use one of: ${STATUS[spec.status].join(", ")}` });
  }
  return issues;
}

export function validateOperationEnvelope(envelope) {
  const issues = [];
  if (!isPlainObject(envelope)) return [{ code: "invalid_operation", field: null, message: "Operation must be an object" }];
  const allowedFields = new Set(["schema_version", "operation_id", "type", "actor", "reason", "source_ids", "approval", "payload"]);
  for (const field of Object.keys(envelope)) {
    if (allowedFields.has(field)) continue;
    const suggestion = nearestName(field, allowedFields);
    issues.push({ code: "unknown_field", field, message: `Operation contains unsupported field: ${field}`, ...(suggestion ? { did_you_mean: suggestion } : {}), supported_fields: [...allowedFields].sort() });
  }
  if (envelope.schema_version !== SCHEMA_VERSION) issues.push({ code: "schema_version", field: "schema_version", message: `Operation schema_version must be ${SCHEMA_VERSION}` });
  if (!ID_PATTERNS.operation.test(envelope.operation_id || "")) issues.push({ code: "invalid_operation_id", field: "operation_id", message: "operation_id must start with OP- and contain at least six stable characters" });
  if (!OPERATION_TYPES.includes(envelope.type)) {
    const suggestion = envelope.type ? nearestName(String(envelope.type), OPERATION_TYPES) : null;
    issues.push({ code: "invalid_operation_type", field: "type", message: `Unsupported operation type: ${envelope.type ?? "missing"}`, ...(suggestion ? { did_you_mean: suggestion } : {}), supported_types: [...OPERATION_TYPES] });
  }
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

// 非法转换必须说明当前状态、目标状态和合法去向，否则调用方只能猜下一步。
export function assertTransition(kind, from, to, id = null) {
  if (canTransition(kind, from, to)) return;
  const allowed = TRANSITIONS[kind]?.[from] || [];
  throw new Error(JSON.stringify({
    code: "invalid_transition",
    kind,
    ...(id ? { id } : {}),
    from,
    to,
    allowed_targets: allowed,
    fix: allowed.length
      ? `From ${from} this ${kind} may only move to: ${allowed.join(", ")}`
      : `${from} is a terminal state for ${kind}; create a successor record instead of reopening it`,
  }));
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
    preference: "PREF",
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
