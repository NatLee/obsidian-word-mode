// 錄製用的 obsidian 模組替身：沿用 jsdom 測試的替身，再補上真的圖示、數學式、Mermaid、對話框與右鍵選單，
// 讓外掛在瀏覽器裡畫出來的樣子接近 Obsidian
import * as base from '../../tests/view/obsidian-mock.js';
export * from '../../tests/view/obsidian-mock.js';

// ---- Obsidian 加在每個元素上的 DOM 輔助函式（比 jsdom 替身完整：attr、title、parent、prepend…）
const E = Element.prototype;
function applyOpts(e, o) {
  if (o == null) return e;
  if (typeof o === 'string') { e.className = o; return e; }
  if (o.cls) e.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
  if (o.text != null) { if (o.text instanceof Node) e.appendChild(o.text); else e.textContent = String(o.text); }
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) { if (v != null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); }
  if (o.title) e.setAttribute('title', o.title);
  if (o.type) e.setAttribute('type', o.type);
  if (o.value != null) e.value = o.value;
  if (o.placeholder) e.setAttribute('placeholder', o.placeholder);
  if (o.href) e.setAttribute('href', o.href);
  return e;
}
function make(tag, o, cb, parent) {
  const e = applyOpts(document.createElement(tag), o);
  const p = (o && typeof o === 'object' && o.parent) || parent;
  if (p) { if (o && typeof o === 'object' && o.prepend) p.prepend(e); else p.appendChild(e); }
  if (cb) cb(e);
  return e;
}
E.createEl = function (tag, o, cb) { return make(tag, o, cb, this); };
E.createDiv = function (o, cb) { return make('div', o, cb, this); };
E.createSpan = function (o, cb) { return make('span', o, cb, this); };
E.addClass = function (...c) { this.classList.add(...c.flatMap(x => String(x).split(/\s+/)).filter(Boolean)); };
E.removeClass = function (...c) { this.classList.remove(...c.flatMap(x => String(x).split(/\s+/)).filter(Boolean)); };
E.toggleClass = function (c, v) { for (const x of (Array.isArray(c) ? c : [c])) this.classList.toggle(x, v); };
E.hasClass = function (c) { return this.classList.contains(c); };
E.setText = function (t) { this.textContent = t; };
E.empty = function () { this.replaceChildren(); };
E.detach = function () { this.remove(); };
E.setAttr = function (k, v) { if (v == null) this.removeAttribute(k); else this.setAttribute(k, String(v)); };
E.show = function () { this.style.display = ''; };
E.hide = function () { this.style.display = 'none'; };
E.toggle = function (v) { this.style.display = v ? '' : 'none'; };
E.isShown = function () { return this.style.display !== 'none'; };
// jsdom 替身把較簡單的版本放在 HTMLElement.prototype，會蓋過上面的，先拿掉
for (const k of ['createEl', 'createDiv', 'createSpan', 'addClass', 'removeClass', 'toggleClass', 'setText', 'empty', 'show', 'hide', 'toggle']) delete HTMLElement.prototype[k];
window.createEl = (tag, o, cb) => make(tag, o, cb, null);
window.createDiv = (o, cb) => make('div', o, cb, null);
window.createSpan = (o, cb) => make('span', o, cb, null);
window.createFragment = cb => { const f = document.createDocumentFragment(); if (cb) cb(f); return f; };
DocumentFragment.prototype.createEl = function (tag, o, cb) { return make(tag, o, cb, this); };
DocumentFragment.prototype.createDiv = function (o, cb) { return make('div', o, cb, this); };
DocumentFragment.prototype.createSpan = function (o, cb) { return make('span', o, cb, this); };
window.activeDocument = document;
window.activeWindow = window;

// ---- 圖示：Obsidian 用的就是 Lucide
const pascal = n => n.replace(/^lucide-/, '').split('-').map(s => (s ? s[0].toUpperCase() + s.slice(1) : '')).join('');
export function setIcon(el, name) {
  el.replaceChildren();
  const L = window.lucide;
  if (!L || !name) return;
  const node = L.icons[pascal(name)];
  // 找不到的圖示記下來，錄完可以檢查（Obsidian 自己的少數圖示不在 Lucide 裡）
  if (!node) { (window.__missingIcons = window.__missingIcons || new Set()).add(name); return; }
  const svg = L.createElement(node);
  svg.setAttribute('class', 'svg-icon lucide-' + name);
  svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
  el.appendChild(svg);
}

