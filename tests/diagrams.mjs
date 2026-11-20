// 圖表 ⇄ 表單資料：九種圖表的解析、產生、不支援的寫法、圖上的文字對應到欄位（表單介面的操作測試在 tests/view/features.mjs）
import { DIAGRAM_KINDS, editableDiagram, detectKind, textSlots, findSlot, setValue, sameModel, parseDiagram, generateDiagram, lostContent, refName, restoreName, dropRefs, NODE_FILLS } from '../src/diagrams.js';
import { MERMAID_TEMPLATES } from '../src/flowchart.js';
// 各語言的翻譯（範本也會翻譯）：直接匯入字典，不經過 i18n.ts（它依賴 Obsidian）
import EN from '../src/i18n-en.js';
import JA from '../src/i18n-ja.js';
import KO from '../src/i18n-ko.js';
import NAN from '../src/i18n-nan.js';
import YUE from '../src/i18n-yue.js';
import ZH_CN from '../src/i18n-zh-cn.js';
import VI from '../src/i18n-vi.js';
import FR from '../src/i18n-fr.js';
import DE from '../src/i18n-de.js';
import ES from '../src/i18n-es.js';
import AR from '../src/i18n-ar.js';
import HE from '../src/i18n-he.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + label + '  ' + extra); } else console.log('PASS ' + label); };
const tr = s => s;
const kind = id => DIAGRAM_KINDS.find(k => k.id === id);
const edit = src => { const r = editableDiagram(src); if (!r.ok) throw new Error('不能用表單編輯：' + r.reason + '\n' + src); return r; };

// ---- 每一種範本都能用表單編輯，而且「讀進來再寫出去」內容不變
ok('十一種圖表', DIAGRAM_KINDS.length === 11 && MERMAID_TEMPLATES.length === 11);
for (const k of DIAGRAM_KINDS) {
  const r = editableDiagram(k.template);
  ok('範本可以用表單編輯：' + k.name, r.ok && r.kind === k, r.ok ? '' : r.reason);
  if (!r.ok) continue;
  const out = k.generate(r.model);
  const again = k.parse(out);
  ok('寫出去再讀回來一樣：' + k.name, typeof again !== 'string' && sameModel(r.model, again), out);
  ok('認得種類：' + k.name, detectKind(out) === k);
  // 每個清單都能新增一列，新增後仍然是讀得回來的圖
  for (const list of k.lists) {
    const m = k.parse(k.template);
    const row = list.make(m, tr);
    if (row.text === '') row.text = '說明'; // 沒有文字的說明不會寫出去
    m.lists[list.key].push(row);
    if (k.fix) k.fix(m);
    const grown = k.parse(k.generate(m));
    ok('新增一列（' + k.name + '・' + list.title + '）', typeof grown !== 'string' && grown.lists[list.key].length === m.lists[list.key].length, typeof grown === 'string' ? grown : k.generate(m));
  }
}

// ---- 循序圖
{
  const r = edit('sequenceDiagram\n    autonumber\n    actor 客戶 as 買家\n    客戶->>系統: 下單\n    Note right of 系統: 檢查庫存\n    系統-->>客戶: 完成\n    Note over 客戶,系統: 結束');
  const m = r.model;
  ok('循序圖：參與者（含沒有宣告的）', m.lists.people.map(p => p.name + ':' + p.type + ':' + p.alias).join(',') === '客戶:actor:買家,系統:participant:', JSON.stringify(m.lists.people));
  ok('循序圖：訊息與備註的順序', m.lists.steps.map(s => s.arrow).join(' ') === '->> note-right -->> note-over' && m.opts.autonumber === '1');
  const out = r.kind.generate(m);
  ok('循序圖：寫回程式碼', out === 'sequenceDiagram\n    autonumber\n    actor 客戶 as 買家\n    participant 系統\n    客戶->>系統: 下單\n    Note right of 系統: 檢查庫存\n    系統-->>客戶: 完成\n    Note over 客戶,系統: 結束', out);
  // 參與者改名：引用它的訊息一起改
  const name = r.kind.lists[0].fields[0];
  setValue(r.kind, m, { field: name, list: r.kind.lists[0], row: m.lists.people[1] }, '伺服器', true);
  ok('循序圖：參與者改名，訊息跟著改', r.kind.generate(m).includes('客戶->>伺服器: 下單') && r.kind.generate(m).includes('Note over 客戶,伺服器: 結束'), r.kind.generate(m));
  ok('循序圖：loop 區塊不能用表單', editableDiagram('sequenceDiagram\n    loop 每天\n    A->>B: hi\n    end').reason === 'blocks');
  ok('循序圖：啟動條的簡寫不能用表單', editableDiagram('sequenceDiagram\n    A->>+B: hi').reason === 'blocks');
}

