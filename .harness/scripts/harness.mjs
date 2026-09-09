#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendActivityEntry,
  buildDailyBrief,
  initializeProject,
  lintWorkspace,
  maintainWorkspace,
  migrateWorkspaceV1ToV2,
  recordOperation,
  rebuildWorkspace,
  registerSource,
  sha256File,
} from "../lib/core.mjs";

function hasFlag(name) {
  return process.argv.includes(name);
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function loadInput() {
  const input = flagValue("--input");
  if (!input) throw new Error("This operation requires --input <json-file>");
  return JSON.parse(await readFile(path.resolve(process.cwd(), input), "utf8"));
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const command = process.argv[2];
const root = process.cwd();

try {
  if (command === "rebuild") {
    print(await rebuildWorkspace(root));
  } else if (command === "lint") {
    const result = await lintWorkspace(root);
    if (hasFlag("--json")) print(result);
    else {
      for (const issue of result.issues) process.stdout.write(`${issue.level.toUpperCase()} ${issue.code} ${issue.path}: ${issue.message}\n`);
      process.stdout.write(`Errors: ${result.counts.error}; warnings: ${result.counts.warning}; info: ${result.counts.info}\n`);
    }
    if (!result.ok) process.exitCode = 1;
  } else if (command === "brief") {
    print(await buildDailyBrief(root));
  } else if (command === "record") {
    print(await recordOperation(root, await loadInput()));
  } else if (command === "maintain") {
    print(await maintainWorkspace(root));
  } else if (command === "migrate") {
    print(await migrateWorkspaceV1ToV2(root, await loadInput()));
  } else if (command === "init") {
    print(await initializeProject(root, await loadInput()));
  } else if (command === "source-add") {
    print(await registerSource(root, await loadInput()));
  } else if (command === "activity-add") {
    print(await appendActivityEntry(root, await loadInput()));
  } else if (command === "hash") {
    const target = process.argv[3];
    if (!target) throw new Error("hash requires a file path");
    print({ path: target, sha256: await sha256File(path.resolve(root, target)) });
  } else {
    throw new Error("Usage: harness.mjs <record|maintain|migrate|rebuild|lint|brief|init|source-add|activity-add|hash> [--input file] [--json]");
  }
} catch (error) {
  let details;
  try {
    details = JSON.parse(error.message);
  } catch {
    details = { code: "operation_failed", message: error.message };
  }
  print({ ok: false, error: details, suggestion: details.fix || "Review the structured error and correct the input or obtain the required approval; do not retry unchanged input repeatedly" });
  process.exitCode = 1;
}
