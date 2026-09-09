import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const STATUS = {
  project: new Set(["uninitialized", "active", "on_hold", "completed", "cancelled"]),
  task: new Set(["not_started", "in_progress", "blocked", "done", "cancelled"]),
  requirement: new Set(["candidate", "proposed", "approved", "implemented", "validated", "superseded", "rejected"]),
  change: new Set(["proposed", "impact_review", "approved", "rejected", "implemented"]),
  register: new Set(["open", "monitoring", "mitigated", "resolved", "accepted", "closed"]),
  deliverable: new Set(["requested", "drafting", "review", "approved", "delivered", "accepted", "superseded", "cancelled"]),
  inbox: new Set(["new", "triaged", "needs_confirmation", "applied", "archived", "rejected"]),
  observation: new Set(["open", "resolved", "dismissed"]),
  proposal: new Set(["proposed", "approved", "active", "rejected", "retired"]),
};

const SOURCE_TYPES = new Set(["email", "email_screenshot", "chat", "chat_screenshot", "daily_note", "office_document", "text_document", "external_connector", "other"]);
const INBOX_CLASSIFICATIONS = new Set(["fact", "feedback", "request", "decision", "commitment", "action", "risk", "issue", "question", "assumption"]);
const ARCHIVE_AVAILABILITY = new Set(["local", "missing", "external", "deleted"]);

const ID_PATTERNS = {
  milestones: /^MS-\d{3,}$/,
  tasks: /^TASK-\d{3,}$/,
  requirements: /^REQ-\d{3,}$/,
  change_requests: /^CR-\d{3,}$/,
  risks: /^RISK-\d{3,}$/,
  issues: /^ISSUE-\d{3,}$/,
  decisions: /^DEC-\d{3,}$/,
  sources: /^SRC-\d{3,}$/,
  items: /^INB-\d{3,}$/,
  deliverables: /^DEL-\d{3,}$/,
  observations: /^OBS-\d{3,}$/,
  proposals: /^RULE-\d{3,}$/,
  files: /^ARC-\d{3,}$/,
};

const JSON_FILES = [
  ".harness/config.json",
  "project/project.json",
  "project/schedule.json",
  "project/requirements.json",
  "project/registers.json",
  "knowledge/sources.json",
  "knowledge/inbox.json",
  "memory/observations.json",
  "deliverables/index.json",
  "governance/proposals.json",
  "governance/change-log.json",
  "archive/index.json",
];

export async function readJson(root, relativePath) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  return JSON.parse(source);
}

export async function writeJsonAtomic(root, relativePath, value) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

