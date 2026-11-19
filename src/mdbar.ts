// Markdown 編輯與閱讀模式上方的工具列（設定「切換到 Markdown／閱讀模式時保留工具列」）
// 編輯模式用 Obsidian 編輯器的指令；閱讀模式只能檢視，編輯按鈕會停用並說明原因。
// 版面跟 Word 模式的功能區一樣（同樣的分頁、群組、按鈕大小與位置），切換模式時畫面不會跳動
import { MarkdownView, setIcon, Menu, Platform, parseYaml } from 'obsidian';
import { t, key } from './i18n.js';
import { attachHint, hideHint } from './hints.js';
import type { DemoName } from './hints.js';
import { CODE_LANGUAGES } from './commands.js';
import { el } from './dom.js';
import { frontmatterOf, peekData } from './props.js';
import { openPropsPeek, closePropsPeek, propertyWidget } from './propview.js';
import { TABS, TAB_ICONS, tabName, fillTab, groupLayout } from './toolbar.js';
import type { TabId, GroupId, TabStyle, RibbonLayout, ButtonStyle } from './toolbar.js';
import type { App, Editor, MarkdownViewModeType } from 'obsidian';
import type WordModePlugin from './main.js';
import type { I18nKey } from './i18n.js';

// 工具列按鈕的設定（button() 的 spec）：title、label、desc 是還沒翻譯的文字；keys 是快速鍵（例如 'Mod+B'）；
// always 表示閱讀模式也能用；active() 回傳 true 時按鈕顯示成按下的樣子
interface MdButtonSpec {
  icon: string;
  title: I18nKey;
  keys?: string | null;
  label?: I18nKey;
  desc?: I18nKey;
  demo?: DemoName;
  big?: boolean;
  // 檢視模式的按鈕：設定可以讓這三個只顯示圖示（跟 toolbar.ts 相同）
  viewMode?: boolean;
  always?: boolean;
  active?: () => boolean;
  run: (e: MouseEvent, b: HTMLButtonElement) => void;
}

// 已建立的按鈕；reason 是停用的原因（閱讀模式），給詳細提示顯示
interface MdButtonItem { dom: HTMLButtonElement; spec: MdButtonSpec; title: string; reason?: string | null; }

// 下拉選單的一項（標題已翻譯）
interface MdMenuItem { title: string; icon?: string; run: () => void; }

// 在選取文字前後加上（或拿掉）符號
function wrap(editor: Editor, open: string, close: string = open): void {
  const sel = editor.getSelection();
  const from = editor.getCursor('from'); const to = editor.getCursor('to');
  const before = editor.getRange({ line: from.line, ch: Math.max(0, from.ch - open.length) }, from);
  const after = editor.getRange(to, { line: to.line, ch: to.ch + close.length });
  if (before === open && after === close) {
    editor.replaceRange('', to, { line: to.line, ch: to.ch + close.length });
    editor.replaceRange('', { line: from.line, ch: from.ch - open.length }, from);
    editor.setSelection({ line: from.line, ch: from.ch - open.length }, { line: to.line, ch: to.ch - (from.line === to.line ? open.length : 0) });
    return;
  }
  if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
    editor.replaceSelection(sel.slice(open.length, sel.length - close.length));
    return;
  }
  editor.replaceSelection(open + sel + close);
  if (!sel) editor.setCursor({ line: from.line, ch: from.ch + open.length });
}

// 目前這行（或選取的每一行）的開頭改成 prefix
function linePrefix(editor: Editor, re: RegExp, prefix: string): void {
  const a = editor.getCursor('from').line; const b = editor.getCursor('to').line;
  for (let l = a; l <= b; l++) {
    const text = editor.getLine(l);
    const next = text.replace(re, '');
    editor.setLine(l, prefix + next);
  }
}

const HEAD_RE = /^#{1,6}\s+/;

// 設定「Markdown／閱讀模式的工具列」：兩種模式都顯示、只在 Markdown 編輯顯示、只在閱讀模式顯示、都隱藏
export type MdToolbarMode = 'both' | 'source' | 'preview' | 'none';

// 把設定檔裡的值換成上面四種之一。1.9.0 以前這個設定是開關：true＝都顯示、false＝都隱藏；
// 其他不認得的值（沒設定過、手改的）當成預設的「都顯示」
export function mdToolbarMode(value: unknown): MdToolbarMode {
  if (value === false) return 'none';
  return value === 'source' || value === 'preview' || value === 'none' ? value : 'both';
}

