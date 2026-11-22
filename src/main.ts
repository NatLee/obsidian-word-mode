// Word 模式：把 Obsidian 筆記變成像 Office Word 一樣編輯
import { Plugin, WorkspaceLeaf, MarkdownView, TFile, Notice, Platform, apiVersion } from 'obsidian';
import { DEFAULTS } from './settings.js';
import { WordModeSettings } from './settingstab.js';
import type { Settings, LanguageSetting } from './settings.js';
import { t, withKey, setLanguage } from './i18n.js';
import { options as cmdOptions } from './commands.js';
import { autoformatOptions } from './autoformat.js';
import { MarkdownConverter } from './markdown.js';
import { WordModeView, VIEW_TYPE } from './view.js';
import { OutlineView, OUTLINE_TYPE } from './outline.js';
import { MarkdownBar, mdToolbarMode, wantsMdBar } from './mdbar.js';
import { KeyboardWatch } from './keyboard.js';
import { MdStatusBar } from './statusbar.js';
import { closePropsPeek } from './propview.js';
import { cleanTemplates } from './templates.js';
import type { Command, Editor, MarkdownViewModeType, View, ViewState } from 'obsidian';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { DocMeta } from './markdown.js';
import type { OutlineSource } from './outline.js';
import type { TabId } from './ribbon.js';
import type { CommandManager } from './obsidian-internal.js';

// 1.5.7 的型別定義裡 Plugin 沒有宣告 onload（繼承 Component 的 onload(): void），
// 但 Obsidian 載入外掛時會等待 onload 回傳的 Promise；1.7.2 起官方型別也宣告成 Promise<void> | void，這裡照新版補上
declare module 'obsidian' {
  interface Plugin {
    onload(): Promise<void> | void;
  }
}

// 切換模式時保留的編輯狀態（含復原紀錄）；at 是存入的時間（Date.now()）
export interface HistoryEntry {
  at: number;
  state: EditorState;
  meta: DocMeta | null;
  lastOut: string;
}

// leaf.view 的型別只是 View；這裡列出程式會先檢查是否存在、某些檢視才有的成員
// （Markdown 與 Word 模式檢視有 file、save；Markdown 有 editor；Word 模式有 pm、applyZoom）
type LeafView = View & {
  file?: TFile | null;
  save?(): Promise<void>;
  editor?: Editor;
  pm?: EditorView | null;
  applyZoom?(): void;
};
// 檢視可能有上述成員的分頁（getLeavesOfType 取得的 Word 模式分頁，可能還沒載入完成）
type LeafWithView = WorkspaceLeaf & { view: LeafView };

// 調整分頁群組寬度用到的成員：WorkspaceLeaf.parent 不在 1.5.7 的型別定義裡；
// setDimension 與 containerEl 是非公開 API，都可能不存在
interface ResizableItem {
  parent?: ResizableItem | null;
  containerEl?: HTMLElement;
  setDimension?(percent: number): void;
}

// 狀態列有這個外掛的字數時，藏起 Obsidian 內建的字數（核心外掛「字數統計」，CSS 在 styles/word-mode.css）。
// 它只要目前的分頁是 .md 檔就會顯示，Word 模式也一樣；它算 Markdown 原文，數字跟這裡不同，兩組數字並排看不出哪個對
function hideBuiltinCount(statusEl: HTMLElement, hide: boolean): void {
  statusEl.ownerDocument.body.classList.toggle('wm-own-count', hide);
}

export default class WordModePlugin extends Plugin {
  declare settings: Settings;
  // 螢幕鍵盤蓋住多少（只有手機、平板有）
  declare keyboard?: KeyboardWatch;
  declare converter: MarkdownConverter;
  declare forceMarkdown: WeakMap<WorkspaceLeaf, string>;
  declare mdActions: Map<MarkdownView, HTMLElement>;
  declare zoomSave: number | undefined;
  declare history: Map<string, HistoryEntry>;
  declare mdBars: Map<MarkdownView, MarkdownBar>;
  declare lastDoc?: WordModeView | MarkdownView;
  declare lastTab?: TabId;
  declare statusEl: HTMLElement;
  declare barView?: WordModeView | MarkdownView | null;
  declare mdStatusKey?: string | null;
  // Markdown／閱讀模式時狀態列的內容（barView 是 Markdown 檢視時才有）
  declare mdStatus?: MdStatusBar | null;
  declare outlineTimer?: number;
  declare outlineDirty?: boolean;
  declare unloaded?: boolean;
  declare restoreSetViewState?: () => void;

