// Markdown 編輯與閱讀模式上方的工具列（設定「切換到 Markdown／閱讀模式時保留工具列」）
// 編輯模式用 Obsidian 編輯器的指令；閱讀模式只能檢視，編輯按鈕會停用並說明原因
import { MarkdownView, setIcon, Menu } from 'obsidian';
import { t, key } from './i18n.js';
import { attachHint, hideHint } from './hints.js';
import { CODE_LANGUAGES } from './commands.js';
import { el } from './dom.js';

// 在選取文字前後加上（或拿掉）符號
function wrap(editor, open, close = open) {
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
function linePrefix(editor, re, prefix) {
  const a = editor.getCursor('from').line; const b = editor.getCursor('to').line;
  for (let l = a; l <= b; l++) {
    const text = editor.getLine(l);
    const next = text.replace(re, '');
    editor.setLine(l, prefix + next);
  }
}

const HEAD_RE = /^#{1,6}\s+/;

export class MarkdownBar {
  constructor(plugin, view) {
    this.plugin = plugin;
    this.view = view;
    this.app = plugin.app;
    const S = plugin.settings;
    this.layout = S.ribbonLayout === 'tabs' ? 'wrap' : (S.ribbonLayout || 'wrap');
    this.buttonStyle = S.buttonStyle || 'auto';
    this.richHints = !!S.richHints;
    this.hidden = new Set(S.hiddenGroups || []);
    this.dom = el('div', 'wm-ribbon wm-mdbar wm-layout-' + this.layout + ' wm-btnstyle-' + this.buttonStyle);
    view.containerEl.insertBefore(this.dom, view.contentEl);
    this.items = [];
    this.mode = null;
    this.render();
  }

  destroy() { hideHint(); this.dom.remove(); }

  get editor() { return this.view.editor; }
  isReading() { return this.view.getMode && this.view.getMode() === 'preview'; }

  cmd(id) { return () => this.app.commands.executeCommandById(id); }

  render() {
    this.dom.replaceChildren();
    this.items = [];
    this.mode = this.isReading() ? 'preview' : 'source';
    const bar = el('div', 'wm-toolbar', this.dom);
    const group = id => (this.hidden.has(id) ? null : el('div', 'wm-group wm-group-' + id, bar));
    const E = fn => () => { const ed = this.editor; if (ed) { fn(ed); ed.focus(); } };

    let g = group('views');
    this.button(g, { icon: 'file-text', title: '切換到 Word 模式', keys: this.plugin.settings.ctrlE !== false ? 'Mod+E' : null, label: 'Word 模式', demo: 'markdown', desc: '用 Word 模式編輯這份筆記。', run: () => this.plugin.switchToWord(this.view.leaf), always: true });
    this.button(g, { icon: 'code-2', title: 'Markdown 編輯', label: 'Markdown', active: () => this.mode === 'source', run: () => this.setMode('source'), always: true });
    this.button(g, { icon: 'book-open', title: '閱讀模式', label: '閱讀', demo: 'reading', active: () => this.mode === 'preview', run: () => this.setMode('preview'), always: true });

    g = group('undo');
    this.button(g, { icon: 'undo-2', title: '復原', keys: 'Mod+Z', run: E(ed => ed.undo()) });
    this.button(g, { icon: 'redo-2', title: '取消復原', keys: 'Mod+Y', run: E(ed => ed.redo()) });

    g = group('styles');
    this.button(g, { icon: 'heading', title: '段落樣式', demo: 'style', desc: '把這一行改成標題 1～6 或內文。', run: (e, b) => this.headingMenu(b) });

    g = group('font');
    this.button(g, { icon: 'bold', title: '粗體', keys: 'Mod+B', demo: 'bold', run: E(ed => wrap(ed, '**')) });
    this.button(g, { icon: 'italic', title: '斜體', keys: 'Mod+I', demo: 'italic', run: E(ed => wrap(ed, '*')) });
    this.button(g, { icon: 'underline', title: '底線', demo: 'underline', run: E(ed => wrap(ed, '<u>', '</u>')) });
    this.button(g, { icon: 'strikethrough', title: '刪除線', demo: 'strike', run: E(ed => wrap(ed, '~~')) });
    this.button(g, { icon: 'highlighter', title: '醒目提示', demo: 'highlight', run: E(ed => wrap(ed, '==')) });
    this.button(g, { icon: 'superscript', title: '上標', demo: 'sup', run: E(ed => wrap(ed, '<sup>', '</sup>')) });
    this.button(g, { icon: 'subscript', title: '下標', demo: 'sub', run: E(ed => wrap(ed, '<sub>', '</sub>')) });
    this.button(g, { icon: 'code', title: '行內程式碼', demo: 'code', run: E(ed => wrap(ed, '`')) });

    g = group('paragraph');
    this.button(g, { icon: 'list', title: '項目符號', demo: 'bullet', run: this.cmd('editor:toggle-bullet-list') });
    this.button(g, { icon: 'list-ordered', title: '編號', demo: 'ordered', run: this.cmd('editor:toggle-numbered-list') });
    this.button(g, { icon: 'list-checks', title: '核取清單', demo: 'task', run: this.cmd('editor:toggle-checklist-status') });
    this.button(g, { icon: 'indent-decrease', title: '減少縮排', demo: 'outdent', run: this.cmd('editor:unindent-list') });
    this.button(g, { icon: 'indent-increase', title: '增加縮排', demo: 'indent', run: this.cmd('editor:indent-list') });
    this.button(g, { icon: 'quote', title: '引文', demo: 'quote', run: this.cmd('editor:toggle-blockquote') });

    g = group('links');
    this.button(g, { icon: 'link', title: '超連結', demo: 'link', run: this.cmd('editor:insert-link') });
    this.button(g, { icon: 'file-symlink', title: '連結到筆記', demo: 'notelink', run: this.cmd('editor:insert-wikilink') });
    g = group('text');
    this.button(g, { icon: 'table', title: '插入表格', demo: 'table', run: this.cmd('editor:insert-table') });
    this.button(g, { icon: 'info', title: '插入提示框', demo: 'callout', run: this.cmd('editor:insert-callout') });
    this.button(g, { icon: 'square-code', title: '插入程式碼區塊', demo: 'codeblock', run: (e, b) => this.codeMenu(b) });
    this.button(g, { icon: 'sigma', title: '插入方程式', demo: 'equation', run: E(ed => { const s = ed.getSelection(); ed.replaceSelection('$' + (s || 'x^2') + '$'); }) });
    this.button(g, { icon: 'message-square', title: '插入註解', demo: 'comment', run: this.cmd('editor:toggle-comments') });
    this.button(g, { icon: 'minus', title: '水平線', demo: 'hr', run: E(ed => { const c = ed.getCursor(); ed.replaceRange('\n---\n', { line: c.line, ch: ed.getLine(c.line).length }); }) });

    g = group('editing');
    this.button(g, { icon: 'search', title: '尋找', keys: 'Mod+F', demo: 'find', run: this.cmd('editor:open-search'), always: true });
    this.button(g, { icon: 'replace', title: '取代', keys: 'Mod+H', demo: 'replace', run: this.cmd('editor:open-search-replace') });

    g = group('show');
    this.button(g, { icon: 'list-tree', title: '大綱', demo: 'outline', run: () => this.plugin.toggleOutline(), active: () => this.plugin.outlineOpen(), always: true });
    this.button(g, { icon: 'chevrons-down-up', title: '摺疊全部標題', demo: 'fold', run: this.cmd('editor:fold-all') });
    this.button(g, { icon: 'chevrons-up-down', title: '展開全部標題', demo: 'unfold', run: this.cmd('editor:unfold-all') });
    g = group('help');
    this.button(g, { icon: 'settings', title: 'Word 模式設定', run: () => this.plugin.openSettings(), always: true });
    for (const x of bar.querySelectorAll('.wm-group')) if (!x.childElementCount) x.remove();
    this.update();
  }

  button(parent, spec) {
    if (!parent) return null;
    const title = spec.keys ? t(spec.title) + ' (' + key(spec.keys) + ')' : t(spec.title);
    const showLabel = this.buttonStyle === 'label' || (this.buttonStyle === 'auto' && spec.big);
    const b = el('button', 'wm-btn' + (showLabel && spec.label ? ' has-label' : ''), parent);
    b.type = 'button';
    el('span', 'wm-sr', b);
    const i = el('span', 'wm-btn-icon', b);
    setIcon(i, spec.icon);
    if (showLabel && spec.label) el('span', 'wm-btn-label', b, t(spec.label));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); hideHint(); if (b.classList.contains('is-disabled')) return; spec.run(e, b); setTimeout(() => this.update(), 50); });
    const it = { dom: b, spec, title };
    this.items.push(it);
    if (this.richHints) {
      b.querySelector('.wm-sr').textContent = title;
      attachHint(b, () => ({ title: t(spec.title), keys: spec.keys ? key(spec.keys) : null, desc: spec.desc ? t(spec.desc) : null, demo: spec.demo, reason: it.reason }));
    } else b.setAttribute('aria-label', title);
    return b;
  }

  update() {
    const reading = this.isReading();
    if ((reading ? 'preview' : 'source') !== this.mode) { this.render(); return; }
    for (const it of this.items) {
      const off = reading && !it.spec.always;
      it.dom.classList.toggle('is-disabled', off);
      it.reason = off ? t('閱讀模式不能編輯：按「Markdown」或「Word 模式」再編輯') : null;
      if (!this.richHints) it.dom.setAttribute('aria-label', off ? it.title + '\n' + it.reason : it.title);
      if (it.spec.active) it.dom.classList.toggle('is-active', !!it.spec.active());
    }
  }

  async setMode(mode) {
    const st = this.view.getState();
    st.mode = mode;
    if (mode === 'source') st.source = false;
    await this.view.setState(st, { history: false });
    this.render();
    if (mode === 'source' && this.editor) this.editor.focus();
  }

  menu(owner, items) {
    const m = new Menu();
    for (const it of items) m.addItem(i => i.setTitle(it.title).onClick(it.run));
    const r = owner.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  headingMenu(owner) {
    const ed = this.editor;
    if (!ed) return;
    const items = [{ title: t('內文'), run: () => { linePrefix(ed, HEAD_RE, ''); ed.focus(); } }];
    for (let i = 1; i <= 6; i++) items.push({ title: t('標題 ' + i), run: () => { linePrefix(ed, HEAD_RE, '#'.repeat(i) + ' '); ed.focus(); } });
    this.menu(owner, items);
  }

  codeMenu(owner) {
    const ed = this.editor;
    if (!ed) return;
    this.menu(owner, CODE_LANGUAGES.map(([lang, label]) => ({
      title: lang ? label : t(label),
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

export function isMarkdownView(v) { return v instanceof MarkdownView; }
