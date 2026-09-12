import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { daysBetween, escapeTable, localDate, mermaidText, text } from "./helpers.mjs";
import { readWorkspace } from "./workspace.mjs";
import { commitTransaction, withWorkspaceLock } from "./transaction.mjs";

function taskVisualStatus(task) {
  if (task.status === "done") return "done";
  if (task.status === "in_progress") return "active";
  if (task.status === "blocked") return "crit";
  return "";
}

const STATUS_LABELS = Object.freeze({
  not_started: "未开始",
  in_progress: "进行中",
  blocked: "阻塞",
  done: "完成",
  cancelled: "取消",
});

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
        const state = taskVisualStatus(item);
        lines.push(`    ${mermaidText(item.title)} :${state ? `${state}, ` : ""}${item.id.toLowerCase().replaceAll("-", "_")}, ${item.forecast_start || item.baseline_start}, ${item.forecast_end || item.baseline_end}`);
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
    lines.push(`| ${escapeTable(item.id)} | ${escapeTable(item.title)} | ${escapeTable(STATUS_LABELS[item.status] || item.status)} | ${escapeTable(baseline)} | ${escapeTable(forecast)} | ${escapeTable(actual)} | ${escapeTable(variance)} | ${escapeTable(item.next_action)} |`);
  }
  if (!milestones.length && !tasks.length) lines.push("| — | 尚无计划 | — | — | — | — | — | — |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderDeliverablesIndex(index) {
  const items = Array.isArray(index.deliverables) ? index.deliverables : [];
  const lines = ["# 交付物索引", "", "> 由 `deliverables/index.json` 自动生成。文件生成、批准、交付和验收是不同状态。", "", "| ID | 交付物 | 类型 | 版本 | 状态 | 计划完成 | 实际完成 | 已交付 | 已验收 | 当前文件 |", "|---|---|---|---|---|---|---|---|---|---|"];
  for (const item of items) lines.push(`| ${escapeTable(item.id)} | ${escapeTable(item.title)} | ${escapeTable(item.type)} | ${escapeTable(item.version)} | ${escapeTable(item.status)} | ${escapeTable(item.due_at)} | ${escapeTable(item.completed_at)} | ${escapeTable(item.delivered_at)} | ${escapeTable(item.accepted_at)} | ${escapeTable(item.path)} |`);
  if (!items.length) lines.push("| — | 暂无交付物 | — | — | — | — | — | — | — | — |");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderKnowledgeIndex(catalog) {
  const pages = [...(catalog.pages || [])].filter((item) => item.status === "active").sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
  const lines = ["# 知识库索引", "", "> 由 `knowledge/catalog.json` 自动生成；先查索引，再按任务需要读取相关页面。", ""];
  for (const item of pages) {
    const relative = path.posix.relative("knowledge", item.path.replaceAll("\\", "/"));
    lines.push(`- [${item.title}](${relative}) · ${item.id} · 最近复查：${text(item.last_reviewed_at)}`);
  }
  if (!pages.length) lines.push("暂无 Wiki 页面。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderRules(rules) {
  const active = (rules.rules || []).filter((item) => item.status === "active");
  const lines = ["# 项目级有效规则", "", "> 由 `governance/rules.json` 自动生成。内置安全护栏位于 `AGENTS.md` 和 `.harness/references/`，此处只展示经用户批准的项目级演进规则。", ""];
  active.forEach((item, index) => lines.push(`${index + 1}. **${item.id}**（${item.scope}）：${item.text}`));
  if (!active.length) lines.push("暂无项目级演进规则。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderActivityDay(date, entries) {
  const lines = [`# ${date} 活动记录`, "", "> 由 `activity/log.json` 自动生成，只记录结果、证据和下一步。", ""];
  for (const item of entries) {
    lines.push(`- ${item.occurred_at} · ${item.id}`, `  - 完成：${item.action}`, `  - 关联：${item.related_ids.join("、") || "—"}`, `  - 结果：${item.outcome}`, `  - 证据：${text(item.evidence)}`, `  - 下一步：${text(item.next_action)}`, "");
  }
  return `${lines.join("\n")}\n`;
}

export function renderActivityIndex(activity, timezone) {
  const groups = groupActivities(activity.entries || [], timezone);
  const lines = ["# 活动记录", "", "> 由 `activity/log.json` 自动生成。按日期查看已经发生的项目工作、结果和下一步。", ""];
  for (const [date, entries] of [...groups.entries()].sort(([left], [right]) => right.localeCompare(left))) lines.push(`- [${date}](${date}.md)：${entries.length} 条`);
  if (!groups.size) lines.push("暂无活动记录。");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function groupActivities(entries, timezone) {
  const groups = new Map();
  for (const item of entries) {
    // 缺失或非法 occurred_at 交由 lint 报告为结构化问题；此处跳过，避免渲染视图时抛出。
    if (!item?.occurred_at || Number.isNaN(Date.parse(item.occurred_at))) continue;
    const date = localDate(timezone, new Date(item.occurred_at));
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  }
  for (const items of groups.values()) items.sort((left, right) => left.occurred_at.localeCompare(right.occurred_at));
  return groups;
}

export async function generatedEntries(root, data, { pruneActivity = true } = {}) {
  const timezone = data.project.timezone || data.config.default_timezone || "UTC";
  const groups = groupActivities(data.activity.entries || [], timezone);
  const entries = [
    { path: "project/gantt.md", content: renderGantt(data.project, data.schedule) },
    { path: "deliverables/index.md", content: renderDeliverablesIndex(data.deliverables) },
    { path: "knowledge/index.md", content: renderKnowledgeIndex(data.catalog) },
    { path: "governance/rules.md", content: renderRules(data.rules) },
    { path: "activity/index.md", content: renderActivityIndex(data.activity, timezone) },
  ];
  for (const [date, items] of groups) entries.push({ path: `activity/${date}.md`, content: renderActivityDay(date, items) });
  if (pruneActivity && existsSync(path.join(root, "activity"))) {
    for (const item of await readdir(path.join(root, "activity"), { withFileTypes: true })) {
      if (item.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(item.name) && !groups.has(item.name.slice(0, 10))) entries.push({ path: `activity/${item.name}`, delete: true });
    }
  }
  return entries;
}

export async function rebuildWorkspace(root, options = {}) {
  if (!options.lockHeld) return withWorkspaceLock(root, () => rebuildWorkspace(root, { ...options, lockHeld: true }));
  const data = await readWorkspace(root);
  const entries = await generatedEntries(root, data);
  const operationId = `OP-rebuild-${Date.now()}`;
  const result = await commitTransaction(root, operationId, entries, { lockHeld: true });
  return { updated: result.committed };
}
