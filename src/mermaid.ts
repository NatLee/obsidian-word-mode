// Mermaid 圖表編輯器：左邊編輯（流程圖可以用表單，其他圖表用程式碼），右邊即時預覽
// opts: { src, existing, mode: 'visual'|'code', render(src, el) → { unload() }, validate(src) → Promise<錯誤訊息|null> }
import { Modal, setIcon } from 'obsidian';
import { t, key } from './i18n.js';
import {
  editableFlowchart, generateFlowchart, newNodeId, DIRECTIONS, SHAPES, LINKS, FLOW_REASONS, MERMAID_TEMPLATES,
} from './flowchart.js';
import type { App } from 'obsidian';
import type { FlowModel, FlowNode, FlowReason } from './flowchart.js';

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
// 下拉選單的選項：[值, 顯示的文字]
type SelectOption = [string, string];

const DEFAULT_SRC = 'flowchart TD\n    A[開始] --> B[結束]';

export class MermaidModal extends Modal {
  declare opts: MermaidModalOptions;
  declare onSave: (text: string) => void;
  declare src: string;
  declare original: string;
  declare model: FlowModel | false | null | undefined;
  declare reason?: FlowReason | null;
  declare tab: MermaidTab;
  declare tabVisual: HTMLButtonElement;
  declare tabCode: HTMLButtonElement;
  declare visualPane: HTMLDivElement;
  declare codePane: HTMLDivElement;
  declare ta: HTMLTextAreaElement;
  declare err: HTMLSpanElement;
  declare prev: HTMLDivElement;
  declare ok: HTMLButtonElement;
  declare timer?: number;
  declare handle?: MermaidPreviewHandle | null;
  declare stamp?: number;

  constructor(app: App, opts: MermaidModalOptions, onSave: (text: string) => void) {
    super(app);
    this.opts = opts;
    this.onSave = onSave;
    this.src = opts.src && opts.src.trim() ? opts.src : t(DEFAULT_SRC);
    this.original = opts.src || '';
    this.model = null;
    this.tab = opts.mode === 'code' ? 'code' : 'visual';
  }

