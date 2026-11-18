// Mermaid 流程圖 ⇄ 「節點＋連線」的資料（純函式，不依賴 Obsidian，方便測試）。
// 只處理看得懂的寫法；遇到看不懂的（子圖、A & B --> C、linkStyle…）就回報無法用表單編輯，改用程式碼。
import type { I18nKey } from './i18n.js';

export interface FlowNode { id: string; text: string | null; shape: string | null; }
export interface FlowEdge { from: string; to: string; text: string; style: string; }
// 解析成功的結果；也是表單編輯與 generateFlowchart 使用的資料
export interface FlowModel { ok: true; keyword: string; dir: string; nodes: FlowNode[]; edges: FlowEdge[]; extra: string[]; }
export interface FlowFailure { ok: false; reason: FlowReason; }
export type FlowResult = FlowModel | FlowFailure;
// generateFlowchart 只需要這些欄位（keyword、dir、extra 可以省略）
export interface FlowSource { keyword?: string; dir?: string; nodes: FlowNode[]; edges: FlowEdge[]; extra?: string[]; }
export type FlowReason = keyof typeof FLOW_REASONS;
interface ReadNode extends FlowNode { rest: string; }
interface ReadLink { style: string; text: string; rest: string; }

export const DIRECTIONS: [string, I18nKey][] = [['TD', '由上到下'], ['LR', '由左到右'], ['BT', '由下到上'], ['RL', '由右到左']];

// 形狀：[代號, 名稱, 開頭符號, 結尾符號]（長的符號排前面，解析時先比對）
export const SHAPES: [string, I18nKey, string, string][] = [
  ['stadium', '圓角膠囊', '([', '])'],
  ['subroutine', '子流程', '[[', ']]'],
  ['cylinder', '資料庫', '[(', ')]'],
  ['circle', '圓形', '((', '))'],
  ['hexagon', '六角形', '{{', '}}'],
  ['parallelogram', '平行四邊形（輸入／輸出）', '[/', '/]'],
  ['rect', '方形', '[', ']'],
  ['round', '圓角', '(', ')'],
  ['diamond', '菱形（判斷）', '{', '}'],
];

// 連線：[代號, 名稱, 沒有文字時的寫法, 有文字時的前半、後半]
export const LINKS: [string, I18nKey, string][] = [
  ['arrow', '箭頭', '-->'],
  ['line', '直線', '---'],
  ['dotted', '虛線箭頭', '-.->'],
  ['thick', '粗箭頭', '==>'],
  ['both', '雙向箭頭', '<-->'],
];

