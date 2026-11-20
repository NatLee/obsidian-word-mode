// 兩條功能區共用的部分（Word 模式的 toolbar.ts、Markdown／閱讀模式的 mdbar.ts）：
// 分頁與群組的清單、按鈕的外觀目錄（ACTIONS）、功能區的外殼（分頁列、面板、群組、按鈕與提示）。
// 這裡只管「長什麼樣子」；按下去做什麼、何時停用，由兩條功能區各自決定
import { t, key } from './i18n.js';
import { attachHint, hideHint } from './hints.js';
import { el, keepFocus } from './dom.js';
import type { DemoName } from './hints.js';
import type { IconFn } from './icons.js';
import type { I18nKey } from './i18n.js';

// 分頁 id（TABS 的第一欄；也是設定 hiddenTabs 存的值）
export type TabId = 'home' | 'insert' | 'review' | 'viewtab';
// 按鈕群組 id（GROUPS 的第一欄；也是設定 hiddenGroups 存的值）
export type GroupId =
  | 'undo' | 'clipboard' | 'styles' | 'font' | 'paragraph' | 'editing'
  | 'tables' | 'illustrations' | 'links' | 'code' | 'text' | 'obsidian'
  | 'proofing' | 'stats' | 'comments'
  | 'views' | 'show' | 'zoom' | 'help';
// [分頁 id, 分頁名稱（翻譯前的原文，顯示時再用 t() 翻譯）]
export type TabEntry = readonly [id: TabId, label: I18nKey];
// [群組 id, 所在分頁, 群組名稱（翻譯前的原文）]
export type GroupEntry = readonly [id: GroupId, tab: TabId, label: I18nKey];

// 設定裡的版面：分頁、全部排成一行、全部自動換行
export type RibbonLayout = 'tabs' | 'single' | 'wrap';
// 設定裡的按鈕樣式：自動（大按鈕才加文字）、只顯示圖示、圖示加文字
export type ButtonStyle = 'auto' | 'icon' | 'label';
// 分頁列的樣式：文字、圖示、圖示加文字、收成一個選單按鈕（不佔一列）
export type TabStyle = 'text' | 'icon' | 'both' | 'menu';

// 分頁與群組（設定頁用同一份清單，讓使用者勾選要顯示的項目）
export const TABS: readonly TabEntry[] = [['home', '常用'], ['insert', '插入'], ['review', '校閱'], ['viewtab', '檢視']];
export const GROUPS: readonly GroupEntry[] = [
  ['undo', 'home', '復原'], ['clipboard', 'home', '剪貼簿'], ['styles', 'home', '樣式'], ['font', 'home', '字型'],
  ['paragraph', 'home', '段落'], ['editing', 'home', '編輯'],
  ['tables', 'insert', '表格'], ['illustrations', 'insert', '圖例'], ['links', 'insert', '連結'], ['code', 'insert', '程式碼'],
  ['text', 'insert', '文字'], ['obsidian', 'insert', 'Obsidian'],
  ['proofing', 'review', '校對'], ['stats', 'review', '統計'], ['comments', 'review', '註解'],
  ['views', 'viewtab', '檢視模式'], ['show', 'viewtab', '顯示'], ['zoom', 'viewtab', '縮放'], ['help', 'viewtab', '說明'],
];

// 使用者自訂的按鈕群組（設定裡的三個欄位）。內容來自 data.json，可能有舊版留下或手改的值，所以鍵與值都當成一般字串，用的時候再檢查
export interface GroupCustom {
  // 群組 id → 自訂名稱；沒有或空白時用預設名稱
  groupNames?: Partial<Record<string, string>> | null;
  // 群組 id → 移到哪個分頁；沒有或不認得的分頁時留在預設分頁
  groupTabs?: Partial<Record<string, string>> | null;
  // 群組的順序（群組 id）；沒列到的群組排在所屬分頁的最後，彼此依預設順序
  groupOrder?: readonly string[] | null;
}
// 一個群組實際的位置與名稱：label 是預設名稱（翻譯前的原文），name 是要顯示的名稱
export interface GroupPlace { id: GroupId; tab: TabId; label: I18nKey; name: string; }

