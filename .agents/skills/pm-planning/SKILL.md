---
name: pm-planning
description: 创建或更新项目计划、里程碑、依赖关系、任务顺序、估算和甘特预测。规划或重新规划时使用；不得静默修改已批准的基线。
metadata:
  kind: workflow
  domain: planning
---

# 规划项目工作

按本次范围查询相关目标、需求、风险、决定和交付物；重排计划时覆盖受影响的依赖并说明下游影响，不为单项更新预读全部项目资料。

执行前读取 `.harness/references/schedule-policy.md`，按初始基线、日常更新或已批准基线变更选择路径：

```text
可验证结果 → 任务/里程碑 → 负责人、依赖、完成证据和下一步
→ 按 schedule-policy.md 选择操作、审批或变更路径 → 按 AGENTS.md 写入和收尾
```

总结关键路径、近期里程碑、主要风险和待决定事项，不要复述完整任务清单。
