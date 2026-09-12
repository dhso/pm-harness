import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDailyBrief,
  compensateLastOperation,
  describeOperationContract,
  lintWorkspace,
  maintainWorkspace,
  queryWorkspace,
  readJson,
  rebuildWorkspace,
  recordOperation,
  renderOperationContract,
  renderGantt,
} from "../.harness/lib/core.mjs";
import { nearestName, OPERATION_TYPES, SCHEMA_VERSION } from "../.harness/lib/model.mjs";
import { commitTransaction } from "../.harness/lib/transaction.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const copiedDirectories = [".harness", ".agents", "project", "knowledge", "memory", "deliverables", "governance", "archive", "activity", "templates"];
const copiedFiles = ["AGENTS.md", ".gitignore", ".gitattributes", "package.json"];

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pm-harness-test-"));
  for (const item of copiedDirectories) await cp(path.join(repositoryRoot, item), path.join(root, item), { recursive: true });
  for (const item of copiedFiles) await cp(path.join(repositoryRoot, item), path.join(root, item));
  return root;
}

async function writeJsonFixture(root, relative, value) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

let operationSequence = 0;
function operation(type, payload, extra = {}) {
  operationSequence += 1;
  return {
    schema_version: SCHEMA_VERSION,
    operation_id: `OP-test-${String(operationSequence).padStart(6, "0")}`,
    type,
    actor: { kind: "agent" },
    reason: `test ${type}`,
    source_ids: [],
    payload,
    ...extra,
  };
}

function minutesAgo(count) {
  return new Date(Date.now() - count * 60_000).toISOString();
}

async function initialize(root, name = "Test project") {
  return recordOperation(root, operation("project.initialize", {
    name,
    objective: "Deliver an accepted outcome",
    timezone: "Asia/Hong_Kong",
    scope_in: ["Core delivery"],
    scope_out: [],
    success_criteria: ["Accepted"],
    constraints: [],
  }));
}

async function stakeholder(root, scopes = []) {
  return recordOperation(root, operation("stakeholder.upsert", {
    name: "Project sponsor",
    role: "Sponsor",
    organization: "Example",
    approval_scopes: scopes,
  }, scopes.length ? { approval: { confirmed_by_user_at: minutesAgo(1) } } : {}));
}

function businessApproval(stakeholderId, extra = {}) {
  return {
    approved_by_id: stakeholderId,
    approved_at: minutesAgo(2),
    confirmed_by_user_at: minutesAgo(1),
    ...extra,
  };
}

test("base template rebuilds, passes lint, uses LF, and has real Skills", async () => {
  const root = await workspace();
  assert.equal(SCHEMA_VERSION, 1);
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.counts, { error: 0, warning: 0, info: 0 });
  assert.equal((await lstat(path.join(root, ".agents/skills"))).isSymbolicLink(), false);
  assert.equal((await readJson(root, "activity/log.json")).schema_version, SCHEMA_VERSION);
  for (const relative of ["AGENTS.md", ".harness/lib/core.mjs", "project/schedule.json"]) assert.ok(!(await readFile(path.join(root, relative), "utf8")).includes("\r\n"));
});

test("lint enforces the 500-line Harness module boundary", async () => {
  const root = await workspace();
  await writeFile(path.join(root, ".harness/lib/oversized.mjs"), "export {};\n".repeat(501), "utf8");
  const result = await lintWorkspace(root);
  assert.ok(result.issues.some((item) => item.code === "harness_module_too_large" && item.path === ".harness/lib/oversized.mjs"));
});

test("PM Skills have valid identities, routing metadata, and resolvable progressive references", async () => {
  for (const entry of await readdir(path.join(repositoryRoot, ".agents/skills"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillRoot = path.join(repositoryRoot, ".agents/skills", entry.name);
    const content = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const kind = frontmatter.match(/^\s+kind:\s*(\S+)$/m)?.[1]?.trim();
    const domain = frontmatter.match(/^\s+domain:\s*(\S+)$/m)?.[1]?.trim();
    assert.equal(name, entry.name);
    assert.ok(description && description.length <= 1024 && !/[<>]/.test(description));
    assert.ok(["router", "workflow", "capability"].includes(kind));
    assert.ok(domain);
    assert.ok(!content.includes("[TODO:"));
    for (const match of content.matchAll(/\]\((references\/[^)]+)\)/g)) {
      assert.ok((await readFile(path.join(skillRoot, match[1]), "utf8")).trim());
    }
  }
});

test("Gantt keeps baseline, forecast, actual, and visible variance separate", () => {
  const output = renderGantt({ name: "Launch" }, { milestones: [], tasks: [{ id: "TASK-001", title: "Prepare", status: "in_progress", baseline_start: "2026-09-01", baseline_end: "2026-09-05", forecast_start: "2026-09-01", forecast_end: "2026-09-07", actual_start: "2026-09-02", actual_end: null, next_action: "Review" }] });
  assert.match(output, /延期 2 天/);
  assert.match(output, /2026-09-01 → 2026-09-05/);
  assert.match(output, /active, task_001/);
  assert.match(output, /进行中/);
  const escaped = renderGantt({ name: "Launch" }, { milestones: [], tasks: [{ id: "TASK-002", title: "Prepare [A]: review", status: "not_started", baseline_start: "2026-09-01", baseline_end: "2026-09-02", next_action: null }] });
  assert.ok(!escaped.includes("Prepare [A]: review :"));
});

test("invalid status, date, and field type are rejected before write", async () => {
  const root = await workspace();
  const before = await readFile(path.join(root, "project/schedule.json"), "utf8");
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Bad task", status: "invented", owner: 42, forecast_end: "2026-99-40" })), /record_validation_failed/);
  assert.equal(await readFile(path.join(root, "project/schedule.json"), "utf8"), before);
  await assert.rejects(recordOperation(root, operation("activity.record", { action: "Bad reference", outcome: "Rejected", related_ids: ["TASK-999"], source_ids: [] })), /workspace_validation_failed/);
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Typo", dueDate: "2026-09-10" })), /unknown_field/);
  await assert.rejects(recordOperation(root, { ...operation("activity.record", { action: "Typo", outcome: "Rejected" }), unexpected: true }), /unknown_field/);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 0);
  assert.equal((await readJson(root, "governance/change-log.json")).operations.length, 0);
  const config = await readJson(root, ".harness/config.json");
  config.staleTaskDays = 9;
  await writeJsonFixture(root, ".harness/config.json", config);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "unknown_field" && item.path === ".harness/config.json"));
});

test("transaction restores every file after an injected cross-file failure", async () => {
  const root = await workspace();
  await writeFile(path.join(root, "one.txt"), "one\n");
  await writeFile(path.join(root, "two.txt"), "two\n");
  await assert.rejects(commitTransaction(root, "OP-test-rollback", [{ path: "one.txt", content: "changed-one\n" }, { path: "two.txt", content: "changed-two\n" }, { path: "three.txt", content: "three\n" }], { failAfter: 1 }), /Injected transaction failure/);
  assert.equal(await readFile(path.join(root, "one.txt"), "utf8"), "one\n");
  assert.equal(await readFile(path.join(root, "two.txt"), "utf8"), "two\n");
  await assert.rejects(readFile(path.join(root, "three.txt"), "utf8"), /ENOENT/);
});

