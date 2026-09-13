---
name: pm-deliverable
description: 规划、创建、评审、版本化和整理项目文档、电子表格、演示文稿、报告及其他正式产出。用户要求制作或修改交付物时使用。
metadata:
  kind: workflow
  domain: deliverable
  composes: officecli
---

# 创建和管理交付物

读取 `.harness/references/deliverable-policy.md`、项目上下文、相关来源和验收标准。

开始重要创建工作前，确认目的、受众、使用场景、格式、截止时间、必需信息或数据以及评审标准。使用 `templates/` 中最接近的模板作为内容脚手架，并按实际需要调整。

正式报告使用 `pm-communication` 组织叙述；本 Skill 负责文件、版本、评审和交付生命周期。

在初稿之前或同时登记交付物。工作文件放在 `deliverables/current/`；使用清晰稳定的文件名并递增版本。绝不覆盖已批准的终稿。

涉及 DOCX、XLSX 或 PPTX 时，使用 [officecli](../officecli/SKILL.md) 处理文件和格式校验；视觉质量重要时生成临时预览，完成检查后不将预览作为长期项目资料。

交付物面向外部受众时，使用 `pm-communication` 的对外表达规则复核正文、页面、图表和附件。

按 `deliverable-policy.md` 更新生命周期；创建、批准、交付和验收分别记录，已批准内容通过新版本和替代链演进。

收尾时报告文件路径、已执行的检查、当前生命周期状态、剩余评审行动和索引更新。
