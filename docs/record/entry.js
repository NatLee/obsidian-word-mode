// 錄製用的進入點：在假的保管庫上開一個真的 Word 模式檢視，做法跟 tests/view/harness.mjs 的 makeEnv 相同
import { WordModeView } from '../../src/view.ts';
import { MarkdownConverter } from '../../src/markdown.ts';
import { setLanguage, t } from '../../src/i18n.ts';
import { TextSelection } from 'prosemirror-state';
import * as mock from 'obsidian';
// 外掛的預設設定，由 record.mjs 從 src/settings.ts 的 DEFAULTS 取出，不會跟外掛不同步
import DEFAULTS from './.cache/defaults.json';

export { TextSelection, mock, t };

export async function makeEnv({ lang = 'en', files: initial = {}, settings = {}, caches: initialCaches = {}, mount }) {
  setLanguage(lang);
  const env = {};
  const files = new Map(Object.entries(initial));
  const caches = new Map(Object.entries(initialCaches));
  const app = {
    vault: {
      configDir: '.obsidian',
      config: { spellcheck: false },
      getConfig(k) { return this.config[k]; },
      async read(f) { return files.get(f.path); },
      async cachedRead(f) { return files.get(f.path); },
      async modify(f, d) { files.set(f.path, d); },
      async create(p, d) { files.set(p, d); return new mock.TFile(p); },
      getAbstractFileByPath(p) { return files.has(p) ? new mock.TFile(p) : null; },
      getResourcePath(f) { return 'app://res/' + f.path; },
      getFiles() { return [...files.keys()].map(p => new mock.TFile(p)); },
      getMarkdownFiles() { return [...files.keys()].filter(p => p.endsWith('.md')).map(p => new mock.TFile(p)); },
      on() { return {}; },
    },
    metadataCache: {
      getFileCache(f) { return caches.get(f.path) || null; },
      getTags() { const o = {}; for (const c of caches.values()) for (const x of (c.tags || [])) o[x.tag] = (o[x.tag] || 0) + 1; return o; },
      fileToLinktext(f) { return f.path.replace(/\.md$/, ''); },
      getFirstLinkpathDest(p) { if (!p) return null; for (const k of files.keys()) { if (k === p || k.replace(/\.md$/, '') === p || k.replace(/\.md$/, '').endsWith('/' + p)) return new mock.TFile(k); } return null; },
      on() { return {}; },
    },
    internalPlugins: { getEnabledPluginById() { return null; }, getPluginById() { return null; } },
    workspace: { openLinkText() {}, getLeaf() { return { openFile() {} }; }, trigger() {} },
    fileManager: { generateMarkdownLink: f => (f.extension === 'md' ? `[[${f.basename}]]` : `[[${f.name}]]`), getAvailablePathForAttachment: async n => n },
  };
  const plugin = {
    app, history: new Map(),
    storeHistory(p, e) { this.history.set(p, Object.assign({ at: Date.now() }, e)); },
    takeHistory(p) { const e = this.history.get(p); this.history.delete(p); return e || null; },
    setFullWidth(on) { this.settings.fullWidth = on; }, outlineChanged() {}, outlineOpen() { return false; }, toggleOutline() {}, syncMdBars() {},
    saveSettings() {}, openSettings() {}, updateStatus() {}, setZoom(z) { this.settings.zoom = z; },
    // 跟 main.ts 一樣：改設定，再讓編輯器套用（文件屬性標題列的圖釘會呼叫）
    setPropsSticky(on) { this.settings.propsSticky = !!on; view.applyPropsSticky(); },
    // 全寬與詳細提示固定關閉，不跟著預設值：動畫是照 A4 頁面錄的，詳細提示開著的話，游標經過按鈕就會跳出提示卡。
    // 場景要的話可以在 settings 裡打開
    settings: Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), { language: lang, fullWidth: false, richHints: false }, settings),
    converter: new MarkdownConverter(),
    // 「切換到 Markdown」：錄製時改成顯示這份筆記存成的 Markdown（見 stage.js 的 showSource）
    switchToMarkdown() { if (window.stage) window.stage.showSource(true); },
  };
  const view = new WordModeView({ app }, plugin);
  if (mount) mount.appendChild(view.containerEl);
  view.load();
  await view.onOpen();
  const open = async (path, data) => { files.set(path, data); await view.loadFile(new mock.TFile(path), data); return view; };
  return Object.assign(env, { app, plugin, view, files, caches, open });
}
