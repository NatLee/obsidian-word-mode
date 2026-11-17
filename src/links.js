// 連結與圖片的偵測（純 ProseMirror，可測試）
import { Plugin, PluginKey, NodeSelection } from 'prosemirror-state';
import { Decoration } from 'prosemirror-view';
import { buildBlockDecorations, updateBlockDecorations } from './decoutil.js';
import { schema } from './schema.js';
import { linkRange } from './commands.js';

export const URL_RE = /https?:\/\/[^\s<>()\[\]]+[^\s<>()\[\].,;:!?'"，。、；：！？」』）]/g;
export const isUrl = s => /^https?:\/\/\S+$/i.test(s.trim());
export const isExternal = href => /^[a-z][a-z0-9+.-]*:/i.test(href);

// Obsidian 的 #標籤：前面是行首或空白，可以有 / 分層，不能全是數字
export const TAG_RE = /(^|\s)#([^\s#!@$%^&*(),.?":;{}|<>\[\]\\`'~=+]+)/g;
// 區塊參照 ^id：寫在段落結尾
const BLOCK_ID_RE = /(^|\s)\^([A-Za-z0-9-]+)$/;

// 一個文字區塊裡的行內標示：沒有加連結格式的網址（Obsidian 也會顯示成連結）、#標籤、^區塊參照
function inlineDecos(node, pos) {
  if (node.type.spec.code) return [];
  const out = [];
  let prevChar = '';
  node.forEach((child, offset) => {
    if (!child.isText) { prevChar = 'x'; return; }
    const text = child.text;
    if (schema.marks.link.isInSet(child.marks) || schema.marks.code.isInSet(child.marks)) { prevChar = text.slice(-1); return; }
    const base = pos + 1 + offset;
    const urls = [];
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(text))) {
      urls.push([m.index, m.index + m[0].length]);
      out.push(Decoration.inline(base + m.index, base + m.index + m[0].length, { class: 'wm-bare-url', 'data-href': m[0] }, { href: m[0] }));
    }
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) {
      const start = m.index + m[1].length;
      if (/^\d+$/.test(m[2])) continue;
      if (start === 0 && prevChar && !/\s/.test(prevChar)) continue; // 前一段文字緊接著 #：不是標籤
      if (urls.some(([a, b]) => start >= a && start < b)) continue;  // 網址裡的 #
      out.push(Decoration.inline(base + start, base + start + 1 + m[2].length, { class: 'wm-tag', 'data-tag': '#' + m[2] }, { tag: '#' + m[2] }));
    }
    prevChar = text.slice(-1);
  });
  const last = node.lastChild;
  if (last && last.isText && !schema.marks.code.isInSet(last.marks)) {
    const bm = BLOCK_ID_RE.exec(last.text);
    if (bm) { const end = pos + node.nodeSize - 1; out.push(Decoration.inline(end - bm[2].length - 1, end, { class: 'wm-block-id' }, { blockId: bm[2] })); }
  }
  return out;
}

// 文件改動時只重算有變的段落（見 decoutil.js）
export const inlineKey = new PluginKey('wmInline');
export const bareUrlPlugin = new Plugin({
  key: inlineKey,
  state: {
    init: (_, state) => buildBlockDecorations(state.doc, inlineDecos),
    apply: (tr, set) => updateBlockDecorations(tr, set, inlineDecos),
  },
  props: { decorations(state) { return inlineKey.getState(state); } },
});

function inlineAt(state, field) {
  const { from, empty } = state.selection;
  if (!empty) return null;
  const set = inlineKey.getState(state);
  const d = set ? set.find(from, from, spec => spec[field] != null)[0] : null;
  return d ? { from: d.from, to: d.to, [field]: d.spec[field] } : null;
}
export function bareUrlAt(state) { return inlineAt(state, 'href'); }
export function tagAt(state) { return inlineAt(state, 'tag'); }

// 文件裡用到的所有 #標籤（不重複）
export function tagsInDoc(state) {
  const set = inlineKey.getState(state);
  return set ? [...new Set(set.find(undefined, undefined, spec => spec.tag != null).map(d => d.spec.tag))] : [];
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
