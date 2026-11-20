// Mermaid 圖表編輯器：左邊編輯（表單或程式碼），右邊即時預覽；點預覽圖上的文字可以直接修改。
// 表單依 diagrams.ts 對各種圖表的描述畫出來：流程圖、循序圖、甘特圖、圓餅圖、狀態圖、類別圖、心智圖、時間軸、ER 圖。
// 很長的圖表：表單的清單分批顯示、可以篩選，下拉選單的選項按下去才產生；預覽重畫時先在背後畫好再換上去，捲動位置不會跑掉。
// opts: { src, existing, mode: 'visual'|'code', render(src, el) → { unload(), ready? }, validate(src) → Promise<錯誤訊息|null> }
import { Modal, Notice, setIcon } from 'obsidian';
import { t, key } from './i18n.js';
import { keepFocus } from './dom.js';
import { DIAGRAM_KINDS, DIAGRAM_REASONS, COMMON_OPTS, editableDiagram, generateDiagram, detectKind, textSlots, findSlot, setValue, restoreName, dropRefs, squash, sameSlot, slotNth, rowSlot } from './diagrams.js';
import { uniqueName } from './templates.js';
import type { App } from 'obsidian';
import type { Choice, ColorField, DiagramKind, DiagramModel, DiagramReason, Field, ListSpec, Row, SelectField, TextField, TextSlot } from './diagrams.js';
import type { SavedTemplate } from './templates.js';

// opts.render 的回傳值：關掉預覽時呼叫 unload()；ready 在內容交給畫面之後完成（沒有就只看畫面上有沒有出現圖）
export interface MermaidPreviewHandle { unload(): void; ready?: Promise<unknown>; }
export type MermaidTab = 'visual' | 'code';
export interface MermaidModalOptions {
  src?: string;
  existing?: boolean;
  mode?: MermaidTab;
  // 新圖表一開始的內容（設定裡選的預設圖表）；沒有就用流程圖
  initial?: string;
  render(src: string, el: HTMLElement): MermaidPreviewHandle;
  // 回傳錯誤訊息；沒有錯誤時回傳 null
  validate?(src: string): Promise<string | null> | string | null;
  // 不列在上方的內建圖表種類（設定裡取消勾選的）
  hiddenKinds?: readonly string[];
  // 使用者自己存的範本：讀取與儲存（沒有提供就不顯示「我的範本」）
  templates?(): SavedTemplate[];
  saveTemplate?(name: string, src: string): void;
}
// 目前的程式碼讀成表單資料的結果
interface Editable { kind: DiagramKind; model: DiagramModel; }
// 表單裡的一個下拉選單（其他欄位改了之後要更新選項，例如步驟改名後連線的選單）。
// full：選項是不是都放進去了。選項很多時只放目前選的那一個，按下去才補齊（見 LAZY_OPTIONS）
interface SelectRef { el: HTMLSelectElement; field: SelectField; row: Row | null; listKey: string | null; full: boolean; lazy: boolean; }
// 圖上的一段文字：元素、文字內容、在同樣文字裡是第幾個
interface DiagramLabel { el: Element; text: string; nth: number; }
// 在圖上編輯的對象：欄位、所在的清單與列（圖表本身的設定時是 null）、多行欄位裡的第幾行
type InlineTarget = Pick<TextSlot, 'field' | 'list' | 'row' | 'line'>;
// 表單裡一個清單的顯示狀態：從第幾列開始顯示、顯示幾列（在符合篩選的列裡算）、篩選的文字
interface ListView { start: number; shown: number; filter: string; }
// 還在背後畫的預覽（畫好才換到畫面上）
interface PendingPreview { canvas: HTMLDivElement; handle: MermaidPreviewHandle; }

const DEFAULT_SRC = 'flowchart TD\n    A[開始] --> B[結束]';
// 「自由編寫」空白時顯示在輸入框裡的例子：一種沒有表單的圖表，讓人知道不限上面列出的種類
const FREE_EXAMPLE = 'gitGraph\n    commit\n    branch develop\n    commit\n    checkout main\n    merge develop';
// 清單一次顯示幾列（很長的圖表一次全部畫出來，表單會慢到不能用）
const CHUNK = 40;
// 清單超過這麼多列才顯示篩選的輸入框
const FILTER_MIN = 12;
// 下拉選單的選項超過這個數量時，只放目前選的那一個，按下去才補齊。
// 兩百個步驟的流程圖有四百個「從／到」選單，每個放兩百個選項就是八萬個元素
const LAZY_OPTIONS = 30;
// 表單裡多行的文字用「 / 」表示換行（輸入框只有一行）
const showLines = (s: string): string => String(s || '').replace(/\n/g, ' / ');
const readLines = (s: string): string => s.replace(/ \/ /g, '\n');

// 點到的位置對應圖上的哪一段文字。點在形狀上（方框、菱形）時，找同一組裡唯一的那段文字
function labelAt(target: Element, root: Element): DiagramLabel | null {
  let el: Element | null = target.closest('text, foreignObject');
  if (!el) {
    const g = target.closest('g');
    const labels = g && root.contains(g) ? g.querySelectorAll('text, foreignObject') : null;
    if (labels && labels.length === 1) el = labels[0];
  }
  if (!el || !root.contains(el)) return null;
  const text = (el.textContent || '').trim();
  if (!text) return null;
  const same = [...root.querySelectorAll('text, foreignObject')].filter(x => squash(x.textContent || '') === squash(text));
  return { el, text, nth: Math.max(0, same.indexOf(el)) };
}

export class MermaidModal extends Modal {
  declare opts: MermaidModalOptions;
  declare onSave: (text: string) => void;
  declare src: string;
  declare original: string;
  // 表單的資料：undefined＝還沒讀（程式碼改過之後要重讀）、null＝這段程式碼不能用表單編輯（原因在 reason）
  declare data: Editable | null | undefined;
  declare reason?: DiagramReason | null;
  declare tab: MermaidTab;
  declare tabVisual: HTMLButtonElement;
  declare tabCode: HTMLButtonElement;
  declare kindsEl: HTMLDivElement;
  // 「自由編寫」：目前的內容不是上方任何一種圖表（或還是空白）時標在這一顆
  declare freeBtn: HTMLButtonElement;
  declare confirmEl: HTMLDivElement;
  // 「我的範本」的面板（按上方的按鈕展開）
  declare tplEl: HTMLDivElement;
  declare tplBtn: HTMLButtonElement | null;
  declare tplOpen: boolean;
  // 表單裡目前的那一列在圖上還找不到（剛新增，圖還沒重畫）：等新的圖出來再捲過去
  declare reveal: boolean;
  declare visualPane: HTMLDivElement;
  declare codePane: HTMLDivElement;
  declare ta: HTMLTextAreaElement;
  declare err: HTMLSpanElement;
  declare tip: HTMLSpanElement;
  declare stage: HTMLDivElement;
  declare prev: HTMLDivElement;
  // 預覽圖畫在 canvas 裡（prev 是可以捲動的外框）；zoom 是預覽的縮放倍率
  declare canvas: HTMLDivElement | null;
  declare zoom: number;
  declare zoomLabel: HTMLButtonElement;
  // 圖原本的寬度（像素，從 SVG 的 viewBox 讀；還不知道時是 0）
  declare natural: number;
  // 縮放倍率還沒被使用者動過：每次畫好依圖的寬度自動決定（放得下就縮到剛好，太寬就維持原本的大小用捲的）
  declare autoZoom: boolean;
  // 這份內容第一次畫出來：圖比框寬的話，把第一段文字捲到中間（否則一開始看到的可能是空白）
  declare firstView: boolean;
  declare ok: HTMLButtonElement;
  declare selects: SelectRef[];
  declare inline: HTMLDivElement | null;
  // 取消圖上正在編輯的文字（關掉小輸入框時呼叫，之後輸入框失去焦點也不會套用）
  declare cancelInline: (() => void) | null;
  // 圖上的輸入框開啟的時間（開啟時把文字捲到看得到的地方，那次捲動不能把輸入框關掉）
  declare inlineAt: number;
  declare listId: number;
  declare timer?: number;
  declare handle?: MermaidPreviewHandle | null;
  declare stamp?: number;
  // 每個清單目前顯示哪一段、篩選的文字（表單重畫時保留）
  declare lists: Record<string, ListView>;
  // 各個下拉選單欄位的選項（同一輪更新裡只算一次；表單資料變了就清掉）
  declare optionCache: Map<SelectField, Choice[]>;
  // 表單裡所有的文字欄位（在圖上找位置用；表單資料變了就清掉）
  declare slots: TextSlot[] | null;
  // 表單裡目前的那一列（在圖上用外框標出來）
  declare current: { list: ListSpec; row: Row } | null;
  declare marker: HTMLDivElement | null;
  declare hover: HTMLDivElement | null;
  // 還在背後畫的預覽，以及它的編號（之後又重畫時，舊的那次畫好也不理它）
  declare pending: PendingPreview | null;
  declare drawId: number;
  // 上一次畫預覽花了多久（毫秒）：圖越大，打字時等越久才重畫
  declare drawMs: number;
  // 預覽畫好之後要做的事（例如按 Tab 跳到下一段文字，要等新的圖出來才找得到位置）
  declare afterDraw: (() => void)[];

