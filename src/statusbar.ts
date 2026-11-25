// 狀態列的內容（像 Word 下方的狀態列）：字數、存檔狀態、檢視切換、查看文件屬性、縮放。
// Word 模式（view.ts）與 Markdown／閱讀模式（MdStatusBar）都用 buildStatusBar 建立，
// 版面與按鈕一樣，切換模式時右下角不會突然少掉按鈕（設定「切換到 Markdown／閱讀模式時保留狀態列」可以關掉）
import { setIcon } from 'obsidian';
import { t, key } from './i18n.js';
import { attachHint } from './hints.js';
import { countSource, countText, docText, docStats, readingMinutes, withSourceCounts } from './textstats.js';
import { WordCountModal, wordCountRows } from './dialogs.js';
import { openMarkdownPeek } from './mdbar.js';
import { openPathMenu, renderPath } from './paths.js';
import type { App, MarkdownView, TAbstractFile } from 'obsidian';
import type { CountMethod, TextStats, WordStats } from './textstats.js';
import type { DemoName, HintInfo } from './hints.js';
import type { I18nKey } from './i18n.js';
import type WordModePlugin from './main.js';

// 三種檢視：Word 模式、Markdown 編輯、閱讀模式
export type StatusMode = 'word' | 'source' | 'preview';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict';

export interface StatusBarSpec {
  // 目前的檢視
  mode: StatusMode;
  // true：在 Obsidian 的狀態列裡（桌機）；false：手機上 Word 模式自己放在筆記下方的列
  inStatusBar: boolean;
  // 設定「詳細提示」：檢視按鈕顯示提示卡與動畫；關閉時用 Obsidian 的一般提示
  richHints: boolean;
  // 按 Mod+E 會切到的檢視（提示裡寫出快速鍵）；null 表示不寫
  modE: StatusMode | null;
  // 縮放只套用在 Word 模式的頁面；false 時縮放列停用並說明原因（仍然顯示，版面才不會跳動）
  zoomable: boolean;
  zoom(): number;
  setZoom(z: number): void;
  onCount(): void;
  onMode(mode: StatusMode): void;
  onProps(btn: HTMLButtonElement): void;
  // 這份筆記（顯示路徑用）；沒有這一項就不顯示路徑。只在桌機的狀態列顯示，手機的列放不下
  file?: (() => TAbstractFile | null) | null;
  app?: App;
}

export interface StatusBarParts {
  count: HTMLDivElement;
  status: HTMLDivElement;
  range: HTMLInputElement;
  zoomLabel: HTMLButtonElement;
  // 筆記的路徑（沒顯示時是 null）
  path: HTMLDivElement | null;
  // 檢視按鈕（依 VIEW_BUTTONS 的順序），最後一個是「查看文件屬性」
  views: HTMLButtonElement[];
}

interface ViewButton { mode: StatusMode; icon: string; title: I18nKey; desc: I18nKey; demo: DemoName; }

// 檢視按鈕：圖示、名稱、提示卡的說明與動畫，跟功能區「檢視模式」群組的按鈕相同
export const VIEW_BUTTONS: readonly ViewButton[] = [
  { mode: 'word', icon: 'file-text', title: 'Word 模式', desc: '像 Word 一樣直接看到格式來編輯，存檔仍是純 Markdown。', demo: 'word' },
  { mode: 'source', icon: 'code-2', title: 'Markdown 編輯', desc: '用 Obsidian 原本的 Markdown 編輯這份筆記。', demo: 'markdown' },
  { mode: 'preview', icon: 'book-open', title: '閱讀模式', desc: '用 Obsidian 的閱讀模式檢視（不能編輯）。', demo: 'reading' },
];

// 狀態列的小按鈕；有詳細提示時名稱放在看不見的文字裡（不設 aria-label，Obsidian 才不會另外跳出一般提示）
function smallButton(parent: HTMLElement, cls: string, rich: boolean, info: HintInfo): HTMLButtonElement {
  const b = parent.createEl('button', { cls });
  b.type = 'button';
  const label = info.title + (info.keys ? ' (' + info.keys + ')' : '') + (info.reason ? '\n' + info.reason : '');
  if (rich) { b.createSpan({ cls: 'wm-sr', text: label }); attachHint(b, () => info); } else b.setAttribute('aria-label', label);
  return b;
}