// ---- 甘特圖
{
  const r = edit('gantt\n    title 時程\n    dateFormat YYYY-MM-DD\n    excludes weekends\n    section 規劃\n    需求 :done, a1, 2026-01-05, 5d\n    設計 :crit, active, after a1, 3d\n    section 開發\n    實作 :10d\n    上線 :milestone, m1, 2026-02-01, 0d');
  const m = r.model;
  ok('甘特圖：標題、日期格式、保留的設定', m.opts.title === '時程' && m.opts.dateFormat === 'YYYY-MM-DD' && m.extra.join() === 'excludes weekends');
  ok('甘特圖：工作的欄位', JSON.stringify(m.lists.tasks[0]) === JSON.stringify({ name: '需求', section: '規劃', status: 'done', id: 'a1', start: '2026-01-05', end: '5d' }), JSON.stringify(m.lists.tasks[0]));
  ok('甘特圖：兩個狀態、只有長度', m.lists.tasks[1].status === 'crit, active' && m.lists.tasks[1].start === 'after a1' && m.lists.tasks[2].end === '10d' && m.lists.tasks[2].section === '開發');
  const out = r.kind.generate(m);
  ok('甘特圖：寫回程式碼', out === 'gantt\n    title 時程\n    dateFormat YYYY-MM-DD\n    excludes weekends\n    section 規劃\n    需求 :done, a1, 2026-01-05, 5d\n    設計 :crit, active, after a1, 3d\n    section 開發\n    實作 :10d\n    上線 :milestone, m1, 2026-02-01, 0d', out);
  ok('甘特圖：click 不能用表單', editableDiagram('gantt\n    A :a1, 2026-01-01, 1d\n    click a1 href "https://x"').reason === 'blocks');
}

// ---- 圓餅圖
{
  const r = edit('pie showData title 佔比\n    "甲" : 45.5\n    "乙" : 30');
  ok('圓餅圖：標題與數值', r.model.opts.title === '佔比' && r.model.opts.showData === '1' && r.model.lists.slices[0].value === '45.5');
  r.model.lists.slices[1].label = '丙 "引號"';
  ok('圓餅圖：寫回程式碼（引號換掉）', r.kind.generate(r.model) === 'pie showData title 佔比\n    "甲" : 45.5\n    "丙 \'引號\'" : 30', r.kind.generate(r.model));
  ok('圓餅圖：標題寫在第二行也可以', edit('pie\n    title 佔比\n    "甲" : 1').model.opts.title === '佔比');
}

// ---- 狀態圖
{
  const r = edit('stateDiagram-v2\n    direction LR\n    [*] --> 待處理\n    待處理 --> 進行中 : 開始\n    進行中 : 正在處理\n    進行中 --> [*]');
  const m = r.model;
  ok('狀態圖：轉換與說明', m.lists.moves.length === 3 && m.lists.moves[1].text === '開始' && m.lists.states[0].text === '正在處理' && m.opts.dir === 'LR');
  // 在圖上把狀態改名：所有出現的地方一起改
  const slot = findSlot(textSlots(r.kind, m), '進行中');
  setValue(r.kind, m, slot, '處理中', true);
  const out = r.kind.generate(m);
  ok('狀態圖：在圖上改名，全部一起改', out === 'stateDiagram-v2\n    direction LR\n    處理中 : 正在處理\n    [*] --> 待處理\n    待處理 --> 處理中 : 開始\n    處理中 --> [*]', out);
  ok('狀態圖：子狀態不能用表單', editableDiagram('stateDiagram-v2\n    state 外層 {\n        [*] --> a\n    }').reason === 'blocks');
  // 套用樣式的 :::：以前「A:::warn --> B」被讀成 A 的說明文字，寫回去是「A : ::warn --> B」，轉換不見了
  for (const src of ['stateDiagram-v2\n    A:::warn --> B', 'stateDiagram-v2\n    A --> B:::warn', 'stateDiagram-v2\n    A --> B\n    B:::warn']) {
    ok('狀態圖：套用樣式（:::）不能用表單：' + src.split('\n')[1].trim(), editableDiagram(src).reason === 'blocks', JSON.stringify(editableDiagram(src).model));
  }
}

