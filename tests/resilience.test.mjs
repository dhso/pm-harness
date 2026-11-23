import assert from "node:assert/strict";
import { lstat, mkdir, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { appendActivityEntry, initializeProject, lintWorkspace, maintainWorkspace, queryWorkspace, readJson, readWorkspace, rebuildWorkspace, recordOperation, registerSource } from "../.harness/lib/core.mjs";
import { generatedEntries } from "../.harness/lib/views.mjs";
import { commitTransaction } from "../.harness/lib/transaction.mjs";
import { SCHEMA_VERSION } from "../.harness/lib/model.mjs";
import { STORE_FILES } from "../.harness/lib/workspace.mjs";
import { createTestWorkspace } from "./support/workspace.mjs";

let sequence = 0;
function operation(type, payload) {
  return { schema_version: SCHEMA_VERSION, operation_id: `OP-resilience-${++sequence}`, type, actor: { kind: "agent" }, reason: `test ${type}`, source_ids: [], payload };
}

async function workspace(t, initialize = true) {
  const root = await createTestWorkspace({ prefix: "pm-harness-resilience-" });
  t.after(() => rm(root, { recursive: true, force: true }));
  if (initialize) await initializeProject(root, { name: "Resilience", objective: "Preserve confirmed facts", timezone: "Asia/Hong_Kong", success_criteria: ["Safe recovery"] });
  return root;
}

const summary = "# 当前工作记忆\n\n- 当前重点：安全恢复\n- 待确认：原件可用性\n- 下一步：恢复索引\n";
const proposalPayload = { title: "Check recipients", manual_reason: "Confirmed retrospective", proposed_rule: "Check recipients before sending", scope: "communication", expected_benefit: "Fewer mistakes", possible_side_effects: "One check", evaluation_metric: "Misaddressed messages", review_at: "2099-12-31" };
async function repeatedObservations(root) {
  for (const title of ["First", "Second"]) await recordOperation(root, operation("observation.record", { title, pattern_key: "recovery-check", evidence: title }));
}

test("every generated view can be recreated without changing facts or authored summaries", async (t) => {
  const root = await workspace(t);
  await recordOperation(root, operation("activity.record", { action: "Confirmed work", outcome: "Recorded" }));
  await recordOperation(root, operation("memory.preference.upsert", { scope: "document", text: "Use Chinese" }));
  const data = await readWorkspace(root);
  const views = await generatedEntries(root, data);
  const paths = [...Object.values(STORE_FILES), "memory/current.md", "project/status.md"];
  const before = await Promise.all(paths.map((relative) => readFile(path.join(root, relative), "utf8")));
  for (const entry of views) await unlink(path.join(root, entry.path));
  const rebuilt = await rebuildWorkspace(root);
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.updated.length, views.length);
  for (const entry of views) assert.equal(await readFile(path.join(root, entry.path), "utf8"), entry.content);
  assert.deepEqual(await Promise.all(paths.map((relative) => readFile(path.join(root, relative), "utf8"))), before);
});

test("a blocked generated target preserves its contents while facts and explicit summaries commit and retry repairs views", async (t) => {
  const root = await workspace(t);
  const blocked = path.join(root, "project/gantt.md");
  await unlink(blocked);
  await mkdir(blocked);
  await writeFile(path.join(blocked, "keep.txt"), "Preserve this directory\n");
  const request = operation("workflow.apply", { kind: "confirmed-update", operations: [
    { type: "activity.record", payload: { action: "Confirmed work", outcome: "Persist despite blocked view" } },
    { type: "status.update", payload: { content: "# Status\n\nConfirmed work.\n" } },
    { type: "memory.current.update", payload: { content: summary } },
    { type: "memory.preference.upsert", payload: { scope: "document", text: "Use Chinese" } },
  ] });
  const saved = await recordOperation(root, request);
  assert.equal(saved.ok, true);
  assert.ok(saved.warnings.some((item) => item.code === "generated_views_pending" && item.path === "project/gantt.md"));
  assert.equal(await readFile(path.join(root, "memory/current.md"), "utf8"), summary);
  assert.match(await readFile(path.join(root, "project/status.md"), "utf8"), /Confirmed work/);
  assert.match(await readFile(path.join(root, "memory/preferences.md"), "utf8"), /Use Chinese/);
  assert.equal(await readFile(path.join(blocked, "keep.txt"), "utf8"), "Preserve this directory\n");
  const repeated = await recordOperation(root, request);
  assert.equal(repeated.idempotent, true);
  assert.ok(repeated.warnings.some((item) => item.code === "generated_views_pending"));
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
  await rm(blocked, { recursive: true });
  const healed = await recordOperation(root, request);
  assert.equal(healed.idempotent, true);
  assert.equal(healed.warnings, undefined);
  assert.ok((await lstat(blocked)).isFile());
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
});

