import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compensateLastOperation, maintainWorkspace, readJson, recordOperation } from "../.harness/lib/core.mjs";
import { SCHEMA_VERSION } from "../.harness/lib/model.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const copiedDirectories = [".harness", ".agents", "project", "knowledge", "memory", "deliverables", "governance", "archive", "activity", "templates"];
const copiedFiles = ["AGENTS.md", ".gitignore", ".gitattributes", "package.json"];

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pm-harness-compensation-"));
  for (const item of copiedDirectories) await cp(path.join(repositoryRoot, item), path.join(root, item), { recursive: true });
  for (const item of copiedFiles) await cp(path.join(repositoryRoot, item), path.join(root, item));
  return root;
}

let sequence = 0;
function operation(type, payload, extra = {}) {
  sequence += 1;
  return {
    schema_version: SCHEMA_VERSION,
    operation_id: `OP-comp-${String(sequence).padStart(6, "0")}`,
    type,
    actor: { kind: "agent" },
    reason: `test ${type}`,
    source_ids: [],
    payload,
    ...extra,
  };
}

async function errorDetails(promise) {
  try {
    await promise;
  } catch (error) {
    return JSON.parse(error.message);
  }
  throw new Error("Expected operation to fail");
}

function compensate(root, operationId, options = {}) {
  return compensateLastOperation(root, operationId, { confirmedByUserAt: new Date().toISOString(), ...options });
}

function activityPayload(action) {
  return { occurred_at: "2026-09-12T09:00:00+08:00", action, outcome: "Done", related_ids: [], source_ids: [] };
}

test("compensation dry-run is read-only and the committed operation preserves append-only audit", async () => {
  const root = await workspace();
  const created = await recordOperation(root, operation("activity.record", activityPayload("Prepare update")));
  const dayPath = path.join(root, "activity/2026-09-12.md");
  assert.match(await readFile(dayPath, "utf8"), /Prepare update/);

  const preview = await compensate(root, created.operation_id, { dryRun: true });
  assert.equal(preview.dry_run, true);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
  assert.equal((await readJson(root, "governance/change-log.json")).operations.length, 1);
  assert.equal((await errorDetails(compensateLastOperation(root, created.operation_id))).code, "user_confirmation_required");

  const undone = await compensate(root, created.operation_id);
  assert.deepEqual(undone.compensation.compensated_operation_ids, [created.operation_id]);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 0);
  const operations = (await readJson(root, "governance/change-log.json")).operations;
  assert.equal(operations[0].compensation.version, 2);
  assert.ok(operations[0].compensation.records[0].after_hash);
  assert.equal(operations[0].compensation.records[0].after, undefined);
  assert.equal(operations.length, 2);
  assert.equal(operations[0].operation_id, created.operation_id);
  assert.equal(operations[1].type, "operation.compensate");
  assert.equal(existsSync(dayPath), false);
});

test("the effective-operation stack supports consecutive compensation and never reuses IDs", async () => {
  const root = await workspace();
  const first = await recordOperation(root, operation("activity.record", activityPayload("First")));
  const second = await recordOperation(root, operation("activity.record", activityPayload("Second")));
  assert.equal(first.activity.id, "ACT-001");
  assert.equal(second.activity.id, "ACT-002");
  await compensate(root, second.operation_id);
  await compensate(root, first.operation_id);
  const reuse = await errorDetails(recordOperation(root, operation("activity.record", { id: "ACT-001", ...activityPayload("Reused") })));
  assert.equal(reuse.code, "workspace_id_reserved");
  const third = await recordOperation(root, operation("activity.record", activityPayload("Third")));
  assert.equal(third.activity.id, "ACT-003");
});

test("maintain records an undoable snapshot for generated rule proposals and observation links", async () => {
  const root = await workspace();
  await recordOperation(root, operation("observation.record", { title: "First miss", pattern_key: "review-pattern", evidence: "one", suggested_rule: "Review first" }));
  await recordOperation(root, operation("observation.record", { title: "Second miss", pattern_key: "review-pattern", evidence: "two", suggested_rule: "Review first" }));
  const maintained = await maintainWorkspace(root);
  assert.equal(maintained.proposals_created.length, 1);
  assert.equal(maintained.observations_linked.length, 2);

  const operationRecord = (await readJson(root, "governance/change-log.json")).operations.at(-1);
  assert.equal(operationRecord.type, "maintain.rule-proposals");
  assert.equal(operationRecord.compensation.reversible, true);
  await compensate(root, operationRecord.operation_id);
  assert.equal((await readJson(root, "governance/proposals.json")).proposals.length, 0);
  assert.ok((await readJson(root, "memory/observations.json")).observations.every((item) => item.proposal_id === null));
});

