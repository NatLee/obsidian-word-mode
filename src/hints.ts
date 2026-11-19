// 詳細提示：滑鼠停在按鈕上時，顯示功能名稱、快速鍵、說明，以及會動的示意圖
// 只有一張提示卡（新的會取代舊的），所以提示不會互相蓋住
import { setIcon } from 'obsidian';
import { t } from './i18n.js';
import { el } from './dom.js';
import type { I18nKey } from './i18n.js';

// 提示卡的內容（attachHint 的 info() 回傳）；demo 是 DEMOS 的名稱
export interface HintInfo {
  title: string;
  keys?: string | null;
  desc?: string | null;
  demo?: DemoName | null;
  reason?: string | null;
}

// 示意圖：在 box 裡建立會動的小範例
export type DemoBuilder = (box: HTMLElement) => void;

// timer 一開始是 null；clearTimeout(null) 不會出錯，但型別定義只收 number | undefined，所以呼叫處用 !
let card: HTMLDivElement | null = null;
let timer: number | null = null;

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

const DEMOS = {
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
  // 圖表：流程圖的方塊與箭頭由左到右依序出現
  mermaid: b => {
    const f = el('div', 'wm-demo-flow', b);
    (['開始', '步驟', '結束'] satisfies I18nKey[]).forEach((x, i) => {
      if (i) el('span', 'wm-demo-arrow wm-step-' + (i * 2 - 1), f, '→');
      el('span', 'wm-demo-node wm-step-' + i * 2 + (i === 1 ? '' : ' is-round'), f, t(x));
    });
  },
  symbol: b => { const l = el('div', 'wm-demo-line', b); ['→', '©', '℃', 'α', '①'].forEach((s, i) => el('span', 'wm-demo-sym wm-sym-' + i, l, s)); },
  link: b => textDemo(b, 'wm-anim-link', t('連結')),
  // 註腳：內文後面冒出編號，下面出現對應的註腳內容
  footnote: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, SAMPLE()); el('span', 'wm-demo-fnref wm-step-0', l, '1'); el('div', 'wm-demo-note wm-step-2', b, '1. ' + t('註腳')); },
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
  // Word 模式：Markdown 的符號收起來，文字直接顯示成粗體與連結（跟下面的 markdown 正好相反）
  word: b => {
    const l = el('div', 'wm-demo-line wm-anim-wysiwyg', b);
    const mark = (s: string) => el('span', 'wm-demo-mdmark', l, s);
    mark('**'); el('span', 'wm-demo-wbold', l, t('粗體')); mark('**');
    el('span', null, l, ' ');
    mark('[['); el('span', 'wm-demo-wlink', l, t('連結')); mark(']]');
  },
  markdown: b => { const l = el('div', 'wm-demo-line wm-demo-mono', b); el('span', 'wm-anim-mdsyntax', l, '**'); el('span', null, l, t('粗體')); el('span', 'wm-anim-mdsyntax', l, '**'); el('span', null, l, ' '); el('span', 'wm-anim-mdsyntax', l, '[['); el('span', null, l, t('連結')); el('span', 'wm-anim-mdsyntax', l, ']]'); },
  reading: b => { const w = linesDemo(b, 'wm-anim-reading', 3); w.classList.add('wm-demo-sel'); },
  paste: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('游標處')); el('span', 'wm-demo-target wm-anim-type', l, t('貼上的內容')); },
  cut: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('剪下')); el('span', 'wm-demo-target wm-anim-undo', l, t('這段文字')); },
  copy: b => { const l = el('div', 'wm-demo-line', b); el('span', null, l, t('複製')); el('span', 'wm-demo-target wm-anim-copy', l, t('這段文字')); },
  wordcount: b => el('div', 'wm-demo-count wm-anim-pop', b, t('1,234 字・5 分鐘')),
  // 設定：在搜尋框打字 → 跳出符合的設定 → 選了之後那一列閃一下（設定頁的搜尋框，見 settingsnav.ts）
  settings: b => {
    const w = el('div', 'wm-demo-setfind', b);
    const q = el('div', 'wm-demo-setq', w);
    setIcon(el('span', 'wm-demo-setq-icon', q), 'search');
    el('span', 'wm-demo-setq-text', q, t('縮放'));
    const hit = el('div', 'wm-demo-sethit', w);
    el('span', 'wm-demo-sethit-name', hit, t('頁面縮放'));
    el('span', 'wm-demo-sethit-sec', hit, t('顯示'));
    const row = el('div', 'wm-demo-setrow', w);
    el('span', null, row, t('頁面縮放'));
    el('span', 'wm-demo-slider', row);
  },
} satisfies Record<string, DemoBuilder>;

// 示意動畫的名稱。按鈕的 demo 用這個型別，指定了不存在的動畫時型別檢查會失敗
// （以前是 string：「插入圖表」「插入註腳」指定的動畫不存在，提示卡就沒有動畫，也沒有任何錯誤）
export type DemoName = keyof typeof DEMOS;

// 在 box 裡畫出 name 這段示意動畫（快速鍵說明也用）。box 要有 wm-hint-demo 這個 class，動畫的時間設定才會套用
export function buildDemo(name: DemoName, box: HTMLElement): void { DEMOS[name](box); }

function ensureCard(): HTMLDivElement {
  if (card && card.isConnected) return card;
  card = el('div', 'wm-hint-card', activeDocument.body);
  card.setAttribute('role', 'tooltip');
  // 提示卡不接滑鼠（CSS 的 pointer-events: none）：它蓋在下一排按鈕與群組名稱上，
  // 以前滑鼠碰到它就讓它留著，結果移到群組上提示卡還在、底下的按鈕也點不到
  return card;
}

export function hideHint(): void {
  window.clearTimeout(timer!);
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
    timer = window.setTimeout(() => show(btn, info()), wait);
  });
  // 離開就收起；移到下一個按鈕時它的 mouseenter 會取消這個 timer，改成換內容。
  // 不能只在「顯示的是這個按鈕」時才收：快速滑過的按鈕還沒換上自己的提示，離開它時前一個按鈕的提示會一直留著
  btn.addEventListener('mouseleave', () => {
    window.clearTimeout(timer!);
    timer = window.setTimeout(hideHint, 120);
  });
  btn.addEventListener('mousedown', hideHint);
}

export function hasDemo(kind: string): kind is DemoName { return Object.prototype.hasOwnProperty.call(DEMOS, kind); }
