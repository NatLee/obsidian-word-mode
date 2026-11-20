// Word 模式的編輯指令（純 ProseMirror，不依賴 Obsidian，方便測試）
import { TextSelection, NodeSelection, Plugin, Selection } from 'prosemirror-state';
import { toggleMark, wrapIn, lift, baseKeymap, chainCommands, exitCode, selectAll } from 'prosemirror-commands';
import { wrapInList, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import {
  addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn, deleteTable,
  goToNextCell, setCellAttr, isInTable, CellSelection,
} from 'prosemirror-tables';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Attrs, Node as PMNode, Mark, MarkType, NodeType, ResolvedPos } from 'prosemirror-model';
import type { I18nKey } from './i18n.js';
import { schema } from './schema.js';
import type { BidAttrs, BlockFormatAttrs, BulletListAttrs, HighlightAttrs, ListItemAttrs, OrderedListAttrs, TableCellAttrs } from './schema.js';
import { htmlSafeBlock } from './markdown.js';
import { autoformatEnter, undoAutoformat } from './autoformat.js';

const N = schema.nodes;
const M = schema.marks;

// 指令的 dispatch 參數（ProseMirror Command 的第二個參數）
type Dispatch = (tr: Transaction) => void;

// 文件中的一段範圍（from／to 都是文件位置）
export interface TextRange { from: number; to: number; }

// 找到的節點與它在文件中的位置
interface NodeAt { node: PMNode; pos: number; }

// 往上找到的祖先節點：depth 是它的深度，pos 是它前面的位置
interface Ancestor { node: PMNode; depth: number; pos: number; }

// 方向：1＝往後／遞增／增加縮排，-1＝往前／遞減／減少縮排
export type Direction = 1 | -1;

// 指令的設定（main 會依設定修改）
export interface CommandOptions {
  // 沒有選取文字時，格式套用到游標所在的整個詞
  wordAtCursor: boolean;
  // 自動取消 Markdown 不支援的對齊／縮排時呼叫（用來提示使用者）
  onCompat: (() => void) | null;
}

// ---------------------------------------------------------------- 文字格式

function eachRange(state: EditorState, fn: (from: number, to: number) => void): void {
  for (const r of state.selection.ranges) fn(r.$from.pos, r.$to.pos);
}

// 游標所在的「詞」（像 Word：沒有選取文字時，格式套用到游標所在的詞）
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh-Hant', { granularity: 'word' }) : null;
export const options: CommandOptions = { wordAtCursor: true, onCompat: null };

// Markdown 不支援的組合：標題、清單、引文、表格裡的對齊／縮排；含 [[連結]]、圖片、數學式的段落對齊。
// 每次修改後自動取消這些格式，讓 Word 畫面看到的跟 Markdown／閱讀模式一樣
let compatNotified = 0;
export const compatPlugin = new Plugin({
  appendTransaction(trs, oldState, state) {
    if (!trs.some(tr => tr.docChanged)) return null;
    let tr = null as Transaction | null; let dropped = false;
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const a = node.attrs;
      if (!a || (!a.align && !a.indent)) return false;
      const top = state.doc.resolve(pos).depth === 0;
      if (!top || node.type !== N.paragraph || !htmlSafeBlock(node)) {
        tr = tr || state.tr;
        tr.setNodeMarkup(pos, null, Object.assign({}, a, { align: null, indent: 0 }));
        dropped = true;
      }
      return false;
    });
    if (dropped && options.onCompat && Date.now() - compatNotified > 8000) { compatNotified = Date.now(); options.onCompat(); }
    return tr ? tr.setMeta('addToHistory', true) : null;
  },
});
function wordRangeAt(state: EditorState): TextRange | null {
  if (!options.wordAtCursor) return null;
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  const off = $from.parentOffset;
  let result: TextRange | null = null;
  $from.parent.forEach((child, offset) => {
    if (result || !child.isText || off <= offset || off >= offset + child.nodeSize) return;
    const local = off - offset;
    const text = child.text!;
    if (segmenter) {
      for (const seg of segmenter.segment(text)) {
        if (seg.isWordLike && seg.index < local && local < seg.index + seg.segment.length) {
          result = { from: $from.start() + offset + seg.index, to: $from.start() + offset + seg.index + seg.segment.length };
          break;
        }
      }
    } else {
      const re = /[\p{L}\p{N}_]+/gu; let m: RegExpExecArray | null;
      while ((m = re.exec(text))) if (m.index < local && local < m.index + m[0].length) { result = { from: $from.start() + offset + m.index, to: $from.start() + offset + m.index + m[0].length }; break; }
    }
  });
  return result;
}

function markCommand(type: MarkType): Command {
  const base = toggleMark(type);
  return (state, dispatch) => {
    const w = wordRangeAt(state);
    if (w) {
      if (dispatch) {
        const tr = state.tr;
        if (state.doc.rangeHasMark(w.from, w.to, type)) tr.removeMark(w.from, w.to, type);
        else tr.addMark(w.from, w.to, type.create());
        dispatch(tr);
      }
      return true;
    }
    return base(state, dispatch);
  };
}

export const toggleBold = markCommand(M.strong);
export const toggleItalic = markCommand(M.em);
export const toggleUnderline = markCommand(M.underline);
export const toggleStrike = markCommand(M.strike);
export const toggleHighlight = markCommand(M.highlight);
export const toggleCode = markCommand(M.code);
export const toggleBorder = markCommand(M.border);
export const toggleSup = markCommand(M.sup);
export const toggleSub = markCommand(M.sub);
export const toggleKbd = markCommand(M.kbd);
export { selectAll };

// 全選按鈕：第二次按取消選取
export function isAllSelected(state: EditorState): boolean {
  const s = state.selection;
  if (s.empty) return false;
  const a = Selection.atStart(state.doc); const b = Selection.atEnd(state.doc);
  return s.from <= a.from && s.to >= b.to;
}
export function collapseSelection(state: EditorState, dispatch?: Dispatch): boolean {
  if (state.selection.empty) return false;
  if (dispatch) dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.from))));
  return true;
}

// 大小寫／全形半形轉換的種類（CASE_KINDS 的鍵）
export type CaseKind = 'upper' | 'lower' | 'title' | 'sentence' | 'half' | 'full';
// 把一段文字轉成另一種大小寫或全形／半形
export type CaseTransform = (s: string) => string;

// ---------------------------------------------------------------- 大小寫、全形／半形