test("meeting workflow applies related facts atomically and remains idempotent", async () => {
  const root = await workspace();
  await initialize(root, "Meeting workflow");
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Prepare review", owner: "PM", forecast_end: "2026-09-10" }));
  const source = await recordOperation(root, operation("source.register", { type: "daily_note", title: "Meeting notes", summary: "Confirmed actions", items: [{ classification: "action", summary: "Move review", authority: "confirmed" }] }));
  const envelope = operation("workflow.apply", {
    kind: "meeting_minutes.confirm",
    operations: [
      { type: "register.upsert", payload: { collection: "decisions", title: "Use revised review date", description: "Review moves to September 12", status: "proposed", source_ids: [source.source.id] } },
      { type: "schedule.upsert", payload: { collection: "tasks", record: { id: task.schedule_item.id, forecast_end: "2026-09-12", next_action: "Confirm attendees" } } },
      { type: "inbox.transition", payload: { id: "INB-001", status: "applied", applied_to_ids: [task.schedule_item.id] } },
      { type: "activity.record", payload: { action: "Confirmed meeting minutes", outcome: "Decision, action and forecast synchronized", related_ids: [task.schedule_item.id, "DEC-001"], source_ids: [source.source.id] } },
    ],
  });
  const before = await Promise.all(["project/schedule.json", "project/registers.json", "knowledge/inbox.json", "activity/log.json", "governance/change-log.json"].map((relative) => readFile(path.join(root, relative), "utf8")));
  await assert.rejects(recordOperation(root, envelope, { failAfter: 1 }), /Injected transaction failure/);
  const afterFailure = await Promise.all(["project/schedule.json", "project/registers.json", "knowledge/inbox.json", "activity/log.json", "governance/change-log.json"].map((relative) => readFile(path.join(root, relative), "utf8")));
  assert.deepEqual(afterFailure, before);
  const applied = await recordOperation(root, envelope);
  assert.equal(applied.workflow.steps.length, 4);
  assert.equal((await readJson(root, "project/schedule.json")).tasks[0].forecast_end, "2026-09-12");
  assert.equal((await readJson(root, "knowledge/inbox.json")).items[0].status, "applied");
  assert.equal((await readJson(root, "activity/log.json")).entries.at(-1).action, "Confirmed meeting minutes");
  assert.equal((await recordOperation(root, envelope)).idempotent, true);
});

test("stable operation_id returns the original result without duplicate activity", async () => {
  const root = await workspace();
  const envelope = operation("activity.record", { occurred_at: "2026-09-09T09:00:00+08:00", action: "Reviewed plan", outcome: "Review complete", related_ids: [], source_ids: [], next_action: "Share" });
  const first = await recordOperation(root, envelope);
  const second = await recordOperation(root, envelope);
  assert.equal(second.idempotent, true);
  assert.equal(second.activity.id, first.activity.id);
  assert.equal((await readJson(root, "activity/log.json")).entries.length, 1);
  assert.equal((await readJson(root, "governance/change-log.json")).operations.length, 1);
  const conflicting = structuredClone(envelope);
  conflicting.payload.outcome = "Different result";
  await assert.rejects(recordOperation(root, conflicting), /operation_id_conflict/);
});

test("baseline changes require scoped approval, matching change request, revision, and digest", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["schedule_baseline"])).stakeholder;
  const initial = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Release", owner: "PM", baseline_start: "2026-09-10", baseline_end: "2026-09-12", forecast_start: "2026-09-10", forecast_end: "2026-09-12", next_action: "Start" }, { approval: businessApproval(approver.id) }));
  assert.equal(initial.baseline.revision, 1);
  assert.equal((await lintWorkspace(root)).ok, true);

  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: initial.schedule_item.id, baseline_end: "2026-09-14" } })), /approval_required/);
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Unapproved baseline addition", baseline_end: "2026-09-20" }, { approval: businessApproval(approver.id) })), /approved_change_request_required/);
  const proposed = await recordOperation(root, operation("change.propose", { title: "Move release", approval_scope: "schedule_baseline", target_ids: [initial.schedule_item.id], change_items: [{ target_id: initial.schedule_item.id, before: { baseline_end: "2026-09-12" }, after: { baseline_end: "2026-09-14" } }], before: "2026-09-12", after: "2026-09-14", reason: "Dependency delay", impact: "Two-day slip", created_at: minutesAgo(5) }));
  await recordOperation(root, operation("change.approve", { id: proposed.change_request.id }, { approval: businessApproval(approver.id) }));
  const approvedRequests = await readJson(root, "project/requirements.json");
  approvedRequests.change_requests[0].change_items[0].after.baseline_end = "2026-09-16";
  await writeJsonFixture(root, "project/requirements.json", approvedRequests);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "change_request_approved_snapshot_mismatch"));
  approvedRequests.change_requests[0].change_items[0].after.baseline_end = "2026-09-14";
  await writeJsonFixture(root, "project/requirements.json", approvedRequests);
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: initial.schedule_item.id, baseline_end: "2026-09-15" } }, { approval: businessApproval(approver.id, { change_request_id: proposed.change_request.id }) })), /change_request_content_mismatch/);
  const changed = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: initial.schedule_item.id, baseline_end: "2026-09-14", forecast_end: "2026-09-14" } }, { approval: businessApproval(approver.id, { change_request_id: proposed.change_request.id }) }));
  assert.equal(changed.baseline.revision, 2);
  assert.equal((await readJson(root, "project/requirements.json")).change_requests[0].status, "implemented");
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: initial.schedule_item.id, baseline_end: "2026-09-15" } }, { approval: businessApproval(approver.id, { change_request_id: proposed.change_request.id }) })), /change_request_already_applied|approved_change_request_required/);
  assert.equal((await lintWorkspace(root)).ok, true);

  const schedule = await readJson(root, "project/schedule.json");
  schedule.tasks[0].baseline_end = "2026-09-15";
  await writeJsonFixture(root, "project/schedule.json", schedule);
  const drift = await lintWorkspace(root);
  assert.ok(drift.issues.some((item) => item.code === "baseline_metadata_invalid"));
});

test("email claims and unscoped stakeholders cannot approve a requirement", async () => {
  const root = await workspace();
  await recordOperation(root, operation("source.register", { type: "email", title: "Approval claim", sender: "Customer", source_time: "2026-09-09T10:00:00+08:00", summary: "Email says approved", items: [{ classification: "decision", summary: "Approve requirement", authority: "claimed", status: "new" }] }));
  const unscoped = (await stakeholder(root)).stakeholder;
  await assert.rejects(recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export records", status: "approved", acceptance_criteria: ["CSV downloads"], source_ids: ["SRC-001"] }, { approval: businessApproval(unscoped.id) })), /approval_scope_missing/);
  assert.equal((await readJson(root, "project/requirements.json")).requirements.length, 0);
});

test("approved requirement snapshot detects direct edits and requires a new version", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["requirement"])).stakeholder;
  const approved = await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export records", status: "approved", acceptance_criteria: ["CSV downloads"], source_ids: [] }, { approval: businessApproval(approver.id) }));
  assert.equal((await lintWorkspace(root)).ok, true);
  const requirements = await readJson(root, "project/requirements.json");
  requirements.requirements[0].description = "Changed outside record";
  await writeJsonFixture(root, "project/requirements.json", requirements);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "requirement_approved_snapshot_mismatch"));
  requirements.requirements[0].description = "Export records";
  await writeJsonFixture(root, "project/requirements.json", requirements);
  await assert.rejects(recordOperation(root, operation("requirement.upsert", { id: approved.requirement.id, description: "Overwrite approved text" }, { approval: businessApproval(approver.id) })), /approved_requirement_requires_new_version/);
  await assert.rejects(recordOperation(root, operation("requirement.upsert", { id: approved.requirement.id, owner: "Product" }, { approval: businessApproval(approver.id) })), /approved_requirement_requires_new_version/);
});

