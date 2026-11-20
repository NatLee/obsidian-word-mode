// 方程式視覺化編輯：LaTeX ⇄ 結構的轉換測試（編輯元件的操作測試在 tests/view/features.mjs）
import { parseLatex, toLatex, toDisplay, fromDisplay, displaySegs, editSegs, segSrc, isCommandArg, forgetSource } from '../src/mathvisual.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + label + '  ' + extra); } else console.log('PASS ' + label); };
const rt = s => toLatex(parseLatex(s));
const kinds = s => parseLatex(s).map(x => x.t).join(',');

// 結構完整的寫法：解析後再輸出要一模一樣
for (const s of [
  '\\frac{a}{b}', '\\dfrac{1}{2}', '\\sqrt{x}', '\\sqrt[3]{x+1}', 'x^{2}', 'a_{i}', 'x_{i}^{2}',
  '\\sum_{i=1}^{n} i', '\\int_{a}^{b} f(x) dx', '\\vec{v}', '\\mathbf{A}', '\\text{if } x > 0',
  '\\left( \\frac{a}{b} \\right)', '\\left\\{ x \\right\\}', '\\left| x \\right|', '\\left\\langle a \\right\\rangle',
  '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
  '\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}',
  '\\frac{\\partial f}{\\partial x}', '\\binom{n}{k}', 'e^{i\\pi} + 1 = 0', '\\alpha + \\beta', '{a}b',
  '\\lim_{x \\to \\infty} \\frac{1}{x}', 'a \\rightarrow b', '\\mathbb{R}^{n}', '\\overline{AB}', '\\{1, 2\\}',
  '\\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}',
]) ok('往返：' + s, rt(s) === s, rt(s));

// 沒有大括號的簡寫照原文寫回去（以前補上大括號：x^2 → x^{2}）；^ 後面的空白、換行也照原文
// （以前 x^ 後面換行，換行被當成上標，寫回去變成 x^{⏎}2，2 掉到上標外面）
for (const s of ['x^2', 'E = mc^2', 'x_i^2', 'x^\\alpha', 'x^ 2', 'x^\n2', 'x^𝔹']) ok('簡寫照原文：' + JSON.stringify(s), rt(s) === s, rt(s));
ok('x^\\n2 的上標是 2', kinds('x^\n2') === 'text,sup,text' && toLatex(parseLatex('x^\n2')[1].a) === '2');
// 新插入的結構（功能區的按鈕，見 forgetSource）照編輯器自己的寫法：上下標加大括號、\left( … \right) 裡外各空一格
const generated = s => toLatex(forgetSource(parseLatex(s)));
ok('新插入的結構照編輯器的寫法', generated('x^2') === 'x^{2}' && generated('^\\circ') === '^{\\circ}' && generated('\\left(x\\right)') === '\\left( x \\right)'
  && generated('\\begin{pmatrix}1&0\\end{pmatrix}') === '\\begin{pmatrix} 1 & 0 \\end{pmatrix}' && generated('\\frac {a} {b}') === '\\frac{a}{b}', generated('\\left(x\\right)'));
// 補充平面的字當上標：以前只拿到半個字，寫回去變成拆開的亂碼
ok('x^𝔹 的上標是整個字', parseLatex('x^𝔹')[1].a[0].v === '𝔹', JSON.stringify(parseLatex('x^𝔹')[1].a));

// 看不懂的寫法：整段保留
for (const s of ['\\frac{a}{', 'a}b', '\\left( x', '\\begin{foo} a \\end{foo}', '\\begin{bmatrix} a & b', '\\frac a b']) {
  ok('看不懂就原樣保留：' + s, rt(s) === s && kinds(s) === 'text', rt(s) + ' / ' + kinds(s));
}
ok('空白', rt('') === '' && kinds('') === 'text');

// 結構
ok('分數的結構', kinds('\\frac{a}{b}') === 'text,frac,text');
ok('上下標各自一格', kinds('x_{i}^{2}') === 'text,sub,text,sup,text', kinds('x_{i}^{2}'));
const mat = parseLatex('\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}')[1];
ok('矩陣 2×2', mat.t === 'env' && mat.name === 'bmatrix' && mat.rows.length === 2 && mat.rows[0].length === 2 && toLatex(mat.rows[1][0]).trim() === 'c');
ok('矩陣結尾多的 \\\\ 不會多出一列', parseLatex('\\begin{pmatrix} a \\\\ b \\\\ \\end{pmatrix}')[1].rows.length === 2);
ok('\\rightarrow 不會被當成 \\right', kinds('a \\rightarrow b') === 'text');

