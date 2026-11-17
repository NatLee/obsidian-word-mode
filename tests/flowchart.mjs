// Mermaid 流程圖 ⇄ 節點與連線的轉換測試
import { parseFlowchart, generateFlowchart, editableFlowchart, sameFlowchart, newNodeId, MERMAID_TEMPLATES } from '../src/flowchart.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + label + '  ' + extra); } else console.log('PASS ' + label); };

const basic = 'flowchart TD\n  A[開始] --> B{判斷}\n  B -->|是| C[結束]\n  B -- 否 --> D((圓))\n  D -.-> A\n  C ==> E([膠囊])\n  E --- F[(資料庫)]\n  F <--> G[[子流程]]\n  G --> H{{六角}} --> I[/輸入/]\n';
const m = parseFlowchart(basic);
ok('解析流程圖', m.ok, JSON.stringify(m));
ok('節點與形狀', m.nodes.map(n => n.id + ':' + n.shape).join(' ') === 'A:rect B:diamond C:rect D:circle E:stadium F:cylinder G:subroutine H:hexagon I:parallelogram', m.nodes.map(n => n.id + ':' + n.shape).join(' '));
ok('節點文字', m.nodes.map(n => n.text).join(',') === '開始,判斷,結束,圓,膠囊,資料庫,子流程,六角,輸入', m.nodes.map(n => n.text).join(','));
ok('連線與線型', m.edges.map(e => e.from + '>' + e.to + ':' + e.style + ':' + e.text).join(' ') === 'A>B:arrow: B>C:arrow:是 B>D:arrow:否 D>A:dotted: C>E:thick: E>F:line: F>G:both: G>H:arrow: H>I:arrow:', m.edges.map(e => e.from + '>' + e.to + ':' + e.style + ':' + e.text).join(' '));
ok('產生後再解析內容相同', sameFlowchart(m, parseFlowchart(generateFlowchart(m))), generateFlowchart(m));
ok('可以用表單編輯', editableFlowchart(basic).ok);

const g = parseFlowchart('graph LR;\n    A-->B;\n    B-->C;\n');
ok('graph LR 與行尾分號', g.ok && g.dir === 'LR' && g.keyword === 'graph' && g.edges.length === 2 && g.nodes.every(n => n.shape === 'rect' && n.text === n.id), JSON.stringify(g));
ok('graph 保留 graph 關鍵字', generateFlowchart(g).startsWith('graph LR'));

const q = parseFlowchart('flowchart TD\n  A["有 (括號) 與 [方括號]"] -->|"是/否?"| B("圓角 #quot;引號#quot;")\n');
ok('有引號的文字', q.ok && q.nodes[0].text === '有 (括號) 與 [方括號]' && q.nodes[1].text === '圓角 "引號"' && q.edges[0].text === '是/否?', JSON.stringify(q));
const gq = generateFlowchart(q);
ok('特殊符號會加引號', gq.includes('A["有 (括號) 與 [方括號]"]') && gq.includes('|"是/否?"|') && gq.includes('#quot;引號#quot;'), gq);
ok('有引號的文字往返相同', sameFlowchart(q, parseFlowchart(gq)));

const st = parseFlowchart('flowchart TD\n  %% 註解\n  A --> B\n  style A fill:#f9f,stroke:#333\n  classDef red fill:#f00\n  class B red\n  click A "https://example.com"\n');
ok('樣式、class、click、註解原樣保留', st.ok && st.extra.length === 5 && generateFlowchart(st).includes('style A fill:#f9f,stroke:#333'), JSON.stringify(st.extra));

for (const [name, src, reason] of [
  ['子圖', 'flowchart TD\n  subgraph 一\n    A --> B\n  end\n', 'subgraph'],
  ['A & B', 'flowchart TD\n  A & B --> C\n', 'multi'],
  ['linkStyle', 'flowchart TD\n  A --> B\n  linkStyle 0 stroke:red\n', 'linkStyle'],
  ['循序圖', 'sequenceDiagram\n  A->>B: hi\n', 'notFlowchart'],
  ['看不懂的形狀', 'flowchart TD\n  A>旗幟] --> B\n', 'syntax'],
  ['樣式類別 :::', 'flowchart TD\n  A:::red --> B\n', 'syntax'],
]) {
  const r = editableFlowchart(src);
  ok('不支援：' + name + '（改用程式碼）', !r.ok && r.reason === reason, JSON.stringify(r));
}

ok('新節點代號不重複', newNodeId({ nodes: [{ id: 'N1' }, { id: 'N3' }] }) === 'N4' && newNodeId({ nodes: [{ id: 'A' }, { id: 'N3' }] }) === 'N4' && newNodeId({ nodes: [] }) === 'N1');
ok('流程圖範本可以用表單編輯', editableFlowchart(MERMAID_TEMPLATES[0][1]).ok);
ok('多行文字用 <br>', (() => { const x = parseFlowchart('flowchart TD\n  A["第一行<br>第二行"]\n'); return x.ok && x.nodes[0].text === '第一行\n第二行' && generateFlowchart(x).includes('第一行<br>第二行'); })());
ok('中文節點代號', (() => { const x = parseFlowchart('flowchart LR\n  開始 --> 結束\n'); return x.ok && x.nodes.map(n => n.id).join() === '開始,結束'; })());

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