function text(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function escapeTable(value) {
  return text(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function mermaidText(value) {
  return text(value).replace(/[,:#;]/g, " ").replace(/\s+/g, " ").trim();
}

function isDate(value) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isTimestamp(value) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function daysBetween(left, right) {
  if (!left || !right || !isDate(left) || !isDate(right)) return null;
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

function taskVisualStatus(task) {
  if (task.status === "done") return "done";
  if (task.status === "in_progress") return "active";
  if (task.status === "blocked") return "crit";
  return "";
}

export function renderGantt(project, schedule) {
  const lines = [
    "# 项目甘特图",
    "",
    "> 由 `project/schedule.json` 自动生成。请勿直接编辑本文件。基线、预测和实际时间分别保留。",
    "",
  ];

  const milestones = Array.isArray(schedule.milestones) ? schedule.milestones : [];
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
  const chartMilestones = milestones.filter((item) => item.forecast_end || item.baseline_end);
  const chartTasks = tasks.filter((item) => (item.forecast_start || item.baseline_start) && (item.forecast_end || item.baseline_end));

  if (chartMilestones.length || chartTasks.length) {
    lines.push("```mermaid", "gantt", `    title ${mermaidText(project.name || "项目计划")}`, "    dateFormat YYYY-MM-DD", "    axisFormat %m-%d");
    if (chartMilestones.length) {
      lines.push("    section 里程碑");
      for (const item of chartMilestones) {
        const date = item.forecast_end || item.baseline_end;
        const marker = item.status === "done" ? "done, " : item.status === "blocked" ? "crit, " : "";
        lines.push(`    ${mermaidText(item.title)} :${marker}milestone, ${item.id.toLowerCase().replaceAll("-", "_")}, ${date}, 0d`);
      }
    }
    if (chartTasks.length) {
      lines.push("    section 任务");
      for (const item of chartTasks) {
        const start = item.forecast_start || item.baseline_start;
        const end = item.forecast_end || item.baseline_end;
        const state = taskVisualStatus(item);
        const prefix = state ? `${state}, ` : "";
        lines.push(`    ${mermaidText(item.title)} :${prefix}${item.id.toLowerCase().replaceAll("-", "_")}, ${start}, ${end}`);
      }
    }
    lines.push("```", "");
  } else {
    lines.push("暂无可绘制的日期计划。", "");
  }

  lines.push("## 时间对照", "", "| ID | 事项 | 状态 | 基线 | 当前预测 | 实际 | 偏差 | 下一步 |", "|---|---|---|---|---|---|---|---|");
  for (const item of [...milestones, ...tasks]) {
    const baseline = item.baseline_start || item.baseline_end ? `${text(item.baseline_start)} → ${text(item.baseline_end)}` : "—";
    const forecast = item.forecast_start || item.forecast_end ? `${text(item.forecast_start)} → ${text(item.forecast_end)}` : "—";
    const actual = item.actual_start || item.actual_end ? `${text(item.actual_start)} → ${text(item.actual_end)}` : "—";
    const slip = daysBetween(item.baseline_end, item.forecast_end);
    const variance = slip === null ? "—" : slip > 0 ? `延期 ${slip} 天` : slip < 0 ? `提前 ${Math.abs(slip)} 天` : "无偏差";
    lines.push(`| ${escapeTable(item.id)} | ${escapeTable(item.title)} | ${escapeTable(item.status)} | ${escapeTable(baseline)} | ${escapeTable(forecast)} | ${escapeTable(actual)} | ${escapeTable(variance)} | ${escapeTable(item.next_action)} |`);
  }
  if (!milestones.length && !tasks.length) lines.push("| — | 尚无计划 | — | — | — | — | — | — |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderDeliverablesIndex(index) {
  const items = Array.isArray(index.deliverables) ? index.deliverables : [];
  const lines = [
    "# 交付物索引",
    "",
    "> 由 `deliverables/index.json` 自动生成。文件生成、交付和验收是不同状态。",
    "",
    "| ID | 交付物 | 类型 | 版本 | 状态 | 计划完成 | 实际完成 | 已交付 | 已验收 | 当前文件 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const item of items) {
    lines.push(`| ${escapeTable(item.id)} | ${escapeTable(item.title)} | ${escapeTable(item.type)} | ${escapeTable(item.version)} | ${escapeTable(item.status)} | ${escapeTable(item.due_at)} | ${escapeTable(item.completed_at)} | ${escapeTable(item.delivered_at)} | ${escapeTable(item.accepted_at)} | ${escapeTable(item.path)} |`);
  }
  if (!items.length) lines.push("| — | 暂无交付物 | — | — | — | — | — | — | — | — |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function walkMarkdown(directory, base = directory) {
  if (!existsSync(directory)) return [];
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await walkMarkdown(absolute, base));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(path.relative(base, absolute));
  }
  return results.sort();
}

export async function renderKnowledgeIndex(root) {
  const wikiRoot = path.join(root, "knowledge/wiki");
  const files = (await walkMarkdown(wikiRoot)).filter((item) => item !== ".gitkeep");
  const lines = ["# 知识库索引", "", "> 自动生成；先查索引，再按任务需要读取相关页面。", ""];
  for (const relative of files) {
    const content = await readFile(path.join(wikiRoot, relative), "utf8");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relative, ".md");
    lines.push(`- [${heading}](wiki/${relative.split(path.sep).join("/")})`);
  }
  if (!files.length) lines.push("暂无 Wiki 页面。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function rebuildWorkspace(root) {
  const [project, schedule, deliverables] = await Promise.all([
    readJson(root, "project/project.json"),
    readJson(root, "project/schedule.json"),
    readJson(root, "deliverables/index.json"),
  ]);
  const outputs = {
    "project/gantt.md": renderGantt(project, schedule),
    "deliverables/index.md": renderDeliverablesIndex(deliverables),
    "knowledge/index.md": await renderKnowledgeIndex(root),
  };
  for (const [relative, content] of Object.entries(outputs)) {
    await writeFile(path.join(root, relative), content, "utf8");
  }
  return { updated: Object.keys(outputs) };
}

function addIssue(issues, level, code, relativePath, message) {
  issues.push({ level, code, path: relativePath, message });
}

function validateStatus(issues, value, allowed, relativePath, id) {
  if (!allowed.has(value)) addIssue(issues, "error", "invalid_status", relativePath, `${id || "record"} has unsupported status: ${text(value)}`);
}

function validateDatePair(issues, record, startField, endField, relativePath) {
  const start = record[startField];
  const end = record[endField];
  if (!isDate(start)) addIssue(issues, "error", "invalid_date", relativePath, `${record.id}: ${startField} must be YYYY-MM-DD`);
  if (!isDate(end)) addIssue(issues, "error", "invalid_date", relativePath, `${record.id}: ${endField} must be YYYY-MM-DD`);
  if (start && end && isDate(start) && isDate(end) && start > end) addIssue(issues, "error", "date_order", relativePath, `${record.id}: ${startField} is after ${endField}`);
}

function dependencyCycles(tasks) {
  const graph = new Map(tasks.map((item) => [item.id, (item.dependency_ids || []).filter((id) => tasks.some((candidate) => candidate.id === id))]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function visit(id, stack) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycles.push([...stack.slice(start), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) || []) visit(dependency, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of graph.keys()) visit(id, []);
  return cycles;
}

function ageInDays(value, now = new Date()) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return Math.floor((now.valueOf() - Date.parse(value)) / 86_400_000);
}

function validateCollection(issues, allIds, records, collectionName, relativePath, statusSet) {
  const pattern = ID_PATTERNS[collectionName];
  for (const record of records || []) {
    if (!record || typeof record !== "object") {
      addIssue(issues, "error", "invalid_record", relativePath, `${collectionName} contains a non-object record`);
      continue;
    }
    if (!pattern?.test(record.id || "")) addIssue(issues, "error", "invalid_id", relativePath, `${collectionName} has invalid ID: ${text(record.id)}`);
    if (record.id && allIds.has(record.id)) addIssue(issues, "error", "duplicate_id", relativePath, `Duplicate ID: ${record.id}`);
    if (record.id) allIds.add(record.id);
    if (!record.title && !record.summary && !record.description) addIssue(issues, "warning", "missing_title", relativePath, `${record.id || collectionName} has no title or summary`);
    if (statusSet) validateStatus(issues, record.status, statusSet, relativePath, record.id);
  }
}

function validateReferences(issues, record, field, allowedIds, relativePath) {
  if (record[field] === undefined) return;
  if (!Array.isArray(record[field])) {
    addIssue(issues, "error", "invalid_reference_list", relativePath, `${record.id}: ${field} must be an array`);
    return;
  }
  for (const id of record[field]) {
    if (!allowedIds.has(id)) addIssue(issues, "error", "missing_reference", relativePath, `${record.id}: ${field} references missing ID ${text(id)}`);
  }
}

function gitTrackedFiles(root) {
  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (inside !== "true") return null;
    const output = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function checkGitPolicy(root, config, issues) {
  const tracked = gitTrackedFiles(root);
  if (!tracked) return;
  const archiveRoots = config.archive_roots || [];
  for (const file of tracked) {
    if (archiveRoots.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)) && !file.endsWith(".gitkeep")) {
      addIssue(issues, "error", "archive_tracked", file, "Archived or generated material must not be tracked by Git");
    }
    const base = path.basename(file);
    if (base === ".env" || base.startsWith(".env.") && base !== ".env.example" || /\.(pem|key)$/i.test(base)) {
      addIssue(issues, "error", "secret_file_tracked", file, "Potential credential file is tracked by Git");
    }
    try {
      const info = await stat(path.join(root, file));
      const maxBytes = Number(config.large_tracked_file_mb || 25) * 1024 * 1024;
      if (info.isFile() && info.size > maxBytes) addIssue(issues, "warning", "large_tracked_file", file, `Tracked file is larger than ${config.large_tracked_file_mb || 25} MB`);
    } catch {
      addIssue(issues, "warning", "tracked_file_missing", file, "Git tracks this path, but it is missing from the working tree");
    }
  }
}

async function checkGenerated(root, expected, relativePath, issues) {
  try {
    const actual = await readFile(path.join(root, relativePath), "utf8");
    if (actual !== expected) addIssue(issues, "error", "generated_drift", relativePath, "Generated view is out of sync; run rebuild");
  } catch {
    addIssue(issues, "error", "generated_missing", relativePath, "Generated view is missing; run rebuild");
  }
}

export async function lintWorkspace(root) {
  const issues = [];
  const data = {};
  for (const relative of JSON_FILES) {
    try {
      data[relative] = await readJson(root, relative);
      if (data[relative].schema_version !== 1) addIssue(issues, "error", "schema_version", relative, "schema_version must be 1");
    } catch (error) {
      addIssue(issues, "error", "invalid_json", relative, error.message);
    }
  }
  if (issues.some((issue) => issue.code === "invalid_json")) return summarizeIssues(issues);

  const project = data["project/project.json"];
  const schedule = data["project/schedule.json"];
  const requirements = data["project/requirements.json"];
  const registers = data["project/registers.json"];
  const sources = data["knowledge/sources.json"];
  const inbox = data["knowledge/inbox.json"];
  const deliverables = data["deliverables/index.json"];
  const observations = data["memory/observations.json"];
  const proposals = data["governance/proposals.json"];
  const archive = data["archive/index.json"];
  const config = data[".harness/config.json"];
  const allIds = new Set();

  validateStatus(issues, project.status, STATUS.project, "project/project.json", project.id || "project");
  if (project.initialized) {
    for (const field of ["id", "name", "timezone", "objective"]) if (!project[field]) addIssue(issues, "error", "missing_project_field", "project/project.json", `Initialized project is missing ${field}`);
    if (!Array.isArray(project.success_criteria) || !project.success_criteria.length) addIssue(issues, "warning", "missing_success_criteria", "project/project.json", "Initialized project has no success criteria");
  }

  validateCollection(issues, allIds, schedule.milestones, "milestones", "project/schedule.json", STATUS.task);
  validateCollection(issues, allIds, schedule.tasks, "tasks", "project/schedule.json", STATUS.task);
  validateCollection(issues, allIds, requirements.requirements, "requirements", "project/requirements.json", STATUS.requirement);
  validateCollection(issues, allIds, requirements.change_requests, "change_requests", "project/requirements.json", STATUS.change);
  validateCollection(issues, allIds, registers.risks, "risks", "project/registers.json", STATUS.register);
  validateCollection(issues, allIds, registers.issues, "issues", "project/registers.json", STATUS.register);
  validateCollection(issues, allIds, registers.decisions, "decisions", "project/registers.json");
  validateCollection(issues, allIds, sources.sources, "sources", "knowledge/sources.json");
  validateCollection(issues, allIds, inbox.items, "items", "knowledge/inbox.json", STATUS.inbox);
  validateCollection(issues, allIds, deliverables.deliverables, "deliverables", "deliverables/index.json", STATUS.deliverable);
  validateCollection(issues, allIds, observations.observations, "observations", "memory/observations.json", STATUS.observation);
  validateCollection(issues, allIds, proposals.proposals, "proposals", "governance/proposals.json", STATUS.proposal);

  const knownIds = new Set(allIds);
  if (project.id) knownIds.add(project.id);
  const requirementIds = new Set((requirements.requirements || []).map((item) => item.id));
  const deliverableIds = new Set((deliverables.deliverables || []).map((item) => item.id));
  const sourceIds = new Set((sources.sources || []).map((item) => item.id));
  const observationIds = new Set((observations.observations || []).map((item) => item.id));
  const proposalIds = new Set((proposals.proposals || []).map((item) => item.id));

  const taskIds = new Set((schedule.tasks || []).map((item) => item.id));
  for (const record of [...(schedule.milestones || []), ...(schedule.tasks || [])]) {
    validateDatePair(issues, record, "baseline_start", "baseline_end", "project/schedule.json");
    validateDatePair(issues, record, "forecast_start", "forecast_end", "project/schedule.json");
    validateDatePair(issues, record, "actual_start", "actual_end", "project/schedule.json");
    if (record.progress !== undefined && (!Number.isFinite(record.progress) || record.progress < 0 || record.progress > 100)) addIssue(issues, "error", "invalid_progress", "project/schedule.json", `${record.id}: progress must be 0-100`);
    for (const dependency of record.dependency_ids || []) {
      if (dependency === record.id) addIssue(issues, "error", "self_dependency", "project/schedule.json", `${record.id} depends on itself`);
      else if (!taskIds.has(dependency)) addIssue(issues, "error", "missing_dependency", "project/schedule.json", `${record.id} references missing task ${dependency}`);
    }
    if (record.status === "done" && !record.actual_end) addIssue(issues, "warning", "done_without_actual", "project/schedule.json", `${record.id} is done without actual_end`);
    if (record.baseline_end && record.forecast_end && record.forecast_end > record.baseline_end) addIssue(issues, "info", "schedule_variance", "project/schedule.json", `${record.id} forecast is later than baseline`);
    const staleDays = ageInDays(record.updated_at);
    if (!["done", "cancelled"].includes(record.status) && staleDays !== null && staleDays > Number(config.stale_task_days || 7)) addIssue(issues, "info", "stale_schedule_item", "project/schedule.json", `${record.id} has not been updated for ${staleDays} days`);
    validateReferences(issues, record, "requirement_ids", requirementIds, "project/schedule.json");
    validateReferences(issues, record, "deliverable_ids", deliverableIds, "project/schedule.json");
    validateReferences(issues, record, "source_ids", sourceIds, "project/schedule.json");
  }
  for (const cycle of dependencyCycles(schedule.tasks || [])) addIssue(issues, "error", "dependency_cycle", "project/schedule.json", `Task dependency cycle: ${cycle.join(" -> ")}`);

  for (const source of sources.sources || []) {
    if (!SOURCE_TYPES.has(source.type)) addIssue(issues, "error", "invalid_source_type", "knowledge/sources.json", `${source.id} has unsupported type: ${text(source.type)}`);
    if (!isTimestamp(source.captured_at)) addIssue(issues, "error", "invalid_timestamp", "knowledge/sources.json", `${source.id} captured_at must be an ISO timestamp`);
    if (source.source_time && !isDate(source.source_time) && !isTimestamp(source.source_time)) addIssue(issues, "warning", "ambiguous_source_time", "knowledge/sources.json", `${source.id} source_time is not an ISO date or timestamp`);
    if (source.archived_path && !existsSync(path.join(root, source.archived_path))) addIssue(issues, "info", "archive_unavailable", "knowledge/sources.json", `${source.id} archive is not present on this machine: ${source.archived_path}`);
  }
  for (const item of inbox.items || []) {
    if (item.source_id && !sourceIds.has(item.source_id)) addIssue(issues, "error", "missing_source", "knowledge/inbox.json", `${item.id} references missing source ${item.source_id}`);
    if (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) addIssue(issues, "error", "invalid_confidence", "knowledge/inbox.json", `${item.id}: confidence must be 0-1`);
    if (!INBOX_CLASSIFICATIONS.has(item.classification)) addIssue(issues, "error", "invalid_classification", "knowledge/inbox.json", `${item.id} has unsupported classification: ${text(item.classification)}`);
    validateReferences(issues, item, "related_ids", knownIds, "knowledge/inbox.json");
  }

  const archiveIds = new Set();
  for (const item of archive.files || []) {
    if (!ID_PATTERNS.files.test(item.id || "")) addIssue(issues, "error", "invalid_id", "archive/index.json", `files has invalid ID: ${text(item.id)}`);
    if (item.id && archiveIds.has(item.id)) addIssue(issues, "error", "duplicate_id", "archive/index.json", `Duplicate archive ID: ${item.id}`);
    if (item.id) archiveIds.add(item.id);
    if (!item.logical_id || !knownIds.has(item.logical_id)) addIssue(issues, "warning", "archive_logical_id_missing", "archive/index.json", `${item.id || "Archive entry"} references missing logical ID: ${text(item.logical_id)}`);
    if (item.source_id && !sourceIds.has(item.source_id)) addIssue(issues, "warning", "archive_source_missing", "archive/index.json", `${item.id || "Archive entry"} references missing source: ${text(item.source_id)}`);
    if (!item.original_name || !item.type || !item.archived_at || !item.reason || !item.availability) addIssue(issues, "error", "archive_metadata_missing", "archive/index.json", `${item.id || "Archive entry"} is missing required archive metadata`);
    if (item.sha256 && !/^[a-f0-9]{64}$/i.test(item.sha256)) addIssue(issues, "error", "invalid_hash", "archive/index.json", `${item.id || "Archive entry"} has an invalid SHA-256`);
    if (!isTimestamp(item.archived_at)) addIssue(issues, "error", "invalid_timestamp", "archive/index.json", `${item.id || "Archive entry"} archived_at must be an ISO timestamp`);
    if (!ARCHIVE_AVAILABILITY.has(item.availability)) addIssue(issues, "error", "invalid_archive_availability", "archive/index.json", `${item.id || "Archive entry"} has unsupported availability: ${text(item.availability)}`);
    if (item.path && !existsSync(path.join(root, item.path))) addIssue(issues, "info", "archive_unavailable", "archive/index.json", `Archive file is not present on this machine: ${item.path}`);
  }

  for (const source of sources.sources || []) {
    if (!source.archived_path) continue;
    const matchingArchive = (archive.files || []).find((item) => item.source_id === source.id && item.path === source.archived_path);
    if (!matchingArchive) addIssue(issues, "error", "archive_index_missing", "knowledge/sources.json", `${source.id} has archived_path but no matching archive index entry`);
    else if (source.sha256 && matchingArchive.sha256 !== source.sha256) addIssue(issues, "error", "archive_hash_mismatch", "archive/index.json", `${matchingArchive.id} hash differs from source ${source.id}`);
  }

  const observationGroups = new Map();
  for (const item of observations.observations || []) {
    if (!item.pattern_key) addIssue(issues, "error", "observation_pattern_missing", "memory/observations.json", `${item.id} has no pattern_key`);
    if (item.proposal_id && !proposalIds.has(item.proposal_id)) addIssue(issues, "error", "missing_proposal", "memory/observations.json", `${item.id} references missing proposal ${item.proposal_id}`);
    if (item.proposal_id) {
      const proposal = (proposals.proposals || []).find((candidate) => candidate.id === item.proposal_id);
      if (proposal && !(proposal.observation_ids || []).includes(item.id)) addIssue(issues, "warning", "proposal_link_asymmetric", "memory/observations.json", `${item.id} links ${item.proposal_id}, but the proposal does not link back`);
    }
    if (!item.pattern_key || ["resolved", "dismissed"].includes(item.status)) continue;
    if (!observationGroups.has(item.pattern_key)) observationGroups.set(item.pattern_key, []);
    observationGroups.get(item.pattern_key).push(item);
  }
  for (const [pattern, items] of observationGroups) {
    const unproposed = items.filter((item) => !item.proposal_id);
    if (unproposed.length >= Number(config.repeat_observation_threshold || 2)) addIssue(issues, "info", "rule_candidate", "memory/observations.json", `${unproposed.length} observations share pattern '${pattern}'; review a scoped rule proposal`);
  }

  for (const item of proposals.proposals || []) {
    for (const field of ["proposed_rule", "scope", "expected_benefit", "possible_side_effects", "evaluation_metric", "review_at"]) {
      if (!item[field]) addIssue(issues, "error", "proposal_metadata_missing", "governance/proposals.json", `${item.id} is missing ${field}`);
    }
    validateReferences(issues, item, "observation_ids", observationIds, "governance/proposals.json");
    if (item.review_at && !isDate(item.review_at) && !isTimestamp(item.review_at)) addIssue(issues, "error", "invalid_review_time", "governance/proposals.json", `${item.id} review_at must be an ISO date or timestamp`);
    if (["approved", "active"].includes(item.status) && !item.approved_by) addIssue(issues, "error", "approval_missing", "governance/proposals.json", `${item.id} is ${item.status} without approved_by`);
    if (item.status === "active" && !item.effective_at) addIssue(issues, "error", "effective_time_missing", "governance/proposals.json", `${item.id} is active without effective_at`);
    for (const observationId of item.observation_ids || []) {
      const observation = (observations.observations || []).find((candidate) => candidate.id === observationId);
      if (observation && observation.proposal_id !== item.id) addIssue(issues, "warning", "proposal_link_asymmetric", "governance/proposals.json", `${item.id} links ${observationId}, but the observation does not link back`);
    }
  }

  for (const item of requirements.change_requests || []) {
    if (["approved", "implemented"].includes(item.status) && !item.approved_by) addIssue(issues, "error", "approval_missing", "project/requirements.json", `${item.id} is ${item.status} without approved_by`);
    if (["approved", "implemented"].includes(item.status) && !item.effective_at) addIssue(issues, "warning", "effective_time_missing", "project/requirements.json", `${item.id} has no effective_at`);
  }

  for (const item of deliverables.deliverables || []) {
    for (const field of ["format", "audience", "purpose"]) {
      if (!item[field]) addIssue(issues, "warning", "deliverable_metadata_missing", "deliverables/index.json", `${item.id} is missing ${field}`);
    }
    if (item.path && !existsSync(path.join(root, item.path))) {
      const level = ["superseded", "cancelled"].includes(item.status) ? "info" : "error";
      addIssue(issues, level, "deliverable_missing", "deliverables/index.json", `${item.id} path does not exist: ${item.path}`);
    }
    if (["approved", "delivered", "accepted"].includes(item.status) && !item.approved_at) addIssue(issues, "warning", "approval_time_missing", "deliverables/index.json", `${item.id} is ${item.status} without approved_at`);
    if (["delivered", "accepted"].includes(item.status) && !item.delivered_at) addIssue(issues, "error", "delivery_time_missing", "deliverables/index.json", `${item.id} is ${item.status} without delivered_at`);
    if (item.status === "accepted" && !item.accepted_at) addIssue(issues, "error", "acceptance_time_missing", "deliverables/index.json", `${item.id} is accepted without accepted_at`);
    if (item.supersedes_id && (!deliverableIds.has(item.supersedes_id) || item.supersedes_id === item.id)) addIssue(issues, "error", "invalid_supersession", "deliverables/index.json", `${item.id} has invalid supersedes_id: ${text(item.supersedes_id)}`);
    if (item.superseded_by_id && (!deliverableIds.has(item.superseded_by_id) || item.superseded_by_id === item.id)) addIssue(issues, "error", "invalid_supersession", "deliverables/index.json", `${item.id} has invalid superseded_by_id: ${text(item.superseded_by_id)}`);
    if (item.status === "superseded" && !item.superseded_by_id) addIssue(issues, "error", "supersession_missing", "deliverables/index.json", `${item.id} is superseded without superseded_by_id`);
    if (item.superseded_by_id && deliverableIds.has(item.superseded_by_id)) {
      const replacement = (deliverables.deliverables || []).find((candidate) => candidate.id === item.superseded_by_id);
      if (replacement?.supersedes_id !== item.id) addIssue(issues, "warning", "supersession_link_asymmetric", "deliverables/index.json", `${item.id} links replacement ${item.superseded_by_id}, but the replacement does not link back`);
    }
    validateReferences(issues, item, "requirement_ids", requirementIds, "deliverables/index.json");
    validateReferences(issues, item, "source_ids", sourceIds, "deliverables/index.json");
  }

  const expectedGantt = renderGantt(project, schedule);
  const expectedDeliverables = renderDeliverablesIndex(deliverables);
  const expectedKnowledge = await renderKnowledgeIndex(root);
  await checkGenerated(root, expectedGantt, "project/gantt.md", issues);
  await checkGenerated(root, expectedDeliverables, "deliverables/index.md", issues);
  await checkGenerated(root, expectedKnowledge, "knowledge/index.md", issues);

  const skillRoot = path.join(root, ".agents/skills");
  if (!existsSync(skillRoot)) addIssue(issues, "error", "skills_missing", ".agents/skills", "ChatGPT skill discovery path is missing");
  else {
    const linkInfo = lstatSync(skillRoot);
    if (linkInfo.isSymbolicLink()) {
      const target = path.resolve(path.dirname(skillRoot), readlinkSync(skillRoot));
      if (!existsSync(target)) addIssue(issues, "error", "skills_link_broken", ".agents/skills", "Skill source symlink is broken");
    }
    const skillNames = await readdir(skillRoot, { withFileTypes: true });
    const count = skillNames.filter((entry) => existsSync(path.join(skillRoot, entry.name, "SKILL.md"))).length;
    if (count < 10) addIssue(issues, "warning", "skills_incomplete", ".agents/skills", `Expected at least 10 PM skills, found ${count}`);
  }

  await checkGitPolicy(root, config, issues);
  return summarizeIssues(issues);
}

function summarizeIssues(issues) {
  return {
    ok: !issues.some((issue) => issue.level === "error"),
    counts: {
      error: issues.filter((issue) => issue.level === "error").length,
      warning: issues.filter((issue) => issue.level === "warning").length,
      info: issues.filter((issue) => issue.level === "info").length,
    },
    issues,
  };
}

function localDate(timezone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function buildDailyBrief(root, now = new Date()) {
  const [config, project, schedule, registers, requirements, inbox, deliverables] = await Promise.all([
    readJson(root, ".harness/config.json"),
    readJson(root, "project/project.json"),
    readJson(root, "project/schedule.json"),
    readJson(root, "project/registers.json"),
    readJson(root, "project/requirements.json"),
    readJson(root, "knowledge/inbox.json"),
    readJson(root, "deliverables/index.json"),
  ]);
  const today = localDate(project.timezone || config.default_timezone, now);
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + Number(config.upcoming_days || 7));
  const windowEnd = until.toISOString().slice(0, 10);
  const active = (schedule.tasks || []).filter((item) => !["done", "cancelled"].includes(item.status));
  const targetDate = (item) => item.forecast_end || item.baseline_end || item.due_at || null;
  const byDate = (left, right) => text(targetDate(left)).localeCompare(text(targetDate(right)));
  return {
    project: project.name || null,
    timezone: project.timezone || config.default_timezone,
    today,
    window_end: windowEnd,
    overdue: active.filter((item) => targetDate(item) && targetDate(item) < today).sort(byDate),
    blocked: active.filter((item) => item.status === "blocked").sort(byDate),
    stale: active.filter((item) => {
      const age = ageInDays(item.updated_at, now);
      return age !== null && age > Number(config.stale_task_days || 7);
    }).sort(byDate),
    due_soon: active.filter((item) => targetDate(item) && targetDate(item) >= today && targetDate(item) <= windowEnd).sort(byDate),
    milestones: (schedule.milestones || []).filter((item) => !["done", "cancelled"].includes(item.status) && targetDate(item) && targetDate(item) <= windowEnd).sort(byDate),
    open_risks: (registers.risks || []).filter((item) => ["open", "monitoring"].includes(item.status)),
    open_issues: (registers.issues || []).filter((item) => !["resolved", "closed"].includes(item.status)),
    pending_changes: (requirements.change_requests || []).filter((item) => ["proposed", "impact_review"].includes(item.status)),
    inbox: (inbox.items || []).filter((item) => ["new", "needs_confirmation"].includes(item.status)),
    due_deliverables: (deliverables.deliverables || []).filter((item) => !["accepted", "superseded", "cancelled"].includes(item.status) && item.due_at && item.due_at <= windowEnd).sort(byDate),
    awaiting_delivery_or_acceptance: (deliverables.deliverables || []).filter((item) => ["approved", "delivered"].includes(item.status)).sort(byDate),
    unscheduled_work: active.filter((item) => !targetDate(item)),
  };
}

function nextId(records, prefix) {
  const maximum = records.reduce((max, item) => {
    const match = String(item.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(3, "0")}`;
}

function safeFilename(value) {
  return String(value || "source").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

export async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export async function registerSource(root, payload) {
  const sources = await readJson(root, "knowledge/sources.json");
  const inbox = await readJson(root, "knowledge/inbox.json");
  const archive = await readJson(root, "archive/index.json");
  const capturedAt = payload.captured_at || new Date().toISOString();
  let archivedPath = payload.archived_path || null;
  let hash = payload.sha256 || null;
  if (payload.raw_path) {
    const sourcePath = path.resolve(root, payload.raw_path);
    hash = await sha256File(sourcePath);
  }
  const duplicate = sources.sources.find((existing) =>
    hash && existing.sha256 === hash ||
    payload.source_locator && existing.source_locator === payload.source_locator ||
    payload.thread_id && payload.source_time && existing.thread_id === payload.thread_id && existing.source_time === payload.source_time && existing.sender === (payload.sender || null),
  );
  if (duplicate) return { duplicate_of: duplicate.id, source: duplicate, inbox_items_added: 0 };

  const id = payload.id || nextId(sources.sources, "SRC");
  if (payload.raw_path) {
    const sourcePath = path.resolve(root, payload.raw_path);
    const year = (payload.source_time || capturedAt).slice(0, 4);
    const destinationRelative = path.join("archive/files", year, `${id}-${safeFilename(path.basename(sourcePath))}`);
    const destination = path.join(root, destinationRelative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
    archivedPath = destinationRelative.split(path.sep).join("/");
    archive.files.push({
      id: nextId(archive.files, "ARC"),
      logical_id: id,
      source_id: id,
      path: archivedPath,
      original_name: path.basename(sourcePath),
      type: payload.type,
      sha256: hash,
      archived_at: capturedAt,
      reason: payload.archive_reason || "source_evidence",
      superseded_by: null,
      availability: "local",
    });
  }
  const source = {
    id,
    type: payload.type,
    title: payload.title || id,
    channel: payload.channel || null,
    sender: payload.sender || null,
    thread_id: payload.thread_id || null,
    source_time: payload.source_time || null,
    captured_at: capturedAt,
    archived_path: archivedPath,
    source_locator: payload.source_locator || null,
    sha256: hash,
    summary: payload.summary || "",
  };
  sources.sources.push(source);
  for (const candidate of payload.items || []) {
    inbox.items.push({
      id: candidate.id || nextId(inbox.items, "INB"),
      source_id: id,
      classification: candidate.classification,
      summary: candidate.summary,
      quote: candidate.quote || null,
      confidence: candidate.confidence ?? null,
      authority: candidate.authority || "unknown",
      related_ids: candidate.related_ids || [],
      proposed_action: candidate.proposed_action || null,
      status: candidate.status || "new",
      created_at: capturedAt,
    });
  }
  await Promise.all([
    writeJsonAtomic(root, "knowledge/sources.json", sources),
    writeJsonAtomic(root, "knowledge/inbox.json", inbox),
    writeJsonAtomic(root, "archive/index.json", archive),
  ]);
  return { source, inbox_items_added: (payload.items || []).length };
}

export async function appendActivityEntry(root, payload) {
  const project = await readJson(root, "project/project.json");
  const timestamp = payload.timestamp || new Date().toISOString();
  const timezone = project.timezone || "UTC";
  const date = localDate(timezone, new Date(timestamp));
  const relative = `activity/${date}.md`;
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  if (!existsSync(target)) await writeFile(target, `# ${date} 活动记录\n\n`, "utf8");
  const ids = (payload.related_ids || []).join("、") || "—";
  const entry = [
    `- ${timestamp}`,
    `  - 完成：${payload.action || "—"}`,
    `  - 关联：${ids}`,
    `  - 结果：${payload.outcome || "—"}`,
    `  - 证据：${payload.evidence || "—"}`,
    `  - 下一步：${payload.next_action || "—"}`,
    "",
  ].join("\n");
  await appendFile(target, entry, "utf8");
  return { path: relative, timestamp };
}

export async function initializeProject(root, payload) {
  const current = await readJson(root, "project/project.json");
  if (current.initialized && !payload.force) throw new Error("Project is already initialized; create a change proposal instead of overwriting it");
  for (const required of ["name", "objective", "timezone"]) if (!payload[required]) throw new Error(`Missing required initialization field: ${required}`);
  const now = new Date().toISOString();
  const project = {
    schema_version: 1,
    initialized: true,
    id: payload.id || "PRJ-001",
    name: payload.name,
    status: payload.status || "active",
    timezone: payload.timezone,
    objective: payload.objective,
    scope_in: payload.scope_in || [],
    scope_out: payload.scope_out || [],
    success_criteria: payload.success_criteria || [],
    constraints: payload.constraints || [],
    stakeholders: payload.stakeholders || [],
    created_at: current.created_at || now,
    updated_at: now,
  };
  await writeJsonAtomic(root, "project/project.json", project);
  await writeFile(path.join(root, "project/status.md"), `# 项目状态：${project.name}\n\n- 状态：${project.status}\n- 当前目标：${project.objective}\n- 最近更新：${now}\n\n## 当前重点\n\n待完善。\n\n## 阻塞与风险\n\n待完善。\n\n## 下一步\n\n建立初始计划和资料索引。\n`, "utf8");
  await writeFile(path.join(root, "memory/current.md"), `# 当前工作记忆\n\n- 当前重点：建立 ${project.name} 的初始计划\n- 待确认：未完成的范围、时间、风险和交付信息\n- 下一步：整理已有资料并建立里程碑\n- 最近更新：${now}\n`, "utf8");
  await rebuildWorkspace(root);
  return project;
}
