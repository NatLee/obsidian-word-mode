// 詳細提示：滑鼠停在按鈕上時，顯示功能名稱、快速鍵、說明，以及會動的示意圖
// 只有一張提示卡（新的會取代舊的），所以提示不會互相蓋住
import { t } from './i18n.js';
import { el } from './dom.js';
import type { I18nKey } from './i18n.js';

// 提示卡的內容（attachHint 的 info() 回傳）；demo 是 DEMOS 的名稱
export interface HintInfo {
  title: string;
  keys?: string | null;
  desc?: string | null;
  demo?: string | null;
  reason?: string | null;
}

// 示意圖：在 box 裡建立會動的小範例
export type DemoBuilder = (box: HTMLElement) => void;

// timer 一開始是 null；clearTimeout(null) 不會出錯，但型別定義只收 number | undefined，所以呼叫處用 !
let card: HTMLDivElement | null = null;
let timer: number | null = null;
let current: HTMLElement | null = null;

// 示意文字：用一小段文字表示「之前 → 之後」
const SAMPLE = () => t('這是範例文字');

function textDemo(box: HTMLElement, cls: string, before?: string) {
  const line = el('div', 'wm-demo-line', box);
  el('span', null, line, before || t('套用在'));
  el('span', 'wm-demo-target ' + cls, line, SAMPLE());
  el('span', null, line, t('上'));
}

function linesDemo(box: HTMLElement, cls: string, n = 3, widths = [90, 70, 82]): HTMLDivElement {
  const wrap = el('div', 'wm-demo-lines ' + cls, box);
  for (let i = 0; i < n; i++) {
    const l = el('div', 'wm-demo-bar', wrap);
    l.style.width = widths[i % widths.length] + '%';
  }
  return wrap;
}

