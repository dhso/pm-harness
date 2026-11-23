import { isPlainObject, SCHEMA_VERSION, validateRecord } from "./model.mjs";
import { COLLECTIONS, STORE_FILES } from "./workspace.mjs";

// 先识别不可安全遍历的数据形状，避免诊断、渲染或写入处理器被 TypeError 打断。
// 写入前只检查容器；字段仍在操作后的完整校验中检查，保留正向修复旧记录的能力。
export function storeShapeIssues(key, value, { validateRecords = true } = {}) {
  const issues = [];
  const add = (code, message) => issues.push({ level: "error", code, path: STORE_FILES[key], message });
  if (!isPlainObject(value)) {
    add("invalid_store", "Top-level store must be an object");
    return issues;
  }
  if (value.schema_version !== SCHEMA_VERSION) add("schema_version", `schema_version must be ${SCHEMA_VERSION}`);
  for (const [store, collection, kind] of COLLECTIONS) {
    if (store !== key) continue;
    if (!Array.isArray(value[collection])) add("invalid_collection", `${collection} must be an array`);
    else for (const [index, record] of value[collection].entries()) {
      if (validateRecords) for (const issue of validateRecord(kind, record)) add(issue.code, issue.message);
      else if (!isPlainObject(record)) add("invalid_record", `${collection}[${index}] must be an object`);
    }
  }
  if (key === "changes") {
    if (!Array.isArray(value.operations)) add("invalid_collection", "operations must be an array");
    else for (const [index, item] of value.operations.entries()) {
      if (!isPlainObject(item)) add("invalid_operation_record", `operations[${index}] must be an object`);
    }
  }
  return issues;
}

export function workspaceShapeIssues(data, options) {
  return Object.keys(STORE_FILES).flatMap((key) => storeShapeIssues(key, data[key], options));
}

export function modelCollections(data, issues) {
  const allIds = new Set();
  const byKind = {};
  const ownersById = new Map();
  for (const [store, collection, kind] of COLLECTIONS) {
    byKind[kind] = data[store][collection];
    for (const record of byKind[kind]) {
      allIds.add(record.id);
      if (!ownersById.has(record.id)) ownersById.set(record.id, []);
      ownersById.get(record.id).push({ kind, relativePath: STORE_FILES[store] });
    }
  }
  for (const [id, owners] of ownersById) {
    if (owners.length < 2) continue;
    const kinds = owners.map((item) => item.kind).sort();
    const allowedRulePair = owners.length === 2 && kinds[0] === "proposal" && kinds[1] === "rule";
    if (!allowedRulePair) issues.push({ level: "error", code: "duplicate_id", path: owners.at(-1).relativePath, message: `Duplicate ID across workspace: ${id}` });
  }
  if (data.project.id) {
    if (allIds.has(data.project.id)) issues.push({ level: "error", code: "duplicate_id", path: STORE_FILES.project, message: `Project ID duplicates another workspace ID: ${data.project.id}` });
    allIds.add(data.project.id);
  }
  return { allIds, byKind };
}
