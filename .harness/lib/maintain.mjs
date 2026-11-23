import { addDays, clone, localDate, nextWorkspaceId, validTimezone, validateOrThrow } from "./helpers.mjs";
import { digestValue, validateRecord } from "./model.mjs";
import { STORE_FILES, readStore, readWorkspace } from "./workspace.mjs";
import { lintWorkspace } from "./lint.mjs";
import { rebuildWorkspace, refreshGeneratedViews } from "./views.mjs";
import { workspaceShapeIssues } from "./workspace-shape.mjs";
import { commitTransaction, jsonEntry, withWorkspaceLock } from "./transaction.mjs";
import { captureCompensation } from "./compensation.mjs";

// 带 scope 的问题只影响所指文件、摘要或环境，不影响观察与提案事实；完整 lint 仍保留其严重级别。
const BLOCKING = (item) => item.level === "error" && !item.scope;

function maintenanceToday(data) {
  const configuredTimezone = data.project?.timezone || data.config?.default_timezone || "UTC";
  return localDate(validTimezone(configuredTimezone) ? configuredTimezone : "UTC");
}

function stoppedReport(data, lint, warnings = []) {
  const pending = pendingProposalSummary(data, maintenanceToday(data));
  return { ok: false, proposals_created: [], observations_linked: [], pending_proposals: pending.items, pending_proposals_complete: pending.complete, rule_reviews_due: [], stopped_before_changes: true, warnings, lint };
}

function pendingProposalSummary(data, today) {
  const proposals = data.proposals?.proposals;
  if (!Array.isArray(proposals)) return { items: [], complete: false };
  const complete = proposals.every((item) => validateRecord("proposal", item).length === 0);
  const items = proposals
    .filter((item) => ["proposed", "approved"].includes(item?.status))
    .map((item) => {
      const reviewAt = typeof item.review_at === "string" ? item.review_at : null;
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        pattern_key: item.pattern_key,
        evidence_count: Array.isArray(item.observation_ids) ? item.observation_ids.length : 0,
        manual_reason: item.manual_reason,
        review_at: reviewAt,
        // 提案没有 created_at，所以用它自己排定的复查日期判断是否搁置过久。
        // 非法日期留给 lint 报错；发现结果用 null 表示当前无法判断。
        overdue: reviewAt ? reviewAt.slice(0, 10) <= today : null,
      };
    });
  return { items, complete };
}

