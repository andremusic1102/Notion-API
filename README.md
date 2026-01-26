# Notion Project & Ticket Sync Tool

## What is this?

This is an internal Notion synchronization tool for engineers.
It treats Git branches and commits as the source of truth and keeps
Notion Projects and Tickets in sync automatically.
這是一個工程師自用的 Notion 同步工具。
Git（branch 與 commit）是唯一的事實來源，
Notion 僅作為專案與任務的視覺化與協作層。

## Architecture Overview

- <PROJECT_NAME>: the actual product repository (Git repo)
- notionapi: automation tools (not a Git repository)
- Markdown spec (notion-init.md): the only human-edited source (repo root)
- Notion: visualization of projects and tickets

Data flow:

Git → Markdown Spec → Notion

- <PROJECT_NAME>：實際的產品專案（Git repo）
- notionapi：自動化工具（不是 Git repo）
- Markdown（notion-init.md）：唯一由人維護的規格（repo root）
- Notion：專案與任務的顯示層

資料流方向：

Git → Markdown 規格 → Notion

## Required Environment Variables

Set these before running any Notion commands:

```bash
export NOTION_TOKEN=...
export NOTION_PROJECTS_DB_ID=...
export NOTION_TICKETS_DB_ID=...
```

## Initialize a New Project

Use init once for a new project:
init 只在新專案第一次使用：

```bash
node ../notionapi/tools/notion-sync.js init --repo <PROJECT_PATH>
```

Or with GitHub URL:

```bash
node ../notionapi/tools/notion-sync.js init --repo-url <GITHUB_URL>
```

## Daily Sync

Use sync at the end of each work session:
sync 可每天或每個工作階段結束後執行：

```bash
node ../notionapi/tools/notion-sync.js sync --repo <PROJECT_PATH>
```

Or with GitHub URL:

```bash
node ../notionapi/tools/notion-sync.js sync --repo-url <GITHUB_URL>
```

## Spec Update (Git → Spec)

Scan repo branches/commits and append new tickets into `notion-init.md`:

```bash
node ../notionapi/tools/notion-sync.js spec-update --repo-url <GITHUB_URL>
```

## Full Sync (Git → Spec → Notion)

Run spec update, then init or sync Notion:

```bash
node ../notionapi/tools/notion-sync.js full-sync --repo-url <GITHUB_URL>
```

## Other Repo Setup Guide

See `docs/OTHER_REPO_SETUP.md` for a step-by-step tutorial to wire another repo via GitHub URL,
including two ready-to-run commands (`notion-init.sh`, `notion-sync.sh`).
