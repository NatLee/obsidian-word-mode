// Mermaid 圖表 ⇄ 表單資料（純函式，不依賴 Obsidian，方便測試）。
// 每一種圖表（流程圖、循序圖、甘特圖、圓餅圖、狀態圖、類別圖、心智圖、時間軸、ER 圖）描述三件事：
// 怎麼把程式碼讀成資料（parse）、怎麼把資料寫回程式碼（generate）、表單有哪些欄位（opts、lists）。
// 表單與「點預覽圖上的文字直接修改」都依這份描述運作，不必為每種圖表另外寫介面。
// 只處理看得懂的寫法；遇到看不懂的（區塊、樣式…）就回報原因，改用程式碼編輯，不會弄壞原本的內容。
import { parseFlowchart, generateFlowchart, DIRECTIONS, SHAPES, LINKS, MERMAID_TEMPLATES } from './flowchart.js';
import type { I18nKey } from './i18n.js';

// 表單裡的一列：欄位名稱 → 值（一律是字串；勾選框用 '1' 與 ''）
export type Row = Record<string, string>;
// 一張圖的資料：opts 是圖表本身的設定（標題、方向…），lists 是各個清單，
// extra 是原樣保留的行（註解、表單沒有的設定），pre 是圖表種類那一行之前的行（%% 註解、%%{init}%%）
export interface DiagramModel { opts: Record<string, string>; lists: Record<string, Row[]>; extra: string[]; pre: string[]; }
// 翻譯函式（由介面傳進來；這個檔案不直接依賴 i18n 的執行內容）
export type Translate = (text: I18nKey) => string;
// 下拉選單的選項：[值, 顯示的文字]
export type Choice = [value: string, label: string];

// 不能用表單編輯的原因
export const DIAGRAM_REASONS = {
  unknownKind: '這種圖表還沒有表單可以用，請用程式碼編輯。',
  blocks: '這張圖用了表單不支援的區塊或指令（例如 loop、alt、子狀態、樣式），請用程式碼編輯。',
  subgraph: '這張圖用了子圖（subgraph），表單編輯不支援，請用程式碼編輯。',
  linkStyle: '這張圖用了 linkStyle（依順序指定連線樣式），表單編輯會打亂順序，請用程式碼編輯。',
  multi: '這張圖用了「A & B --> C」的寫法，表單編輯不支援，請用程式碼編輯。',
  syntax: '有表單編輯看不懂的寫法，請用程式碼編輯。',
  roundtrip: '這張圖有表單編輯無法完整保留的內容，請用程式碼編輯。',
} satisfies Record<string, I18nKey>;
export type DiagramReason = keyof typeof DIAGRAM_REASONS;

// ---------------------------------------------------------------- 表單欄位的描述

interface FieldBase {
  // 欄位名稱（Row 或 opts 的鍵）
  key: string;
  // 欄位的說明（提示文字）
  label: I18nKey;
  // 寬度：xs 很窄（代號、數字）、s 窄、m 一般、l 寬（主要的文字）
  size?: 'xs' | 's' | 'm' | 'l';
}
// 一行文字。group：這個欄位的值是某一類東西的名稱（例如參與者、狀態），在圖上改名時同一類的欄位一起改；
// def：這一欄是那類東西的「定義」，在表單裡改名也會連帶更新其他引用它的欄位；
// multiline：文字可以換行（表單裡用「 / 」表示換行）；suggest：輸入時的建議
export interface TextField extends FieldBase { kind: 'text'; placeholder?: I18nKey; group?: string; def?: boolean; multiline?: boolean; suggest?: (m: DiagramModel) => string[]; }
// 多行文字，一行一項（類別的成員、實體的欄位、時間軸的事件）；存成用換行分開的字串
export interface LinesField extends FieldBase { kind: 'lines'; placeholder?: I18nKey; }
export interface SelectField extends FieldBase { kind: 'select'; options: (m: DiagramModel, tr: Translate) => Choice[]; group?: string; }
export interface CheckField extends FieldBase { kind: 'check'; }
// 階層（心智圖）：用縮排表示，值是 '0'、'1'、'2'…
export interface LevelField extends FieldBase { kind: 'level'; }
// 色彩（流程圖節點的底色）：值是 CSS 色碼，空字串＝預設。colors 是可以選的色彩：[色碼, 名稱]
export interface ColorField extends FieldBase { kind: 'color'; colors: readonly (readonly [color: string, name: I18nKey])[]; }
export type Field = TextField | LinesField | SelectField | CheckField | LevelField | ColorField;

// 一列上的額外按鈕（例如流程圖的「新增下一步」）；回傳新增的那一列（介面會把游標放過去）
export interface RowAction { icon: string; label: I18nKey; run(m: DiagramModel, row: Row, tr: Translate): Row | null; }
// 表單裡的一個清單
export interface ListSpec {
  key: string;
  title: I18nKey;
  // 「新增」按鈕的文字
  add: I18nKey;
  fields: Field[];
  // 新的一列（還沒加進清單）
  make(m: DiagramModel, tr: Translate): Row;
  actions?: RowAction[];
  // 刪除一列之前呼叫（例如刪掉連到這個步驟的線）
  onDelete?(m: DiagramModel, row: Row): void;
  // 每一列另外加的 CSS class
  rowClass?: string;
  // 清單下方的說明
  hint?: I18nKey;
  // 第一列不能刪除、不能移動（心智圖的中心主題）
  fixedFirst?: boolean;
}
export interface DiagramKind {
  id: string;
  name: I18nKey;
  // Lucide 圖示
  icon: string;
  // 圖表種類那一行的寫法
  head: RegExp;
  // 範本（依介面語言翻譯）
  template: I18nKey;
  // 讀成資料；看不懂時回傳原因
  parse(src: string): DiagramModel | DiagramReason;
  generate(m: DiagramModel): string;
  opts: Field[];
  lists: ListSpec[];
  // 每次修改後整理資料（例如心智圖的階層不能一次跳兩層）
  fix?(m: DiagramModel): void;
}

// ---------------------------------------------------------------- 共用的小工具

const INDENT = '    ';
const one = (s: string | undefined): string => String(s == null ? '' : s).replace(/\s*\r?\n\s*/g, ' ').trim();
const unquote = (s: string): string => { const v = s.trim(); return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v; };
const emptyModel = (): DiagramModel => ({ opts: {}, lists: {}, extra: [], pre: [] });
const fixed = (list: readonly (readonly [string, I18nKey])[]) => (_m: DiagramModel, tr: Translate): Choice[] => list.map(([v, label]) => [v, tr(label)]);
const names = (list: string, key = 'name') => (m: DiagramModel): Choice[] => (m.lists[list] || []).map(r => [r[key], r[key]]);
const template = (name: I18nKey): I18nKey => MERMAID_TEMPLATES.find(x => x[0] === name)![1];

// 把程式碼分成：種類那一行之前的行（註解）、種類那一行的比對結果、之後的每一行（去掉空行與行尾分號）
interface Split { pre: string[]; head: RegExpExecArray; body: { raw: string; text: string }[]; }
function split(src: string, head: RegExp): Split | null {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const pre: string[] = [];
  while (i < lines.length && (!lines[i].trim() || /^\s*%%/.test(lines[i]))) { if (lines[i].trim()) pre.push(lines[i].trim()); i++; }
  const m = head.exec((lines[i] || '').trim());
  if (!m) return null;
  const body = lines.slice(i + 1).filter(l => l.trim()).map(raw => ({ raw, text: raw.trim().replace(/;$/, '').trim() }));
  return { pre, head: m, body };
}
// 寫回程式碼：種類之前的行、種類那一行、原樣保留的行、其餘的行
const join = (m: DiagramModel, head: string, body: string[]): string => [...m.pre, head, ...m.extra.map(x => INDENT + x), ...body].join('\n');
// 清單裡沒有這個名稱就加一列（循序圖的參與者、類別、實體可以不先宣告就直接使用）
function ensure(rows: Row[], name: string, make: (name: string) => Row): void {
  if (name && !rows.some(r => r.name === name)) rows.push(make(name));
}

