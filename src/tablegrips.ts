// 表格的列與欄把手（不依賴 Obsidian）：游標所在的表格，每一列開頭、每一欄上方的格線上各有一個小把手，
// 按一下選取整列或整欄，再開選單（插入、移動、對齊、排序、刪除）。手機沒有右鍵選單，表格靠這個與功能區操作。
// 同時在游標所在的表格加上 is-active，讓右上角的按鈕一直顯示（nodeviews.ts 的 WordTableView）。
// 表格的上面或下面沒有地方可以打字時（兩個表格相鄰、表格在文件或提示框的最前面、最後面、旁邊是程式碼或方程式），
// 在表格加上 has-para-before／has-para-after，那一邊的「＋ 段落」才出現（按鈕在 nodeviews.ts 的 WordTableView 裡，
// 位置跟著表格的外框，不會跟提示框、引文外面的字疊在一起）。手機沒有 Ctrl+Enter 也沒有方向鍵，原本沒辦法在那裡打字
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { CellSelection } from 'prosemirror-tables';
import { t } from './i18n.js';
import { el } from './dom.js';
import { schema } from './schema.js';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';

const N = schema.nodes;

// 把手的種類：整列、整欄
export type GripKind = 'row' | 'col';

// 按下把手、選好整列或整欄之後要做的事（開選單）；anchor 是把手本身，選單開在它旁邊
export type OpenGripMenu = (view: EditorView, kind: GripKind, anchor: HTMLElement) => void;

export const tableGripsKey = new PluginKey('wmTableGrips');

// 游標所在（或選取所在）的表格；整張表被選取時也算
function activeTable(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection;
  const $p = sel instanceof CellSelection ? sel.$anchorCell : sel.$from;
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === N.table) return { node: $p.node(d), pos: $p.before(d) };
  const after = $p.nodeAfter;
  if (after && after.type === N.table && sel.from === $p.pos && sel.to === $p.pos + after.nodeSize) return { node: after, pos: $p.pos };
  return null;
}

// 把手的狀態：current＝游標所在的列或欄，selected＝整列或整欄被選取（不含整張表被選取，那時每一格都反白，不用再標）
type GripState = 'current' | 'selected' | null;

// 游標所在的列與欄（第幾列、第幾欄），以及被選取的整列、整欄
interface GripFocus { row: number; col: number; rows: Set<number>; cols: Set<number>; }

// 指在儲存格前面的位置 → 第幾列、第幾欄（Markdown 的表格沒有合併儲存格，用索引就好）
const rowOf = ($cell: ResolvedPos): number => $cell.index($cell.depth - 1);
const colOf = ($cell: ResolvedPos): number => $cell.index();

function focusOf(state: EditorState): GripFocus {
  const sel = state.selection;
  const f: GripFocus = { row: -1, col: -1, rows: new Set(), cols: new Set() };
  if (sel instanceof CellSelection) {
    const byRow = sel.isRowSelection(); const byCol = sel.isColSelection();
    // 只選了幾格：拖選的終點那一格算游標所在的列與欄。選了整列、整欄或整張表時不標游標所在的位置
    if (!byRow && !byCol) { f.row = rowOf(sel.$headCell); f.col = colOf(sel.$headCell); }
    if (byRow !== byCol) {
      const [a, b] = byRow ? [rowOf(sel.$anchorCell), rowOf(sel.$headCell)] : [colOf(sel.$anchorCell), colOf(sel.$headCell)];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) (byRow ? f.rows : f.cols).add(i);
    }
    return f;
  }
  const $f = sel.$from;
  for (let d = $f.depth; d > 1; d--) {
    const t = $f.node(d).type;
    if (t === N.table_cell || t === N.table_header) { f.row = $f.index(d - 2); f.col = $f.index(d - 1); break; }
  }
  return f;
}

// pos 是儲存格裡段落前面的位置
function grip(pos: number, kind: GripKind, index: number, state: GripState, open: OpenGripMenu): Decoration {
  return Decoration.widget(pos, (view: EditorView, getPos: () => number | undefined) => {
    const b = el('button', 'wm-table-grip is-' + kind + (state ? ' is-' + state : ''));
    b.type = 'button';
    b.contentEditable = 'false';
    b.setAttribute('aria-label', kind === 'row' ? t('選取整列') : t('選取整欄'));
    // 不搶走編輯區的焦點，也不讓瀏覽器把游標移到這裡（觸控也是，螢幕鍵盤才不會收起來）
    const hold = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    b.addEventListener('pointerdown', hold);
    b.addEventListener('mousedown', hold);
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      // 位置在按下時才算：把手的 DOM 會沿用到之後的狀態，建立時記下的位置可能已經過時
      const at = getPos();
      if (at == null) return;
      // 把手放在儲存格的段落前面，往前一個位置就是儲存格的開頭
      const $cell = view.state.doc.resolve(at - 1);
      if (!$cell.nodeAfter || ($cell.nodeAfter.type !== N.table_cell && $cell.nodeAfter.type !== N.table_header)) return;
      view.dispatch(view.state.tr.setSelection(kind === 'row' ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell)));
      view.focus();
      open(view, kind, b);
    });
    return b;
  }, {
    side: -1, ignoreSelection: true, stopEvent: () => true,
    // 同一個位置、同一個狀態的把手沿用 DOM（不用每打一個字就重建）；狀態變了才換新的
    key: 'wm-grip-' + kind + index + (state || ''),
  });
}

// 旁邊是這些就不用「＋ 段落」：點進去就能打字
function typable(n: PMNode | null | undefined): boolean {
  if (!n) return false;
  const name = n.type.name;
  // 程式碼區塊也是 textblock，但在裡面打的是程式碼，不是段落：要有按鈕
  return (n.isTextblock && !n.type.spec.code) || name === 'bullet_list' || name === 'ordered_list' || name === 'blockquote' || name === 'callout';
}

function gripState(index: number, current: number, selected: Set<number>): GripState {
  return selected.has(index) ? 'selected' : index === current ? 'current' : null;
}

function decorate(state: EditorState, open: OpenGripMenu): DecorationSet | null {
  const tb = activeTable(state);
  if (!tb) return null;
  const $t = state.doc.resolve(tb.pos);
  const $end = state.doc.resolve(tb.pos + tb.node.nodeSize);
  const cls = 'is-active' + (typable($t.nodeBefore) ? '' : ' has-para-before') + (typable($end.nodeAfter) ? '' : ' has-para-after');
  const decos: Decoration[] = [Decoration.node(tb.pos, tb.pos + tb.node.nodeSize, { class: cls })];
  const f = focusOf(state);
  let rowPos = tb.pos + 1;
  tb.node.forEach((row, _off, r) => {
    let cellPos = rowPos + 1;
    row.forEach((cell, _o, c) => {
      // 每一列的第一格放列的把手；第一列的每一格放欄的把手
      if (c === 0) decos.push(grip(cellPos + 1, 'row', r, gripState(r, f.row, f.rows), open));
      if (r === 0) decos.push(grip(cellPos + 1, 'col', c, gripState(c, f.col, f.cols), open));
      cellPos += cell.nodeSize;
    });
    rowPos += row.nodeSize;
  });
  return DecorationSet.create(state.doc, decos);
}

export function tableGripsPlugin(open: OpenGripMenu): Plugin {
  return new Plugin({
    key: tableGripsKey,
    props: { decorations: state => decorate(state, open) },
  });
}
