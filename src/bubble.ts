// 浮動小工具列：游標在連結上、或選取圖片時出現（像 Word／Google 文件）
import { Plugin } from 'prosemirror-state';
import { t, withKey, key } from './i18n.js';
import { linkContext } from './links.js';
import { el } from './dom.js';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Attrs } from 'prosemirror-model';
import type { LinkContext, ImageContext, WikilinkContext, TextLinkContext } from './links.js';
import type { I18nKey } from './i18n.js';

// 連結在工具列上的顯示方式（view.js 的 describe 產生）
export interface LinkDescription { icon: string; label: string; title: string; missing: boolean; }

// 浮動工具列需要的外部功能（view.js 的 bubbleContext 產生）。
// 圖片專用的功能（setWidth 等）只會在選取圖片時被呼叫，所以參數是 ImageContext
export interface BubbleContext {
  host: HTMLElement;
  icon(el: HTMLElement, name: string, fallback: string): void;
  describe(target: string, wiki: boolean): LinkDescription;
  open(info: LinkContext, newTab: boolean): void;
  edit(info: LinkContext): void;
  copy(text: string): void;
  unlink(info: LinkContext): void;
  imageExists(attrs: Attrs): boolean;
  imageWidth(attrs: Attrs): number | null;
  pageWidth(): number;
  setWidth(info: ImageContext, width: number | null): void;
  editAlt(info: ImageContext): void;
  replaceImage(info: ImageContext, btn: HTMLElement): void;
  openImage(info: ImageContext): void;
  removeNode(info: ImageContext): void;
}

// nodeDOM 可能是文字節點（沒有 getBoundingClientRect），所以 position() 先檢查再呼叫
type MaybeElement = Node & Partial<Pick<Element, 'getBoundingClientRect'>>;

export const IMAGE_SIZES = [
  { label: t('小'), pct: 0.25 }, { label: t('中'), pct: 0.5 }, { label: t('大'), pct: 0.75 }, { label: t('滿版'), pct: 1 },
];

// Bubble 的欄位：info 是目前顯示的連結／圖片（沒有時是 null），key 用來判斷內容有沒有變、要不要重畫。
// 工具列的內容在 info 的種類改變時一定會重畫，所以按鈕被按下時 this.info 的種類與建立按鈕時相同：
// btn() 依此把 this.info 轉成呼叫端宣告的型別（例如圖片按鈕的 ImageContext）
class Bubble {
  declare view: EditorView;
  declare ctx: BubbleContext;
  declare dom: HTMLDivElement;
  declare info: LinkContext | null;
  declare key: string;
  declare onBlur: () => void;