const toHalf = (s: string): string => s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
const toFull = (s: string): string => s.replace(/[\u0021-\u007E]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '\u3000');
const CASE_KINDS: Record<CaseKind, CaseTransform> = {
  upper: s => s.toUpperCase(),
  lower: s => s.toLowerCase(),
  title: s => s.toLowerCase().replace(/(^|[\s\-（(「『"'])([a-z])/g, (m: string, a: string, b: string) => a + b.toUpperCase()),
  sentence: s => s.toLowerCase().replace(/(^\s*|[.!?。！？]\s*)([a-z])/g, (m: string, a: string, b: string) => a + b.toUpperCase()),
  half: toHalf,
  full: toFull,
};
export function changeCase(kind: CaseKind): Command {
  const f = CASE_KINDS[kind];
  return (state, dispatch) => {
    const w = wordRangeAt(state);
    const ranges = w ? [w] : state.selection.ranges.map(r => ({ from: r.$from.pos, to: r.$to.pos })).filter(r => r.to > r.from);
    if (!ranges.length) return false;
    if (dispatch) {
      const tr = state.tr;
      const pieces: { a: number; b: number; text: string; marks: readonly Mark[] }[] = [];
      for (const r of ranges) {
        state.doc.nodesBetween(r.from, r.to, (node, pos) => {
          if (!node.isText) return true;
          const a = Math.max(r.from, pos); const b = Math.min(r.to, pos + node.nodeSize);
          if (b > a) pieces.push({ a, b, text: node.text!.slice(a - pos, b - pos), marks: node.marks });
          return false;
        });
      }
      for (const p of pieces.reverse()) {
        const nt = f(p.text);
        if (nt !== p.text) tr.replaceWith(tr.mapping.map(p.a), tr.mapping.map(p.b), schema.text(nt, p.marks));
      }
      dispatch(tr);
    }
    return true;
  };
}

// ---------------------------------------------------------------- 排序（段落或清單項目）

export function sortBlocks(dir: Direction): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
    // 清單：排序整個清單（或游標所在的清單）
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type === N.bullet_list || n.type === N.ordered_list) {
        if (n.childCount < 2) return false;
        if (dispatch) {
          const items: PMNode[] = []; n.forEach(c => items.push(c));
          items.sort((a, b) => collator.compare(a.textContent, b.textContent) * dir);
          const pos = $from.before(d);
          dispatch(state.tr.replaceWith(pos, pos + n.nodeSize, n.type.create(n.attrs, items)));
        }
        return true;
      }
    }
    // 選取的最外層段落
    if ($from.depth < 1) return false;
    const start = $from.index(0); const end = $to.index(0);
    if (end <= start) return false;
    const nodes: PMNode[] = [];
    for (let i = start; i <= end; i++) { const c = state.doc.child(i); if (c.type !== N.paragraph) return false; nodes.push(c); }
    if (dispatch) {
      const sorted = nodes.slice().sort((a, b) => collator.compare(a.textContent, b.textContent) * dir);
      const from = $from.before(1); const to = $to.after(1);
      dispatch(state.tr.replaceWith(from, to, sorted));
    }
    return true;
  };
}

// 程式碼區塊的語言：lang 是存進 ``` 後面的名稱（空字串＝純文字），label 是選單上顯示的名稱
export type CodeLanguage = [lang: string, label: string];

// ---------------------------------------------------------------- 程式碼

export const CODE_LANGUAGES: CodeLanguage[] = [
  ['', '純文字'], ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'],
  ['sql', 'SQL'], ['bash', 'Bash / Shell'], ['powershell', 'PowerShell'], ['yaml', 'YAML'], ['markdown', 'Markdown'],
  ['html', 'HTML'], ['css', 'CSS'], ['xml', 'XML'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
  ['go', 'Go'], ['rust', 'Rust'], ['r', 'R'], ['matlab', 'MATLAB'], ['dockerfile', 'Dockerfile'], ['ini', 'INI'],
  ['mermaid', 'Mermaid'], ['dataview', 'Dataview'],
];

// 選取範圍裡的段落是否只有純文字（轉成程式碼不會遺失連結、圖片、格式）
function plainSelection(state: EditorState): boolean {
  let ok = true;
  const { $from, $to } = state.selection;
  const from = $from.parent.isTextblock ? $from.start() : $from.pos;
  const to = $to.parent.isTextblock ? $to.end() : $to.pos;
  state.doc.nodesBetween(from, to, n => {
    if (!ok) return false;
    if (n.isTextblock) {
      n.forEach(c => {
        if (c.isText ? c.marks.some(m => m.type !== M.code) : c.type !== N.hard_break) ok = false;
      });
      return false;
    }
    return true;
  });
  return ok;
}

// 選取範圍碰到的段落可以整個換成一個程式碼區塊時，回傳要換掉的範圍；不行就回傳 null。
// 範圍只包住選到的段落：以前是把選取範圍所在的整個頂層區塊換掉，在清單裡選一個字，整個清單（連同其他項目裡的
// [[連結]]）都會變成一個程式碼區塊
function codeBlockRange(state: EditorState): TextRange | null {
  const { $from, $to } = state.selection;
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) return null;
  const range = $from.blockRange($to);
  if (!range) return null;
  let { depth, start, end } = range;
  let parent = range.parent; let i = range.startIndex; let j = range.endIndex;
  // 這一層不能放程式碼區塊（選了清單的好幾項），或是待辦事項的第一段（方框後面要接文字，接程式碼區塊會讀不回來）
  const blocked = (): boolean => !parent.canReplaceWith(i, j, N.code_block)
    || (parent.type === N.list_item && i === 0 && (parent.attrs as ListItemAttrs).checked != null);
  while (blocked()) {
    // 整個上層都選到了（例如選了整個清單）才往上一層、把上層整個換掉；只選到一部分就不轉換
    if (depth === 0 || i !== 0 || j !== parent.childCount) return null;
    start = $from.before(depth); end = $from.after(depth);
    depth--;
    parent = $from.node(depth); i = $from.index(depth); j = i + 1;
  }
  let ok = true; let first = -1; let last = -1;
  state.doc.nodesBetween(start, end, (n, pos) => {
    if (!ok) return false;
    if (n.isTextblock) {
      if (first < 0) first = pos;
      last = pos;
      // 只有純文字才轉（轉成程式碼不會遺失連結、圖片、格式）
      n.forEach(c => { if (c.isText ? c.marks.some(m => m.type !== M.code) : c.type !== N.hard_break) ok = false; });
      return false;
    }
    if (n.isLeaf) ok = false; // 分隔線、數學式、HTML 區塊這類沒有文字的區塊：變成程式碼就不見了
    return true;
  });
  // 範圍裡還有沒選到的段落（例如從內文選到清單的第一項，清單還有其他項目）：不轉換
  if (!ok || first !== $from.before() || last !== $to.before()) return null;
  return { from: start, to: end };
}