const DEMOS: Record<string, DemoBuilder> = {
  bold: b => textDemo(b, 'wm-anim-bold'),
  italic: b => textDemo(b, 'wm-anim-italic'),
  underline: b => textDemo(b, 'wm-anim-underline'),
  strike: b => textDemo(b, 'wm-anim-strike'),
  sup: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, 'x'); el('span', 'wm-demo-target wm-anim-sup', l, '2'); el('span', null, l, ' + m'); el('span', 'wm-demo-target wm-anim-sup', l, '3'); },
  sub: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, 'H'); el('span', 'wm-demo-target wm-anim-sub', l, '2'); el('span', null, l, 'O · CO'); el('span', 'wm-demo-target wm-anim-sub', l, '2'); },
  highlight: b => textDemo(b, 'wm-anim-highlight'),
  shading: b => textDemo(b, 'wm-anim-shading'),
  border: b => textDemo(b, 'wm-anim-border'),
  color: b => textDemo(b, 'wm-anim-color'),
  code: b => textDemo(b, 'wm-anim-code'),
  kbd: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('按 ')); el('span', 'wm-demo-target wm-anim-kbd', l, 'Ctrl'); el('span', null, l, ' + '); el('span', 'wm-demo-target wm-anim-kbd', l, 'S'); },
  clear: b => textDemo(b, 'wm-anim-clear'),
  case: b => { const l = el('div', 'wm-demo-line', b); const s = el('span', 'wm-demo-swap', l); el('span', 'wm-swap-a', s, 'hello world'); el('span', 'wm-swap-b', s, 'Hello World'); },
  painter: b => {
    const l = el('div', 'wm-demo-line', b);
    el('span', 'wm-demo-src', l, t('格式'));
    el('span', 'wm-demo-brush', l, '🖌');
    el('span', null, l, ' → ');
    el('span', 'wm-demo-target wm-anim-paint', l, SAMPLE());
  },
  style: b => { el('div', 'wm-demo-target wm-anim-heading', b, t('段落變成標題')); linesDemo(b, '', 2); },
  bullet: b => { const w = linesDemo(b, 'wm-anim-list wm-list-bullet'); w.dataset.kind = 'bullet'; },
  ordered: b => { const w = linesDemo(b, 'wm-anim-list wm-list-ordered'); w.dataset.kind = 'ordered'; },
  task: b => linesDemo(b, 'wm-anim-list wm-list-task'),
  indent: b => linesDemo(b, 'wm-anim-indent'),
  outdent: b => linesDemo(b, 'wm-anim-outdent'),
  left: b => linesDemo(b, 'wm-anim-align wm-to-left', 3, [90, 55, 75]),
  center: b => linesDemo(b, 'wm-anim-align wm-to-center', 3, [90, 55, 75]),
  right: b => linesDemo(b, 'wm-anim-align wm-to-right', 3, [90, 55, 75]),
  justify: b => linesDemo(b, 'wm-anim-align wm-to-justify', 3, [90, 55, 75]),
  quote: b => linesDemo(b, 'wm-anim-quote', 2),
  callout: b => { const w = el('div', 'wm-demo-callout wm-anim-pop', b); el('div', 'wm-demo-callout-title', w, 'ⓘ ' + t('提示')); el('div', 'wm-demo-bar wm-demo-bar-wide', w); },
  sort: b => {
    const w = el('div', 'wm-demo-sort', b);
    ['C', 'A', 'B'].forEach((x, i) => { const r = el('div', 'wm-demo-sortrow wm-sort-' + i, w); el('span', null, r, x + ' ' + t('項目')); });
  },
  marks: b => { const l = el('div', 'wm-demo-line wm-anim-marks', b); (['這是', '範例', '文字'] satisfies I18nKey[]).forEach((w, i) => { if (i) el('span', 'wm-demo-dot', l, '·'); el('span', null, l, t(w)); }); el('span', 'wm-demo-para', l, '¶'); },
  cleanup: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('殘留')); el('span', 'wm-demo-bad', l, '**'); el('span', null, l, t('的符號')); el('span', 'wm-demo-bad', l, '"'); },
  find: b => { const l = el('div', 'wm-demo-line', b); (['報表', '的', '報表', '與', '報表'] satisfies I18nKey[]).forEach((w, i) => el('span', i % 2 ? null : 'wm-demo-match wm-match-' + i / 2, l, t(w))); },
  replace: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('把')); const s = el('span', 'wm-demo-swap', l); el('span', 'wm-swap-a', s, t('舊字')); el('span', 'wm-swap-b', s, t('新字')); el('span', null, l, t('全部換掉')); },
  selectall: b => { const w = linesDemo(b, 'wm-anim-selectall'); w.classList.add('wm-demo-sel'); },
  undo: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('打錯')); el('span', 'wm-demo-target wm-anim-undo', l, t('的字')); },
  redo: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('恢復')); el('span', 'wm-demo-target wm-anim-redo', l, t('的字')); },
  table: b => { const g = el('div', 'wm-demo-grid', b); for (let i = 0; i < 12; i++) el('span', 'wm-demo-cell wm-cell-' + i, g); },
  image: b => { const f = el('div', 'wm-demo-image wm-anim-pop', b); el('span', null, f, '🖼'); },
  equation: b => el('div', 'wm-demo-eq wm-anim-pop', b, 'E = mc²   ∑ xᵢ'),
  symbol: b => { const l = el('div', 'wm-demo-line', b); ['→', '©', '℃', 'α', '①'].forEach((s, i) => el('span', 'wm-demo-sym wm-sym-' + i, l, s)); },
  link: b => textDemo(b, 'wm-anim-link', t('連結')),
  notelink: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('參考')); el('span', 'wm-demo-target wm-anim-link', l, t('另一份筆記')); },
  codeblock: b => { const c = el('div', 'wm-demo-codeblock', b); el('div', 'wm-demo-codehead', c, 'Python'); const l = el('div', 'wm-demo-codeline', c); el('span', 'wm-tk-kw', l, 'def '); el('span', 'wm-tk-fn', l, 'total'); el('span', null, l, '(x): '); el('span', 'wm-tk-kw', l, 'return '); el('span', 'wm-tk-str', l, '"ok"'); },
  comment: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('內文')); el('span', 'wm-demo-comment wm-anim-pop', l, '💬'); el('span', 'wm-demo-note', l, t('閱讀時看不到')); },
  date: b => el('div', 'wm-demo-date wm-anim-type', b, (window.moment ? window.moment().format('YYYY-MM-DD HH:mm') : '2026-11-17 08:00')),
  hr: b => { linesDemo(b, '', 1); el('div', 'wm-demo-hr wm-anim-grow', b); linesDemo(b, '', 1); },
  template: b => { const w = linesDemo(b, 'wm-anim-template', 3); w.classList.add('wm-demo-sel'); },
  properties: b => { const p = el('div', 'wm-demo-props wm-anim-pop', b); el('div', null, p, 'tags: #' + t('會議')); el('div', null, p, 'date: 2026-11-17'); },
  outline: b => { const w = el('div', 'wm-demo-outline', b); ([[1, '第一章'], [2, '背景'], [2, '方法'], [1, '第二章']] as const).forEach(([lv, x], i) => { const r = el('div', 'wm-demo-oitem wm-oitem-' + i, w, t(x)); r.style.paddingLeft = (lv - 1) * 12 + 'px'; }); },
  fold: b => { el('div', 'wm-demo-target wm-anim-heading-static', b, '▾ ' + t('標題')); linesDemo(b, 'wm-anim-fold', 2); },
  unfold: b => { el('div', 'wm-demo-target wm-anim-heading-static', b, '▸ ' + t('標題')); linesDemo(b, 'wm-anim-unfold', 2); },
  zoom: b => linesDemo(b, 'wm-anim-zoom', 3),
  fullwidth: b => linesDemo(b, 'wm-anim-wide', 3),
  markdown: b => { const l = el('div', 'wm-demo-line wm-demo-mono', b); el('span', 'wm-anim-mdsyntax', l, '**'); el('span', null, l, t('粗體')); el('span', 'wm-anim-mdsyntax', l, '**'); el('span', null, l, ' '); el('span', 'wm-anim-mdsyntax', l, '[['); el('span', null, l, t('連結')); el('span', 'wm-anim-mdsyntax', l, ']]'); },
  reading: b => { const w = linesDemo(b, 'wm-anim-reading', 3); w.classList.add('wm-demo-sel'); },
  paste: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('游標處')); el('span', 'wm-demo-target wm-anim-type', l, t('貼上的內容')); },
  cut: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('剪下')); el('span', 'wm-demo-target wm-anim-undo', l, t('這段文字')); },
  copy: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('複製')); el('span', 'wm-demo-target wm-anim-copy', l, t('這段文字')); },
  wordcount: b => el('div', 'wm-demo-count wm-anim-pop', b, t('1,234 字・5 分鐘')),
};

