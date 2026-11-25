# 模組地圖與常見修改

需要動到某一塊時再讀這份。每個原始檔開頭都有一行中文註解說明用途，這裡只寫跨檔案才看得出來的事。

## 哪個功能在哪裡

| 要改的東西 | 看這裡 |
| --- | --- |
| Markdown ⇄ 文件的轉換、哪些語法認得 | `markdown.ts`（切段、markdown-it 規則、序列化）、`schema.ts`（節點與 mark） |
| 編輯指令（粗體、清單、表格、對齊、排序…） | `commands.ts`。表格指令在 `table` 物件；`inCode`／`codeBlocked` 判斷程式碼區塊 |
| 功能區按鈕 | 兩條功能區都有的按鈕，外觀（圖示、名稱、文字、快速鍵、說明、動畫）在 `ribbon.ts` 的 `ACTIONS`；按下去做什麼在 `toolbar.ts` 的 `buildHome`／`buildInsert`／`buildReview`／`buildView`（Word 模式）與 `mdbar.ts` 的 `render()`（Markdown／閱讀模式）。只有 Word 模式有的按鈕，外觀直接寫在 `toolbar.ts` |
| 功能區的外殼（分頁列、收成選單的按鈕、面板、群組、按鈕的 DOM、提示） | `ribbon.ts` 的 `RibbonShell`，兩條功能區各建一個。兩邊還留著的差別（都只在 Word 模式有）：群組元素的 `data-group`、停用按鈕的 `aria-disabled`、詳細提示模式下 `.wm-sr` 文字裡的停用原因 |
| 功能區的分頁與群組（哪個群組在哪個分頁、順序、名稱） | `ribbon.ts` 的 `TABS`、`GROUPS` 是預設值；`groupLayout(settings)` 套用使用者的自訂（`groupNames`、`groupTabs`、`groupOrder`），兩條功能區與設定頁的清單（`groupsettings.ts`）都用它，不要直接讀 `GROUPS` 排版 |
| 色彩面板 | `colorpicker.ts`（`buildColorPanel`）；由 `toolbar.ts` 的 `openColorPopup`／`openHighlightPopup` 開啟 |
| 右鍵選單、快速鍵、貼上、拖放 | 右鍵選單在 `contextmenu.ts` 的 `openContextMenu`（`view.ts` 的 `onContextMenu` 呼叫它）；其餘在 `view.ts` 的 `onOpen`（scope 的快速鍵）、`onKeyDown`、`onPaste`、`onDrop` |
| 連結、圖片、程式碼區塊、表格、提示框、文件屬性的畫面 | `nodeviews.ts`（每種節點一個 NodeView；需要 Obsidian 的功能由 `NodeViewContext` 傳入，在 `view.ts` 的 `nodeViewContext()`） |
| 連結／圖片上的浮動小工具列 | `bubble.ts` |
| 表格的列與欄把手、右上角的按鈕、「表格」情境分頁 | 把手在 `tablegrips.ts`（裝飾，也替游標所在的表格加 `is-active`）；右上角的按鈕在 `nodeviews.ts` 的 `WordTableView`；把手與「表格選項」的選單在 `contextmenu.ts` 的 `openTableMenu`；情境分頁由 `ribbon.ts` 的 `contextTab`／`setContextTab` 建立，按鈕在 `toolbar.ts` 的 `buildTable`。`prosemirror-tables` 會把整張表的節點選取換成所有儲存格的選取，所以「整張表被選取」看的是 `CellSelection` 的 `isRowSelection() && isColSelection()` |
| 右下角的狀態列（字數、存檔狀態、檢視切換、查看文件屬性、縮放） | `statusbar.ts` 的 `buildStatusBar`：Word 模式（`view.ts` 的 `buildBottomBar`）與 Markdown／閱讀模式（`MdStatusBar`，由 `main.ts` 的 `updateStatus` 建立）共用，兩邊的版面要一樣。字數的兩種算法（設定 `countMethod`）在 `textstats.ts`：`countText` 只算看得到的文字、`countSource` 跟 Obsidian 內建的字數一樣（逐字比對過 Obsidian 1.15.1 的 regex）。狀態列有字數時，`main.ts` 的 `hideBuiltinCount` 藏起 Obsidian 內建的字數（它在 Word 模式也會出現） |
| 路徑的顯示與「複製路徑」 | `paths.ts`：`pathEntries()` 列出可以複製的路徑（保管庫內、完整路徑、Obsidian 網址…），狀態列（`buildStatusBar` 的 `file`）與 `view.pathItems()`（連結、內嵌、圖片的右鍵選單）都用它 |
| 游標的樣式 | `caret.ts` 的 `caretPlugin`：在頁面上畫一個元素跟著選取移動；`view.applyCaretLook()` 切換 `wm-caret-custom`（藏內建游標）、`wm-caret-touch`（手機、平板）與顏色 `--wm-caret-color`。閃爍每次移動、點擊、按鍵都從亮的那一半重來：切換 `is-odd` 換成另一組一樣的 `@keyframes`（`wm-caret-fade`／`wm-caret-fade2`），兩組要一起改；位置沒變的更新（別的外掛、裝飾）不重來，不然游標一直亮著。手機只在 `.wm-caret-on`（自己的游標畫著）時藏內建的：選取把手跟著 `caret-color`。手指按著到放開後 400ms，`followDom` 每一格照 DOM 的選取畫（`posAtDOM` → `coordsAtPos`，不滑動）：長按拖曳時 touch.ts 不讓 PM 讀選取，只照 PM 的狀態畫會跟 iOS 的放大鏡對不上（1.34.0 改成長按交回系統游標，手指一動就沒換到，換到時又像游標變回原樣，已拿掉）。觸控板放大鏡裡的標記也照形狀畫（`LoupeOptions.caret`、`data-shape`）。設定頁的預覽是 `caretDemo`（同一組 CSS）。編輯區裡自己的輸入框要在 CSS 把 `caret-color` 放回來 |
| 查看文件屬性的小視窗、固定在上方的屬性列 | `propview.ts`（`openPropsPeek`、`fillPropsPeek`、`fillPinSummary`）；資料由 `props.ts` 的 `peekData` 整理。Word 模式的屬性列在 `view.ts` 的 `updatePin`，Markdown 模式讀原文在 `mdbar.ts` 的 `openMarkdownPeek`。兩邊都經過 `showProps`：手機上開成 Obsidian 的 Modal（`.wm-props-modal`），可以直接編輯，手機上是貼著鍵盤上緣的底部面板，鍵盤開著時有擴充列（上一欄、下一欄用 `accessory.ts` 的 `stepField`，符號用 `textField` + `insertAt` 只插進文字欄位）（`PropsPeekOptions.edit`：Word 模式 `view.ts` 的 `writeProperties` 改節點，Markdown 模式 `mdbar.ts` 的 `markdownPropsEdit` 在編輯模式改編輯器的原文、閱讀模式用 `processFrontMatter`）；其他裝置是按鈕旁的小框。表單本身在 `propform.ts` 的 `PropsForm`（`FrontmatterView` 也用它，host 提供 `ctx`、`commit`、`render`；`quiet` 時寫回不重畫） |
| 對話框（連結、方程式、快速鍵、清理符號、字數） | `dialogs.ts`；方程式的格子編輯在 `mathvisual.ts`（`MathField`） |
| 圖表編輯器 | `mermaid.ts`（對話框、表單、圖上編輯）、`diagrams.ts`（十一種圖表的描述、圖表外觀、欄位種類）、`flowchart.ts`（流程圖的解析與範本 `MERMAID_TEMPLATES`） |
| 自己存的公式與圖表範本 | `templates.ts`（資料操作，純函式）、`templateui.ts`（設定頁的管理清單）；存在設定的 `mathTemplates`、`diagramTemplates`。方程式編輯器的「我的公式」在 `dialogs.ts`，圖表編輯器的「我的範本」在 `mermaid.ts` |
| 設定 | `settings.ts`：`Settings` 介面、`DEFAULTS`；`settingstab.ts`：`settingSections()` 與設定頁。設定分成幾類（`SectionId`），設定頁上方的分類列在 `settingsnav.ts`，一次只顯示一類；其他分類用 CSS 隱藏（`.wm-settings[data-wm-tab]`），不用設定定義的 `visible`（會讓那些設定搜尋不到） |
| 設定頁的搜尋框 | 畫面與鍵盤操作在 `settingsnav.ts` 的 `buildSettingSearch`，比對與排序在 `settingsearch.ts`（純函式，同義詞在 `SYNONYMS`）。`main.ts` 的 `WordModeSettings` 記下每一列畫在哪裡（`rowEls`），`searchItems()` 用 `settingTextsByLanguage()` 暫時切換語言取得每一列在各語言的文字，所以介面是中文也能打英文找到。列加上 `common: true` 會在還沒打字時列在「常用的設定」 |
| 尋找取代、摺疊、大綱、編輯標記、自動格式、`[[`／`#` 選單、斜線選單 | `find.ts`、`fold.ts`、`outline.ts`、`marks.ts`、`autoformat.ts`、`suggest.ts` + `complete.ts` |
| 按鈕的詳細提示與示意動畫 | `hints.ts` 的 `DEMOS`（按鈕的 `demo` 屬性是它的鍵，型別是 `DemoName`，寫了不存在的名稱型別檢查會失敗），動畫在 CSS 的 `wm-anim-*`、`wm-step-*`。快速鍵說明（`dialogs.ts` 的 `SHORTCUTS`）每一列的第三個欄位也是 `DemoName`，按那一列會展開同一段動畫 |