// 上括號、下括號：內容與標籤是同一個結構的兩格（以前 \overbrace 被當成文字，標籤變成上標）
for (const s of ['\\overbrace{a+b}^{n}', '\\underbrace{1+\\cdots+1}_{k}', '\\overbrace{x}', 'x + \\overbrace{a} b', '\\frac{\\overbrace{x}^{2}}{y}']) ok('往返：' + s, rt(s) === s, rt(s));
const ob = parseLatex('\\overbrace{a+b}^{n}')[1];
ok('上括號的結構：a 是內容、b 是標籤', kinds('\\overbrace{a+b}^{n}') === 'text,brace,text' && ob.t === 'brace' && toLatex(ob.a) === 'a+b' && toLatex(ob.b) === 'n', kinds('\\overbrace{a+b}^{n}'));
ok('標籤的簡寫照原文：\\overbrace{a}^n', rt('\\overbrace{a}^n') === '\\overbrace{a}^n' && rt('\\underbrace{a} _\\alpha') === '\\underbrace{a} _\\alpha' && toLatex(parseLatex('\\underbrace{a} _\\alpha')[1].b) === '\\alpha', rt('\\underbrace{a} _\\alpha'));
ok('上括號後面的 _ 不是標籤，是一般的下標', kinds('\\overbrace{a}_{b}') === 'text,brace,text,sub,text' && rt('\\overbrace{a}_{b}') === '\\overbrace{a}_{b}', kinds('\\overbrace{a}_{b}'));
// 沒有標籤：標籤格是空的，輸出時不加 ^{}。原文寫了空的標籤（^{}）就照原文
ok('沒有標籤：標籤格是空的，輸出時不加 ^{}', rt('\\overbrace{a}') === '\\overbrace{a}' && parseLatex('\\overbrace{a}')[1].b.length === 1
  && rt('\\overbrace{a}^{}') === '\\overbrace{a}^{}' && generated('\\overbrace{a}^{}') === '\\overbrace{a}', rt('\\overbrace{a}^{}'));
ok('沒有 { } 的寫法看不懂，照原文', kinds('\\overbrace x') === 'text' && rt('\\overbrace x') === '\\overbrace x');

// 編號：\tag{…} 與不加括號的 \tag*{…} 是一格（以前格子裡照原文顯示「\tag」）
for (const s of ['E = mc^{2} \\tag{1}', 'a \\tag*{A.1}', '\\tag{1.2}']) ok('往返：' + s, rt(s) === s, rt(s));
const tag = parseLatex('E \\tag{1}')[1], tagStar = parseLatex('\\tag*{x}')[1];
ok('編號的結構', tag.t === 'group' && tag.cmd === '\\tag' && toLatex(tag.a) === '1' && tagStar.t === 'group' && tagStar.cmd === '\\tag*', JSON.stringify([tag.cmd, tagStar.cmd]));

// 符號顯示
ok('顯示：\\alpha + \\beta → α + β', toDisplay('\\alpha + \\beta') === 'α + β', toDisplay('\\alpha + \\beta'));
ok('顯示：\\alpha x → αx（隔開字母的空白不顯示）', toDisplay('\\alpha x') === 'αx', toDisplay('\\alpha x'));
ok('顯示：\\sin x → sin x', toDisplay('\\sin x') === 'sin x', toDisplay('\\sin x'));
ok('顯示：不認得的指令照原樣', toDisplay('\\foo x') === '\\foo x');
ok('顯示：\\mathbb{R} → ℝ', toDisplay('x \\in \\mathbb{R}') === 'x ∈ ℝ', toDisplay('x \\in \\mathbb{R}'));
ok('輸入：α+β → \\alpha+\\beta', fromDisplay('α+β') === '\\alpha+\\beta', fromDisplay('α+β'));
ok('輸入：αx → \\alpha x（補空白）', fromDisplay('αx') === '\\alpha x', fromDisplay('αx'));
ok('輸入：sin x → \\sin x', fromDisplay('sin x') === '\\sin x' && fromDisplay('2sin(x)') === '2\\sin(x)', fromDisplay('2sin(x)'));
ok('輸入：sinx、cosine 不轉換', fromDisplay('sinx') === 'sinx' && fromDisplay('cosine') === 'cosine');
ok('輸入：已經有反斜線的不重複', fromDisplay('\\sin x') === '\\sin x');
// 間距指令：以前照原文顯示「\,」
ok('顯示：\\, 變成細空白，不是「\\,」', toDisplay('f(x)\\,dx') === 'f(x)\u2009dx', JSON.stringify(toDisplay('f(x)\\,dx')));
ok('顯示：\\: \\; \\quad \\qquad 變成空白', toDisplay('a\\:b\\;c\\quad d\\qquad e') === 'a\u205Fb\u2004c\u2003d\u2003\u2003e', JSON.stringify(toDisplay('a\\:b\\;c\\quad d\\qquad e')));
ok('輸入：細空白轉回 \\,，後面不多補空白', fromDisplay('f(x)\u2009dx') === 'f(x)\\,dx', fromDisplay('f(x)\u2009dx'));
ok('輸入：\\quad 後面接字母要補空白', fromDisplay('a\u2003b') === 'a\\quad b', fromDisplay('a\u2003b'));
for (const s of ['\\alpha x', '\\sin x', 'a \\le b', '\\sum', '\\infty', 'x \\to 0', '\\foo x', '\\int f(x)\\,dx', 'a\\quad b', 'x\\;y']) {
  const back = fromDisplay(toDisplay(s));
  ok('顯示再轉回 LaTeX 意思相同：' + s, back.replace(/ /g, '') === s.replace(/ /g, ''), back);
}