// 插入程式碼區塊：有選取的段落就把它們變成程式碼區塊，否則插入空的區塊
export function insertCodeBlock(lang: string): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    const { $from, $to, empty } = state.selection;
    if ($from.parent.type === N.code_block) {
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), null, Object.assign({}, $from.parent.attrs, { params: lang })));
      return true;
    }
    const range = empty ? null : codeBlockRange(state);
    if (range) {
      // 段落裡的換行（hard_break）不是文字，要自己換成「\n」，不然幾行會併成一行
      const text = state.doc.textBetween(range.from, range.to, '\n', leaf => (leaf.type === N.hard_break ? '\n' : ''));
      const node = N.code_block.create({ params: lang }, text ? schema.text(text) : null);
      if (dispatch) {
        const tr = state.tr.replaceWith(range.from, range.to, node);
        tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + node.content.size));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (!empty) {
      // 選取的內容有連結或格式、或不能整個換成程式碼區塊：不轉換、也不取代，在選取範圍所在段落的後面插入新的程式碼區塊
      const st = state.apply(state.tr.setSelection(TextSelection.create(state.doc, $to.end())));
      return insertBlock(N.code_block.create({ params: lang }))(st, tr => {
        if (!dispatch) return;
        const out = state.tr.setSelection(TextSelection.create(state.doc, $to.end()));
        tr.steps.forEach(step => out.step(step));
        out.setSelection(tr.selection.map(out.doc, out.mapping.slice(out.mapping.maps.length)));
        dispatch(out.scrollIntoView());
      });
    }
    return insertBlock(N.code_block.create({ params: lang }))(state, dispatch);
  };
}

// 螢光色彩：color 為 null 是預設黃色；label 是選單名稱；css 是色塊要顯示的顏色（沒有時用 color）
export type HighlightColor = [color: string | null, label: I18nKey, css?: string];

// 螢光（醒目提示）色彩：color 為 null 是預設黃色（==文字==），'none' 是移除
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  [null, '黃色（預設）', 'var(--text-highlight-bg, rgba(255, 208, 0, .4))'],
  ['#4caf5066', '綠色'], ['#00bcd466', '青色'], ['#ff80ab66', '粉紅'], ['#448aff59', '藍色'],
  ['#ff525266', '紅色'], ['#ff980066', '橘色'], ['#b388ff66', '紫色'],
  ['#9e9e9e59', '灰色（字元網底）'],
];
export function setHighlight(color: string | null): Command {
  return (state, dispatch) => {
    const w = wordRangeAt(state);
    const ranges = w ? [w] : state.selection.ranges.map(r => ({ from: r.$from.pos, to: r.$to.pos }));
    if (dispatch) {
      let tr = state.tr;
      if (!w && state.selection.empty) {
        tr = tr.removeStoredMark(M.highlight);
        if (color !== 'none') tr = tr.addStoredMark(M.highlight.create({ color }));
      } else {
        for (const r of ranges) {
          tr = tr.removeMark(r.from, r.to, M.highlight);
          if (color !== 'none') tr = tr.addMark(r.from, r.to, M.highlight.create({ color }));
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
export function currentHighlight(state: EditorState): string | null {
  const { $from, empty, from, to } = state.selection;
  if (empty) { const m = M.highlight.isInSet(state.storedMarks || $from.marks()); return m ? (m.attrs as HighlightAttrs).color || 'default' : null; }
  let c: string | null = null;
  state.doc.nodesBetween(from, to, n => { if (c == null && n.isText) { const m = M.highlight.isInSet(n.marks); if (m) c = (m.attrs as HighlightAttrs).color || 'default'; } });
  return c;
}

// ---------------------------------------------------------------- 對齊

// 只有最外層的段落與標題可以設定對齊／左縮排（存成 HTML 段落）；表格內改設整欄對齊
function topBlocks(state: EditorState, types: NodeType[]): NodeAt[] {
  const out: NodeAt[] = [];
  eachRange(state, (from, to) => {
    // 一律回傳 false（不往裡面走），所以走到的都是最上層的區塊
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (types.includes(node.type)) out.push({ node, pos });
      return false;
    });
  });
  return out;
}

// 選取範圍裡最上層的段落。功能區每次更新會連續問對齊（四個）、縮排（兩個）按鈕能不能用，每個都要這份清單；
// 同一個編輯狀態只走一次文件。全選一份長筆記時，沒有這個快取每移動一次選取要多花二十幾毫秒。
// 回傳的陣列是共用的，呼叫的地方不能改它
const topParagraphCache = new WeakMap<EditorState, NodeAt[]>();
function topParagraphs(state: EditorState): NodeAt[] {
  let out = topParagraphCache.get(state);
  if (!out) { out = topBlocks(state, [N.paragraph]); topParagraphCache.set(state, out); }
  return out;
}

// htmlSafeBlock 要看段落裡的每一個節點。節點不會變（改了就是新的節點），所以結果可以跟著節點記下來
const safeBlockCache = new WeakMap<PMNode, boolean>();
function safeBlock(node: PMNode): boolean {
  let ok = safeBlockCache.get(node);
  if (ok === undefined) { ok = htmlSafeBlock(node); safeBlockCache.set(node, ok); }
  return ok;
}

// 段落對齊方式（表格內的整欄對齊不支援 justify）
export type Align = 'left' | 'center' | 'right' | 'justify';
export type CellAlign = Exclude<Align, 'justify'>;

export function setAlign(align: Align): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return table.alignColumn(align === 'justify' ? 'left' : align)(state, dispatch);
    // 標題不能對齊（存成 HTML 後就不是 Obsidian 的標題了）；含 [[連結]]、圖片、數學式的段落也不行
    const usable = (b: NodeAt): boolean => (align === 'left' ? !!b.node.attrs.align : safeBlock(b.node));
    // 沒有 dispatch 是功能區在問按鈕能不能用：找到一段就夠了
    if (!dispatch) return topParagraphs(state).some(usable);
    const blocks = topParagraphs(state).filter(usable);
    if (!blocks.length) return false;
    if (dispatch) {
      const all = blocks.every(b => (b.node.attrs.align || 'left') === align);
      const value = all && align !== 'left' ? null : (align === 'left' ? null : align);
      const tr = state.tr;
      for (const b of blocks) tr.setNodeMarkup(b.pos, null, Object.assign({}, b.node.attrs, { align: value }));
      dispatch(tr);
    }
    return true;
  };
}
// 對齊／縮排按鈕停用的原因（顯示在提示裡）
export function blockFormatBlocked(state: EditorState): I18nKey | null {
  const $f = state.selection.$from;
  if (isInTable(state)) return null;
  if (inCode(state)) return codeBlocked(state);
  if ($f.parent.type === N.heading) return '標題不能對齊或整段縮排（Markdown 的標題不支援，存成 HTML 會變成不是標題）';
  if ($f.parent.type === N.paragraph && $f.depth === 1 && !htmlSafeBlock($f.parent)) return '這段含有 [[內部連結]]、圖片、數學式或註解，對齊後在 Obsidian 會失效，所以不能對齊；縮排會改用首行縮排';
  if ($f.depth > 1 && !inListItem($f)) return '引文、提示框裡的段落只能用首行縮排（Markdown 不支援對齊）';
  return null;
}

// 游標或選取範圍是否碰到程式碼區塊（裡面只能放純文字）
export function inCode(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return !!$from.parent.type.spec.code || !!$to.parent.type.spec.code;
}
// 程式碼區塊裡不能用的功能：按鈕停用的原因（顯示在提示裡）
export function codeBlocked(state: EditorState): I18nKey | null {
  return inCode(state) ? '程式碼區塊裡只能放純文字，不能使用這個功能。請先把游標移到區塊外面。' : null;
}
// 給按鈕的 enabled：不在程式碼區塊裡
export const notInCode = (state: EditorState): boolean => !inCode(state);

export function currentAlign(state: EditorState): Align | null {
  if (isInTable(state)) {
    const $f = state.selection.$from;
    // 儲存格的 align 型別是 string（從網頁貼上時可能帶入其他 CSS text-align 值）；與原本一樣照原值回傳
    for (let d = $f.depth; d > 0; d--) { const n = $f.node(d); if (n.type === N.table_cell || n.type === N.table_header) return (n.attrs as TableCellAttrs).align || 'left'; }
  }
  const $f = state.selection.$from;
  if ($f.depth === 1 && $f.parent.type === N.paragraph) return ($f.parent.attrs as BlockFormatAttrs).align || 'left';
  return null;
}

// 整段左縮排（像 Word 的「增加縮排」）
function blockIndent(dir: Direction): Command {
  return (state, dispatch) => {
    const usable = (b: NodeAt): boolean => (dir < 0 ? b.node.attrs.indent > 0 : b.node.attrs.indent < 8 && safeBlock(b.node));
    if (!dispatch) return topParagraphs(state).some(usable);
    const blocks = topParagraphs(state).filter(usable);
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const b of blocks) tr.setNodeMarkup(b.pos, null, Object.assign({}, b.node.attrs, { indent: (b.node.attrs as BlockFormatAttrs).indent + dir }));
      dispatch(tr);
    }
    return true;
  };
}

