import { isPlainObject, nearestName, RECORD_MODELS } from "./model.mjs";

const fields = (kind) => ["id", ...Object.keys(RECORD_MODELS[kind]?.fields || {})];
const fieldTypes = (kind) => ({ id: "string", ...(RECORD_MODELS[kind]?.fields || {}) });
const mergedFieldTypes = (...kinds) => {
  const result = {};
  for (const kind of kinds) {
    for (const [field, type] of Object.entries(fieldTypes(kind))) {
      if (!(field in result)) result[field] = type;
      else if (result[field] !== type) result[field] = [...new Set(String(result[field]).split(" | ").concat(type))].join(" | ");
    }
  }
  return result;
};
const scheduleFields = [...new Set([...fields("task"), ...fields("milestone")])];
const registerFields = [...new Set([...fields("risk"), ...fields("issue"), ...fields("decision")])];

const PROJECT_FIELD_TYPES = Object.freeze({
  id: "string",
  name: "string",
  status: "string",
  timezone: "string",
  objective: "string",
  scope_in: "stringArray",
  scope_out: "stringArray",
  success_criteria: "stringArray",
  constraints: "stringArray",
  budget: "object",
});

// 操作输入契约是校验、CLI 发现和参考文档的共同事实源。
// record model 描述落盘后的完整对象；这里描述调用方实际需要提供的 payload。
export const OPERATION_SPECS = Object.freeze({
  "project.initialize": {
    fields: Object.fromEntries(Object.entries(PROJECT_FIELD_TYPES).filter(([field]) => field !== "budget")),
    required: ["name", "timezone", "objective"],
    defaults: ["id", "status", "scope_in", "scope_out", "success_criteria", "constraints"],
    status_kinds: ["project"],
    note: "初始化项目事实；省略 id 时分配 PRJ-001。",
  },
  "project.update": {
    fields: Object.fromEntries(Object.entries(PROJECT_FIELD_TYPES).filter(([field]) => field !== "id")),
    status_kinds: ["project"],
    note: "只更新提供的字段；改变目标、范围、成功标准或预算需要对话确认。",
  },
  "stakeholder.upsert": { fields: fieldTypes("stakeholder"), create_required: ["name", "role"], update_required: ["id"], status_kinds: ["stakeholder"] },
  "source.register": {
    fields: { ...fieldTypes("source"), raw_path: "workspacePath", archive_reason: "string", items: "inboxItemArray" },
    create_required: ["type"],
    defaults: ["id", "title", "captured_at", "summary"],
    note: "raw_path 必须位于项目目录内；items 为收件箱条目数组。",
  },
  "activity.record": {
    fields: { ...fieldTypes("activity"), timestamp: "timestamp" },
    required: ["action", "outcome"],
    defaults: ["id", "occurred_at", "related_ids", "source_ids", "recorded_at"],
  },
  "schedule.upsert": {
    fields: { collection: "tasks | milestones", record: "object", ...mergedFieldTypes("task", "milestone") },
    required: ["collection"],
    create_required: ["title"],
    update_required: ["id"],
    defaults: ["id", "status", "owner", "progress", "dependency_ids", "requirement_ids", "deliverable_ids", "source_ids", "next_action", "updated_at"],
    status_kinds: ["task"],
    note: "记录字段可平铺或放入 record；create/update 必填字段指记录本身。",
  },
  "schedule.baseline.approve": { fields: {}, note: "payload 为空对象；基线摘要由计划数据自动计算，需有效审批。" },
  "requirement.upsert": {
    fields: fieldTypes("requirement"),
    create_required: ["title", "description"],
    update_required: ["id"],
    defaults: ["id", "status", "acceptance_criteria", "source_ids", "updated_at"],
    status_kinds: ["requirement"],
  },
  "register.upsert": {
    fields: { collection: "risks | issues | decisions", record: "object", ...mergedFieldTypes("risk", "issue", "decision") },
    required: ["collection"],
    create_required: ["title", "description"],
    update_required: ["id"],
    defaults: ["id", "status", "owner", "source_ids", "updated_at"],
    status_kinds: ["register", "decision"],
    note: "记录字段可平铺或放入 record；create/update 必填字段指记录本身。",
  },
  "change.propose": {
    fields: { id: "string", title: "string", approval_scope: "approvalScope", target_ids: "stringArray", change_items: "changeItems", before: "string", after: "string", reason: "string", impact: "string", source_ids: "stringArray", created_at: "timestamp" },
    required: ["title", "approval_scope", "target_ids", "change_items", "before", "after", "reason", "impact"],
    defaults: ["id", "source_ids", "created_at"],
    status_kinds: ["change_request"],
    note: "每个 target_id 必须有一条 change_items: [{ target_id, before, after }]。",
  },
  "change.approve": { fields: { id: "string" }, required: ["id"], status_kinds: ["change_request"], note: "批准后摘要锁定，实际写入必须逐项一致。" },
  "inbox.transition": {
    fields: Object.fromEntries(Object.entries(fieldTypes("inbox")).filter(([field]) => ["id", "status", "applied_to_ids", "applied_at", "disposition_reason"].includes(field))),
    required: ["id", "status"],
    status_kinds: ["inbox"],
  },
  "deliverable.upsert": {
    fields: fieldTypes("deliverable"),
    create_required: ["title", "type", "format", "version", "audience", "purpose"],
    update_required: ["id"],
    defaults: ["id", "status", "requirement_ids", "source_ids", "acceptance_criteria", "reviewers"],
    status_kinds: ["deliverable"],
  },
  "deliverable.transition": { fields: fieldTypes("deliverable"), required: ["id", "status"], status_kinds: ["deliverable"] },
  "wiki.register": {
    fields: { ...fieldTypes("wiki"), content: "string" },
    create_required: ["title", "path"],
    update_required: ["id"],
    defaults: ["id", "status", "source_ids", "related_ids", "last_reviewed_at"],
    status_kinds: ["wiki"],
    note: "新页面必须提供 content；更新已有页面时可省略。",
  },
  "observation.record": {
    fields: fieldTypes("observation"),
    required: ["title", "pattern_key", "evidence"],
    defaults: ["id", "status", "created_at"],
    status_kinds: ["observation"],
  },
  "rule.propose": {
    fields: Object.fromEntries(Object.entries(fieldTypes("proposal")).filter(([field]) => !["status", "approved_by", "approved_at", "effective_at"].includes(field))),
    required: ["title", "proposed_rule", "scope", "expected_benefit", "possible_side_effects", "evaluation_metric", "review_at"],
    one_of: [["observation_ids", "manual_reason"]],
    defaults: ["id", "observation_ids"],
    status_kinds: ["proposal"],
    note: "必须关联 observation_ids，或提供 manual_reason。",
  },
  "rule.activate": { fields: { id: "string" }, required: ["id"], status_kinds: ["proposal"], note: "必须由用户明确确认。" },
  "rule.retire": { fields: { id: "string" }, required: ["id"], status_kinds: ["rule"], note: "必须由用户明确确认。" },
  "workflow.apply": { fields: { kind: "string", operations: "operationArray" }, required: ["kind", "operations"], note: "operations 按依赖顺序排列；不支持嵌套工作流。" },
});