// ---- 沒有改到的內容要原樣回來
// 使用者在格子裡改一個字，整格都會「顯示 → 再轉回 LaTeX」；整個方程式也會從格子重新寫出來。
// 這兩條路只要有一條轉不回來，沒改到的地方就被改掉了。

// 函數名稱前面緊接字母或另一個指令：以前反斜線不見了（nlog n、sincos x、\argmax）
for (const s of ['n\\log n', '\\sin\\cos x', '\\arg\\max', 'O(n\\log n)', '\\alpha\\sin x', '2\\pi\\cos\\theta', 'x\\max y']) {
  ok('顯示再轉回，反斜線還在：' + s, fromDisplay(toDisplay(s)) === s, JSON.stringify(toDisplay(s)) + ' → ' + fromDisplay(toDisplay(s)));
}
ok('緊接字母的函數名稱照原文顯示', toDisplay('n\\log n') === 'n\\log n' && toDisplay('\\sin\\cos x') === 'sin\\cos x', toDisplay('\\sin\\cos x'));
ok('換行後面的字不會被看成指令：\\\\sin', toDisplay('a \\\\sin x') === 'a \\\\sin x' && fromDisplay(toDisplay('a \\\\\\sin x')) === 'a \\\\\\sin x', toDisplay('a \\\\sin x'));

// 上下標是「指令加它的參數」：以前指令跟參數被拆開（A^{\mathrm}{T}），是壞掉的 LaTeX。
// 原文照原文寫回去；當成新插入的結構時加上大括號，大括號裡正好是整個指令加參數
for (const [s, want] of [
  ['A^\\mathrm{T}', 'A^{\\mathrm{T}}'], ['x_\\text{max}', 'x_{\\text{max}}'], ['e^\\frac{1}{2}', 'e^{\\frac{1}{2}}'],
  ['x^\\sqrt{2}', 'x^{\\sqrt{2}}'], ['a_\\mathbf{k}^\\mathrm{T}', 'a_{\\mathbf{k}}^{\\mathrm{T}}'], ['x_\\mathbb{R}', 'x_{\\mathbb{R}}'],
  ['A^\\top B', 'A^{\\top} B'], ['f^\\prime(x)', 'f^{\\prime}(x)'], ['x^\\,y', 'x^{\\,}y'],
]) ok('上下標裡的指令：' + s, rt(s) === s && rt(want) === want && generated(s) === want, rt(s) + ' / ' + generated(s));
const supT = parseLatex('A^\\mathrm{T}')[1];
ok('上標裡是一個完整的結構', supT.t === 'sup' && supT.a[1]?.t === 'group' && supT.a[1].cmd === '\\mathrm' && toLatex(supT.a[1].a) === 'T', JSON.stringify(supT));
// 不知道要不要參數的指令、少了大括號的寫法：猜錯會把內容搬進或搬出上標，所以整段原樣保留
for (const s of ['x^\\mathsf{T}', 'x^\\frac12', 'x^\\left( a \\right)', 'x^\\foo {a}', 'x^^2', 'x^\\\\ y']) {
  ok('上下標看不懂就原樣保留：' + s, rt(s) === s && kinds(s) === 'text', rt(s) + ' / ' + kinds(s));
}

// 文字類指令的大括號裡是一般文字：底線不是下標（以前變成 \text{learning_{r}ate}）
for (const s of [
  '\\text{learning_rate}', '\\tag{eq_1}', '\\label{eq:loss_fn}', '\\operatorname{arg\\,max}_{x} f(x)', '\\operatorname*{arg\\,min}_{\\theta} L',
  '\\mathrm{H_2O}', '\\mathrm{ d }x', '\\textbf{a_b^c}', '\\text{50\\% of {x} & y}', '\\mathit{max_iter}', '\\mbox{if $x_1 > 0$}',
  'f(x) = \\begin{cases} 1 & \\text{if } x > 0 \\\\ 0 & \\text{other_wise} \\end{cases}',
]) ok('文字原樣保留：' + s, rt(s) === s, rt(s));
const txt = parseLatex('\\text{learning_rate}')[1];
ok('文字是一格，裡面沒有下標', txt.t === 'group' && txt.a.length === 1 && txt.a[0].t === 'text' && txt.a[0].v === 'learning_rate', JSON.stringify(txt));
ok('\\operatorname*：星號算在指令裡', parseLatex('\\operatorname*{argmax}')[1].cmd === '\\operatorname*');

