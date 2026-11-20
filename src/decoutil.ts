// 以「文字區塊」為單位維護裝飾（decorations）：文件改動時只重算有變的區塊，其餘沿用。
// 每次打字都重建整份文件的裝飾，在長文件會讓輸入變慢。
import { DecorationSet } from 'prosemirror-view';
import type { Decoration } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';

export type BuildDecorations = (node: PMNode, pos: number) => Decoration[];
export type IsTarget = (node: PMNode) => boolean;

// build(node, pos) → Decoration[]；isTarget(node) 判斷哪些文字區塊要加裝飾（預設是全部）
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
        if (!node.isTextblock) return true;
        if (done.has(pos)) return false;
        done.add(pos);
        // 不是目標的文字區塊也要清：程式碼區塊跟段落合併之後，原本的上色會跟著文字搬進段落，
        // 只清「現在是目標」的區塊就會留在那裡
        const old = set.find(pos + 1, pos + node.nodeSize - 1);
        if (old.length) set = set.remove(old);
        if (!isTarget(node)) return false;
        const next = build(node, pos);
        if (next.length) set = set.add(doc, next);
        return false;
      });
    });
  });
  return set;
}
