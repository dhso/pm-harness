import { isPlainObject, RECORD_MODELS } from "./model.mjs";

const fields = (kind) => ["id", ...Object.keys(RECORD_MODELS[kind]?.fields || {})];
const scheduleFields = [...new Set([...fields("task"), ...fields("milestone")])];
const registerFields = [...new Set([...fields("risk"), ...fields("issue"), ...fields("decision")])];

const PAYLOAD_FIELDS = Object.freeze({
  "project.initialize": ["id", "name", "status", "timezone", "objective", "scope_in", "scope_out", "success_criteria", "constraints"],
  "project.update": ["name", "status", "timezone", "objective", "scope_in", "scope_out", "success_criteria", "constraints", "budget"],
  "stakeholder.upsert": fields("stakeholder"),
  "source.register": [...fields("source"), "raw_path", "archive_reason", "items"],
  "activity.record": [...fields("activity"), "timestamp"],
  "schedule.upsert": ["collection", "record", ...scheduleFields],
  "schedule.baseline.approve": [],
  "requirement.upsert": fields("requirement"),
  "register.upsert": ["collection", "record", ...registerFields],
  "change.propose": ["id", "title", "approval_scope", "target_ids", "change_items", "before", "after", "reason", "impact", "source_ids", "created_at"],
  "change.approve": ["id"],
  "inbox.transition": ["id", "status", "applied_to_ids", "applied_at", "disposition_reason"],
  "deliverable.upsert": fields("deliverable"),
  "deliverable.transition": fields("deliverable"),
  "wiki.register": [...fields("wiki"), "content"],
  "observation.record": fields("observation"),
  "rule.propose": ["id", "title", "observation_ids", "proposed_rule", "scope", "expected_benefit", "possible_side_effects", "evaluation_metric", "review_at", "manual_reason", "pattern_key"],
  "rule.activate": ["id"],
  "rule.retire": ["id"],
  "workflow.apply": ["kind", "operations"],
});

const INBOX_ITEM_FIELDS = new Set(fields("inbox").filter((field) => !["id", "source_id", "created_at"].includes(field)));
const APPROVAL_FIELDS = new Set(["approved_by_id", "approved_at", "confirmed_by_user_at", "change_request_id"]);
const ACTOR_FIELDS = new Set(["kind", "id", "name"]);
const WORKFLOW_STEP_FIELDS = new Set(["type", "reason", "source_ids", "approval", "payload"]);
const STORE_SHAPES = Object.freeze({
  config: [".harness/config.json", ["schema_version", "default_timezone", "upcoming_days", "recent_activity_days", "stale_task_days", "large_tracked_file_mb", "repeat_observation_threshold", "rule_review_days", "memory_current_max_bytes", "memory_current_stale_days", "verify_archive_hash_on_lint", "archive_roots"]],
  project: ["project/project.json", ["schema_version", "initialized", "id", "name", "status", "timezone", "objective", "scope_in", "scope_out", "success_criteria", "constraints", "budget", "created_at", "updated_at"]],
  stakeholders: ["project/stakeholders.json", ["schema_version", "stakeholders"]],
  schedule: ["project/schedule.json", ["schema_version", "baseline", "milestones", "tasks"]],
  requirements: ["project/requirements.json", ["schema_version", "requirements", "change_requests"]],
  registers: ["project/registers.json", ["schema_version", "risks", "issues", "decisions"]],
  sources: ["knowledge/sources.json", ["schema_version", "sources"]],
  inbox: ["knowledge/inbox.json", ["schema_version", "items"]],
  catalog: ["knowledge/catalog.json", ["schema_version", "pages"]],
  observations: ["memory/observations.json", ["schema_version", "observations"]],
  activity: ["activity/log.json", ["schema_version", "entries"]],
  deliverables: ["deliverables/index.json", ["schema_version", "deliverables"]],
  proposals: ["governance/proposals.json", ["schema_version", "proposals"]],
  rules: ["governance/rules.json", ["schema_version", "rules"]],
  changes: ["governance/change-log.json", ["schema_version", "changes", "operations"]],
  archive: ["archive/index.json", ["schema_version", "files"]],
});

function unknownFields(value, allowed, prefix, issues) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ code: "unknown_field", field: `${prefix}${key}`, message: `${prefix}${key} is not supported` });
  }
}

export function validateOperationContract(envelope) {
  const issues = [];
  unknownFields(envelope.actor, ACTOR_FIELDS, "actor.", issues);
  if (envelope.approval !== undefined) {
    if (!isPlainObject(envelope.approval)) issues.push({ code: "invalid_approval", field: "approval", message: "approval must be an object" });
    else unknownFields(envelope.approval, APPROVAL_FIELDS, "approval.", issues);
  }
  const allowed = PAYLOAD_FIELDS[envelope.type];
  if (allowed && isPlainObject(envelope.payload)) unknownFields(envelope.payload, new Set(allowed), "payload.", issues);
  if (envelope.type === "source.register" && Array.isArray(envelope.payload?.items)) {
    envelope.payload.items.forEach((item, index) => unknownFields(item, INBOX_ITEM_FIELDS, `payload.items[${index}].`, issues));
  }
  for (const type of ["schedule.upsert", "register.upsert"]) {
    if (envelope.type === type && envelope.payload?.record !== undefined && !isPlainObject(envelope.payload.record)) {
      issues.push({ code: "invalid_record", field: "payload.record", message: "payload.record must be an object" });
    }
  }
  if (envelope.type === "schedule.upsert" && isPlainObject(envelope.payload?.record)) unknownFields(envelope.payload.record, new Set(scheduleFields), "payload.record.", issues);
  if (envelope.type === "register.upsert" && isPlainObject(envelope.payload?.record)) unknownFields(envelope.payload.record, new Set(registerFields), "payload.record.", issues);
  if (envelope.type === "workflow.apply") {
    if (!Array.isArray(envelope.payload?.operations) || !envelope.payload.operations.length) {
      issues.push({ code: "invalid_workflow", field: "payload.operations", message: "workflow.apply requires at least one operation" });
    } else {
      envelope.payload.operations.forEach((step, index) => {
        if (!isPlainObject(step)) issues.push({ code: "invalid_workflow_step", field: `payload.operations[${index}]`, message: "Workflow step must be an object" });
        else unknownFields(step, WORKFLOW_STEP_FIELDS, `payload.operations[${index}].`, issues);
      });
    }
  }
  return issues;
}

export function validateWorkspaceContract(data) {
  const issues = [];
  for (const [key, [path, fields]] of Object.entries(STORE_SHAPES)) {
    const local = [];
    unknownFields(data[key], new Set(fields), "", local);
    for (const issue of local) issues.push({ ...issue, path });
  }
  const nested = [
    [data.schedule?.baseline, new Set(["revision", "status", "digest", "approved_by_id", "approved_at", "change_request_id"]), "project/schedule.json", "baseline."],
    ...((data.changes?.operations || []).map((item, index) => [item, new Set(["operation_id", "request_hash", "type", "target_ids", "recorded_at", "result"]), "governance/change-log.json", `operations[${index}].`])),
  ];
  for (const [value, allowed, path, prefix] of nested) {
    const local = [];
    unknownFields(value, allowed, prefix, local);
    for (const issue of local) issues.push({ ...issue, path });
  }
  return issues;
}