## 常見修改的做法

**加一個功能區按鈕**：在 `toolbar.ts` 對應的 `build*` 裡呼叫 `this.button(g, 外觀, 做法)`。外觀是 `{ icon, title, text, label, keys, desc, demo, big }`（`title`、`desc`、`label` 是翻譯前的中文原文），做法是 `{ cmd 或 onClick, active, enabled, why }`。需要 Obsidian 的動作加到 `ToolbarContext.dialogs`，在 `view.ts` 的 `buildToolbar()` 實作。在程式碼區塊裡不適用的按鈕，做法加 `...NO_CODE`。只有 Word 模式有的按鈕，外觀直接寫在呼叫的地方；Markdown 模式也該有的話，把外觀放進 `ribbon.ts` 的 `ACTIONS`（兩邊都寫 `A.名稱`），再在 `mdbar.ts` 同一個群組呼叫 `this.button(g, A.名稱, { run, active, always })`。兩邊刻意不同的值寫在那一項的 `word`／`md`：只有 Word 模式綁的快速鍵放 `word.keys`；說明提到另一邊沒有的操作時放 `word.desc`，Markdown 功能區就不顯示那句說明。

**加一個設定**：三處：`settings.ts` 的 `Settings` 介面與 `DEFAULTS`、`settingstab.ts` 的 `settingSections()` 裡的一列（`toggleRow`、`row`，或 `kind: 'grid'` 放自訂內容），放進合適的分類與小節（`sub('標題')` 之後到下一個 `sub` 為止是同一節；Obsidian 1.13 起每一節是一個有標題的群組，舊版畫成 `setHeading()` 的標題列）。說明裡寫「下一項設定」的列，下一列要真的是那一項（`ui.mjs` 會檢查）。要加新的分類時：`SectionId` 加一個 id、`settingSections()` 加一段，`styles/word-mode.css`「設定頁：分類列」的隱藏規則也要加一個選擇器（`tests/view/ui.mjs` 會檢查）。會影響功能區的設定，`onChange` 要呼叫 `refreshToolbars()`，並把欄位加進 `ToolbarContext.settings`。

