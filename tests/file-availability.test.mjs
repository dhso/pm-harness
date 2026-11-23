import assert from "node:assert/strict";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compensateLastOperation, lintWorkspace, maintainWorkspace, readJson, rebuildWorkspace, recordOperation } from "../.harness/lib/core.mjs";
import { SCHEMA_VERSION } from "../.harness/lib/model.mjs";
import { createTestWorkspace } from "./support/workspace.mjs";

let sequence = 0;
function operation(type, payload, extra = {}) {
  return { schema_version: SCHEMA_VERSION, operation_id: `OP-files-${++sequence}`, type, actor: { kind: "agent" }, reason: `test ${type}`, source_ids: [], payload, ...extra };
}

async function workspace(t) {
  const root = await createTestWorkspace({ prefix: "pm-harness-files-" });
  t.after(() => rm(root, { recursive: true, force: true }));
  await recordOperation(root, operation("project.initialize", { name: "File availability", objective: "Keep unrelated work available", timezone: "Asia/Hong_Kong", success_criteria: ["Safe writes"] }));
  return root;
}

async function deliverable(root, file = "门店每日金额模板_v1.xlsx") {
  const relative = `deliverables/current/${file}`;
  await writeFile(path.join(root, relative), "Isolated file-existence fixture\n");
  const result = await recordOperation(root, operation("deliverable.upsert", { title: file, type: "report", format: path.extname(file).slice(1), version: "v1", path: relative, audience: "Team", purpose: "Review" }));
  return result.deliverable;
}

async function wiki(root, file = "context.md") {
  const result = await recordOperation(root, operation("wiki.register", { title: file, path: `knowledge/wiki/${file}`, content: "# Context\n", source_ids: [], related_ids: [] }));
  return result.wiki;
}

async function assertRejected(promise, code) {
  await assert.rejects(promise, (error) => {
    const details = JSON.parse(error.message);
    assert.equal(details.code, "workspace_validation_failed");
    assert.ok(details.issues.some((item) => item.code === code && item.level === "error"), JSON.stringify(details));
    return true;
  });
}

const memoryContent = "# 当前工作记忆\n\n- 当前重点：核实缺失文件\n- 待确认：交付物恢复情况\n- 下一步：从原件或备份恢复\n";

test("missing deliverable and Wiki files allow unrelated summaries, preferences and activity with visible warnings", async (t) => {
  const root = await workspace(t);
  const missingDeliverable = await deliverable(root);
  const missingWiki = await wiki(root);
  await unlink(path.join(root, missingDeliverable.path));
  await unlink(path.join(root, missingWiki.path));
  const metadata = await readJson(root, "deliverables/index.json");
  await unlink(path.join(root, "memory/current.md"));
  const request = operation("memory.current.update", { content: memoryContent });
  const beforeLog = await readFile(path.join(root, "governance/change-log.json"), "utf8");
  const preview = await recordOperation(root, request, { dryRun: true });
  assert.equal(preview.committed, false);
  assert.ok(preview.warnings.some((item) => item.code === "deliverable_missing"));
  assert.equal(await readFile(path.join(root, "governance/change-log.json"), "utf8"), beforeLog);
  await assert.rejects(readFile(path.join(root, "memory/current.md")), { code: "ENOENT" });

  const saved = await recordOperation(root, request);
  assert.equal(await readFile(path.join(root, "memory/current.md"), "utf8"), memoryContent);
  assert.deepEqual(saved.warnings.map((item) => item.code).sort(), ["deliverable_missing", "wiki_page_missing"]);
  assert.ok(saved.warnings.every((item) => item.level === "warning" && item.scope === "outside_operation" && item.fix));
  const repeated = await recordOperation(root, request);
  assert.equal(repeated.idempotent, true);
  // 重试沿用原提交的计数，仍表明缺失文件存在；不重放样本，明细交给 lint。
  assert.deepEqual(saved.warning_summary.by_code, { deliverable_missing: 1, wiki_page_missing: 1 });
  assert.deepEqual(repeated.warning_summary.by_code, saved.warning_summary.by_code);
  assert.equal(repeated.warning_summary.total, saved.warning_summary.total);
  assert.equal(repeated.warnings, undefined);
  assert.match(repeated.warning_summary.fix, /lint/);
  // The warning does not interfere with transactional compensation either.
  await compensateLastOperation(root, saved.operation_id, { confirmedByUserAt: new Date().toISOString() });
  await assert.rejects(readFile(path.join(root, "memory/current.md")), { code: "ENOENT" });

  const workflow = await recordOperation(root, operation("workflow.apply", { kind: "summary-sync", operations: [
    { type: "status.update", payload: { content: "# 项目状态\n\n文件待恢复。\n" } },
    { type: "memory.current.update", payload: { content: memoryContent } },
    { type: "memory.preference.upsert", payload: { scope: "document", text: "报告用中文" } },
    { type: "activity.record", payload: { action: "核实文件缺失", outcome: "等待恢复原件", related_ids: [missingDeliverable.id, missingWiki.id] } },
  ] }));
  assert.equal(workflow.ok, true);
  assert.deepEqual(await readJson(root, "deliverables/index.json"), metadata);
  await unlink(path.join(root, "memory/preferences.md"));
  await rebuildWorkspace(root);
  assert.match(await readFile(path.join(root, "memory/preferences.md"), "utf8"), /报告用中文/);
  for (const fast of [true, false]) {
    const lint = await lintWorkspace(root, { fast });
    assert.equal(lint.ok, false);
    assert.deepEqual(lint.issues.filter((item) => item.level === "error").map((item) => item.code).sort(), ["deliverable_missing", "wiki_page_missing"]);
  }
  const maintained = await maintainWorkspace(root);
  assert.equal(maintained.ok, false);
  assert.equal(maintained.stopped_before_changes, false);
});

