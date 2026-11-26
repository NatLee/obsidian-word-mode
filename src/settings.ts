// 外掛的設定：型別與預設值。設定頁的內容在 settingstab.ts
import type { Language } from './i18n.js';
import type { RibbonLayout, ButtonStyle, TabId, GroupId, TabStyle } from './ribbon.js';
import type { MdToolbarMode } from './mdbar.js';
import type { PropsStyle } from './view.js';
import type { CaretBlink, CaretShape } from './caret.js';
import type { EquationEditMode } from './dialogs.js';
import type { MermaidTab } from './mermaid.js';
import type { SavedTemplate } from './templates.js';
import type { CountMethod } from './textstats.js';

// 介面語言設定：auto＝跟隨 Obsidian 的語言
export type LanguageSetting = 'auto' | Language;
// 工具列位置：auto＝手機放下方、平板與電腦放上方
export type ToolbarPosition = 'auto' | 'top' | 'bottom';
// 大綱的位置：split＝在筆記旁另開一欄、left／right＝Obsidian 的左／右側邊欄、popup＝下拉選單
export type OutlinePlace = 'split' | 'left' | 'right' | 'popup';
// 同步衝突的處理方式：ask＝每次詢問、both＝自動兩份都保留
export type ConflictMode = 'ask' | 'both';
// 右鍵選單中可在設定隱藏的區段（設定 hiddenCtx 存的值）
export type ContextMenuSection = 'table' | 'clipboard' | 'format' | 'paragraph' | 'insert' | 'tools';

// 外掛設定（存在 data.json）；有 ? 的欄位只在使用者設定過、或舊版設定檔裡才有
export interface Settings {
  // ---- 一般
  language: LanguageSetting;
  openByDefault: boolean;
  // 不使用 Word 模式的資料夾，以換行或逗號分隔
  excludeFolders: string;
  // ---- 編輯
  ctrlE: boolean;
  wordAtCursor: boolean;
  autoFormat: boolean;
  autoComplete: boolean;
  // 在段落開頭打 / 跳出插入選單
  slashMenu: boolean;
  // 手機的 Markdown 模式打字時，工具列讓給 Obsidian 自己的手機工具列（不疊成兩列）
  mdYieldNative: boolean;
  // 手機的閱讀模式工具列只留能用的按鈕（一列）
  readingLite: boolean;
  // ---- 拖曳移動游標（手機、平板；toolbar.ts 的 caretPad、loupe.ts）：整列按鈕當觸控板、按住多久開始、移動速度（1 慢～5 快）、
  // 放大鏡要不要顯示、倍率、寬度、外觀
  padRow: boolean;
  // 手機上字數、存檔狀態、檢視切換、文件屬性放在哪裡：header 是右上角（文件屬性）與「⋯」選單（字數統計、閱讀模式），
  // 畫面下方不放狀態列；bar 是畫面下方的狀態列（1.37 以前的樣子）
  phoneStatus: 'header' | 'bar';
  // 控制鍵列（keyrow.ts，手機、平板）：要不要放開關、要顯示哪些鍵（KeyId）、上次是不是開著（不在設定頁上，開關時記下來）
  keyRow: boolean;
  keyRowKeys: string[];
  keyRowOpen: boolean;
  padHold: number;
  padSpeed: number;
  loupeShow: boolean;
  loupeZoom: number;
  loupeWidth: number;
  loupeStyle: 'capsule' | 'card';
  loupeInfo: boolean;
  pasteChip: boolean;
  keepHistory: boolean;
  // ---- 顯示
  fullWidth: boolean;
  // 頁面縮放百分比（50–200）
  zoom: number;
  showMarks: boolean;
  highlightWeird: boolean;
  // 文件屬性固定在頁面上方（捲動時一直看得到）
  propsSticky: boolean;
  // 文件屬性區塊的外觀，以及固定的屬性列要不要顯示屬性名稱
  propsStyle: PropsStyle;
  pinLabels: boolean;
  // ---- 游標（caret.ts）：形狀、顏色（accent 強調色、text 文字顏色、custom 用 caretCustom）、閃爍的方式、移動時要不要滑過去
  caretShape: CaretShape;
  caretColor: 'accent' | 'text' | 'custom';
  caretCustom: string;
  caretBlink: CaretBlink;
  // 閃一次（淡出再淡入一次）要幾秒
  caretPeriod: number;
  caretSmooth: boolean;
  toolbarPosition: ToolbarPosition;
  // ---- 工具列
  ribbonLayout: RibbonLayout;
  buttonStyle: ButtonStyle;
  // 使用者自己選過按鈕樣式（之後不再依舊設定 ribbonLabels 改成只顯示圖示）
  buttonStyleSet?: boolean;
  groupLabels: boolean;
  // 「檢視」分頁的三個檢視模式按鈕（Word 模式／Markdown／閱讀）要不要顯示文字
  viewButtonLabels: boolean;
  hiddenTabs: TabId[];
  hiddenGroups: GroupId[];
  // 自訂的按鈕群組（ribbon.ts 的 groupLayout 套用）：名稱（群組 id → 名稱）、
  // 移到哪個分頁（群組 id → 分頁 id，只存有移動過的）、順序（群組 id，空的＝預設順序）
  groupNames: Partial<Record<GroupId, string>>;
  groupTabs: Partial<Record<GroupId, TabId>>;
  groupOrder: GroupId[];
  richHints: boolean;
  // Markdown／閱讀模式要不要顯示工具列：都顯示、只在其中一種模式顯示、都隱藏（舊版存的是 true／false，載入時轉換）
  mdToolbar: MdToolbarMode;
  mdStatusBar: boolean;
  // 桌機的狀態列顯示這份筆記的路徑（按一下複製）
  showPath: boolean;
  // 狀態列與「字數統計」的字數怎麼算：只算看得到的文字，或跟 Obsidian 內建的字數一樣算 Markdown 原文
  countMethod: CountMethod;
  outlinePlace: OutlinePlace;
  // 分頁列的樣式（文字、圖示、圖示加文字、收成選單）與自訂的分頁名稱（分頁 id → 名稱）
  tabStyle: TabStyle;
  tabLabels: Partial<Record<TabId, string>>;
  // 手機、平板的螢幕鍵盤開著時把功能區精簡成一列（分頁列收成選單、按鈕只顯示圖示），鍵盤收起來就恢復
  compactOnKeyboard: boolean;
  // 手機上鍵盤收著時的功能區：short 只放一列鍵盤收著也用得到的按鈕（復原、插入圖片、大綱、摺疊…，右邊的圓鈕叫出鍵盤）；hidden 整條藏起來
  // （Word 模式的大綱、插入圖片、方程式、圖表放進右上角的「⋯」選單）；full 完整的兩列功能區。Word 與 Markdown 編輯模式都照這個
  phoneIdle: 'short' | 'hidden' | 'full';
  // 上次選的字型色彩（CSS 色碼）
  lastFontColor?: string;
  // 上次選的醒目提示色彩（CSS 色碼）；空字串＝預設黃色
  lastHighlight?: string;
  // 最近使用的自訂色彩（最新的在前）
  recentFontColors?: string[];
  recentHighlights?: string[];
  // ---- 右鍵選單與方程式
  ctxMenu: boolean;
  hiddenCtx: ContextMenuSection[];
  mathDisplay: boolean;
  mathMode: EquationEditMode;
  mermaidMode: MermaidTab;
  codePreview: boolean;
  // 很長的圖表與查詢結果先收合成固定的高度
  collapseTall: boolean;
  // 程式碼區塊顯示行號（開啟時不自動換行）
  codeLineNumbers: boolean;
  // 最近使用的方程式（LaTeX 原始碼，最新的在前）
  recentMath: string[];
  // 自己存的公式與圖表範本（名稱加原始碼），在編輯器裡存、在設定頁管理
  mathTemplates: SavedTemplate[];
  diagramTemplates: SavedTemplate[];
  // 圖表編輯器上方不列出來的內建圖表種類（DiagramKind 的 id）
  hiddenDiagramKinds: string[];
  // 插入新圖表時一開始的內容：''＝流程圖、'kind:<id>'＝某一種內建圖表、'tpl:<名稱>'＝自己存的範本
  defaultDiagram: string;
  // ---- 同步與檔案
  conflict: ConflictMode;
  maxSizeMB: number;
  // ---- 舊版設定（載入時轉換後刪除）
  // false＝舊版的「按鈕不顯示文字」
  ribbonLabels?: boolean;
  // false＝舊版的「不使用大綱側邊欄」
  outlineSidebar?: boolean;
}

