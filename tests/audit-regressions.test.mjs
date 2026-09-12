import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { lintWorkspace, maintainWorkspace, readJson, rebuildWorkspace, recordOperation } from "../.harness/lib/core.mjs";
import { SCHEMA_VERSION } from "../.harness/lib/model.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const copiedDirectories = [".harness", ".agents", "project", "knowledge", "memory", "deliverables", "governance", "archive", "activity", "templates"];
const copiedFiles = ["AGENTS.md", ".gitignore", ".gitattributes", "package.json"];

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pm-harness-audit-"));
  for (const item of copiedDirectories) await cp(path.join(repositoryRoot, item), path.join(root, item), { recursive: true });
  for (const item of copiedFiles) await cp(path.join(repositoryRoot, item), path.join(root, item));
  return root;
}

let sequence = 0;
function operation(type, payload, extra = {}) {
  sequence += 1;
  return { schema_version: SCHEMA_VERSION, operation_id: `OP-audit-${String(sequence).padStart(6, "0")}`, type, actor: { kind: "agent" }, reason: `test ${type}`, source_ids: [], payload, ...extra };
}

async function initialize(root) {
  await recordOperation(root, operation("project.initialize", { name: "Audit regression", objective: "Keep controlled changes recoverable", timezone: "Asia/Hong_Kong", scope_in: [], scope_out: [], success_criteria: ["Safe"], constraints: [] }));
}

