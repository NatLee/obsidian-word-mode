// 「查看文件屬性」小視窗：從功能區或狀態列的按鈕打開，不用捲到筆記最上方就能看到屬性。
// Word 模式讀編輯中的文件，Markdown／閱讀模式讀原文（mdbar.ts 的 openMarkdownPeek），畫面相同。
// 屬性很多時：上方有篩選框、清單在框內捲動；很長的值先顯示三行，點一下看全部
import { t } from './i18n.js';
import { el, isRtl, popupLeft, visibleBottom } from './dom.js';
import { hideHint } from './hints.js';
import { propType, summarize, isTagKey, PROP_ICONS } from './props.js';
import type { PropsPeekData } from './props.js';
import type { App } from 'obsidian';

// Obsidian 為這個屬性設定的類型（設定 → 屬性）：metadataTypeManager 是非公開 API，沒有時回傳 null，改依值判斷
export function propertyWidget(app: App, key: string): string | null {
  try {
    const m = app.metadataTypeManager;
    const info = m && (m.getPropertyInfo ? m.getPropertyInfo(key) : m.properties && m.properties[key.toLowerCase()]);
    return info ? (info.widget || info.type || null) : null;
  } catch { return null; }
}

export interface PropsPeekOptions {
  // 在 target 裡放 Obsidian 圖示；找不到圖示時改顯示 fallback 文字
  icon(target: HTMLElement, name: string, fallback: string): void;
  // Obsidian 為這個屬性設定的類型（text、multitext、date…）；沒有時依值判斷
  typeHint?(key: string): string | null;
  // 下方的「前往文件屬性」（沒有屬性時是「新增文件屬性」）；null 表示不顯示（例如閱讀模式沒有屬性，沒辦法新增）
  go?: (() => void) | null;
  isMobile?: boolean;
  // 不畫標題列（固定在上方的屬性列展開時，標題已經在屬性列上）
  bare?: boolean;
}

// 屬性超過這個數量才顯示篩選框
export const PEEK_FILTER_MIN = 6;

// 同一時間只有一個小視窗
let peek: HTMLDivElement | null = null;
let peekOwner: HTMLElement | null = null;
let unlisten: (() => void) | null = null;

export function closePropsPeek(): void {
  if (unlisten) unlisten();
  unlisten = null;
  if (peek) peek.remove();
  peek = null; peekOwner = null;
}

// 在 owner 按鈕旁打開；同一個按鈕再按一次就關閉。回傳小視窗（關閉時是 null）
export function openPropsPeek(owner: HTMLElement, data: PropsPeekData, o: PropsPeekOptions): HTMLDivElement | null {
  if (peek && peekOwner === owner) { closePropsPeek(); return null; }
  closePropsPeek();
  hideHint();
  const doc = owner.ownerDocument;
  const p = el('div', 'wm-popup wm-peek' + (o.isMobile ? ' is-mobile' : ''), doc.body);
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', t('文件屬性'));
  peek = p; peekOwner = owner;
  fillPropsPeek(p, data, Object.assign({}, o, { go: o.go ? () => { closePropsPeek(); o.go!(); } : null }));
  markOverflow(p);
  place(p, owner);
  // 點小視窗以外的地方、按 Esc 就關閉（點原本的按鈕交給按鈕自己處理：再按一次是關閉）
  const down = (e: Event) => { const n = e.target as Node | null; if (peek && !peek.contains(n) && !(peekOwner && peekOwner.contains(n))) closePropsPeek(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && peek) { e.preventDefault(); closePropsPeek(); } };
  doc.addEventListener('pointerdown', down, true);
  doc.addEventListener('keydown', key, true);
  unlisten = () => { doc.removeEventListener('pointerdown', down, true); doc.removeEventListener('keydown', key, true); };
  return p;
}

// 放在按鈕下方；下面放不下時放上方（狀態列在畫面最下面），左右不超出畫面。介面由右到左時對齊按鈕的右緣
function place(p: HTMLElement, owner: HTMLElement): void {
  const r = owner.getBoundingClientRect();
  const vw = window.innerWidth; const vh = visibleBottom(window);
  const w = p.offsetWidth || 300; const h = p.offsetHeight || 200;
  p.style.left = popupLeft(r, w, vw, isRtl(owner)) + 'px';
  p.style.top = Math.max(4, r.bottom + 4 + h > vh && r.top - h - 4 > 0 ? r.top - h - 4 : r.bottom + 4) + 'px';
}

