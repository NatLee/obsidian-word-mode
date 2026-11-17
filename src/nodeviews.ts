import { TableView } from 'prosemirror-tables';
import { CALLOUT_TYPES, calloutIcon, CODE_LANGUAGES } from './commands.js';
import { t, key } from './i18n.js';
import { FOOTNOTE_DEF, FOOTNOTE_REF, footnoteBody } from './footnotes.js';
import { el } from './dom.js';
import type { Attrs, Node as PMNode } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';
import type { EditorView, NodeView, NodeViewConstructor, ViewMutationRecord } from 'prosemirror-view';
import type { EmbedHandle, MediaKind } from './embeds.js';
import type { TextCallback } from './dialogs.js';
import type { I18nKey } from './i18n.js';

// 右鍵選單的一個項目（ctx.menu 用）
export interface NodeViewMenuItem { title: string; icon?: string; run: () => void; }

// 節點顯示元件需要的外部功能，由 view.js 的 nodeViewContext() 提供（Obsidian 端的實作）。
// 標成可省略（?）的成員，顯示元件用之前都會先檢查；沒有提供時只少那一項功能。
export interface NodeViewContext {
  // 在 el 裡放 Obsidian 的圖示；圖示不存在時改顯示 fallback 文字
  icon(el: HTMLElement, name: string, fallback: string): void;
  // ---- 連結
  openLink(target: string, newLeaf: boolean): void;
  isResolved(target: string): boolean;
  // 滑鼠移到筆記連結上：交給 Obsidian 的頁面預覽
  hoverLink?(event: MouseEvent, linktext: string, targetEl: HTMLElement): void;
  // pos 是 getPos() 的結果，可能是 undefined
  editLinkAt(pos: number | undefined): void;
  // ---- 圖片
  // 圖片節點的屬性 → 可以顯示的網址；找不到檔案時是 null
  resolveImage(attrs: Attrs): string | null;
  imageMenu(evt: MouseEvent, pos: number): void;
  setImageWidth(pos: number, width: number): void;
  pageWidth(): number;
  // ---- 內嵌、用 Obsidian 顯示 Markdown
  mediaKind?(src: string): MediaKind;
  renderEmbed?(target: string, el: HTMLElement): EmbedHandle;
  renderBlock?(src: string, el: HTMLElement): EmbedHandle;
  renderMarkdown(src: string, el: HTMLElement): void;
  renderMath(src: string, el: HTMLElement, display: boolean): void;
  // 這個語言（程式碼區塊的 params）在 Obsidian 會不會顯示成結果
  canPreview?(lang: string): boolean;
  // ---- 對話框、選單、通知
  editSource(title: string, src: string, onSave: TextCallback): void;
  prompt(title: string, value: string, placeholder: string, onSave: TextCallback): void;
  // pos 是 getPos() 的結果，可能是 undefined
  editMath?(pos: number | undefined, src: string, display: boolean): void;
  editMermaid?(pos: number): void;
  menu(evt: MouseEvent, items: NodeViewMenuItem[]): void;
  notice?(message: string): void;
  // ---- 註腳
  // 註腳的內容；找不到定義時是 null
  footnoteText?(id: string): string | null;
  gotoFootnote?(id: string): void;
  editFootnote?(id: string): void;
  // ---- 文件屬性（frontmatter）
  parseYaml(text: string): unknown;
  stringifyYaml(obj: PropValues): string;
  propsOpen(): boolean;
  setPropsOpen(open: boolean): void;
  // Obsidian 為這個屬性設定的類型（text、multitext、number、checkbox、date、datetime…）
  propertyType?(key: string): string | null | undefined;
  // ---- 提示框
  // pos 是 getPos() 的結果，可能是 undefined
  unwrapCallout(pos: number | undefined): void;
}

// 文件屬性區塊的 DOM：view.js 的 openProperties() 呼叫 wmOpen() 展開它
export interface FrontmatterDom extends HTMLDivElement { wmOpen?: () => void; }

// 文件屬性的內容（YAML 解析後的物件）
export type PropValues = Record<string, unknown>;

// 任務狀態：[核取方塊裡的字元, 名稱（翻譯前）, 圖示]
export type TaskStatus = [ch: string, label: I18nKey, icon: string];

// 節點在文件裡的位置；節點顯示元件已經不在畫面上時是 undefined
type GetPos = () => number | undefined;

// node.attrs 的可修改版本（Attrs 是唯讀的）
type MutableAttrs = { -readonly [K in keyof Attrs]: Attrs[K] };

// 特殊節點的顯示方式（ctx 由 Obsidian 端提供）
// ctx: { openLink(target, newLeaf), isResolved(target), resolveImage(attrs) -> url|null,
//        renderMarkdown(src, el), renderMath(src, el, display), editSource(title, src, onSave), menu(evt, items) }

const isMod = (e: MouseEvent): boolean => e.ctrlKey || e.metaKey;

