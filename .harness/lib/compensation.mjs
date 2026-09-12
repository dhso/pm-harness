import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { clone } from "./helpers.mjs";
import { digestValue } from "./model.mjs";
import { COLLECTIONS } from "./workspace.mjs";

const collectionsByStore = new Map();
const collectionKeys = new Set();
const MANAGED_DOCUMENTS = new Set(["project/status.md", "memory/current.md"]);
for (const [store, collection] of COLLECTIONS) {
  if (!collectionsByStore.has(store)) collectionsByStore.set(store, []);
  collectionsByStore.get(store).push(collection);
  collectionKeys.add(`${store}.${collection}`);
}

function fail(code, details) {
  throw new Error(JSON.stringify({ code, ...details }));
}

function collectArchivedPaths(value, paths = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectArchivedPaths(item, paths);
  } else if (value && typeof value === "object") {
    if (typeof value.archived_path === "string" && value.archived_path.startsWith("archive/files/")) paths.add(value.archived_path);
    for (const item of Object.values(value)) collectArchivedPaths(item, paths);
  }
  return [...paths];
}

function recordChanges(beforeRecords, afterRecords, store, collection) {
  const changes = [];
  const before = new Map((beforeRecords || []).map((item, index) => [item.id, { item, index }]));
  for (const [afterIndex, item] of (afterRecords || []).entries()) {
    const previous = before.get(item.id);
    if (!previous) {
      changes.push({ store, collection, id: item.id, change: "created", after_hash: digestValue(item), after_index: afterIndex });
      continue;
    }
    before.delete(item.id);
    if (digestValue(previous.item) !== digestValue(item)) {
      changes.push({ store, collection, id: item.id, change: "updated", before: clone(previous.item), after_hash: digestValue(item), before_index: previous.index, after_index: afterIndex });
    }
  }
  for (const { item, index } of before.values()) changes.push({ store, collection, id: item.id, change: "removed", before: clone(item), before_index: index });
  return changes;
}

export async function captureCompensation(root, before, after, changedStores, extraEntries, result) {
  const retainedPaths = new Set(collectArchivedPaths(result));
  const blockedPaths = [];
  const documents = [];
  for (const entry of extraEntries) {
    if (entry.path.startsWith("archive/files/")) retainedPaths.add(entry.path);
    else if (MANAGED_DOCUMENTS.has(entry.path)) {
      const absolute = path.join(root, entry.path);
      const beforeExists = existsSync(absolute);
      documents.push({
        path: entry.path,
        before_exists: beforeExists,
        before: beforeExists ? await readFile(absolute, "utf8") : null,
        after_hash: digestValue(entry.delete ? undefined : entry.content),
      });
    } else blockedPaths.push(entry.path);
  }
  // 人工文档写入本来就不能直接补偿；不要为不可补偿的操作复制整份事实快照，
  // 这样 status/memory/Wiki 等长文本不会把 change-log.json 成倍撑大。
  if (blockedPaths.length) return {
    version: 2,
    reversible: false,
    records: [],
    metadata: [],
    documents,
    retained_paths: [...retainedPaths].sort(),
    blocked_paths: [...new Set(blockedPaths)].sort(),
  };
  const records = [];
  const metadata = [];
  for (const store of changedStores) {
    const collections = collectionsByStore.get(store) || [];
    for (const collection of collections) records.push(...recordChanges(before[store]?.[collection], after[store]?.[collection], store, collection));

    const excluded = new Set(["schema_version", "operations", ...collections]);
    const keys = new Set([...Object.keys(before[store] || {}), ...Object.keys(after[store] || {})]);
    for (const key of keys) {
      if (excluded.has(key) || digestValue(before[store]?.[key]) === digestValue(after[store]?.[key])) continue;
      metadata.push({
        store,
        key,
        before_exists: Object.hasOwn(before[store] || {}, key),
        after_exists: Object.hasOwn(after[store] || {}, key),
        before: clone(before[store]?.[key]),
        after_hash: digestValue(after[store]?.[key]),
      });
    }
  }

  return {
    version: 2,
    reversible: blockedPaths.length === 0,
    records,
    metadata,
    documents,
    retained_paths: [...retainedPaths].sort(),
    blocked_paths: [...new Set(blockedPaths)].sort(),
  };
}

