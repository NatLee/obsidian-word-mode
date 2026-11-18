// 色彩面板：字型色彩與醒目提示共用（標準色彩、深淺變化、最近使用的自訂色彩、自訂色彩）
import { el } from './dom.js';
import { t } from './i18n.js';
import { HIGHLIGHT_COLORS } from './commands.js';
import type { HighlightColor } from './commands.js';
import type { I18nKey } from './i18n.js';

// 「字元網底」的灰色（醒目提示的一種，有自己的按鈕）
export const SHADING = '#9e9e9e59';

export type ColorKind = 'font' | 'highlight';
// 色塊：[CSS 色碼, 名稱（翻譯前的原文；沒有名稱時顯示色碼）]
export type Swatch = readonly [color: string, name?: I18nKey];

export interface ColorPanelOptions {
  kind: ColorKind;
  // 目前使用的色彩（標出對應的色塊）；醒目提示的預設黃色是 null
  current: string | null;
  // 最近使用的自訂色彩（最新的在前）
  recent: readonly string[];
  // 在 el 裡放圖示
  icon: (el: HTMLElement, name: string, fallback: string) => void;
  // 讓按鈕不搶走編輯區的焦點
  keepFocus: (b: HTMLElement) => void;
  // 選了色彩。醒目提示的預設黃色是 null；custom 表示是使用者自己調的色彩（要記進「最近使用」）
  onPick: (color: string | null, custom: boolean) => void;
  // 按了「自動」（字型）或「無色彩」（醒目提示）
  onClear: () => void;
}

// 字型的標準色彩（像 Word 的「標準色彩」）
export const TEXT_COLORS: readonly (readonly [color: string, name: I18nKey])[] = [
  ['#000000', '黑色'], ['#7f7f7f', '灰色'], ['#c00000', '深紅'], ['#ff0000', '紅色'], ['#ff8c00', '橙色'],
  ['#bf9000', '金色'], ['#00b050', '綠色'], ['#00b0f0', '淺藍'], ['#0070c0', '藍色'], ['#7030a0', '紫色'],
];

// 醒目提示：色碼最後兩碼是不透明度，深色與淺色佈景主題都看得清楚文字。null 是預設黃色（存成 ==文字==）；
// 灰色是「字元網底」按鈕用的，不放進色盤
export const HIGHLIGHT_SOFT: readonly HighlightColor[] = HIGHLIGHT_COLORS.filter(c => c[0] !== SHADING);
// 較深的一排：同樣的顏色，不透明度較高
export const HIGHLIGHT_VIVID: readonly Swatch[] = [
  ['#ffd000b3', '黃色'], ['#4caf50b3', '綠色'], ['#00bcd4b3', '青色'], ['#ff80abb3', '粉紅'], ['#448affb3', '藍色'],
  ['#ff5252b3', '紅色'], ['#ff9800b3', '橘色'], ['#b388ffb3', '紫色'],
];

// ---------------------------------------------------------------- 色碼工具

export type Rgba = [r: number, g: number, b: number, a: number];