test("workflow compensation restores all child changes as one operation", async () => {
  const root = await workspace();
  const workflow = await recordOperation(root, operation("workflow.apply", {
    kind: "meeting_sync",
    operations: [
      { type: "schedule.upsert", payload: { collection: "tasks", title: "Follow up", owner: "PM" } },
      { type: "activity.record", payload: activityPayload("Meeting recorded") },
    ],
  }));
  assert.equal((await readJson(root, "governance/change-log.json")).operations.length, 1, "workflow steps stay in the parent result instead of duplicating audit rows");
  await compensate(root, workflow.operation_id);
  assert.equal((await readJson(root, "project/schedule.json")).tasks.length, 0);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 0);
  const compensated = (await readJson(root, "governance/change-log.json")).operations.at(-1).result.compensation.compensated_operation_ids;
  assert.deepEqual(compensated, [workflow.operation_id, `${workflow.operation_id}.step-01`, `${workflow.operation_id}.step-02`]);
});

test("one workflow keeps facts, status, and current memory in sync and undoable", async () => {
  const root = await workspace();
  const originalStatus = await readFile(path.join(root, "project/status.md"), "utf8");
  const originalMemory = await readFile(path.join(root, "memory/current.md"), "utf8");
  const workflow = await recordOperation(root, operation("workflow.apply", {
    kind: "status_sync",
    operations: [
      { type: "schedule.upsert", payload: { collection: "tasks", title: "Sync task", owner: "PM" } },
      { type: "status.update", payload: { content: "# 项目状态\n\n## 当前重点\n\n同步完成。\n\n## 阻塞与风险\n\n无。\n\n## 下一步\n\n继续推进。\n" } },
      { type: "memory.current.update", payload: { content: "# 当前工作记忆\n\n- 当前重点：同步完成\n- 待确认：无\n- 下一步：继续推进\n" } },
    ],
  }));
  assert.equal((await readJson(root, "governance/change-log.json")).operations.length, 1);
  assert.equal((await readJson(root, "project/schedule.json")).tasks.length, 1);
  await compensate(root, workflow.operation_id);
  assert.equal((await readJson(root, "project/schedule.json")).tasks.length, 0);
  assert.equal(await readFile(path.join(root, "project/status.md"), "utf8"), originalStatus);
  assert.equal(await readFile(path.join(root, "memory/current.md"), "utf8"), originalMemory);
});

test("controlled changes, human-authored files, and later conflicts are refused", async () => {
  const controlledRoot = await workspace();
  const stakeholder = await recordOperation(controlledRoot, operation("stakeholder.upsert", {
    name: "Sponsor", role: "Sponsor", approval_scopes: ["requirement"],
  }, { approval: { confirmed_by_user_at: new Date().toISOString() } }));
  assert.equal((await errorDetails(compensate(controlledRoot, stakeholder.operation_id))).code, "controlled_change_not_compensatable");

  const contentRoot = await workspace();
  const wiki = await recordOperation(contentRoot, operation("wiki.register", {
    title: "Context", path: "knowledge/wiki/context.md", content: "# Context\n", source_ids: [], related_ids: [],
  }));
  assert.equal((await errorDetails(compensate(contentRoot, wiki.operation_id))).code, "operation_not_compensatable");

  const conflictRoot = await workspace();
  const task = await recordOperation(conflictRoot, operation("schedule.upsert", { collection: "tasks", title: "Original", owner: "PM" }));
  const schedulePath = path.join(conflictRoot, "project/schedule.json");
  const schedule = await readJson(conflictRoot, "project/schedule.json");
  schedule.tasks[0].title = "Manually changed";
  await writeFile(schedulePath, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
  assert.equal((await errorDetails(compensate(conflictRoot, task.operation_id))).code, "compensation_conflict");
});

test("source compensation removes indexes, retains raw archives, and reserves source and archive IDs", async () => {
  const root = await workspace();
  const inputPath = path.join(root, ".harness/tmp/source.txt");
  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, "evidence one", "utf8");
  const first = await recordOperation(root, operation("source.register", {
    type: "daily_note", title: "Evidence one", raw_path: ".harness/tmp/source.txt", items: [{ classification: "fact", summary: "Fact one" }],
  }));
  const archivedPath = first.source.archived_path;
  const undone = await compensate(root, first.operation_id);
  assert.deepEqual(undone.compensation.retained_paths, [archivedPath]);
  assert.equal(existsSync(path.join(root, archivedPath)), true);
  assert.equal((await readJson(root, "knowledge/sources.json")).sources.length, 0);
  assert.equal((await readJson(root, "knowledge/inbox.json")).items.length, 0);
  assert.equal((await readJson(root, "archive/index.json")).files.length, 0);

  await writeFile(inputPath, "evidence two", "utf8");
  const second = await recordOperation(root, operation("source.register", {
    type: "daily_note", title: "Evidence two", raw_path: ".harness/tmp/source.txt", items: [{ classification: "fact", summary: "Fact two" }],
  }));
  assert.equal(second.source.id, "SRC-002");
  assert.equal((await readJson(root, "archive/index.json")).files[0].id, "ARC-002");
});

