// 使用者自己存的範本（公式、圖表）：名稱加原始碼。純資料操作，不依賴 Obsidian，可以直接測試。
// 每個函式都回傳新的陣列，不改動傳進來的那一份（設定物件由呼叫的地方決定何時換掉、何時存檔）。

export interface SavedTemplate { name: string; src: string; }

// 名稱最長 60 個字；原始碼最長 20000 個字（一張很大的圖表也夠用，又不會讓設定檔無限長大）
const MAX_NAME = 60;
const MAX_SRC = 20000;
export const MAX_TEMPLATES = 200;

// 不是文字的（設定檔被手動改壞）當成空的
const cleanName = (s: unknown): string => (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const cleanSrc = (s: unknown): string => (typeof s === 'string' ? s : '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').slice(0, MAX_SRC);

// 整理從設定檔讀進來的資料：格式不對、沒有內容的丟掉，名稱重複的只留第一個
export function cleanTemplates(list: unknown): SavedTemplate[] {
  if (!Array.isArray(list)) return [];
  const out: SavedTemplate[] = [];
  const seen = new Set<string>();
  for (const item of list as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const name = cleanName((item as Partial<SavedTemplate>).name);
    const src = cleanSrc((item as Partial<SavedTemplate>).src);
    if (!name || !src.trim() || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, src });
    if (out.length >= MAX_TEMPLATES) break;
  }
  return out;
}

// 存一個範本：同名的直接換掉內容（位置不變），否則加在最後。名稱或內容是空的就不存
export function saveTemplate(list: readonly SavedTemplate[], name: string, src: string): SavedTemplate[] {
  const n = cleanName(name);
  const s = cleanSrc(src);
  if (!n || !s.trim()) return list.slice();
  const i = list.findIndex(x => x.name === n);
  if (i >= 0) return list.map((x, j) => (j === i ? { name: n, src: s } : x));
  if (list.length >= MAX_TEMPLATES) return list.slice();
  return list.concat({ name: n, src: s });
}

export function removeTemplate(list: readonly SavedTemplate[], index: number): SavedTemplate[] {
  return list.filter((_, i) => i !== index);
}

// 往前（dir = -1）或往後（dir = 1）移一格；已經在邊上就不動
export function moveTemplate(list: readonly SavedTemplate[], index: number, dir: number): SavedTemplate[] {
  const j = index + dir;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list.slice();
  const out = list.slice();
  const [item] = out.splice(index, 1);
  out.splice(j, 0, item);
  return out;
}

// 改名：新名稱是空的、或跟別的範本重複時不改
export function renameTemplate(list: readonly SavedTemplate[], index: number, name: string): SavedTemplate[] {
  const n = cleanName(name);
  if (!n || index < 0 || index >= list.length || list.some((x, i) => i !== index && x.name === n)) return list.slice();
  return list.map((x, i) => (i === index ? { name: n, src: x.src } : x));
}

// 改內容：清成空的就不改（要拿掉請用刪除）
export function editTemplate(list: readonly SavedTemplate[], index: number, src: string): SavedTemplate[] {
  const s = cleanSrc(src);
  if (!s.trim() || index < 0 || index >= list.length) return list.slice();
  return list.map((x, i) => (i === index ? { name: x.name, src: s } : x));
}

// 還沒用過的名稱：base、base 2、base 3…
export function uniqueName(list: readonly SavedTemplate[], base: string): string {
  const b = cleanName(base) || '1';
  const used = new Set(list.map(x => x.name));
  if (!used.has(b)) return b;
  for (let i = 2; ; i++) { const n = (b.slice(0, MAX_NAME - 4) + ' ' + i); if (!used.has(n)) return n; }
}