// ---- 數學式：MathJax 3（SVG 輸出）
export async function loadMathJax() {
  while (!(window.MathJax && window.MathJax.tex2svg)) await new Promise(r => setTimeout(r, 30));
  await window.MathJax.startup.promise;
  // MathJax 自己的樣式（獨立一行的方程式置中），平常是排版整頁時才加
  if (!document.getElementById('MJX-SVG-styles') && window.MathJax.svgStylesheet) document.head.appendChild(window.MathJax.svgStylesheet());
}
export function renderMath(src, display) {
  const MJ = window.MathJax;
  if (!MJ || !MJ.tex2svg) { const s = document.createElement('span'); s.textContent = src; return s; }
  return MJ.tex2svg(src, { display: !!display });
}
export function finishRenderMath() { return Promise.resolve(); }

// ---- Mermaid 與 Markdown 的轉譯：只做錄製用得到的部分（Mermaid 區塊、獨立一行的方程式、純文字）
let mmReady = null;
export async function loadMermaid() {
  if (!mmReady) mmReady = (async () => {
    while (!window.mermaid) await new Promise(r => setTimeout(r, 30));
    window.mermaid.initialize({ startOnLoad: false, theme: 'default', fontFamily: 'var(--font-interface)', securityLevel: 'loose' });
    return window.mermaid;
  })();
  return mmReady;
}
let mmId = 0;
export const MarkdownRenderer = {
  async render(app, src, el) {
    const m = /^```mermaid\n([\s\S]*?)\n?```\s*$/.exec(src);
    if (m) {
      const mm = await loadMermaid();
      const host = el.createDiv('mermaid');
      // 錄製工具不是外掛本身，Mermaid 回傳的是 SVG 字串，這裡直接放進去
      try { const { svg } = await mm.render('wm-rec-mmd-' + (++mmId), m[1]); host.innerHTML = svg; } catch (e) { host.textContent = String((e && e.message) || e); }
      return;
    }
    const math = /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec(src);
    if (math) {
      await loadMathJax();
      el.createDiv('math-block').appendChild(renderMath(math[1].trim(), true));
      return;
    }
    const d = el.createDiv('markdown-rendered');
    for (const para of src.split(/\n{2,}/)) d.createEl('p', { text: para });
  },
};

// ---- 程式碼區塊的語法上色
export async function loadPrism() { return window.Prism || base.FakePrism; }

// ---- 長得像 Obsidian 的對話框
export class Modal {
  constructor(app) {
    this.app = app;
    this.scope = new base.Scope();
    this.containerEl = createDiv('modal-container mod-dim');
    this.containerEl.createDiv('modal-bg');
    this.modalEl = this.containerEl.createDiv('modal');
    const close = this.modalEl.createDiv('modal-close-button');
    setIcon(close, 'x');
    close.addEventListener('click', () => this.close());
    this.titleEl = this.modalEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
  }
  setTitle(t) { this.titleEl.setText(t); return this; }
  open() { Modal.last = this; document.body.appendChild(this.containerEl); if (this.onOpen) this.onOpen(); }
  close() { this.containerEl.remove(); if (this.onClose) this.onClose(); }
}

