// Word 模式的編輯指令（純 ProseMirror，不依賴 Obsidian，方便測試）
import { TextSelection, NodeSelection, Plugin, Selection } from 'prosemirror-state';
import { toggleMark, wrapIn, lift, baseKeymap, chainCommands, exitCode, selectAll } from 'prosemirror-commands';
import { wrapInList, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import {
  addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn, deleteTable,
  goToNextCell, setCellAttr, isInTable, CellSelection,
} from 'prosemirror-tables';
import { schema } from './schema.js';
import { htmlSafeBlock } from './markdown.js';

const N = schema.nodes;
const M = schema.marks;

// ---------------------------------------------------------------- 文字格式

function eachRange(state, fn) {
  for (const r of state.selection.ranges) fn(r.$from.pos, r.$to.pos);
}

// 游標所在的「詞」（像 Word：沒有選取文字時，格式套用到游標所在的詞）
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh-Hant', { granularity: 'word' }) : null;
export const options = { wordAtCursor: true, onCompat: null };

// Markdown 不支援的組合：標題、清單、引文、表格裡的對齊／縮排；含 [[連結]]、圖片、數學式的段落對齊。
// 每次修改後自動取消這些格式，讓 Word 畫面看到的跟 Markdown／閱讀模式一樣
let compatNotified = 0;
export const compatPlugin = new Plugin({
  appendTransaction(trs, oldState, state) {
    if (!trs.some(tr => tr.docChanged)) return null;
    let tr = null; let dropped = false;
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
export function wordRangeAt(state) {
  if (!options.wordAtCursor) return null;
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  const off = $from.parentOffset;
  let result = null;
  $from.parent.forEach((child, offset) => {
    if (result || !child.isText || off <= offset || off >= offset + child.nodeSize) return;
    const local = off - offset;
    const text = child.text;
    if (segmenter) {
      for (const seg of segmenter.segment(text)) {
        if (seg.isWordLike && seg.index < local && local < seg.index + seg.segment.length) {
          result = { from: $from.start() + offset + seg.index, to: $from.start() + offset + seg.index + seg.segment.length };
          break;
        }
      }
    } else {
      const re = /[\p{L}\p{N}_]+/gu; let m;
      while ((m = re.exec(text))) if (m.index < local && local < m.index + m[0].length) { result = { from: $from.start() + offset + m.index, to: $from.start() + offset + m.index + m[0].length }; break; }
    }
  });
  return result;
}

function markCommand(type) {
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
export function isAllSelected(state) {
  const s = state.selection;
  if (s.empty) return false;
  const a = Selection.atStart(state.doc); const b = Selection.atEnd(state.doc);
  return s.from <= a.from && s.to >= b.to;
}
export function collapseSelection(state, dispatch) {
  if (state.selection.empty) return false;
  if (dispatch) dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.from))));
  return true;
}

// ---------------------------------------------------------------- 大小寫、全形／半形

const toHalf = s => s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ');
const toFull = s => s.replace(/[\u0021-\u007E]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, '\u3000');
export const CASE_KINDS = {
  upper: s => s.toUpperCase(),
  lower: s => s.toLowerCase(),
  title: s => s.toLowerCase().replace(/(^|[\s\-（(「『"'])([a-z])/g, (m, a, b) => a + b.toUpperCase()),
  sentence: s => s.toLowerCase().replace(/(^\s*|[.!?。！？]\s*)([a-z])/g, (m, a, b) => a + b.toUpperCase()),
  half: toHalf,
  full: toFull,
};
export function changeCase(kind) {
  const f = CASE_KINDS[kind];
  return (state, dispatch) => {
    const w = wordRangeAt(state);
    const ranges = w ? [w] : state.selection.ranges.map(r => ({ from: r.$from.pos, to: r.$to.pos })).filter(r => r.to > r.from);
    if (!ranges.length) return false;
    if (dispatch) {
      const tr = state.tr;
      const pieces = [];
      for (const r of ranges) {
        state.doc.nodesBetween(r.from, r.to, (node, pos) => {
          if (!node.isText) return true;
          const a = Math.max(r.from, pos); const b = Math.min(r.to, pos + node.nodeSize);
          if (b > a) pieces.push({ a, b, text: node.text.slice(a - pos, b - pos), marks: node.marks });
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

export function sortBlocks(dir) {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
    // 清單：排序整個清單（或游標所在的清單）
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type === N.bullet_list || n.type === N.ordered_list) {
        if (n.childCount < 2) return false;
        if (dispatch) {
          const items = []; n.forEach(c => items.push(c));
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
    const nodes = [];
    for (let i = start; i <= end; i++) { const c = state.doc.child(i); if (c.type !== N.paragraph) return false; nodes.push(c); }
    if (dispatch) {
      const sorted = nodes.slice().sort((a, b) => collator.compare(a.textContent, b.textContent) * dir);
      const from = $from.before(1); const to = $to.after(1);
      dispatch(state.tr.replaceWith(from, to, sorted));
    }
    return true;
  };
}

// ---------------------------------------------------------------- 程式碼

export const CODE_LANGUAGES = [
  ['', '純文字'], ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'],
  ['sql', 'SQL'], ['bash', 'Bash / Shell'], ['powershell', 'PowerShell'], ['yaml', 'YAML'], ['markdown', 'Markdown'],
  ['html', 'HTML'], ['css', 'CSS'], ['xml', 'XML'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
  ['go', 'Go'], ['rust', 'Rust'], ['r', 'R'], ['matlab', 'MATLAB'], ['dockerfile', 'Dockerfile'], ['ini', 'INI'],
  ['mermaid', 'Mermaid'], ['dataview', 'Dataview'],
];

// 插入程式碼區塊：有選取的段落就把它們變成程式碼區塊，否則插入空的區塊
// 選取範圍裡的段落是否只有純文字（轉成程式碼不會遺失連結、圖片、格式）
function plainSelection(state) {
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

export function insertCodeBlock(lang) {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    const { $from, $to, empty } = state.selection;
    if ($from.parent.type === N.code_block) {
      if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(), null, Object.assign({}, $from.parent.attrs, { params: lang })));
      return true;
    }
    if (!empty && $from.depth >= 1 && plainSelection(state)) {
      const text = state.doc.textBetween($from.before(1), $to.after(1), '\n');
      const node = N.code_block.create({ params: lang }, text ? schema.text(text) : null);
      if (dispatch) {
        const from = $from.before(1);
        const tr = state.tr.replaceWith(from, $to.after(1), node);
        tr.setSelection(TextSelection.create(tr.doc, from + 1 + node.content.size));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (!empty) {
      // 選取的內容有連結或格式：不轉換、也不取代，在選取範圍所在段落的後面插入新的程式碼區塊
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

// 螢光（醒目提示）色彩：color 為 null 是預設黃色（==文字==），'none' 是移除
export const HIGHLIGHT_COLORS = [
  [null, '黃色（預設）', 'var(--text-highlight-bg, rgba(255, 208, 0, .4))'],
  ['#4caf5066', '綠色'], ['#00bcd466', '青色'], ['#ff80ab66', '粉紅'], ['#448aff59', '藍色'],
  ['#ff525266', '紅色'], ['#ff980066', '橘色'], ['#b388ff66', '紫色'],
  ['#9e9e9e59', '灰色（字元網底）'],
];
export function setHighlight(color) {
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
export function currentHighlight(state) {
  const { $from, empty, from, to } = state.selection;
  if (empty) { const m = M.highlight.isInSet(state.storedMarks || $from.marks()); return m ? m.attrs.color || 'default' : null; }
  let c = null;
  state.doc.nodesBetween(from, to, n => { if (c == null && n.isText) { const m = M.highlight.isInSet(n.marks); if (m) c = m.attrs.color || 'default'; } });
  return c;
}

// ---------------------------------------------------------------- 對齊

// 只有最外層的段落與標題可以設定對齊／左縮排（存成 HTML 段落）；表格內改設整欄對齊
function topBlocks(state, types) {
  const out = [];
  eachRange(state, (from, to) => {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (state.doc.resolve(pos).depth === 0) {
        if (types.includes(node.type)) out.push({ node, pos });
        return false;
      }
      return false;
    });
  });
  return out;
}
export function setAlign(align) {
  return (state, dispatch) => {
    if (isInTable(state)) return table.alignColumn(align === 'justify' ? 'left' : align)(state, dispatch);
    // 標題不能對齊（存成 HTML 後就不是 Obsidian 的標題了）；含 [[連結]]、圖片、數學式的段落也不行
    const blocks = topBlocks(state, [N.paragraph]).filter(b => align === 'left' ? !!b.node.attrs.align : htmlSafeBlock(b.node));
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
export function blockFormatBlocked(state) {
  const $f = state.selection.$from;
  if (isInTable(state)) return null;
  if ($f.parent.type === N.heading) return '標題不能對齊或整段縮排（Markdown 的標題不支援，存成 HTML 會變成不是標題）';
  if ($f.parent.type === N.paragraph && $f.depth === 1 && !htmlSafeBlock($f.parent)) return '這段含有 [[內部連結]]、圖片、數學式或註解，對齊後在 Obsidian 會失效，所以不能對齊；縮排會改用首行縮排';
  if ($f.depth > 1 && !inListItem($f)) return '引文、提示框裡的段落只能用首行縮排（Markdown 不支援對齊）';
  return null;
}

export function currentAlign(state) {
  if (isInTable(state)) {
    const $f = state.selection.$from;
    for (let d = $f.depth; d > 0; d--) { const n = $f.node(d); if (n.type === N.table_cell || n.type === N.table_header) return n.attrs.align || 'left'; }
  }
  const $f = state.selection.$from;
  if ($f.depth === 1 && $f.parent.type === N.paragraph) return $f.parent.attrs.align || 'left';
  return null;
}

// 整段左縮排（像 Word 的「增加縮排」）
export function blockIndent(dir) {
  return (state, dispatch) => {
    let blocks = topBlocks(state, [N.paragraph]);
    if (dir < 0) blocks = blocks.filter(b => b.node.attrs.indent > 0);
    else blocks = blocks.filter(b => b.node.attrs.indent < 8 && htmlSafeBlock(b.node));
    if (!blocks.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const b of blocks) tr.setNodeMarkup(b.pos, null, Object.assign({}, b.node.attrs, { indent: b.node.attrs.indent + dir }));
      dispatch(tr);
    }
    return true;
  };
}

export function setColor(color) {
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

// 清除格式（像 Word 的「清除所有格式」）：移除文字格式，標題與程式碼區塊改回內文
export function clearFormatting(state, dispatch) {
  if (dispatch) {
    let tr = state.tr;
    const w = wordRangeAt(state);
    if (w) tr = tr.removeMark(w.from, w.to, null);
    else if (state.selection.empty) tr = tr.setStoredMarks([]);
    else eachRange(state, (from, to) => { tr = tr.removeMark(from, to, null); });
    eachRange(state, (from, to) => {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type === N.heading || node.type === N.code_block) {
          tr = tr.setNodeMarkup(pos, N.paragraph, { bid: node.attrs.bid != null ? node.attrs.bid : null });
          return false;
        }
        return !node.isTextblock;
      });
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
}

export function markActive(state, type) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function currentColor(state) {
  const { $from, empty, from, to } = state.selection;
  const marks = empty ? (state.storedMarks || $from.marks()) : null;
  if (marks) { const m = M.color.isInSet(marks); return m ? m.attrs.color : null; }
  let c = null;
  state.doc.nodesBetween(from, to, n => { if (c == null && n.isText) { const m = M.color.isInSet(n.marks); if (m) c = m.attrs.color; } });
  return c;
}

// 格式刷：記住游標處的格式，套用到之後選取的文字
export function captureMarks(state) {
  const { $from, empty, from } = state.selection;
  if (empty) return state.storedMarks || $from.marks();
  const n = state.doc.nodeAt(from);
  return n ? n.marks : $from.marks();
}
export function applyMarks(marks) {
  return (state, dispatch) => {
    if (state.selection.empty) return false;
    if (dispatch) {
      let tr = state.tr;
      eachRange(state, (from, to) => {
        tr = tr.removeMark(from, to, null);
        for (const m of marks) if (m.type !== M.link) tr = tr.addMark(from, to, m);
      });
      dispatch(tr);
    }
    return true;
  };
}

// ---------------------------------------------------------------- 段落樣式

export const BLOCK_STYLES = [
  { id: 'p', label: '內文' },
  { id: 'h1', label: '標題 1' }, { id: 'h2', label: '標題 2' }, { id: 'h3', label: '標題 3' },
  { id: 'h4', label: '標題 4' }, { id: 'h5', label: '標題 5' }, { id: 'h6', label: '標題 6' },
  { id: 'code', label: '程式碼' },
];

function styleType(id) {
  if (id === 'p') return [N.paragraph, {}];
  if (id === 'code') return [N.code_block, {}];
  return [N.heading, { level: +id.slice(1) }];
}

export function setBlockStyle(id) {
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
        tr = tr.setBlockType(from, to, type, node => Object.assign({}, attrs, { bid: node.attrs.bid != null ? node.attrs.bid : null }));
      });
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function currentBlockStyle(state) {
  const p = state.selection.$from.parent;
  if (p.type === N.heading) return 'h' + p.attrs.level;
  if (p.type === N.code_block) return 'code';
  return 'p';
}

function findAncestor($pos, pred) {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (pred(node)) return { node, depth: d, pos: $pos.before(d) };
  }
  return null;
}

export function toggleQuote(state, dispatch) {
  if (findAncestor(state.selection.$from, n => n.type === N.blockquote)) return lift(state, dispatch);
  return wrapIn(N.blockquote)(state, dispatch);
}

export function inQuote(state) {
  return !!findAncestor(state.selection.$from, n => n.type === N.blockquote);
}

// ---------------------------------------------------------------- 清單

const isList = n => n.type === N.bullet_list || n.type === N.ordered_list;
const isTaskList = n => n.childCount > 0 && n.firstChild.attrs.checked != null;

export function currentList(state) {
  const l = findAncestor(state.selection.$from, isList);
  if (!l) return null;
  if (l.node.type === N.ordered_list) return 'ordered';
  return isTaskList(l.node) ? 'task' : 'bullet';
}

export function toggleList(kind) {
  const target = kind === 'ordered' ? N.ordered_list : N.bullet_list;
  return (state, dispatch) => {
    const l = findAncestor(state.selection.$from, isList);
    if (l) {
      const cur = l.node.type === N.ordered_list ? 'ordered' : isTaskList(l.node) ? 'task' : 'bullet';
      if (cur === kind) return liftListItem(N.list_item)(state, dispatch);
      if (dispatch) {
        let tr = state.tr;
        if (l.node.type !== target) {
          const attrs = target === N.ordered_list
            ? { order: 1, tight: l.node.attrs.tight, bid: l.node.attrs.bid }
            : { tight: l.node.attrs.tight, bullet: '-', bid: l.node.attrs.bid };
          tr = tr.setNodeMarkup(l.pos, target, attrs);
        }
        l.node.forEach((child, offset) => {
          const checked = kind === 'task' ? (child.attrs.checked != null ? child.attrs.checked : false) : null;
          tr = tr.setNodeMarkup(l.pos + 1 + offset, null, Object.assign({}, child.attrs, { checked }));
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
function inListItem($pos) {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === N.list_item) return true;
  return false;
}
function paragraphsInSelection(state) {
  const out = [];
  eachRange(state, (from, to) => {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === N.paragraph) {
        if (!inListItem(state.doc.resolve(pos + 1))) out.push({ node, pos });
        return false;
      }
      return true;
    });
  });
  return out;
}
export function paragraphIndent(dir, topLevelToo) {
  return (state, dispatch) => {
    let paras = paragraphsInSelection(state);
    if (dir > 0 && !topLevelToo) paras = paras.filter(p => state.doc.resolve(p.pos).depth > 0);
    if (dir < 0) paras = paras.filter(p => p.node.firstChild && p.node.firstChild.isText && LEAD.test(p.node.firstChild.text));
    if (!paras.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const p of paras.slice().reverse()) {
        const start = p.pos + 1;
        if (dir > 0) tr.insertText(INDENT, start);
        else tr.delete(start, start + p.node.firstChild.text.match(LEAD)[0].length);
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

export function toggleTaskAt(pos) {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type !== N.list_item) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { checked: !node.attrs.checked })));
    return true;
  };
}

// ---------------------------------------------------------------- 插入

export function insertInline(node) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.type.contentMatch.matchType(node.type) && !$from.parent.inlineContent) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
    return true;
  };
}

export function insertText(text, marks) {
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

export function setLink(href, text) {
  return (state, dispatch) => {
    if (dispatch) {
      const { from, to, empty } = state.selection;
      let tr = state.tr;
      if (empty || text != null) {
        const t = text || href;
        tr = tr.insertText(t, from, to);
        if (href) tr = tr.addMark(from, from + t.length, M.link.create({ href }));
      } else {
        tr = tr.removeMark(from, to, M.link);
        if (href) tr = tr.addMark(from, to, M.link.create({ href }));
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 取得游標所在連結的範圍
export function linkRange(state) {
  const { $from } = state.selection;
  const mark = M.link.isInSet($from.marks()) || ($from.nodeAfter && M.link.isInSet($from.nodeAfter.marks));
  if (!mark) return null;
  const start = $from.start();
  const runs = [];
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

export function insertBlock(node) {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(node);
      let found = null;
      tr.doc.descendants((n, pos) => { if (found == null && n === node) found = pos; return found == null; });
      if (found != null) {
        const inside = found + 1;
        try {
          const at = node.type === N.table ? found + 4 : node.isTextblock ? inside
            : node.firstChild && node.firstChild.isTextblock ? found + 2 : found + node.nodeSize;
          const sel = TextSelection.near(tr.doc.resolve(at));
          tr.setSelection(sel);
        } catch (e) { /* 保持預設 */ }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function insertHr(state, dispatch) {
  return insertBlock(N.horizontal_rule.create())(state, dispatch);
}

export function createTable(rows, cols) {
  const header = N.table_row.create(null, Array.from({ length: cols }, () => N.table_header.createAndFill()));
  const body = Array.from({ length: Math.max(0, rows - 1) }, () =>
    N.table_row.create(null, Array.from({ length: cols }, () => N.table_cell.createAndFill())));
  return N.table.create(null, [header, ...body]);
}

export function insertTable(rows, cols) {
  return (state, dispatch) => insertBlock(createTable(rows, cols))(state, dispatch);
}

// ---------------------------------------------------------------- 表格

export const table = {
  isIn: isInTable,
  addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn, deleteTable,
  align: a => setCellAttr('align', a),
  // Markdown 的對齊是整欄的：一次設定整欄
  alignColumn(a) {
    return (state, dispatch) => {
      if (!isInTable(state)) return false;
      const $cell = state.selection instanceof CellSelection ? state.selection.$anchorCell : null;
      const $from = state.selection.$from;
      const t = findAncestor($from, n => n.type === N.table);
      if (!t) return false;
      const cellDepth = (() => { for (let d = $from.depth; d > 0; d--) { const tn = $from.node(d).type; if (tn === N.table_cell || tn === N.table_header) return d; } return null; })();
      let col;
      if ($cell) col = $cell.index();
      else if (cellDepth != null) col = $from.index(cellDepth - 1);
      else return false;
      if (dispatch) {
        let tr = state.tr;
        t.node.forEach((row, rowOff) => {
          let off = 0; let i = 0;
          row.forEach((cell, cellOff) => {
            if (i === col) tr = tr.setNodeMarkup(t.pos + 1 + rowOff + 1 + cellOff, null, Object.assign({}, cell.attrs, { align: a }));
            i++; off += cell.nodeSize;
          });
        });
        dispatch(tr);
      }
      return true;
    };
  },
};

export function inTableCell(state) {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === N.table_cell || t === N.table_header) return true;
  }
  return false;
}


// ---------------------------------------------------------------- 移動段落（Alt+↑／Alt+↓）

// 移動游標所在的清單項目、表格列或段落（與上一個／下一個交換位置）
export function moveBlock(dir) {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let d = null;
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
    const start = $from.before(d);
    const end = $from.after(d);
    if ($to.pos > end) return false;
    if (dispatch) {
      const sib = parent.child(target);
      const a = state.selection.from - start;
      const b = state.selection.to - start;
      const tr = state.tr;
      let newStart;
      if (dir < 0) {
        newStart = start - sib.nodeSize;
        tr.delete(start, end).insert(newStart, node);
      } else {
        newStart = start + sib.nodeSize;
        tr.insert(end + sib.nodeSize, node).delete(start, end);
      }
      try { tr.setSelection(TextSelection.create(tr.doc, newStart + a, newStart + b)); } catch (e) { /* 保持預設 */ }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ---------------------------------------------------------------- 表格排序

function cellText(cell) { return cell.textContent.trim(); }
function asNumber(t) {
  const s = t.replace(/[,\s，]/g, '').replace(/[%％]$/, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? parseFloat(s) : null;
}

// 依游標所在的欄排序（標題列不動）；數字依大小、文字依中文筆畫／字母順序
export function sortTableByColumn(dir) {
  return (state, dispatch) => {
    const $from = state.selection.$from;
    let tDepth = null;
    for (let i = $from.depth; i > 0; i--) if ($from.node(i).type === N.table) { tDepth = i; break; }
    if (tDepth == null || $from.depth < tDepth + 2) return false;
    const table = $from.node(tDepth);
    if (table.childCount < 3) return false;
    const col = $from.index(tDepth + 1);
    if (dispatch) {
      const rows = [];
      table.forEach(r => rows.push(r));
      const head = rows[0];
      const body = rows.slice(1);
      const key = r => (r.childCount > col ? cellText(r.child(col)) : '');
      const allNum = body.every(r => { const t = key(r); return t === '' || asNumber(t) != null; });
      const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
      const sorted = body.map((r, i) => ({ r, i })).sort((x, y) => {
        const a = key(x.r); const b = key(y.r);
        if (a === '' && b !== '') return 1;
        if (b === '' && a !== '') return -1;
        const c = allNum ? asNumber(a) - asNumber(b) : collator.compare(a, b);
        return (c || x.i - y.i) * (c ? dir : 1);
      }).map(x => x.r);
      const pos = $from.before(tDepth);
      const node = table.type.create(table.attrs, [head, ...sorted]);
      const tr = state.tr.replaceWith(pos, pos + table.nodeSize, node);
      try { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(state.selection.from, tr.doc.content.size)))); } catch (e) { /* 保持預設 */ }
      dispatch(tr);
    }
    return true;
  };
}

// ---------------------------------------------------------------- 提示框（callout）

export const CALLOUT_TYPES = [
  ['note', '備註', 'pencil'], ['info', '資訊', 'info'], ['tip', '提示', 'flame'], ['important', '重要', 'flame'],
  ['success', '完成', 'check'], ['question', '問題', 'help-circle'], ['warning', '注意', 'alert-triangle'],
  ['danger', '危險', 'zap'], ['failure', '失敗', 'x'], ['example', '範例', 'list'], ['quote', '引用', 'quote'],
  ['abstract', '摘要', 'clipboard-list'], ['todo', '待辦', 'check-circle-2'], ['bug', '問題回報', 'bug'],
];

export function calloutIcon(type) {
  const t = (type || '').toLowerCase();
  const alias = { summary: 'abstract', tldr: 'abstract', hint: 'tip', check: 'success', done: 'success', help: 'question', faq: 'question',
    caution: 'warning', attention: 'warning', fail: 'failure', missing: 'failure', error: 'danger', cite: 'quote' };
  const k = alias[t] || t;
  const hit = CALLOUT_TYPES.find(x => x[0] === k);
  return hit ? hit[2] : 'pencil';
}

export function calloutLabel(type) {
  const hit = CALLOUT_TYPES.find(x => x[0] === (type || '').toLowerCase());
  return hit ? hit[1] : type;
}

// 把選取的段落放進提示框；沒有可包的段落時插入空的提示框
export function insertCallout(type) {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    const wrap = wrapIn(N.callout, { type, title: null, fold: '' });
    if (wrap(state)) return wrap(state, dispatch);
    return insertBlock(N.callout.create({ type, title: null, fold: '' }, N.paragraph.create()))(state, dispatch);
  };
}

export function inCallout(state) {
  return !!findAncestor(state.selection.$from, n => n.type === N.callout);
}

// ---------------------------------------------------------------- 鍵盤

const insertHardBreak = (state, dispatch) => {
  const br = N.hard_break;
  if (!state.selection.$from.parent.type.contentMatch.matchType(br) && !state.selection.$from.parent.inlineContent) return false;
  if (state.selection.$from.parent.type.spec.code) return false;
  if (state.selection.$from.parent.type === N.heading) return false; // Markdown 的標題只能一行
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
  return true;
};

const tabInText = (state, dispatch) => {
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
const backspaceLift = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset > 0) return false;
  const li = findAncestor($from, n => n.type === N.list_item);
  if (!li) return false;
  if ($from.index(li.depth) !== 0) return false;
  return liftListItem(N.list_item)(state, dispatch);
};

// 標題行尾按 Enter：下一段回到內文
const enterAfterHeading = (state, dispatch) => {
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
const tabInTable = (state, dispatch, view) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  if (dispatch && view) {
    addRowAfter(state, dispatch);
    goToNextCell(1)(view.state, view.dispatch);
  }
  return true;
};

export function buildKeymap() {
  const keys = {
    'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
    'Mod-b': toggleBold, 'Mod-i': toggleItalic, 'Mod-u': toggleUnderline,
    'Mod-Shift-x': toggleStrike, 'Mod-Shift-h': toggleHighlight, 'Mod-`': toggleCode,
    'Mod-l': setAlign('left'), 'Mod-j': setAlign('justify'),
    'Mod-Alt-0': setBlockStyle('p'),
    'Shift-Enter': chainCommands(insertHardBreak, (s, d) => (s.selection.$from.parent.type === N.heading ? enterAfterHeading(s, d) || baseKeymap.Enter(s, d) : false)),
    'Mod-Enter': chainCommands(exitCode, insertHardBreak),
    Enter: chainCommands(
      (s, d) => (inTableCell(s) ? insertHardBreak(s, d) : false),
      splitListItem(N.list_item),
      enterAfterHeading,
    ),
    Tab: chainCommands(tabInTable, sinkListItem(N.list_item), (s) => !!currentList(s), tabInText),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(N.list_item), paragraphIndent(-1), () => true),
    Backspace: backspaceLift,
    'Alt-ArrowUp': moveBlock(-1),
    'Alt-ArrowDown': moveBlock(1),
  };
  for (let i = 1; i <= 6; i++) keys['Mod-Alt-' + i] = setBlockStyle('h' + i);
  return keys;
}

export { baseKeymap, undo, redo, NodeSelection };
