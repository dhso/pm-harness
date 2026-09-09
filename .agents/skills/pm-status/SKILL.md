---
name: pm-status
description: Record project progress, meetings, actions, decisions, risks, blockers, and status reports. Use for check-ins, minutes, weekly updates, or when the user reports work completed.
---

# Maintain project status

Read the current schedule, registers, deliverable index, recent activity, and unresolved inbox items.

For meetings, read [meeting-minutes.md](references/meeting-minutes.md) and use `templates/meeting-notes.md`. Separate discussion from confirmed decisions and assigned actions. Every action needs an owner or an explicit `unassigned` state; every claimed deadline needs a source.

A confirmed minute must drive the relevant requirements, task forecasts/actuals, risks, issues, decisions, deliverables, memory, and activity updates instead of remaining an isolated document. Apply these linked records in one `workflow.apply` transaction so failure cannot leave a partially synchronized meeting. Confirmation of minute accuracy is not business approval: controlled requirements or baselines still require authorized approval and an exact change request.

For progress updates, update forecast, actual, status, progress, evidence, and next action without changing baseline. A completed task needs an outcome; a generated deliverable is not automatically delivered or accepted.

For status reports, establish the factual status here, then use `pm-communication` with `templates/status-report.md` to produce send-ready wording. Lead with outcome, variance, risks, decisions needed, and the next period. Avoid activity lists without impact.

Write a compact `ACT-###` through the agent-only record contract; `activity/log.json` is the fact source and dated Markdown is generated in project timezone. Then refresh current status, memory, the Gantt view, and indexes.