test("a derived transaction failure rolls back views while confirmed facts stay committed", async (t) => {
  const root = await workspace(t);
  const oldIndex = await readFile(path.join(root, "activity/index.md"), "utf8");
  const request = operation("workflow.apply", { kind: "confirmed-update", operations: [
    { type: "activity.record", payload: { action: "Confirmed work", outcome: "Keep this fact" } },
    { type: "memory.current.update", payload: { content: summary } },
  ] });
  const saved = await recordOperation(root, request, { viewFailAfter: 1 });
  assert.equal(saved.ok, true);
  assert.ok(saved.warnings.some((item) => item.code === "generated_views_pending"));
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
  assert.equal(await readFile(path.join(root, "memory/current.md"), "utf8"), summary);
  assert.equal(await readFile(path.join(root, "activity/index.md"), "utf8"), oldIndex);
  assert.ok((await lintWorkspace(root)).issues.some((item) => ["generated_missing", "generated_drift"].includes(item.code)));
  assert.equal((await recordOperation(root, request)).idempotent, true);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("generated symlinks and explicit directory targets are preserved instead of being replaced", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "keep.txt"), "Keep original\n");
  await unlink(path.join(root, "project/gantt.md"));
  await symlink("../keep.txt", path.join(root, "project/gantt.md"));
  const saved = await recordOperation(root, operation("activity.record", { action: "Continue", outcome: "Safe view warning" }));
  assert.ok(saved.warnings.some((item) => item.path === "project/gantt.md"));
  assert.equal(await readFile(path.join(root, "keep.txt"), "utf8"), "Keep original\n");
  assert.ok((await lstat(path.join(root, "project/gantt.md"))).isSymbolicLink());
  await mkdir(path.join(root, "manual.md"));
  await writeFile(path.join(root, "manual.md/keep.txt"), "Keep directory\n");
  await assert.rejects(commitTransaction(root, "OP-resilience-directory", [{ path: "manual.md", content: "Replacement" }]), /transaction_target_not_file/);
  assert.equal(await readFile(path.join(root, "manual.md/keep.txt"), "utf8"), "Keep directory\n");
});

test("missing summaries and local archives do not block records or safe maintenance proposals", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "raw.txt"), "Confirmed source text\n");
  const source = await recordOperation(root, operation("source.register", { type: "daily_note", title: "Original", raw_path: "raw.txt", summary: "Confirmed source" }));
  await unlink(path.join(root, source.source.archived_path));
  await unlink(path.join(root, "memory/current.md"));
  await unlink(path.join(root, "project/status.md"));
  await repeatedObservations(root);
  assert.equal((await queryWorkspace(root, { target: "source", id: source.source.id })).record.id, source.source.id);
  const result = await maintainWorkspace(root);
  assert.equal(result.stopped_before_changes, false);
  assert.equal(result.proposals_created.length, 1);
  for (const code of ["current_memory_missing", "project_status_missing", "archive_unavailable"]) assert.ok(result.lint.issues.some((item) => item.code === code));
  await assert.rejects(readFile(path.join(root, "memory/current.md")), { code: "ENOENT" });
  assert.equal((await readJson(root, "archive/index.json")).files[0].availability, "local");
  await recordOperation(root, operation("memory.current.update", { content: summary }));
  await recordOperation(root, operation("status.update", { content: "# Status\n\nSource recovery pending.\n" }));
  assert.equal(await readFile(path.join(root, "memory/current.md"), "utf8"), summary);
});