// 套用自訂之後的群組清單：先依分頁（TABS 的順序），同一個分頁裡依自訂的順序。
// 兩條功能區與設定頁都用這一份，所以改名、換分頁、調順序在三個地方一致
export function groupLayout(custom?: GroupCustom | null): GroupPlace[] {
  const c = custom || {};
  const tabIndex = new Map<string, number>(TABS.map(([id], i) => [id, i]));
  const order = new Map<string, number>();
  (c.groupOrder || []).forEach((id, i) => { if (!order.has(id)) order.set(id, i); });
  const list = GROUPS.map(([id, tab, label], i) => {
    const moved = c.groupTabs ? c.groupTabs[id] : null;
    const name = c.groupNames ? c.groupNames[id] : null;
    return {
      place: { id, tab: (moved && tabIndex.has(moved) ? moved : tab) as TabId, label, name: name && name.trim() ? name.trim() : t(label) },
      // 沒列在自訂順序裡的排在後面（新版本加的群組、或使用者沒調過順序）
      rank: order.has(id) ? order.get(id)! : GROUPS.length + i,
    };
  });
  list.sort((a, b) => tabIndex.get(a.place.tab)! - tabIndex.get(b.place.tab)! || a.rank - b.rank);
  return list.map(x => x.place);
}

// 把群組在所屬分頁裡往前（-1）或往後（1）移一格，回傳新的 groupOrder；已經在最前或最後時回傳 null
export function moveGroup(custom: GroupCustom | null | undefined, id: GroupId, dir: -1 | 1): GroupId[] | null {
  const list = groupLayout(custom);
  const i = list.findIndex(g => g.id === id);
  const j = i + dir;
  if (i < 0 || !list[j] || list[j].tab !== list[i].tab) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list.map(g => g.id);
}

// 把群組移到另一個分頁（排在該分頁最後），回傳新的 groupTabs 與 groupOrder
export function moveGroupToTab(custom: GroupCustom | null | undefined, id: GroupId, tab: TabId): { groupTabs: Partial<Record<GroupId, TabId>>; groupOrder: GroupId[] } {
  const layout = groupLayout(custom);
  // 從實際的位置重新整理：只留下不在預設分頁的群組（移回預設分頁就不留紀錄，不認得的舊值也順便清掉）
  const groupTabs: Partial<Record<GroupId, TabId>> = {};
  for (const [gid, home] of GROUPS) {
    const now = gid === id ? tab : layout.find(g => g.id === gid)!.tab;
    if (now !== home) groupTabs[gid] = now;
  }
  const groupOrder = layout.map(g => g.id).filter(x => x !== id);
  groupOrder.push(id);
  return { groupTabs, groupOrder };
}

// 分頁的圖示（分頁列樣式為「圖示」「圖示加文字」「收成選單」時顯示）
export const TAB_ICONS: Record<TabId, string> = { home: 'home', insert: 'plus-circle', review: 'spell-check', viewtab: 'eye' };

// 分頁顯示的名稱：使用者在設定裡自訂的名稱，沒有時用預設名稱
export function tabName(id: TabId, label: I18nKey, custom?: Partial<Record<string, string>> | null): string {
  const c = custom && custom[id];
  return c && c.trim() ? c.trim() : t(label);
}

// 在分頁按鈕裡放圖示與名稱（依分頁列的樣式）；只有圖示時名稱放在提示裡
export function fillTab(b: HTMLElement, id: TabId, name: string, style: TabStyle, icon: IconFn): void {
  b.replaceChildren();
  if (style !== 'text') icon(el('span', 'wm-tab-icon', b), TAB_ICONS[id], '');
  if (style !== 'icon' || !b.querySelector('svg')) el('span', 'wm-tab-text', b, name);
  if (style === 'icon') b.setAttribute('aria-label', name);
}

// ----------------------------------------------------------- 按鈕的外觀

