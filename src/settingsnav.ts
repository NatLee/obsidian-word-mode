// 設定頁上方的分類列：設定分成幾類，一次只顯示一類；分類列上方的搜尋框可以直接找到某個設定。
// 從 main.ts 獨立出來是為了能在介面測試裡實際操作（main.ts 整個外掛進入點沒辦法放進測試）
import { Platform, Scope, setIcon } from 'obsidian';
import type { Keymap } from 'obsidian';
import { t } from './i18n.js';
import { keepFocus, keyboardHints } from './dom.js';
import { searchSettings } from './settingsearch.js';
import type { SearchDoc, SearchHit, TextRange } from './settingsearch.js';

// 分類列的一個按鈕；label 是已翻譯的文字
export interface SettingNavItem<T extends string> { id: T; label: string; icon: string; }

// 畫好的分類列：el 是整條列；select 只更新按鈕的狀態（由外部換分類時用，不會呼叫 onPick）
export interface SettingNav<T extends string> { el: HTMLElement; select(id: T): void; }

// 讓 container（設定頁的外框）只顯示 id 這一類。
// 實際的隱藏寫在 CSS（.wm-settings[data-wm-tab="…"]）：不用 Obsidian 設定定義的 visible，
// 因為 visible 為 false 的群組會被排除在設定搜尋之外，其他分類的設定就搜尋不到了
export function showSettingSection(container: HTMLElement, id: string): void {
  container.dataset.wmTab = id;
}

// 分類列用 position: sticky 留在捲動範圍的上緣，但 sticky 是以外框的內容區為準：外框有上內距時，
// 分類列會停在內距下面，上方空出一截。這裡量出內距記在 --wm-set-pad，樣式表用它把分類列往上移到貼齊上緣。
// 設定頁還沒顯示時量不到，所以等到捲動（這時分類列才需要固定）再量，每次畫設定頁之後只量一次。
// 回傳的函式在重畫設定頁時呼叫，下次捲動會重新量（佈景主題可能換過）
export function trackSettingPadding(container: HTMLElement): () => void {
  let measured = false;
  container.addEventListener('scroll', () => {
    if (measured) return;
    measured = true;
    const pad = parseFloat(getComputedStyle(container).paddingTop);
    container.style.setProperty('--wm-set-pad', (pad > 0 ? pad : 0) + 'px');
  }, { passive: true });
  return () => { measured = false; };
}

