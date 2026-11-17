// 以「文字區塊」為單位維護裝飾（decorations）：文件改動時只重算有變的區塊，其餘沿用。
// 每次打字都重建整份文件的裝飾，在長文件會讓輸入變慢。
import { DecorationSet } from 'prosemirror-view';

// build(node, pos) → Decoration[]；isTarget(node) 判斷要不要處理這個節點（預設是所有文字區塊）
export function buildBlockDecorations(doc, build, isTarget = n => n.isTextblock) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (!isTarget(node)) return !node.isTextblock;
    for (const d of build(node, pos)) decos.push(d);
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function updateBlockDecorations(tr, set, build, isTarget = n => n.isTextblock) {
  if (!tr.docChanged) return set;
  const doc = tr.doc;
  set = set.map(tr.mapping, doc);
  const done = new Set();
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((oS, oE, nS, nE) => {
      const from = Math.max(0, Math.min(rest.map(nS, -1), doc.content.size));
      const to = Math.max(from, Math.min(rest.map(nE, 1), doc.content.size));
      doc.nodesBetween(from, to, (node, pos) => {
        if (!isTarget(node)) return !node.isTextblock;
        if (done.has(pos)) return false;
        done.add(pos);
        const old = set.find(pos, pos + node.nodeSize);
        if (old.length) set = set.remove(old);
        const next = build(node, pos);
        if (next.length) set = set.add(doc, next);
        return false;
      });
    });
  });
  return set;
}
