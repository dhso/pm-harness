import { SCHEMA_VERSION } from "./model.mjs";
import { normalizeArray } from "./helpers.mjs";

export async function applyWorkflow(envelope, applyStep) {
  if (typeof envelope.payload.kind !== "string" || !envelope.payload.kind.trim()) throw new Error(JSON.stringify({ code: "workflow_kind_required" }));
  const changedStores = new Set();
  const entries = [];
  const targetIds = [];
  const steps = [];
  for (const [index, step] of envelope.payload.operations.entries()) {
    if (step.type === "workflow.apply") throw new Error(JSON.stringify({ code: "nested_workflow_not_supported", index }));
    const child = {
      schema_version: SCHEMA_VERSION,
      operation_id: `${envelope.operation_id}.step-${String(index + 1).padStart(2, "0")}`,
      type: step.type,
      actor: envelope.actor,
      reason: step.reason || envelope.reason,
      source_ids: normalizeArray(step.source_ids ?? envelope.source_ids),
      ...(step.approval || envelope.approval ? { approval: step.approval || envelope.approval } : {}),
      payload: step.payload,
    };
    const applied = await applyStep(child);
    for (const key of applied.transaction.changed_stores) changedStores.add(key);
    entries.push(...applied.transaction.entries);
    targetIds.push(...applied.target_ids);
    const { transaction, ...publicResult } = applied;
    steps.push(publicResult);
  }
  return { result: { workflow: { kind: envelope.payload.kind, steps } }, changedStores, entries, targetIds };
}
