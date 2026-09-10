// 按 ID 或过滤条件只读取目标事实源，并只返回调用方需要的记录和字段。
import { COLLECTIONS, readJson, STORE_FILES } from "./workspace.mjs";
import { nearestName, RECORD_MODELS } from "./model.mjs";

// 查询别名 -> [store, collection]。单数与复数都接受。
function collectionIndex() {
  const index = new Map();
  for (const [store, collection, kind] of COLLECTIONS) {
    // label 用 kind，避免返回 activity/log.json 里的内部数组名 `entries`。
    const resolved = { store, collection, label: kind, kind };
    // 复数集合名先进入候选表；像 taks 这类歧义拼写优先建议 CLI 文档中的 tasks。
    index.set(collection, resolved);
    index.set(kind, resolved);
  }
  const project = { store: "project", collection: null, label: "project", kind: "project", singleton: true };
  index.set("project", project);
  return index;
}

const ID_PREFIX_KIND = Object.freeze({
  STK: "stakeholder",
  MS: "milestone",
  TASK: "task",
  REQ: "requirement",
  CR: "change_request",
  RISK: "risk",
  ISSUE: "issue",
  DEC: "decision",
  SRC: "source",
  INB: "inbox",
  ACT: "activity",
  DEL: "deliverable",
  WIKI: "wiki",
  OBS: "observation",
  RULE: "rule",
  CHG: "change",
  ARC: "archive",
  PRJ: "project",
});

function pick(record, fields) {
  if (!fields?.length) return record;
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}

function matches(record, filters) {
  return Object.entries(filters).every(([field, value]) => String(record[field] ?? "") === String(value));
}

function assertKnownFields(names, supported, usage) {
  for (const field of names) {
    if (supported.has(field)) continue;
    const suggestion = nearestName(field, supported);
    const available = [...supported].sort();
    throw new Error(JSON.stringify({
      code: "unknown_query_field",
      field,
      usage,
      ...(suggestion ? { did_you_mean: suggestion } : {}),
      supported_fields: available,
      fix: suggestion ? `Use ${suggestion} instead of ${field}` : `Use one of: ${available.join(", ")}`,
    }));
  }
}

export async function queryWorkspace(root, { target, id, filters = {}, fields = [], limit = 0 } = {}) {
  const index = collectionIndex();

  // 只给 ID 时按前缀推断集合，调用方不必记住 ID 属于哪个文件。
  if (!target && id) {
    const kind = ID_PREFIX_KIND[String(id).split("-")[0].toUpperCase()];
    if (!kind) throw new Error(JSON.stringify({ code: "unknown_id_prefix", id, fix: `Pass an explicit collection, or use an ID with a known prefix: ${Object.keys(ID_PREFIX_KIND).join(", ")}` }));
    target = kind;
  }
  if (!target) throw new Error(JSON.stringify({ code: "query_target_required", fix: `Pass a collection: ${[...new Set(COLLECTIONS.map((item) => item[2]))].join(", ")}` }));

  const normalizedTarget = String(target).toLowerCase();
  const resolved = index.get(normalizedTarget);
  if (!resolved) {
    const suggestion = nearestName(normalizedTarget, [...index.keys()]);
    throw new Error(JSON.stringify({ code: "unknown_collection", target, ...(suggestion ? { did_you_mean: suggestion } : {}), supported: [...new Set([...COLLECTIONS.map((item) => item[2]), "project"])].sort() }));
  }

  if (!Number.isInteger(limit) || limit < 0) throw new Error(JSON.stringify({ code: "invalid_limit", limit, fix: "Use a non-negative integer" }));
  const storeData = await readJson(root, STORE_FILES[resolved.store]);
  const records = resolved.singleton ? [storeData] : storeData?.[resolved.collection] || [];
  const supported = resolved.singleton
    ? new Set(Object.keys(storeData))
    : new Set(["id", ...Object.keys(RECORD_MODELS[resolved.kind]?.fields || {})]);
  assertKnownFields(Object.keys(filters), supported, "where");
  assertKnownFields(fields, supported, "fields");
  if (id) {
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error(JSON.stringify({ code: "record_not_found", id, collection: resolved.label, count: records.length }));
    return { collection: resolved.label, record: pick(record, fields) };
  }

  let found = Object.keys(filters).length ? records.filter((item) => matches(item, filters)) : records;
  const total = found.length;
  if (limit > 0) found = found.slice(0, limit);
  return {
    collection: resolved.label,
    count: total,
    ...(limit > 0 && total > found.length ? { truncated: true, returned: found.length } : {}),
    records: found.map((item) => pick(item, fields)),
  };
}