// 一個按鈕的外觀；title、label、desc 都是翻譯前的原文
export interface ButtonLook {
  // 功能名稱，也是提示的標題；分頁以外的版面用它判斷重複的按鈕
  title: I18nKey;
  // Obsidian（Lucide）圖示名稱
  icon?: string;
  // 沒有圖示（或這一版 Obsidian 沒有這個圖示）時顯示的文字
  text?: string;
  // 顯示文字時的按鈕名稱
  label?: I18nKey;
  // 快速鍵，例如 'Mod+B'
  keys?: string | null;
  // 詳細提示的說明
  desc?: I18nKey;
  // 詳細提示的示意動畫名稱（hints.ts 的 DEMOS）
  demo?: DemoName;
  // 大按鈕：按鈕樣式為「自動」時也顯示文字
  big?: boolean;
  // 檢視模式的按鈕（Word 模式／Markdown／閱讀）：設定可以讓這三個只顯示圖示
  viewMode?: boolean;
  // 額外的 CSS class
  cls?: string;
  // 分割按鈕的箭頭：全部排在一起的版面也不去除重複
  split?: boolean;
}

// 哪一條功能區：Word 模式、Markdown／閱讀模式
export type RibbonSide = 'word' | 'md';

// 一個功能在功能區上的樣子。外觀只寫一次；兩條功能區刻意不一樣的地方寫在 word／md，蓋掉共用的值。
// 會不一樣通常是因為做法不同：Word 模式自己綁的快速鍵 Markdown 編輯器沒有，
// 說明裡提到的操作（拖曳選大小、旁邊的箭頭）另一邊沒有
export interface RibbonAction extends ButtonLook {
  word?: Partial<ButtonLook>;
  md?: Partial<ButtonLook>;
}

const find: RibbonAction = { icon: 'search', title: '尋找', keys: 'Mod+F', text: '找', demo: 'find', word: { desc: '在這份筆記裡尋找文字。再按一次關閉。' } };
const replace: RibbonAction = { icon: 'replace', title: '取代', keys: 'Mod+H', text: '換', demo: 'replace', word: { desc: '把找到的文字換成別的文字。再按一次關閉。' } };