test("many missing files keep responses and audit records bounded while lint lists every one", async (t) => {
  const root = await workspace(t);
  const total = 12;
  const items = [];
  for (let index = 0; index < total; index += 1) items.push(await deliverable(root, `bulk-${index}.md`));
  for (const item of items) await unlink(path.join(root, item.path));
  const saved = await recordOperation(root, operation("memory.current.update", { content: memoryContent }));
  assert.equal(saved.warning_summary.total, total);
  assert.equal(saved.warning_summary.omitted, saved.warning_summary.total - saved.warnings.length);
  assert.ok(saved.warnings.length < total);
  assert.match(saved.warning_summary.fix, /lint/);
  const recorded = (await readJson(root, "governance/change-log.json")).operations.find((item) => item.operation_id === saved.operation_id);
  assert.equal(recorded.result.warnings, undefined);
  assert.equal(recorded.result.warning_summary.total, total);
  const lint = await lintWorkspace(root, { fast: true });
  assert.equal(lint.issues.filter((item) => item.code === "deliverable_missing").length, total);
});

test("file checks isolate records in the same store and still reject affected or newly missing files atomically", async (t) => {
  const root = await workspace(t);
  const missing = await deliverable(root);
  const available = await deliverable(root, "available.md");
  const missingWiki = await wiki(root);
  await unlink(path.join(root, missing.path));
  await unlink(path.join(root, missingWiki.path));
  const otherDelivery = await recordOperation(root, operation("deliverable.transition", { id: available.id, status: "drafting" }));
  assert.ok(otherDelivery.warnings.some((item) => item.record_id === missing.id));
  await wiki(root, "available.md");

  for (const request of [
    operation("deliverable.transition", { id: missing.id, status: "drafting" }),
    operation("deliverable.upsert", { id: missing.id }),
    operation("deliverable.upsert", { title: "New missing file", type: "report", format: "md", version: "v1", path: "deliverables/current/absent.md", audience: "Team", purpose: "Review" }),
    operation("workflow.apply", { kind: "atomic-update", operations: [
      { type: "memory.current.update", payload: { content: memoryContent } },
      { type: "deliverable.transition", payload: { id: missing.id, status: "drafting" } },
    ] }),
  ]) {
    const before = await Promise.all(["memory/current.md", "deliverables/index.json", "governance/change-log.json"].map((relative) => readFile(path.join(root, relative), "utf8")));
    for (const dryRun of [true, false]) await assertRejected(recordOperation(root, request, { dryRun }), "deliverable_missing");
    const after = await Promise.all(["memory/current.md", "deliverables/index.json", "governance/change-log.json"].map((relative) => readFile(path.join(root, relative), "utf8")));
    assert.deepEqual(after, before);
  }
  await assert.rejects(recordOperation(root, operation("wiki.register", { id: missingWiki.id, title: "Still missing" })), /wiki.register requires content/);
  // A successor implicitly modifies its predecessor, which must not escape the scope.
  await assertRejected(recordOperation(root, operation("wiki.register", { title: "Successor", path: "knowledge/wiki/successor.md", content: "# New context\n", supersedes_id: missingWiki.id })), "wiki_page_missing");
  // A pending Wiki body satisfies the check in the same transaction.
  await recordOperation(root, operation("wiki.register", { id: missingWiki.id, content: "# Restored from supplied content\n" }));
  assert.match(await readFile(path.join(root, missingWiki.path), "utf8"), /Restored/);
});

