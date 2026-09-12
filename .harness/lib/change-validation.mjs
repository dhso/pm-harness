import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertTransition, digestValue, isPlainObject } from "./model.mjs";
import { digestChangeIntent } from "./helpers.mjs";

const APPROVED_REQUIREMENT_STATUSES = new Set(["approved", "implemented", "validated"]);
const CONTROLLED_FIELDS = Object.freeze({
  objective: ["objective"],
  scope: ["scope_in", "scope_out", "success_criteria", "constraints"],
  budget: ["budget"],
  schedule_baseline: ["baseline_start", "baseline_end"],
  requirement: ["title", "description", "acceptance_criteria", "status", "superseded_by_id"],
  decision: ["title", "description", "rationale", "superseded_by_id"],
  deliverable: ["title", "type", "format", "version", "path", "content_sha256", "audience", "purpose", "requirement_ids", "source_ids", "due_at", "acceptance_criteria", "reviewers", "status", "superseded_by_id"],
  acceptance: ["status", "acceptance_evidence"],
});

function recordsForScope(data, scope) {
  if (scope === "objective" || scope === "scope" || scope === "budget") return [{ ...data.project, _kind: "project" }];
  if (scope === "schedule_baseline") return [...(data.schedule.tasks || []), ...(data.schedule.milestones || [])].map((item) => ({ ...item, _kind: "task" }));
  if (scope === "requirement") return (data.requirements.requirements || []).map((item) => ({ ...item, _kind: "requirement" }));
  if (scope === "decision") return (data.registers.decisions || []).map((item) => ({ ...item, _kind: "decision" }));
  if (scope === "deliverable" || scope === "acceptance") return (data.deliverables.deliverables || []).map((item) => ({ ...item, _kind: "deliverable" }));
  return [];
}

function compareProvidedFields(actual, expected, fields) {
  return fields.every((field) => !(field in expected) || digestChangeIntent({ [field]: actual?.[field] ?? null }) === digestChangeIntent({ [field]: expected[field] ?? null }));
}

export function requirementReplacementSnapshot(candidate) {
  return { title: candidate.title, description: candidate.description, acceptance_criteria: candidate.acceptance_criteria, ...(candidate.owner != null ? { owner: candidate.owner } : {}) };
}

function replacementMatchesCandidate(candidate, replacement) {
  const snapshot = { ...replacement };
  delete snapshot.id;
  if (snapshot.owner == null && candidate.owner == null) delete snapshot.owner;
  return digestChangeIntent(snapshot) === digestChangeIntent(requirementReplacementSnapshot(candidate));
}

function matchingCandidate(data, predecessor, replacement) {
  return (data.requirements.requirements || []).find((item) =>
    item.supersedes_id === predecessor.id
    && ["candidate", "proposed"].includes(item.status)
    && replacementMatchesCandidate(item, replacement));
}

export function validateChangeProposal(data, { approvalScope, targetIds, changeItems }) {
  const records = new Map(recordsForScope(data, approvalScope).map((item) => [item.id, item]));
  for (const id of targetIds) {
    const target = records.get(id);
    if (!target) throw new Error(JSON.stringify({ code: "change_request_target_missing", approval_scope: approvalScope, target_id: id, fix: "先创建并登记目标对象，再提交变更请求" }));
    if (approvalScope === "requirement" && ["superseded", "rejected"].includes(target.status)) {
      throw new Error(JSON.stringify({ code: "change_request_terminal_target", target_id: id, status: target.status, fix: "不能再修改已替代或已拒绝的需求；请以当前有效需求创建新的候选版本" }));
    }
    const item = changeItems.find((candidate) => candidate.target_id === id);
    const controlledFields = CONTROLLED_FIELDS[approvalScope] || [];
    if (item?.before && !compareProvidedFields(target, item.before, controlledFields)) {
      throw new Error(JSON.stringify({ code: "change_request_before_snapshot_mismatch", target_id: id, fix: "before 必须完整反映目标当前受控字段；请重新读取目标后创建提案" }));
    }
    if (item?.after?.status && item.after.status !== target.status) {
      assertTransition(target._kind, target.status, item.after.status, id);
    }
    if (approvalScope === "requirement" && APPROVED_REQUIREMENT_STATUSES.has(target.status)) {
      const replacement = item?.after?.replacement;
      if (!isPlainObject(replacement) || item.after.status !== "superseded" || !item.after.superseded_by_id) {
        throw new Error(JSON.stringify({ code: "replacement_candidate_required", target_id: id, fix: "已批准需求必须先创建 supersedes_id 指向该目标的 candidate，再在 after 中提供完整 replacement 快照" }));
      }
      const candidate = matchingCandidate(data, target, replacement);
      if (!candidate) {
        throw new Error(JSON.stringify({ code: "replacement_candidate_snapshot_mismatch", target_id: id, fix: "先创建内容与 replacement 完全一致、状态为 candidate 或 proposed 的替代需求，再提交提案" }));
      }
      if (item.after.superseded_by_id !== candidate.id) {
        throw new Error(JSON.stringify({ code: "replacement_candidate_target_mismatch", target_id: id, replacement_id: item.after.superseded_by_id, fix: `after.superseded_by_id 必须引用候选替代 ${candidate.id}` }));
      }
      const replacementWithoutId = { ...replacement };
      if ("id" in replacementWithoutId && replacementWithoutId.id !== candidate.id) {
        throw new Error(JSON.stringify({ code: "replacement_candidate_target_mismatch", target_id: id, replacement_id: replacementWithoutId.id, fix: `replacement.id 必须引用候选替代 ${candidate.id}` }));
      }
      delete replacementWithoutId.id;
      if (replacementWithoutId.owner == null && candidate.owner == null) delete replacementWithoutId.owner;
      if (digestChangeIntent(replacementWithoutId) !== digestChangeIntent(requirementReplacementSnapshot(candidate))) {
        throw new Error(JSON.stringify({ code: "replacement_candidate_snapshot_mismatch", target_id: id, fix: "after.replacement 必须与候选需求的 title、description、acceptance_criteria 完全一致" }));
      }
    }
  }
}

