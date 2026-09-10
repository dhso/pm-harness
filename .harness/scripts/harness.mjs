#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendActivityEntry,
  buildDailyBrief,
  describeOperationContract,
  initializeProject,
  lintWorkspace,
  maintainWorkspace,
  OPERATION_CONTRACT_PATH,
  queryWorkspace,
  recordOperation,
  rebuildWorkspace,
  registerSource,
  renderOperationContract,
  sha256File,
} from "../lib/core.mjs";

function hasFlag(name) {
  return process.argv.includes(name);
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

// 入参支持 --data '<json>' 内联、--input <file>，以及管道 stdin，
// 省去为每次写入先落一个临时文件。
async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw || null;
}

function parseJson(raw, origin) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(JSON.stringify({ code: "invalid_json_input", origin, message: error.message, fix: "Provide a single valid JSON object" }));
  }
}

async function loadInput() {
  const inline = flagValue("--data");
  if (inline) return parseJson(inline, "--data");
  const input = flagValue("--input");
  if (input) return parseJson(await readFile(path.resolve(process.cwd(), input), "utf8"), input);
  const piped = await readStdin();
  if (piped) return parseJson(piped, "stdin");
  throw new Error(JSON.stringify({ code: "input_required", fix: "Pass --data '<json>', --input <json-file>, or pipe JSON on stdin" }));
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, hasFlag("--compact") ? 0 : 2)}\n`);
}

const command = process.argv[2];
const root = process.cwd();

const USAGE = {
  record: "harness.mjs record [--data '<json>'|--input <file>|stdin] [--dry-run] [--compact] — 写入一条操作；字段见 contract <type> 或 .harness/references/operation-contract.md",
  query: "harness.mjs query <target|ID> [--id <id>] [--fields a,b] [--limit n] [--compact] — 读取工作区记录",
  contract: "harness.mjs contract <operation-type> — 输出该操作的 payload 契约、必填字段与状态转换",
  rebuild: "harness.mjs rebuild — 从事实源重建自动生成的索引、甘特图和视图",
  lint: "harness.mjs lint [--fast] [--json] — 校验工作区",
  brief: "harness.mjs brief — 生成每日项目工作简报",
  maintain: "harness.mjs maintain — 执行完整维护与哈希检查",
  init: "harness.mjs init [--data '<json>'|--input <file>|stdin] — 兼容的项目初始化入口",
  "source-add": "harness.mjs source-add [--data '<json>'|--input <file>|stdin] — 兼容的来源登记入口",
  "activity-add": "harness.mjs activity-add [--data '<json>'|--input <file>|stdin] — 兼容的活动登记入口",
  "docs-contract": "harness.mjs docs-contract — 重新生成操作契约参考文档",
  hash: "harness.mjs hash <file> — 计算文件 sha256",
};

// --help 必须自解释：过去 `record --help` 会掉进 input_required，把用法问题伪装成输入问题。
if (hasFlag("--help") || hasFlag("-h") || command === "help") {
  const topic = command === "help" ? process.argv[3] : command;
  if (USAGE[topic]) print({ ok: true, usage: USAGE[topic], ...(topic === "record" ? { envelope_required: ["schema_version", "operation_id", "type", "actor", "reason", "source_ids", "payload"], hint: "记录字段放在 payload 内；用 contract <type> 查具体字段" } : {}) });
  else print({ ok: true, commands: Object.keys(USAGE), usage: "harness.mjs <command> --help 查看单个命令用法" });
  process.exit(0);
}

try {
  if (command === "rebuild") {
    print(await rebuildWorkspace(root));
  } else if (command === "lint") {
    const result = await lintWorkspace(root, { fast: hasFlag("--fast") });
    if (hasFlag("--json")) print(result);
    else {
      for (const issue of result.issues) process.stdout.write(`${issue.level.toUpperCase()} ${issue.code} ${issue.path}: ${issue.message}\n`);
      process.stdout.write(`Errors: ${result.counts.error}; warnings: ${result.counts.warning}; info: ${result.counts.info}\n`);
    }
    if (!result.ok) process.exitCode = 1;
  } else if (command === "brief") {
    print(await buildDailyBrief(root));
  } else if (command === "record") {
    print(await recordOperation(root, await loadInput(), { dryRun: hasFlag("--dry-run") }));
  } else if (command === "maintain") {
    print(await maintainWorkspace(root));
  } else if (command === "init") {
    print(await initializeProject(root, await loadInput()));
  } else if (command === "source-add") {
    print(await registerSource(root, await loadInput()));
  } else if (command === "activity-add") {
    print(await appendActivityEntry(root, await loadInput()));
  } else if (command === "query") {
    // query <collection|id> [--id ID] [--where field=value ...] [--fields a,b] [--limit n]
    const positional = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
    const explicitId = flagValue("--id");
    const looksLikeId = positional && /^[A-Z]+-\d+$/i.test(positional);
    const filters = {};
    for (let index = 0; index < process.argv.length; index += 1) {
      if (process.argv[index] !== "--where") continue;
      const clause = process.argv[index + 1] || "";
      const separator = clause.indexOf("=");
      if (separator <= 0) throw new Error(JSON.stringify({ code: "invalid_where", clause, fix: "Use --where field=value" }));
      filters[clause.slice(0, separator)] = clause.slice(separator + 1);
    }
    print(await queryWorkspace(root, {
      target: looksLikeId ? null : positional,
      id: explicitId || (looksLikeId ? positional : null),
      filters,
      fields: (flagValue("--fields") || "").split(",").map((item) => item.trim()).filter(Boolean),
      limit: Number(flagValue("--limit") || 0),
    }));
  } else if (command === "contract") {
    const type = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
    if (!type) throw new Error(JSON.stringify({ code: "operation_type_required", fix: "Use contract <operation-type>" }));
    print(describeOperationContract(type));
  } else if (command === "docs-contract") {
    const target = path.join(root, OPERATION_CONTRACT_PATH);
    await writeFile(target, renderOperationContract());
    print({ ok: true, generated: OPERATION_CONTRACT_PATH });
  } else if (command === "hash") {
    const target = process.argv[3];
    if (!target) throw new Error("hash requires a file path");
    print({ path: target, sha256: await sha256File(path.resolve(root, target)) });
  } else {
    throw new Error("Usage: harness.mjs <record|query|contract|maintain|rebuild|lint|brief|init|source-add|activity-add|docs-contract|hash> [--data json|--input file] [--dry-run] [--json] [--fast] [--compact]");
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