  constructor(view: EditorView, ctx: BubbleContext) {
    this.view = view;
    this.ctx = ctx;
    this.dom = el('div', 'wm-bubble');
    this.dom.hide();
    this.dom.addEventListener('mousedown', e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); });
    this.dom.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); });
    ctx.host.appendChild(this.dom);
    this.info = null;
    this.key = '';
    this.onBlur = () => setTimeout(() => {
      if (!this.view.hasFocus() && !this.dom.contains(document.activeElement)) this.hide();
    }, 150);
    view.dom.addEventListener('blur', this.onBlur);
    this.update(view, null);
  }

  destroy() { this.view.dom.removeEventListener('blur', this.onBlur); this.dom.remove(); }

  hide() { this.dom.hide(); this.info = null; this.key = ''; }

  update(view: EditorView, prev: EditorState | null) {
    const st = view.state;
    if (prev && prev.doc.eq(st.doc) && prev.selection.eq(st.selection) && this.info) return;
    const info = linkContext(st);
    if (!info) { this.hide(); return; }
    const key = info.kind + ':' + (info.pos != null ? info.pos : info.from + '-' + info.to) + ':' + JSON.stringify(info.node ? info.node.attrs : info.href);
    this.info = info;
    if (key !== this.key) { this.key = key; this.render(info); }
    this.dom.style.display = '';
    this.position(info);
  }

  position(info: LinkContext) {
    const v = this.view;
    let rect: { left: number; top: number; bottom: number };
    try {
      if (info.pos != null) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the cast is needed: Node has no getBoundingClientRect, and removing it fails the type check
        const dom = v.nodeDOM(info.pos) as MaybeElement | null;
        rect = dom && dom.getBoundingClientRect ? dom.getBoundingClientRect() : v.coordsAtPos(info.pos);
      } else {
        const a = v.coordsAtPos(info.from);
        rect = { left: a.left, bottom: a.bottom, top: a.top };
      }
    } catch (e) { return; }
    const host = this.ctx.host.getBoundingClientRect();
    const maxLeft = Math.max(0, host.width - (this.dom.offsetWidth || 320) - 8);
    this.dom.style.left = Math.min(maxLeft, Math.max(0, rect.left - host.left)) + 'px';
    this.dom.style.top = (rect.bottom - host.top + 6) + 'px';
  }

  btn<I extends LinkContext>(parent: HTMLElement, icon: string, title: string, run: (info: I, e: MouseEvent) => void, cls?: string): HTMLButtonElement {
    const b = el('button', 'wm-bubble-btn' + (cls ? ' ' + cls : ''), parent);
    b.type = 'button';
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-label', title);
    this.ctx.icon(b, icon, title);
    b.addEventListener('click', e => { e.preventDefault(); const info = this.info as I | null; if (info) run(info, e); });
    return b;
  }

  render(info: LinkContext) {
    const c = this.ctx;
    this.dom.replaceChildren();
    this.dom.dataset.kind = info.kind;
    if (info.kind === 'image') { this.renderImage(info); return; }

    const target = info.kind === 'wikilink' ? info.node.attrs.target : info.href;
    const d = c.describe(target, info.kind === 'wikilink');
    const link = el('a', 'wm-bubble-url' + (d.missing ? ' is-missing' : ''), this.dom);
    const ic = el('span', 'wm-bubble-icon', link);
    c.icon(ic, d.icon, '');
    el('span', 'wm-bubble-label', link, d.label);
    link.setAttribute('aria-label', d.title + '\n' + t('（點一下開啟，Ctrl+點擊在新分頁開啟）').replace('Ctrl', key('Mod')));
    link.href = '#';
    link.addEventListener('click', e => { e.preventDefault(); if (this.info) c.open(this.info, e.ctrlKey || e.metaKey); });
    el('span', 'wm-bubble-sep', this.dom);
    if (info.kind === 'url') {
      this.btn(this.dom, 'link', t('設定顯示文字（變成超連結）'), i => c.edit(i));
      this.btn(this.dom, 'copy', t('複製網址'), (i: TextLinkContext) => c.copy(i.href));
      return;
    }
    this.btn(this.dom, 'pencil', withKey('編輯連結', 'Mod+K'), i => c.edit(i));
    this.btn(this.dom, 'copy', t('複製連結'), (i: WikilinkContext | TextLinkContext) => c.copy(i.kind === 'wikilink' ? i.node.attrs.target : i.href));
    this.btn(this.dom, 'unlink', t('移除連結（保留文字）'), i => c.unlink(i));
  }

  renderImage(info: ImageContext) {
    const c = this.ctx;
    const a = info.node.attrs;
    const missing = !c.imageExists(a);
    if (missing) el('span', 'wm-bubble-warn', this.dom, t('找不到圖片'));
    el('span', 'wm-bubble-text', this.dom, t('寬度'));
    const cur = c.imageWidth(a);
    const full = c.pageWidth();
    for (const s of IMAGE_SIZES) {
      const w = Math.round(full * s.pct);
      // IMAGE_SIZES 的 label 是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
      const b = el('button', 'wm-bubble-size', this.dom, t(s.label as I18nKey));
      b.type = 'button';
      b.setAttribute('aria-label', w + ' px');
      if (cur && Math.abs(cur - w) <= 2) b.classList.add('is-active');
      b.addEventListener('click', e => { e.preventDefault(); if (this.info) c.setWidth(this.info as ImageContext, w); });
    }
    const orig = el('button', 'wm-bubble-size' + (cur ? '' : ' is-active'), this.dom, t('原始'));
    orig.type = 'button';
    orig.setAttribute('aria-label', t('原始大小'));
    orig.addEventListener('click', e => { e.preventDefault(); if (this.info) c.setWidth(this.info as ImageContext, null); });
    const input = el('input', 'wm-bubble-width', this.dom);
    input.type = 'number'; input.min = '20'; input.step = '10';
    input.placeholder = 'px';
    input.value = cur ? String(cur) : '';
    input.setAttribute('aria-label', t('自訂寬度（像素），按 Enter 套用'));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = parseInt(input.value, 10);
        if (this.info) c.setWidth(this.info as ImageContext, v > 0 ? v : null);
        this.view.focus();
      } else if (e.key === 'Escape') { e.preventDefault(); this.view.focus(); }
    });
    el('span', 'wm-bubble-sep', this.dom);
    this.btn(this.dom, 'text-cursor-input', t('替代文字（圖片說明）'), (i: ImageContext) => c.editAlt(i));
    this.btn(this.dom, 'replace', t('更換圖片…'), (i: ImageContext, e) => c.replaceImage(i, e.currentTarget as HTMLButtonElement));
    if (!missing) this.btn(this.dom, 'external-link', t('在新分頁開啟圖片'), (i: ImageContext) => c.openImage(i));
    this.btn(this.dom, 'trash-2', t('刪除圖片'), (i: ImageContext) => c.removeNode(i), 'mod-warning');
  }
}

export function bubblePlugin(ctx: BubbleContext): Plugin {
  return new Plugin({ view: view => new Bubble(view, ctx) });
}
