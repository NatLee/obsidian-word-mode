// Markdown 編輯與閱讀模式上方的工具列（設定「切換到 Markdown／閱讀模式時保留工具列」）
// 編輯模式用 Obsidian 編輯器的指令；閱讀模式只能檢視，編輯按鈕會停用並說明原因。
// 版面跟 Word 模式的功能區一樣（同樣的分頁、群組、按鈕大小與位置），切換模式時畫面不會跳動：
// 外殼與按鈕的外觀都來自 ribbon.ts，這裡只決定每個按鈕對 Markdown 編輯器做什麼
import { MarkdownView, Menu, Platform, parseYaml, stringifyYaml } from 'obsidian';
import { PromptModal } from './dialogs.js';
import type { PropsEdit } from './propview.js';
import type { NodeViewMenuItem, PropValues } from './nodeviews.js';
import { t } from './i18n.js';
import { hideHint } from './hints.js';
import { CODE_LANGUAGES } from './commands.js';
import { el } from './dom.js';
import { iconOr } from './icons.js';
import { frontmatterBody, frontmatterOf, peekData, wrapFrontmatter } from './props.js';
import { closePropsPeek, propertyWidget, showProps } from './propview.js';
import { ACTIONS as A, RibbonShell, ribbonClass } from './ribbon.js';
import type { ButtonClick, MenuItem, RibbonAction, RibbonButton, TabId } from './ribbon.js';
import type { App, Editor, EditorPosition, MarkdownViewModeType } from 'obsidian';
import { keyRowKeys } from './keyrow.js';
import { installTrackpad, padHold } from './trackpad.js';
import type { TrackpadHooks } from './trackpad.js';
import type { KeyMods, MoveKey } from './keyrow.js';
import { MdStatusBar, mdWordCount } from './statusbar.js';
import type WordModePlugin from './main.js';
import type { I18nKey } from './i18n.js';

// 一個按鈕在 Markdown／閱讀模式做什麼（長什麼樣子是 button() 的另一個參數，來自 ribbon.ts 的 ACTIONS）：
// always 表示閱讀模式也能用；active() 回傳 true 時按鈕顯示成按下的樣子
interface MdHandler {
  run: ButtonClick;
  active?: () => boolean;
  always?: boolean;
}

// 已建立的按鈕；reason 是停用的原因（閱讀模式），給詳細提示顯示
interface MdButtonItem extends RibbonButton { spec: MdHandler; }

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

// 插入水平線要放進去的文字（放在游標那一行的行尾）。line 是游標那一行，prevLine 是上一行（第一行時是 null）。
// 水平線前面一定要有空行：直接接在文字下面的 --- 會把那一行變成標題；
// 檔案最前面的 --- 會被當成文件屬性的開頭，所以那裡改用 ***
export function hrText(line: string, prevLine: string | null): string {
  if (line.trim()) return '\n\n---\n';
  if (prevLine == null) return '***\n';
  return prevLine.trim() ? '\n---\n' : '---\n';
}

// 插入程式碼區塊要放進去的文字（取代選取的內容）。before／after 是選取範圍那一行在選取之前、之後的文字。
// 圍欄要自己一行；沒有選取時中間留一個空行，cursorLine 是游標要放在「插入位置往下第幾行」（-1 表示不用移動）
export function codeBlockText(sel: string, lang: string, before: string, after: string): { text: string; cursorLine: number } {
  const head = before.trim() ? '\n' : '';
  const body = sel ? sel + (sel.endsWith('\n') ? '' : '\n') : '\n';
  const tail = after.trim() ? '\n' : '';
  return { text: head + '```' + lang + '\n' + body + '```' + tail, cursorLine: sel ? -1 : (head ? 2 : 1) };
}