export function findDuplicateDraft(data, candidate, { excludeId = null } = {}) {
  const normalizedItems = (items) => [...items].sort((left, right) => left.target_id.localeCompare(right.target_id));
  // 自由文本和证据来源可以追加或换一种说法；唯一性只由业务范围、目标和精确结构化改动决定。
  const fingerprint = digestChangeIntent({
    approval_scope: candidate.approval_scope,
    target_ids: [...candidate.target_ids].sort(),
    change_items: normalizedItems(candidate.change_items),
  });
  return (data.requirements.change_requests || []).find((item) => item.id !== excludeId && ["proposed", "impact_review", "approved"].includes(item.status) && digestChangeIntent({
    approval_scope: item.approval_scope,
    target_ids: [...item.target_ids].sort(),
    change_items: normalizedItems(item.change_items || []),
  }) === fingerprint);
}

export async function syncRequirementReplacement(root, data, predecessor, replacement, now) {
  const changedTasks = [];
  const ownerChangedTasks = [];
  for (const collection of ["tasks", "milestones"]) {
    for (const task of data.schedule[collection] || []) {
      if (!Array.isArray(task.requirement_ids) || !task.requirement_ids.includes(predecessor.id)) continue;
      task.requirement_ids = [...new Set(task.requirement_ids.map((id) => id === predecessor.id ? replacement.id : id))];
      if (replacement.owner != null && task.owner !== replacement.owner) {
        task.owner = replacement.owner;
        ownerChangedTasks.push(task.id);
      }
      task.updated_at = now;
      changedTasks.push(task.id);
    }
  }
  const entries = [];
  if (changedTasks.length || predecessor.status === "superseded") {
    const oldTitle = predecessor.title;
    const newTitle = replacement.title;
    const statusPath = path.join(root, "project/status.md");
    const memoryPath = path.join(root, "memory/current.md");
    const [status, memory] = await Promise.all([readFile(statusPath, "utf8"), readFile(memoryPath, "utf8")]);
    const taskSummary = changedTasks.length ? `关联任务已切换到新需求（${changedTasks.join("、")}）` : "当前没有关联任务";
    const ownerSummary = ownerChangedTasks.length ? `任务负责人已同步（${ownerChangedTasks.join("、")}）` : "任务负责人未改动";
    const summary = `需求“${oldTitle}”已由“${newTitle}”替代，${taskSummary}，${ownerSummary}。`;
    const statusContent = status.includes("## 已生效的需求变更")
      ? `${status.trimEnd()}\n- ${summary}\n`
      : `${status.trimEnd()}\n\n## 已生效的需求变更\n\n- ${summary}\n`;
    entries.push({ path: "project/status.md", content: statusContent });
    let updatedMemory = memory.replace(/^- 已生效变更：.*$/m, `- 已生效变更：${oldTitle} → ${newTitle}；${changedTasks.length ? "关联任务已同步" : "暂无关联任务"}；${ownerChangedTasks.length ? "负责人已同步" : "负责人未改动"}`);
    updatedMemory = updatedMemory.replace(/- 最近更新：.*\n?/, `- 最近更新：${now}\n`);
    entries.push({ path: "memory/current.md", content: updatedMemory.includes("已生效变更") ? updatedMemory : `${updatedMemory.trimEnd()}\n- 已生效变更：${oldTitle} → ${newTitle}；${changedTasks.length ? "关联任务已同步" : "暂无关联任务"}；${ownerChangedTasks.length ? "负责人已同步" : "负责人未改动"}\n` });
  }
  return { changedTasks, entries };
}