  async onload(): Promise<void> {
    // data.json 不存在時 loadData() 回傳 null
    this.settings = Object.assign({}, DEFAULTS, await this.loadData() as Partial<Settings> | null);
    if (this.settings.ribbonLabels === false && !this.settings.buttonStyleSet) this.settings.buttonStyle = 'icon';
    delete this.settings.ribbonLabels;
    if (this.settings.outlineSidebar === false) this.settings.outlinePlace = 'popup';
    delete this.settings.outlineSidebar;
    // 1.9.0 以前是開關（true／false），換成四選一的值，設定頁的選單才會停在對的選項
    this.settings.mdToolbar = mdToolbarMode(this.settings.mdToolbar);
    this.settings.mathTemplates = cleanTemplates(this.settings.mathTemplates);
    this.settings.diagramTemplates = cleanTemplates(this.settings.diagramTemplates);
    if (!Array.isArray(this.settings.hiddenDiagramKinds)) this.settings.hiddenDiagramKinds = [];
    setLanguage(this.settings.language);
    this.applyOptions();
    this.converter = new MarkdownConverter();
    this.forceMarkdown = new WeakMap(); // leaf -> 使用者手動切回 Markdown 的檔案路徑
    this.mdActions = new Map();
    this.history = new Map(); // 檔案路徑 → 編輯狀態（切換模式時保留復原紀錄）
    // 手機、平板：量螢幕鍵盤蓋住多少，檢視與對話框依此讓出位置。各家裝置、輸入法回報的高度不一樣，
    // 版面不對時要有實際的數字才查得出來，所以附一個把量到的數字複製出來的指令
    if (Platform.isMobile) {
      const kb = new KeyboardWatch(window);
      this.keyboard = kb;
      this.register(kb.start());
      this.addCommand({
        id: 'copy-keyboard-report', name: t('複製螢幕鍵盤的診斷資訊'),
        callback: () => {
          const device = (Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : 'other') + (Platform.isPhone ? ' phone' : ' tablet');
          const text = kb.report(['Word Mode ' + this.manifest.version + ' / Obsidian ' + apiVersion + ' / ' + device]);
          if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => new Notice(t('已複製診斷資訊，可以貼到問題回報裡')));
        },
      });
    }

