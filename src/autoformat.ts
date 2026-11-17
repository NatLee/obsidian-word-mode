// 輸入時自動套用格式（像 Word 的「輸入時自動套用格式」，規則用 Markdown 的寫法）：
//   段落開頭打「- 」「1. 」「# 」「> 」「[ ] 」→ 清單、編號、標題、引文、核取清單
//   打完 **粗體**、*斜體*、`程式碼`、==螢光==、~~刪除線~~、[[筆記]]、[文字](網址)、$數學式$ → 直接變成格式
//   「```」「---」「| a | b |」之後按 Enter → 程式碼區塊、分隔線、表格
// 跟 Word 一樣，套用格式是獨立的一個步驟：先放進打的字，再套用格式。
// 所以按一次復原（Ctrl+Z，或緊接著按 Backspace）只會取消格式，打的字還在。
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { findWrapping, canJoin } from 'prosemirror-transform';
import { closeHistory, undo } from 'prosemirror-history';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Node as PMNode, NodeType, MarkType, ResolvedPos, Attrs } from 'prosemirror-model';
import { schema } from './schema.js';

// 規則比對的結果；lead 是開頭不屬於格式的字元數（見 lead()）
type RuleMatch = RegExpExecArray & { lead?: number };
// re 比對游標前的文字；run 用比對結果修改 tr，做不到就回傳 false
interface Rule { re: RegExp; run(tr: Transaction, m: RuleMatch, c: number): boolean; }
type MakeNode = (m: RuleMatch) => PMNode | null;
type Dispatch = (tr: Transaction) => void;

const N = schema.nodes;
const M = schema.marks;
const LEAF = '\ufffc'; // 代表圖片、連結等非文字節點（長度與節點大小都是 1，位置才對得上）
const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|svg|webp|avif|heic|tiff?)$/i;

export const autoformatOptions = { enabled: true };
export const autoKey = new PluginKey<boolean>('wmAutoformat');

function textBefore($pos: ResolvedPos): string {
  return $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 1000), $pos.parentOffset, null, LEAF);
}

// 把 pos 所在的段落包進清單或引文；前面緊接著同類型的就接在一起
function wrapBlock(tr: Transaction, pos: number, type: NodeType, attrs: Attrs | null, itemAttrs?: Attrs): boolean {
  const range = tr.doc.resolve(pos).blockRange();
  const wrapping = range && findWrapping(range, type, attrs);
  if (!wrapping) return false;
  if (itemAttrs) wrapping[wrapping.length - 1].attrs = itemAttrs;
  // 有 wrapping 就表示 range 不是 null
  tr.wrap(range, wrapping);
  const before = tr.doc.resolve(range.start).nodeBefore;
  if (before && before.type === type && canJoin(tr.doc, range.start)) tr.join(range.start);
  return true;
}

// ---------------------------------------------------------------- 段落開頭的規則（打空白時）
// run(tr, m, c)：tr 是「已經放進打的字」之後的 transaction，c 是游標位置；做不到就回傳 false
const BLOCK_RULES: Rule[] = [
  { re: /^(#{1,6})[ \u3000]$/, run(tr, m, c) {
    const $c = tr.doc.resolve(c);
    if (!$c.node(-1).canReplaceWith($c.index(-1), $c.indexAfter(-1), N.heading)) return false;
    const start = $c.start();
    tr.delete(start, c).setBlockType(start, start, N.heading, { level: m[1].length, bid: $c.parent.attrs.bid });
    return true;
  } },
  { re: /^\[([ xX]?)\][ \u3000]$/, run(tr, m, c) {
    const $c = tr.doc.resolve(c);
    const start = $c.start();
    const checked = !!m[1].trim();
    const inItem = $c.depth >= 2 && $c.node(-1).type === N.list_item && $c.index(-1) === 0;
    tr.delete(start, c);
    if (inItem) { tr.setNodeMarkup($c.before(-1), null, Object.assign({}, $c.node(-1).attrs, { checked, status: null })); return true; }
    return wrapBlock(tr, start, N.bullet_list, { tight: true }, { checked });
  } },
  { re: /^([-*+])[ \u3000]$/, run(tr, m, c) {
    const $c = tr.doc.resolve(c);
    if ($c.depth >= 2 && $c.node(-1).type === N.list_item) return false; // 已經在清單裡
    tr.delete($c.start(), c);
    return wrapBlock(tr, $c.start(), N.bullet_list, { tight: true, bullet: m[1] });
  } },
  { re: /^(\d{1,9})[.)][ \u3000]$/, run(tr, m, c) {
    const $c = tr.doc.resolve(c);
    if ($c.depth >= 2 && $c.node(-1).type === N.list_item) return false;
    tr.delete($c.start(), c);
    return wrapBlock(tr, $c.start(), N.ordered_list, { order: +m[1], tight: true });
  } },
  { re: /^>[ \u3000]$/, run(tr, m, c) {
    const $c = tr.doc.resolve(c);
    tr.delete($c.start(), c);
    return wrapBlock(tr, $c.start(), N.blockquote, null);
  } },
  // 提示框（> [!note] 標題）在按 Enter 時才轉換（見 autoformatEnter），這樣才打得了標題
];