**加介面文字**：直接在程式裡寫中文原文（`t('…')` 或標成 `I18nKey` 的欄位），再把鍵加進 `i18n-en.ts`，以及 `i18n-ja.ts`、`i18n-ko.ts`、`i18n-nan.ts`（台文，漢字）、`i18n-yue.ts`（粵語）、`i18n-zh-cn.ts`、`i18n-vi.ts`、`i18n-fr.ts`、`i18n-de.ts`、`i18n-es.ts`、`i18n-ar.ts`、`i18n-he.ts` 的結尾。每個檔案每筆一行，格式是 `JSON.stringify` 的結果。帶變數的寫 `{name}`。不要把翻譯好的片段接成一句（各語言語序不同，英文會變成「Insertimage」），整句當一個鍵、會變的部分用 `{name}`；示意動畫裡必須分開的片段，用空格分詞的語言要在譯文裡自己帶空格（`tests/view/ui.mjs` 的「拼接的文字」會檢查）。阿拉伯文與希伯來文裡寫進 Mermaid 程式碼的範例與識別名稱（例如 `NewState`）保留英文，由右往左的文字會打亂程式碼那一行的顯示。

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
- 螢幕鍵盤蓋住多少由 `keyboard.ts` 的 `KeyboardWatch`（`plugin.keyboard`，只有手機、平板有）量：`visualViewport`、Obsidian 的 `--keyboard-height`、鍵盤事件帶的高度三個取最大，寫在 body 的 `--wm-kb-cover` 與 `wm-kb-up`。不要只相信其中一個（iPhone 17 Pro、iOS 26 的注音鍵盤，Obsidian 縮的量少了約 100pt）。檢視用 `syncKeyboard` 讓出下方（`--wm-kb-inset`、`wm-kb-open`）；浮動面板定位用 `dom.ts` 的 `visibleBottom()`，不要用 `innerHeight`。版面不對時請使用者執行指令「複製螢幕鍵盤的診斷資訊」，貼回來的數字才是依據，不要用截圖猜。
- 螢幕鍵盤的提示（自動大寫、自動修正、鍵盤種類、右下角的鍵）用 `dom.ts` 的 `keyboardHints` 設在各個輸入欄位上；編輯區本身在游標進到程式碼裡時（`commands.ts` 的 `typingCode`）由 view.ts 的 `attributes` 關掉自動大寫與修正。新的輸入欄位記得加。
- Obsidian 手機版的滑動手勢（側邊欄、下拉）遇到 `data-ignore-swipe` 的元素就不接手（它的程式裡叫 `ignoreSwipe`）：功能區與手機的抽屜都標了。功能區跟著鍵盤滑動是 view.ts 的 `slideToolbar`（FLIP，位移在 `--wm-bar-shift`）；抽屜往下拖掉是 toolbar.ts 的 `sheetDrag`。拖曳移動游標用觸控事件（不是指標事件），拖曳中每一下都 `preventDefault`。
- 編輯區的觸控手勢在 `touch.ts`（`installTouch`，view.ts 只在行動裝置安裝）：編輯中點表格儲存格自己放游標（擋掉 iOS 的剪下／貼上選單）、兩指點一下選整段。點一般的文字不接手：iOS 的「貼上、選取、全選」選單網頁擋不掉（1.35.0 試過在 touchend 擋掉自己放游標，實機照樣跳出；只有 App 原生層的 WKWebView 改得了），不要再試。點兩個不能打字的區塊（表格、程式碼、圖表）之間的縫隙，手指碰到的是編輯區本身時 `gapTapPos` 插入空段落。表格：最後一列的空行再按 Enter 跳到表格後面（`enterOutOfTable`）；游標在表格裡、上面或下面沒有地方可以打字時，按鈕在 `WordTableView` 裡（跟著表格外框、靠開頭那一邊），`tablegrips.ts` 加上 `has-para-before`／`has-para-after` 才顯示；會出現按鈕的位置（旁邊是表格、程式碼、方程式、分隔線，或容器的頭尾）在樣式表固定留空間，按鈕不會蓋到字。Word 模式裡的提示框 `overflow: visible`（Obsidian 的會裁掉表格的按鈕、冒出內層捲軸）；「表格」分頁與表格選單有在上方／下方插入段落（`table.before`、`table.exit`）。拖曳移動游標時的放大預覽在 `loupe.ts`（複製游標那一段、用 transform 對位）。功能區按鈕「往上滑＝另一個功能」在 `ribbon.ts` 的 `swipeKeys`，配對寫在 `ACTIONS` 的 `swipe`。表格的最小寬度由 `WordTableView.looseMinWidth` 搬到 `--wm-min-width`，手機上最多撐到容器寬。
- 鍵盤上方整列是觸控板（Editorial 的做法）：`toolbar.ts` 的 `caretPad(el, hold)`。分頁選單按鈕 `hold = 0` 直接拖；整列的按住時間讀設定 `padHold`（`padHold()` 整理成 150～800ms）按住不動才變成觸控板；速度 `padSpeed`（`padSteps()`，再乘上加速度 `padGain()`：手指每一段的速度換成 0.5～2.2 倍，不滿一格的距離留到下一次）、放大鏡 `loupeShow`／`loupeStyle`（膠囊、卡片）／`loupeZoom`／`loupeWidth`／`loupeInfo`（鏡片旁的位置資訊，`caretInfo()`；`loupe.ts` 的 `loupeOptions()`）都在開始拖的時候才讀，設定改了馬上生效。上下移動（`moveCaretLines`）用 `padGoalX` 記住目標欄；這個方向緊鄰的是 `isPadObject` 的物件（原文區塊、水平線、文件屬性、顯示成結果的程式碼）時先 NodeSelection 停在上面，放大鏡改成只顯示 `objectLabel`；走不動時 `loupe.edge()` 提示文件頭尾（提示放在位置資訊的最前面，位置照常寫）。位置資訊不截斷：先填內容、量實際高度再決定鏡片上下，比鏡片寬時 `centerInfo` 收在畫面內，再放不下就換行。停在物件上時資訊壓在物件框的下緣、寬度不超過物件。放大鏡只放在捲動區看得到的範圍內（`Loupe.bounds()`，扣掉標題列、功能區、鍵盤），上方放不下才放下方。iOS 的 Touch.identifier 可能是負數，不要用 -1 當「沒有在追蹤」（`is-trackpad` 加說明 `.wm-pad-tip`），按住沒拖照常算點擊。`ribbon.ts` 的往上滑按鍵、往下滑收鍵盤看到 `is-trackpad` 就不動作。短距離移動用控制鍵列（`keyrow.ts` 的 `KeyRow`）：Esc、Tab、Ctrl（Apple 的裝置是 ⌘，`APPLE`）、Shift、方向鍵、Home、End；Ctrl／Shift 點一下作用一次、連點兩下鎖住；Ctrl 開著時在 document 的捕獲階段攔下 `beforeinput` 的那一個字，改送成鍵盤事件（`sendKey`，給 ProseMirror、CodeMirror 自己的快速鍵處理），Tab、Esc 也是這樣送。方向鍵、Home、End 由各模式移動：Word 模式是 `toolbar.ts` 的 `keyMove`（`moveCaretLines(n, extend)`、`wordEdge`、`paragraphEdge`、`lineEdge`），Markdown 模式是 `mdbar.ts` 的 `keyMove`（Obsidian 編輯器的 `exec`，Shift 時把選取的起點放回去）。`RibbonShell` 在「收起鍵盤」左邊放開關 `.wm-keys-btn`（跟它一樣只在 `wm-kb-up` 時出現：鍵盤收著時這些鍵沒有作用，控制鍵列也只在 `wm-kb-up` 時顯示），控制鍵列不放在功能區裡（會把「收起鍵盤」的位置擠歪），由 `keys.mount` 放到旁邊；功能區重建前要呼叫 `shell.destroy()`（document 上的事件）。設定 `keyRow`、`keyRowKeys`，開著與否記在 `keyRowOpen`。Markdown 編輯時 Obsidian 自己的手機工具列（`.mobile-toolbar`，只建立一次）由 `nativebar.ts` 加上同一套：開關是 Obsidian 的 `.mobile-toolbar-floating-options` 圓形按鈕、插在「切換鍵盤」左邊，控制鍵列 absolute 在工具列上方，開著時把 `.mobile-toolbar-spacer` 加高一列（body 的 `wm-native-keys-open`）；鍵盤開關、換分頁時 `sync()`。觸控板的手勢在 `trackpad.ts`（`installTrackpad` + hooks），Word 模式（`caretPad`）、Markdown 工具列與 Obsidian 的工具列共用。按住時的說明 `.wm-pad-tip` 的 z-index 要高過 Obsidian 手機工具列的 `--layer-menu`（65），Obsidian 工具列的按鈕在 `is-trackpad` 時變淡。Markdown 模式沒有放大鏡，拖曳時由 `mdbar.ts` 的 `padPosition` 在工具列上方放 `.wm-pad-pos`（第幾行第幾字與游標前後各 10 個字）。**文字上不要自己取代 iOS 的放大鏡**：在模擬器實測過，手指按著不動約 0.5 秒 iOS 就接手，網頁擋不掉（只有在那之前就有 touchmove 並 preventDefault 才擋得住，實機的長按多半在 0.6 秒後才有第一個 touchmove）。
- iOS 長按拖曳游標（系統的放大鏡）：拖曳中 iOS 不斷改系統的選取，ProseMirror 讀進來、覺得 DOM 寫法不同又寫回去，兩邊每 8ms 互搶一次，放大鏡就失效（實機紀錄看到：游標進到方程式裡；段落結尾是行內方程式時 PM 放在分隔圖片 `img.ProseMirror-separator` 前面、iOS 放在後面；表格與段落間的縫隙）。`touch.ts` 在拖曳時（從編輯區裡按下、手指移動過、最近有觸控事件，而且「按住超過 450ms 才拖」或「按下時已選取一段文字」；不要求焦點，因為鍵盤收著時長按是途中才拿到焦點，iOS 會先選一個詞再拉範圍，範圍的一端進到縫隙一樣會互搶）在 window 的捕獲階段擋掉 `selectionchange`，PM 收不到；放開的當下用 `TextSelection.between` 照 DOM 選取設定狀態。不要用 PM 的 `suppressSelectionUpdates`（它會主動把選取寫回 DOM）。條件太鬆會讓一般點擊壞掉（1.31.0 的教訓），動到這裡要請使用者在實機確認。也不要用 `user-select: none` 擋不能編輯的區塊。
- 點在方程式、圖表這類 `contenteditable="false"` 的區塊上：iOS 把系統的選取放進區塊裡，編輯器不認，選取留在原處（剛拿到焦點時是文件開頭，看起來像游標跑到開頭）。`touch.ts` 的 `tapInBlock` 在點擊後 150ms 檢查，還在區塊裡就整個選取那個區塊（段落、標題裡的小東西則放在旁邊的字上）；區塊裡的按鈕、輸入框，或這段時間別人改過選取時不管。
- 引文、提示框裡整段只有 `$$…$$` 的段落：markdown-it 讀成段落裡的 raw_inline，`markdown.ts` 的 `displayMathBlock`（在 `liftCallouts` 裡）換成 `raw_block`（kind math），才有區塊的編輯按鈕；寫回的文字相同。清單項目不換（第一個子節點必須是段落）。
- 手機的對話框：Obsidian 的 `.modal-content` 是 flex 直欄的捲動區，而且完全不避開鍵盤。內容的每一塊要 `flex-shrink: 0`；長表單的按鈕列用 `dialogs.ts` 的 `buttonBar()` 放在捲動區外面；鍵盤開著時用 `wm-kb-up` 把對話框收到鍵盤上方（樣式表最後的「手機的方程式、圖表編輯器」）。手機上方程式、圖表編輯器是整個畫面（`position: fixed`，下緣 `bottom: var(--wm-kb-cover)`，按鈕列 `order: -1` 放最上面），最下面是 `accessory.ts` 的 `Accessory`：方程式把編輯區標題列的上一格那組（`visualKeys`）與符號卡片（`.wm-eq-palbox`）搬進去，LaTeX 模式另有 `latexKeys`；圖表是 `formKeys`（`fieldStep`，跳過下拉選單）與 `codeKeys`（符號來自 `DiagramKind.keys`，認不出種類用 `CODE_KEYS`，種類變了在 `markKind` 重填）。Obsidian 的 `Modal.open` 在手機上會先收起鍵盤（只有實體鍵盤時才把焦點放進對話框）；方程式、圖表編輯器自己放焦點前問 `dialogs.ts` 的 `mayAutoFocus`：手機上剛打開不放、之後只在鍵盤本來就開著時放，不然一打開鍵盤就把對話框壓扁。
- 手機的選單是從下面滑上來的面板：項目多的用子選單（`contextmenu.ts` 的 `openTableMenu`）。Menu 的圖示名稱經過 `icons.ts` 的 `iconId()`，Lucide 改過名字的才不會變空白。
- 手機的導覽列是浮動的時候（`is-floating-nav`）蓋在檢視上面，檢視下方留 `--view-bottom-spacing`（Obsidian 的變數）。功能區與狀態列在手機上照舊是貼齊兩邊的長條（1.36.0 試過 Obsidian 的 `mod-raised` 浮動卡片，跟其他模式不一致，1.37.0 改回來）。手機上的狀態列由設定 `phoneStatus` 決定（1.38 起預設 `header`）：`header` 時畫面下方不放狀態列（Word 模式的 `contentEl` 加 `wm-status-header`，樣式表藏 `.wm-bottombar`；Markdown 的 `syncStatus` 不建），「查看文件屬性」是標題列的 `addAction`（Word 模式 `view.propsAction`、Markdown 模式 `main.ts` 的 `mdPropsActions`，`refreshToolbars` 跟著設定顯示或藏起），字數統計與閱讀模式放在「⋯」選單（Word 模式 `onPaneMenu`；Markdown 模式是 `file-menu` 事件 `source === 'more-options'`，`statusbar.ts` 的 `mdWordCount`）。`bar` 是舊的樣子：手機的 Markdown／閱讀模式也在工具列下方放狀態列（`mdbar.ts` 的 `syncStatus`，外層加 `wm-phone` 讓 Word 模式手機狀態列的樣式一起套上），切換模式時版面不跳。分頁列右邊的快速按鈕在手機上 sticky 在右端。觸控螢幕點過之後 `:hover` 會卡住：手機的分頁、快速按鈕的 hover 底色放在 `@media (hover: none)` 裡關掉。
- 螢幕鍵盤常常沒有按鍵事件（`^`、Backspace 的 keydown 收不到）、也沒有方向鍵與 Tab：要靠 `input` 事件判斷打了什麼，並提供對應的按鈕。

