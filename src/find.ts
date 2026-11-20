// 尋找與取代（Ctrl+F / Ctrl+H）
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { t, withKey } from './i18n.js';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { el } from './dom.js';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

// 搜尋選項（區分大小寫、正規表示式、全字相符）
export interface FindOptions { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean; }

// buildMatcher 的結果：可用的正規表示式，或是寫錯的正規表示式
export interface Matcher { re: RegExp; whole: boolean; error?: undefined; }
export interface MatcherError { error: true; }

// 一個搜尋結果在文件裡的範圍
export interface FindMatch { from: number; to: number; }

// 外掛狀態；decos 是快取的裝飾（decorations 裡直接寫進狀態物件）
export interface FindState {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
  matches: FindMatch[];
  current: number;
  error: boolean;
  decos?: { doc: PMNode; current: number; set: DecorationSet };
}

// 交易的 meta：要改的欄位
export type FindMeta = Partial<FindState>;

const findKey = new PluginKey<FindState>('wmFind');

const OBJ = '￼'; // 代表圖片、連結等非文字節點
const WORD = '\\p{L}\\p{N}_';

// 把搜尋字串變成正規表示式；opts: { caseSensitive, regex, wholeWord }。寫錯的正規表示式回傳 { error }
function buildMatcher(query: string, opts: FindOptions = {}): Matcher | MatcherError | null {
  if (!query) return null;
  let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 全字相符：前後不能是字母或數字（不用 lookbehind，前一個字元放在第 1 組）
  const whole = !!opts.wholeWord && !opts.regex;
  if (whole) src = '(^|[^' + WORD + '])(?:' + src + ')(?=$|[^' + WORD + '])';
  const flags = 'g' + (opts.caseSensitive ? '' : 'i');
  try { return { re: new RegExp(src, flags + 'u'), whole }; } catch {
    if (!opts.regex) return { error: true };
    try { return { re: new RegExp(src, flags), whole }; } catch { return { error: true }; }
  }
}

// 一個文字區塊拿來比對的文字：圖片、連結這類不是文字的節點用 OBJ 佔位，字元位置才會跟文件位置對得上
function blockText(node: PMNode): string {
  let text = '';
  node.forEach(child => { text += child.isText ? child.text : OBJ.repeat(child.nodeSize); });
  return text;
}

// 最多找這麼多筆：再多也沒辦法一筆一筆看，而且每一筆都要畫一個標記
const MAX_MATCHES = 5000;

// opts 可以是布林值（是否區分大小寫，舊的呼叫方式）或 { caseSensitive, regex, wholeWord }
function findMatches(doc: PMNode, query: string, opts?: FindOptions | boolean | null): FindMatch[] {
  const out: FindMatch[] = [];
  const o = typeof opts === 'object' && opts ? opts : { caseSensitive: !!opts };
  const mt = buildMatcher(query, o);
  if (!mt || mt.error) return out;
  doc.descendants((node, pos) => {
    // 已經到上限：後面的區塊都不用看了（只在迴圈裡跳出的話，每個區塊還是會再多找一筆）
    if (out.length > MAX_MATCHES) return false;
    if (!node.isTextblock) return true;
    const text = blockText(node);
    mt.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = mt.re.exec(text))) {
      const lead = mt.whole ? m[1].length : 0;
      const start = m.index + lead;
      const len = m[0].length - lead;
      if (len <= 0) { mt.re.lastIndex = m.index + 1; if (mt.re.lastIndex > text.length) break; continue; }
      out.push({ from: pos + 1 + start, to: pos + 1 + start + len });
      mt.re.lastIndex = start + len;
      if (out.length > MAX_MATCHES) return false;
    }
    return false;
  });
  return out;
}