test("approved requirement replacement closes both sides of the supersession chain", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["requirement"])).stakeholder;
  const old = await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV", status: "approved", acceptance_criteria: ["CSV downloads"], source_ids: [] }, { approval: businessApproval(approver.id) }));
  const linkedTask = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Implement export", owner: "Engineer", requirement_ids: [old.requirement.id] }));
  const replacement = await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV and XLSX", status: "candidate", acceptance_criteria: ["CSV downloads", "XLSX downloads"], source_ids: [], supersedes_id: old.requirement.id }));
  await recordOperation(root, operation("requirement.upsert", { id: replacement.requirement.id, status: "proposed" }));
  const exact = {
    target_id: old.requirement.id,
    before: { status: "approved", superseded_by_id: null },
    after: { status: "superseded", superseded_by_id: replacement.requirement.id, replacement: { title: "Export", description: "Export CSV and XLSX", acceptance_criteria: ["XLSX downloads", "CSV downloads"] } },
  };
  const change = await recordOperation(root, operation("change.propose", { title: "Replace export requirement", approval_scope: "requirement", target_ids: [old.requirement.id], change_items: [exact], before: "CSV only", after: "CSV and XLSX", reason: "Customer need", impact: "Broader export scope", created_at: minutesAgo(5) }));
  await recordOperation(root, operation("change.approve", { id: change.change_request.id }, { approval: businessApproval(approver.id) }));
  await recordOperation(root, operation("requirement.upsert", { id: replacement.requirement.id, status: "approved" }, { approval: businessApproval(approver.id, { change_request_id: change.change_request.id }) }));
  const records = (await readJson(root, "project/requirements.json")).requirements;
  assert.equal(records.find((item) => item.id === old.requirement.id).superseded_by_id, replacement.requirement.id);
  assert.equal(records.find((item) => item.id === replacement.requirement.id).supersedes_id, old.requirement.id);
  const linked = (await readJson(root, "project/schedule.json")).tasks.find((item) => item.id === linkedTask.schedule_item.id);
  assert.deepEqual(linked.requirement_ids, [replacement.requirement.id]);
  assert.equal(linked.owner, "Engineer", "missing replacement owner must not erase an existing task owner");
  assert.match(await readFile(path.join(root, "project/status.md"), "utf8"), /Export.*已由.*替代/);
  assert.match(await readFile(path.join(root, "memory/current.md"), "utf8"), /已生效变更：Export/);
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("replacement requirement owner propagates to linked tasks while missing owners remain compatible", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["requirement"])).stakeholder;
  const old = await recordOperation(root, operation("requirement.upsert", { title: "Checkout", description: "Complete checkout", status: "approved", acceptance_criteria: ["Order submits"], source_ids: [] }, { approval: businessApproval(approver.id) }));
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Build checkout", owner: "Engineer", requirement_ids: [old.requirement.id] }));
  const replacement = await recordOperation(root, operation("requirement.upsert", { title: "Checkout", description: "Complete checkout", owner: "Product", status: "candidate", acceptance_criteria: ["Order submits"], source_ids: [], supersedes_id: old.requirement.id }));
  await recordOperation(root, operation("requirement.upsert", { id: replacement.requirement.id, status: "proposed" }));
  const change = await recordOperation(root, operation("change.propose", { title: "Assign checkout owner", approval_scope: "requirement", target_ids: [old.requirement.id], change_items: [{ target_id: old.requirement.id, before: { status: "approved", superseded_by_id: null }, after: { status: "superseded", superseded_by_id: replacement.requirement.id, replacement: { title: "Checkout", description: "Complete checkout", owner: "Product", acceptance_criteria: ["Order submits"] } } }], before: "Engineer-owned checkout", after: "Product-owned checkout", reason: "Ownership clarified", impact: "Linked implementation task changes owner", created_at: minutesAgo(5) }));
  await recordOperation(root, operation("change.approve", { id: change.change_request.id }, { approval: businessApproval(approver.id) }));
  await recordOperation(root, operation("requirement.upsert", { id: replacement.requirement.id, status: "approved" }, { approval: businessApproval(approver.id, { change_request_id: change.change_request.id }) }));
  const linked = (await readJson(root, "project/schedule.json")).tasks.find((item) => item.id === task.schedule_item.id);
  assert.equal(linked.owner, "Product");
  assert.equal((await readJson(root, "project/requirements.json")).requirements.find((item) => item.id === replacement.requirement.id).owner, "Product");
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("requirement change proposals require a matching candidate and deduplicate unfinished drafts", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["requirement"])).stakeholder;
  const old = await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV", status: "approved", acceptance_criteria: ["CSV downloads"], source_ids: [] }, { approval: businessApproval(approver.id) }));
  const item = { target_id: old.requirement.id, before: { status: "approved", superseded_by_id: null }, after: { status: "superseded", superseded_by_id: "REQ-002", replacement: { title: "Export", description: "Export CSV and XLSX", acceptance_criteria: ["CSV downloads", "XLSX downloads"] } } };
  await assert.rejects(recordOperation(root, operation("change.propose", { title: "Replace export", approval_scope: "requirement", target_ids: [old.requirement.id], change_items: [item], before: "CSV", after: "CSV and XLSX", reason: "Need XLSX", impact: "Broader export" })), /replacement_candidate_required|replacement_candidate_snapshot_mismatch/);
  await assert.rejects(recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV and XLSX", status: "proposed", acceptance_criteria: ["CSV and XLSX download"], source_ids: [], supersedes_id: old.requirement.id })), /replacement_candidate_required/);
  await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV and XLSX", status: "candidate", acceptance_criteria: ["CSV downloads", "XLSX downloads"], source_ids: [], supersedes_id: old.requirement.id }));
  const first = await recordOperation(root, operation("change.propose", { title: "Replace export", approval_scope: "requirement", target_ids: [old.requirement.id], change_items: [item], before: "CSV", after: "CSV and XLSX", reason: "Need XLSX", impact: "Broader export" }));
  const reorderedItem = structuredClone(item);
  reorderedItem.after.replacement.acceptance_criteria = ["XLSX downloads", "CSV downloads", "CSV downloads"];
  const duplicate = await recordOperation(root, operation("change.propose", { title: "Same export replacement", approval_scope: "requirement", target_ids: [old.requirement.id], change_items: [reorderedItem], before: "The old export only supports CSV", after: "The replacement also supports XLSX", reason: "Different wording", impact: "Same change" }));
  assert.equal(duplicate.reused_existing, true);
  assert.equal(duplicate.change_request.id, first.change_request.id);
  assert.equal((await readJson(root, "project/requirements.json")).change_requests.filter((item) => item.status === "proposed").length, 1);
  assert.ok(first.change_request.id);
});

test("source registration archives atomically, hashes content, deduplicates, and controls inbox disposition", async () => {
  const root = await workspace();
  await writeFile(path.join(root, "mail.txt"), "Move review to Friday", "utf8");
  const first = await recordOperation(root, operation("source.register", { type: "email", title: "Review timing", sender: "Sponsor", source_time: "2026-09-09T09:00:00+08:00", raw_path: "mail.txt", summary: "Move review", items: [{ classification: "request", summary: "Move review to Friday", confidence: 1, authority: "unknown" }, { classification: "feedback", summary: "No action needed", authority: "unknown" }] }));
  assert.match(first.source.archived_path, /^archive\/files\/2026\/SRC-001-/);
  assert.equal(first.source.sha256.length, 64);
  assert.equal((await readJson(root, "archive/index.json")).files[0].sha256, first.source.sha256);

  const duplicate = await recordOperation(root, operation("source.register", { type: "email", title: "Copy", raw_path: "mail.txt", summary: "Same bytes", items: [] }));
  assert.equal(duplicate.duplicate_of, "SRC-001");
  assert.equal((await readJson(root, "knowledge/sources.json")).sources.length, 1);
  assert.equal((await readJson(root, "governance/change-log.json")).operations.filter((item) => item.type === "source.register").length, 2);

  await assert.rejects(recordOperation(root, operation("inbox.transition", { id: "INB-001", status: "applied", applied_to_ids: [] })), /workspace_validation_failed/);
  await recordOperation(root, operation("inbox.transition", { id: "INB-001", status: "applied", applied_to_ids: ["SRC-001"] }));
  await assert.rejects(recordOperation(root, operation("inbox.transition", { id: "INB-002", status: "archived" })), /workspace_validation_failed/);
  await recordOperation(root, operation("inbox.transition", { id: "INB-002", status: "archived", disposition_reason: "Informational only" }));
  const item = (await readJson(root, "knowledge/inbox.json")).items[0];
  assert.equal(item.status, "applied");
  assert.ok(item.applied_at);
});

test("activities use project timezone and daily brief includes recent work with at most three reasons", async () => {
  const root = await workspace();
  await initialize(root, "Daily brief");
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Late task", owner: "PM", forecast_end: "2026-09-08", next_action: "Recover" }));
  await recordOperation(root, operation("activity.record", { occurred_at: "2026-09-08T16:30:00Z", action: "Investigated delay", outcome: "Root cause found", related_ids: [task.schedule_item.id], source_ids: [], next_action: "Recover" }));
  const day = await readFile(path.join(root, "activity/2026-09-09.md"), "utf8");
  assert.match(day, /Investigated delay/);
  const brief = await buildDailyBrief(root, new Date("2026-09-09T02:00:00Z"));
  assert.equal(brief.recent_activity.length, 1);
  assert.ok(brief.overdue.some((item) => item.id === task.schedule_item.id));
  assert.ok(brief.top_actions.length <= 3);
  assert.ok(brief.top_actions.every((item) => item.reason));
});