// ---- 真的畫出來的右鍵選單（含子選單）
class Item {
  constructor(menu) { this.menu = menu; this.title = ''; this.icon = null; this.disabled = false; this.sub = null; }
  setTitle(t) { this.title = t; return this; }
  setIcon(i) { this.icon = i; return this; }
  setSection() { return this; }
  setChecked() { return this; }
  setDisabled(d) { this.disabled = !!d; return this; }
  setWarning() { return this; }
  setIsLabel() { return this; }
  onClick(fn) { this.fn = fn; return this; }
  setSubmenu() { this.sub = new Menu(); return this.sub; }
}
export class Menu {
  constructor() { this.items = []; this.hideFns = []; }
  addItem(f) { const it = new Item(this); f(it); this.items.push(it); return this; }
  addSeparator() { this.items.push('sep'); return this; }
  setNoIcon() { return this; }
  setUseNativeMenu() { return this; }
  onHide(fn) { this.hideFns.push(fn); return this; }
  showAtMouseEvent(e) { return this.showAtPosition({ x: e.clientX, y: e.clientY }); }
  showAtPosition(p) {
    Menu.last = this;
    if (!this.parentMenu) for (const m of document.querySelectorAll('.menu')) m.remove();
    const el = this.el = document.body.createDiv('menu');
    for (const it of this.items) {
      if (it === 'sep') { if (el.lastChild && !el.lastChild.classList.contains('menu-separator')) el.createDiv('menu-separator'); continue; }
      const row = el.createDiv('menu-item' + (it.disabled ? ' is-disabled' : '') + (it.sub ? ' has-submenu' : ''));
      const ic = row.createDiv('menu-item-icon'); if (it.icon) setIcon(ic, it.icon);
      row.createDiv({ cls: 'menu-item-title', text: it.title });
      if (it.sub) setIcon(row.createDiv('menu-item-icon mod-submenu'), 'chevron-right');
      it.row = row;
      // 滑鼠移到有子選單的項目就展開，跟 Obsidian 一樣
      row.addEventListener('mouseenter', () => {
        for (const o of this.items) if (o !== 'sep' && o.row) o.row.classList.toggle('selected', o === it);
        if (this.openSub && this.openSub !== it.sub) { this.openSub.hide(); this.openSub = null; }
        if (it.sub && this.openSub !== it.sub) { const r = row.getBoundingClientRect(); it.sub.parentMenu = this; it.sub.showAtPosition({ x: r.right - 4, y: r.top - 4 }); this.openSub = it.sub; }
      });
      row.addEventListener('click', ev => { if (it.disabled || it.sub) return; ev.stopPropagation(); this.root().hide(); if (it.fn) it.fn(ev); });
    }
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    // 超出視窗時往內移
    const r = el.getBoundingClientRect();
    if (r.bottom > innerHeight - 8) el.style.top = Math.max(8, innerHeight - 8 - r.height) + 'px';
    if (r.right > innerWidth - 8) el.style.left = Math.max(8, this.parentMenu ? p.x - r.width - this.parentMenu.el.getBoundingClientRect().width + 8 : innerWidth - 8 - r.width) + 'px';
    if (!this.parentMenu) setTimeout(() => { this.away = ev => { if (!ev.target.closest('.menu')) this.hide(); }; document.addEventListener('mousedown', this.away, true); });
    return this;
  }
  root() { let m = this; while (m.parentMenu) m = m.parentMenu; return m; }
  hide() {
    if (this.openSub) { this.openSub.hide(); this.openSub = null; }
    if (this.el) this.el.remove();
    if (this.away) document.removeEventListener('mousedown', this.away, true);
    for (const f of this.hideFns) f();
  }
}

// ---- 有 Obsidian 檢視標題列的分頁：addAction() 的按鈕放在跟 Obsidian 一樣的位置
export class TextFileView extends base.TextFileView {
  constructor(leaf) {
    super(leaf);
    this.containerEl.className = 'workspace-leaf-content';
    const head = this.headerEl = createDiv('view-header');
    const nav = head.createDiv('view-actions');
    for (const i of ['arrow-left', 'arrow-right']) setIcon(nav.createDiv('clickable-icon'), i);
    this.titleEl = head.createDiv('view-header-title');
    this.actionsEl = head.createDiv('view-actions');
    setIcon(this.actionsEl.createDiv('clickable-icon'), 'more-vertical');
    this.containerEl.prepend(head);
  }
  addAction(icon, title, cb) {
    const b = createDiv({ cls: 'clickable-icon view-action', attr: { 'aria-label': title } });
    setIcon(b, icon);
    b.addEventListener('click', ev => cb(ev));
    this.actionsEl.prepend(b);
    return b;
  }
}

export class Notice { constructor(m) { base.log.push(['notice', m]); } setMessage() { return this; } hide() {} }