// '#abc'、'#aabbcc'、'#aabbccdd'（可以不寫 #）→ [r, g, b, a]（a 是 0～1）；看不懂時回傳 null
export function parseHex(input: string): Rgba | null {
  let h = String(input || '').trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  if (h.length <= 4) h = h.split('').map(c => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// [r, g, b, a] → '#rrggbb'；a 小於 1 時是 '#rrggbbaa'
export function toHex(c: Rgba): string {
  return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) + (c[3] < 1 ? hex2(c[3] * 255) : '');
}

// 使用者輸入的色碼整理成 '#rrggbb' 或 '#rrggbbaa'（小寫）；看不懂時回傳 null
export function normalizeColor(input: string): string | null {
  const c = parseHex(input);
  return c ? toHex(c) : null;
}

// 往白色（amount > 0）或黑色（amount < 0）調：amount 是 -1～1
export function shade(color: string, amount: number): string {
  const c = parseHex(color);
  if (!c) return color;
  const to = amount > 0 ? 255 : 0; const k = Math.abs(amount);
  return toHex([c[0] + (to - c[0]) * k, c[1] + (to - c[1]) * k, c[2] + (to - c[2]) * k, 1]);
}

// 標準色彩的深淺變化：每個顏色四階（較淺兩階、較深兩階）；黑色那一欄是灰階
export function shadeRows(base: readonly string[]): string[][] {
  const steps = [0.6, 0.3, -0.25, -0.5];
  const gray = [0.85, 0.65, 0.45, 0.25];
  return steps.map((s, row) => base.map(c => (parseHex(c)!.slice(0, 3).every(v => v === 0) ? shade(c, gray[row]) : shade(c, s))));
}

// ---------------------------------------------------------------- 面板

export function buildColorPanel(p: HTMLElement, o: ColorPanelOptions): void {
  const font = o.kind === 'font';
  p.classList.add('wm-cp', font ? 'wm-color-popup' : 'wm-hl-popup');
  el('div', 'wm-cp-title', p, t(font ? '字型色彩' : '醒目提示色彩'));

  const same = (a: string | null, b: string | null): boolean => (a || '').toLowerCase() === (b || '').toLowerCase();
  const section = (label: I18nKey): void => { el('div', 'wm-cp-label', p, t(label)); };
  const grid = (cols: number, cls = ''): HTMLDivElement => {
    const g = el('div', 'wm-color-grid wm-cp-grid' + (cls ? ' ' + cls : ''), p);
    g.style.setProperty('--wm-cp-cols', String(cols));
    return g;
  };
  const swatch = (parent: HTMLElement, color: string | null, name: string, css?: string, custom = false): HTMLButtonElement => {
    const b = el('button', 'wm-color-swatch wm-cp-swatch' + (same(color, o.current) ? ' is-active' : ''), parent);
    b.type = 'button';
    b.setAttribute('aria-label', name);
    b.style.setProperty('--wm-cp-color', css || color || 'transparent');
    o.keepFocus(b);
    b.addEventListener('click', () => o.onPick(color, custom));
    return b;
  };

  // ---- 自動／無色彩
  const clear = el('button', 'wm-color-auto wm-cp-clear', p);
  clear.type = 'button';
  el('span', 'wm-cp-clear-chip' + (font ? ' is-auto' : ''), clear, font ? 'A' : '');
  el('span', null, clear, t(font ? '自動（清除色彩）' : '無色彩（移除醒目提示）'));
  o.keepFocus(clear);
  clear.addEventListener('click', () => o.onClear());

  // ---- 色盤
  const cols = font ? TEXT_COLORS.length : HIGHLIGHT_SOFT.length;
  if (font) {
    section('標準色彩');
    const g = grid(cols);
    for (const [c, name] of TEXT_COLORS) swatch(g, c, t(name));
    section('深淺變化');
    const tints = grid(cols, 'is-tints');
    for (const row of shadeRows(TEXT_COLORS.map(x => x[0]))) for (const c of row) swatch(tints, c, c.toUpperCase());
  } else {
    section('螢光筆');
    const g = grid(cols);
    for (const [c, name, css] of HIGHLIGHT_SOFT) swatch(g, c, t(name), css);
    section('較深的色彩');
    const g2 = grid(cols);
    for (const [c, name] of HIGHLIGHT_VIVID) swatch(g2, c, name ? t(name) + t('（較深）') : c);
  }

  // ---- 最近使用的自訂色彩
  if (o.recent.length) {
    section('最近使用的自訂色彩');
    const g = grid(cols);
    for (const c of o.recent.slice(0, cols)) swatch(g, c, c.toUpperCase(), undefined, true);
  }

  // ---- 自訂色彩：色盤、色碼、（醒目提示）不透明度、預覽
  section('自訂色彩');
  const box = el('div', 'wm-cp-custom', p);
  const start = parseHex(o.current || '') || parseHex(font ? '#c00000' : '#ffd00066')!;
  let alpha = font ? 1 : (start[3] < 1 ? start[3] : 0.4);
  const well = el('input', 'wm-cp-well', box);
  well.type = 'color';
  well.value = toHex([start[0], start[1], start[2], 1]);
  well.setAttribute('aria-label', t('選擇色彩'));
  const code = el('input', 'wm-cp-hex', box);
  code.type = 'text';
  code.spellcheck = false;
  code.maxLength = 9;
  code.setAttribute('aria-label', t('色碼'));
  code.placeholder = font ? '#C00000' : '#FFD000';
  const preview = el('span', 'wm-cp-preview', box, t('文字 Aa'));
  const ok = el('button', 'wm-cp-apply mod-cta', box, t('套用'));
  ok.type = 'button';

  let range: HTMLInputElement | null = null; let pct: HTMLSpanElement | null = null;
  if (!font) {
    const row = el('div', 'wm-cp-alpha', p);
    el('span', 'wm-cp-alpha-name', row, t('不透明度'));
    range = el('input', 'wm-cp-range', row);
    range.type = 'range'; range.min = '10'; range.max = '100'; range.step = '5';
    range.value = String(Math.round(alpha * 20) * 5);
    range.setAttribute('aria-label', t('不透明度'));
    pct = el('span', 'wm-cp-alpha-value', row);
  }

  // 目前調出來的色彩；色碼打到一半（看不懂）時回傳 null
  const value = (): string | null => {
    const c = parseHex(code.value);
    if (!c) return null;
    return toHex([c[0], c[1], c[2], font ? 1 : alpha]);
  };
  const refresh = (): void => {
    const v = value();
    code.classList.toggle('is-invalid', !v);
    ok.disabled = !v;
    if (pct) pct.textContent = Math.round(alpha * 100) + '%';
    if (!v) return;
    if (font) preview.style.color = v; else preview.style.backgroundColor = v;
  };
  code.value = well.value.toUpperCase();
  well.addEventListener('input', () => { code.value = well.value.toUpperCase(); refresh(); });
  code.addEventListener('input', () => {
    const c = parseHex(code.value);
    if (c) {
      well.value = toHex([c[0], c[1], c[2], 1]);
      // 色碼自己帶了不透明度（#rrggbbaa）：滑桿跟著移動
      if (!font && c[3] < 1 && range) { alpha = c[3]; range.value = String(Math.round(alpha * 100)); }
    }
    refresh();
  });
  if (range) range.addEventListener('input', () => { alpha = +range.value / 100; refresh(); });
  const apply = (): void => { const v = value(); if (v) o.onPick(v, true); };
  ok.addEventListener('click', apply);
  code.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  refresh();

  if (!font) el('div', 'wm-popup-note', p, t('黃色存成 ==文字==；其他顏色存成 HTML，Obsidian 閱讀畫面也看得到。'));
}
