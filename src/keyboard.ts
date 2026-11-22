// 手機、平板的螢幕鍵盤：鍵盤從畫面下緣往上蓋住多少。
// Obsidian 靠原生端給的 --keyboard-height 把工作區縮到鍵盤上方，但對話框不會跟著縮，而且這個值在有些裝置上
// 比鍵盤實際的高度小（iPhone 17 Pro、iOS 26 的注音鍵盤）。這裡把拿得到的來源都量一遍、取最大的：
// visualViewport 變矮了多少、Obsidian 的 --keyboard-height、鍵盤升起事件帶的高度。
// 結果寫在 body 的 --wm-kb-cover 與 wm-kb-up，樣式表與 Word 模式的檢視（view.ts 的 syncKeyboard）各自讓出位置
import { layoutHeight, visibleBottom } from './dom.js';

// 鍵盤升起、收起時 Obsidian 的 app 送到 window 的事件；高度是原生端量的，不一定有
interface KeyboardEventLike extends Event { keyboardHeight?: unknown; }

const EVENTS = ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide'] as const;
const LOG_SIZE = 40;

// el 是不是可以打字的地方（有焦點時螢幕鍵盤會升起）
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable || el.matches('textarea, select, [contenteditable="true"]')) return true;
  // 核取方塊、按鈕這類 input 不會叫出鍵盤
  return el instanceof (el.ownerDocument.defaultView || window).HTMLInputElement && !/^(checkbox|radio|button|submit|range|color|file)$/.test(el.type);
}

export class KeyboardWatch {
  // 鍵盤從視窗下緣往上蓋住的高度（像素）；鍵盤沒升起是 0
  cover = 0;
  // 螢幕鍵盤是不是開著
  open = false;
  // 最近一次鍵盤事件：升起（true）、收起（false）、沒收過（null），以及事件帶的高度
  shown: boolean | null = null;
  eventHeight = 0;
  // 最近幾次量到的數字，給「複製診斷資訊」用
  log: string[] = [];
  private subs = new Set<() => void>();
  private timers: number[] = [];

  constructor(private win: Window) {}

  // 開始監聽；回傳停止的函式
  start(): () => void {
    const { win } = this;
    const vv = win.visualViewport;
    // 鍵盤升起有動畫，Obsidian 也在途中改工作區的高度：馬上量一次，動畫途中與結束後再量
    const soon = () => {
      this.timers.forEach(id => win.clearTimeout(id));
      this.timers = [0, 120, 350, 700].map(ms => win.setTimeout(() => this.measure(), ms));
    };
    const onKeyboard = (e: Event) => {
      this.shown = e.type.endsWith('Show');
      const h = (e as KeyboardEventLike).keyboardHeight;
      this.eventHeight = this.shown && typeof h === 'number' && h > 0 ? h : 0;
      this.note(e.type);
      soon();
    };
    if (vv) { vv.addEventListener('resize', soon); vv.addEventListener('scroll', soon); }
    for (const name of EVENTS) win.addEventListener(name, onKeyboard);
    win.document.addEventListener('focusin', soon);
    win.document.addEventListener('focusout', soon);
    return () => {
      this.timers.forEach(id => win.clearTimeout(id));
      if (vv) { vv.removeEventListener('resize', soon); vv.removeEventListener('scroll', soon); }
      for (const name of EVENTS) win.removeEventListener(name, onKeyboard);
      win.document.removeEventListener('focusin', soon);
      win.document.removeEventListener('focusout', soon);
      this.apply(0, false);
    };
  }

  // 鍵盤的狀態變了就呼叫 fn；回傳取消的函式
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  // Obsidian 的 --keyboard-height（像素）
  private cssHeight(): number {
    const v = this.win.getComputedStyle(this.win.document.documentElement).getPropertyValue('--keyboard-height');
    return parseFloat(v) || 0;
  }

