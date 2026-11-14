---
name: pm-deliverable
description: 规划、创建、评审、版本化和整理项目文档、电子表格、演示文稿、报告及其他正式产出。用户要求制作或修改交付物时使用。
metadata:
  kind: workflow
  domain: deliverable
  composes: officecli
---

# 创建和管理交付物

读取 `.harness/references/deliverable-policy.md` 及本次相关上下文、来源和验收标准。重要创建工作先明确目的、受众、场景、格式、期限、必需信息和评审标准；局部修改复用已有约定，缺口按 `AGENTS.md` 澄清。

复用已确认文档偏好，需要补查时用 `query preference --where scope=document`；选择最接近的模板并按需调整。

| 条件 | 加载 |
|---|---|
| 正式报告的叙述 | 将事实、受众与目的交给 `pm-communication`，取得文稿后由本流程继续制作文件 |
| DOCX、XLSX、PPTX 文件处理与校验 | [officecli](../officecli/SKILL.md) |
| 外部正文、页面、图表或附件 | [说人话与保真](../pm-communication/references/plain-language.md)，不为表达复核额外加载整套沟通工作流 |

```text
初稿前或同时登记 → 创建/修改 → 检查 → 保存可评审或继续使用的文件
→ 按 deliverable-policy.md 记录生命周期 → 按 AGENTS.md 收尾
```

收尾时报告文件路径、已执行的检查、当前生命周期状态、剩余评审行动和索引更新。
