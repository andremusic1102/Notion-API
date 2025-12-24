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

```bash
node Notion-API/tools/notion-init.js init --spec Notion-API/specs/notion-init.md
```

- The init command is a one-time operation.
- Running it again after initialization will fail by design.
- init 指令只能執行一次。
- 若 Project 已存在，再次執行將直接失敗，這是刻意設計的防呆行為。

## Daily Sync

```bash
node Notion-API/tools/notion-sync.js sync
```

- The sync command will automatically create a commit for tracked file changes using a standardized commit message before syncing to Notion.
- sync 指令會在同步前，自動為已追蹤的檔案建立一筆規格化的 commit，再將該次工作同步到 Notion。