// 這個檢視目前的模式（viewMode：MarkdownView.getMode() 的結果）要不要顯示工具列
export function wantsMdBar(value: unknown, viewMode: string | null | undefined): boolean {
  const mode = mdToolbarMode(value);
  if (mode === 'both' || mode === 'none') return mode === 'both';
  return mode === (viewMode === 'preview' ? 'preview' : 'source');
}

export class MarkdownBar {
  declare plugin: WordModePlugin;
  declare view: MarkdownView;
  declare app: App;
  declare layout: RibbonLayout;
  declare buttonStyle: ButtonStyle;
  declare hideViewLabels: boolean;
  declare tabStyle: TabStyle;
  declare richHints: boolean;
  declare hidden: Set<string>;
  declare hiddenTabs: Set<string>;
  declare dom: HTMLDivElement;
  declare items: MdButtonItem[];
  declare mode: MarkdownViewModeType | null;
  declare panels: Partial<Record<TabId, HTMLDivElement>>;
  declare tabBtns: Partial<Record<TabId, HTMLButtonElement>>;
  declare tabNames: Partial<Record<TabId, string>>;
  declare tabSwitch: HTMLButtonElement | null;
  declare seen: Set<string>;
  // 跟著工具列高度更新 --wm-mdbar-height；環境沒有 ResizeObserver 時是 null
  declare sizer: ResizeObserver | null;