// ---------------------------------------------------------------- 流程圖（解析與產生在 flowchart.ts）

// 節點的底色：淺色，配上深一點的框線與深色的字（深色佈景主題裡字才看得清楚）
export const NODE_FILLS: [string, I18nKey][] = [
  ['#ffe3e3', '紅色'], ['#ffe8cc', '橘色'], ['#fff3bf', '黃色'], ['#d3f9d8', '綠色'],
  ['#c5f6fa', '青色'], ['#d0ebff', '藍色'], ['#e5dbff', '紫色'], ['#e9ecef', '灰色'],
];
const NODE_TEXT = '#1f2328';
// 框線的顏色：底色加深
const strokeOf = (fill: string): string => '#' + [1, 3, 5].map(i => Math.round(parseInt(fill.slice(i, i + 2), 16) * 0.62).toString(16).padStart(2, '0')).join('');
const styleOf = (id: string, fill: string): string => 'style ' + id + ' fill:' + fill + ',stroke:' + strokeOf(fill) + ',color:' + NODE_TEXT;
// 表單認得的寫法：只有底色，或是這裡產生的「底色＋框線＋字色」；其他 style 行原樣保留
const NODE_STYLE = /^style\s+(\S+)\s+fill:(#[0-9a-fA-F]{6})(,stroke:#[0-9a-fA-F]{6},color:#[0-9a-fA-F]{6})?$/;

const flowchart: DiagramKind = {
  id: 'flowchart', name: '流程圖', icon: 'workflow', head: /^(flowchart|graph)\b/, template: template('流程圖'),
  parse(src) {
    const f = parseFlowchart(src);
    if (!f.ok) return f.reason === 'notFlowchart' ? 'unknownKind' : f.reason;
    const m = emptyModel();
    for (const line of String(src).replace(/\r\n?/g, '\n').split('\n')) {
      if (!line.trim()) continue;
      if (!/^\s*%%/.test(line)) break;
      m.pre.push(line.trim());
    }
    m.opts = { keyword: f.keyword, dir: f.dir };
    m.lists.nodes = f.nodes.map(n => ({ id: n.id, text: n.text == null ? '' : n.text, shape: n.shape || 'rect', fill: '' }));
    // len（連線加長幾級）沒有對應的欄位，只是跟著這一列保留下來：以前讀進來就丟掉，---> 寫回去變成 -->，節點的層次就變了
    m.lists.edges = f.edges.map(e => ({ from: e.from, style: e.style, to: e.to, text: e.text || '', len: e.len ? String(e.len) : '' }));
    for (const line of f.extra) {
      const x = NODE_STYLE.exec(line);
      const node = x ? m.lists.nodes.find(n => n.id === x[1]) : undefined;
      const fill = x ? x[2].toLowerCase() : '';
      if (node && !node.fill && (!x![3] || line === styleOf(node.id, fill))) node.fill = fill;
      else m.extra.push(line);
    }
    return m;
  },
  generate(m) {
    return [...m.pre, generateFlowchart({
      keyword: m.opts.keyword, dir: m.opts.dir,
      nodes: m.lists.nodes.map(r => ({ id: r.id, text: r.text, shape: r.shape })),
      edges: m.lists.edges.map(r => ({ from: r.from, to: r.to, text: r.text, style: r.style, len: +r.len || 0 })),
      extra: [...m.lists.nodes.filter(r => /^#[0-9a-f]{6}$/.test(r.fill || '')).map(r => styleOf(r.id, r.fill)), ...m.extra],
    })].join('\n');
  },
  opts: [{ kind: 'select', key: 'dir', label: '方向', options: fixed(DIRECTIONS) }],
  lists: [
    {
      key: 'nodes', title: '步驟（節點）', add: '＋ 新增步驟',
      fields: [
        { kind: 'text', key: 'text', label: '步驟的文字', placeholder: '步驟的文字', size: 'l', multiline: true },
        { kind: 'select', key: 'shape', label: '形狀', options: fixed(SHAPES.map(s => [s[0], s[1]] as const)) },
        { kind: 'color', key: 'fill', label: '底色', colors: NODE_FILLS },
      ],
      make: (m, tr) => ({ id: flowId(m), text: tr('新步驟'), shape: 'rect', fill: '' }),
      actions: [{
        icon: 'corner-down-right', label: '新增下一步（接在這個步驟後面）',
        run(m, row, tr) {
          const next: Row = { id: flowId(m), text: tr('新步驟'), shape: 'rect', fill: '' };
          m.lists.nodes.push(next);
          m.lists.edges.push({ from: row.id, style: 'arrow', to: next.id, text: '' });
          return next;
        },
      }],
      onDelete(m, row) { m.lists.edges = m.lists.edges.filter(e => e.from !== row.id && e.to !== row.id); },
    },
    {
      key: 'edges', title: '連線', add: '＋ 新增連線', rowClass: 'wm-mmd-edge',
      fields: [
        { kind: 'select', key: 'from', label: '從', options: flowNodes },
        { kind: 'select', key: 'style', label: '線的樣式', options: fixed(LINKS.map(l => [l[0], l[1]] as const)), size: 's' },
        { kind: 'select', key: 'to', label: '到', options: flowNodes },
        { kind: 'text', key: 'text', label: '線上的文字', placeholder: '線上的文字（可不填）' },
      ],
      make(m) {
        const n = m.lists.nodes;
        return { from: n.length ? n[Math.max(0, n.length - 2)].id : '', style: 'arrow', to: n.length ? n[n.length - 1].id : '', text: '' };
      },
    },
  ],
};
// 新節點的代號：N1、N2…（避開已經用過的）
function flowId(m: DiagramModel): string {
  const used = new Set(m.lists.nodes.map(r => r.id));
  let i = m.lists.nodes.length + 1;
  while (used.has('N' + i)) i++;
  return 'N' + i;
}
// 連線選單裡的節點名稱：文字（代號）
function flowNodes(m: DiagramModel): Choice[] {
  return m.lists.nodes.map(r => [r.id, r.text && r.text !== r.id ? r.text.split('\n')[0] + '（' + r.id + '）' : r.id]);
}

// ---------------------------------------------------------------- 循序圖

// 訊息的箭頭，以及三種備註（備註跟訊息排在同一個清單裡，順序才對）
const SEQUENCE_ARROWS: [string, I18nKey][] = [
  ['->>', '實線箭頭'], ['-->>', '虛線箭頭（回覆）'], ['->', '實線（沒有箭頭）'], ['-->', '虛線（沒有箭頭）'],
  ['-x', '實線，結尾打叉'], ['--x', '虛線，結尾打叉'], ['-)', '非同步'], ['--)', '非同步（虛線）'],
  ['note-right', '備註（在右邊）'], ['note-left', '備註（在左邊）'], ['note-over', '備註（跨在上面）'],
];
const SEQ_MESSAGE = /^(.+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([^:]+?)\s*:\s*(.*)$/;
const sequence: DiagramKind = {
  id: 'sequence', name: '循序圖', icon: 'arrow-left-right', head: /^sequenceDiagram\s*$/, template: template('循序圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const people: Row[] = []; const steps: Row[] = [];
    const person = (name: string) => ensure(people, name, n => ({ name: n, type: 'participant', alias: '' }));
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if (/^autonumber$/.test(text)) { m.opts.autonumber = '1'; continue; }
      if ((x = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/.exec(text))) {
        if (people.some(r => r.name === x![2])) return 'syntax';
        people.push({ name: x[2], type: x[1], alias: x[3] || '' });
        continue;
      }
      if ((x = /^note\s+(right of|left of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(text))) {
        const who = x[2].split(',').map(v => v.trim()).filter(Boolean);
        const side = x[1].toLowerCase();
        if (!who.length || who.length > 2 || (side !== 'over' && who.length > 1)) return 'syntax';
        who.forEach(person);
        steps.push({ from: who[0], arrow: side === 'over' ? 'note-over' : side === 'right of' ? 'note-right' : 'note-left', to: who[1] || who[0], text: x[3] });
        continue;
      }
      if (/^(loop|alt|else|opt|par|and|end|rect|critical|option|break|activate|deactivate|box|create|destroy|links?|title|accTitle|accDescr)(\s|$)/.test(text)) return 'blocks';
      if ((x = SEQ_MESSAGE.exec(text))) {
        if (/^[+-]/.test(x[3])) return 'blocks'; // A->>+B：啟動條的簡寫
        person(x[1]); person(x[3]);
        steps.push({ from: x[1], arrow: x[2], to: x[3], text: x[4] });
        continue;
      }
      return 'syntax';
    }
    m.lists.people = people; m.lists.steps = steps;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    if (m.opts.autonumber) out.push(INDENT + 'autonumber');
    for (const p of m.lists.people) if (one(p.name)) out.push(INDENT + (p.type === 'actor' ? 'actor ' : 'participant ') + one(p.name) + (one(p.alias) ? ' as ' + one(p.alias) : ''));
    for (const r of m.lists.steps) {
      if (!one(r.from)) continue;
      if (r.arrow === 'note-over') out.push(INDENT + 'Note over ' + one(r.from) + (one(r.to) && r.to !== r.from ? ',' + one(r.to) : '') + ': ' + one(r.text));
      else if (r.arrow === 'note-right' || r.arrow === 'note-left') out.push(INDENT + 'Note ' + (r.arrow === 'note-right' ? 'right' : 'left') + ' of ' + one(r.from) + ': ' + one(r.text));
      else if (one(r.to)) out.push(INDENT + one(r.from) + r.arrow + one(r.to) + ': ' + one(r.text));
    }
    return join(m, 'sequenceDiagram', out);
  },
  opts: [{ kind: 'check', key: 'autonumber', label: '訊息自動編號' }],
  lists: [
    {
      key: 'people', title: '參與者', add: '＋ 新增參與者',
      fields: [
        { kind: 'text', key: 'name', label: '名稱', placeholder: '名稱', group: 'person', def: true },
        { kind: 'select', key: 'type', label: '外觀', options: fixed([['participant', '方框'], ['actor', '人形']]), size: 's' },
        { kind: 'text', key: 'alias', label: '顯示的文字', placeholder: '顯示的文字（可不填）' },
      ],
      make: (m, tr) => ({ name: unique(m.lists.people, tr('參與者')), type: 'participant', alias: '' }),
      onDelete(m, row) { m.lists.steps = m.lists.steps.filter(r => r.from !== row.name && r.to !== row.name); },
    },
    {
      key: 'steps', title: '訊息與備註（由上到下）', add: '＋ 新增訊息',
      fields: [
        { kind: 'select', key: 'from', label: '從', options: names('people'), group: 'person' },
        { kind: 'select', key: 'arrow', label: '箭頭或備註', options: fixed(SEQUENCE_ARROWS) },
        { kind: 'select', key: 'to', label: '到', options: names('people'), group: 'person' },
        { kind: 'text', key: 'text', label: '文字', placeholder: '訊息或備註的文字', size: 'l' },
      ],
      make(m, tr) {
        const p = m.lists.people;
        return { from: p.length ? p[0].name : '', arrow: '->>', to: p.length ? p[Math.min(1, p.length - 1)].name : '', text: tr('新訊息') };
      },
    },
  ],
};
// 不重複的新名稱：「參與者」「參與者 2」「參與者 3」…
function unique(rows: Row[], base: string, key = 'name'): string {
  const used = new Set(rows.map(r => r[key]));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(base + ' ' + i)) i++;
  return base + ' ' + i;
}

// ---------------------------------------------------------------- 甘特圖

const GANTT_STATUS: [string, I18nKey][] = [
  ['', '一般'], ['done', '已完成'], ['active', '進行中'], ['crit', '重要'], ['milestone', '里程碑'],
  ['crit, done', '重要、已完成'], ['crit, active', '重要、進行中'],
];
const GANTT_TAGS = new Set(['done', 'active', 'crit', 'milestone']);
const GANTT_KEEP = /^(axisFormat|tickInterval|excludes|includes|todayMarker|weekday|inclusiveEndDates|topAxis)(\s|$)/;
const gantt: DiagramKind = {
  id: 'gantt', name: '甘特圖', icon: 'gantt-chart', head: /^gantt\s*$/, template: template('甘特圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const tasks: Row[] = [];
    let section = '';
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text) || GANTT_KEEP.test(text)) { m.extra.push(text); continue; }
      if ((x = /^title\s+(.*)$/.exec(text))) { m.opts.title = x[1]; continue; }
      if ((x = /^dateFormat\s+(.*)$/.exec(text))) { m.opts.dateFormat = x[1]; continue; }
      if ((x = /^section\s+(.*)$/.exec(text))) { section = x[1]; continue; }
      if (/^(click|accTitle|accDescr)(\s|$)/.test(text)) return 'blocks';
      if (!(x = /^(.+?)\s*:\s*(.*)$/.exec(text))) return 'syntax';
      const parts = x[2].split(',').map(v => v.trim()).filter(Boolean);
      const tags: string[] = [];
      while (parts.length && GANTT_TAGS.has(parts[0])) tags.push(parts.shift()!);
      const status = tags.join(', ');
      if (!parts.length || parts.length > 3 || !GANTT_STATUS.some(g => g[0] === status)) return 'syntax';
      const row: Row = { name: x[1], section, status, id: '', start: '', end: '' };
      if (parts.length === 3) [row.id, row.start, row.end] = parts;
      else if (parts.length === 2) [row.start, row.end] = parts;
      else row.end = parts[0];
      tasks.push(row);
    }
    m.lists.tasks = tasks;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    if (one(m.opts.title)) out.push(INDENT + 'title ' + one(m.opts.title));
    if (one(m.opts.dateFormat)) out.push(INDENT + 'dateFormat ' + one(m.opts.dateFormat));
    const body: string[] = [];
    let section = '';
    for (const r of m.lists.tasks) {
      if (!one(r.name)) continue;
      if (one(r.section) !== section) { section = one(r.section); if (section) body.push(INDENT + 'section ' + section); }
      // 有代號時一定要有開始日期（只寫兩項的話 Mermaid 會把代號當成開始日期）
      const meta = [r.status, one(r.start) ? one(r.id) : '', one(r.start), one(r.end) || '1d'].filter(Boolean);
      body.push(INDENT + one(r.name).replace(/:/g, '：') + ' :' + meta.join(', '));
    }
    return [...m.pre, 'gantt', ...out, ...m.extra.map(x => INDENT + x), ...body].join('\n');
  },
  opts: [
    { kind: 'text', key: 'title', label: '標題', placeholder: '圖表的標題（可不填）', size: 'l' },
    { kind: 'text', key: 'dateFormat', label: '日期格式', placeholder: 'YYYY-MM-DD', size: 's' },
  ],
  lists: [{
    key: 'tasks', title: '工作', add: '＋ 新增工作', hint: '開始可以填日期，或「after 代號」接在另一項工作後面；留白表示接在上一項後面。長度例如 5d、2w，也可以填結束日期。',
    fields: [
      { kind: 'text', key: 'name', label: '工作名稱', placeholder: '工作名稱', size: 'l' },
      { kind: 'text', key: 'section', label: '區段', placeholder: '區段（可不填）', group: 'section', suggest: m => [...new Set(m.lists.tasks.map(r => r.section).filter(Boolean))] },
      { kind: 'select', key: 'status', label: '狀態', options: fixed(GANTT_STATUS), size: 's' },
      { kind: 'text', key: 'id', label: '代號', placeholder: '代號', size: 'xs' },
      { kind: 'text', key: 'start', label: '開始', placeholder: '開始', size: 's' },
      { kind: 'text', key: 'end', label: '長度或結束日期', placeholder: '長度', size: 'xs' },
    ],
    make(m, tr) {
      const last = m.lists.tasks[m.lists.tasks.length - 1];
      return { name: tr('新工作'), section: last ? last.section : '', status: '', id: '', start: '', end: '3d' };
    },
  }],
};

