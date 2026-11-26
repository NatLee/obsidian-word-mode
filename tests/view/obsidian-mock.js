// 測試用的 Obsidian API 替身
const P = HTMLElement.prototype;
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, v) { this.classList.toggle(c, v); };
P.setText = function (t) { this.textContent = t; };
P.empty = function () { this.replaceChildren(); };
P.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
P.createEl = function (tag, o = {}) {
  const e = document.createElement(tag);
  if (o.cls) e.className = o.cls;
  if (o.text) e.textContent = o.text;
  if (o.type) e.type = o.type;
  if (o.value != null) e.value = o.value;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) e.setAttribute(k, String(v));
  this.appendChild(e);
  return e;
};
P.createDiv = function (o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); };
P.createSpan = function (o) { return this.createEl('span', typeof o === 'string' ? { cls: o } : (o || {})); };
P.show = function () { this.style.display = ''; };
P.hide = function () { this.style.display = 'none'; };
P.toggle = function (v) { this.style.display = v ? '' : 'none'; };

export const log = [];

export class TFile {
  constructor(path) { this.path = path; this.name = path.split('/').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); this.extension = this.name.split('.').pop(); this.parent = { path: path.split('/').slice(0, -1).join('/') }; this.stat = { size: 10 }; }
}
export class TFolder { constructor(path, children = []) { this.path = path; this.name = path.split('/').pop(); this.children = children; } }
export class Vault { static recurseChildren(root, cb) { cb(root); for (const c of root.children || []) { if (c instanceof TFolder) Vault.recurseChildren(c, cb); else cb(c); } } }
export class FileSystemAdapter { getFullPath(p) { return '/vault/' + p; } }
export class Notice { constructor(m) { log.push(['notice', m]); } }
export class Menu {
  constructor() { this.items = []; }
  addItem(f) { const it = { title: '', disabled: false, setTitle(t) { this.title = t; return this; }, setIcon() { return this; }, setSection() { return this; }, onClick(fn) { this.fn = fn; return this; }, setDisabled(d) { this.disabled = d; return this; }, setSubmenu() { this.submenu = new Menu(); return this.submenu; } }; f(it); this.items.push(it); return this; }
  addSeparator() { return this; }
  showAtMouseEvent() { Menu.last = this; }
  showAtPosition() { Menu.last = this; }
}
export class Modal {
  constructor(app) { this.app = app; this.titleEl = document.createElement('div'); this.contentEl = document.createElement('div'); this.modalEl = document.createElement('div'); }
  open() { Modal.last = this; document.body.appendChild(this.contentEl); if (this.onOpen) this.onOpen(); }
  close() { this.contentEl.remove(); this.onClose && this.onClose(); }
}
export class FuzzySuggestModal extends Modal { setPlaceholder() {} open() { FuzzySuggestModal.last = this; } }
export const MarkdownRenderer = { render: async (app, src, el) => { el.textContent = 'RENDERED:' + src; } };
export function renderMath(src) { const s = document.createElement('span'); s.className = 'math'; s.textContent = src; return s; }
export function finishRenderMath() {}
export async function loadMathJax() {}
export function setIcon(el, name) { el.dataset.icon = name; }
export function getIcon() { return null; }
export const apiVersion = '1.5.7';
export function requireApiVersion() { return true; }
export function normalizePath(p) { return p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export const Platform = { isMobile: false };
export class MenuItem {}

class Events { on() { return {}; } }
export class TextFileView {
  constructor(leaf) {
    this.leaf = leaf; this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.contentEl = this.containerEl.createDiv('view-content');
    document.body.appendChild(this.containerEl);
    this.saves = [];
    this.data = null; this.lastSavedData = null; this.dirty = false; this.saving = false; this.saveAgain = false;
    // 真的 Obsidian 在 2 秒後自動存檔；測試自己決定什麼時候呼叫 save()
    this.requestSave = () => { this.dirty = true; this.saveRequested = (this.saveRequested || 0) + 1; };
  }
  load() { this._loaded = true; }
  registerDomEvent(el, type, fn, opt) { el.addEventListener(type, fn, opt); }
  // 右上角的按鈕：記下圖示與名稱，點一下執行（真的 Obsidian 也是這樣）
  addAction(icon, title, cb) { const d = document.createElement('div'); d.dataset.icon = icon; d.setAttribute('aria-label', title); if (cb) d.addEventListener('click', cb); (this.actions || (this.actions = [])).push(d); return d; }
  registerEvent() {}
  register() {}
  onPaneMenu() {}
  // ---- 存檔、關閉、檔案在外面被改：照 Obsidian 的 TextFileView 寫（對照過 1.5.8 與 1.15.1 的 app.js，
  // 兩版流程相同）。重點是 Obsidian 自己會在這幾個時機呼叫 getViewData()／setViewData()，
  // 外掛的存檔狀態不能假設「getViewData() 被呼叫就等於存好了」
  async save(clear) {
    this.dirty = false;
    const file = this.file;
    if (!file) return;
    if (this.saving) { if (!clear) this.saveAgain = true; return; }
    this.saveAgain = false;
    const data = this.getViewData();
    if (this.lastSavedData === data || this.lastSavedData === null) return;
    const before = this.lastSavedData;
    if (clear) { this.data = null; this.lastSavedData = null; this.clear(); } else { this.data = data; this.lastSavedData = data; }
    this.saving = true;
    try { await this.app.vault.modify(file, data); this.saves.push(data); }
    catch (e) { this.lastSavedData = before; throw e; } // 真的 Obsidian 還會跳通知、把內容存進檔案復原
    finally { this.saving = false; if (this.saveAgain && !clear) void this.save(); }
  }
  async onUnloadFile() { await this.save(true); }
  // 檔案被改（同步、其他外掛、自己存檔）時 Obsidian 會呼叫；測試改完 files 之後自己呼叫
  async onModify(file) { if (!this.saving && file === this.file) await this.loadFileInternal(file, false); }
  async loadFileInternal(file, initial) {
    let data = await this.app.vault.read(file);
    const before = this.lastSavedData;
    this.lastSavedData = data;
    if (!initial && before) {
      if (before === data) return;
      if (this.dirty) {
        const mine = this.getViewData();
        if (mine === data) return;
        if (mine !== before) data = merge3(before, mine, data);
      }
    }
    this.setData(data, initial);
  }
  setData(data, clear) { if (this.data !== data || clear) { this.data = data; this.setViewData(data, clear); } }
  async loadFile(file, data) { this.file = file; this.dirty = false; this.lastSavedData = data; this.setData(data, true); }
}
// Obsidian 用 diff-match-patch 做三方合併；這裡以行為單位，足以表現「兩邊改不同行就都保留」。
// 行數不同時當成合併不了，用磁碟上的版本
function merge3(base, mine, theirs) {
  const b = base.split('\n'), m = mine.split('\n'), th = theirs.split('\n');
  if (b.length !== m.length || b.length !== th.length) return theirs;
  return b.map((line, i) => (m[i] !== line ? m[i] : th[i])).join('\n');
}
export class Plugin {}
// 設定頁：只做出 Obsidian 的 DOM 結構（setting-item 的名稱、說明、控制項），控制項是什麼方法都接受、回傳自己的替身
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); } }
const settingControl = () => { const base = { inputEl: document.createElement('input') }; const p = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => p) }); return p; };
export class Setting {
  constructor(el) {
    this.settingEl = el.createDiv('setting-item');
    this.infoEl = this.settingEl.createDiv('setting-item-info');
    this.nameEl = this.infoEl.createDiv('setting-item-name');
    this.descEl = this.infoEl.createDiv('setting-item-description');
    this.controlEl = this.settingEl.createDiv('setting-item-control');
  }
  setName(n) { this.nameEl.textContent = n; return this; }
  setDesc(d) { this.descEl.textContent = d; return this; }
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this; }
}
for (const k of ['addToggle', 'addDropdown', 'addSlider', 'addText', 'addTextArea', 'addButton', 'addColorPicker', 'addExtraButton']) Setting.prototype[k] = function (cb) { cb(settingControl()); return this; };
export class WorkspaceLeafX { setViewState() {} }
export class MarkdownView {}
export { Events };