// ---- 類別圖
{
  const r = edit('classDiagram\n    class 訂單 {\n        +編號\n        +送出()\n    }\n    客戶 "1" --> "*" 訂單 : 下單\n    動物 <|-- 狗\n    狗 : +叫()');
  const m = r.model;
  ok('類別圖：類別與成員', m.lists.classes.map(c => c.name).join(',') === '訂單,客戶,動物,狗' && m.lists.classes[0].members === '+編號\n+送出()' && m.lists.classes[3].members === '+叫()');
  ok('類別圖：關係與數量', JSON.stringify(m.lists.relations[0]) === JSON.stringify({ a: '客戶', ca: '1', type: '-->', cb: '*', b: '訂單', text: '下單' }) && m.lists.relations[1].type === '<|--');
  const out = r.kind.generate(m);
  ok('類別圖：寫回程式碼', out.includes('    class 訂單 {\n        +編號\n        +送出()\n    }') && out.includes('    class 客戶\n') && out.includes('    客戶 "1" --> "*" 訂單 : 下單') && out.includes('    動物 <|-- 狗'), out);
  ok('類別圖：成員的文字可以從圖上找到', findSlot(textSlots(r.kind, m), '+送出()').line === 1);
  ok('類別圖：以 class 開頭的類別名稱', edit('classDiagram\n    classA <|-- classB').model.lists.relations.length === 1);
  ok('類別圖：namespace 不能用表單', editableDiagram('classDiagram\n    namespace N {\n    class A\n    }').ok === false);
  // 關係的符號緊貼著類別名稱：以前被讀成一個叫「Animal<|--Dog」的類別，成員是 inherits，寫回去關係就不見了
  const lone = editableDiagram('classDiagram\n    Animal<|--Dog : inherits');
  ok('類別圖：Animal<|--Dog : inherits 是關係，不是類別的成員', lone.ok && lone.model.lists.relations.length === 1 && lone.kind.generate(lone.model) === 'classDiagram\n    class Animal\n    class Dog\n    Animal <|-- Dog : inherits', lone.ok ? lone.kind.generate(lone.model) : lone.reason);
  const tight = edit('classDiagram\n    Animal<|--Dog : inherits\n    客戶"1"-->"*"訂單\n    A ..|>B');
  ok('類別圖：關係緊貼著名稱也讀得出來', tight.model.lists.classes.map(c => c.name).join(',') === 'Animal,Dog,客戶,訂單,A,B' && tight.model.lists.classes.every(c => !c.members)
    && JSON.stringify(tight.model.lists.relations[0]) === JSON.stringify({ a: 'Animal', ca: '', type: '<|--', cb: '', b: 'Dog', text: 'inherits' })
    && JSON.stringify(tight.model.lists.relations[1]) === JSON.stringify({ a: '客戶', ca: '1', type: '-->', cb: '*', b: '訂單', text: '' }) && tight.model.lists.relations[2].type === '..|>', JSON.stringify(tight.model.lists));
  const tightOut = tight.kind.generate(tight.model);
  ok('類別圖：緊貼的關係寫回去還是關係', tightOut.includes('    Animal <|-- Dog : inherits') && tightOut.includes('    客戶 "1" --> "*" 訂單') && !tightOut.includes('{'), tightOut);
  for (const [name, src] of [
    ['名稱裡有關係的符號', 'classDiagram\n    A<|--|>B : x'], ['分不出是不是聚合', 'classDiagram\n    Zoo--Dog'], ['名稱裡有引號', 'classDiagram\n    A"1" : +x'],
    ['class 後面的名稱有關係的符號', 'classDiagram\n    class A<|--B'], ['套用樣式的寫法', 'classDiagram\n    class A:::warn'],
  ]) ok('類別圖：' + name + '就改用程式碼', editableDiagram(src).ok === false, JSON.stringify(editableDiagram(src).model));
}

// ---- 心智圖
{
  const r = edit('mindmap\n  root((主題))\n    分支一\n      細項\n    [方形]\n    分支三');
  const m = r.model;
  ok('心智圖：階層', m.lists.nodes.map(n => n.level).join('') === '01211' && m.lists.nodes[0].shape === 'circle' && m.lists.nodes[0].id === 'root' && m.lists.nodes[3].shape === 'square');
  // 階層不能一次跳兩層；第一個一定是中心主題
  m.lists.nodes[2].level = '5';
  m.lists.nodes[4].level = '0';
  r.kind.fix(m);
  ok('心智圖：整理階層', m.lists.nodes.map(n => n.level).join('') === '01211', m.lists.nodes.map(n => n.level).join(''));
  const child = r.kind.lists[0].actions[0].run(m, m.lists.nodes[1], tr);
  ok('心智圖：新增子分支', m.lists.nodes.indexOf(child) === 2 && child.level === '2');
  const out = r.kind.generate(m);
  ok('心智圖：寫回程式碼', out === 'mindmap\n  root((主題))\n    分支一\n      新分支\n      細項\n    [方形]\n    分支三', out);
  ok('心智圖：圖示不能用表單', editableDiagram('mindmap\n  root\n    A\n    ::icon(fa fa-book)').reason === 'blocks');
  // 文字裡有括號要加引號：以前引號讀進來就拿掉，寫回去是 root((計畫 (2026)))，Mermaid 畫不出來
  const src = 'mindmap\n  root(("計畫 (2026)"))\n    子題\n    id["a [b]"]\n    "引號"';
  const q = edit(src);
  ok('心智圖：有引號的文字（表單裡不顯示引號）', q.model.lists.nodes[0].text === '計畫 (2026)' && q.model.lists.nodes[0].shape === 'circle' && q.model.lists.nodes[2].text === 'a [b]', JSON.stringify(q.model.lists.nodes));
  ok('心智圖：有括號的文字寫回去還有引號', q.kind.generate(q.model) === src, q.kind.generate(q.model));
  ok('心智圖：沒有形狀的節點整行原樣保留', q.model.lists.nodes[3].text === '"引號"' && q.model.lists.nodes[3].shape === 'default');
  q.model.lists.nodes[1].shape = 'round';
  q.model.lists.nodes[1].text = '子題 (一)';
  ok('心智圖：在表單打了括號也會加引號', q.kind.generate(q.model).includes('\n    ("子題 (一)")\n') && editableDiagram(q.kind.generate(q.model)).ok, q.kind.generate(q.model));
}

// ---- 時間軸
{
  const r = edit('timeline\n    title 里程碑\n    section 第一階段\n    2025 : 啟動 : 招募\n         : 設計\n    2026 : 上線');
  const m = r.model;
  ok('時間軸：時間點與事件（含接續的事件）', m.lists.periods[0].events === '啟動\n招募\n設計' && m.lists.periods[1].section === '第一階段' && m.opts.title === '里程碑');
  const out = r.kind.generate(m);
  ok('時間軸：寫回程式碼', out === 'timeline\n    title 里程碑\n    section 第一階段\n    2025 : 啟動 : 招募 : 設計\n    2026 : 上線', out);
}

