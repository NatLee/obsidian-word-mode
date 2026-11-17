// 以「文字區塊」為單位維護裝飾（decorations）：文件改動時只重算有變的區塊，其餘沿用。
// 每次打字都重建整份文件的裝飾，在長文件會讓輸入變慢。
import { DecorationSet } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';

export type BuildDecorations = (node: PMNode, pos: number) => Decoration[];
export type IsTarget = (node: PMNode) => boolean;

// build(node, pos) → Decoration[]；isTarget(node) 判斷要不要處理這個節點（預設是所有文字區塊）
export function buildBlockDecorations(doc: PMNode, build: BuildDecorations, isTarget: IsTarget = n => n.isTextblock): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isTarget(node)) return !node.isTextblock;
    for (const d of build(node, pos)) decos.push(d);
    return false;
  });
  return DecorationSet.create(doc, decos);
}

export function updateBlockDecorations(tr: Transaction, set: DecorationSet, build: BuildDecorations, isTarget: IsTarget = n => n.isTextblock): DecorationSet {
  if (!tr.docChanged) return set;
  const doc = tr.doc;
  set = set.map(tr.mapping, doc);
  const done = new Set<number>();
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
