// 設定頁的搜尋：依使用者打的字找出相關的設定、排出先後，並標出符合的位置（給搜尋框的自動完成清單用）。
// 不依賴 Obsidian，可以直接測試；畫清單在 settingsnav.ts 的 buildSettingSearch

// 一筆可以搜尋的設定。name、desc 是目前介面語言的文字；
// terms 是這一列裡其他看得到的文字（下拉選單的選項、勾選項目的名稱），使用者記得選項卻不記得設定名稱時也找得到；
// alt 是同一個設定在其他介面語言的名稱與說明：介面是中文、打英文也找得到（反過來也一樣）
export interface SearchDoc {
  name: string;
  desc: string;
  terms: readonly string[];
  alt: readonly { name: string; desc: string }[];
}

// 文字裡的一段 [from, to)
export interface TextRange { from: number; to: number; }

// 搜尋結果裡名稱下面那一行：kind 是這段文字的來源
//   desc：設定的說明；term：這一列的選項或勾選項目；alt：其他語言的名稱或說明
// text 已經截到符合的位置附近
export interface SearchSnippet { text: string; ranges: TextRange[]; kind: 'desc' | 'term' | 'alt'; }

export interface SearchHit<T extends SearchDoc> {
  doc: T;
  score: number;
  // 名稱裡符合的位置
  name: TextRange[];
  snippet: SearchSnippet | null;
}

// 同義詞：同一組裡的詞互相代換再找一次。使用者常用別的說法找設定（「快捷鍵」找「快速鍵」、「功能區」找「工具列」），
// 介面文字只用其中一種說法，沒有這份清單就找不到。各語言混在同一組沒關係，換出來的詞只是多比對一次
const SYNONYMS: readonly (readonly string[])[] = [
  ['快速鍵', '快捷鍵', '熱鍵', '鍵盤', 'shortcut', 'hotkey', 'keyboard'],
  ['工具列', '功能區', '工具欄', 'toolbar', 'ribbon'],
  ['資料夾', '文件夾', 'folder', 'directory'],
  ['縮放', '放大', '縮小', 'zoom', 'scale'],
  ['語言', '語系', 'language', 'locale'],
  ['右鍵', '快顯功能表', 'context menu', 'right-click', 'right click'],
  ['方程式', '公式', '數學', 'equation', 'formula', 'math', 'latex'],
  ['圖表', '流程圖', 'mermaid', 'diagram', 'chart', 'flowchart'],
  ['同步', 'sync', 'synology'],
  ['還原', '重設', '重置', 'reset', 'restore'],
  ['屬性', 'frontmatter', 'properties', 'property', 'yaml'],
  ['大綱', '目錄', 'outline', 'toc', 'table of contents'],
  ['提示', 'tooltip', 'hint'],
  ['狀態列', 'status bar'],
  ['字數', 'word count'],
  ['寬度', '全寬', 'width', 'wide'],
];

// 比對用的文字：英文不分大小寫，全形英數字、全形空白當成半形（中文輸入法常打出全形）。
// 一個字一個字換，換完長度不變，符合的位置才能直接對回原文
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = c.normalize('NFKC').toLowerCase();
    out += n.length === 1 ? n : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
  }
  return out;
}

// 搜尋字串拆成幾個詞（空白分開），每個詞都要找得到
export function queryTokens(q: string): string[] {
  return fold(q).split(/\s+/).filter(Boolean);
}

// 一個詞的各種說法：自己，以及把裡面的同義詞換成同一組其他詞的結果
function variants(token: string): { text: string; synonym: boolean }[] {
  const out = [{ text: token, synonym: false }];
  const seen = new Set([token]);
  for (const group of SYNONYMS) {
    for (const w of group) {
      const fw = fold(w);
      const at = token.indexOf(fw);
      if (at < 0) continue;
      for (const other of group) {
        const v = token.slice(0, at) + fold(other) + token.slice(at + fw.length);
        if (!seen.has(v)) { seen.add(v); out.push({ text: v, synonym: true }); }
      }
    }
  }
  return out;
}

