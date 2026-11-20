// 邊界案例的往返測試（不需要真實的 vault）：
// 1. 沒有修改時，輸出要跟原文一字不差
// 2. 每個區塊重新輸出後再讀回來，文件結構要相同（不會遺失或改變內容）
// 3. 個別案例另外檢查「編輯後」的輸出
import { EditorState, TextSelection } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import { MarkdownConverter } from '../src/markdown.js';
import { schema } from '../src/schema.js';
import { moveBlock, setAlign, setBlockStyle } from '../src/commands.js';

const c = new MarkdownConverter();
let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + label + '  ' + extra); } else console.log('PASS ' + label); };

const CASES = {
  customTask: '- [/] 進行中\n- [-] 取消\n- [>] 延後\n- [X] 大寫\n- [x] 完成\n- [ ] 待辦\n',
  taskNotLink: '- [x](https://a.b) 連結不是任務\n- [^1] 註腳不是任務\n',
  emptyTask: '- [ ] \n- [x] 做完的\n- [/] \n- [ ]\n> - [ ] \n',
  htmlComment: '文字 <!-- 註解 --> 後面\n',
  blockComment: '%%\n多行\n\n註解 **x**\n%%\n',
  blockCommentGlued: '前面的文字\n%%\n多行\n\n註解\n%%\n後面的文字\n',
  blockCommentNoBlank: '%%\n多行\n註解\n%%\n',
  mathBlank: '$$\na = b\n\nc = d\n$$\n',
  mathNoBlank: '$$\nx^2\n$$\n',
  mathInFence: '```\n$$\n\n不是數學式\n$$\n```\n',
  commentInList: '- 項目\n  %%\n\n  註解\n  %%\n- 二\n',
  nestedOl: '1. 一\n   - 巢狀\n2. 二\n',
  hardBreak2sp: '行尾兩空白  \n下一行\n',
  backslashBreak: '行尾反斜線\\\n下一行\n',
  blockId: '段落文字 ^abc123\n',
  tagStart: '#標籤 開頭的段落\n',
  underscoreEm: '*斜體* 和 _底線斜體_ 和 __粗體__ 與 snake_case_name\n',
  angleLink: '[連結](<路徑 有空白.md>) 與 [a](b%20c.md)\n',
  embedHeading: '![[note#heading]] 與 ![[file.pdf#page=2]]\n',
  tableEsc: '| a | b |\n|---|---|\n| 1 \\| 2 | `x\\|y` |\n',
  tableWikiPipe: '| a | b |\n|---|---|\n| [[x|y]] | ![[i.png|50]] |\n',
  tableExtraCells: '| a |\n|---|\n| **粗** | 多出來 | 的內容 |\n',
  tableCodePipe: '| a |\n|---|\n| `x|y` |\n',
  tableInline: '| a | b |\n| :-: | --: |\n| **粗** [[x\\|y]] | $m$ %%c%% |\n',
  emptyCells: '| a | b |\n|---|---|\n|  | x |\n',
  noLeadingPipe: 'a | b\n--- | ---\n1 | 2\n',
  calloutFold: '> [!note]- 標題 **粗**\n> 內容\n',
  calloutNested: '> [!tip] 外層\n> 文字\n> > [!warning] 內層\n> > 內文\n',
  details: '<details>\n<summary>x</summary>\n\n內容 **粗**\n\n</details>\n',
  taskMeta: '- [ ] 任務 📅 2026-01-01 #tag [[x]]\n',
  setext: '標題\n===\n',
  autolink: '<https://x.com> 與 www.example.com 與 https://a.b/c_d\n',
  escapes: '\\$100 和 \\*字面\\* 與 1\\. 不是清單\n',
  refLink: '[text][ref] 文字\n\n[ref]: https://x.com\n',
  dollar: '價格 $5 到 $10 元\n',
  cjkBold: '中文**「粗體」**中文 與 **粗體**，後面\n',
  listCode: '- 項目\n\n  ```js\n  a\n  ```\n- 二\n',
  looseList: '- a\n\n- b\n\n- c\n',
  numberedStart: '3. 三\n4. 四\n',
  starBullets: '* a\n* b\n',
  headingTrail: '## 標題 ##\n',
  htmlInlineUnknown: '文字 <span class="x">a</span> <abbr title="t">b</abbr>\n',
  imgSize: '![alt|100x200](a.png) ![[b.png|說明|300]]\n',
  mathBlockInline: '$$x^2$$ 同一行\n',
  dataview: '```dataview\nTABLE a\n```\n',
  mermaid: '```mermaid\nflowchart TD\n  A[開始] --> B{判斷}\n  B -->|是| C[結束]\n```\n',
  tabIndentList: '- a\n\t- b\n\t\t- c\n',
  indentedCode: '段落\n\n    code\n',
  inlineFootnote: '文字^[行內註腳 **粗**] 後\n',
  footnote: '文字[^1] 與 [^note]。\n\n[^1]: 第一個註腳\n[^note]: 第二個\n    延續的內容\n',
  tilde: 'A :smile: ~~刪~~ ~單~ H~2~O x^2^\n',
  fmNoEnd: '---\ntitle: x\n\n內容\n',
  fmEmpty: '---\n---\n\n內文\n',
  crlf: '# 標題\r\n\r\n段落\r\n\r\n- a\r\n- b\r\n',
  noFinalNewline: '段落一\n\n段落二',
  wikiHeadingAlias: '[[note#^abc|別名]] [[#本頁標題]]\n',
  tagAndBlock: '- 項目 #tag ^id1\n',
  embeds: '![[筆記]]\n\n![[筆記#標題]]\n\n![[錄音.mp3]] ![[影片.mp4]] ![[文件.pdf#page=3]]\n\n![](https://www.youtube.com/watch?v=abc)\n',
  query: '```query\ntag:#todo\n```\n',
  hr: '***\n\n___\n\n---\n',
};