test("daily brief prioritizes structured high risks when no urgent task outranks them", async () => {
  const root = await workspace();
  await initialize(root, "Risk brief");
  await recordOperation(root, operation("register.upsert", { collection: "risks", title: "Vendor outage", description: "Critical dependency may fail", owner: "PM", probability: "high", impact: "high", trigger: "Vendor misses readiness check", response: "Prepare fallback", response_due: "2026-09-10", next_review: "2026-09-09", source_ids: [] }));
  const brief = await buildDailyBrief(root, new Date("2026-09-09T02:00:00Z"));
  assert.equal(brief.top_actions[0].kind, "risk");
  assert.equal(brief.priority_risks[0].id, "RISK-001");
});

test("deliverable transitions enforce authority, chronology, immutable approved content, and supersession cycles", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["deliverable", "acceptance"])).stakeholder;
  await mkdir(path.join(root, "deliverables/current"), { recursive: true });
  await writeFile(path.join(root, "deliverables/current/report-v01.md"), "# Report\n", "utf8");
  const created = await recordOperation(root, operation("deliverable.upsert", { title: "Report", type: "status_report", format: "md", version: "v01", status: "requested", path: "deliverables/current/report-v01.md", audience: "Sponsor", purpose: "Decision", requirement_ids: [], source_ids: [], acceptance_criteria: ["Accurate"], reviewers: [] }));
  const id = created.deliverable.id;
  await recordOperation(root, operation("deliverable.transition", { id, status: "drafting" }));
  await recordOperation(root, operation("deliverable.transition", { id, status: "review", completed_at: minutesAgo(5) }));
  await recordOperation(root, operation("deliverable.transition", { id, status: "approved" }, { approval: businessApproval(approver.id) }));
  await recordOperation(root, operation("deliverable.transition", { id, status: "delivered", delivered_at: new Date().toISOString() }));
  await recordOperation(root, operation("deliverable.transition", { id, status: "accepted", acceptance_evidence: "Sponsor confirmation" }, { approval: { approved_by_id: approver.id, approved_at: new Date(Date.now() + 60_000).toISOString(), confirmed_by_user_at: new Date(Date.now() + 120_000).toISOString() } }));
  assert.equal((await lintWorkspace(root)).ok, true);
  await writeFile(path.join(root, "deliverables/current/report-v01.md"), "# Tampered report\n", "utf8");
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "deliverable_content_hash_mismatch"));
  await writeFile(path.join(root, "deliverables/current/report-v01.md"), "# Report\n", "utf8");
  await assert.rejects(recordOperation(root, operation("deliverable.upsert", { id, title: "Overwritten title" })), /approved_deliverable_requires_new_version/);

  const index = await readJson(root, "deliverables/index.json");
  index.deliverables[0].accepted_at = minutesAgo(10);
  await writeJsonFixture(root, "deliverables/index.json", index);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "lifecycle_time_order"));

  await writeJsonFixture(root, "deliverables/index.json", { schema_version: SCHEMA_VERSION, deliverables: [
    { id: "DEL-001", title: "A", type: "doc", format: "md", version: "v01", status: "requested", path: null, audience: "Team", purpose: "Test", requirement_ids: [], source_ids: [], acceptance_criteria: [], reviewers: [], supersedes_id: "DEL-002", superseded_by_id: "DEL-002" },
    { id: "DEL-002", title: "B", type: "doc", format: "md", version: "v02", status: "requested", path: null, audience: "Team", purpose: "Test", requirement_ids: [], source_ids: [], acceptance_criteria: [], reviewers: [], supersedes_id: "DEL-001", superseded_by_id: "DEL-001" },
  ] });
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "supersession_cycle"));
});

test("approved deliverable replacement is exact, reciprocal, and atomic", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["deliverable"])).stakeholder;
  await mkdir(path.join(root, "deliverables/current"), { recursive: true });
  await writeFile(path.join(root, "deliverables/current/report-v01.md"), "# Report v1\n", "utf8");
  const old = await recordOperation(root, operation("deliverable.upsert", { title: "Report", type: "status_report", format: "md", version: "v01", status: "approved", path: "deliverables/current/report-v01.md", audience: "Sponsor", purpose: "Decision", requirement_ids: [], source_ids: [], acceptance_criteria: ["Accurate"], reviewers: [] }, { approval: businessApproval(approver.id) }));
  const replacementPath = "deliverables/current/report-v02.md";
  const replacementContent = "# Report v2\n";
  await writeFile(path.join(root, replacementPath), replacementContent, "utf8");
  const replacement = await recordOperation(root, operation("deliverable.upsert", { title: "Report", type: "status_report", format: "md", version: "v02", status: "requested", path: replacementPath, audience: "Sponsor", purpose: "Decision", requirement_ids: [], source_ids: [], acceptance_criteria: ["Accurate"], reviewers: [], supersedes_id: old.deliverable.id }));
  await recordOperation(root, operation("deliverable.transition", { id: replacement.deliverable.id, status: "drafting" }));
  await recordOperation(root, operation("deliverable.transition", { id: replacement.deliverable.id, status: "review", completed_at: minutesAgo(5) }));
  const replacementSnapshot = { title: "Report", type: "status_report", format: "md", version: "v02", path: replacementPath, content_sha256: createHash("sha256").update(replacementContent).digest("hex"), audience: "Sponsor", purpose: "Decision", requirement_ids: [], source_ids: [], due_at: null, acceptance_criteria: ["Accurate"], reviewers: [] };
  const exact = { target_id: old.deliverable.id, before: { status: "approved", superseded_by_id: null }, after: { status: "superseded", superseded_by_id: replacement.deliverable.id, replacement: replacementSnapshot } };
  const change = await recordOperation(root, operation("change.propose", { title: "Replace report", approval_scope: "deliverable", target_ids: [old.deliverable.id], change_items: [exact], before: "v01", after: "v02", reason: "Revision", impact: "New approved report", created_at: minutesAgo(5) }));
  await recordOperation(root, operation("change.approve", { id: change.change_request.id }, { approval: businessApproval(approver.id) }));
  await recordOperation(root, operation("deliverable.transition", { id: replacement.deliverable.id, status: "approved" }, { approval: businessApproval(approver.id, { change_request_id: change.change_request.id }) }));
  const records = (await readJson(root, "deliverables/index.json")).deliverables;
  assert.equal(records.find((item) => item.id === old.deliverable.id).superseded_by_id, replacement.deliverable.id);
  assert.equal(records.find((item) => item.id === replacement.deliverable.id).supersedes_id, old.deliverable.id);
  assert.equal((await lintWorkspace(root)).ok, true);
});

test("Wiki catalog detects missing pages, unregistered pages, bad sources, and overdue review", async () => {
  const root = await workspace();
  await recordOperation(root, operation("source.register", { type: "daily_note", title: "Architecture note", summary: "Architecture facts", items: [] }));
  await recordOperation(root, operation("wiki.register", { title: "Architecture", path: "knowledge/wiki/architecture.md", content: "# Architecture\n\nConfirmed design.\n", source_ids: ["SRC-001"], related_ids: [], review_due_at: "2020-01-01" }));
  let lint = await lintWorkspace(root);
  assert.ok(lint.issues.some((item) => item.code === "wiki_review_overdue"));
  await writeFile(path.join(root, "knowledge/wiki/orphan.md"), "# Orphan\n", "utf8");
  await unlink(path.join(root, "knowledge/wiki/architecture.md"));
  const catalog = await readJson(root, "knowledge/catalog.json");
  catalog.pages[0].source_ids = ["SRC-999"];
  await writeJsonFixture(root, "knowledge/catalog.json", catalog);
  lint = await lintWorkspace(root);
  const codes = lint.issues.map((item) => item.code);
  assert.ok(codes.includes("wiki_page_missing"));
  assert.ok(codes.includes("wiki_not_registered"));
  assert.ok(codes.includes("missing_reference"));
});

