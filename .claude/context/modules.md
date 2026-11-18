# 模組地圖與常見修改

需要動到某一塊時再讀這份。每個原始檔開頭都有一行中文註解說明用途，這裡只寫跨檔案才看得出來的事。

## 哪個功能在哪裡

| 要改的東西 | 看這裡 |
| --- | --- |
| Markdown ⇄ 文件的轉換、哪些語法認得 | `markdown.ts`（切段、markdown-it 規則、序列化）、`schema.ts`（節點與 mark） |
| 編輯指令（粗體、清單、表格、對齊、排序…） | `commands.ts`。表格指令在 `table` 物件；`inCode`／`codeBlocked` 判斷程式碼區塊 |
| 功能區按鈕 | `toolbar.ts` 的 `buildHome`／`buildInsert`／`buildReview`／`buildView`；Markdown／閱讀模式的對應按鈕在 `mdbar.ts` 的 `render()` |
| 色彩面板 | `colorpicker.ts`（`buildColorPanel`）；由 `toolbar.ts` 的 `openColorPopup`／`openHighlightPopup` 開啟 |
| 右鍵選單、快速鍵、貼上、拖放 | `view.ts` 的 `onContextMenu`、`onOpen`（scope 的快速鍵）、`onKeyDown`、`onPaste`、`onDrop` |
| 連結、圖片、程式碼區塊、表格、提示框、文件屬性的畫面 | `nodeviews.ts`（每種節點一個 NodeView；需要 Obsidian 的功能由 `NodeViewContext` 傳入，在 `view.ts` 的 `nodeViewContext()`） |
| 連結／圖片上的浮動小工具列 | `bubble.ts` |
| 對話框（連結、方程式、快速鍵、清理符號、字數） | `dialogs.ts`；方程式的格子編輯在 `mathvisual.ts`（`MathField`） |
| 圖表編輯器 | `mermaid.ts`（對話框、表單、圖上編輯）、`diagrams.ts`（九種圖表的描述）、`flowchart.ts`（流程圖的解析與範本 `MERMAID_TEMPLATES`） |
| 設定 | `main.ts`：`Settings` 介面、`DEFAULTS`、`settingSections()` |
| 尋找取代、摺疊、大綱、編輯標記、自動格式、`[[`／`#` 選單 | `find.ts`、`fold.ts`、`outline.ts`、`marks.ts`、`autoformat.ts`、`suggest.ts` + `complete.ts` |
| 按鈕的詳細提示與示意動畫 | `hints.ts` 的 `DEMOS`（按鈕的 `demo` 屬性是它的鍵），動畫在 CSS 的 `wm-anim-*` |

## 常見修改的做法

**加一個功能區按鈕**：在 `toolbar.ts` 對應的 `build*` 裡呼叫 `this.button(g, { icon, title, text, desc, cmd 或 onClick, active, enabled, why })`。`title`、`desc`、`label` 是翻譯前的中文原文。需要 Obsidian 的動作加到 `ToolbarContext.dialogs`，在 `view.ts` 的 `buildToolbar()` 實作。在程式碼區塊裡不適用的按鈕加 `...NO_CODE`。Markdown 模式也該有的話，在 `mdbar.ts` 同一個群組加對應的按鈕。

**加一個設定**：`main.ts` 三處：`Settings` 介面、`DEFAULTS`、`settingSections()` 裡的一列（`toggleRow`、`row`，或 `kind: 'grid'` 放自訂內容）。會影響功能區的設定，`onChange` 要呼叫 `refreshToolbars()`，並把欄位加進 `ToolbarContext.settings`。

**加介面文字**：直接在程式裡寫中文原文（`t('…')` 或標成 `I18nKey` 的欄位），再把鍵加進 `i18n-en.ts`、`i18n-ja.ts`、`i18n-ko.ts` 的結尾。三個檔案每筆一行，格式是 `JSON.stringify` 的結果。帶變數的寫 `{name}`。

**加一種圖表或一個表單欄位**：只改 `diagrams.ts`。新增一個 `DiagramKind`（`head`、`parse`、`generate`、`opts`、`lists`），加進 `DIAGRAM_KINDS`，並在 `flowchart.ts` 的 `MERMAID_TEMPLATES` 加範本。`parse` 遇到看不懂的寫法要回傳原因（`'blocks'`、`'syntax'`），不要硬猜。欄位的 `group` 讓同一類名稱在圖上改名時一起改，`def` 讓表單裡改名也連動。

**用到 Obsidian 非公開的 API**：先在 `obsidian-internal.d.ts` 宣告成可能不存在，呼叫前檢查，並準備好沒有時的退路（例如右鍵子選單的 `canSubmenu()`）。

## Mermaid 的限制（實測 10.9.1 與 11.4.1）

- ER 圖：實體名稱與關係的說明只要不是英數字就要加雙引號；欄位的型別與名稱只能用英數字與底線，中文說明寫在後面的引號裡。
- 其他八種圖表可以直接用中文名稱。
- 表單產生的程式碼由 `generate` 負責加引號或換掉會出問題的字元；預覽上方會顯示 Mermaid 的語法錯誤。

## 測試

- `tests/*.mjs`：純函式測試，由 `tests/run.mjs` 用 esbuild 打包後執行。斷言失敗印 `FAIL`。
- `tests/view/*.mjs`：在 jsdom 裡跑整個 `WordModeView`，Obsidian 由 `tests/view/obsidian-mock.js` 代替，環境在 `harness.mjs`（`makeEnv`、`type`、`press`、`caret`）。新的介面測試加在 `ui.mjs`，一個功能一段，用 `// ======== 標題 ========` 分開。要測的模組沒有匯出時加進 `tests/view/entry.js`。
- jsdom 的限制：元素的位置與大小都是 0；`contentEditable` 的 `focus()` 不會真的取得焦點；直接改 `textContent` 不會移動游標（要自己用 `MathField.place` 放）；`MarkdownRenderer` 的替身只輸出 `RENDERED:` 加原文，沒有 SVG。
- 預覽圖、版面、真的打字這類 jsdom 測不到的東西，用記憶 `word-mode-visual-check` 的無頭 Chrome 做法檢查。
- 拆成多個 commit 時，每個 commit 都要單獨通過測試與 lint。