test("missing files do not excuse invalid paths, references or missing authoritative stores", async (t) => {
  const root = await workspace(t);
  const missing = await deliverable(root);
  await unlink(path.join(root, missing.path));
  await assertRejected(recordOperation(root, operation("activity.record", { action: "Bad reference", outcome: "Reject", related_ids: ["TASK-999"] })), "missing_reference");

  const original = await readJson(root, "deliverables/index.json");
  await writeFile(path.join(root, "deliverables/index.json"), JSON.stringify({ ...original, deliverables: [{ ...original.deliverables[0], path: "../outside.md" }] }));
  await assertRejected(recordOperation(root, operation("memory.current.update", { content: memoryContent })), "invalid_deliverable_path");
  await writeFile(path.join(root, "deliverables/index.json"), JSON.stringify(original));

  await unlink(path.join(root, "memory/preferences.json"));
  await assert.rejects(recordOperation(root, operation("memory.current.update", { content: memoryContent })), (error) => JSON.parse(error.message).code === "store_missing");
});

test("scope calculation and dry-run tolerate a newly added optional field", async (t) => {
  const root = await workspace(t);
  const missing = await deliverable(root);
  await unlink(path.join(root, missing.path));
  const proposed = await recordOperation(root, operation("rule.propose", { title: "Review recipients", manual_reason: "Confirmed retrospective", proposed_rule: "Review recipients before sending", scope: "communication", expected_benefit: "Fewer mistakes", possible_side_effects: "One check", evaluation_metric: "Misaddressed messages", review_at: "2099-12-31" }));
  const request = operation("rule.reject", { id: proposed.proposal.id, reason: "Use the existing process" }, { approval: { confirmed_by_user_at: new Date().toISOString() } });
  const preview = await recordOperation(root, request, { dryRun: true });
  const change = preview.changes.find((item) => item.id === proposed.proposal.id);
  assert.equal(change.before.disposition_reason, null);
  assert.equal(change.after.disposition_reason, request.payload.reason);
  assert.equal((await readJson(root, "governance/proposals.json")).proposals[0].status, "proposed");
  const rejected = await recordOperation(root, request);
  assert.equal(rejected.proposal.status, "rejected");
  assert.ok(rejected.warnings.some((item) => item.code === "deliverable_missing"));
});

test("missing approved deliverables block delivery and acceptance while unrelated memory can record recovery work", async (t) => {
  const root = await workspace(t);
  const confirmedAt = new Date().toISOString();
  const approver = (await recordOperation(root, operation("stakeholder.upsert", { name: "Sponsor", role: "Sponsor", approval_scopes: ["deliverable", "acceptance"] }, { approval: { confirmed_by_user_at: confirmedAt } }))).stakeholder;
  const item = await deliverable(root);
  const approval = { approved_by_id: approver.id, approved_at: confirmedAt, confirmed_by_user_at: confirmedAt };
  await recordOperation(root, operation("deliverable.transition", { id: item.id, status: "drafting" }));
  await recordOperation(root, operation("deliverable.transition", { id: item.id, status: "review" }));
  const content = await readFile(path.join(root, item.path));
  await unlink(path.join(root, item.path));
  await assert.rejects(recordOperation(root, operation("deliverable.transition", { id: item.id, status: "approved" }, { approval })), /deliverable_file_required/);
  await writeFile(path.join(root, item.path), content);
  await recordOperation(root, operation("deliverable.transition", { id: item.id, status: "approved" }, { approval }));
  await unlink(path.join(root, item.path));
  await recordOperation(root, operation("memory.current.update", { content: memoryContent }));
  await assertRejected(recordOperation(root, operation("deliverable.transition", { id: item.id, status: "delivered" })), "deliverable_missing");
  await writeFile(path.join(root, item.path), content);
  await recordOperation(root, operation("deliverable.transition", { id: item.id, status: "delivered" }));
  await unlink(path.join(root, item.path));
  const acceptanceAt = new Date().toISOString();
  await assertRejected(recordOperation(root, operation("deliverable.transition", { id: item.id, status: "accepted", acceptance_evidence: "Sponsor confirmation" }, { approval: { ...approval, approved_at: acceptanceAt, confirmed_by_user_at: acceptanceAt } })), "deliverable_missing");
});