// 在 host 裡畫出分類列。按下按鈕（或用方向鍵移動）時呼叫 onPick
export function buildSettingNav<T extends string>(host: HTMLElement, items: readonly SettingNavItem<T>[], active: T, onPick: (id: T) => void): SettingNav<T> {
  const bar = host.createDiv('wm-pills wm-set-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', t('設定分類'));
  const buttons = new Map<T, HTMLButtonElement>();
  const select = (id: T) => {
    for (const [k, b] of buttons) {
      const on = k === id;
      b.toggleClass('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      // 整條列只佔一個 Tab 停駐點，列內用方向鍵移動（頁籤的慣例）
      b.tabIndex = on ? 0 : -1;
    }
  };
  const pick = (id: T, focus?: boolean) => {
    select(id);
    if (focus) buttons.get(id)?.focus();
    onPick(id);
  };
  items.forEach((item, i) => {
    const b = bar.createEl('button', { cls: 'wm-pill wm-set-tab' });
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.tab = item.id;
    setIcon(b.createSpan('wm-pill-icon'), item.icon);
    b.createSpan({ text: item.label });
    b.addEventListener('click', () => pick(item.id));
    b.addEventListener('keydown', e => {
      const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1
          : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      // Obsidian 的設定視窗自己也用方向鍵在各列之間移動，這裡處理掉就不要再往外傳
      e.stopPropagation();
      pick(items[(to + items.length) % items.length].id, true);
    });
    buttons.set(item.id, b);
  });
  select(active);
  return { el: bar, select };
}

// ---- 設定頁的搜尋框：打字時列出符合的設定（自動完成），選一個就切到那一類、捲到那一列並閃一下

// 一筆可以搜尋的設定：section、icon 是所屬分類的名稱（已翻譯）與圖示；common 為 true 的在還沒打字時列在「常用的設定」
export interface SettingSearchItem extends SearchDoc {
  section: string;
  icon: string;
  common?: boolean;
}

export interface SettingSearch { el: HTMLElement; input: HTMLInputElement; }

// 清單最多列幾筆；更多的只顯示還有幾項，多打幾個字縮小範圍
const SHOW = 8;
// 每個搜尋框的清單要有不同的 id（aria-controls、aria-activedescendant 用）
let searchSeq = 0;

// 文字畫進 host，ranges 標成醒目的 <mark>（不用 innerHTML）
function paintRanges(host: HTMLElement, text: string, ranges: readonly TextRange[]): void {
  let at = 0;
  for (const r of ranges) {
    if (r.from > at) host.appendText(text.slice(at, r.from));
    host.createEl('mark', { cls: 'wm-set-find-hl', text: text.slice(r.from, r.to) });
    at = r.to;
  }
  if (at < text.length) host.appendText(text.slice(at));
}

// 這一列裡其他看得到的文字：下拉選單的選項、勾選項目的名稱。搜尋時也比對這些（見 SearchDoc.terms）
export function settingTerms(el: HTMLElement): string[] {
  const out = new Set<string>();
  el.querySelectorAll('option, label').forEach(x => {
    const s = (x.textContent || '').trim();
    if (s && s.length <= 60) out.add(s);
  });
  return [...out].slice(0, 80);
}

const flashTimers = new WeakMap<HTMLElement, number>();

// 捲到 el 那一列並閃一下，讓使用者一眼看到在哪；focus 為 true 時把焦點移到那一列的第一個控制項
// （用鍵盤選的時候，馬上可以按空白鍵切換）
export function revealSetting(el: HTMLElement, focus: boolean): void {
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  // 同一列連續選兩次也要再閃一次：先拿掉、讓瀏覽器重算一次樣式，再加回去
  el.removeClass('wm-set-flash');
  void el.offsetWidth;
  el.addClass('wm-set-flash');
  const old = flashTimers.get(el);
  if (old) window.clearTimeout(old);
  flashTimers.set(el, window.setTimeout(() => el.removeClass('wm-set-flash'), 2200));
  if (focus) {
    const c = el.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
    if (c) c.focus({ preventScroll: true });
  }
}

// Obsidian 的按鍵處理：keymap 是 app.keymap，scope 是 app.scope（見 buildSettingSearch）
export interface SettingSearchKeys { keymap: Keymap; scope: Scope; }

// 在 host 裡畫搜尋框。items 在每次取得焦點時呼叫一次（那時設定頁已經畫好，才收集得到選項的文字）；
// 選了一筆時呼叫 onPick，byKeyboard 表示是按 Enter 選的。
// keys：設定視窗的 Esc 由 Obsidian 的按鍵處理負責，可能比搜尋框先收到、直接關掉整個設定視窗。
// 清單開著或框裡有字時，在 Obsidian 的按鍵處理上推一層只處理 Esc 的 scope，先收起清單、清掉字；都沒有了才拿掉，Esc 照常關掉設定視窗
export function buildSettingSearch<T extends SettingSearchItem>(host: HTMLElement, items: () => T[], onPick: (item: T, byKeyboard: boolean) => void, keys?: SettingSearchKeys): SettingSearch {
  const id = 'wm-set-find-' + (++searchSeq);
  const wrap = host.createDiv('wm-set-find');
  const box = wrap.createDiv('wm-set-find-box');
  setIcon(box.createSpan('wm-set-find-icon'), 'search');
  const input = keyboardHints(box.createEl('input', { cls: 'wm-set-find-input', type: 'search' }), { plain: true, enter: 'search' });
  input.placeholder = t('搜尋設定，例如：縮放、工具列、快速鍵');
  input.setAttribute('aria-label', t('搜尋設定'));
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);
  input.autocomplete = 'off';
  input.spellcheck = false;
  const clear = box.createEl('button', { cls: 'wm-set-find-clear clickable-icon' });
  clear.type = 'button';
  clear.setAttribute('aria-label', t('清除搜尋'));
  setIcon(clear, 'x');
  clear.hidden = true;

  const pop = wrap.createDiv('wm-set-find-pop');
  pop.hidden = true;
  const head = pop.createDiv('wm-set-find-head');
  const list = pop.createDiv('wm-set-find-list');
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('搜尋設定'));
  const more = pop.createDiv('wm-set-find-more');
  const foot = pop.createDiv('wm-set-find-foot');
  for (const [k, label] of [['↑↓', '選擇'], ['Enter', '前往'], ['Esc', '關閉']] as const) {
    const s = foot.createSpan();
    s.createEl('kbd', { text: k });
    s.appendText(' ' + t(label));
  }

  // 這次取得焦點時的設定清單、目前列出的結果與反白的那一筆
  let all: T[] = [];
  let shown: T[] = [];
  let active = 0;
  const rows: HTMLElement[] = [];

  const mark = (i: number, scroll: boolean) => {
    active = i;
    rows.forEach((r, j) => r.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    const r = rows[i];
    if (r) {
      input.setAttribute('aria-activedescendant', r.id);
      if (scroll && typeof r.scrollIntoView === 'function') r.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  // Esc：先收起清單，再清掉打的字。回傳 false 表示沒有東西可以收、可以清（Esc 照常關掉設定視窗）
  const dismiss = (): boolean => {
    if (!pop.hidden) close();
    else if (input.value) { input.value = ''; clear.hidden = true; }
    else return false;
    syncScope();
    return true;
  };
  // 推到 Obsidian 按鍵處理上的那一層（見上方說明）；只在搜尋框有焦點、而且 Esc 有事可做時才推上去
  let scope: Scope | null = null;
  let pushed = false;
  const syncScope = () => {
    if (!keys) return;
    const want = input.ownerDocument.activeElement === input && (!pop.hidden || !!input.value);
    if (want && !pushed) {
      if (!scope) {
        scope = new Scope(keys.scope);
        scope.register([], 'Escape', () => (dismiss() ? false : undefined));
      }
      keys.keymap.pushScope(scope);
      pushed = true;
    } else if (!want && pushed && scope) {
      keys.keymap.popScope(scope);
      pushed = false;
    }
  };
  const close = () => {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    syncScope();
  };
  const pick = (item: T, byKeyboard: boolean) => {
    close();
    // 用滑鼠或手指選的：讓搜尋框失去焦點，手機的螢幕鍵盤才會收起來，看得到捲過去的那一列。
    // 手機上按鍵盤的「搜尋」鍵選的也一樣（電腦上焦點會移到那一列的控制項，手機上不移，不收的話鍵盤就一直開著）
    if (!byKeyboard || Platform.isMobile) input.blur();
    onPick(item, byKeyboard);
  };
  const addRow = (item: T, hit: SearchHit<T> | null) => {
    const r = list.createDiv('wm-set-find-item');
    r.id = id + '-' + rows.length;
    r.setAttribute('role', 'option');
    const top = r.createDiv('wm-set-find-top');
    const name = top.createSpan('wm-set-find-name');
    paintRanges(name, item.name, hit ? hit.name : []);
    const sec = top.createSpan('wm-set-find-sec');
    setIcon(sec.createSpan('wm-set-find-sec-icon'), item.icon);
    sec.createSpan({ text: item.section });
    const snip = hit ? hit.snippet : item.desc ? { text: item.desc, ranges: [], kind: 'desc' as const } : null;
    if (snip) {
      const d = r.createDiv('wm-set-find-snip');
      // 其他語言的文字可能是由右往左寫的（阿拉伯文、希伯來文）
      d.dir = 'auto';
      if (snip.kind === 'term') d.createSpan({ cls: 'wm-set-find-via', text: t('包含') + t('：') });
      else if (snip.kind === 'alt') {
        const g = d.createSpan('wm-set-find-via wm-set-find-lang');
        g.setAttribute('aria-label', t('其他語言'));
        setIcon(g, 'languages');
      }
      paintRanges(d, snip.text, snip.ranges);
    }
    const i = rows.length;
    // 按下時不要讓搜尋框失去焦點（失去焦點會先把清單收起來，就點不到了）
    keepFocus(r);
    r.addEventListener('click', () => pick(item, false));
    r.addEventListener('mousemove', () => { if (active !== i) mark(i, false); });
    rows.push(r);
    shown.push(item);
  };
  const render = () => {
    const q = input.value;
    clear.hidden = !q;
    list.empty();
    rows.length = 0;
    shown = [];
    more.setText('');
    const commons = all.filter(x => x.common);
    if (!q.trim()) {
      head.setText(t('常用的設定'));
      for (const x of commons) addRow(x, null);
    } else {
      const hits = searchSettings(all, q);
      if (hits.length) {
        head.setText(t('{n} 項符合', { n: hits.length }));
        for (const h of hits.slice(0, SHOW)) addRow(h.doc, h);
        if (hits.length > SHOW) more.setText(t('還有 {n} 項，多打幾個字可以縮小範圍', { n: hits.length - SHOW }));
      } else {
        // 找不到時仍然列出常用的設定，不要讓使用者面對一片空白
        head.setText(t('找不到「{q}」相關的設定。換個說法試試，或從下面的分類找找看。', { q: q.trim() }));
        for (const x of commons) addRow(x, null);
      }
    }
    more.hidden = !more.textContent;
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    mark(rows.length ? 0 : -1, false);
    syncScope();
  };

  // 手機：搜尋框有焦點時，手指在搜尋框以外的地方按下（捲動設定頁、點別的設定）就讓它失去焦點、收起鍵盤。
  // iOS 點在不能取得焦點的地方不會自己收鍵盤，設定頁又沒有其他收鍵盤的方法。結果清單裡的點擊由 pick 處理
  const doc = input.ownerDocument;
  const outside = (e: TouchEvent): void => {
    const target = e.target as Node | null;
    if (target && wrap.contains(target)) return;
    input.blur();
  };
  input.addEventListener('focus', () => {
    all = items(); render();
    if (Platform.isMobile) doc.addEventListener('touchstart', outside, { capture: true, passive: true });
  });
  input.addEventListener('input', render);
  input.addEventListener('blur', () => {
    close();
    doc.removeEventListener('touchstart', outside, { capture: true });
  });
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // Obsidian 的設定視窗自己也用方向鍵在各列之間移動，這裡處理掉就不要再往外傳
      e.stopPropagation();
      if (pop.hidden) { render(); return; }
      if (!rows.length) return;
      mark((active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length, true);
    } else if (e.key === 'Enter') {
      // 手機上沒有結果可以選時按「搜尋」鍵：當成打完了，收起鍵盤
      if (pop.hidden || !shown[active]) { if (Platform.isMobile) { e.preventDefault(); input.blur(); } return; }
      e.preventDefault();
      e.stopPropagation();
      pick(shown[active], true);
    } else if (e.key === 'Escape') {
      // 已經由推上去的 scope 處理過（Obsidian 的按鍵處理先收到）就不要再做一次
      if (e.defaultPrevented) return;
      if (!dismiss()) return;
      e.preventDefault();
      e.stopPropagation();
    }
  });
  keepFocus(clear);
  clear.addEventListener('click', () => {
    input.value = '';
    input.focus();
    render();
  });
  return { el: wrap, input };
}
