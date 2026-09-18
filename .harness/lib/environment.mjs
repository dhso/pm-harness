import { readFile, readdir } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { ageInDays } from "./helpers.mjs";

function addIssue(issues, level, code, relativePath, message) {
  issues.push({ level, code, path: relativePath, message });
}

const SKILL_KINDS = new Set(["router", "workflow", "capability"]);
const TASK_DEPENDENCY_DIRECTORIES = new Set(["node_modules", ".venv", "venv", "__pypackages__", ".npm", ".pip-cache"]);

function skillFrontmatter(content) {
  const block = content.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
  const composes = block.match(/^\s+composes:\s*(.+)$/m)?.[1]?.split(",").map((item) => item.trim()).filter(Boolean) || [];
  return {
    name: block.match(/^name:\s*(\S+)$/m)?.[1] || null,
    description: block.match(/^description:\s*(.+)$/m)?.[1]?.trim() || null,
    kind: block.match(/^\s+kind:\s*(\S+)$/m)?.[1] || null,
    domain: block.match(/^\s+domain:\s*(\S+)$/m)?.[1] || null,
    owner: block.match(/^\s+owner:\s*(\S+)$/m)?.[1] || null,
    composes,
  };
}

async function harnessModules(root) {
  const files = [];
  const directories = ["lib", "scripts"].map((directory) => path.join(root, ".harness", directory));
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(absolute);
    }
  }
  return files;
}

async function addTaskSandboxIssues(root, issues) {
  const taskRoot = path.join(root, "tmp", "tasks");
  if (!existsSync(taskRoot)) return;
  for (const task of await readdir(taskRoot, { withFileTypes: true })) {
    if (!task.isDirectory()) continue;
    for (const entry of await readdir(path.join(taskRoot, task.name), { withFileTypes: true })) {
      if (!TASK_DEPENDENCY_DIRECTORIES.has(entry.name)) continue;
      const relative = `tmp/tasks/${task.name}/${entry.name}`;
      addIssue(issues, "warning", "task_dependency_environment", relative, "Task sandbox contains a dependency environment or package cache; use the root dependency environment or user-level tooling, then clean this task directory");
    }
  }
}

