import { TableView } from 'prosemirror-tables';
import { CALLOUT_TYPES, calloutIcon, CODE_LANGUAGES } from './commands.js';
import { t, key } from './i18n.js';
import { FOOTNOTE_DEF, FOOTNOTE_REF, footnoteBody, footnoteText, removeFootnote } from './footnotes.js';
import { el, whenVisible, onPress, onKeyPress, keepFocus } from './dom.js';
import { propType, isTagKey, summarize, propLink, convertProp, renameProp, propsSummary, PROP_ICONS as TYPE_ICON, frontmatterBody } from './props.js';
import type { PropType } from './props.js';
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
  // 程式碼區塊要不要顯示行號
  lineNumbers?(): boolean;
  // 很長的圖表與查詢結果要不要先收合（設定「很長的圖表先收合」）
  collapseTall?(): boolean;
  // ---- 對話框、選單、通知
  editSource(title: string, src: string, onSave: TextCallback): void;
  prompt(title: string, value: string, placeholder: string, onSave: TextCallback): void;
  // pos 是 getPos() 的結果，可能是 undefined
  editMath?(pos: number | undefined, src: string, display: boolean): void;
  // 獨立方程式右上角「更多功能」的選單（改成行內、複製 LaTeX…）；pos 是方程式節點的位置
  mathMenu?(evt: MouseEvent, pos: number): void;
  editMermaid?(pos: number): void;
  menu(evt: MouseEvent, items: NodeViewMenuItem[]): void;
  notice?(message: string): void;
  // ---- 註腳
  gotoFootnote?(id: string): void;
  editFootnote?(id: string): void;
  // ---- 文件屬性（frontmatter）
  parseYaml(text: string): unknown;
  stringifyYaml(obj: PropValues): string;
  propsOpen(): boolean;
  setPropsOpen(open: boolean): void;
  // 設定「文件屬性固定在頁面上方」：標題列的圖釘按鈕讀取、切換它
  propsSticky?(): boolean;
  setPropsSticky?(on: boolean): void;
  // Obsidian 為這個屬性設定的類型（text、multitext、number、checkbox、date、datetime…）
  propertyType?(key: string): string | null | undefined;
  // ---- 提示框
  // pos 是 getPos() 的結果，可能是 undefined
  unwrapCallout(pos: number | undefined): void;
}

// 文件屬性區塊的 DOM：view.js 的 openProperties() 呼叫 wmOpen() 展開它；設定改了（例如固定在上方）呼叫 wmRefresh() 重畫
export interface FrontmatterDom extends HTMLDivElement { wmOpen?: () => void; wmRefresh?: () => void; }

// 文件屬性的內容（YAML 解析後的物件）
export type PropValues = Record<string, unknown>;

// 各種節點的屬性（對應 schema.ts 裡各節點 attrs 的設定）。node.attrs 的值是 any，讀取時先轉成這些型別。
// bid 是原文區塊編號，新建立的區塊是 null。
export interface WikilinkAttrs { readonly target: string; readonly alias: string | null; readonly embed: boolean; }
// width：寬度（像素數字的字串）；wiki：是否為 ![[圖片]] 寫法
export interface ImageAttrs { readonly src: string; readonly alt: string | null; readonly title: string | null; readonly wiki: boolean; readonly width: string | null; }
// kind：raw、html、math、comment、footnote 等（見 RAW_LABEL）
export interface RawBlockAttrs { readonly src: string; readonly kind: string; readonly bid: number | null; }
export interface RawInlineAttrs { readonly src: string; }
export interface FrontmatterAttrs { readonly src: string; readonly bid: number | null; }
// checked：null＝一般項目、false／true＝任務；status：自訂任務狀態的字元，一般的 x 為 null
export interface ListItemAttrs { readonly checked: boolean | null; readonly status: string | null; }
// params：``` 後面的語言與參數
export interface CodeBlockAttrs { readonly params: string; readonly bid: number | null; }
// fold：''＝不可摺疊、'+'＝預設展開、'-'＝預設收合；title 是 null 時顯示類型名稱
export interface CalloutAttrs { readonly type: string; readonly title: string | null; readonly fold: string; readonly bid: number | null; }

// 任務狀態：[核取方塊裡的字元, 名稱（翻譯前）, 圖示]
export type TaskStatus = [ch: string, label: I18nKey, icon: string];

// 節點在文件裡的位置；節點顯示元件已經不在畫面上時是 undefined
type GetPos = () => number | undefined;

// node.attrs 的可修改版本（Attrs 是唯讀的）
type MutableAttrs = { -readonly [K in keyof Attrs]: Attrs[K] };

// 特殊節點的顯示方式（ctx 由 Obsidian 端提供）

const isMod = (e: MouseEvent | KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

// 事件發生在內嵌的播放器、影片裡：交給它們自己處理，才能直接操作
const inPlayer = (e: Event): boolean => !!(e.target && (e.target as Element).closest && (e.target as Element).closest('audio, video, iframe'));

// ---------------------------------------------------------------- 各種節點共用的部分

// 改節點的屬性，沒提到的屬性照舊。節點已經不在文件裡（例如對話框開著的時候被刪掉）就不做，回傳 false
function setNodeAttrs(nv: { node: PMNode; view: EditorView; getPos: GetPos }, changes: Attrs): boolean {
  const pos = nv.getPos();
  if (pos == null) return false;
  nv.view.dispatch(nv.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, nv.node.attrs, changes)));
  return true;
}

// 整個節點刪掉（區塊右上角的刪除鍵），可以復原。節點已經不在文件裡就不做
function deleteNode(nv: { node: PMNode; view: EditorView; getPos: GetPos }): void {
  const pos = nv.getPos();
  if (pos == null) return;
  nv.view.dispatch(nv.view.state.tr.delete(pos, pos + nv.node.nodeSize).scrollIntoView());
  nv.view.focus();
}

// 複製到剪貼簿，成功時按鈕短暫變色（.is-done）
function copyWithFeedback(btn: HTMLElement, text: string): void {
  if (!navigator.clipboard) return;
  void navigator.clipboard.writeText(text).then(() => { btn.classList.add('is-done'); window.setTimeout(() => btn.classList.remove('is-done'), 900); });
}

// 獨立一行的方程式 $$…$$；第一組是方程式內容
const MATH_BLOCK = /^\s*\$\$([\s\S]*?)\$\$\s*$/;

// 區塊右上角的小按鈕（程式碼區塊、原文區塊共用）。名稱放在 aria-label，Obsidian 會顯示成提示；
// 按下時不搶走編輯區的焦點（觸控也是，螢幕鍵盤才不會收起來）
function cornerButton(parent: HTMLElement, ctx: Partial<NodeViewContext>, cls: string, label: string, icon: string, fallback: string, run: (e: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls, parent);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  if (ctx.icon) ctx.icon(b, icon, fallback); else b.textContent = fallback;
  keepFocus(b);
  b.addEventListener('click', run);
  return b;
}

