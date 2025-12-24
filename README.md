# Notion-API

## What is this?

Notion-API is a first-class project tracked in Notion.
It provides deterministic tooling to sync Git activity and Markdown specs into Notion Projects and Tickets.
Notion-API 本身就是一個被 Notion 管理的 Project，
負責把 Git 行為與 Markdown 規格穩定同步到 Notion。

## Workflow Alignment

- Notion-API and Calories-Scanner follow the same workflow
- Markdown spec is the only declarative source
- Ticket Number is the immutable ID (Notion-API uses 1001+)
- Git commits become Notion ticket comments
- diff / sync flows stay identical across projects

Notion-API 與 Calories-Scanner 採用完全一致的工作流：
Markdown 唯一規格、Ticket Number 作為 immutable ID、Git → Notion comment、diff / sync 一致。

## Initialize Notion-API

Run init inside a project root. If `--spec` is omitted, it generates `docs/notion-init.md`.
Use `--spec` for custom paths.
Init also creates and pushes Ticket branches to `origin` without checking them out.
Branches that already exist on the remote are skipped.

```bash
# Recommended
node ../Notion-API/tools/notion-init.js init

# Advanced
node ../Notion-API/tools/notion-init.js init --spec path/to/notion-init.md
```

## Daily Sync

```bash
node Notion-API/tools/notion-sync.js sync
```