function ensureCard(): HTMLDivElement {
  if (card && card.isConnected) return card;
  card = el('div', 'wm-hint-card', activeDocument.body);
  card.setAttribute('role', 'tooltip');
  card.addEventListener('mouseenter', () => window.clearTimeout(timer!));
  card.addEventListener('mouseleave', hideHint);
  return card;
}

export function hideHint(): void {
  window.clearTimeout(timer!);
  current = null;
  if (card) card.classList.remove('is-shown');
}

function show(btn: HTMLElement, info: HintInfo) {
  const c = ensureCard();
  c.replaceChildren();
  const head = el('div', 'wm-hint-head', c);
  el('span', 'wm-hint-title', head, info.title);
  if (info.keys) {
    const k = el('span', 'wm-hint-keys', head);
    info.keys.split('+').forEach((p, i) => { if (i) el('span', 'wm-hint-plus', k, '+'); el('kbd', null, k, p); });
  }
  if (info.desc) el('div', 'wm-hint-desc', c, info.desc);
  if (info.reason) el('div', 'wm-hint-reason', c, info.reason);
  const demo = info.demo && DEMOS[info.demo];
  if (demo) { const box = el('div', 'wm-hint-demo', c); demo(box); }
  c.classList.add('is-shown');
  // 放在按鈕下方（工具列在下面時放上方），不超出畫面
  const r = btn.getBoundingClientRect();
  const w = c.offsetWidth || 260; const h = c.offsetHeight || 120;
  const vw = window.innerWidth; const vh = window.innerHeight;
  let top = r.bottom + 8;
  if (top + h > vh - 4) top = Math.max(4, r.top - h - 8);
  c.style.top = top + 'px';
  c.style.left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, vw - w - 4)) + 'px';
}

// info: () => { title, keys, desc, demo, reason }
export function attachHint(btn: HTMLElement, info: () => HintInfo): void {
  btn.addEventListener('mouseenter', () => {
    window.clearTimeout(timer!);
    // 已經有提示卡在顯示：直接換成這個按鈕的（像 Word）；否則等一下再出現
    const wait = card && card.classList.contains('is-shown') ? 80 : 550;
    timer = window.setTimeout(() => { current = btn; show(btn, info()); }, wait);
  });
  btn.addEventListener('mouseleave', () => {
    window.clearTimeout(timer!);
    timer = window.setTimeout(() => { if (current === btn) hideHint(); }, 120);
  });
  btn.addEventListener('mousedown', hideHint);
}

export function hasDemo(kind: string): boolean { return !!DEMOS[kind]; }
