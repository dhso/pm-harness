---
name: pm-source-intake
description: Process inbound email, chat messages, screenshots, daily notes, and attachments into traceable evidence, project knowledge, actions, risks, or change proposals. Use whenever the user shares communications or informal records.
---

# Intake project sources

Read `.harness/references/source-intake.md`, `.harness/references/data-model.md`, and the `source-add` contract in `.harness/references/automation.md`.

Inspect the supplied content and identify what is visible versus inferred. For screenshots, transcribe only necessary text, preserve speaker order, and attach confidence to ambiguous names, numbers, dates, or commitments.

Register a `SRC-###` source and split its useful contents into inbox items. Classify each item as a fact, feedback, request, decision, commitment, action, risk, issue, question, or assumption. Link related project IDs.

Apply low-risk updates such as activity entries, candidate tasks, evidence-backed Wiki additions, or open questions. If an item may change a requirement, scope, success criterion, committed date, budget, or acceptance, invoke `pm-requirements` and create a change request instead of editing the baseline.

When the source is an Office file, use OfficeCLI if available. Keep raw files in the ignored archive and only necessary structured evidence in tracked files.

Return a compact intake card: sources processed, knowledge added, actions/risks found, possible changes, and questions requiring confirmation.
