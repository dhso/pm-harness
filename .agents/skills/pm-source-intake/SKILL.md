---
name: pm-source-intake
description: 将收到的邮件、聊天消息、截图、日常记录和附件处理为可追溯证据、项目知识、行动、风险或变更提案。用户分享沟通材料或非正式记录时使用。
metadata:
  kind: workflow
  domain: source-intake
---

# 摄取项目来源

读取[摄取政策](../../../.harness/references/source-intake.md)，按其中流程得到来源、收件条目和关联对象；受控事项按 `AGENTS.md` 判定。

```text
逐条交接：
if 需业务变更控制:
    将来源、条目与受影响对象交给 pm-requirements → 返回候选/变更请求/待确认项
else: 按摄取政策应用或保留 → 返回应用目标或处置原因
按 AGENTS.md 收尾
```

业务变更路径见[变更控制](../../../.harness/references/change-control.md)。Office 来源交给 `officecli` 返回必要内容和读取限制；只有需确认 ID、状态或关系时才读 `.harness/references/data-model.md`。

返回精简的摄取卡片：已处理来源、补充知识、发现的行动/风险、可能的变更以及需要确认的问题。