// 一次顯示借用、之後要還的東西：Obsidian 的顯示元件（內嵌的筆記、圖表、查詢結果）、還在等的「看得到才畫」。
// 重畫之前與節點移除時呼叫 release() 一次還清，各個節點不用各自記 handle、取消函式再一個一個清
class RenderScope {
  declare owed: (() => void)[];
  constructor() { this.owed = []; }
  add(release: () => void): void { this.owed.push(release); }
  // Obsidian 的顯示元件；回傳同一個 handle，方便接著用
  embed(handle: EmbedHandle): EmbedHandle {
    // 別的外掛註冊的區塊 unload 時可能出錯，不能讓它中斷這邊的重畫
    this.add(() => { try { handle.unload(); } catch { /* 忽略 */ } });
    return handle;
  }
  release(): void { for (const release of this.owed.splice(0)) release(); }
}

// 整塊當成一個東西、內容不能直接打字的節點（連結、圖片、原文、文件屬性）共用的部分：
// 節點換了就視需要重畫、不理會自己畫面的變動、移除時還掉顯示借用的東西。
// 子類別要提供三樣：自己的元素（傳給建構式）、render()、changed()；建構式最後自己呼叫 render()
abstract class AtomView<D extends HTMLElement> implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare ctx: NodeViewContext;
  declare dom: D;
  // 目前畫面借用的東西（重畫前、移除時還掉）
  declare shown: RenderScope;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext, dom: D) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx; this.dom = dom;
    this.shown = new RenderScope();
  }
  abstract render(): void;
  // 節點換了之後畫面要不要重畫；prev 是換掉之前的節點，this.node 已經是新的
  abstract changed(prev: PMNode): boolean;
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const prev = this.node;
    this.node = node;
    if (this.changed(prev)) this.render();
    return true;
  }
  ignoreMutation(): boolean { return true; }
  destroy(): void { this.shown.release(); }
}

