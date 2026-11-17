// Word 模式：把 Obsidian 筆記變成像 Office Word 一樣編輯
import { Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownView, TFile, Notice, setIcon, Platform } from 'obsidian';
import { t, withKey, key, setLanguage, getLanguage } from './i18n.js';
import { options as cmdOptions } from './commands.js';
import { MarkdownConverter } from './markdown.js';
import { WordModeView, VIEW_TYPE } from './view.js';
import { OutlineView, OUTLINE_TYPE } from './outline.js';
import { MarkdownBar } from './mdbar.js';
import { TABS, GROUPS } from './toolbar.js';

const DEFAULTS = {
  // 一般
  language: 'auto',
  openByDefault: true,
  excludeFolders: '_模板',
  // 編輯
  ctrlE: true,
  wordAtCursor: true,
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
  hiddenTabs: [],
  hiddenGroups: [],
  richHints: false,
  mdToolbar: true,
  outlinePlace: 'split',
  // 右鍵選單與方程式
  ctxMenu: true,
  hiddenCtx: [],
  mathDisplay: false,
  recentMath: [],
  // 同步與檔案
  conflict: 'ask',
  maxSizeMB: 2,
};

export default class WordModePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    if (this.settings.ribbonLabels === false && !this.settings.buttonStyleSet) this.settings.buttonStyle = 'icon';
    delete this.settings.ribbonLabels;
    if (this.settings.outlineSidebar === false) this.settings.outlinePlace = 'popup';
    delete this.settings.outlineSidebar;
    setLanguage(this.settings.language);
    this.applyOptions();
    this.converter = new MarkdownConverter();
    this.forceMarkdown = new WeakMap(); // leaf -> 使用者手動切回 Markdown 的檔案路徑
    this.mdActions = new Map();
    this.history = new Map(); // 檔案路徑 → 編輯狀態（切換模式時保留復原紀錄）

    this.registerView(VIEW_TYPE, leaf => new WordModeView(leaf, this));
    this.registerView(OUTLINE_TYPE, leaf => new OutlineView(leaf, this));
    this.mdBars = new Map();
    this.addRibbonIcon('list-tree', t('大綱（Word 模式）'), () => this.toggleOutline());
    this.addCommand({ id: 'toggle-outline', name: t('開啟／關閉大綱側邊欄'), callback: () => this.toggleOutline() });
    // 記住最後使用的筆記畫面（點側邊欄時仍知道要顯示哪份筆記的大綱）
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => {
      const v = leaf && leaf.view;
      if (v && v.file && (v instanceof WordModeView || v instanceof MarkdownView)) { this.lastDoc = v; this.outlineChanged(v, true); }
    }));
    this.patchSetViewState();

    this.addCommand({
      id: 'open-word-mode', name: t('以 Word 模式編輯目前筆記'),
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const v = leaf && leaf.view;
        if (!(v instanceof MarkdownView) || !v.file) return false;
        if (!checking) this.switchToWord(leaf);
        return true;
      },
    });
    this.addCommand({
      id: 'open-markdown', name: t('以 Markdown 編輯目前筆記'),
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf || !(leaf.view instanceof WordModeView)) return false;
        if (!checking) this.switchToMarkdown(leaf);
        return true;
      },
    });
    this.addCommand({
      id: 'toggle-mode', name: t('切換 Word 模式／Markdown'),
      checkCallback: checking => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return false;
        if (leaf.view instanceof WordModeView) { if (!checking) this.switchToMarkdown(leaf); return true; }
        if (leaf.view instanceof MarkdownView && leaf.view.file) { if (!checking) this.switchToWord(leaf); return true; }
        return false;
      },
    });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem(i => i.setTitle(t('以 Word 模式開啟')).setIcon('file-text').setSection('open').onClick(async () => {
        const l = leaf && leaf.view && leaf.view.file === file ? leaf : this.app.workspace.getLeaf(false);
        this.forceMarkdown.delete(l);
        await l.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      }));
      menu.addItem(i => i.setTitle(t('以 Markdown 開啟')).setIcon('code-2').setSection('open').onClick(async () => {
        const l = leaf && leaf.view && leaf.view.file === file ? leaf : this.app.workspace.getLeaf(false);
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
    this.registerInterval(window.setInterval(() => { for (const b of this.mdBars.values()) b.update(); }, 700));

    this.addSettingTab(new WordModeSettings(this.app, this));

    // 桌機：Word 模式的存檔狀態、檢視切換、縮放放進 Obsidian 右下角狀態列（字數用 Obsidian 內建的）
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('wm-statusbar');
    this.statusEl.style.display = 'none';
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateStatus(null)));

    // 在 Markdown 畫面按 Ctrl+E（Obsidian 的「切換閱讀／編輯」）：改成切回 Word 模式
    const cmds = this.app.commands;
    if (cmds && cmds.executeCommand) {
      const orig = cmds.executeCommand;
      const plugin = this;
      const patched = function (command, ...rest) {
        try {
          if (command && command.id === 'markdown:toggle-preview' && plugin.settings.ctrlE !== false) {
            const v = plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (v && v.file && /\.md$/i.test(v.file.path)) { plugin.switchToWord(v.leaf); return true; }
          }
        } catch (e) { console.error('[Word 模式]', e); }
        return orig.call(this, command, ...rest);
      };
      cmds.executeCommand = patched;
      this.register(() => { if (cmds.executeCommand === patched) cmds.executeCommand = orig; });
    }

    const wordCommand = (id, name, run) => this.addCommand({
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
        const f = leaf.view && leaf.view.file;
        if (f && this.eligible(f.path)) leaf.setViewState({ type: VIEW_TYPE, state: { file: f.path } });
      });
    });
  }

  onunload() {
    for (const b of this.mdBars.values()) b.destroy();
    this.mdBars.clear();
    for (const [, btn] of this.mdActions) btn.remove();
    this.mdActions.clear();
    if (this.restoreSetViewState) this.restoreSetViewState();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      const f = leaf.view && leaf.view.file;
      if (f) leaf.setViewState({ type: 'markdown', state: { file: f.path } });
    });
  }

  async saveSettings() { await this.saveData(this.settings); }

  storeHistory(path, entry) {
    this.history.delete(path);
    this.history.set(path, Object.assign({ at: Date.now() }, entry));
    while (this.history.size > 30) this.history.delete(this.history.keys().next().value);
  }

  takeHistory(path) {
    const e = this.history.get(path);
    if (!e) return null;
    this.history.delete(path);
    return Date.now() - e.at < 6 * 3600 * 1000 ? e : null;
  }

  // ---- Markdown／閱讀模式的工具列
  syncMdBars() {
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
  refreshToolbars() {
    for (const v of this.views()) v.buildToolbar();
    for (const b of this.mdBars.values()) b.destroy();
    this.mdBars.clear();
    this.syncMdBars();
  }

  // ---- 大綱側邊欄
  docView() {
    const v = this.lastDoc;
    if (v && v.leaf && v.file && this.app.workspace.getLeavesOfType(v.getViewType()).includes(v.leaf)) return v;
    const a = this.app.workspace.getActiveViewOfType(WordModeView) || this.app.workspace.getActiveViewOfType(MarkdownView);
    return a || null;
  }

  outlineOpen() { return this.app.workspace.getLeavesOfType(OUTLINE_TYPE).length > 0; }

  // 大綱的位置：split＝在筆記左邊另外展開一欄（預設，像第二個側邊欄）；left／right＝放進 Obsidian 的左／右側邊欄
  async toggleOutline() {
    const ws = this.app.workspace;
    const leaves = ws.getLeavesOfType(OUTLINE_TYPE);
    if (leaves.length) leaves.forEach(l => l.detach());
    else {
      const place = this.settings.outlinePlace === 'popup' ? 'split' : (this.settings.outlinePlace || 'split');
      const d = this.docView();
      let leaf;
      if (place === 'split' && d && d.leaf) {
        leaf = ws.createLeafBySplit(d.leaf, 'vertical', true);
        await leaf.setViewState({ type: OUTLINE_TYPE, active: false });
        this.narrowLeaf(leaf, d.leaf);
      } else {
        leaf = place === 'right' ? ws.getRightLeaf(false) : ws.getLeftLeaf(false);
        await leaf.setViewState({ type: OUTLINE_TYPE, active: false });
        ws.revealLeaf(leaf);
      }
      if (d && d.leaf) ws.setActiveLeaf(d.leaf, { focus: true });
    }
    for (const v of this.views()) if (v.toolbar) v.toolbar.refresh();
    for (const b of this.mdBars.values()) b.update();
  }

  // 新展開的大綱欄寬度約 260px（其餘留給筆記）
  narrowLeaf(leaf, docLeaf) {
    try {
      // 分割後兩邊都在同一個 split 裡，各自是一組分頁（tabs）；設定兩組的比例
      const mine = leaf.parent && leaf.parent.setDimension ? leaf.parent : leaf;
      const other = docLeaf.parent && docLeaf.parent.setDimension ? docLeaf.parent : docLeaf;
      const host = mine.containerEl && mine.containerEl.parentElement;
      const total = host ? host.getBoundingClientRect().width : 1200;
      const pct = Math.max(12, Math.min(35, 260 / (total || 1200) * 100));
      if (mine.setDimension) mine.setDimension(pct);
      if (other !== mine && other.setDimension) other.setDimension(100 - pct);
    } catch (e) { /* 用預設寬度 */ }
  }



  outlineChanged(view, docChanged) {
    if (!this.outlineOpen()) return;
    clearTimeout(this.outlineTimer);
    this.outlineTimer = setTimeout(() => {
      for (const l of this.app.workspace.getLeavesOfType(OUTLINE_TYPE)) {
        const ov = l.view;
        if (!(ov instanceof OutlineView)) continue;
        if (docChanged || ov.source !== this.docView()) ov.refresh(); else ov.markCurrent();
      }
    }, docChanged ? 300 : 120);
  }

  applyOptions() {
    cmdOptions.wordAtCursor = this.settings.wordAtCursor !== false;
  }

  views() { return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v instanceof WordModeView); }

  async setFullWidth(on) {
    this.settings.fullWidth = !!on;
    for (const v of this.views()) { v.contentEl.toggleClass('wm-full-width', !!on); if (v.pm) v.toolbar.update(v.pm.state); }
    await this.saveSettings();
  }

  openSettings() {
    const s = this.app.setting;
    if (!s) return;
    s.open();
    s.openTabById(this.manifest.id);
  }

  // 重新開啟所有 Word 模式的分頁（版面設定改變時）；編輯紀錄會保留
  async refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const st = leaf.getViewState();
      if (leaf.view && leaf.view.save) await leaf.view.save();
      await leaf.setViewState({ type: 'empty', state: {} });
      await leaf.setViewState(st);
    }
  }

  // 換語言：重新載入外掛，讓所有文字（含命令名稱）都換成新語言
  async changeLanguage(lang) {
    this.settings.language = lang;
    await this.saveSettings();
    const id = this.manifest.id;
    const plugins = this.app.plugins;
    if (!plugins || !plugins.disablePlugin) { new Notice(t('請重新啟動 Obsidian 讓語言設定生效')); return; }
    const reopen = this.app.setting && this.app.setting.activeTab && this.app.setting.activeTab.id === id;
    await plugins.disablePlugin(id);
    await plugins.enablePlugin(id);
    if (reopen) setTimeout(() => { try { this.app.setting.openTabById(id); } catch (e) { /* 忽略 */ } }, 100);
  }

  async setZoom(z) {
    this.settings.zoom = Math.max(50, Math.min(200, Math.round(z / 10) * 10));
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(l => { if (l.view.applyZoom) l.view.applyZoom(); });
    await this.saveSettings();
  }

  updateStatus(view) {
    const el = this.statusEl;
    if (!el) return;
    const active = this.app.workspace.getActiveViewOfType(WordModeView);
    if (view && view !== active) return;
    if (!active || !active.pm || Platform.isMobile) { el.style.display = 'none'; this.barView = null; return; }
    el.style.display = '';
    if (this.barView !== active || !el.childElementCount) {
      el.empty();
      active.buildBottomBar(el, true);
      this.barView = active;
    } else active.renderStatus();
  }


  excluded() {
    return this.settings.excludeFolders.split(/[\n,]/).map(s => s.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
  }

  eligible(path) {
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
  patchSetViewState() {
    const plugin = this;
    const proto = WorkspaceLeaf.prototype;
    const orig = proto.setViewState;
    const patched = function (state, eState) {
      try {
        if (plugin.settings.openByDefault && state && state.type === 'markdown' && state.state && typeof state.state.file === 'string') {
          const file = state.state.file;
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

  async switchToMarkdown(leaf, mode) {
    const v = leaf.view;
    if (!(v instanceof WordModeView) || !v.file) return;
    const path = v.file.path;
    await v.save();
    v.cacheHistory();
    this.forceMarkdown.set(leaf, path);
    const state = mode === 'preview' ? { file: path, mode: 'preview' } : { file: path, mode: 'source', source: false };
    await leaf.setViewState({ type: 'markdown', state, active: true });
    setTimeout(() => { const nv = leaf.view; if (nv && nv.editor && mode !== 'preview') nv.editor.focus(); }, 50);
  }

  async switchToWord(leaf) {
    const v = leaf.view;
    if (!(v instanceof MarkdownView) || !v.file) return;
    const path = v.file.path;
    await v.save();
    this.forceMarkdown.delete(leaf);
    await leaf.setViewState({ type: VIEW_TYPE, state: { file: path }, active: true });
    setTimeout(() => { const nv = leaf.view; if (nv && nv.pm) nv.pm.focus(); }, 50);
  }
}

class WordModeSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const c = this.containerEl;
    const p = this.plugin;
    const S = p.settings;
    const save = async () => { p.applyOptions(); await p.saveSettings(); };
    const toggle = (setting, k, after) => setting.addToggle(tg => tg.setValue(!!(S[k] == null ? DEFAULTS[k] : S[k])).onChange(async v => { S[k] = v; await save(); if (after) after(v); }));
    const heading = (text, icon) => {
      const h = new Setting(c).setName(t(text)).setHeading();
      h.settingEl.addClass('wm-setting-heading');
      if (icon) { const i = h.nameEl.createSpan('wm-setting-icon'); setIcon(i, icon); h.nameEl.prepend(i); }
      return h;
    };
    c.empty();
    c.addClass('wm-settings');

    // ------------------------------------------------ 一般（放在最上面，不加標題）
    new Setting(c).setName(t('介面語言'))
      .setDesc(t('Word 模式的按鈕、選單與提示文字使用的語言。「自動」會跟著 Obsidian 的語言。'))
      .addDropdown(d => d.addOptions({ auto: t('自動（跟隨 Obsidian）'), 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어' })
        .setValue(S.language || 'auto').onChange(v => p.changeLanguage(v)));
    toggle(new Setting(c).setName(t('預設用 Word 模式開啟筆記'))
      .setDesc(t('開啟 .md 筆記時自動使用 Word 模式。可隨時用右上角按鈕切回 Markdown。')), 'openByDefault');
    new Setting(c).setName(t('不使用 Word 模式的資料夾'))
      .setDesc(t('每行一個資料夾（例如模板資料夾），裡面的筆記一律用 Markdown 開啟。'))
      .addTextArea(ta => ta.setValue(S.excludeFolders).onChange(async v => { S.excludeFolders = v; await save(); }));

    // ------------------------------------------------ 編輯
    heading('編輯', 'pencil');
    toggle(new Setting(c).setName(withKey('切換 Word 模式與 Markdown', 'Mod+E'))
      .setDesc(t('開啟時，在 Markdown 畫面按 {k} 會回到 Word 模式（取代 Obsidian 原本的「切換閱讀／編輯」）。閱讀模式可用下方狀態列的按鈕開啟。', { k: key('Mod+E') })), 'ctrlE');
    toggle(new Setting(c).setName(t('沒有選取文字時，格式套用到游標所在的詞'))
      .setDesc(t('像 Word 一樣：游標在詞中間按粗體，整個詞會變粗體。關閉後只影響接下來輸入的文字。')), 'wordAtCursor');
    toggle(new Setting(c).setName(t('貼上 Markdown 文字時顯示「轉成格式」選項'))
      .setDesc(t('從 ChatGPT 等地方複製的 Markdown 純文字，貼上後可一鍵轉成粗體、標題、清單等格式。')), 'pasteChip');
    toggle(new Setting(c).setName(t('切換模式時保留復原紀錄'))
      .setDesc(t('切到 Markdown 編輯再切回來，仍可用 {k} 復原之前的修改（最多保留 30 份筆記、6 小時）。', { k: key('Mod+Z') })), 'keepHistory');

    // ------------------------------------------------ 顯示
    heading('顯示', 'monitor');
    toggle(new Setting(c).setName(t('全寬頁面'))
      .setDesc(t('關閉時以 A4 紙張寬度顯示，開啟時使用整個視窗寬度。')), 'fullWidth', v => p.setFullWidth(v));
    new Setting(c).setName(t('頁面縮放'))
      .setDesc(t('也可以用 {k}+滑鼠滾輪，或右下角的縮放列調整。', { k: key('Mod') }))
      .addSlider(sl => sl.setLimits(50, 200, 10).setValue(S.zoom || 100).setDynamicTooltip().onChange(v => p.setZoom(v)));
    toggle(new Setting(c).setName(t('開啟筆記時顯示編輯標記（¶）'))
      .setDesc(t('顯示空白（·）、全形空白（□）、Tab（→）、換行（↵）與段落結尾（¶）。也可以用工具列的 ¶ 按鈕隨時切換。')), 'showMarks');
    toggle(new Setting(c).setName(t('一直標示奇怪符號'))
      .setDesc(t('即使沒開編輯標記，也用紅色波浪底線標出看不見的字元、亂碼、殘留的 ** == [[ 與落單的引號。可到「校閱 → 清理符號」一次清除。')), 'highlightWeird', () => p.refreshViews());

    // ------------------------------------------------ 工具列
    heading('工具列', 'layout-panel-top');
    const rebuild = async () => { await save(); p.refreshToolbars(); };
    new Setting(c).setName(t('版面'))
      .setDesc(t('「分頁」像 Word（常用／插入／校閱／檢視）；「一行」把所有按鈕排成一行，可左右捲動；「自動換行」把所有按鈕都顯示出來，放不下就換行。'))
      .addDropdown(d => d.addOptions({ tabs: t('分頁（像 Word）'), single: t('全部排成一行'), wrap: t('全部顯示（自動換行）') })
        .setValue(S.ribbonLayout || 'tabs').onChange(async v => { S.ribbonLayout = v; await rebuild(); }));
    new Setting(c).setName(t('按鈕樣式'))
      .setDesc(t('「自動」：常用功能只顯示圖示，插入、校閱、檢視的按鈕下方有名稱。「只顯示圖示」最精簡；「圖示加文字」每個按鈕都有名稱。'))
      .addDropdown(d => d.addOptions({ auto: t('自動'), icon: t('只顯示圖示'), label: t('圖示加文字') })
        .setValue(S.buttonStyle || 'auto').onChange(async v => { S.buttonStyle = v; S.buttonStyleSet = true; await rebuild(); }));
    toggle(new Setting(c).setName(t('顯示群組名稱'))
      .setDesc(t('在每組按鈕下方顯示「剪貼簿」「字型」「段落」等名稱（像 Word）。')), 'groupLabels', () => p.refreshToolbars());
    new Setting(c).setName(t('工具列位置'))
      .setDesc(t('「自動」在手機上放在畫面下方（靠近鍵盤，單手好按），平板與電腦放在上方。'))
      .addDropdown(d => d.addOptions({ auto: t('自動'), top: t('上方'), bottom: t('下方') })
        .setValue(S.toolbarPosition || 'auto').onChange(async v => { S.toolbarPosition = v; await rebuild(); }));
    toggle(new Setting(c).setName(t('切換到 Markdown／閱讀模式時保留工具列'))
      .setDesc(t('在 Obsidian 的 Markdown 編輯與閱讀畫面上方也顯示工具列（粗體、標題、清單、連結、尋找、大綱等）。閱讀模式只能檢視，編輯按鈕會停用。')), 'mdToolbar', () => p.refreshToolbars());
    new Setting(c).setName(t('大綱的位置'))
      .setDesc(t('「另開一欄」在筆記左邊再展開一個大綱欄（像第二個側邊欄，不會蓋掉檔案總管）；也可以放進 Obsidian 的左或右側邊欄，或用小型下拉選單。'))
      .addDropdown(d => d.addOptions({ split: t('在筆記旁另開一欄（建議）'), left: t('左側邊欄（與檔案總管同一區）'), right: t('右側邊欄'), popup: t('下拉選單') })
        .setValue(S.outlinePlace || 'split').onChange(async v => {
          S.outlinePlace = v; await save();
          if (p.outlineOpen()) { await p.toggleOutline(); if (v !== 'popup') await p.toggleOutline(); }
        }));
    toggle(new Setting(c).setName(t('詳細提示（含動畫示意）'))
      .setDesc(t('滑鼠停在按鈕上時，顯示功能說明、快速鍵，以及一段動畫示範這個按鈕會做什麼。適合剛開始使用的人。')), 'richHints', () => p.refreshToolbars());

    // 要顯示的分頁與群組
    const box = c.createDiv('wm-settings-groups');
    box.createDiv({ cls: 'setting-item-name', text: t('顯示的分頁與按鈕群組') });
    box.createDiv({ cls: 'setting-item-description', text: t('取消勾選可以隱藏不常用的功能。隱藏整個分頁時，該分頁的按鈕都不會出現。') });
    const cols = box.createDiv('wm-settings-groups-grid');
    for (const [tab, tabLabel] of TABS) {
      const col = cols.createDiv('wm-settings-groups-col');
      const tl = col.createEl('label', { cls: 'wm-settings-tab' });
      const tcb = tl.createEl('input', { type: 'checkbox' });
      tcb.checked = !(S.hiddenTabs || []).includes(tab);
      tl.createSpan({ text: t(tabLabel) });
      const inner = [];
      for (const [gid, gtab, gLabel] of GROUPS) {
        if (gtab !== tab) continue;
        const gl = col.createEl('label', { cls: 'wm-settings-group' });
        const gcb = gl.createEl('input', { type: 'checkbox' });
        gcb.checked = !(S.hiddenGroups || []).includes(gid);
        gcb.disabled = !tcb.checked;
        gl.createSpan({ text: t(gLabel) });
        inner.push(gcb);
        gcb.addEventListener('change', async () => {
          const set = new Set(S.hiddenGroups || []);
          if (gcb.checked) set.delete(gid); else set.add(gid);
          S.hiddenGroups = [...set];
          await rebuild();
        });
      }
      tcb.addEventListener('change', async () => {
        const set = new Set(S.hiddenTabs || []);
        if (tcb.checked) set.delete(tab); else set.add(tab);
        S.hiddenTabs = [...set];
        for (const x of inner) x.disabled = !tcb.checked;
        await rebuild();
      });
    }

    // ------------------------------------------------ 右鍵選單與方程式
    heading('右鍵選單與方程式', 'mouse-pointer-click');
    toggle(new Setting(c).setName(t('使用 Word 模式的右鍵選單'))
      .setDesc(t('在編輯區按右鍵時，顯示依游標位置變化的選單（連結、方程式、表格、程式碼…），以及下面勾選的功能。關閉時使用 Obsidian／系統原本的選單。手機上長按仍是選取文字。')), 'ctxMenu');
    const ctxBox = c.createDiv('wm-settings-groups wm-settings-ctx');
    ctxBox.createDiv({ cls: 'setting-item-name', text: t('右鍵選單要顯示的項目') });
    const ctxGrid = ctxBox.createDiv('wm-settings-groups-grid');
    for (const [id, label, desc] of [
      ['table', '表格', '插入／刪除列欄、整欄對齊、排序'],
      ['clipboard', '剪貼簿', '剪下、複製、貼上、只貼上文字、全選'],
      ['format', '格式', '有選取文字時：粗體、斜體、底線、醒目提示、清除格式'],
      ['paragraph', '段落', '項目符號、編號、增加／減少縮排'],
      ['insert', '插入', '超連結、連結到筆記、方程式、註解'],
      ['tools', '工具', '複製為 Markdown、在筆記或保管庫中搜尋、字數統計、編輯標記'],
    ]) {
      const l = ctxGrid.createEl('label', { cls: 'wm-settings-ctx-item' });
      const cb = l.createEl('input', { type: 'checkbox' });
      cb.checked = !(S.hiddenCtx || []).includes(id);
      const tx = l.createDiv();
      tx.createDiv({ cls: 'wm-settings-tab', text: t(label) });
      tx.createDiv({ cls: 'setting-item-description', text: t(desc) });
      cb.addEventListener('change', async () => {
        const set = new Set(S.hiddenCtx || []);
        if (cb.checked) set.delete(id); else set.add(id);
        S.hiddenCtx = [...set];
        await save();
      });
    }
    toggle(new Setting(c).setName(t('新方程式預設為獨立一行'))
      .setDesc(t('關閉時新插入的方程式放在文字中（$…$），開啟時獨立一行置中（$$…$$）。在方程式編輯器裡都可以切換。')), 'mathDisplay');
    new Setting(c).setName(t('清除最近使用的方程式'))
      .setDesc(t('方程式編輯器會記住最近 12 個方程式，方便重複使用。'))
      .addButton(b => b.setButtonText(t('清除')).onClick(async () => { S.recentMath = []; await save(); new Notice(t('已清除')); }));

    // ------------------------------------------------ 同步與檔案
    heading('同步與檔案', 'refresh-cw');
    new Setting(c).setName(t('同步衝突的處理方式'))
      .setDesc(t('筆記在這裡有未存檔的修改時，又被 Synology Drive 或其他裝置改過。'))
      .addDropdown(d => d.addOptions({ ask: t('每次詢問（建議）'), both: t('自動兩份都保留（另存我的版本）') })
        .setValue(S.conflict || 'ask').onChange(async v => { S.conflict = v; await save(); }));
    new Setting(c).setName(t('檔案大小上限（MB）'))
      .setDesc(t('超過這個大小的筆記一律用 Markdown 開啟，避免太大的檔案讓編輯變慢。'))
      .addText(tx => { tx.inputEl.type = 'number'; tx.setValue(String(S.maxSizeMB || 2)).onChange(async v => { const n = parseFloat(v); if (n > 0) { S.maxSizeMB = n; await save(); } }); });
    c.createEl('p', { cls: 'setting-item-description', text: t('在 frontmatter 加上「word-mode: false」可讓單一筆記不使用 Word 模式。') });

    // ------------------------------------------------ 進階
    heading('進階', 'wrench');
    new Setting(c).setName(t('快速鍵說明'))
      .setDesc(t('查看 Word 模式所有的快速鍵。'))
      .addButton(b => b.setButtonText(t('開啟')).onClick(() => {
        const v = p.views()[0];
        if (v) v.toolbar.ctx.dialogs.shortcuts(); else new Notice(t('請先用 Word 模式開啟一份筆記'));
      }));
    new Setting(c).setName(t('還原預設設定'))
      .setDesc(t('把以上所有設定改回預設值（不會修改任何筆記）。'))
      .addButton(b => b.setButtonText(t('還原')).setWarning().onClick(async () => {
        const lang = S.language;
        p.settings = Object.assign({}, DEFAULTS, { language: lang });
        await save();
        p.refreshToolbars();
        await p.refreshViews();
        this.display();
      }));
    c.createEl('p', { cls: 'setting-item-description wm-settings-version', text: 'Word 模式 v' + p.manifest.version + ' · ' + getLanguage() });
  }
}

export { Notice };
