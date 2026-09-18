---
name: pm-maintain
description: 审计项目管理 Harness，修复安全的索引漂移，整理记忆，并提出有证据支持的规则改进。重大里程碑、重复纠正、发现不一致或明确要求审计时使用。
metadata:
  kind: workflow
  domain: maintain
---

# 维护和演进 Harness

读取 `.harness/references/evolution-policy.md`、生效规则、观察记录和最近的 lint 输出。

按照 `.harness/references/automation.md` 运行一次 `maintain`。只修复安全的机械漂移，不靠猜测解决语义冲突，也不启动重试或监听循环。

检查观察记录中的重复失败模式。规则提案必须引用证据、说明适用范围、解释收益和副作用，并定义后续如何验证效果。新增规则前先去重或收窄提案。

整理记忆时从 `maintain` 和 lint 的输出取对象，不凭印象找：

1. `pending_proposals` 和 `rule_reviews_due` 列出待处置提案与到期规则；`pending_proposals_complete=false` 时先报告发现不完整，不得把空数组解释为没有提案。逐条与用户确认后 `rule.activate`、`rule.reject` 或 `rule.retire`，不留悬空提案。
2. 已解决的观察用 `observation.record` 转为 `resolved` 或 `dismissed`。
3. lint 报 `preferences_over_budget` 时用 `query preference` 通读，把语义重叠的条目合并为一条并退役其余；`memory/current.md` 过期时按当前事实更新，不编造内容消除告警。

规则激活、基线修复、大范围删除或记忆冲突解决必须在对话中呈现并获得批准；批准后通过类型化操作应用并设置复查条件。

## 撤销最近一次写入

按已读取的自动化参考先预演并说明影响，取得确认后再补偿。不能补偿时按返回的 `code` 和 `fix` 正向修正；不删除操作历史或归档原件。

旧版本留下的无效或重复未批准草案按 `.harness/references/change-control.md` 技术作废，不表述为业务驳回。
