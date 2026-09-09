---
name: pm-knowledge
description: Answer project questions from local evidence and curate confirmed information into a concise, linked Wiki. Use for research synthesis or knowledge organization after sources have been triaged.
---

# Curate project knowledge

Search indexes first, then open only relevant Wiki, project, source, and evidence records. Keep answers grounded in project files; cite paths and source IDs when useful.

Separate confirmed facts, interpretations, assumptions, and unresolved conflicts. If required information is absent, say so and identify the smallest useful next source or question.

When consolidating knowledge:

- merge duplicate topic pages instead of copying the same fact repeatedly;
- retain provenance and last-reviewed date;
- link requirements, decisions, tasks, risks, and deliverables by stable ID;
- move obsolete claims to a superseded section rather than silently deleting history;
- keep raw communications out of the Wiki.

Register every page in `knowledge/catalog.json` with a stable `WIKI-###`, sources, related IDs, review state, and review dates. Do not leave orphan Markdown pages.

Rebuild the knowledge index and update memory only when the information is durable across sessions.
