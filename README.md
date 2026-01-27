# Notion Project & Ticket Sync Tool

## What is this?

This is an internal Notion synchronization tool for engineers.
It treats Git repo state + README TODOs as the source of truth and keeps
Notion Projects and Tickets in sync.
這是一個工程師自用的 Notion 同步工具。
Git（repo 狀態與 README TODOs）是唯一的事實來源，
Notion 僅作為專案與任務的視覺化與協作層。

## Architecture Overview

- <PROJECT_NAME>: the actual product repository (Git repo)
- notionapi: automation tools (not a Git repository)
- Markdown spec (notion-init.md): generated from README TODOs (repo root)
- Notion: visualization of projects and tickets

Data flow:

Git → README TODOs → notion-init.md → Notion

- <PROJECT_NAME>：實際的產品專案（Git repo）
- notionapi：自動化工具（不是 Git repo）
- Markdown（notion-init.md）：由 README TODOs 產生（repo root）
- Notion：專案與任務的顯示層

資料流方向：

Git → README TODOs → notion-init.md → Notion

## Required Environment Variables

Set these before running any Notion commands:
`NOTION_TOKEN`, `NOTION_PROJECTS_DB_ID`, `NOTION_TICKETS_DB_ID`.

## Rules (for other repos)

1) README must include:

```md
## TODOs
- Task item 1
- Task item 2
```

Rules:
- Section title must be exactly `## TODOs`
- Each `-`/`*` line becomes a ticket

2) `notion-init.md`
- If missing, Notion-API will generate it from README TODOs
- Ticket Number starts at 1 and auto-increments

3) Ticket update
- Commit message must include `RepoName-<number>` (e.g. `KeyboardRIME-1`)
- Sync updates: Status / Latest Commit / Last Synced / Dev Notes

## CodeX Prompt (initial setup)

```text
請在此 repo 內完成 Notion-API 串接與初始化設定。

前提：
- NOTION_TOKEN / NOTION_PROJECTS_DB_ID / NOTION_TICKETS_DB_ID 已在環境變數中
- Notion-API GitHub URL（公開）：https://github.com/andremusic1102/Notion-API.git

需求：
1) 在 /workspaces/Notion-API 執行，不在此 repo 跑指令
2) 先取得 repo URL（使用 `git remote get-url origin`），然後直接執行初始化與同步指令
3) 若 repo 根目錄沒有 `notion-init.md`，請依 README `## TODOs` 產生完整 `notion-init.md`
4) 依 README TODOs 建立/更新 tickets 後再同步 Notion
5) 不要安裝任何套件，不要修改 Notion-API 原始碼

完成後請回報執行的指令與結果。
```

## CodeX Prompt (daily sync)

```text
請在 /workspaces/Notion-API 執行同步，不在此 repo 跑指令。

步驟：
1) 取得 repo URL（使用 `git remote get-url origin`）
2) 執行同步（使用 Notion-API 的 full-sync 指令）

不要安裝任何套件，不要修改 Notion-API 原始碼。
```
