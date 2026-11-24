// 自己畫的游標（桌機）：瀏覽器內建的游標只能改顏色，粗細、形狀、閃爍的方式、移動時的滑動都改不了。
// 做法是把內建的游標變透明（CSS），在頁面上放一個絕對定位的元素，每次選取或版面變動時移到游標的位置。
// 這幾種情況交還給內建的游標或直接不顯示：輸入法組字中（組字的底線與游標由瀏覽器畫）、有選取範圍、
// 選到整個節點、編輯區沒有焦點。手機一律用系統的游標（它有拖曳的把手與放大鏡），這個外掛不會裝上去
import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export type CaretShape = 'line' | 'thick' | 'block' | 'underline' | 'native';
export type CaretBlink = 'fade' | 'blink' | 'solid';
export interface CaretLook { shape: CaretShape; blink: CaretBlink; smooth: boolean; }

export const CARET_SHAPES: readonly CaretShape[] = ['line', 'thick', 'block', 'underline', 'native'];
export const CARET_BLINKS: readonly CaretBlink[] = ['fade', 'blink', 'solid'];

// 設定值整理成認得的樣子（舊版沒有這些設定、或設定檔被手動改壞時用預設）
export function caretLook(shape: unknown, blink: unknown, smooth: unknown): CaretLook {
  return {
    shape: CARET_SHAPES.includes(shape as CaretShape) ? shape as CaretShape : 'line',
    blink: CARET_BLINKS.includes(blink as CaretBlink) ? blink as CaretBlink : 'fade',
    smooth: smooth !== false,
  };
}

// 停止移動多久之後才開始閃：打字、移動游標的時候一直是實心的，看得清楚位置
const IDLE_MS = 500;

export interface CaretContext {
  // 目前的設定；shape 是 native 時不畫（用內建的游標）
  look(): CaretLook;
  // 游標畫在這個元素裡（頁面，position: relative，可能有 CSS zoom）
  host(): HTMLElement;
}

class CaretView {
  declare el: HTMLDivElement;
  declare shown: boolean;
  declare idle: number;
  declare frame: number;
  declare ro: ResizeObserver | null;
  declare onFocus: () => void;

  constructor(readonly view: EditorView, readonly ctx: CaretContext) {
    const doc = view.dom.ownerDocument;
    this.el = ctx.host().createDiv({ cls: 'wm-caret', attr: { 'aria-hidden': 'true' } });
    this.shown = false; this.idle = 0; this.frame = 0;
    // 焦點、組字不會產生 transaction；等這一輪事件處理完（ProseMirror 的 composing 才是新的值）再重畫
    this.onFocus = () => this.later();
    for (const ev of ['focus', 'blur', 'compositionstart', 'compositionend']) view.dom.addEventListener(ev, this.onFocus);
    // 版面變了但選取沒變（視窗大小、縮放、圖片載入、摺疊）：游標的座標會變
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.later()) : null;
    if (this.ro) this.ro.observe(view.dom);
    // 字型載入完，字的寬度會變（編輯區的大小不一定變）
    const fonts = doc.fonts;
    if (fonts) void fonts.ready.then(() => this.later(), () => { /* 不影響 */ });
    this.update();
  }

  later(): void {
    const win = this.view.dom.ownerDocument.defaultView;
    if (!win || this.frame) return;
    this.frame = win.requestAnimationFrame(() => { this.frame = 0; this.update(); });
  }

  hide(): void {
    this.shown = false;
    this.el.classList.remove('is-shown');
  }

  update(): void {
    const view = this.view;
    const look = this.ctx.look();
    const sel = view.state.selection;
    const host = this.ctx.host();
    // 組字中把內建的游標放回來（CSS 用這個類別），自己的收起來
    host.classList.toggle('wm-caret-composing', view.composing);
    if (look.shape === 'native' || view.composing || !view.editable || !(sel instanceof TextSelection) || !sel.empty || !view.hasFocus()) { this.hide(); return; }
    let c: { left: number; top: number; bottom: number };
    let box: DOMRect;
    try { c = view.coordsAtPos(sel.head); box = host.getBoundingClientRect(); } catch { this.hide(); return; }
    if (!(c.bottom > c.top)) { this.hide(); return; }
    // 頁面有 CSS zoom 時，量到的是放大後的座標，寫回去的是放大前的
    const scale = host.offsetWidth ? box.width / host.offsetWidth || 1 : 1;
    const x = (c.left - box.left) / scale - host.clientLeft;
    const y = (c.top - box.top) / scale - host.clientTop;
    const h = (c.bottom - c.top) / scale;
    const el = this.el;
    el.dataset.shape = look.shape;
    el.dataset.blink = look.blink;
    // 剛出現（點進編輯區、選取收起來）直接到位，不要從上一次的位置滑過來
    el.classList.toggle('is-smooth', look.smooth && this.shown);
    el.style.setProperty('--wm-caret-x', x.toFixed(2) + 'px');
    el.style.setProperty('--wm-caret-y', y.toFixed(2) + 'px');
    el.style.setProperty('--wm-caret-h', h.toFixed(2) + 'px');
    el.classList.add('is-shown');
    this.shown = true;
    // 移動中是實心的，停下來才閃
    el.classList.remove('is-idle');
    const win = view.dom.ownerDocument.defaultView;
    if (win) {
      win.clearTimeout(this.idle);
      this.idle = win.setTimeout(() => el.classList.add('is-idle'), IDLE_MS);
    }
  }

  destroy(): void {
    const win = this.view.dom.ownerDocument.defaultView;
    if (win) { win.clearTimeout(this.idle); if (this.frame) win.cancelAnimationFrame(this.frame); }
    for (const ev of ['focus', 'blur', 'compositionstart', 'compositionend']) this.view.dom.removeEventListener(ev, this.onFocus);
    if (this.ro) this.ro.disconnect();
    this.ctx.host().classList.remove('wm-caret-composing');
    this.el.remove();
  }
}

export function caretPlugin(ctx: CaretContext): Plugin {
  return new Plugin({ view: view => new CaretView(view, ctx) });
}
