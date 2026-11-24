// 輸入時的自動完成：打 [[ 選筆記（[[筆記# 選標題）、打 # 選標籤，像 Obsidian 的編輯器；
// 在段落開頭打 / 選要插入什麼（斜線選單：標題、清單、表格、圖表…），手機上不用捲功能區找按鈕
// ctx: { enabled(), files(query) → [{ file, label, detail }], resolve(name) → file|null, headings(file|null) → [text],
//        tags(query) → ['#標籤'], linkNode(file|null, heading|null, embed) → 節點, icon(el, name, fallback) }
import { Plugin, PluginKey } from 'prosemirror-state';
import { t } from './i18n.js';
import { el, isRtl, popupLeft, visibleBottom } from './dom.js';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { TFile } from 'obsidian';

// 游標前面正在打的 [[… 或 #…（外掛狀態）；embed 只有連結（![[…）才有
export interface SuggestTrigger {
  kind: 'link' | 'tag' | 'slash';
  embed?: boolean;
  query: string;
  from: number;
  to: number;
}

// ctx.files() 回傳的一筆檔案（complete.js 的 searchFiles 產生）
export interface SuggestFileItem {
  file: TFile;
  label: string;
  detail?: string;
  icon?: string;
}

// 選單裡的一列：標籤（tag）、標題（heading，file 為 null 表示目前這份筆記）或檔案
export interface SuggestItem {
  label: string;
  detail?: string;
  icon: string;
  file?: TFile | null;
  heading?: string;
  tag?: string;
  // 斜線選單的項目：選了之後先刪掉「/查詢」再執行
  run?: (view: EditorView) => void;
}

// 斜線選單的一項（complete.ts 的 slashItems 產生）；keys 是另外可以用來找它的字（英文、縮寫）
export interface SlashItem { label: string; icon: string; keys?: string; detail?: string; run: (view: EditorView) => void; }

// 斜線選單裡符合查詢的項目：名稱或 keys 裡有這段字；開頭就符合的排前面
export function matchSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return items;
  const rank = (it: SlashItem): number => {
    const label = it.label.toLowerCase();
    const keys = (it.keys || '').toLowerCase().split(' ');
    if (label.startsWith(q) || keys.some(k => k.startsWith(q))) return 0;
    return label.includes(q) || keys.some(k => k.includes(q)) ? 1 : -1;
  };
  return items.map(it => ({ it, r: rank(it) })).filter(x => x.r >= 0).sort((a, b) => a.r - b.r).map(x => x.it);
}

// 自動完成需要的外部功能（complete.js 的 suggestContext 產生）
export interface SuggestContext {
  enabled(): boolean;
  files(query: string): SuggestFileItem[];
  resolve(name: string): TFile | null;
  headings(file: TFile | null): string[];
  tags(query: string): string[];
  linkNode(file: TFile | null, heading: string | null, embed: boolean | undefined): PMNode | null;
  // 斜線選單的項目；沒有這個函式（或設定關掉）就沒有斜線選單
  slash?(): SlashItem[];
  icon(el: HTMLElement, name: string, fallback: string): void;
}

interface SuggestUI { view: EditorView; box: HTMLDivElement | null; items: SuggestItem[]; index: number; }

const suggestKey = new PluginKey<SuggestTrigger | null>('wmSuggest');
const LEAF = '￼';

