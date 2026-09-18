import { readFile } from "node:fs/promises";
import path from "node:path";

export const STORE_FILES = Object.freeze({
  config: ".harness/config.json",
  project: "project/project.json",
  stakeholders: "project/stakeholders.json",
  schedule: "project/schedule.json",
  requirements: "project/requirements.json",
  registers: "project/registers.json",
  sources: "knowledge/sources.json",
  inbox: "knowledge/inbox.json",
  catalog: "knowledge/catalog.json",
  preferences: "memory/preferences.json",
  observations: "memory/observations.json",
  activity: "activity/log.json",
  deliverables: "deliverables/index.json",
  proposals: "governance/proposals.json",
  rules: "governance/rules.json",
  changes: "governance/change-log.json",
  archive: "archive/index.json",
});

export const COLLECTIONS = Object.freeze([
  ["stakeholders", "stakeholders", "stakeholder"],
  ["schedule", "milestones", "milestone"],
  ["schedule", "tasks", "task"],
  ["requirements", "requirements", "requirement"],
  ["requirements", "change_requests", "change_request"],
  ["registers", "risks", "risk"],
  ["registers", "issues", "issue"],
  ["registers", "decisions", "decision"],
  ["sources", "sources", "source"],
  ["inbox", "items", "inbox"],
  ["catalog", "pages", "wiki"],
  ["preferences", "preferences", "preference"],
  ["observations", "observations", "observation"],
  ["activity", "entries", "activity"],
  ["deliverables", "deliverables", "deliverable"],
  ["proposals", "proposals", "proposal"],
  ["rules", "rules", "rule"],
  ["changes", "changes", "change"],
  ["archive", "files", "archive"],
]);

export const REQUIREMENT_IMMUTABLE_FIELDS = Object.freeze(["title", "description", "acceptance_criteria", "owner"]);
export const REQUIREMENT_LEGACY_IMMUTABLE_FIELDS = Object.freeze(["title", "description", "acceptance_criteria"]);
export const REQUIREMENT_LINK_FIELDS = Object.freeze(["source_ids", "supersedes_id", "superseded_by_id"]);
export const DELIVERABLE_IMMUTABLE_FIELDS = Object.freeze(["title", "type", "format", "version", "path", "content_sha256", "audience", "purpose", "requirement_ids", "source_ids", "due_at", "acceptance_criteria", "reviewers"]);
export const DELIVERABLE_CONTROLLED_FIELDS = Object.freeze([...DELIVERABLE_IMMUTABLE_FIELDS, "supersedes_id", "superseded_by_id"]);
// 改 text 等于换掉用户说过的话，所以旧条退役留档、新条接手，而不是原地覆盖。
// scope 只是分类，改了不丢事实，原地更新即可。
export const PREFERENCE_SUPERSEDING_FIELDS = Object.freeze(["text"]);
export const DECISION_CONTROLLED_FIELDS = Object.freeze(["title", "description", "rationale", "source_ids", "superseded_by_id"]);

export async function readJson(root, relativePath) {
  let raw;
  try {
    raw = await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    const wrapped = new Error(JSON.stringify({
      code: error.code === "ENOENT" ? "store_missing" : "store_read_failed",
      path: relativePath,
      message: error.message,
      fix: error.code === "ENOENT" ? `Restore ${relativePath} from the workspace template or backup` : "Check file permissions and retry once",
    }));
    wrapped.code = error.code === "ENOENT" ? "store_missing" : "store_read_failed";
    wrapped.path = relativePath;
    throw wrapped;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error(JSON.stringify({
      code: "invalid_json",
      path: relativePath,
      message: error.message,
      fix: "Restore valid JSON for this store; do not retry unchanged input",
    }));
    wrapped.code = "invalid_json";
    wrapped.path = relativePath;
    throw wrapped;
  }
}

// 所有事实源都由新模板创建并严格读取；缺失必须显式报错，不能静默当成空数据。
export async function readStore(root, key) {
  return readJson(root, STORE_FILES[key]);
}

export async function readWorkspace(root) {
  const entries = await Promise.all(Object.keys(STORE_FILES).map(async (key) => [key, await readStore(root, key)]));
  return Object.fromEntries(entries);
}
