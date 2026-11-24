// Word 模式的功能區（Ribbon）：常用／插入／校閱／檢視。這裡決定每個按鈕按下去執行哪個編輯指令或開哪個對話框、
// 何時顯示成作用中或停用，以及自己的下拉面板；分頁、群組、按鈕的 DOM 與兩條功能區共用的按鈕外觀在 ribbon.ts。
// 版面可在設定中調整：分頁、全部排成一行（可左右捲動）、全部自動換行；按鈕可只顯示圖示或加上文字；分頁與群組可隱藏
import * as C from './commands.js';
import { Loupe } from './loupe.js';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { t, key } from './i18n.js';
import { marksOn } from './marks.js';
import { hideHint } from './hints.js';
import { el, isRtl, keepFocus, popupLeft, visibleBottom } from './dom.js';
import { closePropsPeek } from './propview.js';
import { buildColorPanel, SHADING } from './colorpicker.js';
import { ACTIONS as A, RibbonShell, ribbonClass } from './ribbon.js';
import type { ColorKind } from './colorpicker.js';
import type { IconFn } from './icons.js';
import { Selection, TextSelection } from 'prosemirror-state';
import type { Command, EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Mark, MarkType } from 'prosemirror-model';
import type { Align, CaseKind, Direction } from './commands.js';
import type { I18nKey } from './i18n.js';
import type { AnyTabId, ButtonClick, GroupBodies, MenuItem, RibbonAction, RibbonButton, RibbonSettings, TabId } from './ribbon.js';

// 「貼上」按鈕與選單的模式：auto＝一般貼上、text＝只貼文字、markdown＝把 Markdown 轉成格式
export type PasteMode = 'auto' | 'text' | 'markdown';
// 「剪下」「複製」按鈕
export type ClipKind = 'cut' | 'copy';

// 功能區需要的外部功能（由 view.js 建立）；有 ? 的成員功能區會先檢查有沒有提供
export interface ToolbarContext {
  // 目前的編輯器；還沒載入筆記時是 null
  getView(): EditorView | null;
  // 在 el 裡放 Obsidian 圖示；找不到圖示時改顯示 fallback 文字
  icon: IconFn;
  isMobile: boolean;
  // 外掛設定（只列出功能區會讀的欄位）：版面、分頁與群組那些在 RibbonSettings，這裡加上色彩按鈕記住的色彩
  settings?: RibbonSettings & {
    // 上次選的字型色彩（CSS 色碼）
    lastFontColor?: string;
    // 上次選的醒目提示色彩（CSS 色碼）；空字串或沒有＝預設黃色
    lastHighlight?: string;
    // 最近使用的自訂色彩（最新的在前）
    recentFontColors?: readonly string[];
    recentHighlights?: readonly string[];
  };
  // 一開始顯示的分頁（上次離開時的分頁）
  initialTab: TabId;
  // 使用者切換分頁時通知，讓下次開啟時回到同一個分頁
  onTab?(id: TabId): void;
  isFullWidth?(): boolean;
  // 尋找列是否開著、是否顯示取代列
  findState?(): { open: boolean; replace: boolean };
  // 大綱是否開著
  outlineOpen?(): boolean;
  // 記住使用者選的色彩（CSS 色碼；醒目提示的預設黃色是 null）。custom：使用者自己調的色彩，要加進「最近使用」
  rememberColor?(kind: ColorKind, color: string | null, custom: boolean): void;
  // 依格式（moment.js 格式字串）把現在的時間轉成文字
  formatDate(format: string): string;
  // 按鈕要開的對話框、選單與其他動作；btn 是按下的按鈕（選單要顯示在它下方）
  dialogs: {
    find(): void;
    replace(): void;
    shortcuts(): void;
    markdown(): void;
    reading(): void;
    paste(mode: PasteMode): void;
    clip(kind: ClipKind): void;
    toggleMarks(): void;
    image(btn: HTMLElement): void;
    equation(): void;
    mermaid(): void;
    link(): void;
    noteLink(): void;
    footnote(): void;
    callout(btn: HTMLElement): void;
    comment(): void;
    template?(): void;
    properties(): void;
    // 「查看文件屬性」小視窗，顯示在 btn 旁邊
    peekProperties(btn: HTMLElement): void;
    cleanup(): void;
    wordCount(): void;
    outline(btn: HTMLElement): void;
    // true 摺疊全部標題，false 全部展開
    foldAll(fold: boolean): void;
    toggleFullWidth(): void;
    // 縮放增減的百分比；0 表示恢復 100%
    zoom(delta: number): void;
    settings(): void;
    // 捲動到文件中的位置（大綱下拉選單點標題時）
    scrollTo(pos: number): void;
    notice?(message: string): void;
  };
}

// 檢查編輯狀態的函式：按鈕是否顯示成作用中、是否可以使用
export type StateTest = (state: EditorState) => boolean;

// 一個按鈕在 Word 模式做什麼（長什麼樣子是 button() 的另一個參數：ribbon.ts 的 ACTIONS，或只有這裡有的按鈕直接寫）
export interface WordHandler {
  // 按下時執行的編輯指令（沒有 onClick 時）
  cmd?: Command;
  onClick?: ButtonClick;
  active?: StateTest;
  enabled?: StateTest;
  // 停用時的原因（翻譯前的原文），沒有原因時回傳 null
  why?: (state: EditorState) => I18nKey | null;
}

// 功能區記住的按鈕，update() 依編輯狀態更新它們
interface ToolbarItem extends RibbonButton, Pick<WordHandler, 'cmd' | 'active' | 'enabled' | 'why'> {}

// 大綱下拉選單的一個標題
interface OutlineHead { level: number; text: string; pos: number; }
// heading 節點的屬性（見 schema.ts）；這裡只讀 level（1～6）
interface HeadingAttrs { readonly level: number; }

// 表格大小選擇器把格子的列、欄號碼（數字）直接存進 dataset，瀏覽器會自動轉成字串
type DataNumbers = Record<string, string | number | undefined>;

const M = schema.marks;

const SYMBOLS: readonly (readonly [group: I18nKey, chars: string])[] = [
  ['常用', '©®™°±×÷≈≠≤≥∞✓✗★☆●○■□◆◇※§¶†…‰€£¥'],
  ['中文標點', '「」『』（）【】《》〈〉、。，；：！？—～·‧'],
  ['箭頭', '→←↑↓↔⇒⇐⇔↗↘↖↙➔➜'],
  ['數學', '∑∏√∛∫∂∆∇∈∉⊂⊃⊆⊇∪∩∀∃∴∵∝∠⊥∥'],
  ['希臘字母', 'αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ'],
  ['單位', '℃℉㎡㎥㎏㎞㎝㎜㏄％＄'],
  ['圈號數字', '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'],
];

// 成對的括號與引號：按下去把選取的文字包起來（沒有選取時插入一對，游標停在中間）
const PAIRS: readonly (readonly [open: string, close: string])[] = [
  ['「', '」'], ['『', '』'], ['（', '）'], ['《', '》'], ['〈', '〉'], ['【', '】'], ['“', '”'], ['‘', '’'],
  ['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'],
];

