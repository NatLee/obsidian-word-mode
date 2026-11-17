import { TableView } from 'prosemirror-tables';
import { CALLOUT_TYPES, calloutIcon, CODE_LANGUAGES } from './commands.js';
import { t } from './i18n.js';

// 特殊節點的顯示方式（ctx 由 Obsidian 端提供）
// ctx: { openLink(target, newLeaf), isResolved(target), resolveImage(attrs) -> url|null,
//        renderMarkdown(src, el), renderMath(src, el, display), editSource(title, src, onSave), menu(evt, items) }

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const isMod = e => e.ctrlKey || e.metaKey;

function displayTarget(tv) {
  return tv.replace(/\.md$/i, '').replace(/#\^?/, ' › ');
}

class WikilinkView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('span', 'wm-wikilink');
    this.dom.addEventListener('mousedown', e => {
      if (isMod(e) && e.button === 0) { e.preventDefault(); e.stopPropagation(); ctx.openLink(this.node.attrs.target, e.shiftKey); }
    });
    this.dom.addEventListener('contextmenu', e => {
      const pos = this.getPos();
      ctx.menu(e, [
        { title: t('開啟連結'), icon: 'file-input', run: () => ctx.openLink(this.node.attrs.target, false) },
        { title: t('在新分頁開啟'), icon: 'file-plus', run: () => ctx.openLink(this.node.attrs.target, true) },
        { title: t('編輯連結…'), icon: 'pencil', run: () => ctx.editLinkAt(pos) },
      ]);
    });
    this.render();
  }
  render() {
    const a = this.node.attrs;
    this.dom.replaceChildren();
    if (a.embed) { const i = el('span', 'wm-inline-icon', this.dom); this.ctx.icon(i, 'file-text', ''); }
    this.dom.appendChild(document.createTextNode(a.alias || displayTarget(a.target)));
    this.dom.classList.toggle('is-embed', !!a.embed);
    this.dom.classList.toggle('is-unresolved', !this.ctx.isResolved(a.target));
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node; this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  ignoreMutation() { return true; }
  stopEvent(e) { return e.type === 'contextmenu'; }
}

export function parseWidth(attrs) {
  let w = attrs.width;
  if (!w && !attrs.wiki && attrs.alt) { const m = /\|(\d+)(?:x(\d+))?$/.exec(attrs.alt); if (m) w = m[1]; }
  if (!w) return null;
  const m = /^(\d+)/.exec(String(w));
  return m ? +m[1] : null;
}

export function imageAttrsWithWidth(attrs, w) {
  const a = Object.assign({}, attrs);
  a.width = w ? String(Math.round(w)) : null;
  if (!a.wiki && a.alt) a.alt = a.alt.replace(/\|\d+(x\d+)?$/, '') || null;
  return a;
}