test("repeated observations create one proposal, never auto-activate, and produce due review advice", async () => {
  const root = await workspace();
  for (const title of ["Missed owner", "Owner missing again"]) await recordOperation(root, operation("observation.record", { title, pattern_key: "missing-owner", evidence: title, suggested_rule: "Check accountable owner before closeout." }));
  const first = await maintainWorkspace(root);
  assert.equal(first.proposals_created.length, 1);
  assert.equal((await readJson(root, "governance/rules.json")).rules.length, 0);
  const observations = await readJson(root, "memory/observations.json");
  observations.observations[0].proposal_id = null;
  await writeJsonFixture(root, "memory/observations.json", observations);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "proposal_observation_link_mismatch"));
  observations.observations[0].proposal_id = first.proposals_created[0];
  await writeJsonFixture(root, "memory/observations.json", observations);
  const second = await maintainWorkspace(root);
  assert.equal(second.proposals_created.length, 0);
  const proposalId = first.proposals_created[0];
  await assert.rejects(recordOperation(root, operation("rule.activate", { id: proposalId })), /user_confirmation_required/);

  const proposals = await readJson(root, "governance/proposals.json");
  proposals.proposals[0].review_at = "2020-01-01";
  await writeJsonFixture(root, "governance/proposals.json", proposals);
  await recordOperation(root, operation("rule.activate", { id: proposalId }, { approval: { confirmed_by_user_at: new Date().toISOString() } }));
  const rules = await readJson(root, "governance/rules.json");
  const approvedText = rules.rules[0].text;
  rules.rules[0].text = "Unapproved direct edit";
  await writeJsonFixture(root, "governance/rules.json", rules);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "rule_snapshot_mismatch"));
  rules.rules[0].text = approvedText;
  await writeJsonFixture(root, "governance/rules.json", rules);
  for (const title of ["Third miss", "Fourth miss"]) await recordOperation(root, operation("observation.record", { title, pattern_key: "missing-owner", evidence: title }));
  const review = await maintainWorkspace(root);
  assert.equal(review.proposals_created.length, 0);
  assert.equal(review.observations_linked.length, 2);
  assert.equal(review.rule_reviews_due[0].id, proposalId);
  assert.equal(review.rule_reviews_due[0].recurrence_count, 2);
  assert.equal((await readJson(root, "governance/rules.json")).rules[0].status, "active");
});

test("maintain stops before rule changes when the workspace has errors", async () => {
  const root = await workspace();
  const config = await readJson(root, ".harness/config.json");
  config.schema_version = 999;
  await writeJsonFixture(root, ".harness/config.json", config);
  const result = await maintainWorkspace(root);
  assert.equal(result.ok, false);
  assert.equal(result.stopped_before_changes, true);
  assert.equal((await readJson(root, "governance/proposals.json")).proposals.length, 0);
});

test("agent-only CLI exposes record, contract discovery, brief, maintain, and structured errors", async () => {
  const root = await workspace();
  const inputPath = path.join(root, ".harness/tmp/operation.json");
  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, `${JSON.stringify(operation("project.initialize", { name: "CLI project", objective: "Verify CLI", timezone: "Asia/Hong_Kong", scope_in: [], scope_out: [], success_criteria: ["Works"], constraints: [] }), null, 2)}\n`, "utf8");
  const script = path.join(root, ".harness/scripts/harness.mjs");
  const recorded = JSON.parse(execFileSync(process.execPath, [script, "record", "--input", inputPath], { cwd: root, encoding: "utf8" }));
  assert.equal(recorded.ok, true);
  const contract = JSON.parse(execFileSync(process.execPath, [script, "contract", "activity.record", "--compact"], { cwd: root, encoding: "utf8" }));
  assert.deepEqual(contract.required, ["action", "outcome"]);
  assert.equal(contract.fields.occurred_at, "timestamp");
  const brief = JSON.parse(execFileSync(process.execPath, [script, "brief", "--json"], { cwd: root, encoding: "utf8" }));
  assert.equal(brief.project, "CLI project");
  const maintained = JSON.parse(execFileSync(process.execPath, [script, "maintain"], { cwd: root, encoding: "utf8" }));
  assert.equal(maintained.ok, true);
  let failed;
  try {
    execFileSync(process.execPath, [script, "record", "--input", "missing.json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    failed = JSON.parse(error.stdout);
  }
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "operation_failed");
  assert.ok(failed.suggestion);
});

test("complete workflow covers intake, change approval, planning, activity, delivery draft, Wiki, brief, maintain, and lint", async () => {
  const root = await workspace();
  await initialize(root, "End-to-end");
  const approver = (await stakeholder(root, ["schedule_baseline", "requirement", "deliverable", "acceptance"])).stakeholder;
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Prepare launch", owner: "PM", forecast_end: "2026-09-20", next_action: "Review input" }));
  await writeFile(path.join(root, "note.txt"), "Launch should move to September 22", "utf8");
  const source = await recordOperation(root, operation("source.register", { type: "daily_note", title: "Launch note", raw_path: "note.txt", source_time: "2026-09-09T09:00:00+08:00", summary: "Move launch", items: [{ classification: "request", summary: "Move launch", authority: "unknown", related_ids: [task.schedule_item.id] }] }));
  const requirement = await recordOperation(root, operation("requirement.upsert", { title: "Launch readiness", description: "Launch checklist is complete", status: "candidate", acceptance_criteria: ["Checklist complete"], source_ids: [source.source.id] }));
  const change = await recordOperation(root, operation("change.propose", { title: "Approve launch baseline", approval_scope: "schedule_baseline", target_ids: [task.schedule_item.id], change_items: [{ target_id: task.schedule_item.id, before: { baseline_start: null, baseline_end: null }, after: { baseline_start: "2026-09-15", baseline_end: "2026-09-22" } }], before: "No baseline", after: "2026-09-22", reason: "Launch request", impact: "Sets committed date", source_ids: [source.source.id], created_at: minutesAgo(5) }));
  await recordOperation(root, operation("change.approve", { id: change.change_request.id }, { approval: businessApproval(approver.id) }));
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, baseline_start: "2026-09-15", baseline_end: "2026-09-22", forecast_end: "2026-09-22", requirement_ids: [requirement.requirement.id] } }, { approval: businessApproval(approver.id, { change_request_id: change.change_request.id }) }));
  await recordOperation(root, operation("activity.record", { action: "Prepared launch plan", outcome: "Baseline and evidence linked", related_ids: [task.schedule_item.id, requirement.requirement.id], source_ids: [source.source.id], next_action: "Draft brief" }));
  await mkdir(path.join(root, "deliverables/current"), { recursive: true });
  await writeFile(path.join(root, "deliverables/current/launch-brief-v01.md"), "# Launch brief\n", "utf8");
  await recordOperation(root, operation("deliverable.upsert", { title: "Launch brief", type: "brief", format: "md", version: "v01", status: "drafting", path: "deliverables/current/launch-brief-v01.md", audience: "Sponsor", purpose: "Launch decision", requirement_ids: [requirement.requirement.id], source_ids: [source.source.id], acceptance_criteria: ["Accurate"], reviewers: [] }));
  await recordOperation(root, operation("wiki.register", { title: "Launch context", path: "knowledge/wiki/launch-context.md", content: "# Launch context\n\nSource: SRC-001.\n", source_ids: [source.source.id], related_ids: [requirement.requirement.id], review_due_at: "2027-01-01" }));
  for (const title of ["Owner check one", "Owner check two"]) await recordOperation(root, operation("observation.record", { title, pattern_key: "owner-check", evidence: title }));
  const maintenance = await maintainWorkspace(root);
  const brief = await buildDailyBrief(root);
  const lint = await lintWorkspace(root);
  assert.equal(maintenance.proposals_created.length, 1);
  assert.ok(brief.recent_activity.length >= 1);
  assert.ok(brief.top_actions.length <= 3);
  assert.equal(lint.ok, true, JSON.stringify(lint.issues, null, 2));
});

test("unknown fields, operation types, and statuses report candidates and a fix", async () => {
  const root = await workspace();
  await initialize(root, "Self-describing errors");
  const misspelled = await rejection(recordOperation(root, operation("activity.record", { occured_at: "2026-09-10T04:00:00Z", action: "a", outcome: "b", related_ids: [], source_ids: [] })));
  const fieldIssue = JSON.parse(misspelled.message).issues.find((item) => item.field === "payload.occured_at");
  assert.equal(fieldIssue.code, "unknown_field");
  assert.equal(fieldIssue.did_you_mean, "payload.occurred_at");
  assert.ok(fieldIssue.supported_fields.includes("occurred_at"));
  assert.ok(fieldIssue.fix.includes("occurred_at"));

  const badType = await rejection(recordOperation(root, { ...operation("activity.record", {}), type: "activty.record" }));
  const typeIssue = JSON.parse(badType.message).issues.find((item) => item.code === "invalid_operation_type");
  assert.equal(typeIssue.did_you_mean, "activity.record");
  assert.ok(typeIssue.supported_types.includes("activity.record"));
});