test("each missing authoritative store blocks unsafe writes but leaves scoped queries and maintenance diagnosis available", async (t) => {
  for (const [key, relative] of Object.entries(STORE_FILES)) await t.test(key, async (t) => {
    const root = await workspace(t);
    const pending = await recordOperation(root, operation("rule.propose", proposalPayload));
    await unlink(path.join(root, relative));
    const count = (await queryWorkspace(root, { target: key === "schedule" ? "source" : "task" })).count;
    assert.equal(count, 0);
    await assert.rejects(recordOperation(root, operation("activity.record", { action: "Unsafe", outcome: "Must not commit" })), (error) => JSON.parse(error.message).code === "store_missing");
    const report = await maintainWorkspace(root);
    assert.equal(report.stopped_before_changes, true);
    assert.ok(report.lint.issues.some((item) => item.code === "store_missing" && item.path === relative));
    assert.equal(report.pending_proposals_complete, key !== "proposals");
    if (key !== "proposals") assert.equal(report.pending_proposals[0].id, pending.proposal.id);
    await assert.rejects(readFile(path.join(root, relative)), { code: "ENOENT" });
  });
});

test("malformed collections and invalid timezones produce structured diagnostics rather than crashing or appearing empty", async (t) => {
  for (const [relative, mutate, target] of [
    ["project/schedule.json", (store) => ({ ...store, tasks: {} }), "task"],
    ["project/schedule.json", (store) => ({ ...store, tasks: [null] }), "task"],
    ["knowledge/catalog.json", (store) => ({ ...store, pages: [{ id: "WIKI-001", path: null }] }), null],
    ["governance/change-log.json", (store) => ({ ...store, operations: {} }), "change"],
    ["governance/change-log.json", (store) => ({ ...store, operations: [null] }), "change"],
    ["project/project.json", (store) => ({ ...store, timezone: "Invalid/Timezone" }), null],
    ["project/project.json", () => null, "project"],
    ["project/requirements.json", (store) => ({ ...store, change_requests: [{ id: "CR-001", title: "Incomplete legacy change", status: "implemented", approval_scope: "requirement", target_ids: ["REQ-001"], before: "Before", after: "After", reason: "Legacy record", impact: "Unknown", source_ids: [], created_at: "2026-01-01T00:00:00Z", applied_at: "2026-01-02T00:00:00Z" }] }), null],
  ]) await t.test(`${relative}-${target}-${++sequence}`, async (t) => {
    const root = await workspace(t);
    const store = await readJson(root, relative);
    const invalid = JSON.stringify(mutate(store));
    await writeFile(path.join(root, relative), invalid);
    const lint = await lintWorkspace(root);
    assert.equal(lint.ok, false);
    assert.ok(lint.issues.some((item) => item.level === "error"));
    const maintained = await maintainWorkspace(root);
    assert.equal(maintained.stopped_before_changes, true);
    if (target) await assert.rejects(queryWorkspace(root, { target }), /query_validation_failed/);
    await assert.rejects(recordOperation(root, operation("memory.current.update", { content: summary })), /workspace_validation_failed/);
    assert.equal(await readFile(path.join(root, relative), "utf8"), invalid);
  });
});

test("temporary-directory scan failures do not hide other diagnostics or stop unrelated records", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "tmp/tasks"), "A sync conflict left a file here\n");
  await unlink(path.join(root, "memory/current.md"));
  const lint = await lintWorkspace(root);
  assert.ok(lint.issues.some((item) => item.code === "environment_check_failed" && item.path === "tmp/tasks"));
  assert.ok(lint.issues.some((item) => item.code === "current_memory_missing"));
  await repeatedObservations(root);
  assert.equal((await maintainWorkspace(root)).proposals_created.length, 1);
});

test("missing skill assets remain visible without blocking normal records or safe maintenance proposals", async (t) => {
  const root = await workspace(t);
  await rm(path.join(root, ".agents/skills"), { recursive: true });
  await repeatedObservations(root);
  const maintained = await maintainWorkspace(root);
  assert.equal(maintained.stopped_before_changes, false);
  assert.equal(maintained.proposals_created.length, 1);
  assert.ok(maintained.lint.issues.some((item) => item.code === "skills_missing" && item.scope === "environment"));
});

