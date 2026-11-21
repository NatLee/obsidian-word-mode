// 回歸測試：貼上的內容帶著 Markdown 表達不了的屬性時，存檔再讀回要得到同樣的文件
import { EditorState, TextSelection } from 'prosemirror-state';
import { MarkdownConverter } from '../src/markdown.js';
import { schema } from '../src/schema.js';
import { normalizeCellAlign } from '../src/schema.js';
import * as C from '../src/commands.js';
import { insertFootnote } from '../src/footnotes.js';
import { propType, summarize, propLink, convertProp, renameProp, propsSummary, frontmatterOf, frontmatterBody, peekData } from '../src/props.js';
import { countSource, countText, docText, docStats, stripFrontmatter, withSourceCounts } from '../src/textstats.js';

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

// ---- 一行開頭的 - > # 1. 等等：在段落開頭、或換行後面，都要維持是文字（不能讀回來變成清單、引文、標題）
{
  const br = () => N.hard_break.create();
  const T = s => schema.text(s);
  const bad = [];
  for (const line of ['- b', '+ b', '> b', '>b', '# b', '1. b', '1) b', '12) b', '---', '- - -', '-', '+', '1.', '=', '===', '* b']) {
    for (const doc of [N.doc.create(null, [para(T(line))]), N.doc.create(null, [para(T('a'), br(), T(line))]),
      N.doc.create(null, [N.blockquote.create(null, [para(T('a'), br(), T(line))])]), N.doc.create(null, [N.bullet_list.create(null, [N.list_item.create(null, [para(T('a'), br(), T(line))])])])]) {
      if (strip(roundtrip(doc)) !== strip(doc)) bad.push(JSON.stringify(ser(doc)));
    }
  }
  check('行首的清單、引文、標題符號：存檔再讀回還是同一段文字', !bad.length, bad.join(' '));
  const plain = N.doc.create(null, [para(T('-5 度'), br(), T('-12.5'), br(), T('--flag'), br(), T('#標籤 +1'), br(), T('1.5 倍'))]);
  check('不是清單的 -5、--flag、#標籤、1.5：不加反斜線', ser(plain) === '-5 度\n-12.5\n--flag\n#標籤 +1\n1.5 倍' && strip(roundtrip(plain)) === strip(plain), JSON.stringify(ser(plain)));
}

// ---- 編輯指令：做完之後存檔、再讀回來，要是同一份文件
// 開一份文件、做一個修改（edit 收到目前的狀態、dispatch、取得最新狀態的函式），回傳存檔結果與前後的文件
const save = (src, edit) => {
  const { doc, meta } = c.parse(src);
  let state = EditorState.create({ doc, schema });
  edit(state, tr => { state = state.apply(tr); }, () => state);
  const out = c.serialize(state.doc, meta);
  return { out, state, doc: state.doc, back: c.parse(out).doc };
};
const sameDoc = r => strip(r.back) === strip(r.doc);
const posOf = (doc, text) => { let p = -1; doc.descendants((n, pos) => { if (p < 0 && n.isText && n.text.includes(text)) p = pos + n.text.indexOf(text); }); return p; };
// 選取 text 的前 len 個字（len 是 0 就只放游標）
const select = (state, text, len = text.length) => { const p = posOf(state.doc, text); return state.tr.setSelection(TextSelection.create(state.doc, p, p + len)); };