test("missing required fields report expected type and the full required set", async () => {
  const root = await workspace();
  await initialize(root, "Missing fields");
  const failure = await rejection(recordOperation(root, operation("activity.record", { action: "no timestamps" })));
  const issues = JSON.parse(failure.message).issues;
  const missing = issues.find((item) => item.code === "missing_field" && item.field === "payload.outcome");
  assert.ok(missing, JSON.stringify(issues, null, 2));
  assert.equal(missing.expected_type, "string");
  assert.deepEqual(missing.required_fields, ["action", "outcome"]);
});

test("query reads only its target store, validates fields, and supports singleton project lookup", async () => {
  const root = await workspace();
  await initialize(root, "Query");
  const blocked = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Blocked work", status: "blocked", owner: "PM" }));
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Open work", status: "not_started", owner: "PM" }));

  const byId = await queryWorkspace(root, { id: blocked.schedule_item.id, fields: ["title", "status"] });
  assert.equal(byId.collection, "task");
  assert.deepEqual(byId.record, { title: "Blocked work", status: "blocked" });

  const filtered = await queryWorkspace(root, { target: "tasks", filters: { status: "blocked" } });
  assert.equal(filtered.count, 1);
  assert.equal(filtered.records[0].id, blocked.schedule_item.id);

  const limited = await queryWorkspace(root, { target: "task", limit: 1 });
  assert.equal(limited.count, 2);
  assert.equal(limited.truncated, true);
  assert.equal(limited.records.length, 1);

  const project = await queryWorkspace(root, { id: "PRJ-001", fields: ["name", "status"] });
  assert.deepEqual(project.record, { name: "Query", status: "active" });

  const badFilter = JSON.parse((await rejection(queryWorkspace(root, { target: "tasks", filters: { stats: "blocked" } }))).message);
  assert.equal(badFilter.code, "unknown_query_field");
  assert.equal(badFilter.did_you_mean, "status");
  const badProjection = JSON.parse((await rejection(queryWorkspace(root, { target: "tasks", fields: ["titel"] }))).message);
  assert.equal(badProjection.did_you_mean, "title");

  // 破坏无关事实源后仍能查询任务，证明 query 没有退回整库读取。
  await writeFile(path.join(root, ".harness/config.json"), "not-json\n", "utf8");
  assert.equal((await queryWorkspace(root, { id: blocked.schedule_item.id })).record.title, "Blocked work");

  const unknown = await rejection(queryWorkspace(root, { target: "taks" }));
  assert.equal(JSON.parse(unknown.message).did_you_mean, "tasks");
  await assert.rejects(queryWorkspace(root, { id: "ZZZ-001" }), (error) => JSON.parse(error.message).code === "unknown_id_prefix");
});

test("fast lint skips only content hashing and still checks contracts and Wiki registration", async () => {
  const root = await workspace();
  await initialize(root, "Fast lint");
  const full = await lintWorkspace(root);
  const fast = await lintWorkspace(root, { fast: true });
  assert.equal(full.mode, "full");
  assert.equal(fast.mode, "fast");
  assert.deepEqual(fast.skipped_checks, ["file_content_hash"]);
  assert.equal(fast.ok, true, JSON.stringify(fast.issues, null, 2));

  await writeFile(path.join(root, "knowledge/wiki/unregistered.md"), "# Unregistered\n", "utf8");
  const unregistered = await lintWorkspace(root, { fast: true });
  assert.ok(unregistered.issues.some((item) => item.code === "wiki_not_registered"));
  await unlink(path.join(root, "knowledge/wiki/unregistered.md"));

  await writeJsonFixture(root, "activity/log.json", { schema_version: SCHEMA_VERSION, entries: [{ id: "ACT-001" }] });
  const broken = await lintWorkspace(root, { fast: true });
  assert.equal(broken.ok, false);
});

test("generated contract reference stays in sync with the executable contract", async () => {
  const generated = renderOperationContract();
  for (const type of OPERATION_TYPES) assert.ok(generated.includes(`### \`${type}\``), `missing section for ${type}`);
  assert.ok(generated.includes("必填：`action`、`outcome`"));
  assert.ok(generated.includes("可省略并由 Harness 补全：`id`、`occurred_at`"));
  assert.ok(generated.includes("必填：`id`、`status`"), "transition operations require only id and status");
  assert.deepEqual(describeOperationContract("project.initialize").required, ["name", "timezone", "objective"]);
  assert.deepEqual(describeOperationContract("schedule.upsert").create_required, ["title"]);
  assert.ok(describeOperationContract("schedule.upsert").statuses.task.transitions.not_started.includes("in_progress"));
  const committed = await readFile(path.join(repositoryRoot, ".harness/references/operation-contract.md"), "utf8");
  assert.equal(committed, generated, "Run npm run docs:contract after changing model.mjs or contracts.mjs");
});

test("field suggestions fire on real typos and stay silent on unrelated names", async () => {
  const activityFields = ["id", "occurred_at", "action", "outcome", "related_ids", "source_ids", "evidence", "next_action", "recorded_at", "timestamp"];
  for (const [typo, expected] of [["occured_at", "occurred_at"], ["actoin", "action"], ["outcom", "outcome"], ["releated_ids", "related_ids"]]) {
    assert.equal(nearestName(typo, activityFields), expected, `${typo} should suggest ${expected}`);
  }
  // 无关字段必须不给建议，否则报错会把调用方带偏。
  for (const unrelated of ["kind", "title", "summary", "status", "owner", "type", "date", "x"]) {
    assert.equal(nearestName(unrelated, activityFields), null, `${unrelated} should not get a suggestion`);
  }
  assert.equal(nearestName("foo.bar", OPERATION_TYPES), null);
  assert.equal(nearestName("activty.record", OPERATION_TYPES), "activity.record");
});

test("dry-run previews record-level changes without writing anything", async () => {
  const root = await workspace();
  await initialize(root, "Dry run");
  const operationsBefore = (await readJson(root, "governance/change-log.json")).operations.length;
  const preview = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Preview task", owner: "PM", forecast_end: "2026-09-30" }), { dryRun: true });
  assert.equal(preview.dry_run, true);
  assert.equal(preview.committed, false);
  assert.deepEqual(preview.changed_stores, ["changes", "schedule"]);
  assert.ok(preview.would_write.includes("project/schedule.json"));
  const created = preview.changes.find((item) => item.change === "created" && item.collection === "tasks");
  assert.equal(created.after.title, "Preview task");

  // 预演不得留下任何痕迹：既不写事实源，也不占用幂等表里的 operation_id。
  const schedule = await readJson(root, "project/schedule.json");
  assert.equal(schedule.tasks.length, 0);
  const log = await readJson(root, "governance/change-log.json");
  assert.equal(log.operations.length, operationsBefore, "dry-run must not append to the idempotency log");
  assert.ok(!log.operations.some((item) => item.operation_id === preview.operation_id));
});

test("dry-run reports field-level before/after on updates", async () => {
  const root = await workspace();
  await initialize(root, "Dry run diff");
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Shift me", owner: "PM", forecast_end: "2026-09-20" }));
  const preview = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, forecast_end: "2026-09-27" } }), { dryRun: true });
  const updated = preview.changes.find((item) => item.id === task.schedule_item.id);
  assert.equal(updated.change, "updated");
  assert.ok(updated.fields.includes("forecast_end"));
  assert.equal(updated.before.forecast_end, "2026-09-20");
  assert.equal(updated.after.forecast_end, "2026-09-27");
  assert.equal((await readJson(root, "project/schedule.json")).tasks[0].forecast_end, "2026-09-20");
});

test("dry-run enforces approval and transition guardrails instead of bypassing them", async () => {
  const root = await workspace();
  await initialize(root, "Dry run guardrails");
  // 受控字段缺审批时，预演必须与真实写入一样失败，绝不能成为绕过审批的旁路。
  await assert.rejects(recordOperation(root, operation("project.update", { objective: "Silently changed" }), { dryRun: true }));

  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Closing", owner: "PM" }));
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "in_progress", actual_start: "2026-09-09" } }));
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "done", actual_end: "2026-09-10" } }));
  await assert.rejects(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "not_started" } }), { dryRun: true }));

  // 预演过的 operation_id 之后仍可正常真实写入。
  const envelope = operation("activity.record", { action: "Reused id", outcome: "Written for real", occurred_at: "2026-09-10T04:00:00Z", related_ids: [], source_ids: [], recorded_at: "2026-09-10T04:00:00Z" });
  await recordOperation(root, envelope, { dryRun: true });
  const real = await recordOperation(root, envelope);
  assert.equal(real.idempotent, false);
  assert.equal(real.ok, true);
});