// ---------------------------------------------------------------- 行內的規則（打完結尾的符號時）
// 文字格式：m[1] 是前一個字元（不屬於格式）、m[2] 是內容；d 是符號的長度
function markRule(re: RegExp, type: MarkType, d: number): Rule {
  return { re, run(tr, m, c) {
    const to = c;
    const from = to - m[0].length + m[1].length;
    if (tr.doc.rangeHasMark(from, to, M.code)) return false;
    tr.delete(to - d, to).delete(from, from + d);
    tr.addMark(from, to - 2 * d, type.create()).removeStoredMark(type);
    return true;
  } };
}
function nodeRule(re: RegExp, make: MakeNode): Rule {
  return { re, run(tr, m, c) {
    const node = make(m);
    if (!node) return false;
    const from = c - m[0].length + (m.lead || 0);
    if (tr.doc.rangeHasMark(from, c, M.code)) return false;
    tr.replaceWith(from, c, node);
    return true;
  } };
}
const lead = (re: RegExp, make: MakeNode): Rule => nodeRule(re, m => { m.lead = m[1].length; return make(m); });

const INLINE_RULES: Rule[] = [
  markRule(/(^|[^*\\])\*\*([^*\s]|[^*\s][^*]*[^*\s])\*\*$/, M.strong, 2),
  markRule(/(^|[^\w\\])__([^_\s]|[^_\s][^_]*[^_\s])__$/, M.strong, 2),
  markRule(/(^|[^*\\])\*([^*\s]|[^*\s][^*]*[^*\s])\*$/, M.em, 1),
  markRule(/(^|[^\w\\])_([^_\s]|[^_\s][^_]*[^_\s])_$/, M.em, 1),
  markRule(/(^|[^=\\])==([^=\s]|[^=\s][^=]*[^=\s])==$/, M.highlight, 2),
  markRule(/(^|[^~\\])~~([^~\s]|[^~\s][^~]*[^~\s])~~$/, M.strike, 2),
  markRule(/(^|[^`\\])`([^`]+)`$/, M.code, 1),
  // ![說明](圖片網址或路徑)、![[圖片.png|300]]、![[筆記]]、[[筆記|別名]]
  nodeRule(/!\[([^[\]]*)\]\(([^()\s]+)\)$/, m => N.image.create({ src: m[2], alt: m[1] || null, wiki: false })),
  nodeRule(/(!?)\[\[([^[\]\n]+)\]\]$/, m => {
    const bar = m[2].indexOf('|');
    const target = (bar < 0 ? m[2] : m[2].slice(0, bar)).trim();
    const alias = bar < 0 ? null : m[2].slice(bar + 1);
    if (!target) return null;
    if (m[1] && IMAGE_EXT.test(target.split('#')[0])) {
      const w = alias != null && /^\d+(x\d+)?$/.test(alias) ? alias : null;
      return N.image.create({ src: target, wiki: true, alt: w ? null : alias, width: w });
    }
    return N.wikilink.create({ target, alias, embed: !!m[1] });
  }),
  // [文字](網址)
  { re: /\[([^[\]]+)\]\(([^()\s]+)\)$/, run(tr, m, c) {
    const from = c - m[0].length;
    if (tr.doc.rangeHasMark(from, c, M.code)) return false;
    const textEnd = from + 1 + m[1].length;
    tr.delete(textEnd, c).delete(from, from + 1);
    tr.addMark(from, from + m[1].length, M.link.create({ href: m[2] })).removeStoredMark(M.link);
    return true;
  } },
  // $數學式$（開頭是數字的不算，避免把「$5 到 $10」當成數學式）、%%註解%%、[^註腳]
  lead(/(^|[^$\\])\$([^$\s\d]|[^$\s\d][^$]*[^$\s])\$$/, m => N.raw_inline.create({ src: '$' + m[2] + '$' })),
  nodeRule(/%%([^%]+)%%$/, m => N.raw_inline.create({ src: m[0] })),
  nodeRule(/\[\^([^\]\s]+)\]$/, m => N.raw_inline.create({ src: m[0] })),
];

function findRule(state: EditorState, $from: ResolvedPos, full: string, wholeBlock: boolean): { r: Rule; m: RuleMatch } | null {
  if (wholeBlock && $from.parent.type === N.paragraph) {
    for (const r of BLOCK_RULES) { const m = r.re.exec(full); if (m) return { r, m }; }
  }
  for (const r of INLINE_RULES) { const m = r.re.exec(full); if (m) return { r, m }; }
  return null;
}

export const autoformatPlugin = new Plugin<boolean>({
  key: autoKey,
  // 狀態：上一個動作是不是自動套用格式（是的話，緊接著按 Backspace 會取消格式）
  state: {
    init: () => false,
    apply: (tr, old) => (tr.getMeta(autoKey) ? true : (tr.docChanged || tr.selectionSet ? false : old)),
  },
  props: {
    handleTextInput(view, from, to, text) {
      if (!autoformatOptions.enabled || view.composing) return false;
      const state = view.state;
      const $from = state.doc.resolve(from);
      if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
      if (M.code.isInSet(state.storedMarks || $from.marks())) return false;
      const before = textBefore($from);
      const hit = findRule(state, $from, before + text, $from.parentOffset === before.length);
      if (!hit) {
        // 剛套用完格式後接著打字：另起一個復原步驟，復原時不會連格式一起取消
        if (!autoKey.getState(state)) return false;
        view.dispatch(closeHistory(state.tr.insertText(text, from, to)).scrollIntoView());
        return true;
      }
      // 第一步：照平常放進打的字
      view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
      // 第二步：套用格式（獨立的復原步驟）
      const s1 = view.state;
      const tr = closeHistory(s1.tr);
      let ok = false;
      try { ok = hit.r.run(tr, hit.m, s1.selection.from) !== false; } catch { ok = false; }
      if (ok && tr.docChanged) view.dispatch(tr.setMeta(autoKey, true).scrollIntoView());
      return true;
    },
  },
});

// 剛自動套用格式後按 Backspace：取消格式（打的字還在），像 Word
export function undoAutoformat(state: EditorState, dispatch?: Dispatch): boolean {
  if (!autoKey.getState(state)) return false;
  return undo(state, dispatch);
}

// 表格那一行的儲存格（只認沒有跳脫的 |）
function pipeCells(text: string): string[] | null {
  let s = text.trim();
  if (!s.startsWith('|') || !/(^|[^\\])\|$/.test(s) || s.length < 3) return null;
  s = s.slice(1, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

// 按 Enter 時的規則：整個段落是 ```、---、| a | b |，或引文第一行是 [!note] 標題
export function autoformatEnter(state: EditorState, dispatch?: Dispatch): boolean {
  if (!autoformatOptions.enabled) return false;
  const { $from, empty } = state.selection;
  const para = $from.parent;
  if (!empty || para.type !== N.paragraph || $from.parentOffset !== para.content.size || !para.content.size) return false;
  let plain = true;
  para.forEach(c => { if (!c.isText || c.marks.length) plain = false; });
  if (!plain) return false;
  const text = para.textContent;
  const holder = $from.node(-1);
  const index = $from.index(-1);
  const can = (type: NodeType) => holder.canReplaceWith(index, index + 1, type);
  const from = $from.before(); const to = $from.after();
  const done = (tr: Transaction, selPos: number) => {
    if (dispatch) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(selPos)));
      dispatch(closeHistory(tr).setMeta(autoKey, true).scrollIntoView());
    }
    return true;
  };
  let m;
  if ((m = /^(?:`{3,}|~{3,})([\w+#.-]*)$/.exec(text)) && can(N.code_block)) {
    return done(state.tr.replaceWith(from, to, N.code_block.create({ params: m[1] || '' })), from + 1);
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(text) && can(N.horizontal_rule)) {
    const hr = N.horizontal_rule.create({ markup: text.slice(0, 3) });
    return done(state.tr.replaceWith(from, to, [hr, N.paragraph.create()]), from + hr.nodeSize + 1);
  }
  const cells = pipeCells(text);
  if (cells && cells.length >= 2 && can(N.table)) {
    const cell = (type: NodeType, tx: string) => type.create(null, N.paragraph.create(null, tx ? schema.text(tx) : null));
    const head = N.table_row.create(null, cells.map(tx => cell(N.table_header, tx)));
    const body = N.table_row.create(null, cells.map(() => cell(N.table_cell, '')));
    return done(state.tr.replaceWith(from, to, N.table.create(null, [head, body])), from + 1 + head.nodeSize + 3);
  }
  if ((m = /^\[!([^\]\s]+)\]([+-]?)(?:[ \u3000]+(.*))?$/.exec(text)) && holder.type === N.blockquote && index === 0 && $from.depth >= 2) {
    const bqPos = $from.before(-1);
    const rest: PMNode[] = [];
    holder.forEach((c, _o, i) => { if (i > 0) rest.push(c); });
    const content = rest.length ? rest : [N.paragraph.create()];
    const callout = N.callout.create({ type: m[1], fold: m[2] || '', title: (m[3] || '').trim() || null, bid: holder.attrs.bid }, content);
    return done(state.tr.replaceWith(bqPos, bqPos + holder.nodeSize, callout), bqPos + 2);
  }
  return false;
}
