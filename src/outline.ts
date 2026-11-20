// 大綱側邊欄：列出目前筆記（Word 模式或 Markdown）的標題，點一下跳過去，可收合、篩選
import { ItemView, MarkdownView, setIcon } from 'obsidian';
import { t } from './i18n.js';
import type { WorkspaceLeaf } from 'obsidian';
import type WordModePlugin from './main.js';
import type { WordModeView } from './view.js';
import type { I18nKey } from './i18n.js';

export const OUTLINE_TYPE = 'natlee-word-outline';

// 大綱的來源畫面：Word 模式或 Markdown。MarkdownView 沒有 pm，寫成 undefined 讓 v.pm 的檢查能分辨兩者
export type OutlineSource = WordModeView | (MarkdownView & { pm?: undefined });

// 一個標題；Word 模式有 pos（文件位置），Markdown 有 line（行號）。
// key、parent、depth 在 collect() 建立樹狀關係時才補上（所以 push 時轉型）
export interface OutlineHeading {
  level: number;
  text: string;
  pos?: number;
  line?: number;
  key: string;
  parent: OutlineHeading | null;
  depth: number;
  hasChildren?: boolean;
}

interface OutlineRow { h: OutlineHeading; row: HTMLDivElement; }

// heading 節點的屬性（見 schema.ts）；這裡只讀 level（1～6）
interface HeadingAttrs { readonly level: number; }

