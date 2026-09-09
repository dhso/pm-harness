---
name: pm-planning
description: Create or update project plans, milestones, dependencies, task sequencing, estimates, and Gantt forecasts. Use for planning and replanning; do not silently change an approved baseline.
---

# Plan project work

Read `.harness/references/schedule-policy.md` and the project goals, requirements, risks, decisions, and deliverables.

Build an outcome-oriented plan with stable IDs, accountable owners, dependencies, acceptance/evidence, and explicit next actions. Avoid creating tasks that cannot be verified.

Set baseline dates only when the user approves a plan. Routine progress changes forecast and actual fields, never baseline. If requested work changes a committed milestone or deadline, create a change request and explain downstream impact before applying it.

After editing `project/schedule.json`, run the rebuild script so `project/gantt.md` reflects the canonical data. Record meaningful planning decisions and unresolved dependencies.

Summarize critical path, near-term milestones, top risks, and decisions needed rather than reciting the full task list.

