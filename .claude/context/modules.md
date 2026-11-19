# 模組地圖與常見修改

需要動到某一塊時再讀這份。每個原始檔開頭都有一行中文註解說明用途，這裡只寫跨檔案才看得出來的事。

## 哪個功能在哪裡

| 要改的東西 | 看這裡 |
| --- | --- |
| Markdown ⇄ 文件的轉換、哪些語法認得 | `markdown.ts`（切段、markdown-it 規則、序列化）、`schema.ts`（節點與 mark） |
| 編輯指令（粗體、清單、表格、對齊、排序…） | `commands.ts`。表格指令在 `table` 物件；`inCode`／`codeBlocked` 判斷程式碼區塊 |
| 功能區按鈕 | `toolbar.ts` 的 `buildHome`／`buildInsert`／`buildReview`／`buildView`；Markdown／閱讀模式的對應按鈕在 `mdbar.ts` 的 `render()` |
| 功能區的分頁與群組（哪個群組在哪個分頁、順序、名稱） | `toolbar.ts` 的 `TABS`、`GROUPS` 是預設值；`groupLayout(settings)` 套用使用者的自訂（`groupNames`、`groupTabs`、`groupOrder`），兩條功能區與設定頁的清單（`groupsettings.ts`）都用它，不要直接讀 `GROUPS` 排版 |
| 色彩面板 | `colorpicker.ts`（`buildColorPanel`）；由 `toolbar.ts` 的 `openColorPopup`／`openHighlightPopup` 開啟 |
| 右鍵選單、快速鍵、貼上、拖放 | `view.ts` 的 `onContextMenu`、`onOpen`（scope 的快速鍵）、`onKeyDown`、`onPaste`、`onDrop` |
| 連結、圖片、程式碼區塊、表格、提示框、文件屬性的畫面 | `nodeviews.ts`（每種節點一個 NodeView；需要 Obsidian 的功能由 `NodeViewContext` 傳入，在 `view.ts` 的 `nodeViewContext()`） |
| 連結／圖片上的浮動小工具列 | `bubble.ts` |
| 右下角的狀態列（字數、存檔狀態、檢視切換、查看文件屬性、縮放） | `statusbar.ts` 的 `buildStatusBar`：Word 模式（`view.ts` 的 `buildBottomBar`）與 Markdown／閱讀模式（`MdStatusBar`，由 `main.ts` 的 `updateStatus` 建立）共用，兩邊的版面要一樣 |
| 查看文件屬性的小視窗、固定在上方的屬性列 | `propview.ts`（`openPropsPeek`、`fillPropsPeek`、`fillPinSummary`）；資料由 `props.ts` 的 `peekData` 整理。Word 模式的屬性列在 `view.ts` 的 `updatePin`，Markdown 模式讀原文在 `mdbar.ts` 的 `openMarkdownPeek` |
| 對話框（連結、方程式、快速鍵、清理符號、字數） | `dialogs.ts`；方程式的格子編輯在 `mathvisual.ts`（`MathField`） |
| 圖表編輯器 | `mermaid.ts`（對話框、表單、圖上編輯）、`diagrams.ts`（十一種圖表的描述、圖表外觀、欄位種類）、`flowchart.ts`（流程圖的解析與範本 `MERMAID_TEMPLATES`） |
| 自己存的公式與圖表範本 | `templates.ts`（資料操作，純函式）、`templateui.ts`（設定頁的管理清單）；存在設定的 `mathTemplates`、`diagramTemplates`。方程式編輯器的「我的公式」在 `dialogs.ts`，圖表編輯器的「我的範本」在 `mermaid.ts` |
| 設定 | `main.ts`：`Settings` 介面、`DEFAULTS`、`settingSections()`。設定分成幾類（`SectionId`），設定頁上方的分類列在 `settingsnav.ts`，一次只顯示一類；其他分類用 CSS 隱藏（`.wm-settings[data-wm-tab]`），不用設定定義的 `visible`（會讓那些設定搜尋不到） |
| 設定頁的搜尋框 | 畫面與鍵盤操作在 `settingsnav.ts` 的 `buildSettingSearch`，比對與排序在 `settingsearch.ts`（純函式，同義詞在 `SYNONYMS`）。`main.ts` 的 `WordModeSettings` 記下每一列畫在哪裡（`rowEls`），`searchItems()` 用 `settingTextsByLanguage()` 暫時切換語言取得每一列在各語言的文字，所以介面是中文也能打英文找到。列加上 `common: true` 會在還沒打字時列在「常用的設定」 |
| 尋找取代、摺疊、大綱、編輯標記、自動格式、`[[`／`#` 選單 | `find.ts`、`fold.ts`、`outline.ts`、`marks.ts`、`autoformat.ts`、`suggest.ts` + `complete.ts` |
| 按鈕的詳細提示與示意動畫 | `hints.ts` 的 `DEMOS`（按鈕的 `demo` 屬性是它的鍵，型別是 `DemoName`，寫了不存在的名稱型別檢查會失敗），動畫在 CSS 的 `wm-anim-*`、`wm-step-*`。快速鍵說明（`dialogs.ts` 的 `SHORTCUTS`）每一列的第三個欄位也是 `DemoName`，按那一列會展開同一段動畫 |

