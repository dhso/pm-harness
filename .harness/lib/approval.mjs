import { digestValue, isPlainObject, isTimestamp } from "./model.mjs";
import { digestChangeIntent, nextWorkspaceId, normalizeArray, validateOrThrow } from "./helpers.mjs";

function verifyExactChange(changeRequest, actualChanges) {
  if (!Array.isArray(changeRequest.change_items) || !changeRequest.change_items.length) {
    throw new Error(JSON.stringify({ code: "change_request_exact_change_required", id: changeRequest.id, fix: "Record structured before/after change_items before approval" }));
  }
  if (!Array.isArray(actualChanges) || !actualChanges.length) {
    throw new Error(JSON.stringify({ code: "actual_change_required", id: changeRequest.id, fix: "本次写入没有改动任何受控字段，无需引用变更请求" }));
  }
  for (const actual of actualChanges) {
    const expected = changeRequest.change_items.find((item) => item.target_id === actual.target_id);
    if (!expected || digestChangeIntent(expected.before) !== digestChangeIntent(actual.before) || digestChangeIntent(expected.after) !== digestChangeIntent(actual.after)) {
      throw new Error(JSON.stringify({ code: "change_request_content_mismatch", id: changeRequest.id, target_id: actual.target_id, fix: "Apply exactly the approved before/after values or create a revised change request" }));
    }
  }
}

export function verifyApproval(data, approval, scope, { requireChangeRequest = false, targetIds = [], actualChanges = [] } = {}) {
  if (!isPlainObject(approval)) throw new Error(JSON.stringify({ code: "approval_required", scope, fix: "Provide structured approval confirmed by the user" }));
  const stakeholder = (data.stakeholders.stakeholders || []).find((item) => item.id === approval.approved_by_id && item.status === "active");
  if (!stakeholder || !stakeholder.approval_scopes.includes(scope)) throw new Error(JSON.stringify({ code: "approval_scope_missing", scope, approved_by_id: approval.approved_by_id, fix: `使用 approval_scopes 含 ${scope} 的在职干系人，或先用 stakeholder.upsert 授予该范围` }));
  if (!isTimestamp(approval.approved_at) || !isTimestamp(approval.confirmed_by_user_at)) throw new Error(JSON.stringify({ code: "approval_time_invalid", scope, fix: "approved_at 与 confirmed_by_user_at 都必须是 ISO 8601 时间戳" }));
  if (Date.parse(approval.confirmed_by_user_at) < Date.parse(approval.approved_at)) throw new Error(JSON.stringify({ code: "approval_time_order", scope, fix: "User confirmation cannot predate the reported business approval" }));
  let changeRequest = null;
  if (requireChangeRequest) {
    changeRequest = (data.requirements.change_requests || []).find((item) => item.id === approval.change_request_id && item.status === "approved");
    if (!changeRequest || changeRequest.approval_scope !== scope) throw new Error(JSON.stringify({ code: "approved_change_request_required", scope, fix: `改动已批准对象前，先用 change.propose 提交并 change.approve 批准一条 approval_scope 为 ${scope} 的变更请求，再在 approval.change_request_id 中引用` }));
    if (changeRequest.approved_change_digest !== digestValue(changeRequest.change_items)) throw new Error(JSON.stringify({ code: "change_request_approved_snapshot_mismatch", id: changeRequest.id, fix: "变更请求批准后 change_items 被直接改动；恢复原内容或另提一条新的变更请求" }));
    if (approval.approved_by_id !== changeRequest.approved_by_id) throw new Error(JSON.stringify({ code: "change_request_approval_mismatch", id: changeRequest.id, fix: "Use the business approver recorded on the change request" }));
    if (targetIds.some((id) => !changeRequest.target_ids.includes(id))) throw new Error(JSON.stringify({ code: "change_request_target_mismatch", scope, target_ids: targetIds, fix: "目标不在变更请求的 target_ids 内；另提一条覆盖该目标的变更请求" }));
    if (targetIds.some((id) => (changeRequest.applied_target_ids || []).includes(id))) throw new Error(JSON.stringify({ code: "change_request_already_applied", id: changeRequest.id, target_ids: targetIds, fix: "该目标已按此变更请求落地；如需再改，另提一条新的变更请求" }));
    verifyExactChange(changeRequest, actualChanges);
  }
  return { stakeholder, changeRequest };
}

export function addControlledChange(data, envelope, details) {
  const changeRequestId = envelope.approval?.change_request_id || null;
  const linkedRequest = changeRequestId ? (data.requirements.change_requests || []).find((item) => item.id === changeRequestId) : null;
  if (changeRequestId && linkedRequest?.status !== "approved") throw new Error(JSON.stringify({ code: "approved_change_request_required", id: changeRequestId, fix: "引用的变更请求必须存在且已批准" }));
  if (envelope.approval?.change_request_id && linkedRequest?.status !== "approved") throw new Error(JSON.stringify({ code: "approved_change_request_required", change_request_id: envelope.approval.change_request_id, fix: "Only an approved change request may be linked to an applied controlled change" }));
  const record = {
    id: nextWorkspaceId(data, data.changes.changes, "change"),
    operation_id: envelope.operation_id,
    kind: details.kind,
    target_ids: details.target_ids,
    before_summary: details.before_summary ?? null,
    after_summary: details.after_summary ?? null,
    before_hash: details.before_hash || digestValue(details.before),
    after_hash: details.after_hash || digestValue(details.after),
    change_request_id: envelope.approval?.change_request_id || null,
    approved_by: linkedRequest?.approved_by_id || envelope.approval?.approved_by_id || "user",
    effective_at: linkedRequest?.effective_at || envelope.approval?.approved_at || envelope.approval?.confirmed_by_user_at || new Date().toISOString(),
    source_ids: normalizeArray(envelope.source_ids),
    recorded_at: new Date().toISOString(),
    ...(details.baseline_revision ? { baseline_revision: details.baseline_revision } : {}),
  };
  validateOrThrow("change", record);
  data.changes.changes.push(record);
  if (linkedRequest) {
    const appliedTargetIds = details.change_request_target_ids || record.target_ids;
    linkedRequest.applied_target_ids = [...new Set([...(linkedRequest.applied_target_ids || []), ...appliedTargetIds])];
    linkedRequest.applied_operation_ids = [...new Set([...(linkedRequest.applied_operation_ids || []), envelope.operation_id])];
    if (linkedRequest.target_ids.every((id) => linkedRequest.applied_target_ids.includes(id))) {
      linkedRequest.status = "implemented";
      linkedRequest.applied_at = record.effective_at;
    }
  }
  return record;
}

export function assertUserConfirmation(approval, purpose) {
  if (!isTimestamp(approval?.confirmed_by_user_at)) throw new Error(JSON.stringify({ code: "user_confirmation_required", purpose, fix: "Record the user's explicit conversational confirmation" }));
}