const DATE_FORMATS: readonly string[] = ['YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY年M月D日', 'YYYY-MM-DD HH:mm', 'HH:mm', 'YYYY-MM-DD dddd'];

const CASE_MENU: readonly (readonly [kind: CaseKind, label: I18nKey])[] = [['upper', '全部大寫'], ['lower', '全部小寫'], ['title', '每個英文單字首字大寫'], ['sentence', '句首大寫'], ['half', '轉成半形'], ['full', '轉成全形']];

// 游標在程式碼區塊裡時停用的按鈕（程式碼區塊只能放純文字）：停用並在提示裡說明原因
const NO_CODE: Pick<WordHandler, 'enabled' | 'why'> = { enabled: C.notInCode, why: C.codeBlocked };

// 「顯示／隱藏編輯標記」的大按鈕：「校閱」與「檢視」分頁各放一個，樣子完全一樣
const MARKS_BIG: RibbonAction = { icon: 'pilcrow', title: '顯示／隱藏編輯標記', text: '¶', label: '編輯標記', big: true, demo: 'marks', desc: '顯示空白、換行與段落結尾，也會標出奇怪的符號。' };

// 功能區；popup 是目前開著的下拉面板（沒有時是 null 或 undefined），painter 是格式刷記住的格式
export class Toolbar {
  declare ctx: ToolbarContext;
  // 分頁列、面板、群組與按鈕的 DOM（跟 Markdown 的功能區共用同一套）
  declare shell: RibbonShell;
  declare dom: HTMLDivElement;
  declare items: ToolbarItem[];
  declare activeTab: AnyTabId;
  // 最後一個選的一般分頁：離開表格時，情境分頁消失，回到這個分頁
  declare lastTab: TabId;
  declare painter: readonly Mark[] | null;
  declare painterSticky: boolean;
  declare painterHandler: (() => void) | null;
  declare hlColor: string | null;
  declare fontColor: string;
  declare onDocDown: (e: PointerEvent) => void;
  declare popup: HTMLDivElement | null | undefined;
  declare popupOwner: HTMLElement | null | undefined;
  // 剛在分頁選單按鈕上拖曳過（caretPad）：接下來的那一下點擊不算
  declare padMoved: boolean | undefined;
  // 手機的抽屜後面那層變暗的底（openPopup）
  declare popupBackdrop: HTMLElement | null | undefined;
  declare painterBtn: HTMLButtonElement | null;
  declare styleBtn: HTMLButtonElement | null;
  declare hlBtn: HTMLButtonElement | null;
  declare colorBtn: HTMLButtonElement | null;
  // 表格工具的群組：分頁版面放在情境分頁「表格」，其他版面跟其他按鈕排在一起、游標在表格裡才顯示
  declare tableGroups: HTMLDivElement[];

  // ctx: { getView(), icon(el, name, fallbackText), dialogs: {...}, isMobile, settings }
  constructor(container: HTMLElement, ctx: ToolbarContext) {
    this.ctx = ctx;
    const S = ctx.settings || {};
    this.dom = el('div', 'wm-ribbon ' + ribbonClass(S), container);
    this.items = [];
    this.painter = null;
    this.hlColor = S.lastHighlight || null;
    this.fontColor = S.lastFontColor || '#c00000';
    this.shell = new RibbonShell(this.dom, {
      side: 'word', settings: S, isMobile: ctx.isMobile, icon: ctx.icon,
      // 剛在選單按鈕上拖曳移動過游標：放開時的那一下點擊不開選單
      openMenu: (owner, items) => { if (this.padMoved) { this.padMoved = false; return; } this.openMenu(owner, items); },
      pickTab: id => this.showTab(id),
    });
    this.build();
    this.showTab(this.shell.usableTab(ctx.initialTab));
    if (ctx.isMobile && this.shell.tabSwitch) this.caretPad(this.shell.tabSwitch);
    this.onDocDown = e => { if (this.popup && !this.popup.contains(e.target as Node | null) && !this.popupOwner!.contains(e.target as Node | null)) this.closePopup(); };
    this.dom.ownerDocument.addEventListener('pointerdown', this.onDocDown, true);
  }

  destroy(): void {
    // 格式刷還開著就重建功能區（改了設定）：不停掉的話，編輯區會留著舊功能區的事件與刷子游標
    this.stopPainter();
    this.dom.ownerDocument.removeEventListener('pointerdown', this.onDocDown, true);
    this.closePopup();
    closePropsPeek();
    hideHint();
    this.dom.remove();
  }

  get view(): EditorView | null { return this.ctx.getView(); }
  get d(): ToolbarContext['dialogs'] { return this.ctx.dialogs; }
  // 外殼的幾個部分，view.ts 與測試直接從功能區讀
  get tabsEl(): HTMLDivElement { return this.shell.tabsEl; }
  get toolbarEl(): HTMLDivElement { return this.shell.bar; }
  get panels(): RibbonShell['panels'] { return this.shell.panels; }
  get tabBtns(): RibbonShell['tabBtns'] { return this.shell.tabBtns; }
  get tabSwitch(): HTMLButtonElement | null { return this.shell.tabSwitch; }

  run(cmd: Command): boolean {
    const v = this.view;
    if (!v) return false;
    const r = cmd(v.state, v.dispatch, v);
    v.focus();
    return r;
  }

  showTab(id: AnyTabId): void {
    if (this.shell.layout !== 'tabs') return;
    this.activeTab = id;
    this.shell.showTab(id);
    // 情境分頁不記成上次的分頁（下次開啟時游標不一定在表格裡）
    if (id === 'tabletab') return;
    this.lastTab = id;
    if (this.ctx.onTab) this.ctx.onTab(id);
  }

  // look：按鈕長什麼樣子（ribbon.ts 的 ACTIONS，或只有 Word 模式有的按鈕直接寫）；how：按下去做什麼、何時作用中或停用
  button(parent: HTMLElement | null | undefined, look: RibbonAction, how: WordHandler = {}): HTMLButtonElement | null {
    const made = this.shell.button(parent, look, (e, b) => {
      if (how.onClick) how.onClick(e, b); else if (how.cmd) this.run(how.cmd);
    });
    if (!made) return null;
    this.items.push(Object.assign(made, { cmd: how.cmd, active: how.active, enabled: how.enabled, why: how.why }));
    return made.dom;
  }

  menuButton(parent: HTMLElement | null | undefined, look: RibbonAction, items: readonly MenuItem[] | (() => readonly MenuItem[])): HTMLButtonElement | null {
    return this.button(parent, look, { onClick: (e, b) => this.openMenu(b, typeof items === 'function' ? items() : items) });
  }

  // 分割按鈕：主按鈕執行，旁邊的小箭頭開選單
  // noCode：游標在程式碼區塊裡時停用
  arrow(parent: HTMLElement | null | undefined, title: I18nKey, onClick: ButtonClick, noCode?: boolean): HTMLButtonElement | null {
    return this.button(parent, { icon: 'chevron-down', title, text: '▾', cls: 'wm-split-arrow', split: true }, { onClick, ...(noCode ? NO_CODE : {}) });
  }

