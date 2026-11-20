// 輸入時的自動完成：打 [[ 選筆記（[[筆記# 選標題）、打 # 選標籤，像 Obsidian 的編輯器
// ctx: { enabled(), files(query) → [{ file, label, detail }], resolve(name) → file|null, headings(file|null) → [text],
//        tags(query) → ['#標籤'], linkNode(file|null, heading|null, embed) → 節點, icon(el, name, fallback) }
import { Plugin, PluginKey } from 'prosemirror-state';
import { t } from './i18n.js';
import { el } from './dom.js';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { TFile } from 'obsidian';

// 游標前面正在打的 [[… 或 #…（外掛狀態）；embed 只有連結（![[…）才有
export interface SuggestTrigger {
  kind: 'link' | 'tag';
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
}

// 自動完成需要的外部功能（complete.js 的 suggestContext 產生）
export interface SuggestContext {
  enabled(): boolean;
  files(query: string): SuggestFileItem[];
  resolve(name: string): TFile | null;
  headings(file: TFile | null): string[];
  tags(query: string): string[];
  linkNode(file: TFile | null, heading: string | null, embed: boolean | undefined): PMNode | null;
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
  return null;
}

export function suggestPlugin(ctx: SuggestContext): Plugin<SuggestTrigger | null> {
  let ui: SuggestUI | null = null; // { view, box, items, index, active }

  const itemsFor = (active: SuggestTrigger): SuggestItem[] => {
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
    if (!active || !ctx.enabled()) { close(); return; }
    const items = itemsFor(active);
    if (!items.length) { close(); return; }
    if (!ui) ui = { view, box: null, items: [], index: 0 };
    if (!ui.box) { ui.box = el('div', 'wm-popup wm-suggest', view.dom.ownerDocument.body); ui.index = 0; }
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
    el('div', 'wm-suggest-hint', box, active.kind === 'tag' ? t('↑↓ 選擇・Enter 插入標籤・Esc 關閉') : t('↑↓ 選擇・Enter 插入連結・打 # 選標題・Esc 關閉'));
    // 放在游標下方；超出畫面時往上或往左移
    try {
      const c = view.coordsAtPos(active.from);
      const w = box.offsetWidth || 260; const h = box.offsetHeight || 200;
      const vw = window.innerWidth || 1024; const vh = window.innerHeight || 768;
      box.style.left = Math.max(4, Math.min(c.left, vw - w - 4)) + 'px';
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
        if (tr.docChanged) return ctx.enabled() ? suggestTrigger(state) : null;
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

