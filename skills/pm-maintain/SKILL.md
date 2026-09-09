---
name: pm-maintain
description: Audit the project-management Harness, repair safe index drift, consolidate memory, and propose evidence-backed rule improvements. Use after material milestones, repeated corrections, detected inconsistencies, or an explicit audit request.
---

# Maintain and evolve the Harness

Read `.harness/references/evolution-policy.md`, `.harness/references/git-policy.md`, active rules, observations, and recent lint output.

Run rebuild, then lint. Repair only safe mechanical drift such as generated indexes. Do not resolve semantic conflicts by guessing.

Review observations for repeated failure patterns. A rule proposal must cite evidence, state its scope, explain benefit and side effects, and define how later work will show whether it helped. Deduplicate or narrow proposals before adding new rules.

Present rule activation, baseline repair, broad deletion, or memory conflict resolution for conversational approval. Apply approved changes, record the decision, and set a later review condition.

Keep entry instructions and always-loaded memory concise. Move conditional detail into the relevant Skill reference instead of growing `AGENTS.md` into a manual.

