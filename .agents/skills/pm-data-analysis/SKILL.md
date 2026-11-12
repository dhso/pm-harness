---
name: pm-data-analysis
description: 为 PM 提供面向客户决策的数据分析咨询、指标设计、分析规划、数据诊断和行动建议。实际连库时组合 dbx；普通项目事实检索使用 pm-knowledge。
metadata:
  kind: workflow
  domain: data-analysis
  composes: dbx
---

# 数据分析咨询

先查相关事实、来源和已有分析，明确客户决策、分析对象、时间范围和衡量方式。只问会改变分析路径的问题；没有数据时可提供计划，不编造发现或收益。

## 按需加载

- 分析方向、指标或计划：读取[分析规划](references/planning.md)。
- 数据核验、诊断或基于证据提出建议：读取[分析与建议](references/findings.md)。
- 实际连库：加载 [dbx](../dbx/SKILL.md)；仅讨论方法时不探测连接。
- 正式文件：由 `pm-deliverable` 管理文件和版本，对外叙述用 `pm-communication`；Office 文件按需加载 `officecli`。
- 建议转为任务或需求：交接给 `pm-planning` 或 `pm-requirements`，不把建议当成已批准决定。

## 结论与证据

先核验口径和数据是否足以回答问题，再选方法。区分观察、解释、假设和建议，相关性不直接解释为因果；关键数字注明时间范围、口径和证据，披露抽样、截断与数据缺口。

默认先给建议或待验证判断，再给关键证据、局限和下一步；多项方案用表格比较，细节按需展开。

## 项目收尾

本工作流统一负责来源、活动和分析结果的交接。需要跨会话保留的新证据先查 `source.register` 契约，数据库查询使用 `external_connector`；已有来源直接关联，允许留存的文件按 `.harness/references/source-intake.md` 归档。纯规划不必加载诊断参考。

临时查询和计算放在 `tmp/tasks/<task-key>/`，从项目根执行；保存最小必要结果后只清理当前任务目录。正式产出按交付物流程登记，长期结果按 `AGENTS.md` 收尾；凭证不进入项目文件，原始客户数据和工具轨迹不进入记忆；不声称建议已采纳、收益已实现或材料已发送。
