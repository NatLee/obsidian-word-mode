// 使用者自己存的範本（公式、圖表）：資料操作的測試
import { cleanTemplates, saveTemplate, removeTemplate, moveTemplate, renameTemplate, editTemplate, uniqueName, MAX_TEMPLATES } from '../src/templates.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + label + '  ' + extra); } else console.log('PASS ' + label); };
const names = list => list.map(x => x.name).join(',');

// 讀設定檔
ok('不是陣列：當成沒有範本', cleanTemplates(null).length === 0 && cleanTemplates('x').length === 0 && cleanTemplates({ a: 1 }).length === 0);
const loaded = cleanTemplates([{ name: ' 甲 ', src: 'a\r\nb  \n' }, null, 'x', { name: '', src: 'x' }, { name: '乙', src: '   ' }, { name: '甲', src: '重複' }, { name: '丙', src: 'c' }, { src: '沒有名稱' }]);
ok('整理：去掉格式不對、空的、重複的', names(loaded) === '甲,丙', names(loaded));
ok('名稱或內容不是文字：丟掉', cleanTemplates([{ name: 5, src: 'x' }, { name: 'a', src: { b: 1 } }, { name: '好', src: 'y' }]).map(x => x.name).join() === '好');
ok('整理：名稱去頭尾空白、換行統一、去掉結尾空白', loaded[0].name === '甲' && loaded[0].src === 'a\nb', JSON.stringify(loaded[0]));
ok('最多 ' + MAX_TEMPLATES + ' 個', cleanTemplates(Array.from({ length: 300 }, (_, i) => ({ name: 'n' + i, src: 's' }))).length === MAX_TEMPLATES);

// 存
let list = [];
list = saveTemplate(list, '流程', 'flowchart TD\n    A --> B');
list = saveTemplate(list, '公式', 'x^2');
ok('新增加在最後', names(list) === '流程,公式');
const before = list;
list = saveTemplate(list, '流程', 'flowchart LR\n    A --> C\n\n');
ok('同名：換掉內容，位置不變', names(list) === '流程,公式' && list[0].src === 'flowchart LR\n    A --> C', JSON.stringify(list[0]));
ok('不改動傳進來的陣列', before[0].src === 'flowchart TD\n    A --> B' && before !== list);
ok('名稱或內容是空的不存', saveTemplate(list, '  ', 'x').length === 2 && saveTemplate(list, '新的', ' \n ').length === 2);
ok('名稱太長會截短', saveTemplate([], 'a'.repeat(100), 'x')[0].name.length === 60);
ok('內容裡的反斜線、引號原樣保留', saveTemplate([], 'tex', '\\frac{a}{b} "q"')[0].src === '\\frac{a}{b} "q"');

// 移動、刪除
list = saveTemplate(list, '第三', 'c');
ok('往前移', names(moveTemplate(list, 2, -1)) === '流程,第三,公式');
ok('往後移', names(moveTemplate(list, 0, 1)) === '公式,流程,第三');
ok('在邊上不動', names(moveTemplate(list, 0, -1)) === names(list) && names(moveTemplate(list, 2, 1)) === names(list) && names(moveTemplate(list, 9, 1)) === names(list));
ok('刪除', names(removeTemplate(list, 1)) === '流程,第三' && list.length === 3);

// 改名、改內容
ok('改名', names(renameTemplate(list, 1, ' 新公式 ')) === '流程,新公式,第三');
ok('改成別人的名稱或空的：不改', names(renameTemplate(list, 1, '流程')) === names(list) && names(renameTemplate(list, 1, '')) === names(list));
ok('改成自己原本的名稱可以', names(renameTemplate(list, 1, '公式')) === names(list));
ok('改內容', editTemplate(list, 1, 'y^3\n')[1].src === 'y^3' && list[1].src === 'x^2');
ok('內容清空：不改', editTemplate(list, 1, '  ')[1].src === 'x^2');

// 名稱
ok('沒用過的名稱直接用', uniqueName(list, '甘特圖') === '甘特圖');
ok('用過的加編號', uniqueName(list, '流程') === '流程 2' && uniqueName(saveTemplate(list, '流程 2', 'x'), '流程') === '流程 3');

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