// ---- 用 Backspace／Delete 把段落與程式碼區塊併在一起：換行要留著
{
  const { baseKeymap } = await import('prosemirror-commands');
  const keys = C.buildKeymap();
  // 外掛自己的按鍵先處理，沒處理的交給 ProseMirror 內建的（跟編輯器裡的順序一樣）
  const key = name => (state, dispatch) => (keys[name] && keys[name](state, dispatch)) || baseKeymap[name](state, dispatch);
  const lines = doc => { const a = []; doc.forEach(n => a.push(n.type.name + ':' + n.textBetween(0, n.content.size, '', '⏎'))); return a.join(' | '); };
  let r = save('```\ncode\n```\n\nx\ny\n', (s, d, cur) => { d(select(s, 'x', 0)); key('Backspace')(cur(), d); });
  check('程式碼區塊下面的段落開頭按 Backspace：併進程式碼區塊，段落裡的換行變成程式碼的換行', lines(r.doc) === 'code_block:codex\ny' && r.out === '```\ncodex\ny\n```\n' && sameDoc(r), lines(r.doc) + ' / ' + JSON.stringify(r.out));
  r = save('x\ny\n\n```\na\nb\n```\n', (s, d, cur) => { d(select(s, 'a', 0)); key('Backspace')(cur(), d); });
  check('段落下面的程式碼區塊開頭按 Backspace：併進段落，程式碼的換行變成段落裡的換行', lines(r.doc) === 'paragraph:x⏎ya⏎b' && sameDoc(r), lines(r.doc) + ' / ' + JSON.stringify(r.out));
  r = save('```\ncode\n```\n\nx\ny\n', (s, d, cur) => { d(s.tr.setSelection(TextSelection.create(s.doc, 5))); key('Delete')(cur(), d); });
  check('程式碼區塊結尾按 Delete：下面的段落併上來，換行留著', lines(r.doc) === 'code_block:codex\ny' && sameDoc(r), lines(r.doc) + ' / ' + JSON.stringify(r.out));
  r = save('x\n\n```\na\nb\n```\n', (s, d, cur) => { d(s.tr.setSelection(TextSelection.create(s.doc, 2))); key('Delete')(cur(), d); });
  check('段落結尾按 Delete：下面的程式碼區塊併上來，換行留著', lines(r.doc) === 'paragraph:xa⏎b' && sameDoc(r), lines(r.doc) + ' / ' + JSON.stringify(r.out));
  r = save('一\n\n二\n', (s, d, cur) => { d(select(s, '二', 0)); key('Backspace')(cur(), d); });
  check('兩個一般段落照平常合併', lines(r.doc) === 'paragraph:一二', lines(r.doc));
}