// 兩條功能區都有的功能。只有一邊有的按鈕直接寫在那一條功能區裡（它沒有第二份可以寫歪），
// 之後另一邊也要有時再搬進來。
// 說明放在 word 裡的：那句話只有 Word 模式做得到（Markdown 的按鈕用 Obsidian 的指令，做法不同），
// Markdown 功能區就不顯示說明
export const ACTIONS = {
  // ---- 常用
  undo: { icon: 'undo-2', title: '復原', keys: 'Mod+Z', demo: 'undo', word: { desc: '取消上一個動作。切到 Markdown 再切回來也能復原。' } },
  redo: { icon: 'redo-2', title: '取消復原', keys: 'Mod+Y', demo: 'redo', desc: '把剛剛復原的動作做回來。' },
  // Word 模式的按鈕直接顯示目前的樣式名稱（沒有圖示）；Markdown 只改這一行的 # 記號，沒有「程式碼」
  style: { title: '段落樣式', demo: 'style', desc: '把段落改成標題 1～6、內文或程式碼。', md: { icon: 'heading', desc: '把這一行改成標題 1～6 或內文。' } },
  bold: { icon: 'bold', title: '粗體', keys: 'Mod+B', text: 'B', demo: 'bold', word: { desc: '把選取的文字（或游標所在的詞）變粗體。' } },
  italic: { icon: 'italic', title: '斜體', keys: 'Mod+I', text: 'I', demo: 'italic', desc: '把文字變斜體。' },
  underline: { icon: 'underline', title: '底線', text: 'U', demo: 'underline', desc: '在文字下方加底線。', word: { keys: 'Mod+U' } },
  strike: { icon: 'strikethrough', title: '刪除線', text: 'S', demo: 'strike', desc: '在文字中間畫一條線。', word: { keys: 'Mod+Shift+X' } },
  sup: { icon: 'superscript', title: '上標', text: 'x²', demo: 'sup', desc: '把文字變成小字並往上移，例如平方。' },
  sub: { icon: 'subscript', title: '下標', text: 'x₂', demo: 'sub', desc: '把文字變成小字並往下移，例如化學式。' },
  highlight: { icon: 'highlighter', title: '醒目提示', text: 'H', demo: 'highlight', word: { keys: 'Mod+Shift+H', desc: '像螢光筆一樣標出文字。旁邊的箭頭可以換顏色。' } },
  bullet: { icon: 'list', title: '項目符號', text: '•', demo: 'bullet', desc: '把段落變成項目符號清單。' },
  ordered: { icon: 'list-ordered', title: '編號', text: '1.', demo: 'ordered', desc: '把段落變成 1. 2. 3. 編號清單。' },
  task: { icon: 'list-checks', title: '核取清單', text: '☐', demo: 'task', desc: '變成可以打勾的待辦清單。' },
  outdent: { icon: 'indent-decrease', title: '減少縮排', text: '←', demo: 'outdent', word: { keys: 'Shift+Tab', desc: '整段往左移；清單往上一層。' } },
  indent: { icon: 'indent-increase', title: '增加縮排', text: '→', demo: 'indent', word: { desc: '整段往右移；清單變成下一層。' } },
  quote: { icon: 'quote', title: '引文', text: '❝', demo: 'quote', desc: '把段落變成引用（左邊有一條線）。' },
  find,
  replace,
  // ---- 插入
  table: { icon: 'table', title: '插入表格', text: '表', label: '表格', big: true, demo: 'table', word: { desc: '拖曳選擇欄數與列數，插入表格。也可以直接貼上 Excel 的範圍。' } },
  equation: { icon: 'sigma', title: '插入方程式', text: '∑', label: '方程式', big: true, demo: 'equation', word: { desc: '用方程式編輯器輸入數學式，即時預覽。' } },
  link: { icon: 'link', title: '超連結', text: '連', label: '連結', big: true, demo: 'link', desc: '把文字連到網址或保管庫裡的筆記。', word: { keys: 'Mod+K' } },
  noteLink: { icon: 'file-symlink', title: '連結到筆記', text: '[[', label: '筆記', big: true, demo: 'notelink', desc: '搜尋並插入另一份筆記的連結。' },
  code: { icon: 'code', title: '行內程式碼', text: '</>', label: '行內', big: true, demo: 'code', desc: '把文字標成程式碼（等寬字型）。', word: { keys: 'Mod+`' } },
  codeBlock: { icon: 'square-code', title: '插入程式碼區塊', text: '{ }', label: '程式碼區塊', big: true, demo: 'codeblock', desc: '插入一段程式碼，可以選語言，會自動上色。' },
  callout: { icon: 'info', title: '插入提示框', text: '框', label: '提示框', big: true, demo: 'callout', desc: '插入有圖示與標題的提示框（Obsidian callout），例如注意、提示、範例。' },
  comment: { icon: 'message-square', title: '插入註解', text: '註', label: '註解', big: true, demo: 'comment', desc: '加一段只有編輯時看得到的註解，閱讀模式不會顯示。' },
  hr: { icon: 'minus', title: '水平線', text: '—', label: '分隔線', big: true, demo: 'hr', desc: '插入一條橫線分隔內容。' },
  // ---- 校閱：跟「編輯」群組的尋找、取代是同一個功能，這裡是有文字的大按鈕
  findBig: { ...find, label: '尋找', big: true },
  replaceBig: { ...replace, label: '取代', big: true },
  // ---- 檢視。前三個是檢視模式：目前的模式顯示成按下的樣子，所以兩邊的名稱不同
  wordMode: { icon: 'file-text', title: 'Word 模式（目前）', text: 'W', label: 'Word 模式', big: true, viewMode: true, demo: 'word', desc: '像 Word 一樣直接看到格式來編輯，存檔仍是純 Markdown。', md: { title: '切換到 Word 模式' } },
  markdownMode: { icon: 'code-2', title: '切換到 Markdown 編輯', text: 'MD', label: 'Markdown', big: true, viewMode: true, demo: 'markdown', desc: '用 Obsidian 原本的 Markdown 編輯這份筆記。', word: { keys: 'Mod+E' }, md: { title: 'Markdown 編輯' } },
  readingMode: { icon: 'book-open', title: '閱讀模式', text: '讀', label: '閱讀', big: true, viewMode: true, demo: 'reading', desc: '用 Obsidian 的閱讀模式檢視（不能編輯）。' },
  outline: { icon: 'list-tree', title: '大綱', text: '綱', label: '大綱', big: true, demo: 'outline', desc: '在筆記旁另外展開大綱欄，點標題可以跳過去。再按一次關閉。' },
  peekProperties: { icon: 'clipboard-list', title: '查看文件屬性', text: '屬', label: '查看屬性', big: true, demo: 'properties', desc: '不用捲到最上方，直接看這份筆記的屬性（標籤、日期等）。屬性很多時可以篩選。' },
  foldAll: { icon: 'chevrons-down-up', title: '摺疊全部標題', text: '收', label: '全部摺疊', big: true, demo: 'fold', desc: '把所有標題下的內容收起來，只看標題。' },
  unfoldAll: { icon: 'chevrons-up-down', title: '展開全部標題', text: '展', label: '全部展開', big: true, demo: 'unfold', desc: '展開所有收起來的標題。' },
  settings: { icon: 'settings', title: 'Word 模式設定', text: '設', label: '設定', big: true, demo: 'settings', desc: '開啟 Word 模式的設定。在上方的搜尋框打幾個字就能找到想要的設定，也可以打英文。' },
  // ---- 右上角的快速按鈕：Word 模式的尋找列也能取代，所以名稱是「尋找與取代」。
  // Markdown 那邊按下去開的是 Obsidian 的尋找（取代是另一個指令），名稱照實寫「尋找」
  findQuick: { ...find, title: '尋找與取代', md: { title: '尋找' } },
} satisfies Record<string, RibbonAction>;

