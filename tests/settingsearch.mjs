// 設定頁的搜尋：比對、排序、標出符合的位置
import { searchSettings, fold, queryTokens } from '../src/settingsearch.js';

let fails = 0;
const ok = (label, cond, extra = '') => { if (!cond) { fails++; console.log('FAIL ' + label + '  ' + extra); } else console.log('PASS ' + label); };
const doc = (name, desc = '', terms = [], alt = []) => ({ name, desc, terms, alt });
const names = hits => hits.map(h => h.doc.name).join(',');
const marked = (text, ranges) => ranges.map(r => text.slice(r.from, r.to)).join('|');

const DOCS = [
  doc('介面語言', 'Word 模式的按鈕、選單與提示文字使用的語言。', ['自動（跟隨 Obsidian）', 'English'], [{ name: 'Interface language', desc: 'The language used by buttons.' }]),
  doc('全寬頁面', '關閉時以 A4 紙張寬度顯示，開啟時使用整個視窗寬度。', [], [{ name: 'Full-width page', desc: 'When off, pages are A4 width.' }]),
  doc('頁面縮放', '也可以用 Ctrl+滑鼠滾輪，或右下角的縮放列調整。', [], [{ name: 'Page zoom', desc: 'You can also use Ctrl+mouse wheel.' }, { name: 'ページのズーム', desc: '' }]),
  doc('工具列位置', '「自動」在手機上放在畫面下方，平板與電腦放在上方。', ['自動', '上方', '下方'], [{ name: 'Toolbar position', desc: '' }]),
  doc('快速鍵說明', '查看 Word 模式所有的快速鍵。', [], [{ name: 'Keyboard shortcuts', desc: '' }]),
  doc('顯示群組名稱', '在每組按鈕下方顯示「剪貼簿」「字型」「段落」等名稱（像 Word）。', [], [{ name: 'Show group names', desc: '' }]),
  doc('檔案大小上限（MB）', '超過這個大小的筆記一律用 Markdown 開啟。', [], [{ name: 'File size limit (MB)', desc: '' }]),
];

// 比對用的文字
ok('英文不分大小寫、全形英數字當成半形', fold('ＷＯＲＤ Mode') === 'word mode' && fold('Ａ４') === 'a4');
ok('fold 不改變長度（位置才能對回原文）', fold('ﬁ㍿Ａｂ').length === 'ﬁ㍿Ａｂ'.length);
ok('全形空白也能分開兩個詞', queryTokens('  工具列　位置 ').join('|') === '工具列|位置');
ok('空白的搜尋：沒有結果', searchSettings(DOCS, '').length === 0 && searchSettings(DOCS, '   ').length === 0);

// 名稱
let hits = searchSettings(DOCS, '縮放');
ok('名稱符合的排在只有說明符合的前面', names(hits) === '頁面縮放', names(hits));
ok('名稱裡符合的位置標出來', marked(hits[0].doc.name, hits[0].name) === '縮放');
hits = searchSettings(DOCS, '頁面');
ok('從開頭符合的排在中間符合的前面', names(hits) === '頁面縮放,全寬頁面', names(hits));
hits = searchSettings(DOCS, '工具 位置');
ok('好幾個詞：每個都要找得到，各自標出來', names(hits) === '工具列位置' && marked('工具列位置', hits[0].name) === '工具|位置', names(hits));
ok('好幾個詞：有一個找不到就不列', searchSettings(DOCS, '工具 縮放').length === 0);
hits = searchSettings(DOCS, '工具位置');
ok('少打幾個字也找得到（依序出現、沒有散太開）', names(hits) === '工具列位置' && marked('工具列位置', hits[0].name) === '工具|位置', names(hits));
ok('散得太開的不算', searchSettings([doc('工具列的樣式與其他的位置')], '工具位置').length === 0);
ok('ＭＢ（全形）找得到 MB', names(searchSettings(DOCS, 'ｍｂ')) === '檔案大小上限（MB）');

// 說明
hits = searchSettings(DOCS, '滾輪');
ok('只有說明符合：也找得到，片段標出符合的位置', names(hits) === '頁面縮放' && hits[0].snippet.kind === 'desc' && marked(hits[0].snippet.text, hits[0].snippet.ranges) === '滾輪', JSON.stringify(hits[0] && hits[0].snippet));
hits = searchSettings([doc('名稱', '這是一段很長很長很長很長很長很長很長很長的說明，最後才提到關鍵字')], '關鍵字');
const sn = hits[0].snippet;
ok('說明很長：片段從符合的位置前面一點開始，前面加「…」，位置跟著移', sn.text.startsWith('…') && sn.text.length < 30 && marked(sn.text, sn.ranges) === '關鍵字', JSON.stringify(sn));
hits = searchSettings(DOCS, '快速鍵說明');
ok('只有名稱符合：片段顯示說明的開頭，不標任何位置', hits[0].snippet.text === '查看 Word 模式所有的快速鍵。' && hits[0].snippet.ranges.length === 0, JSON.stringify(hits[0].snippet));

// 選項
hits = searchSettings(DOCS, '下方');
ok('選項的文字也找得到；說明裡也有時，名稱下面顯示說明', names(hits).startsWith('工具列位置') && hits[0].snippet.kind === 'desc' && marked(hits[0].snippet.text, hits[0].snippet.ranges) === '下方', JSON.stringify(hits[0] && hits[0].snippet));
hits = searchSettings([doc('工具列位置', '放在哪裡', ['自動', '上方', '下方'])], '下方');
ok('只有選項符合：片段顯示那個選項', hits[0].snippet.kind === 'term' && hits[0].snippet.text === '下方' && marked('下方', hits[0].snippet.ranges) === '下方', JSON.stringify(hits[0].snippet));