// 寫回去會壞掉的寫法不拆成格子：註解（接成一行後，後面全部被註解掉）、換列的參數（變成下一列的文字）
for (const s of ['a % 註解\n+ b', '\\begin{aligned} a &= b % 註解\n\\\\ c &= d \\end{aligned}', '\\begin{cases} a \\\\[1ex] b \\end{cases}', '\\begin{matrix} a \\\\* b \\end{matrix}']) {
  ok('不拆成格子，原樣保留：' + JSON.stringify(s), rt(s) === s && kinds(s) === 'text', rt(s));
}
ok('\\% 不是註解', kinds('\\frac{1}{2} = 50\\%') === 'text,frac,text' && rt('\\frac{1}{2} = 50\\%') === '\\frac{1}{2} = 50\\%');
ok('整段看不懂的 LaTeX 標成照原文顯示（不轉換符號）', parseLatex('\\frac{a}{')[0].raw === true && !parseLatex('x + 1')[0].raw && !parseLatex('')[0].raw);
ok('格子結尾的「\\ 」不會吃掉後面的大括號', rt('\\frac{a\\ }{b}') === '\\frac{a\\ }{b}' && rt('x^{a\\ }') === 'x^{a\\ }', rt('\\frac{a\\ }{b}'));

// 實際會出現的公式：讀成格子再寫出來、顯示再轉回，都要一字不差。
// 做不到一字不差的寫法寫成 [原文, 整理後的結果]：結果的意思要跟原文一樣，而且再讀一次不會再變。
// 以前簡寫（x^2）、\left 與矩陣裡的空白、分成好幾行的環境都會被整理；現在都照原文，沒有這種寫法了
const REAL = [
  'E = mc^{2}', '\\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}', 'e^{i\\pi} + 1 = 0', '\\frac{1}{1 + \\frac{1}{1 + \\frac{1}{x}}}',
  '\\sum_{i=1}^{n} i^{2} = \\frac{n(n+1)(2n+1)}{6}', '\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', '\\min_{x} \\max_{y} f(x, y)', 'T(n) = 2T(n/2) + O(n\\log n)',
  '\\hat{y} = \\bar{x} + \\vec{v} \\cdot \\tilde{w}', '\\dot{x} + \\ddot{y} = \\overline{AB} + \\overrightarrow{CD}', '\\hat{\\mathbf{n}} \\times \\boldsymbol{\\omega}',
  '\\left( \\frac{a}{b} \\right)^{2}', '\\left. \\frac{df}{dx} \\right|_{x=0}', '\\left\\{ x \\in \\mathbb{R} \\mid x > 0 \\right\\}', '\\left\\langle \\psi \\middle| \\phi \\right\\rangle',
  '\\left[ \\frac{1}{2}, \\left( a + \\frac{b}{c} \\right) \\right]',
  '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', '\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix} \\begin{pmatrix} x \\\\ y \\end{pmatrix}',
  '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc', 'A = \\begin{bmatrix} \\frac{1}{2} & x^{2} \\\\ \\sqrt{y} & \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} \\end{bmatrix}',
  '\\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}', 'f(x) = \\begin{cases} 1 & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}',
  '\\mathcal{L}(\\theta) = -\\frac{1}{N}\\sum_{i=1}^{N} y_{i} \\log \\hat{y}_{i}', '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_{0}}',
  '\\mathbb{E}[X] = \\sum_{x} x\\,p(x)', 'P(A \\mid B) = \\frac{P(B \\mid A)P(A)}{P(B)}', '\\binom{n}{k} = \\frac{n!}{k!(n-k)!}',
  '\\overbrace{a+b}^{n} + \\underbrace{c}_{\\text{k items}}', '\\sqrt[3]{x^{2} + 1}', 'x\'\' + \\omega^{2} x = 0', '\\boxed{E = mc^{2}}', '\\color{red}{x} + \\textcolor{blue}{y}',
  '\\theta_{t+1} = \\theta_{t} - \\eta \\nabla_{\\theta} \\text{loss_fn}(\\theta_{t}) \\tag{eq_1}', 'W^{\\mathrm{T}} x + b', '\\operatorname{softmax}(z)_{i} = \\frac{e^{z_{i}}}{\\sum_{j} e^{z_{j}}}',
  'a \\le b \\ge c \\ne d \\approx e', 'A \\to B \\Rightarrow C', '\\forall x \\in A, \\exists y \\notin B', 'a\\quad b \\; c\\,d', '\\{1, 2\\} \\cup \\emptyset',
  '\\sum\\limits_{i} a_{i}', '\\arg\\max_{x} f(x)', '\\sin^{2} x + \\cos^{2} x = 1', '\\frac{\\partial^{2} f}{\\partial x^{2}}',
  // 以前只能整理成另一種寫法的：簡寫、\left 與環境裡的空白、分成好幾行的環境、指令與大括號之間的空白
  'x^2 + y_i', '\\int_0^\\infty f', 'A^\\mathrm{T} + e^\\frac{1}{2}', '\\left(\\frac{a}{b}\\right)^2', '\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}',
  '\\begin{aligned}\n  a &= b + c \\\\\n    &= d\n\\end{aligned}', '\\begin{array}{cc} a & b \\\\ c & d \\end{array}',
  '\\frac {a} {b} + \\sqrt {x}', '\\overbrace{a}^n',
  '\\begin{cases}\n  x, & x \\ge 0 \\\\\n  -x, & x < 0\n\\end{cases}', '\\begin{pmatrix} a \\\\ b \\\\ \\end{pmatrix}', '\\sqrt[]{x} + \\overbrace{a}^{}',
];
// 畫面上看不出差別、只靠格子記著原文才留得住的寫法：同一個符號的另一種寫法、直接打的符號、
// 剛好是函數名稱的字、不認得的指令的參數。整段當成新打的字轉換（fromDisplay）會換成編輯器偏好的寫法，所以不在 REAL 裡
const SPELLING = ['a \\leq b \\geq c \\neq d \\qquad e', 'A \\rightarrow B', 'α ≤ β + \\alpha', 'x_{max} + sin x', '\\color{tan}{x} + \\mathsf{max}'];
// 去掉空白與大括號之後的指令與文字：整理前後應該一樣（沒有少掉、多出或調換任何東西）
const flat = s => (s.match(/\\[A-Za-z]+|\\[^A-Za-z]|[^\s{}]/g) || []).join(' ');
for (const item of [...REAL, ...SPELLING]) {
  const [s, want] = Array.isArray(item) ? item : [item, item];
  const out = rt(s);
  ok('格子往返：' + JSON.stringify(s), out === want && rt(out) === out && flat(out) === flat(s), out);
}
// 整段顯示再當成新打的字轉回（fromDisplay）：一字不差。例外是同一個符號的兩種寫法（\leq 與 \le、\qquad 與 \quad\quad），
// 新打的字轉成其中一種，再轉一次不會再變。編輯器改格子時不走這條路：沒改到的地方照記著的原文（見後面「改一格」的測試）
for (const item of REAL) {
  const s = Array.isArray(item) ? item[0] : item;
  ok('顯示往返：' + JSON.stringify(s), fromDisplay(toDisplay(s)) === s, fromDisplay(toDisplay(s)));
}
for (const [s, want] of [['a \\leq b \\geq c \\neq d', 'a \\le b \\ge c \\ne d'], ['A \\rightarrow B', 'A \\to B'], ['a\\qquad b', 'a\\quad\\quad b']]) {
  const back = fromDisplay(toDisplay(s));
  ok('顯示往返（同一個符號的另一種寫法）：' + s, back === want && fromDisplay(toDisplay(back)) === back, back);
}
// 每一格文字各自轉換：把公式拆成格子，每一格（文字類的格子除外，它們不轉換）顯示再轉回都要一樣
const cells = (row, plain, out = []) => {
  for (const it of row) {
    if (it.t === 'text') { if (!plain && !it.raw) out.push(it.v); continue; }
    const inner = it.t === 'group' && ['\\text', '\\mathrm', '\\tag', '\\operatorname', '\\label', '\\mbox', '\\textbf', '\\mathit'].includes(it.cmd.replace('*', ''));
    for (const k of ['a', 'b', 'n']) if (Array.isArray(it[k])) cells(it[k], inner, out);
    if (it.rows) it.rows.forEach(r => r.forEach(c => cells(c, false, out)));
  }
  return out;
};
{
  const bad = [];
  for (const item of REAL) for (const v of cells(parseLatex(Array.isArray(item) ? item[0] : item))) if (fromDisplay(toDisplay(v)) !== v) bad.push(v);
  ok('每一格文字顯示再轉回都一樣', !bad.length, JSON.stringify(bad));
}

