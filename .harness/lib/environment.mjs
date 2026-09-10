import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ageInDays } from "./helpers.mjs";

function addIssue(issues, level, code, relativePath, message) {
  issues.push({ level, code, path: relativePath, message });
}

const SKILL_KINDS = new Set(["router", "workflow", "capability"]);

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

function gitTrackedFiles(root) {
  try {
    if (execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "true") return null;
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean);
  } catch {
    return null;
  }
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

  const tracked = gitTrackedFiles(root);
  if (!tracked) return;
  for (const file of tracked) {
    if ((data.config.archive_roots || []).some((prefix) => file === prefix || file.startsWith(`${prefix}/`)) && !file.endsWith(".gitkeep")) addIssue(issues, "error", "archive_tracked", file, "Archived or generated material must not be tracked by Git");
    const base = path.basename(file);
    if (base === ".env" || base.startsWith(".env.") && base !== ".env.example" || /\.(pem|key)$/i.test(base)) addIssue(issues, "error", "secret_file_tracked", file, "Potential credential file is tracked by Git");
    try {
      const info = await stat(path.join(root, file));
      if (info.isSymbolicLink()) addIssue(issues, "error", "symlink_tracked", file, "Cross-platform template must not track symlinks");
      if (info.isFile() && info.size > Number(data.config.large_tracked_file_mb || 25) * 1024 * 1024) addIssue(issues, "warning", "large_tracked_file", file, `Tracked file exceeds ${data.config.large_tracked_file_mb || 25} MB`);
    } catch {}
  }
}