// ---- ER 圖（Mermaid 規定：不是英數字的實體名稱與關係說明要加引號；欄位的型別與名稱只能用英數字）
{
  const src = 'erDiagram\n    "客戶" ||--o{ ORDER : "下單"\n    ORDER ||..|{ "訂單 明細" : contains\n    "客戶" {\n        string name "姓名"\n        int age PK\n    }\n    "倉庫"';
  const r = edit(src);
  const m = r.model;
  ok('ER 圖：實體與欄位（名稱不含引號）', m.lists.entities.map(e => e.name).join(',') === '客戶,ORDER,訂單 明細,倉庫' && m.lists.entities[0].attrs === 'string name "姓名"\nint age PK', JSON.stringify(m.lists.entities));
  ok('ER 圖：關係', m.lists.relations[0].text === '下單' && m.lists.relations[1].left === '||' && m.lists.relations[1].line === '..' && m.lists.relations[1].right === '|{' && m.lists.relations[1].b === '訂單 明細');
  const out = r.kind.generate(m);
  ok('ER 圖：寫回程式碼（中文加引號、英文不加）', out === 'erDiagram\n    "客戶" ||--o{ ORDER : "下單"\n    ORDER ||..|{ "訂單 明細" : contains\n    "客戶" {\n        string name "姓名"\n        int age PK\n    }\n    "倉庫"', out);
  // 在圖上把實體改名：關係裡的名稱一起改
  setValue(r.kind, m, findSlot(textSlots(r.kind, m), '客戶'), '會員', true);
  ok('ER 圖：實體改名，關係跟著改', r.kind.generate(m).startsWith('erDiagram\n    "會員" ||--o{ ORDER : "下單"') && r.kind.generate(m).includes('    "會員" {'), r.kind.generate(m));
  // 刪除實體：連到它的關係也刪掉
  r.kind.lists[0].onDelete(m, m.lists.entities[2]);
  ok('ER 圖：刪除實體時刪掉關係', m.lists.relations.length === 1);
  ok('ER 圖：範本的中文名稱有加引號', r.kind.template.includes('"客戶" ||--o{ "訂單" : "下單"'));
}

// ---- 流程圖：開頭的註解與設定會保留
{
  const r = edit('%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart LR\n    A[開始] --> B{判斷}\n    style A fill:#f9f');
  ok('流程圖：開頭的設定保留', r.model.pre.join() === '%%{init: {"flowchart": {"curve": "linear"}}}%%' && r.model.extra.join() === 'style A fill:#f9f');
  const out = r.kind.generate(r.model);
  ok('流程圖：寫回程式碼', out === '%%{init: {"flowchart": {"curve": "linear"}}}%%\nflowchart LR\n    A[開始]\n    B{判斷}\n    A --> B\n    style A fill:#f9f', out);
  const next = r.kind.lists[0].actions[0].run(r.model, r.model.lists.nodes[1], tr);
  ok('流程圖：新增下一步', next.id === 'N3' && r.model.lists.edges[1].from === 'B' && r.model.lists.edges[1].to === 'N3');
  r.kind.lists[0].onDelete(r.model, r.model.lists.nodes[0]);
  ok('流程圖：刪除步驟時刪掉連線', r.model.lists.edges.length === 1);
  ok('流程圖：子圖不能用表單', editableDiagram('flowchart TD\n    subgraph S\n    A --> B\n    end').reason === 'subgraph');
}

// ---- 不認得的圖表、圖上的文字
ok('不認得的圖表種類', editableDiagram('gitGraph\n    commit').reason === 'unknownKind' && detectKind('gitGraph') === null);
{
  const r = edit('pie showData title 佔比\n    "項目一" : 45\n    "項目二" : 30');
  const slots = textSlots(r.kind, r.model);
  ok('圖上的文字：完全相同', findSlot(slots, '項目二').row === r.model.lists.slices[1]);
  ok('圖上的文字：後面多了數值也找得到', findSlot(slots, '項目一 [45]').row === r.model.lists.slices[0]);
  ok('圖上的文字：圖表的標題', findSlot(slots, '佔比').row === null && findSlot(slots, '佔比').field.key === 'title');
  ok('圖上的文字：找不到', findSlot(slots, '45%') === null);
  const f = edit('flowchart TD\n    A[是] --> B[是]');
  ok('圖上的文字：同樣的文字依出現的順序', findSlot(textSlots(f.kind, f.model), '是', 1).row === f.model.lists.nodes[1]);
}

