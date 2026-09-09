import { digestValue, isPlainObject, isTimestamp, nextId } from "./model.mjs";
import { normalizeArray, validateOrThrow } from "./helpers.mjs";

function verifyExactChange(changeRequest, actualChanges) {
  if (!Array.isArray(changeRequest.change_items) || !changeRequest.change_items.length) {
    throw new Error(JSON.stringify({ code: "change_request_exact_change_required", id: changeRequest.id, fix: "Record structured before/after change_items before approval" }));
  }
  if (!Array.isArray(actualChanges) || !actualChanges.length) {
    throw new Error(JSON.stringify({ code: "actual_change_required", id: changeRequest.id }));
  }
  for (const actual of actualChanges) {
    const expected = changeRequest.change_items.find((item) => item.target_id === actual.target_id);
    if (!expected || digestValue(expected.before) !== digestValue(actual.before) || digestValue(expected.after) !== digestValue(actual.after)) {
      throw new Error(JSON.stringify({ code: "change_request_content_mismatch", id: changeRequest.id, target_id: actual.target_id, fix: "Apply exactly the approved before/after values or create a revised change request" }));
    }
  }
}

export function verifyApproval(data, approval, scope, { requireChangeRequest = false, targetIds = [], actualChanges = [] } = {}) {
  if (!isPlainObject(approval)) throw new Error(JSON.stringify({ code: "approval_required", scope, fix: "Provide structured approval confirmed by the user" }));
  const stakeholder = (data.stakeholders.stakeholders || []).find((item) => item.id === approval.approved_by_id && item.status === "active");
  if (!stakeholder || !stakeholder.approval_scopes.includes(scope)) throw new Error(JSON.stringify({ code: "approval_scope_missing", scope, approved_by_id: approval.approved_by_id }));
  if (!isTimestamp(approval.approved_at) || !isTimestamp(approval.confirmed_by_user_at)) throw new Error(JSON.stringify({ code: "approval_time_invalid", scope }));
  if (Date.parse(approval.confirmed_by_user_at) < Date.parse(approval.approved_at)) throw new Error(JSON.stringify({ code: "approval_time_order", scope, fix: "User confirmation cannot predate the reported business approval" }));
  let changeRequest = null;
  if (requireChangeRequest) {
    changeRequest = (data.requirements.change_requests || []).find((item) => item.id === approval.change_request_id && item.status === "approved");
    if (!changeRequest || changeRequest.approval_scope !== scope) throw new Error(JSON.stringify({ code: "approved_change_request_required", scope }));
    if (changeRequest.approved_change_digest !== digestValue(changeRequest.change_items)) throw new Error(JSON.stringify({ code: "change_request_approved_snapshot_mismatch", id: changeRequest.id }));
    if (approval.approved_by_id !== changeRequest.approved_by_id) throw new Error(JSON.stringify({ code: "change_request_approval_mismatch", id: changeRequest.id, fix: "Use the business approver recorded on the change request" }));
    if (targetIds.some((id) => !changeRequest.target_ids.includes(id))) throw new Error(JSON.stringify({ code: "change_request_target_mismatch", scope, target_ids: targetIds }));
    if (targetIds.some((id) => (changeRequest.applied_target_ids || []).includes(id))) throw new Error(JSON.stringify({ code: "change_request_already_applied", id: changeRequest.id, target_ids: targetIds }));
    verifyExactChange(changeRequest, actualChanges);
  }
  return { stakeholder, changeRequest };
}

export function addControlledChange(data, envelope, details) {
  const linkedRequest = envelope.approval?.change_request_id ? (data.requirements.change_requests || []).find((item) => item.id === envelope.approval.change_request_id) : null;
  const record = {
    id: nextId(data.changes.changes, "change"),
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
  if (record.change_request_id) {
    const request = (data.requirements.change_requests || []).find((item) => item.id === record.change_request_id);
    if (request) {
      const appliedTargetIds = details.change_request_target_ids || record.target_ids;
      request.applied_target_ids = [...new Set([...(request.applied_target_ids || []), ...appliedTargetIds])];
      request.applied_operation_ids = [...new Set([...(request.applied_operation_ids || []), envelope.operation_id])];
      if (request.target_ids.every((id) => request.applied_target_ids.includes(id))) {
        request.status = "implemented";
        request.applied_at = record.effective_at;
      }
    }
  }
  return record;
}

export function assertUserConfirmation(approval, purpose) {
  if (!isTimestamp(approval?.confirmed_by_user_at)) throw new Error(JSON.stringify({ code: "user_confirmation_required", purpose, fix: "Record the user's explicit conversational confirmation" }));
}