// ----------------------------------------------------------- 功能區的外殼

// 外掛設定裡兩條功能區都會讀的欄位
export interface RibbonSettings extends GroupCustom {
  ribbonLayout?: RibbonLayout;
  buttonStyle?: ButtonStyle;
  hiddenGroups?: readonly string[];
  hiddenTabs?: readonly string[];
  richHints?: boolean;
  groupLabels?: boolean;
  // 「檢視」分頁的三個檢視模式按鈕要不要顯示文字（預設顯示）
  viewButtonLabels?: boolean;
  tabStyle?: TabStyle;
  // 自訂的分頁名稱（分頁 id → 名稱；沒有或空白時用預設名稱）
  tabLabels?: Partial<Record<string, string>>;
}

// 按鈕的點擊處理；btn 是按下的按鈕
export type ButtonClick = (e: MouseEvent, btn: HTMLButtonElement) => void;

// 下拉選單的一個項目；title 已經翻譯好
export interface MenuItem {
  title: string;
  icon?: string;
  run: () => void;
}

// 已建立的按鈕：title 是已翻譯、含快速鍵的標題；reason 是已翻譯的停用原因（沒有停用或沒有原因時是 null）
export interface RibbonButton {
  dom: HTMLButtonElement;
  title: string;
  reason: string | null;
}

// 各群組放按鈕的容器；群組或它所在的分頁被隱藏時沒有這一項
export type GroupBodies = Partial<Record<GroupId, HTMLDivElement>>;

export interface ShellOptions {
  side: RibbonSide;
  settings: RibbonSettings;
  isMobile: boolean;
  // 在 el 裡放 Obsidian 圖示；找不到圖示時改顯示 fallback 文字
  icon: IconFn;
  // 分頁收成選單時，按下選單按鈕要開的選單（Word 模式用自己的下拉面板，Markdown 用 Obsidian 的選單）
  openMenu(owner: HTMLElement, items: MenuItem[]): void;
  // 使用者選了分頁（分頁按鈕或選單）
  pickTab(id: TabId): void;
}

// 功能區最外層元素的 class（版面、按鈕樣式、分頁列樣式、要不要顯示群組名稱）
export function ribbonClass(S: RibbonSettings): string {
  return 'wm-layout-' + (S.ribbonLayout || 'tabs') + ' wm-btnstyle-' + (S.buttonStyle || 'auto') + ' wm-tabstyle-' + (S.tabStyle || 'text') + (S.groupLabels ? ' wm-group-labels' : '');
}

