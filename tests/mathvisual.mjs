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

// 符號顯示
ok('顯示：\\alpha + \\beta → α+ β', toDisplay('\\alpha + \\beta') === 'α+ β', toDisplay('\\alpha + \\beta'));
ok('顯示：\\sin x → sin x', toDisplay('\\sin x') === 'sin x', toDisplay('\\sin x'));
ok('顯示：不認得的指令照原樣', toDisplay('\\foo x') === '\\foo x');
ok('顯示：\\mathbb{R} → ℝ', toDisplay('x \\in \\mathbb{R}') === 'x ∈ℝ', toDisplay('x \\in \\mathbb{R}'));
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

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