class ImageView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('span', 'wm-image');
    this.img = el('img', null, this.dom);
    this.img.draggable = false;
    this.missing = el('span', 'wm-image-missing', this.dom);
    this.badge = el('span', 'wm-image-badge', this.dom);
    for (const dir of [-1, 1]) {
      const h = el('span', 'wm-image-handle ' + (dir < 0 ? 'is-left' : 'is-right'), this.dom);
      h.setAttribute('aria-label', t('拖曳調整大小'));
      // pointer 事件同時支援滑鼠與觸控（手機、平板）
      h.addEventListener('pointerdown', e => this.startResize(e, dir));
    }
    this.img.addEventListener('load', () => this.updateBadge());
    this.dom.addEventListener('contextmenu', e => { const pos = this.getPos(); if (pos != null) ctx.imageMenu(e, pos); });
    this.render();
  }
  render() {
    const a = this.node.attrs;
    const url = this.ctx.resolveImage(a);
    if (url) {
      if (this.img.getAttribute('src') !== url) this.img.src = url;
      this.img.style.display = '';
      this.missing.style.display = 'none';
    } else {
      this.img.style.display = 'none';
      this.missing.style.display = '';
      this.missing.replaceChildren();
      const i = el('span', 'wm-inline-icon', this.missing); this.ctx.icon(i, 'image-off', '');
      this.missing.appendChild(document.createTextNode(t('找不到圖片：') + a.src));
    }
    this.img.alt = (a.alt || '').replace(/\|\d+(x\d+)?$/, '');
    const w = parseWidth(a);
    this.img.style.width = w ? w + 'px' : '';
    this.updateBadge();
  }
  updateBadge(w) {
    const width = w || parseWidth(this.node.attrs);
    this.badge.textContent = width ? width + ' px' : (this.img.naturalWidth ? t('原始 ') + this.img.naturalWidth + ' px' : t('原始大小'));
  }
  setWidth(w) {
    const pos = this.getPos();
    if (pos == null) return;
    this.ctx.setImageWidth(pos, w);
  }
  startResize(e, dir) {
    e.preventDefault(); e.stopPropagation();
    const handle = e.currentTarget;
    const startX = e.clientX;
    const startW = this.img.getBoundingClientRect().width || this.img.naturalWidth || 200;
    const maxW = this.ctx.pageWidth();
    const calc = ev => Math.min(maxW, Math.max(40, Math.round((startW + dir * (ev.clientX - startX)) / 10) * 10));
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 舊環境 */ }
    this.dom.classList.add('is-resizing');
    const move = ev => { const w = calc(ev); this.img.style.width = w + 'px'; this.updateBadge(w); };
    const up = ev => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      window.removeEventListener('pointerup', up);
      this.dom.classList.remove('is-resizing');
      this.setWidth(calc(ev));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    window.addEventListener('pointerup', up);
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node; this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e) { return (e.target && e.target.classList && e.target.classList.contains('wm-image-handle')) || e.type === 'contextmenu'; }
  ignoreMutation() { return true; }
}

const RAW_LABEL = {
  callout: t('提示框'), html: 'HTML', math: t('數學式'), comment: t('註解'), raw: t('Markdown 原文'),
};

class RawBlockView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'wm-raw-block');
    this.dom.contentEditable = 'false';
    this.label = el('div', 'wm-raw-label', this.dom);
    this.body = el('div', 'wm-raw-body', this.dom);
    this.dom.addEventListener('dblclick', e => { e.preventDefault(); this.edit(); });
    this.dom.addEventListener('mousedown', e => {
      const a = e.target.closest && e.target.closest('a');
      if (a && isMod(e)) {
        e.preventDefault(); e.stopPropagation();
        const href = a.getAttribute('data-href') || a.getAttribute('href');
        if (href) ctx.openLink(href, e.shiftKey);
      }
    });
    this.dom.addEventListener('click', e => { if (e.target.closest && e.target.closest('a')) e.preventDefault(); }, true);
    // 右鍵選單由編輯器統一處理（view.onContextMenu）
    this.render();
  }
  render() {
    const a = this.node.attrs;
    this.label.textContent = t(RAW_LABEL[a.kind] || RAW_LABEL.raw) + t('（按兩下編輯）');
    this.dom.dataset.kind = a.kind;
    this.body.replaceChildren();
    if (a.kind === 'comment') { el('pre', 'wm-raw-comment', this.body, a.src); return; }
    this.ctx.renderMarkdown(a.src, this.body);
  }
  edit() {
    const mm = this.node.attrs.kind === 'math' && /^\s*\$\$([\s\S]*?)\$\$\s*$/.exec(this.node.attrs.src);
    if (mm && this.ctx.editMath) { this.ctx.editMath(this.getPos(), mm[1].trim(), true); return; }
    this.ctx.editSource(t('編輯') + t(RAW_LABEL[this.node.attrs.kind] || RAW_LABEL.raw), this.node.attrs.src, value => {
      const pos = this.getPos();
      if (pos == null) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: value.replace(/\s+$/, '') })));
    });
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src || node.attrs.kind !== this.node.attrs.kind;
    this.node = node;
    if (changed) this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e) { return e.type === 'dblclick' || (e.type === 'mousedown' && isMod(e)); }
  ignoreMutation() { return true; }
}

