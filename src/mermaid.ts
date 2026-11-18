// Mermaid 圖表編輯器：左邊編輯（表單或程式碼），右邊即時預覽；點預覽圖上的文字可以直接修改。
// 表單依 diagrams.ts 對各種圖表的描述畫出來：流程圖、循序圖、甘特圖、圓餅圖、狀態圖、類別圖、心智圖、時間軸、ER 圖。
// opts: { src, existing, mode: 'visual'|'code', render(src, el) → { unload() }, validate(src) → Promise<錯誤訊息|null> }
import { Modal, setIcon } from 'obsidian';
import { t, key } from './i18n.js';
import { DIAGRAM_KINDS, DIAGRAM_REASONS, editableDiagram, detectKind, textSlots, findSlot, setValue, squash } from './diagrams.js';
import type { App } from 'obsidian';
import type { DiagramKind, DiagramModel, DiagramReason, Field, ListSpec, Row, SelectField, TextField, TextSlot } from './diagrams.js';

// opts.render 的回傳值：關掉預覽時呼叫 unload()
export interface MermaidPreviewHandle { unload(): void; }
export type MermaidTab = 'visual' | 'code';
export interface MermaidModalOptions {
  src?: string;
  existing?: boolean;
  mode?: MermaidTab;
  render(src: string, el: HTMLElement): MermaidPreviewHandle;
  // 回傳錯誤訊息；沒有錯誤時回傳 null
  validate?(src: string): Promise<string | null> | string | null;
}
// 目前的程式碼讀成表單資料的結果
interface Editable { kind: DiagramKind; model: DiagramModel; }
// 表單裡的一個下拉選單（其他欄位改了之後要更新選項，例如步驟改名後連線的選單）
interface SelectRef { el: HTMLSelectElement; field: SelectField; row: Row | null; }
// 圖上的一段文字：元素、文字內容、在同樣文字裡是第幾個
interface DiagramLabel { el: Element; text: string; nth: number; }
// 在圖上編輯的對象：欄位、所在的清單與列（圖表本身的設定時是 null）、多行欄位裡的第幾行
type InlineTarget = Pick<TextSlot, 'field' | 'list' | 'row' | 'line'>;