// ---- 改一格，其他地方一字不動
// 以前在格子裡改一個字，整個方程式都換成編輯器自己的寫法：x^2 → x^{2}、\leq → \le、α → \alpha、max → \max、
// \left(x\right) → \left( x \right)、分成好幾行的矩陣接成一行。現在沒改到的格子照原文，改到的格子裡也只有改到的地方會變。

// 照介面的做法改一格：從那一格記著的段落改（MathField 的 retype），游標停在改過的地方的結尾
const typeInCell = (v, text, caret = text.length, auto = true) => segSrc(editSegs(displaySegs(v), text, auto, undefined, caret));
const PLAIN = ['\\text', '\\textrm', '\\textbf', '\\textit', '\\texttt', '\\textsf', '\\textnormal', '\\mbox', '\\mathrm', '\\mathit', '\\operatorname', '\\operatorname*', '\\tag', '\\tag*', '\\label'];
// 所有的文字格，依畫面上的順序。plain：照原文顯示的格子（文字類指令的內容、看不懂的整段），打的字就是原文；
// auto：會不會自動把 sin 換成 \sin（不認得的指令的參數不會，見 isCommandArg）；
// unit：直接放在沒有大括號的上下標裡的格子（x^\mathrm{T} 的前後），內容變成好幾個字時要加大括號，會變的範圍是整個上下標的內容
const textCells = (row, plain = false, auto = true, unit = null, out = []) => {
  for (const it of row) {
    if (it.t === 'text') { out.push({ it, plain: plain || !!it.raw, auto, unit }); continue; }
    const bare = (it.t === 'sup' || it.t === 'sub') && it.g && !it.g[0].endsWith('{') ? it.a
      : it.t === 'brace' && it.g && it.g.length === 3 && !it.g[1].endsWith('{') ? it.b : null;
    const inPlain = it.t === 'group' && PLAIN.includes(it.cmd);
    const inAuto = !(it.t === 'braces' && isCommandArg(row, it));
    for (const k of ['n', 'a', 'b']) if (Array.isArray(it[k])) textCells(it[k], inPlain, inAuto, it[k] === bare ? it[k] : null, out);
    if (it.rows) it.rows.forEach(r => r.forEach(c => textCells(c, false, true, null, out)));
  }
  return out;
};
// 讀進來、照介面的做法改其中一格，再寫回去。pick：第幾格（負的從後面數）或挑格子的條件；
// fn 把畫面上的字改成新的字（可以回傳 [新的字, 游標位置]）
const change = (src, pick, fn) => {
  const m = parseLatex(src);
  const all = textCells(m);
  const c = typeof pick === 'number' ? all[pick < 0 ? all.length + pick : pick] : all.find(x => pick(x.it.v));
  if (!c) return 'NO CELL';
  const r = fn(c.plain ? c.it.v : toDisplay(c.it.v));
  const [text, caret] = Array.isArray(r) ? r : [r, r.length];
  c.it.v = c.plain ? text : typeInCell(c.it.v, text, caret, c.auto);
  return toLatex(m);
};
const add = ch => d => d + ch;
const same = (label, got, want) => ok(label, got === want, JSON.stringify(got) + ' 應該是 ' + JSON.stringify(want));