  build(): void {
    const shell = this.shell;
    const G = shell.groups;
    // 群組元素上記著群組 id（data-group）；Markdown 的功能區沒有這個屬性，所以不放在共用的外殼裡
    for (const [id, body] of Object.entries(G)) if (body.parentElement) body.parentElement.dataset.group = id;
    this.buildHome(G);
    this.buildInsert(G);
    this.buildReview(G);
    this.buildView(G);
    this.buildTable();
    // 右上角固定的快速按鈕
    const quick = shell.finish();
    shell.apart(() => {
      this.button(quick, A.findQuick, { onClick: () => this.d.find(), active: () => this.isFindOpen() });
      if (!shell.hiddenGroups.has('help')) this.button(quick, { icon: 'help-circle', title: '快速鍵說明', keys: 'Mod+/', text: '?', demo: 'kbd', desc: '列出所有快速鍵；點一列可以看動畫示範。' }, { onClick: () => this.d.shortcuts() });
      // 跟「檢視」分頁的 Markdown 按鈕是同一個功能：這裡只有圖示，說明多了怎麼切回來
      this.button(quick, { ...A.markdownMode, label: undefined, big: false, desc: '用 Obsidian 原本的 Markdown 編輯這份筆記，再按一次（或在 Markdown 畫面按同樣的快速鍵）切回 Word 模式。' }, { onClick: () => this.d.markdown() });
    });
  }

  isFindOpen(): boolean { return !!(this.ctx.findState && this.ctx.findState().open); }

  // 同一個功能有好幾個按鈕的（尋找、取代、編輯標記、註解），做的事寫在這裡一次
  findHandler(): WordHandler { return { onClick: () => this.d.find(), active: () => this.isFindOpen() && !this.ctx.findState!().replace }; }
  replaceHandler(): WordHandler { return { onClick: () => this.d.replace(), active: () => this.isFindOpen() && this.ctx.findState!().replace }; }
  marksHandler(): WordHandler { return { onClick: () => this.d.toggleMarks(), active: s => marksOn(s) }; }
  commentHandler(): WordHandler { return { onClick: () => this.d.comment(), ...NO_CODE }; }

  // ----------------------------------------------------------- 常用
  buildHome(G: GroupBodies): void {
    let g = G.undo;
    this.button(g, A.undo, { cmd: undo, enabled: s => undo(s) });
    this.button(g, A.redo, { cmd: redo, enabled: s => redo(s) });

    g = G.clipboard;
    this.button(g, { icon: 'clipboard-paste', title: '貼上', keys: 'Mod+V', label: '貼上', text: '貼', desc: '貼上剪貼簿的內容。Excel 範圍會變成表格。', demo: 'paste' }, { onClick: () => this.d.paste('auto') });
    this.arrow(g, '貼上選項', (e, b) => this.openMenu(b, [
      { title: t('貼上') + ' (' + key('Mod+V') + ')', icon: 'clipboard-paste', run: () => this.d.paste('auto') },
      { title: t('只貼上文字') + ' (' + key('Mod+Shift+V') + ')', icon: 'type', run: () => this.d.paste('text') },
      { title: t('貼上並轉換 Markdown 格式'), icon: 'file-code', run: () => this.d.paste('markdown') },
    ]));
    this.button(g, { icon: 'scissors', title: '剪下', keys: 'Mod+X', text: '剪', desc: '剪下選取的內容。', demo: 'cut' }, { onClick: () => this.d.clip('cut') });
    this.button(g, { icon: 'copy', title: '複製', keys: 'Mod+C', text: '複', desc: '複製選取的內容。', demo: 'copy' }, { onClick: () => this.d.clip('copy') });
    this.painterBtn = this.button(g, { icon: 'paintbrush', title: '複製格式', text: '刷', desc: '先把游標放在有格式的文字，按一下格式刷，再選取要套用的文字。按兩下可以連續刷，按 Esc 結束。', demo: 'painter' }, { onClick: () => this.togglePainter(), ...NO_CODE });
    if (this.painterBtn) this.painterBtn.addEventListener('dblclick', e => { e.preventDefault(); this.togglePainter(true); });

    g = G.styles;
    // 按鈕上直接顯示目前的段落樣式（update() 會跟著游標換），所以沒有圖示
    this.styleBtn = this.button(g, { ...A.style, text: t('內文'), cls: 'wm-style-btn' }, { onClick: (e, b) => this.openStylePopup(b) });

    g = G.font;
    const mk = (look: RibbonAction, cmd: Command, type: MarkType) => this.button(g, look, { cmd, active: s => C.markActive(s, type), ...NO_CODE });
    mk(A.bold, C.toggleBold, M.strong);
    mk(A.italic, C.toggleItalic, M.em);
    mk(A.underline, C.toggleUnderline, M.underline);
    mk(A.strike, C.toggleStrike, M.strike);
    mk(A.sup, C.toggleSup, M.sup);
    mk(A.sub, C.toggleSub, M.sub);
    this.hlBtn = this.button(g, { ...A.highlight, cls: 'wm-hl-btn' }, {
      cmd: (st, dp) => (this.hlColor === null ? C.toggleHighlight(st, dp) : C.setHighlight(this.hlColor)(st, dp)),
      active: st => { const h = C.currentHighlight(st); return !!h && h !== SHADING; },
      ...NO_CODE,
    });
    if (this.hlBtn && this.hlColor) this.hlBtn.style.setProperty('--wm-hl', this.hlColor);
    this.arrow(g, '醒目提示色彩', (e, b) => this.openHighlightPopup(b), true);
    this.button(g, { icon: 'paint-bucket', title: '字元網底', text: '網', demo: 'shading', desc: '在文字後面加上灰色底色（Word 的「字元網底」）。' }, {
      cmd: (st, dp) => C.setHighlight(C.currentHighlight(st) === SHADING ? 'none' : SHADING)(st, dp),
      active: st => C.currentHighlight(st) === SHADING, ...NO_CODE });
    this.button(g, { icon: 'square', title: '字元框線', text: '框', demo: 'border', desc: '在文字外面加一個方框。' }, { cmd: C.toggleBorder, active: s => C.markActive(s, M.border), ...NO_CODE });
    this.colorBtn = this.button(g, { icon: 'baseline', title: '字型色彩', text: 'A', cls: 'wm-color-btn', demo: 'color', desc: '把文字改成上次選的顏色。旁邊的箭頭可以選其他顏色。' }, {
      cmd: (st, dp) => C.setColor(this.fontColor)(st, dp), ...NO_CODE });
    if (this.colorBtn) this.colorBtn.style.setProperty('--wm-current-color', this.fontColor);
    this.arrow(g, '其他字型色彩', (e, b) => this.openColorPopup(b), true);
    this.menuButton(g, { icon: 'case-sensitive', title: '大小寫／全形半形', text: 'Aa', demo: 'case', desc: '把英文字改成大寫、小寫，或把文字轉成全形、半形。' },
      CASE_MENU.map(([k, label]) => ({ title: t(label), run: () => this.run(C.changeCase(k)) })));
    this.button(g, { icon: 'remove-formatting', title: '清除所有格式', text: '清', demo: 'clear', desc: '移除粗體、顏色、醒目提示等所有格式，標題會改回內文。' }, { cmd: C.clearFormatting });

    g = G.paragraph;
    this.button(g, A.bullet, { cmd: C.toggleList('bullet'), active: s => C.currentList(s) === 'bullet', ...NO_CODE });
    this.button(g, A.ordered, { cmd: C.toggleList('ordered'), active: s => C.currentList(s) === 'ordered', ...NO_CODE });
    this.button(g, A.task, { cmd: C.toggleList('task'), active: s => C.currentList(s) === 'task', ...NO_CODE });
    this.button(g, A.outdent, { cmd: C.outdent, enabled: s => C.outdent(s) });
    this.button(g, A.indent, { cmd: C.indent, enabled: s => C.indent(s), why: C.blockFormatBlocked });
    const al = (a: Align, icon: string, title: I18nKey, keys: string | null, text: string) => this.button(g, { icon, title, keys, text, demo: a, desc: '設定段落的對齊方式。' },
      { cmd: C.setAlign(a), active: st => C.currentAlign(st) === a, enabled: st => C.setAlign(a)(st) || (a === 'left' && C.currentAlign(st) === 'left'), why: C.blockFormatBlocked });
    al('left', 'align-left', '靠左對齊', 'Mod+L', '左');
    al('center', 'align-center', '置中', null, '中');
    al('right', 'align-right', '靠右對齊', null, '右');
    al('justify', 'align-justify', '左右對齊', 'Mod+J', '齊');
    this.button(g, A.quote, { cmd: C.toggleQuote, active: s => C.inQuote(s) });
    this.menuButton(g, { icon: 'arrow-down-a-z', title: '排序', text: '排', demo: 'sort', desc: '把選取的段落、清單或表格依筆畫或字母排序。' }, [
      { title: t('遞增排序（A→Z、1→9）'), icon: 'arrow-down-a-z', run: () => this.sortCmd(1) },
      { title: t('遞減排序（Z→A、9→1）'), icon: 'arrow-up-z-a', run: () => this.sortCmd(-1) },
    ]);
    this.button(g, { icon: 'pilcrow', title: '顯示／隱藏編輯標記', text: '¶', demo: 'marks', desc: '顯示空白（·）、全形空白、Tab、換行與段落結尾（¶），也會標出奇怪的符號。' }, this.marksHandler());

    g = G.editing;
    this.button(g, A.find, this.findHandler());
    this.button(g, A.replace, this.replaceHandler());
    this.button(g, { icon: 'text-select', title: '全選', keys: 'Mod+A', text: '全', demo: 'selectall', desc: '選取整份筆記。再按一次取消選取。' }, { onClick: () => this.toggleSelectAll(), active: s => C.isAllSelected(s) });
  }

