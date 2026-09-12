---
name: pm-maintain
description: 审计项目管理 Harness，修复安全的索引漂移，整理记忆，并提出有证据支持的规则改进。重大里程碑、重复纠正、发现不一致或明确要求审计时使用。
metadata:
  kind: workflow
  domain: maintain
---

# 维护和演进 Harness

读取 `.harness/references/evolution-policy.md`、生效规则、观察记录和最近的 lint 输出。

按照 `.harness/references/automation.md` 运行一次 `maintain` 流程。它会执行一次安全重建、完整 lint、去重后的规则候选生成和到期规则复查；不得启动重试或监听循环。只修复安全的机械漂移，不要靠猜测解决语义冲突。

检查观察记录中的重复失败模式。规则提案必须引用证据、说明适用范围、解释收益和副作用，并定义后续如何验证效果。新增规则前先去重或收窄提案。

规则激活、基线修复、大范围删除或记忆冲突解决必须在对话中呈现并获得批准。批准后通过类型化记录操作应用变更，记录决定并设置后续复查条件。`governance/rules.json` 是事实源，`rules.md` 是生成视图。

## 撤销最近一次写入

用户要求撤销刚才那步时，先 `undo <operation_id> --dry-run`，在对话中说明将恢复和移除的内容；取得确认后用 `undo <operation_id> --confirmed-at <确认时间>` 执行。

只能依次撤销最近的可撤销操作；更早的改动用正向写入修正。受控变更被拒时改走 `change.propose` 和 `change.approve`；`compensation_conflict` 说明目标在原操作后又被修改，也只能正向修正。结果里的 `retained_paths` 是保留在本机的归档原件，转告用户。撤销会保留原操作并追加一条补偿操作，不删除审计历史。

旧版本留下的无效或重复未批准变更草案使用 `change.void` 技术作废，可在一次操作中处理多条；保留原记录、原因和时间。不得把技术作废写成业务驳回，也不得作废已批准请求。无效未批准草案只作为维护警告，但任何批准尝试仍必须通过当前完整校验。

保持入口指令和始终加载的记忆精简。将条件性细节放入相关 Skill 参考文件，不要把 `AGENTS.md` 膨胀成手册。
