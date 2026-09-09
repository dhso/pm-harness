import { addDays, localDate, validateOrThrow } from "./helpers.mjs";
import { digestValue, nextId } from "./model.mjs";
import { STORE_FILES, readWorkspace } from "./workspace.mjs";
import { lintWorkspace } from "./lint.mjs";
import { generatedEntries, rebuildWorkspace } from "./views.mjs";
import { commitTransaction, jsonEntry } from "./transaction.mjs";

export async function maintainWorkspace(root) {
  await rebuildWorkspace(root);
  const initialLint = await lintWorkspace(root);
  if (!initialLint.ok) return { ok: false, proposals_created: [], observations_linked: [], rule_reviews_due: [], stopped_before_changes: true, lint: initialLint };
  const data = await readWorkspace(root);
  const threshold = Number(data.config.repeat_observation_threshold || 2);
  const today = localDate(data.project.timezone || data.config.default_timezone || "UTC");
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
      id: nextId(data.proposals.proposals, "proposal"),
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
    for (const item of items) item.proposal_id = proposal.id;
    created.push(proposal.id);
  }
  if (created.length || linked.length) {
    const operationId = `OP-maintain-${digestValue([...created, ...linked]).slice(0, 12)}`;
    data.changes.operations ||= [];
    data.changes.operations.push({ operation_id: operationId, type: "maintain.rule-proposals", target_ids: [...created, ...linked], recorded_at: new Date().toISOString(), result: { proposals_created: created, observations_linked: linked } });
    const entries = [jsonEntry(STORE_FILES.proposals, data.proposals), jsonEntry(STORE_FILES.observations, data.observations), jsonEntry(STORE_FILES.changes, data.changes), ...await generatedEntries(root, data)];
    await commitTransaction(root, operationId, entries);
  }
  const lint = await lintWorkspace(root);
  const refreshed = await readWorkspace(root);
  const rulesDue = (refreshed.rules.rules || []).filter((item) => item.status === "active" && item.review_at.slice(0, 10) <= today).map((item) => {
    const recurrenceCount = item.pattern_key ? (refreshed.observations.observations || []).filter((observation) => observation.pattern_key === item.pattern_key && observation.created_at >= item.effective_at).length : null;
    return { id: item.id, pattern_key: item.pattern_key, recurrence_count: recurrenceCount, recommendation: recurrenceCount === 0 ? "keep" : recurrenceCount === null ? "review_manually" : recurrenceCount === 1 ? "narrow_or_keep" : "revise_or_retire" };
  });
  return { ok: lint.ok, proposals_created: created, observations_linked: linked, rule_reviews_due: rulesDue, initial_lint: initialLint, lint };
}