export async function addEnvironmentIssues(root, data, issues) {
  const skillRoot = path.join(root, ".agents", "skills");
  if (!existsSync(skillRoot)) addIssue(issues, "error", "skills_missing", ".agents/skills", "Repository Skills directory is missing");
  else if (lstatSync(skillRoot).isSymbolicLink()) addIssue(issues, "error", "skills_symlink", ".agents/skills", "Cross-platform template requires a real Skills directory, not a symlink");
  else {
    const entries = await readdir(skillRoot, { withFileTypes: true });
    const skillEntries = entries.filter((item) => item.isDirectory() && existsSync(path.join(skillRoot, item.name, "SKILL.md")));
    const count = skillEntries.length;
    if (count < 10) addIssue(issues, "warning", "skills_incomplete", ".agents/skills", `Expected at least 10 PM Skills, found ${count}`);
    const skillMeta = new Map();
    for (const entry of skillEntries) {
      const relative = `.agents/skills/${entry.name}/SKILL.md`;
      const meta = skillFrontmatter(await readFile(path.join(skillRoot, entry.name, "SKILL.md"), "utf8"));
      skillMeta.set(entry.name, meta);
      if (meta.name !== entry.name) addIssue(issues, "error", "skill_name_mismatch", relative, `Skill frontmatter name must match directory: ${entry.name}`);
      if (!meta.description) addIssue(issues, "error", "skill_description_missing", relative, "Skill description is required for routing");
      if (!SKILL_KINDS.has(meta.kind)) addIssue(issues, "error", "skill_kind_invalid", relative, "Skill metadata.kind must be router, workflow, or capability");
      if (!meta.domain) addIssue(issues, "error", "skill_domain_missing", relative, "Skill metadata.domain is required for routing");
    }
    for (const entry of skillEntries) {
      const relative = `.agents/skills/${entry.name}/SKILL.md`;
      const meta = skillMeta.get(entry.name);
      if (meta.kind === "capability" && meta.owner && !skillMeta.has(meta.owner)) addIssue(issues, "error", "skill_owner_missing", relative, `Capability owner does not exist: ${meta.owner}`);
      for (const composed of meta.composes) if (!skillMeta.has(composed)) addIssue(issues, "error", "skill_composes_missing", relative, `Composed skill does not exist: ${composed}`);
    }
  }

  for (const absolute of await harnessModules(root)) {
    const content = await readFile(absolute, "utf8");
    const lineCount = content.split("\n").length - Number(content.endsWith("\n"));
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (lineCount > 500) addIssue(issues, "error", "harness_module_too_large", relative, `Harness module has ${lineCount} lines; split it to at most 500`);
  }

  await addTaskSandboxIssues(root, issues);

  const currentPath = path.join(root, "memory/current.md");
  try {
    const current = await readFile(currentPath, "utf8");
    if (Buffer.byteLength(current) > Number(data.config.memory_current_max_bytes || 4096)) addIssue(issues, "warning", "current_memory_too_large", "memory/current.md", "Current memory exceeds the configured context budget");
    for (const label of ["当前重点", "待确认", "下一步"]) if (!current.includes(label)) addIssue(issues, "warning", "current_memory_section_missing", "memory/current.md", `Current memory is missing ${label}`);
    if (data.project.initialized && !/最近更新：\d{4}-\d{2}-\d{2}T/.test(current)) addIssue(issues, "warning", "current_memory_update_missing", "memory/current.md", "Initialized project memory needs an ISO recent-update timestamp");
    const updatedAt = current.match(/最近更新：(\d{4}-\d{2}-\d{2}T\S+)/)?.[1];
    if (data.project.initialized && updatedAt && (ageInDays(updatedAt) ?? 0) > Number(data.config.memory_current_stale_days || 14)) addIssue(issues, "warning", "current_memory_stale", "memory/current.md", `Current memory has not been refreshed for more than ${data.config.memory_current_stale_days || 14} days`);
  } catch {
    addIssue(issues, "error", "current_memory_missing", "memory/current.md", "Current memory file is missing");
  }

  // 偏好只查条数与退役字段一致性，刻意不查过期：长期偏好没有"过期"语义，
  // 过期类告警会逼着 agent 为消警告而编造记忆。
  const preferences = data.preferences?.preferences || [];
  const activePreferences = preferences.filter((item) => item.status === "active");
  const preferenceBudget = Number(data.config.max_active_preferences || 40);
  if (activePreferences.length > preferenceBudget) {
    addIssue(issues, "warning", "preferences_over_budget", "memory/preferences.json", `${activePreferences.length} active preferences exceed the configured budget of ${preferenceBudget}; merge overlapping entries or retire ones that no longer apply`);
  }
  for (const item of preferences) {
    if (item.status === "retired" && (!item.retired_at || !item.retire_reason)) {
      addIssue(issues, "error", "preference_retirement_incomplete", "memory/preferences.json", `${item.id} is retired without a retirement time and reason`);
    }
    if (item.status === "active" && (item.retired_at || item.retire_reason)) {
      addIssue(issues, "error", "preference_active_with_retirement", "memory/preferences.json", `${item.id} is active but carries retirement fields`);
    }
  }

  const statusPath = path.join(root, "project", "status.md");
  try {
    const status = await readFile(statusPath, "utf8");
    if (Buffer.byteLength(status) > Number(data.config.status_max_bytes || 8192)) addIssue(issues, "warning", "project_status_too_large", "project/status.md", "Project status exceeds the configured summary budget");
  } catch {
    addIssue(issues, "error", "project_status_missing", "project/status.md", "Project status file is missing");
  }

}
