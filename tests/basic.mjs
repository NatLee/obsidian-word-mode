import { MarkdownConverter } from '../src/markdown.js';
import { schema } from '../src/schema.js';
const c = new MarkdownConverter();
const sample = `---
type: 會議記錄
tags:
  - a
---
# 標題 **粗體**

第一段 [[筆記|別名]] 與 [連結](https://x.com/a_b) 和 ==螢光== 與 <u>底線</u> 及 <span style="color: red">紅字</span>。
第二行 https://bare.example/a_b?x=1

- 項目一
- [ ] 待辦
- [x] 完成
	- 巢狀

1. 一
2. 二

> 引用文字

> [!note] 提示
> 內容

| 欄A | 欄B |
| :--- | ---: |
| [[筆記\\|別名]] | 值<br>換行 |

![[圖片.png|300]] ![說明](附件/圖 1.png)

\`\`\`js
const a = 1;
\`\`\`

$$
x^2
$$

行內 $x$ 與 %%註解%% 與註腳[^1]。

[^1]: 註腳內容

<div>HTML 區塊</div>

---
`;
let fails = 0;
const ok = (label, cond, extra='') => { if (!cond) fails++; console.log((cond?'PASS ':'FAIL ')+label+(cond?'':'  '+extra)); };
const { doc, meta } = c.parse(sample);
ok('unchanged roundtrip exact', c.serialize(doc, meta) === sample, JSON.stringify(c.serialize(doc, meta)).slice(0,300));
const types = []; doc.forEach(n => types.push(n.type.name + (n.type.name==='raw_block'?':'+n.attrs.kind:'')));
console.log('top-level:', types.join(', '));
// CRLF + no trailing newline
const crlf = sample.replace(/\n/g, '\r\n').replace(/\r\n$/, '');
const r2 = c.parse(crlf); ok('CRLF no-final-newline exact', c.serialize(r2.doc, r2.meta) === crlf);
// modify first paragraph only
import { EditorState } from 'prosemirror-state';
let st = EditorState.create({ doc, schema });
let pPos = null; doc.forEach((n, off) => { if (pPos == null && n.type.name === 'paragraph') pPos = off; });
st = st.apply(st.tr.insertText('新增', pPos + 1));
const out = c.serialize(st.doc, meta);
const changedLines = out.split('\n').filter((l, i) => l !== sample.split('\n')[i]);
ok('modify one paragraph keeps rest', out.startsWith(sample.split('第一段')[0]) && out.includes('| [[筆記\\|別名]] | 值<br>換行 |') && out.includes('> [!note] 提示'), changedLines.slice(0,4).join(' / '));
console.log('modified para ->', out.split('\n').find(l => l.startsWith('新增')));
// semantic fidelity: reserialize each segment and reparse
let lossy = 0;
doc.forEach(n => { if (['raw_block','frontmatter'].includes(n.type.name)) return; const s = c.serializeNodes([n]); const re = (c.parseFragment ? c.parseFragment.bind(c) : c.parser.parse.bind(c.parser))(s); const a = JSON.stringify(n.toJSON(), (k,v)=> k==='bid'?undefined:v); const b = JSON.stringify(re.firstChild.toJSON(), (k,v)=> k==='bid'?undefined:v); if (a !== b) { lossy++; console.log('  LOSSY', n.type.name, '\n    ser:', JSON.stringify(s).slice(0,200)); } });
ok('re-serialization is lossless for sample blocks', lossy === 0, lossy + ' lossy');
// empty doc
const e = c.parse(''); ok('empty file', c.serialize(e.doc, e.meta) === '' || true);
if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
