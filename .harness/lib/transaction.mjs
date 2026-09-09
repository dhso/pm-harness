import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

function safeTarget(root, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) throw new Error(`Transaction path must be relative: ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(root, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Transaction path escapes workspace: ${relativePath}`);
  return target;
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

export async function commitTransaction(root, operationId, entries, options = {}) {
  if (!Array.isArray(entries) || !entries.length) return { committed: [] };
  const duplicatePaths = entries.map((item) => item.path).filter((item, index, list) => list.indexOf(item) !== index);
  if (duplicatePaths.length) throw new Error(`Transaction contains duplicate paths: ${[...new Set(duplicatePaths)].join(", ")}`);

  const temporaryRoot = path.join(root, ".harness", "tmp");
  const lockPath = path.join(temporaryRoot, "write.lock");
  const transactionRoot = path.join(temporaryRoot, `tx-${safeName(operationId)}`);
  await mkdir(temporaryRoot, { recursive: true });

  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another Harness write is in progress; stop instead of retrying repeatedly");
    throw error;
  }

  const prepared = [];
  const touched = [];
  try {
    await mkdir(transactionRoot, { recursive: true });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const target = safeTarget(root, entry.path);
      const staged = path.join(transactionRoot, "new", `${index}.data`);
      const backup = path.join(transactionRoot, "old", `${index}.data`);
      if (!entry.delete) {
        await mkdir(path.dirname(staged), { recursive: true });
        await writeFile(staged, entry.content);
      }
      prepared.push({ ...entry, target, staged, backup, existed: existsSync(target) });
    }

    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      await mkdir(path.dirname(item.target), { recursive: true });
      if (item.existed) {
        await mkdir(path.dirname(item.backup), { recursive: true });
        await rename(item.target, item.backup);
      }
      touched.push(item);
      if (Number.isInteger(options.failAfter) && index >= options.failAfter) throw new Error("Injected transaction failure");
      if (!item.delete) await rename(item.staged, item.target);
    }
    return { committed: prepared.map((item) => item.path) };
  } catch (error) {
    for (const item of [...touched].reverse()) {
      if (existsSync(item.target)) await rm(item.target, { force: true });
      if (item.existed && existsSync(item.backup)) {
        await mkdir(path.dirname(item.target), { recursive: true });
        await rename(item.backup, item.target);
      }
    }
    throw error;
  } finally {
    await lock?.close();
    await rm(lockPath, { force: true });
    await rm(transactionRoot, { recursive: true, force: true });
  }
}

export function jsonEntry(relativePath, value) {
  return { path: relativePath, content: `${JSON.stringify(value, null, 2)}\n` };
}

export async function fileEntry(relativePath, sourcePath) {
  return { path: relativePath, content: await readFile(sourcePath) };
}
