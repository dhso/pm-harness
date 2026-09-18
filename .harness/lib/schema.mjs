// 数据形状的唯一事实源：状态机、ID 规则和记录模型。
// 校验与工具函数在 model.mjs；调用方统一从 model.mjs 导入，本模块只被它 re-export。

export const STATUS = Object.freeze({
  project: ["uninitialized", "active", "on_hold", "completed", "cancelled"],
  stakeholder: ["active", "inactive"],
  task: ["not_started", "in_progress", "blocked", "done", "cancelled"],
  requirement: ["candidate", "proposed", "approved", "implemented", "validated", "superseded", "rejected"],
  change_request: ["proposed", "impact_review", "approved", "rejected", "voided", "implemented"],
  register: ["open", "monitoring", "mitigated", "resolved", "accepted", "closed"],
  decision: ["proposed", "approved", "rejected", "superseded"],
  deliverable: ["requested", "drafting", "review", "approved", "delivered", "accepted", "superseded", "cancelled"],
  inbox: ["new", "triaged", "needs_confirmation", "applied", "archived", "rejected"],
  preference: ["active", "retired"],
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

// 常用偏好范围：只用于生成视图的分组顺序和 skill 里的建议值，不做校验。
// 真实偏好的形态无法穷举（画图、评审、会议节奏……），限定闭集只会逼着 agent 硬塞分类。
export const PREFERENCE_SCOPES = Object.freeze([
  "communication",
  "document",
  "schedule",
  "collaboration",
  "tooling",
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
  preference: /^PREF-\d{3,}$/,
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
    proposed: ["impact_review", "approved", "rejected", "voided"],
    impact_review: ["approved", "rejected", "voided"],
    approved: ["implemented"],
    rejected: [],
    voided: [],
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
  preference: {
    active: ["retired"],
    retired: [],
  },
  observation: {
    open: ["resolved", "dismissed"],
    resolved: [],
    dismissed: [],
  },
});

export const COMMON_ARRAY_FIELDS = Object.freeze({
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
    fields: { name: "string", role: "string", organization: "nullableString", status: "string", approval_scopes: "approvalScopes", source_ids: "stringArray", updated_at: "timestamp" },
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
    fields: { title: "string", description: "string", owner: "nullableString", status: "string", acceptance_criteria: "stringArray", source_ids: "stringArray", supersedes_id: "nullableString", superseded_by_id: "nullableString", approved_by_id: "nullableString", approved_at: "nullableTimestamp", updated_at: "timestamp" },
  },
  change_request: {
    id: "change_request",
    required: ["id", "title", "status", "approval_scope", "target_ids", "before", "after", "reason", "impact", "source_ids", "created_at"],
    status: "change_request",
    fields: { title: "string", status: "string", approval_scope: "approvalScope", target_ids: "stringArray", change_items: "changeItems", before: "string", after: "string", reason: "string", impact: "string", source_ids: "stringArray", created_at: "timestamp", approved_by_id: "nullableString", confirmed_by_user_at: "nullableTimestamp", effective_at: "nullableTimestamp", approved_change_digest: "nullableHash", applied_target_ids: "stringArray", applied_operation_ids: "stringArray", applied_at: "nullableTimestamp", disposition_reason: "nullableString", voided_at: "nullableTimestamp" },
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
    fields: { title: "string", description: "string", status: "string", rationale: "nullableString", source_ids: "stringArray", approved_by_id: "nullableString", approved_at: "nullableTimestamp", superseded_by_id: "nullableString", updated_at: "timestamp" },
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
    fields: { title: "string", type: "string", format: "string", version: "string", status: "string", path: "nullableString", content_sha256: "nullableHash", audience: "string", purpose: "string", requirement_ids: "stringArray", source_ids: "stringArray", due_at: "nullableDate", completed_at: "nullableTimestamp", approved_by_id: "nullableString", approved_at: "nullableTimestamp", delivered_at: "nullableTimestamp", accepted_by_id: "nullableString", accepted_at: "nullableTimestamp", acceptance_criteria: "stringArray", acceptance_evidence: "nullableString", reviewers: "stringArray", supersedes_id: "nullableString", superseded_by_id: "nullableString" },
  },
  wiki: {
    id: "wiki",
    required: ["id", "title", "path", "status", "source_ids", "related_ids", "last_reviewed_at"],
    status: "wiki",
    fields: { title: "string", path: "string", status: "string", source_ids: "stringArray", related_ids: "stringArray", owner: "nullableString", last_reviewed_at: "nullableTimestamp", review_due_at: "nullableDate", supersedes_id: "nullableString", superseded_by_id: "nullableString" },
  },
  preference: {
    id: "preference",
    required: ["id", "scope", "text", "status", "source_ids", "created_at", "updated_at"],
    status: "preference",
    fields: { scope: "string", text: "string", status: "string", source_ids: "stringArray", supersedes_id: "nullableString", superseded_by_id: "nullableString", retired_at: "nullableTimestamp", retire_reason: "nullableString", created_at: "timestamp", updated_at: "timestamp" },
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
    fields: { title: "string", status: "string", observation_ids: "stringArray", proposed_rule: "string", scope: "string", expected_benefit: "string", possible_side_effects: "string", evaluation_metric: "string", review_at: "dateOrTimestamp", manual_reason: "nullableString", approved_by: "nullableString", approved_at: "nullableTimestamp", effective_at: "nullableTimestamp", disposition_reason: "nullableString", pattern_key: "nullableString" },
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