export class MarkdownBar {
  declare plugin: WordModePlugin;
  declare view: MarkdownView;
  declare app: App;
  // 分頁列、面板、群組與按鈕的 DOM（跟 Word 模式的功能區共用同一套）
  declare shell: RibbonShell;
  declare dom: HTMLDivElement;
  declare items: MdButtonItem[];
  declare mode: MarkdownViewModeType | null;
  // 跟著工具列高度更新 --wm-mdbar-height；環境沒有 ResizeObserver 時是 null
  declare sizer: ResizeObserver | null;
  // 取消訂閱螢幕鍵盤的狀態；桌機沒有鍵盤偵測時是 null
  declare offKeyboard: (() => void) | null;
  // 手機的閱讀模式：只剩一列能用的按鈕（見 update）
  declare lite: boolean;
  // 手機：工具列下方的狀態列（跟 Word 模式同一個位置與內容）；外層加 wm-phone，Word 模式手機狀態列的樣式就一起套上。
  // 設定關掉、電腦、平板時是 null（電腦用 Obsidian 右下角的狀態列，main.ts 的 updateStatus）
  declare statusWrap: HTMLDivElement | null;
  declare status: MdStatusBar | null;
  declare statusKey: string;
  // 這個檢視的工具列在下方（控制鍵列放在它上面、狀態列放在它下面）
  declare bottom: boolean;
  // 剛在工具列上拖曳移動過游標（trackpad.ts）：放開時那一下點擊不開分頁選單
  declare padMoved: boolean;