// 小視窗的內容（測試直接呼叫）
export function fillPropsPeek(p: HTMLElement, data: PropsPeekData, o: PropsPeekOptions): void {
  p.replaceChildren();
  const values = data.kind === 'props' ? data.values : null;
  const keys = values ? Object.keys(values) : [];
  if (!o.bare) {
    const head = el('div', 'wm-peek-head', p);
    o.icon(el('span', 'wm-peek-badge', head), 'clipboard-list', '');
    el('span', 'wm-peek-title', head, t('文件屬性'));
    if (values) el('span', 'wm-peek-count', head, t('{n} 個屬性', { n: keys.length }));
  }
  if (data.kind === 'raw') {
    el('pre', 'wm-peek-raw', p, data.text);
  } else if (!keys.length) {
    el('div', 'wm-peek-empty', p, t('這份筆記沒有文件屬性'));
  } else {
    let filter: HTMLInputElement | null = null;
    if (keys.length > PEEK_FILTER_MIN) {
      filter = el('input', 'wm-peek-filter', p);
      filter.type = 'search';
      filter.placeholder = t('篩選屬性…');
    }
    const list = el('div', 'wm-peek-list', p);
    const rows = keys.map(k => ({ k, row: row(list, k, values![k], o), text: (k + ' ' + summarize(values![k])).toLowerCase() }));
    const none = el('div', 'wm-peek-empty', p, t('沒有符合的屬性'));
    none.hidden = true;
    if (filter) {
      const f = filter;
      f.addEventListener('input', () => {
        const q = f.value.trim().toLowerCase();
        let shown = 0;
        for (const r of rows) { const on = !q || r.text.includes(q); r.row.hidden = !on; if (on) shown++; }
        none.hidden = shown > 0;
      });
      // 打開就能直接打字篩選（手機不自動跳出鍵盤）
      if (!o.isMobile) window.setTimeout(() => { if (f.isConnected) f.focus(); }, 0);
    }
  }
  if (o.go) {
    const foot = el('div', 'wm-peek-foot', p);
    const b = el('button', 'wm-peek-go', foot);
    b.type = 'button';
    o.icon(el('span', 'wm-peek-go-icon', b), data.kind === 'none' ? 'plus' : 'arrow-up-to-line', '');
    el('span', null, b, data.kind === 'none' ? t('新增文件屬性') : t('前往文件屬性'));
    const go = o.go;
    b.addEventListener('click', () => go());
  }
}

function row(list: HTMLElement, key: string, value: unknown, o: PropsPeekOptions): HTMLDivElement {
  const type = propType(key, value, o.typeHint ? o.typeHint(key) : null);
  const r = el('div', 'wm-peek-row wm-prop-' + type, list);
  const k = el('div', 'wm-peek-key', r);
  o.icon(el('span', 'wm-peek-icon', k), PROP_ICONS[type], '');
  el('span', 'wm-peek-name', k, key);
  k.setAttribute('aria-label', key);
  const v = el('div', 'wm-peek-value', r);
  if (type === 'list') {
    const arr: unknown[] = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
    const tag = isTagKey(key);
    for (const item of arr) {
      const text = summarize(item);
      el('span', 'wm-chip' + (tag ? ' wm-chip-tag' : ''), v, (tag && !text.startsWith('#') ? '#' : '') + text);
    }
    if (!arr.length) el('span', 'wm-peek-blank', v, t('（空白）'));
    // 很多項目時只顯示三行，點一下看全部
    clampable(v);
  } else if (type === 'checkbox') {
    const cb = el('input', 'wm-peek-check', v);
    cb.type = 'checkbox'; cb.checked = !!value; cb.disabled = true;
  } else {
    const text = summarize(value);
    if (!text) el('span', 'wm-peek-blank', v, t('（空白）'));
    else { el('span', 'wm-peek-text', v, text); clampable(v); }
  }
  return r;
}

// 固定在上方的精簡屬性列：每個屬性一小段「名稱 值」排成一行，清單顯示成小標籤（最多 3 個，其餘寫 +N），
// 放不下的部分由樣式表淡出；完整內容要點開屬性列看
const PIN_LIST_MAX = 3;
export function fillPinSummary(box: HTMLElement, data: PropsPeekData, o: Pick<PropsPeekOptions, 'icon' | 'typeHint'>): void {
  box.replaceChildren();
  if (data.kind === 'none') return;
  if (data.kind === 'raw') { el('span', 'wm-pin-val', box, 'YAML'); return; }
  const keys = Object.keys(data.values);
  if (!keys.length) { el('span', 'wm-pin-empty', box, t('這份筆記沒有文件屬性')); return; }
  for (const key of keys) {
    const value = data.values[key];
    const type = propType(key, value, o.typeHint ? o.typeHint(key) : null);
    const item = el('span', 'wm-pin-item', box);
    el('span', 'wm-pin-key', item, key);
    if (type === 'list') {
      const arr: unknown[] = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
      const tag = isTagKey(key);
      for (const x of arr.slice(0, PIN_LIST_MAX)) {
        const text = summarize(x);
        el('span', 'wm-pin-chip' + (tag ? ' is-tag' : ''), item, (tag && !text.startsWith('#') ? '#' : '') + text);
      }
      if (arr.length > PIN_LIST_MAX) el('span', 'wm-pin-more', item, '+' + (arr.length - PIN_LIST_MAX));
      if (!arr.length) el('span', 'wm-pin-blank', item, '—');
    } else if (type === 'checkbox') {
      const c = el('span', 'wm-pin-check' + (value ? ' is-on' : ''), item);
      o.icon(c, value ? 'check-square' : 'square', value ? '☑' : '☐');
    } else {
      const text = summarize(value);
      el('span', text ? 'wm-pin-val' : 'wm-pin-blank', item, text ? (text.length > 40 ? text.slice(0, 40) + '…' : text) : '—');
    }
  }
}

// 值太長時（超過三行）先收起來，點一下展開、再點一下收起
function clampable(v: HTMLElement): void {
  v.classList.add('is-clamped');
  v.addEventListener('click', () => {
    // 沒有被截掉（內容不到三行）時不用切換，選取文字也不會被打斷
    if (!v.classList.contains('is-more')) return;
    v.classList.toggle('is-clamped');
  });
}

// 小視窗放進畫面、量得到高度之後，標出真的被截掉的值（下緣變淡、可以點開）
export function markOverflow(p: HTMLElement): void {
  for (const v of Array.from(p.querySelectorAll<HTMLElement>('.wm-peek-value.is-clamped'))) v.classList.toggle('is-more', v.scrollHeight > v.clientHeight + 1);
}
