// 文件屬性（frontmatter）的值：判斷類型、轉換類型、轉成顯示用的文字。這裡沒有畫面，方便單獨測試。

export type PropType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'object';

const LIST_KEYS = /^(tags|aliases|cssclasses|cssclass|alias|tag)$/i;
const TAG_KEYS = /^tags?$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// hint 是 Obsidian 為這個屬性設定的類型（text、multitext、number、checkbox、date、datetime…）
export function propType(key: string, value: unknown, hint?: string | null): PropType {
  if (hint === 'multitext' || hint === 'tags' || hint === 'aliases' || Array.isArray(value) || LIST_KEYS.test(key)) return 'list';
  if (hint === 'checkbox' || typeof value === 'boolean') return 'checkbox';
  if (hint === 'number' || typeof value === 'number') return 'number';
  if (hint === 'date' || (typeof value === 'string' && DATE.test(value))) return 'date';
  if (hint === 'datetime' || (typeof value === 'string' && DATETIME.test(value))) return 'datetime';
  if (value && typeof value === 'object') return 'object';
  return 'text';
}

export function isTagKey(key: string): boolean { return TAG_KEYS.test(key); }

// 每種類型的圖示（Lucide 名稱）：文件屬性區塊與「查看文件屬性」小視窗共用
export const PROP_ICONS: Record<PropType, string> = { text: 'text', list: 'list', number: 'binary', checkbox: 'check-square', date: 'calendar', datetime: 'clock', object: 'braces' };

// 文件屬性節點的 src（含前後的 ---）→ 中間的 YAML
export function frontmatterBody(src: string): string {
  return src.replace(/^---[^\n]*\r?\n/, '').replace(/\r?\n?(---|\.\.\.)\s*$/, '');
}

// Markdown 原文開頭的文件屬性（YAML）；沒有時是 null。
// 判斷方式跟 markdown.ts 切出文件屬性的規則一樣：第一行是 ---，到下一個 --- 或 ... 為止
export function frontmatterOf(text: string): string | null {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---' || lines[i] === '...') return lines.slice(1, i).join('\n');
  return null;
}

// 文件屬性的 YAML 本文（不含前後的 ---）包回完整的區塊；本文是空的時候是 ---\n---
export function wrapFrontmatter(body: string): string {
  const b = body.replace(/\s+$/, '');
  return '---\n' + (b ? b + '\n' : '') + '---';
}

// 「查看文件屬性」小視窗要顯示的內容：沒有文件屬性、看不懂的 YAML（顯示原文），或屬性的值
export type PropsPeekData = { kind: 'none' } | { kind: 'raw'; text: string } | { kind: 'props'; values: Record<string, unknown> };

// body 是 frontmatterBody／frontmatterOf 的結果；parse 是 Obsidian 的 parseYaml（測試時換成替身）
export function peekData(body: string | null, parse: (yaml: string) => unknown): PropsPeekData {
  if (body == null) return { kind: 'none' };
  if (!body.trim()) return { kind: 'props', values: {} };
  try {
    const o = parse(body);
    if (o && typeof o === 'object' && !Array.isArray(o)) return { kind: 'props', values: o as Record<string, unknown> };
  } catch { /* 看不懂的 YAML：顯示原文 */ }
  return { kind: 'raw', text: body };
}

// 純量（文字、數字、布林）轉成文字；其餘回傳 null
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

// 任何屬性值 → 一行看得懂的文字（巢狀資料寫成「名稱: 值, 名稱: 值」，不會出現 [object Object]）
export function summarize(value: unknown): string {
  if (value == null) return '';
  const s = scalarText(value);
  if (s != null) return s;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(v => summarize(v)).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => k + ': ' + (v && typeof v === 'object' && !(v instanceof Date) ? (Array.isArray(v) ? '[' + summarize(v) + ']' : '{' + summarize(v) + '}') : summarize(v)))
      .join(', ');
  }
  return '';
}

export interface PropLink { kind: 'wiki' | 'url'; target: string; text: string; }

// 值是「[[筆記]]」「[[筆記|別名]]」或網址時，回傳連結的目標與顯示文字
export function propLink(value: unknown): PropLink | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const w = v.match(/^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/);
  if (w) {
    const target = w[1].trim();
    return { kind: 'wiki', target, text: (w[2] && w[2].trim()) || target.replace(/\.md$/i, '').replace(/#\^?/, ' › ') };
  }
  if (/^https?:\/\/\S+$/i.test(v)) return { kind: 'url', target: v, text: v.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') };
  return null;
}

const pad = (n: number): string => String(n).padStart(2, '0');
function localDate(d: Date): string { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function localDateTime(d: Date): string { return localDate(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

// 把值換成另一種類型：能保留的內容盡量保留（清單 ⇄ 文字、文字 → 數字…），沒辦法時給該類型的預設值
export function convertProp(value: unknown, to: Exclude<PropType, 'object'>, now: Date = new Date()): unknown {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  const text = scalarText(first);
  switch (to) {
    case 'list':
      if (Array.isArray(value)) return value;
      if (value == null || value === '') return [];
      return typeof value === 'string' ? value.split(/[,，]\s*/).map(s => s.trim()).filter(Boolean) : [value];
    case 'text':
      if (value == null) return null;
      return summarize(value) || null;
    case 'number': {
      if (typeof first === 'number') return first;
      const n = text == null || !text.trim() ? NaN : Number(text);
      return Number.isFinite(n) ? n : 0;
    }
    case 'checkbox':
      return first === true || (typeof first === 'string' && /^(true|yes|y|1)$/i.test(first.trim())) || (typeof first === 'number' && first !== 0);
    case 'date':
      return text != null && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : localDate(now);
    case 'datetime':
      if (text != null && DATETIME.test(text)) return text.slice(0, 16);
      if (text != null && DATE.test(text)) return text + 'T00:00';
      return localDateTime(now);
  }
}

// 把屬性改名，位置不變；新名稱空白或已經存在時回傳 null
export function renameProp(obj: Record<string, unknown>, from: string, to: string): Record<string, unknown> | null {
  const name = to.trim();
  if (!name || name === from || Object.prototype.hasOwnProperty.call(obj, name)) return null;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) out[k === from ? name : k] = obj[k];
  return out;
}

// 收合時顯示的摘要：前幾個有值的屬性「名稱: 值」
export function propsSummary(obj: Record<string, unknown>, max = 4): string {
  const parts: string[] = [];
  for (const k of Object.keys(obj)) {
    const v = summarize(obj[k]);
    if (!v) continue;
    parts.push(k + ': ' + (v.length > 40 ? v.slice(0, 40) + '…' : v));
    if (parts.length === max) break;
  }
  return parts.join('  ·  ');
}
