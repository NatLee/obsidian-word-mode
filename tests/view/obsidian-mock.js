// 測試用的 Obsidian API 替身
const P = HTMLElement.prototype;
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, v) { this.classList.toggle(c, v); };
P.setText = function (t) { this.textContent = t; };
P.empty = function () { this.replaceChildren(); };
P.createEl = function (tag, o = {}) {
  const e = document.createElement(tag);
  if (o.cls) e.className = o.cls;
  if (o.text) e.textContent = o.text;
  if (o.type) e.type = o.type;
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
export class TFolder { constructor(path) { this.path = path; this.name = path.split('/').pop(); } }
export class Notice { constructor(m) { log.push(['notice', m]); } }
export class Menu {
  constructor() { this.items = []; }
  addItem(f) { const it = { title: '', disabled: false, setTitle(t) { this.title = t; return this; }, setIcon() { return this; }, setSection() { return this; }, onClick(fn) { this.fn = fn; return this; }, setDisabled(d) { this.disabled = d; return this; } }; f(it); this.items.push(it); return this; }
  addSeparator() { return this; }
  showAtMouseEvent() { Menu.last = this; }
  showAtPosition() { Menu.last = this; }
}
export class Modal {
  constructor(app) { this.app = app; this.titleEl = document.createElement('div'); this.contentEl = document.createElement('div'); this.modalEl = document.createElement('div'); }
  open() { Modal.last = this; document.body.appendChild(this.contentEl); this.onOpen(); }
  close() { this.contentEl.remove(); this.onClose && this.onClose(); }
}
export class FuzzySuggestModal extends Modal { setPlaceholder() {} open() { FuzzySuggestModal.last = this; } }
export const MarkdownRenderer = { render: async (app, src, el) => { el.textContent = 'RENDERED:' + src; } };
export function renderMath(src) { const s = document.createElement('span'); s.className = 'math'; s.textContent = src; return s; }
export function finishRenderMath() {}
export async function loadMathJax() {}
export function setIcon(el, name) { el.dataset.icon = name; }
export function normalizePath(p) { return p.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''); }
export const Platform = { isMobile: false };

class Events { on() { return {}; } }
export class TextFileView {
  constructor(leaf) {
    this.leaf = leaf; this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.contentEl = this.containerEl.createDiv('view-content');
    document.body.appendChild(this.containerEl);
    this.saves = [];
    this.requestSave = () => { this.saveRequested = (this.saveRequested || 0) + 1; };
  }
  load() { this._loaded = true; }
  registerDomEvent(el, type, fn, opt) { el.addEventListener(type, fn, opt); }
  addAction() { return document.createElement('div'); }
  registerEvent() {}
  register() {}
  onPaneMenu() {}
  async save() { const d = this.getViewData(); this.saves.push(d); await this.app.vault.modify(this.file, d); }
  async onUnloadFile() {}
  async loadFile(file, data) { this.file = file; this.setViewData(data, true); }
}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
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
