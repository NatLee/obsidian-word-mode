// 字數統計（狀態列與「字數統計」視窗共用同一套算法）。算法有兩種，由設定「字數的算法」選擇：
//   word：只算看得到的文字。中文、日文、韓文以字計，英文與數字以單字計；Markdown 符號、連結網址與文件屬性不算，字元數不含空白
//   obsidian：跟 Obsidian 內建的字數（核心外掛「字數統計」）一樣，算 Markdown 原文（文件屬性除外），字元數含空白與換行。
//             給習慣看 Obsidian 字數的人：切換 Word 模式與 Markdown 時數字不會變
import type { Node as PMNode } from 'prosemirror-model';

export type CountMethod = 'word' | 'obsidian';

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

// 預估閱讀時間（分鐘）：中文每分鐘 400 字、英文每分鐘 200 個單字
export function readingMinutes(s: Pick<TextStats, 'cjk' | 'latin'>): number { return Math.max(1, Math.round(s.cjk / 400 + s.latin / 200)); }

// Obsidian 內建字數的詞（照 Obsidian 1.15.1 的算法）：數字（可以有千分位與小數點）、
// 中日文以外的文字與 - ' ’ 連成一串算一個詞（韓文也是一串算一個），中文、日文的假名每個字算一個。
// Obsidian 把文字的範圍一段段列出來；這裡用 \p{L}（所有文字）扣掉一個字算一個詞的那幾段，再加上整段泰米爾文（含母音符號）。
// 跟 Obsidian 的 regex 逐字比對過：只有 Unicode 9 之後才加入的少數罕用字母不同（Obsidian 的清單比較舊，不算它們）
const OBS_SINGLE = '\\u0F00\\u0F40-\\u0F47\\u0F49-\\u0F6C\\u0F88-\\u0F8C\\u3041-\\u3096\\u309D-\\u309F\\u30A1-\\u30FA\\u30FC-\\u30FF\\u4E00-\\u9FD5';
const OBS_WORD = new RegExp('(?:[0-9]+(?:[,.][0-9]+)*|(?![' + OBS_SINGLE + '])[-\'’\\p{L}\\u0B80-\\u0BFF])+|[' + OBS_SINGLE + ']', 'gu');

// 去掉開頭的文件屬性，判斷方式跟 Obsidian 一樣：第一行是 ---，到下一個從行首開始的 ---
export function stripFrontmatter(md: string): string {
  const open = /^---\r?\n/.exec(md);
  if (!open) return md;
  const close = /---(?:\r?\n|$)/g;
  close.lastIndex = open[0].length;
  for (let m = close.exec(md); m; m = close.exec(md)) if (md.charAt(m.index - 1) === '\n') return md.slice(close.lastIndex);
  return md;
}

// 「跟 Obsidian 一樣」的算法，md 是 Markdown 原文。fragment：選取的一段，不去掉文件屬性（Obsidian 算選取時也不去掉）。
// cjk、latin 只用來估閱讀時間
export function countSource(md: string, fragment = false): TextStats {
  const text = fragment ? md : stripFrontmatter(md);
  const { cjk, latin } = countText(text);
  return { cjk, latin, words: (text.match(OBS_WORD) || []).length, chars: text.replace(/\s/g, '').length, charsWithSpaces: text.length };
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
    paras, heads, tables, images, links, minutes: readingMinutes({ cjk, latin }),
  };
}

// 「跟 Obsidian 一樣」的算法：字數、字元數與閱讀時間改用 Markdown 原文 md 來算；段落、標題、表格這些數目不變
export function withSourceCounts(st: WordStats, md: string, fragment = false): WordStats {
  const c = countSource(md, fragment);
  return Object.assign({}, st, { words: c.words, chars: c.chars, charsSp: c.charsWithSpaces, minutes: readingMinutes(c) });
}