export class Scope { constructor(parent) { this.parent = parent; this.keys = []; } register(mods, key, fn) { this.keys.push({ mods, key, fn }); return this; } }
// 簡化版 YAML（測試用）：key: value、key: [a, b]、清單 - item
export function parseYaml(t) {
  const o = {}; let cur = null;
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && cur) { (o[cur] = Array.isArray(o[cur]) ? o[cur] : []).push(li[1]); continue; }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) throw new Error('bad yaml');
    cur = m[1].trim();
    let v = m[2].trim();
    if (v === '') v = null;
    else if (/^\[(.*)\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
    else if (v === 'true' || v === 'false') v = v === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    o[cur] = v;
  }
  return o;
}
export function stringifyYaml(o) {
  let s = '';
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) { s += k + ':\n'; for (const x of v) s += '  - ' + x + '\n'; }
    else s += k + ': ' + (v == null ? '' : v) + '\n';
  }
  return s;
}
export class WorkspaceLeaf { setViewState() {} }
export const FakePrism = {
  languages: { python: { keyword: /\bdef\b/ } },
  tokenize(text) {
    const out = []; const re = /\bdef\b/g; let last = 0; let m;
    while ((m = re.exec(text))) { if (m.index > last) out.push(text.slice(last, m.index)); out.push({ type: 'keyword', content: 'def', length: 3 }); last = m.index + 3; }
    if (last < text.length) out.push(text.slice(last));
    return out;
  },
};
export async function loadPrism() { return FakePrism; }
export class ItemView {}

// 模糊搜尋的簡化版：包含就算符合，越前面分數越高
export function prepareFuzzySearch(q) { const s = q.toLowerCase(); return text => { const i = text.toLowerCase().indexOf(s); return i < 0 ? null : { score: -i, matches: [] }; }; }
export function getAllTags(cache) { return (cache.tags || []).map(x => x.tag); }

export class Component { constructor() { this.children = []; } load() { this.loaded = true; } unload() { this.loaded = false; Component.unloaded = (Component.unloaded || 0) + 1; } addChild(c) { this.children.push(c); c.load(); return c; } removeChild(c) { c.unload(); return c; } }
// 其他外掛註冊的程式碼區塊（測試用：假裝有 dataview）
export const MarkdownPreviewRenderer = { codeBlockPostProcessors: { dataview() {} } };
export async function loadMermaid() { return { parse: async s => { if (/語法錯誤/.test(s)) throw new Error('Parse error on line 2'); } }; }

// 標題底下的內容：從該標題開始，到下一個同級或更高層級的標題之前
export function resolveSubpath(cache, subpath) {
  const name = subpath.replace(/^#/, '').split('#').pop();
  const hs = cache.headings || [];
  const i = hs.findIndex(h => h.heading === name);
  if (i < 0) return null;
  const next = hs.slice(i + 1).find(h => h.level <= hs[i].level);
  return { type: 'heading', current: hs[i], next: next || null, start: hs[i].position.start, end: next ? next.position.start : null };
}
