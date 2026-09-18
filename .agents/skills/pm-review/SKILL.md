---
name: pm-review
description: 对照约定标准评审项目工作或交付物，执行验收，或开展提取行动和可复用经验的复盘。评审关口、里程碑和项目收尾时使用。
metadata:
  kind: workflow
  domain: review
---

# 评审结果

识别适用的目标、需求、验收标准、决定或交付物说明。依据这些来源评审，不凭一般偏好判断。

先报告重要缺口，并说明证据和影响。区分阻塞性发现、建议改进和可选润色。没有处于 `acceptance` 权限范围的有效干系人、按时间排列的证据和用户确认，不得将工作标记为已验收。

复盘时使用 `templates/retrospective.md`。比较基线、预测、实际结果、需求变化、风险、决定、交付证据和活动。区分可复用的流程经验与一次性情况。

记录后续任务和长期经验：

- 值得长期遵守的流程经验用 `rule.propose` 立项，尚无重复观察时用 `manual_reason` 说明复盘依据，并给出复查日期；用户批准后才 `rule.activate`，不采纳时用 `rule.reject` 记录理由。
- 纯协作或交付习惯用 `memory.preference.upsert` 记录。
- 将 Harness 失败或重复纠正记录为观察，不要直接创建生效规则；已解决的观察转为 `resolved` 或 `dismissed`。