const DEFAULT_SRC = 'flowchart TD\n    A[開始] --> B[結束]';
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
  declare confirmEl: HTMLDivElement;
  declare visualPane: HTMLDivElement;
  declare codePane: HTMLDivElement;
  declare ta: HTMLTextAreaElement;
  declare err: HTMLSpanElement;
  declare tip: HTMLSpanElement;
  declare stage: HTMLDivElement;
  declare prev: HTMLDivElement;
  declare ok: HTMLButtonElement;
  declare selects: SelectRef[];
  declare inline: HTMLDivElement | null;
  // 取消圖上正在編輯的文字（關掉小輸入框時呼叫，之後輸入框失去焦點也不會套用）
  declare cancelInline: (() => void) | null;
  declare listId: number;
  declare timer?: number;
  declare handle?: MermaidPreviewHandle | null;
  declare stamp?: number;

  constructor(app: App, opts: MermaidModalOptions, onSave: (text: string) => void) {
    super(app);
    this.opts = opts;
    this.onSave = onSave;
    this.src = opts.src && opts.src.trim() ? opts.src : t(DEFAULT_SRC);
    this.original = opts.src || '';
    this.data = undefined;
    this.tab = opts.mode === 'code' ? 'code' : 'visual';
    this.selects = [];
    this.inline = null;
    this.cancelInline = null;
    this.listId = 0;
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.existing ? t('編輯圖表（Mermaid）') : t('插入圖表（Mermaid）'));
    this.modalEl.addClass('wm-mmd-modal');
    const c = this.contentEl;
    c.addClass('wm-mmd');

    // ---- 圖表種類（按一下換成那一種的範本）
    this.kindsEl = c.createDiv('wm-mmd-kinds');
    for (const k of DIAGRAM_KINDS) {
      const b = this.kindsEl.createEl('button', { cls: 'wm-mmd-kind' });
      b.dataset.kind = k.id;
      setIcon(b.createSpan('wm-mmd-kind-icon'), k.icon);
      b.createSpan({ text: t(k.name) });
      b.setAttribute('aria-label', t('換成「{name}」的範本', { name: t(k.name) }));
      b.addEventListener('click', () => this.pickKind(k));
    }
    this.confirmEl = c.createDiv('wm-mmd-confirm');
    this.confirmEl.hide();

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
    this.ta.value = this.src;
    this.ta.addEventListener('input', () => { this.src = this.ta.value; this.data = undefined; this.markKind(); this.schedulePreview(); });
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { // Tab 輸入縮排，不要跳到下一個欄位
        e.preventDefault();
        const a = this.ta.selectionStart;
        this.ta.value = this.ta.value.slice(0, a) + '    ' + this.ta.value.slice(this.ta.selectionEnd);
        this.ta.setSelectionRange(a + 4, a + 4);
        this.ta.dispatchEvent(new Event('input'));
      }
    });
    const right = body.createDiv('wm-mmd-right wm-eq-card');
    const lab = right.createDiv('wm-eq-label');
    lab.createSpan({ text: t('預覽') });
    this.tip = lab.createSpan({ cls: 'wm-mmd-tip', text: t('點圖上的文字可以直接修改') });
    this.err = lab.createSpan({ cls: 'wm-eq-error' });
    // stage 包住預覽與「在圖上編輯」的小輸入框（預覽重畫時輸入框不會被清掉）
    this.stage = right.createDiv('wm-mmd-stage');
    this.prev = this.stage.createDiv('wm-mmd-preview');
    this.prev.addEventListener('click', e => this.onPreviewClick(e));
    this.prev.addEventListener('scroll', () => this.closeInline());

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

  setSource(src: string): void {
    this.src = src;
    this.ta.value = src;
    this.data = undefined;
    this.closeInline();
    this.markKind();
    this.preview();
  }

  // 標出目前是哪一種圖表；不能用表單時不顯示「點圖上的文字可以直接修改」
  markKind(): void {
    const kind = detectKind(this.src);
    for (const b of this.kindsEl.querySelectorAll<HTMLElement>('.wm-mmd-kind')) b.toggleClass('is-active', !!kind && b.dataset.kind === kind.id);
    this.tip.toggle(!!this.getModel());
  }

  // 按了某一種圖表：換成那一種的範本。目前的內容是自己改過的就先問一下，免得誤按把內容蓋掉
  pickKind(k: DiagramKind): void {
    const cur = this.src.trim();
    const pristine = !cur || cur === t(DEFAULT_SRC).trim() || DIAGRAM_KINDS.some(x => t(x.template).trim() === cur);
    const apply = () => {
      this.confirmEl.hide();
      this.setSource(t(k.template)); // 範本的文字也跟著介面語言
      this.setTab(this.getModel() ? this.tab : 'code');
    };
    if (pristine) { apply(); return; }
    this.confirmEl.empty();
    this.confirmEl.show();
    this.confirmEl.createSpan({ text: t('要把目前的內容換成「{name}」的範本嗎？目前的內容會被取代。', { name: t(k.name) }) });
    const yes = this.confirmEl.createEl('button', { text: t('取代'), cls: 'mod-warning' });
    const no = this.confirmEl.createEl('button', { text: t('取消') });
    yes.addEventListener('click', apply);
    no.addEventListener('click', () => this.confirmEl.hide());
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
    this.src = d.kind.generate(d.model);
    this.ta.value = this.src;
    if (rebuild) this.buildVisual(); else this.refreshSelects();
    if (now) this.preview(); else this.schedulePreview();
  }

  // 其他欄位改了（例如步驟改名）：更新每個下拉選單的選項，保留原本選的值
  refreshSelects(): void {
    const d = this.data;
    if (!d) return;
    for (const s of this.selects) {
      const value = (s.row || d.model.opts)[s.field.key] || '';
      s.el.replaceChildren();
      for (const [v, label] of s.field.options(d.model, t)) s.el.createEl('option', { text: label }).value = v;
      s.el.value = value;
    }
  }

  // 表單裡某一列的元素
  rowEl(list: ListSpec, row: Row): HTMLElement | null {
    const d = this.data;
    const i = d ? (d.model.lists[list.key] || []).indexOf(row) : -1;
    return i < 0 ? null : this.visualPane.querySelector<HTMLElement>('[data-row="' + list.key + ':' + i + '"]');
  }

  // 標出表單裡的一列並捲到看得到的地方；focus 為 true 時把游標放進第一個輸入框
  markRow(list: ListSpec, row: Row, focus: boolean): void {
    for (const r of this.visualPane.querySelectorAll('.wm-mmd-row.is-current')) r.removeClass('is-current');
    const el = this.rowEl(list, row);
    if (!el) return;
    el.addClass('is-current');
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    if (!focus) return;
    const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], textarea');
    if (input) { input.focus(); input.select(); }
  }

  // ---------------------------------------------------------- 表單

  buildVisual(): void {
    const p = this.visualPane;
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
    for (const f of kind.opts) this.field(head, f, null, null, true);
    // ---- 各個清單
    for (const list of kind.lists) {
      const rows = model.lists[list.key] || (model.lists[list.key] = []);
      const title = p.createDiv('wm-mmd-section');
      title.createSpan({ text: t(list.title) });
      title.createSpan({ cls: 'wm-mmd-count', text: String(rows.length) });
      const box = p.createDiv('wm-mmd-list');
      rows.forEach((row, i) => this.row(box, list, rows, row, i));
      const add = p.createEl('button', { text: t(list.add), cls: 'wm-mmd-add' });
      add.addEventListener('click', () => {
        const row = list.make(model, t);
        rows.push(row);
        this.changed(true);
        this.markRow(list, row, true);
      });
      if (list.hint) p.createDiv({ cls: 'wm-mmd-hint', text: t(list.hint) });
    }
    if (model.extra.length) p.createDiv({ cls: 'wm-mmd-note', text: t('這張圖另外有 {n} 行樣式設定（style、class 等），會原樣保留；要修改請用程式碼。', { n: model.extra.length }) });
  }

  // 表單裡的一列：各個欄位，右邊是這一列的按鈕（額外的動作、上移、下移、刪除）
  row(box: HTMLElement, list: ListSpec, rows: Row[], row: Row, i: number): void {
    const d = this.data!;
    const el = box.createDiv('wm-mmd-row' + (list.rowClass ? ' ' + list.rowClass : ''));
    el.dataset.row = list.key + ':' + i;
    el.addEventListener('focusin', () => { for (const r of this.visualPane.querySelectorAll('.wm-mmd-row.is-current')) r.removeClass('is-current'); el.addClass('is-current'); });
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
    if (list.onDelete) list.onDelete(d.model, row);
    // onDelete 可能換掉其他清單的陣列，所以重新取一次這個清單
    const now = d.model.lists[list.key];
    const j = now.indexOf(row);
    if (j >= 0) now.splice(j, 1);
    this.changed(true);
  }

  // 表單裡的一格。row 是 null 表示圖表本身的設定（存在 model.opts）；labelled：欄位前面顯示名稱
  field(parent: HTMLElement, f: Field, list: ListSpec | null, row: Row | null, labelled: boolean): void {
    const d = this.data!;
    const store = row || d.model.opts;
    const label = t(f.label);
    const cls = 'wm-mmd-f-' + f.key + (f.size ? ' is-' + f.size : '');
    const host = labelled && f.kind !== 'check' ? parent.createEl('label', { cls: 'wm-mmd-opt' }) : parent;
    if (host !== parent) host.createSpan({ text: label });
    if (f.kind === 'text') {
      const input = host.createEl('input', { type: 'text', cls: 'wm-mmd-text ' + cls });
      input.value = f.multiline ? showLines(store[f.key]) : (store[f.key] || '');
      input.setAttribute('aria-label', label);
      if (f.placeholder) input.placeholder = t(f.placeholder);
      if (f.suggest) {
        // 輸入時的建議（已經用過的狀態名稱、區段名稱）
        const id = 'wm-mmd-dl-' + (this.listId++);
        const dl = host.createEl('datalist');
        dl.id = id;
        input.setAttribute('list', id);
        const fill = () => { dl.replaceChildren(); for (const v of f.suggest!(d.model)) dl.createEl('option').value = v; };
        fill();
        input.addEventListener('focus', fill);
      }
      input.addEventListener('input', () => {
        // 「定義」的欄位（參與者、類別、實體的名稱）改名：引用它的欄位一起改
        setValue(d.kind, d.model, { field: f, list, row }, f.multiline ? readLines(input.value) : input.value, !!f.def);
        this.changed(false);
      });
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
      for (const [v, text] of f.options(d.model, t)) s.createEl('option', { text }).value = v;
      s.value = store[f.key] || '';
      s.addEventListener('change', () => { store[f.key] = s.value; this.changed(false); });
      this.selects.push({ el: s, field: f, row });
    } else if (f.kind === 'check') {
      const l = parent.createEl('label', { cls: 'wm-mmd-check ' + cls });
      const cb = l.createEl('input', { type: 'checkbox' });
      cb.checked = !!store[f.key];
      l.createSpan({ text: label });
      cb.addEventListener('change', () => { store[f.key] = cb.checked ? '1' : ''; this.changed(false); });
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
    if (!slot && hit) slot = findSlot(textSlots(d.kind, d.model), hit.text, hit.nth);
    if (!slot) return;
    e.preventDefault();
    if (this.tab !== 'visual') this.setTab('visual');
    if (slot.list && slot.row) this.markRow(slot.list, slot.row, false);
    this.openInline((hit && hit.el) || target, slot);
  }

  // 在圖上那段文字的位置放一個小輸入框：改文字、Enter 套用；旁邊是這一列的動作（新增下一步、刪除）
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
    const input = box.createEl('input', { type: 'text', cls: 'wm-mmd-inline-input' });
    input.value = multiline ? showLines(current) : current.trim();
    input.setAttribute('aria-label', t(field.label));
    let done = false;
    this.cancelInline = () => { done = true; };
    const commit = () => {
      if (done) return;
      done = true;
      const value = multiline ? readLines(input.value) : input.value.trim();
      this.closeInline();
      if (value === (multiline ? current : current.trim())) return;
      // 在圖上改名：同一類的名稱（參與者、狀態、類別…）一起改
      setValue(d.kind, d.model, slot, value, true);
      this.changed(true, true);
      if (list && row) this.markRow(list, row, false);
    };
    const button = (name: string, label: string, run: () => void, cls = ''): void => {
      const b = box.createEl('button', { cls: 'clickable-icon wm-mmd-inline-btn' + (cls ? ' ' + cls : '') });
      b.setAttribute('aria-label', label);
      setIcon(b, name);
      b.addEventListener('mousedown', ev => ev.preventDefault()); // 游標留在輸入框，才不會先觸發「離開就套用」
      b.addEventListener('click', run);
    };
    button('check', t('套用'), commit, 'is-apply');
    if (list && row) {
      for (const a of list.actions || []) {
        button(a.icon, t(a.label), () => { done = true; this.closeInline(); const next = a.run(d.model, row, t); this.changed(true, true); if (next) this.markRow(list, next, true); });
      }
      const pinned = !!list.fixedFirst && d.model.lists[list.key].indexOf(row) === 0;
      if (!pinned) button('trash-2', t('刪除這一列'), () => { done = true; this.closeInline(); this.removeRow(list, row); this.preview(); }, 'is-danger');
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
    });
    input.addEventListener('blur', () => window.setTimeout(commit, 0));
    // 位置：蓋在那段文字上（以 stage 為基準）
    const a = anchor.getBoundingClientRect();
    const s = this.stage.getBoundingClientRect();
    const width = Math.max(150, Math.min(320, a.width + 60));
    box.style.left = Math.max(0, Math.min(a.left - s.left + a.width / 2 - width / 2, Math.max(0, s.width - width - 90))) + 'px';
    box.style.top = Math.max(0, a.top - s.top + a.height / 2 - 16) + 'px';
    input.style.width = width + 'px';
    input.focus();
    input.select();
  }

  closeInline(): void {
    if (this.cancelInline) { this.cancelInline(); this.cancelInline = null; }
    if (this.inline) { const el = this.inline; this.inline = null; el.remove(); }
  }

  // ---------------------------------------------------------- 預覽

  schedulePreview(): void { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.preview(), 300); }

  preview(): void {
    if (!this.prev) return;
    window.clearTimeout(this.timer);
    if (this.handle) { try { this.handle.unload(); } catch { /* 忽略 */ } this.handle = null; }
    this.prev.empty();
    this.err.setText('');
    const src = this.src.trim();
    if (!src) { this.prev.createSpan({ cls: 'wm-eq-empty', text: t('（輸入後顯示預覽）') }); return; }
    this.handle = this.opts.render(src, this.prev);
    if (this.opts.validate) {
      const stamp = this.stamp = (this.stamp || 0) + 1;
      Promise.resolve(this.opts.validate(src)).then(msg => { if (stamp === this.stamp && this.err) this.err.setText(msg ? t('語法錯誤：') + msg : ''); }).catch(() => {});
    }
  }
}