export function setColor(color: string | null): Command {
  return (state, dispatch) => {
    if (dispatch) {
      let tr = state.tr;
      const w = wordRangeAt(state);
      if (w) {
        tr = tr.removeMark(w.from, w.to, M.color);
        if (color) tr = tr.addMark(w.from, w.to, M.color.create({ color }));
      } else if (state.selection.empty) {
        tr = tr.removeStoredMark(M.color);
        if (color) tr = tr.addStoredMark(M.color.create({ color }));
      } else {
        eachRange(state, (from, to) => {
          tr = tr.removeMark(from, to, M.color);
          if (color) tr = tr.addMark(from, to, M.color.create({ color }));
        });
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 移除一段文字的格式，連結留著：連結是內容不是格式（Word 的清除格式、格式刷也不會動超連結），拿掉就找不回網址了
function removeFormats(tr: Transaction, from: number, to: number): Transaction {
  for (const type of Object.values(M)) if (type !== M.link) tr.removeMark(from, to, type);
  return tr;
}

// 清除格式（像 Word 的「清除所有格式」）：移除文字格式，標題與程式碼區塊改回內文
export function clearFormatting(state: EditorState, dispatch?: Dispatch): boolean {
  if (dispatch) {
    let tr = state.tr;
    const w = wordRangeAt(state);
    if (w) tr = removeFormats(tr, w.from, w.to);
    else if (state.selection.empty) tr = tr.setStoredMarks((state.storedMarks || state.selection.$from.marks()).filter(m => m.type === M.link));
    else eachRange(state, (from, to) => { tr = removeFormats(tr, from, to); });
    eachRange(state, (from, to) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === N.heading || node.type === N.code_block) {
          // 用 retype 而不是 setNodeMarkup：程式碼區塊裡的每一行要變成段落裡的換行
          tr = retype(tr, pos + 1, pos + 1, N.paragraph, () => ({ bid: (node.attrs as BidAttrs).bid != null ? (node.attrs as BidAttrs).bid : null }));
          return false;
        }
        return !node.isTextblock;
      });
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// 選取範圍裡出現過的格式。功能區有十來個格式按鈕，各自把選取範圍掃一遍，不如同一個編輯狀態一起掃一次
const marksCache = new WeakMap<EditorState, Set<MarkType>>();
function marksInSelection(state: EditorState): Set<MarkType> {
  let set = marksCache.get(state);
  if (!set) {
    const found = new Set<MarkType>();
    state.doc.nodesBetween(state.selection.from, state.selection.to, node => { for (const m of node.marks) found.add(m.type); });
    marksCache.set(state, set = found);
  }
  return set;
}

export function markActive(state: EditorState, type: MarkType): boolean {
  const { $from, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return marksInSelection(state).has(type);
}

// 格式刷：記住游標處的格式，套用到之後選取的文字
export function captureMarks(state: EditorState): readonly Mark[] {
  const { $from, empty, from } = state.selection;
  if (empty) return state.storedMarks || $from.marks();
  const n = state.doc.nodeAt(from);
  return n ? n.marks : $from.marks();
}
export function applyMarks(marks: readonly Mark[]): Command {
  return (state, dispatch) => {
    if (state.selection.empty) return false;
    if (dispatch) {
      let tr = state.tr;
      eachRange(state, (from, to) => {
        // 換掉目標的格式；目標原本的連結留著，來源的連結也不會帶過去
        tr = removeFormats(tr, from, to);
        for (const m of marks) if (m.type !== M.link) tr = tr.addMark(from, to, m);
      });
      dispatch(tr);
    }
    return true;
  };
}

// 段落樣式代號：p＝內文、h1～h6＝標題、code＝程式碼區塊
export type BlockStyleId = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'code';
// 段落樣式選單的一項
export interface BlockStyle { id: BlockStyleId; label: I18nKey; }

// ---------------------------------------------------------------- 段落樣式

export const BLOCK_STYLES: BlockStyle[] = [
  { id: 'p', label: '內文' },
  { id: 'h1', label: '標題 1' }, { id: 'h2', label: '標題 2' }, { id: 'h3', label: '標題 3' },
  { id: 'h4', label: '標題 4' }, { id: 'h5', label: '標題 5' }, { id: 'h6', label: '標題 6' },
  { id: 'code', label: '程式碼' },
];

// 改變文字區塊的種類（setBlockType），並保住換行：段落裡的換行是 hard_break 節點，程式碼區塊裡是文字「\n」。
// 程式碼區塊不能放 hard_break，直接轉會被丟掉、幾行併成一行；反過來「\n」留在段落裡，讀回來才會變成換行。
// 兩者都佔一個位置，互換之後其他位置不變
function retype(tr: Transaction, from: number, to: number, type: NodeType, attrs: (node: PMNode) => Attrs): Transaction {
  const toCode = !!type.spec.code;
  const swaps: number[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const $pos = tr.doc.resolve(pos);
    // 跟 setBlockType 一樣的條件：這個位置不能換成新的種類時它不會動，這裡也不能動
    if (!!node.type.spec.code === toCode || !$pos.parent.canReplaceWith($pos.index(), $pos.index() + 1, type)) return false;
    node.forEach((child, offset) => {
      if (toCode) { if (child.type === N.hard_break) swaps.push(pos + 1 + offset); }
      else if (child.isText) for (let i = 0; i < child.text!.length; i++) if (child.text![i] === '\n') swaps.push(pos + 1 + offset + i);
    });
    return false;
  });
  if (toCode) for (const p of swaps) tr.replaceWith(p, p + 1, schema.text('\n'));
  tr.setBlockType(from, to, type, attrs);
  if (!toCode) for (const p of swaps) tr.replaceWith(p, p + 1, N.hard_break.create());
  return tr;
}

function styleType(id: BlockStyleId): [NodeType, { level?: number }] {
  if (id === 'p') return [N.paragraph, {}];
  if (id === 'code') return [N.code_block, {}];
  return [N.heading, { level: +id.slice(1) }];
}

export function setBlockStyle(id: BlockStyleId): Command {
  const [type, attrs] = styleType(id);
  return (state, dispatch) => {
    // 轉成程式碼會把連結、圖片、格式變成純文字：只允許純文字段落
    if (type === N.code_block && !plainSelection(state)) return false;
    let applicable = false;
    eachRange(state, (from, to) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (applicable) return false;
        if (!node.isTextblock) return;
        if (node.type === type && (type !== N.heading || node.attrs.level === attrs.level)) return;
        const $pos = state.doc.resolve(pos);
        const i = $pos.index();
        applicable = $pos.parent.canReplaceWith(i, i + 1, type);
      });
    });
    if (!applicable) return false;
    if (dispatch) {
      let tr = state.tr;
      eachRange(state, (from, to) => {
        tr = retype(tr, from, to, type, node => Object.assign({}, attrs, { bid: (node.attrs as BidAttrs).bid != null ? (node.attrs as BidAttrs).bid : null }));
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function currentBlockStyle(state: EditorState): BlockStyleId {
  const p = state.selection.$from.parent;
  if (p.type === N.heading) return ('h' + p.attrs.level) as BlockStyleId;
  if (p.type === N.code_block) return 'code';
  return 'p';
}

function findAncestor($pos: ResolvedPos, pred: (node: PMNode) => boolean): Ancestor | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (pred(node)) return { node, depth: d, pos: $pos.before(d) };
  }
  return null;
}

export function toggleQuote(state: EditorState, dispatch?: Dispatch): boolean {
  if (findAncestor(state.selection.$from, n => n.type === N.blockquote)) return lift(state, dispatch);
  return wrapIn(N.blockquote)(state, dispatch);
}

export function inQuote(state: EditorState): boolean {
  return !!findAncestor(state.selection.$from, n => n.type === N.blockquote);
}

// 清單種類：項目符號、編號、核取清單（任務）
export type ListKind = 'bullet' | 'ordered' | 'task';

// ---------------------------------------------------------------- 清單

const isList = (n: PMNode): boolean => n.type === N.bullet_list || n.type === N.ordered_list;
const isTaskList = (n: PMNode): boolean => n.childCount > 0 && n.firstChild!.attrs.checked != null;

export function currentList(state: EditorState): ListKind | null {
  const l = findAncestor(state.selection.$from, isList);
  if (!l) return null;
  if (l.node.type === N.ordered_list) return 'ordered';
  return isTaskList(l.node) ? 'task' : 'bullet';
}

export function toggleList(kind: ListKind): Command {
  const target = kind === 'ordered' ? N.ordered_list : N.bullet_list;
  return (state, dispatch) => {
    const l = findAncestor(state.selection.$from, isList);
    if (l) {
      const cur = l.node.type === N.ordered_list ? 'ordered' : isTaskList(l.node) ? 'task' : 'bullet';
      if (cur === kind) return liftListItem(N.list_item)(state, dispatch);
      if (dispatch) {
        let tr = state.tr;
        if (l.node.type !== target) {
          const listAttrs = l.node.attrs as BulletListAttrs | OrderedListAttrs;
          const attrs = target === N.ordered_list
            ? { order: 1, tight: listAttrs.tight, bid: listAttrs.bid }
            : { tight: listAttrs.tight, bullet: '-', bid: listAttrs.bid };
          tr = tr.setNodeMarkup(l.pos, target, attrs);
        }
        l.node.forEach((child, offset) => {
          const itemAttrs = child.attrs as ListItemAttrs;
          const checked = kind === 'task' ? (itemAttrs.checked != null ? itemAttrs.checked : false) : null;
          tr = tr.setNodeMarkup(l.pos + 1 + offset, null, Object.assign({}, child.attrs, { checked, status: checked ? itemAttrs.status : null }));
        });
        dispatch(tr);
      }
      return true;
    }
    const wrap = wrapInList(target, target === N.ordered_list ? { order: 1, tight: true } : { tight: true });
    if (!wrap(state)) return false;
    if (dispatch) {
      wrap(state, tr => {
        if (kind === 'task') {
          const from = tr.mapping.map(state.selection.from, -1);
          const to = tr.mapping.map(state.selection.to, 1);
          tr.doc.nodesBetween(from, to, (n, pos) => {
            if (n.type === N.list_item && n.attrs.checked == null) tr.setNodeMarkup(pos, null, { checked: false });
          });
        }
        dispatch(tr.scrollIntoView());
      });
    }
    return true;
  };
}

// 段落縮排：Markdown 沒有段落左縮排，改用中文常見的「首行縮排兩個全形空白」
const INDENT = '\u3000\u3000';
const LEAD = /^[\u3000 \t]{1,2}/;
function inListItem($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === N.list_item) return true;
  return false;
}
// 選取範圍裡不在清單項目內的段落。跟 topParagraphs 一樣，同一個編輯狀態只走一次文件，回傳的陣列不能改
const paragraphCache = new WeakMap<EditorState, NodeAt[]>();
function paragraphsInSelection(state: EditorState): NodeAt[] {
  const hit = paragraphCache.get(state);
  if (hit) return hit;
  const out: NodeAt[] = [];
  eachRange(state, (from, to) => {
    state.doc.nodesBetween(from, to, (node, pos) => {
      // 清單項目裡的段落不算：整個項目不用往裡面走
      if (node.type === N.list_item) return false;
      if (node.type === N.paragraph) { out.push({ node, pos }); return false; }
      return true;
    });
  });
  paragraphCache.set(state, out);
  return out;
}
function paragraphIndent(dir: Direction, topLevelToo?: boolean): Command {
  return (state, dispatch) => {
    const usable = (p: NodeAt): boolean => (dir > 0
      ? !!topLevelToo || state.doc.resolve(p.pos).depth > 0
      : !!(p.node.firstChild && p.node.firstChild.isText && LEAD.test(p.node.firstChild.text!)));
    if (!dispatch) return paragraphsInSelection(state).some(usable);
    const paras = paragraphsInSelection(state).filter(usable);
    if (!paras.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const p of paras.slice().reverse()) {
        const start = p.pos + 1;
        if (dir > 0) tr.insertText(INDENT, start);
        else tr.delete(start, start + p.node.firstChild!.text!.match(LEAD)![0].length);
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 增加縮排：清單項目變成下一層；一般段落整段往右縮（引文、提示框內的段落用首行縮排）
export const indent = chainCommands(sinkListItem(N.list_item), (s, d) => blockIndent(1)(s, d), paragraphIndent(1, true));
// 減少縮排：清單項目往上一層（最上層時取消清單）；一般段落減少左縮排，最後移除首行縮排
export const outdent = chainCommands(liftListItem(N.list_item), (s, d) => blockIndent(-1)(s, d), paragraphIndent(-1));

// ---------------------------------------------------------------- 插入

export function insertInline(node: PMNode): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.type.contentMatch.matchType(node.type) && !$from.parent.inlineContent) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}

export function insertText(text: string, marks?: readonly Mark[] | null): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const { from, to } = state.selection;
      const tr = state.tr.insertText(text, from, to);
      if (marks) for (const m of marks) tr.addMark(from, from + text.length, m);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 游標所在連結的範圍、連結的 mark 與連結文字
export interface LinkRange extends TextRange { mark: Mark; text: string; }

// 取得游標所在連結的範圍
export function linkRange(state: EditorState): LinkRange | null {
  const { $from } = state.selection;
  const mark = M.link.isInSet($from.marks()) || ($from.nodeAfter && M.link.isInSet($from.nodeAfter.marks));
  if (!mark) return null;
  const start = $from.start();
  const runs: TextRange[] = [];
  $from.parent.forEach((child, offset) => {
    const a = start + offset; const b = a + child.nodeSize;
    if (!mark.isInSet(child.marks)) return;
    const last = runs[runs.length - 1];
    if (last && last.to === a) last.to = b; else runs.push({ from: a, to: b });
  });
  const r = runs.find(x => x.from <= $from.pos && x.to >= $from.pos);
  if (!r) return null;
  return { from: r.from, to: r.to, mark, text: state.doc.textBetween(r.from, r.to) };
}

export function insertBlock(node: PMNode): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(node);
      let found = null as number | null;
      tr.doc.descendants((n, pos) => { if (found == null && n === node) found = pos; return found == null; });
      if (found != null) {
        const inside = found + 1;
        try {
          const at = node.type === N.table ? found + 4 : node.isTextblock ? inside
            : node.firstChild && node.firstChild.isTextblock ? found + 2 : found + node.nodeSize;
          const sel = TextSelection.near(tr.doc.resolve(at));
          tr.setSelection(sel);
        } catch { /* 保持預設 */ }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function insertHr(state: EditorState, dispatch?: Dispatch): boolean {
  return insertBlock(N.horizontal_rule.create())(state, dispatch);
}

function createTable(rows: number, cols: number): PMNode {
  const header = N.table_row.create(null, Array.from({ length: cols }, () => N.table_header.createAndFill()!));
  const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
    N.table_row.create(null, Array.from({ length: cols }, () => N.table_cell.createAndFill()!)));
  return N.table.create(null, [header, ...body]);
}

export function insertTable(rows: number, cols: number): Command {
  return (state, dispatch) => insertBlock(createTable(rows, cols))(state, dispatch);
}

// 表格指令（工具列、右鍵選單用）
export interface TableCommands {
  isIn: (state: EditorState) => boolean;
  addRowBefore: Command;
  addRowAfter: Command;
  addColumnBefore: Command;
  addColumnAfter: Command;
  deleteRow: Command;
  deleteColumn: Command;
  deleteTable: Command;
  // 只設定選取的儲存格
  align: (a: CellAlign) => Command;
  // 設定游標所在的整欄
  alignColumn(a: CellAlign): Command;
}

// ---------------------------------------------------------------- 表格

export const table: TableCommands = {
  isIn: isInTable,
  addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn, deleteTable,
  align: (a: CellAlign) => setCellAttr('align', a),
  // Markdown 的對齊是整欄的：一次設定整欄
  alignColumn(a: CellAlign): Command {
    return (state, dispatch) => {
      if (!isInTable(state)) return false;
      const $cell = state.selection instanceof CellSelection ? state.selection.$anchorCell : null;
      const $from = state.selection.$from;
      const t = findAncestor($from, n => n.type === N.table);
      if (!t) return false;
      const cellDepth = (() => { for (let d = $from.depth; d > 0; d--) { const tn = $from.node(d).type; if (tn === N.table_cell || tn === N.table_header) return d; } return null; })();
      let col: number;
      if ($cell) col = $cell.index();
      else if (cellDepth != null) col = $from.index(cellDepth - 1);
      else return false;
      if (dispatch) {
        let tr = state.tr;
        t.node.forEach((row, rowOff) => {
          let i = 0;
          row.forEach((cell, cellOff) => {
            if (i === col) tr = tr.setNodeMarkup(t.pos + 1 + rowOff + 1 + cellOff, null, Object.assign({}, cell.attrs, { align: a }));
            i++;
          });
        });
        dispatch(tr);
      }
      return true;
    };
  },
};

function inTableCell(state: EditorState): boolean {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === N.table_cell || t === N.table_header) return true;
  }
  return false;
}


// ---------------------------------------------------------------- 移動段落（Alt+↑／Alt+↓）

// 移動游標所在的清單項目、表格列或段落（與上一個／下一個交換位置）
export function moveBlock(dir: Direction): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let d: number | null = null;
    for (let i = $from.depth; i > 0; i--) {
      const t = $from.node(i).type;
      if (t === N.list_item || t === N.table_row) { d = i; break; }
    }
    if (d == null) d = 1;
    if ($from.depth < d) return false;
    const parent = $from.node(d - 1);
    const index = $from.index(d - 1);
    const target = index + dir;
    if (target < 0 || target >= parent.childCount) return false;
    const node = $from.node(d);
    // 表格的標題列固定在最上面：標題列不能搬，其他列也不能搬到它上面
    if (node.type === N.table_row && (index === 0 || target === 0)) return false;
    const start = $from.before(d);
    const end = $from.after(d);
    if ($to.pos > end) return false;
    if (dispatch) {
      const sib = parent.child(target);
      const a = state.selection.from - start;
      const b = state.selection.to - start;
      const tr = state.tr;
      let newStart: number;
      if (dir < 0) {
        newStart = start - sib.nodeSize;
        tr.delete(start, end).insert(newStart, node);
      } else {
        newStart = start + sib.nodeSize;
        tr.insert(end + sib.nodeSize, node).delete(start, end);
      }
      try { tr.setSelection(TextSelection.create(tr.doc, newStart + a, newStart + b)); } catch { /* 保持預設 */ }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ---------------------------------------------------------------- 表格排序

function cellText(cell: PMNode): string { return cell.textContent.trim(); }
function asNumber(t: string): number | null {
  const s = t.replace(/[,\s，]/g, '').replace(/[%％]$/, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : null;
}

// 依游標所在的欄排序（標題列不動）；數字依大小、文字依中文筆畫／字母順序
export function sortTableByColumn(dir: Direction): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from;
    let tDepth: number | null = null;
    for (let i = $from.depth; i > 0; i--) if ($from.node(i).type === N.table) { tDepth = i; break; }
    if (tDepth == null || $from.depth < tDepth + 2) return false;
    const table = $from.node(tDepth);
    if (table.childCount < 3) return false;
    const col = $from.index(tDepth + 1);
    if (dispatch) {
      const rows: PMNode[] = [];
      table.forEach(r => rows.push(r));
      const head = rows[0];
      const body = rows.slice(1);
      const key = (r: PMNode): string => (r.childCount > col ? cellText(r.child(col)) : '');
      const allNum = body.every(r => { const t = key(r); return t === '' || asNumber(t) != null; });
      const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
      const sorted = body.map((r, i) => ({ r, i })).sort((x, y) => {
        const a = key(x.r); const b = key(y.r);
        if (a === '' && b !== '') return 1;
        if (b === '' && a !== '') return -1;
        // allNum 時非空白的格都是數字；兩格都空白時是 null - null（等於 0）
        const c = allNum ? asNumber(a)! - asNumber(b)! : collator.compare(a, b);
        return (c || x.i - y.i) * (c ? dir : 1);
      }).map(x => x.r);
      const pos = $from.before(tDepth);
      const node = table.type.create(table.attrs, [head, ...sorted]);
      const tr = state.tr.replaceWith(pos, pos + table.nodeSize, node);
      try { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(state.selection.from, tr.doc.content.size)))); } catch { /* 保持預設 */ }
      dispatch(tr);
    }
    return true;
  };
}

