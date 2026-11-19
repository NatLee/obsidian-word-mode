// 字數統計：中文、日文、韓文以字計，英文與數字以單字計（狀態列與「字數統計」視窗共用同一套算法）
import type { Node as PMNode } from 'prosemirror-model';

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;

export interface TextStats {
  cjk: number;
  latin: number;
  words: number;
  chars: number;
  charsWithSpaces: number;
}

export function countText(text: string): TextStats {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.replace(CJK, ' ').match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g) || []).length;
  return { cjk, latin, words: cjk + latin, chars: text.replace(/\s/g, '').length, charsWithSpaces: text.replace(/\n/g, '').length };
}

// 文件裡的文字（狀態列的字數用）：區塊之間換行，圖片、文件屬性這類節點算一個空白
export function docText(doc: PMNode, from = 0, to = doc.content.size): string { return doc.textBetween(from, to, '\n', ' '); }

// 「字數統計」視窗的各項數字
export interface WordStats {
  words: number; chars: number; charsSp: number;
  paras: number; heads: number; tables: number; images: number; links: number;
  minutes: number;
}

// 文件（或其中一段）的字數統計。Word 模式用編輯中的文件；Markdown／閱讀模式先把原文轉成文件再算，兩邊的數字才會一樣
export function docStats(doc: PMNode, from = 0, to = doc.content.size): WordStats {
  const text = docText(doc, from, to);
  const { cjk, latin } = countText(text);
  let paras = 0; let heads = 0; let tables = 0; let images = 0; let links = 0;
  doc.nodesBetween(from, to, n => {
    if (n.isTextblock && n.textContent.trim()) { paras++; if (n.type.name === 'heading') heads++; }
    if (n.type.name === 'table') tables++;
    if (n.type.name === 'image') images++;
    if (n.type.name === 'wikilink' || n.marks.some(m => m.type.name === 'link')) links++;
    return true;
  });
  return {
    words: cjk + latin, chars: text.replace(/\s/g, '').length, charsSp: text.replace(/\n/g, '').length,
    // 閱讀時間：中文每分鐘 400 字、英文每分鐘 200 個單字
    paras, heads, tables, images, links, minutes: Math.max(1, Math.round(cjk / 400 + latin / 200)),
  };
}