  onOpen(): void {
    this.titleEl.setText(this.opts.existing ? t('編輯圖表（Mermaid）') : t('插入圖表（Mermaid）'));
    this.modalEl.addClass('wm-mmd-modal');
    const c = this.contentEl;
    c.addClass('wm-mmd');

    const top = c.createDiv('wm-mmd-top');
    const tabs = top.createDiv('wm-link-tabs');
    this.tabVisual = tabs.createEl('button', { text: t('表單（流程圖）') });
    this.tabCode = tabs.createEl('button', { text: t('程式碼') });
    this.tabVisual.addEventListener('click', () => this.setTab('visual'));
    this.tabCode.addEventListener('click', () => this.setTab('code'));
    const tpl = top.createEl('select', { cls: 'dropdown wm-mmd-template' });
    tpl.setAttribute('aria-label', t('套用範本（會取代目前的內容）'));
    tpl.createEl('option', { text: t('範本…') }).value = '';
    MERMAID_TEMPLATES.forEach(([name], i) => { tpl.createEl('option', { text: t(name) }).value = String(i); });
    tpl.addEventListener('change', () => {
      if (tpl.value === '') return;
      this.setSource(t(MERMAID_TEMPLATES[+tpl.value][1])); // 範本的文字也跟著介面語言
      tpl.value = '';
      this.setTab(this.model ? this.tab : 'code');
    });
    top.createDiv({ cls: 'wm-eq-hint', text: t('{k} 套用・Esc 取消', { k: key('Mod+Enter') }) });

    const body = c.createDiv('wm-mmd-body');
    const left = body.createDiv('wm-mmd-edit');
    this.visualPane = left.createDiv('wm-mmd-visual');
    this.codePane = left.createDiv('wm-mmd-code');
    this.ta = this.codePane.createEl('textarea', { cls: 'wm-mmd-input' });
    this.ta.spellcheck = false;
    this.ta.value = this.src;
    this.ta.addEventListener('input', () => { this.src = this.ta.value; this.model = undefined; this.schedulePreview(); });
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { // Tab 輸入縮排，不要跳到下一個欄位
        e.preventDefault();
        const a = this.ta.selectionStart;
        this.ta.value = this.ta.value.slice(0, a) + '    ' + this.ta.value.slice(this.ta.selectionEnd);
        this.ta.setSelectionRange(a + 4, a + 4);
        this.ta.dispatchEvent(new Event('input'));
      }
    });
    const right = body.createDiv('wm-mmd-right');
    const lab = right.createDiv('wm-eq-label');
    lab.createSpan({ text: t('預覽') });
    this.err = lab.createSpan({ cls: 'wm-eq-error' });
    this.prev = right.createDiv('wm-mmd-preview');
    // 點預覽圖上的節點：跳到表單裡那個節點
    this.prev.addEventListener('click', e => {
      const g = (e.target as Element).closest && (e.target as Element).closest('g.node, .node');
      const m = g && /^flowchart-(.+)-\d+$/.exec(g.id || '');
      if (m && this.getModel()) { this.setTab('visual'); this.focusNode(m[1]); }
    });

    const bar = c.createDiv('modal-button-container');
    bar.createEl('button', { text: t('取消') }).addEventListener('click', () => this.close());
    this.ok = bar.createEl('button', { text: this.opts.existing ? t('套用') : t('插入'), cls: 'mod-cta' });
    this.ok.addEventListener('click', () => this.submit());
    c.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); } });

    this.setTab(this.tab === 'visual' && !this.getModel() ? 'code' : this.tab);
    this.preview();
  }

  onClose(): void {
    window.clearTimeout(this.timer);
    if (this.handle) { try { this.handle.unload(); } catch { /* 忽略 */ } }
    this.contentEl.empty();
  }

  submit(): void {
    const text = this.src.replace(/\s+$/, '');
    if (!text.trim()) return;
    this.close();
    // 沒有改動就交回原本的文字（不重寫使用者自己排的格式）
    this.onSave(text === this.original.replace(/\s+$/, '') ? this.original : text);
  }

  // 目前的程式碼能不能用表單編輯（流程圖且沒有不支援的寫法）
  getModel(): FlowModel | null {
    if (this.model === undefined || this.model === null) {
      const m = editableFlowchart(this.src);
      this.model = m.ok ? m : false;
      this.reason = m.ok ? null : m.reason;
    }
    return this.model || null;
  }

  setSource(src: string): void {
    this.src = src;
    this.ta.value = src;
    this.model = undefined;
    this.preview();
  }

  setTab(tab: MermaidTab): void {
    this.tab = tab;
    this.tabVisual.toggleClass('is-active', tab === 'visual');
    this.tabCode.toggleClass('is-active', tab === 'code');
    this.visualPane.toggle(tab === 'visual');
    this.codePane.toggle(tab === 'code');
    if (tab === 'visual') this.buildVisual(); else { this.ta.value = this.src; window.setTimeout(() => this.ta.focus(), 10); }
  }

  // 表單改了：重新產生程式碼並更新預覽
  changed(rebuild: boolean): void {
    this.src = generateFlowchart(this.model as FlowModel); // 只有表單會呼叫，這時一定有 model
    this.ta.value = this.src;
    if (rebuild) this.buildVisual();
    this.schedulePreview();
  }

  focusNode(id: string): void {
    const row = this.visualPane.querySelector('[data-node="' + String(id).replace(/"/g, '\\"') + '"]');
    if (!row) return;
    for (const r of this.visualPane.querySelectorAll('.wm-mmd-row.is-current')) r.removeClass('is-current');
    row.addClass('is-current');
    const input = row.querySelector('input');
    if (input) { input.focus(); input.select(); }
    if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  buildVisual(): void {
    const p = this.visualPane;
    p.empty();
    const model = this.getModel();
    if (!model) {
      // getModel 回傳 null 時一定設了 reason
      p.createDiv({ cls: 'wm-mmd-note', text: t(FLOW_REASONS[this.reason!] || FLOW_REASONS.syntax) });
      const b = p.createEl('button', { text: t('改用程式碼編輯'), cls: 'mod-cta' });
      b.addEventListener('click', () => this.setTab('code'));
      return;
    }
    const icon = (parent: HTMLElement, name: string, label: string, run: () => void): HTMLButtonElement => {
      const b = parent.createEl('button', { cls: 'clickable-icon wm-mmd-iconbtn' });
      b.setAttribute('aria-label', label);
      setIcon(b, name);
      b.addEventListener('click', run);
      return b;
    };
    const select = (parent: HTMLElement, cls: string, options: SelectOption[], value: string, onChange: (value: string) => void): HTMLSelectElement => {
      const s = parent.createEl('select', { cls: 'dropdown ' + cls });
      for (const [v, label] of options) s.createEl('option', { text: label }).value = v;
      s.value = value;
      s.addEventListener('change', () => onChange(s.value));
      return s;
    };
    const nodeLabel = (n: FlowNode): string => (n.text && n.text !== n.id ? n.text.split('\n')[0] + '（' + n.id + '）' : n.id);

    // ---- 方向
    const dirRow = p.createDiv('wm-mmd-dir');
    dirRow.createSpan({ text: t('方向') });
    select(dirRow, 'wm-mmd-dirsel', DIRECTIONS.map(([v, label]) => [v, t(label)]), model.dir, v => { model.dir = v; this.changed(false); });

    // ---- 節點
    p.createDiv({ cls: 'wm-mmd-section', text: t('步驟（節點）') });
    const nodes = p.createDiv('wm-mmd-list');
    for (const n of model.nodes) {
      const row = nodes.createDiv('wm-mmd-row');
      row.dataset.node = n.id;
      const input = row.createEl('input', { type: 'text', cls: 'wm-mmd-text' });
      input.value = n.text == null ? '' : n.text.replace(/\n/g, ' / ');
      input.placeholder = t('步驟的文字');
      input.addEventListener('input', () => { n.text = input.value.replace(/ \/ /g, '\n'); this.changed(false); });
      input.addEventListener('change', () => this.buildVisual()); // 更新下方連線選單裡的名稱
      input.addEventListener('focus', () => { for (const r of p.querySelectorAll('.wm-mmd-row.is-current')) r.removeClass('is-current'); row.addClass('is-current'); });
      select(row, 'wm-mmd-shape', SHAPES.map(([v, label]) => [v, t(label)]), n.shape || 'rect', v => { n.shape = v; this.changed(false); });
      icon(row, 'corner-down-right', t('新增下一步（接在這個步驟後面）'), () => {
        const id = newNodeId(model);
        model.nodes.push({ id, text: t('新步驟'), shape: 'rect' });
        model.edges.push({ from: n.id, to: id, text: '', style: 'arrow' });
        this.changed(true);
        this.focusNode(id);
      });
      icon(row, 'trash-2', t('刪除這個步驟（連到它的線也會刪除）'), () => {
        model.nodes = model.nodes.filter(x => x !== n);
        model.edges = model.edges.filter(e => e.from !== n.id && e.to !== n.id);
        this.changed(true);
      });
    }
    const addNode = p.createEl('button', { text: t('＋ 新增步驟'), cls: 'wm-mmd-add' });
    addNode.addEventListener('click', () => {
      const id = newNodeId(model);
      model.nodes.push({ id, text: t('新步驟'), shape: 'rect' });
      this.changed(true);
      this.focusNode(id);
    });

    // ---- 連線
    p.createDiv({ cls: 'wm-mmd-section', text: t('連線') });
    const edges = p.createDiv('wm-mmd-list');
    const nodeOptions: SelectOption[] = model.nodes.map(n => [n.id, nodeLabel(n)]);
    model.edges.forEach((e, i) => {
      const row = edges.createDiv('wm-mmd-row wm-mmd-edge');
      select(row, 'wm-mmd-from', nodeOptions, e.from, v => { e.from = v; this.changed(false); });
      select(row, 'wm-mmd-link', LINKS.map(([v, label]) => [v, t(label)]), e.style, v => { e.style = v; this.changed(false); });
      select(row, 'wm-mmd-to', nodeOptions, e.to, v => { e.to = v; this.changed(false); });
      const input = row.createEl('input', { type: 'text', cls: 'wm-mmd-text' });
      input.value = e.text || '';
      input.placeholder = t('線上的文字（可不填）');
      input.addEventListener('input', () => { e.text = input.value; this.changed(false); });
      icon(row, 'trash-2', t('刪除這條連線'), () => { model.edges.splice(i, 1); this.changed(true); });
    });
    const addEdge = p.createEl('button', { text: t('＋ 新增連線'), cls: 'wm-mmd-add' });
    addEdge.disabled = model.nodes.length < 1;
    addEdge.addEventListener('click', () => {
      const a = model.nodes[Math.max(0, model.nodes.length - 2)];
      const b = model.nodes[model.nodes.length - 1];
      model.edges.push({ from: a.id, to: b.id, text: '', style: 'arrow' });
      this.changed(true);
    });
    if (model.extra && model.extra.length) p.createDiv({ cls: 'wm-mmd-note', text: t('這張圖另外有 {n} 行樣式設定（style、class 等），會原樣保留；要修改請用程式碼。', { n: model.extra.length }) });
  }

  schedulePreview(): void { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.preview(), 300); }

  preview(): void {
    if (!this.prev) return;
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