test("invalid transitions return a structured error naming the legal targets", async () => {
  const root = await workspace();
  await initialize(root, "Transitions");
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Close me", owner: "PM" }));
  const skipped = await rejection(recordOperation(root, operation("deliverable.transition", { id: "DEL-404", status: "delivered" })));
  assert.ok(skipped);

  const forward = await rejection(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "done", actual_end: "2026-09-10" } })));
  const detail = JSON.parse(forward.message);
  assert.equal(detail.code, "invalid_transition");
  assert.equal(detail.kind, "task");
  assert.equal(detail.from, "not_started");
  assert.deepEqual(detail.allowed_targets, ["in_progress", "blocked", "cancelled"]);
  assert.ok(detail.fix.includes("in_progress"));

  // 终态必须明确告知"另建后继记录"，而不是只说不允许。
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "in_progress", actual_start: "2026-09-09" } }));
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "done", actual_end: "2026-09-10" } }));
  const reopened = JSON.parse((await rejection(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, status: "not_started" } })))).message);
  assert.deepEqual(reopened.allowed_targets, []);
  assert.ok(reopened.fix.includes("terminal state"));
});

test("an empty baseline cannot be approved and is caught by lint if already stored", async () => {
  const root = await workspace();
  await initialize(root, "Empty baseline");
  const approver = (await stakeholder(root, ["schedule_baseline"])).stakeholder;
  // 没有任何条目携带基线日期时，批准会让空快照的摘要自洽，必须在入口拒绝。
  const refused = JSON.parse((await rejection(recordOperation(root, operation("schedule.baseline.approve", {}, { approval: businessApproval(approver.id) })))).message);
  assert.equal(refused.code, "baseline_empty");
  assert.ok(refused.fix.includes("baseline_start"));

  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "No dates", owner: "PM" }));
  assert.ok((await rejection(recordOperation(root, operation("schedule.baseline.approve", {}, { approval: businessApproval(approver.id) })))).message.includes("baseline_empty"));

  // 已落盘的空批准状态过去可以通过 lint，因为空快照摘要恰好匹配。
  const schedule = await readJson(root, "project/schedule.json");
  schedule.baseline = { revision: 1, status: "approved", digest: schedule.baseline.digest, approved_by_id: approver.id, approved_at: minutesAgo(2), change_request_id: null };
  await writeJsonFixture(root, "project/schedule.json", schedule);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "baseline_empty"));
});

test("reapproving the same baseline is a safe no-op and cannot conceal approved baseline drift", async () => {
  const root = await workspace();
  await initialize(root, "Baseline replay");
  const approver = (await stakeholder(root, ["schedule_baseline"])).stakeholder;
  await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Release", baseline_end: "2026-09-30" }));
  const approved = await recordOperation(root, operation("schedule.baseline.approve", {}, { approval: businessApproval(approver.id) }));
  assert.equal(approved.baseline.revision, 1);
  assert.equal(approved.already_approved, false);

  const repeated = await recordOperation(root, operation("schedule.baseline.approve", {}));
  assert.equal(repeated.already_approved, true);
  assert.equal(repeated.baseline.revision, 1);
  const baselineChanges = (await readJson(root, "governance/change-log.json")).changes.filter((item) => item.kind === "schedule_baseline");
  assert.equal(baselineChanges.length, 1);

  const schedule = await readJson(root, "project/schedule.json");
  schedule.tasks[0].baseline_end = "2026-10-01";
  await writeJsonFixture(root, "project/schedule.json", schedule);
  const drift = JSON.parse((await rejection(recordOperation(root, operation("schedule.baseline.approve", {}, { approval: businessApproval(approver.id) })))).message);
  assert.equal(drift.code, "approved_baseline_drift");
});

test("filling many baseline dates under one change request produces a single revision", async () => {
  const root = await workspace();
  await initialize(root, "Batch baseline");
  const approver = (await stakeholder(root, ["schedule_baseline"])).stakeholder;
  const first = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Design", owner: "PM" }));
  const second = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Build", owner: "PM" }));
  const third = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Ship", owner: "PM" }));
  const ids = [first.schedule_item.id, second.schedule_item.id, third.schedule_item.id];
  const dates = { [ids[0]]: "2026-09-05", [ids[1]]: "2026-09-06", [ids[2]]: "2026-09-07" };

  const proposed = await recordOperation(root, operation("change.propose", {
    title: "Set the initial baseline",
    approval_scope: "schedule_baseline",
    target_ids: ids,
    change_items: ids.map((id) => ({ target_id: id, before: { baseline_start: null, baseline_end: null }, after: { baseline_start: "2026-09-01", baseline_end: dates[id] } })),
    before: "no baseline",
    after: "baseline set",
    reason: "Plan agreed",
    impact: "None",
    created_at: minutesAgo(5),
  }));
  await recordOperation(root, operation("change.approve", { id: proposed.change_request.id }, { approval: businessApproval(approver.id) }));

  const scheduleBefore = await readFile(path.join(root, "project/schedule.json"), "utf8");
  await assert.rejects(recordOperation(root, operation("schedule.batch-upsert", { items: [
    { collection: "tasks", record: { id: ids[0], baseline_start: "2026-09-01", baseline_end: dates[ids[0]] } },
    { collection: "tasks", record: { id: ids[1], baseline_start: "invalid", baseline_end: dates[ids[1]] } },
  ] }, { approval: businessApproval(approver.id, { change_request_id: proposed.change_request.id }) })), /record_validation_failed/);
  assert.equal(await readFile(path.join(root, "project/schedule.json"), "utf8"), scheduleBefore, "invalid batch must not write a partial baseline");

  const applied = await recordOperation(root, operation("schedule.batch-upsert", { items: ids.map((id) => ({
    collection: "tasks",
    record: { id, baseline_start: "2026-09-01", baseline_end: dates[id] },
  })) }, { approval: businessApproval(approver.id, { change_request_id: proposed.change_request.id }) }));
  assert.equal(applied.baseline.revision, 1);
  assert.deepEqual(applied.schedule_items.map((item) => item.id), ids);

  const changes = (await readJson(root, "governance/change-log.json")).changes.filter((item) => item.kind === "schedule_baseline");
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].target_ids, ids);
  assert.equal(changes[0].baseline_revision, 1);
  // 合并后的记录仍须与当前基线摘要一致，否则 lint 会判定缺少受控变更记录。
  const result = await lintWorkspace(root);
  assert.ok(!result.issues.some((item) => item.code === "baseline_approval_missing" || item.code === "baseline_empty"), JSON.stringify(result.issues));
  const request = (await readJson(root, "project/requirements.json")).change_requests[0];
  assert.equal(request.status, "implemented");
  assert.deepEqual(request.applied_target_ids, ids);
});