  toggleSelectAll(): void {
    const v = this.view;
    if (!v) return;
    if (C.isAllSelected(v.state)) this.run(C.collapseSelection);
    else this.run(C.selectAll);
  }

  sortCmd(dir: Direction): void {
    const v = this.view;
    if (!v) return;
    if (C.table.isIn(v.state)) this.run(C.sortTableByColumn(dir));
    else if (!this.run(C.sortBlocks(dir)) && this.d.notice) this.d.notice(t('請先選取要排序的段落，或把游標放在清單或表格裡'));
  }

  // ----------------------------------------------------------- 表格（情境分頁）
  // 游標在表格裡時才出現的「表格」分頁（像 Word 的表格工具）；不用分頁的版面，這些群組排在最後、游標在表格裡才顯示
  buildTable(): void {
    const shell = this.shell;
    const host = shell.contextTab('tabletab', '表格') || shell.all;
    this.tableGroups = [];
    if (!host) return;
    const T = C.table;
    const group = (name: I18nKey) => { const body = shell.group(host, 'wm-table-tools', t(name)); this.tableGroups.push(body.parentElement as HTMLDivElement); return body; };
    const run = (cmd: Command) => () => { this.run(cmd); };
    const tb = (parent: HTMLElement, icon: string, title: I18nKey, cmd: Command, text: string, more: Partial<WordHandler> = {}) => this.button(parent, { icon, title, text }, { cmd, enabled: s => cmd(s), ...more });
    // 跟其他分頁同名的按鈕（全部排在一起的版面會去除重複）也要出現
    shell.apart(() => {
      let g = group('表格');
      this.menuButton(g, { icon: 'mouse-pointer-click', title: '選取', text: '選', label: '選取', big: true, desc: '選取游標所在的儲存格、整列、整欄或整張表。選取整列、整欄或整張表後按 Backspace 會刪掉它們。' }, [
        { title: t('選取儲存格'), icon: 'square', run: run(T.selectCell) },
        { title: t('選取整列'), icon: 'rows-3', run: run(T.selectRow) },
        { title: t('選取整欄'), icon: 'columns-3', run: run(T.selectColumn) },
        { title: t('選取表格'), icon: 'table', run: run(T.selectTable) },
      ]);
      this.menuButton(g, { icon: 'trash-2', title: '刪除', text: '刪', label: '刪除', big: true, desc: '清除儲存格的內容，或刪除列、欄、整張表。' }, [
        { title: t('清除內容'), icon: 'eraser', run: run(T.clearCells) },
        { title: t('刪除列'), icon: 'rows-3', run: run(T.deleteRow) },
        { title: t('刪除欄'), icon: 'columns-3', run: run(T.deleteColumn) },
        { title: t('刪除表格'), icon: 'trash-2', run: run(T.deleteTable) },
      ]);
      this.button(g, { icon: 'text', title: '表格轉成文字', text: '文', label: '轉成文字', big: true, desc: '把表格換回一般段落：每一列一段，儲存格之間用 Tab 隔開。' }, { cmd: T.toText, enabled: s => T.toText(s) });
      // 螢幕鍵盤沒有 Tab：手機、平板多兩顆按鈕在儲存格之間移動（最後一格再按下一格會新增一列，跟 Tab 一樣）
      if (this.ctx.isMobile) {
        g = group('儲存格');
        tb(g, 'arrow-left-from-line', '上一個儲存格', C.prevCell, '←格');
        tb(g, 'arrow-right-from-line', '下一個儲存格', C.nextCell, '格→');
      }
      g = group('列與欄');
      tb(g, 'arrow-up-to-line', '在上方插入列', T.addRowBefore, '↑列');
      tb(g, 'arrow-down-to-line', '在下方插入列', T.addRowAfter, '↓列');
      tb(g, 'arrow-left-to-line', '在左側插入欄', T.addColumnBefore, '←欄');
      tb(g, 'arrow-right-to-line', '在右側插入欄', T.addColumnAfter, '→欄');
      g = group('移動');
      tb(g, 'arrow-up', '列上移', C.moveBlock(-1), '列↑');
      tb(g, 'arrow-down', '列下移', C.moveBlock(1), '列↓');
      tb(g, 'arrow-left', '欄左移', C.moveTableColumn(-1), '欄←');
      tb(g, 'arrow-right', '欄右移', C.moveTableColumn(1), '欄→');
      g = group('對齊');
      tb(g, 'align-left', '整欄靠左', T.alignColumn('left'), '左', { active: s => C.currentAlign(s) === 'left' });
      tb(g, 'align-center', '整欄置中', T.alignColumn('center'), '中', { active: s => C.currentAlign(s) === 'center' });
      tb(g, 'align-right', '整欄靠右', T.alignColumn('right'), '右', { active: s => C.currentAlign(s) === 'right' });
      g = group('排序');
      tb(g, 'arrow-down-a-z', '依此欄排序（遞增）', C.sortTableByColumn(1), '排↑');
      tb(g, 'arrow-up-z-a', '依此欄排序（遞減）', C.sortTableByColumn(-1), '排↓');
    });
  }

