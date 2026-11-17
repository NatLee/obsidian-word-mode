import { el } from './dom.js';
import type { I18nKey } from './i18n.js';
// 方程式的簡易視覺化編輯：把 LaTeX 拆成「看得到的結構」（分數上下兩格、根號、上下標、括號、矩陣…），
// 每一格都可以直接點進去打字，符號顯示成真正的符號（α、≤、∑）。存檔仍是 LaTeX。
// 不依賴 Obsidian；看不懂的 LaTeX 會原樣放在文字格裡，不會遺失。

// ---------------------------------------------------------------- 符號 ⇄ LaTeX 指令
const SYMBOL_PAIRS: [string, string][] = [
  ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'], ['\\epsilon', 'ϵ'], ['\\varepsilon', 'ε'], ['\\zeta', 'ζ'], ['\\eta', 'η'],
  ['\\theta', 'θ'], ['\\iota', 'ι'], ['\\kappa', 'κ'], ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\nu', 'ν'], ['\\xi', 'ξ'], ['\\pi', 'π'], ['\\rho', 'ρ'],
  ['\\sigma', 'σ'], ['\\tau', 'τ'], ['\\upsilon', 'υ'], ['\\phi', 'ϕ'], ['\\varphi', 'φ'], ['\\chi', 'χ'], ['\\psi', 'ψ'], ['\\omega', 'ω'],
  ['\\Gamma', 'Γ'], ['\\Delta', 'Δ'], ['\\Theta', 'Θ'], ['\\Lambda', 'Λ'], ['\\Xi', 'Ξ'], ['\\Pi', 'Π'], ['\\Sigma', 'Σ'], ['\\Phi', 'Φ'], ['\\Psi', 'Ψ'], ['\\Omega', 'Ω'],
  ['\\pm', '±'], ['\\mp', '∓'], ['\\times', '×'], ['\\div', '÷'], ['\\cdot', '·'], ['\\le', '≤'], ['\\leq', '≤'], ['\\ge', '≥'], ['\\geq', '≥'],
  ['\\ne', '≠'], ['\\neq', '≠'], ['\\approx', '≈'], ['\\equiv', '≡'], ['\\propto', '∝'], ['\\sim', '∼'], ['\\ll', '≪'], ['\\gg', '≫'],
  ['\\in', '∈'], ['\\notin', '∉'], ['\\subset', '⊂'], ['\\subseteq', '⊆'], ['\\supset', '⊃'], ['\\supseteq', '⊇'], ['\\cup', '∪'], ['\\cap', '∩'],
  ['\\emptyset', '∅'], ['\\forall', '∀'], ['\\exists', '∃'], ['\\neg', '¬'], ['\\land', '∧'], ['\\lor', '∨'],
  ['\\to', '→'], ['\\rightarrow', '→'], ['\\leftarrow', '←'], ['\\Rightarrow', '⇒'], ['\\Leftarrow', '⇐'], ['\\Leftrightarrow', '⇔'], ['\\leftrightarrow', '↔'], ['\\mapsto', '↦'],
  ['\\infty', '∞'], ['\\partial', '∂'], ['\\nabla', '∇'], ['\\ldots', '…'], ['\\cdots', '⋯'], ['\\circ', '∘'], ['\\angle', '∠'], ['\\perp', '⊥'], ['\\parallel', '∥'],
  ['\\sum', '∑'], ['\\prod', '∏'], ['\\int', '∫'], ['\\iint', '∬'], ['\\oint', '∮'], ['\\mathbb{R}', 'ℝ'], ['\\mathbb{N}', 'ℕ'], ['\\mathbb{Z}', 'ℤ'], ['\\mathbb{Q}', 'ℚ'], ['\\mathbb{C}', 'ℂ'],
];
const CMD_TO_CHAR = new Map(SYMBOL_PAIRS);
const CHAR_TO_CMD = new Map<string, string>();
for (const [cmd, ch] of SYMBOL_PAIRS) if (!CHAR_TO_CMD.has(ch)) CHAR_TO_CMD.set(ch, cmd);
const FUNCS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lim', 'max', 'min', 'exp', 'det', 'gcd'];
const FUNC_SET = new Set(FUNCS);

