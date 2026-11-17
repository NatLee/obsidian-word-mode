// 顯示編輯標記（像 Word 的 ¶）與「奇怪符號」偵測／清除
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { t } from './i18n.js';
import type { I18nKey } from './i18n.js';

// 奇怪符號的種類代號與修正方式
export type WeirdKindId = 'zw' | 'ctrl' | 'nbsp' | 'repl' | 'md' | 'quote' | 'space';
export type WeirdFix = 'remove' | 'space' | 'collapse';
// WEIRD_KINDS 的一筆：def 是清理對話框預設要不要勾選
export interface WeirdKind { id: WeirdKindId; label: I18nKey; fix: WeirdFix; def: boolean; always: boolean; }
// 找到的一個奇怪符號（文件位置）
export interface WeirdFound { from: number; to: number; kind: WeirdKindId; }
export type WeirdCounts = Partial<Record<WeirdKindId, number>>;

// on：顯示編輯標記；always：沒開編輯標記時也標示奇怪符號
export interface MarksFlags { on: boolean; always: boolean; }
export interface MarksState extends MarksFlags { decos: DecorationSet; }
export interface MarksOptions { on?: boolean; always?: boolean; }
// 交易的 meta：只改有給的那一項
export interface MarksMeta { on?: boolean | null; always?: boolean | null; }

export const marksKey = new PluginKey<MarksState>('wmMarks');

// eslint-disable-next-line no-irregular-whitespace -- the irregular whitespace is the character this code detects or cleans up
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
// eslint-disable-next-line no-irregular-whitespace -- the irregular whitespace is the character this code detects or cleans up
const INVISIBLE = /[​-‍⁠﻿]/;
const OBJ = '￰'; // 代表非文字的節點（圖片、連結等）

// 奇怪符號的種類：fix 為修正方式（remove 刪除、space 換成空白、collapse 合併空白）
// always：沒開編輯標記時也標示（設定「一直標示奇怪符號」）
export const WEIRD_KINDS: readonly WeirdKind[] = [
  { id: 'zw', label: '零寬度字元（看不見的字元）', fix: 'remove', def: true, always: true },
  { id: 'ctrl', label: '控制字元', fix: 'remove', def: true, always: true },
  { id: 'nbsp', label: '不換行空白（換成一般空白）', fix: 'space', def: true, always: false },
  { id: 'repl', label: '亂碼字元（�）', fix: 'remove', def: false, always: true },
  { id: 'md', label: '殘留的 Markdown 符號（** == ~~ [[ ]]）', fix: 'remove', def: false, always: true },
  { id: 'quote', label: '落單的引號（\' " `）', fix: 'remove', def: false, always: true },
  { id: 'space', label: '多餘的空白（連續空白、段落結尾空白）', fix: 'collapse', def: false, always: false },
];

export function weirdLabel(kind: string): string {
  const k = WEIRD_KINDS.find(x => x.id === kind);
  return k ? t(k.label) : kind;
}

// 掃描一段文字，回傳 [{from, to, kind}]（位置是文件位置）
function scanText(text: string, base: number, inCode: boolean): WeirdFound[] {
  const out: WeirdFound[] = [];
  const add = (i: number, len: number, kind: WeirdKindId) => out.push({ from: base + i, to: base + i + len, kind });
  let m;
  // eslint-disable-next-line no-control-regex, no-irregular-whitespace -- matching control characters is the purpose of this pattern; the irregular whitespace is the character this code detects or cleans up
  const re = /[​-‍⁠﻿]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]| |�/g;
  while ((m = re.exec(text))) {
    const c = m[0];
    add(m.index, 1, c === ' ' ? 'nbsp' : c === '�' ? 'repl' : INVISIBLE.test(c) ? 'zw' : 'ctrl');
  }
  if (inCode) return out;
  const md = /\*\*|==|~~|\[\[|\]\]/g;
  while ((m = md.exec(text))) add(m.index, m[0].length, 'md');
  // 引號：段落中數量是單數時，標示跟中文字相鄰或孤零零的那幾個
  for (const q of ["'", '"', '`']) {
    const idx = [];
    for (let i = 0; i < text.length; i++) if (text[i] === q) idx.push(i);
    if (!idx.length) continue;
    const odd = idx.length % 2 === 1;
    for (const i of idx) {
      const prev = text[i - 1] || ''; const next = text[i + 1] || '';
      const lonely = (!prev || CJK.test(prev) || /\s/.test(prev)) && (!next || CJK.test(next) || /\s/.test(next));
      const besideCjk = CJK.test(prev) || CJK.test(next);
      if ((odd && (besideCjk || lonely)) || (q === '`' && lonely)) add(i, 1, 'quote');
    }
  }
  const sp = / {2,}| +$/g;
  while ((m = sp.exec(text))) {
    if (m[0].length) add(m.index, m[0].length, 'space'); else sp.lastIndex++;
  }
  return out;
}

// 掃描一個文字區塊（段落、標題…）
export function scanBlock(node: PMNode, pos: number): WeirdFound[] {
  let text = '';
  node.forEach(c => {
    // 有程式碼格式的文字只檢查看不見的字元
    // eslint-disable-next-line no-control-regex, no-irregular-whitespace -- matching control characters is the purpose of this pattern; the irregular whitespace is the character this code detects or cleans up
    if (c.isText && c.marks.some(mk => mk.type.name === 'code')) text += c.text!.replace(/[^\u0000-\u001f\u007f ​-‍⁠﻿�]/g, OBJ);
    else text += c.isText ? c.text : OBJ.repeat(c.nodeSize);
  });
  return scanText(text, pos + 1, !!node.type.spec.code)
    .filter(f => !text.slice(f.from - pos - 1, f.to - pos - 1).includes(OBJ));
}

