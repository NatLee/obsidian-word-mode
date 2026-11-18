// Word 模式：把 Obsidian 筆記變成像 Office Word 一樣編輯
import { Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownView, TFile, Notice, setIcon, Platform, loadMathJax, renderMath, finishRenderMath } from 'obsidian';
import { t, withKey, key, setLanguage, getLanguage } from './i18n.js';
import { options as cmdOptions } from './commands.js';
import { autoformatOptions } from './autoformat.js';
import { MarkdownConverter } from './markdown.js';
import { WordModeView, VIEW_TYPE } from './view.js';
import { OutlineView, OUTLINE_TYPE } from './outline.js';
import { MarkdownBar } from './mdbar.js';
import { TABS } from './toolbar.js';
import { fillGroupSettings } from './groupsettings.js';
import { buildSettingNav, showSettingSection, trackSettingPadding } from './settingsnav.js';
import { ShortcutModal } from './dialogs.js';
import { DIAGRAM_KINDS, detectKind } from './diagrams.js';
import { cleanTemplates } from './templates.js';
import { buildTemplateManager } from './templateui.js';
import type { App, Command, Editor, MarkdownViewModeType, View, ViewState } from 'obsidian';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Language, I18nKey } from './i18n.js';
import type { DocMeta } from './markdown.js';
import type { OutlineSource } from './outline.js';
import type { RibbonLayout, ButtonStyle, TabId, GroupId, TabStyle } from './toolbar.js';
import type { EquationEditMode } from './dialogs.js';
import type { SettingNav } from './settingsnav.js';
import type { MermaidTab } from './mermaid.js';
import type { SavedTemplate } from './templates.js';
import type { CommandManager } from './obsidian-internal.js';

// 1.5.7 的型別定義裡 Plugin 沒有宣告 onload（繼承 Component 的 onload(): void），
// 但 Obsidian 載入外掛時會等待 onload 回傳的 Promise；1.7.2 起官方型別也宣告成 Promise<void> | void，這裡照新版補上
declare module 'obsidian' {
  interface Plugin {
    onload(): Promise<void> | void;
  }
}

// 介面語言設定：auto＝跟隨 Obsidian 的語言
export type LanguageSetting = 'auto' | Language;
// 工具列位置：auto＝手機放下方、平板與電腦放上方
export type ToolbarPosition = 'auto' | 'top' | 'bottom';
// 大綱的位置：split＝在筆記旁另開一欄、left／right＝Obsidian 的左／右側邊欄、popup＝下拉選單
export type OutlinePlace = 'split' | 'left' | 'right' | 'popup';
// 同步衝突的處理方式：ask＝每次詢問、both＝自動兩份都保留
export type ConflictMode = 'ask' | 'both';
// 右鍵選單中可在設定隱藏的區段（設定 hiddenCtx 存的值）
export type ContextMenuSection = 'table' | 'clipboard' | 'format' | 'paragraph' | 'insert' | 'tools';