// 被整個選取時自己加上選取的樣式。行內原文（RawInlineView）不在這一層：
// 它一直是用 ProseMirror 預設的做法（除了加樣式，還會把元素設成可拖曳），維持原樣
abstract class SelectableAtomView<D extends HTMLElement> extends AtomView<D> {
  selectNode(): void { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode(): void { this.dom.classList.remove('ProseMirror-selectednode'); }
}

function displayTarget(tv: string): string {
  return tv.replace(/\.md$/i, '').replace(/#\^?/, ' › ');
}

class WikilinkView extends SelectableAtomView<HTMLSpanElement> {
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    super(node, view, getPos, ctx, el('span', 'wm-wikilink'));
    this.dom.addEventListener('mousedown', e => {
      if (isMod(e) && e.button === 0) { e.preventDefault(); e.stopPropagation(); ctx.openLink((this.node.attrs as WikilinkAttrs).target, e.shiftKey); }
    });
    this.dom.addEventListener('mouseover', e => { if (ctx.hoverLink) ctx.hoverLink(e, (this.node.attrs as WikilinkAttrs).target, this.dom); });
    this.dom.addEventListener('contextmenu', e => {
      const pos = this.getPos();
      ctx.menu(e, [
        { title: t('開啟連結'), icon: 'file-input', run: () => ctx.openLink((this.node.attrs as WikilinkAttrs).target, false) },
        { title: t('在新分頁開啟'), icon: 'file-plus', run: () => ctx.openLink((this.node.attrs as WikilinkAttrs).target, true) },
        { title: t('編輯連結…'), icon: 'pencil', run: () => ctx.editLinkAt(pos) },
      ]);
    });
    this.render();
  }
  render(): void {
    const a = this.node.attrs as WikilinkAttrs;
    this.shown.release();
    this.dom.replaceChildren();
    this.dom.classList.toggle('is-embed', !!a.embed);
    this.dom.classList.toggle('is-unresolved', !this.ctx.isResolved(a.target));
    // 內嵌（![[筆記]]、![[錄音.mp3]]、![[文件.pdf]]…）：顯示內容，跟 Obsidian 的閱讀畫面一樣
    const embed = !!a.embed && !!this.ctx.renderEmbed;
    this.dom.classList.toggle('wm-embed', embed);
    // 看得到才載入：內嵌的筆記要讀檔、整份顯示，一份筆記嵌了很多份時開啟會很慢
    if (embed) { this.shown.add(whenVisible(this.dom, () => { this.shown.embed(this.ctx.renderEmbed!(a.target, this.dom)); })); return; }
    if (a.embed) { const i = el('span', 'wm-inline-icon', this.dom); this.ctx.icon(i, 'file-text', ''); }
    this.dom.appendChild(activeDocument.createTextNode(a.alias || displayTarget(a.target)));
  }
  changed(prev: PMNode): boolean { return !this.node.sameMarkup(prev); }
  stopEvent(e: Event): boolean { return e.type === 'contextmenu' || inPlayer(e); }
}

export function parseWidth(attrs: Attrs): number | null {
  const a = attrs as ImageAttrs;
  let w = a.width;
  if (!w && !a.wiki && a.alt) { const m = /\|(\d+)(?:x(\d+))?$/.exec(a.alt); if (m) w = m[1]; }
  if (!w) return null;
  const m = /^(\d+)/.exec(String(w));
  return m ? +m[1] : null;
}

export function imageAttrsWithWidth(attrs: Attrs, w: number | null): Attrs {
  const a: MutableAttrs = Object.assign({}, attrs);
  // 讀取用原本的屬性（型別確定）；a 只改 width 和 alt
  const img = attrs as ImageAttrs;
  a.width = w ? String(Math.round(w)) : null;
  if (!img.wiki && img.alt) a.alt = img.alt.replace(/\|\d+(x\d+)?$/, '') || null;
  return a;
}

class ImageView extends SelectableAtomView<HTMLSpanElement> {
  declare img: HTMLImageElement;
  declare missing: HTMLSpanElement;
  declare embedEl: HTMLSpanElement;
  declare badge: HTMLSpanElement;
  // 目前顯示成內嵌內容的來源；顯示成圖片時是 null
  declare embedKey: string | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    super(node, view, getPos, ctx, el('span', 'wm-image'));
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
    const a = this.node.attrs as ImageAttrs;
    // ![](…) 也可能是影片、錄音、PDF、筆記或 YouTube：顯示成內嵌的內容，不是破圖
    const kind = this.ctx.mediaKind ? this.ctx.mediaKind(a.src) : 'image';
    const embed = kind !== 'image' && kind !== 'missing' && !!this.ctx.renderEmbed;
    this.dom.classList.toggle('wm-embed', embed);
    if (embed) {
      if (this.embedKey !== a.src) { this.shown.release(); this.embedKey = a.src; this.shown.embed(this.ctx.renderEmbed!(a.src, this.embedEl)); }
      return;
    }
    if (this.embedKey != null) { this.shown.release(); this.embedKey = null; this.embedEl.replaceChildren(); }
    const url = this.ctx.resolveImage(a);
    if (url) {
      if (this.img.getAttribute('src') !== url) this.img.src = url;
      this.img.show();
      this.missing.hide();
    } else {
      this.img.hide();
      this.missing.show();
      this.missing.replaceChildren();
      const i = el('span', 'wm-inline-icon', this.missing); this.ctx.icon(i, 'image-off', '');
      this.missing.appendChild(activeDocument.createTextNode(t('找不到圖片：') + a.src));
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
    try { handle.setPointerCapture(e.pointerId); } catch { /* 舊環境 */ }
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
  // 每次都重畫；render() 自己會略過沒變的部分（網址一樣不重設 src、內嵌的來源一樣不重新載入）
  changed(): boolean { return true; }
  stopEvent(e: Event): boolean {
    return (e.target && (e.target as Element).classList && (e.target as Element).classList.contains('wm-image-handle')) || e.type === 'contextmenu' || inPlayer(e);
  }
}

const RAW_LABEL: Record<string, string> = {
  callout: t('提示框'), html: 'HTML', math: t('數學式'), comment: t('註解'), raw: t('Markdown 原文'), footnote: t('註腳'),
};

class RawBlockView extends SelectableAtomView<HTMLDivElement> {
  declare label: HTMLDivElement;
  declare body: HTMLDivElement;
  // 右上角的小按鈕：編輯、更多功能（只有方程式）或複製、刪除。名稱與顯示哪幾顆在 render() 依種類決定
  declare tools: HTMLDivElement;
  declare editBtn: HTMLButtonElement;
  declare moreBtn: HTMLButtonElement;
  declare copyBtn: HTMLButtonElement;
  declare delBtn: HTMLButtonElement;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    super(node, view, getPos, ctx, el('div', 'wm-raw-block'));
    this.dom.contentEditable = 'false';
    this.label = el('div', 'wm-raw-label', this.dom);
    this.tools = el('div', 'wm-block-tools', this.dom);
    this.editBtn = cornerButton(this.tools, ctx, 'wm-block-edit', t('編輯原文'), 'pencil', t('編輯原文'), () => this.edit());
    this.moreBtn = cornerButton(this.tools, ctx, 'wm-block-more', t('更多功能'), 'more-horizontal', '⋯', e => {
      const pos = this.getPos();
      if (pos != null && ctx.mathMenu) ctx.mathMenu(menuEvent(e, this.moreBtn), pos);
    });
    this.copyBtn = cornerButton(this.tools, ctx, 'wm-block-copy', t('複製為 Markdown'), 'copy', t('複製為 Markdown'), () => copyWithFeedback(this.copyBtn, (this.node.attrs as RawBlockAttrs).src));
    this.delBtn = cornerButton(this.tools, ctx, 'wm-block-delete', t('刪除這個區塊'), 'trash-2', t('刪除這個區塊'), () => this.remove());
    this.body = el('div', 'wm-raw-body', this.dom);
    // 很快連按兩下右上角的按鈕不算按兩下區塊（不然按「更多功能」兩下會連編輯的對話框也打開）
    this.dom.addEventListener('dblclick', e => { e.preventDefault(); if (!this.tools.contains(e.target as Node)) this.edit(); });
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
    const a = this.node.attrs as RawBlockAttrs;
    // RAW_LABEL 的值是載入時 t() 的結果或 'HTML'，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    this.label.textContent = t((RAW_LABEL[a.kind] || RAW_LABEL.raw) as I18nKey) + t('（按兩下編輯）');
    this.dom.dataset.kind = a.kind;
    this.body.replaceChildren();
    this.shown.release();
    const fn = a.kind === 'footnote' && FOOTNOTE_DEF.exec(a.src);
    // 方程式的「更多功能」有改成行內、複製 LaTeX 等好幾項；其他區塊能做的只有複製原文，直接放一顆複製鍵
    const math = a.kind === 'math' && MATH_BLOCK.test(a.src);
    this.editBtn.setAttribute('aria-label', math ? t('編輯方程式') : fn ? t('編輯註腳…') : t('編輯原文'));
    this.moreBtn.hidden = !(math && this.ctx.mathMenu);
    this.copyBtn.hidden = math;
    this.delBtn.setAttribute('aria-label', math ? t('刪除方程式') : fn ? t('刪除註腳（連同文中的編號）') : t('刪除這個區塊'));
    if (fn) {
      // 註腳定義：顯示編號與內容（內容照 Markdown 顯示）
      this.label.textContent = t('註腳') + ' ' + fn[1] + t('（按兩下編輯）');
      const body = footnoteBody(a.src);
      if (!body.trim()) this.body.textContent = t('（空白）');
      else if (this.ctx.renderBlock) this.shown.embed(this.ctx.renderBlock(body, this.body));
      else this.body.textContent = body;
      return;
    }
    if (a.kind === 'comment') { el('pre', 'wm-raw-comment', this.body, a.src); return; }
    if (this.ctx.renderBlock) this.shown.embed(this.ctx.renderBlock(a.src, this.body));
    else this.ctx.renderMarkdown(a.src, this.body);
  }
  edit(): void {
    const a = this.node.attrs as RawBlockAttrs;
    const fn = a.kind === 'footnote' && FOOTNOTE_DEF.exec(a.src);
    if (fn && this.ctx.editFootnote) { this.ctx.editFootnote(fn[1]); return; }
    const mm = a.kind === 'math' && MATH_BLOCK.exec(a.src);
    if (mm && this.ctx.editMath) { this.ctx.editMath(this.getPos(), mm[1].trim(), true); return; }
    // RAW_LABEL 的值是載入時 t() 的結果或 'HTML'，不一定是鍵；再翻一次，找不到時 t() 原樣回傳。
    // 標題用帶變數的整句（「編輯{name}」）：各語言的語序不同，直接拼起來英文還會變成「EditingHTML」
    this.ctx.editSource(t('編輯{name}', { name: t((RAW_LABEL[a.kind] || RAW_LABEL.raw) as I18nKey) }), a.src, value => { setNodeAttrs(this, { src: value.replace(/\s+$/, '') }); });
  }
  // 右上角的刪除鍵。註腳的內容連同文中的編號一起刪：只刪內容的話，文中會留下對不到內容的 [^1]，存成 Markdown 就變成一般文字
  remove(): void {
    const fn = this.node.attrs.kind === 'footnote' && FOOTNOTE_DEF.exec((this.node.attrs as RawBlockAttrs).src);
    if (fn && removeFootnote(fn[1])(this.view.state, tr => this.view.dispatch(tr.scrollIntoView()))) { this.view.focus(); return; }
    deleteNode(this);
  }
  // bid（原文區塊的編號）變了不用重畫
  changed(prev: PMNode): boolean { return this.node.attrs.src !== prev.attrs.src || this.node.attrs.kind !== prev.attrs.kind; }
  // 右上角按鈕上的事件（按下、鍵盤）留給按鈕自己，編輯器不要拿去選取整個區塊
  stopEvent(e: Event): boolean { return e.type === 'dblclick' || (e.type === 'mousedown' && isMod(e as MouseEvent)) || this.tools.contains(e.target as Node); }
}

class RawInlineView extends AtomView<HTMLSpanElement> {
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    super(node, view, getPos, ctx, el('span', 'wm-raw-inline'));
    this.dom.addEventListener('dblclick', e => { e.preventDefault(); this.edit(); });
    // 註腳：滑鼠移上去顯示內容；按住 Ctrl／Cmd 點一下跳到內容
    this.dom.addEventListener('mouseenter', () => this.footnoteTip());
    this.dom.addEventListener('mousedown', e => {
      const m = FOOTNOTE_REF.exec((this.node.attrs as RawInlineAttrs).src);
      if (m && isMod(e) && e.button === 0 && this.ctx.gotoFootnote) { e.preventDefault(); e.stopPropagation(); this.ctx.gotoFootnote(m[1]); }
    });
    this.render();
  }
  footnoteTip(): void {
    const m = FOOTNOTE_REF.exec((this.node.attrs as RawInlineAttrs).src);
    if (!m) return;
    // 直接從自己所在的編輯器讀，不經過 ctx.footnoteText：第一份筆記是在建立編輯器的過程中畫出來的，
    // 那時 view.ts 還拿不到編輯器，ctx.footnoteText 會出錯，有註腳的筆記就整份開不起來
    const text = footnoteText(this.view.state.doc, m[1]);
    this.dom.classList.toggle('is-missing', text == null);
    this.dom.setAttribute('aria-label', text == null ? t('找不到這個註腳的內容（按兩下新增）') : t('註腳') + ' ' + m[1] + '\n' + text);
  }
  render(): void {
    const s = (this.node.attrs as RawInlineAttrs).src;
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
    const a = this.node.attrs as RawInlineAttrs;
    const m = /^\$\$([\s\S]+)\$\$$/.exec(a.src) || /^\$([^$][\s\S]*)\$$/.exec(a.src);
    if (m && this.ctx.editMath) { this.ctx.editMath(this.getPos(), m[1].trim(), false); return; }
    const fn = FOOTNOTE_REF.exec(a.src);
    if (fn && this.ctx.editFootnote) { this.ctx.editFootnote(fn[1]); return; }
    this.ctx.editSource(t('編輯原文'), a.src, value => { if (value) setNodeAttrs(this, { src: value }); });
  }
  changed(prev: PMNode): boolean { return this.node.attrs.src !== prev.attrs.src; }
  stopEvent(e: Event): boolean { return e.type === 'dblclick'; }
}

