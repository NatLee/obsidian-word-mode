// Obsidian 檢視：以 Word 方式編輯 Markdown 筆記
import {
  TextFileView, Notice, Menu, MarkdownRenderer,
  setIcon, normalizePath, TFile, TFolder, Vault, Platform, Scope, parseYaml, stringifyYaml,
  Component, MarkdownPreviewRenderer, loadMermaid,
} from 'obsidian';
import { EditorView } from 'prosemirror-view';
import { loadPrism } from 'obsidian';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import { linkContext, isExternal, isUrl } from './links.js';
import { iconOr } from './icons.js';
import { openContextMenu } from './contextmenu.js';
import { renderMathInto } from './mathrender.js';
import type { IconFn } from './icons.js';
import { bubblePlugin } from './bubble.js';
import { parseWidth, imageAttrsWithWidth } from './nodeviews.js';
import { findPlugin, FindBar } from './find.js';
import { foldPlugin } from './fold.js';
import { stripSliceBids, stripBids, clipboardTable, tableFromRows, fillTable, looksLikeMarkdown } from './paste.js';
import { Slice, Fragment } from 'prosemirror-model';
import { schema, IMAGE_EXT } from './schema.js';
import { createEditorState, restoreEditorState } from './editor.js';
import { createNodeViews } from './nodeviews.js';
import { Toolbar } from './toolbar.js';
import * as C from './commands.js';
import { marksPlugin, marksKey, marksOn, scanWeird } from './marks.js';
import { codePlugin, codeKey, codeActivePlugin } from './codehl.js';
import { MermaidModal } from './mermaid.js';
import { DIAGRAM_KINDS } from './diagrams.js';
import { saveTemplate } from './templates.js';
import { footnotes, footnoteBody, insertFootnote, setFootnoteBody } from './footnotes.js';
import { renderEmbed, mediaKind } from './embeds.js';
import { foldKey } from './fold.js';
import { suggestPlugin } from './suggest.js';
import { suggestContext } from './complete.js';
import { SourceModal, PromptModal, LinkDialog, FilePicker, ShortcutModal, EquationModal, CleanupModal, WordCountModal, wordCountRows } from './dialogs.js';
import { countText, docText, docStats } from './textstats.js';
import { buildStatusBar, renderSaveStatus, renderCount, showZoom } from './statusbar.js';
import { openPropsPeek, propertyWidget, fillPropsPeek, fillPinSummary, markOverflow } from './propview.js';
import { isRtl } from './dom.js';
import { frontmatterBody, peekData } from './props.js';
import { t, key, withKey } from './i18n.js';
import type { Modifier, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import type { Command, EditorState, Plugin, Transaction } from 'prosemirror-state';
import type { Attrs, Node as PMNode } from 'prosemirror-model';
import type { DecorationSet } from 'prosemirror-view';
import type WordModePlugin from './main.js';
import type { PasteMode, ClipKind } from './toolbar.js';
import type { NodeViewContext, NodeViewMenuItem, FrontmatterDom } from './nodeviews.js';
import type { BubbleContext, LinkDescription } from './bubble.js';
import type { FoldState } from './fold.js';
import type { LinkContext } from './links.js';
import type { LinkDialogInit, LinkDialogResult, MathRenderer, EquationInit } from './dialogs.js';
import type { SaveStatus } from './statusbar.js';
import type { PropsPeekData } from './props.js';
import type { FrontmatterAttrs } from './schema.js';
import type { SuggestTrigger } from './suggest.js';
import type { EmbedHandle } from './embeds.js';
import type { DocMeta, ParseResult } from './markdown.js';
import type { PrismLike } from './codehl.js';
import type { MarksState, WeirdKindId } from './marks.js';
import type { TextRange } from './commands.js';
import type { TemplatesInstance } from './obsidian-internal.js';

export const VIEW_TYPE = 'natlee-word-mode';

// 存檔狀態（下方狀態列顯示）：saved 已儲存、dirty 編輯中、saving 儲存中、conflict 同步衝突
export type { SaveStatus } from './statusbar.js';

// 文件屬性區塊的外觀（設定）：區塊＝框線加底色、只有框線、簡潔＝沒有框線
export type PropsStyle = 'card' | 'outline' | 'plain';

// 方程式節點的位置與內容（display 為 true 表示獨立一行 $$…$$）
export interface MathTarget { pos: number; src: string; display: boolean; }
// mathAt() 找到的方程式：另外帶著節點本身
export interface MathInfo extends MathTarget { node: PMNode; }

// buildLink() 的結果：依保管庫的設定是 [[Wiki 連結]] 或 [Markdown 連結](路徑)
export type BuiltLink =
  | { wiki: true; target: string; alias: string | null }
  | { wiki: false; text: string; href: string };

// 插入圖片時給的屬性（schema 的 image 節點）；用 type 而不是 interface，才能直接當成 Attrs 傳給 ProseMirror
export type NewImageAttrs = { src: string; alt?: string | null; wiki: boolean };

// 貼上純文字 Markdown 後顯示的「貼上選項」小視窗，以及貼上的範圍
export interface PasteChip { el: HTMLDivElement; from: number; to: number; }

// 同步衝突正在等使用者選擇。busy 是已經按了其中一個選項、還在處理（另存副本、讀檔），這時再按一次不重複執行
export interface ConflictState { busy: boolean; }

// setEphemeralState() 收到的狀態：line 原文行號（大綱、反向連結）、match 搜尋結果的字元位置、subpath 是 #標題 或 #^區塊
export interface EphemeralState {
  line?: unknown;
  match?: { matches?: [from: number, to: number][] } | null;
  subpath?: string;
}

// 滑鼠事件的 target 一定是元素（不會是文字節點），宣告成 Element 才能直接呼叫 closest()
export type ElementEvent<E extends Event = MouseEvent> = E & { readonly target: Element };

// nodeDOM() 可能是文字節點（沒有 closest），mathAt() 先檢查再呼叫
type MaybeElement = Node & Partial<Pick<Element, 'closest'>>;

// 核心外掛「範本」的設定：obsidian-internal.d.ts 只宣告了 folder，這裡另外用到日期、時間格式
type TemplateOptions = NonNullable<TemplatesInstance['options']> & { dateFormat?: string; timeFormat?: string };

// 捕捉到的錯誤：通常是 Error；mermaid 的解析錯誤把訊息放在 str
interface CaughtError { message?: string; str?: string; }

// 節點屬性的型別（對應 schema.ts 各節點的 attrs；ProseMirror 的 node.attrs 本身是 any）。
// nodeviews.ts 也匯出同樣形狀的介面，之後可以改成共用
// width：寬度（像素數字的字串）；wiki：是否為 ![[圖片]] 寫法
interface ImageAttrs { readonly src: string; readonly alt: string | null; readonly title: string | null; readonly wiki: boolean; readonly width: string | null; }
interface WikilinkAttrs { readonly target: string; readonly alias: string | null; readonly embed: boolean; }
// kind：raw、math、footnote 等；bid 是原文區塊編號，新建立的區塊是 null
interface RawBlockAttrs { readonly src: string; readonly kind: string; readonly bid: number | null; }
interface RawInlineAttrs { readonly src: string; }

// Obsidian 載入的 mermaid（loadMermaid() 在型別定義裡是 any）：這裡只用到 parse()，語法錯誤時會丟出例外
interface MermaidLike { parse?(text: string): Promise<unknown>; }

// ------------------------------------------------------------------ 檢視

// 欄位說明（類別裡不能寫註解，寫在這裡）：
// - pm：ProseMirror 編輯器；還沒載入筆記（第一次 setViewData 之前）與關閉後是 null
// - meta：parse() 回傳的原文區塊資訊，存檔時交給 serialize()；還沒載入筆記時是 null
// - lastOut：最後一次載入或輸出的 Markdown 原文；outDoc 是輸出 lastOut 時的文件，文件沒變就不用再轉換一次
// - editRev／savedRev：每改一次文件 editRev 加一；確定寫進檔案之後，savedRev 記下寫的是第幾版。
//   兩個不一樣就是有還沒存檔的修改（unsaved）。不能用「getViewData() 被呼叫過」來判斷：Obsidian 在存檔之外
//   也會呼叫它（檔案在外面被改、要合併的時候），而且寫檔可能失敗
// - toolbarHost、findHost、bannerHost、scroller、page、toolbar、findBar、bubble、fold：在 onOpen() 建立，
//   之後一直存在，所以不標成可省略
// - countEl、statusBox、zoomRange、zoomLabel：下方狀態列（buildBottomBar）建立的元素；
//   還沒建立狀態列時都不存在
// - marks、code、suggest：第一次 editorPlugins() 時才建立
// - prism：Obsidian 的 Prism（非同步載入，載入前不存在）
// - propsOpen：文件屬性區塊是否展開；還沒設定過時是 undefined（視為展開）
// - plainPasteNext：下一次貼上只貼純文字（Ctrl+Shift+V、功能區的「只貼上文字」）
// - pendingEState：編輯器還沒建立時收到的 setEphemeralState()，載入後再處理
// - countTimer：延遲更新字數的計時器
// setEphemeralState() 先檢查父類別有沒有這個方法：型別定義裡它一定存在，TypeScript 會把這個檢查當成錯誤，
// 所以在檢查的地方把它轉型成「可能是 undefined」（執行結果不變）
export class WordModeView extends TextFileView {
  declare plugin: WordModePlugin;
  declare pm: EditorView | null;
  declare meta: DocMeta | null;
  declare lastOut: string;
  declare changed: boolean;
  declare outDoc: PMNode | null;
  declare editRev: number;
  declare savedRev: number;
  declare status: SaveStatus;
  declare savedAt: Date | undefined;
  declare conflict: ConflictState | null | undefined;
  declare toolbarHost: HTMLDivElement;
  declare findHost: HTMLDivElement;
  declare bannerHost: HTMLDivElement;
  // 文件屬性固定在上方（設定）：捲動區上方的屬性列。pinHost 在 onOpen 建立；pin 第一次需要時才建立；
  // pinNode 是屬性列目前顯示的文件屬性節點（節點沒變就不重畫）
  declare pinHost: HTMLDivElement;
  declare pin: HTMLDivElement | null;
  declare pinNode: PMNode | null;
  declare scroller: HTMLDivElement;
  declare page: HTMLDivElement;
  declare toolbar: Toolbar;
  declare findBar: FindBar;
  declare bubble: Plugin;
  declare fold: Plugin<FoldState>;
  declare prism: PrismLike | undefined;
  declare countEl: HTMLDivElement | undefined;
  declare statusBox: HTMLDivElement | undefined;
  declare zoomRange: HTMLInputElement | undefined;
  declare zoomLabel: HTMLButtonElement | undefined;
  declare marks: Plugin<MarksState> | undefined;
  declare code: Plugin<DecorationSet> | undefined;
  declare suggest: Plugin<SuggestTrigger | null> | undefined;
  declare propsOpen: boolean | undefined;
  declare plainPasteNext: boolean | undefined;
  declare pendingEState: EphemeralState | null | undefined;
  declare pasteChip: PasteChip | null | undefined;
  declare countTimer: number | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: WordModePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.pm = null;
    this.meta = null;
    this.lastOut = '';
    this.changed = false;   // 載入後是否修改過（決定是否要重新輸出）
    this.outDoc = null;
    this.editRev = 0;
    this.savedRev = 0;
  }

  // 有還沒寫進檔案的修改
  get unsaved(): boolean { return this.editRev !== this.savedRev; }

  getViewType(): string { return VIEW_TYPE; }
  getIcon(): string { return 'file-text'; }
  getDisplayText(): string { return this.file ? this.file.basename : t('Word 模式'); }
  canAcceptExtension(ext: string): boolean { return ext === 'md'; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('wm-view');
    this.contentEl.toggleClass('wm-mobile', !!Platform.isMobile);
    this.contentEl.toggleClass('wm-phone', !!Platform.isPhone);
    this.contentEl.toggleClass('wm-full-width', !!this.plugin.settings.fullWidth);
    this.toolbarHost = this.contentEl.createDiv('wm-toolbar-host');
    this.findHost = this.contentEl.createDiv('wm-findbar-host');
    this.bannerHost = this.contentEl.createDiv('wm-banner-host');
    this.pinHost = this.contentEl.createDiv('wm-pin-host');
    this.pin = null; this.pinNode = null;
    this.scroller = this.contentEl.createDiv('wm-scroller');
    this.page = this.scroller.createDiv('wm-page');
    this.buildToolbar();
    this.findBar = new FindBar(this.findHost, { getView: () => this.pm, icon: iconOr, onChange: () => this.toolbar && this.toolbar.refresh() });
    this.bubble = bubblePlugin(this.bubbleContext());
    this.fold = foldPlugin({ icon: iconOr });
    Promise.resolve(loadPrism()).then((P: PrismLike) => {
      this.prism = P;
      if (this.pm) this.pm.dispatch(this.pm.state.tr.setMeta(codeKey, true));
    }).catch(() => { /* 沒有 Prism 就不上色 */ });
    this.status = 'saved';
    // 手機沒有 Obsidian 狀態列：在畫面下方放自己的狀態列；桌機則整合進 Obsidian 右下角的狀態列
    if (Platform.isMobile) this.buildBottomBar(this.contentEl.createDiv('wm-bottombar'), false);
    this.applyZoom();
    this.applyPropsLook();
    this.applyPropsSticky();
    this.registerDomEvent(this.scroller, 'scroll', () => this.updatePin(), { passive: true });
    // 屬性列展開時，點屬性列以外的地方就收起來
    this.registerDomEvent(this.contentEl.ownerDocument, 'pointerdown', e => { if (this.pin && this.pin.classList.contains('is-open') && !this.pin.contains(e.target as Node | null)) this.closePin(); }, true);
    // 側邊欄開關、視窗改變大小時，屬性列跟著頁面的寬度
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => { if (this.pin && this.pin.classList.contains('is-shown')) this.updatePin(); });
      ro.observe(this.scroller);
      this.register(() => ro.disconnect());
    }
    this.registerDomEvent(this.scroller, 'wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.plugin.setZoom(this.plugin.settings.zoom + (e.deltaY < 0 ? 10 : -10));
    }, { passive: false });

    // 快速鍵放在這個畫面的 scope，才不會被 Obsidian 的全域快速鍵搶走（例如 Ctrl+K、Ctrl+E）
    this.scope = new Scope(this.app.scope);
    const inEditor = () => this.pm && this.pm.hasFocus();
    const reg = (mods: Modifier[], key: string, fn: (evt: KeyboardEvent) => void, onlyEditor?: boolean) => this.scope!.register(mods, key, evt => {
      if (!this.pm || (onlyEditor && !inEditor())) return true;
      fn(evt);
      return false;
    });
    const cmd = (c: Command) => () => { c(this.pm!.state, tr => this.pm!.dispatch(tr), this.pm!); };
    reg(['Mod'], 'k', () => this.openLinkDialog());
    reg(['Mod'], 'f', () => this.findBar.open(false));
    reg(['Mod'], 'h', () => this.findBar.open(true));
    reg(['Mod'], 'e', () => { void this.plugin.switchToMarkdown(this.leaf); });
    reg(['Mod'], '/', () => new ShortcutModal(this.app, this.plugin).open());
    reg(['Mod'], 's', () => { void this.save(); });
    reg(['Mod'], 'b', cmd(C.toggleBold), true);
    reg(['Mod'], 'i', cmd(C.toggleItalic), true);
    reg(['Mod'], 'u', cmd(C.toggleUnderline), true);
    reg(['Mod'], 'l', cmd(C.setAlign('left')), true);
    reg(['Mod'], 'j', cmd(C.setAlign('justify')), true);
    reg(['Mod'], '`', cmd(C.toggleCode), true);
    reg(['Mod', 'Shift'], 'h', cmd(C.toggleHighlight), true);
    reg(['Mod', 'Shift'], 'x', cmd(C.toggleStrike), true);
    this.addAction('code-2', withKey('切換到 Markdown 編輯', 'Mod+E'), () => this.plugin.switchToMarkdown(this.leaf));
  }

  // 建立（或依設定重建）上方功能區
  buildToolbar(): void {
    if (this.toolbar) { this.toolbar.destroy(); this.toolbarHost.empty(); }
    const S = this.plugin.settings;
    this.contentEl.toggleClass('wm-no-labels', S.buttonStyle === 'icon');
    const pos = S.toolbarPosition || 'auto';
    this.contentEl.toggleClass('wm-toolbar-bottom', pos === 'bottom' || (pos === 'auto' && !!Platform.isPhone));
    this.toolbar = new Toolbar(this.toolbarHost, {
      getView: () => this.pm,
      icon: iconOr,
      isMobile: !!Platform.isMobile,
      settings: S,
      initialTab: this.plugin.lastTab || 'home',
      onTab: id => { this.plugin.lastTab = id; },
      isFullWidth: () => !!this.plugin.settings.fullWidth,
      findState: () => ({ open: !!(this.findBar && this.findBar.isOpen), replace: !!(this.findBar && this.findBar.replacing) }),
      outlineOpen: () => this.plugin.outlineOpen(),
      rememberColor: (kind, c, custom) => {
        const P = this.plugin.settings;
        // 自訂色彩另外記進「最近使用」（最新的在前，不重複）
        const recent = (list: readonly string[] | undefined, max: number) => [c!, ...(list || []).filter(x => x.toLowerCase() !== c!.toLowerCase())].slice(0, max);
        if (kind === 'font') {
          if (c) P.lastFontColor = c;
          if (c && custom) P.recentFontColors = recent(P.recentFontColors, 10);
        } else {
          P.lastHighlight = c || '';
          if (c && custom) P.recentHighlights = recent(P.recentHighlights, 8);
        }
        void this.plugin.saveSettings();
      },
      formatDate: f => (window.moment ? window.moment().format(f) : new Date().toLocaleString()),
      dialogs: {
        link: () => this.openLinkDialog(),
        noteLink: () => this.openNoteLinkPicker(),
        image: b => this.openImageMenu(b),
        template: () => this.openTemplatePicker(),
        markdown: () => { void this.plugin.switchToMarkdown(this.leaf); },
        reading: () => { void this.plugin.switchToMarkdown(this.leaf, 'preview'); },
        // 按一次開啟、再按一次關閉
        find: () => { const f = this.findBar; if (f.isOpen && !f.replacing) f.close(); else { f.open(false); f.showReplace(false); } },
        replace: () => { const f = this.findBar; if (f.isOpen && f.replacing) f.close(); else f.open(true); },
        callout: b => this.openCalloutMenu(b),
        shortcuts: () => new ShortcutModal(this.app, this.plugin).open(),
        equation: () => this.openEquation(),
        mermaid: () => this.openMermaid(),
        footnote: () => this.insertFootnoteDialog(),
        scrollTo: pos => this.scrollToPos(pos),
        paste: mode => { void this.pasteFromClipboard(mode); },
        clip: kind => this.clipboardAction(kind),
        toggleMarks: () => { if (this.pm) this.setMarks(!marksOn(this.pm.state)); },
        cleanup: () => { if (this.pm) new CleanupModal(this.app, this).open(); },
        wordCount: () => this.openWordCount(),
        comment: () => this.insertComment(),
        foldAll: fold => this.foldAll(fold),
        outline: b => { if (this.plugin.settings.outlinePlace === 'popup') this.toolbar.openOutlinePopup(b); else void this.plugin.toggleOutline(); },
        toggleFullWidth: () => { void this.plugin.setFullWidth(!this.plugin.settings.fullWidth); },
        zoom: d => { this.plugin.setZoom(d === 0 ? 100 : (this.plugin.settings.zoom || 100) + d); },
        settings: () => this.plugin.openSettings(),
        properties: () => this.openProperties(),
        peekProperties: b => this.peekProperties(b),
        notice: msg => new Notice(msg),
      },
    });
    if (this.pm) this.toolbar.update(this.pm.state);
  }

  async onClose(): Promise<void> {
    this.plugin.updateStatus(null);
    if (this.toolbar) this.toolbar.destroy();
    if (this.pm) { this.pm.destroy(); this.pm = null; }
  }

  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem(i => i.setTitle(withKey('切換到 Markdown 編輯', 'Mod+E')).setIcon('code-2').setSection('pane').onClick(() => this.plugin.switchToMarkdown(this.leaf)));
    super.onPaneMenu(menu, source);
  }

  // ---------------------------------------------------------- 資料進出

  setViewData(data: string, clear: boolean): void {
    if (!clear && this.pm && data === this.lastOut) return;
    // clear 為 false 表示同一份筆記在磁碟上被改了（同步、其他裝置、其他外掛）。Obsidian 自己監聽檔案變動，
    // 有還沒自動存檔的修改時會先合併再交給這裡，所以 data 可能是合併過的內容，不一定是磁碟上的原文。
    // 這裡還有沒存檔的修改時不能直接蓋掉，改走同步衝突的流程（新版本到使用者選的時候再從磁碟讀）
    if (!clear && this.pm && (this.unsaved || this.conflict)) { this.showConflict(); return; }
    this.loadDoc(data, clear);
  }

  getViewData(): string {
    if (!this.pm || !this.changed) return this.lastOut;
    const doc = this.pm.state.doc;
    // Obsidian 存檔與合併時會連續呼叫好幾次；文件沒變就用上一次的結果
    if (doc === this.outDoc) return this.lastOut;
    try {
      const out = this.plugin.converter.serialize(doc, this.meta!);
      this.lastOut = out;
      this.outDoc = doc;
      return out;
    } catch (e) {
      console.error('[Word 模式] 輸出 Markdown 失敗', e);
      new Notice(t('Word 模式：存檔時轉換失敗，已保留原本內容。請改用 Markdown 編輯。'));
      return this.lastOut;
    }
  }

  clear(): void {
    this.changed = false;
    this.savedRev = this.editRev;
    this.hideConflict();
  }

  // ---------------------------------------------------------- 存檔狀態

  setStatus(s: SaveStatus): void {
    this.status = s;
    this.savedAt = s === 'saved' ? new Date() : this.savedAt;
    this.plugin.updateStatus(this);
    this.renderStatus();
  }

  // ---------------------------------------------------------- 下方狀態列（像 Word：字數、存檔、檢視、縮放）

  buildBottomBar(bar: HTMLElement, inStatusBar: boolean): void {
    // 字數：手機在筆記下方的列，桌機在 Obsidian 的狀態列（Obsidian 內建的字數只算 Markdown 編輯器）
    const parts = buildStatusBar(bar, {
      mode: 'word', inStatusBar, richHints: !!this.plugin.settings.richHints && !Platform.isMobile, modE: 'source', zoomable: true,
      zoom: () => this.plugin.settings.zoom || 100,
      setZoom: z => { this.plugin.setZoom(z); },
      onCount: () => this.openWordCount(),
      onMode: m => { void this.plugin.switchToMarkdown(this.leaf, m === 'preview' ? 'preview' : undefined); },
      onProps: b => this.peekProperties(b),
    });
    this.countEl = parts.count;
    this.statusBox = parts.status;
    this.zoomRange = parts.range;
    this.zoomLabel = parts.zoomLabel;
    this.renderStatus();
    this.applyZoom();
    this.updateCount();
  }

  // ---------------------------------------------------------- 文件屬性固定在上方（設定）
  // 文件屬性本身照常跟著文件捲動（版面不會變）；捲出畫面之後，捲動區上方浮出一條精簡的屬性列，
  // 一行列出每個屬性，點一下展開完整清單（屬性很多時可以篩選、在框內捲動）

  // 文件屬性的外觀（設定）：用 class 切換，樣式都在 CSS；不認得的值當成預設的「區塊」
  applyPropsLook(): void {
    const S = this.plugin.settings;
    this.contentEl.toggleClass('wm-props-style-outline', S.propsStyle === 'outline');
    this.contentEl.toggleClass('wm-props-style-plain', S.propsStyle === 'plain');
    this.contentEl.toggleClass('wm-pin-nolabels', S.pinLabels === false);
  }

  applyPropsSticky(): void {
    if (!this.plugin.settings.propsSticky) this.hidePin();
    this.updatePin();
    // 文件屬性標題列的圖釘按鈕跟著設定變（設定頁、另一個分頁的圖釘改的也一樣）
    const fm = this.propsNode();
    const dom = fm && fm.dom as FrontmatterDom;
    if (dom && dom.wmRefresh) dom.wmRefresh();
  }

  // 文件最前面的文件屬性節點與它的畫面；沒有時是 null
  propsNode(): { node: PMNode; dom: HTMLElement } | null {
    const first = this.pm && this.pm.state.doc.firstChild;
    if (!first || first.type !== schema.nodes.frontmatter) return null;
    const dom = this.pm!.nodeDOM(0) as HTMLElement | null;
    return dom ? { node: first, dom } : null;
  }

  // 捲動、文件改變時呼叫：文件屬性捲出畫面就顯示屬性列，屬性有變才重畫
  updatePin(): void {
    const fm = this.plugin.settings.propsSticky ? this.propsNode() : null;
    const box = this.scroller.getBoundingClientRect();
    // 文件屬性的下緣捲到屬性列的位置（上緣往下 40px）才出現，兩者不會疊在一起
    if (!fm || this.scroller.scrollTop <= 0 || fm.dom.getBoundingClientRect().bottom >= box.top + 40) { this.hidePin(); return; }
    const pin = this.ensurePin();
    if (fm.node !== this.pinNode) { this.pinNode = fm.node; this.renderPin(); }
    // 跟頁面的文字同寬（頁面縮放、全寬、捲軸都算進去）
    const r = this.pm!.dom.getBoundingClientRect();
    const host = this.pinHost.getBoundingClientRect();
    if (r.width) { pin.style.left = (r.left - host.left) + 'px'; pin.style.width = r.width + 'px'; }
    pin.classList.add('is-shown');
  }

  ensurePin(): HTMLDivElement {
    if (this.pin) return this.pin;
    const pin = this.pin = this.pinHost.createDiv('wm-pin');
    const bar = pin.createDiv('wm-pin-bar');
    bar.setAttribute('role', 'button');
    bar.tabIndex = 0;
    bar.setAttribute('aria-expanded', 'false');
    setIcon(bar.createSpan('wm-pin-icon'), 'clipboard-list');
    bar.createDiv('wm-pin-items');
    bar.createSpan('wm-pin-count');
    setIcon(bar.createSpan('wm-pin-chev'), 'chevron-down');
    pin.createDiv('wm-pin-card wm-peek');
    // 點屬性列不搶走編輯區的游標
    bar.addEventListener('mousedown', e => e.preventDefault());
    bar.addEventListener('click', () => this.togglePin());
    bar.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.togglePin(); } });
    pin.addEventListener('keydown', e => { if (e.key === 'Escape' && pin.classList.contains('is-open')) { e.preventDefault(); this.closePin(); if (this.pm) this.pm.focus(); } });
    return pin;
  }

  pinOptions(): { icon: IconFn; typeHint: (k: string) => string | null } {
    return {
      icon: iconOr,
      typeHint: k => propertyWidget(this.app, k),
    };
  }

  renderPin(): void {
    const pin = this.pin;
    if (!pin) return;
    const data = this.propsPeekData();
    fillPinSummary(pin.querySelector<HTMLElement>('.wm-pin-items')!, data, this.pinOptions());
    const n = data.kind === 'props' ? Object.keys(data.values).length : 0;
    pin.querySelector<HTMLElement>('.wm-pin-count')!.setText(n ? t('{n} 個屬性', { n }) : '');
    pin.querySelector('.wm-pin-bar')!.setAttribute('aria-label', t('文件屬性') + (n ? t('：') + t('{n} 個屬性', { n }) : ''));
    if (pin.classList.contains('is-open')) this.fillPinCard();
  }

  fillPinCard(): void {
    const card = this.pin!.querySelector<HTMLElement>('.wm-pin-card')!;
    fillPropsPeek(card, this.propsPeekData(), Object.assign(this.pinOptions(), {
      bare: true, isMobile: !!Platform.isMobile, go: () => { this.closePin(); this.openProperties(); },
    }));
    markOverflow(card);
  }

  togglePin(): void {
    const pin = this.pin;
    if (!pin) return;
    const open = !pin.classList.contains('is-open');
    pin.classList.toggle('is-open', open);
    pin.querySelector('.wm-pin-bar')!.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) this.fillPinCard(); else pin.querySelector<HTMLElement>('.wm-pin-card')!.empty();
  }

  closePin(): void { if (this.pin && this.pin.classList.contains('is-open')) this.togglePin(); }

  hidePin(): void {
    if (!this.pin) return;
    this.closePin();
    this.pin.classList.remove('is-shown');
  }

  // 編輯器要把游標捲進畫面時：游標被上方的屬性列蓋住，就多往上捲一點讓它露出來。
  // ProseMirror 只知道捲動區的上緣，不知道上面有東西蓋著；回傳 false 交給 ProseMirror 原本的捲動
  scrollPastProps(v: EditorView): boolean {
    const pin = this.pin && this.pin.classList.contains('is-shown') ? this.pin : null;
    if (!pin) return false;
    let caret: { top: number; bottom: number };
    try { caret = v.coordsAtPos(v.state.selection.head); } catch { return false; }
    const box = this.scroller.getBoundingClientRect();
    // 檢視沒有顯示出來（量不到大小），或游標在畫面下方以外：照原本的方式捲
    if (!box.height || caret.bottom > box.bottom) return false;
    // 游標在畫面上方以外時，ProseMirror 會把它捲到最上緣（剛好被蓋住），所以一起處理
    const cover = Math.max(box.top, pin.getBoundingClientRect().bottom);
    if (caret.top >= cover + 4) return false;
    this.scroller.scrollTop -= cover + 8 - caret.top;
    return true;
  }

  applyZoom(): void {
    const z = this.plugin.settings.zoom || 100;
    if (this.page) this.page.style.zoom = String(z / 100);
    if (this.zoomRange && this.zoomLabel) showZoom({ range: this.zoomRange, zoomLabel: this.zoomLabel }, z);
  }

  renderStatus(): void {
    if (this.statusBox) renderSaveStatus(this.statusBox, this.status, this.savedAt);
  }

  updateCount(): void {
    if (!this.pm || !this.countEl) return;
    const st = this.pm.state;
    const all = countText(docText(st.doc));
    renderCount(this.countEl, all, st.selection.empty ? null : countText(docText(st.doc, st.selection.from, st.selection.to)));
  }

  // ---------------------------------------------------------- 編輯器外掛

  editorPlugins(): Plugin[] {
    if (!this.marks) this.marks = marksPlugin({ on: !!this.plugin.settings.showMarks, always: this.plugin.settings.highlightWeird !== false });
    if (!this.code) this.code = codePlugin(() => this.prism);
    if (!this.suggest) this.suggest = suggestPlugin(suggestContext(this, iconOr));
    return [this.suggest, this.bubble, findPlugin, this.fold, this.marks, this.code, codeActivePlugin];
  }

  setMarks(on: boolean): void {
    if (!this.pm) return;
    this.pm.dispatch(this.pm.state.tr.setMeta(marksKey, { on }));
    this.pm.focus();
  }

  jumpToWeird(kind: WeirdKindId): void {
    const f = scanWeird(this.pm!.state.doc).find(x => x.kind === kind);
    if (!f) return;
    const st = this.pm!.state;
    this.pm!.dispatch(st.tr.setMeta(marksKey, { on: true }).setSelection(TextSelection.create(st.doc, f.from, f.to)).scrollIntoView());
    this.pm!.focus();
  }

  foldAll(fold: boolean): void {
    if (!this.pm) return;
    this.pm.dispatch(this.pm.state.tr.setMeta(foldKey, fold ? { all: true } : { clear: true }));
    this.pm.focus();
  }

  // ---------------------------------------------------------- 剪貼簿（功能區的貼上／剪下／複製）

  async pasteFromClipboard(mode: PasteMode): Promise<void> {
    const v = this.pm;
    if (!v) return;
    v.focus();
    let text = ''; let html = ''; let image: File | null = null;
    try {
      if (navigator.clipboard.read) {
        for (const it of await navigator.clipboard.read()) {
          if (!html && it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
          if (!text && it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
          const img = it.types.find(x => /^image\//.test(x));
          if (!image && img) image = new File([await it.getType(img)], 'Pasted image.' + img.split('/')[1].replace('jpeg', 'jpg'), { type: img });
        }
      } else text = await navigator.clipboard.readText();
    } catch {
      try { text = await navigator.clipboard.readText(); } catch {
        new Notice(t('無法讀取剪貼簿，請直接按 {k} 貼上', { k: key('Mod+V') }));
        return;
      }
    }
    if (mode === 'markdown') {
      if (!text) return;
      const frag = stripBids(this.plugin.converter.parseFragment(text).content);
      v.dispatch(v.state.tr.replaceSelection(new Slice(frag, 0, 0)).scrollIntoView());
      return;
    }
    if (image && !text && !html) { void this.insertUploadedImages([image]); return; }
    let ev: ClipboardEvent | undefined;
    try {
      const dt = new DataTransfer();
      if (text) dt.setData('text/plain', text);
      if (html && mode !== 'text') dt.setData('text/html', html);
      ev = new ClipboardEvent('paste', { clipboardData: dt });
    } catch { ev = undefined; }
    if (mode === 'text') { this.plainPasteNext = true; v.pasteText(text, ev); this.plainPasteNext = false; }
    else if (html) v.pasteHTML(html, ev);
    else if (text) v.pasteText(text, ev);
  }

  clipboardAction(kind: ClipKind): void {
    if (!this.pm) return;
    const pm = this.pm;
    pm.focus();
    const { doc, selection } = pm.state;
    let ok = false;
    try {
      if (!selection.empty && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        // 跟鍵盤的剪下／複製一樣，同時放格式（HTML）與純文字
        const { dom, text } = pm.serializeForClipboard(selection.content());
        const item = new ClipboardItem({ 'text/html': new Blob([dom.innerHTML], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) });
        void navigator.clipboard.write([item]).then(
          // 寫入期間文件沒有變動才刪除選取的內容
          () => { if (kind === 'cut' && pm.state.doc === doc) pm.dispatch(pm.state.tr.delete(selection.from, selection.to).scrollIntoView()); },
          () => this.clipboardFailed(kind),
        );
        ok = true;
      }
    } catch { ok = false; }
    // 外層 t() 收到的是已經翻譯過的文字，不一定是鍵；找不到時 t() 原樣回傳，只負責代入 {k}
    if (!ok) this.clipboardFailed(kind);
  }

  clipboardFailed(kind: ClipKind): void {
    new Notice(t(kind === 'cut' ? '請按 {k} 剪下' : '請按 {k} 複製', { k: key(kind === 'cut' ? 'Mod+X' : 'Mod+C') }));
  }

  // ---------------------------------------------------------- 字數統計與註解

  openWordCount(): void {
    if (!this.pm) return;
    const st = this.pm.state;
    new WordCountModal(this.app, wordCountRows(docStats(st.doc), st.selection.empty ? null : docStats(st.doc, st.selection.from, st.selection.to))).open();
  }

  insertComment(): void {
    if (!this.pm || this.blockedInCode()) return;
    const st = this.pm.state;
    const selected = st.selection.empty ? '' : st.doc.textBetween(st.selection.from, st.selection.to, ' ');
    new PromptModal(this.app, t('插入註解'), '', t('註解內容（只在編輯時看得到，閱讀模式不顯示）'), value => {
      const text = String(value || '').replace(/%%/g, '%').trim();
      if (!text) return;
      const node = schema.nodes.raw_inline.create({ src: '%%' + text + '%%' });
      const s2 = this.pm!.state;
      const at = selected ? s2.selection.to : s2.selection.from;
      this.pm!.dispatch(s2.tr.insert(at, node).scrollIntoView());
      this.pm!.focus();
    }).open();
  }

  // 游標在程式碼區塊裡（只能放純文字）：提示這個功能不能用，回傳 true
  blockedInCode(): boolean {
    if (!this.pm || !C.inCode(this.pm.state)) return false;
    new Notice(t(C.codeBlocked(this.pm.state)!));
    return true;
  }

  openProperties(): void {
    if (!this.pm) return;
    const st = this.pm.state;
    if (st.doc.firstChild && st.doc.firstChild.type === schema.nodes.frontmatter) {
      this.propsOpen = true;
      const dom = this.pm.nodeDOM(0) as FrontmatterDom | null;
      if (dom && dom.wmOpen) dom.wmOpen();
      this.scroller.scrollTop = 0;
      return;
    }
    this.propsOpen = true;
    const tr = st.tr.insert(0, schema.nodes.frontmatter.create({ src: '---\n---' }));
    this.pm.dispatch(tr);
    this.scroller.scrollTop = 0;
  }

  // 「查看文件屬性」小視窗的內容：編輯中的文件最前面的文件屬性（還沒存檔的修改也看得到）
  propsPeekData(): PropsPeekData {
    const first = this.pm && this.pm.state.doc.firstChild;
    if (!first || first.type !== schema.nodes.frontmatter) return { kind: 'none' };
    return peekData(frontmatterBody((first.attrs as FrontmatterAttrs).src), yaml => parseYaml(yaml) as unknown);
  }

  peekProperties(btn: HTMLElement): void {
    if (!this.pm) return;
    openPropsPeek(btn, this.propsPeekData(), {
      icon: iconOr,
      typeHint: k => propertyWidget(this.app, k),
      go: () => this.openProperties(),
      isMobile: !!Platform.isMobile,
    });
  }

  openEquation(existing?: MathTarget): void {
    if (!this.pm || (!existing && this.blockedInCode())) return;
    const render: MathRenderer = (src, el, display) => renderMathInto(src, el, display);
    const st0 = this.pm.state;
    // 沒有指定要編輯的方程式、但有選取文字：把選取的文字當成方程式內容
    const selText = !existing && !st0.selection.empty && st0.selection.$from.sameParent(st0.selection.$to) ? st0.doc.textBetween(st0.selection.from, st0.selection.to) : '';
    const init: EquationInit = existing
      ? { src: existing.src, display: existing.display, existing: true, onDelete: () => this.deleteNodeAt(existing.pos) }
      : { src: selText, display: this.plugin.settings.mathDisplay === true };
    new EquationModal(this.app, init, render, (src, display) => {
      const st = this.pm!.state;
      const node = display ? schema.nodes.raw_block.create({ src: '$$\n' + src + '\n$$', kind: 'math' }) : schema.nodes.raw_inline.create({ src: '$' + src + '$' });
      if (existing) {
        const n = st.doc.nodeAt(existing.pos);
        if (n && n.isInline === node.isInline) { this.pm!.dispatch(st.tr.replaceWith(existing.pos, existing.pos + n.nodeSize, node)); this.pm!.focus(); return; }
        if (n) {
          // 行內 ⇄ 獨立一行：刪掉舊的，在同一個位置放新的
          const tr = st.tr.delete(existing.pos, existing.pos + n.nodeSize);
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(existing.pos, tr.doc.content.size))));
          this.pm!.dispatch(tr);
        }
      }
      const ins = display ? C.insertBlock(node) : C.insertInline(node);
      ins(this.pm!.state, tv => this.pm!.dispatch(tv));
      this.pm!.focus();
    }, this.plugin).open();
  }

  deleteNodeAt(pos: number): void {
    const st = this.pm!.state;
    const n = st.doc.nodeAt(pos);
    if (n) this.pm!.dispatch(st.tr.delete(pos, pos + n.nodeSize));
    this.pm!.focus();
  }

  // 方程式節點（行內 $…$ 或獨立 $$…$$）的位置與內容
  mathAt(dom: MaybeElement | null): MathInfo | null {
    const elx = dom && dom.closest && (dom.closest('.wm-raw-inline.is-math') || dom.closest('.wm-raw-block[data-kind="math"]'));
    if (!elx) return null;
    let pos: number;
    try { pos = this.pm!.posAtDOM(elx, 0); } catch { return null; }
    return this.mathNodeAt(pos) || this.mathNodeAt(pos - 1);
  }

  // 位置 p 的節點是方程式的話，回傳它的內容
  mathNodeAt(p: number): MathInfo | null {
    const n = p >= 0 && this.pm!.state.doc.nodeAt(p);
    if (!n) return null;
    let m: RegExpExecArray | null;
    if (n.type.name === 'raw_inline' && (m = /^\$\$?([\s\S]+?)\$?\$$/.exec((n.attrs as RawInlineAttrs).src))) return { pos: p, node: n, src: m[1].trim(), display: false };
    if (n.type.name === 'raw_block' && (n.attrs as RawBlockAttrs).kind === 'math' && (m = /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec((n.attrs as RawBlockAttrs).src))) return { pos: p, node: n, src: m[1].trim(), display: true };
    return null;
  }

  mathMenuItems(math: MathTarget): Required<NodeViewMenuItem>[] {
    return [
      { title: t('編輯方程式…'), icon: 'sigma', run: () => this.openEquation({ pos: math.pos, src: math.src, display: math.display }) },
      ...this.mathMoreItems(math),
      { title: t('刪除方程式'), icon: 'trash-2', run: () => this.deleteNodeAt(math.pos) },
    ];
  }

  // 編輯、刪除以外的方程式功能：獨立方程式右上角已經有編輯、刪除的按鈕，「更多功能」只列這些
  mathMoreItems(math: MathTarget): Required<NodeViewMenuItem>[] {
    return [
      { title: math.display ? t('改成文字中（行內）') : t('改成獨立一行'), icon: math.display ? 'text-cursor' : 'align-center', run: () => this.convertMath(math) },
      { title: t('複製 LaTeX'), icon: 'copy', run: () => this.copyText(math.src) },
      { title: t('複製為 Markdown'), icon: 'file-code', run: () => this.copyText(math.display ? '$$\n' + math.src + '\n$$' : '$' + math.src + '$') },
    ];
  }

  convertMath(math: MathTarget): void {
    const st = this.pm!.state;
    const n = st.doc.nodeAt(math.pos);
    if (!n) return;
    const tr = st.tr.delete(math.pos, math.pos + n.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(math.pos, tr.doc.content.size))));
    this.pm!.dispatch(tr);
    const node = math.display ? schema.nodes.raw_inline.create({ src: '$' + math.src + '$' }) : schema.nodes.raw_block.create({ src: '$$\n' + math.src + '\n$$', kind: 'math' });
    (math.display ? C.insertInline(node) : C.insertBlock(node))(this.pm!.state, tv => this.pm!.dispatch(tv));
    this.pm!.focus();
  }


  async save(clear?: boolean): Promise<void> {
    if (this.conflict) return; // 同步衝突時先不寫入，等使用者選擇
    const rev = this.editRev;
    // 上一次寫入還沒完成時，舊版的 Obsidian 這一次不會寫（等寫完再存一次），所以這一次不能算存好了
    const busy = this.saving === true;
    if (this.unsaved) this.setStatus('saving');
    try {
      await super.save(clear);
    } catch (e) {
      // 寫不進去（檔案被鎖、磁碟滿了）：Obsidian 會自己跳通知。這裡把狀態改回編輯中，修改仍然算還沒存檔，
      // 之後檔案在外面被改時才會走同步衝突，不會被悄悄蓋掉
      if (this.status === 'saving') this.setStatus('dirty');
      throw e;
    }
    if (!busy && rev > this.savedRev) this.savedRev = rev;
    if (this.status !== 'conflict') this.setStatus(this.unsaved ? 'dirty' : 'saved');
  }

  async onUnloadFile(file: TFile): Promise<void> {
    // 關閉時衝突還沒解決：把自己的版本另存副本，原檔留給同步進來的版本。
    // 另存成功才放掉這裡的修改；另存失敗時讓下面照常存檔（我的版本只存在這裡，磁碟上的版本別的裝置還有）
    let dropped = false;
    if (this.conflict) {
      try {
        if (await this.saveMyCopy()) { this.dropEdits(await this.app.vault.read(file)); dropped = true; }
      } catch (e) { console.error('[Word 模式] 另存我的版本失敗', e); }
      this.hideConflict();
    }
    const r = await super.onUnloadFile(file);
    // 放掉修改之後，記住的編輯狀態會跟檔案內容對不上，下次開啟要從檔案重新讀
    if (!dropped) this.cacheHistory(file);
    return r;
  }

  // 放掉還沒存檔的修改，之後存檔時輸出 disk（磁碟上的內容），也就是不會寫入
  dropEdits(disk: string): void {
    this.lastOut = disk;
    this.changed = false;
    this.outDoc = null;
    this.savedRev = this.editRev;
  }

  // 記住這份筆記的編輯狀態（含復原紀錄），切換模式回來時可以繼續 Ctrl+Z
  cacheHistory(file?: TFile | null): void {
    const f = file || this.file;
    if (!f || !this.pm || this.conflict || this.plugin.settings.keepHistory === false) return;
    this.plugin.storeHistory(f.path, { state: this.pm.state, meta: this.meta, lastOut: this.lastOut });
  }

  // ---------------------------------------------------------- 同步衝突

  showConflict(): void {
    // 已經在等使用者選擇時，檔案又被改了：選的時候才讀磁碟，所以不用再做一次
    if (this.conflict) return;
    this.conflict = { busy: false };
    this.setStatus('conflict');
    if (this.plugin.settings.conflict === 'both') {
      // 設定為「自動兩份都保留」：不詢問，把自己的版本另存副本後載入新版本。另存失敗就改成詢問
      this.conflict.busy = true;
      this.keepBoth().catch(e => {
        console.error('[Word 模式] 另存我的版本失敗', e);
        if (this.conflict) { this.conflict.busy = false; this.showConflictBanner(); }
      });
      return;
    }
    this.showConflictBanner();
  }

  // 把自己的版本另存副本，再載入磁碟上的版本
  async keepBoth(): Promise<void> {
    const f = await this.saveMyCopy();
    await this.loadTheirs();
    if (f) new Notice(t('你的版本已另存為「') + f.basename + t('」，目前顯示新版本。'));
  }

  // 載入磁碟上現在的內容（放掉這裡的修改）並結束衝突
  async loadTheirs(): Promise<void> {
    if (!this.file) return;
    const disk = await this.app.vault.read(this.file);
    this.hideConflict();
    // 讓 Obsidian 記住的內容跟畫面一致（它手上可能是合併過的版本）
    this.data = disk;
    this.loadDoc(disk, false);
  }

  showConflictBanner(): void {
    const b = this.bannerHost;
    b.empty();
    const box = b.createDiv('wm-banner');
    const msg = box.createDiv('wm-banner-text');
    setIcon(msg.createSpan('wm-banner-icon'), 'alert-triangle');
    msg.createSpan({ text: t('這份筆記剛在其他地方被修改（可能是 Synology 同步或其他裝置）。你在這裡的修改還沒存檔，要保留哪一份？') });
    const bar = box.createDiv('wm-banner-actions');
    // 每個選項都要讀檔或寫檔；處理中再按一次（或按另一個）不重複執行。失敗時留著橫幅讓使用者再選
    const btn = (text: string, cls: string, run: () => Promise<void>) => {
      const x = bar.createEl('button', { text, cls });
      x.addEventListener('click', () => {
        const c = this.conflict;
        if (!c || c.busy) return;
        c.busy = true;
        run().catch(e => { console.error('[Word 模式]', e); if (this.conflict === c) c.busy = false; });
      });
      return x;
    };
    btn(t('載入新版本'), '', async () => { await this.loadTheirs(); new Notice(t('已載入新版本，你剛剛的修改已捨棄。')); });
    btn(t('保留我的版本'), 'mod-cta', async () => {
      this.hideConflict();
      this.setStatus('dirty');
      await this.save();
      new Notice(t('已用你的版本覆蓋。'));
    });
    btn(t('兩份都保留'), '', () => this.keepBoth());
  }

  hideConflict(): void {
    this.conflict = null;
    if (this.bannerHost) this.bannerHost.empty();
  }

  async saveMyCopy(): Promise<TFile | null> {
    if (!this.file || !this.pm) return null;
    const mine = this.plugin.converter.serialize(this.pm.state.doc, this.meta!);
    const stamp = window.moment ? window.moment().format('YYYYMMDD-HHmm') : String(Date.now());
    const dir = this.file.parent && this.file.parent.path !== '/' ? this.file.parent.path + '/' : '';
    let path = normalizePath(dir + this.file.basename + t('（我的版本 ') + stamp + t('）.md'));
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(dir + this.file.basename + t('（我的版本 ') + stamp + '-' + (i++) + t('）.md'));
    return this.app.vault.create(path, mine);
  }

  // ---------------------------------------------------------- 跳到指定位置（大綱、反向連結、搜尋結果、#標題 連結）

  setEphemeralState(state: EphemeralState | null | undefined): void {
    if (super.setEphemeralState as ((state: unknown) => void) | undefined) super.setEphemeralState(state);
    if (!state) return;
    if (!this.pm || !this.meta) { this.pendingEState = state; return; }
    let line: number | null = null;
    if (typeof state.line === 'number') line = state.line;
    else if (state.match && state.match.matches && state.match.matches[0]) line = this.offsetToLine(state.match.matches[0][0]);
    else if (state.subpath) line = this.subpathLine(state.subpath);
    if (line != null) this.scrollToLine(line);
  }

  offsetToLine(offset: number): number {
    const tv = this.lastOut.slice(0, offset);
    return (tv.match(/\r\n|\n|\r/g) || []).length;
  }

  subpathLine(subpath: string): number | null {
    const cache = this.file && this.app.metadataCache.getFileCache(this.file);
    if (!cache) return null;
    const sp = subpath.replace(/^#/, '');
    if (sp.startsWith('^')) {
      const b = cache.blocks && cache.blocks[sp.slice(1).toLowerCase()];
      return b ? b.position.start.line : null;
    }
    const last = sp.split('#').pop()!.trim().toLowerCase();
    const h = (cache.headings || []).find(x => x.heading.trim().toLowerCase() === last);
    return h ? h.position.start.line : null;
  }

  // 原文行號 → 文件位置：找出包含該行的原文區塊
  lineToPos(line: number): number | null {
    const doc = this.pm!.state.doc;
    let segs = this.meta!.segments;
    // meta 記的是載入當時每個區塊在第幾行。編輯之後（上面多一段、刪掉一段）檔案裡的行號就不一樣了，
    // 照舊的行號會跳到別的區塊。改過的話，把現在會存出去的內容重新切一次：
    // 切出來的最上層區塊跟目前文件的最上層區塊一一對應（順序相同），用順序對回目前的位置
    if (this.changed) {
      try {
        const fresh = this.plugin.converter.parse(this.getViewData());
        if (fresh.doc.childCount === doc.childCount) {
          segs = fresh.meta.segments;
          let at = -1;
          for (let i = 0; i < segs.length; i++) if (segs[i].line != null && segs[i].line <= line) at = i;
          if (at < 0) return 0;
          let pos = 0; let hit: number | null = null;
          fresh.doc.forEach((n, _offset, i) => { if (hit == null && n.attrs.bid === at) hit = pos; pos += doc.child(i).nodeSize; });
          if (hit != null) return hit;
        }
      } catch (e) { console.error('[Word 模式] 找不到這一行對應的位置', e); }
      segs = this.meta!.segments;
    }
    let idx = -1;
    for (let i = 0; i < segs.length; i++) if (segs[i].line != null && segs[i].line <= line) idx = i;
    if (idx < 0) return 0;
    let found: number | null = null;
    this.pm!.state.doc.descendants((n, p) => { if (found != null) return false; if (n.attrs && n.attrs.bid === idx) { found = p; return false; } return true; });
    return found;
  }

  scrollToLine(line: number): void {
    const pos = this.lineToPos(line);
    if (pos != null) this.scrollToPos(pos);
  }

  scrollToPos(pos: number): void {
    const v = this.pm!;
    try {
      const sel = TextSelection.near(v.state.doc.resolve(Math.min(pos + 1, v.state.doc.content.size)));
      v.dispatch(v.state.tr.setSelection(sel));
      let dom = v.nodeDOM(pos) as HTMLElement | null;
      if (dom && dom.nodeType !== 1) dom = dom.parentElement;
      if (dom && dom.scrollIntoView) {
        dom.scrollIntoView({ block: 'center' });
        dom.classList.add('wm-flash');
        window.setTimeout(() => dom.classList.remove('wm-flash'), 1200);
      } else v.dispatch(v.state.tr.scrollIntoView());
      v.focus();
    } catch { /* 忽略 */ }
  }

  loadDoc(data: string, clear: boolean): void {
    let parsed: ParseResult;
    try { parsed = this.plugin.converter.parse(data); }
    catch (e) {
      console.error('[Word 模式] 解析失敗', e);
      new Notice(t('Word 模式無法開啟這份筆記，改用 Markdown 編輯。'));
      this.lastOut = data;
      window.setTimeout(() => this.plugin.switchToMarkdown(this.leaf), 0);
      return;
    }
    this.meta = parsed.meta;
    this.lastOut = data;
    this.changed = false;
    this.outDoc = null;
    this.savedRev = this.editRev;
    // 貼上選項指的是舊文件裡的位置，換了文件就不能再用
    this.hidePasteChip();
    const plugins = this.editorPlugins();
    let state: EditorState | null = null;
    // 同一份筆記剛切去 Markdown 又切回來：沿用原本的編輯狀態與復原紀錄
    const cached = clear && this.file ? this.plugin.takeHistory(this.file.path) : null;
    if (cached) {
      try {
        if (cached.lastOut === data) {
          state = restoreEditorState(cached.state, plugins);
          this.meta = cached.meta;
        } else {
          // 在 Markdown 改過：把改動當成一個步驟，Ctrl+Z 可以退回 Markdown 的修改，再往前退回之前的編輯
          const st = restoreEditorState(cached.state, plugins);
          const tr = st.tr.replaceWith(0, st.doc.content.size, parsed.doc.content);
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(cached.state.selection.from, tr.doc.content.size))));
          state = st.apply(tr);
        }
      } catch (e) { console.error('[Word 模式] 無法還原編輯紀錄', e); state = null; this.meta = parsed.meta; }
    }
    if (!state) state = createEditorState(parsed.doc, plugins);
    const scrollTop = this.scroller.scrollTop;
    if (!this.pm) {
      this.pm = new EditorView(this.page, {
        state,
        nodeViews: createNodeViews(this.nodeViewContext()),
        dispatchTransaction: tr => this.dispatch(tr),
        // 拼字檢查跟著 Obsidian 的設定（設定 → 編輯器 → 拼字檢查）
        attributes: { class: 'wm-editor', spellcheck: this.spellcheckOn() ? 'true' : 'false' },
        handleDOMEvents: {
          mousedown: (v, e) => this.onMouseDown(e as ElementEvent),
          mouseover: (v, e) => {
            const a = (e.target as Element).closest && (e.target as Element).closest<HTMLAnchorElement>('a.wm-link');
            const href = a && a.getAttribute('href');
            if (href && !isExternal(href)) { let lt = href; try { lt = decodeURIComponent(href); } catch { /* 保持原樣 */ } this.hoverLink(e, lt, a); }
            return false;
          },
          contextmenu: (v, e) => this.onContextMenu(e as ElementEvent<typeof e>),
        },
        handleKeyDown: (v, e) => this.onKeyDown(e),
        handleScrollToSelection: v => this.scrollPastProps(v),
        handlePaste: (v, e) => this.onPaste(e),
        handleDrop: (v, e) => this.onDrop(e),
        transformPasted: slice => stripSliceBids(slice),
        transformPastedHTML: html => html
          .replace(/<img[^>]+src="(?:file:|data:)[^"]*"[^>]*>/gi, '')
          .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, ''),
      });
    } else {
      this.pm.updateState(state);
    }
    this.toolbar.update(state);
    if (clear) this.scroller.scrollTop = 0;
    else this.scroller.scrollTop = scrollTop;
    this.setStatus('saved');
    this.updateCount();
    this.updatePin();
    if (this.pendingEState) { const st = this.pendingEState; this.pendingEState = null; window.setTimeout(() => this.setEphemeralState(st), 0); }
    this.plugin.outlineChanged(this, true);
  }

  dispatch(tr: Transaction): void {
    if (!this.pm) return;
    const state = this.pm.state.apply(tr);
    this.pm.updateState(state);
    if (tr.docChanged) {
      this.changed = true;
      this.editRev++;
      if (this.status !== 'conflict') this.setStatus('dirty');
      this.requestSave();
      if (this.pasteChip && !tr.getMeta('wmPasteChip')) this.hidePasteChip();
      if (this.pin) this.updatePin();
    }
    this.toolbar.update(state);
    if (tr.docChanged || tr.selectionSet) this.plugin.outlineChanged(this, tr.docChanged);
    window.clearTimeout(this.countTimer);
    this.countTimer = window.setTimeout(() => this.updateCount(), 200);
  }


  // ---------------------------------------------------------- Obsidian 協助函式

  sourcePath(): string { return this.file ? this.file.path : ''; }

  // 連結路徑 → 保管庫裡的檔案或資料夾（支援相對路徑、%20 編碼、<路徑>）
  resolvePath(linkpath: string): TAbstractFile | null {
    const clean = String(linkpath).replace(/^<|>$/g, '').split('#')[0];
    let p = clean;
    try { p = decodeURIComponent(clean); } catch { /* 保持原樣 */ }
    if (!p) return this.file;
    const vault = this.app.vault;
    const dir = this.file && this.file.parent ? this.file.parent.path : '';
    const join = (base: string) => {
      const parts = base && base !== '/' ? base.split('/') : [];
      for (const seg of p.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
      return normalizePath(parts.join('/'));
    };
    if (/^\.\.?\//.test(p)) { const f = vault.getAbstractFileByPath(join(dir)); if (f) return f; }
    const dest = this.app.metadataCache.getFirstLinkpathDest(p.replace(/\/$/, ''), this.sourcePath());
    if (dest) return dest;
    for (const cand of [join(dir), normalizePath(p)]) { const f = cand && vault.getAbstractFileByPath(cand); if (f) return f; }
    return null;
  }

  resolveFile(linkpath: string): TFile | null {
    const f = this.resolvePath(linkpath);
    return f instanceof TFile ? f : null;
  }

  openLink(target: string, newLeaf: boolean): void {
    if (isExternal(target)) { window.open(target); return; }
    const f = this.resolvePath(target);
    if (f instanceof TFolder) {
      try {
        const fe = this.app.internalPlugins!.getEnabledPluginById!('file-explorer');
        if (fe) { fe.revealInFolder(f); return; }
      } catch { /* 改用提示 */ }
      new Notice(t('這是資料夾：') + f.path);
      return;
    }
    if (f instanceof TFile && f.extension !== 'md') {
      void this.app.workspace.getLeaf(newLeaf ? 'tab' : false).openFile(f);
      return;
    }
    let linktext = target.replace(/^<|>$/g, '');
    try { linktext = decodeURIComponent(linktext); } catch { /* 保持原樣 */ }
    if (f instanceof TFile) {
      const sub = linktext.includes('#') ? '#' + linktext.split('#').slice(1).join('#') : '';
      linktext = f.path + sub;
    }
    void this.app.workspace.openLinkText(linktext, this.sourcePath(), newLeaf ? 'tab' : false);
  }

  nodeViewContext(): NodeViewContext {
    const menu = (evt: MouseEvent, items: NodeViewMenuItem[]) => {
      evt.preventDefault();
      const m = new Menu();
      for (const it of items) m.addItem(i => { i.setTitle(it.title); if (it.icon) i.setIcon(it.icon); i.onClick(it.run); });
      m.showAtMouseEvent(evt);
    };
    return {
      icon: iconOr,
      openLink: (tv, n) => this.openLink(tv, n),
      isResolved: tv => !!this.resolveFile(tv),
      resolveImage: a => {
        const { src } = a as ImageAttrs;
        if (/^(https?:|data:)/i.test(src)) return src;
        const f = this.resolveFile(src);
        return f instanceof TFile ? this.app.vault.getResourcePath(f) : null;
      },
      renderMarkdown: (src, el) => {
        MarkdownRenderer.render(this.app, src, el, this.sourcePath(), this).catch(e => { el.setText(src); console.error(e); });
      },
      renderMath: (src, el, display) => renderMathInto(src, el, display, '$' + src + '$'),
      editSource: (title, src, onSave) => new SourceModal(this.app, title, src, onSave).open(),
      editLinkAt: pos => { this.selectNodeAt(pos); this.openLinkDialog(); },
      prompt: (title, value, placeholder, cb) => new PromptModal(this.app, title, value, placeholder, cb).open(),
      editMath: (pos, src, display) => { if (pos != null) this.openEquation({ pos, src, display }); },
      parseYaml: tv => { const v: unknown = parseYaml(tv); return v; },
      stringifyYaml: o => stringifyYaml(o),
      propsOpen: () => this.propsOpen !== false,
      setPropsOpen: v => { this.propsOpen = v; },
      propsSticky: () => !!this.plugin.settings.propsSticky,
      setPropsSticky: on => {
        void this.plugin.setPropsSticky(on);
        // 打開時畫面不會馬上變（要往下捲才出現），說一聲
        if (on) new Notice(t('往下捲動時，文件屬性會固定在頁面上方'));
      },
      propertyType: key => propertyWidget(this.app, key),
      unwrapCallout: pos => this.unwrapCallout(pos),
      imageMenu: (evt, pos) => this.imageMenu(evt, pos),
      setImageWidth: (pos, w) => this.setImageWidth(pos, w),
      pageWidth: () => this.pageWidth(),
      notice: msg => new Notice(msg),
      renderBlock: (src, el) => this.renderBlock(src, el),
      canPreview: lang => this.canPreview(lang),
      collapseTall: () => this.plugin.settings.collapseTall !== false,
      lineNumbers: () => !!this.plugin.settings.codeLineNumbers,
      editMermaid: pos => this.openMermaid(pos),
      gotoFootnote: id => this.gotoFootnote(id),
      editFootnote: id => this.editFootnote(id),
      renderEmbed: (target, el) => renderEmbed(this, target, el),
      mediaKind: src => mediaKind(this, src),
      hoverLink: (event, linktext, targetEl) => this.hoverLink(event, linktext, targetEl),
      menu,
      mathMenu: (evt, pos) => { const math = this.mathNodeAt(pos); if (math) menu(evt, this.mathMoreItems(math)); },
    };
  }

  // ---------------------------------------------------------- 事件

  onMouseDown(e: ElementEvent): boolean {
    // Ctrl+點擊超連結：開啟（一般點擊只放游標，不會跳出網址）
    const a = e.target.closest && e.target.closest('a.wm-link');
    if (a && (e.ctrlKey || e.metaKey) && e.button === 0) {
      e.preventDefault();
      this.openLink(a.getAttribute('href')!, e.shiftKey);
      return true;
    }
    const u = e.target.closest && e.target.closest('.wm-bare-url');
    if (u && (e.ctrlKey || e.metaKey) && e.button === 0) {
      e.preventDefault();
      this.openLink(u.getAttribute('data-href')!, e.shiftKey);
      return true;
    }
    // Ctrl+點擊 #標籤：在保管庫中搜尋這個標籤
    const tag = e.target.closest && e.target.closest('.wm-tag');
    if (tag && (e.ctrlKey || e.metaKey) && e.button === 0) {
      e.preventDefault();
      this.searchVault('tag:' + tag.getAttribute('data-tag'));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------- 用 Obsidian 顯示 Markdown（原文區塊、程式碼區塊的結果、內嵌）

  // 把一段 Markdown 交給 Obsidian 顯示在 el 裡；回傳的 unload() 用來釋放（重畫或區塊被刪除時呼叫）
  renderBlock(src: string, el: HTMLElement, sourcePath?: string): EmbedHandle {
    const comp = new Component();
    if (this.addChild) this.addChild(comp); else comp.load();
    const ready = MarkdownRenderer.render(this.app, src, el, sourcePath || this.sourcePath(), comp).catch(e => { el.setText(src); console.error('[Word Mode]', e); });
    return { ready, unload: () => { if (this.removeChild) this.removeChild(comp); else comp.unload(); } };
  }

  // 這個語言的程式碼區塊在 Obsidian 會不會顯示成結果：內建的 mermaid、query、math、base，
  // 以及其他外掛註冊的區塊（dataview、tasks、chart…）
  canPreview(lang: string | null | undefined): boolean {
    if (this.plugin.settings.codePreview === false) return false;
    const l = String(lang || '').trim().split(/\s+/)[0].toLowerCase();
    if (!l) return false;
    if (l === 'mermaid' || l === 'query' || l === 'math' || l === 'base') return true;
    try {
      const pp = MarkdownPreviewRenderer.codeBlockPostProcessors;
      return !!(pp && pp[l]);
    } catch { return false; }
  }

  // Mermaid 圖表編輯器：pos 是既有的 mermaid 程式碼區塊位置；沒有 pos 就是插入新的
  openMermaid(pos?: number | null): void {
    if (!this.pm || (pos == null && this.blockedInCode())) return;
    const existing = pos != null ? this.pm.state.doc.nodeAt(pos) : null;
    const isCode = existing && existing.type === schema.nodes.code_block;
    const S = this.plugin.settings;
    // 新圖表一開始的內容（設定「新圖表一開始的內容」）：某一種內建圖表的範本，或自己存的範本
    const def = S.defaultDiagram || '';
    let initial = '';
    if (def.startsWith('tpl:')) { const x = (S.diagramTemplates || []).find(y => y.name === def.slice(4)); if (x) initial = x.src; }
    else if (def.startsWith('kind:')) { const k = DIAGRAM_KINDS.find(y => y.id === def.slice(5)); if (k) initial = t(k.template); }
    new MermaidModal(this.app, {
      initial,
      hiddenKinds: S.hiddenDiagramKinds || [],
      templates: () => S.diagramTemplates || [],
      saveTemplate: (name, src) => { S.diagramTemplates = saveTemplate(S.diagramTemplates || [], name, src); void this.plugin.saveSettings(); },
      src: isCode ? existing.textContent : '',
      existing: !!isCode,
      mode: this.plugin.settings.mermaidMode === 'code' ? 'code' : 'visual',
      render: (s, el) => this.renderBlock('```mermaid\n' + s + '\n```', el),
      validate: async s => {
        try {
          const mm = (await loadMermaid()) as MermaidLike | undefined;
          if (mm && mm.parse) await mm.parse(s);
          return null;
        } catch (e) { return String((e && ((e as CaughtError).str || (e as CaughtError).message)) || e).split('\n')[0]; }
      },
    }, text => {
      const st = this.pm!.state;
      const content = text ? schema.text(text) : null;
      if (isCode) {
        const n = st.doc.nodeAt(pos!);
        if (!n || n.type !== schema.nodes.code_block) return;
        if (n.textContent !== text) this.pm!.dispatch(st.tr.replaceWith(pos!, pos! + n.nodeSize, schema.nodes.code_block.create(n.attrs, content)));
      } else {
        C.insertBlock(schema.nodes.code_block.create({ params: 'mermaid' }, content))(st, tr => this.pm!.dispatch(tr));
        // 游標移到圖表後面，圖表就會顯示成結果（游標在裡面時顯示的是程式碼）
        const s2 = this.pm!.state;
        const $f = s2.selection.$from;
        for (let d = $f.depth; d > 0; d--) {
          if ($f.node(d).type === schema.nodes.code_block) {
            const after = $f.after(d);
            let tr = s2.tr;
            if (after >= s2.doc.content.size) tr = tr.insert(after, schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
            this.pm!.dispatch(tr);
            break;
          }
        }
      }
      this.pm!.focus();
    }).open();
  }

  // 滑鼠移到筆記連結上：交給 Obsidian 的「頁面預覽」顯示預覽（依它的設定，預設要按住 Ctrl／Cmd）
  hoverLink(event: MouseEvent, linktext: string, targetEl: HTMLElement): void {
    try {
      this.app.workspace.trigger('hover-link', { event, source: VIEW_TYPE, hoverParent: this, targetEl, linktext, sourcePath: this.sourcePath() });
    } catch { /* 沒有頁面預覽就不顯示 */ }
  }

  // ---------------------------------------------------------- 註腳

  insertFootnoteDialog(): void {
    if (!this.pm || this.blockedInCode()) return;
    if (!insertFootnote('')(this.pm.state)) { new Notice(t('請先把游標放在文字裡')); return; }
    new PromptModal(this.app, t('插入註腳'), '', t('註腳內容（會放在文件最後）'), value => {
      insertFootnote(value)(this.pm!.state, tr => this.pm!.dispatch(tr));
      this.pm!.focus();
    }).open();
  }

  // 跳到註腳的內容（文件後面的定義）
  gotoFootnote(id: string): void {
    const d = footnotes(this.pm!.state.doc).defs.find(x => x.id === id);
    if (!d) { new Notice(t('找不到這個註腳的內容')); return; }
    this.selectNodeAt(d.pos);
    const dom = this.pm!.nodeDOM(d.pos) as HTMLElement | null;
    if (dom && dom.scrollIntoView) { dom.scrollIntoView({ block: 'center' }); dom.classList.add('wm-flash'); window.setTimeout(() => dom.classList.remove('wm-flash'), 1200); }
  }

  // 編輯註腳的內容；還沒有定義就新增一個
  editFootnote(id: string): void {
    const d = footnotes(this.pm!.state.doc).defs.find(x => x.id === id);
    new SourceModal(this.app, t('註腳') + ' ' + id, d ? footnoteBody((d.node.attrs as RawBlockAttrs).src) : '', value => {
      const st = this.pm!.state;
      const cur = footnotes(st.doc).defs.find(x => x.id === id);
      if (cur) setFootnoteBody(cur.pos, value)(st, tr => this.pm!.dispatch(tr));
      else this.pm!.dispatch(st.tr.insert(st.doc.content.size, schema.nodes.raw_block.create({ src: '[^' + id + ']: ' + String(value).replace(/\r?\n/g, '\n    ').trim(), kind: 'footnote' })));
      this.pm!.focus();
    }).open();
  }

  spellcheckOn(): boolean {
    try { return !!(this.app.vault.getConfig && this.app.vault.getConfig('spellcheck')); } catch { return false; }
  }

  onKeyDown(e: KeyboardEvent): boolean {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const k = e.key.toLowerCase();
    // 選取方程式時按 Enter：開啟方程式編輯器
    const sel = this.pm!.state.selection;
    if (e.key === 'Enter' && !mod && sel instanceof NodeSelection) {
      const dom = this.pm!.nodeDOM(sel.from);
      const math = dom && this.mathAt(dom.firstChild || dom) || (dom && this.mathAt(dom));
      if (math) { e.preventDefault(); this.openEquation({ pos: math.pos, src: math.src, display: math.display }); return true; }
    }
    if (mod && !e.shiftKey && k === 'f') { e.preventDefault(); this.findBar.open(false); return true; }
    if (mod && !e.shiftKey && k === 'h') { e.preventDefault(); this.findBar.open(true); return true; }
    if (mod && !e.shiftKey && (k === '/' || e.code === 'Slash')) { e.preventDefault(); new ShortcutModal(this.app, this.plugin).open(); return true; }
    if (mod && e.shiftKey && k === 'v') { this.plainPasteNext = true; window.setTimeout(() => { this.plainPasteNext = false; }, 1000); return false; }
    if (e.key === 'Escape') {
      // 功能區的下拉面板開著：先關它（按鈕不會搶走焦點，所以按鍵是送到編輯區這裡）
      if (this.toolbar.popup) { this.toolbar.closePopup(); return true; }
      if (this.pasteChip) { this.hidePasteChip(); return true; }
      if (this.toolbar.painter) { this.toolbar.togglePainter(); return true; }
      if (this.findBar.isOpen) { this.findBar.close(); return true; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.openLinkDialog();
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
      return true;
    }
    return false;
  }

  // 右鍵選單（內容在 contextmenu.ts）
  onContextMenu(e: ElementEvent): boolean { return openContextMenu(this, e); }

  // 選取範圍轉成 Markdown 原文
  selectionMarkdown(): string {
    const st = this.pm!.state;
    const slice = st.selection.content();
    let content = slice.content;
    if (content.firstChild && content.firstChild.isInline) content = Fragment.from(schema.nodes.paragraph.create(null, content));
    try {
      const doc = schema.topNodeType.create(null, stripBids(content));
      const meta = this.plugin.converter.parse('').meta;
      return this.plugin.converter.serialize(doc, meta).replace(/\n+$/, '');
    } catch { return st.doc.textBetween(st.selection.from, st.selection.to, '\n'); }
  }

  searchVault(q: string): void {
    const gs = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('global-search');
    if (gs && gs.instance && gs.instance.openGlobalSearch) gs.instance.openGlobalSearch(q);
    else new Notice(t('請先啟用 Obsidian 的「搜尋」核心外掛'));
  }


  onPaste(e: ClipboardEvent): boolean {
    // 選取文字後貼上網址：把選取的文字變成超連結（像 Google 文件）
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    const st = this.pm!.state;
    const plain = this.plainPasteNext;
    this.plainPasteNext = false;
    this.hidePasteChip();
    // Excel／試算表／表格：建立表格，或在表格裡從目前儲存格開始填入
    const rows = !plain && !st.selection.$from.parent.type.spec.code ? clipboardTable(text, html) : null;
    if (rows) {
      e.preventDefault();
      const fill = C.table.isIn(st) ? fillTable(st, rows) : null;
      if (fill) this.pm!.dispatch(fill);
      else C.insertBlock(tableFromRows(rows))(this.pm!.state, tr => this.pm!.dispatch(tr));
      return true;
    }
    // 只有純文字、看起來像 Markdown（例如從 ChatGPT 複製）：先照原樣貼上，再提供「轉成格式」
    if (!plain && this.plugin.settings.pasteChip !== false && text && !html && looksLikeMarkdown(text) && !st.selection.$from.parent.type.spec.code) {
      const from = st.selection.from;
      window.setTimeout(() => this.showPasteChip(text, from), 0);
      return false;
    }
    if (text && isUrl(text) && !st.selection.empty && !(st.selection instanceof NodeSelection)
      && !st.selection.$from.parent.type.spec.code && st.selection.$from.sameParent(st.selection.$to)) {
      e.preventDefault();
      const { from, to } = st.selection;
      this.pm!.dispatch(st.tr.removeMark(from, to, schema.marks.link).addMark(from, to, schema.marks.link.create({ href: text.trim() })));
      return true;
    }
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
    if (!files.length) return false;
    e.preventDefault();
    void this.insertUploadedImages(files);
    return true;
  }

  onDrop(e: DragEvent): boolean {
    const drag = this.app.dragManager && this.app.dragManager.draggable;
    const pos = this.pm!.posAtCoords({ left: e.clientX, top: e.clientY });
    const place = () => { if (pos) this.pm!.dispatch(this.pm!.state.tr.setSelection(TextSelection.near(this.pm!.state.doc.resolve(pos.pos)))); };
    if (drag && (drag.type === 'file' || drag.type === 'files')) {
      e.preventDefault();
      place();
      const list = drag.type === 'file' ? [drag.file] : drag.files!;
      for (const f of list) if (f instanceof TFile) this.insertFileLink(f);
      return true;
    }
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /^image\//.test(f.type));
    if (!files.length) return false;
    e.preventDefault();
    place();
    void this.insertUploadedImages(files);
    return true;
  }

  // ---------------------------------------------------------- 貼上選項

  showPasteChip(text: string, from: number): void {
    const v = this.pm!;
    const to = v.state.selection.from;
    if (to <= from) return;
    this.hidePasteChip();
    const chip = this.page.createDiv('wm-paste-chip');
    const head = chip.createDiv('wm-paste-head');
    setIcon(head.createSpan('wm-tab-icon'), 'clipboard-paste');
    head.createSpan({ text: t('貼上選項') });
    const b1 = chip.createEl('button', { text: t('轉成格式（Markdown）'), cls: 'mod-cta' });
    const b2 = chip.createEl('button', { text: t('保留純文字') });
    for (const b of [b1, b2, chip]) b.addEventListener('mousedown', ev => ev.preventDefault());
    b1.addEventListener('click', () => {
      const doc = this.plugin.converter.parseFragment(text);
      const frag = stripBids(doc.content);
      const st = this.pm!.state;
      const tr = st.tr.replaceRange(from, Math.min(this.pasteChip!.to, st.doc.content.size), new Slice(frag, 0, 0));
      tr.setMeta('wmPasteChip', true);
      this.hidePasteChip();
      this.pm!.dispatch(tr.scrollIntoView());
      this.pm!.focus();
    });
    b2.addEventListener('click', () => { this.hidePasteChip(); this.pm!.focus(); });
    try {
      const c = v.coordsAtPos(to);
      const host = this.page.getBoundingClientRect();
      // 介面由右到左時往左展開：右緣對齊貼上內容的結尾（由左到右照舊，左緣對齊、預留 260px）
      const rtl = isRtl(this.page);
      const w = rtl ? chip.offsetWidth || 260 : 260;
      chip.style.left = Math.max(0, Math.min(rtl ? c.right - host.left - w : c.left - host.left, host.width - w)) + 'px';
      chip.style.top = (c.bottom - host.top + 6) + 'px';
    } catch { /* 預設位置 */ }
    this.pasteChip = { el: chip, from, to };
  }

  hidePasteChip(): void {
    if (this.pasteChip) { this.pasteChip.el.remove(); this.pasteChip = null; }
  }

  // ---------------------------------------------------------- 提示框

  openCalloutMenu(btn?: HTMLElement | null): void {
    if (!this.pm || this.blockedInCode()) return;
    const m = new Menu();
    for (const [type, label, icon] of C.CALLOUT_TYPES) {
      m.addItem(i => i.setTitle(t(label) + t('（') + type + t('）')).setIcon(icon).onClick(() => {
        C.insertCallout(type)(this.pm!.state, tr => this.pm!.dispatch(tr));
        this.pm!.focus();
      }));
    }
    const r = btn ? btn.getBoundingClientRect() : { left: 200, bottom: 120 };
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  unwrapCallout(pos: number | null | undefined): void {
    const st = this.pm!.state;
    const n = pos != null ? st.doc.nodeAt(pos) : null;
    if (!n || n.type !== schema.nodes.callout) return;
    this.pm!.dispatch(st.tr.replaceWith(pos!, pos! + n.nodeSize, stripBids(n.content)));
    this.pm!.focus();
  }

  // ---------------------------------------------------------- 插入連結與圖片

  copyText(tv: string): void {
    // 通知只顯示開頭一小段：複製一整段程式碼或一大段 Markdown 時，整份內容貼在通知裡會蓋住半個畫面
    const flat = tv.replace(/\s+/g, ' ').trim();
    const shown = flat.length > 60 ? flat.slice(0, 57) + '…' : flat;
    navigator.clipboard.writeText(tv).then(() => new Notice(t('已複製：') + shown), () => new Notice(t('無法複製')));
  }

  selectNodeAt(pos: number | null | undefined): void {
    if (pos == null) return;
    try { this.pm!.dispatch(this.pm!.state.tr.setSelection(NodeSelection.create(this.pm!.state.doc, pos))); } catch { /* 忽略 */ }
  }

  // 依目前位置開啟連結對話框：新增、編輯網址連結、筆記連結（Wiki 或 Markdown）、或把網址文字變成連結
  openLinkDialog(ctx?: LinkContext | null): void {
    if (!this.pm || (!ctx && this.blockedInCode())) return;
    const st = this.pm.state;
    const info = ctx || linkContext(st);
    if (info && info.kind === 'image') return;
    let init: LinkDialogInit;
    let range: TextRange;
    if (info && info.kind === 'wikilink') {
      const a = info.node.attrs as WikilinkAttrs;
      const f = this.app.metadataCache.getFirstLinkpathDest(a.target.split('#')[0], this.sourcePath());
      init = { existing: true, text: a.alias || '', mode: 'file', file: f || null, query: a.target, href: a.target };
      range = { from: info.pos, to: info.pos + 1 };
    } else if (info && (info.kind === 'link' || info.kind === 'url')) {
      const href = info.href;
      const ext = isExternal(href);
      const f = ext ? null : this.resolveFile(href);
      init = { existing: info.kind === 'link', text: info.text === href ? '' : info.text, mode: ext ? 'url' : 'file', href, file: f, query: f ? f.basename : href };
      range = { from: info.from, to: info.to };
    } else {
      const { from, to, empty } = st.selection;
      const text = empty ? '' : st.doc.textBetween(from, to, ' ');
      init = { existing: false, text, mode: 'url', href: isUrl(text) ? text.trim() : '' };
      range = { from, to };
    }
    new LinkDialog(this.app, this, init, res => this.applyLink(range, res, info), () => { if (info) this.unlink(info); }).open();
  }

  applyLink(range: TextRange, res: LinkDialogResult, info: LinkContext | null): void {
    const state = this.pm!.state;
    const { from, to } = range;
    const existing = state.doc.textBetween(from, to, ' ');
    const tr = state.tr;
    const marksAt = state.doc.resolve(from).marks().filter(m => m.type !== schema.marks.link);
    const putText = (text: string, href: string | undefined) => {
      const node = state.schema.text(text, href ? marksAt.concat(schema.marks.link.create({ href })) : marksAt);
      tr.replaceWith(from, to, node);
      tr.setSelection(TextSelection.create(tr.doc, from + text.length));
    };
    if (res.mode === 'url') {
      const text = res.text || (info && info.kind === 'wikilink' ? '' : existing) || res.href;
      putText(text, res.href);
    } else {
      const f = res.file;
      const l = this.buildLink(f);
      const kind = info ? info.kind : null;
      // 原本是 [[筆記連結]] 就維持 Wiki 連結；原本是 Markdown 連結就維持 Markdown；新的連結依保管庫設定
      const asWiki = kind === 'wikilink' ? true : kind === 'link' ? false : l.wiki;
      if (asWiki) {
        const target = kind === 'wikilink' && res.unchanged ? (info!.node!.attrs as WikilinkAttrs).target
          : l.wiki ? l.target : this.app.metadataCache.fileToLinktext(f, this.sourcePath(), true);
        const alias = res.text && res.text !== f.basename ? res.text : null;
        const embed = kind === 'wikilink' && !!(info!.node!.attrs as WikilinkAttrs).embed;
        tr.replaceWith(from, to, schema.nodes.wikilink.create({ target, alias, embed }));
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
      } else {
        const href = res.unchanged && kind === 'link' ? res.href : (l.wiki ? f.path : l.href);
        const text = res.text || ((kind === 'link' || kind === null) && existing ? existing : f.basename);
        putText(text, href);
      }
    }
    this.pm!.dispatch(tr.scrollIntoView());
    this.pm!.focus();
  }

  unlink(info: LinkContext): void {
    const tr = this.pm!.state.tr;
    if (info.kind === 'link') tr.removeMark(info.from, info.to, schema.marks.link);
    else if (info.kind === 'wikilink') {
      const a = info.node.attrs as WikilinkAttrs;
      // split() 至少回傳一個元素，pop() 不會是 undefined
      const text = a.alias || a.target.replace(/\.md$/i, '').split('/').pop()!;
      tr.replaceWith(info.pos, info.pos + 1, this.pm!.state.schema.text(text));
    } else return;
    this.pm!.dispatch(tr);
    this.pm!.focus();
  }

  // 連結預覽列的顯示內容
  describe(target: string, wiki: boolean): LinkDescription {
    if (isExternal(target)) {
      const label = target.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      return { icon: 'globe', label: label.length > 60 ? label.slice(0, 57) + '…' : label, title: target, missing: false };
    }
    const f = wiki ? this.app.metadataCache.getFirstLinkpathDest(target.split('#')[0], this.sourcePath()) : this.resolvePath(target);
    let label = target;
    try { label = decodeURIComponent(target); } catch { /* 保持原樣 */ }
    if (f instanceof TFolder) return { icon: 'folder', label: f.path + '/', title: t('資料夾：') + f.path, missing: false };
    if (f instanceof TFile) {
      const icon = f.extension === 'md' ? 'file-text' : IMAGE_EXT.test(f.extension) ? 'image' : f.extension === 'pdf' ? 'file-text' : 'file';
      return { icon, label: f.extension === 'md' ? f.path.replace(/\.md$/, '') : f.path, title: f.path, missing: false };
    }
    return { icon: 'file-question', label: label + t('（找不到，點一下會建立新筆記）'), title: label, missing: true };
  }

  bubbleContext(): BubbleContext {
    return {
      host: this.page,
      icon: iconOr,
      describe: (tv, wiki) => this.describe(tv, wiki),
      open: (info, newTab) => this.openLink(info.kind === 'wikilink' ? (info.node.attrs as WikilinkAttrs).target : info.href!, newTab),
      edit: info => this.openLinkDialog(info),
      copy: tv => this.copyText(tv),
      unlink: info => this.unlink(info),
      imageExists: a => !!this.nodeViewContext().resolveImage(a),
      imageWidth: a => parseWidth(a),
      pageWidth: () => this.refWidth(),
      setWidth: (info, w) => this.setImageWidth(info.pos, w),
      editAlt: info => this.editImageAlt(info.pos),
      replaceImage: (info, btn) => this.openImageMenu(btn, info.pos),
      openImage: info => this.openImage(info.node.attrs),
      removeNode: info => { this.pm!.dispatch(this.pm!.state.tr.delete(info.pos, info.pos + info.node.nodeSize)); this.pm!.focus(); },
    };
  }

  // ---------------------------------------------------------- 圖片

  pageWidth(): number {
    const w = this.pm ? this.pm.dom.clientWidth : 0;
    return w > 100 ? w : 700;
  }

  // 圖片「小／中／大／滿版」的基準寬度：Obsidian 閱讀畫面的行寬（預設 700px），避免全寬頁面時圖片被放得過大
  refWidth(): number {
    let line = 0;
    try { line = parseInt(getComputedStyle(activeDocument.body).getPropertyValue('--file-line-width'), 10) || 0; } catch { /* 預設值 */ }
    return Math.min(this.pageWidth(), line > 200 ? line : 700);
  }

  imageAt(pos: number | null | undefined): PMNode | null {
    const n = pos != null ? this.pm!.state.doc.nodeAt(pos) : null;
    return n && n.type === schema.nodes.image ? n : null;
  }

  setImageWidth(pos: number, w: number | null): void {
    const n = this.imageAt(pos);
    if (!n) return;
    const tr = this.pm!.state.tr.setNodeMarkup(pos, null, imageAttrsWithWidth(n.attrs, w));
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    this.pm!.dispatch(tr);
    this.pm!.focus();
  }

  editImageAlt(pos: number): void {
    const n = this.imageAt(pos);
    if (!n) return;
    const cur = ((n.attrs as ImageAttrs).alt || '').replace(/\|\d+(x\d+)?$/, '');
    new PromptModal(this.app, t('圖片的替代文字（說明）'), cur, t('例如：2026 年 10 月發電量趨勢圖'), v => {
      const node = this.imageAt(pos);
      if (!node) return;
      const tr = this.pm!.state.tr.setNodeMarkup(pos, null, Object.assign({}, node.attrs, { alt: v.trim() || null }));
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      this.pm!.dispatch(tr);
      this.pm!.focus();
    }).open();
  }

  openImage(a: Attrs): void {
    const { src } = a as ImageAttrs;
    if (/^https?:/i.test(src)) { window.open(src); return; }
    const f = this.resolveFile(src);
    if (f) void this.app.workspace.getLeaf('tab').openFile(f);
  }

  imageMenu(evt: MouseEvent, pos: number): void {
    evt.preventDefault();
    this.selectNodeAt(pos);
    const n = this.imageAt(pos);
    if (!n) return;
    const m = new Menu();
    const full = this.refWidth();
    for (const [label, pct] of [[t('小（25%）'), 0.25], [t('中（50%）'), 0.5], [t('大（75%）'), 0.75], [t('滿版'), 1]] as [string, number][]) {
      m.addItem(i => i.setTitle(t('寬度：') + label).onClick(() => this.setImageWidth(pos, Math.round(full * pct))));
    }
    m.addItem(i => i.setTitle(t('原始大小')).setIcon('maximize').onClick(() => this.setImageWidth(pos, null)));
    m.addSeparator();
    m.addItem(i => i.setTitle(t('替代文字…')).setIcon('text-cursor-input').onClick(() => this.editImageAlt(pos)));
    m.addItem(i => i.setTitle(t('更換圖片…')).setIcon('replace').onClick(() => this.openImageMenu(null, pos, evt)));
    m.addItem(i => i.setTitle(t('在新分頁開啟圖片')).setIcon('external-link').onClick(() => this.openImage(n.attrs)));
    m.addItem(i => i.setTitle(t('刪除圖片')).setIcon('trash-2').onClick(() => { this.pm!.dispatch(this.pm!.state.tr.delete(pos, pos + n.nodeSize)); }));
    m.showAtMouseEvent(evt);
  }

  // 依照保管庫的連結設定（Wiki 或 Markdown 連結、相對路徑）產生連結
  buildLink(file: TFile): BuiltLink {
    const raw = this.app.fileManager.generateMarkdownLink(file, this.sourcePath()).replace(/^!/, '');
    let m = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(raw);
    if (m) return { wiki: true, target: m[1], alias: m[2] != null ? m[2] : null };
    m = /^\[([^\]]*)\]\((.*)\)$/.exec(raw);
    if (m) return { wiki: false, text: m[1] || file.basename, href: m[2].replace(/^<|>$/g, '') };
    return { wiki: true, target: file.path, alias: null };
  }

  insertFileLink(file: TFile): void {
    if (IMAGE_EXT.test(file.extension)) { this.insertImageFile(file); return; }
    const l = this.buildLink(file);
    const run = (cmd: Command) => cmd(this.pm!.state, tr => this.pm!.dispatch(tr));
    if (l.wiki) run(C.insertInline(schema.nodes.wikilink.create({ target: l.target, alias: l.alias })));
    else run(C.insertText(l.text, [schema.marks.link.create({ href: l.href })]));
    this.pm!.focus();
  }

  insertImageFile(file: TFile, replacePos?: number | null): void {
    const l = this.buildLink(file);
    const attrs = l.wiki ? { src: l.target, wiki: true } : { src: l.href, alt: file.basename, wiki: false };
    this.insertImageAttrs(attrs, replacePos);
  }

  // 插入圖片；replacePos 有值時是「更換圖片」：保留原本的寬度與說明
  insertImageAttrs(attrs: NewImageAttrs, replacePos?: number | null): void {
    const old = replacePos != null ? this.imageAt(replacePos) : null;
    if (old) {
      const oa = old.attrs as ImageAttrs;
      const a = Object.assign({}, attrs, { width: oa.width, title: oa.title });
      if (oa.alt) a.alt = oa.alt;
      const tr = this.pm!.state.tr.setNodeMarkup(replacePos!, null, a);
      tr.setSelection(NodeSelection.create(tr.doc, replacePos!));
      this.pm!.dispatch(tr);
    } else {
      C.insertInline(schema.nodes.image.create(attrs))(this.pm!.state, tr => this.pm!.dispatch(tr));
    }
    this.pm!.focus();
  }

  openNoteLinkPicker(): void {
    if (!this.pm || this.blockedInCode()) return;
    const files = this.app.vault.getFiles().filter(f => f !== this.file && !f.path.startsWith(this.app.vault.configDir + '/'))
      // 筆記排在附件前面，其餘照路徑
      .sort((a, b) => (Number(b.extension === 'md') - Number(a.extension === 'md')) || a.path.localeCompare(b.path));
    new FilePicker(this.app, files, t('輸入筆記或檔案名稱…'), f => this.insertFileLink(f)).open();
  }

  // 沒有 Templater 時用 Obsidian 的核心外掛「範本」：在游標處插入範本內容，支援 {{title}}、{{date}}、{{time}}
  openCoreTemplatePicker(): void {
    if (!this.pm) return;
    const ip = this.app.internalPlugins;
    const core = ip && ip.getPluginById ? ip.getPluginById('templates') : null;
    const opts = core && core.enabled !== false && core.instance ? (core.instance.options || {}) : null;
    const folder = opts && opts.folder ? normalizePath(opts.folder) : '';
    if (!folder) { new Notice(t('請先啟用 Templater 外掛，或在 Obsidian 的核心外掛「範本」設定範本資料夾')); return; }
    const list = this.markdownFilesIn(folder);
    if (!list.length) { new Notice(t('找不到範本（範本資料夾：') + folder + t('）')); return; }
    new FilePicker(this.app, list, t('選擇要套用的範本…'), tf => { void (async () => {
      try {
        let text = await this.app.vault.cachedRead(tf);
        const now = (fmt: string) => (window.moment ? window.moment().format(fmt) : new Date().toLocaleString());
        text = text.replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/, '') // 範本自己的文件屬性不插入
          .replace(/\{\{title\}\}/gi, this.file ? this.file.basename : '')
          .replace(/\{\{(date|time)(?::([^}]+))?\}\}/gi, (m: string, kind: string, f: string | undefined) => now(f || (kind.toLowerCase() === 'date' ? ((opts as TemplateOptions).dateFormat || 'YYYY-MM-DD') : ((opts as TemplateOptions).timeFormat || 'HH:mm'))));
        const frag = stripBids(this.plugin.converter.parseFragment(text).content);
        this.pm!.dispatch(this.pm!.state.tr.replaceSelection(new Slice(frag, 0, 0)).scrollIntoView());
        this.pm!.focus();
      } catch (e) {
        console.error('[Word Mode]', e);
        new Notice(t('套用範本失敗：') + (e && (e as CaughtError).message ? (e as CaughtError).message : String(e)));
      }
    })(); }).open();
  }

  // 某個資料夾（含子資料夾）裡的筆記：只走訪那個資料夾，不列出整個保管庫
  markdownFilesIn(folder: string): TFile[] {
    const root = this.app.vault.getAbstractFileByPath(folder);
    const out: TFile[] = [];
    if (root instanceof TFolder) Vault.recurseChildren(root, f => { if (f instanceof TFile && f.extension === 'md') out.push(f); });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // 套用 Templater 範本：空白筆記直接寫入；已有內容時切到 Markdown 再插入到游標處
  openTemplatePicker(): void {
    if (!this.pm || this.blockedInCode()) return;
    const tp = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['templater-obsidian'];
    if (!tp || !tp.templater) { this.openCoreTemplatePicker(); return; }
    const folder = normalizePath(tp.settings.templates_folder || '');
    // Templater 沒有設定範本資料夾時，它自己也是列出整個保管庫的筆記
    const list = folder ? this.markdownFilesIn(folder) : this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
    if (!list.length) { new Notice(t('找不到範本（範本資料夾：') + (folder || t('未設定')) + t('）')); return; }
    new FilePicker(this.app, list, t('選擇要套用的範本…'), tf => { void (async () => {
      try {
        const doc = this.pm!.state.doc;
        const empty = doc.childCount === 1 && doc.firstChild!.isTextblock && doc.firstChild!.content.size === 0;
        if (empty) {
          if (!this.file) return;
          await tp.templater!.write_template_to_file(tf, this.file);
        } else {
          const leaf = this.leaf;
          await this.plugin.switchToMarkdown(leaf);
          new Notice(t('已切換到 Markdown 編輯並在游標處插入範本；完成後可按右上角切回 Word 模式。'));
          await tp.templater!.append_template_to_active_file(tf);
        }
      } catch (e) {
        console.error('[Word 模式] 套用範本失敗', e);
        new Notice(t('套用範本失敗：') + (e && (e as CaughtError).message ? (e as CaughtError).message : String(e)));
      }
    })(); }).open();
  }

  openImageMenu(btn: HTMLElement | null | undefined, replacePos?: number | null, evt?: MouseEvent): void {
    if (!this.pm || (replacePos == null && this.blockedInCode())) return;
    const m = new Menu();
    // 選單文字用整句翻譯，不拼「插入／更換為」加上來源：各語言的語序不同（日文、韓文動詞在後面），拼起來英文也會少空格
    const replacing = replacePos != null;
    m.addItem(i => i.setTitle(replacing ? t('更換為保管庫裡的圖片…') : t('插入保管庫裡的圖片…')).setIcon('image').onClick(() => {
      const imgs = this.app.vault.getFiles().filter(f => IMAGE_EXT.test(f.extension));
      new FilePicker(this.app, imgs, t('輸入圖片檔名…'), f => this.insertImageFile(f, replacePos)).open();
    }));
    m.addItem(i => i.setTitle(t('從電腦上傳圖片…')).setIcon('upload').onClick(() => {
      const input = createEl('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = replacePos == null;
      input.addEventListener('change', () => { void this.insertUploadedImages(Array.from(input.files || []), replacePos); });
      input.click();
    }));
    m.addItem(i => i.setTitle(replacing ? t('更換為網路圖片（網址）…') : t('插入網路圖片（網址）…')).setIcon('globe').onClick(() => {
      new PromptModal(this.app, t('圖片網址'), '', t('https://…/圖片.png'), v => {
        const url = v.trim();
        if (!url) return;
        this.insertImageAttrs({ src: url, alt: null, wiki: false }, replacePos);
      }).open();
    }));
    if (evt) { m.showAtMouseEvent(evt); return; }
    const r = btn ? btn.getBoundingClientRect() : { left: 200, bottom: 120 };
    m.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  async insertUploadedImages(files: File[], replacePos?: number | null): Promise<void> {
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const ext = (f.name.split('.').pop() || (f.type.split('/')[1] || 'png')).toLowerCase();
        const stamp = window.moment ? window.moment().format('YYYYMMDDHHmmss') : String(Date.now());
        const name = f.name && f.name !== 'image.png' ? f.name : t('貼上的圖片') + '_' + stamp + '.' + ext;
        const path = await this.app.fileManager.getAvailablePathForAttachment(name, this.sourcePath());
        const tf = await this.app.vault.createBinary(path, buf);
        this.insertImageFile(tf, replacePos);
        replacePos = null;
      } catch (e) {
        console.error('[Word 模式] 圖片儲存失敗', e);
        new Notice(t('圖片儲存失敗：') + (e && (e as CaughtError).message ? (e as CaughtError).message : String(e)));
      }
    }
  }
}
