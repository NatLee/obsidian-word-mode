import { el } from './dom.js';
import type { I18nKey } from './i18n.js';
// 方程式的簡易視覺化編輯：把 LaTeX 拆成「看得到的結構」（分數上下兩格、根號、上下標、括號、矩陣…），
// 每一格都可以直接點進去打字，符號顯示成真正的符號（α、≤、∑）。存檔仍是 LaTeX。
// 不依賴 Obsidian；看不懂的 LaTeX 會原樣放在文字格裡，不會遺失。

// ---------------------------------------------------------------- 符號 ⇄ LaTeX 指令
// 間距指令顯示成差不多寬的空白字元，不然會照原文顯示「\,」（\int f(x)\,dx 很常見）：
// \, 細空白、\: 中等數學空白、\; 三分之一 em、\quad 一個 em（\qquad 顯示成兩個；沒改到的話存回去還是 \qquad，見 displaySegs）
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
// 指令名稱只由英文字母組成：判斷「接起來會不會變成另一個指令」都用這個
const isLetter = (ch: string | undefined): boolean => !!ch && /[A-Za-z]/.test(ch);

// ---------------------------------------------------------------- 一格文字：原文 ⇄ 畫面上的字
// 格子裡顯示的是好讀的樣子（\alpha → α、\sin → sin、\, → 細空白），不認得的指令照原樣顯示。
// 顯示是一段一段對出來的，每一段記著原文（src）與畫面上的字（shown）：使用者改了格子裡的字之後，
// 沒改到的段落用記著的原文寫回去，只有改到的地方才從畫面上的字轉換。
// 以前整格都從畫面上的字轉回去，畫面上分不出來的寫法（\leq 與 \le 都是 ≤、α 與 \alpha、max 與 \max）
// 只要在同一格改一個字，就全部變成編輯器自己偏好的那一種
export interface Seg { src: string; shown: string; }
export const segSrc = (segs: Seg[]): string => segs.map(s => s.src).join('');
const segShown = (segs: Seg[]): string => segs.map(s => s.shown).join('');

// 原文 → 一段一段。一般的字一個字一段；指令（連同它顯示成的符號）是一段，不能只留半個
export function displaySegs(latex: string): Seg[] {
  const out: Seg[] = [];
  const plain = (t: string): void => { for (const ch of Array.from(t)) out.push({ src: ch, shown: ch }); };
  // 反斜線加一個不是字母的字（\\、\{、\,）是一個單位：不這樣讀的話，「\\sin」（換行後面接 sin）會被看成「\」加「\sin」。
  // u：反斜線後面是補充平面的字（\𝔹）時整個字算進去，不會只拿到半個
  const re = /\\mathbb\{([RNZQC])\}|\\([^A-Za-z])|\\([A-Za-z]+)( ?)/gu;
  let last = 0;
  for (let m = re.exec(latex); m; m = re.exec(latex)) {
    plain(latex.slice(last, m.index));
    last = m.index + m[0].length;
    // 沒有對到的群組是 undefined（型別定義寫成 string）
    const bb = m[1] as string | undefined, other = m[2] as string | undefined, name = m[3], space = m[4];
    if (bb) { out.push({ src: m[0], shown: CMD_TO_CHAR.get(m[0])! }); continue; }
    if (other != null) { out.push({ src: m[0], shown: SPACE_TO_CHAR.get(m[0]) || m[0] }); continue; }
    const cmd = '\\' + name;
    // \qquad 顯示成兩個 em 的空白（整段記著 \qquad，沒改到就照原文寫回去）
    const symbol = name === 'qquad' ? '\u2003\u2003' : CMD_TO_CHAR.get(cmd);
    // 函數名稱前面緊接字母或反斜線（n\log n、\sin\cos x、\arg\max）時不拿掉反斜線：
    // 拿掉之後畫面上跟前面的字連成一個字，看不出哪裡是函數
    const bare = !symbol && FUNC_SET.has(name) && !/[A-Za-z\\]/.test(latex[m.index - 1] || '');
    out.push({ src: cmd, shown: symbol || (bare ? name : cmd) });
    // 符號後面的空白只有在「隔開後面的字母」時才不顯示（\alpha x → αx）：那個空白只是 LaTeX 的分隔，不佔位置。
    // 其他的空白照樣顯示
    if (space) out.push({ src: space, shown: symbol && isLetter(latex[last]) ? '' : space });
  }
  plain(latex.slice(last));
  return out;
}

// 新打的字 → 一段一段：α → \alpha、獨立的 sin → \sin（auto 為 false 時不轉換函數名稱），其他照打的字。
// prev 是這段字前面緊接的那個字：前面是字母或反斜線時，開頭的字不是獨立的一個詞
function freshSegs(text: string, prev: string, auto: boolean): Seg[] {
  const out: Seg[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const cmd = CHAR_TO_CMD.get(chars[i]);
    if (cmd) { out.push({ src: cmd, shown: chars[i] }); continue; }
    if (auto && isLetter(chars[i]) && !/[A-Za-z\\]/.test(i ? chars[i - 1] : prev)) {
      let j = i;
      while (isLetter(chars[j])) j++;
      const word = chars.slice(i, j).join('');
      if (FUNC_SET.has(word)) { out.push({ src: '\\' + word, shown: word }); i = j - 1; continue; }
    }
    out.push({ src: chars[i], shown: chars[i] });
  }
  return out;
}

// 指令（\alpha）後面緊接字母時補一個不顯示的空白，不然會接成另一個指令（\alphax）
function sealSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && /^\\[A-Za-z]+$/.test(last.src) && isLetter(s.src[0])) out.push({ src: ' ', shown: '' });
    out.push(s);
  }
  return out;
}

// 畫面上第 a 到第 b 個字之間的段落。只切到一半的段落（游標在 \foo 中間）留下的部分照畫面上的字。
// 剛好在邊界上的「不顯示的空白」不算在內：它是隔開前後兩段用的，要不要留由 sealSegs 決定
function sliceSegs(segs: Seg[], a: number, b: number): Seg[] {
  const out: Seg[] = [];
  let pos = 0;
  for (const s of segs) {
    const from = pos, to = pos + s.shown.length;
    pos = to;
    if (from === to) { if (from > a && from < b) out.push(s); continue; }
    if (to <= a || from >= b) continue;
    if (from >= a && to <= b) out.push(s);
    else out.push(...freshSegs(s.shown.slice(Math.max(a, from) - from, Math.min(b, to) - from), '', false));
  }
  return out;
}

// 把畫面上第 from 到第 to 個字換成 put
function spliceSegs(segs: Seg[], from: number, to: number, put: Seg[]): Seg[] {
  return sealSegs([...sliceSegs(segs, 0, from), ...put, ...sliceSegs(segs, to, Infinity)]);
}