export async function maintainWorkspace(root, options = {}) {
  if (!options.lockHeld) return withWorkspaceLock(root, () => maintainWorkspace(root, { ...options, lockHeld: true }));
  let data;
  try { data = await readWorkspace(root); } catch {
    // 缺失的权威 Store 仍阻断写入，但不能同时隐藏其他 Store 中可读取的待处置提案。
    const partial = {};
    for (const key of ["project", "config", "proposals"]) {
      try { partial[key] = await readStore(root, key); } catch { /* 发现范围不完整时保留未知。 */ }
    }
    return stoppedReport(partial, await lintWorkspace(root));
  }
  if (workspaceShapeIssues(data).length) return stoppedReport(data, await lintWorkspace(root));
  const warnings = [];
  try { warnings.push(...(await rebuildWorkspace(root, { lockHeld: true })).warnings); } catch (error) {
    // 校验失败的原因记在警告里，便于排查；完整诊断仍由 lint 给出。
    const cause = (() => { try { return JSON.parse(error.message); } catch { return { message: error.message }; } })();
    return stoppedReport(data, await lintWorkspace(root), [{ level: "warning", code: "rebuild_blocked", path: "workspace", message: `Generated views were not refreshed: ${cause.code || cause.message}`, fix: "Resolve the reported lint errors, then rerun maintain" }]);
  }
  const initialLint = await lintWorkspace(root);
  if (warnings.some((item) => item.cause_code === "transaction_recovery_required") || initialLint.issues.some(BLOCKING)) return stoppedReport(data, initialLint, warnings);
  const today = maintenanceToday(data);
  const beforeState = clone(data);
  const threshold = Number(data.config.repeat_observation_threshold || 2);
  const groups = new Map();
  for (const item of data.observations.observations || []) {
    if (item.status !== "open" || item.proposal_id) continue;
    if (!groups.has(item.pattern_key)) groups.set(item.pattern_key, []);
    groups.get(item.pattern_key).push(item);
  }
  const created = [];
  const linked = [];
  for (const [pattern, items] of groups) {
    if (items.length < threshold) continue;
    const existing = (data.proposals.proposals || []).find((item) => item.pattern_key === pattern && ["proposed", "approved", "active"].includes(item.status));
    if (existing) {
      for (const item of items) {
        item.proposal_id = existing.id;
        if (!existing.observation_ids.includes(item.id)) existing.observation_ids.push(item.id);
        linked.push(item.id);
      }
      continue;
    }
    const proposal = {
      id: nextWorkspaceId(data, data.proposals.proposals, "proposal"),
      title: `减少重复问题：${items.at(-1).title}`,
      status: "proposed",
      observation_ids: items.map((item) => item.id),
      proposed_rule: items.findLast((item) => item.suggested_rule)?.suggested_rule || `处理与“${pattern}”相关的工作时，在收尾前执行针对性检查并记录证据。`,
      scope: `pattern:${pattern}`,
      expected_benefit: `减少“${pattern}”同类问题重复发生`,
      possible_side_effects: "增加一次针对性检查；复查时应确认没有造成不必要流程负担",
      evaluation_metric: `规则生效后同一 pattern_key 的新增观察数量`,
      review_at: addDays(today, Number(data.config.rule_review_days || 30)),
      approved_by: null,
      approved_at: null,
      effective_at: null,
      pattern_key: pattern,
    };
    validateOrThrow("proposal", proposal);
    data.proposals.proposals.push(proposal);
    for (const item of items) {
      item.proposal_id = proposal.id;
      linked.push(item.id);
    }
    created.push(proposal.id);
  }
  if (created.length || linked.length) {
    const operationId = `OP-maintain-${digestValue([...created, ...linked]).slice(0, 12)}`;
    const result = { proposals_created: created, observations_linked: linked };
    const changedStores = new Set(["proposals", "observations"]);
    const compensation = await captureCompensation(root, beforeState, data, changedStores, [], result);
    data.changes.operations ||= [];
    data.changes.operations.push({ operation_id: operationId, type: "maintain.rule-proposals", target_ids: [...new Set([...created, ...linked])], recorded_at: new Date().toISOString(), result, compensation });
    const entries = [jsonEntry(STORE_FILES.proposals, data.proposals), jsonEntry(STORE_FILES.observations, data.observations), jsonEntry(STORE_FILES.changes, data.changes)];
    await commitTransaction(root, operationId, entries, { lockHeld: true });
    warnings.push(...(await refreshGeneratedViews(root, data, { operationId, lockHeld: true })).warnings);
  }
  const lint = created.length || linked.length ? await lintWorkspace(root) : initialLint;
  const refreshed = data;
  const rulesDue = (refreshed.rules.rules || []).filter((item) => item.status === "active" && item.review_at.slice(0, 10) <= today).map((item) => {
    const recurrenceCount = item.pattern_key ? (refreshed.observations.observations || []).filter((observation) => observation.pattern_key === item.pattern_key && observation.created_at >= item.effective_at).length : null;
    return { id: item.id, pattern_key: item.pattern_key, recurrence_count: recurrenceCount, recommendation: recurrenceCount === 0 ? "keep" : recurrenceCount === null ? "review_manually" : recurrenceCount === 1 ? "narrow_or_keep" : "revise_or_retire" };
  });
  // 待处置提案必须有发现入口：否则提案生成后无人问津，长期占着待批准队列。
  // 只报告事实和证据强度，不代替用户决定激活还是驳回。
  const pending = pendingProposalSummary(refreshed, today);
  return { ok: lint.ok && !warnings.length, proposals_created: created, observations_linked: linked, pending_proposals: pending.items, pending_proposals_complete: pending.complete, rule_reviews_due: rulesDue, stopped_before_changes: false, warnings: [...new Map(warnings.map((item) => [JSON.stringify(item), item])).values()], initial_lint: initialLint, lint };
}