  constructor(plugin: WordModePlugin, view: MarkdownView) {
    this.plugin = plugin;
    this.view = view;
    this.app = plugin.app;
    // 位置跟 Word 模式的功能區一樣（設定的「工具列位置」；自動時手機在下方）：切換編輯模式時工具列不會從下面跳到最上面
    const pos = plugin.settings.toolbarPosition || 'auto';
    const bottom = pos === 'bottom' || (pos === 'auto' && !!Platform.isPhone);
    this.bottom = bottom;
    this.statusWrap = null; this.status = null; this.statusKey = '';
    this.dom = el('div', 'wm-ribbon wm-mdbar ' + ribbonClass(plugin.settings) + (Platform.isMobile ? ' wm-mobile' : '') + (bottom ? ' wm-mdbar-bottom' : ''));
    view.containerEl.insertBefore(this.dom, bottom ? view.contentEl.nextSibling : view.contentEl);
    // 螢幕鍵盤開著時、手機上鍵盤收著時，跟 Word 模式一樣精簡成一列（樣式表的 wm-kb-compact，掛在這個檢視的外框上）
    this.offKeyboard = plugin.keyboard ? plugin.keyboard.subscribe(() => this.syncKeyboard()) : null;
    this.syncKeyboard();
    this.items = [];
    // 打字時讓給 Obsidian 自己的手機工具列（樣式表的 wm-yield-native；設定可以關）
    this.dom.toggleClass('wm-yield-native', plugin.settings.mdYieldNative !== false);
    this.mode = null;
    this.render();
    // 其他外掛會假設「標題列正下方就是筆記內容」，用 top: var(--header-height) 把自己的東西貼在那裡
    // （Pretty Properties 的 BANNER／COVER／ICON 按鈕列），結果疊在這條工具列的分頁上。
    // 把工具列的高度記在 containerEl 的 --wm-mdbar-height，樣式表用它把那些東西往下移。
    // 高度會隨分頁、換行、視窗寬度改變，所以用 ResizeObserver 跟著更新；沒有 ResizeObserver 的環境只設一次
    this.syncStatus();
    this.syncHeight();
    this.sizer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.syncHeight());
    if (this.sizer) this.sizer.observe(this.dom);
  }

  // 跟 Word 模式的 syncIdle 同一套：打字時看 compactOnKeyboard；手機上鍵盤收著時看 phoneIdle（short 只顯示鍵盤收著也
  // 用得到的那一列（buildIdle），hidden 整條藏起來）。閱讀模式不能打字，不管 phoneIdle（手機另有 wm-reading-lite）
  syncKeyboard(): void {
    const S = this.plugin.settings;
    const kb = this.plugin.keyboard;
    const open = !!kb && kb.open;
    const idle = Platform.isPhone && !open && !this.isReading() ? (S.phoneIdle || 'short') : 'full';
    const c = this.view.containerEl;
    c.toggleClass('wm-idle-short', idle === 'short');
    c.toggleClass('wm-idle-hidden', idle === 'hidden');
    c.toggleClass('wm-kb-compact', open && S.compactOnKeyboard !== false);
  }

  // 手機的狀態列：要有的時候放在檢視最下面（工具列在下方時就在工具列下面）；換了編輯／閱讀模式重建（按鈕不一樣）
  syncStatus(): void {
    const want = !!Platform.isPhone && this.plugin.settings.phoneStatus === 'bar' && this.plugin.settings.mdStatusBar !== false && !!this.view.file && /\.md$/i.test(this.view.file.path);
    if (!want) {
      if (this.statusWrap) { this.statusWrap.remove(); this.statusWrap = null; this.status = null; this.statusKey = ''; }
      this.dom.removeClass('has-status');
      return;
    }
    const key = this.view.file!.path + '|' + (this.isReading() ? 'preview' : 'source');
    if (this.statusWrap && this.status && key === this.statusKey) { this.status.update(); return; }
    if (!this.statusWrap) this.statusWrap = this.view.containerEl.createDiv('wm-phone wm-mdbar-status');
    this.statusWrap.empty();
    this.statusKey = key;
    this.status = new MdStatusBar(this.plugin, this.statusWrap.createDiv('wm-bottombar'), this.view, false);
    this.dom.addClass('has-status');
  }

  // 控制鍵（keyrow.ts）的方向鍵、Home、End（見 editorKeyMove）。閱讀模式不能編輯
  keyMove(key: MoveKey, mods: KeyMods): boolean {
    const ed = this.view.editor;
    if (!ed || this.isReading()) return false;
    return editorKeyMove(ed, key, mods);
  }

  // 工具列當觸控板（trackpad.ts）：跟 Word 模式一樣，分頁選單按鈕直接拖、整列按鈕按住一下再拖；用 Obsidian 編輯器的指令移動
  trackpad(shell: RibbonShell): void {
    const S = this.plugin.settings;
    let pos: ReturnType<typeof padPosition> | null = null;
    const hooks: TrackpadHooks = {
      focused: () => !this.isReading() && !!this.view.editor && this.view.editor.hasFocus(),
      speed: () => this.plugin.settings.padSpeed,
      moved: m => { this.padMoved = m; },
      skip: '.wm-tab-switch',
      // Markdown 模式沒有放大鏡：工具列上方顯示游標的位置與旁邊的字
      begin: () => { pos = padPosition(shell.bar, this.view.editor); },
      step: (nx, ny) => { editorStep(this.view.editor, nx, ny); if (pos) pos.update(); },
      end: () => { if (pos) { pos.remove(); pos = null; } },
    };
    if (shell.tabSwitch) installTrackpad(shell.tabSwitch, 0, hooks);
    if (S.padRow !== false) installTrackpad(shell.bar, () => padHold(this.plugin.settings.padHold), hooks);
  }

  syncHeight(): void { this.view.containerEl.style.setProperty('--wm-mdbar-height', this.dom.offsetHeight + 'px'); }

  destroy(): void {
    hideHint();
    closePropsPeek();
    if (this.sizer) this.sizer.disconnect();
    if (this.offKeyboard) this.offKeyboard();
    if (this.shell) this.shell.destroy();
    if (this.statusWrap) this.statusWrap.remove();
    this.view.containerEl.removeClass('wm-kb-compact', 'wm-idle-short', 'wm-idle-hidden');
    this.view.containerEl.style.removeProperty('--wm-mdbar-height');
    this.dom.remove();
  }

  get editor(): Editor { return this.view.editor; }
  // 外殼的面板與分頁按鈕，測試直接從工具列讀
  get panels(): RibbonShell['panels'] { return this.shell.panels; }
  get tabBtns(): RibbonShell['tabBtns'] { return this.shell.tabBtns; }
  isReading(): boolean { return this.view.getMode && this.view.getMode() === 'preview'; }

  cmd(id: string): () => boolean { return () => { const commands = this.app.commands; return commands ? commands.executeCommandById(id) : false; }; }

  render(): void {
    // 舊的控制鍵列在工具列外面，而且在 document 上掛了事件
    if (this.shell) this.shell.destroy();
    this.dom.replaceChildren();
    this.dom.removeClass('wm-reading-lite');
    this.lite = false;
    this.items = [];
    this.mode = this.isReading() ? 'preview' : 'source';
    const S = this.plugin.settings;
    const shell = new RibbonShell(this.dom, {
      side: 'md', settings: S, isMobile: !!Platform.isMobile, icon: iconOr,
      // 剛在分頁選單按鈕上拖曳移動過游標：放開時的那一下點擊不開選單
      openMenu: (owner, items) => { if (this.padMoved) { this.padMoved = false; return; } this.menu(owner, items); },
      // Markdown 的功能區沒有情境分頁
      pickTab: id => { if (id !== 'tabletab') this.showTab(id); },
      // 控制鍵列：閱讀模式不能編輯，不放。位置跟 Word 模式一樣：工具列在下方時放在它上面
      keys: Platform.isMobile && S.keyRow !== false && !this.isReading() ? {
        list: keyRowKeys(S.keyRowKeys), open: !!S.keyRowOpen,
        setOpen: open => { S.keyRowOpen = open; void this.plugin.saveSettings(); },
        move: (key, mods) => this.keyMove(key, mods),
        mount: row => {
          row.addClass('wm-mdbar-keys');
          // 打字時讓出 Obsidian 的工具列：控制鍵列跟著一起讓（樣式表）
          row.toggleClass('wm-yield-native', S.mdYieldNative !== false);
          this.view.containerEl.insertBefore(row, this.bottom ? this.dom : this.dom.nextSibling);
        },
      } : null,
      // 換到閱讀模式不會重建工具列：一律放，閱讀模式沒有 wm-idle-short，樣式表不顯示
      showKeyboard: Platform.isMobile ? () => { const ed = this.editor; if (ed && !this.isReading()) ed.focus(); } : null,
    });
    this.shell = shell;
    if (Platform.isMobile && !this.isReading()) this.trackpad(shell);
    const G = shell.groups;
    const E = (fn: (ed: Editor) => void) => () => { const ed = this.editor; if (ed) { fn(ed); ed.focus(); } };
    const find: MdHandler = { run: this.cmd('editor:open-search'), always: true };
    const replace: MdHandler = { run: this.cmd('editor:open-search-replace') };
    // 快速鍵依設定：關掉「Ctrl+E 切換」時提示裡不顯示
    const toWord: RibbonAction = { ...A.wordMode, keys: S.ctrlE !== false ? 'Mod+E' : null };
    const goWord: MdHandler = { run: () => { void this.plugin.switchToWord(this.view.leaf); }, always: true };

    // ---- 常用
    let g = G.undo;
    this.button(g, A.undo, { run: E(ed => ed.undo()) });
    this.button(g, A.redo, { run: E(ed => ed.redo()) });

    g = G.styles;
    this.button(g, A.style, { run: (e, b) => this.headingMenu(b) });

    g = G.font;
    this.button(g, A.bold, { run: E(ed => wrap(ed, '**')) });
    this.button(g, A.italic, { run: E(ed => wrap(ed, '*')) });
    this.button(g, A.underline, { run: E(ed => wrap(ed, '<u>', '</u>')) });
    this.button(g, A.strike, { run: E(ed => wrap(ed, '~~')) });
    this.button(g, A.sup, { run: E(ed => wrap(ed, '<sup>', '</sup>')) });
    this.button(g, A.sub, { run: E(ed => wrap(ed, '<sub>', '</sub>')) });
    this.button(g, A.highlight, { run: E(ed => wrap(ed, '==')) });

    g = G.paragraph;
    this.button(g, A.bullet, { run: this.cmd('editor:toggle-bullet-list') });
    this.button(g, A.ordered, { run: this.cmd('editor:toggle-numbered-list') });
    this.button(g, A.task, { run: this.cmd('editor:toggle-checklist-status') });
    this.button(g, A.outdent, { run: this.cmd('editor:unindent-list') });
    this.button(g, A.indent, { run: this.cmd('editor:indent-list') });
    this.button(g, A.quote, { run: this.cmd('editor:toggle-blockquote') });

    g = G.editing;
    this.button(g, A.find, find);
    this.button(g, A.replace, replace);

    // ---- 插入
    this.button(G.tables, A.table, { run: this.cmd('editor:insert-table') });
    this.button(G.illustrations, A.equation, { run: E(ed => { const sel = ed.getSelection(); ed.replaceSelection('$' + (sel || 'x^2') + '$'); }) });
    g = G.links;
    this.button(g, A.link, { run: this.cmd('editor:insert-link') });
    this.button(g, A.noteLink, { run: this.cmd('editor:insert-wikilink') });
    g = G.code;
    this.button(g, A.code, { run: E(ed => wrap(ed, '`')) });
    this.button(g, A.codeBlock, { run: (e, b) => this.codeMenu(b) });
    g = G.text;
    this.button(g, A.callout, { run: this.cmd('editor:insert-callout') });
    this.button(g, A.comment, { run: this.cmd('editor:toggle-comments') });
    this.button(g, A.hr, { run: E(ed => { const c = ed.getCursor(); const line = ed.getLine(c.line); ed.replaceRange(hrText(line, c.line > 0 ? ed.getLine(c.line - 1) : null), { line: c.line, ch: line.length }); }) });

    // ---- 校閱
    g = G.proofing;
    this.button(g, A.findBig, find);
    this.button(g, A.replaceBig, replace);

    // ---- 檢視：前三個按鈕的位置、大小跟 Word 模式的「檢視」分頁一樣
    g = G.views;
    this.button(g, toWord, goWord);
    this.button(g, A.markdownMode, { active: () => this.mode === 'source', run: () => { void this.setMode('source'); }, always: true });
    this.button(g, A.readingMode, { active: () => this.mode === 'preview', run: () => { void this.setMode('preview'); }, always: true });
    g = G.show;
    this.button(g, A.outline, { run: (e, b) => { if (Platform.isPhone) this.outlineMenu(b); else void this.plugin.toggleOutline(); }, active: () => this.plugin.outlineOpen(), always: true });
    this.button(g, A.peekProperties, { run: (e, b) => openMarkdownPeek(this.plugin, this.view, b), always: true });
    this.button(g, A.foldAll, { run: this.cmd('editor:fold-all') });
    this.button(g, A.unfoldAll, { run: this.cmd('editor:unfold-all') });
    this.button(G.help, A.settings, { run: () => this.plugin.openSettings(), always: true });

    // 右邊固定的快速按鈕（位置跟 Word 模式一樣）：尋找、切回 Word 模式
    const quick = shell.finish();
    shell.apart(() => {
      this.button(quick, A.findQuick, find);
      this.button(quick, { ...toWord, big: false, label: undefined }, goWord);
    });
    if (Platform.isMobile) this.buildIdle();
    if (shell.layout === 'tabs') this.showTab(shell.usableTab(this.plugin.lastTab), true);
    this.update();
  }

  // 手機上鍵盤收著時的一列（設定 phoneIdle 是 short；樣式表在 wm-idle-short 底下只顯示這一列）：跟 Word 模式的 buildIdle
  // 一樣只放鍵盤收著也用得到的（不把游標放回編輯器）。插入圖片、方程式在 Markdown 是在游標處插入文字，要先有游標，不放
  buildIdle(): void {
    const row = el('div', 'wm-idlebar', this.dom);
    row.setAttribute('role', 'toolbar');
    const icon = (look: RibbonAction): RibbonAction => ({ ...look, label: undefined, big: false });
    const sep = (): void => { el('span', 'wm-idlebar-sep', row); };
    const quiet = (fn: (ed: Editor) => void): MdHandler => ({ run: () => { const ed = this.editor; if (ed) fn(ed); } });
    this.shell.apart(() => {
      this.button(row, A.undo, quiet(ed => ed.undo()));
      this.button(row, A.redo, quiet(ed => ed.redo()));
      sep();
      this.button(row, icon(A.outline), { run: (e, b) => this.outlineMenu(b), always: true });
      this.button(row, icon(A.peekProperties), { run: (e, b) => openMarkdownPeek(this.plugin, this.view, b), always: true });
      this.button(row, icon(A.foldAll), { run: this.cmd('editor:fold-all') });
      this.button(row, icon(A.unfoldAll), { run: this.cmd('editor:unfold-all') });
      sep();
      this.button(row, { icon: 'bar-chart-3', title: '字數統計', text: '數', demo: 'wordcount', desc: '顯示字數、字元數、段落數與預估閱讀時間；有選取時也會算選取範圍。' }, { run: () => mdWordCount(this.plugin, this.view), always: true });
      this.button(row, icon(A.settings), { run: () => this.plugin.openSettings(), always: true });
    });
  }

  // 手機的大綱：列出標題的選單（Obsidian 的選單在手機上從畫面下方滑上來），點一個就捲過去；不開新的分頁蓋住筆記
  outlineMenu(owner: HTMLElement): void {
    const file = this.view.file;
    const cache = file ? this.plugin.app.metadataCache.getFileCache(file) : null;
    const heads = (cache && cache.headings) || [];
    const menu = new Menu();
    if (!heads.length) menu.addItem(i => i.setTitle(t('這份筆記沒有標題')).setDisabled(true));
    const min = Math.min(...heads.map(h => h.level));
    for (const h of heads) {
      // 縮排用全形空白：選單項目不能自己設定樣式
      menu.addItem(i => i.setTitle('\u3000'.repeat(h.level - min) + h.heading).onClick(() => {
        this.view.setEphemeralState({ line: h.position.start.line });
      }));
    }
    const r = owner.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.top });
  }

  // 切換分頁；跟 Word 模式共用「上次的分頁」，切換模式後停在同一個分頁
  showTab(id: TabId, initial?: boolean): void {
    this.shell.showTab(id);
    if (!initial) this.plugin.lastTab = id;
  }

  // look：按鈕長什麼樣子（ribbon.ts 的 ACTIONS）；how：按下去對 Markdown 編輯器做什麼
  button(parent: HTMLElement | null | undefined, look: RibbonAction, how: MdHandler): HTMLButtonElement | null {
    const made = this.shell.button(parent, look, (e, b) => { how.run(e, b); window.setTimeout(() => this.update(), 50); });
    if (!made) return null;
    this.items.push(Object.assign(made, { spec: how }));
    return made.dom;
  }

  update(): void {
    this.syncStatus();
    this.syncKeyboard();
    const reading = this.isReading();
    this.mode = reading ? 'preview' : 'source';
    for (const it of this.items) {
      const off = reading && !it.spec.always;
      it.dom.classList.toggle('is-disabled', off);
      it.reason = off ? t('閱讀模式不能編輯：按「Markdown」或「Word 模式」再編輯') : null;
      // 詳細提示模式：原因顯示在提示卡上（讀 it.reason），按鈕上的文字不用跟著改
      if (!this.shell.richHints) this.shell.setTip(it);
      if (it.spec.active) it.dom.classList.toggle('is-active', !!it.spec.active());
    }
    // 閱讀模式不能編輯，四個分頁裡大半的按鈕是停用的。手機的畫面小，佔兩列卻幾乎都按不了：
    // 只留「檢視」分頁裡能用的那幾顆（切換模式、大綱、屬性、設定）排成一列，分頁列與停用的按鈕藏起來（樣式表）。
    // 不動「上次的分頁」：回到編輯模式時還是原來那個分頁
    const lite = reading && !!Platform.isPhone && this.plugin.settings.readingLite !== false && this.shell.layout === 'tabs' && !!this.shell.panels.viewtab;
    if (lite === this.lite) return;
    this.lite = lite;
    this.dom.toggleClass('wm-reading-lite', lite);
    this.shell.showTab(lite ? 'viewtab' : this.shell.usableTab(this.plugin.lastTab));
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

  menu(owner: HTMLElement, items: MenuItem[]): void {
    const m = new Menu();
    for (const it of items) m.addItem(i => { i.setTitle(it.title).onClick(it.run); if (it.icon) i.setIcon(it.icon); });
    const r = owner.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  headingMenu(owner: HTMLElement): void {
    const ed = this.editor;
    if (!ed) return;
    const items: MenuItem[] = [{ title: t('內文'), run: () => { linePrefix(ed, HEAD_RE, ''); ed.focus(); } }];
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
        const from = ed.getCursor('from'), to = ed.getCursor('to');
        const ins = codeBlockText(sel, lang, ed.getLine(from.line).slice(0, from.ch), ed.getLine(to.line).slice(to.ch));
        ed.replaceSelection(ins.text);
        if (ins.cursorLine >= 0) ed.setCursor({ line: from.line + ins.cursorLine, ch: 0 });
        ed.focus();
      },
    })));
  }
}

