// 公共 API 门面。具体职责按模块拆分，调用方继续只依赖本文件。
export { readJson, readWorkspace } from "./workspace.mjs";
export {
  rebuildWorkspace,
  renderActivityDay,
  renderActivityIndex,
  renderDeliverablesIndex,
  renderGantt,
  renderKnowledgeIndex,
  renderRules,
} from "./views.mjs";
export { lintWorkspace } from "./lint.mjs";
export { buildDailyBrief } from "./brief.mjs";
export { migrateWorkspaceV1ToV2 } from "./migration.mjs";
export {
  recordOperation,
} from "./operations.mjs";
export { appendActivityEntry, initializeProject, registerSource, sha256File } from "./compat.mjs";
export { maintainWorkspace } from "./maintain.mjs";