export function buildStatusBar(bar: HTMLElement, o: StatusBarSpec): StatusBarParts {
  // 筆記的路徑：按一下或按右鍵選要複製哪一種路徑
  const getFile = o.file, app = o.app;
  const path = o.inStatusBar && getFile && app ? bar.createDiv('wm-bb-path') : null;
  if (path && getFile && app) {
    renderPath(path, getFile());
    const menu = (e: MouseEvent) => { const f = getFile(); if (f) openPathMenu(app, f, e); };
    path.addEventListener('click', menu);
    path.addEventListener('contextmenu', menu);
  }
  const count = bar.createDiv('wm-bb-count');
  count.addEventListener('click', () => o.onCount());
  if (!o.inStatusBar) bar.createDiv('wm-bb-spacer');
  const status = bar.createDiv('wm-bb-status');
  const views = bar.createDiv('wm-bb-views');
  const buttons: HTMLButtonElement[] = [];
  for (const v of VIEW_BUTTONS) {
    const on = v.mode === o.mode;
    const b = smallButton(views, 'wm-bb-btn' + (on ? ' is-active' : ''), o.richHints, {
      title: t(v.title) + (on ? t('（目前）') : ''), keys: o.modE === v.mode ? key('Mod+E') : null, desc: t(v.desc), demo: v.demo,
    });
    setIcon(b.createSpan('wm-bb-btn-icon'), v.icon);
    b.dataset.mode = v.mode;
    b.addEventListener('click', () => { if (!on) o.onMode(v.mode); });
    buttons.push(b);
  }
  const props = smallButton(views, 'wm-bb-btn wm-bb-props', o.richHints, { title: t('查看文件屬性'), desc: t('不用捲到最上方，直接看這份筆記的屬性（標籤、日期等）。屬性很多時可以篩選。'), demo: 'properties' });
  setIcon(props.createSpan('wm-bb-btn-icon'), 'clipboard-list');
  props.addEventListener('click', () => o.onProps(props));
  buttons.push(props);

  const zoom = bar.createDiv('wm-bb-zoom' + (o.zoomable ? '' : ' is-disabled'));
  const reason = o.zoomable ? null : t('縮放只套用在 Word 模式的頁面。');
  const zbtn = (cls: string, title: I18nKey, text: string | null) => {
    const b = zoom.createEl('button', { cls, text: text || undefined });
    b.type = 'button';
    b.setAttribute('aria-label', t(title) + (reason ? '\n' + reason : ''));
    if (reason) { b.classList.add('is-disabled'); b.setAttribute('aria-disabled', 'true'); }
    return b;
  };
  const minus = zbtn('wm-bb-btn', '縮小', t('－'));
  const range = zoom.createEl('input', { type: 'range', cls: 'wm-bb-range' });
  range.min = '50'; range.max = '200'; range.step = '10';
  range.disabled = !o.zoomable;
  if (reason) range.setAttribute('aria-label', reason);
  const plus = zbtn('wm-bb-btn', '放大', t('＋'));
  const zoomLabel = zbtn('wm-bb-zoomlabel', '恢復 100%', null);
  if (o.zoomable) {
    minus.addEventListener('click', () => o.setZoom(o.zoom() - 10));
    plus.addEventListener('click', () => o.setZoom(o.zoom() + 10));
    range.addEventListener('input', () => o.setZoom(+range.value));
    zoomLabel.addEventListener('click', () => o.setZoom(100));
  }
  const parts = { count, status, range, zoomLabel, path, views: buttons };
  showZoom(parts, o.zoom());
  return parts;
}

export function showZoom(parts: Pick<StatusBarParts, 'range' | 'zoomLabel'>, z: number): void {
  parts.range.value = String(z);
  parts.zoomLabel.setText(z + '%');
}