class RawInlineView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('span', 'wm-raw-inline');
    this.dom.addEventListener('dblclick', e => { e.preventDefault(); this.edit(); });
    this.render();
  }
  render() {
    const s = this.node.attrs.src;
    this.dom.replaceChildren();
    this.dom.className = 'wm-raw-inline';
    let m;
    if ((m = /^\$\$([\s\S]+)\$\$$/.exec(s)) || (m = /^\$([^$][\s\S]*)\$$/.exec(s))) {
      this.dom.classList.add('is-math');
      this.ctx.renderMath(m[1], this.dom, false);
      this.dom.setAttribute('aria-label', t('方程式（按兩下或按右鍵編輯）') + '\n' + m[1].trim());
    } else if (/^%%[\s\S]*%%$/.test(s)) {
      this.dom.classList.add('is-comment');
      this.ctx.icon(this.dom, 'message-square', t('註'));
      this.dom.setAttribute('aria-label', t('註解（閱讀模式不顯示，點一下編輯）') + '\n' + s.slice(2, -2).trim());
    } else if ((m = /^\[\^([^\]]+)\]$/.exec(s))) {
      this.dom.classList.add('is-footnote');
      this.dom.textContent = '[' + m[1] + ']';
    } else {
      this.dom.classList.add('is-source');
      this.dom.textContent = s;
    }
  }
  edit() {
    const m = /^\$\$([\s\S]+)\$\$$/.exec(this.node.attrs.src) || /^\$([^$][\s\S]*)\$$/.exec(this.node.attrs.src);
    if (m && this.ctx.editMath) { this.ctx.editMath(this.getPos(), m[1].trim(), false); return; }
    this.ctx.editSource(t('編輯原文'), this.node.attrs.src, value => {
      const pos = this.getPos();
      if (pos == null || !value) return;
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { src: value }));
    });
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (changed) this.render();
    return true;
  }
  stopEvent(e) { return e.type === 'dblclick'; }
  ignoreMutation() { return true; }
}

// 文件屬性（frontmatter / metadata）：像 Word 的「摘要資訊」，以表單編輯，存回 YAML
const LIST_KEYS = /^(tags|aliases|cssclasses|cssclass|alias|tag)$/i;
function propType(key, value, hint) {
  if (hint === 'multitext' || hint === 'tags' || hint === 'aliases' || Array.isArray(value) || LIST_KEYS.test(key)) return 'list';
  if (hint === 'checkbox' || typeof value === 'boolean') return 'checkbox';
  if (hint === 'number' || typeof value === 'number') return 'number';
  if (hint === 'date' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date';
  if (hint === 'datetime' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))) return 'datetime';
  if (value && typeof value === 'object') return 'object';
  return 'text';
}
const TYPE_LABEL = { text: t('文字'), list: t('清單'), number: t('數字'), checkbox: t('核取方塊'), date: t('日期'), datetime: t('日期時間'), object: t('其他') };
const TYPE_ICON = { text: 'text', list: 'list', number: 'binary', checkbox: 'check-square', date: 'calendar', datetime: 'clock', object: 'braces' };

