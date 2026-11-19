// 狀態列的內容（像 Word 下方的狀態列）：字數、存檔狀態、檢視切換、查看文件屬性、縮放。
// Word 模式（view.ts）與 Markdown／閱讀模式（MdStatusBar）都用 buildStatusBar 建立，
// 版面與按鈕一樣，切換模式時右下角不會突然少掉按鈕（設定「切換到 Markdown／閱讀模式時保留狀態列」可以關掉）
import { setIcon } from 'obsidian';
import { t, key } from './i18n.js';
import { attachHint } from './hints.js';
import { countText, docText, docStats } from './textstats.js';
import { WordCountModal, wordCountRows } from './dialogs.js';
import { openMarkdownPeek } from './mdbar.js';
import type { MarkdownView } from 'obsidian';
import type { TextStats } from './textstats.js';
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
}

export interface StatusBarParts {
  count: HTMLDivElement;
  status: HTMLDivElement;
  range: HTMLInputElement;
  zoomLabel: HTMLButtonElement;
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
  const parts = { count, status, range, zoomLabel, views: buttons };
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

// 字數：有選取時顯示「已選取 a／b 字」；提示裡是預估閱讀時間
export function renderCount(box: HTMLElement, all: TextStats, sel: TextStats | null): void {
  const fmt = (n: number) => n.toLocaleString();
  if (sel) box.setText(t('已選取 {a}／{b} 字', { a: fmt(sel.words), b: fmt(all.words) }));
  else box.setText(t('{a} 字・{b} 個字元', { a: fmt(all.words), b: fmt(all.chars) }));
  // 閱讀時間：中文每分鐘 400 字、英文每分鐘 200 個單字（與「字數統計」視窗相同）
  const minutes = Math.max(1, Math.round(all.cjk / 400 + all.latin / 200));
  box.setAttribute('aria-label', t('預估閱讀時間') + t('：') + t('{n} 分鐘', { n: minutes }) + ' · ' + t('中文字以字計、英文以單字計（點一下看詳細統計）'));
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
  declare dirty: boolean;
  // 讀檔案是非同步的：只採用最後一次的結果
  declare seq: number;
  // 上次畫出來的存檔狀態（狀態＋修改時間）
  declare stamp: string;

  constructor(plugin: WordModePlugin, el: HTMLElement, view: MarkdownView) {
    this.plugin = plugin; this.view = view; this.el = el;
    this.mode = view.getMode && view.getMode() === 'preview' ? 'preview' : 'source';
    this.text = null; this.sel = ''; this.dirty = false; this.seq = 0; this.stamp = '';
    this.all = countText('');
    const S = plugin.settings;
    el.empty();
    this.parts = buildStatusBar(el, {
      mode: this.mode, inStatusBar: true, richHints: !!S.richHints, modE: S.ctrlE !== false ? 'word' : null, zoomable: false,
      zoom: () => S.zoom || 100, setZoom: () => { /* Markdown／閱讀模式不能縮放 */ },
      onCount: () => this.openWordCount(),
      onMode: m => { if (m === 'word') void plugin.switchToWord(view.leaf); else void plugin.setMarkdownMode(view, m); },
      onProps: b => openMarkdownPeek(plugin, view, b),
    });
    this.update();
  }

  // 定時呼叫（main.ts）：內容或選取有變才重算字數，再確認存檔狀態
  update(): void {
    let text = '';
    try { text = this.view.getViewData(); } catch { /* 檢視還沒載入完成 */ }
    const sel = this.mode === 'source' && this.view.editor ? this.view.editor.getSelection() : '';
    if (text !== this.text || sel !== this.sel) {
      if (text !== this.text) this.all = this.countMarkdown(text);
      this.text = text; this.sel = sel;
      renderCount(this.parts.count, this.all, sel ? this.countMarkdown(sel, true) : null);
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

  // fragment：選取的一段（不切文件屬性與區塊）
  countMarkdown(text: string, fragment = false): TextStats {
    if (text.length > PARSE_LIMIT) return countText(text);
    try {
      const c = this.plugin.converter;
      return countText(docText(fragment ? c.parseFragment(text) : c.parse(text).doc));
    } catch { return countText(text); }
  }

  openWordCount(): void {
    const c = this.plugin.converter;
    let text = '';
    try { text = this.view.getViewData(); } catch { return; }
    try {
      const sel = this.mode === 'source' && this.view.editor ? this.view.editor.getSelection() : '';
      new WordCountModal(this.plugin.app, wordCountRows(docStats(c.parse(text).doc), sel ? docStats(c.parseFragment(sel)) : null)).open();
    } catch (e) { console.error('[Word 模式] 無法統計字數', e); }
  }
}