const strip = (k, v) => (k === 'bid' ? undefined : v);
for (const [name, src] of Object.entries(CASES)) {
  const { doc, meta } = c.parse(src);
  const out = c.serialize(doc, meta);
  ok(name + '：沒修改時一字不差', out === src, JSON.stringify(out));
  // 每個區塊重新輸出再讀回：結構相同
  let lossy = null;
  doc.forEach(n => {
    if (lossy || n.type.name === 'raw_block' || n.type.name === 'frontmatter') return;
    const s = c.serializeNodes([n]);
    const re = c.parseFragment(s);
    const a = JSON.stringify(n.toJSON(), strip);
    const b = re.childCount === 1 ? JSON.stringify(re.firstChild.toJSON(), strip) : 'MULTI';
    if (a !== b) lossy = s;
  });
  ok(name + '：重新輸出不遺失內容', !lossy, JSON.stringify(lossy));
}

// ---- 編輯後的輸出
const edited = (src, find) => {
  const { doc, meta } = c.parse(src);
  let st = EditorState.create({ doc, schema });
  let pos = null;
  doc.descendants((n, p) => { if (pos == null && n.isText && n.text.includes(find)) pos = p + n.text.indexOf(find); return pos == null; });
  if (pos == null) throw new Error('找不到「' + find + '」');
  st = st.apply(st.tr.insertText('新', pos));
  return c.serialize(st.doc, meta);
};
const kinds = src => { const out = []; c.parse(src).doc.forEach(n => out.push(n.type.name + (n.type.name === 'raw_block' ? ':' + n.attrs.kind : ''))); return out.join(','); };

let o = edited(CASES.customTask, '進行中');
ok('自訂任務狀態：編輯後保留 [/] [-] [>] [X]', o === '- [/] 新進行中\n- [-] 取消\n- [>] 延後\n- [X] 大寫\n- [x] 完成\n- [ ] 待辦\n', JSON.stringify(o));
ok('[x](網址) 與 [^1] 不是任務', c.parse(CASES.taskNotLink).doc.firstChild.firstChild.attrs.checked == null);
{
  // 還沒打字的待辦事項（- [ ] 後面是空的）：是任務，編輯同一個清單的其他項目不會把方框跳脫成 \[ \]
  const items = []; c.parse(CASES.emptyTask).doc.firstChild.forEach(li => items.push([li.attrs.checked, li.attrs.status, li.textContent]));
  ok('空的待辦事項是任務', JSON.stringify(items) === '[[false,null,""],[true,null,"做完的"],[true,"/",""],[false,null,""]]', JSON.stringify(items));
  o = edited(CASES.emptyTask, '做完的');
  ok('空的待辦事項：編輯其他項目後方框還在', o === '- [ ] \n- [x] 新做完的\n- [/] \n- [ ] \n> - [ ] \n', JSON.stringify(o));
  const plain = c.parse('- [1]\n- [a] \n- [ ]\n  下一行\n').doc.firstChild;
  ok('「- [1]」後面連空白都沒有：不是任務', plain.child(0).attrs.checked == null && plain.child(0).textContent === '[1]');
  ok('「- [a] 」後面有空白：是自訂狀態的任務', plain.child(1).attrs.checked === true && plain.child(1).attrs.status === 'a');
}