export function scanWeird(doc: PMNode): WeirdFound[] {
  const found: WeirdFound[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const f of scanBlock(node, pos)) found.push(f);
    return false;
  });
  return found;
}

export function countWeird(doc: PMNode): WeirdCounts {
  const counts: WeirdCounts = {};
  for (const f of scanWeird(doc)) counts[f.kind] = (counts[f.kind] || 0) + 1;
  return counts;
}

// 依勾選的種類清除，回傳 transaction（沒有可清的就回傳 null）
export function cleanWeird(state: EditorState, kinds: readonly string[]): Transaction | null {
  const list = scanWeird(state.doc).filter(f => kinds.includes(f.kind));
  if (!list.length) return null;
  const tr = state.tr;
  // 由後往前改，位置才不會跑掉；重疊的只處理一次
  let lastFrom = Infinity;
  for (const f of list.slice().sort((a, b) => b.from - a.from)) {
    if (f.to > lastFrom) continue;
    lastFrom = f.from;
    const kind = WEIRD_KINDS.find(k => k.id === f.kind)!; // 每個 kind 都在 WEIRD_KINDS 裡
    if (kind.fix === 'space') tr.insertText(' ', f.from, f.to);
    else if (kind.fix === 'collapse') {
      const $end = state.doc.resolve(f.to);
      if (f.to === $end.end()) tr.delete(f.from, f.to);
      else tr.insertText(' ', f.from, f.to);
    } else tr.delete(f.from, f.to);
  }
  return tr;
}

function widget(cls: string, text: string): () => HTMLSpanElement {
  return () => { const s = createSpan(); s.className = cls; s.textContent = text; s.contentEditable = 'false'; return s; };
}

function blockDecos(node: PMNode, pos: number, s: MarksFlags): Decoration[] {
  const decos: Decoration[] = [];
  if (s.on) {
    node.forEach((c, off) => {
      const at = pos + 1 + off;
      if (c.type.name === 'hard_break') { decos.push(Decoration.widget(at, widget('wm-mark-br', '↵'), { side: -1, key: 'br' })); return; }
      if (!c.isText) return;
      // eslint-disable-next-line no-irregular-whitespace -- the irregular whitespace is the character this code detects or cleans up
      const re = /[ 　\t]/g; let m;
      while ((m = re.exec(c.text!))) {
        const cls = m[0] === ' ' ? 'wm-ws-space' : m[0] === '　' ? 'wm-ws-full' : 'wm-ws-tab';
        decos.push(Decoration.inline(at + m.index, at + m.index + 1, { class: cls }));
      }
    });
    if (!node.type.spec.code) decos.push(Decoration.widget(pos + node.nodeSize - 1, widget('wm-mark-para', '¶'), { side: 1, key: 'para', marks: [] }));
  }
  if (s.on || s.always) {
    for (const f of scanBlock(node, pos)) {
      const kind = WEIRD_KINDS.find(k => k.id === f.kind)!;
      if (!s.on && !kind.always) continue;
      decos.push(Decoration.inline(f.from, f.to, { class: 'wm-weird wm-weird-' + f.kind, 'aria-label': t(kind.label) }));
    }
  }
  return decos;
}

function buildAll(doc: PMNode, s: MarksFlags): DecorationSet {
  if (!s.on && !s.always) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const d of blockDecos(node, pos, s)) decos.push(d);
    return false;
  });
  return DecorationSet.create(doc, decos);
}

// 只重算有改動的段落（打字時不用每次掃整份文件）
function updateDecos(tr: Transaction, set: DecorationSet, s: MarksFlags): DecorationSet {
  if (!s.on && !s.always) return DecorationSet.empty;
  set = set.map(tr.mapping, tr.doc);
  const doc = tr.doc;
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((oS, oE, nS, nE) => ranges.push([rest.map(nS, -1), rest.map(nE, 1)]));
  });
  const done = new Set<number>();
  for (const [a, b] of ranges) {
    const from = Math.max(0, Math.min(a, doc.content.size)); const to = Math.max(from, Math.min(b, doc.content.size));
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (done.has(pos)) return false;
      done.add(pos);
      set = set.remove(set.find(pos + 1, pos + node.nodeSize - 1));
      set = set.add(doc, blockDecos(node, pos, s));
      return false;
    });
  }
  return set;
}

// 顯示編輯標記：空白 ·、全形空白 □、Tab →、換行 ↵、段落結尾 ¶，並標出奇怪符號
// opts.always：沒開編輯標記時也標出明顯的奇怪符號
export function marksPlugin(opts: MarksOptions = {}): Plugin<MarksState> {
  return new Plugin<MarksState>({
    key: marksKey,
    state: {
      init: (_, state) => {
        const s = { on: !!opts.on, always: !!opts.always };
        return Object.assign(s, { decos: buildAll(state.doc, s) });
      },
      apply(tr, old, _o, state) {
        const meta: MarksMeta | undefined = tr.getMeta(marksKey);
        if (meta) {
          const s = { on: meta.on != null ? !!meta.on : old.on, always: meta.always != null ? !!meta.always : old.always };
          return Object.assign(s, { decos: buildAll(state.doc, s) });
        }
        if (!tr.docChanged) return old;
        return Object.assign({}, old, { decos: updateDecos(tr, old.decos, old) });
      },
    },
    props: { decorations(state) { return marksKey.getState(state)!.decos; } },
  });
}

export function marksOn(state: EditorState): boolean { const s = marksKey.getState(state); return !!(s && s.on); }
