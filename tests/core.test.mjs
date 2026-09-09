import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  buildDailyBrief,
  initializeProject,
  lintWorkspace,
  readJson,
  rebuildWorkspace,
  registerSource,
  renderGantt,
  writeJsonAtomic,
} from "../.harness/lib/core.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pm-harness-test-"));
  for (const item of [".harness", "project", "knowledge", "memory", "deliverables", "governance", "archive", "activity", "skills", "templates"]) {
    await cp(path.join(repositoryRoot, item), path.join(root, item), { recursive: true });
  }
  await mkdir(path.join(root, ".agents"), { recursive: true });
  await symlink("../skills", path.join(root, ".agents/skills"));
  return root;
}

test("renders baseline, forecast, actual, and visible variance", () => {
  const output = renderGantt(
    { name: "Launch" },
    {
      milestones: [],
      tasks: [{
        id: "TASK-001",
        title: "Prepare release",
        status: "in_progress",
        baseline_start: "2026-09-01",
        baseline_end: "2026-09-05",
        forecast_start: "2026-09-01",
        forecast_end: "2026-09-07",
        actual_start: "2026-09-02",
        actual_end: null,
        next_action: "Complete review",
      }],
    },
  );
  assert.match(output, /延期 2 天/);
  assert.match(output, /2026-09-01 → 2026-09-05/);
  assert.match(output, /active, task_001/);
});

test("base template rebuilds and passes with no errors", async () => {
  const root = await workspace();
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.counts.error, 0);
});

test("lint detects duplicate IDs, bad date order, missing dependency, and dependency cycles", async () => {
  const root = await workspace();
  await writeJsonAtomic(root, "project/schedule.json", {
    schema_version: 1,
    milestones: [{ id: "MS-001", title: "Gate", status: "not_started" }],
    tasks: [
      {
        id: "TASK-001",
        title: "First",
        status: "in_progress",
        baseline_start: "2026-09-10",
        baseline_end: "2026-09-01",
        dependency_ids: ["TASK-999"],
      },
      { id: "TASK-001", title: "Duplicate", status: "not_started" },
      { id: "TASK-002", title: "Cycle A", status: "not_started", dependency_ids: ["TASK-003"] },
      { id: "TASK-003", title: "Cycle B", status: "not_started", dependency_ids: ["TASK-002"] },
    ],
  });
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  const codes = result.issues.map((item) => item.code);
  assert.equal(result.ok, false);
  assert.ok(codes.includes("duplicate_id"));
  assert.ok(codes.includes("date_order"));
  assert.ok(codes.includes("missing_dependency"));
  assert.ok(codes.includes("dependency_cycle"));
});

test("daily brief separates overdue, blocked, and due-soon work", async () => {
  const root = await workspace();
  await initializeProject(root, {
    name: "Brief test",
    objective: "Ship",
    timezone: "Asia/Hong_Kong",
    success_criteria: ["Accepted"],
  });
  await writeJsonAtomic(root, "project/schedule.json", {
    schema_version: 1,
    milestones: [],
    tasks: [
      { id: "TASK-001", title: "Late", status: "in_progress", forecast_end: "2026-09-08", updated_at: "2026-08-01T00:00:00Z" },
      { id: "TASK-002", title: "Blocked", status: "blocked", forecast_end: "2026-09-11" },
      { id: "TASK-003", title: "Later", status: "not_started", forecast_end: "2026-10-01" },
    ],
  });
  const brief = await buildDailyBrief(root, new Date("2026-09-09T02:00:00Z"));
  assert.deepEqual(brief.overdue.map((item) => item.id), ["TASK-001"]);
  assert.deepEqual(brief.stale.map((item) => item.id), ["TASK-001"]);
  assert.deepEqual(brief.blocked.map((item) => item.id), ["TASK-002"]);
  assert.ok(brief.due_soon.some((item) => item.id === "TASK-002"));
  assert.ok(!brief.due_soon.some((item) => item.id === "TASK-003"));
});

