# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Word Mode 是 Obsidian 外掛：用 ProseMirror 把 Markdown 筆記變成像 Word 一樣編輯，存檔仍是純 Markdown。公開專案，會在手機上執行；`minAppVersion` 是 1.5.7。

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm test` | 型別檢查加全部測試。每個測試檔最後印 `ALL PASS`，失敗的行以 `FAIL` 開頭。 |
| `npm run lint` | ESLint（Obsidian 審查社群外掛的同一套規則），不能有警告。 |
| `npm run build` | 正式建置到 `dist/`（`main.js`、`manifest.json`、`styles.css`）。`npm run dev` 不壓縮。 |
| `node tests/run.mjs tests/diagrams.mjs` | 單跑一個純函式測試（`tests/*.mjs`，直接匯入 `src/`）。 |
| `node tests/view/build-test.mjs && node tests/view/ui.mjs` | 單跑一個介面測試（`tests/view/` 的 `test.mjs`、`features.mjs`、`ui.mjs`）。要先打包。 |
| `npm run test:vault -- "<vault 路徑>"` | 對真實 vault 做往返檢查（唯讀）。改了 `src/markdown.ts` 或 `src/schema.ts` 之後、部署之前必跑，`notExact` 與 `lossyBlocks` 都要是 0。 |

交付前自查：`npm test`、`npm run lint`、`npm run build`，以及用 Grep 工具在 `src/` 搜尋 `\(\?<[=!]`，不能有結果（見下面的規則）。

## 架構

- **往返不失真是核心**。`MarkdownConverter.parse()`（`src/markdown.ts`）把原文切成「原文區塊」，每個頂層節點用 `bid` 屬性指回 `meta.segments`。`serialize(doc, meta)` 只重新產生改過的區塊，沒改的區塊一字不差輸出原文。新建的節點 `bid` 是 null；貼上或複製節點要先 `stripBids`。看不懂或不適合用 Word 方式編輯的內容（HTML、數學、註腳、註解）存成 `raw_block`／`raw_inline`，`src` 屬性就是原文。連續的空行每多一行是一個 `blank` 原文區塊，顯示成空白段落（最後一行空行仍是兩個區塊之間的分隔）；文件最後面新加的空白段落不寫進檔案。
- **`src/view.ts` 的 `WordModeView` 是中樞**：建立編輯器、功能區、尋找列，是所有對話框的進入點，也處理右鍵選單、貼上、同步衝突。功能區（`src/toolbar.ts`）只透過 `ToolbarContext.dialogs` 回呼 view，不直接碰 Obsidian。
- **不依賴 Obsidian 的純邏輯**：`commands.ts`、`schema.ts`、`markdown.ts`、`flowchart.ts`、`diagrams.ts`、`mathvisual.ts`、`colorpicker.ts` 的色碼工具。這些可以用 `tests/run.mjs` 直接測，新的邏輯盡量寫在這一類。
- **`src/main.ts`**：外掛進入點、Word ⇄ Markdown 切換（包了 `WorkspaceLeaf.setViewState`）。設定的型別與預設值（`Settings`、`DEFAULTS`）在 `src/settings.ts`，設定頁在 `src/settingstab.ts`：內容只在 `settingSections()` 描述一次，舊版的 `display()` 與 Obsidian 1.13 的 `getSettingDefinitions()` 都用它。
- **兩條功能區要長得一樣**：`toolbar.ts`（Word 模式）與 `mdbar.ts`（Markdown／閱讀模式）都用 `src/ribbon.ts` 建立。`ribbon.ts` 有 `TABS`、`GROUPS`、`groupLayout`，建立分頁列、面板、群組與按鈕的 `RibbonShell`（DOM 結構與 CSS 類別只有這一份），以及 `ACTIONS`：兩邊都有的按鈕的外觀（圖示、名稱、文字、快速鍵、說明、動畫）只寫在這裡，兩條功能區各自只寫按下去做什麼。版面與按鈕的外觀改 `ribbon.ts`，不要在其中一條功能區裡另外寫。
- **圖表編輯器是資料驅動的**：`src/diagrams.ts` 每種圖表一份 `DiagramKind`（怎麼讀、怎麼寫回、表單欄位）；`src/mermaid.ts` 依這份描述畫表單與「在圖上編輯」。只有「讀進來再寫出去內容不變」的圖才開表單，否則開程式碼並說明原因。
- **介面文字以繁體中文原文為鍵**。`I18nKey = keyof typeof EN`，新字串沒加進 `src/i18n-en.ts` 型別檢查就會失敗；其他十一份翻譯（`ja`、`ko`、`nan` 台文、`yue` 粵語、`zh-cn`、`vi`、`fr`、`de`、`es`、`ar`、`he`）沒有的鍵會退回英文（台文、粵語退回中文原文），但要一併補上。
- **樣式全部在 `styles/word-mode.css`**，類別前綴 `wm-`。檔案是隨版本往後加的，後面的規則會蓋掉前面的；改既有元件前先搜尋它在檔案後段有沒有覆蓋。

各模組的細節與常見修改的做法在 `.claude/context/modules.md`，需要時再讀。

## 規則

- 不用 regex lookbehind（`(?<=…)`、`(?<!…)`）：iOS 16.4 以前會讓整個外掛載入失敗。lookahead 可以。
- 遵守 Obsidian 外掛規範：不用 `innerHTML`、不用全域的 `app`、靜態樣式寫在 CSS 不寫在 JS、指令不設預設快速鍵、英文介面文字用 sentence case。
- Obsidian 的外掛掃描比本機的 `npm run lint` 嚴：`style.setProperty('--x', '0px')` 這種寫死的值也算靜態樣式（改成 `removeProperty`，預設值寫在 CSS 的 `var(--x, 0px)`；算出來的值才用 `setProperty`）；`instanceof (win).HTMLInputElement` 這種跨視窗的寫法會被警告（改用 `tagName`／`nodeType` 判斷）。
- Obsidian 的外掛掃描也檢查 CSS（`npm run lint` 不會抓到）：不用 `!important`（改用更具體的選擇器，或在 JS 拿掉第三方寫在元素上的樣式）、不用 `:has`（改加類別）、同一條規則不寫兩次同一個屬性（後援寫成 `@supports`）、捲軸不直接寫 `scrollbar-width`（用 Obsidian 的 `--scrollbar-native-width: none` 加 `::-webkit-scrollbar`）、不用 `mask-image`／`-webkit-mask-image`（掃描以 Obsidian 1.4.5 的 Chromium 為準，會報「partial support」）。淡出改成蓋一層從透明到底色的漸層，底下有淡色時疊在 `--wm-fade-tint`（做法見 `styles/word-mode.css` 收合的圖表）。掃描讀的是 `styles/word-mode.css`，本機可以用 `npx doiuse@6 --browsers "chrome 114" styles/word-mode.css` 重現（沒有輸出就是通過）。
- 新用到的 Obsidian API 要在 1.5.7 存在。非公開的 API 一律宣告在 `src/obsidian-internal.d.ts` 並標成可能不存在，呼叫前先檢查，壞掉時只少一項功能。
- 功能有變動時，十三份 README（`README.md`、`.zh-TW`、`.nan-TW`（台文）、`.yue-HK`（粵語）、`.zh-CN`、`.ja`、`.ko`、`.vi`、`.fr`、`.de`、`.es`、`.ar`、`.he`）都要更新。README 只寫給使用者看的介紹與功能；開發、架構、發佈寫在 `docs/development.md`（與 `.zh-TW`）。動畫裡的介面變了就用 `node docs/record/record.mjs <場景>` 重錄，只錄受影響的場景（每次重錄都會永久留在 git 歷史）。
- GitHub Actions：`ci.yml` 只能手動觸發，維持這樣，平常的驗證都在本機做。`release.yml` 會在推版本 tag 時自動執行（測試、建置、來源證明、建立 GitHub Release）。
- 程式碼註解用繁體中文，說明「為什麼」。
- Commit 與 PR：英文，標題 `type(scope): what`；作者只用 git config 的 NatLee，不加任何 Claude／AI 的署名或字樣。交付流程用 `ship` skill（拆成主題 commit、開 PR、merge commit、刪分支）。

## 版本

- **有更新就要升版號**（NatLee，2026-11-18）。每次交付改到外掛的更新，合併到 `main` 之後在 `main` 上執行 `npm version patch`（修正、重構）或 `npm version minor`（新功能）。只改 `.claude/` 這類不屬於外掛的檔案不算。
- 版本號的來源是 `package.json`；`npm version` 會同步 `manifest.json`、`versions.json` 並建立 commit 與 tag（不加 `v`）。不要手改版號。
- **推 tag 就是公開發佈**：tag 一推上去，release workflow 就會建立 GitHub Release，使用者會收到更新。
- 升版後直接 `git push origin main --follow-tags`，不用先問（NatLee，2026-11-18，確認時已知道這會發佈）。推完用 `gh run list --limit 1` 與 `gh release view <版本>` 確認 workflow 成功、Release 有三個檔案。
- Actions 不能用的時候才用 `npm run release:local`（沒有來源證明）；這個要先問使用者。

## Vault

使用者的 vault 是真實的工作筆記，由 Synology Drive 同步，路徑記在這台電腦的 Claude 記憶 `word-mode-vault-rules`（不在這個 repo 裡）。

- 只有使用者要求時才部署：把 `dist/` 的三個檔案複製到 `<vault>/.obsidian/plugins/natlee-word-mode/`。
- 絕不修改 vault 裡的筆記，不覆蓋外掛的 `data.json`。
- 原始碼、`node_modules` 不能放進 Synology Drive 同步的資料夾（曾經讓同步程式當掉）。

## 這台機器（Windows、Git Bash）

- Bash 工具會把 `\\` 變成 `\`，包含加了引號的 heredoc。含反斜線的腳本、regex、LaTeX 一律用 Write／Edit 工具寫成檔案再執行。
- 沒有 Python。臨時腳本用 Node 寫，放在 session 的 scratchpad，不要放進專案。

## 讀檔的習慣（省 token）

- 這些檔案很大，先用 Grep 找到位置再讀片段，不要整檔讀：`src/view.ts`、`src/commands.ts`、`src/markdown.ts`、`src/nodeviews.ts`、`src/toolbar.ts`、`src/main.ts`、`src/settingstab.ts`、`src/i18n-*.ts`、`styles/word-mode.css`、`tests/view/*.mjs`。
- `tests/view/bundle.mjs` 與 `tests/.build/` 是打包產物，不要讀。用 Grep 工具搜尋會自動略過；用 bash 的 `grep -r` 會掃到它。
- 找缺的翻譯鍵：跑 `npm run typecheck`，錯誤訊息裡 `is not assignable` 前面的字串就是缺的鍵。
- 介面改動要看實際版面時，照記憶 `word-mode-visual-check` 的做法用無頭 Chrome 截圖，不必部署到 vault。