function coveredOperationIds(operation) {
  const childIds = operation.result?.workflow?.steps?.map((item) => item.operation_id).filter(Boolean) || [];
  return [...new Set([operation.operation_id, ...childIds])];
}

function compensatedIds(operations) {
  return new Set(operations.filter((item) => item.type === "operation.compensate").flatMap((item) => item.result?.compensation?.compensated_operation_ids || []));
}

export function latestEffectiveOperation(operations) {
  const compensated = compensatedIds(operations);
  return operations.findLast((item) => item.type !== "operation.compensate" && !compensated.has(item.operation_id)) || null;
}

function assertCurrent(actual, expected, targetId) {
  if (digestValue(actual) !== digestValue(expected)) {
    fail("compensation_conflict", { target_id: targetId, fix: "目标内容在原操作后发生了变化；请改用正向修正，避免覆盖后续事实" });
  }
}

function assertValidSnapshot(snapshot, operationId, data) {
  const invalid = (reason) => fail("compensation_snapshot_invalid", { operation_id: operationId, reason, fix: "补偿快照不完整或已被修改；请使用正向修正" });
  if (!snapshot || ![1, 2].includes(snapshot.version) || typeof snapshot.reversible !== "boolean") invalid("invalid_header");
  if (![snapshot.records, snapshot.metadata, snapshot.retained_paths, snapshot.blocked_paths].every(Array.isArray) || snapshot.version === 2 && !Array.isArray(snapshot.documents)) invalid("invalid_collections");
  if (snapshot.reversible && snapshot.blocked_paths.length) invalid("blocked_paths_marked_reversible");
  if (!snapshot.retained_paths.every((item) => typeof item === "string" && item.startsWith("archive/files/"))) invalid("invalid_retained_path");
  if (!snapshot.blocked_paths.every((item) => typeof item === "string" && item.length > 0)) invalid("invalid_blocked_path");
  for (const item of snapshot.records) {
    if (!item || !collectionKeys.has(`${item.store}.${item.collection}`) || typeof item.id !== "string" || !["created", "updated", "removed"].includes(item.change)) invalid("invalid_record_change");
    if (item.change === "created" && (snapshot.version === 1 ? !item.after || item.after.id !== item.id : typeof item.after_hash !== "string")) invalid("invalid_created_record");
    if (item.change === "updated" && (snapshot.version === 1 ? !item.before || !item.after || item.before.id !== item.id || item.after.id !== item.id : !item.before || item.before.id !== item.id || typeof item.after_hash !== "string")) invalid("invalid_updated_record");
    if (item.change === "removed" && (!item.before || item.before.id !== item.id)) invalid("invalid_removed_record");
  }
  for (const item of snapshot.metadata) {
    const collections = collectionsByStore.get(item?.store) || [];
    if (!item || !data[item.store] || typeof item.key !== "string" || ["schema_version", "operations", ...collections].includes(item.key)) invalid("invalid_metadata_change");
    if (typeof item.before_exists !== "boolean" || typeof item.after_exists !== "boolean") invalid("invalid_metadata_presence");
    if (snapshot.version === 2 && typeof item.after_hash !== "string") invalid("invalid_metadata_hash");
  }
  for (const item of snapshot.documents || []) {
    if (!item || !MANAGED_DOCUMENTS.has(item.path) || typeof item.before_exists !== "boolean" || typeof item.after_hash !== "string") invalid("invalid_document_change");
    if (item.before_exists && typeof item.before !== "string") invalid("invalid_document_before");
  }
}

function assertCurrentChange(actual, change, targetId, snapshotVersion) {
  if (snapshotVersion === 1) return assertCurrent(actual, change.after, targetId);
  if (digestValue(actual) !== change.after_hash) {
    fail("compensation_conflict", { target_id: targetId, fix: "目标内容在原操作后发生了变化；请改用正向修正，避免覆盖后续事实" });
  }
}