// 前一個字是空白或標點：算是一個詞的開頭（「Page zoom」的 zoom、「（MB）」的 MB）
const BOUNDARY = /[\s()（）「」『』[\]/／·・,，、.。:：;；!?！？+-]/;

// needle 在 hay 裡依序出現（中間可以隔幾個字），而且不會散得太開：「工具位置」找得到「工具列位置」。
// 回傳每個符合的字的位置；找不到回傳 null
function subsequence(hay: string, needle: string): TextRange[] | null {
  if (needle.length < 2) return null;
  const at: number[] = [];
  let from = 0;
  for (const ch of needle) {
    const i = hay.indexOf(ch, from);
    if (i < 0) return null;
    at.push(i);
    from = i + 1;
  }
  if (at[at.length - 1] - at[0] + 1 > needle.length * 2 + 1) return null;
  return merge(at.map(i => ({ from: i, to: i + 1 })));
}

// 重疊或相連的範圍併成一段
function merge(ranges: TextRange[]): TextRange[] {
  const sorted = ranges.slice().sort((a, b) => a.from - b.from);
  const out: TextRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ from: r.from, to: r.to });
  }
  return out;
}

// 片段最多從符合的位置往前留幾個字，太長的說明才看得到符合的地方
const LEAD = 16;

function snippetAt(text: string, ranges: TextRange[], kind: SearchSnippet['kind']): SearchSnippet {
  const first = ranges.length ? ranges[0].from : 0;
  if (first <= LEAD) return { text, ranges, kind };
  const start = first - LEAD;
  // 前面加了「…」，位置要往後一格
  return { text: '…' + text.slice(start), ranges: ranges.map(r => ({ from: r.from - start + 1, to: r.to - start + 1 })), kind };
}

// 一筆設定裡可以比對的文字（都已經 fold 過）。srcs 是名稱以外的文字：第一個是說明，接著是其他語言的名稱、選項、其他語言的說明。
// prefix 為 true 的（其他語言的名稱）跟名稱一樣，從開頭或詞首符合的分數比較高
interface Source { text: string; orig: string; kind: SearchSnippet['kind']; weight: number; prefix: boolean; }
interface Folded { name: string; srcs: Source[]; }

// 在某段文字裡找到的位置；direct 為 false 表示是換成同義詞才找到的
interface Found { ranges: TextRange[]; direct: boolean; }

// 一個詞在一筆設定裡的比對結果。score 是最好的那一項的分數（決定排序）；
// 其餘欄位決定要標出哪些字、名稱下面那一行顯示什麼：
//   name：名稱裡的位置；desc：說明（srcs[0]）裡的位置；other：說明以外最好的那段文字（第幾個 src）
interface TokenMatch { score: number; name: Found | null; desc: Found | null; other: (Found & { src: number }) | null; }

function matchToken(doc: Folded, token: string): TokenMatch | null {
  let score = 0;
  let name: Found | null = null;
  let desc: Found | null = null;
  let other: (Found & { src: number; score: number }) | null = null;
  // variants 的第一個是原本的詞：先找到的（原本的詞）優先，同義詞只在原本的詞找不到時補上
  for (const v of variants(token)) {
    // 同義詞找到的排在原本的詞後面
    const k = v.synonym ? 0.8 : 1;
    const direct = !v.synonym;
    const len = v.text.length;
    const i = doc.name.indexOf(v.text);
    if (i >= 0) {
      score = Math.max(score, (i === 0 ? 100 : BOUNDARY.test(doc.name[i - 1]) ? 80 : 60) * k);
      if (!name) name = { ranges: [{ from: i, to: i + len }], direct };
    } else if (direct) {
      const sub = subsequence(doc.name, v.text);
      if (sub) { score = Math.max(score, 30); name = { ranges: sub, direct: false }; }
    }
    doc.srcs.forEach((s, si) => {
      const at = s.text.indexOf(v.text);
      if (at < 0) return;
      // 其他語言的名稱從開頭或詞首符合算一樣：各語言同分時，排在前面的語言（英文）優先顯示
      const sc = (s.prefix ? (at === 0 || BOUNDARY.test(s.text[at - 1]) ? 1 : 0.6) * s.weight : s.weight) * k;
      score = Math.max(score, sc);
      const ranges = [{ from: at, to: at + len }];
      if (si === 0) { if (!desc) desc = { ranges, direct }; } else if (!other || (direct && !other.direct) || (direct === other.direct && sc > other.score)) other = { ranges, direct, src: si, score: sc };
    });
  }
  return score > 0 ? { score, name, desc, other } : null;
}

