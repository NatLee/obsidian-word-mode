// Mermaid 流程圖 ⇄ 「節點＋連線」的資料（純函式，不依賴 Obsidian，方便測試）。
// 只處理看得懂的寫法；遇到看不懂的（子圖、A & B --> C、linkStyle…）就回報無法用表單編輯，改用程式碼。
import type { I18nKey } from './i18n.js';

export interface FlowNode { id: string; text: string | null; shape: string | null; }
// len：連線加長了幾級（--> 是 0、---> 是 1、----> 是 2；Mermaid 用它決定兩個節點隔幾層）
export interface FlowEdge { from: string; to: string; text: string; style: string; len?: number; }
// 解析成功的結果；也是表單編輯與 generateFlowchart 使用的資料
export interface FlowModel { ok: true; keyword: string; dir: string; nodes: FlowNode[]; edges: FlowEdge[]; extra: string[]; }
export interface FlowFailure { ok: false; reason: FlowReason; }
export type FlowResult = FlowModel | FlowFailure;
// generateFlowchart 只需要這些欄位（keyword、dir、extra 可以省略）
export interface FlowSource { keyword?: string; dir?: string; nodes: FlowNode[]; edges: FlowEdge[]; extra?: string[]; }
// 解析不出來的原因；給使用者看的說明在 diagrams.ts 的 DIAGRAM_REASONS（notFlowchart 在那裡算成 unknownKind）
export type FlowReason = 'notFlowchart' | 'subgraph' | 'linkStyle' | 'multi' | 'syntax';
interface ReadNode extends FlowNode { rest: string; }
interface ReadLink { style: string; text: string; rest: string; len: number; }

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
    const inner = rest.slice(open.length, i);
    // A[\文字/]、A[\文字\]：梯形與反向的平行四邊形，表單沒有這些形狀。當成方形的話，
    // 斜線會變成文字的一部分，寫回去是 A["\文字/"]（一個方形，文字裡有斜線）
    if (shape === 'rect' && inner.startsWith('\\')) return null;
    const text = unquote(inner);
    return { id, text, shape, rest: rest.slice(i + close.length) };
  }
  if (/^[[({>]/.test(rest)) return null; // 不認得的形狀
  return { id, text: null, shape: null, rest };
}

// 各種連線最短的寫法裡，會隨長度增加的那個符號（- . =）有幾個：多出來的就是加長的級數
const LINK_BASE: Record<string, number> = { arrow: 2, line: 3, dotted: 1, thick: 2, both: 2 };
// 連線的寫法：len 是加長的級數（-->、--->、---->；-.->、-..->；==>、===>）
function linkCode(style: string, len = 0): string {
  const n = Math.max(0, Math.floor(len) || 0);
  if (style === 'line') return '---' + '-'.repeat(n);
  if (style === 'dotted') return '-.' + '.'.repeat(n) + '->';
  if (style === 'thick') return '==' + '='.repeat(n) + '>';
  if (style === 'both') return '<--' + '-'.repeat(n) + '>';
  return '--' + '-'.repeat(n) + '>';
}

// 從字串開頭讀一條連線：-->、-->|文字|、-- 文字 -->、-.->、==>、<-->…；回傳 { style, text, rest, len } 或 null。
// 每個樣式的比對裡，第一組括號是「會隨長度增加的符號」（寫在線中間的文字是第一組，符號是第二組）
function readLink(s: string): ReadLink | null {
  let m: RegExpExecArray | null;
  const label = (rest: string): { text: string; rest: string } => { const lm = /^\|([^|]*)\|/.exec(rest); return lm ? { text: unquote(lm[1]), rest: rest.slice(lm[0].length) } : { text: '', rest }; };
  // 符號後面可以接 |文字|
  const plain = (style: string): ReadLink => { const l = label(s.slice(m![0].length)); return { style, text: l.text, rest: l.rest, len: m![1].length - LINK_BASE[style] }; };
  // 文字寫在中間
  const inline = (style: string): ReadLink => ({ style, text: unquote(m![1]), rest: s.slice(m![0].length), len: m![2].length - LINK_BASE[style] });
  if ((m = /^<(-{2,})>/.exec(s))) return plain('both');
  if ((m = /^(-{2,})>/.exec(s))) return plain('arrow');
  if ((m = /^(-{3,})(?![->])/.exec(s))) return plain('line');
  if ((m = /^-(\.+)->/.exec(s))) return plain('dotted');
  if ((m = /^(={2,})>/.exec(s))) return plain('thick');
  // 文字寫在中間：A -- 文字 --> B、A -. 文字 .-> B、A == 文字 ==> B、A -- 文字 --- B
  if ((m = /^--\s+([^-|>][^|>]*?)\s+(-{2,})>/.exec(s))) return inline('arrow');
  if ((m = /^--\s+([^-|>][^|>]*?)\s+(-{3,})(?![->])/.exec(s))) return inline('line');
  if ((m = /^-\.\s+([^|>]*?)\s+(\.+)->/.exec(s))) return inline('dotted');
  if ((m = /^==\s+([^=|>][^|>]*?)\s+(={2,})>/.exec(s))) return inline('thick');
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
      model.edges.push({ from: prev.id, to: next.id, text: link.text || '', style: link.style, len: link.len });
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
    out.push('    ' + e.from + ' ' + linkCode(link[0], e.len) + (e.text ? '|' + quote(e.text) + '|' : '') + ' ' + e.to);
  }
  for (const x of model.extra || []) out.push('    ' + x);
  return out.join('\n');
}

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
  ['旅程圖', 'journey\n    title 我的一天\n    section 上午\n      泡茶: 5: 我\n      開會: 2: 我, 同事\n    section 下午\n      寫報告: 3: 我'],
  ['象限圖', 'quadrantChart\n    title 工作的優先順序\n    x-axis "不急" --> "很急"\n    y-axis "不重要" --> "很重要"\n    quadrant-1 "馬上做"\n    quadrant-2 "排時間做"\n    quadrant-3 "有空再做"\n    quadrant-4 "交給別人"\n    "寫報告": [0.8, 0.9]\n    "整理信箱": [0.3, 0.2]'],
];