// 不是 <button> 的元素當按鈕或連結用：讓 Tab 走得到，也讓輔助工具知道它能按。
// 不直接換成 <button>：Obsidian 與佈景主題給 button 的底色、陰影、高度會跑出來，樣子就變了
function focusable(target: HTMLElement, role: 'button' | 'link'): void {
  target.setAttribute('role', role);
  target.tabIndex = 0;
}

// ctx.menu 照滑鼠事件的位置開選單。用鍵盤開的時候沒有滑鼠位置：改給一個位置在控制項左下角的滑鼠事件。
// 用 Enter、空白鍵按 <button> 時，瀏覽器送的是 click，但沒有滑鼠位置（detail 是 0）
function menuEvent(e: MouseEvent | KeyboardEvent, anchor: HTMLElement): MouseEvent {
  if (e.type !== 'keydown' && !(e.type === 'click' && e.detail === 0)) return e as MouseEvent;
  const r = anchor.getBoundingClientRect();
  return new MouseEvent('click', { clientX: r.left, clientY: r.bottom, view: anchor.ownerDocument.defaultView });
}

// 文件屬性（frontmatter / metadata）：像 Word 的「摘要資訊」，以表單編輯，存回 YAML。
// 類型的判斷與轉換在 props.ts。
const TYPE_LABEL: Record<PropType, string> = { text: t('文字'), list: t('清單'), number: t('數字'), checkbox: t('核取方塊'), date: t('日期'), datetime: t('日期時間'), object: t('其他') };
// 可以從選單換成的類型（巢狀資料只能用原文編輯）
const EDITABLE_TYPES: Exclude<PropType, 'object'>[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];

// 重畫時把元素整批換新的區塊，用這個留住焦點（不然改一個值、按一顆按鈕，焦點就掉到整個視窗上，鍵盤接不下去）。
// 畫的時候替每個能取得焦點的控制項取一個重畫前後不變的名稱（keep），重畫之後焦點回到同名的控制項
class FocusKeeper {
  // 這一次畫出來的控制項，依畫面上的順序
  declare now: Map<string, HTMLElement>;
  // 每個登記過的元素叫什麼；已經被換掉的舊元素也要認得（follow 用）
  declare names: WeakMap<EventTarget, string>;
  constructor() { this.now = new Map(); this.names = new WeakMap(); }
  keep<T extends HTMLElement>(name: string, target: T): T {
    this.now.set(name, target);
    this.names.set(target, name);
    return target;
  }
  // 執行 draw（把 root 裡的元素換新，並用 keep 登記新的控制項）；焦點原本在 root 的某個控制項上就接回去
  redraw(root: HTMLElement, draw: () => void): void {
    const active = root.ownerDocument.activeElement;
    const name = active ? this.names.get(active) : undefined;
    const order = [...this.now.keys()];
    const had = name != null && this.now.get(name) === active;
    // 文字欄位才有游標位置（數字、日期欄位讀不到）
    const field = had && (active as HTMLInputElement).type === 'text' ? active as HTMLInputElement : null;
    const caret = field ? { value: field.value, start: field.selectionStart, end: field.selectionEnd } : null;
    this.now = new Map();
    draw();
    if (!had) return;
    // 原本的控制項不在了（刪掉的那一列、最後一個標籤的 ×）：給畫面上接在它後面的那一個，後面沒有就往前找
    const at = order.indexOf(name);
    const next = [name, ...order.slice(at + 1), ...order.slice(0, at).reverse()].find(n => this.now.has(n));
    const target = next != null ? this.now.get(next) : undefined;
    if (!target) return;
    target.focus({ preventScroll: true });
    // 同一個欄位、內容也沒變：游標放回原來的位置
    if (next === name && caret && (target as HTMLInputElement).value === caret.value) (target as HTMLInputElement).setSelectionRange(caret.start, caret.end);
  }
  // 焦點正要移過去的元素（blur 事件的 relatedTarget）已經在重畫時被換掉了：接到新畫出來的同名控制項。
  // 離開輸入框時才存檔、重畫的欄位會這樣：重畫發生在焦點移過去之前，使用者按 Tab 或用滑鼠點的那個控制項就不在了
  follow(next: EventTarget | null): void {
    const name = next ? this.names.get(next) : undefined;
    const target = name != null ? this.now.get(name) : undefined;
    if (target && target !== next) target.focus({ preventScroll: true });
  }
}

