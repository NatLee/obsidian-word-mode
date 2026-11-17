// 尋找與取代（Ctrl+F / Ctrl+H）
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { t, withKey, key } from './i18n.js';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const findKey = new PluginKey('wmFind');

export function findMatches(doc, query, caseSensitive) {
  const out = [];
  if (!query) return out;
  const q = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach(child => { text += child.isText ? child.text : '￼'; });
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(q);
    while (i >= 0) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length });
      i = hay.indexOf(q, i + Math.max(1, q.length));
    }
    return false;
  });
  return out;
}

function compute(doc, s) {
  return Object.assign({}, s, { matches: findMatches(doc, s.query, s.caseSensitive) });
}

export const findPlugin = new Plugin({
  key: findKey,
  state: {
    init: () => ({ query: '', caseSensitive: false, matches: [], current: -1 }),
    apply(tr, old) {
      const meta = tr.getMeta(findKey);
      let s = old;
      if (meta) s = compute(tr.doc, Object.assign({}, old, meta));
      else if (tr.docChanged && old.query) s = compute(tr.doc, old);
      if (s.current >= s.matches.length) s = Object.assign({}, s, { current: s.matches.length ? 0 : -1 });
      return s;
    },
  },
  props: {
    decorations(state) {
      const s = findKey.getState(state);
      if (!s.query || !s.matches.length) return null;
      return DecorationSet.create(state.doc, s.matches.map((m, i) =>
        Decoration.inline(m.from, m.to, { class: 'wm-find-match' + (i === s.current ? ' is-current' : '') })));
    },
  },
});

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// 尋找列（顯示在工具列下方）
export class FindBar {
  constructor(host, ctx) {
    this.ctx = ctx; // { getView(), icon(el, name, fallback) }
    this.dom = el('div', 'wm-findbar', host);
    this.dom.style.display = 'none';
    const row1 = el('div', 'wm-find-row', this.dom);
    this.input = el('input', 'wm-find-input', row1);
    this.input.type = 'text';
    this.input.placeholder = t('尋找…');
    this.count = el('span', 'wm-find-count', row1);
    this.btn(row1, 'arrow-up', t('上一個 (Shift+Enter)'), () => this.step(-1));
    this.btn(row1, 'arrow-down', t('下一個 (Enter)'), () => this.step(1));
    this.caseBtn = this.btn(row1, 'case-sensitive', t('區分大小寫'), () => this.setCase(!this.state().caseSensitive), 'Aa');
    this.replToggle = this.btn(row1, 'replace', withKey('取代', 'Mod+H'), () => this.showReplace(!this.replacing));
    this.btn(row1, 'x', t('關閉 (Esc)'), () => this.close());
    this.row2 = el('div', 'wm-find-row', this.dom);
    this.replInput = el('input', 'wm-find-input', this.row2);
    this.replInput.type = 'text';
    this.replInput.placeholder = t('取代為…');
    const b1 = el('button', 'wm-find-textbtn', this.row2, t('取代'));
    b1.type = 'button';
    b1.addEventListener('click', () => this.replaceOne());
    const b2 = el('button', 'wm-find-textbtn', this.row2, t('全部取代'));
    b2.type = 'button';
    b2.addEventListener('click', () => this.replaceAll());
    this.replacing = false;
    this.row2.style.display = 'none';

    this.input.addEventListener('input', () => this.search(this.input.value));
    const keys = e => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.target === this.replInput) this.replaceOne(); else this.step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); this.showReplace(!this.replacing); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); this.input.focus(); this.input.select(); }
    };
    this.input.addEventListener('keydown', keys);
    this.replInput.addEventListener('keydown', keys);
  }

  btn(parent, icon, title, run, fallback) {
    const b = el('button', 'wm-find-btn', parent);
    b.type = 'button';
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-label', title);
    this.ctx.icon(b, icon, fallback || title.slice(0, 1));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); run(); });
    return b;
  }

  get view() { return this.ctx.getView(); }
  state() { return findKey.getState(this.view.state); }
  get isOpen() { return this.dom.style.display !== 'none'; }

  open(withReplace) {
    const v = this.view;
    if (!v) return;
    this.dom.style.display = '';
    const { from, to, empty } = v.state.selection;
    if (!empty) {
      const tv = v.state.doc.textBetween(from, to, ' ');
      if (tv && !tv.includes('\n') && tv.length < 200) this.input.value = tv;
    }
    this.showReplace(!!withReplace || this.replacing);
    this.search(this.input.value);
    this.input.focus();
    this.input.select();
    if (this.ctx.onChange) this.ctx.onChange();
  }

  close() {
    const v = this.view;
    this.dom.style.display = 'none';
    if (v) {
      v.dispatch(v.state.tr.setMeta(findKey, { query: '', current: -1 }));
      v.focus();
    }
    if (this.ctx.onChange) this.ctx.onChange();
  }

  showReplace(on) {
    this.replacing = on;
    this.row2.style.display = on ? '' : 'none';
    this.replToggle.classList.toggle('is-active', on);
    if (on && this.isOpen && this.input.value) setTimeout(() => this.replInput.focus(), 0);
    if (this.ctx.onChange) this.ctx.onChange();
  }

  setCase(on) {
    this.caseBtn.classList.toggle('is-active', on);
    this.search(this.input.value, on);
  }

  // 搜尋：預設跳到游標之後的第一個結果
  search(query, caseSensitive) {
    const v = this.view;
    if (!v) return;
    const cs = caseSensitive != null ? caseSensitive : this.state().caseSensitive;
    const matches = findMatches(v.state.doc, query, cs);
    const from = v.state.selection.from;
    let cur = matches.findIndex(m => m.from >= from);
    if (cur < 0) cur = matches.length ? 0 : -1;
    v.dispatch(v.state.tr.setMeta(findKey, { query, caseSensitive: cs, current: cur }));
    this.reveal();
  }

  step(dir) {
    const v = this.view;
    const s = this.state();
    if (!s.matches.length) return;
    const cur = ((s.current < 0 ? (dir > 0 ? -1 : 0) : s.current) + dir + s.matches.length) % s.matches.length;
    v.dispatch(v.state.tr.setMeta(findKey, { current: cur }));
    this.reveal();
  }

  // 選取目前結果並捲到可見處（焦點留在尋找框）
  reveal() {
    const v = this.view;
    const s = this.state();
    this.count.textContent = s.query ? (s.matches.length ? `${s.current + 1}/${s.matches.length}` : t('找不到')) : '';
    this.count.classList.toggle('is-empty', !!s.query && !s.matches.length);
    const m = s.matches[s.current];
    if (!m) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).scrollIntoView());
  }

  replaceOne() {
    const v = this.view;
    const s = this.state();
    const m = s.matches[s.current];
    if (!m) return;
    const tr = v.state.tr.insertText(this.replInput.value, m.from, m.to);
    v.dispatch(tr);
    const after = this.state();
    const next = after.matches.findIndex(x => x.from >= m.from + this.replInput.value.length);
    v.dispatch(v.state.tr.setMeta(findKey, { current: next >= 0 ? next : (after.matches.length ? 0 : -1) }));
    this.reveal();
  }

  replaceAll() {
    const v = this.view;
    const s = this.state();
    if (!s.matches.length) return;
    const tr = v.state.tr;
    for (const m of s.matches.slice().reverse()) tr.insertText(this.replInput.value, m.from, m.to);
    const n = s.matches.length;
    v.dispatch(tr);
    this.reveal();
    this.count.textContent = t('已取代 {n} 處', { n });
  }
}