// 把游標所在的欄與左邊／右邊的欄交換（每一列都換，對齊跟著欄走）
export function moveTableColumn(dir: Direction): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from;
    let tDepth: number | null = null;
    for (let i = $from.depth; i > 0; i--) if ($from.node(i).type === N.table) { tDepth = i; break; }
    if (tDepth == null || $from.depth < tDepth + 2) return false;
    const table = $from.node(tDepth);
    const rowIndex = $from.index(tDepth);
    const col = $from.index(tDepth + 1);
    const to = col + dir;
    if (to < 0 || to >= table.child(rowIndex).childCount) return false;
    if (dispatch) {
      const rows: PMNode[] = [];
      table.forEach(r => {
        // 格數不夠的列（不整齊的表格）不動
        if (r.childCount <= Math.max(col, to)) { rows.push(r); return; }
        const cells: PMNode[] = [];
        r.forEach(c => cells.push(c));
        [cells[col], cells[to]] = [cells[to], cells[col]];
        rows.push(r.type.create(r.attrs, cells));
      });
      const pos = $from.before(tDepth);
      const node = table.type.create(table.attrs, rows);
      const tr = state.tr.replaceWith(pos, pos + table.nodeSize, node);
      // 游標跟著搬過去的儲存格：算出它在新表格裡的位置，加上游標原本在儲存格裡的偏移
      let cellPos = pos + 1;
      for (let r = 0; r < rowIndex; r++) cellPos += node.child(r).nodeSize;
      cellPos += 1;
      for (let c = 0; c < to; c++) cellPos += node.child(rowIndex).child(c).nodeSize;
      const offset = $from.pos - $from.before(tDepth + 2);
      try { tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + offset))); } catch { /* 保持預設 */ }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 提示框種類：type 是 [!type] 裡的名稱，label 是選單名稱，icon 是 Obsidian（Lucide）圖示名稱