// 節點代號：英數字、底線、中文；中間可以有連字號（a-b），但「A-->B」的 - 屬於連線
const ID = '[A-Za-z0-9_\\u00c0-\\uffff]+(?:-[A-Za-z0-9_\\u00c0-\\uffff]+)*';
const unquote = (s: string): string => {
  let v = s.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v.replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, '\n');
};
// 文字裡有 Mermaid 的特殊符號時要加引號
const quote = (s: unknown): string => {
  const v = String(s).replace(/"/g, '#quot;').replace(/\r?\n/g, '<br>');
  return /^[\p{L}\p{N}\s_.,:：，。！？、-]*$/u.test(v) && !/^\s|\s$/.test(v) && v !== '' ? v : '"' + v + '"';
};

// 從字串開頭讀一個節點：A、A[文字]、A{"文字"}…；回傳 { id, text, shape, rest } 或 null
function readNode(s: string): ReadNode | null {
  const m = new RegExp('^(' + ID + ')').exec(s);
  if (!m) return null;
  const id = m[1];
  let rest = s.slice(id.length);
  for (const [shape, , open, close] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    // 找結尾符號：引號裡的不算
    let i = open.length; let inQuote = false;
    for (; i < rest.length; i++) {
      if (rest[i] === '"') inQuote = !inQuote;
      else if (!inQuote && rest.startsWith(close, i)) break;
    }
    if (i >= rest.length) return null;
    const text = unquote(rest.slice(open.length, i));
    return { id, text, shape, rest: rest.slice(i + close.length) };
  }
  if (/^[[({>]/.test(rest)) return null; // 不認得的形狀
  return { id, text: null, shape: null, rest };
}

// 從字串開頭讀一條連線：-->、-->|文字|、-- 文字 -->、-.->、==>、<-->…；回傳 { style, text, rest } 或 null
function readLink(s: string): ReadLink | null {
  let m: RegExpExecArray | null;
  const label = (rest: string): { text: string; rest: string } => { const lm = /^\|([^|]*)\|/.exec(rest); return lm ? { text: unquote(lm[1]), rest: rest.slice(lm[0].length) } : { text: '', rest }; };
  if ((m = /^<-{2,}>/.exec(s))) { const l = label(s.slice(m[0].length)); return { style: 'both', text: l.text, rest: l.rest }; }
  if ((m = /^-{2,}>/.exec(s))) { const l = label(s.slice(m[0].length)); return { style: 'arrow', text: l.text, rest: l.rest }; }
  if ((m = /^-{3,}(?![->])/.exec(s))) { const l = label(s.slice(m[0].length)); return { style: 'line', text: l.text, rest: l.rest }; }
  if ((m = /^-\.+->/.exec(s))) { const l = label(s.slice(m[0].length)); return { style: 'dotted', text: l.text, rest: l.rest }; }
  if ((m = /^={2,}>/.exec(s))) { const l = label(s.slice(m[0].length)); return { style: 'thick', text: l.text, rest: l.rest }; }
  // 文字寫在中間：A -- 文字 --> B、A -. 文字 .-> B、A == 文字 ==> B、A -- 文字 --- B
  if ((m = /^--\s+([^-|>][^|>]*?)\s+-{2,}>/.exec(s))) return { style: 'arrow', text: unquote(m[1]), rest: s.slice(m[0].length) };
  if ((m = /^--\s+([^-|>][^|>]*?)\s+-{3,}(?![->])/.exec(s))) return { style: 'line', text: unquote(m[1]), rest: s.slice(m[0].length) };
  if ((m = /^-\.\s+([^|>]*?)\s+\.+->/.exec(s))) return { style: 'dotted', text: unquote(m[1]), rest: s.slice(m[0].length) };
  if ((m = /^==\s+([^=|>][^|>]*?)\s+={2,}>/.exec(s))) return { style: 'thick', text: unquote(m[1]), rest: s.slice(m[0].length) };
  return null;
}

const fail = (reason: FlowReason): FlowFailure => ({ ok: false, reason });

// 解析：{ ok: true, keyword, dir, nodes: [{ id, text, shape }], edges: [{ from, to, text, style }], extra: [原樣保留的行] }
export function parseFlowchart(src: string): FlowResult {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (!lines[i].trim() || /^\s*%%/.test(lines[i]))) i++;
  const head = /^\s*(flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*;?\s*$/.exec(lines[i] || '');
  if (!head) return fail('notFlowchart');
  const model: FlowModel = { ok: true, keyword: head[1], dir: head[2] === 'TB' ? 'TD' : (head[2] || 'TD'), nodes: [], edges: [], extra: [] };
  const byId = new Map<string, FlowNode>();
  const touch = (n: ReadNode): FlowNode => {
    let node = byId.get(n.id);
    if (!node) { node = { id: n.id, text: n.id, shape: 'rect' }; byId.set(n.id, node); model.nodes.push(node); }
    if (n.shape) { node.shape = n.shape; node.text = n.text; }
    return node;
  };
  for (i += 1; i < lines.length; i++) {
    const raw = lines[i];
    let s = raw.trim().replace(/;$/, '').trim();
    if (!s) continue;
    if (/^%%/.test(s)) { model.extra.push(raw.trim()); continue; }
    if (/^(subgraph|end|direction)\b/.test(s)) return fail('subgraph');
    if (/^linkStyle\b/.test(s)) return fail('linkStyle');
    if (/^(style|classDef|class|click)\b/.test(s)) { model.extra.push(raw.trim()); continue; }
    let node = readNode(s);
    if (!node) return fail('syntax');
    let prev = touch(node);
    s = node.rest.trim();
    if (/^:::/.test(s)) return fail('syntax');
    while (s) {
      if (s.startsWith('&')) return fail('multi');
      const link = readLink(s);
      if (!link) return fail('syntax');
      node = readNode(link.rest.trim());
      if (!node) return fail('syntax');
      const next = touch(node);
      model.edges.push({ from: prev.id, to: next.id, text: link.text || '', style: link.style });
      prev = next;
      s = node.rest.trim();
      if (/^:::/.test(s)) return fail('syntax');
    }
  }
  return model;
}

// 產生 Mermaid 程式碼
export function generateFlowchart(model: FlowSource): string {
  const out = [(model.keyword || 'flowchart') + ' ' + (model.dir || 'TD')];
  for (const n of model.nodes) {
    const shape = (SHAPES.find(x => x[0] === n.shape) || SHAPES.find(x => x[0] === 'rect'))!;
    out.push('    ' + n.id + shape[2] + quote(n.text == null || n.text === '' ? n.id : n.text) + shape[3]);
  }
  for (const e of model.edges) {
    const link = LINKS.find(x => x[0] === e.style) || LINKS[0];
    out.push('    ' + e.from + ' ' + link[2] + (e.text ? '|' + quote(e.text) + '|' : '') + ' ' + e.to);
  }
  for (const x of model.extra || []) out.push('    ' + x);
  return out.join('\n');
}

// 兩份資料內容是否相同（比較節點、連線、方向、附加的行）
export function sameFlowchart(a: FlowResult | null | undefined, b: FlowResult | null | undefined): boolean {
  const pick = (m: FlowModel): string => JSON.stringify({ d: m.dir, n: m.nodes.map(n => [n.id, n.text, n.shape]), e: m.edges.map(e => [e.from, e.to, e.text, e.style]), x: m.extra });
  return !!a && !!b && a.ok && b.ok && pick(a) === pick(b);
}

// 這段程式碼能不能用表單編輯：解析得出來，而且「產生後再解析」內容不變
export function editableFlowchart(src: string): FlowResult {
  const m = parseFlowchart(src);
  if (!m.ok) return m;
  const again = parseFlowchart(generateFlowchart(m));
  return sameFlowchart(m, again) ? m : fail('roundtrip');
}

// 新節點的代號：N1、N2…（避開已經用過的）
export function newNodeId(model: { nodes: FlowNode[] }): string {
  const used = new Set(model.nodes.map(n => n.id));
  let i = model.nodes.length + 1;
  while (used.has('N' + i)) i++;
  return 'N' + i;
}

export const FLOW_REASONS = {
  notFlowchart: '這不是流程圖（flowchart／graph），請用程式碼編輯。',
  subgraph: '這張圖用了子圖（subgraph），表單編輯不支援，請用程式碼編輯。',
  linkStyle: '這張圖用了 linkStyle（依順序指定連線樣式），表單編輯會打亂順序，請用程式碼編輯。',
  multi: '這張圖用了「A & B --> C」的寫法，表單編輯不支援，請用程式碼編輯。',
  syntax: '有表單編輯看不懂的寫法，請用程式碼編輯。',
  roundtrip: '這張圖有表單編輯無法完整保留的內容，請用程式碼編輯。',
} satisfies Record<string, I18nKey>;

// 常用圖表的範本
// [範本名稱, 範本內容]：兩者都會依介面語言翻譯
export const MERMAID_TEMPLATES: [I18nKey, I18nKey][] = [
  ['流程圖', 'flowchart TD\n    A[開始] --> B{條件成立？}\n    B -->|是| C[處理]\n    B -->|否| D[結束]\n    C --> D'],
  ['循序圖', 'sequenceDiagram\n    participant 使用者\n    participant 系統\n    使用者->>系統: 送出請求\n    系統-->>使用者: 回覆結果'],
  ['甘特圖', 'gantt\n    title 專案時程\n    dateFormat YYYY-MM-DD\n    section 規劃\n    需求確認 :a1, 2026-01-05, 5d\n    section 開發\n    實作 :after a1, 10d'],
  ['圓餅圖', 'pie title 佔比\n    "項目一" : 45\n    "項目二" : 30\n    "項目三" : 25'],
  ['狀態圖', 'stateDiagram-v2\n    [*] --> 待處理\n    待處理 --> 進行中\n    進行中 --> 完成\n    完成 --> [*]'],
  ['類別圖', 'classDiagram\n    class 訂單 {\n        +編號\n        +金額\n        +送出()\n    }\n    class 客戶\n    客戶 "1" --> "*" 訂單'],
  ['心智圖', 'mindmap\n  root((主題))\n    分支一\n      細項\n    分支二'],
  ['時間軸', 'timeline\n    title 里程碑\n    2025 : 啟動\n    2026 : 上線'],
  ['ER 圖', 'erDiagram\n    "客戶" ||--o{ "訂單" : "下單"\n    "訂單" ||--|{ "明細" : "包含"'],
];
