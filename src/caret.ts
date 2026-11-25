// 自己畫的游標：瀏覽器內建的游標只能改顏色，粗細、形狀、閃爍的方式、移動時的滑動都改不了。
// 做法是把內建的游標變透明（CSS），在頁面上放一個絕對定位的元素，每次選取或版面變動時移到游標的位置。
// 這幾種情況交還給內建的游標或直接不顯示：輸入法組字中（組字的底線與游標由瀏覽器畫）、有選取範圍、
// 選到整個節點、編輯區沒有焦點。
// 手機、平板（touch）也畫，但只在沒有選取範圍時藏起系統的游標（.wm-caret-on）：選取的把手、iOS 的選取顏色跟著 caret-color，
// 一直透明會看不到把手。手指按著的時候（點、長按拖曳、iOS 的放大鏡）每一格都照系統目前的選取畫：
// 長按拖曳時 touch.ts 不讓 ProseMirror 讀選取，只照編輯器的狀態畫的話，游標會停在原地，跟放大鏡裡的位置對不上。
// （1.34.0 長按時改交回系統的游標，但手指稍微一動就沒換到，放大鏡拖的是透明的游標；換到時又像游標突然變回原本的樣子）
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

// 閃一次要幾秒（設定）：整理成 0.4 到 3 秒之間、一位小數；不是數字就用預設
export const CARET_PERIOD = { min: 0.4, max: 3, step: 0.1, default: 1.3 } as const;
export function caretPeriod(v: unknown): number {
  const n = typeof v === 'number' && isFinite(v) ? v : CARET_PERIOD.default;
  return Math.round(Math.max(CARET_PERIOD.min, Math.min(CARET_PERIOD.max, n)) * 10) / 10;
}

// 手指放開之後再照系統的選取畫多久：iOS 放開後還會調整一次選取，touch.ts 也是放開時才把它交給編輯器
const TOUCH_TAIL_MS = 400;

export interface CaretContext {
  // 目前的設定；shape 是 native 時不畫（用內建的游標）
  look(): CaretLook;
  // 游標畫在這個元素裡（頁面，position: relative，可能有 CSS zoom）
  host(): HTMLElement;
  // 手機、平板：手指按著時照系統的選取畫（見檔案開頭）
  touch?: boolean;
}

// 閃爍從頭開始（亮的那一半）：在兩組一樣的動畫之間切換，瀏覽器就會從 0% 重新播放，不用強制重排版面
function restartBlink(el: HTMLElement): void {
  el.classList.toggle('is-odd');
}

class CaretView {
  declare el: HTMLDivElement;
  declare shown: boolean;
  declare frame: number;
  declare ro: ResizeObserver | null;
  declare onFocus: () => void;
  // 點擊、按鍵：就算選取沒變（點在原本的位置、在文件結尾按右鍵），閃爍也要從頭開始，看起來才有反應
  declare onPoke: () => void;
  // 上一次畫的位置與樣子：只有變了（或剛點擊、按鍵）才讓閃爍從頭開始。
  // 別的外掛、裝飾的更新也會呼叫 update，每次都重來的話游標會一直亮著不閃
  declare last: string;
  declare poked: boolean;
  // 手機：手指按著（或剛放開）時照系統的選取畫，follow 是那段時間的每一格（requestAnimationFrame）
  declare touching: boolean;
  declare touchUntil: number;
  declare follow: number;
  declare touchEvents: [string, (e: TouchEvent) => void][];

  constructor(readonly view: EditorView, readonly ctx: CaretContext) {
    const doc = view.dom.ownerDocument;
    this.el = ctx.host().createDiv({ cls: 'wm-caret', attr: { 'aria-hidden': 'true' } });
    this.shown = false; this.frame = 0; this.last = ''; this.poked = false;
    this.touching = false; this.touchUntil = 0; this.follow = 0; this.touchEvents = [];
    // 焦點、組字不會產生 transaction；等這一輪事件處理完（ProseMirror 的 composing 才是新的值）再重畫
    this.onFocus = () => this.later();
    for (const ev of ['focus', 'blur', 'compositionstart', 'compositionend']) view.dom.addEventListener(ev, this.onFocus);
    this.onPoke = () => { this.poked = true; this.later(); };
    for (const ev of ['mousedown', 'keydown']) view.dom.addEventListener(ev, this.onPoke);
    if (ctx.touch) this.watchTouch();
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
    this.last = '';
    this.el.classList.remove('is-shown');
    this.ctx.host().classList.remove('wm-caret-on');
  }