export type CalloutType = [type: string, label: I18nKey, icon: string];

// ---------------------------------------------------------------- 提示框（callout）

export const CALLOUT_TYPES: CalloutType[] = [
  ['note', '備註', 'pencil'], ['info', '資訊', 'info'], ['tip', '提示', 'flame'], ['important', '重要', 'flame'],
  ['success', '完成', 'check'], ['question', '問題', 'help-circle'], ['warning', '注意', 'alert-triangle'],
  ['danger', '危險', 'zap'], ['failure', '失敗', 'x'], ['example', '範例', 'list'], ['quote', '引用', 'quote'],
  ['abstract', '摘要', 'clipboard-list'], ['todo', '待辦', 'check-circle-2'], ['bug', '問題回報', 'bug'],
];

export function calloutIcon(type: string | null | undefined): string {
  const t = (type || '').toLowerCase();
  const alias: Record<string, string> = { summary: 'abstract', tldr: 'abstract', hint: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question',
    caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };
  const k = alias[t] || t;
  const hit = CALLOUT_TYPES.find(x => x[0] === k);
  return hit ? hit[2] : 'pencil';
}

// 把選取的段落放進提示框；沒有可包的段落時插入空的提示框
export function insertCallout(type: string): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    const wrap = wrapIn(N.callout, { type, title: null, fold: '' });
    if (wrap(state)) return wrap(state, dispatch);
    return insertBlock(N.callout.create({ type, title: null, fold: '' }, N.paragraph.create()))(state, dispatch);
  };
}