// ---- 結構：沒改到的地方照原文（格子之間記著的原文，見 MathSlots 的 g）
// 1. 沒有大括號的上下標：改別的格子時照原文；改它本身時，還是一個單位就照樣不加，變成好幾個字才加
same('1. 改別的格子：x^2、a_i 不加大括號', change('x^2 + a_i + y', -1, add('1')), 'x^2 + a_i + y1');
same('1. 改別的格子：x^\\alpha、A^\\mathrm{T} 不加大括號', change('x^\\alpha + A^\\mathrm{T} + y', -1, add('1')), 'x^\\alpha + A^\\mathrm{T} + y1');
same('1. 改上標本身：2 改成 3 還是 x^3', change('x^2 + y', 1, () => '3'), 'x^3 + y');
same('1. 改上標本身：變成兩個字才加大括號', change('x^2 + y', 1, () => '23'), 'x^{23} + y');
same('1. 改上標本身：α 改成 β 還是一個指令', change('x^\\alpha + y', 1, () => 'β'), 'x^\\beta + y');
same('1. 改上標裡的結構：A^\\mathrm{T} 改成 A^\\mathrm{X}', change('A^\\mathrm{T} + y', v => v === 'T', () => 'X'), 'A^\\mathrm{X} + y');
same('1. 原文有大括號的照樣有', change('x^{2} + y', 1, () => '3'), 'x^{3} + y');
same('1. 上下括號沒有大括號的標籤也一樣', change('\\overbrace{a}^n + y', -1, add('1')), '\\overbrace{a}^n + y1');
// 上標是指令、後面那一格改成字母開頭：中間補一個空白，不會接成另一個指令（\alphab）
same('1. x^\\alpha 後面的格子改成字母開頭', change('x^\\alpha b', -1, () => 'b'), 'x^\\alpha b');