class FrontmatterView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'wm-props');
    this.dom.contentEditable = 'false';
    this.dom.wmOpen = () => { this.ctx.setPropsOpen(true); this.render(); };
    this.render();
  }
  inner() { return this.node.attrs.src.replace(/^---[^\n]*\r?\n/, '').replace(/\r?\n?(---|\.\.\.)\s*$/, ''); }
  data() {
    const tv = this.inner();
    if (!tv.trim()) return {};
    try {
      const o = this.ctx.parseYaml(tv);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (e) { return null; }
  }
  commit(obj) {
    const pos = this.getPos();
    if (pos == null) return;
    const body = Object.keys(obj).length ? this.ctx.stringifyYaml(obj).replace(/\s+$/, '') + '\n' : '';
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: '---\n' + body + '---' })));
  }
  editRaw() {
    this.ctx.editSource(t('編輯文件屬性（YAML 原文）'), this.node.attrs.src, value => {
      const pos = this.getPos();
      if (pos == null) return;
      let v = value.replace(/\s+$/, '');
      if (!/^---\r?\n/.test(v)) v = '---\n' + v;
      if (!/\n(---|\.\.\.)$/.test(v)) v += '\n---';
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { src: v })));
    });
  }
  render() {
    const open = this.ctx.propsOpen();
    const d = this.dom;
    d.replaceChildren();
    const obj = this.data();
    const head = el('div', 'wm-props-head', d);
    const chev = el('span', 'wm-props-chev', head); this.ctx.icon(chev, open ? 'chevron-down' : 'chevron-right', open ? '▾' : '▸');
    el('span', 'wm-props-title', head, t('文件屬性'));
    el('span', 'wm-props-count', head, obj ? Object.keys(obj).length + ' 項' : 'YAML');
    head.addEventListener('mousedown', e => { e.preventDefault(); this.ctx.setPropsOpen(!this.ctx.propsOpen()); this.render(); });
    const raw = el('button', 'wm-props-raw', head); raw.type = 'button'; raw.setAttribute('aria-label', t('編輯 YAML 原文')); this.ctx.icon(raw, 'code-2', t('原文'));
    raw.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.editRaw(); });
    if (!open) return;
    const body = el('div', 'wm-props-body', d);
    if (!obj) {
      el('div', 'wm-props-note', body, t('這份文件屬性的格式比較特殊，請按右上角「原文」編輯。'));
      el('pre', 'wm-fm-body', body, this.inner());
      return;
    }
    for (const key of Object.keys(obj)) this.row(body, obj, key);
    this.addRow(body, obj);
  }
  row(body, obj, key) {
    const value = obj[key];
    const type = propType(key, value, this.ctx.propertyType && this.ctx.propertyType(key));
    const r = el('div', 'wm-prop', body);
    const k = el('div', 'wm-prop-key', r);
    const ic = el('span', 'wm-prop-icon', k); this.ctx.icon(ic, TYPE_ICON[type], '');
    el('span', null, k, key);
    k.setAttribute('aria-label', key + t('（') + t(TYPE_LABEL[type]) + t('）'));
    const v = el('div', 'wm-prop-value', r);
    const set = nv => { const o = Object.assign({}, obj); o[key] = nv; this.commit(o); };
    if (type === 'list') {
      const arr = Array.isArray(value) ? value.slice() : (value == null || value === '' ? [] : [value]);
      arr.forEach((item, i) => {
        const chip = el('span', 'wm-chip', v, String(item));
        const x = el('span', 'wm-chip-x', chip, '×');
        x.setAttribute('aria-label', t('移除'));
        x.addEventListener('mousedown', e => { e.preventDefault(); const a = arr.slice(); a.splice(i, 1); set(a); });
      });
      const inp = el('input', 'wm-prop-input wm-chip-input', v);
      inp.placeholder = t('新增…');
      const add = () => {
        const tv = inp.value.trim().replace(/^#/, '');
        if (!tv) return;
        set(arr.concat(tv.split(/[,，]\s*/).filter(Boolean)));
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      inp.addEventListener('blur', add);
    } else if (type === 'checkbox') {
      const cb = el('input', 'wm-prop-check', v); cb.type = 'checkbox'; cb.checked = !!value;
      cb.addEventListener('change', () => set(cb.checked));
    } else if (type === 'object') {
      el('code', 'wm-prop-object', v, JSON.stringify(value));
      v.setAttribute('aria-label', t('巢狀資料請用「原文」編輯'));
    } else {
      const inp = el('input', 'wm-prop-input', v);
      inp.type = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text';
      inp.value = value == null ? '' : String(value).slice(0, type === 'datetime' ? 16 : undefined);
      inp.placeholder = t('（空白）');
      const save = () => {
        let nv = inp.value;
        if (type === 'number') nv = nv === '' ? null : Number(nv);
        else if (nv === '') nv = null;
        if (nv === value || (nv === null && value == null)) return;
        set(nv);
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('change', save);
    }
    const del = el('button', 'wm-prop-del', r); del.type = 'button'; del.setAttribute('aria-label', t('刪除這個屬性')); this.ctx.icon(del, 'x', '×');
    del.addEventListener('mousedown', e => { e.preventDefault(); const o = Object.assign({}, obj); delete o[key]; this.commit(o); });
  }
  addRow(body, obj) {
    const r = el('div', 'wm-prop wm-prop-add', body);
    const k = el('input', 'wm-prop-input', r); k.placeholder = t('＋ 新增屬性名稱');
    const tv = el('select', 'wm-prop-type dropdown', r);
    for (const [val, label] of Object.entries(TYPE_LABEL)) { if (val === 'object') continue; const o = el('option', null, tv, t(label)); o.value = val; }
    const go = () => {
      const key = k.value.trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(obj, key)) { k.select(); return; }
      const init = { text: '', list: [], number: 0, checkbox: false, date: (window.moment ? window.moment().format('YYYY-MM-DD') : new Date().toISOString().slice(0, 10)), datetime: (window.moment ? window.moment().format('YYYY-MM-DDTHH:mm') : new Date().toISOString().slice(0, 16)) }[tv.value];
      const o = Object.assign({}, obj); o[key] = init === '' ? null : init;
      this.commit(o);
    };
    k.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const b = el('button', 'wm-prop-addbtn', r, t('新增')); b.type = 'button';
    b.addEventListener('mousedown', e => { e.preventDefault(); go(); });
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (changed) this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent() { return true; }
  ignoreMutation() { return true; }
}

class ListItemView {
  constructor(node, view, getPos) {
    this.node = node; this.view = view; this.getPos = getPos;
    this.dom = document.createElement('li');
    if (node.attrs.checked != null) {
      this.dom.className = 'wm-task';
      this.cb = el('input', 'task-list-item-checkbox', this.dom);
      this.cb.type = 'checkbox';
      this.cb.contentEditable = 'false';
      this.cb.addEventListener('mousedown', e => {
        e.preventDefault();
        const pos = this.getPos();
        if (pos == null) return;
        this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { checked: !this.node.attrs.checked })));
      });
    }
    this.contentDOM = el('div', 'wm-li-content', this.dom);
    this.sync();
  }
  sync() {
    if (!this.cb) return;
    this.cb.checked = !!this.node.attrs.checked;
    this.dom.classList.toggle('is-checked', !!this.node.attrs.checked);
  }
  update(node) {
    if (node.type !== this.node.type || (node.attrs.checked == null) !== (this.node.attrs.checked == null)) return false;
    this.node = node; this.sync();
    return true;
  }
  stopEvent(e) { return !!this.cb && e.target === this.cb; }
  ignoreMutation(m) { return !!this.cb && (m.target === this.cb || m.target === this.dom && m.type === 'attributes'); }
}

