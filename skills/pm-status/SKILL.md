---
name: pm-status
description: Record project progress, meetings, actions, decisions, risks, blockers, and status reports. Use for check-ins, minutes, weekly updates, or when the user reports work completed.
---

# Maintain project status

Read the current schedule, registers, deliverable index, recent activity, and unresolved inbox items.

For meetings, use `templates/meeting-notes.md` and separate discussion from confirmed decisions and assigned actions. Every action needs an owner or an explicit `unassigned` state; every claimed deadline needs a source.

For progress updates, update forecast, actual, status, progress, evidence, and next action without changing baseline. A completed task needs an outcome; a generated deliverable is not automatically delivered or accepted.

For status reports, use `templates/status-report.md` and lead with outcome, variance, risks, decisions needed, and the next period. Avoid activity lists without impact.

Write a compact dated activity entry through the agent-only contract in `.harness/references/automation.md`, then refresh `project/status.md`, `memory/current.md`, the Gantt view, and indexes.