// 存檔狀態：圖示加文字；at 是上次存檔的時間（沒有時只寫「已儲存」）
export function renderSaveStatus(box: HTMLElement, st: SaveStatus, at: Date | number | null | undefined): void {
  const time = at != null && window.moment ? window.moment(at).format('HH:mm') : '';
  const text = st === 'dirty' ? t('編輯中（自動儲存）') : st === 'saving' ? t('儲存中…') : st === 'conflict' ? t('同步衝突') : t('已儲存') + (time ? ' ' + time : '');
  box.empty();
  setIcon(box.createSpan('wm-bb-icon'), st === 'conflict' ? 'alert-triangle' : st === 'saved' ? 'check' : 'loader');
  box.createSpan({ cls: 'wm-bb-status-text', text });
  // 手機的狀態列放不下文字時只顯示圖示，文字放在提示裡
  box.setAttribute('aria-label', text);
  box.toggleClass('is-conflict', st === 'conflict');
}

// 字數的算法的說明（狀態列字數的提示與「字數統計」視窗用）
export function countNote(method: CountMethod): string {
  return method === 'obsidian'
    ? t('跟 Obsidian 內建的字數一樣：算 Markdown 原文（文件屬性除外），符號與連結網址也算；中文、日文每個字算一個詞。')
    : t('只算看得到的文字：中文、日文、韓文一字算一個，英文與數字一個單字算一個；Markdown 符號、連結網址與文件屬性不算。');
}

// 字數：只顯示字數，有選取時顯示「已選取 a／b 字」。字元數放在提示與「字數統計」視窗：
// 兩個數字並排太擠，而且字元數的算法各家不同（Obsidian 內建的含空白與 Markdown 符號），並排容易看成同一種數字
export function renderCount(box: HTMLElement, all: TextStats, sel: TextStats | null, method: CountMethod): void {
  const fmt = (n: number) => n.toLocaleString();
  if (sel) box.setText(t('已選取 {a}／{b} 字', { a: fmt(sel.words), b: fmt(all.words) }));
  else box.setText(t('{n} 字', { n: fmt(all.words) }));
  // 「跟 Obsidian 一樣」時字元數也跟 Obsidian 一樣含空白與換行
  const chars = method === 'obsidian' ? t('字元數（含空白）') + t('：') + fmt(all.charsWithSpaces) : t('字元數（不含空白）') + t('：') + fmt(all.chars);
  const minutes = t('預估閱讀時間') + t('：') + t('{n} 分鐘', { n: readingMinutes(all) });
  box.setAttribute('aria-label', [chars, minutes, countNote(method), t('點一下看詳細統計')].join('\n'));
}

// 「字數統計」視窗。all、sel 是文件與選取範圍的統計；算法是「跟 Obsidian 一樣」時，字數改用 Markdown 原文算
// （md、selMd 只在這時呼叫：Word 模式要先把文件轉成 Markdown）
export function showWordCount(app: App, method: CountMethod, all: WordStats, sel: WordStats | null, md: () => string, selMd: () => string): void {
  if (method === 'obsidian') {
    all = withSourceCounts(all, md());
    if (sel) sel = withSourceCounts(sel, selMd(), true);
  }
  new WordCountModal(app, wordCountRows(all, sel), countNote(method)).open();
}

// 很長的筆記不轉成文件，直接算原文（每次改字都要重算，轉換太花時間）
const PARSE_LIMIT = 300000;

// Markdown／閱讀模式時狀態列的內容。字數先把原文轉成 Word 模式的文件再算，數字跟 Word 模式一樣；
// 存檔狀態比較編輯中的內容與檔案（Obsidian 沒有公開「還沒存檔」的狀態），時間是檔案的修改時間
export class MdStatusBar {
  declare plugin: WordModePlugin;
  declare view: MarkdownView;
  declare el: HTMLElement;
  declare mode: 'source' | 'preview';
  declare parts: StatusBarParts;
  declare text: string | null;
  declare all: TextStats;
  declare sel: string;
  // 上一次定時更新看到、但還沒拿來算字數的內容與選取（見 update）
  declare seenText: string | null;
  declare seenSel: string;
  declare dirty: boolean;
  // 讀檔案是非同步的：只採用最後一次的結果
  declare seq: number;
  // 上次畫出來的存檔狀態（狀態＋修改時間）
  declare stamp: string;

