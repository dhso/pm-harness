import { addDays, ageInDays, localDate, text } from "./helpers.mjs";
import { readWorkspace } from "./workspace.mjs";

function targetDate(item) {
  return item.forecast_end || item.baseline_end || item.due_at || item.response_due || item.next_review || null;
}

function riskScore(item) {
  const score = { low: 1, medium: 2, high: 3 };
  return (score[item.probability] || 0) * (score[item.impact] || 0);
}

export async function buildDailyBrief(root, now = new Date()) {
  const data = await readWorkspace(root);
  const timezone = data.project.timezone || data.config.default_timezone;
  const today = localDate(timezone, now);
  const windowEnd = addDays(today, Number(data.config.upcoming_days || 7));
  const recentStart = addDays(today, -Number(data.config.recent_activity_days || 7));
  const active = (data.schedule.tasks || []).filter((item) => !["done", "cancelled"].includes(item.status));
  const byDate = (left, right) => text(targetDate(left)).localeCompare(text(targetDate(right)));
  const taskById = new Map((data.schedule.tasks || []).map((item) => [item.id, item]));
  const dependencySensitive = active.map((item) => ({ ...item, blocked_by_ids: (item.dependency_ids || []).filter((id) => !["done", "cancelled"].includes(taskById.get(id)?.status)) })).filter((item) => item.blocked_by_ids.length);
  const overdue = active.filter((item) => targetDate(item) && targetDate(item) < today).sort(byDate);
  const blocked = active.filter((item) => item.status === "blocked").sort(byDate);
  const dueSoon = active.filter((item) => targetDate(item) && targetDate(item) >= today && targetDate(item) <= windowEnd).sort(byDate);
  const activeMilestones = (data.schedule.milestones || []).filter((item) => !["done", "cancelled"].includes(item.status));
  const milestones = activeMilestones.filter((item) => targetDate(item) && targetDate(item) <= windowEnd).sort(byDate);
  const urgentMilestones = activeMilestones.filter((item) => item.status === "blocked" || targetDate(item) && targetDate(item) <= today).sort(byDate);
  // 与风险一致，只把仍需跟进的问题视为开放；mitigated、accepted 已有处置，需要时用 query 查看。
  const openIssues = (data.registers.issues || []).filter((item) => ["open", "monitoring"].includes(item.status)).sort((left, right) => Number(left.status !== "open") - Number(right.status !== "open"));
  const pendingChanges = (data.requirements.change_requests || []).filter((item) => ["proposed", "impact_review"].includes(item.status));
  const pendingApprovals = [
    ...pendingChanges.map((item) => ({ kind: "change_request", ...item })),
    ...(data.requirements.requirements || []).filter((item) => item.status === "proposed").map((item) => ({ kind: "requirement", ...item })),
    ...(data.registers.decisions || []).filter((item) => item.status === "proposed").map((item) => ({ kind: "decision", ...item })),
    ...(data.deliverables.deliverables || []).filter((item) => item.status === "review").map((item) => ({ kind: "deliverable", ...item })),
    ...(data.proposals.proposals || []).filter((item) => item.status === "proposed").map((item) => ({ kind: "rule", ...item })),
  ];
  const inbox = (data.inbox.items || []).filter((item) => ["new", "triaged", "needs_confirmation"].includes(item.status));
  const commitments = inbox.filter((item) => item.classification === "commitment");
  const openRisks = (data.registers.risks || []).filter((item) => ["open", "monitoring"].includes(item.status)).sort((left, right) => riskScore(right) - riskScore(left));
  const priorityRisks = openRisks.filter((item) => riskScore(item) >= 6 || item.response_due && item.response_due <= windowEnd || item.next_review && item.next_review <= today);
  const dueDeliverables = (data.deliverables.deliverables || []).filter((item) => !["delivered", "accepted", "superseded", "cancelled"].includes(item.status) && item.due_at && item.due_at <= windowEnd).sort(byDate);
  const rulesDue = (data.rules.rules || []).filter((item) => item.status === "active" && item.review_at.slice(0, 10) <= today).map((item) => ({ ...item, recurrence_count: item.pattern_key ? (data.observations.observations || []).filter((observation) => observation.pattern_key === item.pattern_key && observation.created_at >= item.effective_at).length : null }));
  const knowledgeDue = (data.catalog.pages || []).filter((item) => item.status === "active" && item.review_due_at && item.review_due_at <= today);
  const attentionActions = [];
  const topActions = [];
  const issueActions = [];
  const lanes = { attention: attentionActions, routine: topActions, issue: issueActions };
  const actionIds = new Set();
  // 只有常规行动限三项；紧急事项和未解决问题各自单列且不设上限，避免互相挤占或被截断。
  const addAction = (kind, item, reason, lane = "routine") => {
    if (actionIds.has(item.id) || (lane === "routine" && topActions.length >= 3)) return;
    lanes[lane].push({ kind, id: item.id, title: item.title || item.summary || item.text, reason, target_date: targetDate(item) });
    actionIds.add(item.id);
  };
  // 先收集紧急事项，再收集常规行动，以便跨组去重。
  for (const item of urgentMilestones) addAction("milestone", item, item.status === "blocked" ? "里程碑当前阻塞，需要确认影响和解除措施" : targetDate(item) < today ? `里程碑已超过 ${targetDate(item)}，需要确认恢复安排` : "里程碑今日到期，需要确认完成或后续安排", "attention");
  for (const item of blocked) addAction("blocked_task", item, "当前阻塞，需要先解除才能恢复计划", "attention");
  for (const item of overdue) addAction("overdue_task", item, `已超过 ${targetDate(item)} 的当前预测日期`, "attention");
  for (const item of dueSoon.filter((entry) => targetDate(entry) === today)) addAction("due_soon", item, "任务今日到期，需要确认完成或后续安排", "attention");
  for (const item of priorityRisks) addAction("risk", item, riskScore(item) >= 6 ? "高概率或高影响风险需要响应" : "风险响应或复查日期临近", "attention");
  for (const item of dueDeliverables.filter((entry) => targetDate(entry) <= today)) addAction("deliverable", item, `交付物已到 ${item.due_at} 的交付期限`, "attention");
  for (const item of openIssues) addAction("issue", item, "问题尚未解决，需要确认处理进展和下一步", "issue");
  for (const item of commitments) addAction("commitment", item, "已记录的对外承诺尚未处置");
  for (const item of dependencySensitive) addAction("dependency", item, `仍依赖 ${item.blocked_by_ids.join("、")}`);
  for (const item of milestones) addAction("milestone", item, `里程碑将在近期窗口内于 ${targetDate(item)} 到期`);
  for (const item of dueSoon) addAction("due_soon", item, `将在近期窗口内于 ${targetDate(item)} 到期`);
  for (const item of pendingChanges) addAction("pending_change", item, "变更尚待影响评审或批准");
  for (const item of pendingApprovals) addAction("pending_approval", item, "事项已进入审批队列，等待有效权限确认");
  for (const item of inbox) addAction("inbox", item, "新来源条目尚待确认或应用");
  for (const item of dueDeliverables) addAction("deliverable", item, `交付物将在 ${item.due_at} 前到期`);
  for (const item of rulesDue) addAction("rule_review", item, "项目规则已到复查时间");
  for (const item of knowledgeDue) addAction("knowledge_review", item, "Wiki 内容已到复查时间");
  return {
    project: data.project.name || null,
    timezone,
    today,
    window_end: windowEnd,
    attention_summary: {
      total: attentionActions.length,
      by_kind: attentionActions.reduce((counts, item) => ({ ...counts, [item.kind]: (counts[item.kind] || 0) + 1 }), {}),
    },
    attention_actions: attentionActions,
    top_actions: topActions,
    issue_actions: issueActions,
    overdue,
    blocked,
    dependency_sensitive: dependencySensitive,
    stale: active.filter((item) => (ageInDays(item.updated_at, now) ?? 0) > Number(data.config.stale_task_days || 7)).sort(byDate),
    due_soon: dueSoon,
    milestones,
    open_risks: openRisks,
    priority_risks: priorityRisks,
    open_issues: openIssues,
    pending_changes: pendingChanges,
    pending_approvals: pendingApprovals,
    awaiting_decisions: inbox.filter((item) => ["decision", "question", "commitment"].includes(item.classification) || item.status === "needs_confirmation"),
    inbox,
    due_deliverables: dueDeliverables,
    awaiting_delivery_or_acceptance: (data.deliverables.deliverables || []).filter((item) => ["approved", "delivered"].includes(item.status)).sort(byDate),
    recent_activity: (data.activity.entries || []).filter((item) => localDate(timezone, new Date(item.occurred_at)) >= recentStart).sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)),
    rule_reviews_due: rulesDue,
    knowledge_reviews_due: knowledgeDue,
    unscheduled_work: active.filter((item) => !targetDate(item)),
  };
}
