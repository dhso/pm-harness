import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDailyBrief,
  lintWorkspace,
  maintainWorkspace,
  readJson,
  rebuildWorkspace,
  recordOperation,
  renderGantt,
} from "../.harness/lib/core.mjs";
import { SCHEMA_VERSION } from "../.harness/lib/model.mjs";
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
});

test("approved requirement replacement closes both sides of the supersession chain", async () => {
  const root = await workspace();
  await initialize(root);
  const approver = (await stakeholder(root, ["requirement"])).stakeholder;
  const old = await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV", status: "approved", acceptance_criteria: ["CSV downloads"], source_ids: [] }, { approval: businessApproval(approver.id) }));
  const replacement = await recordOperation(root, operation("requirement.upsert", { title: "Export", description: "Export CSV and XLSX", status: "candidate", acceptance_criteria: ["CSV and XLSX download"], source_ids: [], supersedes_id: old.requirement.id }));
  await recordOperation(root, operation("requirement.upsert", { id: replacement.requirement.id, status: "proposed" }));
  const exact = {
    target_id: old.requirement.id,
    before: { status: "approved", superseded_by_id: null },
    after: { status: "superseded", superseded_by_id: replacement.requirement.id, replacement: { title: "Export", description: "Export CSV and XLSX", acceptance_criteria: ["CSV and XLSX download"] } },
  };
  const change = await recordOperation(root, operation("change.propose", { title: "Replace export requirement", approval_scope: "requirement", target_ids: [old.requirement.id], change_items: [exact], before: "CSV only", after: "CSV and XLSX", reason: "Customer need", impact: "Broader export scope", created_at: minutesAgo(5) }));
  await recordOperation(root, operation("change.approve", { id: change.change_request.id }, { approval: businessApproval(approver.id) }));
  await recordOperation(root, operation("requirement.upsert", { id: replacement.requirement.id, status: "approved" }, { approval: businessApproval(approver.id, { change_request_id: change.change_request.id }) }));
  const records = (await readJson(root, "project/requirements.json")).requirements;
  assert.equal(records.find((item) => item.id === old.requirement.id).superseded_by_id, replacement.requirement.id);
  assert.equal(records.find((item) => item.id === replacement.requirement.id).supersedes_id, old.requirement.id);
  assert.equal((await lintWorkspace(root)).ok, true);
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

test("Git keeps the necessary set, excludes raw archives, and flags forced archives or credentials", async () => {
  const root = await workspace();
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  const modes = execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" });
  assert.ok(!modes.split("\n").some((line) => line.startsWith("120000 ")));
  await mkdir(path.join(root, "archive/files/2026"), { recursive: true });
  await writeFile(path.join(root, "archive/files/2026/mail.png"), "raw", "utf8");
  assert.match(execFileSync("git", ["check-ignore", "archive/files/2026/mail.png"], { cwd: root, encoding: "utf8" }), /mail\.png/);
  await writeFile(path.join(root, ".env"), "TOKEN=secret", "utf8");
  execFileSync("git", ["add", "-f", "archive/files/2026/mail.png", ".env"], { cwd: root });
  const lint = await lintWorkspace(root);
  const codes = lint.issues.map((item) => item.code);
  assert.ok(codes.includes("archive_tracked"));
  assert.ok(codes.includes("secret_file_tracked"));
});

test("agent-only CLI exposes record, brief, maintain, and structured errors", async () => {
  const root = await workspace();
  const inputPath = path.join(root, ".harness/tmp/operation.json");
  await mkdir(path.dirname(inputPath), { recursive: true });
  await writeFile(inputPath, `${JSON.stringify(operation("project.initialize", { name: "CLI project", objective: "Verify CLI", timezone: "Asia/Hong_Kong", scope_in: [], scope_out: [], success_criteria: ["Works"], constraints: [] }), null, 2)}\n`, "utf8");
  const script = path.join(root, ".harness/scripts/harness.mjs");
  const recorded = JSON.parse(execFileSync(process.execPath, [script, "record", "--input", inputPath], { cwd: root, encoding: "utf8" }));
  assert.equal(recorded.ok, true);
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