// LaTeX 文字 → 顯示：\alpha → α、\sin → sin；不認得的指令照原樣顯示
export function toDisplay(latex: string): string {
  // bb 與 name 只會有一個有值；bb 有值時前面就先回傳了，所以 name 在後面一定是字串
  return latex.replace(/\\mathbb\{([RNZQC])\}|\\([A-Za-z]+) ?/g, (m: string, bb: string | undefined, name: string) => {
    if (bb) return CMD_TO_CHAR.get('\\mathbb{' + bb + '}')!;
    const cmd = '\\' + name;
    if (CMD_TO_CHAR.has(cmd)) return CMD_TO_CHAR.get(cmd)!;
    if (FUNC_SET.has(name)) return name + (m.endsWith(' ') ? ' ' : '');
    return m;
  });
}

// 顯示 → LaTeX：α → \alpha（後面接字母時補一個空白）、獨立的 sin → \sin
export function fromDisplay(text: string): string {
  let out = '';
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const cmd = CHAR_TO_CMD.get(chars[i]);
    if (!cmd) { out += chars[i]; continue; }
    out += cmd;
    if (!cmd.endsWith('}') && /^[A-Za-z]$/.test(chars[i + 1] || '')) out += ' ';
  }
  return out.replace(new RegExp('(^|[^A-Za-z\\\\])(' + FUNCS.join('|') + ')(?![A-Za-z])', 'g'), '$1\\$2');
}

// ---------------------------------------------------------------- LaTeX ⇄ 結構
// 一列（row）是項目的陣列；項目：
//   { t: 'text', v }                 一段 LaTeX 文字
//   { t: 'frac', cmd, a, b }         分數（a 分子、b 分母）
//   { t: 'sqrt', a, n }              根號（n 是次方根，可為 null）
//   { t: 'sup', a } / { t: 'sub', a } 上標／下標
//   { t: 'group', cmd, a }           \vec{…}、\mathbf{…}、\text{…} 等
//   { t: 'paren', l, r, a }          \left( … \right)
//   { t: 'env', name, rows }         矩陣、分段函數（rows 是「列」的陣列，每列是「格」的陣列，每格是一列項目）
//   { t: 'braces', a }               單純的 { … }
export type MathRow = MathItem[];
// 結構項目放子列的欄位（a、b、n、rows）：走訪整棵樹時直接用欄位名稱取值，不必先分辨是哪一種項目
interface MathSlots { a?: MathRow; b?: MathRow; n?: MathRow | null; rows?: MathRow[][]; }
export interface TextItem { t: 'text'; v: string; }
export interface FracItem extends MathSlots { t: 'frac'; cmd: string; a: MathRow; b: MathRow; }
export interface SqrtItem extends MathSlots { t: 'sqrt'; a: MathRow; n: MathRow | null; }
export interface ScriptItem extends MathSlots { t: 'sup' | 'sub'; a: MathRow; }
export interface GroupItem extends MathSlots { t: 'group'; cmd: string; a: MathRow; }
export interface ParenItem extends MathSlots { t: 'paren'; l: string; r: string; a: MathRow; }
export interface EnvItem extends MathSlots { t: 'env'; name: string; rows: MathRow[][]; }
export interface BracesItem extends MathSlots { t: 'braces'; a: MathRow; }
export type MathItem = TextItem | FracItem | SqrtItem | ScriptItem | GroupItem | ParenItem | EnvItem | BracesItem;
const FRACS = ['\\frac', '\\dfrac', '\\tfrac', '\\binom'];
export const GROUP_CMDS = ['\\vec', '\\bar', '\\hat', '\\tilde', '\\dot', '\\ddot', '\\overline', '\\underline', '\\mathbf', '\\mathbb', '\\mathrm', '\\mathcal', '\\mathit', '\\text', '\\boldsymbol', '\\overrightarrow'];
const ENVS = ['matrix', 'bmatrix', 'pmatrix', 'vmatrix', 'Bmatrix', 'Vmatrix', 'cases', 'aligned', 'align', 'array', 'gathered'];

class ParseError extends Error {}

// parseRow 的結果：解析出的一列，以及停下來的位置（停在 stops 其中一個字串的開頭）
interface RowResult { row: MathRow; pos: number; }