// 功能區的外殼：分頁列、按鈕列、每個分頁的面板、群組，以及建立按鈕的方法。
// 兩條功能區各建一個，所以版面、DOM 結構、CSS class、提示的寫法只有這一份。
// 用法：new RibbonShell() → 用 button() 把按鈕放進 groups → finish() 之後再放右上角的快速按鈕
export class RibbonShell {
  declare side: RibbonSide;
  declare icon: IconFn;
  declare layout: RibbonLayout;
  declare buttonStyle: ButtonStyle;
  declare tabStyle: TabStyle;
  declare hideViewLabels: boolean;
  declare richHints: boolean;
  declare hiddenGroups: Set<string>;
  declare tabsEl: HTMLDivElement;
  declare bar: HTMLDivElement;
  // 分頁版面：每個分頁一塊面板（被隱藏的分頁也有，標成 is-empty）；其他版面是空的，按鈕全部放在 all
  declare panels: Partial<Record<TabId, HTMLDivElement>>;
  declare all: HTMLDivElement | null;
  declare tabBtns: Partial<Record<TabId, HTMLButtonElement>>;
  // 看得到的分頁的名稱；被隱藏或沒有按鈕的分頁沒有這一項
  declare tabNames: Partial<Record<TabId, string>>;
  // 分頁收成選單時的選單按鈕
  declare tabSwitch: HTMLButtonElement | null;
  declare groups: GroupBodies;
  // 全部排在一起的版面：已經放過的功能（按鈕的 title）
  declare seen: Set<string>;

  constructor(root: HTMLElement, o: ShellOptions) {
    const S = o.settings;
    this.side = o.side;
    this.icon = o.icon;
    this.layout = S.ribbonLayout || 'tabs';
    this.buttonStyle = S.buttonStyle || 'auto';
    this.tabStyle = S.tabStyle || 'text';
    this.hideViewLabels = S.viewButtonLabels === false;
    this.richHints = !!S.richHints && !o.isMobile;
    this.hiddenGroups = new Set(S.hiddenGroups || []);
    const hiddenTabs = new Set<string>(S.hiddenTabs || []);
    this.tabsEl = el('div', 'wm-tabs', root);
    this.bar = el('div', 'wm-toolbar', root);
    this.bar.setAttribute('role', 'toolbar');
    this.panels = {};
    this.all = null;
    this.tabBtns = {};
    this.tabNames = {};
    this.tabSwitch = null;
    this.groups = {};
    this.seen = new Set();
    if (this.layout === 'tabs') {
      const menuTabs = this.tabStyle === 'menu';
      // 收成選單：分頁列不佔一列，改成按鈕列最前面的一個按鈕，按下去選分頁
      if (menuTabs) {
        const sw = el('button', 'wm-tab-switch', this.bar);
        sw.type = 'button';
        el('span', 'wm-tab-switch-label', sw);
        this.icon(el('span', 'wm-tab-switch-arrow', sw), 'chevron-down', '▾');
        keepFocus(sw);
        sw.addEventListener('click', () => o.openMenu(sw, TABS.filter(([id]) => this.tabNames[id] != null)
          .map(([id]) => ({ title: this.tabNames[id]!, icon: TAB_ICONS[id], run: () => o.pickTab(id) }))));
        this.tabSwitch = sw;
      }
      for (const [id, label] of TABS) {
        const panel = el('div', 'wm-panel', this.bar);
        this.panels[id] = panel;
        if (hiddenTabs.has(id)) { panel.classList.add('is-empty'); continue; }
        const name = tabName(id, label, S.tabLabels);
        this.tabNames[id] = name;
        if (menuTabs) continue;
        const b = el('button', 'wm-tab', this.tabsEl);
        b.type = 'button';
        fillTab(b, id, name, this.tabStyle, this.icon);
        keepFocus(b);
        b.addEventListener('click', () => o.pickTab(id));
        this.tabBtns[id] = b;
      }
    } else {
      this.all = el('div', 'wm-panel', this.bar);
    }
    // 群組的名稱、順序與所在分頁來自同一份 groupLayout（包含使用者自訂的部分）
    for (const { id, tab, name } of groupLayout(S)) {
      if (hiddenTabs.has(tab) || this.hiddenGroups.has(id)) continue;
      const g = el('div', 'wm-group wm-group-' + id, this.all || this.panels[tab]);
      this.groups[id] = el('div', 'wm-group-body', g);
      el('div', 'wm-group-name', g, name);
    }
  }

  // 顯示某個分頁的面板，並更新分頁按鈕（或選單按鈕）的樣子
  showTab(id: TabId): void {
    for (const [k, p] of Object.entries(this.panels)) p.classList.toggle('is-hidden', k !== id);
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('is-active', k === id);
    if (this.tabSwitch) {
      const name = this.tabNames[id] || '';
      const label = this.tabSwitch.querySelector<HTMLElement>('.wm-tab-switch-label');
      if (label) fillTab(label, id, name, 'both', this.icon);
      this.tabSwitch.setAttribute('aria-label', t('切換分頁') + t('：') + name);
    }
  }