## README 與文件

- README 給 Obsidian 使用者看：介紹、功能、操作動畫、安裝、隱私揭露。開發、架構、測試、發佈流程寫在 `docs/development.md` 與 `docs/development.zh-TW.md`（繁體中文、台文、粵語 README 連到中文版，其他語言連到英文版）。阿拉伯文、希伯來文 README 整份包在 `<div dir="rtl">` 裡。操作動畫只錄了 en、zh-TW、ja、ko 四種：台文、粵語、簡體中文的 README 用 zh-TW 的動畫，越南文、法文、德文、西班牙文、阿拉伯文、希伯來文用 en 的。存檔示意圖（`docs/images/generate.mjs`）每種語言都有，阿拉伯文與希伯來文整張左右鏡像。
- 操作動畫（`docs/images/<場景>.<語言>.webp`，WebP 動畫、品質 75）由 `node docs/record/record.mjs <場景> [--lang en]` 錄製：真的外掛程式碼在無頭 Chrome 裡跑，Obsidian 換成 `docs/record/mock.js`；每個場景的操作在 `docs/record/scenes.mjs`。功能區、對話框的版面或文字有變，只重錄受影響的場景（每次重錄都會永久留在 git 歷史；全部重錄要加 `--all`）。需要 Chrome、ffmpeg 與網路。
- 存檔示意圖（`saving.*.svg`）由 `node docs/images/generate.mjs` 產生。