// ---------------------------------------------------------------- 圓餅圖

const pie: DiagramKind = {
  id: 'pie', name: '圓餅圖', icon: 'pie-chart', head: /^pie(\s+showData)?(?:\s+title\s+(.*))?\s*$/, template: template('圓餅圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    if (s.head[1]) m.opts.showData = '1';
    if (s.head[2]) m.opts.title = s.head[2].trim();
    const slices: Row[] = [];
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if (/^showData$/.test(text)) { m.opts.showData = '1'; continue; }
      if ((x = /^title\s+(.*)$/.exec(text))) { m.opts.title = x[1]; continue; }
      if (!(x = /^"([^"]*)"\s*:\s*(\d+(?:\.\d+)?)$/.exec(text))) return 'syntax';
      slices.push({ label: x[1], value: x[2] });
    }
    m.lists.slices = slices;
    return m;
  },
  generate(m) {
    const head = 'pie' + (m.opts.showData ? ' showData' : '') + (one(m.opts.title) ? ' title ' + one(m.opts.title) : '');
    const body = m.lists.slices.filter(r => one(r.label)).map(r => INDENT + '"' + one(r.label).replace(/"/g, '\'') + '" : ' + (parseFloat(r.value) >= 0 ? String(parseFloat(r.value)) : '0'));
    return join(m, head, body);
  },
  opts: [
    { kind: 'text', key: 'title', label: '標題', placeholder: '圖表的標題（可不填）', size: 'l' },
    { kind: 'check', key: 'showData', label: '在圖例顯示數值' },
  ],
  lists: [{
    key: 'slices', title: '項目', add: '＋ 新增項目', hint: '數值填多少都可以，圖上會自動換算成百分比。',
    fields: [
      { kind: 'text', key: 'label', label: '項目名稱', placeholder: '項目名稱', size: 'l' },
      { kind: 'text', key: 'value', label: '數值', placeholder: '數值', size: 'xs' },
    ],
    make: (m, tr) => ({ label: unique(m.lists.slices, tr('新項目'), 'label'), value: '10' }),
  }],
};

// ---------------------------------------------------------------- 狀態圖

const STATE = '(\\[\\*\\]|[^\\s:]+)';
const stateNames = (m: DiagramModel): string[] => [...new Set(['[*]', ...m.lists.moves.flatMap(r => [r.from, r.to]), ...m.lists.states.map(r => r.name)].filter(Boolean))];
const state: DiagramKind = {
  id: 'state', name: '狀態圖', icon: 'circle-dot', head: /^stateDiagram(-v2)?\s*$/, template: template('狀態圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    m.opts.v2 = s.head[1] ? '1' : '';
    const moves: Row[] = []; const states: Row[] = [];
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if ((x = /^direction\s+(TB|TD|BT|RL|LR)$/.exec(text))) { m.opts.dir = x[1] === 'TD' ? 'TB' : x[1]; continue; }
      // 狀態:::樣式 是套用樣式的寫法。以前「A:::warn --> B」被讀成狀態 A 的說明文字「::warn --> B」，
      // 寫回去是「A : ::warn --> B」，轉換就不見了
      if (/:::/.test(text)) return 'blocks';
      if ((x = new RegExp('^' + STATE + '\\s*-->\\s*' + STATE + '(?:\\s*:\\s*(.*))?$').exec(text))) { moves.push({ from: x[1], to: x[2], text: x[3] || '' }); continue; }
      if ((x = /^state\s+"([^"]*)"\s+as\s+(\S+)$/.exec(text))) { states.push({ name: x[2], text: x[1] }); continue; }
      if (/^(?:(?:state|note|end note|classDef|class|style|accTitle|accDescr)(?:\s|$)|\}|--$)/.test(text) || /<<|\{$/.test(text)) return 'blocks';
      if ((x = /^([^\s:]+)\s*:\s*(.+)$/.exec(text))) { states.push({ name: x[1], text: x[2] }); continue; }
      return 'syntax';
    }
    m.lists.moves = moves; m.lists.states = states;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    if (m.opts.dir) out.push(INDENT + 'direction ' + m.opts.dir);
    for (const r of m.lists.states) if (one(r.name) && one(r.text)) out.push(INDENT + one(r.name) + ' : ' + one(r.text));
    for (const r of m.lists.moves) if (one(r.from) && one(r.to)) out.push(INDENT + one(r.from) + ' --> ' + one(r.to) + (one(r.text) ? ' : ' + one(r.text) : ''));
    return join(m, 'stateDiagram' + (m.opts.v2 ? '-v2' : ''), out);
  },
  opts: [{ kind: 'select', key: 'dir', label: '方向', options: fixed([['', '預設（由上到下）'], ['TB', '由上到下'], ['LR', '由左到右'], ['BT', '由下到上'], ['RL', '由右到左']]) }],
  lists: [
    {
      key: 'moves', title: '狀態的轉換', add: '＋ 新增轉換', hint: '直接輸入狀態的名稱（不能有空白）；用 [*] 代表開始或結束。',
      fields: [
        { kind: 'text', key: 'from', label: '從這個狀態', placeholder: '從', group: 'state', suggest: stateNames },
        { kind: 'text', key: 'to', label: '到這個狀態', placeholder: '到', group: 'state', suggest: stateNames },
        { kind: 'text', key: 'text', label: '線上的文字', placeholder: '線上的文字（可不填）' },
      ],
      make(m, tr) {
        const last = m.lists.moves[m.lists.moves.length - 1];
        return { from: last && last.to !== '[*]' ? last.to : tr('新狀態'), to: '[*]', text: '' };
      },
    },
    {
      key: 'states', title: '狀態的說明（可不填）', add: '＋ 新增說明',
      fields: [
        { kind: 'text', key: 'name', label: '狀態', placeholder: '狀態的名稱', group: 'state', suggest: stateNames },
        { kind: 'text', key: 'text', label: '顯示的文字', placeholder: '圖上顯示的文字', size: 'l' },
      ],
      make: m => ({ name: stateNames(m).find(n => n !== '[*]' && !m.lists.states.some(r => r.name === n)) || '', text: '' }),
    },
  ],
};