// 這筆設定可以比對的文字；alt 裡跟目前語言一樣的（沒有翻譯而退回原文）不重複比對
function foldDoc(doc: SearchDoc): Folded {
  const srcs: Source[] = [];
  const seen = new Set([doc.name, doc.desc]);
  const add = (orig: string, kind: SearchSnippet['kind'], weight: number, prefix = false) => {
    if (!orig || seen.has(orig)) return;
    seen.add(orig);
    srcs.push({ text: fold(orig), orig, kind, weight, prefix });
  };
  // 說明一定放在第一個（matchToken 以 srcs[0] 當說明），沒有說明時是空字串，什麼都比對不到
  srcs.push({ text: fold(doc.desc), orig: doc.desc, kind: 'desc', weight: 15, prefix: false });
  // 其他語言的名稱：分數比目前語言的名稱打一點折，同樣的字在兩種語言都符合時，目前語言的排前面
  for (const a of doc.alt) add(a.name, 'alt', 90, true);
  for (const x of doc.terms) add(x, 'term', 25);
  for (const a of doc.alt) add(a.desc, 'alt', 12);
  return { name: fold(doc.name), srcs };
}

// 依 query 找出符合的設定，分數高的在前；分數相同時維持 docs 原本的順序（設定頁上的順序）。
// query 是空白時回傳空陣列（要顯示什麼由呼叫的一方決定）
export function searchSettings<T extends SearchDoc>(docs: readonly T[], query: string): SearchHit<T>[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return [];
  const hits: (SearchHit<T> & { order: number })[] = [];
  docs.forEach((doc, order) => {
    const f = foldDoc(doc);
    const ms: TokenMatch[] = [];
    for (const token of tokens) {
      const m = matchToken(f, token);
      if (!m) return;
      ms.push(m);
    }
    const score = ms.reduce((n, m) => n + m.score, 0);
    const name = merge(ms.flatMap(m => (m.name ? m.name.ranges : [])));
    const descRanges = (direct: boolean) => merge(ms.flatMap(m => (m.desc && (m.desc.direct || !direct) ? m.desc.ranges : [])));
    // 說明以外的文字（選項、其他語言）：只看名稱裡沒有直接找到的詞，名稱已經標出來的就不必再說明為什麼符合。
    // 第一個這樣的詞決定顯示哪一段，同一段文字裡其他詞的位置也一起標出來
    const otherSnippet = (direct: boolean): SearchSnippet | null => {
      const lead = ms.find(m => !(m.name && m.name.direct) && m.other && (m.other.direct || !direct));
      if (!lead || !lead.other) return null;
      const si = lead.other.src;
      const s = f.srcs[si];
      return snippetAt(s.orig, merge(ms.flatMap(m => (m.other && m.other.src === si ? m.other.ranges : []))), s.kind);
    };
    // 名稱下面那一行，依序：說明裡直接找到的、選項或其他語言直接找到的、說明裡換成同義詞找到的、選項或其他語言換成同義詞找到的。
    // 都沒有（只有名稱符合）時顯示說明的開頭
    const direct = descRanges(true);
    const synonym = descRanges(false);
    const snippet = direct.length ? snippetAt(doc.desc, direct, 'desc')
      : otherSnippet(true)
        || (synonym.length ? snippetAt(doc.desc, synonym, 'desc') : null)
        || otherSnippet(false)
        || (doc.desc ? { text: doc.desc, ranges: [], kind: 'desc' as const } : null);
    hits.push({ doc, score, name, snippet, order });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.map(({ doc, score, name, snippet }) => ({ doc, score, name, snippet }));
}