function parseRow(s: string, pos: number, stops: string[]): RowResult {
  const row: MathRow = [];
  let text = '';
  const flush = () => { if (text) { row.push({ t: 'text', v: text }); text = ''; } };
  const at = (w: string) => s.startsWith(w, pos);
  const isStop = () => stops.some(w => at(w) && (!/^\\[A-Za-z]+$/.test(w) || !/[A-Za-z]/.test(s[pos + w.length] || '')));
  const skipSpace = () => { while (s[pos] === ' ') pos++; };
  const group = (): MathRow => {
    skipSpace();
    if (s[pos] !== '{') throw new ParseError('{');
    const r = parseRow(s, pos + 1, ['}']);
    pos = r.pos + 1;
    return r.row;
  };
  const command = () => { const m = /^\\[A-Za-z]+/.exec(s.slice(pos)); return m ? m[0] : null; };
  while (pos < s.length) {
    if (isStop()) { flush(); return { row, pos }; }
    const ch = s[pos];
    if (ch === '}') throw new ParseError('}');
    if (ch === '{') { flush(); const r = parseRow(s, pos + 1, ['}']); pos = r.pos + 1; row.push({ t: 'braces', a: r.row }); continue; }
    if (ch === '^' || ch === '_') {
      flush();
      pos++;
      skipSpace();
      let a: MathRow;
      if (s[pos] === '{') a = group();
      else {
        const c = command();
        if (c) { a = [{ t: 'text', v: c }]; pos += c.length; } else if (pos < s.length) { a = [{ t: 'text', v: s[pos] }]; pos++; } else throw new ParseError('^');
      }
      row.push({ t: ch === '^' ? 'sup' : 'sub', a });
      continue;
    }
    if (ch === '\\') {
      const c = command();
      if (!c) { text += s.slice(pos, pos + 2); pos += 2; continue; } // \{ \} \\ \, 等
      const mb = /^\\mathbb\{[RNZQC]\}/.exec(s.slice(pos));
      if (mb) { text += mb[0]; pos += mb[0].length; continue; }
      if (FRACS.includes(c)) { flush(); pos += c.length; const a = group(); const b = group(); row.push({ t: 'frac', cmd: c, a, b }); continue; }
      if (c === '\\sqrt') {
        flush(); pos += c.length; skipSpace();
        let n: MathRow | null = null;
        if (s[pos] === '[') { const r = parseRow(s, pos + 1, [']']); n = r.row; pos = r.pos + 1; }
        row.push({ t: 'sqrt', a: group(), n });
        continue;
      }
      if (GROUP_CMDS.includes(c)) {
        const save = pos;
        pos += c.length; skipSpace();
        if (s[pos] === '{') { flush(); row.push({ t: 'group', cmd: c, a: group() }); continue; }
        pos = save;
      }
      if (c === '\\left') {
        flush(); pos += c.length; skipSpace();
        const dl = /^(\\[A-Za-z]+|\\.|.)/.exec(s.slice(pos));
        if (!dl) throw new ParseError('left');
        pos += dl[0].length;
        const r = parseRow(s, pos, ['\\right']);
        if (!s.startsWith('\\right', r.pos)) throw new ParseError('right');
        pos = r.pos + 6; skipSpace();
        const dr = /^(\\[A-Za-z]+|\\.|.)/.exec(s.slice(pos));
        if (!dr) throw new ParseError('right');
        pos += dr[0].length;
        row.push({ t: 'paren', l: dl[0], r: dr[0], a: r.row });
        continue;
      }
      if (c === '\\begin') {
        const m = /^\\begin\{([A-Za-z*]+)\}/.exec(s.slice(pos));
        if (!m || !ENVS.includes(m[1])) throw new ParseError('env');
        flush(); pos += m[0].length;
        const end = '\\end{' + m[1] + '}';
        const rows: MathRow[][] = [[]];
        for (;;) {
          const r = parseRow(s, pos, ['&', '\\\\', end]);
          rows[rows.length - 1].push(r.row);
          pos = r.pos;
          if (s.startsWith(end, pos)) { pos += end.length; break; }
          if (s[pos] === '&') { pos++; continue; }
          if (s.startsWith('\\\\', pos)) { pos += 2; rows.push([]); continue; }
          throw new ParseError('end');
        }
        // 最後一列如果只有一個空白格（結尾多寫了 \\）就拿掉
        const last = rows[rows.length - 1];
        if (rows.length > 1 && last.length === 1 && !toLatex(last[0]).trim()) rows.pop();
        row.push({ t: 'env', name: m[1], rows });
        continue;
      }
      if (c === '\\right' || c === '\\end') throw new ParseError(c);
      text += c; pos += c.length;
      continue;
    }
    text += ch; pos++;
  }
  flush();
  if (stops.length) throw new ParseError('eof');
  return { row, pos };
}