class CodeBlockView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'wm-codeblock');
    this.head = el('div', 'wm-code-head', this.dom);
    this.head.contentEditable = 'false';
    this.sel = el('select', 'wm-code-langsel dropdown', this.head);
    this.sel.setAttribute('aria-label', t('程式語言'));
    el('span', 'wm-code-spacer', this.head);
    this.copy = el('button', 'wm-code-copy', this.head);
    this.copy.type = 'button';
    this.copy.setAttribute('aria-label', t('複製程式碼'));
    if (ctx && ctx.icon) ctx.icon(this.copy, 'copy', t('複製')); else this.copy.textContent = t('複製');
    this.copy.addEventListener('mousedown', e => e.preventDefault());
    this.copy.addEventListener('click', () => {
      const text = this.node.textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { this.copy.classList.add('is-done'); setTimeout(() => this.copy.classList.remove('is-done'), 900); });
    });
    this.sel.addEventListener('change', () => {
      if (this.sel.value === '__other') {
        this.syncSelect();
        if (ctx && ctx.prompt) ctx.prompt(t('程式語言'), this.node.attrs.params || '', 'python, sql, json…', v => this.setLang(v.trim()));
        return;
      }
      this.setLang(this.sel.value);
    });
    this.pre = el('pre', 'wm-code', this.dom);
    this.contentDOM = el('code', null, this.pre);
    this.syncSelect();
  }
  setLang(lang) {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, { params: lang })));
    this.view.focus();
  }
  syncSelect() {
    const cur = (this.node.attrs.params || '').trim();
    this.sel.replaceChildren();
    const list = CODE_LANGUAGES.slice();
    if (cur && !list.some(([v]) => v === cur)) list.push([cur, cur]);
    for (const [v, label] of list) { const o = el('option', null, this.sel, v ? label : t(label)); o.value = v; }
    const o = el('option', null, this.sel, t('其他…')); o.value = '__other';
    this.sel.value = cur;
    this.pre.dataset && (this.pre.dataset.lang = cur);
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.params !== this.node.attrs.params;
    this.node = node;
    if (changed) this.syncSelect();
    return true;
  }
  stopEvent(e) { return this.head.contains(e.target); }
  ignoreMutation(m) { return this.head.contains(m.target) || m.target === this.head; }
}