test("CLI undo uses compensation without requiring a Git repository", async () => {
  const root = await workspace();
  const created = await recordOperation(root, operation("activity.record", activityPayload("CLI undo")));
  const script = path.join(root, ".harness/scripts/harness.mjs");
  const result = JSON.parse(execFileSync(process.execPath, [script, "undo", created.operation_id, "--confirmed-at", new Date().toISOString(), "--compact"], { cwd: root, encoding: "utf8" }));
  assert.equal(result.ok, true);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 0);
});

test("the workspace lock covers read, validation, mutation, and transaction commit", async () => {
  const root = await workspace();
  const inputPath = path.join(root, ".harness/tmp/large-source.bin");
  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, Buffer.alloc(16 * 1024 * 1024, 7));
  const source = operation("source.register", { type: "other", title: "Large source", raw_path: ".harness/tmp/large-source.bin", items: [] });
  const activity = operation("activity.record", activityPayload("Concurrent activity"));
  const outcomes = await Promise.allSettled([recordOperation(root, source), recordOperation(root, activity)]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1, JSON.stringify(outcomes.map((item) => item.status === "rejected" ? item.reason?.message : item.value)));
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  const data = await readJson(root, "governance/change-log.json");
  assert.equal(data.operations.length, 1);
});

test("only one writer can reclaim a stale workspace lock", async () => {
  const root = await workspace();
  const temporaryRoot = path.join(root, ".harness/tmp");
  await mkdir(temporaryRoot, { recursive: true });
  await writeFile(path.join(temporaryRoot, "write.lock"), `${JSON.stringify({ pid: process.pid + 1000000, hostname: os.hostname(), acquired_at: new Date(0).toISOString() })}\n`, "utf8");
  const { acquireWorkspaceLock } = await import("../.harness/lib/transaction.mjs");
  const outcomes = await Promise.allSettled([acquireWorkspaceLock(root), acquireWorkspaceLock(root)]);
  const acquired = outcomes.filter((item) => item.status === "fulfilled");
  const refused = outcomes.filter((item) => item.status === "rejected");
  assert.equal(acquired.length, 1, JSON.stringify(outcomes));
  assert.equal(refused.length, 1, JSON.stringify(outcomes));
  const refusal = JSON.parse(refused[0].reason.message);
  assert.ok(["workspace_busy", "workspace_lock_recovery_busy"].includes(refusal.code));
  await acquired[0].value();
  assert.equal(existsSync(path.join(temporaryRoot, "write.lock")), false);
  assert.equal(existsSync(path.join(temporaryRoot, "write-lock-recovery.lock")), false);
});

test("a dead workspace lock recovers an interrupted transaction before the next write", async () => {
  const root = await workspace();
  const target = path.join(root, "project/status.md");
  const original = await readFile(target, "utf8");
  const transactionRoot = path.join(root, ".harness/tmp/tx-interrupted");
  await mkdir(path.join(transactionRoot, "old"), { recursive: true });
  await writeFile(path.join(transactionRoot, "old/0.data"), original, "utf8");
  await writeFile(target, "partial write\n", "utf8");
  await writeFile(path.join(transactionRoot, "manifest.json"), `${JSON.stringify({
    version: 1,
    operation_id: "OP-interrupted",
    phase: "applying",
    entries: [{ index: 0, path: "project/status.md", existed: true, delete: false }],
  })}\n`, "utf8");
  await writeFile(path.join(root, ".harness/tmp/write.lock"), `${JSON.stringify({ pid: process.pid + 1000000, hostname: os.hostname(), acquired_at: new Date().toISOString() })}\n`, "utf8");

  await recordOperation(root, operation("activity.record", { action: "Recovered", outcome: "Interrupted transaction restored" }));
  assert.equal(await readFile(target, "utf8"), original);
});

test("transaction targets cannot escape through a workspace symlink", async () => {
  const root = await workspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), "pm-harness-outside-"));
  await symlink(outside, path.join(root, "linked-output"));
  const { commitTransaction } = await import("../.harness/lib/transaction.mjs");
  await assert.rejects(commitTransaction(root, "OP-symlink-guard", [{ path: "linked-output/file.txt", content: "blocked" }]), /symbolic-link directory/);
  assert.equal(existsSync(path.join(outside, "file.txt")), false);
});