ok('有空行的 %% 註解是一整個原文區塊', kinds(CASES.blockComment) === 'raw_block:comment', kinds(CASES.blockComment));
ok('有空行的 $$ 數學式是一整個原文區塊', kinds(CASES.mathBlank) === 'raw_block:math', kinds(CASES.mathBlank));
ok('黏著文字的 %% 註解：前後文字各自成段', kinds(CASES.blockCommentGlued) === 'paragraph,raw_block:comment,paragraph', kinds(CASES.blockCommentGlued));
o = edited(CASES.blockCommentGlued, '後面的文字');
ok('編輯註解後面的文字：註解結尾不會被跳脫', o === '前面的文字\n%%\n多行\n\n註解\n%%\n新後面的文字\n', JSON.stringify(o));
ok('程式碼區塊裡的 $$ 不受影響', kinds(CASES.mathInFence) === 'code_block', kinds(CASES.mathInFence));
ok('清單裡的 %% 不切開清單', kinds(CASES.commentInList) === 'bullet_list', kinds(CASES.commentInList));

ok('表格裡 [[x|y]] 沒跳脫的 |：仍是可編輯的表格', kinds(CASES.tableWikiPipe) === 'table', kinds(CASES.tableWikiPipe));
o = edited(CASES.tableWikiPipe, 'a');
ok('編輯該表格：連結與圖片都還在', o.includes('[[x\\|y]]') && o.includes('![[i.png\\|50]]'), JSON.stringify(o));
ok('格數比標題列多的表格：保留原文', kinds(CASES.tableExtraCells) === 'raw_block:raw', kinds(CASES.tableExtraCells));
ok('儲存格裡 `x|y` 沒跳脫：保留原文', kinds(CASES.tableCodePipe) === 'raw_block:raw', kinds(CASES.tableCodePipe));

// 新增的空白文件屬性不寫進檔案；原本就有的空白屬性保持原樣
{
  const { doc, meta } = c.parse('內文\n');
  let st = EditorState.create({ doc, schema });
  st = st.apply(st.tr.insert(0, schema.nodes.frontmatter.create({ src: '---\n---' })));
  ok('新增但沒有內容的文件屬性不會寫進檔案', c.serialize(st.doc, meta) === '內文\n', JSON.stringify(c.serialize(st.doc, meta)));
  st = st.apply(st.tr.setNodeMarkup(0, null, { src: '---\ntags:\n  - a\n---', bid: null }));
  ok('有內容的文件屬性寫在最前面', c.serialize(st.doc, meta) === '---\ntags:\n  - a\n---\n\n內文\n', JSON.stringify(c.serialize(st.doc, meta)));
}

// ---- 存檔後再讀回來要是同一份文件：重新產生的區塊不能跟前後的區塊黏在一起
// 開一份文件、做一個修改（edit 收到目前的狀態、dispatch、取得最新狀態的函式），回傳存檔結果與讀回的文件
const save = (src, edit) => {
  const { doc, meta } = c.parse(src);
  let state = EditorState.create({ doc, schema });
  edit(state, tr => { state = state.apply(tr); }, () => state);
  const out = c.serialize(state.doc, meta);
  return { out, doc: state.doc, back: c.parse(out).doc };
};
const json = doc => JSON.stringify(doc.toJSON(), strip);
const sameDoc = r => json(r.back) === json(r.doc);
const posOf = (doc, text) => { let p = -1; doc.descendants((n, pos) => { if (p < 0 && n.isText && n.text.includes(text)) p = pos + n.text.indexOf(text); }); return p; };
const caretAt = (state, text) => state.tr.setSelection(TextSelection.create(state.doc, posOf(state.doc, text)));
const P = text => schema.nodes.paragraph.create(null, schema.text(text));

