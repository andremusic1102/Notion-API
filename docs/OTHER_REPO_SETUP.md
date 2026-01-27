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

## 2) 使用方式（全部透過 Notion-API）

所有操作都在 **Notion-API repo** 執行，不在其他 repo 內跑指令或寫腳本。

初始化（第一次使用）：

```bash
node /workspaces/Notion-API/tools/notion-sync.js init --repo-url <GITHUB_URL>
```

每日同步：

```bash
node /workspaces/Notion-API/tools/notion-sync.js full-sync --repo-url <GITHUB_URL>
```

---

## 3) 其他 repo 必要條件

1) README 需包含標準 `## TODOs` 區塊（見上方規則）
2) repo 需有 `notion-init.md`（若沒有，full-sync 會建立最小範例）

---

## 一段式 CodeX Prompt（貼上即可完成設定）

```text
請在此 repo 內完成 Notion-API 串接與初始化設定。

前提：
- NOTION_TOKEN / NOTION_PROJECTS_DB_ID / NOTION_TICKETS_DB_ID 已在環境變數中
- Notion-API GitHub URL（公開）：https://github.com/andremusic1102/Notion-API.git

需求：
1) 在 /workspaces/Notion-API 執行，不在此 repo 跑指令
2) 先取得 repo URL（使用 `git remote get-url origin`），然後直接執行初始化與同步指令：
   - `REPO_URL="$(git remote get-url origin)"`
   - `node /workspaces/Notion-API/tools/notion-sync.js init --repo-url "$REPO_URL"`
   - `node /workspaces/Notion-API/tools/notion-sync.js full-sync --repo-url "$REPO_URL"`
3) 若 repo 根目錄沒有 `notion-init.md`，建立最小範例
4) 不要安裝任何套件，不要修改 Notion-API 原始碼

完成後請回報執行的指令與結果。
```
