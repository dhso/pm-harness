import { SCHEMA_VERSION, makeOperationId } from "./model.mjs";
import { localDate, normalizeArray, safeWorkspaceInputPath, sha256Path } from "./helpers.mjs";
import { readWorkspace } from "./workspace.mjs";
import { recordOperation } from "./operations.mjs";

function splitPayload(input) {
  const { operation_id, actor, reason, ...payload } = input;
  return { operation_id, actor, reason, payload };
}

export async function registerSource(root, input) {
  const { operation_id, actor, reason, payload } = splitPayload(input);
  const signature = payload.raw_path ? { ...payload, raw_sha256: await sha256Path(await safeWorkspaceInputPath(root, payload.raw_path)) } : payload;
  return recordOperation(root, { schema_version: SCHEMA_VERSION, operation_id: operation_id || makeOperationId("source.register", signature), type: "source.register", actor: actor || { kind: "agent" }, reason: reason || "登记项目来源", source_ids: [], payload });
}

export async function appendActivityEntry(root, input) {
  const { operation_id, actor, reason, payload } = splitPayload(input);
  const result = await recordOperation(root, { schema_version: SCHEMA_VERSION, operation_id: operation_id || makeOperationId("activity.record", payload), type: "activity.record", actor: actor || { kind: "agent" }, reason: reason || "记录实际项目活动", source_ids: normalizeArray(payload.source_ids), payload });
  const timezone = (await readWorkspace(root)).project.timezone || "UTC";
  return { id: result.activity.id, path: `activity/${localDate(timezone, new Date(result.activity.occurred_at))}.md`, timestamp: result.activity.occurred_at };
}

export async function initializeProject(root, input) {
  const { operation_id, actor, reason, payload } = splitPayload(input);
  const result = await recordOperation(root, { schema_version: SCHEMA_VERSION, operation_id: operation_id || makeOperationId("project.initialize", payload), type: "project.initialize", actor: actor || { kind: "agent" }, reason: reason || "初始化项目", source_ids: [], payload });
  return result.project;
}

export async function compensateLastOperation(root, operationId, options = {}) {
  const payload = { operation_id: operationId };
  return recordOperation(root, {
    schema_version: SCHEMA_VERSION,
    operation_id: makeOperationId("operation.compensate", payload),
    type: "operation.compensate",
    actor: { kind: "agent" },
    reason: "撤销最近一次可撤销操作并保留审计记录",
    source_ids: [],
    ...(options.confirmedByUserAt ? { approval: { confirmed_by_user_at: options.confirmedByUserAt } } : {}),
    payload,
  }, options);
}

export async function sha256File(filePath) {
  return sha256Path(filePath);
}