export class OutlineView extends ItemView {
  declare plugin: WordModePlugin;
  declare collapsed: Set<string>;
  declare filter: string;
  declare titleEl2: HTMLDivElement;
  declare search: HTMLInputElement;
  declare list: HTMLDivElement;
  declare source: OutlineSource | null | undefined;
  // 第一次 refresh() 之前是 undefined；rows 是 render() 依 heads 建的，所以 rows 有值時 heads 一定也有
  declare heads: OutlineHeading[] | undefined;
  declare rows: OutlineRow[] | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: WordModePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.collapsed = new Set();
    this.filter = '';
  }

  getViewType() { return OUTLINE_TYPE; }
  getDisplayText() { return t('大綱'); }
  getIcon() { return 'list-tree'; }

  async onOpen() {
    const c = this.contentEl;
    c.empty();
    c.addClass('wm-outline-view');
    const top = c.createDiv('wm-ov-top');
    this.titleEl2 = top.createDiv('wm-ov-file');
    const tools = top.createDiv('wm-ov-tools');
    const btn = (icon: string, label: I18nKey, run: () => void) => {
      const b = tools.createEl('button', { cls: 'clickable-icon' });
      b.setAttribute('aria-label', t(label));
      setIcon(b, icon);
      b.addEventListener('click', run);
      return b;
    };
    btn('chevrons-down-up', '全部收合', () => { for (const h of this.heads || []) if (h.hasChildren) this.collapsed.add(h.key); this.render(); });
    btn('chevrons-up-down', '全部展開', () => { this.collapsed.clear(); this.render(); });
    this.search = c.createEl('input', { type: 'search', cls: 'wm-ov-search' });
    this.search.placeholder = t('篩選標題…');
    this.search.addEventListener('input', () => { this.filter = this.search.value.trim().toLowerCase(); this.render(); });
    this.list = c.createDiv('wm-ov-list');
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refresh()));
    this.registerEvent(this.app.metadataCache.on('changed', f => { const v: OutlineSource | null = this.plugin.docView(); if (v && v.file === f && !(v.pm)) this.refresh(); }));
    // Markdown 畫面的游標位置沒有事件，定時更新「目前所在的標題」
    this.registerInterval(window.setInterval(() => this.markCurrent(), 800));
    this.refresh();
  }

  async onClose() { this.contentEl.empty(); }

  // 讀出標題：Word 模式從編輯器文件，Markdown 從 Obsidian 的索引
  collect(): OutlineHeading[] {
    const v: OutlineSource | null = this.plugin.docView();
    this.source = v;
    if (!v || !v.file) return [];
    const out: OutlineHeading[] = [];
    if (v.pm) {
      v.pm.state.doc.forEach((n, pos) => {
        if (n.type.name === 'heading') out.push({ level: (n.attrs as HeadingAttrs).level, text: n.textContent || t('（無標題）'), pos } as OutlineHeading);
      });
    } else {
      const cache = this.app.metadataCache.getFileCache(v.file);
      for (const h of (cache && cache.headings) || []) out.push({ level: h.level, text: h.heading, line: h.position.start.line } as OutlineHeading);
    }
    // 建立樹狀關係（收合用）
    const stack: OutlineHeading[] = [];
    out.forEach((h, i) => {
      // 收合狀態記在這個鍵上。要帶筆記的路徑：只用「第幾個＋標題文字」的話，
      // 另一份筆記同一個位置有同名的標題（例如第一個都是「摘要」）也會跟著收合
      h.key = v.file!.path + '\n' + i + ':' + h.text;
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      h.parent = stack.length ? stack[stack.length - 1] : null;
      h.depth = stack.length;
      if (h.parent) h.parent.hasChildren = true;
      stack.push(h);
    });
    return out;
  }

  refresh() {
    if (!this.list) return;
    this.heads = this.collect();
    const v = this.source;
    this.titleEl2.setText(v && v.file ? v.file.basename : t('沒有開啟的筆記'));
    this.render();
  }

  hidden(h: OutlineHeading): boolean {
    for (let p = h.parent; p; p = p.parent) if (this.collapsed.has(p.key)) return true;
    return false;
  }

  render() {
    const list = this.list;
    list.empty();
    const heads = this.heads || [];
    if (!heads.length) { list.createDiv({ cls: 'wm-ov-empty', text: t('這份筆記沒有標題') }); return; }
    this.rows = [];
    for (const h of heads) {
      const match = !this.filter || h.text.toLowerCase().includes(this.filter);
      if (!match || (!this.filter && this.hidden(h))) continue;
      const row = list.createDiv('wm-ov-item wm-ov-h' + h.level);
      row.style.paddingLeft = (6 + (this.filter ? 0 : h.depth) * 14) + 'px';
      const tog = row.createSpan('wm-ov-toggle');
      if (h.hasChildren && !this.filter) {
        setIcon(tog, this.collapsed.has(h.key) ? 'chevron-right' : 'chevron-down');
        tog.addEventListener('click', e => {
          e.stopPropagation();
          if (this.collapsed.has(h.key)) this.collapsed.delete(h.key); else this.collapsed.add(h.key);
          this.render();
        });
      }
      row.createSpan({ cls: 'wm-ov-level', text: 'H' + h.level });
      row.createSpan({ cls: 'wm-ov-text', text: h.text });
      row.addEventListener('click', () => this.jump(h));
      this.rows.push({ h, row });
    }
    this.markCurrent();
  }

  jump(h: OutlineHeading) {
    const v = this.source;
    if (!v) return;
    this.app.workspace.setActiveLeaf(v.leaf, { focus: true });
    if (v.pm && h.pos != null) v.scrollToPos(h.pos);
    else if (h.line != null) {
      if (v instanceof MarkdownView && v.getMode() === 'source') {
        v.editor.setCursor({ line: h.line, ch: 0 });
        v.editor.scrollIntoView({ from: { line: h.line, ch: 0 }, to: { line: h.line, ch: 0 } }, true);
        v.editor.focus();
      } else v.leaf.setEphemeralState({ line: h.line });
    }
  }

  // 標出游標目前所在的標題
  markCurrent() {
    if (!this.rows || !this.source) return;
    const v = this.source;
    let at = null;
    if (v.pm) at = v.pm.state.selection.from;
    else if (v instanceof MarkdownView && v.getMode() === 'source' && v.editor) at = v.editor.getCursor().line;
    let cur = null;
    if (at != null) for (const h of this.heads!) { const p = v.pm ? h.pos : h.line; if (p! <= at) cur = h; else break; }
    for (const { h, row } of this.rows) {
      const on = h === cur;
      // 目前的標題換了：捲到看得見的地方
      if (on && !row.hasClass('is-current') && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      row.toggleClass('is-current', on);
    }
  }
}
