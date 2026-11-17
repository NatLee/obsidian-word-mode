// Word 模式的對話框：原文編輯、輸入框、超連結、檔案選擇、快速鍵說明、方程式編輯器、清理符號、字數統計
import { Modal, FuzzySuggestModal, Notice, setIcon } from 'obsidian';
import { countWeird, cleanWeird, WEIRD_KINDS } from './marks.js';
import { MathField } from './mathvisual.js';
import { t, key, isMac } from './i18n.js';

export class SourceModal extends Modal {
  constructor(app, title, value, onSave) { super(app); this.titleText = title; this.value = value; this.onSave = onSave; }
  onOpen() {
    this.titleEl.setText(this.titleText);
    const ta = this.contentEl.createEl('textarea', { cls: 'wm-source-input' });
    ta.value = this.value;
    ta.rows = Math.min(20, Math.max(4, this.value.split('\n').length + 1));
    const bar = this.contentEl.createDiv('modal-button-container');
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    const ok = bar.createEl('button', { text: t('套用'), cls: 'mod-cta' });
    ok.addEventListener('click', () => { this.close(); this.onSave(ta.value); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    setTimeout(() => ta.focus(), 10);
  }
  onClose() { this.contentEl.empty(); }
}

export class PromptModal extends Modal {
  constructor(app, title, value, placeholder, onSave) { super(app); this.titleText = title; this.value = value; this.placeholder = placeholder; this.onSave = onSave; }
  onOpen() {
    this.titleEl.setText(this.titleText);
    const i = this.contentEl.createEl('input', { type: 'text', cls: 'wm-prompt-input' });
    i.value = this.value || '';
    i.placeholder = this.placeholder || '';
    const bar = this.contentEl.createDiv('modal-button-container');
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    const ok = bar.createEl('button', { text: t('確定'), cls: 'mod-cta' });
    ok.addEventListener('click', () => { this.close(); this.onSave(i.value); });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    setTimeout(() => { i.focus(); i.select(); }, 10);
  }
  onClose() { this.contentEl.empty(); }
}

// 插入／編輯超連結：可以連到網址，或搜尋保管庫裡的筆記與檔案
export class LinkDialog extends Modal {
  // init: { text, mode: 'url'|'file', href, file, existing }
  constructor(app, view, init, onSave, onRemove) {
    super(app); this.view = view; this.init = init; this.onSave = onSave; this.onRemove = onRemove;
    this.mode = init.mode || 'url';
    this.selected = init.file || null;
    this.results = [];
    this.active = 0;
  }
  onOpen() {
    const c = this.contentEl;
    c.addClass('wm-link-dialog');
    this.titleEl.setText(this.init.existing ? t('編輯超連結') : t('插入超連結'));
    const row = (label) => { const d = c.createDiv('wm-form-row'); d.createEl('label', { text: label }); return d; };
    this.text = row(t('顯示文字')).createEl('input', { type: 'text' });
    this.text.value = this.init.text || '';
    this.text.placeholder = t('（留白則顯示網址或筆記名稱）');

    const tabs = c.createDiv('wm-link-tabs');
    const tab = (icon, label) => {
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
    if (this.init.existing && this.onRemove) bar.createEl('button', { text: t('移除連結'), cls: 'mod-warning' }).addEventListener('click', () => { this.close(); this.onRemove(); });
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    this.ok = bar.createEl('button', { text: t('確定'), cls: 'mod-cta' });
    this.ok.addEventListener('click', () => this.submit());

    const keys = e => {
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
  setMode(m) {
    this.mode = m;
    this.tabUrl.toggleClass('is-active', m === 'url');
    this.tabFile.toggleClass('is-active', m === 'file');
    this.urlPane.style.display = m === 'url' ? '' : 'none';
    this.filePane.style.display = m === 'file' ? '' : 'none';
    setTimeout(() => (this.init.text || this.text.value ? (m === 'url' ? this.href : this.query) : this.text).focus(), 10);
    if (m === 'file') this.search();
  }
  search() {
    const q = this.query.value.trim().toLowerCase();
    const files = this.app.vault.getFiles().filter(f => !f.path.startsWith(this.app.vault.configDir + '/') && f !== this.view.file);
    const score = f => {
      const b = f.basename.toLowerCase(); const p = f.path.toLowerCase();
      if (!q) return f.extension === 'md' ? 1 : 0;
      if (b === q) return 100;
      if (b.startsWith(q)) return 80;
      if (b.includes(q)) return 60;
      if (p.includes(q)) return 40;
      return q.split(/\s+/).every(tv => p.includes(tv)) ? 20 : -1;
    };
    this.results = files.map(f => [score(f), f]).filter(x => x[0] >= 0).map(x => [x[0] + (x[1].extension === 'md' ? 5 : 0), x[1]])
      .sort((a, b) => b[0] - a[0] || a[1].path.length - b[1].path.length).slice(0, 8).map(x => x[1]);
    this.active = 0;
    this.renderList();
  }
  renderList() {
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
  pick(f) { this.selected = f; this.query.value = f.basename; this.renderList(); this.ok.focus(); }
  submit() {
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
  onClose() { this.contentEl.empty(); }
}

export class FilePicker extends FuzzySuggestModal {
  constructor(app, files, placeholder, onChoose) { super(app); this.files = files; this.onChooseFile = onChoose; this.setPlaceholder(placeholder); }
  getItems() { return this.files; }
  getItemText(f) { return f.path; }
  onChooseItem(f) { this.onChooseFile(f); }
}

// 快速鍵說明：Mod 顯示成 Ctrl 或 Cmd，文字在顯示時才翻譯；多個組合用「／」分開
export const SHORTCUTS = [
  ['檢視', 'eye', [['Mod+E', 'Word 模式 ⇄ Markdown 編輯（在 Markdown 畫面再按一次切回）'], ['Mod+滑鼠滾輪', '放大／縮小頁面'], ['Mod+/', '快速鍵說明']]],
  ['文字格式', 'bold', [['Mod+B', '粗體'], ['Mod+I', '斜體'], ['Mod+U', '底線'], ['Mod+Shift+X', '刪除線'], ['Mod+Shift+H', '醒目提示（螢光筆）'], ['Mod+`', '行內程式碼'], ['（沒有選取時）', '格式套用到游標所在的詞']]],
  ['段落', 'pilcrow', [['Mod+Alt+1～6', '標題 1～6'], ['Mod+Alt+0', '內文'], ['Mod+L／Mod+J', '靠左／左右對齊（置中、靠右在工具列）'], ['Tab', '段落開頭：首行縮排兩個字'], ['Alt+↑／Alt+↓', '上下移動段落、清單項目或表格列'], ['Shift+Enter', '同一段落內換行']]],
  ['表格', 'table', [['Tab／Shift+Tab', '下一格／上一格（最後一格按 Tab 新增一列）'], ['Enter', '儲存格內換行'], ['貼上 Excel 範圍', '建立表格，或從目前儲存格開始填入']]],
  ['連結與插入', 'link', [['Mod+K', '插入／編輯超連結'], ['Mod+點擊', '開啟連結'], ['選取文字後貼上網址', '把文字變成超連結']]],
  ['尋找與編輯', 'search', [['Mod+F', '尋找'], ['Mod+H', '取代'], ['Mod+Z／Mod+Y', '復原／取消復原'], ['Mod+Shift+V', '貼上純文字'], ['Mod+S', '立即存檔'], ['Esc', '關閉尋找、結束格式刷']]],
  ['格式刷', 'paintbrush', [['按一下', '刷一次'], ['按兩下', '連續刷，按 Esc 或再按一次結束']]],
];

export const KEY_NAMES = { Mod: () => key('Mod'), Alt: () => key('Alt'), Shift: () => 'Shift', Enter: () => 'Enter', Esc: () => 'Esc', Tab: () => 'Tab' };

// 'Mod+Shift+V' → [Ctrl] + [Shift] + [V]；沒有 + 的說明文字（例如「按一下」）照樣顯示
function renderKeys(parent, combo) {
  const box = parent.createDiv('wm-sc-keys');
  combo.split('／').forEach((alt, i) => {
    if (i) box.createSpan({ cls: 'wm-sc-or', text: '/' });
    const parts = alt.split('+');
    const isText = parts.length === 1 && !/^(Tab|Enter|Esc|Shift)$/.test(alt) && !/^[A-Z0-9`\/]$/.test(alt);
    if (isText) { box.createSpan({ cls: 'wm-sc-text', text: t(alt) }); return; }
    parts.forEach((p, j) => {
      if (j) box.createSpan({ cls: 'wm-sc-plus', text: '+' });
      const name = KEY_NAMES[p] ? KEY_NAMES[p]() : t(p);
      box.createEl('kbd', { text: name, cls: /[㐀-鿿]/.test(p) ? 'is-mouse' : '' });
    });
  });
}

export const MATH_SNIPPETS = [
  ['結構', [['分數', '\\frac{}{}'], ['根號', '\\sqrt{}'], ['n 次方根', '\\sqrt[n]{}'], ['上標', '^{}'], ['下標', '_{}'], ['上下標', '_{}^{}'], ['括號', '\\left( \\right)'], ['中括號', '\\left[ \\right]'], ['大括號', '\\left\\{ \\right\\}'], ['絕對值', '\\left| \\right|'], ['矩陣', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'], ['分段函數', '\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}'], ['多行對齊', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}'], ['編號', '\\tag{1}'], ['文字', '\\text{}']]],
  ['運算', [['總和', '\\sum_{i=1}^{n}'], ['積分', '\\int_{a}^{b}'], ['重積分', '\\iint_{D}'], ['極限', '\\lim_{x \\to \\infty}'], ['乘積', '\\prod_{i=1}^{n}'], ['微分', '\\frac{d}{dx}'], ['偏微分', '\\frac{\\partial }{\\partial x}'], ['組合', '\\binom{n}{k}'], ['最大', '\\max'], ['最小', '\\min'], ['對數', '\\log'], ['自然對數', '\\ln'], ['指數', 'e^{}'], ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan']]],
  ['標記', [['向量', '\\vec{}'], ['平均', '\\bar{}'], ['估計', '\\hat{}'], ['波浪', '\\tilde{}'], ['一階導數', '\\dot{}'], ['二階導數', '\\ddot{}'], ['上括號', '\\overbrace{}^{}'], ['下括號', '\\underbrace{}_{}'], ['粗體', '\\mathbf{}'], ['空心字', '\\mathbb{}'], ['正體', '\\mathrm{}'], ['花體', '\\mathcal{}']]],
  ['關係', [['±', '\\pm'], ['×', '\\times'], ['÷', '\\div'], ['·', '\\cdot'], ['≤', '\\le'], ['≥', '\\ge'], ['≠', '\\ne'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∝', '\\propto'], ['∼', '\\sim'], ['≪', '\\ll'], ['≫', '\\gg']]],
  ['集合與邏輯', [['∈', '\\in'], ['∉', '\\notin'], ['⊂', '\\subset'], ['⊆', '\\subseteq'], ['∪', '\\cup'], ['∩', '\\cap'], ['∅', '\\emptyset'], ['∀', '\\forall'], ['∃', '\\exists'], ['¬', '\\neg'], ['∧', '\\land'], ['∨', '\\lor'], ['ℝ', '\\mathbb{R}'], ['ℕ', '\\mathbb{N}']]],
  ['箭頭與其他', [['→', '\\to'], ['←', '\\leftarrow'], ['⇒', '\\Rightarrow'], ['⇔', '\\Leftrightarrow'], ['↦', '\\mapsto'], ['∞', '\\infty'], ['∂', '\\partial'], ['∇', '\\nabla'], ['…', '\\ldots'], ['⋯', '\\cdots'], ['°', '^\\circ'], ['′', "'"]]],
  ['希臘字母', [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\epsilon'], ['η', '\\eta'], ['θ', '\\theta'], ['λ', '\\lambda'], ['μ', '\\mu'], ['ν', '\\nu'], ['π', '\\pi'], ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['φ', '\\phi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'], ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'], ['Ω', '\\Omega']]],
];

// 方程式編輯器：上方分類按鈕、輸入框、即時預覽（含語法錯誤提示）、最近使用
export class EquationModal extends Modal {
  constructor(app, init, render, onSave, plugin) {
    super(app); this.init = init; this.render = render; this.onSave = onSave; this.plugin = plugin; this.display = !!init.display;
  }
  onOpen() {
    this.titleEl.setText(this.init.existing ? t('編輯方程式') : t('插入方程式'));
    this.modalEl.addClass('wm-eq-modal');
    const c = this.contentEl;
    c.addClass('wm-eq');
    const top = c.createDiv('wm-eq-top');
    const modes = top.createDiv('wm-link-tabs');
    const mInline = modes.createEl('button', { text: t('文字中（行內）') });
    const mBlock = modes.createEl('button', { text: t('獨立一行（置中）') });
    const setMode = d => { this.display = d; mInline.toggleClass('is-active', !d); mBlock.toggleClass('is-active', d); this.preview(); };
    mInline.addEventListener('click', () => setMode(false));
    mBlock.addEventListener('click', () => setMode(true));
    // 編輯方式：視覺化（分數、根號等顯示成一格一格，可以直接點進去打）或 LaTeX 原始碼
    const edits = top.createDiv('wm-link-tabs wm-eq-modes');
    this.tabVisual = edits.createEl('button', { text: t('視覺化') });
    this.tabLatex = edits.createEl('button', { text: 'LaTeX' });
    this.tabVisual.addEventListener('click', () => this.setEdit('visual'));
    this.tabLatex.addEventListener('click', () => this.setEdit('latex'));
    top.createDiv({ cls: 'wm-eq-hint', text: t('{k} 套用・Esc 取消', { k: key('Mod+Enter') }) });
    // 分類（像 Word 的方程式工具列）
    const cats = c.createDiv('wm-eq-cats');
    const pal = c.createDiv('wm-eq-palette');
    const recent = (this.plugin && this.plugin.settings.recentMath) || [];
    const groups = MATH_SNIPPETS.slice();
    if (recent.length) groups.unshift(['最近使用', recent.map(r => [r.length > 18 ? r.slice(0, 17) + '…' : r, r, true])]);
    const showGroup = i => {
      pal.empty();
      [...cats.children].forEach((b, j) => b.toggleClass('is-active', i === j));
      const row = pal.createDiv('wm-eq-items');
      for (const [label, snip, raw] of groups[i][1]) {
        const b = row.createEl('button', { cls: 'wm-eq-btn' + (raw ? ' is-recent' : '') });
        if (raw || /^[\u0000-ɏ]+$/.test(label) && label.length <= 3) b.setText(raw ? label : label); else b.setText(t(label));
        // 按鈕上直接顯示公式的樣子
        if (!raw && /^(\\[a-z]|[\^_])/i.test(snip) && label.length > 1) {
          b.empty();
          const pv = b.createSpan('wm-eq-btn-math');
          const demo = (/^[\^_]/.test(snip) ? 'x' : '') + snip.replace(/\\(text|mathrm)\{\}/g, '\\$1{abc}').replace(/\{\}/g, '{\\square}');
          this.render(demo, pv, false);
          b.createSpan({ cls: 'wm-eq-btn-label', text: t(label) });
        }
        b.setAttribute('aria-label', snip);
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => (raw ? this.insertRaw(snip) : this.insert(snip)));
      }
    };
    groups.forEach(([name], i) => {
      const b = cats.createEl('button', { text: t(name), cls: 'wm-eq-cat' });
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => showGroup(i));
    });
    this.fieldHost = c.createDiv('wm-eq-visual');
    this.field = new MathField(this.fieldHost, {
      label: s => t(s),
      // 視覺化編輯的內容隨時寫回 LaTeX（LaTeX 那一格是唯一的來源，套用時讀它）
      onChange: latex => { this.ta.value = latex; clearTimeout(this.timer); this.timer = setTimeout(() => this.preview(), 150); },
    });
    this.fieldHost.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    this.fieldHint = c.createDiv({ cls: 'wm-eq-visual-hint', text: t('點格子直接輸入；按 ^ 或 _ 加上標、下標；Tab 跳到下一格；格子開頭按 Backspace 刪除前面的結構。') });
    this.ta = c.createEl('textarea', { cls: 'wm-eq-input' });
    this.ta.value = this.init.src || '';
    this.ta.rows = 3;
    this.ta.spellcheck = false;
    this.ta.placeholder = t('輸入 LaTeX，例如 E = mc^2，或點上方按鈕插入');
    const lab = c.createDiv('wm-eq-label');
    lab.createSpan({ text: t('預覽') });
    this.err = lab.createSpan({ cls: 'wm-eq-error' });
    const copy = lab.createEl('button', { cls: 'clickable-icon wm-eq-copy' });
    copy.setAttribute('aria-label', t('複製 LaTeX'));
    setIcon(copy, 'copy');
    copy.addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(this.ta.value.trim()).then(() => new Notice(t('已複製：') + this.ta.value.trim())));
    this.prev = c.createDiv('wm-eq-preview');
    const bar = c.createDiv('modal-button-container');
    if (this.init.existing && this.init.onDelete) {
      const del = bar.createEl('button', { text: t('刪除方程式'), cls: 'mod-warning' });
      del.addEventListener('click', () => { this.close(); this.init.onDelete(); });
    }
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    const ok = bar.createEl('button', { text: this.init.existing ? t('套用') : t('插入'), cls: 'mod-cta' });
    ok.addEventListener('click', () => {
      const v = this.ta.value.trim(); if (!v) return;
      if (this.plugin) {
        const r = [v].concat((this.plugin.settings.recentMath || []).filter(x => x !== v)).slice(0, 12);
        this.plugin.settings.recentMath = r; this.plugin.saveSettings();
      }
      this.close(); this.onSave(v, this.display);
    });
    this.ta.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.preview(), 150); });
    this.ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ok.click(); } });
    showGroup(recent.length && !this.init.src ? 0 : (recent.length ? 1 : 0));
    setMode(this.display);
    this.setEdit(this.plugin && this.plugin.settings.mathMode === 'latex' ? 'latex' : 'visual');
  }
  // 切換編輯方式。切到視覺化時用目前的 LaTeX 建立格子；沒有在格子裡改東西就不會動到原本的 LaTeX
  setEdit(mode) {
    this.editMode = mode;
    this.tabVisual.toggleClass('is-active', mode === 'visual');
    this.tabLatex.toggleClass('is-active', mode === 'latex');
    this.fieldHost.toggle(mode === 'visual');
    this.fieldHint.toggle(mode === 'visual');
    this.ta.toggle(mode === 'latex');
    if (mode === 'visual') { this.field.setLatex(this.ta.value); setTimeout(() => this.field.focus(true), 10); }
    else setTimeout(() => { this.ta.focus(); this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length); }, 10);
  }
  insertRaw(text) {
    if (this.editMode === 'visual') { this.field.insert(text); return; }
    const ta = this.ta;
    const a = ta.selectionStart; const b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.focus(); ta.setSelectionRange(a + text.length, a + text.length);
    this.preview();
  }
  insert(snip) {
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
  preview() {
    if (!this.prev) return;
    this.prev.empty();
    this.err.setText('');
    const v = this.ta.value.trim();
    if (!v) { this.prev.createSpan({ cls: 'wm-eq-empty', text: t('（輸入後顯示預覽）') }); return; }
    // 括號不成對時先提示（MathJax 會顯示紅字）
    let depth = 0;
    for (const ch of v.replace(/\\[{}]/g, '')) { if (ch === '{') depth++; else if (ch === '}') depth--; if (depth < 0) break; }
    if (depth !== 0) this.err.setText(t('大括號 { } 沒有成對'));
    this.render(v, this.prev, this.display);
    setTimeout(() => { if (this.prev && this.prev.querySelector('mjx-merror, .merror, [data-mjx-error]')) this.err.setText(t('語法錯誤，請檢查 LaTeX')); }, 120);
  }
  onClose() { clearTimeout(this.timer); this.contentEl.empty(); }
}

export class ShortcutModal extends Modal {
  onOpen() {
    this.titleEl.setText(t('Word 模式快速鍵'));
    this.modalEl.addClass('wm-shortcuts-modal');
    const c = this.contentEl;
    c.addClass('wm-shortcuts');
    const head = c.createDiv('wm-sc-head');
    const search = head.createEl('input', { type: 'search', cls: 'wm-sc-search' });
    search.placeholder = t('搜尋快速鍵或功能…');
    head.createDiv({ cls: 'wm-sc-platform', text: isMac ? t('Mac：Cmd 與 Option') : t('Windows：Ctrl 與 Alt') });
    const grid = c.createDiv('wm-sc-grid');
    const cards = [];
    for (const [group, icon, rows] of SHORTCUTS) {
      const card = grid.createDiv('wm-sc-card');
      const h = card.createDiv('wm-sc-card-head');
      setIcon(h.createSpan('wm-sc-icon'), icon);
      h.createSpan({ text: t(group) });
      const list = [];
      for (const [k, d] of rows) {
        const row = card.createDiv('wm-sc-row');
        row.createDiv({ cls: 'wm-sc-desc', text: t(d) });
        renderKeys(row, k);
        list.push({ row, text: (t(d) + ' ' + t(k) + ' ' + k).toLowerCase() });
      }
      cards.push({ card, list, group: t(group).toLowerCase() });
    }
    const empty = c.createDiv({ cls: 'wm-sc-empty', text: t('找不到符合的快速鍵') });
    empty.hide();
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let any = false;
      for (const { card, list, group } of cards) {
        let n = 0;
        for (const { row, text } of list) { const ok = !q || text.includes(q) || group.includes(q); row.toggle(ok); if (ok) n++; }
        card.toggle(n > 0); if (n) any = true;
      }
      empty.toggle(!any);
    });
    setTimeout(() => search.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

// 清理奇怪符號
export class CleanupModal extends Modal {
  constructor(app, view) { super(app); this.view = view; }
  onOpen() {
    this.titleEl.setText(t('清理奇怪符號'));
    this.modalEl.addClass('wm-cleanup-modal');
    const { contentEl } = this;
    const counts = countWeird(this.view.pm.state.doc);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    contentEl.createDiv({ cls: 'wm-cleanup-intro', text: total ? t('找到 {n} 個可能有問題的符號。勾選要清除的種類：', { n: total }) : t('沒有找到奇怪符號，這份筆記很乾淨！') });
    if (!total) return;
    const checks = {};
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
      const tr = kinds.length ? cleanWeird(this.view.pm.state, kinds) : null;
      this.close();
      if (tr) { this.view.pm.dispatch(tr); new Notice(t('已清除，Ctrl+Z 可以復原').replace('Ctrl', key('Mod'))); }
      this.view.pm.focus();
    });
  }
  onClose() { this.contentEl.empty(); }
}

export const SAMPLE = { zw: '␣', ctrl: '␣', nbsp: '·', repl: '�', md: '**', quote: '"', space: '··' };

// 字數統計（像 Word 的「字數統計」視窗）
export class WordCountModal extends Modal {
  constructor(app, rows) { super(app); this.rows = rows; }
  onOpen() {
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
  onClose() { this.contentEl.empty(); }
}