function displayTarget(tv: string): string {
  return tv.replace(/\.md$/i, '').replace(/#\^?/, ' › ');
}

class WikilinkView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: HTMLSpanElement;
  declare handle: EmbedHandle | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('span', 'wm-wikilink');
    this.dom.addEventListener('mousedown', e => {
      if (isMod(e) && e.button === 0) { e.preventDefault(); e.stopPropagation(); ctx.openLink(this.node.attrs.target, e.shiftKey); }
    });
    this.dom.addEventListener('mouseover', e => { if (ctx.hoverLink) ctx.hoverLink(e, this.node.attrs.target, this.dom); });
    this.dom.addEventListener('contextmenu', e => {
      const pos = this.getPos();
      ctx.menu(e, [
        { title: t('開啟連結'), icon: 'file-input', run: () => ctx.openLink(this.node.attrs.target, false) },
        { title: t('在新分頁開啟'), icon: 'file-plus', run: () => ctx.openLink(this.node.attrs.target, true) },
        { title: t('編輯連結…'), icon: 'pencil', run: () => ctx.editLinkAt(pos) },
      ]);
    });
    this.render();
  }
  render(): void {
    const a = this.node.attrs;
    this.dispose();
    this.dom.replaceChildren();
    this.dom.classList.toggle('is-embed', !!a.embed);
    this.dom.classList.toggle('is-unresolved', !this.ctx.isResolved(a.target));
    // 內嵌（![[筆記]]、![[錄音.mp3]]、![[文件.pdf]]…）：顯示內容，跟 Obsidian 的閱讀畫面一樣
    const embed = !!a.embed && !!this.ctx.renderEmbed;
    this.dom.classList.toggle('wm-embed', embed);
    if (embed) { this.handle = this.ctx.renderEmbed!(a.target, this.dom); return; }
    if (a.embed) { const i = el('span', 'wm-inline-icon', this.dom); this.ctx.icon(i, 'file-text', ''); }
    this.dom.appendChild(document.createTextNode(a.alias || displayTarget(a.target)));
  }
  dispose(): void { if (this.handle) { try { this.handle.unload(); } catch (e) { /* 忽略 */ } this.handle = null; } }
  destroy(): void { this.dispose(); }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = !node.sameMarkup(this.node);
    this.node = node;
    if (changed) this.render();
    return true;
  }
  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
  ignoreMutation(): boolean { return true; }
  // 內嵌的播放器、影片要能直接操作
  stopEvent(e: Event): boolean { return e.type === 'contextmenu' || !!(e.target && (e.target as Element).closest && (e.target as Element).closest('audio, video, iframe')); }
}

export function parseWidth(attrs: Attrs): number | null {
  let w = attrs.width;
  if (!w && !attrs.wiki && attrs.alt) { const m = /\|(\d+)(?:x(\d+))?$/.exec(attrs.alt); if (m) w = m[1]; }
  if (!w) return null;
  const m = /^(\d+)/.exec(String(w));
  return m ? +m[1] : null;
}

export function imageAttrsWithWidth(attrs: Attrs, w: number | null): Attrs {
  const a: MutableAttrs = Object.assign({}, attrs);
  a.width = w ? String(Math.round(w)) : null;
  if (!a.wiki && a.alt) a.alt = a.alt.replace(/\|\d+(x\d+)?$/, '') || null;
  return a;
}

class ImageView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: HTMLSpanElement;
  declare img: HTMLImageElement;
  declare missing: HTMLSpanElement;
  declare embedEl: HTMLSpanElement;
  declare badge: HTMLSpanElement;
  declare embedKey: string | null | undefined;
  declare handle: EmbedHandle | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('span', 'wm-image');
    this.img = el('img', null, this.dom);
    this.img.draggable = false;
    this.missing = el('span', 'wm-image-missing', this.dom);
    this.embedEl = el('span', 'wm-embed-host', this.dom);
    this.badge = el('span', 'wm-image-badge', this.dom);
    for (const dir of [-1, 1]) {
      const h = el('span', 'wm-image-handle ' + (dir < 0 ? 'is-left' : 'is-right'), this.dom);
      h.setAttribute('aria-label', t('拖曳調整大小'));
      // pointer 事件同時支援滑鼠與觸控（手機、平板）
      h.addEventListener('pointerdown', e => this.startResize(e, dir));
    }
    this.img.addEventListener('load', () => this.updateBadge());
    this.dom.addEventListener('contextmenu', e => { const pos = this.getPos(); if (pos != null) ctx.imageMenu(e, pos); });
    this.render();
  }
  render(): void {
    const a = this.node.attrs;
    // ![](…) 也可能是影片、錄音、PDF、筆記或 YouTube：顯示成內嵌的內容，不是破圖
    const kind = this.ctx.mediaKind ? this.ctx.mediaKind(a.src) : 'image';
    const embed = kind !== 'image' && kind !== 'missing' && !!this.ctx.renderEmbed;
    this.dom.classList.toggle('wm-embed', embed);
    if (embed) {
      if (this.embedKey !== a.src) { this.dispose(); this.embedKey = a.src; this.handle = this.ctx.renderEmbed!(a.src, this.embedEl); }
      return;
    }
    if (this.embedKey != null) { this.dispose(); this.embedKey = null; this.embedEl.replaceChildren(); }
    const url = this.ctx.resolveImage(a);
    if (url) {
      if (this.img.getAttribute('src') !== url) this.img.src = url;
      this.img.style.display = '';
      this.missing.hide();
    } else {
      this.img.hide();
      this.missing.style.display = '';
      this.missing.replaceChildren();
      const i = el('span', 'wm-inline-icon', this.missing); this.ctx.icon(i, 'image-off', '');
      this.missing.appendChild(document.createTextNode(t('找不到圖片：') + a.src));
    }
    this.img.alt = (a.alt || '').replace(/\|\d+(x\d+)?$/, '');
    const w = parseWidth(a);
    this.img.style.width = w ? w + 'px' : '';
    this.updateBadge();
  }
  updateBadge(w?: number): void {
    const width = w || parseWidth(this.node.attrs);
    this.badge.textContent = width ? width + ' px' : (this.img.naturalWidth ? t('原始 ') + this.img.naturalWidth + ' px' : t('原始大小'));
  }
  setWidth(w: number): void {
    const pos = this.getPos();
    if (pos == null) return;
    this.ctx.setImageWidth(pos, w);
  }
  startResize(e: PointerEvent, dir: number): void {
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startW = this.img.getBoundingClientRect().width || this.img.naturalWidth || 200;
    const maxW = this.ctx.pageWidth();
    const calc = (ev: PointerEvent): number => Math.min(maxW, Math.max(40, Math.round((startW + dir * (ev.clientX - startX)) / 10) * 10));
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 舊環境 */ }
    this.dom.classList.add('is-resizing');
    const move = (ev: PointerEvent): void => { const w = calc(ev); this.img.style.width = w + 'px'; this.updateBadge(w); };
    const up = (ev: PointerEvent): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      window.removeEventListener('pointerup', up);
      this.dom.classList.remove('is-resizing');
      this.setWidth(calc(ev));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    window.addEventListener('pointerup', up);
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node; this.render();
    return true;
  }
  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
  dispose(): void { if (this.handle) { try { this.handle.unload(); } catch (e) { /* 忽略 */ } this.handle = null; } }
  destroy(): void { this.dispose(); }
  stopEvent(e: Event): boolean {
    return (e.target && (e.target as Element).classList && (e.target as Element).classList.contains('wm-image-handle')) || e.type === 'contextmenu'
      || !!(e.target && (e.target as Element).closest && (e.target as Element).closest('audio, video, iframe'));
  }
  ignoreMutation(): boolean { return true; }
}