export const PAYLOAD_FIELDS = Object.freeze(Object.fromEntries(Object.entries(OPERATION_SPECS).map(([type, spec]) => [type, Object.keys(spec.fields)])));

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
    if (allowed.has(key)) continue;
    const suggestion = nearestName(key, allowed);
    const supported = [...allowed].sort();
    issues.push({
      code: "unknown_field",
      field: `${prefix}${key}`,
      message: `${prefix}${key} is not supported`,
      ...(suggestion ? { did_you_mean: `${prefix}${suggestion}` } : {}),
      supported_fields: supported,
      fix: suggestion
        ? `Rename ${prefix}${key} to ${prefix}${suggestion}, or use one of: ${supported.join(", ")}`
        : `Remove ${prefix}${key} or replace it with one of: ${supported.join(", ")}`,
    });
  }
}

function requiredFields(value, spec, prefix, issues) {
  if (!isPlainObject(value)) return;
  for (const field of spec.required || []) {
    if (field in value && value[field] !== undefined) continue;
    issues.push({
      code: "missing_field",
      field: `${prefix}${field}`,
      message: `${prefix}${field} is required`,
      expected_type: spec.fields[field],
      required_fields: [...spec.required],
      fix: `Provide ${prefix}${field} as ${spec.fields[field]}`,
    });
  }
  for (const alternatives of spec.one_of || []) {
    const provided = (field) => {
      const candidate = value[field];
      if (Array.isArray(candidate)) return candidate.length > 0;
      return candidate !== undefined && candidate !== null && candidate !== "";
    };
    if (alternatives.some(provided)) continue;
    issues.push({
      code: "missing_one_of",
      field: prefix.slice(0, -1),
      message: `${prefix} requires one of: ${alternatives.join(", ")}`,
      required_one_of: alternatives,
      fix: `Provide one of: ${alternatives.map((field) => `${prefix}${field}`).join(", ")}`,
    });
  }
}

export function validateOperationContract(envelope) {
  const issues = [];
  unknownFields(envelope.actor, ACTOR_FIELDS, "actor.", issues);
  if (envelope.approval !== undefined) {
    if (!isPlainObject(envelope.approval)) issues.push({ code: "invalid_approval", field: "approval", message: "approval must be an object" });
    else unknownFields(envelope.approval, APPROVAL_FIELDS, "approval.", issues);
  }
  const spec = OPERATION_SPECS[envelope.type];
  const allowed = PAYLOAD_FIELDS[envelope.type];
  if (allowed && isPlainObject(envelope.payload)) {
    unknownFields(envelope.payload, new Set(allowed), "payload.", issues);
    requiredFields(envelope.payload, spec, "payload.", issues);
  }
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
