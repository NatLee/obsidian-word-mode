// Word 模式的對話框：原文編輯、輸入框、超連結、檔案選擇、快速鍵說明、方程式編輯器、清理符號、字數統計
import { Modal, FuzzySuggestModal, Notice, setIcon, Platform } from 'obsidian';
import { countWeird, cleanWeird, WEIRD_KINDS } from './marks.js';
import { MathField } from './mathvisual.js';
import { saveTemplate, uniqueName } from './templates.js';
import type { SavedTemplate } from './templates.js';
import { keepFocus } from './dom.js';
import { buildDemo } from './hints.js';
import { t, key, isMac } from './i18n.js';
import type { App, TFile } from 'obsidian';
import type { WeirdKindId } from './marks.js';
import type WordModePlugin from './main.js';
import type { WordModeView } from './view.js';
import type { I18nKey } from './i18n.js';
import type { DemoName } from './hints.js';
import type { WordStats } from './textstats.js';

// 原文編輯、輸入框按「套用／確定」後收到輸入的文字
export type TextCallback = (value: string) => void;

// 超連結對話框：連到網址，或連到保管庫裡的筆記與檔案
export type LinkMode = 'url' | 'file';
// 開啟時的初始值：existing 是否在編輯既有的連結、text 顯示文字、href 原本的網址或連結目標、file 原本連到的檔案、query 搜尋框的預設文字
export interface LinkDialogInit {
  existing?: boolean;
  text?: string;
  mode?: LinkMode;
  href?: string;
  file?: TFile | null;
  query?: string;
}
// 按「確定」的結果；連到檔案時 unchanged 表示沒有換檔案，href 帶回初始值的 href
export type LinkDialogResult =
  | { mode: 'url'; href: string; text: string }
  | { mode: 'file'; file: TFile; text: string; unchanged: boolean; href: string | undefined };
export type LinkSaveCallback = (result: LinkDialogResult) => void;

// 檔案選擇器選好檔案後呼叫（可以是 async 函式）
export type FileChooseCallback = (file: TFile) => void;

// 快速鍵說明的一組：分類名稱、圖示、[按鍵組合, 說明, 示意動畫] 的列表（文字在顯示時才翻譯）。
// 示意動畫是 hints.ts 的動畫名稱，與工具列的詳細提示共用；有動畫的那一列按一下會展開
export type ShortcutRow = [combo: string, desc: I18nKey, demo?: DemoName];
export type ShortcutGroup = [group: I18nKey, icon: string, rows: ShortcutRow[]];
// 快速鍵說明視窗裡的一列與一張卡片，搜尋或選分類時用來顯示或隱藏。
// label 是放說明文字的元素、desc 是翻譯後的說明（搜尋時標出符合的字）、text 是搜尋比對用的小寫文字；
// line、demo、demoBox 只有帶示意動畫的列才有：line 是可以按的那一行，demoBox 是放動畫的框
interface ShortcutRowEl { row: HTMLDivElement; label: HTMLElement; desc: string; text: string; line?: HTMLElement; demo?: DemoName; demoBox?: HTMLElement; }
// col 是卡片所在的那一欄
interface ShortcutCardEl { card: HTMLDivElement; col: HTMLDivElement; list: ShortcutRowEl[]; group: string; index: number; }

// 方程式工具列的一個按鈕：顯示文字、插入的 LaTeX；raw 為 true 表示「最近使用」，原樣插入
// 一般按鈕的 label 是介面文字（翻譯前）；「最近使用」的 label 是使用者輸入過的公式，不翻譯
// named：常用公式，公式下面顯示名稱（label 是翻譯前的名稱）
// named：按鈕下方顯示名稱。true＝內建的常用公式（名稱是介面文字，要翻譯）；'user'＝自己存的公式（名稱照原樣顯示）
export type MathSnippet = [label: I18nKey, snip: string, raw?: undefined, named?: undefined] | [label: string, snip: string, raw: true, named?: boolean | 'user'];
export type MathSnippetGroup = [name: I18nKey, items: MathSnippet[]];
// 方程式對話框的初始值：src LaTeX 原文、display 是否獨立一行、existing 是否在編輯既有的方程式、onDelete 按「刪除方程式」時呼叫
export interface EquationInit {
  src?: string;
  display?: boolean;
  existing?: boolean;
  onDelete?: () => void;
}
// 把 LaTeX 畫到 el 裡（display 為 true 表示獨立一行、置中）
export type MathRenderer = (src: string, el: HTMLElement, display: boolean) => void;
export type EquationSaveCallback = (src: string, display: boolean) => void;
export type EquationEditMode = 'visual' | 'latex';

// 字數統計的一列：名稱、整份文件、選取範圍（沒有選取時為 null）
export type WordCountRow = [label: string, all: string, sel: string | null];

export class SourceModal extends Modal {
  declare titleText: string;
  declare value: string;
  declare onSave: TextCallback;
  constructor(app: App, title: string, value: string, onSave: TextCallback) { super(app); this.titleText = title; this.value = value; this.onSave = onSave; }
  onOpen(): void {
    this.titleEl.setText(this.titleText);
    const ta = this.contentEl.createEl('textarea', { cls: 'wm-source-input' });
    ta.value = this.value;
    ta.rows = Math.min(20, Math.max(4, this.value.split('\n').length + 1));
    const bar = this.contentEl.createDiv('modal-button-container');
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    const ok = bar.createEl('button', { text: t('套用'), cls: 'mod-cta' });
    ok.addEventListener('click', () => { this.close(); this.onSave(ta.value); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    window.setTimeout(() => ta.focus(), 10);
  }
  onClose(): void { this.contentEl.empty(); }
}

export class PromptModal extends Modal {
  declare titleText: string;
  declare value: string;
  declare placeholder: string;
  declare onSave: TextCallback;
  constructor(app: App, title: string, value: string, placeholder: string, onSave: TextCallback) { super(app); this.titleText = title; this.value = value; this.placeholder = placeholder; this.onSave = onSave; }
  onOpen(): void {
    this.titleEl.setText(this.titleText);
    const i = this.contentEl.createEl('input', { type: 'text', cls: 'wm-prompt-input' });
    i.value = this.value || '';
    i.placeholder = this.placeholder || '';
    const bar = this.contentEl.createDiv('modal-button-container');
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    const ok = bar.createEl('button', { text: t('確定'), cls: 'mod-cta' });
    ok.addEventListener('click', () => { this.close(); this.onSave(i.value); });
    // 輸入法選字中的 Enter 是確定選字，不是送出
    i.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok.click(); } });
    window.setTimeout(() => { i.focus(); i.select(); }, 10);
  }
  onClose(): void { this.contentEl.empty(); }
}