// 「查看文件屬性」小視窗（功能區與狀態列的按鈕）：讀這份筆記的原文，所以還沒存檔的修改也看得到
export function openMarkdownPeek(plugin: WordModePlugin, view: MarkdownView, btn: HTMLElement): void {
  let text = '';
  try { text = view.getViewData(); } catch { /* 檢視還沒載入完成 */ }
  const data = peekData(frontmatterOf(text), yaml => parseYaml(yaml) as unknown);
  const reading = view.getMode && view.getMode() === 'preview';
  // 有屬性：捲到最上方（Obsidian 把屬性顯示在那裡）；沒有屬性：編輯模式才能新增
  const go = data.kind !== 'none' ? () => { try { view.currentMode.applyScroll(0); } catch { /* 沒有捲動的方法 */ } }
    : reading ? null : () => addMarkdownProperty(plugin, view);
  showProps(plugin.app, btn, data, {
    icon: iconOr,
    typeHint: k => propertyWidget(plugin.app, k), go, isMobile: !!Platform.isMobile,
    edit: Platform.isPhone ? markdownPropsEdit(plugin, view) : undefined,
  });
}

// 筆記開頭的文件屬性（含前後的 ---）：Obsidian 認得的寫法，結尾也可以是 ...
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/;

// 手機的文件屬性視窗在 Markdown／閱讀模式也能直接編輯。編輯模式改編輯器裡的原文（可以復原、游標不跳）；
// 閱讀模式沒有編輯器，用 Obsidian 的 processFrontMatter 寫回檔案。寫檔是非同步的，視窗裡先顯示剛寫的內容
function markdownPropsEdit(plugin: WordModePlugin, view: MarkdownView): PropsEdit {
  let latest: PropValues | null = null;
  const app = plugin.app;
  // 把筆記開頭的文件屬性換成 block（沒有時加在最前面）：編輯模式改編輯器，閱讀模式改檔案
  const replace = (block: string): void => {
    const ed = (!view.getMode || view.getMode() === 'source') ? view.editor : null;
    if (ed) {
      const m = FRONTMATTER.exec(ed.getValue());
      if (m) ed.replaceRange(block, ed.offsetToPos(0), ed.offsetToPos(m[0].length));
      else ed.replaceRange(block + '\n', { line: 0, ch: 0 });
      return;
    }
    if (view.file) void app.vault.process(view.file, text => { const m = FRONTMATTER.exec(text); return m ? block + text.slice(m[0].length) : block + '\n' + text; });
  };
  const text = (): string => { try { return view.getViewData(); } catch { return ''; } };
  return {
    yaml: {
      read: () => { const m = FRONTMATTER.exec(text()); return m ? frontmatterBody(m[0]) : ''; },
      write: body => {
        // 寫檔是非同步的：視窗先顯示剛寫的內容（看不懂的 YAML 就等檔案寫好再讀）
        try { const v: unknown = parseYaml(body); latest = v && typeof v === 'object' && !Array.isArray(v) ? v as PropValues : null; } catch { latest = null; }
        replace(wrapFrontmatter(body));
      },
    },
    read: () => {
      if (latest) return { kind: 'props', values: latest };
      return peekData(frontmatterOf(text()), yaml => parseYaml(yaml) as unknown);
    },
    commit: obj => {
      latest = obj;
      const ed = (!view.getMode || view.getMode() === 'source') ? view.editor : null;
      if (ed || !view.file) { replace(wrapFrontmatter(Object.keys(obj).length ? stringifyYaml(obj) : '')); return; }
      void app.fileManager.processFrontMatter(view.file, (fm: Record<string, unknown>) => {
        for (const k of Object.keys(fm)) delete fm[k];
        Object.assign(fm, obj);
      });
    },
    ctx: {
      icon: iconOr,
      menu: (evt: MouseEvent, items: NodeViewMenuItem[]) => {
        evt.preventDefault();
        const m = new Menu();
        for (const it of items) m.addItem(i => { i.setTitle(it.title); if (it.icon) i.setIcon(it.icon); i.onClick(it.run); });
        m.showAtMouseEvent(evt);
      },
      prompt: (title, value, placeholder, cb) => new PromptModal(app, title, value, placeholder, cb).open(),
      openLink: (target, newLeaf) => { void app.workspace.openLinkText(target, view.file ? view.file.path : '', newLeaf); },
      propertyType: key => propertyWidget(app, key),
    },
  };
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

// 控制鍵的方向鍵、Home、End 在 Obsidian 的編輯器（Markdown 模式）：用編輯器的指令移動，Shift 延伸選取時把選取的起點放回去。
// Ctrl（⌘）：左右跳一個詞，上下到這一行的開頭、結尾（已經在那裡時到上一行、下一行），Home／End 是文件的開頭、結尾。
// mdbar.ts 的工具列與 nativebar.ts（Obsidian 自己的手機工具列）共用。回傳有沒有移動（按住連續移動時，走不動就停）
export function editorKeyMove(ed: Editor, key: MoveKey, mods: KeyMods): boolean {
  const anchor = ed.getCursor('anchor');
  const head = ed.getCursor('head');
  const line = head.line;
  const lineLen = (n: number) => ed.getLine(n).length;
  let to: EditorPosition;
  if (key === 'left' || key === 'right') {
    const dir = key === 'left' ? -1 : 1;
    if (mods.mod) { ed.exec(dir < 0 ? 'goWordLeft' : 'goWordRight'); to = ed.getCursor('head'); }
    else if (!mods.shift && ed.somethingSelected()) to = dir < 0 ? ed.getCursor('from') : ed.getCursor('to');
    else to = offsetBy(ed, head, dir);
  } else if (key === 'up' || key === 'down') {
    const dir = key === 'up' ? -1 : 1;
    if (mods.mod) {
      const edge = dir < 0 ? 0 : lineLen(line);
      const next = line + dir;
      to = head.ch !== edge || next < 0 || next > ed.lastLine() ? { line, ch: edge } : { line: next, ch: dir < 0 ? 0 : lineLen(next) };
    } else { ed.exec(dir < 0 ? 'goUp' : 'goDown'); to = ed.getCursor('head'); }
  } else if (mods.mod) to = key === 'home' ? { line: 0, ch: 0 } : { line: ed.lastLine(), ch: lineLen(ed.lastLine()) };
  else to = { line, ch: key === 'home' ? 0 : lineLen(line) };
  if (mods.shift) ed.setSelection(anchor, to); else ed.setCursor(to);
  return to.line !== head.line || to.ch !== head.ch;
}

// 觸控板在 Obsidian 的編輯器裡走 nx 個字、ny 行
export function editorStep(ed: Editor, nx: number, ny: number): void {
  if (nx) ed.setCursor(offsetBy(ed, ed.getCursor('head'), nx));
  for (let i = 0; i < Math.abs(ny); i++) ed.exec(ny < 0 ? 'goUp' : 'goDown');
}

// pos 往前、往後 n 個字（收在文件的頭尾之間）。文件的長度用最後一行算，不用整份文字（很長的筆記每一格都要算）
function offsetBy(ed: Editor, pos: EditorPosition, n: number): EditorPosition {
  const last = ed.lastLine();
  const end = ed.posToOffset({ line: last, ch: ed.getLine(last).length });
  return ed.offsetToPos(Math.max(0, Math.min(ed.posToOffset(pos) + n, end)));
}

// 在 Obsidian 的編輯器裡拖曳移動游標（觸控板）時的位置提示：工具列上方一顆膠囊，寫出第幾行、第幾字，
// 以及游標前後幾個字（中間畫一條游標）。Word 模式有放大鏡；Markdown 模式的編輯器是 Obsidian 的，沒辦法複製一段放大，用這個代替
const PAD_AROUND = 10;
export function padPosition(bar: HTMLElement, ed: Editor): { update(): void; remove(): void } {
  const doc = bar.ownerDocument;
  const pill = el('div', 'wm-pad-pos', doc.body);
  pill.setAttribute('aria-hidden', 'true');
  const where = el('span', 'wm-pad-pos-where', pill);
  const text = el('span', 'wm-pad-pos-text', pill);
  const update = (): void => {
    const head = ed.getCursor('head');
    const line = ed.getLine(head.line);
    where.setText(t('第 {l} 行，第 {c} 字', { l: String(head.line + 1), c: String(head.ch) }));
    text.replaceChildren();
    const before = line.slice(Math.max(0, head.ch - PAD_AROUND), head.ch);
    const after = line.slice(head.ch, head.ch + PAD_AROUND);
    text.appendText((head.ch > PAD_AROUND ? '…' : '') + before);
    el('span', 'wm-pad-pos-caret', text);
    text.appendText(after + (line.length > head.ch + PAD_AROUND ? '…' : ''));
    // 放在工具列上方、水平置中（工具列在畫面下方，膠囊不會被手指擋住）
    const r = bar.getBoundingClientRect();
    pill.style.left = Math.round(r.left + r.width / 2) + 'px';
    // 工具列放在上方時上面沒有位置，改放在工具列下方
    const above = r.top - pill.offsetHeight - 8;
    pill.style.top = Math.round(above >= 8 ? above : r.bottom + 8) + 'px';
  };
  update();
  return { update, remove: () => pill.remove() };
}
