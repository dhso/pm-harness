---
name: pm-maintain
description: Audit the project-management Harness, repair safe index drift, consolidate memory, and propose evidence-backed rule improvements. Use after material milestones, repeated corrections, detected inconsistencies, or an explicit audit request.
---

# Maintain and evolve the Harness

Read `.harness/references/evolution-policy.md`, `.harness/references/git-policy.md`, active rules, observations, and recent lint output.

Run the single `maintain` flow from `.harness/references/automation.md`. It performs one safe rebuild, full lint, deduplicated rule-candidate creation, and due-rule review; it must not start a retry or watcher loop. Repair only safe mechanical drift. Do not resolve semantic conflicts by guessing.

Review observations for repeated failure patterns. A rule proposal must cite evidence, state its scope, explain benefit and side effects, and define how later work will show whether it helped. Deduplicate or narrow proposals before adding new rules.

Present rule activation, baseline repair, broad deletion, or memory conflict resolution for conversational approval. Apply approved changes through typed record operations, record the decision, and set a later review condition. `governance/rules.json` is the fact source; `rules.md` is generated.

Keep entry instructions and always-loaded memory concise. Move conditional detail into the relevant Skill reference instead of growing `AGENTS.md` into a manual.