const RAW_LABEL: Record<string, string> = {
  callout: t('提示框'), html: 'HTML', math: t('數學式'), comment: t('註解'), raw: t('Markdown 原文'), footnote: t('註腳'),
};

class RawBlockView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: HTMLDivElement;
  declare label: HTMLDivElement;
  declare body: HTMLDivElement;
  declare handle: EmbedHandle | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'wm-raw-block');
    this.dom.contentEditable = 'false';
    this.label = el('div', 'wm-raw-label', this.dom);
    this.body = el('div', 'wm-raw-body', this.dom);
    this.dom.addEventListener('dblclick', e => { e.preventDefault(); this.edit(); });
    this.dom.addEventListener('mousedown', e => {
      const a = (e.target as Element).closest && (e.target as Element).closest('a');
      if (a && isMod(e)) {
        e.preventDefault(); e.stopPropagation();
        const href = a.getAttribute('data-href') || a.getAttribute('href');
        if (href) ctx.openLink(href, e.shiftKey);
      }
    });
    this.dom.addEventListener('click', e => { if ((e.target as Element).closest && (e.target as Element).closest('a')) e.preventDefault(); }, true);
    // 右鍵選單由編輯器統一處理（view.onContextMenu）
    this.render();
  }
  render(): void {
    const a = this.node.attrs;
    // RAW_LABEL 的值是載入時 t() 的結果或 'HTML'，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    this.label.textContent = t((RAW_LABEL[a.kind] || RAW_LABEL.raw) as I18nKey) + t('（按兩下編輯）');
    this.dom.dataset.kind = a.kind;
    this.body.replaceChildren();
    this.dispose();
    const fn = a.kind === 'footnote' && FOOTNOTE_DEF.exec(a.src);
    if (fn) {
      // 註腳定義：顯示編號與內容（內容照 Markdown 顯示）
      this.label.textContent = t('註腳') + ' ' + fn[1] + t('（按兩下編輯）');
      const body = footnoteBody(a.src);
      if (!body.trim()) this.body.textContent = t('（空白）');
      else if (this.ctx.renderBlock) this.handle = this.ctx.renderBlock(body, this.body);
      else this.body.textContent = body;
      return;
    }
    if (a.kind === 'comment') { el('pre', 'wm-raw-comment', this.body, a.src); return; }
    if (this.ctx.renderBlock) this.handle = this.ctx.renderBlock(a.src, this.body);
    else this.ctx.renderMarkdown(a.src, this.body);
  }
  // 釋放上一次顯示用到的資源（Obsidian 的顯示元件）
  dispose(): void { if (this.handle) { try { this.handle.unload(); } catch (e) { /* 忽略 */ } this.handle = null; } }
  destroy(): void { this.dispose(); }
  edit(): void {
    const fn = this.node.attrs.kind === 'footnote' && FOOTNOTE_DEF.exec(this.node.attrs.src);
    if (fn && this.ctx.editFootnote) { this.ctx.editFootnote(fn[1]); return; }
    const mm = this.node.attrs.kind === 'math' && /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec(this.node.attrs.src);
    if (mm && this.ctx.editMath) { this.ctx.editMath(this.getPos(), mm[1].trim(), true); return; }
    // RAW_LABEL 的值是載入時 t() 的結果或 'HTML'，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    this.ctx.editSource(t('編輯') + t((RAW_LABEL[this.node.attrs.kind] || RAW_LABEL.raw) as I18nKey), this.node.attrs.src, value => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: value.replace(/\s+$/, '') })));
    });
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src || node.attrs.kind !== this.node.attrs.kind;
    this.node = node;
    if (changed) this.render();
    return true;
  }
  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e: Event): boolean { return e.type === 'dblclick' || (e.type === 'mousedown' && isMod(e as MouseEvent)); }
  ignoreMutation(): boolean { return true; }
}

