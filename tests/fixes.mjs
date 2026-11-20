// 回歸測試：貼上的內容帶著 Markdown 表達不了的屬性時，存檔再讀回要得到同樣的文件
import { MarkdownConverter } from '../src/markdown.js';
import { schema } from '../src/schema.js';
import { normalizeCellAlign } from '../src/schema.js';
import { propType, summarize, propLink, convertProp, renameProp, propsSummary, frontmatterOf, frontmatterBody, peekData } from '../src/props.js';
import { countText, docText, docStats } from '../src/textstats.js';

const c = new MarkdownConverter();
const N = schema.nodes;
let failed = 0;
const check = (name, ok, detail) => { if (ok) console.log('ok  ', name); else { failed++; console.log('FAIL', name, detail === undefined ? '' : detail); } };
const para = (...inline) => N.paragraph.create(null, inline);
const nodes = doc => { const a = []; doc.forEach(n => a.push(n)); return a; };
const ser = doc => c.serializeNodes(nodes(doc));
const roundtrip = doc => c.parse(ser(doc)).doc;
// 比較時不看 bid（原文區塊編號）
const strip = node => JSON.stringify(node.toJSON(), (k, v) => (k === 'bid' ? undefined : v));

// ---- 表格儲存格的對齊：只留下 Markdown 寫得出來的值
check('align: start → 預設', normalizeCellAlign('start') === null);
check('align: end → right', normalizeCellAlign('end') === 'right');
check('align: -webkit-center → center', normalizeCellAlign('-webkit-center') === 'center');
check('align: CENTER → center', normalizeCellAlign('CENTER') === 'center');
check('align: justify → 預設', normalizeCellAlign('justify') === null);
check('align: 空字串 → 預設', normalizeCellAlign('') === null && normalizeCellAlign(null) === null);

// ---- 沒有目標的連結：存成純文字，不要變成原文區塊
{
  const doc = N.doc.create(null, [para(schema.text('前面 '), schema.text('沒有目標', [schema.marks.link.create({ href: '' })]), schema.text(' 後面'))]);
  const md = ser(doc);
  const back = c.parse(md).doc;
  check('空連結：Markdown 不含 ]()', !md.includes(']()'), JSON.stringify(md));
  check('空連結：讀回是一個段落', back.childCount === 1 && back.firstChild.type === N.paragraph, strip(back));
  check('空連結：文字都在', back.textContent === '前面 沒有目標 後面', back.textContent);
  check('空連結：再存一次相同', ser(back).trim() === md.trim());
}
{
  const doc = N.doc.create(null, [para(schema.text('只有空白', [schema.marks.link.create({ href: '   ' })]))]);
  const md = ser(doc);
  check('空白連結：存成純文字', md.trim() === '只有空白', JSON.stringify(md));
}
{
  // 有目標的連結不受影響
  const doc = N.doc.create(null, [para(schema.text('連結', [schema.marks.link.create({ href: 'https://example.com/a' })]))]);
  check('一般連結：往返相同', strip(roundtrip(doc)) === strip(doc), ser(doc));
}

// ---- 連按兩次換行、段落一開頭就換行：不能寫成空白行（讀回來會變成兩段，或換行不見）
{
  const br = () => N.hard_break.create();
  const T = s => schema.text(s);
  const same = (name, ...blocks) => { const doc = N.doc.create(null, blocks); check(name, strip(roundtrip(doc)) === strip(doc), JSON.stringify(ser(doc))); };
  check('連續兩個換行：第一個寫成 <br>', ser(N.doc.create(null, [para(T('a'), br(), br(), T('b'))])) === 'a<br>\nb', JSON.stringify(ser(N.doc.create(null, [para(T('a'), br(), br(), T('b'))]))));
  same('連續兩個換行：讀回還是一段', para(T('a'), br(), br(), T('b')));
  same('連續三個換行', para(T('a'), br(), br(), br(), T('b')));
  same('段落開頭就換行', para(br(), T('a'), br(), T('b')));
  same('引文裡連續兩個換行', N.blockquote.create(null, [para(T('a'), br(), br(), T('b'))]));
  same('清單裡連續兩個換行、待辦事項開頭就換行', N.bullet_list.create(null, [
    N.list_item.create(null, [para(T('a'), br(), br(), T('b'))]), N.list_item.create({ checked: false }, [para(br(), T('c'))])]));
  const blankLine = roundtrip(N.doc.create(null, [para(T('a'), br(), T('  '), br(), T('b'))]));
  check('兩個換行中間只有空白：讀回還是一段、兩個換行', blankLine.childCount === 1 && strip(blankLine.firstChild) === strip(para(T('a'), br(), br(), T('b'))), strip(blankLine));
  check('一般的換行照舊寫成換行', ser(N.doc.create(null, [para(T('a'), br(), T('b'), br(), T('c'))])) === 'a\nb\nc');
}

