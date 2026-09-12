import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";

const LOCK_STALE_AFTER_MS = 30 * 60 * 1000;
const LOCK_RECOVERY_FILE = "write-lock-recovery.lock";

function safeTarget(root, relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) throw new Error(`Transaction path must be relative: ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(root, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Transaction path escapes workspace: ${relativePath}`);
  let current = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, target).split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Transaction path uses a symbolic-link directory: ${relativePath}`);
  }
  return target;
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

async function releaseOwnedLock(handle, lockPath, token) {
  await handle.close();
  try {
    const owner = JSON.parse(await readFile(lockPath, "utf8"));
    if (owner.token === token) await rm(lockPath, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function acquireRecoveryLock(temporaryRoot) {
  const recoveryPath = path.join(temporaryRoot, LOCK_RECOVERY_FILE);
  const token = randomUUID();
  let handle;
  try {
    handle = await open(recoveryPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(JSON.stringify({
        code: "workspace_lock_recovery_busy",
        path: `.harness/tmp/${LOCK_RECOVERY_FILE}`,
        fix: "Another process is recovering the workspace lock; wait for it to finish, then retry once",
      }));
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, hostname: hostname(), acquired_at: new Date().toISOString() })}\n`);
  } catch (error) {
    await handle.close();
    await rm(recoveryPath, { force: true });
    throw error;
  }
  return () => releaseOwnedLock(handle, recoveryPath, token);
}

export async function acquireWorkspaceLock(root) {
  const temporaryRoot = path.join(root, ".harness", "tmp");
  const lockPath = path.join(temporaryRoot, "write.lock");
  await mkdir(temporaryRoot, { recursive: true });
  const token = randomUUID();
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      const releaseRecovery = await acquireRecoveryLock(temporaryRoot);
      try {
        // 锁可能在等待 recovery lock 时已正常释放；先做一次无破坏的获取。
        try {
          lock = await open(lockPath, "wx");
        } catch (retryError) {
          if (retryError.code !== "EEXIST") throw retryError;
          const stale = await staleLock(lockPath);
          if (!stale) throw new Error(JSON.stringify({ code: "workspace_busy", fix: "Another Harness write is in progress; wait for it to finish, then retry once" }));
          await rm(lockPath, { force: true });
          try {
            lock = await open(lockPath, "wx");
          } catch (claimError) {
            if (claimError.code === "EEXIST") throw new Error(JSON.stringify({ code: "workspace_busy", fix: "Another Harness write acquired the workspace during recovery; wait for it to finish, then retry once" }));
            throw claimError;
          }
        }
      } finally {
        await releaseRecovery();
      }
    } else throw error;
  }
  try {
    await lock.writeFile(`${JSON.stringify({ token, pid: process.pid, hostname: hostname(), acquired_at: new Date().toISOString() })}\n`);
    await recoverTransactions(root);
  } catch (error) {
    await lock.close();
    await rm(lockPath, { force: true });
    throw error;
  }
  return () => releaseOwnedLock(lock, lockPath, token);
}

async function staleLock(lockPath) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    const details = await stat(lockPath).catch(() => null);
    return Boolean(details && Date.now() - details.mtimeMs > LOCK_STALE_AFTER_MS);
  }
  const acquiredAt = Date.parse(metadata.acquired_at || "");
  if (metadata.hostname === hostname() && Number.isInteger(metadata.pid) && metadata.pid > 0) {
    try {
      process.kill(metadata.pid, 0);
      return false;
    } catch (error) {
      if (error.code === "EPERM") return false;
      return true;
    }
  }
  return !Number.isFinite(acquiredAt) || Date.now() - acquiredAt > LOCK_STALE_AFTER_MS;
}

