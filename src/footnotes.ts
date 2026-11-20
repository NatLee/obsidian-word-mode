// 註腳：文字裡的 [^1]（參照）與文件後面的「[^1]: 內容」（定義）。純 ProseMirror，可測試。
import { TextSelection } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema.js';

export interface FootnoteRef { id: string; pos: number; }
export interface FootnoteDef { id: string; pos: number; node: PMNode; }
export interface Footnotes { refs: FootnoteRef[]; defs: FootnoteDef[]; }

// raw_inline 與 raw_block 節點的屬性（見 schema.ts）；這裡只讀 src（原文）
interface RawSrcAttrs { readonly src: string; }

const N = schema.nodes;
export const FOOTNOTE_REF = /^\[\^([^\]\s]+)\]$/;
export const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]?/;

// 文件裡所有的註腳參照與定義
export function footnotes(doc: PMNode): Footnotes {
  const refs: FootnoteRef[] = []; const defs: FootnoteDef[] = [];
  doc.descendants((node, pos) => {
    if (node.type === N.raw_inline) { const m = FOOTNOTE_REF.exec((node.attrs as RawSrcAttrs).src); if (m) refs.push({ id: m[1], pos }); return false; }
    if (node.type === N.raw_block) { const m = FOOTNOTE_DEF.exec((node.attrs as RawSrcAttrs).src); if (m) defs.push({ id: m[1], pos, node }); return false; }
    return true;
  });
  return { refs, defs };
}

// 註腳定義的內容（去掉開頭的 [^1]: 與延續行的縮排）
export function footnoteBody(src: string): string {
  return String(src).replace(FOOTNOTE_DEF, '').split('\n').map((l, i) => (i ? l.replace(/^( {1,4}|\t)/, '') : l)).join('\n');
}
export function footnoteText(doc: PMNode, id: string): string | null {
  const d = footnotes(doc).defs.find(x => x.id === id);
  return d ? footnoteBody((d.node.attrs as RawSrcAttrs).src) : null;
}

// 下一個編號：目前最大的數字編號 + 1
function nextFootnoteId(doc: PMNode): string {
  const { refs, defs } = footnotes(doc);
  let max = 0;
  for (const x of refs.concat(defs)) if (/^\d+$/.test(x.id)) max = Math.max(max, +x.id);
  return String(max + 1);
}

// 在游標處插入註腳參照，並在文件後面（既有註腳的後面）加上定義
export function insertFootnote(text?: string | null): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.inlineContent || $from.parent.type.spec.code) return false;
    if (dispatch) {
      const id = nextFootnoteId(state.doc);
      const body = String(text || '').replace(/\r?\n/g, '\n    ').trim();
      const def = N.raw_block.create({ src: '[^' + id + ']: ' + body, kind: 'footnote' });
      const { defs } = footnotes(state.doc);
      // 定義放在最後一個既有定義的後面；還沒有任何註腳就放在文件最後
      const last = defs.filter(d => state.doc.resolve(d.pos).depth === 0).pop();
      const at = last ? last.pos + last.node.nodeSize : state.doc.content.size;
      const tr = state.tr.insert(at, def);
      // 既有的註腳定義可能在游標前面（定義不一定寫在文件最後），插入定義後游標的位置會往後移
      const pos = tr.mapping.map(state.selection.to);
      tr.insert(pos, N.raw_inline.create({ src: '[^' + id + ']' }));
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// 修改註腳定義的內容
export function setFootnoteBody(pos: number, text?: string | null): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const m = node && node.type === N.raw_block && FOOTNOTE_DEF.exec((node.attrs as RawSrcAttrs).src);
    if (!m) return false;
    if (dispatch) {
      const body = String(text || '').replace(/\r?\n/g, '\n    ').trim();
      dispatch(state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { src: '[^' + m[1] + ']: ' + body })));
    }
    return true;
  };
}

// 刪除註腳：參照與定義一起刪
export function removeFootnote(id: string): Command {
  return (state, dispatch) => {
    const { refs, defs } = footnotes(state.doc);
    const hits = refs.filter(r => r.id === id).map(r => [r.pos, r.pos + 1]).concat(defs.filter(d => d.id === id).map(d => [d.pos, d.pos + d.node.nodeSize]));
    if (!hits.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const [a, b] of hits.sort((x, y) => y[0] - x[0])) tr.delete(a, b);
      dispatch(tr);
    }
    return true;
  };
}
