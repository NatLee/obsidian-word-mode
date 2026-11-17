// 標題摺疊：點標題左邊的箭頭，收起到下一個同級（或更高層級）標題之前的內容
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { t } from './i18n.js';

export const foldKey = new PluginKey('wmFold');

export function foldPlugin(ctx) {
  return new Plugin({
    key: foldKey,
    state: {
      init: () => [],
      apply(tr, folded, oldState, newState) {
        let list = folded;
        if (tr.docChanged) {
          list = folded.map(p => tr.mapping.mapResult(p)).filter(r => !r.deleted).map(r => r.pos);
        }
        const meta = tr.getMeta(foldKey);
        if (meta && meta.toggle != null) {
          list = list.includes(meta.toggle) ? list.filter(p => p !== meta.toggle) : list.concat(meta.toggle);
        }
        if (meta && meta.clear) list = [];
        // 全部摺疊：收起每個頂層標題
        if (meta && meta.all) { list = []; newState.doc.forEach((n, pos) => { if (n.type.name === 'heading') list.push(pos); }); }
        // 只保留仍是頂層標題的位置
        return list.filter((p, i, a) => a.indexOf(p) === i && (() => {
          const n = newState.doc.nodeAt(p);
          return n && n.type.name === 'heading' && newState.doc.resolve(p).depth === 0;
        })());
      },
    },
    props: {
      decorations(state) {
        const folded = foldKey.getState(state);
        const decos = [];
        const doc = state.doc;
        let hideUntilLevel = null;
        doc.forEach((node, pos) => {
          const isHeading = node.type.name === 'heading';
          if (hideUntilLevel != null) {
            if (isHeading && node.attrs.level <= hideUntilLevel) hideUntilLevel = null;
            else { decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wm-fold-hidden' })); return; }
          }
          if (!isHeading) return;
          const isFolded = folded.includes(pos);
          decos.push(Decoration.widget(pos + 1, view => {
            const b = document.createElement('span');
            b.className = 'wm-fold-toggle' + (isFolded ? ' is-folded' : '');
            b.contentEditable = 'false';
            b.setAttribute('aria-label', t(isFolded ? t('展開') : t('摺疊')));
            ctx.icon(b, isFolded ? 'chevron-right' : 'chevron-down', isFolded ? '▸' : '▾');
            const toggle = e => { e.preventDefault(); e.stopPropagation(); view.dispatch(view.state.tr.setMeta(foldKey, { toggle: pos })); };
            b.addEventListener('mousedown', toggle);
            return b;
          }, { side: -1, key: 'fold-' + pos + '-' + isFolded, ignoreSelection: true }));
          if (isFolded) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wm-heading-folded' }));
            hideUntilLevel = node.attrs.level;
          }
        });
        return DecorationSet.create(doc, decos);
      },
    },
  });
}