// Obsidian 提示框：外框和標題照 Obsidian 樣式，內容可以直接編輯
class CalloutView {
  constructor(node, view, getPos, ctx) {
    this.node = node; this.view = view; this.getPos = getPos; this.ctx = ctx;
    this.dom = el('div', 'callout wm-callout');
    this.head = el('div', 'callout-title', this.dom);
    this.head.contentEditable = 'false';
    this.icon = el('div', 'callout-icon', this.head);
    this.titleEl = el('div', 'callout-title-inner', this.head);
    this.contentDOM = el('div', 'callout-content', this.dom);
    this.icon.setAttribute('aria-label', t('更換提示框類型'));
    this.titleEl.setAttribute('aria-label', t('點一下編輯標題'));
    this.icon.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      ctx.menu(e, CALLOUT_TYPES.map(([tv, label, icon]) => ({ title: t(label) + t('（') + tv + t('）'), icon, run: () => this.set({ type: tv }) }))
        .concat([{ title: t('移除提示框（保留內容）'), icon: 'trash-2', run: () => ctx.unwrapCallout(this.getPos()) }]));
    });
    this.titleEl.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      ctx.prompt(t('提示框標題'), this.node.attrs.title || '', t('留白則顯示類型名稱'), v => this.set({ title: v.trim() || null }));
    });
    this.render();
  }
  set(attrs) {
    const pos = this.getPos();
    if (pos == null) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, Object.assign({}, this.node.attrs, attrs)));
    this.view.focus();
  }
  render() {
    const a = this.node.attrs;
    this.dom.setAttribute('data-callout', a.type);
    this.dom.setAttribute('data-callout-fold', a.fold || '');
    this.icon.replaceChildren();
    this.ctx.icon(this.icon, calloutIcon(a.type), '');
    const tv = a.type.charAt(0).toUpperCase() + a.type.slice(1);
    this.titleEl.textContent = a.title ? a.title.replace(/(\*\*|__|==|`)/g, '').replace(/\\([\\`*_{}\[\]()#+\-.!|<>=$%~])/g, '$1') : tv;
    this.titleEl.classList.toggle('is-default', !a.title);
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    const changed = JSON.stringify(node.attrs) !== JSON.stringify(this.node.attrs);
    this.node = node;
    if (changed) this.render();
    return true;
  }
  stopEvent(e) { return this.head.contains(e.target); }
  ignoreMutation(m) { return this.head.contains(m.target) || m.target === this.dom && m.type === 'attributes'; }
}

export function createNodeViews(ctx) {
  return {
    wikilink: (n, v, g) => new WikilinkView(n, v, g, ctx),
    image: (n, v, g) => new ImageView(n, v, g, ctx),
    raw_block: (n, v, g) => new RawBlockView(n, v, g, ctx),
    raw_inline: (n, v, g) => new RawInlineView(n, v, g, ctx),
    frontmatter: (n, v, g) => new FrontmatterView(n, v, g, ctx),
    list_item: (n, v, g) => new ListItemView(n, v, g),
    code_block: (n, v, g) => new CodeBlockView(n, v, g, ctx),
    table: n => new TableView(n, 90),
    callout: (n, v, g) => new CalloutView(n, v, g, ctx),
  };
}
