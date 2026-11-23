import { SCHEMA_VERSION, makeOperationId } from "./model.mjs";
import { localDate, normalizeArray, safeWorkspaceInputPath, sha256Path } from "./helpers.mjs";
import { readStore, readWorkspace } from "./workspace.mjs";
import { recordOperation } from "./operations.mjs";
import { latestEffectiveOperation } from "./compensation.mjs";

function splitPayload(input) {
  const { operation_id, actor, reason, ...payload } = input;
  return { operation_id, actor, reason, payload };
}

export async function registerSource(root, input) {
  const { operation_id, actor, reason, payload } = splitPayload(input);
  const signature = !operation_id && payload.raw_path ? { ...payload, raw_sha256: await sha256Path(await safeWorkspaceInputPath(root, payload.raw_path)) } : payload;
  return recordOperation(root, { schema_version: SCHEMA_VERSION, operation_id: operation_id || makeOperationId("source.register", signature), type: "source.register", actor: actor || { kind: "agent" }, reason: reason || "登记项目来源", source_ids: [], payload });
}

export async function appendActivityEntry(root, input) {
  const { operation_id, actor, reason, payload } = splitPayload(input);
  const timezone = (await readStore(root, "project")).timezone || "UTC";
  const result = await recordOperation(root, { schema_version: SCHEMA_VERSION, operation_id: operation_id || makeOperationId("activity.record", payload), type: "activity.record", actor: actor || { kind: "agent" }, reason: reason || "记录实际项目活动", source_ids: normalizeArray(payload.source_ids), payload });
  return { id: result.activity.id, path: `activity/${localDate(timezone, new Date(result.activity.occurred_at))}.md`, timestamp: result.activity.occurred_at, ...(result.warnings ? { warnings: result.warnings } : {}) };
}

export async function initializeProject(root, input) {
  const { operation_id, actor, reason, payload } = splitPayload(input);
  const result = await recordOperation(root, { schema_version: SCHEMA_VERSION, operation_id: operation_id || makeOperationId("project.initialize", payload), type: "project.initialize", actor: actor || { kind: "agent" }, reason: reason || "初始化项目", source_ids: [], payload });
  return { ...result.project, ...(result.warnings ? { warnings: result.warnings } : {}) };
}

// 只读查找最近一次尚未撤销的写入，供 `undo --latest` 使用；真正的补偿仍走预演、确认和全部护栏。
export async function findLatestUndoableOperation(root) {
  const latest = latestEffectiveOperation((await readWorkspace(root)).changes.operations || []);
  if (!latest) throw new Error(JSON.stringify({ code: "no_undoable_operation", fix: "没有可撤销的写入；如需恢复事实请正向修正" }));
  return { operation_id: latest.operation_id, type: latest.type, recorded_at: latest.recorded_at, target_ids: latest.target_ids || [] };
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
