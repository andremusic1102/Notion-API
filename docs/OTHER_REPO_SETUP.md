# Other Repo Setup Guide (GitHub URL + Codespaces)

這份教學收錄「規則」與「一段式 CodeX prompt」，讓你在其他 repo 一貼就完成設定。

---

## 規則總覽（目前的行為）

1) Spec 來源  
- 讀取 repo 根目錄 `README.md` 的 `## TODOs` 區塊  
- `TODOs` 下的清單項目會生成 tickets（每行一個）

## README TODOs 標準格式（請所有 repo 遵守）

必須在 README.md 內出現下列區塊（標題需完全相同）：

```md
## TODOs
- Task item 1
- Task item 2
- Task item 3
```

規則：
- 必須是 `## TODOs`
- 每一行用 `- ` 或 `* ` 開頭
- 每一行代表 1 張 ticket

2) `notion-init.md` 行為  
- 每次 `spec-update` 會重寫 Tickets 區塊  
- Ticket Number 依序從 1 開始遞增

3) Ticket 更新規則  
- **不看 branch**  
- commit message 必須包含 `RepoName-<number>`  
- 例：`KeyboardRIME-1`、`KeyboardRIME-2`

4) 同步欄位  
- Status / Latest Commit / Last Synced / Dev Notes

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

## 3) 讓其他 repo 知道 Notion-API 的來源

你有兩種方式指定 Notion-API 的位置：

### 3.1 使用本機路徑（預設）
腳本會用 `NOTION_API_ROOT`，沒有設定時預設 `/workspaces/Notion-API`。

你可以在執行前先指定：

```bash
export NOTION_API_ROOT=/path/to/Notion-API
```

### 3.2 使用 Notion-API GitHub URL（推薦給新環境）
如果想要每次自動取得 Notion-API，你可以在腳本內加入 clone 邏輯：

```bash
NOTION_API_ROOT="${NOTION_API_ROOT:-/tmp/notion-api}"
if [ ! -d "$NOTION_API_ROOT/.git" ]; then
  git clone https://github.com/<org>/Notion-API.git "$NOTION_API_ROOT"
fi
```

---

## 4) 直接執行 Notion-API 指令（不建立腳本）

你可以在其他 repo 直接執行 Notion-API 指令：

```bash
REPO_URL="$(git remote get-url origin)"
node /tmp/notion-api/tools/notion-sync.js init --repo-url "$REPO_URL"
node /tmp/notion-api/tools/notion-sync.js full-sync --repo-url "$REPO_URL"
```

---

## 5) 使用方式

### 5.1 初始化（第一次使用）

```bash
./notion-init.sh
```

### 5.2 每日同步

```bash
./notion-sync.sh
```

---

## 6) 常見問題

### Q1: 找不到 `notion-init.md`？
請確認 spec 檔案在 repo 根目錄，檔名必須是 `notion-init.md`。

### Q2: 不是使用 `/workspaces/Notion-API`？
你可以在執行前先設定：

```bash
export NOTION_API_ROOT=/path/to/Notion-API
```

---

## 7) 對應的指令行行為（參考）

如果你要直接跑，不用腳本也可以：

```bash
node /tmp/notion-api/tools/notion-sync.js init --repo-url <GITHUB_URL>
node /tmp/notion-api/tools/notion-sync.js full-sync --repo-url <GITHUB_URL>
```

---

## 一段式 CodeX Prompt（貼上即可完成設定）

```text
請在此 repo 內完成 Notion-API 串接與初始化設定。

前提：
- NOTION_TOKEN / NOTION_PROJECTS_DB_ID / NOTION_TICKETS_DB_ID 已在環境變數中
- Notion-API GitHub URL：https://github.com/andremusic1102/Notion-API.git

需求：
1) 若 `/tmp/notion-api` 不存在，clone Notion-API 到 `/tmp/notion-api`
2) 若 repo 根目錄沒有 `notion-init.md`，建立最小範例
3) 直接執行 Notion-API 指令（不要建立腳本）：
   - `node /tmp/notion-api/tools/notion-sync.js init --repo-url <this repo url>`
   - `node /tmp/notion-api/tools/notion-sync.js full-sync --repo-url <this repo url>`
4) Notion-API 指令必須使用 `git remote get-url origin` 取得 repo URL
5) 不要安裝任何套件，不要修改 Notion-API 原始碼

完成後請回報執行的指令與結果。
```