  // 手機：手指按著到放開後 TOUCH_TAIL_MS，每一格照系統的選取畫；之後回到照編輯器的狀態畫
  watchTouch(): void {
    const win = this.view.dom.ownerDocument.defaultView;
    if (!win) return;
    const tick = (): void => {
      this.follow = 0;
      if (!this.touching && win.performance.now() > this.touchUntil) { this.poked = true; this.update(); return; }
      this.followDom();
      this.follow = win.requestAnimationFrame(tick);
    };
    const start = (): void => { this.touching = true; if (!this.follow) this.follow = win.requestAnimationFrame(tick); };
    const release = (e: TouchEvent): void => {
      if (e.touches.length) return;
      this.touching = false;
      this.touchUntil = win.performance.now() + TOUCH_TAIL_MS;
    };
    this.touchEvents = [['touchstart', start], ['touchend', release], ['touchcancel', release]];
    for (const [ev, fn] of this.touchEvents) this.view.dom.addEventListener(ev, fn as EventListener, { passive: true });
  }

  // 照系統目前的選取（DOM 的選取）畫；選取不在編輯區裡、或是一段範圍時交給 update 的規則
  followDom(): void {
    const view = this.view;
    const s = view.dom.ownerDocument.getSelection();
    if (!s || !s.anchorNode || !view.dom.contains(s.anchorNode)) { this.fromState(); return; }
    if (!s.isCollapsed) { this.hide(); return; }
    let pos: number;
    try { pos = view.posAtDOM(s.anchorNode, s.anchorOffset); } catch { this.fromState(); return; }
    if (!this.visible() || pos < 0 || pos > view.state.doc.content.size) { this.hide(); return; }
    // 跟著手指：不滑動，滑過去會落後手指
    this.draw(pos, false);
  }

  // 現在能不能畫自己的游標（不看選取）
  visible(): boolean {
    const view = this.view;
    return this.ctx.look().shape !== 'native' && !view.composing && view.editable && view.hasFocus();
  }

  update(): void {
    const view = this.view;
    const host = this.ctx.host();
    // 組字中把內建的游標放回來（CSS 用這個類別），自己的收起來
    host.classList.toggle('wm-caret-composing', view.composing);
    // 手指按著時由 followDom 畫（照系統的選取），這裡不要用編輯器還沒更新的選取蓋掉
    if (this.touching && this.follow) return;
    this.fromState();
  }

  // 照編輯器的選取畫
  fromState(): void {
    const sel = this.view.state.selection;
    if (!this.visible() || !(sel instanceof TextSelection) || !sel.empty) { this.hide(); return; }
    this.draw(sel.head, this.ctx.look().smooth);
  }

  // 把游標畫在 pos；smooth 是要不要從上一個位置滑過去
  draw(pos: number, smooth: boolean): void {
    const view = this.view;
    const look = this.ctx.look();
    const host = this.ctx.host();
    let c: { left: number; top: number; bottom: number };
    let box: DOMRect;
    try { c = view.coordsAtPos(pos); box = host.getBoundingClientRect(); } catch { this.hide(); return; }
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
    el.classList.toggle('is-smooth', smooth && this.shown);
    el.style.setProperty('--wm-caret-x', x.toFixed(2) + 'px');
    el.style.setProperty('--wm-caret-y', y.toFixed(2) + 'px');
    el.style.setProperty('--wm-caret-h', h.toFixed(2) + 'px');
    el.classList.add('is-shown');
    host.classList.add('wm-caret-on');
    this.shown = true;
    // 移動、點擊、按鍵之後從亮的那一半重新閃（像系統的游標）：不會停在淡掉的樣子，也不用等一下才開始閃
    const key = [x.toFixed(1), y.toFixed(1), h.toFixed(1), look.shape, look.blink].join();
    if (key !== this.last || this.poked) restartBlink(el);
    this.last = key;
    this.poked = false;
  }

