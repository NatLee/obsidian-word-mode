// Word 模式的功能區（Ribbon）：常用／插入／校閱／檢視。這裡決定每個按鈕按下去執行哪個編輯指令或開哪個對話框、
// 何時顯示成作用中或停用，以及自己的下拉面板；分頁、群組、按鈕的 DOM 與兩條功能區共用的按鈕外觀在 ribbon.ts。
// 版面可在設定中調整：分頁、全部排成一行（可左右捲動）、全部自動換行；按鈕可只顯示圖示或加上文字；分頁與群組可隱藏
import * as C from './commands.js';
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
      openMenu: (owner, items) => this.openMenu(owner, items),
      pickTab: id => this.showTab(id),
    });
    this.build();
    this.showTab(this.shell.usableTab(ctx.initialTab));
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
    this.button(g, { icon: 'keyboard', title: '鍵盤按鍵', text: '⌨', label: '按鍵', big: true, demo: 'kbd', desc: '把文字標成鍵盤按鍵的樣子，例如 Ctrl。' }, { cmd: C.toggleKbd, active: s => C.markActive(s, M.kbd), ...NO_CODE });
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

  // ----------------------------------------------------------- 彈出選單
  openPopup(owner: HTMLElement, build: (p: HTMLDivElement) => void): void {
    if (this.popup && this.popupOwner === owner) { this.closePopup(); return; }
    this.closePopup();
    hideHint();
    const p = el('div', 'wm-popup' + (this.ctx.isMobile ? ' is-mobile' : ''), this.dom.ownerDocument.body);
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
    // 放在按鈕下方；超出畫面時改放上方或往旁邊移（手機的工具列在畫面下方）。介面由右到左時對齊按鈕的右緣、往左展開。
    // 視窗大小看按鈕所在的那個視窗：筆記拉到獨立視窗之後，全域的 window 還是主視窗
    const r = owner.getBoundingClientRect();
    const win = owner.ownerDocument.defaultView || window;
    const vw = win.innerWidth; const vh = visibleBottom(win);
    const w = p.offsetWidth || 200; const h = p.offsetHeight || 200;
    p.style.left = popupLeft(r, w, vw, isRtl(owner)) + 'px';
    p.style.top = Math.max(4, r.bottom + 4 + h > vh && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4) + 'px';
  }

  closePopup(): void {
    if (this.popup) this.popup.remove();
    this.popup = null; this.popupOwner = null;
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