// 設定中值是 true／false 的欄位（設定頁的開關使用）
export type ToggleKey = { [K in keyof Settings]-?: Settings[K] extends boolean | undefined ? K : never }[keyof Settings];

export const DEFAULTS: Settings = {
  // 一般
  language: 'auto',
  openByDefault: true,
  excludeFolders: '_模板',
  // 編輯
  ctrlE: true,
  wordAtCursor: true,
  autoFormat: true,
  autoComplete: true,
  // 預設關閉：這個外掛的定位是照 Word 的方式操作（功能區），斜線選單是另一種習慣，想用的人自己開
  slashMenu: false,
  mdYieldNative: true,
  readingLite: true,
  padRow: true,
  keyRow: true,
  phoneStatus: 'header',
  keyRowKeys: ['esc', 'tab', 'mod', 'shift', 'left', 'up', 'down', 'right', 'home', 'end'],
  keyRowOpen: false,
  padHold: 300,
  padSpeed: 3,
  loupeShow: true,
  loupeZoom: 1.6,
  loupeWidth: 260,
  loupeStyle: 'capsule',
  loupeInfo: true,
  pasteChip: true,
  keepHistory: true,
  // 顯示
  fullWidth: true,
  zoom: 100,
  showMarks: false,
  highlightWeird: true,
  propsSticky: false,
  propsStyle: 'card',
  pinLabels: true,
  caretShape: 'line',
  caretColor: 'accent',
  caretCustom: '#2b7de9',
  caretBlink: 'fade',
  caretPeriod: 1.3,
  caretSmooth: true,
  toolbarPosition: 'auto',
  // 工具列
  ribbonLayout: 'tabs',
  buttonStyle: 'auto',
  groupLabels: false,
  viewButtonLabels: true,
  hiddenTabs: [],
  hiddenGroups: [],
  groupNames: {},
  groupTabs: {},
  groupOrder: [],
  tabStyle: 'text',
  tabLabels: {},
  compactOnKeyboard: true,
  phoneIdle: 'short',
  richHints: true,
  mdToolbar: 'both',
  mdStatusBar: true,
  showPath: true,
  countMethod: 'word',
  outlinePlace: 'split',
  // 右鍵選單與方程式
  ctxMenu: true,
  hiddenCtx: [],
  mathDisplay: false,
  mathMode: 'visual',
  mermaidMode: 'visual',
  codePreview: true,
  collapseTall: true,
  codeLineNumbers: false,
  recentMath: [],
  mathTemplates: [],
  diagramTemplates: [],
  hiddenDiagramKinds: [],
  defaultDiagram: '',
  // 同步與檔案
  conflict: 'ask',
  maxSizeMB: 2,
};
