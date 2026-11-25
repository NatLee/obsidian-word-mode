// 拖曳移動游標時（toolbar.ts 的 caretPad），在游標上方顯示放大的預覽（Editorial 的做法）：
// 手機上的字小、游標只是一條細線，一格一格移動時看放大的那一塊比較容易停在想要的字中間。
// 做法：把游標所在的那一段複製一份放進固定大小的鏡片裡放大，用 transform 平移到游標對準鏡片中的標記；
// 同一段裡移動只改 transform（有轉場，所以是滑過去的），換段才重新複製
import type { EditorView } from 'prosemirror-view';
import { NodeSelection } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { el, visibleBottom } from './dom.js';
import { t } from './i18n.js';

// 鏡片與游標的距離（卡片樣式含指向游標的小尖角）、鏡片離畫面邊緣至少多遠
const GAP = { capsule: 16, card: 14 } as const;
const EDGE = 8;

// 外觀（設定）：膠囊是圓頭的長條、沒有尖角（像 iOS 的放大鏡）；卡片是圓角方框加一個指向游標的小尖角（1.32 以前的樣子）
export type LoupeStyle = 'capsule' | 'card';
// info：鏡片外面顯示游標所在的位置（哪一種區塊、第幾個字）
export interface LoupeOptions { scale: number; width: number; style: LoupeStyle; info: boolean; }
// 位置資訊那一條的高度與跟鏡片的距離（決定鏡片放在游標上面還是下面時要算進去）
const INFO_H = 26;
// 設定的範圍與預設值（設定頁的拉桿也用這份）
export const LOUPE_ZOOM = { min: 1.2, max: 2.5, step: 0.1, default: 1.6 } as const;
export const LOUPE_WIDTH = { min: 180, max: 340, step: 20, default: 260 } as const;

const clampTo = (v: unknown, r: { min: number; max: number; step: number; default: number }): number => {
  const n = typeof v === 'number' && isFinite(v) ? v : r.default;
  return Math.round(Math.max(r.min, Math.min(r.max, n)) / r.step) * r.step;
};
// 設定值整理成認得的樣子（舊版沒有這些設定、或設定檔被手動改壞時用預設）
export function loupeOptions(zoom: unknown, width: unknown, style: unknown, info?: unknown): LoupeOptions {
  return {
    scale: Math.round(clampTo(zoom, LOUPE_ZOOM) * 10) / 10,
    width: clampTo(width, LOUPE_WIDTH),
    style: style === 'card' ? 'card' : 'capsule',
    info: info !== false,
  };
}

// 游標所在位置的說明（放大鏡旁邊那一條）：最靠近游標的區塊種類（表格寫出第幾列第幾欄），加上在這一段的第幾個字。
// 拖曳移動游標時看得出現在跑到哪裡，跨段、進出表格時特別有用
export function caretInfo($head: ResolvedPos): string[] {
  const parent = $head.parent;
  let where = parent.type.name === 'heading' ? t('標題 {n}', { n: String(parent.attrs.level) }) : parent.type.name === 'code_block' ? t('程式碼') : t('內文');
  for (let d = $head.depth - 1; d > 0; d--) {
    const n = $head.node(d);
    const name = n.type.name;
    if (name === 'table_cell' || name === 'table_header') {
      where = t('表格') + ' ' + t('第 {r} 列第 {c} 欄', { r: String($head.index(d - 2) + 1), c: String($head.index(d - 1) + 1) });
      break;
    }
    if (name === 'list_item') {
      const list = $head.node(d - 1);
      where = n.attrs.checked != null ? t('核取清單') : list.type.name === 'ordered_list' ? t('編號') : t('項目符號');
      break;
    }
    if (name === 'blockquote') { where = t('引文'); break; }
    if (name === 'callout') { where = t('提示框'); break; }
  }
  const out = [where, t('第 {i}／{n} 字', { i: String($head.parentOffset), n: String(parent.content.size) })];
  // 游標旁邊緊貼著圖片、行內方程式、內嵌這類不是文字的東西：寫出來（放大鏡裡它們很小，不一定看得出來）
  const side = (n: PMNode | null | undefined): string | null => {
    if (!n || n.isText) return null;
    if (n.type.name === 'image') return t('圖片');
    if (n.type.name === 'raw_inline') return /^\$/.test(String(n.attrs.src)) ? t('行內方程式') : t('原文');
    if (n.type.name === 'wikilink' && n.attrs.embed) return t('內嵌');
    return null;
  };
  const before = side($head.nodeBefore); const after = side($head.nodeAfter);
  if (before) out.push('← ' + before);
  if (after) out.push(after + ' →');
  return out;
}

