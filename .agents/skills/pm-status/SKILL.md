---
name: pm-status
description: 记录项目进展、会议、行动、决定、风险、阻塞和状态报告。用于进度检查、会议纪要、周报，或用户报告已完成工作时。
metadata:
  kind: workflow
  domain: status
---

# 维护项目状态

读取当前计划、登记册、交付物索引、近期活动和未解决的收件箱条目。

处理会议时读取[meeting-minutes.md](references/meeting-minutes.md)，并使用 `templates/meeting-notes.md`。区分讨论、已确认决定和已分配行动。每项行动都需要负责人或明确的 `unassigned` 状态；每个声称的截止日期都需要来源。

已确认的纪要必须驱动相关需求、任务预测/实际、风险、问题、决定、交付物、记忆和活动更新，不能只是孤立文件。通过一次 `workflow.apply` 事务应用这些关联记录，避免失败造成部分同步。确认纪要准确不等于业务批准：受控需求或基线仍需授权批准和精确变更请求。

更新进度时，在不改变基线的前提下更新预测、实际、状态、进度、证据和下一步行动。已完成任务必须有结果；生成交付物不会自动变成已交付或已验收。

编写状态报告时，先在此处建立事实状态，再使用 `pm-communication` 和 `templates/status-report.md` 生成可发送的文字。开头应说明结果、偏差、风险、待决定事项和下一周期。避免只列活动而不说明影响。

通过仅供 Agent 使用的记录契约写入精简的 `ACT-###`；`activity/log.json` 是事实源，带日期的 Markdown 按项目时区生成。需要刷新人读状态与短期记忆时，把 `status.update`、`memory.current.update` 与相关事实纳入同一次 `workflow.apply`，再重建甘特视图和索引。
