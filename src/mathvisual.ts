import { el } from './dom.js';
import type { I18nKey } from './i18n.js';
// 方程式的簡易視覺化編輯：把 LaTeX 拆成「看得到的結構」（分數上下兩格、根號、上下標、括號、矩陣…），
// 每一格都可以直接點進去打字，符號顯示成真正的符號（α、≤、∑）。存檔仍是 LaTeX。
// 不依賴 Obsidian；看不懂的 LaTeX 會原樣放在文字格裡，不會遺失。

// ---------------------------------------------------------------- 符號 ⇄ LaTeX 指令
// 間距指令顯示成差不多寬的空白字元，不然會照原文顯示「\,」（\int f(x)\,dx 很常見）：
// \, 細空白、\: 中等數學空白、\; 三分之一 em、\quad 一個 em（\qquad 顯示成兩個，改過再存回時寫成 \quad\quad，看起來一樣）
const SPACE_PAIRS: [string, string][] = [['\\,', '\u2009'], ['\\:', '\u205F'], ['\\;', '\u2004']];
const SYMBOL_PAIRS: [string, string][] = [
  ['\\quad', '\u2003'],
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
const SPACE_TO_CHAR = new Map(SPACE_PAIRS);
const CHAR_TO_CMD = new Map<string, string>();
for (const [cmd, ch] of [...SYMBOL_PAIRS, ...SPACE_PAIRS]) if (!CHAR_TO_CMD.has(ch)) CHAR_TO_CMD.set(ch, cmd);
const FUNCS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'lim', 'max', 'min', 'exp', 'det', 'gcd'];
const FUNC_SET = new Set(FUNCS);