// ---------------------------------------------------------------- 類別圖

const CLASS_RELATIONS: [string, I18nKey][] = [
  ['<|--', '繼承'], ['*--', '組合'], ['o--', '聚合'], ['-->', '關聯'], ['--', '連結'], ['..>', '依賴'], ['..|>', '實作'], ['..', '虛線連結'],
  ['--|>', '繼承（方向相反）'], ['--*', '組合（方向相反）'], ['--o', '聚合（方向相反）'], ['<--', '關聯（方向相反）'], ['<..', '依賴（方向相反）'], ['<|..', '實作（方向相反）'],
];
const CLASS_REL = /^(\S+)\s+(?:"([^"]*)"\s+)?(<\|--|<\|\.\.|\*--|o--|-->|--\|>|\.\.\|>|--\*|--o|<--|\.\.>|<\.\.|--|\.\.)\s+(?:"([^"]*)"\s+)?(\S+)(?:\s*:\s*(.*))?$/;
// 關係的符號緊貼著類別名稱的寫法（Animal<|--Dog）。聚合的 o-- 與 --o 不在這裡：o 緊貼著名稱時分不出是不是名稱的一部分
const CLASS_REL_TIGHT = /^([^\s:<>|*."{}-]+)\s*(?:"([^"]*)"\s*)?(<\|--|<\|\.\.|\*--|-->|--\|>|\.\.\|>|--\*|<--|\.\.>|<\.\.|--|\.\.)\s*(?:"([^"]*)"\s*)?([^\s:<>|*."{}-]+)(?:\s*:\s*(.*))?$/;
// 類別名稱裡不會有關係的符號、冒號、引號與大括號。以前「名稱 : 成員」的寫法什麼都收，
// Animal<|--Dog : inherits 被讀成一個叫「Animal<|--Dog」的類別，成員是 inherits，寫回去整個關係就不見了
const classNameOk = (name: string): boolean => /^[^\s:<>|*."{}]+$/.test(name) && !name.includes('--');
const classDiagram: DiagramKind = {
  id: 'class', name: '類別圖', icon: 'boxes', head: /^classDiagram(-v2)?\s*$/, template: template('類別圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const classes: Row[] = []; const relations: Row[] = [];
    const cls = (name: string): Row => { ensure(classes, name, n => ({ name: n, members: '' })); return classes.find(r => r.name === name)!; };
    const member = (row: Row, line: string) => { row.members = row.members ? row.members + '\n' + line : line; };
    let open: Row | null = null;
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (open) { if (text === '}') open = null; else member(open, text); continue; }
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if ((x = /^direction\s+(TB|TD|BT|RL|LR)$/.exec(text))) { m.opts.dir = x[1] === 'TD' ? 'TB' : x[1]; continue; }
      if ((x = /^class\s+(\S+?)\s*\{$/.exec(text))) { if (!classNameOk(x[1])) return 'syntax'; open = cls(x[1]); continue; }
      // class 名稱:::樣式 是套用樣式的寫法
      if ((x = /^class\s+(\S+)$/.exec(text))) { if (!classNameOk(x[1])) return x[1].includes(':::') ? 'blocks' : 'syntax'; cls(x[1]); continue; }
      const spaced = CLASS_REL.exec(text);
      if ((x = spaced || CLASS_REL_TIGHT.exec(text))) {
        if (!classNameOk(x[1]) || !classNameOk(x[5])) return 'syntax';
        // 緊貼的寫法裡，-- 旁邊的名稱以 o 結尾或開頭（Zoo--Dog）：可能是聚合的 o--，分不出來就不猜
        if (!spaced && ((x[3].startsWith('--') && x[1].endsWith('o')) || (x[3].endsWith('--') && x[5].startsWith('o')))) return 'syntax';
        cls(x[1]); cls(x[5]);
        relations.push({ a: x[1], ca: x[2] || '', type: x[3], cb: x[4] || '', b: x[5], text: x[6] || '' });
        continue;
      }
      if (/^(?:(?:class|namespace|note|click|link|callback|style|cssClass|classDef|accTitle|accDescr)(?:\s|$)|<<)/.test(text)) return 'blocks';
      if ((x = /^(\S+)\s*:\s*(.+)$/.exec(text))) { if (!classNameOk(x[1])) return 'syntax'; member(cls(x[1]), x[2]); continue; }
      return 'syntax';
    }
    if (open) return 'syntax';
    m.lists.classes = classes; m.lists.relations = relations;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    if (m.opts.dir) out.push(INDENT + 'direction ' + m.opts.dir);
    for (const c of m.lists.classes) {
      const name = one(c.name).replace(/\s+/g, '_');
      if (!name) continue;
      const members = String(c.members || '').split('\n').map(v => v.trim()).filter(Boolean);
      if (!members.length) { out.push(INDENT + 'class ' + name); continue; }
      out.push(INDENT + 'class ' + name + ' {', ...members.map(v => INDENT + INDENT + v), INDENT + '}');
    }
    const q = (v: string) => (one(v) ? '"' + one(v).replace(/"/g, '\'') + '" ' : '');
    for (const r of m.lists.relations) {
      if (!one(r.a) || !one(r.b)) continue;
      out.push(INDENT + one(r.a).replace(/\s+/g, '_') + ' ' + q(r.ca) + r.type + ' ' + q(r.cb) + one(r.b).replace(/\s+/g, '_') + (one(r.text) ? ' : ' + one(r.text) : ''));
    }
    return join(m, 'classDiagram', out);
  },
  opts: [{ kind: 'select', key: 'dir', label: '方向', options: fixed([['', '預設（由上到下）'], ['TB', '由上到下'], ['LR', '由左到右'], ['BT', '由下到上'], ['RL', '由右到左']]) }],
  lists: [
    {
      key: 'classes', title: '類別', add: '＋ 新增類別',
      fields: [
        { kind: 'text', key: 'name', label: '類別名稱', placeholder: '類別名稱', group: 'class', def: true },
        { kind: 'lines', key: 'members', label: '屬性與方法', placeholder: '一行一個，例如：\n+名稱\n+計算()' },
      ],
      make: (m, tr) => ({ name: unique(m.lists.classes, tr('新類別')).replace(/\s+/g, '_'), members: '' }),
      onDelete(m, row) { m.lists.relations = m.lists.relations.filter(r => r.a !== row.name && r.b !== row.name); },
    },
    {
      key: 'relations', title: '關係', add: '＋ 新增關係', hint: '數量可以填 1、*、0..1 等，寫在線的兩端；不需要就留白。',
      fields: [
        { kind: 'select', key: 'a', label: '類別', options: names('classes'), group: 'class' },
        { kind: 'text', key: 'ca', label: '數量', placeholder: '數量', size: 'xs' },
        { kind: 'select', key: 'type', label: '關係', options: (_m, tr) => CLASS_RELATIONS.map(([v, label]) => [v, tr(label) + '  ' + v]) },
        { kind: 'text', key: 'cb', label: '數量', placeholder: '數量', size: 'xs' },
        { kind: 'select', key: 'b', label: '類別', options: names('classes'), group: 'class' },
        { kind: 'text', key: 'text', label: '線上的文字', placeholder: '線上的文字（可不填）' },
      ],
      make(m) {
        const c = m.lists.classes;
        return { a: c.length ? c[0].name : '', ca: '', type: '-->', cb: '', b: c.length ? c[Math.min(1, c.length - 1)].name : '', text: '' };
      },
    },
  ],
};

// ---------------------------------------------------------------- 心智圖

// 形狀：[代號, 名稱, 開頭符號, 結尾符號]（解析時依這個順序比對）
const MIND_SHAPES: [string, I18nKey, string, string][] = [
  ['default', '一般', '', ''],
  ['circle', '圓形', '((', '))'],
  ['bang', '爆炸形', '))', '(('],
  ['cloud', '雲朵', ')', '('],
  ['hexagon', '六角形', '{{', '}}'],
  ['square', '方形', '[', ']'],
  ['round', '圓角', '(', ')'],
];
const MIND_RE: [string, RegExp][] = [
  ['circle', /^([^\s()[\]{}]*)\(\((.*)\)\)$/], ['bang', /^([^\s()[\]{}]*)\)\)(.*)\(\($/], ['cloud', /^([^\s()[\]{}]*)\)(.*)\($/],
  ['hexagon', /^([^\s()[\]{}]*)\{\{(.*)\}\}$/], ['square', /^([^\s()[\]{}]*)\[(.*)\]$/], ['round', /^([^\s()[\]{}]*)\((.*)\)$/],
];
const mindmap: DiagramKind = {
  id: 'mindmap', name: '心智圖', icon: 'network', head: /^mindmap\s*$/, template: template('心智圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const nodes: Row[] = [];
    const stack: number[] = [];
    for (const { raw, text } of s.body) {
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if (/^::/.test(text) || /`/.test(text)) return 'blocks'; // 圖示、樣式、Markdown 文字
      const indent = /^\s*/.exec(raw)![0].replace(/\t/g, '    ').length;
      while (stack.length && indent <= stack[stack.length - 1]) stack.pop();
      const level = stack.length;
      stack.push(indent);
      if (level === 0 && nodes.length) return 'syntax'; // 只能有一個中心主題
      let row: Row = { level: String(level), text: unquote(text), shape: 'default', id: '' };
      for (const [shape, re] of MIND_RE) {
        const x = re.exec(text);
        if (x) { row = { level: String(level), text: unquote(x[2]), shape, id: x[1] }; break; }
      }
      nodes.push(row);
    }
    if (!nodes.length) return 'syntax';
    m.lists.nodes = nodes;
    return m;
  },
  generate(m) {
    const body = m.lists.nodes.map(r => {
      const shape = MIND_SHAPES.find(x => x[0] === r.shape) || MIND_SHAPES[0];
      const text = one(r.text) || '?';
      return '  '.repeat(+r.level + 1) + (shape[0] === 'default' ? text : (r.id || '') + shape[2] + text + shape[3]);
    });
    return [...m.pre, 'mindmap', ...m.extra.map(x => '  ' + x), ...body].join('\n');
  },
  // 階層：第一個是中心主題（0），其他至少是 1，而且不能比上一個多兩層以上
  fix(m) {
    let prev = -1;
    m.lists.nodes.forEach((r, i) => {
      let level = Math.max(0, Math.floor(+r.level) || 0);
      level = i === 0 ? 0 : Math.max(1, Math.min(level, prev + 1));
      r.level = String(level);
      prev = level;
    });
  },
  opts: [],
  lists: [{
    key: 'nodes', title: '主題與分支', add: '＋ 新增分支', fixedFirst: true, hint: '第一個是中心主題。用左右箭頭調整分支的階層，用上下箭頭調整順序。',
    fields: [
      { kind: 'level', key: 'level', label: '階層' },
      { kind: 'text', key: 'text', label: '文字', placeholder: '主題或分支的文字', size: 'l' },
      { kind: 'select', key: 'shape', label: '形狀', options: fixed(MIND_SHAPES.map(x => [x[0], x[1]] as const)), size: 's' },
    ],
    make: (_m, tr) => ({ level: '1', text: tr('新分支'), shape: 'default', id: '' }),
    actions: [{
      icon: 'corner-down-right', label: '新增子分支（接在這個分支下面）',
      run(m, row, tr) {
        const next: Row = { level: String(+row.level + 1), text: tr('新分支'), shape: 'default', id: '' };
        m.lists.nodes.splice(m.lists.nodes.indexOf(row) + 1, 0, next);
        return next;
      },
    }],
  }],
};

// ---------------------------------------------------------------- 時間軸

const timeline: DiagramKind = {
  id: 'timeline', name: '時間軸', icon: 'milestone', head: /^timeline\s*$/, template: template('時間軸'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const periods: Row[] = [];
    let section = '';
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if ((x = /^title\s+(.*)$/.exec(text))) { m.opts.title = x[1]; continue; }
      if ((x = /^section\s+(.*)$/.exec(text))) { section = x[1]; continue; }
      if (/^(accTitle|accDescr)(\s|$)/.test(text)) return 'blocks';
      const parts = text.split(':').map(v => v.trim());
      if (!parts[0]) {
        // 開頭是冒號：接在上一個時間點後面的事件
        const last = periods[periods.length - 1];
        if (!last) return 'syntax';
        last.events = [last.events, ...parts.slice(1)].filter(Boolean).join('\n');
        continue;
      }
      periods.push({ section, time: parts[0], events: parts.slice(1).filter(Boolean).join('\n') });
    }
    m.lists.periods = periods;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    if (one(m.opts.title)) out.push(INDENT + 'title ' + one(m.opts.title));
    let section = '';
    for (const r of m.lists.periods) {
      const time = one(r.time).replace(/:/g, '：');
      if (!time) continue;
      if (one(r.section) !== section) { section = one(r.section); if (section) out.push(INDENT + 'section ' + section); }
      const events = String(r.events || '').split('\n').map(v => v.trim().replace(/:/g, '：')).filter(Boolean);
      out.push(INDENT + [time, ...events].join(' : '));
    }
    return join(m, 'timeline', out);
  },
  opts: [{ kind: 'text', key: 'title', label: '標題', placeholder: '圖表的標題（可不填）', size: 'l' }],
  lists: [{
    key: 'periods', title: '時間點', add: '＋ 新增時間點',
    fields: [
      { kind: 'text', key: 'time', label: '時間', placeholder: '時間，例如 2026', size: 's' },
      { kind: 'lines', key: 'events', label: '事件', placeholder: '事件（一行一件）' },
      { kind: 'text', key: 'section', label: '區段', placeholder: '區段（可不填）', size: 's', group: 'section', suggest: m => [...new Set(m.lists.periods.map(r => r.section).filter(Boolean))] },
    ],
    make(m, tr) {
      const last = m.lists.periods[m.lists.periods.length - 1];
      return { section: last ? last.section : '', time: tr('新時間點'), events: tr('事件') };
    },
  }],
};

// ---------------------------------------------------------------- ER 圖

const ER_LEFT: [string, I18nKey][] = [['||', '剛好一個'], ['|o', '零或一個'], ['}o', '零或多個'], ['}|', '一個或多個']];
const ER_RIGHT: [string, I18nKey][] = [['||', '剛好一個'], ['o|', '零或一個'], ['o{', '零或多個'], ['|{', '一個或多個']];
// 實體名稱：英數字可以直接寫，其他（中文、有空白）要加引號
const ER_NAME = '("[^"]+"|[^\\s"{]+)';
const ER_REL = new RegExp('^' + ER_NAME + '\\s+(\\|o|\\|\\||\\}o|\\}\\|)(--|\\.\\.)(o\\||\\|\\||o\\{|\\|\\{)\\s+' + ER_NAME + '\\s*:\\s*(.+)$');
const ER_BLOCK = new RegExp('^' + ER_NAME + '\\s*\\{$');
const ER_ALONE = new RegExp('^' + ER_NAME + '$');
// 寫回程式碼時：不是單純英數字的名稱加上引號（Mermaid 的規定）
const erName = (v: string): string => { const s = one(v); return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) ? s : '"' + s.replace(/"/g, '\'') + '"'; };
const er: DiagramKind = {
  id: 'er', name: 'ER 圖', icon: 'database', head: /^erDiagram\s*$/, template: template('ER 圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const entities: Row[] = []; const relations: Row[] = [];
    const entity = (name: string): Row => { ensure(entities, name, n => ({ name: n, attrs: '' })); return entities.find(r => r.name === name)!; };
    let open: Row | null = null;
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (open) { if (text === '}') open = null; else open.attrs = open.attrs ? open.attrs + '\n' + text : text; continue; }
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if ((x = ER_BLOCK.exec(text))) { open = entity(unquote(x[1])); continue; }
      if ((x = ER_REL.exec(text))) {
        const a = unquote(x[1]); const b = unquote(x[5]);
        entity(a); entity(b);
        relations.push({ a, left: x[2], line: x[3], right: x[4], b, text: unquote(x[6]) });
        continue;
      }
      if (/^(style|classDef|class|direction|accTitle|accDescr)(\s|$)/.test(text)) return 'blocks';
      if ((x = ER_ALONE.exec(text))) { entity(unquote(x[1])); continue; }
      return 'syntax';
    }
    if (open) return 'syntax';
    m.lists.entities = entities; m.lists.relations = relations;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    for (const r of m.lists.relations) {
      if (!one(r.a) || !one(r.b)) continue;
      const label = one(r.text);
      // 關係的說明也一樣：不是英數字就加引號
      out.push(INDENT + erName(r.a) + ' ' + r.left + (r.line || '--') + r.right + ' ' + erName(r.b) + ' : ' + (/^[A-Za-z0-9_-]+$/.test(label) ? label : '"' + label.replace(/"/g, '\'') + '"'));
    }
    const used = new Set(m.lists.relations.flatMap(r => [r.a, r.b]));
    for (const e of m.lists.entities) {
      if (!one(e.name)) continue;
      const attrs = String(e.attrs || '').split('\n').map(v => v.trim()).filter(Boolean);
      if (attrs.length) out.push(INDENT + erName(e.name) + ' {', ...attrs.map(v => INDENT + INDENT + v), INDENT + '}');
      else if (!used.has(e.name)) out.push(INDENT + erName(e.name));
    }
    return join(m, 'erDiagram', out);
  },
  opts: [],
  lists: [
    {
      key: 'entities', title: '實體（資料表）', add: '＋ 新增實體', hint: '欄位的型別與名稱只能用英文、數字與底線（Mermaid 的規定）；中文的說明寫在後面的引號裡。',
      fields: [
        { kind: 'text', key: 'name', label: '實體名稱', placeholder: '實體名稱', group: 'entity', def: true },
        { kind: 'lines', key: 'attrs', label: '欄位', placeholder: '一行一個欄位：型別 名稱 "說明"，例如：\nstring name "姓名"\nint age PK' },
      ],
      make: (m, tr) => ({ name: unique(m.lists.entities, tr('新實體')), attrs: '' }),
      onDelete(m, row) { m.lists.relations = m.lists.relations.filter(r => r.a !== row.name && r.b !== row.name); },
    },
    {
      key: 'relations', title: '關係', add: '＋ 新增關係', hint: '例如「客戶（剛好一個）— 訂單（零或多個）」表示一個客戶可以有很多張訂單。',
      fields: [
        { kind: 'select', key: 'a', label: '實體', options: names('entities'), group: 'entity' },
        { kind: 'select', key: 'left', label: '這一邊有幾個', options: fixed(ER_LEFT), size: 's' },
        { kind: 'select', key: 'right', label: '另一邊有幾個', options: fixed(ER_RIGHT), size: 's' },
        { kind: 'select', key: 'b', label: '實體', options: names('entities'), group: 'entity' },
        { kind: 'text', key: 'text', label: '關係的說明', placeholder: '關係的說明，例如：下單' },
      ],
      make(m, tr) {
        const e = m.lists.entities;
        return { a: e.length ? e[0].name : '', left: '||', line: '--', right: 'o{', b: e.length ? e[Math.min(1, e.length - 1)].name : '', text: tr('關係') };
      },
    },
  ],
};

// ---------------------------------------------------------------- 旅程圖

const journey: DiagramKind = {
  id: 'journey', name: '旅程圖', icon: 'map', head: /^journey\s*$/, template: template('旅程圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const steps: Row[] = [];
    let section = '';
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if ((x = /^title\s+(.*)$/.exec(text))) { m.opts.title = x[1]; continue; }
      if ((x = /^section\s+(.*)$/.exec(text))) { section = x[1]; continue; }
      if (/^(accTitle|accDescr)(\s|$)/.test(text)) return 'blocks';
      // 步驟：名稱: 分數（1～5）: 參與的人（可不寫）
      if (!(x = /^([^:]+?)\s*:\s*([1-5])\s*(?::\s*(.*))?$/.exec(text))) return 'syntax';
      steps.push({ section, name: x[1], score: x[2], actors: (x[3] || '').split(',').map(v => v.trim()).filter(Boolean).join(', ') });
    }
    m.lists.steps = steps;
    return m;
  },
  generate(m) {
    const out: string[] = [];
    if (one(m.opts.title)) out.push(INDENT + 'title ' + one(m.opts.title));
    let section = '';
    for (const r of m.lists.steps) {
      const name = one(r.name).replace(/:/g, '：');
      if (!name) continue;
      if (one(r.section) !== section) { section = one(r.section); if (section) out.push(INDENT + 'section ' + section); }
      const actors = one(r.actors).replace(/:/g, '：');
      out.push(INDENT + '  ' + name + ': ' + (/^[1-5]$/.test(r.score) ? r.score : '3') + (actors ? ': ' + actors : ''));
    }
    return join(m, 'journey', out);
  },
  opts: [{ kind: 'text', key: 'title', label: '標題', placeholder: '圖表的標題（可不填）', size: 'l' }],
  lists: [{
    key: 'steps', title: '步驟', add: '＋ 新增步驟', hint: '感受從 1（最糟）到 5（最好）。參與的人用逗號分開。',
    fields: [
      { kind: 'text', key: 'name', label: '步驟', placeholder: '做了什麼', size: 'l' },
      { kind: 'select', key: 'score', label: '感受', options: (_m, tr) => [['1', '1 ' + tr('（最糟）')], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 ' + tr('（最好）')]], size: 's' },
      { kind: 'text', key: 'actors', label: '參與的人', placeholder: '參與的人' },
      { kind: 'text', key: 'section', label: '區段', placeholder: '區段（可不填）', size: 's', group: 'section', suggest: m => [...new Set(m.lists.steps.map(r => r.section).filter(Boolean))] },
    ],
    make(m, tr) {
      const last = m.lists.steps[m.lists.steps.length - 1];
      return { section: last ? last.section : '', name: tr('新步驟'), score: '3', actors: last ? last.actors : '' };
    },
  }],
};

// ---------------------------------------------------------------- 象限圖

// Mermaid 規定：座標軸、象限、點的名稱只要不是英數字就要加引號（標題不用），所以一律加
const quoted = (v: string): string => '"' + one(v).replace(/"/g, '\'') + '"';
const QUAD_TEXT = '("[^"]*"|[^"\\s][^"]*?)';
const QUAD_AXIS = new RegExp('^([xy])-axis\\s+' + QUAD_TEXT + '(?:\\s*-->\\s*' + QUAD_TEXT + ')?$');
const QUAD_POINT = new RegExp('^' + QUAD_TEXT + '\\s*:\\s*\\[\\s*(\\d*\\.?\\d+)\\s*,\\s*(\\d*\\.?\\d+)\\s*\\]$');
const unit = (v: string): string => { const n = parseFloat(v); return String(n >= 0 && n <= 1 ? n : 0.5); };
const quadrant: DiagramKind = {
  id: 'quadrant', name: '象限圖', icon: 'layout-grid', head: /^quadrantChart\s*$/, template: template('象限圖'),
  parse(src) {
    const s = split(src, this.head);
    if (!s) return 'unknownKind';
    const m = emptyModel();
    m.pre = s.pre;
    const points: Row[] = [];
    for (const { text } of s.body) {
      let x: RegExpExecArray | null;
      if (/^%%/.test(text)) { m.extra.push(text); continue; }
      if ((x = /^title\s+(.*)$/.exec(text))) { m.opts.title = x[1]; continue; }
      if ((x = QUAD_AXIS.exec(text))) { m.opts[x[1] + '1'] = unquote(x[2]); m.opts[x[1] + '2'] = x[3] ? unquote(x[3]) : ''; continue; }
      if ((x = /^quadrant-([1-4])\s+(.+)$/.exec(text))) { m.opts['q' + x[1]] = unquote(x[2]); continue; }
      if (/^(classDef|accTitle|accDescr)(\s|$)/.test(text)) return 'blocks';
      if (!(x = QUAD_POINT.exec(text))) return 'syntax';
      points.push({ name: unquote(x[1]), x: String(parseFloat(x[2])), y: String(parseFloat(x[3])) });
    }
    m.lists.points = points;
    return m;
  },
  generate(m) {
    const o = m.opts;
    const out: string[] = [];
    if (one(o.title)) out.push(INDENT + 'title ' + one(o.title));
    for (const a of ['x', 'y']) if (one(o[a + '1'])) out.push(INDENT + a + '-axis ' + quoted(o[a + '1']) + (one(o[a + '2']) ? ' --> ' + quoted(o[a + '2']) : ''));
    for (const n of ['1', '2', '3', '4']) if (one(o['q' + n])) out.push(INDENT + 'quadrant-' + n + ' ' + quoted(o['q' + n]));
    for (const r of m.lists.points) if (one(r.name)) out.push(INDENT + quoted(r.name) + ': [' + unit(r.x) + ', ' + unit(r.y) + ']');
    return join(m, 'quadrantChart', out);
  },
  opts: [
    { kind: 'text', key: 'title', label: '標題', placeholder: '圖表的標題（可不填）', size: 'l' },
    { kind: 'text', key: 'x1', label: '橫軸（左）', size: 's' }, { kind: 'text', key: 'x2', label: '橫軸（右）', size: 's' },
    { kind: 'text', key: 'y1', label: '縱軸（下）', size: 's' }, { kind: 'text', key: 'y2', label: '縱軸（上）', size: 's' },
    { kind: 'text', key: 'q1', label: '右上的象限', size: 's' }, { kind: 'text', key: 'q2', label: '左上的象限', size: 's' },
    { kind: 'text', key: 'q3', label: '左下的象限', size: 's' }, { kind: 'text', key: 'q4', label: '右下的象限', size: 's' },
  ],
  lists: [{
    key: 'points', title: '項目', add: '＋ 新增項目', hint: '位置是 0 到 1 的數字：橫向 0 在最左、1 在最右；縱向 0 在最下、1 在最上。',
    fields: [
      { kind: 'text', key: 'name', label: '項目名稱', placeholder: '項目名稱', size: 'l' },
      { kind: 'text', key: 'x', label: '橫向的位置', placeholder: '0–1', size: 'xs' },
      { kind: 'text', key: 'y', label: '縱向的位置', placeholder: '0–1', size: 'xs' },
    ],
    make: (m, tr) => ({ name: unique(m.lists.points, tr('新項目')), x: '0.5', y: '0.5' }),
  }],
};

// ---------------------------------------------------------------- 對外的函式

// 所有能用表單編輯的圖表種類（順序也是範本列的順序）
export const DIAGRAM_KINDS: readonly DiagramKind[] = [flowchart, sequence, gantt, pie, state, classDiagram, mindmap, timeline, er, journey, quadrant];

// 圖表的外觀（Mermaid 的佈景）：寫成最前面的一行 %%{init: {"theme": "…"}}%%。空字串＝不指定，跟著 Obsidian
const THEMES: [string, I18nKey][] = [['', '跟著 Obsidian'], ['default', '預設（淺紫）'], ['neutral', '黑白'], ['forest', '綠色'], ['dark', '深色'], ['base', '米色']];
const THEME_LINE = /^%%\{\s*init\s*:\s*\{\s*["']theme["']\s*:\s*["'](default|neutral|forest|dark|base)["']\s*\}\s*\}%%$/;
// 每一種圖表都有的設定（表單裡排在各自的設定後面）
export const COMMON_OPTS: Field[] = [{ kind: 'select', key: 'theme', label: '外觀', options: fixed(THEMES) }];

// 讀成資料：各種圖表自己的 parse，再把外觀那一行從開頭的註解裡拿出來變成設定
export function parseDiagram(kind: DiagramKind, src: string): DiagramModel | DiagramReason {
  const m = kind.parse(src);
  if (typeof m === 'string') return m;
  const i = m.pre.findIndex(l => THEME_LINE.test(l));
  if (i >= 0) { m.opts.theme = THEME_LINE.exec(m.pre[i])![1]; m.pre.splice(i, 1); }
  return m;
}
// 寫回程式碼：有指定外觀時加在最前面
export function generateDiagram(kind: DiagramKind, m: DiagramModel): string {
  const src = kind.generate(m);
  return m.opts.theme ? '%%{init: {"theme": "' + m.opts.theme + '"}}%%\n' + src : src;
}

// 這段程式碼是哪一種圖表（看第一個不是註解的行）；不認得時回傳 null
export function detectKind(src: string): DiagramKind | null {
  const first = String(src).replace(/\r\n?/g, '\n').split('\n').find(l => l.trim() && !/^\s*%%/.test(l));
  if (!first) return null;
  return DIAGRAM_KINDS.find(k => k.head.test(first.trim())) || null;
}

export type DiagramResult = { ok: true; kind: DiagramKind; model: DiagramModel } | { ok: false; kind: DiagramKind | null; reason: DiagramReason };

export const sameModel = (a: DiagramModel, b: DiagramModel): boolean => JSON.stringify([a.opts, a.lists, a.extra, a.pre]) === JSON.stringify([b.opts, b.lists, b.extra, b.pre]);

// 這段程式碼能不能用表單編輯：認得種類、讀得出來，而且「寫回去再讀一次」內容不變（表示沒有遺漏任何東西）
export function editableDiagram(src: string): DiagramResult {
  const kind = detectKind(src);
  if (!kind) return { ok: false, kind: null, reason: 'unknownKind' };
  const model = parseDiagram(kind, src);
  if (typeof model === 'string') return { ok: false, kind, reason: model };
  const again = parseDiagram(kind, generateDiagram(kind, model));
  if (typeof again === 'string' || !sameModel(model, again)) return { ok: false, kind, reason: 'roundtrip' };
  return { ok: true, kind, model };
}

// 表單裡的一個文字欄位（在圖上點文字時，用來找出對應的欄位）：
// list 與 row 是 null 表示圖表本身的設定；line 是多行欄位裡的第幾行（一般欄位是 -1）
export interface TextSlot { field: TextField | LinesField; list: ListSpec | null; row: Row | null; line: number; value: string; }

export function textSlots(kind: DiagramKind, m: DiagramModel): TextSlot[] {
  const out: TextSlot[] = [];
  const add = (field: Field, list: ListSpec | null, row: Row | null, value: string | undefined) => {
    if (field.kind === 'text') { if (value) out.push({ field, list, row, line: -1, value }); }
    else if (field.kind === 'lines') String(value || '').split('\n').forEach((v, line) => { if (v.trim()) out.push({ field, list, row, line, value: v.trim() }); });
  };
  for (const f of kind.opts) add(f, null, null, m.opts[f.key]);
  for (const list of kind.lists) for (const row of m.lists[list.key] || []) for (const f of list.fields) add(f, list, row, row[f.key]);
  return out;
}

// 比對圖上的文字與欄位的值：不管空白與換行（圖上多行的文字會連在一起）
export const squash = (s: string): string => String(s || '').replace(/\s+/g, '');

// 圖上的文字（label，同樣文字裡的第 nth 個）對應到哪一個欄位。完全相同的優先；
// 找不到時找「圖上的文字以欄位的值開頭」的（例如圓餅圖的圖例後面多了數值），取最長的
export function findSlot(slots: TextSlot[], label: string, nth = 0): TextSlot | null {
  const want = squash(label);
  if (!want) return null;
  const exact = slots.filter(s => squash(s.value) === want);
  if (exact.length) return exact[Math.min(nth, exact.length - 1)];
  let best: TextSlot | null = null;
  const shown = label.trim();
  for (const s of slots) {
    const v = s.value.trim();
    // 後面要接空白、括號或冒號才算（「45%」不算是以「45」這個值開頭的文字）
    if (v.length >= 2 && shown.startsWith(v) && /^[\s[(:：]/.test(shown.slice(v.length)) && (!best || v.length > best.value.trim().length)) best = s;
  }
  return best;
}

// 兩個欄位位置是不是同一個（同一列的同一個欄位、多行欄位裡的同一行）
export function sameSlot(a: Pick<TextSlot, 'field' | 'row' | 'line'>, b: Pick<TextSlot, 'field' | 'row' | 'line'>): boolean {
  return a.field === b.field && a.row === b.row && a.line === b.line;
}

// findSlot 的反方向：這個欄位在「值相同的欄位」裡排第幾個，也就是圖上同樣文字裡的第幾個（找不到時是 -1）
export function slotNth(slots: TextSlot[], slot: Pick<TextSlot, 'field' | 'row' | 'line'>): number {
  const me = slots.find(s => sameSlot(s, slot));
  if (!me) return -1;
  const want = squash(me.value);
  return slots.filter(s => squash(s.value) === want).findIndex(s => sameSlot(s, slot));
}

// 某一列的第一個有內容的文字欄位（在圖上標出這一列時用它來找位置）
export function rowSlot(slots: TextSlot[], row: Row): TextSlot | null {
  return slots.find(s => s.row === row) || null;
}

// 改一個欄位的值。欄位屬於某一類名稱（group）而且 everywhere 為 true 時，同一類裡原本同名的欄位一起改
// （在圖上把「使用者」改名，所有訊息裡的「使用者」都跟著改）
export function setValue(kind: DiagramKind, m: DiagramModel, slot: { field: Field; list: ListSpec | null; row: Row | null; line?: number }, value: string, everywhere: boolean): void {
  const { field, row } = slot;
  const target = row || m.opts;
  const old = target[field.key] || '';
  if (field.kind === 'lines' && slot.line != null && slot.line >= 0) {
    const lines = old.split('\n');
    lines[slot.line] = value;
    target[field.key] = lines.filter(v => v.trim()).join('\n');
    return;
  }
  target[field.key] = value;
  const group = (field.kind === 'text' || field.kind === 'select') ? field.group : undefined;
  if (!group || !everywhere || !old || old === value) return;
  for (const list of kind.lists) {
    for (const f of list.fields) {
      if ((f.kind !== 'text' && f.kind !== 'select') || f.group !== group) continue;
      for (const r of m.lists[list.key] || []) if (r[f.key] === old) r[f.key] = value;
    }
  }
}
