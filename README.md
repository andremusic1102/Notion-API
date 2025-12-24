# Notion-API

## What this tool currently does

- Initializes a Notion Project page and its Tickets from a Markdown spec generated at init time.
- Generates init tickets from README sections (preferred) or folder structure (fallback).
- Writes the spec to `<PROJECT_ROOT>/docs/notion-init.md` unless a custom `--spec` path is provided.
- On sync, auto-commits tracked changes (never on `main`) and syncs the spec to Notion.
- Updates ticket status/priority/last-sync/latest-commit based on rules, then mirrors to Notion.
- Appends git commits as Notion ticket comments.

## Two commands only

```bash
node Notion-API/tools/notion-init.js init --spec Notion-API/specs/notion-init.md
node Notion-API/tools/notion-sync.js sync
```

## What is intentionally NOT automated

- No sync on `main` (auto-commit is blocked).
- No commit of untracked files (only `git add -u`).
- No auto creation of new tickets during sync.
- No automatic move to `Done` or status rollback.
- No automatic changes to `Ticket Number`, `Project` relation, or formula fields.

## Internal structure overview (for maintainers)

- `Notion-API/tools/notion-init.js` creates the Project + initial Tickets and writes the spec.
- `Notion-API/tools/notion-sync.js` auto-commits, parses git log, updates spec, syncs to Notion.
- `Notion-API/tools/notion-rules.js` holds spec parsing/serialization and sync/init rules.