// ---- 圖表的外觀：最前面的一行 %%{init: {"theme": "…"}}%%
{
  const r = edit('%%{init: {"theme": "forest"}}%%\n%% 註解\npie title 佔比\n    "甲" : 1');
  ok('外觀：從開頭的設定讀出來，其他註解留著', r.model.opts.theme === 'forest' && r.model.pre.join() === '%% 註解');
  ok('外觀：寫回最前面', generateDiagram(r.kind, r.model) === '%%{init: {"theme": "forest"}}%%\n%% 註解\npie title 佔比\n    "甲" : 1', generateDiagram(r.kind, r.model));
  r.model.opts.theme = '';
  ok('外觀：改回跟著 Obsidian 就不寫那一行', generateDiagram(r.kind, r.model) === '%% 註解\npie title 佔比\n    "甲" : 1');
  const other = edit('%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ff0000"}}}%%\npie\n    "甲" : 1');
  ok('外觀：設定裡還有別的東西時原樣保留，不當成外觀', other.model.opts.theme === undefined && other.model.pre.length === 1);
  const k = kind('sequence');
  const m = parseDiagram(k, k.template);
  m.opts.theme = 'dark';
  ok('外觀：每一種圖表都可以設定', generateDiagram(k, m).startsWith('%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n') && editableDiagram(generateDiagram(k, m)).model.opts.theme === 'dark');
}

// ---- 流程圖節點的底色
{
  const fill = NODE_FILLS[0][0];
  const r = edit('flowchart TD\n    A[開始] --> B[結束]\n    style A fill:' + fill + '\n    style B fill:#f9f,stroke:#333\n    style A stroke-width:4px');
  ok('底色：只有底色的 style 行讀成節點的底色，其他 style 行原樣保留', r.model.lists.nodes[0].fill === fill && r.model.lists.nodes[1].fill === '' && r.model.extra.join('|') === 'style B fill:#f9f,stroke:#333|style A stroke-width:4px', JSON.stringify(r.model.extra));
  r.model.lists.nodes[1].fill = NODE_FILLS[5][0];
  const out = r.kind.generate(r.model);
  ok('底色：寫成底色＋框線＋字色', out.includes('    style A fill:#ffe3e3,stroke:#9e8d8d,color:#1f2328\n    style B fill:#d0ebff,stroke:#81929e,color:#1f2328\n    style B fill:#f9f,stroke:#333'), out);
  const again = edit(out);
  ok('底色：寫出去再讀回來一樣', again.model.lists.nodes.map(n => n.fill).join() === '#ffe3e3,#d0ebff' && again.model.extra.length === 2);
  again.model.lists.nodes[0].fill = '';
  ok('底色：改回預設就不寫 style', !again.kind.generate(again.model).includes('style A fill'));
}

// ---- 旅程圖
{
  const r = edit('journey\n    title 我的一天\n    section 上午\n      泡茶: 5: 我\n      開會: 2: 我,同事\n    section 下午\n      寫報告: 3');
  const m = r.model;
  ok('旅程圖：步驟、分數、參與的人、區段', JSON.stringify(m.lists.steps[1]) === JSON.stringify({ section: '上午', name: '開會', score: '2', actors: '我, 同事' }) && m.lists.steps[2].actors === '' && m.lists.steps[2].section === '下午', JSON.stringify(m.lists.steps));
  const out = r.kind.generate(m);
  ok('旅程圖：寫回程式碼', out === 'journey\n    title 我的一天\n    section 上午\n      泡茶: 5: 我\n      開會: 2: 我, 同事\n    section 下午\n      寫報告: 3', out);
  ok('旅程圖：分數不是 1～5 就改用程式碼', editableDiagram('journey\n    泡茶: 9: 我').reason === 'syntax');
}

// ---- 象限圖（Mermaid 規定：座標軸、象限、項目的名稱不是英數字就要加引號，標題不用）
{
  const r = edit('quadrantChart\n    title 優先順序\n    x-axis "不急" --> "很急"\n    y-axis Low --> High\n    quadrant-1 "馬上做"\n    quadrant-3 Later\n    "寫報告": [0.8, 0.9]\n    Inbox: [.3, 0.2]');
  const m = r.model;
  ok('象限圖：座標軸與象限', m.opts.title === '優先順序' && m.opts.x1 === '不急' && m.opts.x2 === '很急' && m.opts.y1 === 'Low' && m.opts.q1 === '馬上做' && m.opts.q3 === 'Later' && m.opts.q2 === undefined);
  ok('象限圖：項目與位置', JSON.stringify(m.lists.points) === JSON.stringify([{ name: '寫報告', x: '0.8', y: '0.9' }, { name: 'Inbox', x: '0.3', y: '0.2' }]), JSON.stringify(m.lists.points));
  m.lists.points[1].x = '7';
  const out = r.kind.generate(m);
  ok('象限圖：寫回程式碼（名稱加引號、超出範圍的位置改成 0.5）', out === 'quadrantChart\n    title 優先順序\n    x-axis "不急" --> "很急"\n    y-axis "Low" --> "High"\n    quadrant-1 "馬上做"\n    quadrant-3 "Later"\n    "寫報告": [0.8, 0.9]\n    "Inbox": [0.5, 0.2]', out);
  ok('象限圖：圖上的象限名稱對應到設定', findSlot(textSlots(r.kind, m), '馬上做').field.key === 'q1');
  ok('象限圖：點的樣式不能用表單', editableDiagram('quadrantChart\n    A: [0.1, 0.2] radius: 12').ok === false);
}