  // ----------------------------------------------------------- 插入
  buildInsert(G: GroupBodies): void {
    this.button(G.tables, A.table, { onClick: (e, b) => this.openTablePopup(b), ...NO_CODE });
    let g = G.illustrations;
    this.button(g, { icon: 'image', title: '插入圖片', text: '圖', label: '圖片', big: true, demo: 'image', desc: '插入保管庫裡的圖片、電腦上的圖片或網路圖片。' }, { onClick: (e, b) => this.d.image(b), ...NO_CODE });
    this.button(g, A.equation, { onClick: () => this.d.equation(), ...NO_CODE });
    this.button(g, { icon: 'workflow', title: '插入圖表（Mermaid）', text: '圖表', label: '圖表', big: true, demo: 'mermaid', desc: '插入流程圖、循序圖、甘特圖、圓餅圖、心智圖等圖表。用表單編輯內容，或直接點預覽圖上的文字修改。' }, { onClick: () => this.d.mermaid(), ...NO_CODE });
    this.button(g, { icon: 'omega', title: '插入符號', text: 'Ω', label: '符號', big: true, demo: 'symbol', desc: '插入中文標點、箭頭、希臘字母、單位等符號。' }, { onClick: (e, b) => this.openSymbolPopup(b) });
    g = G.links;
    this.button(g, A.link, { onClick: () => this.d.link(), ...NO_CODE });
    this.button(g, A.noteLink, { onClick: () => this.d.noteLink(), ...NO_CODE });
    this.button(g, { icon: 'asterisk', title: '插入註腳', text: '註', label: '註腳', big: true, demo: 'footnote', desc: '在游標處加上註腳編號，內容放在文件最後。滑鼠移到編號上可以看內容。' }, { onClick: () => this.d.footnote(), ...NO_CODE });
    g = G.code;
    this.button(g, A.code, { cmd: C.toggleCode, active: s => C.markActive(s, M.code), ...NO_CODE });
    // 選單的 label 多半是不翻譯的語言名稱；只有 lang 是空字串時才是介面文字「純文字」，型別分不出來所以轉型
    this.menuButton(g, A.codeBlock,
      () => C.CODE_LANGUAGES.map(([lang, label]) => ({ title: lang ? label : t(label as I18nKey), run: () => this.run(C.insertCodeBlock(lang)) })));
    // 沒有圖示：按鈕本身就畫成一顆鍵帽（樣式表的 wm-btn-kbd），看樣子就知道是「把字變成這樣」。
    // 原本是鍵盤圖示加「按鍵」兩個字，手機上沒有提示可看，會以為跟螢幕鍵盤有關
    this.button(g, { title: '鍵盤按鍵', text: 'Ctrl', label: '按鍵樣式', big: true, cls: 'wm-btn-kbd', demo: 'kbd', desc: '把文字標成鍵盤按鍵的樣子，例如 Ctrl。' }, { cmd: C.toggleKbd, active: s => C.markActive(s, M.kbd), ...NO_CODE });
    g = G.text;
    this.button(g, A.callout, { onClick: (e, b) => this.d.callout(b), ...NO_CODE });
    this.button(g, A.comment, this.commentHandler());
    this.menuButton(g, { icon: 'calendar-clock', title: '插入日期與時間', text: '日', label: '日期', big: true, demo: 'date', desc: '插入今天的日期或現在的時間。' },
      () => DATE_FORMATS.map(f => ({ title: this.ctx.formatDate(f), run: () => this.run(C.insertText(this.ctx.formatDate(f))) })));
    this.button(g, A.hr, { cmd: C.insertHr, ...NO_CODE });
    g = G.obsidian;
    if (this.d.template) this.button(g, { icon: 'layout-template', title: '套用範本', text: '範', label: '範本', big: true, demo: 'template', desc: '用 Templater 範本在游標處插入內容。' }, { onClick: () => this.d.template!(), ...NO_CODE });
    this.button(g, { icon: 'list-plus', title: '文件屬性', text: '屬', label: '屬性', big: true, demo: 'properties', desc: '編輯筆記最上方的屬性（標籤、日期等 metadata）。' }, { onClick: () => this.d.properties() });
  }

  // ----------------------------------------------------------- 校閱
  buildReview(G: GroupBodies): void {
    const g = G.proofing;
    this.button(g, A.findBig, this.findHandler());
    this.button(g, A.replaceBig, this.replaceHandler());
    this.button(g, { icon: 'sparkles', title: '清理符號', text: '淨', label: '清理符號', big: true, demo: 'cleanup', desc: '找出看不見的字元、亂碼、殘留的 ** 與落單的引號，勾選後一次清除。' }, { onClick: () => this.d.cleanup() });
    this.button(g, MARKS_BIG, this.marksHandler());
    this.button(G.stats, { icon: 'bar-chart-3', title: '字數統計', text: '數', label: '字數', big: true, demo: 'wordcount', desc: '顯示字數、字元數、段落數與預估閱讀時間；有選取時也會算選取範圍。' }, { onClick: () => this.d.wordCount() });
    // 跟「插入」分頁的註解是同一個功能，這裡換一個圖示與名稱
    this.button(G.comments, { ...A.comment, icon: 'message-square-plus', label: '新增註解' }, this.commentHandler());
  }