test("source registration archives raw material outside the tracked knowledge set", async () => {
  const root = await workspace();
  await writeFile(path.join(root, "mail.txt"), "Please move the review to Friday", "utf8");
  const result = await registerSource(root, {
    type: "email",
    title: "Review timing",
    sender: "Sponsor",
    source_time: "2026-09-09T09:00:00+08:00",
    raw_path: "mail.txt",
    items: [{
      classification: "request",
      summary: "Move review to Friday",
      confidence: 1,
      proposed_action: "create_change_request",
    }],
  });
  assert.equal(result.source.id, "SRC-001");
  assert.match(result.source.archived_path, /^archive\/files\/2026\/SRC-001-/);
  assert.equal(result.source.sha256.length, 64);
  const inbox = await readJson(root, "knowledge/inbox.json");
  assert.equal(inbox.items[0].source_id, "SRC-001");
  assert.equal(inbox.items[0].status, "new");
  const archive = await readJson(root, "archive/index.json");
  assert.equal(archive.files[0].id, "ARC-001");
  assert.equal(archive.files[0].logical_id, "SRC-001");
  assert.equal(archive.files[0].source_id, "SRC-001");
  assert.equal(archive.files[0].sha256, result.source.sha256);

  const duplicate = await registerSource(root, {
    type: "email",
    title: "Repeated copy",
    raw_path: "mail.txt",
    items: [{ classification: "request", summary: "Duplicate" }],
  });
  assert.equal(duplicate.duplicate_of, "SRC-001");
  assert.equal((await readJson(root, "knowledge/sources.json")).sources.length, 1);
});

test("generated deliverable index distinguishes delivery and acceptance", async () => {
  const root = await workspace();
  await writeFile(path.join(root, "deliverables/current/report-v01.md"), "# Report\n", "utf8");
  await writeJsonAtomic(root, "deliverables/index.json", {
    schema_version: 1,
    deliverables: [{
      id: "DEL-001",
      title: "Report",
      type: "status_report",
      version: "v01",
      status: "review",
      path: "deliverables/current/report-v01.md",
      due_at: "2026-09-10",
      delivered_at: null,
      accepted_at: null,
    }],
  });
  await rebuildWorkspace(root);
  const generated = await readFile(path.join(root, "deliverables/index.md"), "utf8");
  assert.match(generated, /review/);
  assert.match(generated, /已交付/);
  const lint = await lintWorkspace(root);
  assert.equal(lint.ok, true, JSON.stringify(lint.issues, null, 2));
});

test("repeated observation patterns become rule candidates without activating rules", async () => {
  const root = await workspace();
  await writeJsonAtomic(root, "memory/observations.json", {
    schema_version: 1,
    observations: [
      { id: "OBS-001", title: "Missed owner", pattern_key: "missing-owner", status: "open" },
      { id: "OBS-002", title: "Owner missing again", pattern_key: "missing-owner", status: "open" },
    ],
  });
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((item) => item.code === "rule_candidate"));
  assert.equal((await readJson(root, "governance/proposals.json")).proposals.length, 0);
});

test("Git policy rejects tracked archives and credential files", async () => {
  const root = await workspace();
  execFileSync("git", ["init", "-q"], { cwd: root });
  await mkdir(path.join(root, "archive/files/2026"), { recursive: true });
  await writeFile(path.join(root, "archive/files/2026/mail.png"), "raw", "utf8");
  await writeFile(path.join(root, ".env"), "TOKEN=secret", "utf8");
  execFileSync("git", ["add", "-f", "archive/files/2026/mail.png", ".env"], { cwd: root });
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  const codes = result.issues.map((item) => item.code);
  assert.equal(result.ok, false);
  assert.ok(codes.includes("archive_tracked"));
  assert.ok(codes.includes("secret_file_tracked"));
});

test("lint enforces evidence-backed rule proposal records", async () => {
  const root = await workspace();
  await writeJsonAtomic(root, "memory/observations.json", {
    schema_version: 1,
    observations: [{ id: "OBS-001", title: "Recurring omission", pattern_key: "missing-owner", status: "open", proposal_id: "RULE-001" }],
  });
  await writeJsonAtomic(root, "governance/proposals.json", {
    schema_version: 1,
    proposals: [{ id: "RULE-001", title: "Incomplete proposal", status: "active", observation_ids: ["OBS-999"] }],
  });
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  const codes = result.issues.map((item) => item.code);
  assert.equal(result.ok, false);
  assert.ok(codes.includes("missing_reference"));
  assert.ok(codes.includes("proposal_metadata_missing"));
  assert.ok(codes.includes("approval_missing"));
  assert.ok(codes.includes("effective_time_missing"));
});

test("lint requires explicit deliverable supersession links", async () => {
  const root = await workspace();
  await writeJsonAtomic(root, "deliverables/index.json", {
    schema_version: 1,
    deliverables: [{
      id: "DEL-001",
      title: "Old report",
      type: "status_report",
      version: "v01",
      status: "superseded",
      path: null,
    }],
  });
  await rebuildWorkspace(root);
  const result = await lintWorkspace(root);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === "supersession_missing"));
});
