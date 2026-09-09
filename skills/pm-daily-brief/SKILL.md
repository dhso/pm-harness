---
name: pm-daily-brief
description: Produce a focused daily project work brief from schedule, recent activity, risks, inbox, and delivery commitments. Use on the first substantial interaction of a day or when the user asks what to do next.
---

# Guide today's work

Run `node .harness/scripts/harness.mjs brief --json` and inspect the referenced records when context is needed.

Present a short brief containing:

- the one to three highest-value actions for today and why now;
- overdue, blocked, or dependency-sensitive work;
- milestones and deliverables due in the configured upcoming window;
- decisions, confirmations, or stakeholder follow-ups needed;
- untriaged sources that may affect requirements or dates.

Do not overwhelm the user with the complete backlog. If priorities conflict, ask one focused tradeoff question. Do not repeat the brief on every chat in the same day unless the state materially changes.

