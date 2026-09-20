import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { baselineDigest, SCHEMA_VERSION } from "../../.harness/lib/model.mjs";
import { rebuildWorkspace } from "../../.harness/lib/views.mjs";

// 只复制可执行资产；项目事实、知识、记忆和治理数据必须由下方固定空状态生成。
export const TEST_STATIC_DIRECTORIES = Object.freeze([".harness", ".agents", "templates"]);
export const TEST_STATIC_FILES = Object.freeze(["AGENTS.md", ".gitignore", ".gitattributes", "package.json"]);

const DEFAULT_CONFIG = Object.freeze({
  schema_version: SCHEMA_VERSION,
  default_timezone: "Asia/Hong_Kong",
  upcoming_days: 7,
  recent_activity_days: 7,
  stale_task_days: 7,
  large_tracked_file_mb: 5,
  repeat_observation_threshold: 2,
  rule_review_days: 30,
  memory_current_max_bytes: 4096,
  status_max_bytes: 8192,
  memory_current_stale_days: 14,
  max_active_preferences: 40,
  verify_archive_hash_on_lint: true,
});

function emptyStores() {
  const schedule = { schema_version: SCHEMA_VERSION, baseline: null, milestones: [], tasks: [] };
  schedule.baseline = {
    revision: 0,
    status: "draft",
    digest: baselineDigest(schedule),
    approved_by_id: null,
    approved_at: null,
    change_request_id: null,
  };
  return {
    ".harness/config.json": DEFAULT_CONFIG,
    "project/project.json": { schema_version: SCHEMA_VERSION, initialized: false, id: "", name: "", status: "uninitialized", timezone: "Asia/Hong_Kong", objective: "", scope_in: [], scope_out: [], success_criteria: [], constraints: [], created_at: null, updated_at: null },
    "project/stakeholders.json": { schema_version: SCHEMA_VERSION, stakeholders: [] },
    "project/schedule.json": schedule,
    "project/requirements.json": { schema_version: SCHEMA_VERSION, requirements: [], change_requests: [] },
    "project/registers.json": { schema_version: SCHEMA_VERSION, risks: [], issues: [], decisions: [] },
    "knowledge/sources.json": { schema_version: SCHEMA_VERSION, sources: [] },
    "knowledge/inbox.json": { schema_version: SCHEMA_VERSION, items: [] },
    "knowledge/catalog.json": { schema_version: SCHEMA_VERSION, pages: [] },
    "memory/preferences.json": { schema_version: SCHEMA_VERSION, preferences: [] },
    "memory/observations.json": { schema_version: SCHEMA_VERSION, observations: [] },
    "activity/log.json": { schema_version: SCHEMA_VERSION, entries: [] },
    "deliverables/index.json": { schema_version: SCHEMA_VERSION, deliverables: [] },
    "governance/proposals.json": { schema_version: SCHEMA_VERSION, proposals: [] },
    "governance/rules.json": { schema_version: SCHEMA_VERSION, rules: [] },
    "governance/change-log.json": { schema_version: SCHEMA_VERSION, changes: [], operations: [] },
    "archive/index.json": { schema_version: SCHEMA_VERSION, files: [] },
  };
}

const EMPTY_DOCUMENTS = Object.freeze({
  "project/status.md": "# 项目状态\n\n项目尚未初始化。请对 AI Agent 说“初始化这个项目”。\n",
  "memory/current.md": "# 当前工作记忆\n\n- 当前重点：项目尚未初始化\n- 待确认：项目目标、范围、成功标准、干系人和关键时间点\n- 下一步：完成项目初始化\n",
});

export async function createTestWorkspace({ repositoryRoot = path.resolve(import.meta.dirname, "../.."), prefix = "pm-harness-test-" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await Promise.all([
    ...TEST_STATIC_DIRECTORIES.map((item) => cp(path.join(repositoryRoot, item), path.join(root, item), { recursive: true })),
    ...TEST_STATIC_FILES.map((item) => cp(path.join(repositoryRoot, item), path.join(root, item))),
  ]);
  const directories = ["project", "knowledge/wiki", "memory", "activity", "deliverables/current", "deliverables/final", "governance", "archive/files"];
  await Promise.all(directories.map((item) => mkdir(path.join(root, item), { recursive: true })));
  await Promise.all([
    ...Object.entries(emptyStores()).map(([relative, value]) => writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, "utf8")),
    ...Object.entries(EMPTY_DOCUMENTS).map(([relative, content]) => writeFile(path.join(root, relative), content, "utf8")),
  ]);
  await rebuildWorkspace(root);
  return root;
}