// 畫面上的字從 segs 變成 text：找出改到的範圍（from 起，舊的到 toOld、新的到 toNew）；沒有變就回傳 null。
// 範圍會往外擴到完整的詞與完整的段落：
// ・詞（連續的英文字母）被加了字、刪了字或切開時，整個詞都算改過。sin 後面多打一個 e 是 sine，不是 \sin 加 e；
//   反過來，原本就寫 max（不是 \max）的地方後面加一個數字，max 這個詞沒有變，就照原文留著
// ・一個指令顯示成好幾個字時（\foo、sin）不能只留半個
// caret 是改完之後游標的位置（打字、刪字、貼上，改過的地方都在游標前面或剛好在游標上）：
// 先找結尾相同的部分而且不越過游標，同樣的字連在一起時（\le\leq 是 ≤≤，中間再打一個 ≤）才知道改的是哪一個，
// 前後記著的原文才對得上
function diffRegion(segs: Seg[], text: string, caret?: number): { from: number; toOld: number; toNew: number } | null {
  const old = segShown(segs);
  if (old === text) return null;
  const max = Math.min(old.length, text.length);
  const sMax = caret == null || caret > text.length ? max : Math.min(max, text.length - caret);
  let s = 0;
  while (s < sMax && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
  let p = 0;
  while (p < max - s && old[p] === text[p]) p++;
  let from = p, toOld = old.length - s, toNew = text.length - s;
  for (;;) {
    const f0 = from, t0 = toOld;
    // 範圍的邊界前後都是字母（不管是改之前還是改之後）：邊界在一個詞的中間，往外擴到詞的開頭與結尾
    while (from > 0 && isLetter(text[from - 1]) && (isLetter(text[from]) || isLetter(old[from]))) from--;
    while (toNew < text.length && isLetter(text[toNew]) && (isLetter(text[toNew - 1]) || isLetter(old[toOld - 1]))) { toNew++; toOld++; }
    let pos = 0;
    for (const sg of segs) {
      const a = pos, b = pos + sg.shown.length;
      pos = b;
      if (a < from && from < b) from = a;
      if (a < toOld && toOld < b) { toNew += b - toOld; toOld = b; }
    }
    if (from === f0 && toOld === t0) break;
  }
  return { from, toOld, toNew };
}

// 使用者把格子裡的字改成 text 之後的段落。segs 是改之前的段落；base 是這一格剛畫出來時的段落（原文）；
// caret 見 diffRegion。改到的地方照新打的字轉換，其他地方留著。再跟 base 比一次：跟原文一樣的開頭與結尾直接用原文，
// 所以打錯一個字再刪掉、刪掉一個符號再打回來，都會回到原本的寫法
export function editSegs(segs: Seg[], text: string, auto = true, base: Seg[] = segs, caret?: number): Seg[] {
  const r = diffRegion(segs, text, caret);
  const next = r ? spliceSegs(segs, r.from, r.toOld, freshSegs(text.slice(r.from, r.toNew), text[r.from - 1] || '', auto)) : segs;
  if (base === segs) return next;
  const b = diffRegion(base, text, caret);
  if (!b) return base;
  return sealSegs([...sliceSegs(base, 0, b.from), ...sliceSegs(next, b.from, b.toNew), ...sliceSegs(base, b.toOld, Infinity)]);
}

// LaTeX 文字 → 顯示
export function toDisplay(latex: string): string { return segShown(displaySegs(latex)); }

// 顯示 → LaTeX，整段都當成新打的字：α → \alpha（後面接字母時補一個空白）、獨立的 sin → \sin
export function fromDisplay(text: string): string { return segSrc(editSegs([], text)); }

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
// 結構項目放子列的欄位（a、b、n、rows）：走訪整棵樹時直接用欄位名稱取值，不必先分辨是哪一種項目。
// g：從原文讀進來的結構記著格子之間的原文（依格子的順序，第一段在第一格前面、最後一段在最後一格後面），
// 寫回去時用這些原文接上格子的內容，所以沒改到的地方一字不差：x^2 不會變成 x^{2}、\left(x\right) 不會被加上空白、
// 分成好幾行寫的矩陣不會接成一行。新插入的結構沒有 g，照編輯器自己的寫法（x^{…}、\left( … \right)）
interface MathSlots { a?: MathRow; b?: MathRow; n?: MathRow | null; rows?: MathRow[][]; g?: string[]; }
// raw：整段看不懂的 LaTeX（見 parseLatex），格子裡照原文顯示、原文存回
export interface TextItem { t: 'text'; v: string; raw?: boolean; }
export interface FracItem extends MathSlots { t: 'frac'; cmd: string; a: MathRow; b: MathRow; }
export interface SqrtItem extends MathSlots { t: 'sqrt'; a: MathRow; n: MathRow | null; }
export interface ScriptItem extends MathSlots { t: 'sup' | 'sub'; a: MathRow; }
export interface GroupItem extends MathSlots { t: 'group'; cmd: string; a: MathRow; }
export interface BraceItem extends MathSlots { t: 'brace'; cmd: string; a: MathRow; b: MathRow; }
export interface ParenItem extends MathSlots { t: 'paren'; l: string; r: string; a: MathRow; }
// w：讀進來時每一列有幾格（之後按「＋列」「＋欄」加的格子不在原文裡，照編輯器的寫法前後各空一格）
export interface EnvItem extends MathSlots { t: 'env'; name: string; rows: MathRow[][]; w?: number[]; }
export interface BracesItem extends MathSlots { t: 'braces'; a: MathRow; }
export type MathItem = TextItem | FracItem | SqrtItem | ScriptItem | GroupItem | BraceItem | ParenItem | EnvItem | BracesItem;
const FRACS = ['\\frac', '\\dfrac', '\\tfrac', '\\binom'];
// 上括號、下括號：標籤寫成接在後面的 ^{…}（上括號）或 _{…}（下括號），TeX 會把它放在括號的正上方／正下方。
// 以前不認得這兩個指令，格子裡照原文顯示「\overbrace」，標籤還被當成右上角的上標
const H_BRACES: Record<string, '^' | '_'> = { '\\overbrace': '^', '\\underbrace': '_' };
// 大括號裡是一般文字或名稱的指令（文字、編號、標籤、運算子的名稱）：內容原樣保留，不拆成結構，
// 格子裡也不轉換符號（不把 sin 變成 \sin、不把 α 變成 \alpha）。
// 以前裡面的底線被當成下標：\text{learning_rate} 改過別的地方再存回去變成 \text{learning_{r}ate}，
// 而 MathJax 在文字裡不處理下標，畫面上就多出一對大括號
const PLAIN_GROUPS = new Set([
  '\\text', '\\textrm', '\\textbf', '\\textit', '\\texttt', '\\textsf', '\\textnormal', '\\mbox',
  '\\mathrm', '\\mathit', '\\operatorname', '\\operatorname*', '\\tag', '\\tag*', '\\label',
]);
const GROUP_CMDS = ['\\vec', '\\bar', '\\hat', '\\tilde', '\\dot', '\\ddot', '\\overline', '\\underline', '\\mathbf', '\\mathbb', '\\mathcal', '\\boldsymbol', '\\overrightarrow', ...PLAIN_GROUPS];
const ENVS = ['matrix', 'bmatrix', 'pmatrix', 'vmatrix', 'Bmatrix', 'Vmatrix', 'cases', 'aligned', 'align', 'array', 'gathered'];
// 後面不接參數的符號（寫成上下標時常見：A^\top、f^\prime、a^\dagger）。SYMBOL_PAIRS 與 FUNCS 裡的指令也都不接參數
const NO_ARG = new Set(['\\prime', '\\top', '\\bot', '\\dagger', '\\dag', '\\ast', '\\star', '\\ell', '\\hbar', '\\intercal']);
// 一定要接參數或另一半的指令：沒有大括號就出現在上下標裡（x^\frac12、x^\left(）時無法拆成格子
const NEEDS_MORE = new Set([...FRACS, ...GROUP_CMDS, ...Object.keys(H_BRACES), '\\sqrt', '\\left', '\\right', '\\middle', '\\begin', '\\end']);

class ParseError extends Error {}

// parseRow 的結果：解析出的一列，以及停下來的位置（停在 stops 其中一個字串的開頭）
interface RowResult { row: MathRow; pos: number; }

function parseRow(s: string, pos: number, stops: string[]): RowResult {
  const row: MathRow = [];
  let text = '';
  const flush = () => { if (text) { row.push({ t: 'text', v: text }); text = ''; } };
  const at = (w: string) => s.startsWith(w, pos);
  const isStop = () => stops.some(w => at(w) && (!/^\\[A-Za-z]+$/.test(w) || !/[A-Za-z]/.test(s[pos + w.length] || '')));
  // 空白、換行都跳過（TeX 找參數時也跳過）。跳過的原文記在結構的 g 裡，寫回去還在
  const skipSpace = () => { while (s[pos] === ' ' || s[pos] === '\n' || s[pos] === '\t' || s[pos] === '\r') pos++; };
  // 讀一個 {…}。cut 依序記下每一格內容在原文的開頭與結尾（格子以外的原文就是結構的 g，見 glue）
  const group = (cut: number[]): MathRow => {
    skipSpace();
    if (s[pos] !== '{') throw new ParseError('{');
    const r = parseRow(s, pos + 1, ['}']);
    cut.push(pos + 1, r.pos);
    pos = r.pos + 1;
    return r.row;
  };
  // 結構從 start 到目前位置的原文裡，cut 以外的部分：第一格前面、格子之間、最後一格後面
  const glue = (start: number, cut: number[]): string[] => {
    const g: string[] = [];
    let from = start;
    for (let i = 0; i < cut.length; i += 2) { g.push(s.slice(from, cut[i])); from = cut[i + 1]; }
    g.push(s.slice(from, pos));
    return g;
  };
  const command = () => { const m = /^\\[A-Za-z]+/.exec(s.slice(pos)); return m ? m[0] : null; };
  // 文字類指令的 {…}：原樣讀到成對的 } 為止（\{、\} 不算），整段是一格文字
  const verbatim = (cut: number[]): MathRow => {
    const start = pos + 1;
    let depth = 0;
    for (; pos < s.length; pos++) {
      if (s[pos] === '\\') { pos++; continue; }
      if (s[pos] === '{') depth++;
      else if (s[pos] === '}' && --depth === 0) { cut.push(start, pos); pos++; return [{ t: 'text', v: s.slice(start, pos - 1) }]; }
    }
    throw new ParseError('{');
  };
  // 原文裡空著的選擇性的格子（\sqrt[]{x} 的次方根、\overbrace{a}^{} 的標籤）：那一格從 cut 拿掉，
  // 它的原文就算在格子之間（g 少一段）。格子照樣留著可以打字；空著的話寫回去還是原文，打了字才換成編輯器的寫法（見 toLatex）
  const blankSlot = (cut: number[], mark: number): void => { if (!s.slice(cut[mark], cut[mark + 1]).trim()) cut.length = mark; };
  // 從 pos 的指令 c 讀一個有格子的結構（分數、根號、\vec{…} 這類、上下括號）；不是這些就回傳 null，pos 不動
  const structure = (c: string): MathItem | null => {
    const start = pos;
    const cut: number[] = [];
    if (FRACS.includes(c)) { pos += c.length; const a = group(cut); const b = group(cut); return { t: 'frac', cmd: c, a, b, g: glue(start, cut) }; }
    if (c === '\\sqrt') {
      pos += c.length; skipSpace();
      let n: MathRow | null = null;
      if (s[pos] === '[') {
        const r = parseRow(s, pos + 1, [']']);
        n = r.row;
        cut.push(pos + 1, r.pos);
        blankSlot(cut, 0);
        pos = r.pos + 1;
      }
      const a = group(cut);
      return { t: 'sqrt', a, n, g: glue(start, cut) };
    }
    // \tag*{…}（編號不加括號）、\operatorname*{…}：指令名稱只抓到字母的部分，星號要一起算進去
    const cmd = s[pos + c.length] === '*' && GROUP_CMDS.includes(c + '*') ? c + '*' : c;
    if (GROUP_CMDS.includes(cmd)) {
      pos += cmd.length; skipSpace();
      if (s[pos] === '{') { const a = PLAIN_GROUPS.has(cmd) ? verbatim(cut) : group(cut); return { t: 'group', cmd, a, g: glue(start, cut) }; }
      pos = start;
    }
    if (H_BRACES[c]) {
      pos += c.length; skipSpace();
      if (s[pos] === '{') {
        const a = group(cut);
        // 後面緊接 ^（上括號）或 _（下括號）就是標籤；沒有標籤時標籤格是空的，空白留給後面的文字
        const afterBody = pos;
        skipSpace();
        let b: MathRow = [];
        if (s[pos] === H_BRACES[c]) { pos++; b = scriptArg(cut); blankSlot(cut, 2); } else pos = afterBody;
        return { t: 'brace', cmd: c, a, b, g: glue(start, cut) };
      }
      pos = start;
    }
    return null;
  };
  // ^ 或 _ 後面的內容：{…}、一個指令（x^\alpha）或一個字（x^2）。cut 記下內容在原文的範圍（沒有大括號時就是那一個單位）
  const scriptArg = (cut: number[]): MathRow => {
    skipSpace();
    if (s[pos] === '{') return group(cut);
    if (isStop()) throw new ParseError('^');
    const start = pos;
    const one = (r: MathRow): MathRow => { cut.push(start, pos); return r; };
    const c = command();
    if (c) {
      const mb = /^\\mathbb\{[RNZQC]\}/.exec(s.slice(pos));
      if (mb) { pos += mb[0].length; return one([{ t: 'text', v: mb[0] }]); }
      // A^\mathrm{T}、e^\frac{1}{2}：指令連同它的參數才是上標。以前只拿指令名稱，
      // 寫回去變成 A^{\mathrm}{T}、e^{\frac}{1}{2}（指令跟參數被拆開，是壞掉的 LaTeX）
      const it = structure(c);
      if (it) return one([it]);
      pos += c.length;
      // 要參數卻沒有大括號的指令（x^\frac12）、不認得又緊接著 { 的指令（不知道它要不要參數，x^\foo{a}）：
      // 猜錯會把內容搬進或搬出上標，所以整段當成看不懂的寫法，原樣保留
      const known = CMD_TO_CHAR.has(c) || FUNC_SET.has(c.slice(1)) || NO_ARG.has(c);
      if (NEEDS_MORE.has(c) || (!known && /^\s*[{[]/.test(s.slice(pos)))) throw new ParseError('^');
      return one([{ t: 'text', v: c }]);
    }
    // 一個字，或反斜線加一個字（\, \{ \|）：以前只拿走反斜線，x^\,y 寫回去變成 x^{\},y。
    // 補充平面的字（𝔹）在字串裡是兩個單位，要整個拿：以前只拿前半個，寫回去變成拆開的亂碼
    const esc = s[pos] === '\\' ? 1 : 0;
    if (esc && (pos + 1 >= s.length || s[pos + 1] === '\\')) throw new ParseError('^');
    if (pos < s.length && (esc || !'^_}&\\'.includes(s[pos]))) {
      pos += esc + String.fromCodePoint(s.codePointAt(pos + esc)!).length;
      return one([{ t: 'text', v: s.slice(start, pos) }]);
    }
    throw new ParseError('^');
  };
  while (pos < s.length) {
    if (isStop()) { flush(); return { row, pos }; }
    const ch = s[pos];
    if (ch === '}') throw new ParseError('}');
    if (ch === '{') { flush(); const r = parseRow(s, pos + 1, ['}']); pos = r.pos + 1; row.push({ t: 'braces', a: r.row }); continue; }
    if (ch === '^' || ch === '_') {
      flush();
      const start = pos++;
      const cut: number[] = [];
      const a = scriptArg(cut);
      row.push({ t: ch === '^' ? 'sup' : 'sub', a, g: glue(start, cut) });
      continue;
    }
    if (ch === '\\') {
      const c = command();
      if (!c) { text += s.slice(pos, pos + 2); pos += 2; continue; } // \{ \} \\ \, 等
      const mb = /^\\mathbb\{[RNZQC]\}/.exec(s.slice(pos));
      if (mb) { text += mb[0]; pos += mb[0].length; continue; }
      const it = structure(c);
      if (it) { flush(); row.push(it); continue; }
      if (c === '\\left') {
        flush();
        const start = pos;
        pos += c.length; skipSpace();
        const dl = /^(\\[A-Za-z]+|\\.|.)/.exec(s.slice(pos));
        if (!dl) throw new ParseError('left');
        pos += dl[0].length;
        const r = parseRow(s, pos, ['\\right']);
        if (!s.startsWith('\\right', r.pos)) throw new ParseError('right');
        const cut = [pos, r.pos];
        pos = r.pos + 6; skipSpace();
        const dr = /^(\\[A-Za-z]+|\\.|.)/.exec(s.slice(pos));
        if (!dr) throw new ParseError('right');
        pos += dr[0].length;
        row.push({ t: 'paren', l: dl[0], r: dr[0], a: r.row, g: glue(start, cut) });
        continue;
      }
      if (c === '\\begin') {
        const m = /^\\begin\{([A-Za-z*]+)\}/.exec(s.slice(pos));
        if (!m || !ENVS.includes(m[1])) throw new ParseError('env');
        flush(); pos += m[0].length;
        const end = '\\end{' + m[1] + '}';
        const rows: MathRow[][] = [[]];
        // 格子之間只有 & 與 \\（格子裡的空白、換行都算在格子裡），所以 g 只記開頭與結尾；cellAt 是最後一格的開頭
        let cellAt = pos;
        for (;;) {
          cellAt = pos;
          const r = parseRow(s, pos, ['&', '\\\\', end]);
          rows[rows.length - 1].push(r.row);
          pos = r.pos;
          if (s.startsWith(end, pos)) break;
          if (s[pos] === '&') { pos++; continue; }
          if (s.startsWith('\\\\', pos)) {
            pos += 2;
            // \\[1ex]、\\*：緊接在換列後面的 [ 與 * 是換列的參數。寫回去時每一列之間會加空白，
            // 參數就變成下一列開頭的文字（畫面上多出「[1ex]」），所以這種寫法不拆成格子
            if (s[pos] === '[' || s[pos] === '*') throw new ParseError('\\\\');
            rows.push([]);
            continue;
          }
          throw new ParseError('end');
        }
        const endAt = pos;
        pos += end.length;
        // 最後一列如果只有一個空白格（結尾多寫了 \\）就拿掉；那段原文（\\ 與空白）算在結尾，寫回去還在
        const last = rows[rows.length - 1];
        let tail = end;
        if (rows.length > 1 && last.length === 1 && !s.slice(cellAt, endAt).trim()) { rows.pop(); tail = '\\\\' + s.slice(cellAt, endAt) + end; }
        row.push({ t: 'env', name: m[1], rows, g: [m[0], tail], w: rows.map(r => r.length) });
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

// 解析 LaTeX；括號不成對等看不懂的情況，整段當成一格文字（不會遺失內容）。
// 那一格標成 raw：照原文顯示、原文存回，不做符號的轉換（看不懂結構，就分不出哪裡是文字、哪裡是數學，
// 轉換會把 \text{max value} 裡的 max 當成函數改成 \max）
export function parseLatex(src?: string | null): MathRow {
  const s = String(src || '');
  const whole = (): MathRow => normalize([s ? { t: 'text', v: s, raw: true } : { t: 'text', v: s }]);
  // 有註解（沒有跳脫的 %）：格子寫回去時整段會接成一行，註解後面的內容就全部被註解掉了
  if (/(^|[^\\])(\\\\)*%/.test(s)) return whole();
  try { return normalize(parseRow(s, 0, []).row); } catch { return whole(); }
}

// 一格的內容，去掉前後的空白。結尾是「\ 」（反斜線加空白，強制的空白）時空白要留著：
// 去掉之後剩下的反斜線會把後面的 } 變成 \}，大括號就不成對了
const trimRow = (row: MathRow): string => {
  const v = toLatex(row).trim();
  return /(^|[^\\])(\\\\)*\\$/.test(v) ? v + ' ' : v;
};
const rowEmpty = (row: MathRow): boolean => !toLatex(row).trim();

// 字串結尾是什麼：'word' 是指令名稱（\alpha、\rangle），'bs' 是單獨一個反斜線，'' 是其他（\\ 是換行，不算）
function ending(s: string): 'word' | 'bs' | '' {
  let i = s.length;
  while (i > 0 && isLetter(s[i - 1])) i--;
  let n = 0;
  while (i - n > 0 && s[i - n - 1] === '\\') n++;
  if (n % 2 === 0) return '';
  return i === s.length ? 'bs' : 'word';
}
// 把幾段 LaTeX 接起來。前一段以指令名稱結尾、下一段以字母開頭時隔一個空白，不然會接成另一個指令
// （\left\langle 後面那一格改成字母開頭變成 \langlea、\right\rangle 後面打 x 變成 \ranglex）；
// 前一段以單獨的反斜線結尾（格子裡打了 \ 還沒打完）也隔一個空白，不然會跟後面的 } 合成 \}，大括號就不成對了。
// 讀進來的原文不會有這兩種接法，所以沒改到的地方不受影響
function cat(parts: string[]): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    const e = ending(out);
    if (e === 'bs' || (e === 'word' && isLetter(p[0]))) out += ' ';
    out += p;
  }
  return out;
}
// 原文的格子之間（g）依序接上每一格的內容；段數對不上時回傳 null，改用編輯器自己的寫法
function glued(g: string[] | undefined, slots: string[]): string | null {
  if (!g || g.length !== slots.length + 1) return null;
  const parts = [g[0]];
  slots.forEach((x, i) => parts.push(x, g[i + 1]));
  return cat(parts);
}
// 不加大括號也還是同一個上標的內容（一個字、一個指令、\mathrm{T} 這樣一個結構）：回傳那段 LaTeX，否則回傳 null。
// 直接讀讀看：讀出來的上標剛好是這段內容才算
function bareArg(row: MathRow): string | null {
  const v = toLatex(row);
  if (!v || v.trim() !== v) return null;
  const back = parseLatex('^' + v);
  const sup = back[1];
  return back.length === 3 && sup.t === 'sup' && toLatex(sup.a) === v && !(back[2] as TextItem).v ? v : null;
}
// 原文寫的上下標（x^2、x^{2}、上下括號的標籤）：pre 是 ^ 加上原文的空白與 {，post 是 }（原文沒有大括號時都沒有）。
// 沒有大括號的寫法，改過之後內容還是一個單位（2 改成 3、\alpha 改成 \beta）就照樣不加；變成好幾個字才加上
function scriptLatex(pre: string, post: string, row: MathRow): string {
  if (pre.endsWith('{')) return cat([pre, toLatex(row), post]);
  const bare = bareArg(row);
  return bare != null ? cat([pre, bare]) : cat([pre, '{', toLatex(row), '}']);
}
// 打字打出來、不成對的大括號與註解符號 %：照樣寫出去整個方程式就壞了（後面的 } 被配走、後面整行變成註解），
// 改寫成看得到的字 \{、\}、\%（格子裡看到的就是這個字）。成對的照樣寫出去：打完 { 再打 } 就是一組大括號。
// 從原文讀進來的格子一定成對、也沒有 %（有 % 的整段不拆成格子），不會被改到
function safeText(v: string): string {
  if (!/[{}%]/.test(v)) return v;
  const open: number[] = [];
  const bad = new Set<number>();
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\') i++;
    else if (v[i] === '%') bad.add(i);
    else if (v[i] === '{') open.push(i);
    else if (v[i] === '}') { if (open.length) open.pop(); else bad.add(i); }
  }
  for (const i of open) bad.add(i);
  if (!bad.size) return v;
  let out = '';
  for (let i = 0; i < v.length; i++) out += (bad.has(i) ? '\\' : '') + v[i];
  return out;
}

// 寫回 LaTeX。從原文讀進來的結構用記著的原文（g）接上格子的內容，格子裡的空白照原文；
// 新插入的結構（沒有 g）用編輯器自己的寫法：格子去掉前後的空白、上下標一律加大括號、\left( … \right) 裡外各空一格
export function toLatex(row: MathRow): string { return cat(row.map(itemLatex)); }
function itemLatex(it: MathItem): string {
  const L = toLatex;
  const g = it.t === 'text' ? undefined : it.g;
  switch (it.t) {
    case 'text': return it.raw ? it.v : safeText(it.v);
    case 'frac': return glued(g, [L(it.a), L(it.b)]) ?? cat([it.cmd || '\\frac', '{', trimRow(it.a), '}{', trimRow(it.b), '}']);
    case 'sqrt': {
      const n = it.n && !rowEmpty(it.n) ? it.n : null;
      // 原文有次方根：清空了就拿掉 [ ]；原文沒有（或是空的）：打了次方根才加上 [ ]
      if (g && g.length === 3) return n ? glued(g, [L(n), L(it.a)])! : cat(['\\sqrt', g[1].slice(1), L(it.a), g[2]]);
      if (g && g.length === 2) return n ? cat(['\\sqrt[', trimRow(n), ']{', L(it.a), g[1]]) : glued(g, [L(it.a)])!;
      return cat(['\\sqrt', n ? '[' + trimRow(n) + ']' : '', '{', trimRow(it.a), '}']);
    }
    case 'sup': case 'sub':
      return g && g.length === 2 ? scriptLatex(g[0], g[1], it.a) : cat([it.t === 'sup' ? '^{' : '_{', trimRow(it.a), '}']);
    case 'group': return glued(g, [L(it.a)]) ?? cat([it.cmd, '{', PLAIN_GROUPS.has(it.cmd) ? L(it.a) : trimRow(it.a), '}']);
    case 'brace': {
      const mark = H_BRACES[it.cmd];
      const label = rowEmpty(it.b) ? null : it.b;
      // 原文有標籤：清空了就拿掉 ^{…}；原文沒有（或是空的）：打了標籤才加上
      if (g && g.length === 3) return label ? cat([g[0], L(it.a), scriptLatex(g[1], g[2], label)]) : cat([g[0], L(it.a), '}']);
      if (g && g.length === 2) return label ? cat([g[0], L(it.a), '}' + mark + '{', trimRow(label), '}']) : glued(g, [L(it.a)])!;
      return cat([it.cmd, '{', trimRow(it.a), '}', label ? mark + '{' + trimRow(label) + '}' : '']);
    }
    case 'paren': return glued(g, [L(it.a)]) ?? cat(['\\left' + it.l, ' ', trimRow(it.a), ' ', '\\right' + it.r]);
    case 'braces': return cat(['{', L(it.a), '}']);
    case 'env': {
      // 原文的格子照原文（裡面的空白、換行都在）；按「＋列」「＋欄」加的格子照編輯器的寫法前後各空一格
      const w = it.w || [];
      const src = g && g.length === 2 ? g : null;
      const parts = [src ? src[0] : '\\begin{' + it.name + '}'];
      it.rows.forEach((r, i) => {
        if (i) parts.push(src ? '\\\\' : ' \\\\');
        r.forEach((cell, j) => {
          if (j) parts.push(src ? '&' : ' &');
          parts.push(src && i < w.length && j < w[i] ? L(cell) : ' ' + trimRow(cell) + (src ? ' ' : ''));
        });
      });
      parts.push(src ? src[1] : ' \\end{' + it.name + '}');
      return cat(parts);
    }
  }
}

// 整理：相鄰的文字合併；結構的前後與中間一定有文字格（才點得進去打字）
export function normalize(row: MathRow): MathRow {
  const out: MathRow = [];
  for (const it of row) {
    const last = out[out.length - 1];
    if (it.t === 'text') {
      if (!last || last.t !== 'text') out.push(it);
      // 原文照樣顯示的文字（raw）跟旁邊的文字合併後，整格都照原文顯示。
      // 其他的接起來時，\alpha 後面接字母要隔一個空白（見 cat）：拿掉兩者之間的結構、在 α 與 x 之間貼上字母時
      else { last.v = last.raw || it.raw ? last.v + it.v : cat([last.v, it.v]); if (it.raw) last.raw = true; }
      continue;
    }
    if (!last || last.t !== 'text') out.push({ t: 'text', v: '' });
    for (const k of ['a', 'b', 'n'] as const) if (Array.isArray(it[k])) it[k] = normalize(it[k]);
    if (it.rows) it.rows = it.rows.map(r => r.map(normalize));
    out.push(it);
  }
  if (!out.length || out[out.length - 1].t !== 'text') out.push({ t: 'text', v: '' });
  return out;
}

// 新插入的結構（功能區的按鈕、打 \frac 再按空白）照編輯器自己的寫法寫出去：拿掉讀範本時記下的原文（g）。
// 不拿掉的話，範本「\left( \right)」打了字會寫成 \left(x\right)，「^\circ」不會加上大括號
export function forgetSource(row: MathRow): MathRow {
  for (const it of row) {
    if (it.t === 'text') continue;
    delete it.g;
    if (it.t === 'env') delete it.w;
    for (const k of ['a', 'b', 'n'] as const) if (Array.isArray(it[k])) forgetSource(it[k]);
    if (it.rows) it.rows.forEach(r => r.forEach(forgetSource));
  }
  return row;
}

// 不認得的指令後面緊接的 {…}（\color{tan}、\mathsf{max}）多半是那個指令的參數（顏色的名稱、換字型的字）：
// 裡面打的 sin、tan、max 不自動換成 \sin、\tan、\max（\color{\tan} 是壞掉的 LaTeX）。
// 認得的指令（\alpha、\sin…）不接參數，後面的 {…} 是一般的群組，照樣轉換
export function isCommandArg(row: MathRow, it: MathItem): boolean {
  const prev = row[row.indexOf(it) - 1];
  if (it.t !== 'braces' || !prev || prev.t !== 'text') return false;
  const m = /(?:^|[^\\])(?:\\\\)*(\\[A-Za-z]+)\s*$/.exec(prev.v);
  return !!m && !CMD_TO_CHAR.has(m[1]) && !FUNC_SET.has(m[1].slice(1)) && !NO_ARG.has(m[1]);
}

// ---------------------------------------------------------------- 編輯元件
const MARK = '\u0001'; // 插入後游標要停的位置（暫時的記號）
// 字上面另外畫一個符號的結構（向量箭頭、上橫線、^、~、點，畫法見 accentMark）：符號要佔高度，
// 外面的分數線、根號才不會壓到它（見 CSS 的 .has-accent）
const ACCENTS = new Set(['\\vec', '\\overrightarrow', '\\bar', '\\overline', '\\hat', '\\tilde', '\\dot', '\\ddot']);
const isScript = (it: MathItem | undefined): it is ScriptItem => !!it && (it.t === 'sup' || it.t === 'sub');
// 空心字、花體的標記用基本平面（BMP）的字母符號：以前的 𝔹、𝒞 在補充平面，手機上常常沒有字型，縮小後也認不出來
const GROUP_LABEL: Record<string, string> = {
  '\\text': 'T', '\\mathrm': 'rm', '\\mathit': 'it', '\\mathcal': 'ℒ', '\\mathbb': 'ℍ', '\\boldsymbol': 'B',
  '\\textrm': 'T', '\\textbf': 'T', '\\textit': 'T', '\\texttt': 'T', '\\textsf': 'T', '\\textnormal': 'T', '\\mbox': 'T',
  '\\operatorname': 'op', '\\operatorname*': 'op', '\\label': '#',
};
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
// 一個文字格記著的段落（見 displaySegs）：base 是剛畫出來時的樣子，segs 隨打字更新；
// auto 為 false 時打的字不自動轉換函數名稱（不認得的指令的參數，見 isCommandArg）
interface Cell { segs: Seg[]; base: Seg[]; auto: boolean; }

// 一個結構項目的所有格子，依畫面上的順序
function slotsOf(it: MathItem): MathRow[] {
  if (it.t === 'text') return [];
  if (it.t === 'frac' || it.t === 'brace') return [it.a, it.b];
  if (it.t === 'sqrt') return it.n ? [it.n, it.a] : [it.a];
  if (it.t === 'env') return it.rows.flat();
  return [it.a];
}

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
function horizontalBrace(doc: Document, parent: HTMLElement, over: boolean): HTMLSpanElement {
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
  return box;
}
// 上括號的內容裡（最外層）剛好有一個下括號（或相反）時，裡面那個括號：\overbrace{\underbrace{x}_{k}}^{n}、
// \overbrace{a+\underbrace{x}_{k}+\frac{1}{2}}^{n} 這種寫法。前後的其他內容照樣排在同一列
function stackedBrace(it: BraceItem): BraceItem | null {
  const inner = it.a.filter((x): x is BraceItem => x.t === 'brace' && x.cmd !== it.cmd);
  return inner.length === 1 ? inner[0] : null;
}

export class MathField {
  declare host: HTMLElement;
  declare opts: MathFieldOptions;
  declare dom: HTMLDivElement;
  declare model: MathRow;
  declare active: MathSlot | null;
  declare byItem: Map<MathItem, HTMLElement>;
  declare owner: Map<MathRow, Owner>;
  // 每個文字格（DOM）記著的段落；literal 是裡面不自動轉換函數名稱的列。每次重畫重新建立
  declare cells: Map<HTMLElement, Cell>;
  declare literal: Set<MathRow>;
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
    this.cells = new Map();
    this.literal = new Set();
    this.dom.appendChild(this.renderRow(this.model));
    if (focusItem && this.byItem.get(focusItem)) this.place(this.byItem.get(focusItem)!, 0);
  }

  // 一列的畫面。上下標另外排：只改畫面的結構，模型與 DOM 裡格子的順序（游標移動的順序）都不變。
  // from、to：只畫這一列的一段（疊在一起的上下括號，裡面那個括號前後的內容分開排，見 renderItem）
  renderRow(row: MathRow, plain?: boolean, from = 0, to = row.length): HTMLSpanElement {
    const box = el('span', 'wm-mv-row');
    let i = from;
    while (i < to) {
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
      if (i + 2 < to && mid && mid.t === 'text' && !mid.v && isScript(other) && other.t !== it.t) {
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

  renderText(row: MathRow, index: number, inPlain?: boolean): HTMLSpanElement {
    const it = row[index] as TextItem; // renderRow 只對文字項目呼叫這裡
    // 照原文顯示、原文存回的格子：文字類指令的內容，以及整段看不懂的 LaTeX
    const plain = inPlain || !!it.raw;
    const span = el('span', 'wm-mv-text');
    span.contentEditable = 'true';
    span.spellcheck = false;
    if (plain) span.dataset.plain = '1';
    // 照原文顯示的格子不用段落：畫面上的字就是原文
    const segs = plain ? [] : displaySegs(it.v);
    this.cells.set(span, { segs, base: segs, auto: !this.literal.has(row) });
    span.textContent = plain ? it.v : segShown(segs);
    // 整列只有這一格而且是空的：顯示成虛線方框，提示可以輸入
    if (row.length === 1 && !it.v) span.classList.add('is-slot');
    this.byItem.set(it, span);
    // 記住目前在哪一格（按上方的按鈕時要插在這裡）
    const here = () => { this.active = { row, index, span }; };
    span.addEventListener('focus', here);
    span.addEventListener('mousedown', here);
    span.addEventListener('keyup', here);
    span.addEventListener('input', () => {
      // 打字時混進來的換行拿掉（螢幕鍵盤的 Enter 攔不到）。原本就有換行的格子（分成好幾行寫的 LaTeX）不能拿：
      // 換行是指令與後面文字之間唯一的分隔時（\implies⏎b），拿掉就接成不存在的指令 \impliesb
      const raw = it.v.includes('\n') ? span.textContent : span.textContent.replace(/\n/g, '');
      if (!plain && (this.typedCommand(row, index, span, raw) || this.typedScript(row, index, span, raw))) return;
      // 只有改到的地方從畫面上的字轉換，其他地方照原文（\leq 還是 \leq、原本的 max 不會變成 \max）
      it.v = plain ? raw : this.retype(span, raw);
      span.classList.toggle('is-slot', row.length === 1 && !it.v);
      // 在向量、~ 這類符號下面打字：打字不會重畫，這裡重新判斷符號要不要放低
      const accent = span.closest('.wm-mv-group.has-accent');
      const inner = accent && accent.querySelector(':scope > .wm-mv-inner');
      if (accent && inner) accent.classList.toggle('is-low', LOW_TEXT.test(inner.textContent || ''));
      this.changed('type');
    });
    span.addEventListener('paste', e => {
      e.preventDefault();
      const tx = ((e.clipboardData && e.clipboardData.getData('text/plain')) || '').replace(/\r?\n/g, ' ');
      // 貼上的是使用者自己的寫法，照原文保留（x^2 不加大括號，不像功能區的按鈕）；
      // 照原文顯示的格子（\text{…}、看不懂的 LaTeX）貼上的就是文字，不拆成結構
      const items = plain ? [{ t: 'text', v: tx } as TextItem] : parseLatex(tx).filter(x => !(x.t === 'text' && !x.v));
      if (tx) this.insertItems(items, row, index, span);
    });
    span.addEventListener('keydown', e => this.onKey(e, row, index, span));
    return span;
  }

  // row：這個項目所在的列（記下每個格子屬於哪個項目，Backspace 往外刪的時候用）
  renderItem(it: MathItem, row: MathRow): HTMLSpanElement {
    // own：這一格屬於哪個結構（預設是 it；疊在一起的上下括號，裡面那個括號的格子屬於裡面的括號）
    const slot = (cls: string, inner: MathRow, parent: HTMLElement | null, plain?: boolean, own: Owner = { item: it, row }): HTMLSpanElement => {
      const s = el('span', cls, parent);
      this.owner.set(inner, own);
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
    if (it.t === 'brace' && stackedBrace(it)) {
      // 上下括號疊在一起：兩個括號、兩個標籤、內容都排在同一個格線裡（CSS 的 .wm-mv-hbrace.is-stack），
      // 兩個括號都貼著內容，跟 MathJax 畫出來的一樣。照一般的排法，裡面的括號為了讓內容置中，
      // 在另一邊留了跟標籤加括號一樣高的空白，外面的括號會被這段空白推開，離內容很遠。
      // 裡面那個括號前後的內容（lead、trail）各自排成一段，放在內容的左右兩邊，外面的括號連它們一起包住。
      // 只改畫面：格子的順序跟模型一樣（前面的內容、裡面的括號的內容與標籤、後面的內容、外面的標籤）
      const inner = stackedBrace(it)!;
      const at = it.a.indexOf(inner);
      const over = it.cmd === '\\overbrace';
      const doc = this.host.ownerDocument;
      const f = el('span', 'wm-mv-hbrace is-stack ' + (over ? 'is-inner-under' : 'is-inner-over'));
      const innerOwn: Owner = { item: inner, row: it.a };
      this.owner.set(it.a, { item: it, row });
      // normalize 之後結構前後一定有文字格，所以兩段都至少有一格
      f.appendChild(this.renderRow(it.a, false, 0, at)).classList.add('wm-mv-hb-edge', 'is-lead');
      // 裡面的括號畫在它的內容旁邊（前後有比較高的內容時，括號一樣貼著自己的內容）
      const body = slot('wm-mv-hb-body', inner.a, f, false, innerOwn);
      horizontalBrace(doc, body, !over).classList.add(over ? 'is-under' : 'is-over');
      slot('wm-mv-hb-label ' + (over ? 'is-under' : 'is-over'), inner.b, f, false, innerOwn);
      f.appendChild(this.renderRow(it.a, false, at + 1)).classList.add('wm-mv-hb-edge', 'is-trail');
      slot('wm-mv-hb-label is-outer ' + (over ? 'is-over' : 'is-under'), it.b, f);
      horizontalBrace(doc, f, over).classList.add('is-outer', over ? 'is-over' : 'is-under');
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
    if (it.t === 'braces') {
      if (isCommandArg(row, it)) this.literal.add(it.a);
      return slot('wm-mv-braces', it.a, null);
    }
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
    const from = c.start - m[0].length;
    const before = raw.slice(0, from);
    if (TYPED_STRUCTS[cmd]) {
      it.v = this.swapTyped(span, raw, from, c.start, []);
      this.place(span, before.length);
      this.insertItems(forgetSource(parseLatex(TYPED_STRUCTS[cmd])).filter(x => !(x.t === 'text' && !x.v)), row, index, span);
      return true;
    }
    if (CMD_TO_CHAR.has(cmd) || FUNC_SET.has(m[1])) {
      // 符號顯示成符號；函數名稱拿掉反斜線、後面留一個空白。函數名稱前面緊接字母時照原文顯示（n\log，見 displaySegs）。
      // 記著打的寫法：打 \leq 就是 \leq，不會因為 ≤ 預設寫成 \le 而被換掉
      const symbol = CMD_TO_CHAR.get(cmd);
      const put: Seg[] = symbol ? [{ src: cmd, shown: symbol }]
        : [{ src: cmd, shown: /[A-Za-z\\]$/.test(before) ? cmd : m[1] }, { src: ' ', shown: ' ' }];
      it.v = this.swapTyped(span, raw, from, c.start, put);
      span.classList.remove('is-slot');
      this.place(span, before.length + segShown(put).length);
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
    it.v = this.swapTyped(span, raw, c.start - 1, c.start, []);
    this.place(span, c.start - 1);
    this.insertItems([{ t: ch === '^' ? 'sup' : 'sub', a: [{ t: 'text', v: '' }] }], row, index, span);
    return true;
  }

  // 格子裡的字變成 text 之後：更新這一格記著的段落，回傳新的原文（見 editSegs）
  retype(span: HTMLElement, text: string): string {
    const cell = this.cells.get(span);
    if (!cell) return fromDisplay(text);
    cell.segs = editSegs(cell.segs, text, cell.auto, cell.base, this.caret(span).end);
    return segSrc(cell.segs);
  }

  // 剛打進來的字（raw）先照打的樣子記進段落、不轉換，再把畫面上第 from 到第 to 個字換成 put；
  // 畫面上的字也一起換好，回傳這一格新的原文
  swapTyped(span: HTMLElement, raw: string, from: number, to: number, put: Seg[]): string {
    const cell = this.cells.get(span);
    const typed = cell ? editSegs(cell.segs, raw, false, cell.segs, this.caret(span).end) : displaySegs(raw);
    const segs = spliceSegs(typed, from, to, put);
    if (cell) cell.segs = segs;
    span.textContent = segShown(segs);
    return segSrc(segs);
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
    // 打 ^ 或 _：直接開一個上標／下標的格子。文字的格子（\text{…}、\tag{…}）裡是一般的字，照樣打進去
    if ((e.key === '^' || e.key === '_') && !mod && !e.altKey && !span.dataset.plain) {
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
        if (i >= 0) {
          // 拿掉記號後前後接起來（\alpha 與 x 之間要隔一個空白，見 cat）；照原文顯示的格子照原樣接
          const head = x.v.slice(0, i), rest = x.v.slice(i + MARK.length);
          x.v = x.raw ? head + rest : cat([head, rest]);
          target = x; offset = x.v.length - rest.length;
        }
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

  // 在目前的游標處插入一段 LaTeX（按上方的結構或符號按鈕）。插入的結構照編輯器自己的寫法（x^{…}，見 forgetSource）
  insert(latex: string): void {
    const items = forgetSource(parseLatex(latex)).filter(it => !(it.t === 'text' && !it.v));
    if (!items.length) return;
    let a = this.active;
    if (!a || !this.dom.contains(a.span)) { const spans = this.spans(); const span = spans[spans.length - 1]; a = this.active = this.findActive(span); }
    if (!a) return;
    // 游標在文字的格子裡（\text{…}、\tag{…}）：裡面是一般的文字，放進去的 \frac、\alpha 不會畫成數學
    // （以前變成 \text{a\frac{}{}b}），所以插在那個文字結構的後面；游標在最前面時插在前面
    const own = this.owner.get(a.row);
    if (a.span.dataset.plain && own && own.item.t === 'group' && PLAIN_GROUPS.has(own.item.cmd)) {
      const at = own.row.indexOf(own.item);
      const front = this.caret(a.span).end === 0 && !!a.span.textContent;
      const next = own.row[front ? at - 1 : at + 1]; // normalize 之後結構前後一定是文字格
      const sp = next && this.byItem.get(next);
      if (sp) {
        this.place(sp, front ? sp.textContent.length : 0);
        this.insertItems(items, own.row, own.row.indexOf(next), sp);
        return;
      }
    }
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
    // 格子在游標處切成前後兩段：每一段用記著的段落取原文（\leq 還是 \leq、原本的 max 還是 max）。
    // 照原文顯示的格子，畫面上的字就是原文
    const cell = span.dataset.plain ? undefined : this.cells.get(span);
    if (cell && segShown(cell.segs) !== shown) cell.segs = editSegs(cell.segs, shown, cell.auto, cell.base);
    const part = (a: number, b: number): string => (cell ? segSrc(sliceSegs(cell.segs, a, b)) : shown.slice(a, b));
    const before = part(0, c.start);
    const selected = part(c.start, c.end);
    const after = part(c.end, shown.length);
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
    const head: TextItem = { t: 'text', v: before };
    // 照原文顯示的格子（整段看不懂的 LaTeX）拆成前後兩段之後，兩段都還是照原文顯示
    if ((row[index] as TextItem).raw) { if (before) head.raw = true; if (after) tail.raw = true; }
    row.splice(index, 1, head, ...fresh, tail);
    this.settle(row);
  }
}