## 測試

- `tests/*.mjs`：純函式測試，由 `tests/run.mjs` 用 esbuild 打包後執行。斷言失敗印 `FAIL`。
- `tests/view/*.mjs`：在 jsdom 裡跑整個 `WordModeView`，Obsidian 由 `tests/view/obsidian-mock.js` 代替，環境在 `harness.mjs`（`makeEnv`、`type`、`press`、`caret`）。新的介面測試加在 `ui.mjs`，一個功能一段，用 `// ======== 標題 ========` 分開。要測的模組沒有匯出時加進 `tests/view/entry.js`。
- 存檔與同步衝突：Obsidian 的 `TextFileView` 自己監聽檔案變動，有還沒自動存檔的修改時會先呼叫 `getViewData()`、合併，再呼叫 `setViewData(合併結果, false)`；存檔也可能失敗。所以 `WordModeView` 用 `editRev`／`savedRev` 記「有沒有還沒寫進檔案的修改」（`unsaved`），不看 `getViewData()` 有沒有被呼叫，也不自己監聽 `modify`。測試替身的 `save`／`onModify`／`loadFileInternal` 照 Obsidian 的流程寫（對照過 1.5.8 與 1.15.1），測試裡改完 `env.files` 之後呼叫 `view.onModify(view.file)` 模擬檔案在外面被改。
- jsdom 的限制：元素的位置與大小都是 0；`contentEditable` 的 `focus()` 不會真的取得焦點；直接改 `textContent` 不會移動游標（要自己用 `MathField.place` 放）；`MarkdownRenderer` 的替身只輸出 `RENDERED:` 加原文，沒有 SVG。
- 預覽圖、版面、真的打字這類 jsdom 測不到的東西，在真的 Chrome 裡看：`docs/record/` 的錄製工具加 `--png` 只存最後一個畫面，或在 `scenes.mjs` 暫時加一個場景；也可以照記憶 `word-mode-visual-check` 的做法。
- 拆成多個 commit 時，每個 commit 都要單獨通過測試與 lint。