async function approvedRequirement(root) {
  const stakeholder = (await recordOperation(root, operation("stakeholder.upsert", { name: "Sponsor", role: "Sponsor", approval_scopes: ["requirement"] }, { approval: { confirmed_by_user_at: "2026-09-12T08:00:00Z" } }))).stakeholder;
  const approval = { approved_by_id: stakeholder.id, approved_at: "2026-09-12T08:01:00Z", confirmed_by_user_at: "2026-09-12T08:02:00Z" };
  const requirement = (await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV", status: "approved", acceptance_criteria: ["CSV downloads"], source_ids: [] }, { approval }))).requirement;
  return { stakeholder, requirement };
}

function replacementPayload(predecessorId, overrides = {}) {
  return {
    predecessor_id: predecessorId,
    replacement: { title: "Export", description: "Export CSV and XLSX", acceptance_criteria: ["CSV downloads", "XLSX downloads"] },
    reason: "Customers need spreadsheets",
    impact: "Broader export scope",
    created_at: "2026-09-12T08:03:00Z",
    ...overrides,
  };
}

test("aggregate replacement proposal derives exact snapshots and reuses the canonical intent", async () => {
  const root = await workspace();
  await initialize(root);
  const { stakeholder, requirement: predecessor } = await approvedRequirement(root);
  const proposal = operation("requirement.replacement.propose", replacementPayload(predecessor.id));
  const preview = await recordOperation(root, proposal, { dryRun: true });
  assert.equal(preview.dry_run, true);
  assert.equal(preview.changes.filter((item) => item.change === "created").length, 2);
  assert.equal((await readJson(root, "project/requirements.json")).requirements.length, 1);
  const first = await recordOperation(root, proposal);
  assert.equal(first.requirement.status, "proposed");
  assert.equal(first.requirement.supersedes_id, predecessor.id);
  assert.deepEqual(first.change_request.change_items[0].after.replacement, {
    title: "Export",
    description: "Export CSV and XLSX",
    acceptance_criteria: ["CSV downloads", "XLSX downloads"],
  });

  const repeated = await recordOperation(root, operation("requirement.replacement.propose", replacementPayload(predecessor.id, {
    title: "Same request, new wording",
    reason: "Spreadsheet export remains necessary",
    impact: "Equivalent business effect",
  })));
  assert.equal(repeated.reused_candidate, true);
  assert.equal(repeated.reused_change_request, true);
  assert.equal(repeated.requirement.id, first.requirement.id);
  assert.equal(repeated.change_request.id, first.change_request.id);
  const reordered = await recordOperation(root, operation("requirement.replacement.propose", replacementPayload(predecessor.id, {
    replacement: { title: "Export", description: "Export CSV and XLSX", acceptance_criteria: ["XLSX downloads", "CSV downloads", "CSV downloads"] },
  })));
  assert.equal(reordered.reused_candidate, true);
  assert.equal(reordered.reused_change_request, true);
  assert.equal(reordered.requirement.id, first.requirement.id);
  assert.equal(reordered.change_request.id, first.change_request.id);
  assert.deepEqual(reordered.requirement.acceptance_criteria, ["CSV downloads", "XLSX downloads"]);
  await assert.rejects(recordOperation(root, operation("requirement.replacement.propose", replacementPayload(predecessor.id, {
    replacement: { title: "Export", description: "Export CSV and XLSX", acceptance_criteria: ["CSV downloads", "XLSX downloads", "PDF downloads"] },
  }))), /active_replacement_candidate_conflict/);
  const stored = await readJson(root, "project/requirements.json");
  assert.equal(stored.requirements.length, 2);
  assert.equal(stored.change_requests.length, 1);

  const approval = { approved_by_id: stakeholder.id, approved_at: "2026-09-12T08:04:00Z", confirmed_by_user_at: "2026-09-12T08:05:00Z" };
  await recordOperation(root, operation("change.approve", { id: first.change_request.id }, { approval }));
  await recordOperation(root, operation("requirement.upsert", { id: first.requirement.id, status: "approved" }, { approval: { ...approval, change_request_id: first.change_request.id } }));
  const applied = await readJson(root, "project/requirements.json");
  assert.equal(applied.requirements.find((item) => item.id === predecessor.id).status, "superseded");
  assert.equal(applied.requirements.find((item) => item.id === first.requirement.id).status, "approved");
  assert.equal(applied.change_requests[0].status, "implemented");
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("legacy invalid drafts are warnings, do not block unrelated writes, and can be voided together", async () => {
  const root = await workspace();
  await initialize(root);
  const { requirement } = await approvedRequirement(root);
  const relative = "project/requirements.json";
  const file = path.join(root, relative);
  const data = JSON.parse(await readFile(file, "utf8"));
  const legacy = (id, replacementId) => ({
    id,
    title: "Legacy invalid replacement",
    status: "proposed",
    approval_scope: "requirement",
    target_ids: [requirement.id],
    change_items: [{ target_id: requirement.id, before: { status: "approved", superseded_by_id: null }, after: { status: "superseded", superseded_by_id: replacementId } }],
    before: "CSV",
    after: "Spreadsheet",
    reason: "Legacy writer omitted the replacement snapshot",
    impact: "Cannot be approved safely",
    source_ids: [],
    created_at: "2026-09-12T08:03:00Z",
    approved_by_id: null,
    confirmed_by_user_at: null,
    effective_at: null,
    approved_change_digest: null,
    applied_target_ids: [],
    applied_operation_ids: [],
    applied_at: null,
  });
  data.change_requests.push(legacy("CR-001", "REQ-900"), legacy("CR-002", "REQ-901"));
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  const before = await lintWorkspace(root);
  assert.equal(before.ok, true);
  assert.equal(before.issues.filter((item) => item.code === "replacement_candidate_required" && item.level === "warning").length, 2);
  const maintained = await maintainWorkspace(root);
  assert.equal(maintained.ok, true);
  assert.equal(maintained.lint.issues.filter((item) => item.code === "replacement_candidate_required").length, 2);
  await assert.rejects(recordOperation(root, operation("change.approve", { id: "CR-001" })), /replacement_candidate_required/);
  await recordOperation(root, operation("activity.record", { action: "Continue unrelated work", outcome: "Recorded despite invalid drafts", occurred_at: "2026-09-12T08:04:00Z" }));
  await assert.rejects(recordOperation(root, operation("change.void", { ids: ["CR-001", "CR-404"], reason: "Atomic repair check" })), /change_request_missing/);
  assert.ok((await readJson(root, relative)).change_requests.every((item) => item.status === "proposed"));
  await recordOperation(root, operation("change.void", { ids: ["CR-001", "CR-002"], reason: "Legacy drafts lack machine-applicable replacement snapshots", voided_at: "2026-09-12T08:05:00Z" }));

  const repaired = await readJson(root, relative);
  assert.deepEqual(repaired.change_requests.map((item) => item.status), ["voided", "voided"]);
  assert.ok(repaired.change_requests.every((item) => item.disposition_reason && item.voided_at));
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("schedule lifecycle rejects incomplete starts and derives actual dates from transition events", async () => {
  const root = await workspace();
  await initialize(root);
  const task = (await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Build export", owner: "Engineer" }))).schedule_item;
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.id, status: "in_progress" } })), /in_progress_without_actual_start/);

  const started = await recordOperation(root, operation("schedule.transition", { id: task.id, status: "in_progress", occurred_at: "2026-09-12T23:30:00Z", next_action: "Finish implementation" }));
  assert.equal(started.transition.from, "not_started");
  assert.equal(started.schedule_item.actual_start, "2026-09-13");
  const completed = await recordOperation(root, operation("schedule.transition", { id: task.id, status: "done", occurred_at: "2026-09-13T10:00:00Z", progress: 100, evidence: "Review passed" }));
  assert.equal(completed.schedule_item.actual_end, "2026-09-13");
  assert.equal(completed.schedule_item.progress, 100);
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("legacy in-progress tasks remain repairable without blocking unrelated work", async () => {
  const root = await workspace();
  await initialize(root);
  const task = (await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Legacy task", owner: "Engineer" }))).schedule_item;
  const relative = "project/schedule.json";
  const file = path.join(root, relative);
  const schedule = JSON.parse(await readFile(file, "utf8"));
  Object.assign(schedule.tasks[0], { status: "in_progress", actual_start: null });
  await writeFile(file, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
  await rebuildWorkspace(root);

  const warning = await lintWorkspace(root);
  assert.equal(warning.ok, true, JSON.stringify(warning.issues, null, 2));
  assert.ok(warning.issues.some((item) => item.code === "in_progress_without_actual_start" && item.level === "warning"));
  await recordOperation(root, operation("activity.record", { action: "Unrelated update", outcome: "Still writable", occurred_at: "2026-09-12T09:00:00Z" }));
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.id, actual_start: "2026-09-12" } }));
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("replacement proposal contract rejects caller-owned IDs and incomplete acceptance criteria", async () => {
  const root = await workspace();
  await initialize(root);
  const { requirement } = await approvedRequirement(root);
  await assert.rejects(recordOperation(root, operation("requirement.replacement.propose", replacementPayload(requirement.id, { replacement: { id: "REQ-999", title: "Export", description: "Bad", acceptance_criteria: ["Defined"] } }))), /unknown_field/);
  await assert.rejects(recordOperation(root, operation("requirement.replacement.propose", replacementPayload(requirement.id, { replacement: { title: "Export", description: "Bad", acceptance_criteria: [] } }))), /replacement_acceptance_criteria_invalid/);
  assert.equal((await readJson(root, "project/requirements.json")).requirements.length, 1);
});
