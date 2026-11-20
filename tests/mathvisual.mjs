// 方程式視覺化編輯：LaTeX ⇄ 結構的轉換測試（編輯元件的操作測試在 tests/view/features.mjs）
import { parseLatex, toLatex, toDisplay, fromDisplay } from '../src/mathvisual.js';

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

// 簡寫會整理成完整的寫法（意思相同）
ok('x^2 → x^{2}', rt('x^2') === 'x^{2}', rt('x^2'));
ok('E = mc^2', rt('E = mc^2') === 'E = mc^{2}', rt('E = mc^2'));
ok('x_i^2', rt('x_i^2') === 'x_{i}^{2}', rt('x_i^2'));
ok('x^\\alpha', rt('x^\\alpha') === 'x^{\\alpha}', rt('x^\\alpha'));

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
ok('標籤的簡寫：\\overbrace{a}^n → ^{n}', rt('\\overbrace{a}^n') === '\\overbrace{a}^{n}' && rt('\\underbrace{a} _\\alpha') === '\\underbrace{a}_{\\alpha}', rt('\\underbrace{a} _\\alpha'));
ok('上括號後面的 _ 不是標籤，是一般的下標', kinds('\\overbrace{a}_{b}') === 'text,brace,text,sub,text' && rt('\\overbrace{a}_{b}') === '\\overbrace{a}_{b}', kinds('\\overbrace{a}_{b}'));
ok('沒有標籤：標籤格是空的，輸出時不加 ^{}', toLatex(parseLatex('\\overbrace{a}^{}')) === '\\overbrace{a}' && parseLatex('\\overbrace{a}')[1].b.length === 1);
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

// 上下標是「指令加它的參數」：以前指令跟參數被拆開（A^{\mathrm}{T}），是壞掉的 LaTeX
for (const [s, want] of [
  ['A^\\mathrm{T}', 'A^{\\mathrm{T}}'], ['x_\\text{max}', 'x_{\\text{max}}'], ['e^\\frac{1}{2}', 'e^{\\frac{1}{2}}'],
  ['x^\\sqrt{2}', 'x^{\\sqrt{2}}'], ['a_\\mathbf{k}^\\mathrm{T}', 'a_{\\mathbf{k}}^{\\mathrm{T}}'], ['x_\\mathbb{R}', 'x_{\\mathbb{R}}'],
  ['A^\\top B', 'A^{\\top} B'], ['f^\\prime(x)', 'f^{\\prime}(x)'], ['x^\\,y', 'x^{\\,}y'],
]) ok('上下標裡的指令：' + s, rt(s) === want && rt(want) === want, rt(s));
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

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