// ---------------------------------------------------------------- 鍵盤

const insertHardBreak: Command = (state, dispatch) => {
  const br = N.hard_break;
  if (!state.selection.$from.parent.type.contentMatch.matchType(br) && !state.selection.$from.parent.inlineContent) return false;
  if (state.selection.$from.parent.type.spec.code) return false;
  if (state.selection.$from.parent.type === N.heading) return false; // Markdown 的標題只能一行
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
  return true;
};

const tabInText: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if ($from.parent.type === N.heading) return true; // 標題不縮排（Markdown 不支援）
  if ((!empty || $from.parentOffset === 0) && paragraphIndent(1, true)(state, dispatch)) return true;
  if (state.selection.$from.parent.type.spec.code) {
    if (dispatch) dispatch(state.tr.insertText('\t'));
    return true;
  }
  if (dispatch) dispatch(state.tr.insertText('　'));
  return true;
};

// 清單項目開頭按 Backspace：先跳出清單（像 Word）
const backspaceLift: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0) return false;
  const li = findAncestor($from, n => n.type === N.list_item);
  if (!li) return false;
  if ($from.index(li.depth) !== 0) return false;
  return liftListItem(N.list_item)(state, dispatch);
};

// 用 Backspace（dir = -1，游標在區塊開頭）或 Delete（dir = 1，游標在區塊結尾）把兩個區塊併在一起，
// 而其中一個是程式碼區塊、另一個不是：先把要併過去的那一塊的換行換成對方的寫法，再合併。
// 段落裡的換行是一個節點（hard_break），程式碼區塊裡是文字「\n」；ProseMirror 內建的合併遇到對方不收的東西
// 是直接丟掉，「程式碼」加「x⏎y」會變成「程式碼xy」。不是這種情況就回傳 false，交給內建的合併
function joinKeepingBreaks(dir: Direction): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.empty) return false;
    const $c = sel.$from;
    if ($c.depth < 1 || !$c.parent.isTextblock) return false;
    if (dir < 0 ? $c.parentOffset > 0 : $c.parentOffset < $c.parent.content.size) return false;
    // 兩個區塊的交界；前面那一塊留下來，後面那一塊的內容併進去
    const cut = dir < 0 ? $c.before() : $c.after();
    const $cut = state.doc.resolve(cut);
    const before = $cut.nodeBefore; const after = $cut.nodeAfter;
    if (!before || !after || !before.isTextblock || !after.isTextblock) return false;
    const toCode = !!before.type.spec.code;
    if (toCode === !!after.type.spec.code) return false;
    const swaps: number[] = [];
    after.forEach((child, offset) => {
      if (toCode) { if (child.type === N.hard_break) swaps.push(cut + 1 + offset); }
      else if (child.isText) for (let i = 0; i < child.text!.length; i++) if (child.text![i] === '\n') swaps.push(cut + 1 + offset + i);
    });
    if (!swaps.length) return false;
    if (dispatch) {
      const tr = state.tr;
      // 換行的節點與「\n」都佔一個位置，逐一換掉不會動到其他位置
      if (toCode) {
        // 併進程式碼區塊：先在段落裡把換行換成「\n」，再跟內建的合併一樣拿掉程式碼區塊不收的東西（粗體這類格式）
        for (const p of swaps) tr.replaceWith(p, p + 1, schema.text('\n'));
        tr.clearIncompatible(cut, before.type, before.contentMatchAt(before.childCount));
        tr.join(cut);
      } else {
        // 程式碼區塊併進段落：程式碼區塊裡放不了換行的節點，所以先合併、再把「\n」換掉。
        // 這裡不能呼叫 clearIncompatible：它會把不是程式碼的區塊裡的「\n」換成空白。
        // 合併拿掉交界的兩個位置，後面的內容往前移 2
        tr.join(cut);
        for (const p of swaps) tr.replaceWith(p - 2, p - 1, N.hard_break.create());
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 段落開頭按 Backspace、前面是文件屬性或原文區塊（方程式、HTML、註解…）：先選取它，再按一次才刪除。
// 避免一個按鍵就把整個屬性區塊或方程式刪掉而沒發現
const selectAtomBefore: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0 || $from.depth !== 1) return false;
  const index = $from.index(0);
  if (index === 0) return false;
  const before = state.doc.child(index - 1);
  if (before.type !== N.frontmatter && before.type !== N.raw_block) return false;
  if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $from.before(1) - before.nodeSize)).scrollIntoView());
  return true;
};