// ---- 文件屬性的值：顯示文字、連結、類型轉換
{
  const nested = { 作者: { 姓名: '小明', 信箱: 'a@b.c' }, 清單: [{ k: 1 }, 'x'] };
  check('summarize：巢狀資料不會出現 [object Object]', !summarize(nested).includes('[object') && !summarize([{ a: 1 }]).includes('[object'), summarize(nested));
  check('summarize：物件寫成「名稱: 值」', summarize({ a: 1, b: 'x' }) === 'a: 1, b: x', summarize({ a: 1, b: 'x' }));
  check('summarize：清單用逗號分隔', summarize(['a', 2, true]) === 'a, 2, true');
  check('summarize：空值是空字串', summarize(null) === '' && summarize(undefined) === '');
  check('propType：物件清單是清單', propType('authors', [{ name: 'x' }]) === 'list');
  check('propType：巢狀物件', propType('meta', { a: 1 }) === 'object');
  check('propLink：[[筆記]]', JSON.stringify(propLink('[[資料夾/筆記]]')) === JSON.stringify({ kind: 'wiki', target: '資料夾/筆記', text: '資料夾/筆記' }));
  check('propLink：[[筆記|別名]]', propLink('[[筆記#標題|看這裡]]').text === '看這裡' && propLink('[[筆記#標題|看這裡]]').target === '筆記#標題');
  check('propLink：網址', propLink('https://www.example.com/a/').text === 'example.com/a' && propLink('https://www.example.com/a/').kind === 'url');
  check('propLink：一般文字不是連結', propLink('看 [[筆記]] 一下') === null && propLink('example.com') === null && propLink(3) === null);
  const now = new Date(2026, 10, 17, 9, 5);
  check('convert：文字 → 清單', JSON.stringify(convertProp('a, b，c', 'list')) === '["a","b","c"]');
  check('convert：清單 → 文字', convertProp(['a', 'b'], 'text') === 'a, b');
  check('convert：文字 → 數字', convertProp('12.5', 'number') === 12.5 && convertProp('abc', 'number') === 0);
  check('convert：→ 核取方塊', convertProp('true', 'checkbox') === true && convertProp('no', 'checkbox') === false && convertProp(null, 'checkbox') === false);
  check('convert：→ 日期', convertProp('2026-01-02T10:20', 'date') === '2026-01-02' && convertProp('x', 'date', now) === '2026-11-17');
  check('convert：→ 日期時間', convertProp('2026-01-02', 'datetime') === '2026-01-02T00:00' && convertProp(null, 'datetime', now) === '2026-11-17T09:05');
  check('convert：空值 → 清單是空清單', JSON.stringify(convertProp(null, 'list')) === '[]');
  const renamed = renameProp({ a: 1, b: 2, c: 3 }, 'b', ' 新 ');
  check('rename：位置不變', JSON.stringify(renamed) === '{"a":1,"新":2,"c":3}', JSON.stringify(renamed));
  check('rename：名稱重複或空白時不改', renameProp({ a: 1, b: 2 }, 'a', 'b') === null && renameProp({ a: 1 }, 'a', '  ') === null);
  check('propsSummary：略過沒有值的屬性', propsSummary({ tags: ['a', 'b'], empty: null, date: '2026-11-17' }) === 'tags: a, b  ·  date: 2026-11-17', propsSummary({ tags: ['a', 'b'], empty: null, date: '2026-11-17' }));
}

// ---- 查看文件屬性：從原文或文件屬性節點取出 YAML（跟 markdown.ts 切文件屬性的規則一樣）
{
  check('frontmatterOf：開頭的 --- 到下一個 ---', frontmatterOf('---\ntags: [a]\ndate: 2026-11-19\n---\n內文') === 'tags: [a]\ndate: 2026-11-19');
  check('frontmatterOf：Windows 換行、用 ... 結尾', frontmatterOf('---\r\na: 1\r\n...\r\n內文') === 'a: 1');
  check('frontmatterOf：空的文件屬性', frontmatterOf('---\n---\n內文') === '');
  check('frontmatterOf：沒有文件屬性', frontmatterOf('# 標題\n---\n') === null && frontmatterOf('---\n沒有結尾') === null && frontmatterOf(' ---\na: 1\n---') === null);
  check('frontmatterOf：跟 Word 模式轉換時切出的文件屬性一樣', (() => {
    const md = '---\na: 1\nb: [x, y]\n---\n\n一段\n';
    const first = c.parse(md).doc.firstChild;
    return first.type === N.frontmatter && frontmatterBody(first.attrs.src) === frontmatterOf(md);
  })());
  const yaml = s => { if (s.includes('!!')) throw new Error('bad'); return s === '[1]' ? [1] : Object.fromEntries(s.split('\n').map(l => l.split(': '))); };
  check('peekData：沒有文件屬性', peekData(null, yaml).kind === 'none');
  check('peekData：空的文件屬性是沒有值的屬性', JSON.stringify(peekData('  ', yaml)) === '{"kind":"props","values":{}}');
  check('peekData：屬性的值', JSON.stringify(peekData('a: 1\nb: 2', yaml)) === '{"kind":"props","values":{"a":"1","b":"2"}}');
  check('peekData：看不懂的 YAML 顯示原文', JSON.stringify(peekData('a: !!x', yaml)) === '{"kind":"raw","text":"a: !!x"}' && peekData('[1]', yaml).kind === 'raw');
}

// ---- 字數：Markdown／閱讀模式先把原文轉成文件再算，跟 Word 模式的數字一樣
{
  const md = '---\ntags: [a]\n---\n# 標題 Title\n\n這是 **粗體** 與 [連結](https://example.com)，hello world。\n\n| 甲 | 乙 |\n| --- | --- |\n| a1 | b1 |\n';
  const doc = c.parse(md).doc;
  const all = countText(docText(doc));
  check('字數：Markdown 符號與文件屬性不算字', all.cjk === countText('標題這是粗體與連結甲乙').cjk && all.latin === 5, JSON.stringify(all));
  const st = docStats(doc);
  check('字數統計：段落、標題、表格、連結', st.heads === 1 && st.tables === 1 && st.links === 1 && st.words === all.words && st.minutes === 1, JSON.stringify(st));
  check('字數統計：選取一段', docStats(doc, 0, doc.child(0).nodeSize + doc.child(1).nodeSize).heads === 1 && docStats(doc, 0, doc.child(0).nodeSize).words === 0);
}

if (failed) { console.log(`\n${failed} 項失敗`); process.exit(1); }
console.log('\nALL PASS');
