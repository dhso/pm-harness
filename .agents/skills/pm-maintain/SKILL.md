---
name: pm-maintain
description: 维护 PM 工作区的索引、记忆和规则，或撤销最近一次项目写入。用于里程碑收尾、重复纠正或一致性审计；Harness 代码开发与评审按代码任务处理。
metadata:
  kind: workflow
  domain: maintain
---

# 维护和演进 Harness

```text
if 撤销最近一次项目写入: 执行「撤销流程」→ 取得补偿结果
else: node .harness/scripts/harness.mjs maintain → 按发现交接
汇总子流程结果 → 统一收尾
```

撤销分支读取[撤销流程](references/undo.md)，完成后进入统一收尾，不进入下方常规维护分流。常规维护命令只运行一次；以下条件可组合，交接维护输出及相关对象：

| 发现或任务 | 处理 |
|---|---|
| 待处置提案、到期规则或重复失败 | [规则提案](../../../.harness/references/evolution-policy.md#规则提案) |
| `preferences_over_budget` | [偏好整理](../../../.harness/references/evolution-policy.md#偏好) |
| 当前记忆过期或记忆整理 | [记忆整理](../../../.harness/references/evolution-policy.md#记忆) |
| 无效或重复的未批准变更草案 | [变更控制](../../../.harness/references/change-control.md)中的技术作废流程 |
| 维护失败或接口/输出不明 | [自动化接口](../../../.harness/references/automation.md)；只继续可安全完成的部分 |

`pending_proposals` 是待处置提案发现入口；`pending_proposals_complete=false` 时报告发现不完整，不把空数组当作没有提案。到期规则看 `rule_reviews_due`。

子流程返回已处置对象、检查结果和待决定事项。本流程按 `AGENTS.md` 统一汇报与收尾，复用本次检查结果，不再次触发自身。
