// Word 風格功能區（Ribbon）：常用／插入／校閱／檢視
// 版面可在設定中調整：分頁、全部排成一行（可左右捲動）、全部自動換行；按鈕可只顯示圖示或加上文字；分頁與群組可隱藏
import * as C from './commands.js';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { t, key } from './i18n.js';
import { marksOn } from './marks.js';
import { attachHint, hideHint } from './hints.js';
import { el } from './dom.js';
import { buildColorPanel, TEXT_COLORS, SHADING } from './colorpicker.js';
import type { ColorKind } from './colorpicker.js';
import type { Command, EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Mark, MarkType } from 'prosemirror-model';
import type { Align, CaseKind, Direction } from './commands.js';
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
// 「貼上」按鈕與選單的模式：auto＝一般貼上、text＝只貼文字、markdown＝把 Markdown 轉成格式
export type PasteMode = 'auto' | 'text' | 'markdown';
// 「剪下」「複製」按鈕
export type ClipKind = 'cut' | 'copy';

// 功能區需要的外部功能（由 view.js 建立）；有 ? 的成員功能區會先檢查有沒有提供
export interface ToolbarContext {
  // 目前的編輯器；還沒載入筆記時是 null
  getView(): EditorView | null;
  // 在 el 裡放 Obsidian 圖示；找不到圖示時改顯示 fallback 文字
  icon: (el: HTMLElement, name: string, fallback: string) => void;
  isMobile: boolean;
  // 外掛設定（只列出功能區會讀的欄位）
  settings?: {
    ribbonLayout?: RibbonLayout;
    buttonStyle?: ButtonStyle;
    hiddenGroups?: readonly string[];
    hiddenTabs?: readonly string[];
    richHints?: boolean;
    groupLabels?: boolean;
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
// 按鈕的點擊處理；btn 是按下的按鈕
export type ButtonClick = (e: MouseEvent, btn: HTMLButtonElement) => void;

// 一個按鈕的描述；title、label、desc 都是翻譯前的原文
export interface ButtonSpec {
  // 功能名稱，也是提示的標題；分頁以外的版面用它判斷重複的按鈕
  title: I18nKey;
  // Obsidian（Lucide）圖示名稱
  icon?: string;
  // 沒有圖示時顯示的文字
  text?: string;
  // 顯示文字時的按鈕名稱
  label?: I18nKey;
  // 快速鍵，例如 'Mod+B'
  keys?: string | null;
  // 詳細提示的說明
  desc?: I18nKey;
  // 詳細提示的示意動畫名稱（hints.ts 的 DEMOS）
  demo?: string;
  // 大按鈕：按鈕樣式為「自動」時也顯示文字
  big?: boolean;
  // 額外的 CSS class
  cls?: string;
  // 分割按鈕的箭頭：全部排在一起的版面也不去除重複
  split?: boolean;
  // 按下時執行的編輯指令（沒有 onClick 時）
  cmd?: Command;
  active?: StateTest;
  enabled?: StateTest;
  // 停用時的原因（翻譯前的原文），沒有原因時回傳 null
  why?: (state: EditorState) => I18nKey | null;
  onClick?: ButtonClick;
}

// 下拉選單的一個項目；title 已經翻譯好
export interface MenuItem {
  title: string;
  icon?: string;
  run(): void;
}

// 功能區記住的按鈕，update() 依編輯狀態更新它們
interface ToolbarItem extends Pick<ButtonSpec, 'cmd' | 'active' | 'enabled' | 'why'> {
  dom: HTMLButtonElement;
  // 已翻譯、含快速鍵的標題
  title: string;
  // 已翻譯的停用原因
  reasonText: string | null;
}

// 大綱下拉選單的一個標題
interface OutlineHead { level: number; text: string; pos: number; }
// heading 節點的屬性（見 schema.ts）；這裡只讀 level（1～6）
interface HeadingAttrs { readonly level: number; }

// 各群組放按鈕的容器；群組被隱藏時是 null，所在分頁被隱藏時沒有這一項
type GroupBodies = Partial<Record<GroupId, HTMLDivElement | null>>;

// 表格大小選擇器把格子的列、欄號碼（數字）直接存進 dataset，瀏覽器會自動轉成字串
type DataNumbers = Record<string, string | number | undefined>;

const M = schema.marks;

export { TEXT_COLORS };

export const SYMBOLS: readonly (readonly [group: I18nKey, chars: string])[] = [
  ['常用', '©®™°±×÷≈≠≤≥∞✓✗★☆●○■□◆◇※§¶†…‰€£¥'],
  ['中文標點', '「」『』（）【】《》〈〉、。，；：！？—～·‧'],
  ['箭頭', '→←↑↓↔⇒⇐⇔↗↘↖↙➔➜'],
  ['數學', '∑∏√∛∫∂∆∇∈∉⊂⊃⊆⊇∪∩∀∃∴∵∝∠⊥∥'],
  ['希臘字母', 'αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ'],
  ['單位', '℃℉㎡㎥㎏㎞㎝㎜㏄％＄'],
  ['圈號數字', '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'],
];

export const DATE_FORMATS: readonly string[] = ['YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY年M月D日', 'YYYY-MM-DD HH:mm', 'HH:mm', 'YYYY-MM-DD dddd'];

const CASE_MENU: readonly (readonly [kind: CaseKind, label: I18nKey])[] = [['upper', '全部大寫'], ['lower', '全部小寫'], ['title', '每個英文單字首字大寫'], ['sentence', '句首大寫'], ['half', '轉成半形'], ['full', '轉成全形']];

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

// 游標在程式碼區塊裡時停用的按鈕（程式碼區塊只能放純文字）：停用並在提示裡說明原因
const NO_CODE: Pick<ButtonSpec, 'enabled' | 'why'> = { enabled: C.notInCode, why: C.codeBlocked };

// 不讓編輯區失去焦點（手機上鍵盤才不會收起來）
export function keepFocus(b: HTMLElement): void {
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
}

// 功能區；popup 是目前開著的下拉面板（沒有時是 null 或 undefined），painter 是格式刷記住的格式
export class Toolbar {
  declare ctx: ToolbarContext;
  declare layout: RibbonLayout;
  declare buttonStyle: ButtonStyle;
  declare hiddenGroups: Set<string>;
  declare hiddenTabs: Set<string>;
  declare richHints: boolean;
  declare groupLabels: boolean;
  declare dom: HTMLDivElement;
  declare tabsEl: HTMLDivElement;
  declare toolbarEl: HTMLDivElement;
  declare allPanel: HTMLDivElement;
  declare items: ToolbarItem[];
  declare panels: Partial<Record<TabId, HTMLDivElement>>;
  declare tabBtns: Partial<Record<TabId, HTMLButtonElement>>;
  declare activeTab: TabId;
  declare seen: Set<string>;
  declare painter: readonly Mark[] | null;
  declare painterSticky: boolean;
  declare painterHandler: (() => void) | null;
  declare hlColor: string | null;
  declare fontColor: string;
  declare onDocDown: (e: PointerEvent) => void;
  declare popup: HTMLDivElement | null | undefined;
  declare popupOwner: HTMLElement | null | undefined;
  declare findBtn: HTMLButtonElement | null;
  declare painterBtn: HTMLButtonElement | null;
  declare styleBtn: HTMLButtonElement | null;
  declare hlBtn: HTMLButtonElement | null;
  declare colorBtn: HTMLButtonElement | null;
  declare tableBtn: HTMLButtonElement | null;
  declare fullBtn: HTMLButtonElement | null;
  declare tableGroup: HTMLDivElement;

  // ctx: { getView(), icon(el, name, fallbackText), dialogs: {...}, isMobile, settings }
  constructor(container: HTMLElement, ctx: ToolbarContext) {
    this.ctx = ctx;
    const S = ctx.settings || {};
    this.layout = S.ribbonLayout || 'tabs';
    this.buttonStyle = S.buttonStyle || 'auto';
    this.hiddenGroups = new Set(S.hiddenGroups || []);
    this.hiddenTabs = new Set(S.hiddenTabs || []);
    this.richHints = !!S.richHints && !ctx.isMobile;
    this.groupLabels = !!S.groupLabels;
    this.dom = el('div', 'wm-ribbon wm-layout-' + this.layout + ' wm-btnstyle-' + this.buttonStyle + (this.groupLabels ? ' wm-group-labels' : ''), container);
    this.tabsEl = el('div', 'wm-tabs', this.dom);
    this.toolbarEl = el('div', 'wm-toolbar', this.dom);
    this.toolbarEl.setAttribute('role', 'toolbar');
    this.items = [];
    this.panels = {};
    this.tabBtns = {};
    this.seen = new Set();
    this.painter = null;
    this.hlColor = S.lastHighlight || null;
    this.fontColor = S.lastFontColor || '#c00000';
    this.build();
    const first = TABS.find(([id]) => this.panels[id] && !this.panels[id].classList.contains('is-empty'));
    this.showTab(this.panels[ctx.initialTab] && !this.panels[ctx.initialTab]!.classList.contains('is-empty') ? ctx.initialTab : (first ? first[0] : 'home'));
    this.onDocDown = e => { if (this.popup && !this.popup.contains(e.target as Node | null) && !this.popupOwner!.contains(e.target as Node | null)) this.closePopup(); };
    this.dom.ownerDocument.addEventListener('pointerdown', this.onDocDown, true);
  }

  destroy(): void {
    this.dom.ownerDocument.removeEventListener('pointerdown', this.onDocDown, true);
    this.closePopup();
    hideHint();
    this.dom.remove();
  }

  get view(): EditorView | null { return this.ctx.getView(); }
  get d(): ToolbarContext['dialogs'] { return this.ctx.dialogs; }

  run(cmd: Command): boolean {
    const v = this.view;
    if (!v) return false;
    const r = cmd(v.state, v.dispatch, v);
    v.focus();
    return r;
  }

  showTab(id: TabId): void {
    if (this.layout !== 'tabs') return;
    this.activeTab = id;
    for (const [k, p] of Object.entries(this.panels)) p.classList.toggle('is-hidden', k !== id);
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('is-active', k === id);
    if (this.ctx.onTab) this.ctx.onTab(id);
  }

  // 按鈕的提示：一般模式用 Obsidian 的 aria-label；詳細提示模式改用自己的提示卡（有說明與動畫），兩者不會同時出現
  setTip(b: HTMLButtonElement, it: ToolbarItem): void {
    const text = it.reasonText ? it.title + '\n' + it.reasonText : it.title;
    if (this.richHints) {
      b.removeAttribute('aria-label');
      b.querySelector('.wm-sr')!.textContent = text;
    } else b.setAttribute('aria-label', text);
  }

  group(panel: HTMLElement | undefined, id: GroupId, label: I18nKey): HTMLDivElement | null {
    if (this.hiddenGroups.has(id)) return null;
    const g = el('div', 'wm-group wm-group-' + id, panel);
    g.dataset.group = id;
    const body = el('div', 'wm-group-body', g);
    el('div', 'wm-group-name', g, t(label));
    return body;
  }

  // spec: { icon, text, title, keys, desc, demo, label, big, cmd, active, enabled, why, onClick, cls, split }
  button(parent: HTMLElement | null | undefined, spec: ButtonSpec): HTMLButtonElement | null {
    if (!parent) return null;
    const title = spec.keys ? t(spec.title) + ' (' + key(spec.keys) + ')' : t(spec.title);
    // 全部排在一起的版面：同一個功能只出現一次
    if (this.layout !== 'tabs' && !spec.split) {
      if (this.seen.has(spec.title)) return null;
      this.seen.add(spec.title);
    }
    const showLabel = this.buttonStyle === 'label' || (this.buttonStyle === 'auto' && spec.big);
    const b = el('button', 'wm-btn' + (spec.cls ? ' ' + spec.cls : '') + (showLabel && spec.label ? ' has-label' : ''), parent);
    b.type = 'button';
    el('span', 'wm-sr', b);
    if (spec.icon) {
      const i = el('span', 'wm-btn-icon', b);
      this.ctx.icon(i, spec.icon, spec.text || t(spec.title).slice(0, 1));
    } else el('span', 'wm-btn-text', b, spec.text);
    if (showLabel && spec.label) el('span', 'wm-btn-label', b, t(spec.label));
    keepFocus(b);
    b.addEventListener('click', e => {
      e.preventDefault();
      hideHint();
      if (b.classList.contains('is-disabled')) return;
      if (spec.onClick) spec.onClick(e, b); else if (spec.cmd) this.run(spec.cmd);
    });
    const it: ToolbarItem = { dom: b, cmd: spec.cmd, active: spec.active, enabled: spec.enabled, why: spec.why, title, reasonText: null };
    this.items.push(it);
    this.setTip(b, it);
    if (this.richHints) {
      attachHint(b, () => ({
        title: t(spec.title), keys: spec.keys ? key(spec.keys) : null,
        desc: spec.desc ? t(spec.desc) : null, demo: spec.demo, reason: it.reasonText,
      }));
    }
    return b;
  }

  menuButton(parent: HTMLElement | null | undefined, spec: Omit<ButtonSpec, 'onClick'>, items: readonly MenuItem[] | (() => readonly MenuItem[])): HTMLButtonElement | null {
    return this.button(parent, Object.assign({}, spec, { onClick: (e: MouseEvent, b: HTMLButtonElement) => this.openMenu(b, typeof items === 'function' ? items() : items) }));
  }

  // 分割按鈕：主按鈕執行，旁邊的小箭頭開選單
  // noCode：游標在程式碼區塊裡時停用
  arrow(parent: HTMLElement | null | undefined, title: I18nKey, onClick: ButtonClick, noCode?: boolean): HTMLButtonElement | null {
    return this.button(parent, { icon: 'chevron-down', title, text: '▾', cls: 'wm-split-arrow', split: true, onClick, ...(noCode ? NO_CODE : {}) });
  }

  panel(tab: TabId): HTMLDivElement | undefined {
    if (this.layout !== 'tabs') return this.allPanel;
    return this.panels[tab];
  }

  build(): void {
    if (this.layout === 'tabs') {
      for (const [id, label] of TABS) {
        this.panels[id] = el('div', 'wm-panel', this.toolbarEl);
        if (this.hiddenTabs.has(id)) { this.panels[id].classList.add('is-empty'); continue; }
        const b = el('button', 'wm-tab', this.tabsEl, t(label));
        b.type = 'button';
        keepFocus(b);
        b.addEventListener('click', () => this.showTab(id));
        this.tabBtns[id] = b;
      }
    } else {
      this.allPanel = el('div', 'wm-panel', this.toolbarEl);
    }
    const G: GroupBodies = {};
    for (const [id, tab, label] of GROUPS) {
      if (this.hiddenTabs.has(tab)) continue;
      G[id] = this.group(this.panel(tab), id, label);
    }
    this.buildHome(G);
    this.buildInsert(G);
    this.buildReview(G);
    this.buildView(G);
    // 沒有任何群組的分頁不顯示
    for (const [id] of TABS) {
      const p = this.panels[id];
      if (p && !p.querySelector('.wm-btn')) { p.classList.add('is-empty'); if (this.tabBtns[id]) { this.tabBtns[id].remove(); delete this.tabBtns[id]; } }
    }
    for (const g of this.toolbarEl.querySelectorAll('.wm-group')) if (!g.querySelector('.wm-btn')) g.remove();
    // 右上角固定的快速按鈕（分頁版面放在分頁列，其他版面放在最後）
    const quickHost = this.layout === 'tabs' ? this.tabsEl : this.allPanel;
    if (this.layout === 'tabs') el('div', 'wm-tabs-spacer', this.tabsEl);
    const quick = el('div', 'wm-tabs-quick', quickHost);
    const prevSeen = this.seen; this.seen = new Set();
    this.findBtn = this.button(quick, { icon: 'search', title: '尋找與取代', keys: 'Mod+F', text: '找', desc: '在這份筆記裡尋找文字，再按一次關閉。', demo: 'find', onClick: () => this.d.find(), active: () => this.isFindOpen() });
    if (!this.hiddenGroups.has('help')) this.button(quick, { icon: 'help-circle', title: '快速鍵說明', keys: 'Mod+/', text: '?', onClick: () => this.d.shortcuts() });
    this.button(quick, { icon: 'code-2', title: '切換到 Markdown 編輯', keys: 'Mod+E', text: 'MD', desc: '用 Obsidian 原本的 Markdown 編輯這份筆記，再按一次（或在 Markdown 畫面按同樣的快速鍵）切回 Word 模式。', demo: 'markdown', onClick: () => this.d.markdown() });
    this.seen = prevSeen;
    if (!this.tabsEl.childElementCount || this.layout !== 'tabs') this.tabsEl.classList.add('is-hidden');
  }

  isFindOpen(): boolean { return !!(this.ctx.findState && this.ctx.findState().open); }

  // ----------------------------------------------------------- 常用
  buildHome(G: GroupBodies): void {
    let g = G.undo;
    this.button(g, { icon: 'undo-2', title: '復原', keys: 'Mod+Z', desc: '取消上一個動作。切到 Markdown 再切回來也能復原。', demo: 'undo', cmd: undo, enabled: s => undo(s) });
    this.button(g, { icon: 'redo-2', title: '取消復原', keys: 'Mod+Y', desc: '把剛剛復原的動作做回來。', demo: 'redo', cmd: redo, enabled: s => redo(s) });

    g = G.clipboard;
    this.button(g, { icon: 'clipboard-paste', title: '貼上', keys: 'Mod+V', label: '貼上', text: '貼', desc: '貼上剪貼簿的內容。Excel 範圍會變成表格。', demo: 'paste', onClick: () => this.d.paste('auto') });
    this.arrow(g, '貼上選項', (e, b) => this.openMenu(b, [
      { title: t('貼上') + ' (' + key('Mod+V') + ')', icon: 'clipboard-paste', run: () => this.d.paste('auto') },
      { title: t('只貼上文字') + ' (' + key('Mod+Shift+V') + ')', icon: 'type', run: () => this.d.paste('text') },
      { title: t('貼上並轉換 Markdown 格式'), icon: 'file-code', run: () => this.d.paste('markdown') },
    ]));
    this.button(g, { icon: 'scissors', title: '剪下', keys: 'Mod+X', text: '剪', desc: '剪下選取的內容。', demo: 'cut', onClick: () => this.d.clip('cut') });
    this.button(g, { icon: 'copy', title: '複製', keys: 'Mod+C', text: '複', desc: '複製選取的內容。', demo: 'copy', onClick: () => this.d.clip('copy') });
    this.painterBtn = this.button(g, { icon: 'paintbrush', title: '複製格式', text: '刷', desc: '先把游標放在有格式的文字，按一下格式刷，再選取要套用的文字。按兩下可以連續刷，按 Esc 結束。', demo: 'painter', onClick: () => this.togglePainter(), ...NO_CODE });
    if (this.painterBtn) this.painterBtn.addEventListener('dblclick', e => { e.preventDefault(); this.togglePainter(true); });

    g = G.styles;
    this.styleBtn = this.button(g, { title: '段落樣式', text: t('內文'), cls: 'wm-style-btn', desc: '把段落改成標題 1～6、內文或程式碼。', demo: 'style', onClick: (e, b) => this.openStylePopup(b) });

    g = G.font;
    const mk = (icon: string, title: I18nKey, keys: string | null, cmd: Command, type: MarkType, text: string, demo: string, desc: I18nKey) => this.button(g, { icon, title, keys, cmd, text, demo, desc, active: s => C.markActive(s, type), ...NO_CODE });
    mk('bold', '粗體', 'Mod+B', C.toggleBold, M.strong, 'B', 'bold', '把選取的文字（或游標所在的詞）變粗體。');
    mk('italic', '斜體', 'Mod+I', C.toggleItalic, M.em, 'I', 'italic', '把文字變斜體。');
    mk('underline', '底線', 'Mod+U', C.toggleUnderline, M.underline, 'U', 'underline', '在文字下方加底線。');
    mk('strikethrough', '刪除線', 'Mod+Shift+X', C.toggleStrike, M.strike, 'S', 'strike', '在文字中間畫一條線。');
    mk('superscript', '上標', null, C.toggleSup, M.sup, 'x²', 'sup', '把文字變成小字並往上移，例如平方。');
    mk('subscript', '下標', null, C.toggleSub, M.sub, 'x₂', 'sub', '把文字變成小字並往下移，例如化學式。');
    this.hlBtn = this.button(g, {
      icon: 'highlighter', title: '醒目提示', keys: 'Mod+Shift+H', text: 'H', cls: 'wm-hl-btn', demo: 'highlight',
      desc: '像螢光筆一樣標出文字。旁邊的箭頭可以換顏色。',
      cmd: (st, dp) => (this.hlColor === null ? C.toggleHighlight(st, dp) : C.setHighlight(this.hlColor)(st, dp)),
      active: st => { const h = C.currentHighlight(st); return !!h && h !== SHADING; },
      ...NO_CODE,
    });
    if (this.hlBtn && this.hlColor) this.hlBtn.style.setProperty('--wm-hl', this.hlColor);
    this.arrow(g, '醒目提示色彩', (e, b) => this.openHighlightPopup(b), true);
    this.button(g, { icon: 'paint-bucket', title: '字元網底', text: '網', demo: 'shading', desc: '在文字後面加上灰色底色（Word 的「字元網底」）。',
      cmd: (st, dp) => C.setHighlight(C.currentHighlight(st) === SHADING ? 'none' : SHADING)(st, dp),
      active: st => C.currentHighlight(st) === SHADING, ...NO_CODE });
    this.button(g, { icon: 'square', title: '字元框線', text: '框', demo: 'border', desc: '在文字外面加一個方框。', cmd: C.toggleBorder, active: s => C.markActive(s, M.border), ...NO_CODE });
    this.colorBtn = this.button(g, { icon: 'baseline', title: '字型色彩', text: 'A', cls: 'wm-color-btn', demo: 'color', desc: '把文字改成上次選的顏色。旁邊的箭頭可以選其他顏色。',
      cmd: (st, dp) => C.setColor(this.fontColor)(st, dp), ...NO_CODE });
    if (this.colorBtn) this.colorBtn.style.setProperty('--wm-current-color', this.fontColor);
    this.arrow(g, '其他字型色彩', (e, b) => this.openColorPopup(b), true);
    this.menuButton(g, { icon: 'case-sensitive', title: '大小寫／全形半形', text: 'Aa', demo: 'case', desc: '把英文字改成大寫、小寫，或把文字轉成全形、半形。' },
      CASE_MENU.map(([k, label]) => ({ title: t(label), run: () => this.run(C.changeCase(k)) })));
    this.button(g, { icon: 'remove-formatting', title: '清除所有格式', text: '清', demo: 'clear', desc: '移除粗體、顏色、醒目提示等所有格式，標題會改回內文。', cmd: C.clearFormatting });

    g = G.paragraph;
    this.button(g, { icon: 'list', title: '項目符號', text: '•', demo: 'bullet', desc: '把段落變成項目符號清單。', cmd: C.toggleList('bullet'), active: s => C.currentList(s) === 'bullet', ...NO_CODE });
    this.button(g, { icon: 'list-ordered', title: '編號', text: '1.', demo: 'ordered', desc: '把段落變成 1. 2. 3. 編號清單。', cmd: C.toggleList('ordered'), active: s => C.currentList(s) === 'ordered', ...NO_CODE });
    this.button(g, { icon: 'list-checks', title: '核取清單', text: '☐', demo: 'task', desc: '變成可以打勾的待辦清單。', cmd: C.toggleList('task'), active: s => C.currentList(s) === 'task', ...NO_CODE });
    this.button(g, { icon: 'indent-decrease', title: '減少縮排', keys: 'Shift+Tab', text: '←', demo: 'outdent', desc: '整段往左移；清單往上一層。', cmd: C.outdent, enabled: s => C.outdent(s) });
    this.button(g, { icon: 'indent-increase', title: '增加縮排', text: '→', demo: 'indent', desc: '整段往右移；清單變成下一層。', cmd: C.indent, enabled: s => C.indent(s), why: C.blockFormatBlocked });
    const al = (a: Align, icon: string, title: I18nKey, keys: string | null, text: string) => this.button(g, { icon, title, keys, text, demo: a, desc: '設定段落的對齊方式。', cmd: C.setAlign(a), active: st => C.currentAlign(st) === a, enabled: st => C.setAlign(a)(st) || (a === 'left' && C.currentAlign(st) === 'left'), why: C.blockFormatBlocked });
    al('left', 'align-left', '靠左對齊', 'Mod+L', '左');
    al('center', 'align-center', '置中', null, '中');
    al('right', 'align-right', '靠右對齊', null, '右');
    al('justify', 'align-justify', '左右對齊', 'Mod+J', '齊');
    this.button(g, { icon: 'quote', title: '引文', text: '❝', demo: 'quote', desc: '把段落變成引用（左邊有一條線）。', cmd: C.toggleQuote, active: s => C.inQuote(s) });
    this.menuButton(g, { icon: 'arrow-down-a-z', title: '排序', text: '排', demo: 'sort', desc: '把選取的段落、清單或表格依筆畫或字母排序。' }, [
      { title: t('遞增排序（A→Z、1→9）'), icon: 'arrow-down-a-z', run: () => this.sortCmd(1) },
      { title: t('遞減排序（Z→A、9→1）'), icon: 'arrow-up-z-a', run: () => this.sortCmd(-1) },
    ]);
    this.button(g, { icon: 'pilcrow', title: '顯示／隱藏編輯標記', text: '¶', demo: 'marks', desc: '顯示空白（·）、全形空白、Tab、換行與段落結尾（¶），也會標出奇怪的符號。', onClick: () => this.d.toggleMarks(), active: s => marksOn(s) });

    g = G.editing;
    this.button(g, { icon: 'search', title: '尋找', keys: 'Mod+F', text: '找', demo: 'find', desc: '在這份筆記裡尋找文字。再按一次關閉。', onClick: () => this.d.find(), active: () => this.isFindOpen() && !this.ctx.findState!().replace });
    this.button(g, { icon: 'replace', title: '取代', keys: 'Mod+H', text: '換', demo: 'replace', desc: '把找到的文字換成別的文字。再按一次關閉。', onClick: () => this.d.replace(), active: () => this.isFindOpen() && this.ctx.findState!().replace });
    this.button(g, { icon: 'text-select', title: '全選', keys: 'Mod+A', text: '全', demo: 'selectall', desc: '選取整份筆記。再按一次取消選取。', onClick: () => this.toggleSelectAll(), active: s => C.isAllSelected(s) });

    // 表格工具（游標在表格內才顯示）
    const tg = this.layout === 'tabs' ? this.panels.home : this.allPanel;
    const tableGroup = el('div', 'wm-group wm-table-tools', tg);
    this.tableGroup = tableGroup;
    const tbody = el('div', 'wm-group-body', tableGroup);
    el('span', 'wm-group-label', tbody, t('表格'));
    el('div', 'wm-group-name', tableGroup, t('表格工具'));
    const T = C.table;
    const prevSeen = this.seen; this.seen = new Set();
    const tb = (icon: string, title: I18nKey, cmd: Command, text: string) => this.button(tbody, { icon, title, cmd, text, enabled: s => cmd(s) });
    tb('arrow-up-to-line', '在上方插入列', T.addRowBefore, '↑列');
    tb('arrow-down-to-line', '在下方插入列', T.addRowAfter, '↓列');
    tb('arrow-left-to-line', '在左側插入欄', T.addColumnBefore, '←欄');
    tb('arrow-right-to-line', '在右側插入欄', T.addColumnAfter, '→欄');
    tb('rows-3', '刪除列', T.deleteRow, '刪列');
    tb('columns-3', '刪除欄', T.deleteColumn, '刪欄');
    tb('arrow-up', '列上移', C.moveBlock(-1), '列↑');
    tb('arrow-down', '列下移', C.moveBlock(1), '列↓');
    tb('arrow-left', '欄左移', C.moveTableColumn(-1), '欄←');
    tb('arrow-right', '欄右移', C.moveTableColumn(1), '欄→');
    tb('arrow-down-a-z', '依此欄排序（遞增）', C.sortTableByColumn(1), '排↑');
    tb('arrow-up-z-a', '依此欄排序（遞減）', C.sortTableByColumn(-1), '排↓');
    tb('trash-2', '刪除表格', T.deleteTable, '刪表');
    this.seen = prevSeen;
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

  // ----------------------------------------------------------- 插入
  buildInsert(G: GroupBodies): void {
    this.tableBtn = this.button(G.tables, { icon: 'table', title: '插入表格', text: '表', label: '表格', big: true, demo: 'table', desc: '拖曳選擇欄數與列數，插入表格。也可以直接貼上 Excel 的範圍。', onClick: (e, b) => this.openTablePopup(b), ...NO_CODE });
    let g = G.illustrations;
    this.button(g, { icon: 'image', title: '插入圖片', text: '圖', label: '圖片', big: true, demo: 'image', desc: '插入保管庫裡的圖片、電腦上的圖片或網路圖片。', onClick: (e, b) => this.d.image(b), ...NO_CODE });
    this.button(g, { icon: 'sigma', title: '插入方程式', text: '∑', label: '方程式', big: true, demo: 'equation', desc: '用方程式編輯器輸入數學式，即時預覽。', onClick: () => this.d.equation(), ...NO_CODE });
    this.button(g, { icon: 'workflow', title: '插入圖表（Mermaid）', text: '圖表', label: '圖表', big: true, demo: 'mermaid', desc: '插入流程圖、循序圖、甘特圖等圖表。流程圖可以用表單編輯步驟與連線，右邊即時預覽。', onClick: () => this.d.mermaid(), ...NO_CODE });
    this.button(g, { icon: 'omega', title: '插入符號', text: 'Ω', label: '符號', big: true, demo: 'symbol', desc: '插入中文標點、箭頭、希臘字母、單位等符號。', onClick: (e, b) => this.openSymbolPopup(b) });
    g = G.links;
    this.button(g, { icon: 'link', title: '超連結', keys: 'Mod+K', text: '連', label: '連結', big: true, demo: 'link', desc: '把文字連到網址或保管庫裡的筆記。', onClick: () => this.d.link(), ...NO_CODE });
    this.button(g, { icon: 'file-symlink', title: '連結到筆記', text: '[[', label: '筆記', big: true, demo: 'notelink', desc: '搜尋並插入另一份筆記的連結。', onClick: () => this.d.noteLink(), ...NO_CODE });
    this.button(g, { icon: 'asterisk', title: '插入註腳', text: '註', label: '註腳', big: true, demo: 'footnote', desc: '在游標處加上註腳編號，內容放在文件最後。滑鼠移到編號上可以看內容。', onClick: () => this.d.footnote(), ...NO_CODE });
    g = G.code;
    this.button(g, { icon: 'code', title: '行內程式碼', keys: 'Mod+`', text: '</>', label: '行內', big: true, demo: 'code', desc: '把文字標成程式碼（等寬字型）。', cmd: C.toggleCode, active: s => C.markActive(s, M.code), ...NO_CODE });
    // 選單的 label 多半是不翻譯的語言名稱；只有 lang 是空字串時才是介面文字「純文字」，型別分不出來所以轉型
    this.menuButton(g, { icon: 'square-code', title: '插入程式碼區塊', text: '{ }', label: '程式碼區塊', big: true, demo: 'codeblock', desc: '插入一段程式碼，可以選語言，會自動上色。' },
      () => C.CODE_LANGUAGES.map(([lang, label]) => ({ title: lang ? label : t(label as I18nKey), run: () => this.run(C.insertCodeBlock(lang)) })));
    this.button(g, { icon: 'keyboard', title: '鍵盤按鍵', text: '⌨', label: '按鍵', big: true, demo: 'kbd', desc: '把文字標成鍵盤按鍵的樣子，例如 Ctrl。', cmd: C.toggleKbd, active: s => C.markActive(s, M.kbd), ...NO_CODE });
    g = G.text;
    this.button(g, { icon: 'info', title: '插入提示框', text: '框', label: '提示框', big: true, demo: 'callout', desc: '插入有圖示與標題的提示框（Obsidian callout），例如注意、提示、範例。', onClick: (e, b) => this.d.callout(b), ...NO_CODE });
    this.button(g, { icon: 'message-square', title: '插入註解', text: '註', label: '註解', big: true, demo: 'comment', desc: '加一段只有編輯時看得到的註解，閱讀模式不會顯示。', onClick: () => this.d.comment(), ...NO_CODE });
    this.menuButton(g, { icon: 'calendar-clock', title: '插入日期與時間', text: '日', label: '日期', big: true, demo: 'date', desc: '插入今天的日期或現在的時間。' },
      () => DATE_FORMATS.map(f => ({ title: this.ctx.formatDate(f), run: () => this.run(C.insertText(this.ctx.formatDate(f))) })));
    this.button(g, { icon: 'minus', title: '水平線', text: '—', label: '分隔線', big: true, demo: 'hr', desc: '插入一條橫線分隔內容。', cmd: C.insertHr, ...NO_CODE });
    g = G.obsidian;
    if (this.d.template) this.button(g, { icon: 'layout-template', title: '套用範本', text: '範', label: '範本', big: true, demo: 'template', desc: '用 Templater 範本在游標處插入內容。', onClick: () => this.d.template!(), ...NO_CODE });
    this.button(g, { icon: 'list-plus', title: '文件屬性', text: '屬', label: '屬性', big: true, demo: 'properties', desc: '編輯筆記最上方的屬性（標籤、日期等 metadata）。', onClick: () => this.d.properties() });
  }

  // ----------------------------------------------------------- 校閱
  buildReview(G: GroupBodies): void {
    let g = G.proofing;
    this.button(g, { icon: 'search', title: '尋找', keys: 'Mod+F', text: '找', label: '尋找', big: true, demo: 'find', desc: '在這份筆記裡尋找文字。再按一次關閉。', onClick: () => this.d.find(), active: () => this.isFindOpen() && !this.ctx.findState!().replace });
    this.button(g, { icon: 'replace', title: '取代', keys: 'Mod+H', text: '換', label: '取代', big: true, demo: 'replace', desc: '把找到的文字換成別的文字。再按一次關閉。', onClick: () => this.d.replace(), active: () => this.isFindOpen() && this.ctx.findState!().replace });
    this.button(g, { icon: 'sparkles', title: '清理符號', text: '淨', label: '清理符號', big: true, demo: 'cleanup', desc: '找出看不見的字元、亂碼、殘留的 ** 與落單的引號，勾選後一次清除。', onClick: () => this.d.cleanup() });
    this.button(g, { icon: 'pilcrow', title: '顯示／隱藏編輯標記', text: '¶', label: '編輯標記', big: true, demo: 'marks', desc: '顯示空白、換行與段落結尾，也會標出奇怪的符號。', onClick: () => this.d.toggleMarks(), active: s => marksOn(s) });
    this.button(G.stats, { icon: 'bar-chart-3', title: '字數統計', text: '數', label: '字數', big: true, demo: 'wordcount', desc: '顯示字數、字元數、段落數與預估閱讀時間；有選取時也會算選取範圍。', onClick: () => this.d.wordCount() });
    this.button(G.comments, { icon: 'message-square-plus', title: '插入註解', text: '註', label: '新增註解', big: true, demo: 'comment', desc: '加一段只有編輯時看得到的註解，閱讀模式不會顯示。', onClick: () => this.d.comment(), ...NO_CODE });
  }

  // ----------------------------------------------------------- 檢視
  buildView(G: GroupBodies): void {
    let g = G.views;
    this.button(g, { icon: 'file-text', title: 'Word 模式（目前）', text: 'W', label: 'Word 模式', big: true, cls: 'is-active' });
    this.button(g, { icon: 'code-2', title: '切換到 Markdown 編輯', keys: 'Mod+E', text: 'MD', label: 'Markdown', big: true, demo: 'markdown', desc: '用 Obsidian 原本的 Markdown 編輯這份筆記。', onClick: () => this.d.markdown() });
    this.button(g, { icon: 'book-open', title: '閱讀模式', text: '讀', label: '閱讀', big: true, demo: 'reading', desc: '用 Obsidian 的閱讀模式檢視（不能編輯）。', onClick: () => this.d.reading() });
    g = G.show;
    this.button(g, { icon: 'pilcrow', title: '顯示／隱藏編輯標記', text: '¶', label: '編輯標記', big: true, demo: 'marks', desc: '顯示空白、換行與段落結尾，也會標出奇怪的符號。', onClick: () => this.d.toggleMarks(), active: s => marksOn(s) });
    this.button(g, { icon: 'list-tree', title: '大綱', text: '綱', label: '大綱', big: true, demo: 'outline', desc: '在筆記旁另外展開大綱欄，點標題可以跳過去。再按一次關閉。', onClick: (e, b) => this.d.outline(b), active: () => !!(this.ctx.outlineOpen && this.ctx.outlineOpen()) });
    this.button(g, { icon: 'chevrons-down-up', title: '摺疊全部標題', text: '收', label: '全部摺疊', big: true, demo: 'fold', desc: '把所有標題下的內容收起來，只看標題。', onClick: () => this.d.foldAll(true) });
    this.button(g, { icon: 'chevrons-up-down', title: '展開全部標題', text: '展', label: '全部展開', big: true, demo: 'unfold', desc: '展開所有收起來的標題。', onClick: () => this.d.foldAll(false) });
    this.fullBtn = this.button(g, { icon: 'move-horizontal', title: '全寬頁面', text: '寬', label: '全寬', big: true, demo: 'fullwidth', desc: '頁面使用整個視窗寬度；關閉時是 A4 紙張寬度。', onClick: () => this.d.toggleFullWidth(), active: () => !!(this.ctx.isFullWidth && this.ctx.isFullWidth()) });
    g = G.zoom;
    this.button(g, { icon: 'zoom-out', title: '縮小', text: '－', demo: 'zoom', desc: '縮小頁面（也可以按住 Ctrl 滾動滑鼠滾輪）。', onClick: () => this.d.zoom(-10) });
    this.button(g, { icon: 'zoom-in', title: '放大', text: '＋', demo: 'zoom', desc: '放大頁面（也可以按住 Ctrl 滾動滑鼠滾輪）。', onClick: () => this.d.zoom(10) });
    this.button(g, { icon: 'scan', title: '恢復 100%', text: '100%', label: '100%', big: true, onClick: () => this.d.zoom(0) });
    g = G.help;
    this.button(g, { icon: 'keyboard', title: '快速鍵說明', keys: 'Mod+/', text: '?', label: '快速鍵', big: true, onClick: () => this.d.shortcuts() });
    this.button(g, { icon: 'settings', title: 'Word 模式設定', text: '設', label: '設定', big: true, onClick: () => this.d.settings() });
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
          const reasonText = r ? t(r) : null;
          if (reasonText !== it.reasonText) { it.reasonText = reasonText; this.setTip(it.dom, it); }
        }
      }
    }
    if (this.styleBtn) {
      const style = C.currentBlockStyle(state);
      const st = C.BLOCK_STYLES.find(x => x.id === style);
      const txt = this.styleBtn.querySelector('.wm-btn-text');
      if (txt && st) txt.textContent = t(st.label);
    }
    this.tableGroup.classList.toggle('is-hidden', !C.table.isIn(state));
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
    // 放在按鈕下方；超出畫面時改放上方或往左移（手機的工具列在畫面下方）
    const r = owner.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
    const w = p.offsetWidth || 200; const h = p.offsetHeight || 200;
    p.style.left = Math.max(4, Math.min(r.left, vw - w - 4)) + 'px';
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
        item.style.paddingLeft = (8 + (h.level - min) * 14) + 'px';
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
            this.closePopup(); this.run(C.insertTable(r, c));
          });
        }
      }
    });
  }
}