test("a non-file deliverable path blocks its own operation while unrelated records can describe recovery", async (t) => {
  const root = await workspace(t);
  const relative = "deliverables/current/report.md";
  await writeFile(path.join(root, relative), "# Report\n");
  const item = (await recordOperation(root, operation("deliverable.upsert", { title: "Report", type: "report", format: "md", version: "v1", audience: "Team", purpose: "Review", path: relative }))).deliverable;
  await unlink(path.join(root, relative));
  await mkdir(path.join(root, relative));
  const saved = await recordOperation(root, operation("memory.current.update", { content: summary }));
  assert.ok(saved.warnings.some((issue) => issue.code === "file_unreadable" && issue.record_id === item.id));
  await assert.rejects(recordOperation(root, operation("deliverable.transition", { id: item.id, status: "drafting" })), (error) => JSON.parse(error.message).issues.some((issue) => issue.code === "file_unreadable" && issue.level === "error"));
  assert.equal((await readJson(root, "deliverables/index.json")).deliverables[0].status, "requested");
  assert.ok((await lstat(path.join(root, relative))).isDirectory());
});

test("unreadable local archive content and an unavailable Wiki directory do not abort lint or unrelated maintenance", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "raw.txt"), "Original\n");
  const source = await recordOperation(root, operation("source.register", { type: "daily_note", raw_path: "raw.txt", summary: "Original" }));
  await unlink(path.join(root, source.source.archived_path));
  await mkdir(path.join(root, source.source.archived_path));
  await rm(path.join(root, "knowledge/wiki"), { recursive: true });
  await writeFile(path.join(root, "knowledge/wiki"), "Sync placeholder\n");
  const lint = await lintWorkspace(root);
  assert.ok(lint.issues.some((item) => item.code === "file_unreadable"));
  assert.ok(lint.issues.some((item) => item.code === "wiki_scan_failed"));
  await repeatedObservations(root);
  const maintained = await maintainWorkspace(root);
  assert.equal(maintained.stopped_before_changes, false);
  assert.equal(maintained.proposals_created.length, 1);
});

test("compatibility entry points preserve view warnings and a missing requested original never creates a source", async (t) => {
  const root = await workspace(t, false);
  await unlink(path.join(root, "project/gantt.md"));
  await mkdir(path.join(root, "project/gantt.md"));
  const initialized = await initializeProject(root, { name: "Resilience", objective: "Keep confirmed facts", timezone: "Asia/Hong_Kong" });
  assert.ok(initialized.warnings.some((item) => item.code === "generated_views_pending"));
  const activity = await appendActivityEntry(root, { action: "Confirmed", outcome: "Recorded" });
  assert.ok(activity.warnings.some((item) => item.code === "generated_views_pending"));
  const before = await readFile(path.join(root, "knowledge/sources.json"), "utf8");
  await assert.rejects(recordOperation(root, operation("source.register", { type: "daily_note", raw_path: "missing.txt", summary: "Missing original" })), /ENOENT/);
  assert.equal(await readFile(path.join(root, "knowledge/sources.json"), "utf8"), before);
});

test("an exact source retry remains idempotent after temporary input cleanup and still rejects a changed request", async (t) => {
  const root = await workspace(t);
  await writeFile(path.join(root, "raw.txt"), "Confirmed original\n");
  const request = operation("source.register", { type: "daily_note", title: "Original", raw_path: "raw.txt", summary: "Confirmed source" });
  const saved = await recordOperation(root, request);
  await unlink(path.join(root, "raw.txt"));
  const repeated = await recordOperation(root, request);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.source.id, saved.source.id);
  assert.ok(repeated.warnings.some((item) => item.code === "source_original_unavailable"));
  await assert.rejects(recordOperation(root, { ...request, payload: { ...request.payload, summary: "Different request" } }), /operation_id_conflict/);
  const compatibilityRequest = { operation_id: "OP-resilience-source-compat", type: "daily_note", title: "Archived original", raw_path: saved.source.archived_path, summary: "Compatibility retry" };
  const compatible = await registerSource(root, compatibilityRequest);
  await unlink(path.join(root, saved.source.archived_path));
  assert.equal((await registerSource(root, compatibilityRequest)).source.id, compatible.source.id);
  assert.equal((await readJson(root, "knowledge/sources.json")).sources.length, 1);
});