class FrontmatterView extends SelectableAtomView<FrontmatterDom> {
  declare keeper: FocusKeeper;
  // 畫了幾次。每一列記著自己是第幾次畫的，整塊重畫之後那一列就作廢（見 row 的 set）
  declare drawn: number;
  // 這次存檔先不重畫（人可能還在欄位裡，見 row 的 save）
  declare quiet: boolean;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx: NodeViewContext) {
    super(node, view, getPos, ctx, el('div', 'wm-props'));
    this.keeper = new FocusKeeper();
    this.drawn = 0;
    this.quiet = false;
    this.dom.contentEditable = 'false';
    this.dom.wmOpen = () => { this.ctx.setPropsOpen(true); this.render(); };
    this.dom.wmRefresh = () => this.render();
    this.render();
  }
  inner(): string { return frontmatterBody((this.node.attrs as FrontmatterAttrs).src); }
  data(): PropValues | null {
    const tv = this.inner();
    if (!tv.trim()) return {};
    try {
      const o = this.ctx.parseYaml(tv);
      return o && typeof o === 'object' && !Array.isArray(o) ? o as PropValues : null;
    } catch { return null; }
  }
  commit(obj: PropValues): void {
    const body = Object.keys(obj).length ? this.ctx.stringifyYaml(obj).replace(/\s+$/, '') + '\n' : '';
    setNodeAttrs(this, { src: '---\n' + body + '---' });
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
    this.ctx.editSource(t('編輯文件屬性（YAML 原文）'), (this.node.attrs as FrontmatterAttrs).src, value => {
      let v = value.replace(/\s+$/, '');
      if (!/^---\r?\n/.test(v)) v = '---\n' + v;
      if (!/\n(---|\.\.\.)$/.test(v)) v += '\n---';
      setNodeAttrs(this, { src: v });
    });
  }
  // 每次都整塊重畫（元素全部換新），焦點由 keeper 接回去
  render(): void {
    this.drawn++;
    this.keeper.redraw(this.dom, () => this.draw());
  }
  draw(): void {
    const open = this.ctx.propsOpen();
    const d = this.dom;
    d.replaceChildren();
    d.classList.toggle('is-collapsed', !open);
    const obj = this.data();
    const head = el('div', 'wm-props-head', d);
    const chev = el('span', 'wm-props-chev', head); this.ctx.icon(chev, open ? 'chevron-down' : 'chevron-right', open ? '▾' : '▸');
    // 跟「查看文件屬性」小視窗、固定在上方的屬性列用同一個圖示，看得出是同一份資料
    this.ctx.icon(el('span', 'wm-props-badge', head), 'clipboard-list', '');
    const title = this.keeper.keep('title', el('span', 'wm-props-title', head, t('文件屬性')));
    // 收合時在標題列顯示內容摘要，不用展開也看得到重點
    const count = obj ? t('{n} 個屬性', { n: Object.keys(obj).length }) : 'YAML';
    el('span', 'wm-props-count', head, obj && !open ? (propsSummary(obj) || count) : count);
    const toggle = (): void => { this.ctx.setPropsOpen(!this.ctx.propsOpen()); this.render(); };
    // 滑鼠按標題列的任何地方都能收合、展開；鍵盤則是走到標題的文字上按 Enter 或空白鍵。
    // 不把整條標題列當成按鈕：裡面還有「原文」「移除」兩顆按鈕，按鈕裡再放按鈕，輔助工具會把裡面的當成純文字
    head.addEventListener('mousedown', e => { e.preventDefault(); toggle(); });
    focusable(title, 'button');
    title.setAttribute('aria-expanded', String(open));
    onKeyPress(title, toggle);
    // 圖釘：切換「文件屬性固定在頁面上方」（往下捲動時上方浮出精簡的屬性列）。開著的時候一直顯示並用強調色
    const ctx = this.ctx;
    if (ctx.propsSticky && ctx.setPropsSticky) {
      const on = ctx.propsSticky();
      const pin = this.keeper.keep('pin', el('button', 'wm-props-raw wm-props-pin', head)); pin.type = 'button';
      pin.setAttribute('aria-label', t('文件屬性固定在頁面上方'));
      pin.setAttribute('aria-pressed', String(on));
      pin.classList.toggle('is-active', on);
      this.ctx.icon(pin, 'pin', t('文件屬性固定在頁面上方'));
      onPress(pin, e => { e.stopPropagation(); if (ctx.setPropsSticky && ctx.propsSticky) ctx.setPropsSticky(!ctx.propsSticky()); });
    }
    const raw = this.keeper.keep('raw', el('button', 'wm-props-raw', head)); raw.type = 'button'; raw.setAttribute('aria-label', t('編輯 YAML 原文')); this.ctx.icon(raw, 'code-2', t('原文'));
    // stopPropagation：這幾顆在標題列裡，不能連帶收合
    onPress(raw, e => { e.stopPropagation(); this.editRaw(); });
    const rm = this.keeper.keep('remove', el('button', 'wm-props-raw wm-props-remove', head)); rm.type = 'button'; rm.setAttribute('aria-label', t('移除文件屬性')); this.ctx.icon(rm, 'trash-2', t('移除'));
    onPress(rm, e => { e.stopPropagation(); this.remove(); });
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
    const r = el('div', 'wm-prop wm-prop-' + type, body);
    const k = el('div', 'wm-prop-key', r);
    // 整塊重畫之後，這一列的元素已經不在畫面上，手上的 obj 也是舊的：不能再存。
    // 被換掉的輸入框還會收到 change、blur（瀏覽器拿掉有焦點的元素時送出）；放著不管，打到一半的內容會連同那份舊資料
    // 一起存回去，把文件裡新的內容蓋掉（例如筆記剛被同步改過）
    const drawn = this.drawn;
    const set = (nv: unknown): void => {
      if (drawn !== this.drawn) return;
      const o = Object.assign({}, obj); o[key] = nv; this.commit(o);
    };
    // 這一列的控制項在重畫前後的名稱：種類＋屬性名稱（清單裡的再加第幾個）
    const keep = <T extends HTMLElement>(kind: string, target: T, i?: number): T => this.keeper.keep(kind + '\n' + key + (i == null ? '' : '\n' + i), target);
    // 類型圖示：點一下換類型或改名
    const ic = keep('type', el('button', 'wm-prop-icon', k)); ic.type = 'button'; this.ctx.icon(ic, TYPE_ICON[type], '');
    ic.setAttribute('aria-label', t('變更類型或重新命名'));
    onPress(ic, e => this.keyMenu(menuEvent(e, ic), obj, key, type));
    const name = el('span', 'wm-prop-name', k, key);
    name.addEventListener('dblclick', e => { e.preventDefault(); this.rename(obj, key); });
    // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    name.setAttribute('aria-label', key + t('（') + t(TYPE_LABEL[type] as I18nKey) + t('）'));
    const v = el('div', 'wm-prop-value', r);
    if (type === 'list') {
      const arr: unknown[] = Array.isArray(value) ? value.slice() : (value == null || value === '' ? [] : [value]);
      const tag = isTagKey(key);
      arr.forEach((item, i) => {
        const link = propLink(item);
        const chip = el('span', 'wm-chip' + (tag ? ' wm-chip-tag' : '') + (link ? ' wm-chip-link' : ''), v);
        const text = summarize(item);
        const label = el('span', 'wm-chip-text', chip, link ? link.text : (tag && !text.startsWith('#') ? '#' : '') + text);
        if (link) { focusable(keep('link', label, i), 'link'); this.linkify(label, link.target); }
        const x = keep('unlist', el('span', 'wm-chip-x', chip, '×'), i);
        x.setAttribute('aria-label', t('移除'));
        focusable(x, 'button');
        onPress(x, () => { const a = arr.slice(); a.splice(i, 1); set(a); });
      });
      const inp = keep('value', el('input', 'wm-prop-input wm-chip-input', v));
      inp.placeholder = t('新增…');
      const add = () => {
        const tv = inp.value.trim().replace(/^#/, '');
        if (!tv) return;
        // [[筆記|別名]] 裡的逗號不是分隔
        set(arr.concat(/^\[\[.*\]\]$/.test(tv) ? [tv] : tv.split(/[,，]\s*/).filter(Boolean)));
      };
      // isComposing：輸入法選字中的 Enter 是確定選字，不是加入這一項
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
      inp.addEventListener('blur', e => { add(); this.keeper.follow(e.relatedTarget); });
    } else if (type === 'checkbox') {
      const cb = keep('value', el('input', 'wm-prop-check', v)); cb.type = 'checkbox'; cb.checked = !!value;
      cb.addEventListener('change', () => set(cb.checked));
    } else if (type === 'object') {
      // 巢狀資料：照結構一層一層列出來（唯讀），要改請用「原文」
      this.tree(v, value);
      v.setAttribute('aria-label', t('巢狀資料請用「原文」編輯'));
    } else {
      const inp = keep('value', el('input', 'wm-prop-input', v));
      inp.type = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text';
      // 文字、數字、日期欄位的值是 YAML 的純量（文字、數字或布林）
      const scalar = value as string | number | boolean | null | undefined;
      inp.value = scalar == null ? '' : String(scalar).slice(0, type === 'datetime' ? 16 : undefined);
      inp.placeholder = t('（空白）');
      // 這個欄位目前存在文件裡的值
      let saved = value;
      const save = () => {
        let nv: string | number | null = inp.value;
        if (type === 'number') nv = nv === '' ? null : Number(nv);
        else if (nv === '') nv = null;
        if (nv === saved || (nv === null && saved == null)) return;
        saved = nv;
        // 先存檔、不重畫，離開欄位（blur）時才畫。日期欄位每改完一段（年、月、日）、數字欄位每按一次上下鍵，
        // 瀏覽器就送出 change，人還在欄位裡；這時重畫會把欄位換成新的，打到一半就斷了。
        // 沒重畫，其他列手上的 obj（同一個物件）就要跟著改，否則它們下次存檔會把這個值蓋回去
        obj[key] = nv;
        this.quiet = true;
        try { set(nv); } finally { this.quiet = false; }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('change', save);
      inp.addEventListener('blur', e => {
        // 改過才重畫（值變了，類型、旁邊的開啟按鈕可能跟著變）；這一列已經作廢（整塊重畫過）就不用
        if (saved !== value && drawn === this.drawn) this.render();
        this.keeper.follow(e.relatedTarget);
      });
      // 值是 [[筆記]] 或網址：旁邊放一個開啟的按鈕
      const link = type === 'text' ? propLink(value) : null;
      if (link) {
        const open = keep('open', el('button', 'wm-prop-open', v)); open.type = 'button'; this.ctx.icon(open, 'external-link', '↗');
        open.setAttribute('aria-label', t('開啟連結'));
        this.linkify(open, link.target);
      }
    }
    const del = keep('delete', el('button', 'wm-prop-del', r)); del.type = 'button'; del.setAttribute('aria-label', t('刪除這個屬性')); this.ctx.icon(del, 'x', '×');
    onPress(del, () => { const o = Object.assign({}, obj); delete o[key]; this.commit(o); });
  }
  // 點一下（或按 Enter）開啟連結；按住 Ctrl／Cmd 或 Shift 開在新分頁
  linkify(target: HTMLElement, link: string): void {
    onPress(target, e => { e.stopPropagation(); this.ctx.openLink(link, isMod(e) || e.shiftKey); });
  }
  // 巢狀資料的唯讀樹狀顯示
  tree(parent: HTMLElement, value: unknown): void {
    const box = el('div', 'wm-prop-tree', parent);
    const entries: [string, unknown][] = Array.isArray(value) ? value.map((item, i): [string, unknown] => [String(i + 1), item]) : Object.entries(value as PropValues);
    for (const [k, item] of entries) {
      const row = el('div', 'wm-prop-tree-row', box);
      el('span', 'wm-prop-tree-key', row, k);
      if (item && typeof item === 'object' && !(item instanceof Date)) this.tree(row, item);
      else el('span', 'wm-prop-tree-value', row, summarize(item));
    }
  }
  // 類型圖示的選單：換類型（內容盡量保留）、重新命名
  keyMenu(e: MouseEvent, obj: PropValues, key: string, type: PropType): void {
    const items: NodeViewMenuItem[] = [];
    if (type !== 'object') {
      for (const ty of EDITABLE_TYPES) {
        items.push({
          // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
          title: t(TYPE_LABEL[ty] as I18nKey) + (ty === type ? '  ✓' : ''), icon: TYPE_ICON[ty],
          run: () => { if (ty === type) return; const o = Object.assign({}, obj); o[key] = convertProp(obj[key], ty); this.commit(o); },
        });
      }
    }
    items.push({ title: t('重新命名…'), icon: 'pencil', run: () => this.rename(obj, key) });
    this.ctx.menu(e, items);
  }
  rename(obj: PropValues, key: string): void {
    this.ctx.prompt(t('重新命名屬性'), key, '', value => { const o = renameProp(obj, key, value); if (o) this.commit(o); });
  }
  addRow(body: HTMLElement, obj: PropValues): void {
    const r = el('div', 'wm-prop wm-prop-add', body);
    // 名稱不跟各列的（種類＋換行＋屬性名稱）撞在一起：這三個沒有換行
    const k = this.keeper.keep('new-name', el('input', 'wm-prop-input', r)); k.placeholder = t('＋ 新增屬性名稱');
    const tv = this.keeper.keep('new-type', el('select', 'wm-prop-type dropdown', r));
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
    k.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    const b = this.keeper.keep('new-add', el('button', 'wm-prop-addbtn', r, t('新增'))); b.type = 'button';
    onPress(b, go);
  }
  changed(prev: PMNode): boolean { return !this.quiet && this.node.attrs.src !== prev.attrs.src; }
  stopEvent(): boolean { return true; }
}

// 任務的狀態（- [/]、- [-] 等是 Tasks 外掛與許多佈景主題通用的寫法）
const TASK_STATUSES: TaskStatus[] = [[' ', '待辦', 'square'], ['x', '完成', 'check-square'], ['/', '進行中', 'loader'], ['-', '已取消', 'minus-square'], ['>', '已延後', 'arrow-right-square'], ['!', '重要', 'alert-circle'], ['?', '有疑問', 'help-circle']];

class ListItemView implements NodeView {
  declare node: PMNode;
  declare view: EditorView;
  declare getPos: GetPos;
  declare dom: HTMLLIElement;
  declare cb: HTMLInputElement | undefined;
  declare contentDOM: HTMLDivElement;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx?: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = createEl('li');
    if (node.attrs.checked != null) {
      this.dom.className = 'wm-task';
      this.cb = el('input', 'task-list-item-checkbox', this.dom);
      this.cb.type = 'checkbox';
      this.cb.contentEditable = 'false';
      this.cb.addEventListener('mousedown', e => {
        e.preventDefault();
        // 點一下：未完成 ⇄ 完成；自訂狀態（/、-、> 等）點一下回到未完成，跟 Obsidian 一樣
        setNodeAttrs(this, { checked: !this.node.attrs.checked, status: null });
      });
    }
    if (this.cb && ctx && ctx.menu) {
      // 右鍵：選任務的狀態
      this.cb.addEventListener('contextmenu', e => {
        e.stopPropagation();
        ctx.menu(e, TASK_STATUSES.map(([ch, label, icon]) => ({
          title: t(label) + (ch === ' ' ? '' : '  [' + ch + ']'), icon,
          run: () => { setNodeAttrs(this, { checked: ch !== ' ', status: ch === ' ' || ch === 'x' ? null : ch }); },
        })));
      });
    }
    this.contentDOM = el('div', 'wm-li-content', this.dom);
    this.sync();
  }
  sync(): void {
    if (!this.cb) return;
    const a = this.node.attrs as ListItemAttrs;
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
// 程式碼區塊的結果（圖表、查詢）超過這個高度（像素）就先收合
const TALL_LIMIT = 640;

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
  declare delBtn: HTMLButtonElement;
  declare body: HTMLDivElement;
  declare gutter: HTMLDivElement;
  declare lines: number | undefined;
  declare pre: HTMLPreElement;
  declare contentDOM: HTMLElement;
  declare preview: HTMLDivElement;
  // 打字時延後重畫結果的計時器
  declare timer: number | undefined;
  // 目前的結果借用的東西（Obsidian 的顯示元件、還在等的「看得到才畫」）
  declare shown: RenderScope;
  declare rendered: string | null | undefined;
  // 很長的結果：收合時下方的「顯示完整內容」按鈕；expanded 是使用者按開了
  declare more: HTMLButtonElement;
  declare expanded: boolean;
  declare sizer: ResizeObserver | null | undefined;
  constructor(node: PMNode, view: EditorView, getPos: GetPos, ctx?: NodeViewContext) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx || {};
    this.shown = new RenderScope();
    this.expanded = false;
    this.dom = el('div', 'wm-codeblock');
    this.head = el('div', 'wm-code-head', this.dom);
    this.head.contentEditable = 'false';
    this.sel = el('select', 'wm-code-langsel dropdown', this.head);
    this.sel.setAttribute('aria-label', t('程式語言'));
    el('span', 'wm-code-spacer', this.head);
    const btn = (cls: string, label: string, icon: string, fallback: string, run: () => void): HTMLButtonElement => cornerButton(this.head, this.ctx, cls, label, icon, fallback, run);
    this.editBtn = btn('wm-code-edit', t('編輯圖表（表單或程式碼，含即時預覽）'), 'workflow', t('編輯圖表'), () => { const pos = this.getPos(); if (pos != null && this.ctx.editMermaid) this.ctx.editMermaid(pos); });
    this.srcBtn = btn('wm-code-src', t('顯示／隱藏原始碼'), 'code-2', t('原始碼'), () => this.toggleSource());
    this.copy = btn('wm-code-copy', t('複製程式碼'), 'copy', t('複製'), () => copyWithFeedback(this.copy, this.node.textContent));
    // 只有顯示成結果的區塊（圖表、查詢）有：整塊是一張圖，不像程式碼可以選取文字再刪。名稱在 syncPreview 依語言換
    this.delBtn = btn('wm-code-delete', t('刪除圖表'), 'trash-2', t('刪除圖表'), () => deleteNode(this));
    this.sel.addEventListener('change', () => {
      if (this.sel.value === '__other') {
        this.syncSelect();
        if (this.ctx.prompt) this.ctx.prompt(t('程式語言'), (this.node.attrs as CodeBlockAttrs).params || '', 'python, sql, json…', v => this.setLang(v.trim()));
        return;
      }
      this.setLang(this.sel.value);
    });
    // 行號放在程式碼左邊的欄；開啟行號時程式碼不自動換行，行號才對得上
    this.body = el('div', 'wm-code-body', this.dom);
    this.gutter = el('div', 'wm-code-gutter', this.body);
    this.gutter.contentEditable = 'false';
    this.gutter.setAttribute('aria-hidden', 'true');
    this.pre = el('pre', 'wm-code', this.body);
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
    // 很長的圖表或查詢結果先收合成固定的高度，按這顆按鈕展開或收回
    this.more = el('button', 'wm-code-more', this.dom);
    this.more.type = 'button';
    this.more.contentEditable = 'false';
    this.more.hidden = true;
    this.more.addEventListener('mousedown', e => e.preventDefault());
    this.more.addEventListener('click', () => { this.expanded = !this.expanded; this.syncTall(); });
    // 結果是另外非同步畫出來的（圖表、查詢），大小變了就重新判斷要不要收合
    if (typeof ResizeObserver !== 'undefined') { this.sizer = new ResizeObserver(() => this.syncTall()); this.sizer.observe(this.preview); }
    this.syncSelect();
    this.syncLines();
    this.syncPreview(true);
  }
  lang(): string { return ((this.node.attrs as CodeBlockAttrs).params || '').trim().split(/\s+/)[0].toLowerCase(); }
  setLang(lang: string): void {
    if (setNodeAttrs(this, { params: lang })) this.view.focus();
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
    const cur = ((this.node.attrs as CodeBlockAttrs).params || '').trim();
    this.sel.replaceChildren();
    const list = CODE_LANGUAGES.slice();
    if (cur && !list.some(([v]) => v === cur)) list.push([cur, cur]);
    // label 是語言名稱或筆記裡寫的語言（不翻譯）；只有 v 是空字串時才是介面文字「純文字」，型別分不出來所以轉型
    for (const [v, label] of list) { const o = el('option', null, this.sel, v ? label : t(label as I18nKey)); o.value = v; }
    const o = el('option', null, this.sel, t('其他…')); o.value = '__other';
    this.sel.value = cur;
    this.pre.dataset && (this.pre.dataset.lang = cur);
  }
  syncLines(): void {
    const on = !!(this.ctx.lineNumbers && this.ctx.lineNumbers());
    this.dom.classList.toggle('has-lines', on);
    if (!on) return;
    const n = this.node.textContent.split('\n').length;
    if (n === this.lines) return;
    this.lines = n;
    this.gutter.textContent = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
  }
  dispose(): void {
    window.clearTimeout(this.timer);
    this.shown.release();
  }
  // 結果很高（超過 TALL_LIMIT）時收合成固定的高度，下面放「顯示完整內容」；游標在區塊裡編輯時不收合
  syncTall(): void {
    const on = !this.ctx.collapseTall || this.ctx.collapseTall();
    const tall = on && this.dom.classList.contains('has-preview') && this.preview.scrollHeight > TALL_LIMIT;
    this.dom.classList.toggle('is-tall', tall && !this.expanded);
    this.more.hidden = !tall;
    // 按鈕裡是置中的小膠囊：箭頭圖示加文字（樣式見 .wm-code-more-pill）。ResizeObserver 常常呼叫這裡，文字沒變就不重做
    const label = this.expanded ? t('收合') : t('顯示完整內容');
    if (!tall || this.more.textContent === label) return;
    const pill = el('span', 'wm-code-more-pill');
    const icon = el('span', 'wm-code-more-icon', pill);
    if (this.ctx.icon) this.ctx.icon(icon, this.expanded ? 'chevron-up' : 'chevron-down', '');
    el('span', null, pill, label);
    this.more.replaceChildren(pill);
  }
  // 顯示結果：內容或語言變了才重畫（打字時延後一下，不要每個字都重畫）
  syncPreview(now: boolean): void {
    const on = !!(this.ctx.canPreview && this.ctx.canPreview((this.node.attrs as CodeBlockAttrs).params));
    const text = this.node.textContent;
    this.dom.classList.toggle('has-preview', on);
    this.dom.classList.toggle('is-empty', !text.trim());
    this.srcBtn.hidden = !on;
    this.editBtn.hidden = !(on && this.lang() === 'mermaid');
    this.delBtn.hidden = !on;
    this.delBtn.setAttribute('aria-label', this.lang() === 'mermaid' ? t('刪除圖表') : t('刪除這個區塊'));
    if (!on) { this.dispose(); this.preview.replaceChildren(); this.rendered = null; this.syncTall(); return; }
    const key = this.node.attrs.params + '\n' + text;
    // 先取消還沒執行的預覽：內容改了又改回來時，key 跟畫面上的一樣，但計時器裡排的是中間那一版
    window.clearTimeout(this.timer);
    if (key === this.rendered) return;
    const run = () => {
      // 內容到要畫的時候才讀：開啟筆記時排的「看得到才畫」可能等很久，中間內容被改過（全部取代、復原）；
      // 畫排隊當時那一版的話，還會順手取消排在後面的重畫，結果就一直停在舊的
      const code = this.node.textContent;
      this.dispose();
      this.rendered = this.node.attrs.params + '\n' + code;
      this.preview.replaceChildren();
      if (!code.trim()) return;
      const ticks = code.match(/`{3,}/g);
      const fence = ticks ? ticks.sort().slice(-1)[0] + '`' : '```';
      const h = this.shown.embed(this.ctx.renderBlock!(fence + this.node.attrs.params + '\n' + code + '\n' + fence, this.preview));
      // 畫好之後判斷要不要收合（沒有 ResizeObserver 的環境靠這裡）；這時結果已經換掉或節點已經移除就不用了
      let current = true;
      this.shown.add(() => { current = false; });
      if (h.ready) void h.ready.then(() => { if (current) this.syncTall(); });
    };
    // 開啟筆記時：捲到看得到才畫（長筆記裡有很多圖表時，不用一開始全部畫完）。
    // 編輯時：停下來才重畫；內容越長畫得越久，等的時間也跟著拉長（0.4 到 1.5 秒）
    if (now) this.shown.add(whenVisible(this.dom, run));
    else this.timer = window.setTimeout(run, 400 + Math.min(1100, Math.floor(text.length / 8)));
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.params !== this.node.attrs.params;
    this.node = node;
    if (changed) this.syncSelect();
    this.syncLines();
    this.syncPreview(false);
    return true;
  }
  destroy(): void { this.dispose(); if (this.sizer) { this.sizer.disconnect(); this.sizer = null; } }
  stopEvent(e: Event): boolean { const n = e.target as Node | null; return this.head.contains(n) || this.preview.contains(n) || this.more.contains(n); }
  ignoreMutation(m: ViewMutationRecord): boolean {
    return this.head.contains(m.target) || this.preview.contains(m.target) || this.more.contains(m.target) || this.gutter.contains(m.target) || (m.target === this.dom && m.type === 'attributes');
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
      ctx.prompt(t('提示框標題'), (this.node.attrs as CalloutAttrs).title || '', t('留白則顯示類型名稱'), v => this.set({ title: v.trim() || null }));
    });
    this.render();
  }
  set(attrs: Attrs): void {
    if (setNodeAttrs(this, attrs)) this.view.focus();
  }
  render(): void {
    const a = this.node.attrs as CalloutAttrs;
    this.dom.setAttribute('data-callout', a.type);
    this.dom.setAttribute('data-callout-fold', a.fold || '');
    this.syncIcon();
    this.syncFold();
    // 自訂類型的圖示寫在 CSS（--callout-icon），要等節點放進畫面後才讀得到
    if (!this.iconTimer) this.iconTimer = window.setTimeout(() => { this.iconTimer = null; this.syncIcon(); }, 0);
    const tv = a.type.charAt(0).toUpperCase() + a.type.slice(1);
    this.titleEl.textContent = a.title ? a.title.replace(/(\*\*|__|==|`)/g, '').replace(/\\([\\`*_{}[\]()#+\-.!|<>=$%~])/g, '$1') : tv;
    this.titleEl.classList.toggle('is-default', !a.title);
  }
  // 圖示：Obsidian、佈景主題或 CSS 片段用 --callout-icon 指定的優先（自訂的提示框類型才會有對的圖示）
  syncIcon(): void {
    let name = '';
    try { name = getComputedStyle(this.dom).getPropertyValue('--callout-icon').trim().replace(/^["']|["']$/g, ''); } catch { name = ''; }
    this.icon.replaceChildren();
    this.ctx.icon(this.icon, name && name !== 'none' && !name.startsWith('<') ? name : calloutIcon((this.node.attrs as CalloutAttrs).type), '');
  }
  syncFold(): void {
    const fold = (this.node.attrs as CalloutAttrs).fold || '';
    this.foldEl.hidden = !fold;
    this.dom.classList.toggle('is-collapsed', !!fold && this.collapsed);
    this.foldEl.replaceChildren();
    if (fold) this.ctx.icon(this.foldEl, this.collapsed ? 'chevron-right' : 'chevron-down', this.collapsed ? '▸' : '▾');
  }
  destroy(): void { window.clearTimeout(this.iconTimer!); }
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