  constructor(plugin: WordModePlugin, view: MarkdownView) {
    this.plugin = plugin;
    this.view = view;
    this.app = plugin.app;
    const S = plugin.settings;
    this.layout = S.ribbonLayout || 'tabs';
    this.buttonStyle = S.buttonStyle || 'auto';
    this.hideViewLabels = S.viewButtonLabels === false;
    this.tabStyle = S.tabStyle || 'text';
    this.richHints = !!S.richHints && !Platform.isMobile;
    this.hidden = new Set(S.hiddenGroups || []);
    this.hiddenTabs = new Set(S.hiddenTabs || []);
    this.dom = el('div', 'wm-ribbon wm-mdbar wm-layout-' + this.layout + ' wm-btnstyle-' + this.buttonStyle + ' wm-tabstyle-' + this.tabStyle
      + (S.groupLabels ? ' wm-group-labels' : '') + (Platform.isMobile ? ' wm-mobile' : ''));
    view.containerEl.insertBefore(this.dom, view.contentEl);
    this.items = [];
    this.mode = null;
    this.render();
    // 其他外掛會假設「標題列正下方就是筆記內容」，用 top: var(--header-height) 把自己的東西貼在那裡
    // （Pretty Properties 的 BANNER／COVER／ICON 按鈕列），結果疊在這條工具列的分頁上。
    // 把工具列的高度記在 containerEl 的 --wm-mdbar-height，樣式表用它把那些東西往下移。
    // 高度會隨分頁、換行、視窗寬度改變，所以用 ResizeObserver 跟著更新；沒有 ResizeObserver 的環境只設一次
    this.syncHeight();
    this.sizer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.syncHeight());
    if (this.sizer) this.sizer.observe(this.dom);
  }

  syncHeight(): void { this.view.containerEl.style.setProperty('--wm-mdbar-height', this.dom.offsetHeight + 'px'); }

  destroy(): void {
    hideHint();
    closePropsPeek();
    if (this.sizer) this.sizer.disconnect();
    this.view.containerEl.style.removeProperty('--wm-mdbar-height');
    this.dom.remove();
  }

  get editor(): Editor { return this.view.editor; }
  isReading(): boolean { return this.view.getMode && this.view.getMode() === 'preview'; }

  cmd(id: string): () => boolean { return () => { const commands = this.app.commands; return commands ? commands.executeCommandById(id) : false; }; }

  render(): void {
    this.dom.replaceChildren();
    this.items = [];
    this.seen = new Set();
    this.panels = {}; this.tabBtns = {}; this.tabNames = {}; this.tabSwitch = null;
    this.mode = this.isReading() ? 'preview' : 'source';
    const S = this.plugin.settings;
    const tabs = this.layout === 'tabs';
    const menuTabs = tabs && this.tabStyle === 'menu';
    const icon = (target: HTMLElement, name: string, fallback: string) => { setIcon(target, name); if (!target.querySelector('svg') && fallback) target.setText(fallback); };
    const tabsEl = el('div', 'wm-tabs', this.dom);
    const bar = el('div', 'wm-toolbar', this.dom);
    bar.setAttribute('role', 'toolbar');
    let all: HTMLDivElement | null = null;
    if (tabs) {
      if (menuTabs) {
        const sw = el('button', 'wm-tab-switch', bar);
        sw.type = 'button';
        el('span', 'wm-tab-switch-label', sw);
        icon(el('span', 'wm-tab-switch-arrow', sw), 'chevron-down', '▾');
        sw.addEventListener('mousedown', e => e.preventDefault());
        sw.addEventListener('click', () => this.menu(sw, TABS.filter(([id]) => this.tabNames[id] != null)
          .map(([id]) => ({ title: this.tabNames[id]!, icon: TAB_ICONS[id], run: () => this.showTab(id) }))));
        this.tabSwitch = sw;
      }
      for (const [id, label] of TABS) {
        if (this.hiddenTabs.has(id)) continue;
        this.panels[id] = el('div', 'wm-panel', bar);
        const name = tabName(id, label, S.tabLabels);
        this.tabNames[id] = name;
        if (menuTabs) continue;
        const b = el('button', 'wm-tab', tabsEl);
        b.type = 'button';
        fillTab(b, id, name, this.tabStyle, icon);
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => this.showTab(id));
        this.tabBtns[id] = b;
      }
    } else all = el('div', 'wm-panel', bar);
    // 群組的名稱、順序與所在分頁跟 Word 模式相同（同一份 groupLayout，包含使用者自訂的部分）
    const G: Partial<Record<GroupId, HTMLDivElement | null>> = {};
    for (const { id, tab, name } of groupLayout(S)) {
      const panel = tabs ? this.panels[tab] : all;
      if (!panel || this.hidden.has(id) || this.hiddenTabs.has(tab)) { G[id] = null; continue; }
      const g = el('div', 'wm-group wm-group-' + id, panel);
      G[id] = el('div', 'wm-group-body', g);
      el('div', 'wm-group-name', g, name);
    }
    const E = (fn: (ed: Editor) => void) => () => { const ed = this.editor; if (ed) { fn(ed); ed.focus(); } };
    const toWord: MdButtonSpec = { icon: 'file-text', title: '切換到 Word 模式', keys: S.ctrlE !== false ? 'Mod+E' : null, label: 'Word 模式', big: true, viewMode: true, demo: 'word', desc: '像 Word 一樣直接看到格式來編輯，存檔仍是純 Markdown。', run: () => { void this.plugin.switchToWord(this.view.leaf); }, always: true };

    // ---- 常用
    let g = G.undo;
    this.button(g, { icon: 'undo-2', title: '復原', keys: 'Mod+Z', run: E(ed => ed.undo()) });
    this.button(g, { icon: 'redo-2', title: '取消復原', keys: 'Mod+Y', run: E(ed => ed.redo()) });

    g = G.styles;
    this.button(g, { icon: 'heading', title: '段落樣式', demo: 'style', desc: '把這一行改成標題 1～6 或內文。', run: (e, b) => this.headingMenu(b) });

    g = G.font;
    this.button(g, { icon: 'bold', title: '粗體', keys: 'Mod+B', demo: 'bold', run: E(ed => wrap(ed, '**')) });
    this.button(g, { icon: 'italic', title: '斜體', keys: 'Mod+I', demo: 'italic', run: E(ed => wrap(ed, '*')) });
    this.button(g, { icon: 'underline', title: '底線', demo: 'underline', run: E(ed => wrap(ed, '<u>', '</u>')) });
    this.button(g, { icon: 'strikethrough', title: '刪除線', demo: 'strike', run: E(ed => wrap(ed, '~~')) });
    this.button(g, { icon: 'superscript', title: '上標', demo: 'sup', run: E(ed => wrap(ed, '<sup>', '</sup>')) });
    this.button(g, { icon: 'subscript', title: '下標', demo: 'sub', run: E(ed => wrap(ed, '<sub>', '</sub>')) });
    this.button(g, { icon: 'highlighter', title: '醒目提示', demo: 'highlight', run: E(ed => wrap(ed, '==')) });

    g = G.paragraph;
    this.button(g, { icon: 'list', title: '項目符號', demo: 'bullet', run: this.cmd('editor:toggle-bullet-list') });
    this.button(g, { icon: 'list-ordered', title: '編號', demo: 'ordered', run: this.cmd('editor:toggle-numbered-list') });
    this.button(g, { icon: 'list-checks', title: '核取清單', demo: 'task', run: this.cmd('editor:toggle-checklist-status') });
    this.button(g, { icon: 'indent-decrease', title: '減少縮排', demo: 'outdent', run: this.cmd('editor:unindent-list') });
    this.button(g, { icon: 'indent-increase', title: '增加縮排', demo: 'indent', run: this.cmd('editor:indent-list') });
    this.button(g, { icon: 'quote', title: '引文', demo: 'quote', run: this.cmd('editor:toggle-blockquote') });

    g = G.editing;
    this.button(g, { icon: 'search', title: '尋找', keys: 'Mod+F', demo: 'find', run: this.cmd('editor:open-search'), always: true });
    this.button(g, { icon: 'replace', title: '取代', keys: 'Mod+H', demo: 'replace', run: this.cmd('editor:open-search-replace') });

    // ---- 插入
    this.button(G.tables, { icon: 'table', title: '插入表格', label: '表格', big: true, demo: 'table', run: this.cmd('editor:insert-table') });
    this.button(G.illustrations, { icon: 'sigma', title: '插入方程式', label: '方程式', big: true, demo: 'equation', run: E(ed => { const sel = ed.getSelection(); ed.replaceSelection('$' + (sel || 'x^2') + '$'); }) });
    g = G.links;
    this.button(g, { icon: 'link', title: '超連結', label: '連結', big: true, demo: 'link', run: this.cmd('editor:insert-link') });
    this.button(g, { icon: 'file-symlink', title: '連結到筆記', label: '筆記', big: true, demo: 'notelink', run: this.cmd('editor:insert-wikilink') });
    g = G.code;
    this.button(g, { icon: 'code', title: '行內程式碼', label: '行內', big: true, demo: 'code', run: E(ed => wrap(ed, '`')) });
    this.button(g, { icon: 'square-code', title: '插入程式碼區塊', label: '程式碼區塊', big: true, demo: 'codeblock', run: (e, b) => this.codeMenu(b) });
    g = G.text;
    this.button(g, { icon: 'info', title: '插入提示框', label: '提示框', big: true, demo: 'callout', run: this.cmd('editor:insert-callout') });
    this.button(g, { icon: 'message-square', title: '插入註解', label: '註解', big: true, demo: 'comment', run: this.cmd('editor:toggle-comments') });
    this.button(g, { icon: 'minus', title: '水平線', label: '分隔線', big: true, demo: 'hr', run: E(ed => { const c = ed.getCursor(); ed.replaceRange('\n---\n', { line: c.line, ch: ed.getLine(c.line).length }); }) });

    // ---- 校閱
    g = G.proofing;
    this.button(g, { icon: 'search', title: '尋找', keys: 'Mod+F', label: '尋找', big: true, demo: 'find', run: this.cmd('editor:open-search'), always: true });
    this.button(g, { icon: 'replace', title: '取代', keys: 'Mod+H', label: '取代', big: true, demo: 'replace', run: this.cmd('editor:open-search-replace') });

    // ---- 檢視：前三個按鈕的位置、大小跟 Word 模式的「檢視」分頁一樣
    g = G.views;
    this.button(g, toWord);
    this.button(g, { icon: 'code-2', title: 'Markdown 編輯', label: 'Markdown', big: true, viewMode: true, demo: 'markdown', desc: '用 Obsidian 原本的 Markdown 編輯這份筆記。', active: () => this.mode === 'source', run: () => { void this.setMode('source'); }, always: true });
    this.button(g, { icon: 'book-open', title: '閱讀模式', label: '閱讀', big: true, viewMode: true, demo: 'reading', desc: '用 Obsidian 的閱讀模式檢視（不能編輯）。', active: () => this.mode === 'preview', run: () => { void this.setMode('preview'); }, always: true });
    g = G.show;
    this.button(g, { icon: 'list-tree', title: '大綱', label: '大綱', big: true, demo: 'outline', run: () => { void this.plugin.toggleOutline(); }, active: () => this.plugin.outlineOpen(), always: true });
    this.button(g, { icon: 'clipboard-list', title: '查看文件屬性', label: '屬性', big: true, demo: 'properties', desc: '不用捲到最上方，直接看這份筆記的屬性（標籤、日期等）。屬性很多時可以篩選。', run: (e, b) => openMarkdownPeek(this.plugin, this.view, b), always: true });
    this.button(g, { icon: 'chevrons-down-up', title: '摺疊全部標題', label: '全部摺疊', big: true, demo: 'fold', run: this.cmd('editor:fold-all') });
    this.button(g, { icon: 'chevrons-up-down', title: '展開全部標題', label: '全部展開', big: true, demo: 'unfold', run: this.cmd('editor:unfold-all') });
    this.button(G.help, { icon: 'settings', title: 'Word 模式設定', label: '設定', big: true, run: () => this.plugin.openSettings(), always: true });

    for (const x of bar.querySelectorAll('.wm-group')) if (!x.querySelector('.wm-btn')) x.remove();
    for (const [id] of TABS) {
      const panel = this.panels[id];
      if (panel && !panel.querySelector('.wm-btn')) { panel.remove(); delete this.panels[id]; delete this.tabNames[id]; if (this.tabBtns[id]) { this.tabBtns[id].remove(); delete this.tabBtns[id]; } }
    }
    // 右邊固定的快速按鈕（位置跟 Word 模式一樣）：尋找、切回 Word 模式
    const quickHost = !tabs ? all! : menuTabs ? bar : tabsEl;
    if (tabs && !menuTabs) el('div', 'wm-tabs-spacer', tabsEl);
    const quick = el('div', 'wm-tabs-quick', quickHost);
    this.seen = new Set();
    this.button(quick, { icon: 'search', title: '尋找', keys: 'Mod+F', demo: 'find', run: this.cmd('editor:open-search'), always: true });
    this.button(quick, Object.assign({}, toWord, { big: false, label: undefined }));
    tabsEl.classList.toggle('is-hidden', !tabs || menuTabs);
    if (tabs) {
      const want = this.plugin.lastTab;
      const first = TABS.find(([id]) => this.panels[id]);
      this.showTab(want && this.panels[want] ? want : first ? first[0] : 'home', true);
    }
    this.update();
  }

  // 切換分頁；跟 Word 模式共用「上次的分頁」，切換模式後停在同一個分頁
  showTab(id: TabId, initial?: boolean): void {
    for (const [k, panel] of Object.entries(this.panels)) panel.classList.toggle('is-hidden', k !== id);
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('is-active', k === id);
    if (this.tabSwitch) {
      const name = this.tabNames[id] || '';
      const label = this.tabSwitch.querySelector<HTMLElement>('.wm-tab-switch-label');
      if (label) fillTab(label, id, name, 'both', (target, icon) => setIcon(target, icon));
      this.tabSwitch.setAttribute('aria-label', t('切換分頁') + t('：') + name);
    }
    if (!initial) this.plugin.lastTab = id;
  }

  button(parent: HTMLElement | null | undefined, spec: MdButtonSpec): HTMLButtonElement | null {
    if (!parent) return null;
    const title = spec.keys ? t(spec.title) + ' (' + key(spec.keys) + ')' : t(spec.title);
    if (this.layout !== 'tabs') {
      if (this.seen.has(spec.title)) return null;
      this.seen.add(spec.title);
    }
    const showLabel = (this.buttonStyle === 'label' || (this.buttonStyle === 'auto' && spec.big)) && !(spec.viewMode && this.hideViewLabels);
    const b = el('button', 'wm-btn' + (showLabel && spec.label ? ' has-label' : ''), parent);
    b.type = 'button';
    el('span', 'wm-sr', b);
    const i = el('span', 'wm-btn-icon', b);
    setIcon(i, spec.icon);
    if (showLabel && spec.label) el('span', 'wm-btn-label', b, t(spec.label));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); hideHint(); if (b.classList.contains('is-disabled')) return; spec.run(e, b); window.setTimeout(() => this.update(), 50); });
    const it: MdButtonItem = { dom: b, spec, title };
    this.items.push(it);
    if (this.richHints) {
      b.querySelector('.wm-sr')!.textContent = title;
      attachHint(b, () => ({ title: t(spec.title), keys: spec.keys ? key(spec.keys) : null, desc: spec.desc ? t(spec.desc) : null, demo: spec.demo, reason: it.reason }));
    } else b.setAttribute('aria-label', title);
    return b;
  }

  update(): void {
    const reading = this.isReading();
    this.mode = reading ? 'preview' : 'source';
    for (const it of this.items) {
      const off = reading && !it.spec.always;
      it.dom.classList.toggle('is-disabled', off);
      it.reason = off ? t('閱讀模式不能編輯：按「Markdown」或「Word 模式」再編輯') : null;
      if (!this.richHints) it.dom.setAttribute('aria-label', off ? it.title + '\n' + it.reason : it.title);
      if (it.spec.active) it.dom.classList.toggle('is-active', !!it.spec.active());
    }
  }

  async setMode(mode: MarkdownViewModeType): Promise<void> {
    const st = this.view.getState() as Record<string, unknown>;
    st.mode = mode;
    if (mode === 'source') st.source = false;
    await this.view.setState(st, { history: false });
    // 設定成只在其中一種模式顯示時，切換模式後這條工具列可能要收起來（或另一個檢視的要出現）。
    // 不等 Obsidian 的 layout-change：直接用 setState 切換模式不一定會觸發它
    this.plugin.syncMdBars();
    if (!this.dom.isConnected) return;
    this.update();
    if (mode === 'source' && this.editor) this.editor.focus();
  }

  menu(owner: HTMLElement, items: MdMenuItem[]): void {
    const m = new Menu();
    for (const it of items) m.addItem(i => { i.setTitle(it.title).onClick(it.run); if (it.icon) i.setIcon(it.icon); });
    const r = owner.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  headingMenu(owner: HTMLElement): void {
    const ed = this.editor;
    if (!ed) return;
    const items: MdMenuItem[] = [{ title: t('內文'), run: () => { linePrefix(ed, HEAD_RE, ''); ed.focus(); } }];
    // 字串相加的型別只是 string；i 是 1～6，所以是「標題 1」～「標題 6」這六個鍵
    for (let i = 1; i <= 6; i++) items.push({ title: t(('標題 ' + i) as `標題 ${1 | 2 | 3 | 4 | 5 | 6}`), run: () => { linePrefix(ed, HEAD_RE, '#'.repeat(i) + ' '); ed.focus(); } });
    this.menu(owner, items);
  }

  codeMenu(owner: HTMLElement): void {
    const ed = this.editor;
    if (!ed) return;
    // label 多半是不翻譯的語言名稱；只有 lang 是空字串時才是介面文字「純文字」，型別分不出來所以轉型
    this.menu(owner, CODE_LANGUAGES.map(([lang, label]) => ({
      title: lang ? label : t(label as I18nKey),
      run: () => {
        const sel = ed.getSelection();
        const c = ed.getCursor('from');
        ed.replaceSelection('```' + lang + '\n' + sel + (sel.endsWith('\n') || !sel ? '' : '\n') + '```\n');
        if (!sel) ed.setCursor({ line: c.line + 1, ch: 0 });
        ed.focus();
      },
    })));
  }
}

