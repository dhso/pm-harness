---
name: pm-onboarding
description: Initialize an uninitialized local project-management workspace through conversation. Use when the user asks to start, set up, or initialize a project; do not use for an already initialized project's routine work.
---

# Initialize the project

Read `project/project.json`. Stop if it is already initialized unless the user explicitly wants to re-baseline the project; re-baselining requires a change proposal.

Gather the minimum durable context:

- project name and problem/background;
- objective and measurable success criteria;
- scope in and scope out;
- key stakeholders and who may approve scope, dates, requirements, and acceptance;
- known milestones, constraints, sources, risks, and expected deliverables;
- project timezone and any fixed dates.

Ask at most three high-impact questions per turn. Offer reasonable assumptions for missing low-impact details rather than turning onboarding into a long form.

Read `.harness/references/data-model.md` before assigning IDs or statuses. Use the agent-only initialization contract in `.harness/references/automation.md`. Register stakeholders separately in `project/stakeholders.json`; granting approval scopes requires explicit user confirmation. Create an initial baseline only with valid schedule authority, update current status and memory, then rebuild and lint.

Finish with a short project summary, remaining unknowns, and the most useful next action.