// 解析 LaTeX；括號不成對等看不懂的情況，整段當成一格文字（不會遺失內容）
export function parseLatex(src?: string | null): MathRow {
  const s = String(src || '');
  try { return normalize(parseRow(s, 0, []).row); } catch { return normalize([{ t: 'text', v: s }]); }
}

const trimRow = (row: MathRow): string => toLatex(row).trim();
export function toLatex(row: MathRow): string {
  let out = '';
  for (const it of row) {
    if (it.t === 'text') out += it.v;
    else if (it.t === 'frac') out += (it.cmd || '\\frac') + '{' + trimRow(it.a) + '}{' + trimRow(it.b) + '}';
    else if (it.t === 'sqrt') out += '\\sqrt' + (it.n && trimRow(it.n) ? '[' + trimRow(it.n) + ']' : '') + '{' + trimRow(it.a) + '}';
    else if (it.t === 'sup') out += '^{' + trimRow(it.a) + '}';
    else if (it.t === 'sub') out += '_{' + trimRow(it.a) + '}';
    else if (it.t === 'group') out += it.cmd + '{' + (it.cmd === '\\text' ? toLatex(it.a) : trimRow(it.a)) + '}';
    else if (it.t === 'paren') out += '\\left' + it.l + ' ' + trimRow(it.a) + ' \\right' + it.r;
    else if (it.t === 'braces') out += '{' + toLatex(it.a) + '}';
    else if (it.t === 'env') out += '\\begin{' + it.name + '} ' + it.rows.map(r => r.map(trimRow).join(' & ')).join(' \\\\ ') + ' \\end{' + it.name + '}';
  }
  return out;
}

// 整理：相鄰的文字合併；結構的前後與中間一定有文字格（才點得進去打字）
export function normalize(row: MathRow): MathRow {
  const out: MathRow = [];
  for (const it of row) {
    const last = out[out.length - 1];
    if (it.t === 'text') { if (last && last.t === 'text') last.v += it.v; else out.push(it); continue; }
    if (!last || last.t !== 'text') out.push({ t: 'text', v: '' });
    for (const k of ['a', 'b', 'n'] as const) if (Array.isArray(it[k])) it[k] = normalize(it[k]);
    if (it.rows) it.rows = it.rows.map(r => r.map(normalize));
    out.push(it);
  }
  if (!out.length || out[out.length - 1].t !== 'text') out.push({ t: 'text', v: '' });
  return out;
}