  // ----------------------------------------------------------- 檢視
  buildView(G: GroupBodies): void {
    let g = G.views;
    // 目前就在 Word 模式：顯示成按下的樣子，按了沒有動作
    this.button(g, { ...A.wordMode, cls: 'is-active' });
    this.button(g, A.markdownMode, { onClick: () => this.d.markdown() });
    this.button(g, A.readingMode, { onClick: () => this.d.reading() });
    g = G.show;
    this.button(g, MARKS_BIG, this.marksHandler());
    this.button(g, A.outline, { onClick: (e, b) => this.d.outline(b), active: () => !!(this.ctx.outlineOpen && this.ctx.outlineOpen()) });
    this.button(g, A.peekProperties, { onClick: (e, b) => this.d.peekProperties(b) });
    this.button(g, A.foldAll, { onClick: () => this.d.foldAll(true) });
    this.button(g, A.unfoldAll, { onClick: () => this.d.foldAll(false) });
    this.button(g, { icon: 'move-horizontal', title: '全寬頁面', text: '寬', label: '全寬', big: true, demo: 'fullwidth', desc: '頁面使用整個視窗寬度；關閉時是 A4 紙張寬度。' }, { onClick: () => this.d.toggleFullWidth(), active: () => !!(this.ctx.isFullWidth && this.ctx.isFullWidth()) });
    g = G.zoom;
    this.button(g, { icon: 'zoom-out', title: '縮小', text: '－', demo: 'zoom', desc: '縮小頁面（也可以按住 Ctrl 滾動滑鼠滾輪）。' }, { onClick: () => this.d.zoom(-10) });
    this.button(g, { icon: 'zoom-in', title: '放大', text: '＋', demo: 'zoom', desc: '放大頁面（也可以按住 Ctrl 滾動滑鼠滾輪）。' }, { onClick: () => this.d.zoom(10) });
    this.button(g, { icon: 'scan', title: '恢復 100%', text: '100%', label: '100%', big: true, demo: 'zoom', desc: '把頁面恢復成原本的大小。' }, { onClick: () => this.d.zoom(0) });
    g = G.help;
    this.button(g, { icon: 'keyboard', title: '快速鍵說明', keys: 'Mod+/', text: '?', label: '快速鍵', big: true, demo: 'kbd', desc: '列出所有快速鍵；點一列可以看動畫示範。' }, { onClick: () => this.d.shortcuts() });
    this.button(g, A.settings, { onClick: () => this.d.settings() });
  }

  update(state: EditorState): void {
    for (const it of this.items) {
      if (it.active) it.dom.classList.toggle('is-active', !!it.active(state));
      if (it.enabled) {
        const ok = !!it.enabled(state);
        // 不用 disabled 屬性：停用的按鈕仍要能顯示提示（說明為什麼不能用）
        it.dom.classList.toggle('is-disabled', !ok); it.dom.setAttribute('aria-disabled', ok ? 'false' : 'true');
        if (it.why) {
          const r = !ok && it.why(state);
          const reason = r ? t(r) : null;
          if (reason !== it.reason) { it.reason = reason; this.shell.setTip(it); }
        }
      }
    }
    if (this.styleBtn) {
      const style = C.currentBlockStyle(state);
      const st = C.BLOCK_STYLES.find(x => x.id === style);
      const txt = this.styleBtn.querySelector('.wm-btn-text');
      if (txt && st) txt.textContent = t(st.label);
    }
    const inTable = C.table.isIn(state);
    if (this.shell.layout === 'tabs') {
      this.shell.setContextTab('tabletab', inTable);
      if (!inTable && this.activeTab === 'tabletab') this.showTab(this.lastTab || this.shell.usableTab(null));
    } else for (const g of this.tableGroups) g.classList.toggle('is-hidden', !inTable);
  }

  // 尋找列、大綱等開關變了：只更新按鈕狀態
  refresh(): void { const v = this.view; if (v) this.update(v.state); }

  // ----------------------------------------------------------- 格式刷
  togglePainter(sticky?: boolean): void {
    const v = this.view;
    if (!v || !this.painterBtn) return;
    if (this.painter && !sticky) { this.stopPainter(); return; }
    if (this.painter) this.stopPainter();
    this.painter = C.captureMarks(v.state);
    this.painterSticky = !!sticky;
    this.painterBtn.classList.add('is-active');
    this.painterBtn.classList.toggle('is-sticky', !!sticky);
    v.dom.classList.add('wm-painting');
    this.painterHandler = () => {
      window.setTimeout(() => {
        const view = this.view;
        if (!this.painter || !view || view.state.selection.empty) return;
        C.applyMarks(this.painter)(view.state, view.dispatch);
        if (!this.painterSticky) this.stopPainter();
      }, 0);
    };
    v.dom.addEventListener('pointerup', this.painterHandler);
    v.dom.addEventListener('keyup', this.painterHandler);
  }

  stopPainter(): void {
    const v = this.view;
    if (v && this.painterHandler) {
      v.dom.removeEventListener('pointerup', this.painterHandler);
      v.dom.removeEventListener('keyup', this.painterHandler);
      v.dom.classList.remove('wm-painting');
    }
    this.painter = null;
    this.painterHandler = null;
    if (this.painterBtn) this.painterBtn.classList.remove('is-active', 'is-sticky');
  }