// 5. \left…\right 與環境裡的空白、換行照原文
same('5. \\left(x\\right) 不加空白', change('\\left(x\\right) + y', -1, add('1')), '\\left(x\\right) + y1');
same('5. 改括號裡的格子也不加空白', change('\\left(x\\right) + y', 1, () => 'xy'), '\\left(xy\\right) + y');
const MAT = '\\begin{pmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{pmatrix} + y';
same('5. 分成好幾行的矩陣不會接成一行', change(MAT, -1, add('1')), MAT + '1');
same('5. 改矩陣裡的一格，其他格的空白、換行不變', change(MAT, v => v === ' 0 ', () => ' 5 '), MAT.replace(' 0 ', ' 5 '));
const CASES = 'f(x) = \\begin{cases}\n  x, & x \\geq 0 \\\\\n  -x, & x < 0\n\\end{cases}';
same('5. 分段函數也一樣（\\geq 也還在）', change(CASES, 0, () => 'g(x) = '), CASES.replace('f(x)', 'g(x)'));
same('5. 指令與大括號之間的空白', change('\\frac {a} {b} + \\sqrt {x} + y', -1, add('1')), '\\frac {a} {b} + \\sqrt {x} + y1');
// 括號是指令（\langle）、裡面的格子改成字母開頭：中間補一個空白，不會接成 \langlea
same('5. \\left\\langle 後面接字母', change('\\left\\langle a\\right\\rangle', 1, () => 'b'), '\\left\\langle b\\right\\rangle');
// 以前 \right\rangle 後面打字母會接成 \ranglex（不存在的指令）
same('5. \\right\\rangle 後面打字母', change('\\left\\langle a \\right\\rangle', -1, () => 'x'), '\\left\\langle a \\right\\rangle x');

// 選擇性的格子：清空就拿掉 [ ] 與 ^{ }，原文空著的照原文，打了字才加上
same('次方根清空', change('\\sqrt[3]{x} + y', 1, () => ''), '\\sqrt{x} + y');
same('原文空著的次方根照原文', change('\\sqrt[]{x} + y', -1, add('1')), '\\sqrt[]{x} + y1');
same('原文空著的次方根打了字', change('\\sqrt[]{x} + y', 1, () => '3'), '\\sqrt[3]{x} + y');
same('標籤清空', change('\\overbrace{a}^n + y', 2, () => ''), '\\overbrace{a} + y');
same('原文空著的標籤打了字', change('\\overbrace{a}^{} + y', 2, () => 'n'), '\\overbrace{a}^{n} + y');
same('沒有大括號的標籤變成兩個字', change('\\overbrace{a}^n + y', 2, () => 'nm'), '\\overbrace{a}^{nm} + y');
{
  // 矩陣按「＋列」加的格子照編輯器的寫法前後各空一格；原本的格子照原文
  const m = parseLatex('\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}');
  m[1].rows.push([[{ t: 'text', v: '' }], [{ t: 'text', v: 'x' }]]);
  same('矩陣加一列', toLatex(m), '\\begin{bmatrix}1&2\\\\3&4\\\\  & x \\end{bmatrix}');
  m[1].rows.splice(1, 2);
  same('矩陣刪掉列', toLatex(m), '\\begin{bmatrix}1&2\\end{bmatrix}');
}

// 格子結尾打了單獨的反斜線：接起來時補一個空白，不會把後面的 } 變成 \}
same('格子結尾打了單獨的反斜線', change('\\frac{a}{b}', 1, add('\\')), '\\frac{a\\ }{b}');

// ---- 格子裡：沒改到的字照原文的寫法（每一格記著的段落，見 displaySegs）
// 2. 同一個符號的另一種寫法：改同一格的別的地方，\leq 不會變成 \le、\qquad 不會變成 \quad\quad
same('2. \\leq \\geq \\neq \\qquad 照原文', change('a \\leq b \\geq c \\neq d\\qquad e', 0, add('1')), 'a \\leq b \\geq c \\neq d\\qquad e1');
same('2. \\rightarrow 不會變成 \\to', change('A \\rightarrow B', 0, add('1')), 'A \\rightarrow B1');
// 同樣的符號連在一起時，打在中間的那一個是新的，原本的兩個照原文
same('2. 在 \\le\\leq 中間打一個 ≤', typeInCell('\\le\\leq', '≤≤≤', 2), '\\le\\le\\leq');
{
  // 刪掉一個符號再打回來：回到原本的寫法（跟這一格剛畫出來時比，見 editSegs 的 base）
  const base = displaySegs('a \\leq b');
  const removed = editSegs(base, 'a  b', true, base, 2);
  same('2. 刪掉 ≤ 再打回來還是 \\leq', segSrc(editSegs(removed, 'a ≤ b', true, base, 3)), 'a \\leq b');
}

// 3. 直接打的符號（α、≤）不會換成指令
same('3. α ≤ β 照原文', change('α ≤ β + \\alpha', 0, add('1')), 'α ≤ β + \\alpha1');
same('3. 新打的符號才換成指令', change('α', 0, add('+β')), 'α+\\beta');