// 外掛設定（存在 data.json）；有 ? 的欄位只在使用者設定過、或舊版設定檔裡才有
export interface Settings {
  // ---- 一般
  language: LanguageSetting;
  openByDefault: boolean;
  // 不使用 Word 模式的資料夾，以換行或逗號分隔
  excludeFolders: string;
  // ---- 編輯
  ctrlE: boolean;
  wordAtCursor: boolean;
  autoFormat: boolean;
  autoComplete: boolean;
  pasteChip: boolean;
  keepHistory: boolean;
  // ---- 顯示
  fullWidth: boolean;
  // 頁面縮放百分比（50–200）
  zoom: number;
  showMarks: boolean;
  highlightWeird: boolean;
  toolbarPosition: ToolbarPosition;
  // ---- 工具列
  ribbonLayout: RibbonLayout;
  buttonStyle: ButtonStyle;
  // 使用者自己選過按鈕樣式（之後不再依舊設定 ribbonLabels 改成只顯示圖示）
  buttonStyleSet?: boolean;
  groupLabels: boolean;
  // 「檢視」分頁的三個檢視模式按鈕（Word 模式／Markdown／閱讀）要不要顯示文字
  viewButtonLabels: boolean;
  hiddenTabs: TabId[];
  hiddenGroups: GroupId[];
  // 自訂的按鈕群組（toolbar.ts 的 groupLayout 套用）：名稱（群組 id → 名稱）、
  // 移到哪個分頁（群組 id → 分頁 id，只存有移動過的）、順序（群組 id，空的＝預設順序）
  groupNames: Partial<Record<GroupId, string>>;
  groupTabs: Partial<Record<GroupId, TabId>>;
  groupOrder: GroupId[];
  richHints: boolean;
  mdToolbar: boolean;
  mdStatusBar: boolean;
  outlinePlace: OutlinePlace;
  // 分頁列的樣式（文字、圖示、圖示加文字、收成選單）與自訂的分頁名稱（分頁 id → 名稱）
  tabStyle: TabStyle;
  tabLabels: Partial<Record<TabId, string>>;
  // 上次選的字型色彩（CSS 色碼）
  lastFontColor?: string;
  // 上次選的醒目提示色彩（CSS 色碼）；空字串＝預設黃色
  lastHighlight?: string;
  // 最近使用的自訂色彩（最新的在前）
  recentFontColors?: string[];
  recentHighlights?: string[];
  // ---- 右鍵選單與方程式
  ctxMenu: boolean;
  hiddenCtx: ContextMenuSection[];
  mathDisplay: boolean;
  mathMode: EquationEditMode;
  mermaidMode: MermaidTab;
  codePreview: boolean;
  // 很長的圖表與查詢結果先收合成固定的高度
  collapseTall: boolean;
  // 程式碼區塊顯示行號（開啟時不自動換行）
  codeLineNumbers: boolean;
  // 最近使用的方程式（LaTeX 原始碼，最新的在前）
  recentMath: string[];
  // 自己存的公式與圖表範本（名稱加原始碼），在編輯器裡存、在設定頁管理
  mathTemplates: SavedTemplate[];
  diagramTemplates: SavedTemplate[];
  // 圖表編輯器上方不列出來的內建圖表種類（DiagramKind 的 id）
  hiddenDiagramKinds: string[];
  // 插入新圖表時一開始的內容：''＝流程圖、'kind:<id>'＝某一種內建圖表、'tpl:<名稱>'＝自己存的範本
  defaultDiagram: string;
  // ---- 同步與檔案
  conflict: ConflictMode;
  maxSizeMB: number;
  // ---- 舊版設定（載入時轉換後刪除）
  // false＝舊版的「按鈕不顯示文字」
  ribbonLabels?: boolean;
  // false＝舊版的「不使用大綱側邊欄」
  outlineSidebar?: boolean;
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

// 設定中值是 true／false 的欄位（設定頁的開關使用）
type ToggleKey = { [K in keyof Settings]-?: Settings[K] extends boolean | undefined ? K : never }[keyof Settings];

const DEFAULTS: Settings = {
  // 一般
  language: 'auto',
  openByDefault: true,
  excludeFolders: '_模板',
  // 編輯
  ctrlE: true,
  wordAtCursor: true,
  autoFormat: true,
  autoComplete: true,
  pasteChip: true,
  keepHistory: true,
  // 顯示
  fullWidth: false,
  zoom: 100,
  showMarks: false,
  highlightWeird: true,
  toolbarPosition: 'auto',
  // 工具列
  ribbonLayout: 'tabs',
  buttonStyle: 'auto',
  groupLabels: false,
  viewButtonLabels: true,
  hiddenTabs: [],
  hiddenGroups: [],
  groupNames: {},
  groupTabs: {},
  groupOrder: [],
  tabStyle: 'text',
  tabLabels: {},
  richHints: false,
  mdToolbar: true,
  mdStatusBar: true,
  outlinePlace: 'split',
  // 右鍵選單與方程式
  ctxMenu: true,
  hiddenCtx: [],
  mathDisplay: false,
  mathMode: 'visual',
  mermaidMode: 'visual',
  codePreview: true,
  collapseTall: true,
  codeLineNumbers: false,
  recentMath: [],
  mathTemplates: [],
  diagramTemplates: [],
  hiddenDiagramKinds: [],
  defaultDiagram: '',
  // 同步與檔案
  conflict: 'ask',
  maxSizeMB: 2,
};

export default class WordModePlugin extends Plugin {
  declare settings: Settings;
  declare converter: MarkdownConverter;
  declare forceMarkdown: WeakMap<WorkspaceLeaf, string>;
  declare mdActions: Map<MarkdownView, HTMLElement>;
  declare history: Map<string, HistoryEntry>;
  declare mdBars: Map<MarkdownView, MarkdownBar>;
  declare lastDoc?: WordModeView | MarkdownView;
  declare lastTab?: TabId;
  declare statusEl: HTMLElement;
  declare barView?: WordModeView | MarkdownView | null;
  declare mdStatusKey?: string | null;
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
    this.settings.mathTemplates = cleanTemplates(this.settings.mathTemplates);
    this.settings.diagramTemplates = cleanTemplates(this.settings.diagramTemplates);
    if (!Array.isArray(this.settings.hiddenDiagramKinds)) this.settings.hiddenDiagramKinds = [];
    setLanguage(this.settings.language);
    this.applyOptions();
    this.converter = new MarkdownConverter();
    this.forceMarkdown = new WeakMap(); // leaf -> 使用者手動切回 Markdown 的檔案路徑
    this.mdActions = new Map();
    this.history = new Map(); // 檔案路徑 → 編輯狀態（切換模式時保留復原紀錄）

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
      this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
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
      if (!this.app.workspace.getActiveViewOfType(WordModeView)) this.updateStatus(null);
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
  syncMdBars(): void {
    const want = this.settings.mdToolbar !== false;
    const live = new Set();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView) || !v.file) continue;
      live.add(v);
      if (want && !this.mdBars.has(v)) this.mdBars.set(v, new MarkdownBar(this, v));
    }
    for (const [v, bar] of this.mdBars) if (!want || !live.has(v)) { bar.destroy(); this.mdBars.delete(v); }
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

  async setZoom(z: number): Promise<void> {
    this.settings.zoom = Math.max(50, Math.min(200, Math.round(z / 10) * 10));
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l: LeafWithView) => { if (l.view.applyZoom) l.view.applyZoom(); });
    await this.saveSettings();
  }

  updateStatus(view: WordModeView | null): void {
    const el = this.statusEl;
    if (!el) return;
    const active = this.app.workspace.getActiveViewOfType(WordModeView);
    if (view && view !== active) return;
    if (Platform.isMobile) { el.hide(); this.barView = null; return; }
    if (active && active.pm) {
      el.show();
      if (this.barView !== active || !el.childElementCount) {
        el.empty();
        active.buildBottomBar(el, true);
        this.barView = active;
      } else active.renderStatus();
      this.mdStatusKey = null;
      return;
    }
    // Markdown 編輯與閱讀模式：狀態列一樣放檢視切換按鈕（只有圖示），位置與 Word 模式相同
    const md = this.settings.mdStatusBar !== false ? this.app.workspace.getActiveViewOfType(MarkdownView) : null;
    if (!md || !md.file || !/\.md$/i.test(md.file.path)) { el.hide(); this.barView = null; this.mdStatusKey = null; return; }
    const mode = md.getMode && md.getMode() === 'preview' ? 'preview' : 'source';
    const stamp = md.file.path + '|' + mode;
    el.show();
    if (this.barView === md && this.mdStatusKey === stamp && el.childElementCount) return;
    el.empty();
    this.barView = md;
    this.mdStatusKey = stamp;
    const views = el.createDiv('wm-bb-views');
    const btn = (icon: string, title: string, on: boolean, run: () => void) => {
      const b = views.createEl('button', { cls: 'wm-bb-btn' + (on ? ' is-active' : '') });
      b.setAttribute('aria-label', title);
      setIcon(b, icon);
      b.addEventListener('click', run);
    };
    btn('file-text', this.settings.ctrlE !== false ? withKey('Word 模式', 'Mod+E') : t('Word 模式'), false, () => { void this.switchToWord(md.leaf); });
    btn('code-2', t('Markdown 編輯') + (mode === 'source' ? t('（目前）') : ''), mode === 'source', () => { void this.setMarkdownMode(md, 'source'); });
    btn('book-open', t('閱讀模式') + (mode === 'preview' ? t('（目前）') : ''), mode === 'preview', () => { void this.setMarkdownMode(md, 'preview'); });
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

// ---- 設定頁
// 設定頁的內容只在 settingSections() 描述一次。Obsidian 1.13 以前由 display() 依序畫出來；
// 1.13 起 Obsidian 改用 getSettingDefinitions() 回傳的定義畫設定頁（有定義時不再呼叫 display()），設定搜尋也用這份定義。
// 兩條路徑的名稱、說明與控制項（含 onChange）都來自同一份資料

// 設定頁的一列；name、desc 是已翻譯的文字
//   setting：一般的設定列。build 在 Obsidian 的 Setting 上加控制項（開關、下拉選單、滑桿、文字框、按鈕）；
//            名稱與說明由畫設定頁的一方設定，build 不再設定。build 的回傳值不使用
//   grid：自訂的勾選區塊（顯示的分頁與按鈕群組、右鍵選單要顯示的項目）。fill 在格線容器裡放勾選框；
//         cls 是 display() 畫的區塊外框的 CSS class
//   note：一段說明文字，不是設定；cls 是 display() 畫的段落另外加的 CSS class
type SettingRow =
  | { kind: 'setting'; name: string; desc: string; build: (setting: Setting) => unknown }
  | { kind: 'grid'; name: string; desc?: string; cls: string; fill: (grid: HTMLElement) => void }
  | { kind: 'note'; desc: string; cls?: string };

// 設定頁的分類。設定頁上方有一條分類列，一次只顯示一類（見 settingsnav.ts）。
// 加一類時，styles/word-mode.css 的「設定頁：分類列」也要加一條對應的隱藏規則
type SectionId = 'general' | 'edit' | 'display' | 'toolbar' | 'ctx' | 'math' | 'sync' | 'advanced';

// 設定頁的一類：heading 是分類列上的名稱，icon 是名稱前的圖示
interface SettingSection {
  id: SectionId;
  heading: I18nKey;
  icon: string;
  rows: SettingRow[];
}

// Obsidian 1.13 起 getSettingDefinitions() 回傳的設定定義。外掛支援 Obsidian 1.5.7 起的版本，
// obsidian 套件的型別刻意固定在 1.5.7，裡面沒有這些型別，所以只在這裡宣告用到的欄位；
// 欄位與 1.13 型別定義裡的 SettingDefinitionRender（name、desc、searchable、render）及 SettingDefinitionGroup（type、heading、items）相同
interface SettingDefinitionRender {
  name: string;
  desc?: string;
  // false：不列入設定搜尋
  searchable?: boolean;
  // Obsidian 建立這一列的 Setting、設好名稱與說明後呼叫，在 setting 上加控制項。
  // 回傳的函式會在這一列重畫或移除前呼叫；Obsidian 會把任何有值的回傳值當成這個函式，所以不要回傳別的東西
  render: (setting: Setting) => void | (() => void);
}
interface SettingDefinitionGroup {
  type: 'group';
  heading?: string;
  // 加在群組外框上的 CSS class（多個用空白分開）
  cls?: string;
  items: SettingDefinitionRender[];
}

// 設定頁的內容。每次畫設定頁或取得定義時重新建立，讀的是當時的 plugin.settings
function settingSections(settingTab: WordModeSettings): SettingSection[] {
  const p = settingTab.plugin;
  const S = p.settings;
  const save = async () => { p.applyOptions(); await p.saveSettings(); };
  const toggle = (setting: Setting, k: ToggleKey, after?: (v: boolean) => unknown) => setting.addToggle(tg => tg.setValue(!!(S[k] == null ? DEFAULTS[k] : S[k])).onChange(async v => { S[k] = v; await save(); if (after) after(v); }));
  const rebuild = async () => { await save(); p.refreshToolbars(); };
  const row = (name: string, desc: string, build: (setting: Setting) => unknown): SettingRow => ({ kind: 'setting', name, desc, build });
  const toggleRow = (name: string, desc: string, k: ToggleKey, after?: (v: boolean) => unknown): SettingRow => row(name, desc, s => toggle(s, k, after));

  return [
    // ------------------------------------------------ 一般
    { id: 'general', heading: '一般', icon: 'settings', rows: [
      row(t('介面語言'), t('Word 模式的按鈕、選單與提示文字使用的語言。「自動」會跟著 Obsidian 的語言。'),
        s => s.addDropdown(d => d.addOptions({ auto: t('自動（跟隨 Obsidian）'), 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어' })
          .setValue(S.language || 'auto').onChange(v => p.changeLanguage(v as LanguageSetting)))),
      toggleRow(t('預設用 Word 模式開啟筆記'), t('開啟 .md 筆記時自動使用 Word 模式。可隨時用右上角按鈕切回 Markdown。'), 'openByDefault'),
      row(t('不使用 Word 模式的資料夾'), t('每行一個資料夾（例如模板資料夾），裡面的筆記一律用 Markdown 開啟。'),
        s => s.addTextArea(ta => ta.setValue(S.excludeFolders).onChange(async v => { S.excludeFolders = v; await save(); }))),
    ] },

    // ------------------------------------------------ 編輯
    { id: 'edit', heading: '編輯', icon: 'pencil', rows: [
      toggleRow(withKey('切換 Word 模式與 Markdown', 'Mod+E'),
        t('開啟時，在 Markdown 畫面按 {k} 會回到 Word 模式（取代 Obsidian 原本的「切換閱讀／編輯」）。閱讀模式可用下方狀態列的按鈕開啟。', { k: key('Mod+E') }), 'ctrlE'),
      toggleRow(t('沒有選取文字時，格式套用到游標所在的詞'),
        t('像 Word 一樣：游標在詞中間按粗體，整個詞會變粗體。關閉後只影響接下來輸入的文字。'), 'wordAtCursor'),
      toggleRow(t('輸入時自動套用格式'),
        t('段落開頭打「- 」「1. 」「# 」「> 」「[ ] 」會變成清單、編號、標題、引文、核取清單；打完 **粗體**、*斜體*、`程式碼`、[[筆記]] 也會直接變成格式。套用格式是獨立的一步：按一次 {k}（或緊接著按 Backspace）只取消格式，打的字還在。', { k: key('Mod+Z') }), 'autoFormat'),
      toggleRow(t('輸入 [[ 與 # 時顯示選單'),
        t('打 [[ 會列出筆記（[[筆記# 列出標題），打 # 會列出用過的標籤，用方向鍵與 Enter 選擇。'), 'autoComplete'),
      toggleRow(t('貼上 Markdown 文字時顯示「轉成格式」選項'),
        t('從 ChatGPT 等地方複製的 Markdown 純文字，貼上後可一鍵轉成粗體、標題、清單等格式。'), 'pasteChip'),
      toggleRow(t('切換模式時保留復原紀錄'),
        t('切到 Markdown 編輯再切回來，仍可用 {k} 復原之前的修改（最多保留 30 份筆記、6 小時）。', { k: key('Mod+Z') }), 'keepHistory'),
    ] },

    // ------------------------------------------------ 顯示
    { id: 'display', heading: '顯示', icon: 'monitor', rows: [
      toggleRow(t('全寬頁面'), t('關閉時以 A4 紙張寬度顯示，開啟時使用整個視窗寬度。'), 'fullWidth', v => p.setFullWidth(v)),
      row(t('頁面縮放'), t('也可以用 {k}+滑鼠滾輪，或右下角的縮放列調整。', { k: key('Mod') }),
        s => s.addSlider(sl => sl.setLimits(50, 200, 10).setValue(S.zoom || 100).setDynamicTooltip().onChange(v => p.setZoom(v)))),
      toggleRow(t('開啟筆記時顯示編輯標記（¶）'),
        t('顯示空白（·）、全形空白（□）、Tab（→）、換行（↵）與段落結尾（¶）。也可以用工具列的 ¶ 按鈕隨時切換。'), 'showMarks'),
      toggleRow(t('顯示圖表與查詢的結果'),
        t('Mermaid 圖表、Dataview 查詢與其他外掛的程式碼區塊顯示成結果（像 Obsidian 的閱讀畫面）。游標進到區塊裡，或按區塊上方的「原始碼」按鈕，才顯示程式碼。關閉後一律顯示程式碼。'), 'codePreview', () => p.refreshViews()),
      toggleRow(t('很長的圖表先收合'), t('圖表或查詢的結果很高時，先收合成固定的高度，下面有「顯示完整內容」可以展開。關閉後一律顯示完整的內容。'), 'collapseTall', () => p.refreshViews()),
      toggleRow(t('程式碼區塊顯示行號'),
        t('在程式碼左邊顯示行號。開啟時太長的行不會自動換行，改成左右捲動。'), 'codeLineNumbers', () => p.refreshViews()),
      toggleRow(t('一直標示奇怪符號'),
        t('即使沒開編輯標記，也用紅色波浪底線標出看不見的字元、亂碼、殘留的 ** == [[ 與落單的引號。可到「校閱 → 清理符號」一次清除。'), 'highlightWeird', () => p.refreshViews()),
    ] },

    // ------------------------------------------------ 工具列
    { id: 'toolbar', heading: '工具列', icon: 'layout-panel-top', rows: [
      row(t('版面'), t('「分頁」像 Word（常用／插入／校閱／檢視）；「一行」把所有按鈕排成一行，可左右捲動；「自動換行」把所有按鈕都顯示出來，放不下就換行。'),
        s => s.addDropdown(d => d.addOptions({ tabs: t('分頁（像 Word）'), single: t('全部排成一行'), wrap: t('全部顯示（自動換行）') })
          .setValue(S.ribbonLayout || 'tabs').onChange(async v => { S.ribbonLayout = v as RibbonLayout; await rebuild(); }))),
      row(t('按鈕樣式'), t('「自動」：常用功能只顯示圖示，插入、校閱、檢視的按鈕下方有名稱。「只顯示圖示」最精簡；「圖示加文字」每個按鈕都有名稱。'),
        s => s.addDropdown(d => d.addOptions({ auto: t('自動'), icon: t('只顯示圖示'), label: t('圖示加文字') })
          .setValue(S.buttonStyle || 'auto').onChange(async v => { S.buttonStyle = v as ButtonStyle; S.buttonStyleSet = true; await rebuild(); }))),
      row(t('分頁列的樣式'), t('「常用／插入／校閱／檢視」這一列的顯示方式。「只顯示圖示」最省空間；「收成選單」不佔一列，改成按鈕列最前面的一個按鈕，按下去選分頁。版面是「分頁」時才有作用。'),
        s => s.addDropdown(d => d.addOptions({ text: t('文字'), icon: t('只顯示圖示'), both: t('圖示加文字'), menu: t('收成選單（不佔一列）') })
          .setValue(S.tabStyle || 'text').onChange(async v => { S.tabStyle = v as TabStyle; await rebuild(); }))),
      { kind: 'grid', name: t('分頁名稱'), desc: t('可以把分頁改成自己習慣的名稱；留白就用預設名稱。'), cls: 'wm-settings-groups wm-settings-tabnames', fill: box => {
        for (const [tab, tabLabel] of TABS) {
          const l = box.createEl('label', { cls: 'wm-settings-tabname' });
          l.createSpan({ text: t(tabLabel) });
          const input = l.createEl('input', { type: 'text' });
          input.placeholder = t(tabLabel);
          input.value = (S.tabLabels || {})[tab] || '';
          input.maxLength = 20;
          input.addEventListener('change', () => {
            const labels = Object.assign({}, S.tabLabels);
            const v = input.value.trim();
            if (v) labels[tab] = v; else delete labels[tab];
            S.tabLabels = labels;
            void rebuild();
          });
        }
      } },
      toggleRow(t('顯示群組名稱'), t('在每組按鈕下方顯示「剪貼簿」「字型」「段落」等名稱（像 Word）。'), 'groupLabels', () => p.refreshToolbars()),
      toggleRow(t('檢視模式的按鈕顯示文字'), t('功能區「檢視」分頁的 Word 模式、Markdown、閱讀三個按鈕下方顯示名稱。關閉後這三個按鈕只顯示圖示（名稱仍在提示裡），Word 模式與 Markdown／閱讀模式的工具列都一樣。'), 'viewButtonLabels', () => p.refreshToolbars()),
      row(t('工具列位置'), t('「自動」在手機上放在畫面下方（靠近鍵盤，單手好按），平板與電腦放在上方。'),
        s => s.addDropdown(d => d.addOptions({ auto: t('自動'), top: t('上方'), bottom: t('下方') })
          .setValue(S.toolbarPosition || 'auto').onChange(async v => { S.toolbarPosition = v as ToolbarPosition; await rebuild(); }))),
      toggleRow(t('切換到 Markdown／閱讀模式時保留工具列'),
        t('在 Obsidian 的 Markdown 編輯與閱讀畫面上方也顯示工具列（粗體、標題、清單、連結、尋找、大綱等）。閱讀模式只能檢視，編輯按鈕會停用。'), 'mdToolbar', () => p.refreshToolbars()),
      toggleRow(t('切換到 Markdown／閱讀模式時，狀態列保留檢視切換按鈕'),
        t('在 Obsidian 右下角的狀態列顯示 Word 模式、Markdown、閱讀三個按鈕（只有圖示），位置與 Word 模式時相同，方便切換回來。'), 'mdStatusBar', () => p.updateStatus(null)),
      row(t('大綱的位置'), t('「另開一欄」在筆記左邊再展開一個大綱欄（像第二個側邊欄，不會蓋掉檔案總管）；也可以放進 Obsidian 的左或右側邊欄，或用小型下拉選單。'),
        s => s.addDropdown(d => d.addOptions({ split: t('在筆記旁另開一欄（建議）'), left: t('左側邊欄（與檔案總管同一區）'), right: t('右側邊欄'), popup: t('下拉選單') })
          .setValue(S.outlinePlace || 'split').onChange(async v => {
            S.outlinePlace = v as OutlinePlace; await save();
            if (p.outlineOpen()) { await p.toggleOutline(); if (v !== 'popup') await p.toggleOutline(); }
          }))),
      toggleRow(t('詳細提示（含動畫示意）'),
        t('滑鼠停在按鈕上時，顯示功能說明、快速鍵，以及一段動畫示範這個按鈕會做什麼。適合剛開始使用的人。'), 'richHints', () => p.refreshToolbars()),
      // 分頁與群組：顯示／隱藏，以及每個群組的名稱、順序、所在分頁
      { kind: 'grid', name: t('自訂分頁與按鈕群組'), desc: t('取消勾選可以隱藏不常用的分頁或群組。每個群組可以改名稱（留白就用預設名稱）、用箭頭調整順序，或移到別的分頁。Word 模式與 Markdown／閱讀模式的工具列都會套用。'), cls: 'wm-settings-groups', fill: grid => fillGroupSettings(grid, S, () => { void rebuild(); }) },
    ] },

    // ------------------------------------------------ 右鍵選單
    { id: 'ctx', heading: '右鍵選單', icon: 'mouse-pointer-click', rows: [
      toggleRow(t('使用 Word 模式的右鍵選單'),
        t('在編輯區按右鍵時，顯示依游標位置變化的選單（連結、方程式、表格、程式碼…），以及下面勾選的功能。關閉時使用 Obsidian／系統原本的選單。手機上長按仍是選取文字。'), 'ctxMenu'),
      { kind: 'grid', name: t('右鍵選單要顯示的項目'), cls: 'wm-settings-groups wm-settings-ctx', fill: ctxGrid => {
        for (const [id, label, desc] of [
          ['table', '表格', '插入／刪除列欄、整欄對齊、排序'],
          ['clipboard', '剪貼簿', '剪下、複製、貼上、只貼上文字、全選'],
          ['format', '格式', '有選取文字時：粗體、斜體、底線、醒目提示、清除格式'],
          ['paragraph', '段落', '項目符號、編號、增加／減少縮排'],
          ['insert', '插入', '超連結、連結到筆記、方程式、註解'],
          ['tools', '工具', '複製為 Markdown、在筆記或保管庫中搜尋、字數統計、編輯標記'],
        ] as const) {
          const l = ctxGrid.createEl('label', { cls: 'wm-settings-ctx-item' });
          const cb = l.createEl('input', { type: 'checkbox' });
          cb.checked = !(S.hiddenCtx || []).includes(id);
          const tx = l.createDiv();
          tx.createDiv({ cls: 'wm-settings-tab', text: t(label) });
          tx.createDiv({ cls: 'setting-item-description', text: t(desc) });
          cb.addEventListener('change', () => {
            const set = new Set(S.hiddenCtx || []);
            if (cb.checked) set.delete(id); else set.add(id);
            S.hiddenCtx = [...set];
            void save();
          });
        }
      } },
    ] },

    // ------------------------------------------------ 方程式與圖表
    { id: 'math', heading: '方程式與圖表', icon: 'sigma', rows: [
      row(t('方程式編輯器預設的編輯方式'), t('「視覺化」把分數、根號、上下標顯示成一格一格，可以直接點進去輸入；「LaTeX」直接編輯原始碼。在編輯器裡隨時可以切換。'),
        s => s.addDropdown(d => d.addOptions({ visual: t('視覺化'), latex: 'LaTeX' })
          .setValue(S.mathMode === 'latex' ? 'latex' : 'visual').onChange(async v => { S.mathMode = v as EquationEditMode; await save(); }))),
      row(t('圖表編輯器預設的編輯方式'), t('「表單」用清單編輯圖表的內容（流程圖、循序圖、甘特圖、圓餅圖、狀態圖、類別圖、心智圖、時間軸、ER 圖），也可以直接點預覽圖上的文字修改；用了表單不支援的寫法時，會自動改用程式碼。'),
        s => s.addDropdown(d => d.addOptions({ visual: t('表單'), code: t('程式碼') })
          .setValue(S.mermaidMode === 'code' ? 'code' : 'visual').onChange(async v => { S.mermaidMode = v as MermaidTab; await save(); }))),
      toggleRow(t('新方程式預設為獨立一行'),
        t('關閉時新插入的方程式放在文字中（$…$），開啟時獨立一行置中（$$…$$）。在方程式編輯器裡都可以切換。'), 'mathDisplay'),
      row(t('清除最近使用的方程式'), t('方程式編輯器會記住最近 12 個方程式，方便重複使用。'),
        s => s.addButton(b => b.setButtonText(t('清除')).onClick(async () => { S.recentMath = []; await save(); new Notice(t('已清除')); }))),
      { kind: 'grid', name: t('我的公式'), desc: t('自己存的公式，在方程式編輯器的「我的公式」分類裡按一下就插入。在編輯器裡按預覽旁邊的書籤按鈕，可以把目前的方程式存進來；這裡可以改名、修改、調整順序與刪除。'), cls: 'wm-settings-groups', fill: box => {
        box.addClass('wm-tpl-manager');
        buildTemplateManager(box, {
          get: () => S.mathTemplates || [],
          set: list => { S.mathTemplates = list; void save(); },
          addLabel: t('＋ 新增公式'), newName: t('公式'), newSrc: 'E = mc^{2}', srcLabel: 'LaTeX',
          empty: t('還沒有自己的公式。'),
          // 公式直接顯示成結果，比一串 LaTeX 好認
          preview: (src, el) => {
            el.setText(src);
            void Promise.resolve(loadMathJax()).then(() => { el.empty(); el.appendChild(renderMath(src, false)); return finishRenderMath(); }).catch(() => el.setText(src));
          },
        });
      } },
      { kind: 'grid', name: t('我的圖表範本'), desc: t('自己存的圖表，在圖表編輯器上方的「我的範本」裡按一下就套用。在編輯器裡可以把目前的圖表存進來；這裡可以改名、修改、調整順序與刪除。'), cls: 'wm-settings-groups', fill: box => {
        box.addClass('wm-tpl-manager');
        buildTemplateManager(box, {
          get: () => S.diagramTemplates || [],
          set: list => { S.diagramTemplates = list; void save(); },
          addLabel: t('＋ 新增圖表範本'), newName: t('圖表'), newSrc: t('flowchart TD\n    A[開始] --> B[結束]'), srcLabel: t('Mermaid 程式碼'),
          empty: t('還沒有自己的圖表範本。'),
          badge: src => { const k = detectKind(src); return k ? t(k.name) : ''; },
        });
      } },
      row(t('新圖表一開始的內容'), t('按「插入圖表」時，編輯器裡先放哪一種圖表。可以選內建的種類，或自己存的範本。'),
        s => s.addDropdown(d => {
          d.addOption('', t('流程圖'));
          for (const k of DIAGRAM_KINDS) if (k.id !== 'flowchart') d.addOption('kind:' + k.id, t(k.name));
          for (const x of S.diagramTemplates || []) d.addOption('tpl:' + x.name, t('我的範本') + t('：') + x.name);
          // 選的範本已經被改名或刪除：顯示成預設的流程圖
          const cur = S.defaultDiagram || '';
          d.setValue(cur.startsWith('tpl:') && !(S.diagramTemplates || []).some(x => 'tpl:' + x.name === cur) ? '' : cur)
            .onChange(async v => { S.defaultDiagram = v; await save(); });
        })),
      { kind: 'grid', name: t('圖表編輯器要列出的圖表種類'), desc: t('取消勾選用不到的種類，編輯器上方就不會列出來。已經畫好的圖表不受影響，仍然可以編輯。'), cls: 'wm-settings-groups', fill: box => {
        for (const k of DIAGRAM_KINDS) {
          const l = box.createEl('label', { cls: 'wm-settings-group' });
          const cb = l.createEl('input', { type: 'checkbox' });
          cb.checked = !(S.hiddenDiagramKinds || []).includes(k.id);
          l.createSpan({ text: t(k.name) });
          cb.addEventListener('change', () => {
            const set = new Set(S.hiddenDiagramKinds || []);
            if (cb.checked) set.delete(k.id); else set.add(k.id);
            S.hiddenDiagramKinds = [...set];
            void save();
          });
        }
      } },
    ] },

    // ------------------------------------------------ 同步與檔案
    { id: 'sync', heading: '同步與檔案', icon: 'refresh-cw', rows: [
      row(t('同步衝突的處理方式'), t('筆記在這裡有未存檔的修改時，又被 Synology Drive 或其他裝置改過。'),
        s => s.addDropdown(d => d.addOptions({ ask: t('每次詢問（建議）'), both: t('自動兩份都保留（另存我的版本）') })
          .setValue(S.conflict || 'ask').onChange(async v => { S.conflict = v as ConflictMode; await save(); }))),
      row(t('檔案大小上限（MB）'), t('超過這個大小的筆記一律用 Markdown 開啟，避免太大的檔案讓編輯變慢。'),
        s => s.addText(tx => { tx.inputEl.type = 'number'; tx.setValue(String(S.maxSizeMB || 2)).onChange(async v => { const n = parseFloat(v); if (n > 0) { S.maxSizeMB = n; await save(); } }); })),
      { kind: 'note', desc: t('在 frontmatter 加上「word-mode: false」可讓單一筆記不使用 Word 模式。') },
    ] },

    // ------------------------------------------------ 進階
    { id: 'advanced', heading: '進階', icon: 'wrench', rows: [
      row(t('快速鍵說明'), t('查看 Word 模式所有的快速鍵。'),
        s => s.addButton(b => b.setButtonText(t('開啟')).onClick(() => { new ShortcutModal(p.app).open(); }))),
      row(t('還原預設設定'), t('把以上所有設定改回預設值（不會修改任何筆記）。'),
        s => s.addButton(b => b.setButtonText(t('還原')).setWarning().onClick(async () => {
          const lang = S.language;
          p.settings = Object.assign({}, DEFAULTS, { language: lang });
          await save();
          p.refreshToolbars();
          await p.refreshViews();
          refreshSettingTab(settingTab);
        }))),
      { kind: 'note', desc: 'Word 模式 v' + p.manifest.version + ' · ' + getLanguage(), cls: 'wm-settings-version' },
    ] },
  ];
}

// 把設定頁的一列換成 Obsidian 1.13 的設定定義。Obsidian 會先建立這一列的 Setting、設好名稱與說明，再呼叫 render
function settingDefinition(row: SettingRow): SettingDefinitionRender {
  switch (row.kind) {
    case 'setting':
      // 大括號不能省：build 可能回傳 Setting，而 render 的回傳值會被當成清除用的函式
      return { name: row.name, desc: row.desc, render: setting => { row.build(setting); } };
    case 'grid':
      // 勾選框放在名稱與說明下方；這一列重畫或設定頁關閉前，先拿掉這次放的勾選框，重畫時才不會多出一份
      return {
        name: row.name, desc: row.desc,
        render: setting => {
          const grid = setting.infoEl.createDiv('wm-settings-groups-grid');
          row.fill(grid);
          return () => grid.remove();
        },
      };
    case 'note':
      // 只是說明文字：沒有名稱與控制項，也不列入設定搜尋（搜尋結果以名稱當標題，空白的標題沒有意義）
      return { name: '', desc: row.desc, searchable: false, render: () => { /* 沒有控制項 */ } };
  }
}

// 設定改變後重畫整個設定頁。Obsidian 1.13 起 settingItems（getSettingDefinitions() 的結果）有內容時，
// 設定頁由 Obsidian 依定義畫、不呼叫 display()，要用 update() 重新取得定義並重畫；舊版 Obsidian 沒有 update()，直接呼叫 display()
function refreshSettingTab(settingTab: WordModeSettings): void {
  if (settingTab.update && settingTab.settingItems && settingTab.settingItems.length > 0) settingTab.update();
  else settingTab.display();
}

class WordModeSettings extends PluginSettingTab {
  declare plugin: WordModePlugin;
  // Obsidian 1.13 起 SettingTab 才有的成員（1.5.7 的型別定義裡沒有，較舊的版本執行時也沒有）：
  // settingItems 是 Obsidian 存下的 getSettingDefinitions() 結果；update() 重新取得定義、更新設定搜尋並重畫開著的設定頁
  declare settingItems?: unknown[];
  declare update?: () => void;
  // 目前顯示的分類。記在這裡，關掉設定再打開、或設定頁重畫之後，仍停在同一類
  section: SectionId = 'general';
  // 畫在設定頁上的分類列（每次畫設定頁時換成新的）
  nav: SettingNav<SectionId> | null = null;
  // 1.13 的設定定義各屬於哪一類：點設定搜尋的結果時，用來先切到那一類
  sectionOf = new WeakMap<object, SectionId>();
  // 重畫設定頁之後呼叫：下次捲動時重新量外框的上內距（見 trackSettingPadding）
  remeasure: () => void;

  constructor(app: App, plugin: WordModePlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.remeasure = trackSettingPadding(this.containerEl);
    // 點設定搜尋的結果時，Obsidian 用這個（非公開的）方法找出那一列再捲過去；那一列在別的分類時是隱藏的，要先切過去。
    // 這個方法不存在或改了名稱時，只是搜尋結果不會自動切換分類
    if (typeof this.getElementForDefinition === 'function') {
      const find = this.getElementForDefinition.bind(this);
      this.getElementForDefinition = def => {
        const id = this.sectionOf.get(def);
        if (id) this.showSection(id);
        return find(def);
      };
    }
  }

  // 換到 id 這一類
  showSection(id: SectionId): void {
    this.section = id;
    showSettingSection(this.containerEl, id);
    if (this.nav) this.nav.select(id);
  }

  // 在 host 裡畫分類列
  buildNav(host: HTMLElement, sections: SettingSection[]): SettingNav<SectionId> {
    const nav = buildSettingNav(host, sections.map(x => ({ id: x.id, label: t(x.heading), icon: x.icon })), this.section, id => {
      this.showSection(id);
      // 每一類的長度不同，換過去之後從頭看起
      this.containerEl.scrollTop = 0;
    });
    this.nav = nav;
    this.remeasure();
    return nav;
  }

  // Obsidian 1.13 以前畫設定頁的方式（1.13 起 getSettingDefinitions() 有內容時，Obsidian 不呼叫這裡）
  display(): void {
    const c = this.containerEl;
    const sections = settingSections(this);
    c.empty();
    c.addClass('wm-settings');
    showSettingSection(c, this.section);
    this.buildNav(c.createDiv('wm-set-nav'), sections);
    for (const section of sections) {
      const box = c.createDiv('wm-set-sec wm-set-' + section.id);
      for (const row of section.rows) {
        if (row.kind === 'setting') row.build(new Setting(box).setName(row.name).setDesc(row.desc));
        else if (row.kind === 'grid') {
          const g = box.createDiv(row.cls);
          g.createDiv({ cls: 'setting-item-name', text: row.name });
          if (row.desc) g.createDiv({ cls: 'setting-item-description', text: row.desc });
          row.fill(g.createDiv('wm-settings-groups-grid'));
        } else box.createEl('p', { cls: 'setting-item-description' + (row.cls ? ' ' + row.cls : ''), text: row.desc });
      }
    }
  }

  // Obsidian 1.13 起：回傳設定定義，Obsidian 依這份定義畫設定頁（不再呼叫 display()），也用來做設定搜尋。
  // Obsidian 在加入設定頁時與每次 update() 時呼叫；舊版 Obsidian 不會呼叫
  getSettingDefinitions(): SettingDefinitionGroup[] {
    const sections = settingSections(this);
    this.containerEl.addClass('wm-settings');
    showSettingSection(this.containerEl, this.section);
    // 分類列自己是一個群組（群組是設定頁外框的直接子元素，才能固定在捲動範圍的上緣），裡面只有一列，不列入設定搜尋
    const nav: SettingDefinitionGroup = {
      type: 'group', cls: 'wm-set-nav',
      items: [{
        name: '', searchable: false,
        render: setting => {
          setting.settingEl.addClass('wm-set-navrow');
          const bar = this.buildNav(setting.settingEl, sections).el;
          // 這一列重畫前先拿掉舊的分類列，才不會多出一條
          return () => bar.remove();
        },
      }],
    };
    return [nav, ...sections.map((section): SettingDefinitionGroup => {
      const items = section.rows.map(settingDefinition);
      for (const item of items) this.sectionOf.set(item, section.id);
      // 分類的名稱已經在分類列上，群組不再加標題
      return { type: 'group', cls: 'wm-set-sec wm-set-' + section.id, items };
    })];
  }
}

export { Notice };
