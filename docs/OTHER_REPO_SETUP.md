# Other Repo Setup Guide (GitHub URL + Codespaces)

這份教學說明如何在「其他 repo」透過 GitHub URL 串接 `Notion-API`，並包成兩個可直接執行的指令：初始化與同步。

---

## 1) 前置需求

### 1.1 Notion 資訊準備
你需要準備三個環境變數：

- `NOTION_TOKEN`
- `NOTION_PROJECTS_DB_ID`
- `NOTION_TICKETS_DB_ID`

### 1.2 在 Codespaces 設定環境變數
建議用 GitHub Codespaces secrets 管理：

1. 到 GitHub repo → Settings → Secrets and variables → Codespaces
2. 新增三個 secrets：`NOTION_TOKEN`、`NOTION_PROJECTS_DB_ID`、`NOTION_TICKETS_DB_ID`
3. 重開 codespace 或重新載入 terminal 環境

如果需要臨時設定（單次 session）：

```bash
export NOTION_TOKEN=...
export NOTION_PROJECTS_DB_ID=...
export NOTION_TICKETS_DB_ID=...
```

---

## 2) Spec 檔案規則

每一個專案 repo 必須在 repo 根目錄放置 `notion-init.md`。

你可以參考 `Notion-API` repo 裡的範例：
`/workspaces/Notion-API/specs/workdomain-init.md`

---

## 3) 在其他 repo 建立兩個指令

以下會在「其他 repo」新增兩個可直接執行的腳本：

- `./notion-init.sh`：初始化 Notion 專案與票
- `./notion-sync.sh`：每日同步（含 spec 更新）

### 3.1 建立 `notion-init.sh`

在其他 repo 根目錄新增檔案：

```bash
cat > notion-init.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

# 取 GitHub URL 作為來源
REPO_URL="$(git remote get-url origin)"

# Notion-API repo 路徑（可自訂）
NOTION_API_ROOT="${NOTION_API_ROOT:-/workspaces/Notion-API}"

node "$NOTION_API_ROOT/tools/notion-sync.js" init --repo-url "$REPO_URL"
EOF

chmod +x notion-init.sh
```

### 3.2 建立 `notion-sync.sh`

在其他 repo 根目錄新增檔案：

```bash
cat > notion-sync.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

# 取 GitHub URL 作為來源
REPO_URL="$(git remote get-url origin)"

# Notion-API repo 路徑（可自訂）
NOTION_API_ROOT="${NOTION_API_ROOT:-/workspaces/Notion-API}"

# full-sync 會做：Git → spec → Notion
node "$NOTION_API_ROOT/tools/notion-sync.js" full-sync --repo-url "$REPO_URL"
EOF

chmod +x notion-sync.sh
```

---

## 4) 使用方式

### 4.1 初始化（第一次使用）

```bash
./notion-init.sh
```

### 4.2 每日同步

```bash
./notion-sync.sh
```

---

## 5) 常見問題

### Q1: 找不到 `notion-init.md`？
請確認 spec 檔案在 repo 根目錄，檔名必須是 `notion-init.md`。

### Q2: 不是使用 `/workspaces/Notion-API`？
你可以在執行前先設定：

```bash
export NOTION_API_ROOT=/path/to/Notion-API
```

---

## 6) 對應的指令行行為（參考）

如果你要直接跑，不用腳本也可以：

```bash
node /workspaces/Notion-API/tools/notion-sync.js init --repo-url <GITHUB_URL>
node /workspaces/Notion-API/tools/notion-sync.js full-sync --repo-url <GITHUB_URL>
```