class RawInlineView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: HTMLSpanElement;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('span', 'wm-raw-inline');
    this.dom.addEventListener('dblclick', e => { e.preventDefault(); this.edit(); });
    // 註腳：滑鼠移上去顯示內容；按住 Ctrl／Cmd 點一下跳到內容
    this.dom.addEventListener('mouseenter', () => this.footnoteTip());
    this.dom.addEventListener('mousedown', e => {
      const m = FOOTNOTE_REF.exec(this.node.attrs.src);
      if (m && isMod(e) && e.button === 0 && this.ctx.gotoFootnote) { e.preventDefault(); e.stopPropagation(); this.ctx.gotoFootnote(m[1]); }
    });
    this.render();
  }
  footnoteTip(): void {
    const m = FOOTNOTE_REF.exec(this.node.attrs.src);
    if (!m || !this.ctx.footnoteText) return;
    const text = this.ctx.footnoteText(m[1]);
    this.dom.classList.toggle('is-missing', text == null);
    this.dom.setAttribute('aria-label', text == null ? t('找不到這個註腳的內容（按兩下新增）') : t('註腳') + ' ' + m[1] + '\n' + text);
  }
  render(): void {
    const s = this.node.attrs.src;
    this.dom.replaceChildren();
    this.dom.className = 'wm-raw-inline';
    let m: RegExpExecArray | null;
    if ((m = /^\$\$([\s\S]+)\$\$$/.exec(s)) || (m = /^\$([^$][\s\S]*)\$$/.exec(s))) {
      this.dom.classList.add('is-math');
      this.ctx.renderMath(m[1], this.dom, false);
      this.dom.setAttribute('aria-label', t('方程式（按兩下或按右鍵編輯）') + '\n' + m[1].trim());
    } else if (/^%%[\s\S]*%%$/.test(s)) {
      this.dom.classList.add('is-comment');
      this.ctx.icon(this.dom, 'message-square', t('註'));
      this.dom.setAttribute('aria-label', t('註解（閱讀模式不顯示，點一下編輯）') + '\n' + s.slice(2, -2).trim());
    } else if ((m = /^\[\^([^\]]+)\]$/.exec(s))) {
      this.dom.classList.add('is-footnote');
      this.dom.textContent = '[' + m[1] + ']';
      this.footnoteTip();
    } else if (s.startsWith('^[') && s.endsWith(']')) {
      // 行內註腳 ^[內容]：顯示成註腳記號，內容在提示裡
      this.dom.classList.add('is-footnote', 'is-footnote-inline');
      this.dom.textContent = '※';
      this.dom.setAttribute('aria-label', t('註腳') + '\n' + s.slice(2, -1));
    } else {
      this.dom.classList.add('is-source');
      this.dom.textContent = s;
    }
  }
  edit(): void {
    const m = /^\$\$([\s\S]+)\$\$$/.exec(this.node.attrs.src) || /^\$([^$][\s\S]*)\$$/.exec(this.node.attrs.src);
    if (m && this.ctx.editMath) { this.ctx.editMath(this.getPos(), m[1].trim(), false); return; }
    const fn = FOOTNOTE_REF.exec(this.node.attrs.src);
    if (fn && this.ctx.editFootnote) { this.ctx.editFootnote(fn[1]); return; }
    this.ctx.editSource(t('編輯原文'), this.node.attrs.src, value => {
      const pos = this.getPos();
      if (pos == null || !value) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { src: value }));
    });
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (changed) this.render();
    return true;
  }
  stopEvent(e: Event): boolean { return e.type === 'dblclick'; }
  ignoreMutation(): boolean { return true; }
}

// 文件屬性（frontmatter / metadata）：像 Word 的「摘要資訊」，以表單編輯，存回 YAML
const LIST_KEYS = /^(tags|aliases|cssclasses|cssclass|alias|tag)$/i;
type PropType = 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' | 'object';
function propType(key: string, value: unknown, hint?: string | null): PropType {
  if (hint === 'multitext' || hint === 'tags' || hint === 'aliases' || Array.isArray(value) || LIST_KEYS.test(key)) return 'list';
  if (hint === 'checkbox' || typeof value === 'boolean') return 'checkbox';
  if (hint === 'number' || typeof value === 'number') return 'number';
  if (hint === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date';
  if (hint === 'datetime' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))) return 'datetime';
  if (value && typeof value === 'object') return 'object';
  return 'text';
}
const TYPE_LABEL: Record<PropType, string> = { text: t('文字'), list: t('清單'), number: t('數字'), checkbox: t('核取方塊'), date: t('日期'), datetime: t('日期時間'), object: t('其他') };
const TYPE_ICON: Record<PropType, string> = { text: 'text', list: 'list', number: 'binary', checkbox: 'check-square', date: 'calendar', datetime: 'clock', object: 'braces' };

