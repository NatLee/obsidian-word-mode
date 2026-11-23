// 拖曳移動游標時（toolbar.ts 的 caretPad），在游標上方顯示放大的預覽（Editorial 的做法）：
// 手機上的字小、游標只是一條細線，一格一格移動時看放大的那一塊比較容易停在想要的字中間。
// 做法：把游標所在的那一段複製一份放進固定大小的鏡片裡放大，用 transform 平移到游標對準鏡片中的標記；
// 同一段裡移動只改 transform（有轉場，所以是滑過去的），換段才重新複製
import type { EditorView } from 'prosemirror-view';
import { el } from './dom.js';

// 放大倍率、鏡片的寬度、鏡片與游標的距離、鏡片離畫面邊緣至少多遠
const SCALE = 1.6;
const WIDTH = 230;
const GAP = 12;
const EDGE = 8;

// 複製出來的段落不在編輯區裡，樣式表裡跟著上層走的字型設定要直接抄過來
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'direction', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize'] as const;

export class Loupe {
  private dom: HTMLDivElement;
  private body: HTMLDivElement;
  private mark: HTMLDivElement;
  // 目前複製的是哪一段
  private block: HTMLElement | null = null;

  constructor(private view: EditorView) {
    // 放在檢視裡面：佈景主題與縮放的變數才拿得到
    const host = view.dom.closest<HTMLElement>('.wm-view') || view.dom.ownerDocument.body;
    this.dom = el('div', 'wm-loupe', host);
    this.dom.setAttribute('aria-hidden', 'true');
    // 有 wm-editor：粗體、連結、行內程式碼這些行內樣式的規則才套得到
    this.body = el('div', 'wm-editor wm-loupe-body', this.dom);
    this.mark = el('div', 'wm-loupe-caret', this.dom);
    this.update();
  }

  // 依目前的游標位置更新內容與位置
  update(): void {
    const { view } = this;
    const { $head, head } = view.state.selection;
    const win = view.dom.ownerDocument.defaultView || window;
    let block: HTMLElement | null = null;
    try {
      const n = $head.depth ? view.nodeDOM($head.before($head.depth)) : null;
      if (n && n.nodeType === 1) block = n as HTMLElement;
    } catch { /* 位置對不到元素：下面當作沒有 */ }
    if (!block || !$head.parent.isTextblock) { this.dom.classList.remove('is-shown'); return; }
    const c = view.coordsAtPos(head);
    const r = block.getBoundingClientRect();
    const lineH = Math.max(12, c.bottom - c.top);
    const height = Math.round(lineH * SCALE + 18);
    if (block !== this.block) {
      this.block = block;
      const copy = block.cloneNode(true) as HTMLElement;
      copy.removeAttribute('id');
      const from = win.getComputedStyle(block);
      for (const k of COPY) copy.style[k] = from[k];
      copy.style.width = r.width + 'px';
      // 換了一段：內容直接換過去，不要從上一段的位置滑過來
      this.dom.classList.add('is-jump');
      this.body.replaceChildren(copy);
    }
    // 鏡片水平置中在游標上，超出畫面就往內收；鏡片裡的標記跟著游標實際的位置偏移
    const left = Math.max(EDGE, Math.min(c.left - WIDTH / 2, win.innerWidth - WIDTH - EDGE));
    const above = c.top - height - GAP;
    const top = above >= EDGE ? above : c.bottom + GAP;
    const markX = c.left - left;
    this.dom.style.width = WIDTH + 'px';
    this.dom.style.height = height + 'px';
    this.dom.style.transform = 'translate3d(' + Math.round(left) + 'px,' + Math.round(top) + 'px,0)';
    this.body.style.transform = 'translate3d(' + (markX - (c.left - r.left) * SCALE).toFixed(1) + 'px,' + (height / 2 - ((c.top + c.bottom) / 2 - r.top) * SCALE).toFixed(1) + 'px,0) scale(' + SCALE + ')';
    this.mark.style.transform = 'translate3d(' + markX.toFixed(1) + 'px,0,0)';
    this.mark.style.height = Math.round(lineH * SCALE) + 'px';
    this.dom.classList.add('is-shown');
    if (this.dom.classList.contains('is-jump')) {
      // 先讓這一格不帶轉場畫出來，再把轉場開回去
      void this.dom.offsetWidth;
      this.dom.classList.remove('is-jump');
    }
  }

  destroy(): void { this.dom.remove(); }
}