  measure(): void {
    const { win } = this;
    // 沒有在打字就當作鍵盤收起來了：iOS 收起鍵盤之後 visualViewport 有時不會馬上恢復，只看它會留下一塊空白
    const typing = isTypingTarget(win.document.activeElement);
    // 鍵盤從版面下緣往上蓋住多少：版面的高度減掉看得到的高度。iOS 為了露出游標會先把整個畫面往上推，推的時候
    // innerHeight 與看得到的下緣都少了推上去的那一段，用它們算會把鍵盤算矮，功能區先跳到錯的位置、推回來之後再跳一次。
    // 版面的高度（dom.ts 的 layoutHeight）不受影響；放大檢視時看得到的高度要乘回縮放比例，不然會當成鍵盤
    const vv = win.visualViewport;
    const layout = layoutHeight(win);
    const gap = Math.max(0, Math.round(vv ? layout - vv.height * (vv.scale || 1) : win.innerHeight - visibleBottom(win)));
    const cover = typing ? Math.max(gap, Math.round(this.cssHeight()), this.shown ? Math.round(this.eventHeight) : 0) : 0;
    // 外接鍵盤時也有焦點，但只會有一條很矮的輔助列：夠高才算螢幕鍵盤開著
    this.apply(cover, typing && (cover > 80 || this.shown === true));
  }

  private apply(cover: number, open: boolean): void {
    if (cover === this.cover && open === this.open) return;
    this.cover = cover; this.open = open;
    const body = this.win.document.body;
    body.classList.toggle('wm-kb-up', open);
    body.style.setProperty('--wm-kb-cover', cover + 'px');
    this.note('measure');
    for (const fn of Array.from(this.subs)) fn();
    // 對話框變矮之後，正在打字的欄位可能跑到看不到的地方
    const a = this.win.document.activeElement;
    if (open && a && a.closest('.modal')) this.win.requestAnimationFrame(() => { if (a.isConnected) a.scrollIntoView({ block: 'nearest' }); });
  }

  // 目前量得到的數字（一行）
  snapshot(): string {
    const { win } = this;
    const doc = win.document;
    const vv = win.visualViewport;
    const rect = (sel: string) => { const e = doc.querySelector(sel); if (!e) return '-'; const r = e.getBoundingClientRect(); return Math.round(r.top) + '..' + Math.round(r.bottom); };
    const a = doc.activeElement;
    return [
      'inner=' + win.innerWidth + 'x' + win.innerHeight,
      'client=' + doc.documentElement.clientHeight + ' scrollY=' + Math.round(win.scrollY || 0) + ' screen=' + (win.screen ? win.screen.height : '-'),
      'vv=' + (vv ? Math.round(vv.height) + '@' + Math.round(vv.offsetTop) : 'none'),
      'css=' + this.cssHeight(),
      'ev=' + (this.shown == null ? 'none' : (this.shown ? 'show' : 'hide') + ':' + this.eventHeight),
      'cover=' + this.cover + (this.open ? ':open' : ''),
      'app=' + rect('.app-container'),
      'view=' + rect('.wm-view'),
      'ribbon=' + rect('.wm-view .wm-ribbon'),
      'modal=' + rect('.modal'),
      'focus=' + (a ? a.tagName.toLowerCase() + (isTypingTarget(a) ? ':typing' : '') : '-'),
    ].join(' ');
  }

  private note(what: string): void {
    this.log.push(what + ' ' + this.snapshot());
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }

  // 回報問題用的整份資料：裝置、body 上的類別、目前的數字與最近的紀錄
  report(header: string[]): string {
    const body = this.win.document.body;
    const flags = Array.from(body.classList).filter(c => /^(is-|mod-|auto-full-screen|emulate-|wm-|show-view-header)/.test(c)).join(' ');
    return [...header, 'body: ' + flags, 'now: ' + this.snapshot(), 'log:', ...this.log].join('\n');
  }
}