async function writeManifest(transactionRoot, manifest) {
  await writeFile(path.join(transactionRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function recoverTransactions(root) {
  const temporaryRoot = path.join(root, ".harness", "tmp");
  const entries = await readdir(temporaryRoot, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory() && item.name.startsWith("tx-"))) {
    const transactionRoot = path.join(temporaryRoot, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(transactionRoot, "manifest.json"), "utf8"));
    } catch {
      throw new Error(JSON.stringify({ code: "transaction_recovery_required", path: `.harness/tmp/${entry.name}`, fix: "Preserve the transaction directory and inspect it before retrying" }));
    }
    if (manifest.phase === "committed") {
      await rm(transactionRoot, { recursive: true, force: true });
      continue;
    }
    for (const item of [...(manifest.entries || [])].reverse()) {
      const target = safeTarget(root, item.path);
      const backup = path.join(transactionRoot, "old", `${item.index}.data`);
      if (item.existed && existsSync(backup)) {
        if (existsSync(target)) await rm(target, { force: true });
        await mkdir(path.dirname(target), { recursive: true });
        await rename(backup, target);
      } else if (!item.existed && existsSync(target)) {
        await rm(target, { force: true });
      }
    }
    await rm(transactionRoot, { recursive: true, force: true });
  }
}

export async function withWorkspaceLock(root, run) {
  const release = await acquireWorkspaceLock(root);
  try {
    return await run();
  } finally {
    await release();
  }
}

export async function commitTransaction(root, operationId, entries, options = {}) {
  if (!options.lockHeld) {
    return withWorkspaceLock(root, () => commitTransaction(root, operationId, entries, { ...options, lockHeld: true }));
  }
  if (!Array.isArray(entries) || !entries.length) return { committed: [] };
  const duplicatePaths = entries.map((item) => item.path).filter((item, index, list) => list.indexOf(item) !== index);
  if (duplicatePaths.length) throw new Error(`Transaction contains duplicate paths: ${[...new Set(duplicatePaths)].join(", ")}`);

  const temporaryRoot = path.join(root, ".harness", "tmp");
  const transactionRoot = path.join(temporaryRoot, `tx-${safeName(operationId)}`);
  await mkdir(temporaryRoot, { recursive: true });

  const prepared = [];
  const touched = [];
  let cleanupTransaction = false;
  try {
    await mkdir(transactionRoot, { recursive: true });
    await writeManifest(transactionRoot, { version: 1, operation_id: operationId, phase: "prepared", entries: [] });
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
    await writeManifest(transactionRoot, {
      version: 1,
      operation_id: operationId,
      phase: "applying",
      entries: prepared.map((item, index) => ({ index, path: item.path, existed: item.existed, delete: Boolean(item.delete) })),
    });

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
    await writeManifest(transactionRoot, {
      version: 1,
      operation_id: operationId,
      phase: "committed",
      entries: prepared.map((item, itemIndex) => ({ index: itemIndex, path: item.path, existed: item.existed, delete: Boolean(item.delete) })),
    });
    cleanupTransaction = true;
    return { committed: prepared.map((item) => item.path) };
  } catch (error) {
    try {
      for (const item of [...touched].reverse()) {
        if (existsSync(item.target)) await rm(item.target, { force: true });
        if (item.existed && existsSync(item.backup)) {
          await mkdir(path.dirname(item.target), { recursive: true });
          await rename(item.backup, item.target);
        }
      }
      cleanupTransaction = true;
    } catch (rollbackError) {
      throw new Error(JSON.stringify({
        code: "transaction_recovery_required",
        operation_id: operationId,
        path: path.relative(root, transactionRoot).split(path.sep).join("/"),
        message: rollbackError.message,
        original_error: error.message,
        fix: "Preserve the transaction directory; the next locked Harness write will resume recovery",
      }), { cause: rollbackError });
    }
    throw error;
  } finally {
    if (cleanupTransaction) await rm(transactionRoot, { recursive: true, force: true });
  }
}

export function jsonEntry(relativePath, value) {
  return { path: relativePath, content: `${JSON.stringify(value, null, 2)}\n` };
}

export async function fileEntry(relativePath, sourcePath) {
  return { path: relativePath, content: await readFile(sourcePath) };
}
