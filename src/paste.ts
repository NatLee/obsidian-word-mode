// 貼上：Excel／試算表 → 表格、Markdown 文字 → 可選擇轉成格式
import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Attrs, Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { schema } from './schema.js';

const N = schema.nodes;

// 貼上的內容不能帶原文區塊編號（bid），否則存檔時會被當成原本的段落
export function stripBids(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach(node => {
    if (node.isText) { nodes.push(node); return; }
    const attrs = 'bid' in node.attrs ? Object.assign({}, node.attrs, { bid: null }) : node.attrs;
    nodes.push(node.type.create(attrs, stripBids(node.content), node.marks));
  });
  return Fragment.from(nodes);
}

export function stripSliceBids(slice: Slice): Slice {
  return new Slice(stripBids(slice.content), slice.openStart, slice.openEnd);
}

// 解析 Tab 分隔文字（Excel 會把含換行的儲存格用雙引號包起來）
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

// 判斷剪貼簿是不是表格（Excel、Google 試算表、Word 表格，或整齊的 Tab 分隔文字）
export function clipboardTable(text: string | null | undefined, html?: string | null): string[][] | null {
  if (!text || !text.includes('\t')) return null;
  const fromSheet = html && (/urn:schemas-microsoft-com:office:excel|google-sheets-html-origin/i.test(html) || /<table[\s>]/i.test(html));
  const rows = parseTSV(text);
  const cols = Math.max(...rows.map(r => r.length));
  if (cols < 2) return null;
  if (!fromSheet) {
    if (rows.length < 2 || !rows.every(r => r.length === cols)) return null;
  }
  return rows.map(r => { const c = r.slice(); while (c.length < cols) c.push(''); return c.map(v => v.trim()); });
}

function cellContent(text: string): PMNode {
  const parts = String(text).split('\n');
  const inline: PMNode[] = [];
  parts.forEach((p, i) => {
    if (i) inline.push(N.hard_break.create());
    if (p) inline.push(schema.text(p));
  });
  return N.paragraph.create(null, inline);
}

function makeCell(isHeader: boolean, text: string, attrs?: Attrs | null): PMNode {
  return (isHeader ? N.table_header : N.table_cell).create(attrs || null, cellContent(text || ''));
}

// 第一列當標題列（Markdown 表格一定有標題列）
export function tableFromRows(rows: string[][]): PMNode {
  return N.table.create(null, rows.map((r, i) => N.table_row.create(null, r.map(v => makeCell(i === 0, v)))));
}

// 游標在表格裡時：從目前儲存格開始填入，不夠的列與欄自動補上（像在 Word 表格裡貼上 Excel）
export function fillTable(state: EditorState, rows: string[][]): Transaction | null {
  const $from = state.selection.$from;
  let tDepth: number | null = null;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.table) { tDepth = d; break; }
  if (tDepth == null) return null;
  const table = $from.node(tDepth);
  const tablePos = $from.before(tDepth);
  const r0 = $from.index(tDepth);
  const c0 = $from.index(tDepth + 1);
  const grid: PMNode[][] = [];
  table.forEach(row => { const cells: PMNode[] = []; row.forEach(c => cells.push(c)); grid.push(cells); });
  const width = Math.max(grid[0].length, c0 + Math.max(...rows.map(r => r.length)));
  const height = Math.max(grid.length, r0 + rows.length);
  for (let r = 0; r < height; r++) {
    if (!grid[r]) grid[r] = [];
    for (let c = 0; c < width; c++) {
      const v = rows[r - r0] && rows[r - r0][c - c0];
      const old = grid[r][c];
      if (v != null && r >= r0 && c >= c0) grid[r][c] = makeCell(r === 0, v, old ? old.attrs : (grid[0][c] ? { align: grid[0][c].attrs.align } : null));
      else if (!old) grid[r][c] = makeCell(r === 0, '', grid[0][c] ? { align: grid[0][c].attrs.align } : null);
    }
  }
  const node = N.table.create(table.attrs, grid.map(cells => N.table_row.create(null, cells)));
  const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, node);
  // 游標移到最後填入的儲存格
  let pos = tablePos + 1;
  const lastR = r0 + rows.length - 1;
  const lastC = c0 + rows[rows.length - 1].length - 1;
  for (let r = 0; r < lastR; r++) pos += node.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < lastC; c++) pos += node.child(lastR).child(c).nodeSize;
  const cell = node.child(lastR).child(lastC);
  try { tr.setSelection(TextSelection.create(tr.doc, pos + 2 + cell.firstChild!.content.size)); } catch { /* 保持預設 */ }
  return tr.scrollIntoView();
}

// 看起來像 Markdown 的純文字（例如從 ChatGPT 複製的內容）
export function looksLikeMarkdown(text: string | null | undefined): boolean {
  if (!text || text.length < 3) return false;
  const block = /^(#{1,6}\s+\S|[-*+]\s+\S|\d+[.)]\s+\S|>\s?\S|```|\|.+\|\s*$|-\s\[[ x]\]\s)/m;
  const inline = /\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`|==[^=\n]+==|\[\[[^\]\n]+\]\]/;
  return block.test(text) || inline.test(text);
}