  constructor(app: App, opts: MermaidModalOptions, onSave: (text: string) => void) {
    super(app);
    this.opts = opts;
    this.onSave = onSave;
    this.src = opts.src && opts.src.trim() ? opts.src : (opts.initial && opts.initial.trim() ? opts.initial : t(DEFAULT_SRC));
    this.original = opts.src || '';
    this.data = undefined;
    this.tab = opts.mode === 'code' ? 'code' : 'visual';
    this.selects = [];
    this.zoom = 1;
    this.natural = 0;
    this.autoZoom = true;
    this.firstView = true;
    this.inline = null;
    this.cancelInline = null;
    this.inlineAt = 0;
    this.listId = 0;
    this.lists = {};
    this.optionCache = new Map();
    this.slots = null;
    this.current = null;
    this.marker = null;
    this.hover = null;
    this.canvas = null;
    this.pending = null;
    this.drawId = 0;
    this.drawMs = 0;
    this.afterDraw = [];
    this.tplBtn = null;
    this.tplOpen = false;
    this.reveal = false;
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.existing ? t('編輯圖表（Mermaid）') : t('插入圖表（Mermaid）'));
    this.modalEl.addClass('wm-mmd-modal');
    const c = this.contentEl;
    c.addClass('wm-mmd');

    // ---- 圖表種類（按一下換成那一種的範本），最後是自己存的範本
    this.kindsEl = c.createDiv('wm-mmd-kinds');
    const hidden = new Set(this.opts.hiddenKinds || []);
    for (const k of DIAGRAM_KINDS) {
      if (hidden.has(k.id)) continue;
      const b = this.kindsEl.createEl('button', { cls: 'wm-mmd-kind' });
      b.dataset.kind = k.id;
      setIcon(b.createSpan('wm-mmd-kind-icon'), k.icon);
      b.createSpan({ text: t(k.name) });
      b.setAttribute('aria-label', t('換成「{name}」的範本', { name: t(k.name) }));
      b.addEventListener('click', () => this.pickKind(k));
    }
    // 自由編寫：從空白開始自己寫 Mermaid 程式碼。Mermaid 畫得出來的都可以（不限有表單的種類），一樣有預覽
    this.freeBtn = this.kindsEl.createEl('button', { cls: 'wm-mmd-kind wm-mmd-free' });
    setIcon(this.freeBtn.createSpan('wm-mmd-kind-icon'), 'pencil');
    this.freeBtn.createSpan({ text: t('自由編寫') });
    this.freeBtn.setAttribute('aria-label', t('自己寫 Mermaid 程式碼，不限上面列出的種類'));
    this.freeBtn.addEventListener('click', () => this.pickFree());
    if (this.opts.templates) {
      const b = this.kindsEl.createEl('button', { cls: 'wm-mmd-kind wm-mmd-mine' });
      setIcon(b.createSpan('wm-mmd-kind-icon'), 'bookmark');
      b.createSpan({ cls: 'wm-mmd-mine-text' });
      b.setAttribute('aria-label', t('自己存的圖表範本：套用，或把目前的圖表存起來'));
      b.addEventListener('click', () => this.toggleTemplates());
      this.tplBtn = b;
    }
    this.tplEl = c.createDiv('wm-mmd-templates');
    this.tplEl.hide();
    this.confirmEl = c.createDiv('wm-mmd-confirm');
    this.confirmEl.hide();
    this.markTemplates();

    // ---- 編輯方式
    const top = c.createDiv('wm-mmd-top');
    const tabs = top.createDiv('wm-seg');
    const tab = (icon: string, label: string) => {
      const b = tabs.createEl('button');
      setIcon(b.createSpan('wm-tab-icon'), icon);
      b.createSpan({ text: label });
      return b;
    };
    this.tabVisual = tab('list-checks', t('表單'));
    this.tabCode = tab('code-2', t('程式碼'));
    this.tabVisual.addEventListener('click', () => this.setTab('visual'));
    this.tabCode.addEventListener('click', () => this.setTab('code'));
    top.createDiv({ cls: 'wm-eq-hint', text: t('{k} 套用・Esc 取消', { k: key('Mod+Enter') }) });