## 常見修改的做法

**加一個功能區按鈕**：在 `toolbar.ts` 對應的 `build*` 裡呼叫 `this.button(g, { icon, title, text, desc, cmd 或 onClick, active, enabled, why })`。`title`、`desc`、`label` 是翻譯前的中文原文。需要 Obsidian 的動作加到 `ToolbarContext.dialogs`，在 `view.ts` 的 `buildToolbar()` 實作。在程式碼區塊裡不適用的按鈕加 `...NO_CODE`。Markdown 模式也該有的話，在 `mdbar.ts` 同一個群組加對應的按鈕。

**加一個設定**：`main.ts` 三處：`Settings` 介面、`DEFAULTS`、`settingSections()` 裡的一列（`toggleRow`、`row`，或 `kind: 'grid'` 放自訂內容），放進合適的分類。要加新的分類時：`SectionId` 加一個 id、`settingSections()` 加一段，`styles/word-mode.css`「設定頁：分類列」的隱藏規則也要加一個選擇器（`tests/view/ui.mjs` 會檢查）。會影響功能區的設定，`onChange` 要呼叫 `refreshToolbars()`，並把欄位加進 `ToolbarContext.settings`。

**加介面文字**：直接在程式裡寫中文原文（`t('…')` 或標成 `I18nKey` 的欄位），再把鍵加進 `i18n-en.ts`，以及 `i18n-ja.ts`、`i18n-ko.ts`、`i18n-nan.ts`（台文，漢字）、`i18n-zh-cn.ts`、`i18n-es.ts`、`i18n-ar.ts`、`i18n-he.ts` 的結尾。每個檔案每筆一行，格式是 `JSON.stringify` 的結果。帶變數的寫 `{name}`。阿拉伯文與希伯來文裡寫進 Mermaid 程式碼的範例與識別名稱（例如 `NewState`）保留英文，由右往左的文字會打亂程式碼那一行的顯示。

**加一種圖表或一個表單欄位**：只改 `diagrams.ts`（新的欄位種類才要動 `mermaid.ts` 的 `field()`；現有的種類是 text、lines、select、check、level、color）。新增一個 `DiagramKind`（`head`、`parse`、`generate`、`opts`、`lists`），加進 `DIAGRAM_KINDS`，並在 `flowchart.ts` 的 `MERMAID_TEMPLATES` 加範本。`parse` 遇到看不懂的寫法要回傳原因（`'blocks'`、`'syntax'`），不要硬猜。欄位的 `group` 讓同一類名稱在圖上改名時一起改，`def` 讓表單裡改名也連動。

**用到 Obsidian 非公開的 API**：先在 `obsidian-internal.d.ts` 宣告成可能不存在，呼叫前檢查，並準備好沒有時的退路（例如右鍵子選單的 `canSubmenu()`）。

## 圖表編輯器的效能（很長的圖表）

兩百個步驟的流程圖曾經讓表單每打一個字要 0.2 秒。改任何一處時記得這幾件事：

- 清單一次只畫一段（`CHUNK` 列，`ListView` 的 `start`／`shown`），`markRow` 會換到那一列所在的段落。不要為了某個功能把整個清單畫出來。
- 下拉選單的選項超過 `LAZY_OPTIONS` 個時只放目前選的那一個，取得焦點才補齊、離開就收回（`fillSelect`）。選項內容用 `optionsOf` 取，同一輪更新每個欄位只算一次。
- 方程式與圖表編輯器的對話框在桌機與平板上是上緣固定（`word-mode.css` 的 `body:not(.is-phone) .modal.wm-eq-modal, … .wm-mmd-modal`），不要改回 Obsidian 預設的垂直置中：高度會隨打字、加列改變，置中會讓整個對話框跳動。
- 預覽重畫時新的圖先畫在 `stage` 裡看不見的 canvas，畫好（出現 `svg`）才換上去（`whenDrawn`），所以捲動位置不會跑掉。要在新圖出來之後做的事放進 `afterDraw`。
- 預覽的圖以 SVG 的 viewBox 寬度為準（`sizeCanvas`），100% 是原本的大小；`autoZoom` 為 true 時每次畫好自動決定倍率，使用者動過縮放就不再自動。
- 文件裡的程式碼區塊結果與內嵌用 `dom.ts` 的 `whenVisible`，捲到看得到才畫；很高的結果由 `CodeBlockView.syncTall` 收合。
- 用記憶 `word-mode-visual-check` 的做法在真的 Chrome 裡量（jsdom 量不出版面與繪製的時間）。