// 游標前面是不是正在打 [[… 或 #…
function suggestTrigger(state: EditorState): SuggestTrigger | null {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  if ((state.storedMarks || $from.marks()).some(m => m.type.name === 'code')) return null;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 200), $from.parentOffset, null, LEAF);
  let m = /(!?)\[\[([^[\]|\n￼]*)$/.exec(before);
  if (m) return { kind: 'link', embed: !!m[1], query: m[2], from: $from.pos - m[0].length, to: $from.pos };
  m = /(^|\s)#([^\s#￼]{1,60})$/.exec(before);
  if (m) return { kind: 'tag', query: m[2], from: $from.pos - m[2].length - 1, to: $from.pos };
  // 斜線選單：只在一般段落的最前面（整段到游標為止只有「/查詢」）。句子中間的 / 是網址、日期、分數，不能跳出來
  if ($from.parent.type.name === 'paragraph') {
    m = /^\/([^\s/￼]{0,24})$/.exec($from.parent.textBetween(0, $from.parentOffset, null, LEAF));
    if (m) return { kind: 'slash', query: m[1], from: $from.pos - m[0].length, to: $from.pos };
  }
  return null;
}

export function suggestPlugin(ctx: SuggestContext): Plugin<SuggestTrigger | null> {
  let ui: SuggestUI | null = null; // { view, box, items, index, active }

  const itemsFor = (active: SuggestTrigger): SuggestItem[] => {
    if (active.kind === 'slash') return ctx.slash ? matchSlash(ctx.slash(), active.query) : [];
    if (active.kind === 'tag') {
      const q = active.query.toLowerCase();
      return ctx.tags(active.query).filter(tag => tag.toLowerCase() !== '#' + q).slice(0, 8).map(tag => ({ label: tag, icon: 'hash', tag }));
    }
    const hash = active.query.indexOf('#');
    if (hash >= 0) {
      const name = active.query.slice(0, hash);
      const file = name ? ctx.resolve(name) : null;
      if (name && !file) return [];
      const q = active.query.slice(hash + 1).toLowerCase();
      return ctx.headings(file).filter(h => h.toLowerCase().includes(q)).slice(0, 8)
        .map(h => ({ label: h, detail: file ? file.basename : t('這份筆記'), icon: 'heading', file, heading: h }));
    }
    return ctx.files(active.query).slice(0, 8).map(r => ({ label: r.label, detail: r.detail, icon: r.icon || 'file-text', file: r.file }));
  };

  const close = () => { if (ui && ui.box) { ui.box.remove(); ui.box = null; ui.items = []; } };

  const pick = (view: EditorView, item: SuggestItem | undefined) => {
    const active = suggestKey.getState(view.state);
    if (!active || !item) return;
    const state = view.state;
    let tr = state.tr;
    if (item.run) {
      // 先把「/查詢」刪掉（段落變回空的），再做選的那件事：對話框、選單都是從空段落開始
      close();
      view.dispatch(tr.delete(active.from, active.to).setMeta(suggestKey, { close: true }));
      view.focus();
      item.run(view);
      return;
    }
    if (item.tag) tr.insertText(item.tag + ' ', active.from, active.to);
    else {
      // 後面已經有 ]]（例如先打好括號再回頭填）就一併取代
      const after = state.doc.textBetween(active.to, Math.min(active.to + 2, state.selection.$from.end()), null, LEAF);
      const node = ctx.linkNode(item.file || null, item.heading || null, active.embed);
      if (!node) return;
      tr = tr.replaceWith(active.from, active.to + (after === ']]' ? 2 : 0), node);
    }
    close();
    view.dispatch(tr.setMeta(suggestKey, { close: true }).scrollIntoView());
    view.focus();
  };

  const render = (view: EditorView) => {
    const active = suggestKey.getState(view.state);
    // 斜線選單有自己的開關（ctx.slash 在關掉時回傳空的清單），不跟著「輸入時自動完成」
    if (!active || (active.kind !== 'slash' && !ctx.enabled())) { close(); return; }
    const items = itemsFor(active);
    if (!items.length) { close(); return; }
    if (!ui) ui = { view, box: null, items: [], index: 0 };
    if (!ui.box) { ui.box = el('div', 'wm-popup wm-suggest', view.dom.ownerDocument.body); ui.index = 0; }
    ui.box.classList.toggle('wm-slash', active.kind === 'slash');
    ui.view = view; ui.items = items;
    if (ui.index >= items.length) ui.index = 0;
    const box = ui.box;
    box.replaceChildren();
    items.forEach((it, i) => {
      const row = el('div', 'wm-suggest-item' + (i === ui!.index ? ' is-selected' : ''), box);
      const ic = el('span', 'wm-suggest-icon', row); ctx.icon(ic, it.icon, '');
      el('span', 'wm-suggest-label', row, it.label);
      if (it.detail) el('span', 'wm-suggest-detail', row, it.detail);
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', () => pick(view, it));
    });
    el('div', 'wm-suggest-hint', box, active.kind === 'slash' ? t('↑↓ 選擇・Enter 插入・Esc 關閉') : active.kind === 'tag' ? t('↑↓ 選擇・Enter 插入標籤・Esc 關閉') : t('↑↓ 選擇・Enter 插入連結・打 # 選標題・Esc 關閉'));
    const cur = box.querySelector<HTMLElement>('.wm-suggest-item.is-selected');
    if (cur && typeof cur.scrollIntoView === 'function') cur.scrollIntoView({ block: 'nearest' });
    // 放在游標下方；超出畫面時往上或往旁邊移。介面由右到左時選單的右緣對齊游標、往左展開（跟 Obsidian 自己的自動完成一樣）
    try {
      const c = view.coordsAtPos(active.from);
      const w = box.offsetWidth || 260; const h = box.offsetHeight || 200;
      const vw = window.innerWidth || 1024; const vh = visibleBottom(window) || 768;
      box.style.left = popupLeft(c, w, vw, isRtl(view.dom)) + 'px';
      box.style.top = (c.bottom + 4 + h > vh && c.top - h - 4 > 0 ? c.top - h - 4 : c.bottom + 4) + 'px';
    } catch { /* 測試環境沒有版面資訊 */ }
  };

  return new Plugin<SuggestTrigger | null>({
    key: suggestKey,
    priority: true, // 排在快速鍵之前，選單開著時 Enter、方向鍵才會先給選單（見 editor.js）
    state: {
      init: () => null,
      apply(tr, old, _o, state) {
        const meta = tr.getMeta(suggestKey) as { close?: boolean } | undefined;
        if (meta && meta.close) return null;
        // 只有打字（文件有變）時才開；只是把游標移到 #標籤 旁邊不會跳出來
        if (tr.docChanged) {
          const trig = suggestTrigger(state);
          return trig && (trig.kind === 'slash' ? !!ctx.slash : ctx.enabled()) ? trig : null;
        }
        if (tr.selectionSet) return null;
        return old;
      },
    },
    view() {
      return { update: view => render(view), destroy: () => { close(); ui = null; } };
    },
    props: {
      handleKeyDown(view, e) {
        if (!ui || !ui.box || !ui.items.length) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          ui.index = (ui.index + (e.key === 'ArrowDown' ? 1 : -1) + ui.items.length) % ui.items.length;
          render(view);
          e.preventDefault();
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(view, ui.items[ui.index]); return true; }
        if (e.key === 'Escape') { close(); view.dispatch(view.state.tr.setMeta(suggestKey, { close: true })); return true; }
        return false;
      },
      handleDOMEvents: { blur: () => { window.setTimeout(close, 150); return false; } },
    },
  });
}

