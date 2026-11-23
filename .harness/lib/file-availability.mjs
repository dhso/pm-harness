import { stat } from "node:fs/promises";
import path from "node:path";
import { sha256Path } from "./helpers.mjs";

// 局部正文缺失可以隔离，但不能把缺失事实隐藏为校验成功。
// 不传目标范围时保持完整 lint 的严重级别；record 只降级范围外的正文缺失。
export function missingFileReporter(issues, targetIds) {
  const fileTargetIds = targetIds === undefined ? null : new Set(targetIds);
  return (item, code, storePath, filePath, message, level = "error") => {
    const outsideOperation = level === "error" && fileTargetIds !== null && !fileTargetIds.has(item.id);
    issues.push({
      level: outsideOperation ? "warning" : level,
      code,
      path: storePath,
      message,
      record_id: item.id,
      file_path: filePath,
      scope: outsideOperation ? "outside_operation" : "local",
      fix: `Restore ${filePath} from the original or backup before operating on ${item.id}; do not fabricate content or change its recorded status to clear this issue`,
    });
  };
}
export async function localFileStatus(root, relative, pendingPaths) {
  if (pendingPaths.has(relative.split(path.sep).join("/"))) return { available: true };
  try {
    const details = await stat(path.join(root, relative));
    return details.isFile() ? { available: true } : { available: false, missing: false, message: "Path is not a regular file" };
  } catch (error) {
    return { available: false, missing: ["ENOENT", "ENOTDIR"].includes(error.code), message: error.message };
  }
}

export async function checkContentHash(root, item, storePath, expectedHash, mismatchCode, issues) {
  const details = { path: storePath, record_id: item.id, file_path: item.path };
  try {
    if (await sha256Path(path.join(root, item.path)) !== expectedHash) issues.push({ ...details, scope: "local", level: "error", code: mismatchCode, message: `${item.id} file content does not match its recorded SHA-256` });
  } catch (error) {
    issues.push({ ...details, scope: "local", level: "error", code: "file_unreadable", cause_code: error.code, message: `${item.id} file could not be read: ${error.message}`, fix: "Restore readable original content before using this file; unrelated facts may still be recorded" });
  }
}
