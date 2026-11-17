// 標題摺疊：點標題左邊的箭頭，收起到下一個同級（或更高層級）標題之前的內容
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { t } from './i18n.js';

// 外掛狀態：folded 是摺起來的頂層標題位置，set 是對應的裝飾
export interface FoldState { folded: number[]; set: DecorationSet; }
// 交易的 meta：toggle 切換某個標題、clear 全部展開、all 全部摺疊
export interface FoldMeta { toggle?: number; clear?: boolean; all?: boolean; }
// icon(el, name, fallback)：放圖示，沒有圖示時改用 fallback 文字
export interface FoldContext { icon(el: HTMLElement, name: string, fallback: string): void; }
// heading 節點的屬性（見 schema.ts）；這裡只讀 level（1～6）
interface HeadingAttrs { readonly level: number; }

export const foldKey = new PluginKey<FoldState>('wmFold');

function buildDecos(doc: PMNode, folded: number[], ctx: FoldContext): DecorationSet {
  const decos: Decoration[] = [];
  let hideUntilLevel: number | null = null;
  doc.forEach((node, pos) => {
    const isHeading = node.type.name === 'heading';
    if (hideUntilLevel != null) {
      if (isHeading && node.attrs.level <= hideUntilLevel) hideUntilLevel = null;
      else { decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wm-fold-hidden' })); return; }
    }
    if (!isHeading) return;
    const isFolded = folded.includes(pos);
    decos.push(Decoration.widget(pos + 1, view => {
      const b = createSpan();
      b.className = 'wm-fold-toggle' + (isFolded ? ' is-folded' : '');
      b.contentEditable = 'false';
      b.setAttribute('aria-label', isFolded ? t('展開') : t('摺疊'));
      ctx.icon(b, isFolded ? 'chevron-right' : 'chevron-down', isFolded ? '▸' : '▾');
      // 位置在按下時才從畫面算（裝飾會跟著文件位移，建立時的位置之後可能已經不對）
      const toggle = (e: MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        let at;
        try { at = view.state.doc.resolve(view.posAtDOM(b, 0)).before(1); } catch { return; }
        view.dispatch(view.state.tr.setMeta(foldKey, { toggle: at }));
      };
      b.addEventListener('mousedown', toggle);
      return b;
    }, { side: -1, key: 'fold-' + isFolded, ignoreSelection: true }));
    if (isFolded) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wm-heading-folded' }));
      hideUntilLevel = (node.attrs as HeadingAttrs).level;
    }
  });
  return DecorationSet.create(doc, decos);
}

// 最上層的區塊結構有沒有變（新增／刪除區塊、標題變成段落、標題層級改變）。
// 只是在某個區塊裡打字時結構不變，裝飾跟著位移就好，不用重建
function structureChanged(a: PMNode, b: PMNode): boolean {
  if (a.childCount !== b.childCount) return true;
  for (let i = 0; i < a.childCount; i++) {
    const x = a.child(i); const y = b.child(i);
    if (x === y) continue;
    if (x.type !== y.type || x.attrs.level !== y.attrs.level) return true;
  }
  return false;
}

export function foldPlugin(ctx: FoldContext): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: foldKey,
    state: {
      init: (_, state) => ({ folded: [], set: buildDecos(state.doc, [], ctx) }),
      apply(tr, old, oldState, newState) {
        const meta = tr.getMeta(foldKey) as FoldMeta | undefined;
        if (!tr.docChanged && !meta) return old;
        let list = old.folded;
        if (tr.docChanged) list = list.map(p => tr.mapping.mapResult(p)).filter(r => !r.deleted).map(r => r.pos);
        if (meta && meta.toggle != null) list = list.includes(meta.toggle) ? list.filter(p => p !== meta.toggle) : list.concat(meta.toggle);
        if (meta && meta.clear) list = [];
        // 全部摺疊：收起每個頂層標題
        if (meta && meta.all) { list = []; newState.doc.forEach((n, pos) => { if (n.type.name === 'heading') list.push(pos); }); }
        // 只保留仍是頂層標題的位置
        list = list.filter((p, i, a) => {
          if (a.indexOf(p) !== i) return false;
          const n = newState.doc.nodeAt(p);
          return !!n && n.type.name === 'heading' && newState.doc.resolve(p).depth === 0;
        });
        if (!meta && !structureChanged(oldState.doc, newState.doc)) return { folded: list, set: old.set.map(tr.mapping, tr.doc) };
        return { folded: list, set: buildDecos(newState.doc, list, ctx) };
      },
    },
    props: { decorations(state) { return foldKey.getState(state)!.set; } },
  });
}
