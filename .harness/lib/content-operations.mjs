import { existsSync } from "node:fs";
import path from "node:path";
import { assertTransition, nextId } from "./model.mjs";
import { clone, digestFields, exactChange, isWorkspaceRelativePath, normalizeArray, replacementChange, safeWikiPath, sha256Path, upsert, validateOrThrow } from "./helpers.mjs";
import { DELIVERABLE_CONTROLLED_FIELDS, DELIVERABLE_IMMUTABLE_FIELDS } from "./workspace.mjs";
import { addControlledChange, assertUserConfirmation, verifyApproval } from "./approval.mjs";

export async function applyContentOperation({ root, envelope, data, now, changedStores, extraEntries, resultIds }) {
  if (envelope.type === "inbox.transition") {
    const item = data.inbox.items.find((candidate) => candidate.id === envelope.payload.id);
    if (!item) throw new Error(`Inbox item not found: ${envelope.payload.id}`);
    assertTransition("inbox", item.status, envelope.payload.status, item.id);
    Object.assign(item, { status: envelope.payload.status, applied_to_ids: normalizeArray(envelope.payload.applied_to_ids), applied_at: envelope.payload.applied_at ?? (envelope.payload.status === "applied" ? now : null), disposition_reason: envelope.payload.disposition_reason ?? null });
    validateOrThrow("inbox", item);
    changedStores.add("inbox");
    resultIds.push(item.id);
    return { inbox_item: item };
  }
  if (["deliverable.upsert", "deliverable.transition"].includes(envelope.type)) {
    const payload = envelope.payload;
    const existing = payload.id ? data.deliverables.deliverables.find((item) => item.id === payload.id) : null;
    if (envelope.type === "deliverable.transition" && !existing) throw new Error(`Deliverable not found: ${payload.id}`);
    const record = envelope.type === "deliverable.transition" ? { ...existing, ...payload } : { ...existing, ...payload, id: payload.id || nextId(data.deliverables.deliverables, "deliverable"), status: payload.status || existing?.status || "requested" };
    for (const field of ["requirement_ids", "source_ids", "acceptance_criteria", "reviewers"]) record[field] = normalizeArray(record[field] || (field === "source_ids" ? envelope.source_ids : []));
    for (const field of ["path", "content_sha256", "due_at", "completed_at", "approved_by_id", "approved_at", "delivered_at", "accepted_by_id", "accepted_at", "acceptance_evidence", "supersedes_id", "superseded_by_id"]) if (!(field in record)) record[field] = null;
    if (existing) assertTransition("deliverable", existing.status, record.status, record.id);
    const existingApproved = existing && ["approved", "delivered", "accepted"].includes(existing.status);
    if (existingApproved && digestFields(existing, DELIVERABLE_IMMUTABLE_FIELDS) !== digestFields(record, DELIVERABLE_IMMUTABLE_FIELDS)) throw new Error(JSON.stringify({ code: "approved_deliverable_requires_new_version", id: record.id, fix: "Create a new DEL version; do not overwrite approved content or metadata" }));
    const supersessionChanged = existingApproved && digestFields(existing, ["supersedes_id", "superseded_by_id"]) !== digestFields(record, ["supersedes_id", "superseded_by_id"]);
    if (supersessionChanged) {
      verifyApproval(data, envelope.approval, "deliverable", { requireChangeRequest: true, targetIds: [record.id], actualChanges: [exactChange(record.id, existing, record, ["supersedes_id", "superseded_by_id"])] });
      addControlledChange(data, envelope, { kind: "deliverable_supersession", target_ids: [record.id], before: existing, after: record, before_hash: digestFields(existing, DELIVERABLE_CONTROLLED_FIELDS), after_hash: digestFields(record, DELIVERABLE_CONTROLLED_FIELDS), before_summary: `${existing.title} ${existing.version}`, after_summary: `${record.title} ${record.version}` });
      changedStores.add("changes");
      changedStores.add("requirements");
    }
    if (record.status === "approved" && existing?.status !== "approved") {
      if (!record.path || !isWorkspaceRelativePath(root, record.path) || !existsSync(path.join(root, record.path))) throw new Error(JSON.stringify({ code: "deliverable_file_required", id: record.id, fix: "Create the deliverable file inside the workspace before approval" }));
      record.content_sha256 = await sha256Path(path.join(root, record.path));
      const predecessor = record.supersedes_id ? data.deliverables.deliverables.find((item) => item.id === record.supersedes_id) : null;
      if (record.supersedes_id && (!existing || !predecessor)) throw new Error(JSON.stringify({ code: "replacement_candidate_required", fix: "Register and review the replacement version before approving its supersession" }));
      const targetId = predecessor?.id || record.id;
      const approval = verifyApproval(data, envelope.approval, "deliverable", { requireChangeRequest: Boolean(predecessor), targetIds: [targetId], actualChanges: predecessor ? [replacementChange(targetId, predecessor, record, DELIVERABLE_IMMUTABLE_FIELDS)] : [] });
      record.approved_by_id = approval.stakeholder.id;
      record.approved_at = approval.changeRequest?.effective_at || envelope.approval.approved_at;
      if (predecessor) {
        assertTransition("deliverable", predecessor.status, "superseded", predecessor.id);
        Object.assign(predecessor, { status: "superseded", superseded_by_id: record.id });
        validateOrThrow("deliverable", predecessor);
      }
      addControlledChange(data, envelope, { kind: "deliverable_approval", target_ids: predecessor ? [record.id, predecessor.id] : [record.id], change_request_target_ids: predecessor ? [predecessor.id] : undefined, before: existing || {}, after: record, before_hash: digestFields(existing, DELIVERABLE_IMMUTABLE_FIELDS), after_hash: digestFields(record, DELIVERABLE_IMMUTABLE_FIELDS), before_summary: existing?.status || null, after_summary: "approved" });
      changedStores.add("changes");
      if (predecessor) changedStores.add("requirements");
    }
    if (record.status === "delivered" && existing?.status !== "delivered") record.delivered_at ||= payload.delivered_at || now;
    if (record.status === "accepted" && existing?.status !== "accepted") {
      const approval = verifyApproval(data, envelope.approval, "acceptance");
      record.accepted_by_id = approval.stakeholder.id;
      record.accepted_at ||= envelope.approval.approved_at;
      record.acceptance_evidence ||= payload.acceptance_evidence;
      addControlledChange(data, envelope, { kind: "deliverable_acceptance", target_ids: [record.id], before: existing || {}, after: record, before_summary: existing?.status || null, after_summary: "accepted" });
      changedStores.add("changes");
    }
    if (["approved", "delivered", "accepted"].includes(record.status) && !record.approved_at) throw new Error(JSON.stringify({ code: "deliverable_approval_required", id: record.id }));
    validateOrThrow("deliverable", record);
    upsert(data.deliverables.deliverables, record);
    changedStores.add("deliverables");
    resultIds.push(record.id);
    return { deliverable: record };
  }
  if (envelope.type === "wiki.register") {
    const payload = envelope.payload;
    const existing = payload.id ? data.catalog.pages.find((item) => item.id === payload.id) : null;
    const record = { ...existing, id: payload.id || nextId(data.catalog.pages, "wiki"), title: payload.title ?? existing?.title, path: safeWikiPath(payload.path ?? existing?.path), status: payload.status || existing?.status || "active", source_ids: normalizeArray(payload.source_ids ?? existing?.source_ids ?? envelope.source_ids), related_ids: normalizeArray(payload.related_ids ?? existing?.related_ids), owner: payload.owner ?? existing?.owner ?? null, last_reviewed_at: payload.last_reviewed_at ?? existing?.last_reviewed_at ?? now, review_due_at: payload.review_due_at ?? existing?.review_due_at ?? null, supersedes_id: payload.supersedes_id ?? existing?.supersedes_id ?? null, superseded_by_id: payload.superseded_by_id ?? existing?.superseded_by_id ?? null };
    if (existing) assertTransition("wiki", existing.status, record.status, record.id);
    validateOrThrow("wiki", record);
    upsert(data.catalog.pages, record);
    if (typeof payload.content === "string") extraEntries.push({ path: record.path, content: payload.content.endsWith("\n") ? payload.content : `${payload.content}\n` });
    else if (!existsSync(path.join(root, record.path))) throw new Error("wiki.register requires content when the page does not exist");
    changedStores.add("catalog");
    resultIds.push(record.id);
    return { wiki: record };
  }
  if (envelope.type === "observation.record") {
    const payload = envelope.payload;
    const record = { id: payload.id || nextId(data.observations.observations, "observation"), title: payload.title, pattern_key: payload.pattern_key, status: payload.status || "open", evidence: payload.evidence, suggested_rule: payload.suggested_rule ?? null, proposal_id: payload.proposal_id ?? null, created_at: payload.created_at || now, resolved_at: payload.resolved_at ?? null };
    validateOrThrow("observation", record);
    data.observations.observations.push(record);
    changedStores.add("observations");
    resultIds.push(record.id);
    return { observation: record };
  }
  if (envelope.type === "rule.propose") {
    const payload = envelope.payload;
    const observationIds = normalizeArray(payload.observation_ids);
    if (!observationIds.length && !payload.manual_reason) throw new Error(JSON.stringify({ code: "rule_evidence_required", fix: "Link observations or provide a manual_reason" }));
    const record = { id: payload.id || nextId(data.proposals.proposals, "proposal"), title: payload.title, status: "proposed", observation_ids: observationIds, proposed_rule: payload.proposed_rule, scope: payload.scope, expected_benefit: payload.expected_benefit, possible_side_effects: payload.possible_side_effects, evaluation_metric: payload.evaluation_metric, review_at: payload.review_at, manual_reason: payload.manual_reason ?? null, approved_by: null, approved_at: null, effective_at: null, pattern_key: payload.pattern_key ?? null };
    validateOrThrow("proposal", record);
    data.proposals.proposals.push(record);
    for (const id of record.observation_ids) {
      const observation = data.observations.observations.find((item) => item.id === id);
      if (observation) observation.proposal_id = record.id;
    }
    changedStores.add("proposals");
    changedStores.add("observations");
    resultIds.push(record.id);
    return { proposal: record };
  }
  if (envelope.type === "rule.activate") {
    assertUserConfirmation(envelope.approval, "rule activation");
    const proposal = data.proposals.proposals.find((item) => item.id === envelope.payload.id);
    if (!proposal || !["proposed", "approved"].includes(proposal.status)) throw new Error(`Rule proposal cannot be activated: ${envelope.payload.id}`);
    const before = clone(proposal);
    if (proposal.status === "proposed") Object.assign(proposal, { status: "approved", approved_by: "user", approved_at: envelope.approval.confirmed_by_user_at });
    assertTransition("proposal", proposal.status, "active", proposal.id);
    Object.assign(proposal, { status: "active", effective_at: envelope.approval.confirmed_by_user_at });
    const rule = { id: proposal.id, text: proposal.proposed_rule, scope: proposal.scope, status: "active", proposal_id: proposal.id, effective_at: proposal.effective_at, review_at: proposal.review_at, retired_at: null, pattern_key: proposal.pattern_key ?? null };
    validateOrThrow("rule", rule);
    upsert(data.rules.rules, rule);
    addControlledChange(data, envelope, { kind: "rule_activation", target_ids: [rule.id], before, after: rule, before_summary: "proposed", after_summary: "active" });
    changedStores.add("proposals"); changedStores.add("rules"); changedStores.add("changes"); resultIds.push(rule.id);
    return { rule };
  }
  if (envelope.type === "rule.retire") {
    assertUserConfirmation(envelope.approval, "rule retirement");
    const rule = data.rules.rules.find((item) => item.id === envelope.payload.id);
    const proposal = data.proposals.proposals.find((item) => item.id === envelope.payload.id);
    if (!rule || rule.status !== "active" || !proposal) throw new Error(`Active rule not found: ${envelope.payload.id}`);
    const before = clone(rule);
    rule.status = "retired"; rule.retired_at = envelope.approval.confirmed_by_user_at; proposal.status = "retired";
    addControlledChange(data, envelope, { kind: "rule_retirement", target_ids: [rule.id], before, after: rule, before_summary: "active", after_summary: "retired" });
    changedStores.add("proposals"); changedStores.add("rules"); changedStores.add("changes"); resultIds.push(rule.id);
    return { rule };
  }
  throw new Error(JSON.stringify({ code: "operation_handler_missing", type: envelope.type }));
}