    const body = c.createDiv('wm-mmd-body');
    const left = body.createDiv('wm-mmd-edit wm-eq-card');
    this.visualPane = left.createDiv('wm-mmd-visual');
    this.codePane = left.createDiv('wm-mmd-code');
    this.ta = this.codePane.createEl('textarea', { cls: 'wm-mmd-input' });
    this.ta.spellcheck = false;
    this.ta.placeholder = t('在這裡寫 Mermaid 程式碼，例如：') + '\n' + FREE_EXAMPLE;
    this.ta.value = this.src;
    // 打程式碼時只先換掉上方標示的種類；「能不能用表單」要把整段程式碼讀過一遍，等停下來重畫預覽時再算
    this.ta.addEventListener('input', () => { this.src = this.ta.value; this.invalidate(); this.markKind(true); this.schedulePreview(); });
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { // Tab 輸入縮排，不要跳到下一個欄位
        e.preventDefault();
        const a = this.ta.selectionStart;
        this.ta.value = this.ta.value.slice(0, a) + '    ' + this.ta.value.slice(this.ta.selectionEnd);
        this.ta.setSelectionRange(a + 4, a + 4);
        this.ta.dispatchEvent(new Event('input'));
      }
    });
    this.codePane.createDiv({ cls: 'wm-mmd-hint', text: t('可以寫任何 Mermaid 語法，不限上面列出的種類。預覽會即時更新，寫錯的地方會顯示在預覽上方。比較新的圖表種類要 Obsidian 內建的 Mermaid 支援才畫得出來。') });
    const right = body.createDiv('wm-mmd-right wm-eq-card');
    const lab = right.createDiv('wm-eq-label');
    lab.createSpan({ text: t('預覽') });
    this.tip = lab.createSpan({ cls: 'wm-mmd-tip', text: t('點圖上的文字可以直接修改') });
    this.tip.setAttribute('aria-label', t('Enter 套用；Tab 套用並跳到下一段文字；Esc 取消'));
    this.err = lab.createSpan({ cls: 'wm-eq-error' });
    // 預覽的縮放：大張的圖可以縮小看全貌、放大看細節，也可以按住 Ctrl 滾動滑鼠滾輪
    const zoomBox = lab.createDiv('wm-mmd-zoom');
    const zoomBtn = (icon: string, label: string, delta: number) => {
      const b = zoomBox.createEl('button', { cls: 'clickable-icon wm-mmd-zoombtn' });
      b.setAttribute('aria-label', label);
      setIcon(b, icon);
      b.addEventListener('click', () => this.setZoom(this.zoom + delta));
    };
    zoomBtn('zoom-out', t('縮小'), -0.25);
    this.zoomLabel = zoomBox.createEl('button', { cls: 'wm-mmd-zoomlabel', text: '100%' });
    this.zoomLabel.setAttribute('aria-label', t('恢復 100%'));
    this.zoomLabel.addEventListener('click', () => this.setZoom(1));
    zoomBtn('zoom-in', t('放大'), 0.25);
    const fit = zoomBox.createEl('button', { cls: 'clickable-icon wm-mmd-zoombtn wm-mmd-fit' });
    fit.setAttribute('aria-label', t('縮到跟預覽一樣寬（看整張圖）'));
    setIcon(fit, 'scan');
    fit.addEventListener('click', () => this.fitZoom());
    // stage 包住預覽與「在圖上編輯」的小輸入框（預覽重畫時輸入框不會被清掉）
    this.stage = right.createDiv('wm-mmd-stage');
    this.prev = this.stage.createDiv('wm-mmd-preview');
    this.prev.addEventListener('click', e => this.onPreviewClick(e));
    this.prev.addEventListener('mouseover', e => this.onPreviewHover(e));
    this.prev.addEventListener('mouseleave', () => this.clearHover());
    this.prev.addEventListener('scroll', () => { if (Date.now() - this.inlineAt > 250) this.closeInline(); });
    this.prev.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY < 0 ? 0.25 : -0.25));
    }, { passive: false });

    const bar = c.createDiv('modal-button-container');
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => { this.closeInline(); this.close(); });
    this.ok = bar.createEl('button', { text: this.opts.existing ? t('套用') : t('插入'), cls: 'mod-cta' });
    this.ok.addEventListener('click', () => this.submit());
    c.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); } });

    this.setTab(this.tab === 'visual' && !this.getModel() ? 'code' : this.tab);
    this.markKind();
    this.preview();
  }

  // 正在圖上編輯文字時按 Esc（或點視窗外面）：只關掉那個小輸入框，不關整個編輯器
  close(): void {
    if (this.inline) { this.closeInline(); return; }
    super.close();
  }

  onClose(): void {
    window.clearTimeout(this.timer);
    this.dropPending();
    this.afterDraw = [];
    if (this.handle) { try { this.handle.unload(); } catch { /* 忽略 */ } }
    this.contentEl.empty();
  }

  submit(): void {
    this.closeInline();
    const text = this.src.replace(/\s+$/, '');
    if (!text.trim()) return;
    this.close();
    // 沒有改動就交回原本的文字（不重寫使用者自己排的格式）
    this.onSave(text === this.original.replace(/\s+$/, '') ? this.original : text);
  }

  // 目前的程式碼能不能用表單編輯（認得的圖表種類，而且沒有不支援的寫法）
  getModel(): Editable | null {
    if (this.data === undefined) {
      const r = editableDiagram(this.src);
      this.data = r.ok ? { kind: r.kind, model: r.model } : null;
      this.reason = r.ok ? null : r.reason;
    }
    return this.data;
  }

  // 程式碼換了：表單的資料與從它算出來的東西都要重來
  invalidate(): void {
    this.data = undefined;
    this.slots = null;
    this.optionCache.clear();
    this.current = null;
  }

  // 表單裡所有的文字欄位（算一次，表單資料變了才重算）
  getSlots(): TextSlot[] {
    const d = this.getModel();
    if (!d) return [];
    if (!this.slots) this.slots = textSlots(d.kind, d.model);
    return this.slots;
  }

  setSource(src: string): void {
    this.src = src;
    this.ta.value = src;
    this.invalidate();
    this.lists = {};
    this.firstView = true;
    this.closeInline();
    this.markKind();
    this.preview();
  }

  // 標出目前是哪一種圖表；不能用表單時不顯示「點圖上的文字可以直接修改」。
  // light：只換上方的標示（看第一行就知道），不去讀整段程式碼
  markKind(light?: boolean): void {
    const kind = detectKind(this.src);
    // 只動各個種類的按鈕（「我的範本」那一顆的標示是面板開著沒有，不歸這裡管）
    for (const b of this.kindsEl.querySelectorAll<HTMLElement>('.wm-mmd-kind[data-kind]')) b.toggleClass('is-active', !!kind && b.dataset.kind === kind.id);
    this.freeBtn.toggleClass('is-active', !kind);
    if (!light) this.tip.toggle(!!this.getModel());
  }

  // 目前的內容是不是還沒動過的範本（內建的或自己存的）：是的話換範本不用先問
  pristine(): boolean {
    const cur = this.src.trim();
    if (!cur || cur === t(DEFAULT_SRC).trim() || DIAGRAM_KINDS.some(x => t(x.template).trim() === cur)) return true;
    return this.savedTemplates().some(x => x.src.trim() === cur);
  }

  // 換成另一份內容（某一種圖表的範本、自己存的範本，或「自由編寫」的空白）。目前的內容是自己改過的就先問一下，免得誤按把內容蓋掉。
  // ask、yes：確認時問的話與按鈕上的字（沒有給就是換範本的問法）
  replaceWith(name: string, src: string, ask?: string, yes?: string): void {
    const apply = () => {
      this.confirmEl.hide();
      this.setSource(src);
      this.setTab(this.getModel() ? this.tab : 'code');
    };
    if (this.pristine()) { apply(); return; }
    this.confirmEl.empty();
    this.confirmEl.show();
    this.confirmEl.createSpan({ text: ask || t('要把目前的內容換成「{name}」的範本嗎？目前的內容會被取代。', { name }) });
    const go = this.confirmEl.createEl('button', { text: yes || t('取代'), cls: 'mod-warning' });
    const no = this.confirmEl.createEl('button', { text: t('取消') });
    go.addEventListener('click', apply);
    no.addEventListener('click', () => this.confirmEl.hide());
  }

  // 按了某一種圖表：換成那一種的範本（範本的文字也跟著介面語言）
  pickKind(k: DiagramKind): void { this.replaceWith(t(k.name), t(k.template)); }

  // 按了「自由編寫」：清成空白，換到程式碼。已經是空白、或正在寫上方沒有的種類時，只換到程式碼，不動內容
  pickFree(): void {
    if (!detectKind(this.src)) { this.confirmEl.hide(); this.setTab('code'); return; }
    this.replaceWith('', '', t('要清空目前的內容，改成自己寫程式碼嗎？'), t('清空'));
  }

  // ---------------------------------------------------------- 我的範本

  savedTemplates(): SavedTemplate[] { return this.opts.templates ? this.opts.templates() : []; }

  // 上方「我的範本」按鈕上的數量
  markTemplates(): void {
    if (!this.tplBtn) return;
    const n = this.savedTemplates().length;
    const text = this.tplBtn.querySelector('.wm-mmd-mine-text');
    if (text) text.textContent = t('我的範本') + (n ? ' ' + n : '');
    this.tplBtn.toggleClass('is-active', this.tplOpen);
  }

  toggleTemplates(): void {
    this.tplOpen = !this.tplOpen;
    if (this.tplOpen) { this.tplEl.show(); this.renderTemplates(); } else this.tplEl.hide();
    this.markTemplates();
  }

  // 面板的內容：存過的範本（按一下套用），以及把目前的圖表存起來的那一列
  renderTemplates(): void {
    const p = this.tplEl;
    p.empty();
    const list = this.savedTemplates();
    const items = p.createDiv('wm-mmd-tpl-list');
    if (!list.length) items.createSpan({ cls: 'wm-mmd-hint', text: t('還沒有自己的範本。把常用的圖表存起來，下次可以直接套用。') });
    for (const x of list) {
      const b = items.createEl('button', { cls: 'wm-mmd-tpl' });
      const kind = detectKind(x.src);
      setIcon(b.createSpan('wm-mmd-kind-icon'), kind ? kind.icon : 'bookmark');
      b.createSpan({ text: x.name });
      b.setAttribute('aria-label', t('套用範本「{name}」', { name: x.name }));
      b.addEventListener('click', () => this.replaceWith(x.name, x.src));
    }
    if (!this.opts.saveTemplate) return;
    const row = p.createDiv('wm-mmd-tpl-save');
    const kind = detectKind(this.src);
    const input = row.createEl('input', { type: 'text', cls: 'wm-mmd-tpl-name' });
    input.value = uniqueName(list, kind ? t(kind.name) : t('圖表'));
    input.placeholder = t('範本名稱');
    input.setAttribute('aria-label', t('範本名稱'));
    const save = row.createEl('button', { text: t('把目前的圖表存成範本') });
    const run = () => {
      const name = input.value.replace(/\s+/g, ' ').trim();
      const src = this.src.replace(/\s+$/, '');
      if (!name) { input.focus(); return; }
      if (!src.trim()) return;
      const existed = list.some(x => x.name === name);
      this.opts.saveTemplate!(name, src);
      new Notice(t(existed ? '已更新範本「{name}」' : '已存成範本「{name}」', { name }));
      this.renderTemplates();
      this.markTemplates();
    };
    save.addEventListener('click', run);
    // isComposing：輸入法選字中的 Enter 是確定選字，不是儲存
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); run(); } });
    p.createDiv({ cls: 'wm-mmd-hint', text: t('同名的範本會被新的內容取代。改名、修改、刪除在「設定 → 方程式與圖表」。') });
  }

  setTab(tab: MermaidTab): void {
    this.tab = tab;
    this.closeInline();
    this.tabVisual.toggleClass('is-active', tab === 'visual');
    this.tabCode.toggleClass('is-active', tab === 'code');
    this.visualPane.toggle(tab === 'visual');
    this.codePane.toggle(tab === 'code');
    if (tab === 'visual') this.buildVisual(); else { this.ta.value = this.src; window.setTimeout(() => this.ta.focus(), 10); }
  }

  // 表單（或圖上）改了：重新產生程式碼並更新預覽。rebuild：清單的列有增減或移動，表單要重畫
  changed(rebuild: boolean, now?: boolean): void {
    const d = this.data;
    if (!d) return; // 只有表單會呼叫，這時一定有資料
    if (d.kind.fix) d.kind.fix(d.model);
    this.slots = null;
    this.optionCache.clear();
    this.src = generateDiagram(d.kind, d.model);
    this.ta.value = this.src;
    if (rebuild) this.buildVisual(); else this.refreshSelects();
    if (now) this.preview(); else this.schedulePreview();
  }

  // 某個下拉選單欄位的選項（同一輪更新裡每個欄位只算一次）
  optionsOf(f: SelectField): Choice[] {
    let list = this.optionCache.get(f);
    if (!list) {
      const d = this.data;
      list = d ? f.options(d.model, t) : [];
      this.optionCache.set(f, list);
    }
    return list;
  }

  // 把下拉選單的選項放進去。all 為 false 時只放目前選的那一個（選項很多時，按下去才補齊）
  fillSelect(s: SelectRef, all: boolean): void {
    const d = this.data;
    if (!d) return;
    const value = (s.row || d.model.opts)[s.field.key] || '';
    const options = this.optionsOf(s.field);
    s.el.replaceChildren();
    if (all) for (const [v, label] of options) s.el.createEl('option', { text: label }).value = v;
    else {
      const cur = options.find(o => o[0] === value);
      s.el.createEl('option', { text: cur ? cur[1] : value }).value = value;
    }
    s.el.value = value;
    s.full = all;
  }

  // 其他欄位改了（例如步驟改名）：更新每個下拉選單的選項，保留原本選的值
  refreshSelects(): void {
    if (!this.data) return;
    for (const s of this.selects) this.fillSelect(s, s.full);
  }

  // 清單目前的顯示狀態（顯示幾列、篩選的文字）
  listView(list: ListSpec): ListView {
    return this.lists[list.key] || (this.lists[list.key] = { start: 0, shown: CHUNK, filter: '' });
  }

  // 表單裡某一列的元素
  rowEl(list: ListSpec, row: Row): HTMLElement | null {
    const d = this.data;
    const i = d ? (d.model.lists[list.key] || []).indexOf(row) : -1;
    return i < 0 ? null : this.visualPane.querySelector<HTMLElement>('[data-row="' + list.key + ':' + i + '"]');
  }

  // 標出表單裡的一列並捲到看得到的地方，同時在圖上標出它；focus 為 true 時把游標放進第一個輸入框
  markRow(list: ListSpec, row: Row, focus: boolean): void {
    for (const r of this.visualPane.querySelectorAll('.wm-mmd-row.is-current')) r.removeClass('is-current');
    let el = this.rowEl(list, row);
    if (!el) {
      // 這一列還沒畫出來（很長的清單只顯示其中一段，或被篩選掉了）：換到它所在的那一段
      const d = this.data;
      const i = d ? (d.model.lists[list.key] || []).indexOf(row) : -1;
      if (i < 0) return;
      this.showRow(list, i);
      this.buildVisual();
      el = this.rowEl(list, row);
      if (!el) return;
    }
    el.addClass('is-current');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    this.current = { list, row };
    this.placeMarker(false);
    if (!focus) return;
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], textarea');
    if (input) { input.focus(); input.select(); }
  }

  // 讓清單顯示第 i 列所在的那一段（拿掉篩選）。表單還沒重畫，呼叫的地方接著會重畫
  showRow(list: ListSpec, i: number): void {
    const v = this.listView(list);
    if (!v.filter && i >= v.start && i < v.start + v.shown) return;
    v.filter = '';
    v.start = Math.floor(i / CHUNK) * CHUNK;
    v.shown = CHUNK;
  }

  // ---------------------------------------------------------- 表單

  buildVisual(): void {
    const p = this.visualPane;
    // 重畫之後回到原本捲到的位置（清空的瞬間捲軸會跳回最上面）
    const scroller = p.parentElement;
    const top = scroller ? scroller.scrollTop : 0;
    p.empty();
    this.selects = [];
    const d = this.getModel();
    if (!d) {
      const kind = detectKind(this.src);
      const box = p.createDiv('wm-mmd-blocked');
      setIcon(box.createSpan('wm-mmd-blocked-icon'), 'code-2');
      // getModel 回傳 null 時一定設了 reason
      box.createDiv({ cls: 'wm-mmd-note', text: (kind ? t(kind.name) + t('：') : '') + t(DIAGRAM_REASONS[this.reason!] || DIAGRAM_REASONS.syntax) });
      const b = box.createEl('button', { text: t('改用程式碼編輯'), cls: 'mod-cta' });
      b.addEventListener('click', () => this.setTab('code'));
      return;
    }
    const { kind, model } = d;
    // ---- 圖表本身的設定（方向、標題…）
    const head = p.createDiv('wm-mmd-head');
    const badge = head.createDiv('wm-mmd-badge');
    setIcon(badge.createSpan('wm-mmd-kind-icon'), kind.icon);
    badge.createSpan({ text: t(kind.name) });
    for (const f of [...kind.opts, ...COMMON_OPTS]) this.field(head, f, null, null, true);
    // ---- 各個清單
    for (const list of kind.lists) {
      const rows = model.lists[list.key] || (model.lists[list.key] = []);
      const view = this.listView(list);
      const title = p.createDiv('wm-mmd-section');
      title.createSpan({ text: t(list.title) });
      const count = title.createSpan({ cls: 'wm-mmd-count', text: String(rows.length) });
      const box = p.createDiv('wm-mmd-list');
      const more = p.createDiv('wm-mmd-more');
      const fill = () => this.fillList(list, box, more, count);
      if (rows.length > FILTER_MIN) {
        // 列很多：可以打字篩選（只重畫這個清單，游標留在篩選框裡）
        const filter = title.createEl('input', { type: 'search', cls: 'wm-mmd-filter' });
        filter.placeholder = t('篩選…');
        filter.setAttribute('aria-label', t('篩選這個清單'));
        filter.value = view.filter;
        filter.addEventListener('input', () => { view.filter = filter.value; view.start = 0; view.shown = CHUNK; fill(); });
      }
      fill();
      const add = p.createEl('button', { text: t(list.add), cls: 'wm-mmd-add' });
      add.addEventListener('click', () => {
        const row = list.make(model, t);
        rows.push(row);
        this.showRow(list, rows.length - 1); // 新的一列在最後：先換到最後一段，表單只要重畫一次
        this.changed(true);
        this.markRow(list, row, true);
      });
      if (list.hint) p.createDiv({ cls: 'wm-mmd-hint', text: t(list.hint) });
    }
    if (model.extra.length) p.createDiv({ cls: 'wm-mmd-note', text: t('這張圖另外有 {n} 行樣式設定（style、class 等），會原樣保留；要修改請用程式碼。', { n: model.extra.length }) });
    if (scroller) scroller.scrollTop = top;
  }

  // 畫出一個清單的列：符合篩選的，而且只畫其中一段（從 start 開始 shown 列）；前面、後面的按按鈕才畫
  fillList(list: ListSpec, box: HTMLElement, more: HTMLElement, count: HTMLElement): void {
    const d = this.data;
    if (!d) return;
    const rows = d.model.lists[list.key] || [];
    const view = this.listView(list);
    box.empty();
    more.empty();
    this.selects = this.selects.filter(s => s.listKey !== list.key);
    const q = view.filter.trim().toLowerCase();
    // 篩選比對這一列看得到的文字：文字欄位的內容，以及下拉選單選到的那個名稱
    const labels = new Map<SelectField, Map<string, string>>();
    const shownText = (row: Row): string => list.fields.map(f => {
      const v = row[f.key] || '';
      if (f.kind !== 'select') return v;
      let m = labels.get(f);
      if (!m) { m = new Map(this.optionsOf(f)); labels.set(f, m); }
      return m.get(v) || v;
    }).join('\n').toLowerCase();
    const match: number[] = [];
    rows.forEach((row, i) => { if (!q || shownText(row).includes(q)) match.push(i); });
    // 列被刪掉、或篩選之後變少了：開始的位置不能超過最後一段
    view.start = Math.max(0, Math.min(view.start, Math.floor(Math.max(0, match.length - 1) / CHUNK) * CHUNK));
    const again = () => this.fillList(list, box, more, count);
    if (view.start > 0) {
      const n = Math.min(CHUNK, view.start);
      const b = box.createDiv('wm-mmd-more').createEl('button', { cls: 'wm-mmd-morebtn', text: t('顯示前面 {n} 列（前面還有 {rest} 列）', { n, rest: view.start }) });
      b.addEventListener('click', () => { view.start -= n; view.shown += n; again(); });
    }
    for (const i of match.slice(view.start, view.start + view.shown)) this.row(box, list, rows, rows[i], i);
    count.setText(q ? match.length + ' / ' + rows.length : String(rows.length));
    if (q && !match.length) more.createSpan({ cls: 'wm-mmd-hint', text: t('沒有符合的列') });
    const rest = match.length - (view.start + view.shown);
    if (rest > 0) {
      const b = more.createEl('button', { cls: 'wm-mmd-morebtn', text: t('再顯示 {n} 列（還有 {rest} 列）', { n: Math.min(CHUNK, rest), rest }) });
      b.addEventListener('click', () => { view.shown += CHUNK; again(); });
    }
  }

  // 表單裡的一列：各個欄位，右邊是這一列的按鈕（額外的動作、上移、下移、刪除）
  row(box: HTMLElement, list: ListSpec, rows: Row[], row: Row, i: number): void {
    const d = this.data!;
    const el = box.createDiv('wm-mmd-row' + (list.rowClass ? ' ' + list.rowClass : ''));
    el.dataset.row = list.key + ':' + i;
    el.addEventListener('focusin', () => {
      for (const r of this.visualPane.querySelectorAll('.wm-mmd-row.is-current')) r.removeClass('is-current');
      el.addClass('is-current');
      // 游標進到這一列：在圖上標出它，不在看得到的範圍就捲過去
      this.current = { list, row };
      this.placeMarker(true);
    });
    for (const f of list.fields) this.field(el, f, list, row, false);
    const tools = el.createDiv('wm-mmd-tools');
    const icon = (name: string, label: string, run: () => void, off?: boolean): void => {
      const b = tools.createEl('button', { cls: 'clickable-icon wm-mmd-iconbtn' });
      b.setAttribute('aria-label', label);
      setIcon(b, name);
      b.disabled = !!off;
      b.addEventListener('click', run);
    };
    for (const a of list.actions || []) icon(a.icon, t(a.label), () => { const next = a.run(d.model, row, t); this.changed(true); if (next) this.markRow(list, next, true); });
    const pinned = !!list.fixedFirst && i === 0; // 心智圖的中心主題：不能移動、不能刪除
    const move = (dir: number) => {
      const j = i + dir;
      if (j < 0 || j >= rows.length || (list.fixedFirst && j === 0)) return;
      rows.splice(i, 1);
      rows.splice(j, 0, row);
      this.changed(true);
      this.markRow(list, row, false);
    };
    if (!pinned) {
      icon('arrow-up', t('上移'), () => move(-1), i === 0 || (!!list.fixedFirst && i === 1));
      icon('arrow-down', t('下移'), () => move(1), i === rows.length - 1);
      icon('trash-2', t('刪除這一列'), () => this.removeRow(list, row));
    }
  }

  removeRow(list: ListSpec, row: Row): void {
    const d = this.data;
    if (!d) return;
    const rows = d.model.lists[list.key];
    const i = rows.indexOf(row);
    if (i < 0 || (list.fixedFirst && i === 0)) return;
    dropRefs(list, d.model, row);
    // onDelete 可能換掉其他清單的陣列，所以重新取一次這個清單
    const now = d.model.lists[list.key];
    const j = now.indexOf(row);
    if (j >= 0) now.splice(j, 1);
    if (this.current && this.current.row === row) this.current = null;
    this.changed(true);
  }

  // 表單裡的一格。row 是 null 表示圖表本身的設定（存在 model.opts）；labelled：欄位前面顯示名稱
  field(parent: HTMLElement, f: Field, list: ListSpec | null, row: Row | null, labelled: boolean): void {
    const d = this.data!;
    const store = row || d.model.opts;
    const label = t(f.label);
    const cls = 'wm-mmd-f-' + f.key + (f.size ? ' is-' + f.size : '');
    // is-short：短的文字欄位，手機上兩個排一列（CSS 用這個類別，不用 :has 去找裡面的輸入框）
    const short = f.kind === 'text' && f.size === 's';
    const host = labelled && f.kind !== 'check' ? parent.createEl('label', { cls: 'wm-mmd-opt' + (short ? ' is-short' : '') }) : parent;
    if (host !== parent) host.createSpan({ text: label });
    if (f.kind === 'text') {
      const input = host.createEl('input', { type: 'text', cls: 'wm-mmd-text ' + cls });
      input.value = f.multiline ? showLines(store[f.key]) : (store[f.key] || '');
      input.setAttribute('aria-label', label);
      if (f.placeholder) input.placeholder = t(f.placeholder);
      if (f.suggest) {
        // 輸入時的建議（已經用過的狀態名稱、區段名稱）：游標進來才產生清單，列很多時才不會每一列都放一份
        const id = 'wm-mmd-dl-' + (this.listId++);
        const dl = host.createEl('datalist');
        dl.id = id;
        input.setAttribute('list', id);
        input.addEventListener('focus', () => { dl.replaceChildren(); for (const v of f.suggest!(d.model)) dl.createEl('option').value = v; });
      }
      input.addEventListener('input', () => {
        // 「定義」的欄位（參與者、類別、實體的名稱）改名：引用它的欄位一起改。
        // 名稱清空或暫時跟別人同名時，setValue 會先留著引用它的欄位不動，等名稱能用了再一起改
        setValue(d.kind, d.model, { field: f, list, row }, f.multiline ? readLines(input.value) : input.value, !!f.def);
        this.changed(false);
      });
      // 離開輸入框時名稱還是空的或跟別人同名：改回原本的名稱（引用它的訊息、關係都還在用那個名稱）
      if (f.def && row) input.addEventListener('change', () => { if (restoreName(f, row)) { input.value = row[f.key] || ''; this.changed(false); } });
    } else if (f.kind === 'lines') {
      const ta = host.createEl('textarea', { cls: 'wm-mmd-lines ' + cls });
      ta.value = store[f.key] || '';
      ta.setAttribute('aria-label', label);
      ta.spellcheck = false;
      if (f.placeholder) ta.placeholder = t(f.placeholder);
      // 高度跟著內容；空的時候留夠顯示提示文字的高度
      const grow = () => { ta.rows = Math.max(2, Math.min(8, (ta.value || ta.placeholder).split('\n').length)); };
      grow();
      ta.addEventListener('input', () => { store[f.key] = ta.value; grow(); this.changed(false); });
    } else if (f.kind === 'select') {
      const s = host.createEl('select', { cls: 'dropdown ' + cls });
      s.setAttribute('aria-label', label);
      const lazy = this.optionsOf(f).length > LAZY_OPTIONS;
      const ref: SelectRef = { el: s, field: f, row, listKey: list ? list.key : null, full: !lazy, lazy };
      this.fillSelect(ref, !lazy);
      if (lazy) {
        // 要選的時候才把所有選項放進去；選完（或離開）再收回只剩一個，之後更新選單才快
        const open = () => { if (!ref.full) this.fillSelect(ref, true); };
        s.addEventListener('pointerdown', open);
        s.addEventListener('mousedown', open);
        s.addEventListener('focus', open);
        s.addEventListener('keydown', open);
        s.addEventListener('blur', () => { if (ref.full) this.fillSelect(ref, false); });
      }
      s.addEventListener('change', () => { store[f.key] = s.value; this.changed(false); });
      this.selects.push(ref);
    } else if (f.kind === 'check') {
      const l = parent.createEl('label', { cls: 'wm-mmd-check ' + cls });
      const cb = l.createEl('input', { type: 'checkbox' });
      cb.checked = !!store[f.key];
      l.createSpan({ text: label });
      cb.addEventListener('change', () => { store[f.key] = cb.checked ? '1' : ''; this.changed(false); });
    } else if (f.kind === 'color') {
      // 色彩：一顆顯示目前顏色的按鈕；按下去在這一列下面展開色塊（不用浮動視窗，手機上也好按）
      const b = parent.createEl('button', { cls: 'wm-mmd-color ' + cls });
      b.setAttribute('aria-label', label);
      const dot = b.createSpan('wm-mmd-color-dot');
      const paint = () => {
        dot.toggleClass('is-none', !store[f.key]);
        if (store[f.key]) dot.style.setProperty('--wm-mmd-fill', store[f.key]); else dot.style.removeProperty('--wm-mmd-fill');
      };
      paint();
      let strip: HTMLDivElement | null = null;
      const close = () => { if (strip) { strip.remove(); strip = null; } };
      b.addEventListener('click', () => {
        if (strip) { close(); return; }
        strip = parent.createDiv('wm-mmd-swatches');
        this.swatches(strip, f, store[f.key] || '', c => { store[f.key] = c; paint(); close(); this.changed(false); });
      });
    } else {
      // 階層：縮排表示層級，兩個按鈕往外一層、往內一層
      const level = Math.max(0, +store[f.key] || 0);
      parent.style.setProperty('--wm-mmd-level', String(level));
      const box = parent.createDiv('wm-mmd-level');
      const step = (name: string, text: string, dir: number, off: boolean) => {
        const b = box.createEl('button', { cls: 'clickable-icon wm-mmd-levelbtn' });
        b.setAttribute('aria-label', text);
        setIcon(b, name);
        b.disabled = off;
        b.addEventListener('click', () => {
          store[f.key] = String(Math.max(0, level + dir));
          this.changed(true);
          if (list && row) this.markRow(list, row, false);
        });
      };
      const first = !!list && !!row && d.model.lists[list.key].indexOf(row) === 0;
      step('chevron-left', t('往外一層'), -1, first || level <= 1);
      step('chevron-right', t('往內一層'), 1, first);
    }
  }

  // 一排色塊：第一個是「預設」（不指定色彩），其餘是這個欄位可以選的色彩
  swatches(parent: HTMLElement, f: ColorField, current: string, pick: (color: string) => void): void {
    const one = (color: string, name: string) => {
      const b = parent.createEl('button', { cls: 'wm-mmd-swatch' + (color ? '' : ' is-none') + (color === current ? ' is-active' : '') });
      b.setAttribute('aria-label', name);
      if (color) b.style.setProperty('--wm-mmd-fill', color);
      keepFocus(b);
      b.addEventListener('click', () => pick(color));
    };
    one('', t('預設的色彩'));
    for (const [color, name] of f.colors) one(color, t(name));
  }

  // 套用縮放倍率（100% 是圖原本的大小）
  applyZoom(zoom: number): void {
    this.zoom = zoom;
    this.closeInline();
    if (this.canvas) this.canvas.style.zoom = String(zoom);
    this.zoomLabel.setText(Math.round(zoom * 100) + '%');
    this.clearHover();
    this.placeMarker(false);
  }

  // 使用者自己調縮放（25%～400%，一次 25%）：之後重畫就不再自動決定倍率
  setZoom(zoom: number): void {
    this.autoZoom = false;
    this.applyZoom(Math.max(0.25, Math.min(4, Math.round(zoom * 4) / 4)));
  }

  // 預覽框裡可以放圖的寬度
  room(): number { return Math.max(0, this.prev.clientWidth - 24); }

  // 縮到跟預覽一樣寬：很大的圖先看全貌，再放大看細節
  fitZoom(): void {
    const room = this.room();
    if (!this.natural || !room) return;
    this.autoZoom = false;
    this.applyZoom(Math.max(0.05, Math.min(4, room / this.natural)));
  }

  // 圖畫好之後：讓它以原本的大小為準（Mermaid 預設會把比框寬的圖整張縮小，步驟一多字就小到看不見），再決定縮放倍率
  sizeCanvas(): void {
    const svg = this.canvas ? this.canvas.querySelector('svg') : null;
    if (!svg) return;
    const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const width = box.length === 4 && box[2] > 0 ? box[2] : 0;
    if (!width) return;
    this.natural = width;
    svg.style.width = width + 'px';
    // Mermaid 在 SVG 上直接寫了 max-width（比框寬就整張縮小）：拿掉它，交給 CSS 的 .wm-mmd-natural。
    // 不在 CSS 用 !important 蓋寫在元素上的樣式，Obsidian 的外掛檢查不接受 !important
    svg.style.removeProperty('max-width');
    svg.classList.add('wm-mmd-natural');
    if (!this.autoZoom) return;
    // 放得下、或只要縮一點（不低於 60%）就縮到剛好；差太多就維持原本的大小，用捲的
    const room = this.room();
    if (!room) return;
    const fit = room / width;
    this.applyZoom(fit >= 0.6 ? Math.min(1, fit) : 1);
  }

  // ---------------------------------------------------------- 表單與圖互相定位

  // 欄位在圖上對應的那段文字。流程圖的步驟用代號找（文字相同的步驟也分得出來），其餘用文字與「同樣文字裡的第幾個」
  labelEl(slot: InlineTarget): Element | null {
    const d = this.data;
    const root = this.canvas;
    if (!d || !root) return null;
    if (d.kind.id === 'flowchart' && slot.list && slot.row && slot.list === d.kind.lists[0]) {
      for (const g of root.querySelectorAll('g.node, .node')) {
        const m = /^flowchart-(.+)-\d+$/.exec(g.id || '');
        if (m && m[1] === slot.row.id) return g.querySelector('foreignObject, text') || g;
      }
      return null;
    }
    const slots = this.getSlots();
    const me = slots.find(s => sameSlot(s, slot));
    if (!me) return null;
    const want = squash(me.value);
    const same = [...root.querySelectorAll('text, foreignObject')].filter(x => squash(x.textContent || '') === want);
    if (!same.length) return null;
    return same[Math.min(Math.max(0, slotNth(slots, slot)), same.length - 1)];
  }

  // 在預覽裡畫一個外框（marker 或 hover）圍住某個元素。外框放在可以捲動的 prev 裡，所以會跟著圖一起捲
  frame(box: HTMLDivElement, el: Element): void {
    // 流程圖的步驟框住整個形狀，其餘框住那段文字
    const target = el.closest('g.node') || el;
    const r = target.getBoundingClientRect();
    const p = this.prev.getBoundingClientRect();
    box.style.left = (r.left - p.left + this.prev.scrollLeft - this.prev.clientLeft - 3) + 'px';
    box.style.top = (r.top - p.top + this.prev.scrollTop - this.prev.clientTop - 3) + 'px';
    box.style.width = (r.width + 6) + 'px';
    box.style.height = (r.height + 6) + 'px';
  }

  // 在圖上標出表單裡目前的那一列。scroll：不在看得到的範圍時把預覽捲過去
  placeMarker(scroll: boolean): void {
    const cur = this.current;
    const slot = cur ? rowSlot(this.getSlots(), cur.row) : null;
    const el = slot ? this.labelEl(slot) : null;
    if (!el) { if (this.marker) { this.marker.remove(); this.marker = null; } if (cur && !scroll) this.reveal = true; return; }
    if (!this.marker || !this.marker.isConnected) this.marker = this.prev.createDiv('wm-mmd-marker');
    if (scroll && !this.inline) {
      const p = this.prev.getBoundingClientRect();
      const a = (el.closest('g.node') || el).getBoundingClientRect();
      if (a.top < p.top || a.bottom > p.bottom) this.prev.scrollTop += a.top + a.height / 2 - (p.top + p.height / 2);
      if (a.left < p.left || a.right > p.right) this.prev.scrollLeft += a.left + a.width / 2 - (p.left + p.width / 2);
    }
    this.frame(this.marker, el);
  }

  // 滑鼠移到圖上可以修改的文字：用淡淡的外框告訴使用者這裡可以點
  onPreviewHover(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target || !target.closest || this.inline || !this.data || !this.canvas || !this.canvas.contains(target)) { this.clearHover(); return; }
    const hit = labelAt(target, this.prev);
    let ok = false;
    if (this.data.kind.id === 'flowchart' && target.closest('g.node, .node')) ok = true;
    else if (hit) ok = !!findSlot(this.getSlots(), hit.text, hit.nth);
    if (!ok || !hit) { this.clearHover(); return; }
    if (!this.hover || !this.hover.isConnected) this.hover = this.prev.createDiv('wm-mmd-marker is-hover');
    this.frame(this.hover, hit.el);
  }

  clearHover(): void { if (this.hover) { this.hover.remove(); this.hover = null; } }

  // ---------------------------------------------------------- 在圖上編輯

  onPreviewClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target || !target.closest) return;
    const d = this.getModel();
    if (!d) return;
    const hit = labelAt(target, this.prev);
    let slot: InlineTarget | null = null;
    // 流程圖的節點：用節點的代號找（比用文字比對準，文字相同的節點也分得出來）
    if (d.kind.id === 'flowchart') {
      const g = target.closest('g.node, .node');
      const m = g && /^flowchart-(.+)-\d+$/.exec(g.id || '');
      const list = d.kind.lists[0];
      const row = m ? d.model.lists.nodes.find(n => n.id === m[1]) : null;
      if (row) slot = { field: list.fields[0] as TextField, list, row, line: -1 };
    }
    if (!slot && hit) slot = findSlot(this.getSlots(), hit.text, hit.nth);
    if (!slot) return;
    e.preventDefault();
    this.clearHover();
    if (this.tab !== 'visual') this.setTab('visual');
    if (slot.list && slot.row) this.markRow(slot.list, slot.row, false);
    this.openInline((hit && hit.el) || target, slot);
  }

  // 開啟某個欄位在圖上的輸入框（圖上找得到那段文字才開）
  openSlot(slot: InlineTarget): void {
    const el = this.labelEl(slot);
    if (!el) return;
    if (slot.list && slot.row) this.markRow(slot.list, slot.row, false);
    this.openInline(el, slot);
  }

  // 在圖上那段文字的位置放一個小輸入框：改文字、Enter 套用、Tab 套用並跳到下一段文字；
  // 旁邊是這一列的動作（新增下一步、刪除）
  openInline(anchor: Element, slot: InlineTarget): void {
    this.closeInline();
    const d = this.data;
    if (!d) return;
    const { field, list, row } = slot;
    const store = row || d.model.opts;
    const current = field.kind === 'lines' ? ((store[field.key] || '').split('\n')[slot.line] || '') : (store[field.key] || '');
    const multiline = field.kind === 'text' && !!field.multiline;
    const box = this.stage.createDiv('wm-mmd-inline');
    this.inline = box;
    // 第一列：輸入框與按鈕；色塊（有的話）在下面一列
    const top = box.createDiv('wm-mmd-inline-row');
    const input = top.createEl('input', { type: 'text', cls: 'wm-mmd-inline-input' });
    input.value = multiline ? showLines(current) : current.trim();
    input.setAttribute('aria-label', t(field.label));
    let done = false;
    this.cancelInline = () => { done = true; };
    // 在圖上改名：同一類的名稱一起改。「定義」的名稱（參與者、類別、實體）改成空的或跟別人同名時不算數，維持原本的名稱
    const rename = (value: string): void => {
      setValue(d.kind, d.model, slot, value, true);
      if (row && field.kind === 'text' && field.def) restoreName(field, row);
    };
    // go：套用之後跳到下一段（1）或上一段（-1）文字繼續改；0 是只套用
    const commit = (go = 0) => {
      if (done) return;
      done = true;
      const value = multiline ? readLines(input.value) : input.value.trim();
      const index = this.getSlots().findIndex(s => sameSlot(s, slot));
      this.closeInline();
      const same = value === (multiline ? current : current.trim());
      // 在圖上改名：同一類的名稱（參與者、狀態、類別…）一起改
      if (!same) { rename(value); this.slots = null; }
      // 下一段文字：照表單的順序（這段文字被清空時，從它原本的位置接著算）
      let next: TextSlot | null = null;
      const after = go ? this.getSlots() : [];
      if (after.length) {
        let j = after.findIndex(s => sameSlot(s, slot));
        if (j < 0) j = Math.min(Math.max(0, index), after.length - 1) - (go > 0 ? 1 : 0);
        next = after[(j + go + after.length) % after.length];
      }
      if (same) { if (next) this.openSlot(next); return; }
      // 圖重畫之後位置會變，所以等新的圖出來再開下一個輸入框
      if (next) { const target = next; this.afterDraw.push(() => this.openSlot(target)); }
      this.changed(true, true);
      if (list && row && !next) this.markRow(list, row, false);
    };
    // 小框裡的「新增下一步」與色塊會關掉輸入框：先把框裡改過的文字寫回去，不然剛打的字會不見
    const keepTyped = (): void => {
      const value = multiline ? readLines(input.value) : input.value.trim();
      if (value === (multiline ? current : current.trim())) return;
      rename(value);
      this.slots = null;
    };
    const button = (name: string, label: string, run: () => void, cls = ''): void => {
      const b = top.createEl('button', { cls: 'clickable-icon wm-mmd-inline-btn' + (cls ? ' ' + cls : '') });
      b.setAttribute('aria-label', label);
      setIcon(b, name);
      keepFocus(b); // 游標留在輸入框，才不會先觸發「離開就套用」；螢幕鍵盤也不會收起來
      b.addEventListener('click', run);
    };
    button('check', t('套用') + ' (Enter)', () => commit(), 'is-apply');
    // 螢幕鍵盤沒有 Tab：給一顆「下一段文字」的按鈕
    button('arrow-right-to-line', t('套用並跳到下一段文字') + ' (Tab)', () => commit(1));
    if (list && row) {
      for (const a of list.actions || []) {
        button(a.icon, t(a.label), () => { done = true; keepTyped(); this.closeInline(); const next = a.run(d.model, row, t); this.changed(true, true); if (next) this.markRow(list, next, true); });
      }
      const pinned = !!list.fixedFirst && d.model.lists[list.key].indexOf(row) === 0;
      if (!pinned) button('trash-2', t('刪除這一列'), () => { done = true; this.closeInline(); this.removeRow(list, row); this.preview(); }, 'is-danger');
      // 這一列有色彩欄位（流程圖節點的底色）：直接在圖上選
      for (const f of list.fields) {
        if (f.kind !== 'color') continue;
        this.swatches(box.createDiv('wm-mmd-swatches'), f, row[f.key] || '', c => {
          done = true;
          keepTyped();
          this.closeInline();
          row[f.key] = c;
          this.changed(true, true);
          this.markRow(list, row, false);
        });
      }
    }
    input.addEventListener('keydown', e => {
      // 輸入法還在選字：這時的 Enter 是確定選字，不是寫回圖上
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(e.shiftKey ? -1 : 1); }
    });
    input.addEventListener('blur', () => window.setTimeout(() => commit(), 0));
    // 那段文字不在預覽框看得到的範圍裡（圖比框大，手機上常見）：先捲到看得到的地方。
    // 捲動會關掉輸入框（見 onOpen），所以記下時間，剛開啟時的捲動不算
    this.inlineAt = Date.now();
    const p = this.prev.getBoundingClientRect();
    // 以整個步驟的形狀為準（方框比裡面的文字大）：有一部分在框外就捲到中間
    const shape = anchor.closest('g.node') || anchor;
    let a = shape.getBoundingClientRect();
    if (a.top < p.top || a.bottom > p.bottom) this.prev.scrollTop += a.top + a.height / 2 - (p.top + p.height / 2);
    if (a.left < p.left || a.right > p.right) this.prev.scrollLeft += a.left + a.width / 2 - (p.left + p.width / 2);
    a = anchor.getBoundingClientRect();
    // 位置：蓋在那段文字上（以 stage 為基準），整個框留在預覽的範圍裡
    const s = this.stage.getBoundingClientRect();
    input.style.width = Math.max(120, Math.min(260, a.width + 60, s.width - 150)) + 'px';
    const fit = (want: number, size: number, room: number) => Math.max(0, Math.min(want, room - size));
    box.style.left = fit(a.left - s.left + a.width / 2 - box.offsetWidth / 2, box.offsetWidth, s.width) + 'px';
    box.style.top = fit(a.top - s.top + a.height / 2 - 18, box.offsetHeight, s.height) + 'px';
    input.focus();
    input.select();
  }

  closeInline(): void {
    if (this.cancelInline) { this.cancelInline(); this.cancelInline = null; }
    if (this.inline) { const el = this.inline; this.inline = null; el.remove(); }
  }

  // ---------------------------------------------------------- 預覽

  // 打字時等一下再重畫。圖越大畫得越久，就等久一點，免得每停一下都卡住（上一次畫了多久的兩倍，最少 0.3 秒、最多 1.5 秒）
  schedulePreview(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.preview(), Math.max(300, Math.min(1500, this.drawMs * 2 + 150)));
  }

  // 放棄還在背後畫的那一份預覽
  dropPending(): void {
    this.drawId++;
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    try { p.handle.unload(); } catch { /* 忽略 */ }
    p.canvas.remove();
  }

  // 等預覽畫出來再呼叫 done：畫面上出現圖就算；沒有圖（語法錯誤時只有訊息）就等內容交出來之後一下子；最久等三秒
  whenDrawn(canvas: HTMLElement, handle: MermaidPreviewHandle, done: () => void): void {
    const id = this.drawId;
    let finished = false;
    let observer: MutationObserver | null = null;
    let timeout = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (observer) observer.disconnect();
      window.clearTimeout(timeout);
      if (id === this.drawId) done();
    };
    // 馬上就有內容（已經畫好的、或測試用的替身）：不用等
    if (canvas.querySelector('svg') || (canvas.textContent || '').trim()) { finish(); return; }
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => { if (canvas.querySelector('svg')) finish(); });
      observer.observe(canvas, { childList: true, subtree: true });
    }
    if (handle.ready) void handle.ready.then(() => window.setTimeout(finish, 250), () => finish());
    timeout = window.setTimeout(finish, 3000);
  }

  // 新的圖出現在畫面上了：記下花了多久、把外框放回對的位置、做排隊等著的事
  drawn(started: number): void {
    this.drawMs = Date.now() - started;
    this.clearHover();
    this.sizeCanvas();
    if (this.firstView && this.canvas && this.canvas.querySelector('svg')) {
      this.firstView = false;
      // 圖比框寬：先把第一段文字（流程圖的第一個步驟）捲到中間
      const first = this.canvas.querySelector('g.node, text, foreignObject');
      if (first && this.prev.scrollWidth > this.prev.clientWidth + 4) {
        const a = first.getBoundingClientRect(); const p = this.prev.getBoundingClientRect();
        this.prev.scrollLeft += a.left + a.width / 2 - (p.left + p.width / 2);
      }
    }
    this.placeMarker(this.reveal);
    this.reveal = false;
    const run = this.afterDraw.splice(0);
    for (const f of run) f();
  }

  preview(): void {
    if (!this.prev) return;
    window.clearTimeout(this.timer);
    this.dropPending();
    // 「能不能用表單」在打程式碼時先不算，這裡才補上
    this.tip.toggle(!!this.getModel());
    this.err.setText('');
    const src = this.src.trim();
    const old = this.canvas && this.canvas.isConnected && this.canvas.hasChildNodes() ? this.canvas : null;
    if (!src) {
      if (this.handle) { try { this.handle.unload(); } catch { /* 忽略 */ } this.handle = null; }
      this.prev.empty();
      this.canvas = null; this.marker = null; this.hover = null;
      this.prev.createSpan({ cls: 'wm-eq-empty', text: t('（輸入後顯示預覽）') });
      this.afterDraw = [];
      return;
    }
    const started = Date.now();
    if (!old) {
      // 第一次（或原本是空的）：直接畫在畫面上
      if (this.handle) { try { this.handle.unload(); } catch { /* 忽略 */ } this.handle = null; }
      this.prev.empty();
      this.marker = null; this.hover = null;
      const canvas = this.prev.createDiv('wm-mmd-canvas');
      canvas.style.zoom = String(this.zoom);
      this.canvas = canvas;
      this.handle = this.opts.render(src, canvas);
      this.whenDrawn(canvas, this.handle, () => this.drawn(started));
    } else {
      // 已經有圖：新的先在背後畫，畫好才換上去。畫的這段時間舊圖留著，畫面不會閃，預覽也不會跳回最上面
      const canvas = this.stage.createDiv('wm-mmd-canvas is-pending');
      canvas.style.zoom = String(this.zoom);
      const handle = this.opts.render(src, canvas);
      this.pending = { canvas, handle };
      this.whenDrawn(canvas, handle, () => {
        const p = this.pending;
        if (!p || p.canvas !== canvas) return;
        this.pending = null;
        const left = this.prev.scrollLeft; const top = this.prev.scrollTop;
        if (this.handle) { try { this.handle.unload(); } catch { /* 忽略 */ } }
        old.remove();
        canvas.removeClass('is-pending');
        this.prev.prepend(canvas);
        this.canvas = canvas;
        this.handle = handle;
        this.prev.scrollLeft = left; this.prev.scrollTop = top;
        this.drawn(started);
      });
    }
    if (this.opts.validate) {
      const stamp = this.stamp = (this.stamp || 0) + 1;
      Promise.resolve(this.opts.validate(src)).then(msg => { if (stamp === this.stamp && this.err) this.err.setText(msg ? t('語法錯誤：') + msg : ''); }).catch(() => {});
    }
  }
}
