# Word Mode（Word 模式）

[English](README.md) | **繁體中文** | [日本語](README.ja.md) | [한국어](README.ko.md)

把 [Obsidian](https://obsidian.md) 的 Markdown 筆記變成像 Word 一樣編輯：有工具列、表格、圖片，存檔仍然是乾淨的 Markdown。

## 這個外掛做什麼

Word Mode 替 `.md` 筆記多加一種編輯器。畫面上看到的是排版好的文字，不是 Markdown 符號；用工具列按鈕和文書軟體常見的快速鍵就能設定格式。

檔案仍然是純 Markdown。編輯筆記時，只有修改過的區塊會重新輸出，其餘部分一字不差保留原文。

## 功能

- **功能區工具列**：常用、插入、校閱、檢視四個分頁。
- **表格**：直接在表格裡編輯，可以增刪列與欄、設定對齊，也可以從試算表貼上儲存格。
- **圖片**：貼上或挑選圖片，拖曳就能調整大小。
- **連結**：連到筆記、標題或網頁；游標在連結上時會出現小工具列。
- **尋找與取代**。
- **大綱側邊欄**與標題摺疊。
- **編輯標記**（例如 `¶`），以及清除看不見的字元或殘留符號的工具。
- **提示框、方程式、待辦清單、程式碼區塊**（含語法上色）。
- **貼上 Markdown 文字**時可以一鍵轉成格式。
- **同步衝突處理**：筆記有未存檔的修改時又在磁碟上被改過，可以選擇要保留哪一份。
- 介面語言：繁體中文、英文、日文、韓文。

無法用 Word 方式編輯的內容（例如 HTML 區塊、註腳定義）會顯示成原文區塊，存檔時原樣保留。

## 使用方式

啟用外掛後，Markdown 筆記預設用 Word 模式開啟。

- 切換 Word 模式與 Markdown：按筆記右上角的按鈕，或按 `Ctrl+E`（macOS 是 `Cmd+E`）。
- 指定用哪一種模式開啟：在筆記上按右鍵，選「以 Word 模式開啟」或「以 Markdown 開啟」。
- 讓單一筆記不使用 Word 模式：在筆記屬性加上 `word-mode: false`。
- 讓整個資料夾不使用 Word 模式：到「設定 → Word Mode → 不使用 Word 模式的資料夾」填入資料夾。

### 指令

| 指令 | 說明 |
| --- | --- |
| 以 Word 模式編輯目前筆記 | 把目前的筆記切換到 Word 模式。 |
| 以 Markdown 編輯目前筆記 | 把目前的筆記切回 Markdown 編輯器。 |
| 切換 Word 模式／Markdown | 在兩種模式之間切換。 |
| 開啟／關閉大綱側邊欄 | 顯示或隱藏大綱。 |
| 尋找 | 在目前的筆記中搜尋。 |
| 尋找與取代 | 在目前的筆記中搜尋並取代。 |
| 大綱：跳到標題 | 跳到目前筆記的某個標題。 |
| 顯示快速鍵說明 | 列出 Word 模式所有的快速鍵。 |

所有指令都沒有預設快速鍵，可以到「設定 → 快捷鍵」自行指定。

## 安裝

需要 Obsidian 1.5.7 以上。

1. 到[最新版本](https://github.com/NatLee/obsidian-word-mode/releases/latest)下載 `main.js`、`manifest.json`、`styles.css`。
2. 把三個檔案放到 `<你的 vault>/.obsidian/plugins/natlee-word-mode/`。
3. 在 Obsidian 開啟「設定 → 第三方外掛」，啟用「Word Mode」。

## 隱私與揭露事項

- **網路**：不使用。外掛本身不會發出任何網路連線。如果用網址插入圖片，Obsidian 會從該網址載入圖片，跟一般筆記相同。
- **遙測**：沒有。
- **帳號與付費**：不需要。
- **vault 以外的檔案**：不會讀取或寫入。
- **外掛會建立的檔案**：貼上的圖片會存到附件資料夾。同步衝突時如果選擇兩份都保留，你的版本會另存在筆記旁邊。

## 已知限制

- 手機上的操作沒有在實機測試過。
- Markdown 與閱讀模式的工具列有部分按鈕呼叫 Obsidian 內建指令，沒有逐一實測。
- 日文、韓文翻譯沒有經過母語者校對。

## 開發

需要 Node.js 22。

| 指令 | 說明 |
| --- | --- |
| `npm install` | 安裝相依套件。 |
| `npm test` | 執行轉換測試與編輯測試（以 jsdom 模擬 Obsidian）。最後一行應是 `ALL PASS`。 |
| `npm run build` | 建置到 `dist/`，不壓縮。 |
| `npm run build:prod` | 建置 `main.js`、`manifest.json`、`styles.css` 到 `dist/`。 |
| `npm run test:vault -- <vault 路徑>` | 對 vault 裡每一份筆記做往返檢查。唯讀，只輸出統計與檔案路徑。 |

修改 `src/markdown.js` 或 `src/schema.js` 之後，請對真實的 vault 執行 `npm run test:vault`，確認 `notExact` 與 `lossyBlocks` 都是 `0`。

不要把這個資料夾或 `node_modules` 放在同步軟體監看的資料夾裡，例如 Synology Drive。

程式結構請看[英文版 README](README.md#project-structure)。

### 發佈新版本

版本號寫在 `package.json`，`manifest.json` 與 `versions.json` 會跟著更新。

1. 執行 `npm version patch`、`npm version minor` 或 `npm version major`。這會更新 `package.json`、`manifest.json`、`versions.json`，並建立 commit 與 tag（例如 `1.2.1`）。
2. 執行 `git push origin main`。
3. 執行 `npm run release:local`。這會跑測試、建置外掛、推 tag，並建立附有 `main.js`、`manifest.json`、`styles.css` 的 GitHub Release。需要 [GitHub CLI](https://cli.github.com)，不使用 GitHub Actions。

tag 必須與版本號完全相同，前面不加 `v`，因為 Obsidian 會找這個 tag 的 Release。

CI 與 release workflow 都不會自動執行。要執行時，到 **Actions** 分頁選擇 workflow，再選 **Run workflow**。release workflow 要在「Use workflow from」選擇要發佈的 tag。

## 致謝

Word Mode 打包了這些開放原始碼函式庫：

- [ProseMirror](https://prosemirror.net)，作者 Marijn Haverbeke 與貢獻者，MIT 授權。
- [markdown-it](https://github.com/markdown-it/markdown-it) 與 [markdown-it-mark](https://github.com/markdown-it/markdown-it-mark)，MIT 授權。
- [entities](https://github.com/fb55/entities)，BSD 2-Clause 授權。

## 授權

[MIT 授權](LICENSE)。