  // 一開始要顯示的分頁：想要的那個（上次的分頁）還在就用它，否則用第一個有按鈕的分頁
  usableTab(want: TabId | null | undefined): TabId {
    const ok = (id: TabId) => { const p = this.panels[id]; return !!p && !p.classList.contains('is-empty'); };
    if (want && ok(want)) return want;
    const first = TABS.find(([id]) => ok(id));
    return first ? first[0] : 'home';
  }

  // 建立按鈕並記下它的提示；parent 是 null（群組被隱藏）或這個功能已經放過時回傳 null。
  // 停用的按鈕不會呼叫 onClick
  button(parent: HTMLElement | null | undefined, action: RibbonAction, onClick: ButtonClick): RibbonButton | null {
    if (!parent) return null;
    const look: ButtonLook = { ...action, ...action[this.side] };
    const title = look.keys ? t(look.title) + ' (' + key(look.keys) + ')' : t(look.title);
    // 全部排在一起的版面：同一個功能只出現一次
    if (this.layout !== 'tabs' && !look.split) {
      if (this.seen.has(look.title)) return null;
      this.seen.add(look.title);
    }
    const showLabel = (this.buttonStyle === 'label' || (this.buttonStyle === 'auto' && look.big)) && !(look.viewMode && this.hideViewLabels);
    const b = el('button', 'wm-btn' + (look.cls ? ' ' + look.cls : '') + (showLabel && look.label ? ' has-label' : ''), parent);
    b.type = 'button';
    el('span', 'wm-sr', b);
    if (look.icon) this.icon(el('span', 'wm-btn-icon', b), look.icon, look.text || t(look.title).slice(0, 1));
    else el('span', 'wm-btn-text', b, look.text);
    if (showLabel && look.label) el('span', 'wm-btn-label', b, t(look.label));
    keepFocus(b);
    b.addEventListener('click', e => {
      e.preventDefault();
      hideHint();
      if (b.classList.contains('is-disabled')) return;
      onClick(e, b);
    });
    const made: RibbonButton = { dom: b, title, reason: null };
    this.setTip(made);
    if (this.richHints) {
      attachHint(b, () => ({
        title: t(look.title), keys: look.keys ? key(look.keys) : null,
        desc: look.desc ? t(look.desc) : null, demo: look.demo, reason: made.reason,
      }));
    }
    return made;
  }

  // 按鈕的提示：一般模式用 Obsidian 的 aria-label；詳細提示模式改用自己的提示卡（有說明與動畫），兩者不會同時出現
  setTip(it: RibbonButton): void {
    const text = it.reason ? it.title + '\n' + it.reason : it.title;
    if (this.richHints) {
      it.dom.removeAttribute('aria-label');
      it.dom.querySelector('.wm-sr')!.textContent = text;
    } else it.dom.setAttribute('aria-label', text);
  }

  // build 裡建立的按鈕不參與「同一個功能只出現一次」：右上角的快速按鈕、表格工具，跟群組裡的同名按鈕要同時存在
  apart(build: () => void): void {
    const prev = this.seen;
    this.seen = new Set();
    build();
    this.seen = prev;
  }

  // 按鈕都放好之後：拿掉沒有按鈕的群組與分頁，建立右上角放快速按鈕的容器並回傳
  // （分頁版面放在分頁列，收成選單時放在按鈕列，其他版面放在最後）
  finish(): HTMLDivElement {
    for (const [id] of TABS) {
      const p = this.panels[id];
      if (!p || p.querySelector('.wm-btn')) continue;
      p.classList.add('is-empty');
      delete this.tabNames[id];
      const b = this.tabBtns[id];
      if (b) { b.remove(); delete this.tabBtns[id]; }
    }
    for (const g of this.bar.querySelectorAll('.wm-group')) if (!g.querySelector('.wm-btn')) g.remove();
    const tabRow = this.layout === 'tabs' && this.tabStyle !== 'menu';
    if (tabRow) el('div', 'wm-tabs-spacer', this.tabsEl);
    const quick = el('div', 'wm-tabs-quick', this.all || (tabRow ? this.tabsEl : this.bar));
    this.tabsEl.classList.toggle('is-hidden', !tabRow);
    return quick;
  }
}