class FrontmatterView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: FrontmatterDom;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'wm-props');
    this.dom.contentEditable = 'false';
    this.dom.wmOpen = () => { this.ctx.setPropsOpen(true); this.render(); };
    this.render();
  }
  inner(): string { return this.node.attrs.src.replace(/^---[^\n]*\r?\n/, '').replace(/\r?\n?(---|\.\.\.)\s*$/, ''); }
  data(): PropValues | null {
    const tv = this.inner();
    if (!tv.trim()) return {};
    try {
      const o = this.ctx.parseYaml(tv);
      return o && typeof o === 'object' && !Array.isArray(o) ? o as PropValues : null;
    } catch (e) { return null; }
  }
  commit(obj: PropValues): void {
    const pos = this.getPos();
    if (pos == null) return;
    const body = Object.keys(obj).length ? this.ctx.stringifyYaml(obj).replace(/\s+$/, '') + '\n' : '';
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: '---\n' + body + '---' })));
  }
  // 移除整個文件屬性區塊（可以用復原鍵救回來）
  remove(): void {
    const pos = this.getPos();
    if (pos == null) return;
    const had = !!this.inner().trim();
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
    if (had && this.ctx.notice) this.ctx.notice(t('已移除文件屬性，{k} 可以復原', { k: key('Mod+Z') }));
  }
  editRaw(): void {
    this.ctx.editSource(t('編輯文件屬性（YAML 原文）'), this.node.attrs.src, value => {
      const pos = this.getPos();
      if (pos == null) return;
      let v = value.replace(/\s+$/, '');
      if (!/^---\r?\n/.test(v)) v = '---\n' + v;
      if (!/\n(---|\.\.\.)$/.test(v)) v += '\n---';
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: v })));
    });
  }
  render(): void {
    const open = this.ctx.propsOpen();
    const d = this.dom;
    d.replaceChildren();
    const obj = this.data();
    const head = el('div', 'wm-props-head', d);
    const chev = el('span', 'wm-props-chev', head); this.ctx.icon(chev, open ? 'chevron-down' : 'chevron-right', open ? '▾' : '▸');
    el('span', 'wm-props-title', head, t('文件屬性'));
    el('span', 'wm-props-count', head, obj ? Object.keys(obj).length + ' 項' : 'YAML');
    head.addEventListener('mousedown', e => { e.preventDefault(); this.ctx.setPropsOpen(!this.ctx.propsOpen()); this.render(); });
    const raw = el('button', 'wm-props-raw', head); raw.type = 'button'; raw.setAttribute('aria-label', t('編輯 YAML 原文')); this.ctx.icon(raw, 'code-2', t('原文'));
    raw.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.editRaw(); });
    const rm = el('button', 'wm-props-raw wm-props-remove', head); rm.type = 'button'; rm.setAttribute('aria-label', t('移除文件屬性')); this.ctx.icon(rm, 'trash-2', t('移除'));
    rm.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.remove(); });
    if (!open) return;
    const body = el('div', 'wm-props-body', d);
    if (!obj) {
      el('div', 'wm-props-note', body, t('這份文件屬性的格式比較特殊，請按右上角「原文」編輯。'));
      el('pre', 'wm-fm-body', body, this.inner());
      return;
    }
    for (const key of Object.keys(obj)) this.row(body, obj, key);
    this.addRow(body, obj);
  }
  row(body: HTMLElement, obj: PropValues, key: string): void {
    const value = obj[key];
    const type = propType(key, value, this.ctx.propertyType && this.ctx.propertyType(key));
    const r = el('div', 'wm-prop', body);
    const k = el('div', 'wm-prop-key', r);
    const ic = el('span', 'wm-prop-icon', k); this.ctx.icon(ic, TYPE_ICON[type], '');
    el('span', null, k, key);
    // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    k.setAttribute('aria-label', key + t('（') + t(TYPE_LABEL[type] as I18nKey) + t('）'));
    const v = el('div', 'wm-prop-value', r);
    const set = (nv: unknown): void => { const o = Object.assign({}, obj); o[key] = nv; this.commit(o); };
    if (type === 'list') {
      const arr: unknown[] = Array.isArray(value) ? value.slice() : (value == null || value === '' ? [] : [value]);
      arr.forEach((item, i) => {
        const chip = el('span', 'wm-chip', v, String(item));
        const x = el('span', 'wm-chip-x', chip, '×');
        x.setAttribute('aria-label', t('移除'));
        x.addEventListener('mousedown', e => { e.preventDefault(); const a = arr.slice(); a.splice(i, 1); set(a); });
      });
      const inp = el('input', 'wm-prop-input wm-chip-input', v);
      inp.placeholder = t('新增…');
      const add = () => {
        const tv = inp.value.trim().replace(/^#/, '');
        if (!tv) return;
        set(arr.concat(tv.split(/[,，]\s*/).filter(Boolean)));
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      inp.addEventListener('blur', add);
    } else if (type === 'checkbox') {
      const cb = el('input', 'wm-prop-check', v); cb.type = 'checkbox'; cb.checked = !!value;
      cb.addEventListener('change', () => set(cb.checked));
    } else if (type === 'object') {
      el('code', 'wm-prop-object', v, JSON.stringify(value));
      v.setAttribute('aria-label', t('巢狀資料請用「原文」編輯'));
    } else {
      const inp = el('input', 'wm-prop-input', v);
      inp.type = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text';
      inp.value = value == null ? '' : String(value).slice(0, type === 'datetime' ? 16 : undefined);
      inp.placeholder = t('（空白）');
      const save = () => {
        let nv: string | number | null = inp.value;
        if (type === 'number') nv = nv === '' ? null : Number(nv);
        else if (nv === '') nv = null;
        if (nv === value || (nv === null && value == null)) return;
        set(nv);
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('change', save);
    }
    const del = el('button', 'wm-prop-del', r); del.type = 'button'; del.setAttribute('aria-label', t('刪除這個屬性')); this.ctx.icon(del, 'x', '×');
    del.addEventListener('mousedown', e => { e.preventDefault(); const o = Object.assign({}, obj); delete o[key]; this.commit(o); });
  }
  addRow(body: HTMLElement, obj: PropValues): void {
    const r = el('div', 'wm-prop wm-prop-add', body);
    const k = el('input', 'wm-prop-input', r); k.placeholder = t('＋ 新增屬性名稱');
    const tv = el('select', 'wm-prop-type dropdown', r);
    // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    for (const [val, label] of Object.entries(TYPE_LABEL)) { if (val === 'object') continue; const o = el('option', null, tv, t(label as I18nKey)); o.value = val; }
    const go = () => {
      const key = k.value.trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(obj, key)) { k.select(); return; }
      const init = { text: '', list: [], number: 0, checkbox: false, date: (window.moment ? window.moment().format('YYYY-MM-DD') : new Date().toISOString().slice(0, 10)), datetime: (window.moment ? window.moment().format('YYYY-MM-DDTHH:mm') : new Date().toISOString().slice(0, 16)) }[tv.value as Exclude<PropType, 'object'>];
      const o = Object.assign({}, obj); o[key] = init === '' ? null : init;
      this.commit(o);
    };
    k.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const b = el('button', 'wm-prop-addbtn', r, t('新增')); b.type = 'button';
    b.addEventListener('mousedown', e => { e.preventDefault(); go(); });
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (changed) this.render();
    return true;
  }
  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(): boolean { return true; }
  ignoreMutation(): boolean { return true; }
}

// 任務的狀態（- [/]、- [-] 等是 Tasks 外掛與許多佈景主題通用的寫法）
export const TASK_STATUSES: TaskStatus[] = [[' ', '待辦', 'square'], ['x', '完成', 'check-square'], ['/', '進行中', 'loader'], ['-', '已取消', 'minus-square'], ['>', '已延後', 'arrow-right-square'], ['!', '重要', 'alert-circle'], ['?', '有疑問', 'help-circle']];

class ListItemView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare dom: HTMLLIElement;
  declare cb: HTMLInputElement | undefined;
  declare contentDOM: HTMLDivElement;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx?: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = document.createElement('li');
    if (node.attrs.checked != null) {
      this.dom.className = 'wm-task';
      this.cb = el('input', 'task-list-item-checkbox', this.dom);
      this.cb.type = 'checkbox';
      this.cb.contentEditable = 'false';
      this.cb.addEventListener('mousedown', e => {
        e.preventDefault();
        const pos = this.getPos();
        if (pos == null) return;
        // 點一下：未完成 ⇄ 完成；自訂狀態（/、-、> 等）點一下回到未完成，跟 Obsidian 一樣
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { checked: !this.node.attrs.checked, status: null })));
      });
    }
    if (this.cb && ctx && ctx.menu) {
      // 右鍵：選任務的狀態
      this.cb.addEventListener('contextmenu', e => {
        e.stopPropagation();
        ctx.menu(e, TASK_STATUSES.map(([ch, label, icon]) => ({
          title: t(label) + (ch === ' ' ? '' : '  [' + ch + ']'), icon,
          run: () => {
            const pos = this.getPos();
            if (pos == null) return;
            this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { checked: ch !== ' ', status: ch === ' ' || ch === 'x' ? null : ch })));
          },
        })));
      });
    }
    this.contentDOM = el('div', 'wm-li-content', this.dom);
    this.sync();
  }
  sync(): void {
    if (!this.cb) return;
    const a = this.node.attrs;
    this.cb.checked = !!a.checked;
    this.dom.classList.toggle('is-checked', !!a.checked);
    // data-task 與 Obsidian 相同，佈景主題的自訂核取方塊樣式才會套用
    const task = a.checked ? (a.status || 'x') : ' ';
    this.dom.setAttribute('data-task', task);
    this.cb.setAttribute('data-task', task);
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type || (node.attrs.checked == null) !== (this.node.attrs.checked == null)) return false;
    this.node = node; this.sync();
    return true;
  }
  stopEvent(e: Event): boolean { return !!this.cb && e.target === this.cb; }
  ignoreMutation(m: ViewMutationRecord): boolean { return !!this.cb && (m.target === this.cb || m.target === this.dom && m.type === 'attributes'); }
}