export function isMarkdownView(v: unknown): v is MarkdownView { return v instanceof MarkdownView; }

// 「查看文件屬性」小視窗（功能區與狀態列的按鈕）：讀這份筆記的原文，所以還沒存檔的修改也看得到
export function openMarkdownPeek(plugin: WordModePlugin, view: MarkdownView, btn: HTMLElement): void {
  let text = '';
  try { text = view.getViewData(); } catch { /* 檢視還沒載入完成 */ }
  const data = peekData(frontmatterOf(text), yaml => parseYaml(yaml) as unknown);
  const reading = view.getMode && view.getMode() === 'preview';
  // 有屬性：捲到最上方（Obsidian 把屬性顯示在那裡）；沒有屬性：編輯模式才能新增
  const go = data.kind !== 'none' ? () => { try { view.currentMode.applyScroll(0); } catch { /* 沒有捲動的方法 */ } }
    : reading ? null : () => addMarkdownProperty(plugin, view);
  openPropsPeek(btn, data, {
    icon: (target, name, fallback) => { setIcon(target, name); if (!target.querySelector('svg') && fallback) target.setText(fallback); },
    typeHint: k => propertyWidget(plugin.app, k), go, isMobile: !!Platform.isMobile,
  });
}

// 在 Markdown 編輯模式新增文件屬性：用 Obsidian 的「新增檔案屬性」指令；沒有這個指令時直接在最前面加上 ---
function addMarkdownProperty(plugin: WordModePlugin, view: MarkdownView): void {
  const commands = plugin.app.commands;
  if (commands && commands.executeCommandById('markdown:add-metadata-property')) return;
  const ed = view.editor;
  if (!ed) return;
  ed.replaceRange('---\n\n---\n', { line: 0, ch: 0 });
  ed.setCursor({ line: 1, ch: 0 });
  ed.focus();
}