test("a deduplicated source retry verifies its own input hash after the input was changed and removed", async (t) => {
  const root = await workspace(t);
  const payload = { type: "daily_note", title: "Original", raw_path: "raw.txt", source_locator: "thread://report", summary: "Confirmed source" };
  await writeFile(path.join(root, "raw.txt"), "Original content\n");
  const original = await recordOperation(root, operation("source.register", payload));
  await writeFile(path.join(root, "raw.txt"), "Updated content at the same source locator\n");
  const request = operation("source.register", payload);
  const duplicate = await recordOperation(root, request);
  assert.equal(duplicate.duplicate_of, original.source.id);
  await unlink(path.join(root, "raw.txt"));
  const repeated = await recordOperation(root, request);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.source.id, original.source.id);
  assert.ok(repeated.warnings.some((item) => item.code === "source_original_unavailable"));
  assert.equal((await readJson(root, "knowledge/sources.json")).sources.length, 1);
  await assert.rejects(recordOperation(root, { ...request, payload: { ...payload, summary: "Changed request" } }), /operation_id_conflict/);
});

test("independent record errors are reported together instead of one hiding the next", async (t) => {
  const root = await workspace(t);
  const relative = "deliverables/current/report.md";
  await writeFile(path.join(root, relative), "# Report\n");
  await recordOperation(root, operation("deliverable.upsert", { title: "Report", type: "report", format: "md", version: "v1", audience: "Team", purpose: "Review", path: relative }));
  const store = await readJson(root, "deliverables/index.json");
  store.deliverables[0].requirement_ids = ["REQ-999"];
  store.deliverables.push({ ...store.deliverables[0] });
  await writeFile(path.join(root, "deliverables/index.json"), JSON.stringify(store));
  const config = await readJson(root, ".harness/config.json");
  await writeFile(path.join(root, ".harness/config.json"), JSON.stringify({ ...config, upcoming_days: 0 }));
  const codes = new Set((await lintWorkspace(root, { fast: true })).issues.filter((item) => item.level === "error").map((item) => item.code));
  for (const code of ["duplicate_id", "missing_reference", "invalid_config"]) assert.ok(codes.has(code), `${code} should be reported alongside the others: ${[...codes]}`);
});

test("rebuild and maintain exit non-zero when views remain stale, without losing committed facts", async (t) => {
  const root = await workspace(t);
  await recordOperation(root, operation("activity.record", { action: "Confirmed", outcome: "Recorded" }));
  await unlink(path.join(root, "project/gantt.md"));
  await mkdir(path.join(root, "project/gantt.md"));
  const script = path.join(root, ".harness/scripts/harness.mjs");
  for (const command of ["rebuild", "maintain"]) {
    const run = spawnSync(process.execPath, [script, command], { cwd: root, encoding: "utf8" });
    assert.equal(run.status, 1, `${command} must surface pending views through its exit status`);
    assert.equal(JSON.parse(run.stdout).ok, false);
  }
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
  assert.ok((await lstat(path.join(root, "project/gantt.md"))).isDirectory());
});

test("maintenance proceeds past any locally scoped problem and stops for an unscoped one", async (t) => {
  const root = await workspace(t);
  await repeatedObservations(root);
  const registers = await readJson(root, "project/registers.json");
  await writeFile(path.join(root, "project/registers.json"), JSON.stringify({ ...registers, risks: [{ id: "RISK-001", title: "Broken", status: "open", mitigation_ids: ["MIT-404"] }] }));
  const stopped = await maintainWorkspace(root);
  assert.equal(stopped.stopped_before_changes, true);
  assert.ok(stopped.lint.issues.some((item) => item.level === "error" && !item.scope));
  await writeFile(path.join(root, "project/registers.json"), JSON.stringify(registers));
  await unlink(path.join(root, "memory/current.md"));
  const proceeded = await maintainWorkspace(root);
  assert.equal(proceeded.stopped_before_changes, false);
  assert.ok(proceeded.lint.issues.some((item) => item.code === "current_memory_missing" && item.scope === "local"));
});