// ---------------------------------------------------------------- 編輯元件
const MARK = '\u0001'; // 插入後游標要停的位置（暫時的記號）
// \text{…} 等裡面是一般文字：不把 sin 變成 \sin、不把 α 變成 \alpha
const PLAIN_GROUPS = new Set(['\\text', '\\mathrm', '\\mathit']);
const DELIM_CHAR: Record<string, string> = { '\\{': '{', '\\}': '}', '\\|': '‖', '\\langle': '⟨', '\\rangle': '⟩', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\lceil': '⌈', '\\rceil': '⌉', '.': '' };
const GROUP_LABEL: Record<string, string> = { '\\text': 'T', '\\mathrm': 'rm', '\\mathit': 'it', '\\mathcal': '𝒞', '\\mathbb': '𝔹', '\\boldsymbol': 'B' };

export interface MathFieldOptions {
  onChange?(latex: string): void;
  label?: (text: I18nKey) => string; // 翻譯
}
// 目前所在的文字格：所在的列、在列裡的位置、對應的 DOM
export interface MathSlot { row: MathRow; index: number; span: HTMLElement; }

export class MathField {
  declare host: HTMLElement;
  declare opts: MathFieldOptions;
  declare dom: HTMLDivElement;
  declare model: MathRow;
  declare active: MathSlot | null;
  declare byItem: Map<MathItem, HTMLElement>;

  // opts: { onChange(latex), label(text) → 翻譯 }
  constructor(host: HTMLElement, opts: MathFieldOptions = {}) {
    this.host = host;
    this.opts = opts;
    this.dom = el('div', 'wm-mv', host);
    this.dom.setAttribute('role', 'textbox');
    this.model = normalize([]);
    this.active = null; // { row, index, span }
    this.render();
  }

  getLatex(): string { return toLatex(this.model).trim(); }
  setLatex(src: string): void { this.model = parseLatex(src); this.active = null; this.render(); }
  isEmpty(): boolean { return !this.getLatex(); }

  changed(): void { if (this.opts.onChange) this.opts.onChange(this.getLatex()); }

  focus(atEnd = true): void {
    const spans = this.spans();
    const span = atEnd ? spans[spans.length - 1] : spans[0];
    if (span) this.place(span, atEnd ? span.textContent.length : 0);
  }

  spans(): HTMLElement[] { return [...this.dom.querySelectorAll<HTMLElement>('.wm-mv-text')]; }

  // 把游標放進某個文字格
  place(span: HTMLElement, offset: number): void {
    span.focus();
    const sel = span.ownerDocument.getSelection && span.ownerDocument.getSelection();
    if (!sel) return;
    try {
      const r = span.ownerDocument.createRange();
      const node = span.firstChild;
      if (node) r.setStart(node, Math.max(0, Math.min(offset, node.textContent!.length))); else r.setStart(span, 0);
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    } catch { /* 測試環境 */ }
  }

  caret(span: HTMLElement): { start: number; end: number } {
    const sel = span.ownerDocument.getSelection && span.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount || !span.contains(sel.anchorNode)) return { start: span.textContent.length, end: span.textContent.length };
    const r = sel.getRangeAt(0);
    const pre = r.cloneRange();
    pre.selectNodeContents(span); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    return { start, end: start + r.toString().length };
  }

  render(focusItem?: MathItem): void {
    this.dom.replaceChildren();
    this.byItem = new Map();
    this.dom.appendChild(this.renderRow(this.model));
    if (focusItem && this.byItem.get(focusItem)) this.place(this.byItem.get(focusItem)!, 0);
  }

  renderRow(row: MathRow, plain?: boolean): HTMLSpanElement {
    const box = el('span', 'wm-mv-row');
    row.forEach((it, index) => {
      if (it.t === 'text') box.appendChild(this.renderText(row, index, plain));
      else box.appendChild(this.renderItem(it));
    });
    return box;
  }

  renderText(row: MathRow, index: number, plain?: boolean): HTMLSpanElement {
    const it = row[index] as TextItem; // renderRow 只對文字項目呼叫這裡
    const span = el('span', 'wm-mv-text');
    span.contentEditable = 'true';
    span.spellcheck = false;
    if (plain) span.dataset.plain = '1';
    span.textContent = plain ? it.v : toDisplay(it.v);
    // 整列只有這一格而且是空的：顯示成虛線方框，提示可以輸入
    if (row.length === 1 && !it.v) span.classList.add('is-slot');
    this.byItem.set(it, span);
    // 記住目前在哪一格（按上方的按鈕時要插在這裡）
    const here = () => { this.active = { row, index, span }; };
    span.addEventListener('focus', here);
    span.addEventListener('mousedown', here);
    span.addEventListener('keyup', here);
    span.addEventListener('input', () => {
      const raw = span.textContent.replace(/\n/g, '');
      it.v = plain ? raw : fromDisplay(raw);
      span.classList.toggle('is-slot', row.length === 1 && !it.v);
      this.changed();
    });
    span.addEventListener('paste', e => {
      e.preventDefault();
      const tx = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      this.insert(tx.replace(/\r?\n/g, ' '));
    });
    span.addEventListener('keydown', e => this.onKey(e, row, index, span));
    return span;
  }

  renderItem(it: MathItem): HTMLSpanElement {
    const slot = (cls: string, row: MathRow, parent: HTMLElement | null, plain?: boolean): HTMLSpanElement => { const s = el('span', cls, parent); s.appendChild(this.renderRow(row, plain)); return s; };
    if (it.t === 'frac') {
      const f = el('span', 'wm-mv-frac' + (it.cmd === '\\binom' ? ' is-binom' : ''));
      slot('wm-mv-num', it.a, f); slot('wm-mv-den', it.b, f);
      return f;
    }
    if (it.t === 'sqrt') {
      const f = el('span', 'wm-mv-sqrt');
      if (it.n) slot('wm-mv-root', it.n, f);
      el('span', 'wm-mv-radical', f, '√');
      slot('wm-mv-radicand', it.a, f);
      return f;
    }
    if (it.t === 'sup' || it.t === 'sub') return slot('wm-mv-' + it.t, it.a, null);
    if (it.t === 'group') {
      const f = el('span', 'wm-mv-group');
      f.dataset.cmd = it.cmd.slice(1);
      if (GROUP_LABEL[it.cmd]) el('span', 'wm-mv-tag', f, GROUP_LABEL[it.cmd]);
      slot('wm-mv-inner', it.a, f, PLAIN_GROUPS.has(it.cmd));
      return f;
    }
    if (it.t === 'paren') {
      const f = el('span', 'wm-mv-paren');
      el('span', 'wm-mv-delim', f, it.l in DELIM_CHAR ? DELIM_CHAR[it.l] : it.l);
      slot('wm-mv-inner', it.a, f);
      el('span', 'wm-mv-delim', f, it.r in DELIM_CHAR ? DELIM_CHAR[it.r] : it.r);
      return f;
    }
    if (it.t === 'braces') return slot('wm-mv-braces', it.a, null);
    if (it.t === 'env') {
      const f = el('span', 'wm-mv-env');
      f.dataset.env = it.name;
      const grid = el('span', 'wm-mv-grid', f);
      for (const r of it.rows) {
        const tr = el('span', 'wm-mv-grid-row', grid);
        for (const cell of r) slot('wm-mv-cell', cell, tr);
      }
      const tools = el('span', 'wm-mv-env-tools', f);
      const L = this.opts.label || (x => x);
      const tool = (text: I18nKey, label: I18nKey, run: () => void) => {
        const b = el('button', 'wm-mv-env-btn', tools, L(text));
        b.type = 'button';
        b.setAttribute('aria-label', L(label));
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => { run(); this.render(); this.changed(); });
      };
      const cols = Math.max(1, ...it.rows.map(r => r.length));
      tool('＋列', '新增一列', () => it.rows.push(Array.from({ length: cols }, () => normalize([]))));
      tool('＋欄', '新增一欄', () => it.rows.forEach(r => r.push(normalize([]))));
      tool('－列', '刪除最後一列', () => { if (it.rows.length > 1) it.rows.pop(); });
      tool('－欄', '刪除最後一欄', () => { if (cols > 1) it.rows.forEach(r => { if (r.length > 1) r.pop(); }); });
      return f;
    }
    return el('span', 'wm-mv-text', null, '');
  }

  onKey(e: KeyboardEvent, row: MathRow, index: number, span: HTMLElement): void {
    const it = row[index] as TextItem; // 按鍵來自文字格，所以是文字項目
    const text = span.textContent;
    const c = this.caret(span);
    const spans = this.spans();
    const i = spans.indexOf(span);
    const go = (d: number, atEnd: boolean) => { const next = spans[i + d]; if (next) { e.preventDefault(); this.place(next, atEnd ? next.textContent.length : 0); } };
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); return; }
    // Tab／Shift+Tab：下一格／上一格（已經是最後一格就離開方程式）
    if (e.key === 'Tab') { if (spans[i + (e.shiftKey ? -1 : 1)]) { go(e.shiftKey ? -1 : 1, e.shiftKey); e.stopPropagation(); } return; }
    if (e.key === 'ArrowRight' && c.start === text.length && c.end === text.length) { go(1, false); return; }
    if (e.key === 'ArrowLeft' && c.start === 0 && c.end === 0) { go(-1, true); return; }
    // 在格子開頭按 Backspace：刪掉前面那個結構（分數、根號…）
    if (e.key === 'Backspace' && c.start === 0 && c.end === 0 && index > 0 && row[index - 1].t !== 'text') {
      e.preventDefault();
      row.splice(index - 1, 1);
      const merged = normalize(row);
      row.splice(0, row.length, ...merged);
      this.render();
      const target = row[Math.max(0, index - 2)];
      const sp = this.byItem.get(target);
      if (sp) this.place(sp, sp.textContent.length - (sp.dataset.plain ? it.v : toDisplay(it.v)).length);
      this.changed();
      return;
    }
    // 打 ^ 或 _：直接開一個上標／下標的格子
    if ((e.key === '^' || e.key === '_') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.insertItems([{ t: e.key === '^' ? 'sup' : 'sub', a: [{ t: 'text', v: '' }] }], row, index, span);
    }
  }

  // 在目前的游標處插入一段 LaTeX（按上方的結構或符號按鈕）
  insert(latex: string): void {
    const items = parseLatex(latex).filter(it => !(it.t === 'text' && !it.v));
    if (!items.length) return;
    let a = this.active;
    if (!a || !this.dom.contains(a.span)) { const spans = this.spans(); const span = spans[spans.length - 1]; a = this.active = this.findActive(span); }
    if (!a) return;
    this.insertItems(items, a.row, a.index, a.span);
  }

  findActive(span: HTMLElement): MathSlot | null {
    // 只在回呼函式裡指定；用 as 寫型別，TS 才不會認定它一直是 null
    let found = null as MathSlot | null;
    const walk = (row: MathRow): void => row.forEach((it, index) => {
      if (found) return;
      if (it.t === 'text') { if (this.byItem.get(it) === span) found = { row, index, span }; return; }
      for (const k of ['a', 'b', 'n'] as const) if (Array.isArray(it[k])) walk(it[k]);
      if (it.rows) it.rows.forEach(r => r.forEach(walk));
    });
    walk(this.model);
    return found;
  }

  insertItems(items: MathRow, row: MathRow, index: number, span: HTMLElement): void {
    const c = this.caret(span);
    const shown = span.textContent;
    const conv = span.dataset.plain ? (x: string) => x : fromDisplay;
    const before = conv(shown.slice(0, c.start));
    const selected = conv(shown.slice(c.start, c.end));
    const after = conv(shown.slice(c.end));
    // 第一個空的格子：有選取文字就放進去；沒有的話游標停在那一格
    let firstSlot = null as MathRow | null; // 在 findSlot 裡指定
    const findSlot = (r: MathRow): void => {
      for (const x of r) {
        if (firstSlot) return;
        if (x.t === 'text') continue;
        for (const k of ['a', 'b', 'n'] as const) {
          if (firstSlot || !Array.isArray(x[k])) continue;
          if (!toLatex(x[k]).trim()) firstSlot = x[k]!; else findSlot(x[k]);
        }
        if (x.rows) for (const rr of x.rows) for (const cell of rr) { if (!firstSlot && !toLatex(cell).trim()) firstSlot = cell; }
      }
    };
    const fresh = normalize(items);
    findSlot(fresh);
    // 用一個看不見的記號標出游標之後要停的位置（整理、合併文字後再找回來）
    // 空的格子經過 normalize 後只有一個空的文字項目，所以 firstSlot[0] 是文字項目
    const tail: TextItem = { t: 'text', v: after };
    if (firstSlot && !selected) (firstSlot[0] as TextItem).v = MARK;
    else { if (firstSlot) (firstSlot[0] as TextItem).v = selected; tail.v = MARK + after; }
    row.splice(index, 1, { t: 'text', v: before }, ...fresh, tail);
    const whole = normalize(row);
    row.splice(0, row.length, ...whole);
    let target = null as TextItem | null; let offset = 0; // 在 walk 裡指定
    const walk = (r: MathRow): void => r.forEach(x => {
      if (x.t === 'text') {
        const i = x.v.indexOf(MARK);
        if (i >= 0) { target = x; offset = i; x.v = x.v.replace(MARK, ''); }
        return;
      }
      for (const k of ['a', 'b', 'n'] as const) if (Array.isArray(x[k])) walk(x[k]);
      if (x.rows) x.rows.forEach(rr => rr.forEach(walk));
    });
    walk(this.model);
    this.render();
    const sp = target && this.byItem.get(target);
    if (sp) {
      this.place(sp, sp.dataset.plain ? offset : toDisplay(target!.v.slice(0, offset)).length);
      this.active = this.findActive(sp);
    }
    this.changed();
  }
}