// 其他語言
hits = searchSettings(DOCS, 'zoom');
ok('介面是中文、打英文也找得到', names(hits) === '頁面縮放', names(hits));
ok('片段顯示符合的那個語言的名稱', hits[0].snippet.kind === 'alt' && hits[0].snippet.text === 'Page zoom' && marked('Page zoom', hits[0].snippet.ranges) === 'zoom', JSON.stringify(hits[0].snippet));
hits = searchSettings(DOCS, 'ズーム');
ok('日文也可以', names(hits) === '頁面縮放' && hits[0].snippet.text === 'ページのズーム');
hits = searchSettings(DOCS, 'TOOLBAR');
ok('其他語言也不分大小寫', names(hits) === '工具列位置', names(hits));
hits = searchSettings(DOCS, 'position');
ok('其他語言的名稱從詞首符合', names(hits) === '工具列位置' && hits[0].snippet.text === 'Toolbar position' && marked('Toolbar position', hits[0].snippet.ranges) === 'position', JSON.stringify(hits[0] && hits[0].snippet));
hits = searchSettings(DOCS, 'shortcut');
ok('打英文的同義詞：直接標出目前語言名稱裡的詞', names(hits) === '快速鍵說明' && marked('快速鍵說明', hits[0].name) === '快速鍵', JSON.stringify(hits[0] && hits[0].name));
hits = searchSettings(DOCS, 'mouse wheel');
ok('其他語言的說明也找得到', names(hits) === '頁面縮放' && hits[0].snippet.kind === 'alt' && marked(hits[0].snippet.text, hits[0].snippet.ranges) === 'mouse|wheel', JSON.stringify(hits[0] && hits[0].snippet));
hits = searchSettings([doc('Word', '', [], [{ name: 'Word', desc: '' }]), doc('Word 模式', '', [], [{ name: 'Word mode', desc: '' }])], 'word');
ok('其他語言跟目前語言一樣的文字不重複比對；目前語言的名稱分數較高', names(hits) === 'Word,Word 模式' && hits[0].snippet === null, names(hits));
hits = searchSettings([doc('頁面縮放', '', [], [{ name: 'Page zoom', desc: '' }]), doc('Zoom 的說明', '', [], [])], 'zoom');
ok('同一個字：目前語言的名稱排在其他語言的名稱前面', names(hits) === 'Zoom 的說明,頁面縮放', names(hits));
hits = searchSettings([doc('頁面縮放', '也可以調整縮放', [], [{ name: 'Page zoom', desc: '' }, { name: 'Zoom de página', desc: '' }])], 'zoom');
ok('打英文：同義詞也標出名稱裡的「縮放」，下面顯示直接找到的英文名稱（不是換成同義詞才找到的說明）',
  marked('頁面縮放', hits[0].name) === '縮放' && hits[0].snippet.kind === 'alt' && hits[0].snippet.text === 'Page zoom', JSON.stringify(hits[0]));
ok('幾種語言從詞首符合算一樣：顯示排在前面的語言（英文）', hits[0].snippet.text === 'Page zoom');
hits = searchSettings([doc('Page zoom', 'Use Ctrl+wheel.', [], [{ name: 'Zoom de página', desc: '' }])], 'zoom');
ok('名稱已經直接找到：不再顯示其他語言，下面顯示說明', hits[0].snippet.kind === 'desc' && hits[0].snippet.text === 'Use Ctrl+wheel.', JSON.stringify(hits[0].snippet));
hits = searchSettings([doc('頁面縮放', '', [], [{ name: 'Page zoom', desc: '' }])], '頁面 zoom');
ok('中英混打：名稱標出中文，下面顯示英文名稱', marked('頁面縮放', hits[0].name) === '頁面縮放' && hits[0].snippet.text === 'Page zoom' && marked('Page zoom', hits[0].snippet.ranges) === 'zoom', JSON.stringify(hits[0]));

// 同義詞
hits = searchSettings(DOCS, '快捷鍵');
ok('同義詞：「快捷鍵」找得到「快速鍵」', names(hits) === '快速鍵說明', names(hits));
ok('同義詞找到的也標出位置', marked('快速鍵說明', hits[0].name) === '快速鍵');
hits = searchSettings(DOCS, '功能區位置');
ok('同義詞換掉詞裡的一部分：「功能區位置」找得到「工具列位置」', names(hits) === '工具列位置', names(hits));
hits = searchSettings([doc('快捷鍵設定'), doc('快速鍵說明')], '快捷鍵');
ok('原本的詞排在同義詞前面', names(hits) === '快捷鍵設定,快速鍵說明', names(hits));

// 排序
hits = searchSettings([doc('甲', '說明有 Word'), doc('乙', '說明也有 Word')], 'word');
ok('分數一樣：照設定頁上的順序', names(hits) === '甲,乙');
hits = searchSettings(DOCS, 'word');
ok('名稱、說明、其他語言都比過，名稱符合的在前', hits.length >= 3 && hits.every((h, i) => i === 0 || h.score <= hits[i - 1].score), names(hits));

if (fails) process.exitCode = 1;
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