// ---- 寫回去的程式碼不能比原本少東西（editableDiagram 的第二道檢查）
// 「讀進來 → 寫出去 → 再讀一次」資料相同，看不出第一次讀的時候就丟掉的東西；所以另外拿原始碼跟寫出去的程式碼比
{
  // 少了東西：列出少掉的片段
  for (const [name, src, out, lost] of [
    ['連線變短', 'flowchart TD\n  A ---> B', 'flowchart TD\n    A[A]\n    B[B]\n    A --> B', '--->'],
    ['虛線變短', 'flowchart TD\n  A -..-> B', 'flowchart TD\n    A[A]\n    B[B]\n    A -.-> B', '-..->'],
    ['文字不見', 'sequenceDiagram\n  A->>B: 你好 world', 'sequenceDiagram\n    participant A\n    participant B\n    A->>B: 你好', 'world'],
    ['數字不見', 'pie\n  "甲" : 45', 'pie\n    "甲" : 4', '45'],
    ['關係的符號變了', 'classDiagram\n  A <|-- B', 'classDiagram\n    class A\n    class B\n    A <-- B', '<|--'],
    ['關鍵字不見', 'sequenceDiagram\n  autonumber\n  A->>B: hi', 'sequenceDiagram\n    participant A\n    participant B\n    A->>B: hi', 'autonumber'],
  ]) ok('少了東西：' + name, lostContent(src, out).join() === lost, JSON.stringify(lostContent(src, out)));
  // 表單本來就會做的重排不算少：縮排、空白、引號、節點與連線分開寫、補上宣告、同一個方向的兩種寫法
  for (const [name, src, out] of [
    ['節點與連線分開寫', 'flowchart TD\n  A[開始]-->B{判斷};', 'flowchart TD\n    A[開始]\n    B{判斷}\n    A --> B'],
    ['線上文字的另一種寫法', 'flowchart TD\n  A -- 否 --> B\n  A -. 也許 .-> B\n  A == 好 ==> B', 'flowchart TD\n    A[A]\n    B[B]\n    A -->|否| B\n    A -.->|也許| B\n    A ==>|好| B'],
    ['不需要的引號', 'flowchart TD\n  A["開始"] --> B', 'flowchart TD\n    A[開始]\n    B[B]\n    A --> B'],
    ['TB 與 TD', 'graph TB\n  A --> B', 'graph TD\n    A[A]\n    B[B]\n    A --> B'],
    ['<br/> 與 <br>', 'flowchart TD\n  A["一<br/>二"]', 'flowchart TD\n    A["一<br>二"]'],
    ['同一個節點寫兩次', 'flowchart TD\n  A[開始] --> B[處理]\n  B[處理] --> C', 'flowchart TD\n    A[開始]\n    B[處理]\n    C[C]\n    A --> B\n    B --> C'],
    ['冒號前後的空白', 'pie\n  "甲？":45', 'pie\n    "甲？" : 45'],
    ['備註的大小寫、箭頭旁的空白', 'sequenceDiagram\n  note over A,B: 好\n  A --x B: 不', 'sequenceDiagram\n    participant A\n    participant B\n    Note over A,B: 好\n    A--xB: 不'],
    ['成員寫在冒號後面', 'classDiagram\n  狗:+叫()', 'classDiagram\n    class 狗 {\n        +叫()\n    }'],
  ]) ok('不算少：' + name, !lostContent(src, out).length, JSON.stringify(lostContent(src, out)));

  // 表單只會留下一部分的寫法：以前照樣開表單，一改就少東西
  for (const [name, src] of [
    ['甘特圖：底下沒有工作的 section', 'gantt\n    section 規劃\n    需求 :a1, 2026-01-05, 5d\n    section 之後再排'],
    ['流程圖：同一個節點前後寫了兩種文字', 'flowchart TD\n    A[草稿] --> B[結束]\n    A[定稿] --> B'],
    ['旅程圖：底下沒有步驟的 section', 'journey\n    section 上午\n      泡茶: 5: 我\n    section 下午'],
  ]) { const r = editableDiagram(src); ok('會少東西就不開表單：' + name, !r.ok && r.reason === 'roundtrip', r.ok ? r.kind.generate(r.model) : r.reason); }

  // 不能誤擋：每一種語言的每一個範本都要能開表單
  const DICTS = { en: EN, ja: JA, ko: KO, nan: NAN, yue: YUE, 'zh-cn': ZH_CN, vi: VI, fr: FR, de: DE, es: ES, ar: AR, he: HE };
  const blocked = [];
  for (const [lang, dict] of Object.entries(DICTS)) for (const k of DIAGRAM_KINDS) {
    const r = editableDiagram(dict[k.template] || '');
    if (!r.ok || r.kind !== k) blocked.push(lang + ' ' + k.id + '（' + (r.ok ? '種類不對' : r.reason) + '）');
  }
  ok('十二種語言的範本都能用表單編輯', !blocked.length, blocked.join('、'));
  // 常見的寫法（Mermaid 文件裡的例子）也都要能開
  for (const src of [
    'flowchart LR\n    A-->B\n    A---C\n    A-- text ---D\n    A---|This is the text|E\n    A-->|text|F\n    A-- text -->G\n    A-.->H\n    A-. text .-> I\n    A ==> J\n    A == text ==> K',
    'graph TD;\n    A[Christmas] -->|Get money| B(Go shopping);\n    B --> C{Let me think};\n    C -->|One| D[Laptop];\n    C -->|Two| E["A dec char:#9829; (#quot;quoted#quot;)"];',
    '%%{init: {\'theme\': \'forest\'}}%%\n%% 註解\nflowchart TB\n    Start --> Stop\n    style Start fill:#F9F,stroke:#333,stroke-width:4px\n    click Stop "https://example.com/a?b=1&c=2"',
    'sequenceDiagram\n    participant A as Alice\n    actor J as John\n    A->>J: Hello John, how are you?\n    J-->>A: Great!\n    A-)J: See you later!\n    J--xA: no\n    A -x J : bye\n    Note right of J: Text in note\n    note over A,J: A typical interaction<br/>But now in two lines',
    'gantt\n    title A Gantt Diagram\n    dateFormat  YYYY-MM-DD HH:mm\n    axisFormat %m/%d\n    excludes weekends\n    section Section\n        A task          :a1, 2014-01-01 10:00, 30d\n        Another task    :crit, active, after a1, 20d\n    section Another\n        Task in Another :done, 2014-01-12, 12d\n        another task    :24d',
    'pie showData\n    title Key elements in Product X\n    "Calcium" : 42.96\n    "Iron" :  5',
    'stateDiagram\n    direction TD\n    [*]-->Still\n    Still-->[*]\n    Still-->Moving:go!\n    s2 : This is a state description\n    state "Another: description" as s3\n    s2 --> s3: A transition',
    'classDiagram-v2\n    direction TD\n    Animal <|-- Duck\n    Customer "1" --> "1..*" Ticket : buys\n    Animal : +int age\n    Animal: +isMammal()\n    Animal:+mate()\n    class Duck{\n        +String beakColor\n        +swim()\n    }\n    class Square~Shape~{\n        List~int~ position\n        getPoints() List~int~\n    }\n    classE o-- classF\n    classM <|.. classN',
    'mindmap\n    id[I am a square]\n      id2(I am a rounded square)\n      id3((I am a circle))\n      id4))I am a bang((\n      id5)I am a cloud(\n      id6{{I am a hexagon}}\n      I am the default shape\n        On effectiveness<br/>and features',
    'timeline\n    title Timeline of Industrial Revolution\n    section 17th-20th century\n        Industry 1.0 : Machinery, Water power, Steam <br>power\n        2004 : Facebook\n             : Google\n    section 21st century\n        Industry 4.0 : Internet, Robotics',
    'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses\n    A |o--o| B : "zero or one"\n    PERSON {\n        string firstName\n        int age "years, >= 18"\n    }\n    ALONE',
    'journey\n    title My working day\n    section Go to work\n      Make tea: 5: Me\n      Do work: 1: Me,Cat\n    section Go home\n      Sit down: 5',
    'quadrantChart\n    title Reach and engagement of campaigns\n    x-axis Low Reach --> High Reach\n    y-axis Low Engagement --> High Engagement\n    quadrant-1 We should expand\n    quadrant-4 May be improved\n    Campaign A: [0.3, 0.6]\n    Campaign E: [0.40, 1.0]\n    "Campaign F": [.35, 0.78]',
  ]) { const r = editableDiagram(src); ok('常見的寫法能開表單：' + src.split('\n').find(l => !l.startsWith('%%')), r.ok, r.ok ? '' : r.reason + ' ' + JSON.stringify(lostContent(src, generateDiagram(r.kind, parseDiagram(r.kind, src))))); }

  // 為了不少東西而跟著原本寫法的三個地方
  const st = edit('stateDiagram-v2\n    state "處理中的訂單" as s1\n    s2 : 完成\n    s1 --> s2');
  ok('狀態圖：state "說明" as 名稱 照同樣的寫法寫回去', st.kind.generate(st.model) === 'stateDiagram-v2\n    state "處理中的訂單" as s1\n    s2 : 完成\n    s1 --> s2' && st.model.lists.states[0].text === '處理中的訂單', st.kind.generate(st.model));
  const cv = edit('classDiagram-v2\n    A <|-- B');
  ok('類別圖：classDiagram-v2 照樣寫回去', cv.kind.generate(cv.model).startsWith('classDiagram-v2\n') && edit('classDiagram\n    A <|-- B').kind.generate(edit('classDiagram\n    A <|-- B').model).startsWith('classDiagram\n'), cv.kind.generate(cv.model));
  const qd = edit('quadrantChart\n    "甲": [0.50, 1.0]');
  ok('象限圖：位置照原本的寫法（0.50、1.0）', qd.kind.generate(qd.model) === 'quadrantChart\n    "甲": [0.50, 1.0]', qd.kind.generate(qd.model));
}

