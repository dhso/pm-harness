---
name: pm-status
description: 记录项目进展、会议、行动、决定、风险、阻塞和状态报告。用于进度检查、会议纪要、周报，或用户报告已完成工作时。
metadata:
  kind: workflow
  domain: status
---

# 维护项目状态

读取当前计划、登记册、交付物索引、近期活动和未解决的收件箱条目。

处理会议时读取[meeting-minutes.md](references/meeting-minutes.md)并使用 `templates/meeting-notes.md`。区分讨论、决定和行动；负责人、日期及其来源不明确时保留待确认。

用户确认纪要后，按上述纪要参考用一次工作流同步相关事实；未获批准的受控事项保持提议状态。

更新进度时保留基线，更新预测、实际、状态、进度、证据和下一步。状态变化使用 `schedule.transition` 并提供实际事件时间；完成事项必须有实际起止时间和结果证据。

编写状态报告时，先在此处建立事实状态，再使用 `pm-communication` 和 `templates/status-report.md` 生成可发送的文字。开头应说明结果、偏差、风险、待决定事项和下一周期。避免只列活动而不说明影响。

把活动、当前状态、短期记忆和相关事实放入同一次类型化工作流，再重建生成视图；只记录实际发生的结果和下一步。