// 插入／編輯超連結：可以連到網址，或搜尋保管庫裡的筆記與檔案
export class LinkDialog extends Modal {
  declare view: WordModeView;
  declare init: LinkDialogInit;
  declare onSave: LinkSaveCallback;
  declare onRemove: (() => void) | undefined;
  declare mode: LinkMode;
  declare selected: TFile | null;
  declare results: TFile[];
  declare active: number;
  declare text: HTMLInputElement;
  declare tabUrl: HTMLButtonElement;
  declare tabFile: HTMLButtonElement;
  declare urlPane: HTMLDivElement;
  declare href: HTMLInputElement;
  declare filePane: HTMLDivElement;
  declare query: HTMLInputElement;
  declare list: HTMLDivElement;
  declare ok: HTMLButtonElement;
  // init: { text, mode: 'url'|'file', href, file, existing }
  constructor(app: App, view: WordModeView, init: LinkDialogInit, onSave: LinkSaveCallback, onRemove?: () => void) {
    super(app); this.view = view; this.init = init; this.onSave = onSave; this.onRemove = onRemove;
    this.mode = init.mode || 'url';
    this.selected = init.file || null;
    this.results = [];
    this.active = 0;
  }
  onOpen(): void {
    const c = this.contentEl;
    c.addClass('wm-link-dialog');
    this.titleEl.setText(this.init.existing ? t('編輯超連結') : t('插入超連結'));
    const row = (label: string) => { const d = c.createDiv('wm-form-row'); d.createEl('label', { text: label }); return d; };
    this.text = row(t('顯示文字')).createEl('input', { type: 'text' });
    this.text.value = this.init.text || '';
    this.text.placeholder = t('（留白則顯示網址或筆記名稱）');

    const tabs = c.createDiv('wm-link-tabs');
    const tab = (icon: string, label: string) => {
      const b = tabs.createEl('button');
      setIcon(b.createSpan('wm-tab-icon'), icon);
      b.createSpan({ text: label });
      return b;
    };
    this.tabUrl = tab('globe', t('網址'));
    this.tabFile = tab('file-text', t('保管庫的筆記或檔案'));
    this.tabUrl.addEventListener('click', () => this.setMode('url'));
    this.tabFile.addEventListener('click', () => this.setMode('file'));

    this.urlPane = c.createDiv('wm-link-pane');
    this.href = this.urlPane.createEl('input', { type: 'text', cls: 'wm-link-href' });
    this.href.placeholder = 'https://…';
    this.href.value = this.mode === 'url' ? (this.init.href || '') : '';
    this.urlPane.createDiv({ cls: 'wm-link-hint', text: t('貼上網址，例如 https://www.example.com') });

    this.filePane = c.createDiv('wm-link-pane');
    this.query = this.filePane.createEl('input', { type: 'text', cls: 'wm-link-query' });
    this.query.placeholder = t('輸入筆記或檔案名稱搜尋…');
    this.query.value = this.selected ? this.selected.basename : (this.mode === 'file' ? (this.init.query || '') : '');
    this.list = this.filePane.createDiv('wm-link-results');
    this.query.addEventListener('input', () => { this.selected = null; this.search(); });

    const bar = c.createDiv('modal-button-container');
    if (this.init.existing && this.onRemove) bar.createEl('button', { text: t('移除連結'), cls: 'mod-warning' }).addEventListener('click', () => { this.close(); this.onRemove!(); });
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    this.ok = bar.createEl('button', { text: t('確定'), cls: 'mod-cta' });
    this.ok.addEventListener('click', () => this.submit());

    const keys = (e: KeyboardEvent) => {
      // 輸入法還在選字：這時的 Enter 是「確定選這個字」、Esc 是「取消選字」，不是給這裡的
      if (e.isComposing) return;
      if (this.mode === 'file' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        this.active = Math.max(0, Math.min(this.results.length - 1, this.active + (e.key === 'ArrowDown' ? 1 : -1)));
        this.renderList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.mode === 'file' && !this.selected && this.results[this.active]) this.pick(this.results[this.active]);
        else this.submit();
      }
    };
    for (const i of [this.text, this.href, this.query]) i.addEventListener('keydown', keys);
    this.setMode(this.mode);
    if (this.mode === 'file') this.search();
  }
  setMode(m: LinkMode): void {
    this.mode = m;
    this.tabUrl.toggleClass('is-active', m === 'url');
    this.tabFile.toggleClass('is-active', m === 'file');
    this.urlPane.style.display = m === 'url' ? '' : 'none';
    this.filePane.style.display = m === 'file' ? '' : 'none';
    window.setTimeout(() => (this.init.text || this.text.value ? (m === 'url' ? this.href : this.query) : this.text).focus(), 10);
    if (m === 'file') this.search();
  }
  search(): void {
    const q = this.query.value.trim().toLowerCase();
    const files = this.app.vault.getFiles().filter(f => !f.path.startsWith(this.app.vault.configDir + '/') && f !== this.view.file);
    const score = (f: TFile) => {
      const b = f.basename.toLowerCase(); const p = f.path.toLowerCase();
      if (!q) return f.extension === 'md' ? 1 : 0;
      if (b === q) return 100;
      if (b.startsWith(q)) return 80;
      if (b.includes(q)) return 60;
      if (p.includes(q)) return 40;
      return q.split(/\s+/).every(tv => p.includes(tv)) ? 20 : -1;
    };
    this.results = files.map<[number, TFile]>(f => [score(f), f]).filter(x => x[0] >= 0).map<[number, TFile]>(x => [x[0] + (x[1].extension === 'md' ? 5 : 0), x[1]])
      .sort((a, b) => b[0] - a[0] || a[1].path.length - b[1].path.length).slice(0, 8).map(x => x[1]);
    this.active = 0;
    this.renderList();
  }
  renderList(): void {
    this.list.empty();
    if (this.selected) {
      const d = this.list.createDiv('wm-link-item is-selected');
      const name = d.createSpan({ cls: 'wm-link-name' });
      setIcon(name.createSpan('wm-tab-icon'), 'check');
      name.createSpan({ text: this.selected.basename });
      d.createSpan({ cls: 'wm-link-path', text: this.selected.path });
      return;
    }
    if (!this.results.length) { this.list.createDiv({ cls: 'wm-link-hint', text: t('找不到符合的筆記或檔案') }); return; }
    this.results.forEach((f, i) => {
      const d = this.list.createDiv('wm-link-item' + (i === this.active ? ' is-active' : ''));
      d.createSpan({ cls: 'wm-link-name', text: f.basename + (f.extension !== 'md' ? '.' + f.extension : '') });
      d.createSpan({ cls: 'wm-link-path', text: f.parent && f.parent.path !== '/' ? f.parent.path : t('（根目錄）') });
      d.addEventListener('mousedown', e => e.preventDefault());
      d.addEventListener('click', () => this.pick(f));
    });
  }
  pick(f: TFile): void { this.selected = f; this.query.value = f.basename; this.renderList(); this.ok.focus(); }
  submit(): void {
    const text = this.text.value;
    if (this.mode === 'url') {
      let href = this.href.value.trim();
      if (!href) { this.href.focus(); return; }
      if (/^www\./i.test(href)) href = 'https://' + href;
      this.close(); this.onSave({ mode: 'url', href, text });
    } else {
      const f = this.selected || (this.results.length === 1 ? this.results[0] : null);
      if (!f) { this.query.focus(); return; }
      this.close(); this.onSave({ mode: 'file', file: f, text, unchanged: f === this.init.file, href: this.init.href });
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

export class FilePicker extends FuzzySuggestModal<TFile> {
  declare files: TFile[];
  declare onChooseFile: FileChooseCallback;
  constructor(app: App, files: TFile[], placeholder: string, onChoose: FileChooseCallback) { super(app); this.files = files; this.onChooseFile = onChoose; this.setPlaceholder(placeholder); }
  getItems(): TFile[] { return this.files; }
  getItemText(f: TFile): string { return f.path; }
  onChooseItem(f: TFile): void { this.onChooseFile(f); }
}

// 快速鍵說明：Mod 顯示成 Ctrl 或 Cmd，文字在顯示時才翻譯；多個組合用「／」分開
const SHORTCUTS: readonly ShortcutGroup[] = [
  ['檢視', 'eye', [['Mod+E', 'Word 模式 ⇄ Markdown 編輯（在 Markdown 畫面再按一次切回）', 'markdown'], ['Mod+滑鼠滾輪', '放大／縮小頁面', 'zoom'], ['Mod+/', '快速鍵說明']]],
  ['文字格式', 'bold', [['Mod+B', '粗體', 'bold'], ['Mod+I', '斜體', 'italic'], ['Mod+U', '底線', 'underline'], ['Mod+Shift+X', '刪除線', 'strike'], ['Mod+Shift+H', '醒目提示（螢光筆）', 'highlight'], ['Mod+`', '行內程式碼', 'code'], ['（沒有選取時）', '格式套用到游標所在的詞']]],
  ['段落', 'pilcrow', [['Mod+Alt+1～6', '標題 1～6', 'style'], ['Mod+Alt+0', '內文'], ['Mod+L／Mod+J', '靠左／左右對齊（置中、靠右在工具列）', 'justify'], ['Tab', '段落開頭：首行縮排兩個字'], ['Alt+↑／Alt+↓', '上下移動段落、清單項目或表格列', 'sort'], ['Shift+Enter', '同一段落內換行']]],
  ['表格', 'table', [['Tab／Shift+Tab', '下一格／上一格（最後一格按 Tab 新增一列）', 'table'], ['Enter', '儲存格內換行'], ['貼上 Excel 範圍', '建立表格，或從目前儲存格開始填入']]],
  ['連結與插入', 'link', [['Mod+K', '插入／編輯超連結', 'link'], ['Mod+點擊', '開啟連結'], ['選取文字後貼上網址', '把文字變成超連結']]],
  ['尋找與編輯', 'search', [['Mod+F', '尋找', 'find'], ['Mod+H', '取代', 'replace'], ['Mod+Z／Mod+Y', '復原／取消復原', 'undo'], ['Mod+Shift+V', '貼上純文字', 'paste'], ['Mod+S', '立即存檔'], ['Esc', '關閉尋找、結束格式刷']]],
  ['格式刷', 'paintbrush', [['按一下', '刷一次', 'painter'], ['按兩下', '連續刷，按 Esc 或再按一次結束']]],
];

const KEY_NAMES: Partial<Record<string, () => string>> = { Mod: () => key('Mod'), Alt: () => key('Alt'), Shift: () => 'Shift', Enter: () => 'Enter', Esc: () => 'Esc', Tab: () => 'Tab' };

// 'Mod+Shift+V' → [Ctrl] + [Shift] + [V]；沒有 + 的說明文字（例如「按一下」）照樣顯示
function renderKeys(parent: HTMLElement, combo: string): void {
  const box = parent.createDiv('wm-sc-keys');
  combo.split('／').forEach((alt, i) => {
    if (i) box.createSpan({ cls: 'wm-sc-or', text: '/' });
    const parts = alt.split('+');
    const isText = parts.length === 1 && !/^(Tab|Enter|Esc|Shift)$/.test(alt) && !/^[A-Z0-9`/]$/.test(alt);
    // alt、p 是從按鍵組合字串切出來的片段：可能是說明文字（例如「按一下」），也可能是按鍵名稱（例如 B、↑），找不到翻譯時 t() 原樣回傳
    if (isText) { box.createSpan({ cls: 'wm-sc-text', text: t(alt as I18nKey) }); return; }
    parts.forEach((p, j) => {
      if (j) box.createSpan({ cls: 'wm-sc-plus', text: '+' });
      // 同上：p 可能是按鍵名稱，不一定是鍵
      const name = KEY_NAMES[p] ? KEY_NAMES[p]() : t(p as I18nKey);
      box.createEl('kbd', { text: name, cls: /[㐀-鿿]/.test(p) ? 'is-mouse' : '' });
    });
  });
}

const MATH_SNIPPETS: readonly MathSnippetGroup[] = [
  ['結構', [['分數', '\\frac{}{}'], ['根號', '\\sqrt{}'], ['n 次方根', '\\sqrt[n]{}'], ['上標', '^{}'], ['下標', '_{}'], ['上下標', '_{}^{}'], ['括號', '\\left( \\right)'], ['中括號', '\\left[ \\right]'], ['大括號', '\\left\\{ \\right\\}'], ['絕對值', '\\left| \\right|'], ['矩陣', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'], ['分段函數', '\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}'], ['多行對齊', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}'], ['編號', '\\tag{1}'], ['文字', '\\text{}']]],
  ['運算', [['總和', '\\sum_{i=1}^{n}'], ['積分', '\\int_{a}^{b}'], ['重積分', '\\iint_{D}'], ['極限', '\\lim_{x \\to \\infty}'], ['乘積', '\\prod_{i=1}^{n}'], ['微分', '\\frac{d}{dx}'], ['偏微分', '\\frac{\\partial }{\\partial x}'], ['組合', '\\binom{n}{k}'], ['最大', '\\max'], ['最小', '\\min'], ['對數', '\\log'], ['自然對數', '\\ln'], ['指數', 'e^{}'], ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan']]],
  ['標記', [['向量', '\\vec{}'], ['平均', '\\bar{}'], ['估計', '\\hat{}'], ['波浪', '\\tilde{}'], ['一階導數', '\\dot{}'], ['二階導數', '\\ddot{}'], ['上括號', '\\overbrace{}^{}'], ['下括號', '\\underbrace{}_{}'], ['粗體', '\\mathbf{}'], ['空心字', '\\mathbb{}'], ['正體', '\\mathrm{}'], ['花體', '\\mathcal{}']]],
  ['關係', [['±', '\\pm'], ['×', '\\times'], ['÷', '\\div'], ['·', '\\cdot'], ['≤', '\\le'], ['≥', '\\ge'], ['≠', '\\ne'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∝', '\\propto'], ['∼', '\\sim'], ['≪', '\\ll'], ['≫', '\\gg']]],
  ['集合與邏輯', [['∈', '\\in'], ['∉', '\\notin'], ['⊂', '\\subset'], ['⊆', '\\subseteq'], ['∪', '\\cup'], ['∩', '\\cap'], ['∅', '\\emptyset'], ['∀', '\\forall'], ['∃', '\\exists'], ['¬', '\\neg'], ['∧', '\\land'], ['∨', '\\lor'], ['ℝ', '\\mathbb{R}'], ['ℕ', '\\mathbb{N}']]],
  ['箭頭與其他', [['→', '\\to'], ['←', '\\leftarrow'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow'], ['↦', '\\mapsto'], ['∞', '\\infty'], ['∂', '\\partial'], ['∇', '\\nabla'], ['…', '\\ldots'], ['⋯', '\\cdots'], ['°', '^\\circ'], ['′', "'"]]],
  ['希臘字母', [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\epsilon'], ['η', '\\eta'], ['θ', '\\theta'], ['λ', '\\lambda'], ['μ', '\\mu'], ['ν', '\\nu'], ['π', '\\pi'], ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['φ', '\\phi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'], ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'], ['Ω', '\\Omega']]],
];

// 常用公式：[名稱, LaTeX]。整條插入後再改裡面的內容，在手機上比一格一格組出來快
const MATH_FORMULAS: readonly (readonly [name: I18nKey, latex: string])[] = [
  ['一元二次方程式的解', 'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}'],
  ['畢氏定理', 'a^{2} + b^{2} = c^{2}'],
  ['平均數', '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_{i}'],
  ['標準差', '\\sigma = \\sqrt{\\frac{1}{n} \\sum_{i=1}^{n} (x_{i} - \\mu)^{2}}'],
  ['年均成長率', 'r = \\left( \\frac{V_{n}}{V_{0}} \\right)^{\\frac{1}{n}} - 1'],
  ['歐拉公式', 'e^{i\\pi} + 1 = 0'],
];

// 方程式編輯器：上方分類按鈕、編輯區（視覺化的格子或 LaTeX，可以復原）、即時預覽（含語法錯誤提示）、最近使用
export class EquationModal extends Modal {
  declare init: EquationInit;
  declare render: MathRenderer;
  declare onSave: EquationSaveCallback;
  declare plugin: WordModePlugin | null | undefined;
  declare display: boolean;
  declare tabVisual: HTMLButtonElement;
  declare tabLatex: HTMLButtonElement;
  declare fieldHost: HTMLDivElement;
  declare field: MathField;
  declare fieldHint: HTMLDivElement;
  declare ta: HTMLTextAreaElement;
  declare err: HTMLSpanElement;
  declare prev: HTMLDivElement;
  declare timer: number | undefined;
  declare editMode: EquationEditMode;
  declare undoBtn: HTMLButtonElement;
  declare redoBtn: HTMLButtonElement;
  // 只有視覺化編輯時顯示的按鈕（上一格、下一格、拿掉結構、復原、取消復原）
  declare visualTools: HTMLButtonElement[];
  // 視覺化的格子目前對應的 LaTeX（LaTeX 那一格跟它不同，表示在 LaTeX 模式改過）；還沒建立格子時是 null
  declare fieldSrc: string | null;
  constructor(app: App, init: EquationInit, render: MathRenderer, onSave: EquationSaveCallback, plugin?: WordModePlugin | null) {
    super(app); this.init = init; this.render = render; this.onSave = onSave; this.plugin = plugin; this.display = !!init.display;
  }
  onOpen(): void {
    this.titleEl.setText(this.init.existing ? t('編輯方程式') : t('插入方程式'));
    this.modalEl.addClass('wm-eq-modal');
    const c = this.contentEl;
    c.addClass('wm-eq');
    this.fieldSrc = null;

    // ---- 上方：方程式放在哪裡、用哪種方式編輯
    const top = c.createDiv('wm-eq-top');
    const modes = top.createDiv('wm-seg');
    const mInline = modes.createEl('button', { text: t('文字中（行內）') });
    const mBlock = modes.createEl('button', { text: t('獨立一行（置中）') });
    const setMode = (d: boolean) => { this.display = d; mInline.toggleClass('is-active', !d); mBlock.toggleClass('is-active', d); this.preview(); };
    mInline.addEventListener('click', () => setMode(false));
    mBlock.addEventListener('click', () => setMode(true));
    // 編輯方式：視覺化（分數、根號等顯示成一格一格，可以直接點進去打）或 LaTeX 原始碼
    const edits = top.createDiv('wm-seg wm-eq-modes');
    this.tabVisual = edits.createEl('button', { text: t('視覺化') });
    this.tabLatex = edits.createEl('button', { text: 'LaTeX' });
    this.tabVisual.addEventListener('click', () => this.setEdit('visual'));
    this.tabLatex.addEventListener('click', () => this.setEdit('latex'));
    top.createDiv({ cls: 'wm-eq-hint', text: t('{k} 套用・Esc 取消', { k: key('Mod+Enter') }) });

    // ---- 結構與符號（像 Word 的方程式工具列）：上面選分類，下面是那一類的按鈕
    const palBox = c.createDiv('wm-eq-card wm-eq-palbox');
    const cats = palBox.createDiv('wm-eq-cats');
    const pal = palBox.createDiv('wm-eq-palette');
    const recent: string[] = (this.plugin && this.plugin.settings.recentMath) || [];
    let groups: MathSnippetGroup[] = [];
    const showGroup = (i: number) => {
      pal.empty();
      [...cats.children].forEach((b, j) => b.toggleClass('is-active', i === j));
      const row = pal.createDiv('wm-eq-items');
      for (const [label, snip, raw, named] of groups[i][1]) {
        const b = row.createEl('button', { cls: 'wm-eq-btn' + (named ? ' is-formula' : raw ? ' is-recent' : '') });
        // eslint-disable-next-line no-control-regex -- matching control characters is the purpose of this pattern
        if (raw || /^[\u0000-ɏ]+$/.test(label) && label.length <= 3) b.setText(raw ? label : label); else b.setText(t(label));
        // 按鈕上直接顯示公式的樣子
        if (!raw && /^(\\[a-z]|[\^_])/i.test(snip) && label.length > 1) {
          b.empty();
          b.addClass('is-struct');
          const pv = b.createSpan('wm-eq-btn-math');
          // \tag 在行內的公式裡不會顯示，示意圖改畫成 (1)。字型類的（粗體、空心字、花體、正體）放範例字，
          // 放 □ 的話每個按鈕都只是一個方框，看不出差別；空心字、花體只有大寫字母有定義，所以用 ABC
          const demo = /^\\tag/.test(snip) ? '(1)' : (/^[\^_]/.test(snip) ? 'x' : '') + snip
            .replace(/\\(text|mathrm|mathbf)\{\}/g, '\\$1{abc}').replace(/\\(mathbb|mathcal)\{\}/g, '\\$1{ABC}').replace(/\{\}/g, '{\\square}');
          this.render(demo, pv, false);
          b.createSpan({ cls: 'wm-eq-btn-label', text: t(label) });
        }
        // 最近使用：直接顯示公式的樣子（比一串 LaTeX 好認）
        if (raw) { b.empty(); this.render(snip, b.createSpan('wm-eq-btn-math'), false); }
        // 常用公式的名稱是介面文字（翻譯前的原文）
        if (named) b.createSpan({ cls: 'wm-eq-btn-label', text: named === 'user' ? label : t(label as I18nKey) });
        b.setAttribute('aria-label', snip);
        keepFocus(b);
        b.addEventListener('click', () => (raw ? this.insertRaw(snip) : this.insert(snip)));
      }
    };
    // 分類：最近使用（有的話）、結構與符號、常用公式、我的公式（自己存過才有）
    const buildGroups = () => {
      const mine: SavedTemplate[] = (this.plugin && this.plugin.settings.mathTemplates) || [];
      groups = MATH_SNIPPETS.slice();
      if (recent.length) groups.unshift(['最近使用', recent.map(r => [r.length > 18 ? r.slice(0, 17) + '…' : r, r, true])]);
      groups.push(['常用公式', MATH_FORMULAS.map(([name, latex]) => [name, latex, true, true])]);
      if (mine.length) groups.push(['我的公式', mine.map(x => [x.name, x.src, true, 'user'])]);
      cats.empty();
      groups.forEach(([name], i) => {
        const b = cats.createEl('button', { text: t(name), cls: 'wm-eq-cat' });
        keepFocus(b);
        b.addEventListener('click', () => showGroup(i));
      });
    };
    buildGroups();

    // ---- 編輯區：標題列右邊是視覺化編輯用的按鈕。上一格、下一格、拿掉結構是給螢幕鍵盤用的
    // （沒有方向鍵與 Tab，空格子裡的 Backspace 也常常沒有事件），滑鼠操作時一樣可以按
    const editor = c.createDiv('wm-eq-card wm-eq-editor');
    const head = editor.createDiv('wm-eq-label');
    head.createSpan({ text: t('編輯') });
    const tools = head.createDiv('wm-eq-tools');
    const tool = (icon: string, label: string, run: () => void) => {
      const b = tools.createEl('button', { cls: 'clickable-icon wm-eq-tool' });
      b.setAttribute('aria-label', label);
      setIcon(b, icon);
      keepFocus(b); // 游標留在格子裡，螢幕鍵盤也不會收起來
      b.addEventListener('click', run);
      return b;
    };
    const prev = tool('chevron-left', t('上一格') + ' (Shift+Tab)', () => { this.field.move(-1); });
    const next = tool('chevron-right', t('下一格') + ' (Tab)', () => { this.field.move(1); });
    const strip = tool('delete', t('拿掉游標所在的結構（分數、根號…），內容留著'), () => { this.field.removeStructure(); });
    tools.createSpan('wm-eq-tools-sep');
    this.undoBtn = tool('undo-2', t('復原') + ' (' + key('Mod+Z') + ')', () => { this.field.undo(); });
    this.redoBtn = tool('redo-2', t('取消復原') + ' (' + key('Mod+Y') + ')', () => { this.field.redo(); });
    this.visualTools = [prev, next, strip, this.undoBtn, this.redoBtn];
    this.fieldHost = editor.createDiv('wm-eq-visual');
    this.field = new MathField(this.fieldHost, {
      label: s => t(s),
      // 視覺化編輯的內容隨時寫回 LaTeX（LaTeX 那一格是唯一的來源，套用時讀它）
      onChange: latex => { this.ta.value = latex; this.fieldSrc = latex; window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.preview(), 150); },
      onHistory: (canUndo, canRedo) => { this.undoBtn.disabled = !canUndo; this.redoBtn.disabled = !canRedo; },
    });
    this.fieldHost.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    this.ta = editor.createEl('textarea', { cls: 'wm-eq-input' });
    this.ta.value = this.init.src || '';
    this.ta.rows = 3;
    this.ta.spellcheck = false;
    this.ta.placeholder = t('輸入 LaTeX，例如 E = mc^2，或點上方按鈕插入');
    this.fieldHint = editor.createDiv({ cls: 'wm-eq-visual-hint', text: t('點格子直接輸入。^、_：上標、下標；Tab 或 Enter：下一格；方向鍵：移動；空格子裡按 Backspace：拿掉這個結構；{k}：復原。也可以打 \\frac、\\sqrt、\\alpha 再按空白。', { k: key('Mod+Z') }) });

    // ---- 預覽
    const pvBox = c.createDiv('wm-eq-card');
    const lab = pvBox.createDiv('wm-eq-label');
    lab.createSpan({ text: t('預覽') });
    this.err = lab.createSpan({ cls: 'wm-eq-error' });
    const copy = lab.createEl('button', { cls: 'clickable-icon wm-eq-copy' });
    copy.setAttribute('aria-label', t('複製 LaTeX'));
    setIcon(copy, 'copy');
    copy.addEventListener('click', () => { if (navigator.clipboard) void navigator.clipboard.writeText(this.ta.value.trim()).then(() => new Notice(t('已複製：') + this.ta.value.trim())); });
    // 把目前的方程式存成「我的公式」：按書籤按鈕，在預覽上方打名稱
    const saveRow = pvBox.createDiv('wm-eq-save');
    saveRow.hide();
    const plugin = this.plugin;
    if (plugin) {
      const keep = lab.createEl('button', { cls: 'clickable-icon wm-eq-keep' });
      keep.setAttribute('aria-label', t('存成我的公式'));
      setIcon(keep, 'bookmark-plus');
      let open = false;
      const close = () => { open = false; saveRow.hide(); saveRow.empty(); };
      keep.addEventListener('click', () => {
        if (open) { close(); return; }
        const v = this.ta.value.trim();
        if (!v) { new Notice(t('先輸入方程式再存')); return; }
        open = true;
        saveRow.empty();
        saveRow.show();
        const name = saveRow.createEl('input', { type: 'text', cls: 'wm-eq-save-name' });
        name.value = uniqueName(plugin.settings.mathTemplates || [], t('公式'));
        name.placeholder = t('範本名稱');
        name.setAttribute('aria-label', t('範本名稱'));
        const run = () => {
          const n = name.value.replace(/\s+/g, ' ').trim();
          const src = this.ta.value.trim();
          if (!n) { name.focus(); return; }
          if (!src) return;
          const list = plugin.settings.mathTemplates || [];
          const existed = list.some(x => x.name === n);
          plugin.settings.mathTemplates = saveTemplate(list, n, src);
          void plugin.saveSettings();
          new Notice(t(existed ? '已更新範本「{name}」' : '已存成範本「{name}」', { name: n }));
          close();
          buildGroups();
          showGroup(groups.length - 1);
        };
        saveRow.createEl('button', { text: t('存成我的公式'), cls: 'mod-cta' }).addEventListener('click', run);
        saveRow.createEl('button', { text: t('取消') }).addEventListener('click', close);
        name.addEventListener('keydown', e => {
          if (e.isComposing) return; // 輸入法選字中
          if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); run(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        });
        window.setTimeout(() => { name.focus(); name.select(); }, 0);
      });
    }
    this.prev = pvBox.createDiv('wm-eq-preview');

    const bar = c.createDiv('modal-button-container');
    if (this.init.existing && this.init.onDelete) {
      const del = bar.createEl('button', { text: t('刪除方程式'), cls: 'mod-warning' });
      del.addEventListener('click', () => { this.close(); this.init.onDelete!(); });
    }
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    const ok = bar.createEl('button', { text: this.init.existing ? t('套用') : t('插入'), cls: 'mod-cta' });
    ok.addEventListener('click', () => {
      const v = this.ta.value.trim(); if (!v) return;
      if (this.plugin) {
        const r = [v].concat((this.plugin.settings.recentMath || []).filter((x: string) => x !== v)).slice(0, 12);
        this.plugin.settings.recentMath = r; void this.plugin.saveSettings();
      }
      this.close(); this.onSave(v, this.display);
    });
    this.ta.addEventListener('input', () => { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.preview(), 150); });
    this.ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    showGroup(recent.length && !this.init.src ? 0 : (recent.length ? 1 : 0));
    setMode(this.display);
    this.setEdit(this.plugin && this.plugin.settings.mathMode === 'latex' ? 'latex' : 'visual');
  }
  // 切換編輯方式。切到視覺化時，LaTeX 有改過才重新建立格子（當成可以復原的一步）；
  // 沒有在格子裡改東西就不會動到原本的 LaTeX
  setEdit(mode: EquationEditMode): void {
    this.editMode = mode;
    this.tabVisual.toggleClass('is-active', mode === 'visual');
    this.tabLatex.toggleClass('is-active', mode === 'latex');
    this.fieldHost.toggle(mode === 'visual');
    this.fieldHint.toggle(mode === 'visual');
    for (const b of this.visualTools) b.toggle(mode === 'visual');
    this.ta.toggle(mode === 'latex');
    if (mode === 'visual') {
      if (this.fieldSrc !== this.ta.value) { this.field.setLatex(this.ta.value, this.fieldSrc != null); this.fieldSrc = this.ta.value; }
      window.setTimeout(() => this.field.focus(true), 10);
    } else window.setTimeout(() => { this.ta.focus(); this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length); }, 10);
  }
  insertRaw(text: string): void {
    if (this.editMode === 'visual') { this.field.insert(text); return; }
    const ta = this.ta;
    const a = ta.selectionStart; const b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.focus(); ta.setSelectionRange(a + text.length, a + text.length);
    this.preview();
  }
  insert(snip: string): void {
    if (this.editMode === 'visual') { this.field.insert(snip); return; }
    const ta = this.ta;
    const a = ta.selectionStart; const b = ta.selectionEnd;
    const sel = ta.value.slice(a, b);
    let text = snip; let caret;
    const hole = text.indexOf('{}');
    if (hole >= 0) { text = text.slice(0, hole + 1) + sel + text.slice(hole + 1); caret = a + hole + 1 + sel.length; }
    else { text = (a > 0 && /[A-Za-z]$/.test(ta.value.slice(0, a)) ? ' ' : '') + text + ' '; caret = a + text.length; }
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.focus();
    ta.setSelectionRange(caret, caret);
    this.preview();
  }
  preview(): void {
    if (!this.prev) return;
    this.prev.empty();
    this.err.setText('');
    const v = this.ta.value.trim();
    if (!v) { this.prev.createSpan({ cls: 'wm-eq-empty', text: t('（輸入後顯示預覽）') }); return; }
    // 括號不成對時先提示（MathJax 會顯示紅字）
    let depth = 0;
    for (const ch of v.replace(/\\[{}]/g, '')) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) break; }
    if (depth !== 0) this.err.setText(t('大括號 { } 沒有成對'));
    // 行內的方程式（$…$）不顯示編號：MathJax 直接略過 \tag，預覽與筆記裡都看不到，所以提醒要改成獨立一行
    else if (!this.display && /\\tag\b/.test(v)) this.err.setText(t('編號只會顯示在獨立一行的方程式'));
    this.render(v, this.prev, this.display);
    window.setTimeout(() => { if (this.prev && this.prev.querySelector('mjx-merror, .merror, [data-mjx-error]')) this.err.setText(t('語法錯誤，請檢查 LaTeX')); }, 120);
  }
  onClose(): void { window.clearTimeout(this.timer); this.contentEl.empty(); }
}

// 把 text 放進 el，符合 q（小寫）的那一段用 <mark> 標出來
function markText(el: HTMLElement, text: string, q: string): void {
  el.empty();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) { el.setText(text); return; }
  el.append(text.slice(0, i));
  el.createEl('mark', { cls: 'wm-sc-mark', text: text.slice(i, i + q.length) });
  el.append(text.slice(i + q.length));
}

export class ShortcutModal extends Modal {
  onOpen(): void {
    this.titleEl.setText(t('Word 模式快速鍵'));
    this.modalEl.addClass('wm-shortcuts-modal');
    const c = this.contentEl;
    c.addClass('wm-shortcuts');
    const head = c.createDiv('wm-sc-head');
    const box = head.createDiv('wm-sc-searchbox');
    setIcon(box.createSpan('wm-sc-search-icon'), 'search');
    const search = box.createEl('input', { type: 'search', cls: 'wm-sc-search' });
    search.placeholder = t('搜尋快速鍵或功能…');
    const count = head.createSpan('wm-sc-count');

    // 分類：只看其中一類（手機上卡片排成一欄很長，不必一路捲）。cat 是選中的卡片編號，null 是全部
    let cat: number | null = null;
    const cats = c.createDiv('wm-pills wm-sc-cats');
    cats.setAttribute('role', 'group');
    cats.setAttribute('aria-label', t('快速鍵分類'));
    const catBtns: [id: number | null, btn: HTMLButtonElement][] = [];
    const catBtn = (id: number | null, icon: string, label: string) => {
      const b = cats.createEl('button', { cls: 'wm-pill wm-sc-cat' });
      b.type = 'button';
      setIcon(b.createSpan('wm-pill-icon'), icon);
      b.createSpan({ text: label });
      b.addEventListener('click', () => { cat = id; apply(); });
      catBtns.push([id, b]);
    };
    catBtn(null, 'layout-grid', t('全部'));

    // 卡片分成兩欄各自往下排（每張放進目前比較短的那一欄）：卡片的高度不一樣，排成格線會在矮的卡片下面留下大片空白；
    // 展開示意動畫時也只會推動同一欄。手機只有一欄
    const grid = c.createDiv('wm-sc-grid');
    const cols = Array.from({ length: Platform.isMobile ? 1 : 2 }, () => ({ el: grid.createDiv('wm-sc-col'), rows: 0 }));
    const cards: ShortcutCardEl[] = [];
    // 一次只展開一段示意動畫
    let open: ShortcutRowEl | null = null;
    const setOpen = (r: ShortcutRowEl, on: boolean) => {
      r.row.toggleClass('is-open', on);
      if (r.line) r.line.setAttribute('aria-expanded', on ? 'true' : 'false');
      // 第一次展開時才建立動畫的內容
      if (on && r.demo && r.demoBox && !r.demoBox.hasChildNodes()) buildDemo(r.demo, r.demoBox);
      if (on) open = r; else if (open === r) open = null;
    };
    const toggleDemo = (r: ShortcutRowEl) => {
      const on = open !== r;
      if (open) setOpen(open, false);
      if (on) setOpen(r, true);
    };
    SHORTCUTS.forEach(([group, icon, rows], index) => {
      catBtn(index, icon, t(group));
      const col = cols.reduce((a, b) => (b.rows < a.rows ? b : a));
      // 卡片的標題大約是兩列的高度
      col.rows += rows.length + 2;
      const card = col.el.createDiv('wm-sc-card');
      const h = card.createDiv('wm-sc-card-head');
      setIcon(h.createSpan('wm-sc-icon'), icon);
      h.createSpan({ cls: 'wm-sc-card-title', text: t(group) });
      h.createSpan({ cls: 'wm-sc-card-count', text: String(rows.length) });
      const list: ShortcutRowEl[] = [];
      for (const [k, d, demo] of rows) {
        const row = card.createDiv('wm-sc-row');
        const line = row.createDiv('wm-sc-line');
        const desc = line.createDiv('wm-sc-desc');
        const label = desc.createSpan({ cls: 'wm-sc-label', text: t(d) });
        renderKeys(line, k);
        // k 是按鍵組合（例如 Mod+E），只有少數是說明文字（例如「按一下」）；找不到翻譯時 t() 原樣回傳
        const r: ShortcutRowEl = { row, label, desc: t(d), text: (t(d) + ' ' + t(k as I18nKey) + ' ' + k).toLowerCase() };
        if (demo) {
          row.addClass('has-demo');
          setIcon(desc.createSpan('wm-sc-play'), 'play');
          line.setAttribute('role', 'button');
          line.tabIndex = 0;
          line.setAttribute('aria-expanded', 'false');
          line.setAttribute('title', t('看動畫示範'));
          r.line = line;
          r.demo = demo;
          // 外面兩層負責展開、收合的高度動畫（一層決定高度，一層把超出的部分裁掉），最裡面才是動畫的框
          r.demoBox = row.createDiv('wm-sc-demo-wrap').createDiv('wm-sc-demo-clip').createDiv('wm-hint-demo wm-sc-demo');
          line.addEventListener('click', () => toggleDemo(r));
          line.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDemo(r); } });
        }
        list.push(r);
      }
      cards.push({ card, col: col.el, list, group: t(group).toLowerCase(), index });
    });
    const empty = c.createDiv({ cls: 'wm-sc-empty', text: t('找不到符合的快速鍵') });
    const foot = c.createDiv('wm-sc-foot');
    const hint = foot.createDiv('wm-sc-hint');
    setIcon(hint.createSpan('wm-sc-play'), 'play');
    hint.createSpan({ text: t('有這個記號的項目，按一下可以看動畫示範。') });
    const platform = foot.createDiv('wm-sc-platform');
    setIcon(platform.createSpan('wm-sc-platform-icon'), 'keyboard');
    platform.createSpan({ text: isMac ? t('Mac：Cmd 與 Option') : t('Windows：Ctrl 與 Alt') });

    // 依搜尋文字與選中的分類，決定每一列、每張卡片要不要顯示
    const apply = () => {
      const q = search.value.trim().toLowerCase();
      for (const [id, b] of catBtns) { b.toggleClass('is-active', id === cat); b.setAttribute('aria-pressed', id === cat ? 'true' : 'false'); }
      let total = 0;
      // 還有卡片要顯示的欄；沒有卡片的那一欄收起來，剩下的一欄才會佔滿整個寬度
      const used = new Set<HTMLElement>();
      for (const { card, col, list, group, index } of cards) {
        let n = 0;
        for (const r of list) {
          const ok = (cat == null || cat === index) && (!q || r.text.includes(q) || group.includes(q));
          r.row.toggle(ok);
          if (ok) { n++; markText(r.label, r.desc, q); } else if (open === r) setOpen(r, false);
        }
        card.toggle(n > 0);
        total += n;
        if (n) used.add(col);
      }
      for (const col of cols) col.el.toggle(used.has(col.el));
      empty.toggle(!total);
      hint.toggle(total > 0);
      count.setText(t('{n} 個快速鍵', { n: total }));
    };
    // 打字搜尋是找全部的快速鍵：先前只看某一類的話，回到全部，才不會明明有卻說找不到
    search.addEventListener('input', () => { if (search.value.trim()) cat = null; apply(); });
    apply();
    window.setTimeout(() => search.focus(), 0);
  }
  onClose(): void { this.contentEl.empty(); }
}

// 清理奇怪符號
export class CleanupModal extends Modal {
  declare view: WordModeView;
  constructor(app: App, view: WordModeView) { super(app); this.view = view; }
  onOpen(): void {
    this.titleEl.setText(t('清理奇怪符號'));
    this.modalEl.addClass('wm-cleanup-modal');
    const { contentEl } = this;
    const counts = countWeird(this.view.pm!.state.doc);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    contentEl.createDiv({ cls: 'wm-cleanup-intro', text: total ? t('找到 {n} 個可能有問題的符號。勾選要清除的種類：', { n: total }) : t('沒有找到奇怪符號，這份筆記很乾淨！') });
    if (!total) return;
    const checks: Record<string, HTMLInputElement> = {};
    for (const k of WEIRD_KINDS) {
      const n = counts[k.id] || 0;
      const row = contentEl.createEl('label', { cls: 'wm-cleanup-row' + (n ? '' : ' is-empty') });
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = !!n && k.def; cb.disabled = !n;
      checks[k.id] = cb;
      row.createSpan({ cls: 'wm-cleanup-sample wm-weird wm-weird-' + k.id, text: SAMPLE[k.id] });
      row.createSpan({ cls: 'wm-cleanup-label', text: t(k.label) });
      row.createSpan({ cls: 'wm-cleanup-count', text: String(n) });
      if (n) {
        const go = row.createEl('button', { cls: 'clickable-icon wm-cleanup-go' });
        go.setAttribute('aria-label', t('跳到第一個'));
        setIcon(go, 'arrow-right');
        go.addEventListener('click', e => { e.preventDefault(); this.close(); this.view.jumpToWeird(k.id); });
      }
    }
    contentEl.createDiv({ cls: 'wm-cleanup-note', text: t('「落單的引號」與「殘留的 Markdown 符號」是推測的，建議先開啟編輯標記（¶）看一下再清除。可以用 Ctrl+Z 復原。').replace('Ctrl', key('Mod')) });
    const btns = contentEl.createDiv('modal-button-container');
    const marks = btns.createEl('button', { text: t('標示出來（開啟編輯標記）') });
    marks.addEventListener('click', () => { this.close(); this.view.setMarks(true); });
    const ok = btns.createEl('button', { text: t('清除勾選的符號'), cls: 'mod-cta' });
    ok.addEventListener('click', () => {
      const kinds = Object.keys(checks).filter(k => checks[k].checked);
      const tr = kinds.length ? cleanWeird(this.view.pm!.state, kinds) : null;
      this.close();
      if (tr) { this.view.pm!.dispatch(tr); new Notice(t('已清除，Ctrl+Z 可以復原').replace('Ctrl', key('Mod'))); }
      this.view.pm!.focus();
    });
  }
  onClose(): void { this.contentEl.empty(); }
}

export const SAMPLE: Record<WeirdKindId, string> = { zw: '␣', ctrl: '␣', nbsp: '·', repl: '�', md: '**', quote: '"', space: '··' };

// 字數統計視窗的每一列：整份文件，有選取時再加一欄選取範圍
export function wordCountRows(all: WordStats, sel: WordStats | null): WordCountRow[] {
  const f = (n: number) => n.toLocaleString();
  const row = (label: string, k: keyof WordStats): WordCountRow => [label, f(all[k]), sel ? f(sel[k]) : null];
  const rows: WordCountRow[] = [];
  if (sel) rows.push(['', t('整份文件'), t('選取範圍')]);
  rows.push(row(t('字數'), 'words'), row(t('字元數（不含空白）'), 'chars'), row(t('字元數（含空白）'), 'charsSp'),
    row(t('段落數'), 'paras'), row(t('標題數'), 'heads'), row(t('表格'), 'tables'), row(t('圖片'), 'images'), row(t('連結'), 'links'));
  rows.push([t('預估閱讀時間'), t('{n} 分鐘', { n: all.minutes }), sel ? t('{n} 分鐘', { n: sel.minutes }) : null]);
  return rows;
}

// 字數統計（像 Word 的「字數統計」視窗）
export class WordCountModal extends Modal {
  declare rows: WordCountRow[];
  constructor(app: App, rows: WordCountRow[]) { super(app); this.rows = rows; }
  onOpen(): void {
    this.titleEl.setText(t('字數統計'));
    const table = this.contentEl.createEl('table', { cls: 'wm-count-table' });
    for (const [label, a, b] of this.rows) {
      const tr = table.createEl('tr');
      tr.createEl('td', { text: label });
      tr.createEl('td', { text: a, cls: 'wm-count-num' });
      if (b != null) tr.createEl('td', { text: b, cls: 'wm-count-num wm-count-sel' });
    }
    this.contentEl.createDiv({ cls: 'wm-count-note', text: t('中文、日文、韓文以字計；英文與數字以單字計。') });
  }
  onClose(): void { this.contentEl.empty(); }
}