## Mermaid 的限制（實測 10.9.1 與 11.4.1）

- ER 圖：實體名稱與關係的說明只要不是英數字就要加雙引號；欄位的型別與名稱只能用英數字與底線，中文說明寫在後面的引號裡。
- 象限圖：座標軸、象限、項目的名稱不是英數字就要加雙引號，標題不能加（加了引號會直接畫出來）。
- 其他九種圖表可以直接用中文名稱。
- 圖表外觀是最前面的一行 `%%{init: {"theme": "…"}}%%`（`parseDiagram`／`generateDiagram` 處理，各種圖表的 `parse`／`generate` 不用管）；流程圖節點的底色是 `style <代號> fill:…,stroke:…,color:…`。
- 表單產生的程式碼由 `generate` 負責加引號或換掉會出問題的字元；預覽上方會顯示 Mermaid 的語法錯誤。

## 手機與平板

- CSS 用 Obsidian 加在 body 上的 `.is-mobile`、`.is-phone`、`.is-tablet`（對話框、彈出面板不在 `.wm-view` 裡，吃不到 `.wm-mobile`）。
- 手機上輸入框的字要 16px 以上，iOS 才不會在取得焦點時放大畫面。
- 按鈕不能搶走輸入位置的焦點：用 `dom.ts` 的 `keepFocus()`（連 pointerdown 一起擋，螢幕鍵盤才不會收起來）。
- 螢幕鍵盤常常沒有按鍵事件（`^`、Backspace 的 keydown 收不到）、也沒有方向鍵與 Tab：要靠 `input` 事件判斷打了什麼，並提供對應的按鈕。

## README 與文件

- README 給 Obsidian 使用者看：介紹、功能、操作動畫、安裝、隱私揭露。開發、架構、測試、發佈流程寫在 `docs/development.md` 與 `docs/development.zh-TW.md`（繁體中文、台文 README 連到中文版，其他語言連到英文版）。阿拉伯文、希伯來文 README 整份包在 `<div dir="rtl">` 裡。操作動畫只錄了 en、zh-TW、ja、ko 四種：台文、簡體中文的 README 用 zh-TW 的動畫，西班牙文、阿拉伯文、希伯來文用 en 的。存檔示意圖（`docs/images/generate.mjs`）九種語言都有，阿拉伯文與希伯來文整張左右鏡像。
- 操作動畫（`docs/images/<場景>.<語言>.webp`，WebP 動畫、品質 75）由 `node docs/record/record.mjs <場景> [--lang en]` 錄製：真的外掛程式碼在無頭 Chrome 裡跑，Obsidian 換成 `docs/record/mock.js`；每個場景的操作在 `docs/record/scenes.mjs`。功能區、對話框的版面或文字有變，只重錄受影響的場景（每次重錄都會永久留在 git 歷史；全部重錄要加 `--all`）。需要 Chrome、ffmpeg 與網路。
- 存檔示意圖（`saving.*.svg`）由 `node docs/images/generate.mjs` 產生。

## 測試

- `tests/*.mjs`：純函式測試，由 `tests/run.mjs` 用 esbuild 打包後執行。斷言失敗印 `FAIL`。
- `tests/view/*.mjs`：在 jsdom 裡跑整個 `WordModeView`，Obsidian 由 `tests/view/obsidian-mock.js` 代替，環境在 `harness.mjs`（`makeEnv`、`type`、`press`、`caret`）。新的介面測試加在 `ui.mjs`，一個功能一段，用 `// ======== 標題 ========` 分開。要測的模組沒有匯出時加進 `tests/view/entry.js`。
- jsdom 的限制：元素的位置與大小都是 0；`contentEditable` 的 `focus()` 不會真的取得焦點；直接改 `textContent` 不會移動游標（要自己用 `MathField.place` 放）；`MarkdownRenderer` 的替身只輸出 `RENDERED:` 加原文，沒有 SVG。
- 預覽圖、版面、真的打字這類 jsdom 測不到的東西，在真的 Chrome 裡看：`docs/record/` 的錄製工具加 `--png` 只存最後一個畫面，或在 `scenes.mjs` 暫時加一個場景；也可以照記憶 `word-mode-visual-check` 的做法。
- 拆成多個 commit 時，每個 commit 都要單獨通過測試與 lint。