// 選取了整個區塊（拖曳時停在方程式、圖表這類物件上）時，旁邊寫的名稱
export function objectLabel(node: PMNode, dom: Node | null): string {
  const name = node.type.name;
  if (name === 'raw_block') {
    const kind = String(node.attrs.kind);
    return kind === 'math' ? t('方程式') : kind === 'comment' ? t('註解') : kind === 'html' ? t('HTML 區塊') : t('Markdown 原文');
  }
  if (name === 'horizontal_rule') return t('水平線');
  if (name === 'frontmatter') return t('文件屬性');
  if (name === 'code_block') {
    const lang = String(node.attrs.params || '').trim().split(/\s+/)[0].toLowerCase();
    return lang === 'mermaid' ? t('圖表') : t('程式碼結果');
  }
  if (name === 'image') return t('圖片');
  return dom && dom.nodeType === 1 ? t('原文') : node.type.name;
}
// 小尖角離鏡片左右兩端至少多遠（再靠邊就會超出圓角）
const TAIL_INSET = 22;

// 複製出來的段落不在編輯區裡，樣式表裡跟著上層走的字型設定要直接抄過來
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'color', 'textAlign', 'direction', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize'] as const;

export class Loupe {
  private dom: HTMLDivElement;
  private body: HTMLDivElement;
  private mark: HTMLDivElement;
  private tail: HTMLDivElement;
  private info: HTMLDivElement | null;
  // 目前複製的是哪一段
  private block: HTMLElement | null = null;
  private scroller: HTMLElement | null;
  private onScroll = () => this.update();
  // 走到文件開頭、結尾時的提示（下一次走得動就收掉）
  private edgeKind: 'start' | 'end' | null = null;

  private opts: LoupeOptions;

  constructor(private view: EditorView, opts?: Partial<LoupeOptions>) {
    this.opts = Object.assign(loupeOptions(undefined, undefined, undefined), opts || {});
    // 放在檢視裡面：佈景主題與縮放的變數才拿得到
    const host = view.dom.closest<HTMLElement>('.wm-view') || view.dom.ownerDocument.body;
    this.dom = el('div', 'wm-loupe is-' + this.opts.style, host);
    this.dom.setAttribute('aria-hidden', 'true');
    this.tail = el('div', 'wm-loupe-tail', this.dom);
    // 裁切內容的是裡面這一層：小尖角要露在鏡片外面
    const lens = el('div', 'wm-loupe-lens', this.dom);
    // 有 wm-editor：粗體、連結、行內程式碼這些行內樣式的規則才套得到
    this.body = el('div', 'wm-editor wm-loupe-body', lens);
    // 四邊的淡出（蓋在內容上面的一層漸層）：上下露出一點的鄰行、左右被切到的字是淡出去的
    el('div', 'wm-loupe-fade', lens);
    this.mark = el('div', 'wm-loupe-caret', lens);
    // 位置資訊：在鏡片外面（鏡片會裁切），放在離游標遠的那一邊
    this.info = this.opts.info ? el('div', 'wm-loupe-info', this.dom) : null;
    // 游標移到畫面外時編輯區會捲動（有時晚一格才捲）：捲了就重新對位，不然鏡片留在原地、跟游標分開
    this.scroller = view.dom.closest<HTMLElement>('.wm-scroller');
    if (this.scroller) this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.update();
  }

  // 走到文件開頭（start）、結尾（end）：資訊那一條改寫成提示，鏡片輕輕晃一下；null 收掉提示
  edge(kind: 'start' | 'end' | null): void {
    const was = this.edgeKind;
    this.edgeKind = kind;
    if (kind && kind !== was) {
      this.dom.classList.remove('is-edge');
      void this.dom.offsetWidth;
      this.dom.classList.add('is-edge');
    }
    if (!kind) this.dom.classList.remove('is-edge');
  }

  // 放大鏡可以放的範圍：編輯區看得到的那一塊（捲動區的上下緣，再扣掉被鍵盤蓋住的部分）。
  // 不能用整個視窗：上面是 Obsidian 的檢視標題列與 iOS 的狀態列、瀏海，下面是功能區，放到那裡會被蓋住
  private bounds(win: Window): { top: number; bottom: number } {
    const r = this.scroller ? this.scroller.getBoundingClientRect() : null;
    const top = Math.max(r ? r.top : 0, 0) + 4;
    const bottom = Math.min(r ? r.bottom : win.innerHeight, visibleBottom(win)) - 4;
    return { top, bottom: Math.max(bottom, top + 40) };
  }

  private fillInfo(parts: string[]): void {
    const box = this.info || el('div', 'wm-loupe-info', this.dom);
    this.info = box;
    box.replaceChildren();
    parts.forEach((p, i) => { if (i) el('span', 'wm-loupe-info-dot', box, '·'); el('span', 'wm-loupe-info-part', box, p); });
  }