  // ----------------------------------------------------------- 拖曳移動游標（手機、平板）
  // 螢幕鍵盤沒有方向鍵，在字與字之間放游標要靠手指點得很準。在分頁選單按鈕上按住拖曳：左右一格一格移動游標，
  // 上下換行（Editorial、Textastic 鍵盤上方那一列的做法）。按鈕列本身要留給左右捲動，所以只有這顆按鈕當觸控板；
  // 沒拖超過 START 就放開還是一般的點擊，照樣開選單
  caretPad(b: HTMLElement): void {
    const START = 8; const STEP_X = 12; const STEP_Y = 26;
    let id = -1; let x = 0; let y = 0; let active = false;
    // 拖曳期間游標上方的放大預覽（loupe.ts）
    let loupe: Loupe | null = null;
    // 用觸控事件而不是指標事件：拖曳中每一下 touchmove 都擋掉預設行為，iOS 才不會中途把這次觸控收走去做別的
    // （捲動、系統手勢），指標事件被收走時只會收到 pointercancel、放大鏡跟著不見。
    // Obsidian 自己的滑動手勢由功能區的 data-ignore-swipe 擋掉（見 ribbon.ts）
    const find = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === id) return t; return null; };
    b.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { id = -1; return; }
      const t = e.touches[0];
      id = t.identifier; x = t.clientX; y = t.clientY; active = false; this.padMoved = false;
    }, { passive: true });
    b.addEventListener('touchmove', e => {
      const t = find(e);
      if (!t) return;
      const dx = t.clientX - x; const dy = t.clientY - y;
      if (!active) {
        if (Math.abs(dx) < START && Math.abs(dy) < START) return;
        // 編輯區沒有焦點（鍵盤沒開）時不啟動：移動游標會把焦點放回去、叫出鍵盤，畫面一重排手指的相對位置就跳掉，游標亂跑
        const v = this.view;
        if (!v || !v.hasFocus()) { id = -1; return; }
        active = true; this.padMoved = true;
        b.classList.add('is-caret-pad');
        this.closePopup();
        loupe = new Loupe(v);
      }
      if (e.cancelable) e.preventDefault();
      const nx = Math.trunc(dx / STEP_X); const ny = Math.trunc(dy / STEP_Y);
      if (nx) { x += nx * STEP_X; this.run(C.moveCaretBy(nx)); }
      if (ny) { y += ny * STEP_Y; this.moveCaretLines(ny); }
      if ((nx || ny) && loupe) loupe.update();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      if (!find(e)) return;
      // 拖曳過：擋掉放開之後的那一下點擊，不然會打開分頁選單
      if (active && e.cancelable) e.preventDefault();
      id = -1; active = false;
      if (loupe) { loupe.destroy(); loupe = null; }
      b.classList.remove('is-caret-pad');
    };
    b.addEventListener('touchend', end);
    b.addEventListener('touchcancel', end);
  }

  // 游標往上（n < 0）或往下移 |n| 行：照畫面上的位置找上一行、下一行同一個水平位置的地方
  moveCaretLines(n: number): void {
    const v = this.view;
    if (!v) return;
    for (let i = 0; i < Math.abs(n); i++) {
      const head = v.state.selection.head;
      const c = v.coordsAtPos(head);
      const h = Math.max(8, c.bottom - c.top);
      // 上一行、下一行不一定緊貼著：段落之間有間距、表格儲存格有內距，只往外探半行會落在空白裡、查回來還是原來的位置，
      // 游標就卡住。一次多探半行，直到找到畫面上真的在另一行的位置（最多探六行的距離）
      let to = -1;
      for (let k = 1; k <= 12 && to < 0; k++) {
        const hit = v.posAtCoords({ left: c.left, top: n < 0 ? c.top - h * k / 2 : c.bottom + h * k / 2 });
        if (!hit) continue;
        const near = Selection.near(v.state.doc.resolve(hit.pos), n < 0 ? -1 : 1).head;
        if (near === head) continue;
        const at = v.coordsAtPos(near);
        if (n < 0 ? at.bottom <= c.top + 1 : at.top >= c.bottom - 1) to = near;
      }
      if (to < 0) return;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, to)).scrollIntoView());
    }
  }

  // ----------------------------------------------------------- 彈出選單
  openPopup(owner: HTMLElement, build: (p: HTMLDivElement) => void): void {
    if (this.popup && this.popupOwner === owner) { this.closePopup(); return; }
    this.closePopup();
    hideHint();
    const p = el('div', 'wm-popup' + (this.ctx.isMobile ? ' is-mobile' : ''), this.dom.ownerDocument.body);
    // 面板裡左右滑（符號、色票）不要把 Obsidian 的側邊欄拉出來（見 ribbon.ts）
    if (this.ctx.isMobile) p.dataset.ignoreSwipe = 'true';
    this.popup = p; this.popupOwner = owner;
    build(p);
    // 焦點在面板裡（色碼的輸入框）時按 Esc：關掉面板，回到編輯區。焦點在編輯區時由 view 的按鍵處理呼叫 closePopup()
    p.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault(); e.stopPropagation();
      this.closePopup();
      const v = this.view;
      if (v) v.focus();
    });
    // 手機（body 的 is-phone）：不跟著按鈕，改成從畫面下方滑上來的抽屜，後面蓋一層變暗的底；位置與大小都在樣式表
    // （.wm-popup.is-sheet），鍵盤開著時貼在鍵盤上方。按底的任何地方就關掉（onDocDown），不搶走編輯區的焦點
    if (owner.ownerDocument.body.classList.contains('is-phone')) {
      p.classList.add('is-sheet');
      // 抽屜最上面放標題（開它的那顆按鈕的名稱，去掉括號裡的快速鍵）：手機上沒有提示可看，抽屜一開要知道這是在選什麼
      const label = (owner.getAttribute('aria-label') || '').split('\n')[0].replace(/\s*[（(][^（()）]*[)）]\s*$/, '');
      if (label) p.prepend(el('div', 'wm-sheet-title', null, label));
      this.popupBackdrop = el('div', 'wm-sheet-backdrop');
      keepFocus(this.popupBackdrop);
      p.before(this.popupBackdrop);
      this.sheetDrag(p);
      return;
    }
    // 放在按鈕下方；超出畫面時改放上方或往旁邊移（手機的工具列在畫面下方）。介面由右到左時對齊按鈕的右緣、往左展開。
    // 視窗大小看按鈕所在的那個視窗：筆記拉到獨立視窗之後，全域的 window 還是主視窗
    const r = owner.getBoundingClientRect();
    const win = owner.ownerDocument.defaultView || window;
    const vw = win.innerWidth; const vh = visibleBottom(win);
    const w = p.offsetWidth || 200; const h = p.offsetHeight || 200;
    p.style.left = popupLeft(r, w, vw, isRtl(owner)) + 'px';
    p.style.top = Math.max(4, r.bottom + 4 + h > vh && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4) + 'px';
  }

  // 抽屜可以往下拖掉（iOS 的抽屜都這樣）：內容捲在最上面時手指往下拖，抽屜跟著手指走；拖超過 CLOSE 放開就關掉，
  // 不夠就彈回去。位移寫在 --wm-sheet-drag，轉場在樣式表
  sheetDrag(p: HTMLElement): void {
    const CLOSE = 70;
    let y = 0; let dy = 0; let on = false;
    p.addEventListener('touchstart', e => {
      on = e.touches.length === 1 && p.scrollTop <= 0;
      y = on ? e.touches[0].clientY : 0; dy = 0;
    }, { passive: true });
    p.addEventListener('touchmove', e => {
      if (!on) return;
      dy = e.touches[0].clientY - y;
      // 往上是捲內容：這次觸控就不當成拖抽屜
      if (dy < 0 && !p.classList.contains('is-dragging')) { on = false; return; }
      if (dy < 6) return;
      p.classList.add('is-dragging');
      p.style.setProperty('--wm-sheet-drag', Math.max(0, dy).toFixed(0) + 'px');
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      if (!p.classList.contains('is-dragging')) return;
      p.classList.remove('is-dragging');
      // 拖過了：擋掉放開之後的點擊，手指底下的選項不要被選到
      if (e.cancelable) e.preventDefault();
      if (dy > CLOSE && e.type === 'touchend') { this.closePopup(); return; }
      p.style.removeProperty('--wm-sheet-drag');
    };
    p.addEventListener('touchend', end);
    p.addEventListener('touchcancel', end);
  }

  closePopup(): void {
    if (this.popup) this.popup.remove();
    if (this.popupBackdrop) this.popupBackdrop.remove();
    this.popup = null; this.popupOwner = null; this.popupBackdrop = null;
  }

  openMenu(owner: HTMLElement, items: readonly MenuItem[]): void {
    this.openPopup(owner, p => {
      p.classList.add('wm-menu-popup');
      for (const it of items) {
        const b = el('button', 'wm-menu-item', p);
        b.type = 'button';
        if (it.icon) { const i = el('span', 'wm-menu-icon', b); this.ctx.icon(i, it.icon, ''); }
        el('span', 'wm-menu-text', b, it.title);
        keepFocus(b);
        b.addEventListener('click', () => { this.closePopup(); it.run(); });
      }
    });
  }

  openStylePopup(owner: HTMLElement): void {
    if (!this.view) return;
    this.openPopup(owner, p => {
      p.classList.add('wm-style-popup');
      const cur = C.currentBlockStyle(this.view!.state);
      for (const s of C.BLOCK_STYLES) {
        const b = el('button', 'wm-style-item' + (s.id === cur ? ' is-active' : ''), p);
        b.type = 'button';
        el('span', 'wm-style-label wm-style-label-' + s.id, b, t(s.label));
        const k = s.id === 'p' ? 'Mod+Alt+0' : /^h\d/.test(s.id) ? 'Mod+Alt+' + s.id.slice(1) : null;
        if (k) el('span', 'wm-style-key', b, key(k));
        const ok = C.setBlockStyle(s.id)(this.view!.state) || s.id === cur;
        if (!ok) b.classList.add('is-disabled');
        keepFocus(b);
        b.addEventListener('click', () => { if (!ok) return; this.closePopup(); this.run(C.setBlockStyle(s.id)); });
      }
    });
  }

  openOutlinePopup(owner: HTMLElement): void {
    const v = this.view;
    if (!v) return;
    const heads: OutlineHead[] = [];
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading') heads.push({ level: (n.attrs as HeadingAttrs).level, text: n.textContent || t('（無標題）'), pos });
      return !n.isTextblock;
    });
    this.openPopup(owner, p => {
      p.classList.add('wm-outline-popup');
      if (!heads.length) { el('div', 'wm-outline-empty', p, t('這份筆記沒有標題')); return; }
      const min = Math.min(...heads.map(h => h.level));
      for (const h of heads) {
        const item = el('div', 'wm-outline-item', p, h.text);
        // 縮排在開頭那一邊：介面由右到左時縮在右邊
        item.style.paddingInlineStart = (8 + (h.level - min) * 14) + 'px';
        item.addEventListener('mousedown', e => e.preventDefault());
        item.addEventListener('click', () => { this.closePopup(); this.d.scrollTo(h.pos); });
      }
    });
  }

  // 字型色彩面板：標準色彩、深淺變化、最近使用的自訂色彩、自訂色彩
  openColorPopup(owner: HTMLElement): void {
    const S = this.ctx.settings || {};
    const apply = (c: string | null, custom: boolean) => {
      this.closePopup();
      if (c) {
        this.fontColor = c;
        if (this.colorBtn) this.colorBtn.style.setProperty('--wm-current-color', c);
        if (this.ctx.rememberColor) this.ctx.rememberColor('font', c, custom);
      }
      this.run(C.setColor(c));
    };
    this.openPopup(owner, p => buildColorPanel(p, {
      kind: 'font', current: this.fontColor, recent: S.recentFontColors || [],
      icon: this.ctx.icon, keepFocus,
      onPick: apply, onClear: () => apply(null, false),
    }));
  }

  // 醒目提示色彩面板：螢光筆色彩、較深的色彩、最近使用的自訂色彩、自訂色彩（可調不透明度）
  openHighlightPopup(owner: HTMLElement): void {
    const S = this.ctx.settings || {};
    this.openPopup(owner, p => buildColorPanel(p, {
      kind: 'highlight', current: this.hlColor, recent: S.recentHighlights || [],
      icon: this.ctx.icon, keepFocus,
      onPick: (color, custom) => {
        this.closePopup();
        this.hlColor = color;
        if (this.hlBtn) { if (color) this.hlBtn.style.setProperty('--wm-hl', color); else this.hlBtn.style.removeProperty('--wm-hl'); }
        if (this.ctx.rememberColor) this.ctx.rememberColor('highlight', color, custom);
        this.run(C.setHighlight(color));
      },
      onClear: () => { this.closePopup(); this.run(C.setHighlight('none')); },
    }));
  }

  openSymbolPopup(owner: HTMLElement): void {
    this.openPopup(owner, p => {
      p.classList.add('wm-symbol-popup');
      // 成對的括號：跨段落選取時包不起來，整組不顯示
      if (this.view && C.wrapPair('(', ')')(this.view.state)) {
        el('div', 'wm-popup-title', p, t('成對（包住選取的文字）'));
        const grid = el('div', 'wm-symbol-grid wm-pair-grid', p);
        for (const [open, close] of PAIRS) {
          const b = el('button', 'wm-symbol wm-pair', grid, open + close);
          b.type = 'button';
          keepFocus(b);
          b.addEventListener('click', () => { this.closePopup(); this.run(C.wrapPair(open, close)); });
        }
      }
      for (const [group, chars] of SYMBOLS) {
        el('div', 'wm-popup-title', p, t(group));
        const grid = el('div', 'wm-symbol-grid', p);
        for (const ch of Array.from(chars)) {
          const b = el('button', 'wm-symbol', grid, ch);
          b.type = 'button';
          keepFocus(b);
          b.addEventListener('click', () => { this.closePopup(); this.run(C.insertText(ch)); });
        }
      }
    });
  }

  openTablePopup(owner: HTMLElement): void {
    if (!this.view || !C.insertTable(2, 2)(this.view.state)) return;
    this.openPopup(owner, p => {
      p.classList.add('wm-table-popup');
      const label = el('div', 'wm-table-label', p, t('插入表格'));
      const grid = el('div', 'wm-table-grid', p);
      const R = 8; const COLS = 8; const cells: HTMLDivElement[] = [];
      let picked: string | null = null;
      const mark = (r: number, c: number) => {
        for (const x of cells) x.classList.toggle('is-on', +x.dataset.r! <= r && +x.dataset.c! <= c);
        label.textContent = t('{c} 欄 × {r} 列（第一列為標題列）', { c, r });
      };
      for (let r = 1; r <= R; r++) {
        for (let c = 1; c <= COLS; c++) {
          const cell = el('div', 'wm-table-cell', grid);
          (cell.dataset as DataNumbers).r = r; (cell.dataset as DataNumbers).c = c;
          cells.push(cell);
          cell.addEventListener('mouseenter', () => mark(r, c));
          cell.addEventListener('mousedown', e => e.preventDefault());
          // 觸控：第一下選大小、第二下確認；滑鼠：按一下就插入
          cell.addEventListener('pointerup', e => {
            if (e.pointerType !== 'mouse' && picked !== r + 'x' + c) { picked = r + 'x' + c; mark(r, c); label.textContent += ' ' + t('— 再點一下插入'); return; }
            this.closePopup();
            // 插入之後切到「表格」分頁（像 Word），接著要加列、對齊都在那裡
            if (this.run(C.insertTable(r, c))) this.showTab('tabletab');
          });
        }
      }
      // 選取了幾段文字：也可以直接把它們轉成表格（用 Tab、「|」或逗號分欄）
      if (this.view && C.textToTable(this.view.state)) {
        const conv = el('button', 'wm-table-convert', p, t('把選取文字轉成表格'));
        conv.type = 'button';
        keepFocus(conv);
        conv.addEventListener('click', () => { this.closePopup(); if (this.run(C.textToTable)) this.showTab('tabletab'); });
      }
    });
  }
}