// ---- 改名不能讓引用它的列消失
// 表單的名稱欄位每打一個字就改一次（setValue 的 everywhere = true）。把名稱一個字一個字刪掉再重打，中間會經過空字串，
// 也可能經過另一列的名稱；以前這兩種情況都會把引用它的列弄丟或混在一起
{
  const def = list => list.fields.find(f => f.def);
  const type = (r, list, row, values) => { for (const v of values) setValue(r.kind, r.model, { field: def(list), list, row }, v, true); };
  const r = edit('sequenceDiagram\n    participant Alice\n    participant Bob\n    Alice->>Bob: hi\n    Bob-->>Alice: yo');
  const people = r.kind.lists[0];
  const alice = r.model.lists.people[0];
  type(r, people, alice, ['Alic', 'Ali', 'Al', 'A', '']);
  ok('循序圖：名稱清空時訊息還在，還是用原本最後能用的名稱', r.kind.generate(r.model) === 'sequenceDiagram\n    participant Bob\n    A->>Bob: hi\n    Bob-->>A: yo' && refName(alice) === 'A', r.kind.generate(r.model));
  ok('循序圖：名稱清空時，訊息的選單裡還找得到它', r.kind.lists[1].fields[0].options(r.model, tr).map(o => o[0]).join() === 'A,Bob');
  type(r, people, alice, ['C', 'Ca', 'Car', 'Carl']);
  ok('循序圖：清空再重打，訊息一則都沒少', r.kind.generate(r.model) === 'sequenceDiagram\n    participant Carl\n    participant Bob\n    Carl->>Bob: hi\n    Bob-->>Carl: yo', r.kind.generate(r.model));
  // 改成 Bobby 會先經過 Bob（另一個參與者的名稱）
  type(r, people, alice, ['B', 'Bo', 'Bob']);
  ok('循序圖：暫時跟別人同名時，兩邊的訊息沒有混在一起', r.model.lists.steps.map(s => s.from + '>' + s.to).join() === 'Bo>Bob,Bob>Bo' && refName(alice) === 'Bo' && alice.name === 'Bob', JSON.stringify(r.model.lists.steps));
  type(r, people, alice, ['Bobb', 'Bobby']);
  ok('循序圖：經過別人的名稱再改完，只有自己的訊息跟著改', r.kind.generate(r.model) === 'sequenceDiagram\n    participant Bobby\n    participant Bob\n    Bobby->>Bob: hi\n    Bob-->>Bobby: yo', r.kind.generate(r.model));
  // 離開輸入框時名稱還不能用：改回去
  type(r, people, alice, ['']);
  ok('循序圖：名稱空著就離開，改回原本的名稱', restoreName(def(people), alice) === true && alice.name === 'Bobby' && restoreName(def(people), alice) === false && editableDiagram(r.kind.generate(r.model)).ok, JSON.stringify(alice));
  // 名稱改到一半時刪掉這一列：刪的是它自己的訊息，不是暫時同名的那一列的
  const d = edit('sequenceDiagram\n    A->>B: 1\n    B->>C: 2\n    C->>A: 3');
  type(d, d.kind.lists[0], d.model.lists.people[0], ['B']);
  dropRefs(d.kind.lists[0], d.model, d.model.lists.people[0]);
  ok('循序圖：改名到一半刪掉參與者，只刪它自己的訊息', d.model.lists.steps.map(s => s.text).join() === '2', JSON.stringify(d.model.lists.steps));

  // 類別圖、ER 圖的名稱欄位是同一套做法
  const c = edit('classDiagram\n    class Animal {\n        +name\n    }\n    Animal <|-- Dog : is');
  type(c, c.kind.lists[0], c.model.lists.classes[0], ['Anima', '', 'P', 'Pe', 'Pet']);
  ok('類別圖：清空再重打，關係與成員都還在', c.kind.generate(c.model) === 'classDiagram\n    class Pet {\n        +name\n    }\n    class Dog\n    Pet <|-- Dog : is', c.kind.generate(c.model));
  type(c, c.kind.lists[0], c.model.lists.classes[0], ['Dog']);
  ok('類別圖：跟另一個類別同名時關係不變', c.model.lists.relations[0].a === 'Pet' && c.model.lists.relations[0].b === 'Dog');
  restoreName(def(c.kind.lists[0]), c.model.lists.classes[0]);
  const e = edit('erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    CUSTOMER {\n        string name\n    }');
  type(e, e.kind.lists[0], e.model.lists.entities[0], ['', 'C', 'CLIENT']);
  ok('ER 圖：清空再重打，關係與欄位都還在', e.kind.generate(e.model) === 'erDiagram\n    CLIENT ||--o{ ORDER : places\n    CLIENT {\n        string name\n    }', e.kind.generate(e.model));

  // 在圖上把名稱清空（狀態圖沒有「定義」的清單，每個轉換各自寫名稱）：只清那一格，其他轉換不受影響
  const s = edit('stateDiagram-v2\n    A --> B\n    B --> C\n    C --> B');
  setValue(s.kind, s.model, findSlot(textSlots(s.kind, s.model), 'B'), '', true);
  ok('狀態圖：在圖上清空名稱，其他轉換還在', s.kind.generate(s.model) === 'stateDiagram-v2\n    B --> C\n    C --> B' && s.model.lists.moves[0].from === 'A' && s.model.lists.moves[0].to === '', s.kind.generate(s.model));
  // 區段本來就可以不填：在圖上清空，同一個區段的工作一起離開區段
  const g = edit('gantt\n    section 規劃\n    需求 :a1, 2026-01-05, 5d\n    設計 :3d');
  setValue(g.kind, g.model, findSlot(textSlots(g.kind, g.model), '規劃'), '', true);
  ok('甘特圖：在圖上清空區段，工作都還在', g.kind.generate(g.model) === 'gantt\n    需求 :a1, 2026-01-05, 5d\n    設計 :3d', g.kind.generate(g.model));
}

console.log(fails ? '\n' + fails + ' 個測試失敗' : '\nALL PASS');
if (fails) process.exitCode = 1;