  // 依目前的游標位置更新內容與位置
  update(): void {
    const { view } = this;
    const sel = view.state.selection;
    const { $head, head } = sel;
    const win = view.dom.ownerDocument.defaultView || window;
    // 停在方程式、圖表這類物件上：不放大（沒有文字），只在物件旁邊寫出是什麼。這時一定顯示資訊。
    // 放在物件下方、對齊左邊：物件上方右邊是它自己的按鈕列、左上角是「按兩下編輯」的標籤，放上面會疊在一起。
    // 下方放不下（被功能區、鍵盤擋住）才放上方
    if (sel instanceof NodeSelection) {
      const dom = view.nodeDOM(sel.from);
      if (!dom || dom.nodeType !== 1) { this.dom.classList.remove('is-shown'); return; }
      const rect = (dom as HTMLElement).getBoundingClientRect();
      const width = this.opts.width;
      const left = Math.max(EDGE, Math.min(rect.left, win.innerWidth - width - EDGE));
      const area = this.bounds(win);
      const below = rect.bottom + INFO_H + 6 <= area.bottom || rect.top - INFO_H - 6 < area.top;
      this.dom.classList.add('is-object');
      this.dom.classList.toggle('is-below', below);
      this.dom.style.width = width + 'px';
      // 高度在樣式表（is-object 是 0）：拿掉文字模式留下的高度
      this.dom.style.removeProperty('height');
      // 物件很高、邊緣已經捲出看得到的範圍時，資訊貼著範圍的邊緣，不要跟著物件跑出去
      const y = below ? Math.max(area.top - 6, Math.min(rect.bottom, area.bottom - INFO_H - 6)) : Math.min(area.bottom, Math.max(rect.top, area.top + INFO_H + 6));
      this.dom.style.transform = 'translate3d(' + Math.round(left) + 'px,' + Math.round(y) + 'px,0)';
      this.fillInfo(this.edgeKind ? [this.edgeKind === 'start' ? t('已到文件開頭') : t('已到文件結尾')] : [objectLabel(sel.node, dom), t('已選取')]);
      this.block = null;
      this.dom.classList.add('is-shown');
      return;
    }
    this.dom.classList.remove('is-object');
    let block: HTMLElement | null = null;
    try {
      const n = $head.depth ? view.nodeDOM($head.before($head.depth)) : null;
      if (n && n.nodeType === 1) block = n as HTMLElement;
    } catch { /* 位置對不到元素：下面當作沒有 */ }
    if (!block || !$head.parent.isTextblock) { this.dom.classList.remove('is-shown'); return; }
    const c = view.coordsAtPos(head);
    const r = block.getBoundingClientRect();
    const { scale: SCALE, width: WIDTH, style } = this.opts;
    const lineH = Math.max(12, c.bottom - c.top);
    const height = Math.round(lineH * SCALE + 22);
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
    // 上下的位置：先放游標上方（手指在下面的功能區，不會擋到）。上方放不下（游標在看得到的範圍頂端）才放下方；
    // 兩邊都放不下（範圍很矮）就放空間比較大的那一邊，再收進範圍裡（寧可稍微蓋到游標那一行，也不要被標題列、功能區蓋住）。
    // 位置資訊在離游標遠的那一邊，也要算進去
    const area = this.bounds(win);
    const infoH = this.opts.info || this.edgeKind ? INFO_H : 0;
    const above = c.top - height - GAP[style];
    const belowTop = c.bottom + GAP[style];
    const fitsAbove = above - infoH >= area.top;
    const fitsBelow = belowTop + height + infoH <= area.bottom;
    const below = !fitsAbove && (fitsBelow || area.bottom - c.bottom > c.top - area.top);
    const top = below
      ? Math.max(area.top, Math.min(belowTop, area.bottom - height - infoH))
      : Math.min(area.bottom - height, Math.max(above, area.top + infoH));
    const markX = c.left - left;
    this.dom.classList.toggle('is-below', below);
    this.dom.style.width = WIDTH + 'px';
    this.dom.style.height = height + 'px';
    this.dom.style.transform = 'translate3d(' + Math.round(left) + 'px,' + Math.round(top) + 'px,0)';
    this.body.style.transform = 'translate3d(' + (markX - (c.left - r.left) * SCALE).toFixed(1) + 'px,' + (height / 2 - ((c.top + c.bottom) / 2 - r.top) * SCALE).toFixed(1) + 'px,0) scale(' + SCALE + ')';
    this.mark.style.transform = 'translate3d(' + markX.toFixed(1) + 'px,0,0)';
    this.mark.style.height = Math.round(lineH * SCALE) + 'px';
    this.tail.style.transform = 'translate3d(' + Math.max(TAIL_INSET, Math.min(markX, WIDTH - TAIL_INSET)).toFixed(1) + 'px,0,0) rotate(45deg)';
    if (this.edgeKind) this.fillInfo([this.edgeKind === 'start' ? t('已到文件開頭') : t('已到文件結尾')]);
    else if (this.opts.info) this.fillInfo(caretInfo($head));
    else if (this.info) { this.info.remove(); this.info = null; }
    this.dom.classList.add('is-shown');
    if (this.dom.classList.contains('is-jump')) {
      // 先讓這一格不帶轉場畫出來，再把轉場開回去
      void this.dom.offsetWidth;
      this.dom.classList.remove('is-jump');
    }
  }

  destroy(): void {
    if (this.scroller) this.scroller.removeEventListener('scroll', this.onScroll);
    this.dom.remove();
  }
}
