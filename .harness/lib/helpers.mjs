import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { digestValue, isDate, isPlainObject, nextId, validateRecord } from "./model.mjs";

export function text(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function escapeTable(value) {
  return text(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function mermaidText(value) {
  return text(value).replace(/[,:#;\[\]{}()"`]/g, " ").replace(/\s+/g, " ").trim();
}

export function daysBetween(left, right) {
  if (!left || !right || !isDate(left) || !isDate(right)) return null;
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

export function ageInDays(value, now = new Date()) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return Math.floor((now.valueOf() - Date.parse(value)) / 86_400_000);
}

export function localDate(timezone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return typeof value === "string" && Boolean(value);
  } catch {
    return false;
  }
}

export function addDays(date, count) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

export async function walkMarkdown(directory, base = directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walkMarkdown(absolute, base));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(path.relative(base, absolute).split(path.sep).join("/"));
  }
  return results.sort();
}

export async function sha256Path(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export function clone(value) {
  return structuredClone(value);
}

export function upsert(records, record) {
  const index = records.findIndex((item) => item.id === record.id);
  if (index >= 0) records[index] = record;
  else records.push(record);
  return record;
}

export function normalizeArray(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item))] : [];
}

function normalizeAcceptanceCriteria(value, field = null) {
  if (field === "acceptance_criteria" && Array.isArray(value)) return [...new Set(value)].sort();
  if (Array.isArray(value)) return value.map((item) => normalizeAcceptanceCriteria(item));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeAcceptanceCriteria(item, key)]));
}

// 验收标准是集合而不是优先级列表；仅在比较时规范化，事实记录仍保留原始展示顺序。
export function digestChangeIntent(value) {
  return digestValue(normalizeAcceptanceCriteria(value));
}

// 已被补偿移除的记录仍保留在操作历史中，自动与显式 ID 都不得重新分配。
export function nextWorkspaceId(data, records, kind, requestedId = null) {
  const reservedIds = new Set((data.changes?.operations || []).flatMap((item) => item.target_ids || []));
  if (requestedId) {
    const exists = (records || []).some((item) => item.id === requestedId);
    if (!exists && reservedIds.has(requestedId)) {
      throw new Error(JSON.stringify({
        code: "workspace_id_reserved",
        id: requestedId,
        fix: "This ID belongs to an earlier operation and cannot identify a new record; omit id to allocate the next stable ID",
      }));
    }
    return requestedId;
  }
  const reserved = [...reservedIds].map((id) => ({ id }));
  return nextId([...(records || []), ...reserved], kind);
}

export function digestFields(record, fields) {
  return digestValue(Object.fromEntries(fields.map((field) => [field, record?.[field] ?? null])));
}

export function exactChange(targetId, before, after, fields) {
  const changed = fields.filter((field) => digestValue(before?.[field] ?? null) !== digestValue(after?.[field] ?? null));
  const select = (value) => Object.fromEntries(changed.map((field) => [field, value?.[field] ?? null]));
  return { target_id: targetId, before: select(before), after: select(after) };
}

export function replacementChange(targetId, predecessor, replacement, fields) {
  const replacementFields = fields.filter((field) => field !== "owner" || predecessor?.owner != null || replacement?.owner != null);
  return {
    target_id: targetId,
    before: { status: predecessor?.status ?? null, superseded_by_id: predecessor?.superseded_by_id ?? null },
    after: {
      status: "superseded",
      superseded_by_id: replacement.id,
      replacement: Object.fromEntries(replacementFields.map((field) => [field, replacement?.[field] ?? null])),
    },
  };
}

export function validateOrThrow(kind, record) {
  const issues = validateRecord(kind, record);
  if (issues.length) throw new Error(JSON.stringify({ code: "record_validation_failed", kind, issues }));
}

export function isWorkspaceRelativePath(root, value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) return false;
  const resolvedRoot = path.resolve(root);
  return path.resolve(root, value).startsWith(`${resolvedRoot}${path.sep}`);
}

export async function safeWorkspaceInputPath(root, value) {
  if (!isWorkspaceRelativePath(root, value)) throw new Error("Source raw_path must stay inside the project workspace");
  const absolute = path.resolve(root, String(value || ""));
  const [resolvedRoot, resolvedInput] = await Promise.all([realpath(root), realpath(absolute)]);
  if (!resolvedInput.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Source raw_path symlink must not escape the project workspace");
  return absolute;
}

export function safeWikiPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized.startsWith("knowledge/wiki/") || !normalized.endsWith(".md") || normalized.includes("../") || path.posix.isAbsolute(normalized)) throw new Error("Wiki path must stay under knowledge/wiki and end in .md");
  return normalized;
}

export function defaultScheduleRecord(payload, kind, now) {
  return {
    id: payload.id || null,
    title: payload.title,
    status: payload.status || "not_started",
    owner: payload.owner ?? null,
    baseline_start: payload.baseline_start ?? null,
    baseline_end: payload.baseline_end ?? null,
    forecast_start: payload.forecast_start ?? null,
    forecast_end: payload.forecast_end ?? null,
    actual_start: payload.actual_start ?? null,
    actual_end: payload.actual_end ?? null,
    progress: payload.progress ?? 0,
    dependency_ids: normalizeArray(payload.dependency_ids),
    requirement_ids: normalizeArray(payload.requirement_ids),
    deliverable_ids: normalizeArray(payload.deliverable_ids),
    source_ids: normalizeArray(payload.source_ids),
    next_action: payload.next_action ?? null,
    evidence: payload.evidence ?? null,
    updated_at: payload.updated_at || now,
    _kind: kind,
  };
}

export function sameBaseline(left, right) {
  return (left?.baseline_start ?? null) === (right?.baseline_start ?? null) && (left?.baseline_end ?? null) === (right?.baseline_end ?? null);
}

export function targetDate(item) {
  return item.forecast_end || item.baseline_end || item.due_at || null;
}
