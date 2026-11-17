// 連結與圖片的偵測（純 ProseMirror，可測試）
import { Plugin, NodeSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema.js';
import { linkRange } from './commands.js';

export const URL_RE = /https?:\/\/[^\s<>()\[\]]+[^\s<>()\[\].,;:!?'"，。、；：！？」』）]/g;
export const isUrl = s => /^https?:\/\/\S+$/i.test(s.trim());
export const isExternal = href => /^[a-z][a-z0-9+.-]*:/i.test(href);

// 找出段落裡沒有加連結格式的網址（Obsidian 也會把這些網址顯示成連結）
function bareUrls(doc) {
  const found = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    node.forEach((child, offset) => {
      if (!child.isText || schema.marks.link.isInSet(child.marks) || schema.marks.code.isInSet(child.marks)) return;
      URL_RE.lastIndex = 0;
      let m;
      while ((m = URL_RE.exec(child.text))) {
        const from = pos + 1 + offset + m.index;
        found.push({ from, to: from + m[0].length, href: m[0] });
      }
    });
    return false;
  });
  return found;
}

export const bareUrlKey = 'wmBareUrls';
export const bareUrlPlugin = new Plugin({
  state: {
    init: (_, state) => bareUrls(state.doc),
    apply: (tr, old) => (tr.docChanged ? bareUrls(tr.doc) : old),
  },
  props: {
    decorations(state) {
      const list = this.getState(state);
      if (!list.length) return null;
      return DecorationSet.create(state.doc, list.map(u => Decoration.inline(u.from, u.to, { class: 'wm-bare-url', 'data-href': u.href })));
    },
  },
});

export function bareUrlAt(state) {
  const { from, empty } = state.selection;
  if (!empty) return null;
  const list = bareUrlPlugin.getState(state) || [];
  return list.find(u => u.from <= from && u.to >= from) || null;
}

// 目前選取位置屬於哪種連結／圖片
export function linkContext(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection) {
    const n = sel.node;
    if (n.type === schema.nodes.image) return { kind: 'image', pos: sel.from, node: n };
    if (n.type === schema.nodes.wikilink) return { kind: 'wikilink', pos: sel.from, node: n };
    return null;
  }
  const r = linkRange(state);
  if (r && sel.from >= r.from && sel.to <= r.to) return { kind: 'link', from: r.from, to: r.to, href: r.mark.attrs.href, text: r.text };
  const u = bareUrlAt(state);
  if (u) return { kind: 'url', from: u.from, to: u.to, href: u.href, text: u.href };
  return null;
}