// LaTeX 文字 → 顯示：\alpha → α、\sin → sin、\, → 細空白；不認得的指令照原樣顯示
export function toDisplay(latex: string): string {
  // bb、sp、name 只會有一個有值；前兩個有值時就先回傳了，所以 name 在後面一定是字串
  return latex.replace(/\\mathbb\{([RNZQC])\}|\\([,:;])|\\([A-Za-z]+) ?/g, (m: string, bb: string | undefined, sp: string | undefined, name: string) => {
    if (bb) return CMD_TO_CHAR.get('\\mathbb{' + bb + '}')!;
    if (sp) return SPACE_TO_CHAR.get('\\' + sp)!;
    if (name === 'qquad') return '\u2003\u2003';
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
    // 指令以字母結尾（\alpha、\quad）時，後面接字母要隔一個空白；\, 與 \mathbb{R} 不用
    if (/[A-Za-z]$/.test(cmd) && /^[A-Za-z]$/.test(chars[i + 1] || '')) out += ' ';
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
//   { t: 'brace', cmd, a, b }        \overbrace{a}^{b}、\underbrace{a}_{b}（a 是內容、b 是括號外的標籤）
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
export interface BraceItem extends MathSlots { t: 'brace'; cmd: string; a: MathRow; b: MathRow; }
export interface ParenItem extends MathSlots { t: 'paren'; l: string; r: string; a: MathRow; }
export interface EnvItem extends MathSlots { t: 'env'; name: string; rows: MathRow[][]; }
export interface BracesItem extends MathSlots { t: 'braces'; a: MathRow; }
export type MathItem = TextItem | FracItem | SqrtItem | ScriptItem | GroupItem | BraceItem | ParenItem | EnvItem | BracesItem;
const FRACS = ['\\frac', '\\dfrac', '\\tfrac', '\\binom'];
// 上括號、下括號：標籤寫成接在後面的 ^{…}（上括號）或 _{…}（下括號），TeX 會把它放在括號的正上方／正下方。
// 以前不認得這兩個指令，格子裡照原文顯示「\overbrace」，標籤還被當成右上角的上標
const H_BRACES: Record<string, '^' | '_'> = { '\\overbrace': '^', '\\underbrace': '_' };
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
  // ^ 或 _ 後面的內容：{…}、一個指令（x^\alpha）或一個字（x^2）
  const scriptArg = (): MathRow => {
    skipSpace();
    if (s[pos] === '{') return group();
    const c = command();
    if (c) { pos += c.length; return [{ t: 'text', v: c }]; }
    if (pos < s.length) return [{ t: 'text', v: s[pos++] }];
    throw new ParseError('^');
  };
  while (pos < s.length) {
    if (isStop()) { flush(); return { row, pos }; }
    const ch = s[pos];
    if (ch === '}') throw new ParseError('}');
    if (ch === '{') { flush(); const r = parseRow(s, pos + 1, ['}']); pos = r.pos + 1; row.push({ t: 'braces', a: r.row }); continue; }
    if (ch === '^' || ch === '_') {
      flush();
      pos++;
      row.push({ t: ch === '^' ? 'sup' : 'sub', a: scriptArg() });
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
      if (H_BRACES[c]) {
        const save = pos;
        pos += c.length; skipSpace();
        if (s[pos] === '{') {
          flush();
          const a = group();
          // 後面緊接 ^（上括號）或 _（下括號）就是標籤；沒有標籤時標籤格是空的，空白留給後面的文字
          const afterBody = pos;
          skipSpace();
          let b: MathRow = [];
          if (s[pos] === H_BRACES[c]) { pos++; b = scriptArg(); } else pos = afterBody;
          row.push({ t: 'brace', cmd: c, a, b });
          continue;
        }
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
    else if (it.t === 'brace') { const label = trimRow(it.b); out += it.cmd + '{' + trimRow(it.a) + '}' + (label ? H_BRACES[it.cmd] + '{' + label + '}' : ''); }
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
// 字上面另外畫一個符號的結構（向量箭頭、上橫線、^、~、點，畫法見 accentMark）：符號要佔高度，
// 外面的分數線、根號才不會壓到它（見 CSS 的 .has-accent）
const ACCENTS = new Set(['\\vec', '\\overrightarrow', '\\bar', '\\overline', '\\hat', '\\tilde', '\\dot', '\\ddot']);
const isScript = (it: MathItem | undefined): it is ScriptItem => !!it && (it.t === 'sup' || it.t === 'sub');
const GROUP_LABEL: Record<string, string> = { '\\text': 'T', '\\mathrm': 'rm', '\\mathit': 'it', '\\mathcal': '𝒞', '\\mathbb': '𝔹', '\\boldsymbol': 'B' };
// 在格子裡打「\指令」再按空白，就變成對應的結構（\frac → 分數的兩格、\sqrt → 根號…）
const TYPED_STRUCTS: Record<string, string> = { '\\sqrt': '\\sqrt{}' };
for (const c of FRACS) TYPED_STRUCTS[c] = c + '{}{}';
for (const c of GROUP_CMDS) TYPED_STRUCTS[c] = c + '{}';
for (const [c, mark] of Object.entries(H_BRACES)) TYPED_STRUCTS[c] = c + '{}' + mark + '{}';

export interface MathFieldOptions {
  onChange?(latex: string): void;
  label?: (text: I18nKey) => string; // 翻譯
  // 復原紀錄變了：現在能不能復原、能不能取消復原
  onHistory?(canUndo: boolean, canRedo: boolean): void;
}
// 目前所在的文字格：所在的列、在列裡的位置、對應的 DOM
export interface MathSlot { row: MathRow; index: number; span: HTMLElement; }
// 一個格子（列）屬於哪個結構項目，以及那個項目所在的列
interface Owner { item: MathItem; row: MathRow; }
// 復原紀錄的一筆：整個結構（JSON）、游標在第幾個文字格與格內的位置；
// src 是「還沒改動」時的原始 LaTeX（復原到這裡時要交回一字不差的原文）
interface Snapshot { model: string; span: number; offset: number; src: string | null; }
// 改動的種類：type 是打字（連續打字合併成一步），struct 是插入或刪除結構
type ChangeKind = 'type' | 'struct';

// 一個結構項目的所有格子，依畫面上的順序
function slotsOf(it: MathItem): MathRow[] {
  if (it.t === 'text') return [];
  if (it.t === 'frac' || it.t === 'brace') return [it.a, it.b];
  if (it.t === 'sqrt') return it.n ? [it.n, it.a] : [it.a];
  if (it.t === 'env') return it.rows.flat();
  return [it.a];
}
const rowEmpty = (row: MathRow): boolean => !toLatex(row).trim();

// 根號的符號。不用「√」字元：字的大小固定，裡面放分數、矩陣這類較高的內容時，
// 上方那條線（被開方數的上框線）會被頂到內容頂端，跟縮在中間的「√」接不起來。
// 改畫成 SVG，外框跟著被開方數一樣高：左下的小勾保持比例、貼齊左下角，
// 只有從勾底往右上的長斜線隨高度伸長，終點剛好接上上框線的左端（TeX 的高根號也是這樣長高的）。
// 勾的 viewBox 是 10×12，勾底在 (5, 12)，所以長斜線從 (50%, 100%) 出發；
// 外框要比寬度的 1.2 倍高（CSS 的 min-height），勾才會撐滿寬度、勾底對得上 50%。
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(doc: Document, tag: string, attrs: Record<string, string>, parent: Element): Element {
  const e = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}
// 符號外框：螢幕閱讀器念 label，裡面的 SVG 不念
function drawnBox(cls: string, label: string, parent: HTMLElement): HTMLSpanElement {
  const box = el('span', cls, parent);
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  return box;
}
function radicalSign(doc: Document, parent: HTMLElement): void {
  const box = drawnBox('wm-mv-radical', '√', parent);
  const outer = svgEl(doc, 'svg', { 'aria-hidden': 'true', focusable: 'false' }, box);
  const hook = svgEl(doc, 'svg', { viewBox: '0 0 10 12', preserveAspectRatio: 'xMinYMax meet', width: '100%', height: '100%', overflow: 'visible' }, outer);
  svgEl(doc, 'polyline', { points: '0.4,7.6 2.3,6.5 5,12' }, hook);
  // 外層沒有 viewBox，單位是 CSS 像素：終點放在 1px 上框線的正中間
  svgEl(doc, 'line', { x1: '50%', y1: '100%', x2: '100%', y2: '0.5' }, outer);
}

// 字上面的符號（向量箭頭、上橫線、^、~、點）：以前用「→」「^」這些字元疊在字上，字元的筆畫在字框裡的高度各不相同
// （~ 在字框中間，看起來飄得很高），向量還另外畫一條框線，箭頭跟線常常對不齊。改成跟根號一樣畫 SVG：
// 外框的大小與位置由 CSS 決定（.wm-mv-accent，依字母高低放在字的頂端上方），這裡只畫形狀。
// 箭頭與上橫線跟著內容的寬度伸長；^、~、點保持比例，置中在字的上方
function accentMark(doc: Document, parent: HTMLElement, cmd: string): void {
  const box = el('span', 'wm-mv-accent', parent);
  const outer = svgEl(doc, 'svg', { 'aria-hidden': 'true', focusable: 'false' }, box);
  const shape = (viewBox: string, align: string): Element =>
    svgEl(doc, 'svg', { viewBox, preserveAspectRatio: align + ' meet', width: '100%', height: '100%', overflow: 'visible' }, outer);
  if (cmd === '\\bar' || cmd === '\\overline' || cmd === '\\vec' || cmd === '\\overrightarrow') {
    // 外層沒有 viewBox，單位是 CSS 像素：線畫在外框的正中間，從左到右
    svgEl(doc, 'line', { x1: '0', y1: '50%', x2: '100%', y2: '50%' }, outer);
    // 箭頭的尖端剛好是線的右端（viewBox 5×8，尖端在 (5, 4)，靠右、上下置中）
    if (cmd === '\\vec' || cmd === '\\overrightarrow') svgEl(doc, 'polyline', { points: '.6,1 5,4 .6,7' }, shape('0 0 5 8', 'xMaxYMid'));
    return;
  }
  if (cmd === '\\hat') svgEl(doc, 'polyline', { points: '1,5.4 5,1 9,5.4' }, shape('0 0 10 6', 'xMidYMax'));
  else if (cmd === '\\tilde') svgEl(doc, 'path', { d: 'M1,4.2C2.7,1.2 4.5,1.2 6,2.8S9.3,4.4 11,1.4' }, shape('0 0 12 5.6', 'xMidYMax'));
  else if (cmd === '\\dot') svgEl(doc, 'circle', { cx: '2', cy: '2', r: '1.3' }, shape('0 0 4 4', 'xMidYMax'));
  else if (cmd === '\\ddot') for (const cx of ['2', '8']) svgEl(doc, 'circle', { cx, cy: '2', r: '1.3' }, shape('0 0 10 4', 'xMidYMax'));
}
// 符號要放低一點的內容：只有沒有上伸筆畫的小寫字母（n、x、a…），符號貼在 x 高度上方；
// 大寫、b、d、h、i 的點、其他結構，符號放在大寫字母的高度上方（TeX 也是看字的高度決定符號的位置）
const LOW_TEXT = /^[acegmnopqrsuvwxyz]+$/;

// \left…\right 的括號，跟根號同樣的問題：字元大小固定，包住分數、矩陣時不會跟著變高。
// 改畫成上下疊起來的幾段 SVG：上端、下端（大括號還有中間的尖角）大小固定，
// 中間的直線（ext）跟著內容伸長。曲線不能整條拉長，拉長會變成細長的弧；TeX 的大括號也是這樣組成的。
// 每段寬 10 單位：上下端高 14（大括號的上下端 9、中段 11），x 是直線的位置。CSS 的高度要跟這些比例一致
interface DelimShape { top: string; bottom: string; x: number[]; mid?: string; }
const DELIM_SHAPES: Record<string, DelimShape> = {
  '(': { top: 'M8.5,.8C4.8,3.2 3,7.5 3,14', bottom: 'M3,0C3,6.5 4.8,10.8 8.5,13.2', x: [3] },
  '[': { top: 'M8,.8H3V14', bottom: 'M3,0V13.2H8', x: [3] },
  '{': { top: 'M8.8,.8C6,.8 5,2 5,4.5V9', mid: 'M5,0C5,3.6 4,5.1 1.2,5.5C4,5.9 5,7.4 5,11', bottom: 'M5,0V4.5C5,7 6,8.2 8.8,8.2', x: [5] },
  '|': { top: 'M5,.8V14', bottom: 'M5,0V13.2', x: [5] },
  '‖': { top: 'M3.5,.8V14M6.5,.8V14', bottom: 'M3.5,0V13.2M6.5,0V13.2', x: [3.5, 6.5] },
  '⌊': { top: 'M3,.8V14', bottom: 'M3,0V13.2H8', x: [3] },
  '⌈': { top: 'M8,.8H3V14', bottom: 'M3,0V13.2', x: [3] },
};
// 認得的括號：[形狀, 是否左右翻轉（右側的括號畫成左側的鏡像）, 螢幕閱讀器念的字]
const DELIMS: Record<string, [string, boolean, string]> = {
  '(': ['(', false, '('], ')': ['(', true, ')'],
  '[': ['[', false, '['], ']': ['[', true, ']'], '\\lbrack': ['[', false, '['], '\\rbrack': ['[', true, ']'],
  '\\{': ['{', false, '{'], '\\}': ['{', true, '}'], '\\lbrace': ['{', false, '{'], '\\rbrace': ['{', true, '}'],
  '|': ['|', false, '|'], '\\vert': ['|', false, '|'], '\\lvert': ['|', false, '|'], '\\rvert': ['|', false, '|'],
  '\\|': ['‖', false, '‖'], '\\Vert': ['‖', false, '‖'], '\\lVert': ['‖', false, '‖'], '\\rVert': ['‖', false, '‖'],
  '\\langle': ['⟨', false, '⟨'], '\\rangle': ['⟨', true, '⟩'],
  '\\lfloor': ['⌊', false, '⌊'], '\\rfloor': ['⌊', true, '⌋'],
  '\\lceil': ['⌈', false, '⌈'], '\\rceil': ['⌈', true, '⌉'],
};
// 矩陣類環境兩側的括號（LaTeX 的分隔符號寫法，交給 drawDelim）；沒列出的環境（matrix、aligned、array…）兩側沒有括號
const ENV_DELIMS: Record<string, [string, string]> = {
  pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['\\{', '\\}'], vmatrix: ['|', '|'], Vmatrix: ['\\|', '\\|'], cases: ['\\{', '.'],
};
function drawDelim(doc: Document, parent: HTMLElement, d: string): void {
  const known = DELIMS[d];
  // 「.」是不顯示的括號；其他不認得的（\uparrow、/…）照原文顯示
  if (!known) { el('span', 'wm-mv-delim', parent, d === '.' ? '' : d); return; }
  const [kind, mirror, label] = known;
  const box = drawnBox('wm-mv-delim is-drawn' + (mirror ? ' is-mirror' : ''), label, parent);
  box.dataset.delim = kind;
  if (kind === '⟨') {
    // 角括號只有兩條斜線：外層不設 viewBox，用百分比直接畫到上下兩端，拉多高都不變形
    const s = svgEl(doc, 'svg', { 'aria-hidden': 'true', focusable: 'false' }, box);
    svgEl(doc, 'line', { x1: '85%', y1: '0', x2: '15%', y2: '50%' }, s);
    svgEl(doc, 'line', { x1: '15%', y1: '50%', x2: '85%', y2: '100%' }, s);
    return;
  }
  const shape = DELIM_SHAPES[kind];
  const piece = (cls: string, h: number, path: string, stretch?: boolean): void => {
    const attrs: Record<string, string> = { class: cls, viewBox: '0 0 10 ' + h, 'aria-hidden': 'true', focusable: 'false' };
    // 伸長的直線段：只有高度跟著拉，寬度的比例跟上下端相同，所以線一樣粗
    if (stretch) attrs.preserveAspectRatio = 'none';
    svgEl(doc, 'path', { d: path }, svgEl(doc, 'svg', attrs, box));
  };
  const ext = () => piece('wm-mv-dext', 10, shape.x.map(x => `M${x},0V10`).join(''), true);
  const capCls = shape.mid ? 'wm-mv-dcap is-short' : 'wm-mv-dcap';
  const capH = shape.mid ? 9 : 14;
  piece(capCls, capH, shape.top);
  ext();
  if (shape.mid) { piece('wm-mv-dmid', 11, shape.mid); ext(); }
  piece(capCls, capH, shape.bottom);
}

// 上括號、下括號的橫向大括號：跟 drawDelim 同樣的做法，兩端的彎鉤與中間的尖角大小固定，
// 中間的直線（.wm-mv-hbext）跟著內容的寬度伸長。形狀是 DELIM_SHAPES 的「{」轉成橫的（x、y 對調）：
// 每段高 10 單位、線在 y = 5，兩端寬 9、尖角寬 11（CSS 的寬度要跟這些比例一致）。
// 畫的是上括號（尖角朝上、兩端往下彎），下括號由 CSS 上下翻轉
function horizontalBrace(doc: Document, parent: HTMLElement, over: boolean): void {
  const box = drawnBox('wm-mv-hbmark', over ? '⏞' : '⏟', parent);
  const piece = (cls: string, w: number, path: string, stretch?: boolean): void => {
    const attrs: Record<string, string> = { class: cls, viewBox: `0 0 ${w} 10`, 'aria-hidden': 'true', focusable: 'false' };
    // 伸長的直線段：只有寬度跟著拉，高度的比例跟兩端相同，所以線一樣粗
    if (stretch) attrs.preserveAspectRatio = 'none';
    svgEl(doc, 'path', { d: path }, svgEl(doc, 'svg', attrs, box));
  };
  const ext = () => piece('wm-mv-hbext', 10, 'M0,5H10', true);
  piece('wm-mv-hbcap', 9, 'M.8,8.8C.8,6 2,5 4.5,5H9');
  ext();
  piece('wm-mv-hbmid', 11, 'M0,5C3.6,5 5.1,4 5.5,1.2C5.9,4 7.4,5 11,5');
  ext();
  piece('wm-mv-hbcap', 9, 'M0,5H4.5C7,5 8.2,6 8.2,8.8');
}

export class MathField {
  declare host: HTMLElement;
  declare opts: MathFieldOptions;
  declare dom: HTMLDivElement;
  declare model: MathRow;
  declare active: MathSlot | null;
  declare byItem: Map<MathItem, HTMLElement>;
  declare owner: Map<MathRow, Owner>;
  declare undoStack: Snapshot[];
  declare redoStack: Snapshot[];
  declare current: Snapshot;
  declare lastType: { span: number; at: number } | null;

  // opts: { onChange(latex), label(text) → 翻譯, onHistory(canUndo, canRedo) }
  constructor(host: HTMLElement, opts: MathFieldOptions = {}) {
    this.host = host;
    this.opts = opts;
    this.dom = el('div', 'wm-mv', host);
    this.dom.setAttribute('role', 'textbox');
    this.model = normalize([]);
    this.active = null; // { row, index, span }
    this.undoStack = []; this.redoStack = []; this.lastType = null;
    this.render();
    this.current = this.snap(null);
    // 點在格子以外的空白處：游標放進最近的一格（不然點了沒反應）
    host.addEventListener('mousedown', e => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest('.wm-mv-text, button')) return;
      e.preventDefault();
      this.focusNear(e.clientX, e.clientY);
    });
  }

  // 還沒改動時交回原始的 LaTeX（不重寫使用者自己的寫法）；改過之後由結構產生
  getLatex(): string { return this.current.src != null ? this.current.src : toLatex(this.model).trim(); }
  // keep 為 true：這次設定當成可以復原的一步（從 LaTeX 模式改完切回來）；否則清掉復原紀錄
  setLatex(src: string, keep?: boolean): void {
    const prev = this.current;
    this.model = parseLatex(src);
    this.active = null;
    this.render();
    this.current = this.snap(src);
    if (keep) this.undoStack.push(prev); else this.undoStack = [];
    this.redoStack = [];
    this.lastType = null;
    this.history();
  }
  isEmpty(): boolean { return !this.getLatex(); }

  // ---- 復原紀錄
  snap(src: string | null): Snapshot {
    const spans = this.spans();
    const i = this.active ? spans.indexOf(this.active.span) : -1;
    return { model: JSON.stringify(this.model), span: i, offset: i >= 0 ? this.caret(spans[i]).start : 0, src };
  }

  restore(s: Snapshot): void {
    this.model = JSON.parse(s.model) as MathRow;
    this.active = null;
    this.render();
    const spans = this.spans();
    const sp = spans[s.span] || spans[spans.length - 1];
    if (sp) { this.place(sp, s.span >= 0 ? s.offset : sp.textContent.length); this.active = this.findActive(sp); }
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  history(): void { if (this.opts.onHistory) this.opts.onHistory(this.canUndo(), this.canRedo()); }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.current);
    this.step(s);
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.current);
    this.step(s);
    return true;
  }

  step(s: Snapshot): void {
    this.current = s;
    this.lastType = null;
    this.restore(s);
    this.history();
    if (this.opts.onChange) this.opts.onChange(this.getLatex());
  }

  // 內容改了：記一筆復原紀錄並通知外面。連續在同一格打字（間隔不到一秒）合併成一步
  changed(kind: ChangeKind = 'struct'): void {
    const prev = this.current;
    const next = this.snap(null);
    if (next.model === prev.model) return; // 其實沒有變（例如只剩一列時按「－列」）
    this.current = next;
    const now = Date.now();
    const merge = kind === 'type' && !!this.lastType && this.lastType.span === next.span && now - this.lastType.at < 1000;
    if (!merge) { this.undoStack.push(prev); if (this.undoStack.length > 200) this.undoStack.shift(); }
    this.lastType = kind === 'type' ? { span: next.span, at: now } : null;
    this.redoStack = [];
    this.history();
    if (this.opts.onChange) this.opts.onChange(this.getLatex());
  }

  focus(atEnd = true): void {
    const spans = this.spans();
    const span = atEnd ? spans[spans.length - 1] : spans[0];
    if (span) this.place(span, atEnd ? span.textContent.length : 0);
  }

  // 游標放進離 (x, y) 最近的文字格
  focusNear(x: number, y: number): void {
    let best: HTMLElement | null = null; let bestD = Infinity; let atEnd = true;
    for (const s of this.spans()) {
      const r = s.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dx + dy * 2;
      if (d <= bestD) { bestD = d; best = s; atEnd = x >= (r.left + r.right) / 2; }
    }
    if (best) { this.place(best, atEnd ? best.textContent.length : 0); this.active = this.findActive(best); }
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
    this.owner = new Map();
    this.dom.appendChild(this.renderRow(this.model));
    if (focusItem && this.byItem.get(focusItem)) this.place(this.byItem.get(focusItem)!, 0);
  }

  // 一列的畫面。上下標另外排：只改畫面的結構，模型與 DOM 裡格子的順序（游標移動的順序）都不變
  renderRow(row: MathRow, plain?: boolean): HTMLSpanElement {
    const box = el('span', 'wm-mv-row');
    let i = 0;
    while (i < row.length) {
      const it = row[i];
      if (!isScript(it)) {
        box.appendChild(it.t === 'text' ? this.renderText(row, i, plain) : this.renderItem(it, row));
        i++;
        continue;
      }
      // 上下標排成一組，佔真的高度（外面的根號上框線、分數線、括號才會讓開，見 CSS 的 .wm-mv-scripts）。
      // 下標後面緊接上標（中間是 normalize 補的空文字格，例如 a_i^2）：疊成上下兩層，像 TeX 一樣
      const scripts = el('span', 'wm-mv-scripts');
      scripts.appendChild(this.renderItem(it, row));
      const mid = row[i + 1], other = row[i + 2];
      let used = 1;
      if (mid && mid.t === 'text' && !mid.v && isScript(other) && other.t !== it.t) {
        scripts.classList.add('is-pair');
        scripts.appendChild(this.renderText(row, i + 1, plain));
        scripts.appendChild(this.renderItem(other, row));
        used = 3;
      }
      // 上下標屬於前面的結構（括號、根號、向量…，中間隔著 normalize 補的空文字格）：跟那個結構包在一起，
      // 上標對齊它的頂端、下標對齊它的底端。前面是文字時，文字跟上下標都以整列的中線為準
      const prev = row[i - 1], base = row[i - 2];
      const prevEl = box.lastElementChild, baseEl = prevEl && prevEl.previousElementSibling;
      if (prev && prev.t === 'text' && !prev.v && base && base.t !== 'text' && !isScript(base) && baseEl) {
        const wrap = el('span', 'wm-mv-attach');
        if (baseEl.classList.contains('has-accent')) wrap.classList.add('has-accent');
        box.insertBefore(wrap, baseEl);
        wrap.append(baseEl, prevEl, scripts);
      } else box.appendChild(scripts);
      i += used;
    }
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
      if (!plain && (this.typedCommand(row, index, span, raw) || this.typedScript(row, index, span, raw))) return;
      it.v = plain ? raw : fromDisplay(raw);
      span.classList.toggle('is-slot', row.length === 1 && !it.v);
      // 在向量、~ 這類符號下面打字：打字不會重畫，這裡重新判斷符號要不要放低
      const accent = span.closest('.wm-mv-group.has-accent');
      const inner = accent && accent.querySelector(':scope > .wm-mv-inner');
      if (accent && inner) accent.classList.toggle('is-low', LOW_TEXT.test(inner.textContent || ''));
      this.changed('type');
    });
    span.addEventListener('paste', e => {
      e.preventDefault();
      const tx = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      this.insert(tx.replace(/\r?\n/g, ' '));
    });
    span.addEventListener('keydown', e => this.onKey(e, row, index, span));
    return span;
  }

  // row：這個項目所在的列（記下每個格子屬於哪個項目，Backspace 往外刪的時候用）
  renderItem(it: MathItem, row: MathRow): HTMLSpanElement {
    const slot = (cls: string, inner: MathRow, parent: HTMLElement | null, plain?: boolean): HTMLSpanElement => {
      const s = el('span', cls, parent);
      this.owner.set(inner, { item: it, row });
      s.appendChild(this.renderRow(inner, plain));
      return s;
    };
    if (it.t === 'frac') {
      const binom = it.cmd === '\\binom';
      const f = el('span', 'wm-mv-frac' + (binom ? ' is-binom' : ''));
      slot('wm-mv-num', it.a, f); slot('wm-mv-den', it.b, f);
      if (!binom) return f;
      // \binom：沒有分數線的上下兩格，外面是跟 \left( \right) 同一套、會伸長的圓括號
      const p = el('span', 'wm-mv-binom');
      drawDelim(this.host.ownerDocument, p, '(');
      p.appendChild(f);
      drawDelim(this.host.ownerDocument, p, ')');
      return p;
    }
    if (it.t === 'sqrt') {
      const f = el('span', 'wm-mv-sqrt');
      if (it.n) slot('wm-mv-root', it.n, f);
      radicalSign(this.host.ownerDocument, f);
      slot('wm-mv-radicand', it.a, f);
      return f;
    }
    if (it.t === 'sup' || it.t === 'sub') return slot('wm-mv-' + it.t, it.a, null);
    if (it.t === 'group') {
      const accent = ACCENTS.has(it.cmd);
      const f = el('span', 'wm-mv-group' + (accent ? ' has-accent' : ''));
      f.dataset.cmd = it.cmd.slice(1);
      if (GROUP_LABEL[it.cmd]) el('span', 'wm-mv-tag', f, GROUP_LABEL[it.cmd]);
      const inner = slot('wm-mv-inner', it.a, f, PLAIN_GROUPS.has(it.cmd));
      if (accent) {
        accentMark(this.host.ownerDocument, f, it.cmd);
        f.classList.toggle('is-low', LOW_TEXT.test(inner.textContent || ''));
      }
      return f;
    }
    if (it.t === 'brace') {
      const over = it.cmd === '\\overbrace';
      const f = el('span', 'wm-mv-hbrace ' + (over ? 'is-over' : 'is-under'));
      // 格子的順序是先內容、再標籤（Tab 照這個順序走），上下的位置由 CSS 排
      const body = slot('wm-mv-hb-body', it.a, f);
      horizontalBrace(this.host.ownerDocument, body, over);
      slot('wm-mv-hb-label', it.b, f);
      return f;
    }
    if (it.t === 'paren') {
      const f = el('span', 'wm-mv-paren');
      drawDelim(this.host.ownerDocument, f, it.l);
      slot('wm-mv-inner', it.a, f);
      drawDelim(this.host.ownerDocument, f, it.r);
      return f;
    }
    if (it.t === 'braces') return slot('wm-mv-braces', it.a, null);
    if (it.t === 'env') {
      const f = el('span', 'wm-mv-env');
      f.dataset.env = it.name;
      // 表格兩側的括號依環境而定（pmatrix 圓括號、vmatrix 直線…），跟 \left…\right 同一套畫法，跟著列數伸長
      const body = el('span', 'wm-mv-env-body', f);
      const delims = ENV_DELIMS[it.name];
      if (delims) drawDelim(this.host.ownerDocument, body, delims[0]);
      const grid = el('span', 'wm-mv-grid', body);
      for (const r of it.rows) {
        const tr = el('span', 'wm-mv-grid-row', grid);
        for (const cell of r) slot('wm-mv-cell', cell, tr);
      }
      if (delims) drawDelim(this.host.ownerDocument, body, delims[1]);
      const tools = el('span', 'wm-mv-env-tools', f);
      const L = this.opts.label || (x => x);
      const tool = (text: I18nKey, label: I18nKey, run: () => void) => {
        const b = el('button', 'wm-mv-env-btn', tools, L(text));
        b.type = 'button';
        b.setAttribute('aria-label', L(label));
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => { run(); this.active = null; this.render(); this.changed(); });
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

  // 在格子裡打完「\指令」再按空白：符號直接顯示成符號（\alpha → α），結構變成格子（\frac → 分數）
  typedCommand(row: MathRow, index: number, span: HTMLElement, raw: string): boolean {
    const c = this.caret(span);
    if (c.start !== c.end) return false;
    const m = /\\([A-Za-z]+)[ \u00a0]$/.exec(raw.slice(0, c.start));
    if (!m) return false;
    const cmd = '\\' + m[1];
    const it = row[index] as TextItem;
    const before = raw.slice(0, c.start - m[0].length); const after = raw.slice(c.start);
    if (TYPED_STRUCTS[cmd]) {
      it.v = fromDisplay(before + after);
      span.textContent = before + after;
      this.place(span, before.length);
      this.insertItems(parseLatex(TYPED_STRUCTS[cmd]).filter(x => !(x.t === 'text' && !x.v)), row, index, span);
      return true;
    }
    if (CMD_TO_CHAR.has(cmd) || FUNC_SET.has(m[1])) {
      const shown = toDisplay(cmd + ' ');
      it.v = fromDisplay(before + shown + after);
      span.textContent = before + shown + after;
      span.classList.remove('is-slot');
      this.place(span, (before + shown).length);
      this.changed('type');
      return true;
    }
    return false;
  }

  // 螢幕鍵盤打的 ^ 與 _ 常常沒有按鍵事件（onKey 攔不到），字會直接進到格子裡：
  // 拿掉那個字，改成上標／下標的格子
  typedScript(row: MathRow, index: number, span: HTMLElement, raw: string): boolean {
    const c = this.caret(span);
    if (c.start !== c.end || c.start < 1) return false;
    const ch = raw[c.start - 1];
    if (ch !== '^' && ch !== '_') return false;
    const it = row[index] as TextItem;
    const before = raw.slice(0, c.start - 1); const after = raw.slice(c.start);
    it.v = fromDisplay(before + after);
    span.textContent = before + after;
    this.place(span, before.length);
    this.insertItems([{ t: ch === '^' ? 'sup' : 'sub', a: [{ t: 'text', v: '' }] }], row, index, span);
    return true;
  }

  // 目前游標所在的格子（按按鈕之前最後停留的那一格）；還沒點過任何格子時是 null
  slot(): MathSlot | null {
    return this.active && this.dom.contains(this.active.span) ? this.active : null;
  }

  // 往後（dir = 1）或往前（dir = -1）一格。螢幕鍵盤沒有 Tab 與方向鍵，編輯器上有對應的按鈕
  move(dir: number): boolean {
    const spans = this.spans();
    const a = this.slot();
    const i = a ? spans.indexOf(a.span) : -1;
    const next = spans[i < 0 ? (dir > 0 ? 0 : spans.length - 1) : i + dir];
    if (!next) return false;
    this.place(next, dir > 0 ? 0 : next.textContent.length);
    this.active = this.findActive(next);
    return true;
  }

  // 拿掉游標所在的結構（內容留著；矩陣這類則整個拿掉）。游標不在任何結構裡時，拿掉游標前面最近的一個結構。
  // 螢幕鍵盤的 Backspace 在空格子裡常常沒有事件，所以另外有按鈕
  removeStructure(): boolean {
    const a = this.slot();
    if (!a) return false;
    const own = this.owner.get(a.row);
    if (own && own.item.t !== 'env') { this.unwrap(own, a.row); return true; }
    const row = own ? own.row : a.row;
    for (let i = own ? row.indexOf(own.item) : a.index - 1; i > 0; i--) {
      if (row[i].t === 'text') continue;
      (row[i - 1] as TextItem).v += MARK; // normalize 之後結構前面一定是文字
      row.splice(i, 1);
      this.settle(row);
      return true;
    }
    return false;
  }

  // 上下移動：到正上方或正下方最近的一格（分數的分子⇄分母、矩陣的上下列）
  vertical(span: HTMLElement, dir: number): boolean {
    const r0 = span.getBoundingClientRect();
    let x = (r0.left + r0.right) / 2;
    try {
      const sel = span.ownerDocument.getSelection();
      if (sel && sel.rangeCount) { const cr = sel.getRangeAt(0).getBoundingClientRect(); if (cr.left || cr.top) x = cr.left; }
    } catch { /* 用格子的中間 */ }
    let best: HTMLElement | null = null; let bestScore = Infinity; let atEnd = false;
    for (const s of this.spans()) {
      if (s === span) continue;
      const r = s.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const dy = dir < 0 ? r0.top - r.bottom : r.top - r0.bottom;
      if (dy < -2) continue; // 不在上方（或下方）
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const score = dx * 4 + dy;
      if (score < bestScore) { bestScore = score; best = s; atEnd = x >= (r.left + r.right) / 2; }
    }
    if (!best) return false;
    this.place(best, atEnd ? best.textContent.length : 0);
    this.active = this.findActive(best);
    return true;
  }

  onKey(e: KeyboardEvent, row: MathRow, index: number, span: HTMLElement): void {
    const it = row[index] as TextItem; // 按鍵來自文字格，所以是文字項目
    const text = span.textContent;
    const c = this.caret(span);
    const spans = this.spans();
    const i = spans.indexOf(span);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const go = (d: number, atEnd: boolean) => { const next = spans[i + d]; if (next) { e.preventDefault(); this.place(next, atEnd ? next.textContent.length : 0); } };
    // 復原／取消復原（格子重畫後瀏覽器自己的復原會失效，所以由這裡處理）
    if (mod && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault(); e.stopPropagation();
      if (k === 'y' || e.shiftKey) this.redo(); else this.undo();
      return;
    }
    // Enter：跳到下一格（跟 Tab 一樣）
    if (e.key === 'Enter' && !mod) { e.preventDefault(); go(1, false); return; }
    // Tab／Shift+Tab：下一格／上一格（已經是最後一格就離開方程式）
    if (e.key === 'Tab') { if (spans[i + (e.shiftKey ? -1 : 1)]) { go(e.shiftKey ? -1 : 1, e.shiftKey); e.stopPropagation(); } return; }
    if (e.key === 'ArrowRight' && c.start === text.length && c.end === text.length) { go(1, false); return; }
    if (e.key === 'ArrowLeft' && c.start === 0 && c.end === 0) { go(-1, true); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod) { if (this.vertical(span, e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault(); return; }
    const atStart = c.start === 0 && c.end === 0;
    // 在格子開頭按 Backspace：刪掉前面那個結構（分數、根號…）
    if (e.key === 'Backspace' && atStart && index > 0 && row[index - 1].t !== 'text') {
      e.preventDefault();
      row.splice(index - 1, 1);
      const merged = normalize(row);
      row.splice(0, row.length, ...merged);
      this.render();
      const target = row[Math.max(0, index - 2)];
      const sp = this.byItem.get(target);
      if (sp) { this.place(sp, sp.textContent.length - (sp.dataset.plain ? it.v : toDisplay(it.v)).length); this.active = this.findActive(sp); }
      this.changed();
      return;
    }
    // 在結構裡面第一格的開頭按 Backspace：拆掉這個結構。全部是空的就整個拿掉（分數裡的分數變回分數）；
    // 有內容就把內容留在原處，只拿掉結構
    const own = this.owner.get(row);
    if (e.key === 'Backspace' && atStart && index === 0 && own) {
      e.preventDefault();
      this.unwrap(own, row);
      return;
    }
    // 在格子結尾按 Delete：刪掉後面那個結構
    if (e.key === 'Delete' && c.start === text.length && c.end === text.length && index < row.length - 1 && row[index + 1].t !== 'text') {
      e.preventDefault();
      it.v += MARK;
      row.splice(index + 1, 1);
      this.settle(row);
      return;
    }
    // 打 ^ 或 _：直接開一個上標／下標的格子
    if ((e.key === '^' || e.key === '_') && !mod && !e.altKey) {
      e.preventDefault();
      this.insertItems([{ t: e.key === '^' ? 'sup' : 'sub', a: [{ t: 'text', v: '' }] }], row, index, span);
    }
  }

  // 拆掉一個結構：own 是結構與它所在的列，from 是游標所在的格子
  unwrap(own: Owner, from: MathRow): void {
    const { item, row } = own;
    const at = row.indexOf(item);
    if (at < 0) return;
    const slots = slotsOf(item);
    const empty = slots.every(rowEmpty);
    const prev = row[at - 1] as TextItem; // normalize 之後結構前面一定是文字
    if (empty) {
      prev.v += MARK;
      row.splice(at, 1);
    } else if (item.t === 'env') {
      // 矩陣、分段函數有內容時不拆（內容會全部擠在一起）：游標移到它前面
      const sp = this.byItem.get(prev);
      if (sp) { this.place(sp, sp.textContent.length); this.active = this.findActive(sp); }
      return;
    } else {
      // 游標停在原本那一格內容的前面
      (from[0] as TextItem).v = MARK + (from[0] as TextItem).v;
      row.splice(at, 1, ...slots.flat());
    }
    this.settle(row);
  }

  // 改完一列之後：整理（合併相鄰的文字）、重畫、把游標放到記號的位置、記一筆復原紀錄
  settle(row: MathRow): void {
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
    this.active = null;
    this.render();
    const sp = target && this.byItem.get(target);
    if (sp) {
      this.place(sp, sp.dataset.plain ? offset : toDisplay(target!.v.slice(0, offset)).length);
      this.active = this.findActive(sp);
    }
    this.changed();
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
    this.settle(row);
  }
}