// ---- 段落 ⇄ 程式碼區塊：每一行都要留著（段落裡的換行是節點，程式碼區塊裡是「\n」）
{
  let r = save('line1\nline2\nline3\n', (s, d, cur) => { d(select(s, 'line1', 0)); C.setBlockStyle('code')(cur(), d); });
  check('有換行的段落 → 程式碼（段落樣式）：每一行都在', r.out === '```\nline1\nline2\nline3\n```\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('line1\nline2\n', (s, d, cur) => { d(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1))); C.insertCodeBlock('js')(cur(), d); });
  check('選取有換行的段落 → 插入程式碼區塊：每一行都在', r.out === '```js\nline1\nline2\n```\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('```\na\nb\n\nc\n```\n', (s, d, cur) => { d(select(s, 'a', 0)); C.setBlockStyle('p')(cur(), d); });
  check('程式碼 → 內文：每一行變成段落裡的換行', r.out === 'a\nb<br>\nc\n' && sameDoc(r) && r.doc.firstChild.textContent === 'abc', JSON.stringify(r.out));
  r = save('```\na\nb\n```\n', (s, d, cur) => { d(select(s, 'a', 0)); C.setBlockStyle('h2')(cur(), d); });
  check('程式碼 → 標題：換行還在', r.out === '## a<br>b\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('```\na\nb\n```\n', (s, d, cur) => { d(select(s, 'a', 1)); C.clearFormatting(cur(), d); });
  check('程式碼區塊清除格式：變成內文，每一行都在', r.out === 'a\nb\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('| a |\n| --- |\n| x<br>y |\n', (s, d, cur) => { d(select(s, 'x', 0)); C.setBlockStyle('code')(cur(), d); });
  check('表格裡不能放程式碼區塊：內容不動', r.out === '| a |\n| --- |\n| x<br>y |\n', JSON.stringify(r.out));
}

// ---- 選取文字後插入程式碼區塊：只換掉選到的段落，沒選到的內容不能動、更不能不見
{
  const code = (from, to = from, len) => (s, d, cur) => {
    const a = posOf(s.doc, from); const b = posOf(s.doc, to) + (len == null ? to.length : len);
    d(s.tr.setSelection(TextSelection.create(s.doc, a, b))); C.insertCodeBlock('')(cur(), d);
  };
  let r = save('- one\n- two [[note]]\n- three\n', code('three', 'three', 3));
  check('清單裡選一個字 → 程式碼：只有那一項變成程式碼，其他項目與 [[連結]] 都在', r.out === '- one\n- two [[note]]\n- ```\n  three\n  ```\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('- one\n- two\n- three\n', code('one', 'three'));
  check('選了整個清單 → 程式碼：整個清單變成一個程式碼區塊', r.out === '```\none\ntwo\nthree\n```\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('- one\n- two [[note]]\n- three\n', code('one', 'two', 1));
  check('選了清單的前兩項（裡面有 [[連結]]）→ 程式碼：內容都不動', r.out.includes('- one\n- two [[note]]\n') && r.out.includes('- three') && sameDoc(r), JSON.stringify(r.out));
  r = save('- one\n- two\n- three\n', code('one', 'two'));
  check('選了清單的前兩項 → 程式碼：清單的每一項都還是清單項目', r.out.startsWith('- one\n- two\n') && r.out.includes('- three') && sameDoc(r), JSON.stringify(r.out));
  r = save('intro\n\n- a\n- b [[n]]\n', code('intro', 'a'));
  check('從內文選到清單的第一項 → 程式碼：沒選到的項目不動', r.out.startsWith('intro\n\n- a\n') && r.out.includes('- b [[n]]') && sameDoc(r), JSON.stringify(r.out));
  r = save('one\n\ntwo\nlines\n\nthree\n', code('one', 'lines'));
  check('選了兩個段落 → 程式碼：這兩段變成一個程式碼區塊，後面的段落不動', r.out === '```\none\ntwo\nlines\n```\n\nthree\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('a\n\n$$\nx\n$$\n\nb\n', code('a', 'b'));
  check('選取範圍裡有數學式 → 程式碼：數學式還在', r.out.includes('$$\nx\n$$') && sameDoc(r), JSON.stringify(r.out));
  r = save('- [ ] task\n- [x] done\n', code('task'));
  check('待辦事項 → 程式碼：方框還在', r.out.startsWith('- [ ] task\n') && r.out.includes('- [x] done') && sameDoc(r), JSON.stringify(r.out));
  r = save('> quote\n> second\n\nafter\n', code('quote', 'quote', 2));
  check('引文裡選字 → 程式碼：程式碼區塊在引文裡', r.out === '> ```\n> quote\n> second\n> ```\n\nafter\n' && sameDoc(r), JSON.stringify(r.out));
}

// ---- 插入註腳：既有的註腳定義在游標前面時，參照要插在游標的位置，不是前一個字
{
  const at = (text, len) => (s, d, cur) => { const p = posOf(s.doc, text) + len; d(s.tr.setSelection(TextSelection.create(s.doc, p))); insertFootnote('new')(cur(), d); };
  let r = save('First[^1]\n\n[^1]: def\n\nSecond paragraph here\n', at('Second', 6));
  check('註腳定義在游標前面：參照插在游標處', r.out === 'First[^1]\n\n[^1]: def\n\n[^2]: new\n\nSecond[^2] paragraph here\n' && sameDoc(r), JSON.stringify(r.out));
  check('註腳定義在游標前面：游標在參照後面', r.state.selection.empty && r.state.selection.$from.nodeBefore.attrs.src === '[^2]');
  r = save('First[^1] and more\n\n[^1]: def\n', at('First', 5));
  check('註腳定義在游標後面：照舊', r.out === 'First[^2][^1] and more\n\n[^1]: def\n\n[^2]: new\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('Only text\n', at('Only', 4));
  check('還沒有註腳：定義加在文件最後', r.out === 'Only[^1] text\n\n[^1]: new\n' && sameDoc(r), JSON.stringify(r.out));
}

// ---- 清除格式、格式刷：拿掉的是格式，連結要留著
{
  const all = s => s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1));
  let r = save('see [site](https://example.com) **bold** <u>==mark==</u>\n', (s, d, cur) => { d(all(s)); C.clearFormatting(cur(), d); });
  check('清除格式：粗體、底線、螢光都拿掉，連結還在', r.out === 'see [site](https://example.com) bold mark\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('see [**site**](https://example.com) here\n', (s, d, cur) => { d(select(s, 'site', 0)); d(cur().tr.setSelection(TextSelection.create(cur().doc, cur().selection.from + 2))); C.clearFormatting(cur(), d); });
  check('清除格式（游標在連結的字裡）：只拿掉粗體', r.out === 'see [site](https://example.com) here\n', JSON.stringify(r.out));
  r = save('**bold** and [site](https://example.com) here\n', (s, d, cur) => {
    d(select(s, 'bold', 2)); const marks = C.captureMarks(cur());
    d(select(cur(), 'site')); C.applyMarks(marks)(cur(), d);
  });
  check('格式刷刷在連結上：套上粗體，連結還在', r.out === '**bold** and [**site**](https://example.com) here\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('[**link**](https://example.com) and *plain* here\n', (s, d, cur) => {
    d(select(s, 'link', 2)); const marks = C.captureMarks(cur());
    d(select(cur(), 'plain')); C.applyMarks(marks)(cur(), d);
  });
  check('格式刷從連結取格式：只帶粗體，不會把連結帶過去', r.out === '[**link**](https://example.com) and **plain** here\n' && sameDoc(r), JSON.stringify(r.out));
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

// ---- 字數「跟 Obsidian 內建的一樣」：算 Markdown 原文，結果要跟 Obsidian 1.15.1 的字數相同
// （下面的數字是照 Obsidian 的算法算出來的：中文、日文一字一個詞，其他文字、數字與 - ' ’ 連成一串算一個）
{
  const words = s => countSource(s, true).words;
  check('Obsidian 字數：中文一字一個、英文一串一個', words('這是 hello world。') === 4);
  check('Obsidian 字數：日文假名一字一個，長音符號也算', words('カタカナー ひらがな') === 9);
  check('Obsidian 字數：韓文一串算一個', words('한국어 문장입니다') === 2);
  check('Obsidian 字數：數字的千分位與小數點連在一起', words('1,000.5 與 3.14') === 3);
  check("Obsidian 字數：- ' ’ 跟字母連成一串，單獨的 - 也算一個", words("well-known it's don’t - x") === 5);
  check('Obsidian 字數：網址拆成好幾個詞，Markdown 符號不算', words('[連結](https://example.com) **粗**') === 6);
  check('Obsidian 字數：其他語言', words('Русский العربية עברית ภาษาไทย') === 4);
  check('Obsidian 字數：空字串', words('') === 0 && countSource('').charsWithSpaces === 0);
  const md = '---\ntags: [a]\n---\n# 標題\n\n內文 text\n';
  const st = countSource(md);
  check('Obsidian 字數：不算文件屬性，字元數含空白與換行', st.words === 5 && st.charsWithSpaces === '# 標題\n\n內文 text\n'.length && st.chars === '#標題內文text'.length, JSON.stringify(st));
  check('Obsidian 字數：選取的一段不去掉開頭的 ---', countSource(md, true).charsWithSpaces === md.length);
  check('文件屬性：跟 Obsidian 一樣判斷', stripFrontmatter('---\n---\n內文') === '內文' && stripFrontmatter('---\r\na: 1\r\n---\r\n內文') === '內文'
    && stripFrontmatter('---\nno close\n內文') === '---\nno close\n內文' && stripFrontmatter('--- \n內文\n---\n') === '--- \n內文\n---\n'
    && stripFrontmatter('---\na: b---\n---\n內文') === '內文' && stripFrontmatter('---\na: 1\n---') === '');
  const doc = c.parse(md).doc;
  const both = withSourceCounts(docStats(doc), md);
  check('字數統計視窗：字數換成原文的算法，段落與標題的數目不變', both.words === 5 && both.charsSp === st.charsWithSpaces && both.heads === 1 && both.paras === docStats(doc).paras, JSON.stringify(both));
}

if (failed) { console.log(`\n${failed} 項失敗`); process.exit(1); }
console.log('\nALL PASS');