// 標題行尾按 Enter：下一段回到內文
const enterAfterHeading: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== N.heading || $from.parentOffset !== $from.parent.content.size) return false;
  if (dispatch) {
    const pos = $from.after();
    const tr = state.tr.insert(pos, N.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// 表格內 Tab：跳下一格；在最後一格時新增一列（像 Word）
const tabInTable: Command = (state, dispatch, view) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  if (dispatch && view) {
    addRowAfter(state, dispatch);
    goToNextCell(1)(view.state, view.dispatch);
  }
  return true;
};

export function buildKeymap(): Record<string, Command> {
  const keys: Record<string, Command> = {
    'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
    'Mod-b': toggleBold, 'Mod-i': toggleItalic, 'Mod-u': toggleUnderline,
    'Mod-Shift-x': toggleStrike, 'Mod-Shift-h': toggleHighlight, 'Mod-`': toggleCode,
    'Mod-l': setAlign('left'), 'Mod-j': setAlign('justify'),
    'Mod-Alt-0': setBlockStyle('p'),
    'Shift-Enter': chainCommands(insertHardBreak, (s, d) => (s.selection.$from.parent.type === N.heading ? enterAfterHeading(s, d) || baseKeymap.Enter(s, d) : false)),
    'Mod-Enter': chainCommands(exitCode, insertHardBreak),
    Enter: chainCommands(
      autoformatEnter,
      (s, d) => (inTableCell(s) ? insertHardBreak(s, d) : false),
      splitListItem(N.list_item),
      enterAfterHeading,
    ),
    Tab: chainCommands(tabInTable, sinkListItem(N.list_item), (s) => !!currentList(s), tabInText),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(N.list_item), paragraphIndent(-1), () => true),
    Backspace: chainCommands(undoAutoformat, backspaceLift, selectAtomBefore, joinKeepingBreaks(-1)),
    Delete: joinKeepingBreaks(1),
    'Alt-ArrowUp': moveBlock(-1),
    'Alt-ArrowDown': moveBlock(1),
  };
  for (let i = 1; i <= 6; i++) keys['Mod-Alt-' + i] = setBlockStyle(('h' + i) as BlockStyleId);
  return keys;
}

export { baseKeymap, undo };