  // inStatusBar：放在 Obsidian 右下角的狀態列（電腦）；false 是手機上自己放在工具列下方的那一列（mdbar.ts）
  constructor(plugin: WordModePlugin, el: HTMLElement, view: MarkdownView, inStatusBar = true) {
    this.plugin = plugin; this.view = view; this.el = el;
    this.mode = view.getMode && view.getMode() === 'preview' ? 'preview' : 'source';
    this.text = null; this.sel = ''; this.seenText = null; this.seenSel = ''; this.dirty = false; this.seq = 0; this.stamp = '';
    this.all = countText('');
    const S = plugin.settings;
    el.empty();
    this.parts = buildStatusBar(el, {
      mode: this.mode, inStatusBar, richHints: !!S.richHints, modE: S.ctrlE !== false ? 'word' : null, zoomable: false,
      zoom: () => S.zoom || 100, setZoom: () => { /* Markdown／閱讀模式不能縮放 */ },
      onCount: () => this.openWordCount(),
      onMode: m => { if (m === 'word') void plugin.switchToWord(view.leaf); else void plugin.setMarkdownMode(view, m); },
      onProps: b => openMarkdownPeek(plugin, view, b),
      file: S.showPath !== false ? () => view.file : null, app: plugin.app,
    });
    this.update();
  }

  // 定時呼叫（main.ts）：內容或選取有變才重算字數，再確認存檔狀態
  update(): void {
    let text = '';
    try { text = this.view.getViewData(); } catch { /* 檢視還沒載入完成 */ }
    const sel = this.mode === 'source' && this.view.editor ? this.view.editor.getSelection() : '';
    if (text !== this.text || sel !== this.sel) {
      // 算字數要解析整份筆記。還在打字（或拖著選取）的時候先不算，等內容停下來，
      // 也就是連續兩次更新看到的都一樣，再算一次。第一次顯示不用等
      const settled = this.text === null || (text === this.seenText && sel === this.seenSel);
      this.seenText = text; this.seenSel = sel;
      if (settled) {
        if (text !== this.text) this.all = this.countMarkdown(text);
        this.text = text; this.sel = sel;
        renderCount(this.parts.count, this.all, sel ? this.countMarkdown(sel, true) : null, this.plugin.settings.countMethod);
      }
    }
    this.renderStatus();
    const file = this.view.file;
    if (!file) return;
    const seq = ++this.seq;
    void this.plugin.app.vault.cachedRead(file).then(disk => {
      if (seq !== this.seq || !this.el.isConnected) return;
      const dirty = disk !== text;
      if (dirty !== this.dirty) { this.dirty = dirty; this.renderStatus(); }
    }, () => { /* 讀不到檔案：維持原本的狀態 */ });
  }

  renderStatus(): void {
    const file = this.view.file;
    const at = file && file.stat ? file.stat.mtime : null;
    // 每次定時更新都會呼叫：狀態沒變就不重畫
    const stamp = (this.dirty ? 'dirty' : 'saved') + '|' + at;
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    renderSaveStatus(this.parts.status, this.dirty ? 'dirty' : 'saved', at);
  }

  // fragment：選取的一段（不切文件屬性與區塊）。「跟 Obsidian 一樣」的算法直接算原文，不用轉換
  countMarkdown(text: string, fragment = false): TextStats {
    if (this.plugin.settings.countMethod === 'obsidian') return countSource(text, fragment);
    if (text.length > PARSE_LIMIT) return countText(text);
    try {
      const c = this.plugin.converter;
      return countText(docText(fragment ? c.parseFragment(text) : c.parse(text).doc));
    } catch { return countText(text); }
  }

  openWordCount(): void { mdWordCount(this.plugin, this.view); }
}

// Markdown／閱讀模式的字數統計（狀態列的字數、手機「⋯」選單的「字數統計」）：原文轉成 Word 模式的文件再算，數字跟 Word 模式一樣
export function mdWordCount(plugin: WordModePlugin, view: MarkdownView): void {
  const c = plugin.converter;
  let text = '';
  try { text = view.getViewData(); } catch { return; }
  try {
    const source = !view.getMode || view.getMode() === 'source';
    const sel = source && view.editor ? view.editor.getSelection() : '';
    showWordCount(plugin.app, plugin.settings.countMethod, docStats(c.parse(text).doc), sel ? docStats(c.parseFragment(sel)) : null, () => text, () => sel);
  } catch (e) { console.error('[Word 模式] 無法統計字數', e); }
}