// 把取代文字裡的 $1、$2、$&、$$、$<名稱> 換成比對到的內容（規則跟 String.replace 一樣）
function expandReplacement(replacement: string, m: RegExpExecArray, text: string): string {
  const groups = m.length - 1;
  return replacement.replace(/\$(?:(\$)|(&)|(`)|(')|(\d\d?)|<([^>]*)>)/g,
    (all: string, dollar?: string, amp?: string, before?: string, after?: string, num?: string, name?: string) => {
      if (dollar) return '$';
      if (amp) return m[0];
      if (before) return text.slice(0, m.index);
      if (after) return text.slice(m.index + m[0].length);
      if (num != null) {
        // 兩位數的組別不存在時，當成一位數的組別後面接一個普通的數字
        let n = +num; let rest = '';
        if (n > groups && num.length === 2) { n = +num[0]; rest = num[1]; }
        return n >= 1 && n <= groups ? (m[n] ?? '') + rest : all;
      }
      if (name != null) return m.groups ? (m.groups[name] ?? '') : all;
      return all;
    });
}

// 取代的文字：正規表示式模式可以用 $1、$2 代表括號裡找到的內容。
// 要在那個文字區塊的原位置重新比對一次：只拿找到的那幾個字去比對的話，看前後文的寫法
// （cat(?=2)、\Bcat）會比對不到，結果是「取代」了卻什麼都沒變
function replacementFor(doc: PMNode, at: FindMatch, query: string, opts: FindOptions, replacement: string): string {
  if (!opts.regex) return replacement;
  const mt = buildMatcher(query, opts);
  if (!mt || mt.error) return replacement;
  const $from = doc.resolve(at.from);
  const text = blockText($from.parent);
  try {
    // y：只在 lastIndex 這個位置比對，不往後找
    const re = new RegExp(mt.re.source, mt.re.flags.replace('g', '') + 'y');
    re.lastIndex = $from.parentOffset;
    const hit = re.exec(text);
    return hit ? expandReplacement(replacement, hit, text) : replacement;
  } catch { return replacement; }
}

function compute(doc: PMNode, s: FindState): FindState {
  const mt = buildMatcher(s.query, s);
  return Object.assign({}, s, { matches: findMatches(doc, s.query, s), error: !!(mt && mt.error) });
}

export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', caseSensitive: false, regex: false, wholeWord: false, matches: [], current: -1, error: false }),
    apply(tr, old) {
      const meta = tr.getMeta(findKey) as FindMeta | undefined;
      let s = old;
      if (meta) s = compute(tr.doc, Object.assign({}, old, meta));
      else if (tr.docChanged && old.query) s = compute(tr.doc, old);
      if (s.current >= s.matches.length) s = Object.assign({}, s, { current: s.matches.length ? 0 : -1 });
      return s;
    },
  },
  props: {
    decorations(state) {
      const s = findKey.getState(state)!;
      if (!s.query || !s.matches.length) return null;
      if (s.decos && s.decos.doc === state.doc && s.decos.current === s.current) return s.decos.set;
      const set = DecorationSet.create(state.doc, s.matches.map((m, i) =>
        Decoration.inline(m.from, m.to, { class: 'wm-find-match' + (i === s.current ? ' is-current' : '') })));
      s.decos = { doc: state.doc, current: s.current, set }; // 同一份文件、同一個目前結果時沿用，不用每次重建
      return set;
    },
  },
});

// 尋找列需要的外部功能（由 view.js 提供）
export interface FindBarContext {
  // 還沒載入筆記時是 null；尋找列只在編輯器存在時開啟、操作，所以 state()、step() 等處用 ! 略過檢查
  getView(): EditorView | null;
  icon(el: HTMLElement, name: string, fallback: string): void;
  onChange?(): void;
}

type FindOption = 'caseSensitive' | 'wholeWord' | 'regex';

// 尋找列（顯示在工具列下方）
export class FindBar {
  declare ctx: FindBarContext;
  declare dom: HTMLDivElement;
  declare input: HTMLInputElement;
  declare count: HTMLSpanElement;
  declare caseBtn: HTMLButtonElement;
  declare wordBtn: HTMLButtonElement;
  declare regexBtn: HTMLButtonElement;
  declare replToggle: HTMLButtonElement;
  declare row2: HTMLDivElement;
  declare replInput: HTMLInputElement;
  declare replacing: boolean;

  constructor(host: HTMLElement, ctx: FindBarContext) {
    this.ctx = ctx; // { getView(), icon(el, name, fallback) }
    this.dom = el('div', 'wm-findbar', host);
    this.dom.hide();
    const row1 = el('div', 'wm-find-row', this.dom);
    this.input = el('input', 'wm-find-input', row1);
    this.input.type = 'text';
    this.input.placeholder = t('尋找…');
    this.count = el('span', 'wm-find-count', row1);
    this.btn(row1, 'arrow-up', t('上一個 (Shift+Enter)'), () => this.step(-1));
    this.btn(row1, 'arrow-down', t('下一個 (Enter)'), () => this.step(1));
    this.caseBtn = this.btn(row1, 'case-sensitive', t('區分大小寫'), () => { if (this.view) this.setCase(!this.state().caseSensitive); }, 'Aa');
    this.wordBtn = this.btn(row1, 'whole-word', t('全字相符（前後不是字母或數字）'), () => { if (this.view) this.setOption('wholeWord', !this.state().wholeWord); }, 'ab');
    this.regexBtn = this.btn(row1, 'regex', t('使用正規表示式（取代時可用 $1、$2）'), () => { if (this.view) this.setOption('regex', !this.state().regex); }, '.*');
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
    this.row2.hide();

    this.input.addEventListener('input', () => this.search(this.input.value));
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); if (e.target === this.replInput) this.replaceOne(); else this.step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); this.showReplace(!this.replacing); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); this.input.focus(); this.input.select(); }
    };
    this.input.addEventListener('keydown', keys);
    this.replInput.addEventListener('keydown', keys);
  }

  btn(parent: HTMLElement, icon: string, title: string, run: () => void, fallback?: string): HTMLButtonElement {
    const b = el('button', 'wm-find-btn', parent);
    b.type = 'button';
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-label', title);
    this.ctx.icon(b, icon, fallback || title.slice(0, 1));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', e => { e.preventDefault(); run(); });
    return b;
  }

  get view(): EditorView | null { return this.ctx.getView(); }
  state(): FindState { return findKey.getState(this.view!.state)!; }
  get isOpen(): boolean { return this.dom.style.display !== 'none'; }

  open(withReplace?: boolean) {
    const v = this.view;
    if (!v) return;
    this.dom.show();
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
    this.dom.hide();
    if (v) {
      v.dispatch(v.state.tr.setMeta(findKey, { query: '', current: -1 }));
      v.focus();
    }
    if (this.ctx.onChange) this.ctx.onChange();
  }

  showReplace(on: boolean) {
    this.replacing = on;
    this.row2.style.display = on ? '' : 'none';
    this.replToggle.classList.toggle('is-active', on);
    if (on && this.isOpen && this.input.value) window.setTimeout(() => this.replInput.focus(), 0);
    if (this.ctx.onChange) this.ctx.onChange();
  }

  setCase(on: boolean) { this.setOption('caseSensitive', on); }

  // 區分大小寫、全字相符、正規表示式
  setOption(name: FindOption, on: boolean) {
    const btn = { caseSensitive: this.caseBtn, wholeWord: this.wordBtn, regex: this.regexBtn }[name];
    btn.classList.toggle('is-active', on);
    // 正規表示式自己可以寫 \b，開啟時「全字相符」不作用
    if (name === 'regex') this.wordBtn.classList.toggle('is-disabled', on);
    this.search(this.input.value, { [name]: on });
  }

  // 搜尋：預設跳到游標之後的第一個結果
  search(query: string, change?: FindOptions) {
    const v = this.view;
    if (!v) return;
    const s = this.state();
    const opts = Object.assign({ caseSensitive: s.caseSensitive, wholeWord: s.wholeWord, regex: s.regex }, change || {});
    const matches = findMatches(v.state.doc, query, opts);
    const from = v.state.selection.from;
    let cur = matches.findIndex(m => m.from >= from);
    if (cur < 0) cur = matches.length ? 0 : -1;
    v.dispatch(v.state.tr.setMeta(findKey, Object.assign({ query, current: cur }, opts)));
    this.reveal();
  }

  step(dir: number) {
    const v = this.view;
    if (!v) return;
    const s = this.state();
    if (!s.matches.length) return;
    const cur = ((s.current < 0 ? (dir > 0 ? -1 : 0) : s.current) + dir + s.matches.length) % s.matches.length;
    v.dispatch(v.state.tr.setMeta(findKey, { current: cur }));
    this.reveal();
  }

  // 選取目前結果並捲到可見處（焦點留在尋找框）
  reveal() {
    const v = this.view;
    if (!v) return;
    const s = this.state();
    this.count.textContent = s.query ? (s.error ? t('正規表示式有誤') : s.matches.length ? `${s.current + 1}/${s.matches.length}` : t('找不到')) : '';
    this.count.classList.toggle('is-empty', !!s.query && !s.matches.length);
    const m = s.matches[s.current];
    if (!m) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, m.from, m.to)).scrollIntoView());
  }

  replaceOne() {
    const v = this.view;
    if (!v) return;
    const s = this.state();
    const m = s.matches[s.current];
    if (!m) return;
    const text = replacementFor(v.state.doc, m, s.query, s, this.replInput.value);
    const tr = v.state.tr.insertText(text, m.from, m.to);
    v.dispatch(tr);
    const after = this.state();
    const next = after.matches.findIndex(x => x.from >= m.from + text.length);
    v.dispatch(v.state.tr.setMeta(findKey, { current: next >= 0 ? next : (after.matches.length ? 0 : -1) }));
    this.reveal();
  }

  replaceAll() {
    const v = this.view;
    if (!v) return;
    const s = this.state();
    if (!s.matches.length) return;
    const tr = v.state.tr;
    for (const m of s.matches.slice().reverse()) {
      tr.insertText(replacementFor(v.state.doc, m, s.query, s, this.replInput.value), m.from, m.to);
    }
    const n = s.matches.length;
    v.dispatch(tr);
    this.reveal();
    this.count.textContent = t('已取代 {n} 處', { n });
  }
}