    this.registerView(VIEW_TYPE, leaf => new WordModeView(leaf, this));
    this.registerView(OUTLINE_TYPE, leaf => new OutlineView(leaf, this));
    // 滑鼠移到筆記連結上時，讓 Obsidian 的「頁面預覽」可以顯示預覽
    if (this.registerHoverLinkSource) this.registerHoverLinkSource(VIEW_TYPE, { display: 'Word Mode', defaultMod: true });
    this.mdBars = new Map();
    this.addRibbonIcon('list-tree', t('大綱（Word 模式）'), () => this.toggleOutline());
    this.addCommand({ id: 'toggle-outline', name: t('開啟／關閉大綱側邊欄'), callback: () => this.toggleOutline() });
    // 記住最後使用的筆記畫面（點側邊欄時仍知道要顯示哪份筆記的大綱）
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      const v: LeafView | null = leaf && leaf.view;
      if (v && v.file && (v instanceof WordModeView || v instanceof MarkdownView)) { this.lastDoc = v; this.outlineChanged(v, true); }
    }));
    this.patchSetViewState();

    this.addCommand({
      id: 'open-word-mode', name: t('以 Word 模式編輯目前筆記'),
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const v = leaf && leaf.view;
        if (!(v instanceof MarkdownView) || !v.file) return false;
        if (!checking) void this.switchToWord(leaf!);
        return true;
      },
    });
    this.addCommand({
      id: 'open-markdown', name: t('以 Markdown 編輯目前筆記'),
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf || !(leaf.view instanceof WordModeView)) return false;
        if (!checking) void this.switchToMarkdown(leaf);
        return true;
      },
    });
    this.addCommand({
      id: 'toggle-mode', name: t('切換 Word 模式／Markdown'),
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return false;
        if (leaf.view instanceof WordModeView) { if (!checking) void this.switchToMarkdown(leaf); return true; }
        if (leaf.view instanceof MarkdownView && leaf.view.file) { if (!checking) void this.switchToWord(leaf); return true; }
        return false;
      },
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem(i => i.setTitle(t('以 Word 模式開啟')).setIcon('file-text').setSection('open').onClick(async () => {
        const l = leaf && leaf.view && (leaf.view as LeafView).file === file ? leaf : this.app.workspace.getLeaf(false);
        this.forceMarkdown.delete(l);
        await l.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      }));
      menu.addItem(i => i.setTitle(t('以 Markdown 開啟')).setIcon('code-2').setSection('open').onClick(async () => {
        const l = leaf && leaf.view && (leaf.view as LeafView).file === file ? leaf : this.app.workspace.getLeaf(false);
        this.forceMarkdown.set(l, file.path);
        await l.setViewState({ type: 'markdown', state: { file: file.path }, active: true });
      }));
    }));

    // Markdown 編輯畫面右上角加一個「Word 模式」按鈕
    const addActions = () => {
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      // 已經關掉的檢視從紀錄裡拿掉，不然每開過一份筆記就多留一個檢視（連同它的編輯器）在記憶體裡
      const open = new Set<unknown>(leaves.map(leaf => leaf.view));
      for (const v of [...this.mdActions.keys()]) if (!open.has(v)) this.mdActions.delete(v);
      leaves.forEach(leaf => {
        const v = leaf.view;
        if (!(v instanceof MarkdownView) || this.mdActions.has(v)) return;
        const btn = v.addAction('file-text', this.settings.ctrlE !== false ? withKey('切換到 Word 模式', 'Mod+E') : t('切換到 Word 模式'), () => this.switchToWord(leaf));
        this.mdActions.set(v, btn);
      });
    };
    this.registerEvent(this.app.workspace.on('layout-change', addActions));
    this.registerEvent(this.app.workspace.on('active-leaf-change', addActions));
    // Markdown／閱讀模式上方的工具列
    this.registerEvent(this.app.workspace.on('layout-change', () => this.syncMdBars()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.syncMdBars()));
    this.registerInterval(window.setInterval(() => {
      for (const b of this.mdBars.values()) b.update();
      // Markdown 的編輯／閱讀切換沒有事件：定時讓狀態列的按鈕跟上（Word 模式的狀態列自己會更新）
      if (!(this.statusDoc() instanceof WordModeView)) this.updateStatus(null);
    }, 700));

    this.addSettingTab(new WordModeSettings(this.app, this));

    // 桌機：Word 模式的存檔狀態、檢視切換、縮放放進 Obsidian 右下角狀態列（字數用 Obsidian 內建的）
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('wm-statusbar');
    this.statusEl.hide();
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateStatus(null)));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.updateStatus(null)));

    // 在 Markdown 畫面按 Ctrl+E（Obsidian 的「切換閱讀／編輯」）：改成切回 Word 模式
    const cmds = this.app.commands;
    if (cmds && cmds.executeCommand) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- the original method is kept so the wrapper can call it with the right `this`
      const orig = cmds.executeCommand;
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the patched function is called with its own `this`, so the plugin is captured in a variable
      const plugin = this;
      const patched = function (this: CommandManager, command: Command, ...rest: unknown[]): boolean {
        try {
          // plugin.unloaded：外掛停用後，如果別的外掛也包了這個函式，這層還原不了，所以自己停止作用
          if (!plugin.unloaded && command && command.id === 'markdown:toggle-preview' && plugin.settings.ctrlE !== false) {
            const v = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (v && v.file && /\.md$/i.test(v.file.path)) { void plugin.switchToWord(v.leaf); return true; }
          }
        } catch (e) { console.error('[Word 模式]', e); }
        return orig.call(this, command, ...rest);
      };
      cmds.executeCommand = patched;
      this.register(() => { if (cmds.executeCommand === patched) cmds.executeCommand = orig; });
    }

    const wordCommand = (id: string, name: string, run: (v: WordModeView) => void) => this.addCommand({
      id, name,
      checkCallback: checking => {
        const v = this.app.workspace.getActiveViewOfType(WordModeView);
        if (!v || !v.pm) return false;
        if (!checking) run(v);
        return true;
      },
    });
    wordCommand('find', t('尋找'), v => v.findBar.open(false));
    wordCommand('replace', t('尋找與取代'), v => v.findBar.open(true));
    wordCommand('shortcuts', t('顯示快速鍵說明'), v => v.toolbar.ctx.dialogs.shortcuts());
    wordCommand('outline', t('大綱：跳到標題'), v => v.toolbar.openOutlinePopup(v.toolbar.dom));

    this.app.workspace.onLayoutReady(() => {
      addActions();
      this.syncMdBars();
      if (!this.settings.openByDefault) return;
      // 啟用外掛時，把已開啟的筆記轉成 Word 模式
      this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
        const f = leaf.view && (leaf.view as LeafView).file;
        if (f && this.eligible(f.path)) void leaf.setViewState({ type: VIEW_TYPE, state: { file: f.path } });
      });
    });
  }

  onunload(): void {
    this.unloaded = true;
    // 縮放剛調完、還沒存就停用外掛：現在存
    if (this.zoomSave != null) { window.clearTimeout(this.zoomSave); this.zoomSave = undefined; void this.saveSettings(); }
    closePropsPeek();
    if (this.statusEl) hideBuiltinCount(this.statusEl, false);
    for (const b of this.mdBars.values()) b.destroy();
    this.mdBars.clear();
    for (const [, btn] of this.mdActions) btn.remove();
    this.mdActions.clear();
    if (this.restoreSetViewState) this.restoreSetViewState();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      const f = leaf.view && (leaf.view as LeafView).file;
      if (f) void leaf.setViewState({ type: 'markdown', state: { file: f.path } });
    });
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  storeHistory(path: string, entry: Omit<HistoryEntry, 'at'>): void {
    this.history.delete(path);
    this.history.set(path, Object.assign({ at: Date.now() }, entry));
    while (this.history.size > 30) this.history.delete(this.history.keys().next().value!);
  }

  takeHistory(path: string): HistoryEntry | null {
    const e = this.history.get(path);
    if (!e) return null;
    this.history.delete(path);
    return Date.now() - e.at < 6 * 3600 * 1000 ? e : null;
  }

  // ---- Markdown／閱讀模式的工具列
  // 每個 Markdown 檢視依設定與它目前的模式（編輯／閱讀）決定要不要有工具列；切換模式、開關分頁、改設定後都會呼叫
  syncMdBars(): void {
    const wanted = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView) || !v.file) continue;
      if (!wantsMdBar(this.settings.mdToolbar, v.getMode())) continue;
      wanted.add(v);
      if (!this.mdBars.has(v)) this.mdBars.set(v, new MarkdownBar(this, v));
    }
    for (const [v, bar] of this.mdBars) if (!wanted.has(v)) { bar.destroy(); this.mdBars.delete(v); }
  }

  // 設定改變：重建所有工具列
  refreshToolbars(): void {
    for (const v of this.views()) v.buildToolbar();
    for (const b of this.mdBars.values()) b.destroy();
    this.mdBars.clear();
    this.syncMdBars();
  }

  // ---- 大綱側邊欄
  docView(): OutlineSource | null {
    const v = this.lastDoc;
    if (v && v.leaf && v.file && this.app.workspace.getLeavesOfType(v.getViewType()).includes(v.leaf)) return v;
    const a = this.app.workspace.getActiveViewOfType(WordModeView) || this.app.workspace.getActiveViewOfType(MarkdownView);
    return a || null;
  }

  outlineOpen(): boolean { return this.app.workspace.getLeavesOfType(OUTLINE_TYPE).length > 0; }

  // 大綱的位置：split＝在筆記左邊另外展開一欄（預設，像第二個側邊欄）；left／right＝放進 Obsidian 的左／右側邊欄
  async toggleOutline(): Promise<void> {
    const ws = this.app.workspace;
    const leaves = ws.getLeavesOfType(OUTLINE_TYPE);
    if (leaves.length) leaves.forEach(l => l.detach());
    else {
      const place = this.settings.outlinePlace === 'popup' ? 'split' : (this.settings.outlinePlace || 'split');
      const d = this.docView();
      let leaf: WorkspaceLeaf;
      if (place === 'split' && d && d.leaf) {
        leaf = ws.createLeafBySplit(d.leaf, 'vertical', true);
        await leaf.setViewState({ type: OUTLINE_TYPE, active: false });
        this.narrowLeaf(leaf, d.leaf);
      } else {
        const side = place === 'right' ? ws.getRightLeaf(false) : ws.getLeftLeaf(false);
        if (!side) return;
        leaf = side;
        await leaf.setViewState({ type: OUTLINE_TYPE, active: false });
        ws.revealLeaf(leaf);
      }
      if (d && d.leaf) ws.setActiveLeaf(d.leaf, { focus: true });
    }
    for (const v of this.views()) if (v.toolbar) v.toolbar.refresh();
    for (const b of this.mdBars.values()) b.update();
  }

  // 新展開的大綱欄寬度約 260px（其餘留給筆記）
  narrowLeaf(leaf: WorkspaceLeaf & ResizableItem, docLeaf: WorkspaceLeaf & ResizableItem): void {
    try {
      // 分割後兩邊都在同一個 split 裡，各自是一組分頁（tabs）；設定兩組的比例
      const mine = leaf.parent && leaf.parent.setDimension ? leaf.parent : leaf;
      const other = docLeaf.parent && docLeaf.parent.setDimension ? docLeaf.parent : docLeaf;
      const host = mine.containerEl && mine.containerEl.parentElement;
      const total = host ? host.getBoundingClientRect().width : 1200;
      const pct = Math.max(12, Math.min(35, 260 / (total || 1200) * 100));
      if (mine.setDimension) mine.setDimension(pct);
      if (other !== mine && other.setDimension) other.setDimension(100 - pct);
    } catch { /* 用預設寬度 */ }
  }



  outlineChanged(view: WordModeView | MarkdownView, docChanged: boolean): void {
    if (!this.outlineOpen()) return;
    // 內容改過就記下來：之後只移動游標的更新不能把「要重讀標題」蓋掉
    if (docChanged) this.outlineDirty = true;
    const run = () => {
      const dirty = this.outlineDirty;
      this.outlineDirty = false;
      for (const l of this.app.workspace.getLeavesOfType(OUTLINE_TYPE)) {
        const ov = l.view;
        if (!(ov instanceof OutlineView)) continue;
        if (dirty || ov.source !== this.docView()) ov.refresh(); else ov.markCurrent();
      }
    };
    window.clearTimeout(this.outlineTimer);
    // 只移動游標：立刻標出目前的標題；內容有改：停手一下再重讀標題
    if (this.outlineDirty) this.outlineTimer = window.setTimeout(run, 300); else run();
  }

  applyOptions(): void {
    cmdOptions.wordAtCursor = this.settings.wordAtCursor !== false;
    autoformatOptions.enabled = this.settings.autoFormat !== false;
  }

  views(): WordModeView[] { return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter((v): v is WordModeView => v instanceof WordModeView); }

  async setFullWidth(on: boolean): Promise<void> {
    this.settings.fullWidth = !!on;
    for (const v of this.views()) { v.contentEl.toggleClass('wm-full-width', !!on); if (v.pm) v.toolbar.update(v.pm.state); }
    await this.saveSettings();
  }

  // 詳細提示（動畫提示）：快速鍵說明裡的開關用。提示是建立按鈕時掛上的，所以要重建工具列
  async setRichHints(on: boolean): Promise<void> {
    this.settings.richHints = !!on;
    await this.saveSettings();
    this.refreshToolbars();
  }

  applyPropsLook(): void { for (const v of this.views()) v.applyPropsLook(); }

  async setPropsSticky(on: boolean): Promise<void> {
    this.settings.propsSticky = !!on;
    for (const v of this.views()) v.applyPropsSticky();
    await this.saveSettings();
  }

  openSettings(): void {
    const s = this.app.setting;
    if (!s) return;
    s.open();
    s.openTabById(this.manifest.id);
  }

  // 重新開啟所有 Word 模式的分頁（版面設定改變時）；編輯紀錄會保留
  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE) as LeafWithView[]) {
      const st = leaf.getViewState();
      if (leaf.view && leaf.view.save) await leaf.view.save();
      await leaf.setViewState({ type: 'empty', state: {} });
      await leaf.setViewState(st);
    }
  }

  // 換語言：重新載入外掛，讓所有文字（含命令名稱）都換成新語言
  async changeLanguage(lang: LanguageSetting): Promise<void> {
    this.settings.language = lang;
    await this.saveSettings();
    const id = this.manifest.id;
    const plugins = this.app.plugins;
    if (!plugins || !plugins.disablePlugin || !plugins.enablePlugin) { new Notice(t('請重新啟動 Obsidian 讓語言設定生效')); return; }
    const reopen = this.app.setting && this.app.setting.activeTab && this.app.setting.activeTab.id === id;
    await plugins.disablePlugin(id);
    await plugins.enablePlugin(id);
    if (reopen) window.setTimeout(() => { try { this.app.setting!.openTabById(id); } catch { /* 忽略 */ } }, 100);
  }

  setZoom(z: number): void {
    this.settings.zoom = Math.max(50, Math.min(200, Math.round(z / 10) * 10));
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l: LeafWithView) => { if (l.view.applyZoom) l.view.applyZoom(); });
    // 按著 Ctrl 滾滾輪、拖縮放滑桿都會連續呼叫很多次：畫面馬上跟著變，設定等停下來再存一次，
    // 不用每一格都寫一次 data.json
    window.clearTimeout(this.zoomSave);
    this.zoomSave = window.setTimeout(() => { this.zoomSave = undefined; void this.saveSettings(); }, 400);
  }

  // 狀態列要顯示哪一份筆記。平常是目前的分頁；焦點在側邊欄（檔案總管、大綱、搜尋結果）時，
  // 是主編輯區最近用過的那個分頁。getActiveViewOfType() 只看「目前有焦點的分頁」，焦點一到側邊欄就回傳 null，
  // 只靠它的話，點一下檔案總管，字數與存檔狀態就不見了
  statusDoc(): WordModeView | MarkdownView | null {
    const ws = this.app.workspace;
    const active = ws.getActiveViewOfType(WordModeView) || ws.getActiveViewOfType(MarkdownView);
    if (active) return active;
    // 主編輯區（含獨立視窗）最近用過、而且看得到的分頁。它是圖片、關聯圖這類別的檢視時就沒有筆記可以顯示
    const leaf = ws.getMostRecentLeaf();
    const v = leaf ? leaf.view : null;
    return v instanceof WordModeView || v instanceof MarkdownView ? v : null;
  }

  updateStatus(view: WordModeView | null): void {
    const el = this.statusEl;
    if (!el) return;
    const doc = this.statusDoc();
    const active = doc instanceof WordModeView ? doc : null;
    if (view && view !== active) return;
    if (Platform.isMobile) { el.hide(); this.hideMdStatus(); return; }
    if (active && active.pm) {
      el.show();
      if (this.barView !== active || !el.childElementCount) {
        el.empty();
        active.buildBottomBar(el, true);
        this.barView = active;
      } else active.renderStatus();
      hideBuiltinCount(el, true);
      this.mdStatusKey = null; this.mdStatus = null;
      return;
    }
    // Markdown 編輯與閱讀模式：狀態列放跟 Word 模式一樣的內容（字數、存檔狀態、檢視切換、文件屬性、縮放）
    const md = this.settings.mdStatusBar !== false && doc instanceof MarkdownView ? doc : null;
    if (!md || !md.file || !/\.md$/i.test(md.file.path)) { this.hideMdStatus(); el.hide(); return; }
    const mode = md.getMode && md.getMode() === 'preview' ? 'preview' : 'source';
    const stamp = md.file.path + '|' + mode;
    el.show();
    hideBuiltinCount(el, true);
    if (this.barView === md && this.mdStatusKey === stamp && this.mdStatus && el.childElementCount) { this.mdStatus.update(); return; }
    this.barView = md;
    this.mdStatusKey = stamp;
    this.mdStatus = new MdStatusBar(this, el, md);
  }

  // 狀態列不再顯示 Markdown 檢視的內容（換到 Word 模式、其他檢視，或關掉設定）
  hideMdStatus(): void {
    if (this.statusEl) hideBuiltinCount(this.statusEl, false);
    this.barView = null; this.mdStatusKey = null; this.mdStatus = null;
  }

  // 換了字數的算法：重算每個 Word 模式分頁與狀態列的字數
  refreshCounts(): void {
    for (const v of this.views()) v.updateCount();
    this.hideMdStatus();
    this.updateStatus(null);
  }

  // 切換 Obsidian 的 Markdown 編輯／閱讀模式
  async setMarkdownMode(view: MarkdownView, mode: MarkdownViewModeType): Promise<void> {
    const st = view.getState() as Record<string, unknown>;
    st.mode = mode;
    if (mode === 'source') st.source = false;
    await view.setState(st, { history: false });
    for (const b of this.mdBars.values()) b.update();
    this.updateStatus(null);
    if (mode === 'source' && view.editor) view.editor.focus();
  }


  excluded(): string[] {
    return this.settings.excludeFolders.split(/[\n,]/).map(s => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
  }

  eligible(path: string): boolean {
    if (!/\.md$/i.test(path)) return false;
    if (path.startsWith(this.app.vault.configDir + '/')) return false;
    if (this.excluded().some(d => path === d || path.startsWith(d + '/'))) return false;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      if (f.stat && f.stat.size > (+this.settings.maxSizeMB || 2) * 1024 * 1024) return false;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm && (fm['kanban-plugin'] || fm['excalidraw-plugin'] || fm['word-mode'] === false)) return false;
    }
    return true;
  }

  // 開啟 Markdown 筆記時，自動改用 Word 模式
  patchSetViewState(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the patched function is called with its own `this`, so the plugin is captured in a variable
    const plugin = this;
    const proto = WorkspaceLeaf.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the original method is kept so the wrapper can call it with the right `this`
    const orig = proto.setViewState;
    const patched = function (this: WorkspaceLeaf, state: ViewState, eState?: unknown): Promise<void> {
      try {
        // ViewState.state 的型別是 any；這裡只讀 file
        const viewState = state && (state.state as { file?: unknown } | null | undefined);
        if (!plugin.unloaded && plugin.settings.openByDefault && state && state.type === 'markdown' && viewState && typeof viewState.file === 'string') {
          const file: string = viewState.file;
          const forced = plugin.forceMarkdown.get(this);
          if (forced !== file && plugin.eligible(file)) {
            plugin.forceMarkdown.delete(this);
            const next = Object.assign({}, state, { type: VIEW_TYPE, state: { file } });
            return orig.call(this, next, eState);
          }
        }
      } catch (e) { console.error('[Word 模式]', e); }
      return orig.call(this, state, eState);
    };
    proto.setViewState = patched;
    this.restoreSetViewState = () => { if (proto.setViewState === patched) proto.setViewState = orig; };
  }

  async switchToMarkdown(leaf: WorkspaceLeaf, mode?: MarkdownViewModeType): Promise<void> {
    const v = leaf.view;
    if (!(v instanceof WordModeView) || !v.file) return;
    const path = v.file.path;
    await v.save();
    v.cacheHistory();
    this.forceMarkdown.set(leaf, path);
    const state = mode === 'preview' ? { file: path, mode: 'preview' } : { file: path, mode: 'source', source: false };
    await leaf.setViewState({ type: 'markdown', state, active: true });
    // 馬上放上 Markdown 的工具列（不等版面事件），切換時上方不會空一下
    this.syncMdBars();
    window.setTimeout(() => { const nv: LeafView = leaf.view; if (nv && nv.editor && mode !== 'preview') nv.editor.focus(); }, 50);
  }

  async switchToWord(leaf: WorkspaceLeaf): Promise<void> {
    const v = leaf.view;
    if (!(v instanceof MarkdownView) || !v.file) return;
    const path = v.file.path;
    await v.save();
    this.forceMarkdown.delete(leaf);
    await leaf.setViewState({ type: VIEW_TYPE, state: { file: path }, active: true });
    window.setTimeout(() => { const nv: LeafView = leaf.view; if (nv && nv.pm) nv.pm.focus(); }, 50);
  }
}