{
  let r = save('A', (s, d) => d(s.tr.insert(s.doc.content.size, P('B'))));
  ok('結尾沒有換行，在最後加一段：是兩段', r.out === 'A\n\nB' && sameDoc(r), JSON.stringify(r.out));
  r = save('A', (s, d, cur) => { d(s.tr.setSelection(TextSelection.create(s.doc, 2))); splitBlock(cur(), d); d(cur().tr.insertText('B')); });
  ok('結尾沒有換行，按 Enter 再打字：是兩段', r.out === 'A\n\nB' && sameDoc(r), JSON.stringify(r.out));
  r = save('A\r\n\r\nB', (s, d) => d(s.tr.insert(s.doc.content.size, P('C'))));
  ok('結尾沒有換行（CRLF），在最後加一段', r.out === 'A\r\n\r\nB\r\n\r\nC' && sameDoc(r), JSON.stringify(r.out));
  r = save('A\n\nB', (s, d, cur) => { d(caretAt(s, 'B')); moveBlock(-1)(cur(), d); });
  ok('結尾沒有換行，把最後一段往上移：仍是兩段', r.out === 'B\n\nA\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('A\n\nB', (s, d) => d(s.tr.delete(0, s.doc.firstChild.nodeSize)));
  ok('結尾沒有換行，刪掉前面的段落：最後一段照原文', r.out === 'B', JSON.stringify(r.out));

  r = save('# H\ntext\n', (s, d, cur) => { d(caretAt(s, 'H')); setBlockStyle('p')(cur(), d); });
  ok('標題緊接內文，標題改成內文：不會併成一段', r.out === 'H\n\ntext\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('# H\r\ntext\r\n', (s, d, cur) => { d(caretAt(s, 'H')); setBlockStyle('p')(cur(), d); });
  ok('標題緊接內文（CRLF），標題改成內文', r.out === 'H\r\n\r\ntext\r\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('intro\n# H\ntext\n', (s, d, cur) => { d(caretAt(s, 'H')); setBlockStyle('p')(cur(), d); });
  ok('內文、標題、內文都緊接：標題改成內文後仍是三段', r.out === 'intro\n\nH\n\ntext\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('Intro line\n- item 1\n- item 2\n', (s, d, cur) => { d(caretAt(s, 'Intro')); setAlign('center')(cur(), d); });
  ok('內文緊接清單，內文置中：清單不會被吃進 HTML 區塊', r.out === '<p style="text-align: center">Intro line</p>\n\n- item 1\n- item 2\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('- a\n# H\n', (s, d, cur) => { d(caretAt(s, 'H')); setBlockStyle('p')(cur(), d); });
  ok('清單緊接標題，標題改成內文：不會變成清單項目的延續', r.out === '- a\n\nH\n' && sameDoc(r), JSON.stringify(r.out));
  r = save('---\na: 1\n---\n# H\ntext\n', (s, d, cur) => { d(caretAt(s, 'H')); setBlockStyle('p')(cur(), d); });
  ok('文件屬性、標題、內文都緊接：只在會併段的地方加空行', r.out === '---\na: 1\n---\nH\n\ntext\n' && sameDoc(r), JSON.stringify(r.out));

  // 筆記原本寫得很緊（中間沒有空行）：只改幾個字不會重排
  const tight = '---\na: 1\n---\n# H\ntext\n- item 1\n- item 2\n## H2\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\ncode\n```\nSee [foo] here\n\n[foo]: https://x.com\n';
  // [要改的字, 原本那一行, 改完那一行]
  for (const [find, line, want] of [['H', '# H\n', '# 新H\n'], ['text', 'text\n', '新text\n'], ['item 2', '- item 2', '- 新item 2'], ['H2', '## H2', '## 新H2'],
    ['a', '| a | b |', '| 新a | b |'], ['code', 'code\n', '新code\n'], ['See', 'See [foo] here', '新See [foo](https://x.com) here']]) {
    const o2 = edited(tight, find);
    ok('寫得很緊的筆記，只改「' + find + '」：其他地方一字不差', o2 === tight.replace(line, want), JSON.stringify(o2));
  }
}

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