export async function applyCompensation(root, data, targetOperationId) {
  const operations = data.changes.operations || [];
  const target = operations.find((item) => item.operation_id === targetOperationId);
  if (!target) fail("operation_not_found", { operation_id: targetOperationId, fix: "用 query 确认需要撤销的 operation_id" });
  if (target.type === "operation.compensate") fail("operation_not_compensatable", { operation_id: targetOperationId, fix: "补偿操作不能再次补偿；如需恢复事实，请使用正向写入" });

  const already = operations.find((item) => item.type === "operation.compensate" && item.result?.compensation?.compensated_operation_ids?.includes(targetOperationId));
  if (already) fail("operation_already_compensated", { operation_id: targetOperationId, compensation_operation_id: already.operation_id });

  const latest = latestEffectiveOperation(operations);
  if (latest?.operation_id !== targetOperationId) {
    fail("not_latest_operation", { operation_id: targetOperationId, latest_operation_id: latest?.operation_id || null, latest_type: latest?.type || null, fix: "只能撤销最近一次尚未撤销的操作；更早的事实请正向修正" });
  }

  const covered = coveredOperationIds(target);
  const controlled = (data.changes.changes || []).filter((item) => covered.includes(item.operation_id));
  if (controlled.length) {
    fail("controlled_change_not_compensatable", { operation_id: targetOperationId, change_ids: controlled.map((item) => item.id), fix: "已批准或受控事实不能直接撤销；请提出并批准新的变更请求" });
  }

  const snapshot = target.compensation;
  if (!snapshot) fail("compensation_snapshot_missing", { operation_id: targetOperationId, fix: "该操作产生于补偿快照启用之前，请使用正向修正" });
  assertValidSnapshot(snapshot, targetOperationId, data);
  if (!snapshot.reversible) fail("operation_not_compensatable", { operation_id: targetOperationId, blocked_paths: snapshot.blocked_paths || [], fix: "该操作写入了需要人工判断的文档内容，请使用正向修正" });

  const changedStores = new Set();
  const entries = [];
  for (const change of [...(snapshot.records || [])].reverse()) {
    const records = data[change.store]?.[change.collection];
    if (!Array.isArray(records)) fail("compensation_snapshot_invalid", { operation_id: targetOperationId, store: change.store, collection: change.collection });
    const index = records.findIndex((item) => item.id === change.id);
    if (change.change === "created") {
      if (index < 0) fail("compensation_conflict", { target_id: change.id, fix: "待撤销的新记录已经不存在，请改用正向修正" });
      assertCurrentChange(records[index], change, change.id, snapshot.version);
      records.splice(index, 1);
    } else if (change.change === "updated") {
      if (index < 0) fail("compensation_conflict", { target_id: change.id, fix: "待恢复的记录已经不存在，请改用正向修正" });
      assertCurrentChange(records[index], change, change.id, snapshot.version);
      records[index] = clone(change.before);
    } else if (change.change === "removed") {
      if (index >= 0) fail("compensation_conflict", { target_id: change.id, fix: "待恢复的记录 ID 已被占用，请改用正向修正" });
      records.splice(Math.min(change.before_index ?? records.length, records.length), 0, clone(change.before));
    }
    changedStores.add(change.store);
  }

  for (const change of [...(snapshot.metadata || [])].reverse()) {
    if (snapshot.version === 1) assertCurrent(data[change.store]?.[change.key], change.after_exists ? change.after : undefined, `${change.store}.${change.key}`);
    else if (digestValue(data[change.store]?.[change.key]) !== change.after_hash) fail("compensation_conflict", { target_id: `${change.store}.${change.key}`, fix: "目标内容在原操作后发生了变化；请改用正向修正，避免覆盖后续事实" });
    if (change.before_exists) data[change.store][change.key] = clone(change.before);
    else delete data[change.store][change.key];
    changedStores.add(change.store);
  }

  for (const change of [...(snapshot.documents || [])].reverse()) {
    const absolute = path.join(root, change.path);
    const current = existsSync(absolute) ? await readFile(absolute, "utf8") : undefined;
    if (digestValue(current) !== change.after_hash) fail("compensation_conflict", { target_id: change.path, fix: "摘要内容在原操作后发生了变化；请改用正向修正，避免覆盖后续内容" });
    entries.push(change.before_exists ? { path: change.path, content: change.before } : { path: change.path, delete: true });
  }

  return {
    target,
    changedStores,
    entries,
    result: {
      compensation: {
        compensated_operation_id: targetOperationId,
        compensated_operation_ids: covered,
        restored_target_ids: target.target_ids || [],
        retained_paths: snapshot.retained_paths || [],
      },
    },
  };
}
