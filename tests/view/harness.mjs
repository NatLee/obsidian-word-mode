// 編輯測試共用的環境：jsdom、假的保管庫與外掛、模擬打字與按鍵
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const g = globalThis;
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'Event', 'InputEvent', 'DOMParser', 'Text']) g[k] = dom.window[k];
// Obsidian 提供的全域：目前視窗的 document／window，以及建立元素的函式
g.activeDocument = dom.window.document; g.activeWindow = dom.window;
g.createEl = (tag, o) => { const e = dom.window.document.createElement(tag); if (typeof o === 'string') e.className = o; else if (o) { if (o.cls) e.className = o.cls; if (o.text) e.textContent = o.text; if (o.type) e.type = o.type; } return e; };
g.createSpan = o => g.createEl('span', o); g.createDiv = o => g.createEl('div', o);
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
Element.prototype.getClientRects = function () { return []; };
Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
Element.prototype.scrollIntoView = function () {};
document.elementFromPoint = () => null;
dom.window.Range.prototype.getClientRects = function () { return []; };
dom.window.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };

export const B = await import('./bundle.mjs');
export const { mock, schema, C, TextSelection, NodeSelection } = B;

let failed = 0;
export const assert = (c, m) => { if (!c) { failed++; console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };
export const finish = () => console.log(failed ? `\n${failed} 個測試失敗` : '\nALL PASS');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// 建立一個假的保管庫與一個已開啟的 Word 模式檢視
export async function makeEnv(initialFiles = {}, settings = {}) {
  const env = {};
  const files = new Map(Object.entries(initialFiles));
  const caches = new Map(); // path → metadata cache（headings、tags…）
  const app = {
    vault: {
      configDir: '.obsidian',
      config: { spellcheck: true },
      getConfig(k) { return this.config[k]; },
      async read(f) { return files.get(f.path); },
      async cachedRead(f) { return files.get(f.path); },
      async modify(f, d) { files.set(f.path, d); },
      async create(p, d) { files.set(p, d); return new mock.TFile(p); },
      getAbstractFileByPath(p) { if (files.has(p)) return new mock.TFile(p); if ([...files.keys()].some(k => k.startsWith(p + '/'))) return new mock.TFolder(p); return null; },
      getResourcePath(f) { return 'app://res/' + f.path; },
      getFiles() { return [...files.keys()].map(p => new mock.TFile(p)); },
      getMarkdownFiles() { return [...files.keys()].filter(p => p.endsWith('.md')).map(p => new mock.TFile(p)); },
      on() { return {}; },
    },
    metadataCache: {
      getFileCache(f) { return caches.get(f.path) || null; },
      getTags() { const o = {}; for (const c of caches.values()) for (const t of (c.tags || [])) o[t.tag] = (o[t.tag] || 0) + 1; return o; },
      fileToLinktext(f) { return f.path.replace(/\.md$/, ''); },
      getFirstLinkpathDest(p) { if (!p) return null; for (const k of files.keys()) { if (k === p || k.endsWith('/' + p) || k.replace(/\.md$/, '') === p || k.replace(/\.md$/, '').endsWith('/' + p)) return new mock.TFile(k); } return null; },
      on() { return {}; },
    },
    internalPlugins: { revealed: [], searches: [], getEnabledPluginById() { return { revealInFolder: f => app.internalPlugins.revealed.push(f.path) }; }, getPluginById(id) { if (id === 'templates' && env.templatesFolder) return { enabled: true, instance: { options: { folder: env.templatesFolder } } }; return id === 'global-search' ? { instance: { openGlobalSearch: q => app.internalPlugins.searches.push(q) } } : null; } },
    workspace: { opened: [], hovers: [], openLinkText(t) { this.opened.push(t); }, getLeaf() { return { openFile() {} }; }, trigger(name, arg) { if (name === 'hover-link') this.hovers.push(arg.linktext); } },
    fileManager: { generateMarkdownLink: f => (f.extension === 'md' ? `[[${f.basename}]]` : `[[${f.name}]]`), getAvailablePathForAttachment: async n => n },
  };
  const plugin = {
    app, statusCalls: 0, history: new Map(),
    storeHistory(p, e) { this.history.set(p, Object.assign({ at: Date.now() }, e)); },
    takeHistory(p) { const e = this.history.get(p); this.history.delete(p); return e || null; },
    setFullWidth(on) { this.settings.fullWidth = on; }, outlineChanged() {}, outlineOpen() { return false; }, toggleOutline() {},
    saveSettings() {}, openSettings() {}, updateStatus() {}, setZoom(z) { this.settings.zoom = z; },
    settings: Object.assign({ fullWidth: false, zoom: 100 }, settings),
    converter: new B.MarkdownConverter(), switched: 0, switchToMarkdown() { this.switched++; },
  };
  const view = new B.WordModeView({ app }, plugin);
  view.load();
  await view.onOpen();
  const open = async (path, data) => { files.set(path, data); await view.loadFile(new mock.TFile(path), data); return view; };
  return Object.assign(env, { app, plugin, view, files, caches, open });
}

// 模擬打字：一次一個字，走編輯器的 handleTextInput（自動套用格式、自動完成都在這裡）
export function type(view, text) {
  const pm = view.pm;
  for (const ch of text) {
    const { from, to } = pm.state.selection;
    if (!pm.someProp('handleTextInput', f => f(pm, from, to, ch))) pm.dispatch(pm.state.tr.insertText(ch, from, to));
  }
}

// 模擬按鍵（Enter、Backspace、ArrowDown…）
export function press(view, key, mods = {}) {
  const ev = new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, mods));
  return !!view.pm.someProp('handleKeyDown', f => f(view.pm, ev));
}

// 游標放到第 n 個文字區塊的結尾（或指定的位移）
export function caret(view, blockIndex = 0, offset = null) {
  const pm = view.pm;
  let i = 0; let found = null;
  pm.state.doc.descendants((n, pos) => { if (found != null) return false; if (n.isTextblock) { if (i === blockIndex) found = { pos, n }; i++; return false; } return true; });
  const at = found.pos + 1 + (offset == null ? found.n.content.size : offset);
  pm.dispatch(pm.state.tr.setSelection(TextSelection.create(pm.state.doc, at)));
}