  destroy(): void {
    const win = this.view.dom.ownerDocument.defaultView;
    if (win) { if (this.frame) win.cancelAnimationFrame(this.frame); if (this.follow) win.cancelAnimationFrame(this.follow); }
    for (const ev of ['focus', 'blur', 'compositionstart', 'compositionend']) this.view.dom.removeEventListener(ev, this.onFocus);
    for (const ev of ['mousedown', 'keydown']) this.view.dom.removeEventListener(ev, this.onPoke);
    for (const [ev, fn] of this.touchEvents) this.view.dom.removeEventListener(ev, fn as EventListener);
    if (this.ro) this.ro.disconnect();
    this.ctx.host().classList.remove('wm-caret-composing', 'wm-caret-on');
    this.el.remove();
  }
}

export function caretPlugin(ctx: CaretContext): Plugin {
  return new Plugin({ view: view => new CaretView(view, ctx) });
}

// 設定頁的游標預覽：一行範例文字上畫一個跟編輯區一樣的游標（同一組 CSS），每隔一下移到別的字，
// 看得到平滑移動，停下來時照設定閃爍。read() 回傳目前的設定，設定改了呼叫 update()。
// 預覽離開頁面（設定頁重畫、關掉）之後計時器自己停；分類沒顯示時（量不到位置）只是不動
export interface CaretDemoLook extends CaretLook { color: 'accent' | 'text' | 'custom'; custom: string; period: number; }
// 游標輪流停的位置：範例文字長度的幾分之幾（每種語言的範例長度不同）
const DEMO_STOPS = [0.3, 0.65, 0.45, 1, 0.15];
const DEMO_MS = 2400;

export function caretDemo(parent: HTMLElement, sample: string, read: () => CaretDemoLook): { update(): void } {
  const box = parent.createDiv({ cls: 'wm-caret-demo', attr: { 'aria-hidden': 'true' } });
  const text = box.createSpan({ cls: 'wm-caret-demo-text', text: sample });
  const caret = box.createDiv('wm-caret');
  const win = parent.ownerDocument.defaultView;
  let stop = 0;
  let shown = false;
  const place = (): void => {
    const node = text.firstChild;
    if (!node || !box.isConnected) return;
    const len = (node.textContent || '').length;
    const off = Math.round(len * DEMO_STOPS[stop % DEMO_STOPS.length]);
    const range = box.ownerDocument.createRange();
    range.setStart(node, off); range.collapse(true);
    const rects = range.getClientRects();
    const r = rects.length ? rects[0] : range.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const lineH = text.getBoundingClientRect().height;
    // 分類沒顯示（display: none）時量到的都是 0：等下一次
    if (!b.width || !lineH) return;
    const look = read();
    caret.dataset.shape = look.shape;
    caret.dataset.blink = look.blink;
    caret.classList.toggle('is-smooth', look.smooth && shown);
    caret.style.setProperty('--wm-caret-x', (r.left - b.left - box.clientLeft).toFixed(2) + 'px');
    caret.style.setProperty('--wm-caret-y', (r.top - b.top - box.clientTop).toFixed(2) + 'px');
    caret.style.setProperty('--wm-caret-h', (r.height || lineH).toFixed(2) + 'px');
    caret.classList.add('is-shown');
    restartBlink(caret);
    shown = true;
  };
  const update = (): void => {
    const look = read();
    box.classList.toggle('wm-caret-text', look.color === 'text');
    const custom = look.color === 'custom' && /^#[0-9a-f]{3,8}$/i.test(look.custom) ? look.custom : '';
    if (custom) box.style.setProperty('--wm-caret-color', custom);
    else box.style.removeProperty('--wm-caret-color');
    const period = caretPeriod(look.period);
    if (period !== CARET_PERIOD.default) box.style.setProperty('--wm-caret-period', period + 's');
    else box.style.removeProperty('--wm-caret-period');
    place();
  };
  if (win) {
    // 第一次：等設定頁把這一列放進畫面、排好版面
    win.requestAnimationFrame(update);
    const timer = win.setInterval(() => {
      if (!box.isConnected) { win.clearInterval(timer); return; }
      stop++;
      place();
    }, DEMO_MS);
  }
  return { update };
}