// 4. 剛好是函數名稱的字：原文的 max、sin 不會變成 \max、\sin；新打的才會
same('4. x_{max} 後面多打一個字', change('x_{max} + y', v => v === 'max', add('1')), 'x_{max1} + y');
same('4. 原文的 sin 照原文', change('sin x', 0, add('1')), 'sin x1');
same('4. 新打的 sin 換成 \\sin', change('a', 0, add(' + sin x')), 'a + \\sin x');
same('4. 自己打 \\sin 也可以', change('a', 0, add(' + \\sin x')), 'a + \\sin x');
same('4. \\sin 後面多打 e 是 sine', change('\\sin x', 0, () => ['sine x', 4]), 'sine x');

// 6. 不認得的指令的參數：裡面打的字不自動換成函數
same('6. \\color{red} 改成 tan 不會變成 \\tan', change('\\color{red}{x} + y', v => v === 'red', () => 'tan'), '\\color{tan}{x} + y');
same('6. \\mathsf{max} 後面多打一個字', change('\\mathsf{max} + y', v => v === 'max', add('1')), '\\mathsf{max1} + y');
ok('6. 認得的指令（\\alpha）後面的 {…} 是一般的群組', !isCommandArg(parseLatex('\\alpha{x}'), parseLatex('\\alpha{x}')[1]) && (m => isCommandArg(m, m[1]))(parseLatex('\\color{red}')));

// 性質：每個公式的每一格多打一個字（照介面的做法），寫出來的 LaTeX 只有那一格在原文裡的範圍會變，而且讀得懂。
// 那一格的範圍：把那一格換成一個記號再寫出來，記號的位置就是範圍（這一步本身也要只動到那一格）
{
  const MARKER = 'Ж';
  const bad = [];
  let count = 0;
  const sources = [...REAL, ...SPELLING, MAT, CASES, 'x^\\alpha + A^\\mathrm{T}', '\\color{red}{x}', '\\left\\langle a\\right\\rangle', '\\frac{a\\ }{b}'];
  for (const item of sources) {
    const s = Array.isArray(item) ? item[0] : item;
    const n = textCells(parseLatex(s)).length;
    for (let k = 0; k < n; k++) {
      const m1 = parseLatex(s);
      const c1 = textCells(m1)[k];
      if (c1.unit) c1.unit.splice(0, c1.unit.length, { t: 'text', v: MARKER }); else c1.it.v = MARKER;
      const o1 = toLatex(m1);
      const from = o1.indexOf(MARKER);
      const to = from + s.length - (o1.length - MARKER.length);
      if (from < 0 || to < from || o1.slice(0, from) !== s.slice(0, from) || o1.slice(from + MARKER.length) !== s.slice(to)) { bad.push(['範圍', s, k, o1]); continue; }
      for (const ch of ['1', 'x']) {
        const m2 = parseLatex(s);
        const c2 = textCells(m2)[k];
        c2.it.v = c2.plain ? c2.it.v + ch : typeInCell(c2.it.v, toDisplay(c2.it.v) + ch, undefined, c2.auto);
        const o2 = toLatex(m2);
        count++;
        const inside = o2 !== s && o2.startsWith(s.slice(0, from)) && o2.endsWith(s.slice(to)) && o2.length >= from + s.length - to;
        if (!inside || parseLatex(o2)[0].raw !== parseLatex(s)[0].raw) bad.push([s, k, ch, o2]);
      }
    }
  }
  ok('性質：多打一個字只改到那一格（' + count + ' 次）', !bad.length && count > 300, JSON.stringify(bad.slice(0, 6)));
}

// 7. 打字打出不成對的大括號或 %：寫成看得到的 \{、\%，方程式不會壞掉；打完成對的 { } 就是一組大括號
same('7. 不成對的 {', change('\\frac{a}{b}', 1, add('{')), '\\frac{a\\{}{b}');
same('7. 成對的 { }', change('\\frac{a}{b}', 1, add('{c}')), '\\frac{a{c}}{b}');
same('7. 不成對的 }', change('\\frac{a}{b}', 1, add('}')), '\\frac{a\\}}{b}');
same('7. %', change('\\frac{a}{b}', 1, add('50%')), '\\frac{a50\\%}{b}');
same('7. 文字格裡不成對的 }', change('\\text{ab} + y', v => v === 'ab', add('}')), '\\text{ab\\}} + y');
for (const s of ['\\frac{a\\{}{b}', '\\frac{a\\}}{b}', '\\frac{a50\\%}{b}', '\\text{ab\\}} + y', '\\frac{a\\ }{b}']) ok('7. 寫出來的 LaTeX 讀得懂：' + s, !parseLatex(s)[0].raw && rt(s) === s);

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