test("separate baseline operations remain append-only and revisions stay monotonic when change requests interleave", async () => {
  const root = await workspace();
  await initialize(root, "Interleaved baselines");
  const approver = (await stakeholder(root, ["schedule_baseline"])).stakeholder;
  const ids = [];
  for (const title of ["Design", "Build", "Ship"]) ids.push((await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title }))).schedule_item.id);

  async function approveChange(title, targetIds) {
    const proposed = await recordOperation(root, operation("change.propose", {
      title,
      approval_scope: "schedule_baseline",
      target_ids: targetIds,
      change_items: targetIds.map((id) => ({ target_id: id, before: { baseline_end: null }, after: { baseline_end: "2026-10-01" } })),
      before: "no date",
      after: "2026-10-01",
      reason: "Approved plan",
      impact: "Sets baseline",
      created_at: minutesAgo(5),
    }));
    await recordOperation(root, operation("change.approve", { id: proposed.change_request.id }, { approval: businessApproval(approver.id) }));
    return proposed.change_request.id;
  }

  const firstRequest = await approveChange("First group", ids.slice(0, 2));
  const secondRequest = await approveChange("Second group", ids.slice(2));
  const apply = (id, changeRequestId) => recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id, baseline_end: "2026-10-01" } }, { approval: businessApproval(approver.id, { change_request_id: changeRequestId }) }));
  const revisions = [];
  revisions.push((await apply(ids[0], firstRequest)).baseline.revision);
  const firstLogSnapshot = structuredClone((await readJson(root, "governance/change-log.json")).changes.find((item) => item.kind === "schedule_baseline"));
  revisions.push((await apply(ids[2], secondRequest)).baseline.revision);
  revisions.push((await apply(ids[1], firstRequest)).baseline.revision);

  assert.deepEqual(revisions, [1, 2, 3]);
  const baselineChanges = (await readJson(root, "governance/change-log.json")).changes.filter((item) => item.kind === "schedule_baseline");
  assert.deepEqual(baselineChanges[0], firstLogSnapshot, "later operations must not rewrite an existing CHG record");
  assert.deepEqual(baselineChanges.map((item) => item.baseline_revision), [1, 2, 3]);
  assert.equal((await lintWorkspace(root)).ok, true);

  const corruptedLog = await readJson(root, "governance/change-log.json");
  corruptedLog.changes.filter((item) => item.kind === "schedule_baseline").at(-1).baseline_revision = 1;
  await writeJsonFixture(root, "governance/change-log.json", corruptedLog);
  const corruptedSchedule = await readJson(root, "project/schedule.json");
  corruptedSchedule.baseline.revision = 1;
  await writeJsonFixture(root, "project/schedule.json", corruptedSchedule);
  assert.ok((await lintWorkspace(root)).issues.some((item) => item.code === "baseline_revision_nonmonotonic"));
});

test("composite payload types expose their element structure in docs and the contract command", async () => {
  // 过去 items 只出现一个类型名 inboxItemArray，写一条记录得去反推 inbox.json。
  const document = renderOperationContract();
  assert.ok(document.includes("`inboxItemArray` 的元素"));
  assert.ok(document.includes("由 Harness 补全，不要传：`id`、`source_id`、`created_at`"));
  for (const field of ["classification", "summary", "authority", "status"]) assert.ok(document.includes(`\`${field}\``));
  assert.ok(document.includes("`changeItems` 的元素"));
  assert.ok(document.includes("`operationArray` 的元素"));
  assert.ok(document.includes("`scheduleUpsertItemArray` 的元素"));

  const contract = describeOperationContract("source.register");
  assert.deepEqual(contract.composite_types.inboxItemArray.generated, ["id", "source_id", "created_at"]);
  assert.deepEqual(contract.composite_types.inboxItemArray.required, ["classification", "summary"]);
  assert.ok(contract.composite_types.inboxItemArray.defaults.includes("status"));
  assert.ok(contract.composite_types.inboxItemArray.fields.includes("classification"));
  assert.ok(!contract.composite_types.inboxItemArray.fields.includes("created_at"));
  const scheduleContract = describeOperationContract("schedule.batch-upsert");
  assert.ok(scheduleContract.composite_types.scheduleUpsertItemArray.record_fields.includes("baseline_end"));
  assert.equal(describeOperationContract("project.initialize").composite_types, undefined);
});

test("record --help explains usage instead of failing with input_required", async () => {
  const root = await workspace();
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [path.join(root, ".harness/scripts/harness.mjs"), ...args], { cwd: root, encoding: "utf8" }));
  const help = run("record", "--help");
  assert.equal(help.ok, true);
  assert.ok(help.usage.includes("record"));
  assert.ok(help.envelope_required.includes("operation_id"));
  const commands = run("--help").commands;
  for (const command of ["contract", "rebuild", "brief", "maintain", "init", "source-add", "activity-add", "docs-contract"]) assert.ok(commands.includes(command));
  // 真正缺少输入时仍须以非零退出码报错，--help 不能把失败路径也变成成功。
  const failure = await rejection(Promise.resolve().then(() => execFileSync(process.execPath, [path.join(root, ".harness/scripts/harness.mjs"), "record", "--data", "{}"], { cwd: root, encoding: "utf8" })));
  assert.equal(JSON.parse(failure.stdout).ok, false);
});

test("status and current memory updates are transactional and bounded", async () => {
  const root = await workspace();
  await initialize(root, "Summary sync");
  const status = await recordOperation(root, operation("status.update", {
    content: "# 项目状态：Summary sync\n\n## 当前重点\n\n完成摘要同步。\n\n## 阻塞与风险\n\n无。\n\n## 下一步\n\n继续推进。\n",
  }));
  assert.equal(status.document.path, "project/status.md");
  assert.match(await readFile(path.join(root, "project/status.md"), "utf8"), /完成摘要同步/);
  await compensateLastOperation(root, status.operation_id, { confirmedByUserAt: new Date().toISOString() });
  assert.doesNotMatch(await readFile(path.join(root, "project/status.md"), "utf8"), /完成摘要同步/);

  const memory = await recordOperation(root, operation("memory.current.update", {
    content: "# 当前工作记忆\n\n- 当前重点：摘要同步\n- 待确认：无\n- 下一步：继续推进\n- 最近更新：2026-09-12T00:00:00.000Z\n",
  }));
  assert.equal(memory.document.path, "memory/current.md");
  assert.match(await readFile(path.join(root, "memory/current.md"), "utf8"), /摘要同步/);

  const config = await readJson(root, ".harness/config.json");
  config.memory_current_max_bytes = 32;
  await writeJsonFixture(root, ".harness/config.json", config);
  await assert.rejects(recordOperation(root, operation("memory.current.update", {
    content: "# 当前工作记忆\n\n- 当前重点：这段内容超过配置上限\n- 待确认：无\n- 下一步：无\n",
  })), /memory_current_too_large/);
});

test("readJson reports an actionable structured error for malformed stores", async () => {
  const root = await workspace();
  await writeFile(path.join(root, "project/project.json"), "not-json\n", "utf8");
  const error = await rejection(readJson(root, "project/project.json"));
  const details = JSON.parse(error.message);
  assert.equal(details.code, "invalid_json");
  assert.equal(details.path, "project/project.json");
  assert.ok(details.fix);
});

test("lint warns before a structured store grows too large", async () => {
  const root = await workspace();
  const config = await readJson(root, ".harness/config.json");
  config.large_tracked_file_mb = 0.0001;
  await writeJsonFixture(root, ".harness/config.json", config);
  const lint = await lintWorkspace(root, { fast: true });
  assert.ok(lint.issues.some((item) => item.code === "store_size_large"));
});

test("approval guardrails return an actionable fix, not just an error code", async () => {
  const root = await workspace();
  await initialize(root, "Guardrail messages");
  const approver = (await stakeholder(root, ["schedule_baseline"])).stakeholder;
  const task = await recordOperation(root, operation("schedule.upsert", { collection: "tasks", title: "Release", owner: "PM", baseline_start: "2026-09-01", baseline_end: "2026-09-10" }, { approval: businessApproval(approver.id) }));

  const proposed = await recordOperation(root, operation("change.propose", { title: "Slip", approval_scope: "schedule_baseline", target_ids: [task.schedule_item.id], change_items: [{ target_id: task.schedule_item.id, before: { baseline_end: "2026-09-10" }, after: { baseline_end: "2026-09-12" } }], before: "10th", after: "12th", reason: "Delay", impact: "Two days", created_at: new Date().toISOString() }));
  // 审批时间早于变更请求创建时间时，报错必须说清"时间戳需要递增"。
  const ordering = JSON.parse((await rejection(recordOperation(root, operation("change.approve", { id: proposed.change_request.id }, { approval: businessApproval(approver.id, { approved_at: minutesAgo(30) }) })))).message);
  assert.equal(ordering.code, "approval_predates_change_request");
  assert.ok(ordering.fix.includes("created_at"));
  assert.ok(ordering.created_at && ordering.approved_at);

  const unscoped = (await stakeholder(root, [])).stakeholder;
  const scope = JSON.parse((await rejection(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, baseline_end: "2026-09-13" } }, { approval: businessApproval(unscoped.id) })))).message);
  assert.ok(scope.fix.includes("schedule_baseline"));
  const missingRequest = JSON.parse((await rejection(recordOperation(root, operation("schedule.upsert", { collection: "tasks", record: { id: task.schedule_item.id, baseline_end: "2026-09-14" } }, { approval: businessApproval(approver.id) })))).message);
  assert.equal(missingRequest.code, "approved_change_request_required");
  assert.ok(missingRequest.fix.includes("change.propose"));
});