// 程式碼區塊：上方可選語言、複製。
// Obsidian 會把某些語言顯示成結果（mermaid 圖表、dataview 查詢、其他外掛註冊的區塊…），這裡也一樣：
// 平常顯示結果，游標進到區塊裡（或按「原始碼」）才顯示程式碼，像 Obsidian 的即時預覽。
class CodeBlockView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: Partial<NodeViewContext>;
  declare dom: HTMLDivElement;
  declare head: HTMLDivElement;
  declare sel: HTMLSelectElement;
  declare editBtn: HTMLButtonElement;
  declare srcBtn: HTMLButtonElement;
  declare copy: HTMLButtonElement;
  declare pre: HTMLPreElement;
  declare contentDOM: HTMLElement;
  declare preview: HTMLDivElement;
  declare timer: number | undefined;
  declare handle: EmbedHandle | null | undefined;
  declare rendered: string | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx?: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx || {};
    this.dom = el('div', 'wm-codeblock');
    this.head = el('div', 'wm-code-head', this.dom);
    this.head.contentEditable = 'false';
    this.sel = el('select', 'wm-code-langsel dropdown', this.head);
    this.sel.setAttribute('aria-label', t('程式語言'));
    el('span', 'wm-code-spacer', this.head);
    const btn = (cls: string, label: string, icon: string, fallback: string, run: () => void): HTMLButtonElement => {
      const b = el('button', cls, this.head);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      if (this.ctx.icon) this.ctx.icon(b, icon, fallback); else b.textContent = fallback;
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', run);
      return b;
    };
    this.editBtn = btn('wm-code-edit', t('編輯圖表（表單或程式碼，含即時預覽）'), 'workflow', t('編輯圖表'), () => { const pos = this.getPos(); if (pos != null && this.ctx.editMermaid) this.ctx.editMermaid(pos); });
    this.srcBtn = btn('wm-code-src', t('顯示／隱藏原始碼'), 'code-2', t('原始碼'), () => this.toggleSource());
    this.copy = btn('wm-code-copy', t('複製程式碼'), 'copy', t('複製'), () => {
      const text = this.node.textContent;
      if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => { this.copy.classList.add('is-done'); setTimeout(() => this.copy.classList.remove('is-done'), 900); });
    });
    this.sel.addEventListener('change', () => {
      if (this.sel.value === '__other') {
        this.syncSelect();
        if (this.ctx.prompt) this.ctx.prompt(t('程式語言'), this.node.attrs.params || '', 'python, sql, json…', v => this.setLang(v.trim()));
        return;
      }
      this.setLang(this.sel.value);
    });
    this.pre = el('pre', 'wm-code', this.dom);
    this.contentDOM = el('code', null, this.pre);
    this.preview = el('div', 'wm-code-preview', this.dom);
    this.preview.contentEditable = 'false';
    // 按兩下結果：把游標放進程式碼（單按留給結果裡的連結、核取方塊等）
    this.preview.addEventListener('dblclick', e => { e.preventDefault(); this.focusCode(); });
    this.preview.addEventListener('mousedown', e => {
      const a = (e.target as Element).closest && (e.target as Element).closest('a');
      if (a && (e.ctrlKey || e.metaKey) && this.ctx.openLink) {
        e.preventDefault();
        const href = a.getAttribute('data-href') || a.getAttribute('href');
        if (href) this.ctx.openLink(href, e.shiftKey);
      }
    });
    this.preview.addEventListener('click', e => { if ((e.target as Element).closest && (e.target as Element).closest('a')) e.preventDefault(); }, true);
    this.syncSelect();
    this.syncPreview(true);
  }
  lang(): string { return (this.node.attrs.params || '').trim().split(/\s+/)[0].toLowerCase(); }
  setLang(lang: string): void {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { params: lang })));
    this.view.focus();
  }
  toggleSource(): void {
    const on = !this.dom.classList.contains('show-code');
    this.dom.classList.toggle('show-code', on);
    this.srcBtn.classList.toggle('is-active', on);
    if (on) this.focusCode();
  }
  focusCode(): void {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setSelection((this.view.state.selection.constructor as typeof Selection).near(this.view.state.doc.resolve(pos + 1))));
    this.view.focus();
  }
  syncSelect(): void {
    const cur = (this.node.attrs.params || '').trim();
    this.sel.replaceChildren();
    const list = CODE_LANGUAGES.slice();
    if (cur && !list.some(([v]) => v === cur)) list.push([cur, cur]);
    // label 是語言名稱或筆記裡寫的語言（不翻譯）；只有 v 是空字串時才是介面文字「純文字」，型別分不出來所以轉型
    for (const [v, label] of list) { const o = el('option', null, this.sel, v ? label : t(label as I18nKey)); o.value = v; }
    const o = el('option', null, this.sel, t('其他…')); o.value = '__other';
    this.sel.value = cur;
    this.pre.dataset && (this.pre.dataset.lang = cur);
  }
  dispose(): void {
    clearTimeout(this.timer);
    if (this.handle) { try { this.handle.unload(); } catch (e) { /* 忽略 */ } this.handle = null; }
  }
  // 顯示結果：內容或語言變了才重畫（打字時延後一下，不要每個字都重畫）
  syncPreview(now: boolean): void {
    const on = !!(this.ctx.canPreview && this.ctx.canPreview(this.node.attrs.params));
    const text = this.node.textContent;
    this.dom.classList.toggle('has-preview', on);
    this.dom.classList.toggle('is-empty', !text.trim());
    this.srcBtn.hidden = !on;
    this.editBtn.hidden = !(on && this.lang() === 'mermaid');
    if (!on) { this.dispose(); this.preview.replaceChildren(); this.rendered = null; return; }
    const key = this.node.attrs.params + '\n' + text;
    if (key === this.rendered) return;
    clearTimeout(this.timer);
    const run = () => {
      this.dispose();
      this.rendered = key;
      this.preview.replaceChildren();
      if (!text.trim()) return;
      const ticks = text.match(/`{3,}/g);
      const fence = ticks ? ticks.sort().slice(-1)[0] + '`' : '```';
      this.handle = this.ctx.renderBlock!(fence + this.node.attrs.params + '\n' + text + '\n' + fence, this.preview);
    };
    if (now) run(); else this.timer = setTimeout(run, 400);
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.params !== this.node.attrs.params;
    this.node = node;
    if (changed) this.syncSelect();
    this.syncPreview(false);
    return true;
  }
  destroy(): void { this.dispose(); }
  stopEvent(e: Event): boolean { return this.head.contains(e.target as Node | null) || this.preview.contains(e.target as Node | null); }
  ignoreMutation(m: ViewMutationRecord): boolean {
    return this.head.contains(m.target) || this.preview.contains(m.target) || (m.target === this.dom && m.type === 'attributes');
  }
}


// Obsidian 提示框：外框和標題照 Obsidian 樣式，內容可以直接編輯
class CalloutView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: HTMLDivElement;
  declare head: HTMLDivElement;
  declare icon: HTMLDivElement;
  declare titleEl: HTMLDivElement;
  declare foldEl: HTMLDivElement;
  declare contentDOM: HTMLDivElement;
  declare collapsed: boolean;
  declare iconTimer: number | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'callout wm-callout');
    this.head = el('div', 'callout-title', this.dom);
    this.head.contentEditable = 'false';
    this.icon = el('div', 'callout-icon', this.head);
    this.titleEl = el('div', 'callout-title-inner', this.head);
    this.foldEl = el('div', 'callout-fold', this.head);
    this.foldEl.setAttribute('aria-label', t('收合／展開'));
    this.contentDOM = el('div', 'callout-content', this.dom);
    // 可摺疊的提示框（[!note]- 預設收合、[!note]+ 預設展開）：點箭頭收合或展開，只影響畫面，不改檔案
    this.collapsed = node.attrs.fold === '-';
    this.foldEl.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.collapsed = !this.collapsed; this.syncFold(); });
    this.icon.setAttribute('aria-label', t('更換提示框類型'));
    this.titleEl.setAttribute('aria-label', t('點一下編輯標題'));
    this.icon.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      ctx.menu(e, CALLOUT_TYPES.map(([tv, label, icon]) => ({ title: t(label) + t('（') + tv + t('）'), icon, run: () => this.set({ type: tv }) }))
        .concat([
          { title: t('可摺疊，預設展開'), icon: 'chevron-down', run: () => { this.collapsed = false; this.set({ fold: '+' }); } },
          { title: t('可摺疊，預設收合'), icon: 'chevron-right', run: () => { this.collapsed = true; this.set({ fold: '-' }); } },
          { title: t('不可摺疊'), icon: 'minus', run: () => { this.collapsed = false; this.set({ fold: '' }); } },
          { title: t('移除提示框（保留內容）'), icon: 'trash-2', run: () => ctx.unwrapCallout(this.getPos()) },
        ]));
    });
    this.titleEl.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      ctx.prompt(t('提示框標題'), this.node.attrs.title || '', t('留白則顯示類型名稱'), v => this.set({ title: v.trim() || null }));
    });
    this.render();
  }
  set(attrs: Attrs): void {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, attrs)));
    this.view.focus();
  }
  render(): void {
    const a = this.node.attrs;
    this.dom.setAttribute('data-callout', a.type);
    this.dom.setAttribute('data-callout-fold', a.fold || '');
    this.syncIcon();
    this.syncFold();
    // 自訂類型的圖示寫在 CSS（--callout-icon），要等節點放進畫面後才讀得到
    if (!this.iconTimer) this.iconTimer = setTimeout(() => { this.iconTimer = null; this.syncIcon(); }, 0);
    const tv = a.type.charAt(0).toUpperCase() + a.type.slice(1);
    this.titleEl.textContent = a.title ? a.title.replace(/(\*\*|__|==|`)/g, '').replace(/\\([\\`*_{}\[\]()#+\-.!|<>=$%~])/g, '$1') : tv;
    this.titleEl.classList.toggle('is-default', !a.title);
  }
  // 圖示：Obsidian、佈景主題或 CSS 片段用 --callout-icon 指定的優先（自訂的提示框類型才會有對的圖示）
  syncIcon(): void {
    let name = '';
    try { name = getComputedStyle(this.dom).getPropertyValue('--callout-icon').trim().replace(/^["']|["']$/g, ''); } catch (e) { name = ''; }
    this.icon.replaceChildren();
    this.ctx.icon(this.icon, name && name !== 'none' && !name.startsWith('<') ? name : calloutIcon(this.node.attrs.type), '');
  }
  syncFold(): void {
    const fold = this.node.attrs.fold || '';
    this.foldEl.hidden = !fold;
    this.dom.classList.toggle('is-collapsed', !!fold && this.collapsed);
    this.foldEl.replaceChildren();
    if (fold) this.ctx.icon(this.foldEl, this.collapsed ? 'chevron-right' : 'chevron-down', this.collapsed ? '▸' : '▾');
  }
  destroy(): void { clearTimeout(this.iconTimer!); }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = JSON.stringify(node.attrs) !== JSON.stringify(this.node.attrs);
    this.node = node;
    if (changed) this.render();
    return true;
  }
  stopEvent(e: Event): boolean { return this.head.contains(e.target as Node | null); }
  ignoreMutation(m: ViewMutationRecord): boolean { return this.head.contains(m.target) || m.target === this.dom && m.type === 'attributes'; }
}

export function createNodeViews(ctx: NodeViewContext): Record<string, NodeViewConstructor> {
  return {
    wikilink: (n, v, g) => new WikilinkView(n, v, g, ctx),
    image: (n, v, g) => new ImageView(n, v, g, ctx),
    raw_block: (n, v, g) => new RawBlockView(n, v, g, ctx),
    raw_inline: (n, v, g) => new RawInlineView(n, v, g, ctx),
    frontmatter: (n, v, g) => new FrontmatterView(n, v, g, ctx),
    list_item: (n, v, g) => new ListItemView(n, v, g, ctx),
    code_block: (n, v, g) => new CodeBlockView(n, v, g, ctx),
    table: n => new TableView(n, 90),
    callout: (n, v, g) => new CalloutView(n, v, g, ctx),
  };
}
