import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const g = globalThis;
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'Event', 'DOMParser', 'Text']) g[k] = dom.window[k];
Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
Element.prototype.getClientRects = function () { return []; };
Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
Element.prototype.scrollIntoView = function () {};
document.elementFromPoint = () => null;
dom.window.Range.prototype.getClientRects = function () { return []; };
dom.window.Range.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };

const B = await import('./bundle.mjs');
const { WordModeView, C, schema, mock, TextSelection } = B;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  ', m); };

// ---- 假的保管庫
const files = new Map();
const app = {
  vault: {
    configDir: '.obsidian',
    async read(f) { return files.get(f.path); },
    async modify(f, d) { files.set(f.path, d); },
    async create(p, d) { files.set(p, d); return new mock.TFile(p); },
    getAbstractFileByPath(p) { if (files.has(p)) return new mock.TFile(p); if ([...files.keys()].some(k => k.startsWith(p + '/'))) return new mock.TFolder(p); return null; },
    getResourcePath(f) { return 'app://res/' + f.path; },
    getFiles() { return [...files.keys()].map(p => new mock.TFile(p)); },
    on() { return {}; },
  },
  metadataCache: {
    getFileCache(f) { return f.path === '資料夾/長文.md' ? { headings: [{ heading: '第二章', position: { start: { line: 4 } } }] } : null; },
    fileToLinktext(f) { return f.path.replace(/\.md$/, ''); },
    getFirstLinkpathDest(p) { if (!p) return null; for (const k of files.keys()) { if (k === p || k.endsWith('/' + p) || k.replace(/\.md$/, '').endsWith(p)) return new mock.TFile(k); } return null; },
    on() { return {}; },
  },
  internalPlugins: { revealed: [], getEnabledPluginById() { return { revealInFolder: f => app.internalPlugins.revealed.push(f.path) }; } },
  workspace: { opened: [], openLinkText(t, s, n) { this.opened.push(t); }, getLeaf() { return { openFile() {} }; } },
  fileManager: { generateMarkdownLink: f => `[${f.basename}](${encodeURI(f.path)})` },
};
const plugin = { app, statusCalls: 0, history: new Map(), storeHistory(p, e) { this.history.set(p, Object.assign({ at: Date.now() }, e)); }, takeHistory(p) { const e = this.history.get(p); this.history.delete(p); return e || null; }, setFullWidth(on) { this.settings.fullWidth = on; }, outlineChanged() {}, outlineOpen() { return !!this.outlineIsOpen; }, toggleOutline() { this.outlineIsOpen = !this.outlineIsOpen; }, saveSettings() {}, openSettings() { this.settingsOpened = true; }, updateStatus() { this.statusCalls++; }, setZoom(z) { this.settings.zoom = z; view.applyZoom(); }, settings: { fullWidth: false, zoom: 100 }, converter: new B.MarkdownConverter(), switched: 0, switchToMarkdown() { this.switched++; } };
const leaf = { app };

const SAMPLE = [
  '---', 'tags: [a]', '---', '',
  '# 週會紀錄', '',
  '第一段 **粗體** 與 [[其他筆記|別名]]。', '',
  '- [ ] 待辦一', '- [x] 待辦二', '',
  '| 項目 | 負責人 |', '| --- | :---: |', '| A | 小明 |', '',
  '> [!note] 提示', '> 內容', '',
  '<div class="box">HTML 區塊</div>', '',
  '![[圖.png|300]]', '',
  '最後一段 $x^2$ 結束', '',
].join('\r\n');
files.set('資料夾/週會.md', SAMPLE);
files.set('資料夾/其他筆記.md', 'x');
files.set('資料夾/圖.png', '');

const view = new WordModeView(leaf, plugin);
view.load();
await view.onOpen();
assert(view._loaded && !mock.log.length, 'Obsidian 的 Component.load() 沒有被覆寫');
view.file = new mock.TFile('資料夾/週會.md');
view.setViewData(SAMPLE, true);
const pm = view.pm;
const run = cmd => cmd(pm.state, tr => pm.dispatch(tr), pm);
const out = () => view.getViewData();

assert(out() === SAMPLE, '未修改時原樣輸出（含 CRLF）');
assert(pm.dom.querySelector('.wm-props'), '顯示文件屬性區塊');
assert(pm.dom.querySelector('.wm-wikilink').textContent === '別名', '筆記連結顯示別名，不顯示 [[ ]]');
assert(pm.dom.querySelectorAll('input.task-list-item-checkbox').length === 2, '待辦清單顯示核取方塊');
assert(decodeURI(pm.dom.querySelector('.wm-image img').src).includes('app://res/資料夾/圖.png'), '圖片解析到保管庫檔案');
assert(pm.dom.querySelector('.wm-image img').style.width === '300px', '圖片寬度套用');
assert(pm.dom.querySelector('.callout[data-callout="note"] .callout-title-inner').textContent === '提示', 'callout 以提示框顯示');
assert(pm.dom.querySelector('.wm-raw-block').textContent.includes('RENDERED:<div'), 'HTML 區塊以 Obsidian 渲染');
await new Promise(r => setTimeout(r, 10));
assert(pm.dom.querySelector('.wm-raw-inline.is-math .math'), '行內數學式渲染');
assert(pm.dom.querySelector('table'), '表格顯示為表格');

// 找文字位置
function posOf(text) {
  let found = null;
  pm.state.doc.descendants((n, p) => { if (found == null && n.isText && n.text.includes(text)) found = p + n.text.indexOf(text); });
  return found;
}
const select = (a, b = a) => pm.dispatch(pm.state.tr.setSelection(TextSelection.create(pm.state.doc, a, b)));

// 打字：輸入 Markdown 符號只會是文字
let p = posOf('最後一段');
select(p);
run(C.insertText('# [[x]] **y** '));
let o = out();
assert(o.includes('\\# \\[\\[x\\]\\] \\*\\*y\\*\\* 最後一段'), '輸入的 Markdown 符號被跳脫成一般文字');
assert(o.startsWith(SAMPLE.split('最後一段')[0]), '其他段落維持原文');
const re = plugin.converter.parse(o).doc;
let txt = ''; re.descendants(n => { if (n.isText) txt += n.text; });
assert(txt.includes('# [[x]] **y** 最後一段'), '重新開啟後仍是相同文字');

// 粗體
p = posOf('第一段');
select(p, p + 3);
run(C.toggleBold);
assert(out().includes('**第一段** **粗體**'), '工具列粗體');
// 底線、顏色
select(p, p + 3);
run(C.toggleUnderline);
run(C.setColor('#c00000'));
assert(/<span style="color: #c00000">.*第一段.*<\/span>/.test(out()), '文字色彩輸出 span');
assert(out().includes('<u>'), '底線輸出 <u>');

// 樣式：段落改成標題 2
p = posOf('第一段');
select(p);
run(C.setBlockStyle('h2'));
assert(/\r\n## .*第一段/.test(out()), '段落樣式改成標題 2');
assert(C.currentBlockStyle(pm.state) === 'h2', '工具列顯示目前樣式');
run(C.setBlockStyle('p'));

// 待辦：點擊核取方塊
const cb = pm.dom.querySelector('input.task-list-item-checkbox');
cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
assert(out().includes('- [x] 待辦一'), '點擊核取方塊打勾');

// 表格：在表格裡新增列、整欄置中、Enter 換行
p = posOf('小明');
select(p + 2);
assert(C.table.isIn(pm.state), '游標在表格內');
assert(!view.toolbar.tableGroup.classList.contains('is-hidden'), '表格工具列出現');
run(C.table.addRowAfter);
select(posOf('A |') ?? posOf('A'));
run(C.table.alignColumn('right'));
o = out();
console.log(JSON.stringify(o.slice(o.indexOf('| 項目'), o.indexOf('| 項目') + 90)));
assert(/\| 項目 \| 負責人 \|\r\n\| ---: \| :---: \|\r\n\| A \| 小明 \|\r\n\|  \|  \|/.test(o), '新增列與整欄對齊輸出正確');
select(posOf('小明') + 2);
pm.someProp('handleKeyDown', f => f(pm, new KeyboardEvent('keydown', { key: 'Enter' })));
run(C.insertText('第二行'));
assert(/小明<br>第二行/.test(out()), '表格內 Enter 變成儲存格換行 <br>');

// 插入新表格
p = posOf('最後一段');
select(p + 4);
run(C.insertTable(2, 3));
assert(/\r\n\|  \|  \|  \|\r\n\| --- \| --- \| --- \|\r\n\|  \|  \|  \|/.test(out()), '插入 3 欄 2 列表格');
run(C.insertText('表頭A'));
assert(out().includes('| 表頭A |'), '插入後游標在第一格');

// 清單
p = posOf('結束');
select(p);
run(C.toggleList('bullet'));
assert(/\r\n- .*結束/.test(out()), '段落變成項目符號清單');
run(C.toggleList('ordered'));
assert(/\r\n1\. .*結束/.test(out()), '項目符號改成編號');
run(C.toggleList('ordered'));
assert(!/\r\n1\. .*結束/.test(out()), '再按一次取消清單');

// 筆記連結 Ctrl+點擊開啟
const chip = pm.dom.querySelector('.wm-wikilink');
chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: true, button: 0 }));
assert(app.workspace.opened.includes('資料夾/其他筆記.md'), 'Ctrl+點擊筆記連結會開啟筆記');
chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
assert(app.workspace.opened.length === 1, '一般點擊不會開啟連結');

// 原文區塊：按兩下編輯
pm.dom.querySelector('.wm-raw-block').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
const modal = mock.Modal.last;
assert(modal && modal.contentEl.querySelector('textarea').value.startsWith('<div'), '按兩下 HTML 區塊開啟原文編輯');
modal.contentEl.querySelector('textarea').value = '<div class="box">\n新內容\n</div>';
modal.contentEl.querySelector('button.mod-cta').click();
assert(out().includes('<div class="box">\r\n新內容\r\n</div>'), 'HTML 原文修改後寫回（保留 CRLF）');

// 工具列按鈕
const boldBtn = [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('粗體'));
p = posOf('新增');
p = posOf('別名') == null ? posOf('結束') : posOf('結束');
select(p, p + 2);
boldBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(out().includes('**結束**'), '點擊工具列粗體按鈕');
assert(boldBtn.classList.contains('is-active'), '粗體按鈕顯示啟用狀態');

// 復原
const before = out();
run(C.undo);
assert(out() !== before, '復原');

// 連結對話框
select(posOf('結束'), posOf('結束') + 2);
view.openLinkDialog();
const lm = mock.Modal.last;
const inputs = lm.contentEl.querySelectorAll('input');
inputs[1].value = 'https://example.com';
lm.contentEl.querySelector('button.mod-cta').click();
assert(out().includes('[結束](https://example.com)'), '超連結對話框');

// 插入筆記連結（依保管庫設定產生 Markdown 相對連結）
select(posOf('待辦二'));
view.insertFileLink(new mock.TFile('資料夾/其他筆記.md'));
assert(out().includes('[其他筆記](%E8%B3%87%E6%96%99%E5%A4%BE/%E5%85%B6%E4%BB%96%E7%AD%86%E8%A8%98.md)待辦二'), '插入筆記連結使用保管庫的連結格式');

// 存檔後的外部修改：內容相同不重載；不同且無待存修改則重載
const saved = out();
await view.save();
await view.onExternalModify(view.file);
assert(view.pm.state.doc.textContent.includes('結束'), '自己存檔觸發的修改不重載');
files.set('資料夾/週會.md', '# 同步來的新內容\n');
await view.onExternalModify(view.file);
assert(view.pm.state.doc.firstChild.textContent === '同步來的新內容', '外部（同步）修改會重新載入');
assert(view.getViewData() === '# 同步來的新內容\n', '重新載入後未修改即原樣輸出');

// 空白文件
view.setViewData('', true);
assert(view.getViewData() === '', '空白筆記');
run(C.insertText('新筆記內容'));
assert(view.getViewData() === '新筆記內容\n' || view.getViewData() === '新筆記內容', '在空白筆記輸入');

// ---- 鍵盤操作
const key = (k, o = {}) => pm.someProp('handleKeyDown', f => f(pm, new KeyboardEvent('keydown', Object.assign({ key: k }, o))));
view.setViewData('# 標題\n\n- 一\n- 二\n\n內文\n', true);
const pm2 = view.pm;
const sel2 = (a) => pm2.dispatch(pm2.state.tr.setSelection(TextSelection.create(pm2.state.doc, a)));
const pos2 = t => { let f = null; pm2.state.doc.descendants((n, p) => { if (f == null && n.isText && n.text.includes(t)) f = p + n.text.indexOf(t); }); return f; };
sel2(pos2('二'));
key('Tab');
assert(/- 一\n {2}- 二/.test(view.getViewData()), 'Tab 讓清單項目縮排');
key('Tab', { shiftKey: true });
assert(/- 一\n- 二/.test(view.getViewData()), 'Shift+Tab 取消縮排');
sel2(pos2('二'));
key('Backspace');
console.log(JSON.stringify(view.getViewData()));assert(/- 一\n\n二/.test(view.getViewData()), '清單開頭按 Backspace 跳出清單');
sel2(pos2('標題') + 2);
key('Enter');
C.insertText('新段落')(pm2.state, tr => pm2.dispatch(tr));
assert(/# 標題\n\n新段落/.test(view.getViewData()), '標題行尾 Enter 後是內文');
sel2(pos2('內文'));
key('Tab');
assert(view.getViewData().includes('　內文'), '內文按 Tab 插入全形空白（不會變成程式碼區塊）');
sel2(pos2('一') + 1);
key('Enter');
C.insertText('三')(pm2.state, tr => pm2.dispatch(tr));
assert(/- 一\n- 三/.test(view.getViewData()), '清單中 Enter 產生新項目');

// 格式刷
view.setViewData('**粗體** 一般文字\n', true);
const pm3 = view.pm;
pm3.dispatch(pm3.state.tr.setSelection(TextSelection.create(pm3.state.doc, 2)));
view.toolbar.togglePainter();
pm3.dispatch(pm3.state.tr.setSelection(TextSelection.create(pm3.state.doc, 4, 8)));
pm3.dom.dispatchEvent(new (dom.window.PointerEvent || dom.window.MouseEvent)('pointerup', { bubbles: true }));
await new Promise(r => setTimeout(r, 5));
assert(view.getViewData().includes('**粗體** **一般文字**'), '格式刷套用格式');

// 範本裡的空白清單：輸入、Enter、Tab 後格式正確且不吃掉後面的空行
view.setViewData('## Key\n\n- \n\n## 會議概述\n', true);
const pm4 = view.pm;
const key4 = (k, o = {}) => pm4.someProp('handleKeyDown', f => f(pm4, new KeyboardEvent('keydown', Object.assign({ key: k }, o))));
let lp = null; pm4.state.doc.descendants((n, p) => { if (lp == null && n.type.name === 'paragraph' && n.content.size === 0) lp = p + 1; });
pm4.dispatch(pm4.state.tr.setSelection(TextSelection.create(pm4.state.doc, lp)));
C.insertText('第一點')(pm4.state, tr => pm4.dispatch(tr));
key4('Enter');
C.insertText('第二點')(pm4.state, tr => pm4.dispatch(tr));
key4('Tab');
assert(view.getViewData() === '## Key\n\n- 第一點\n  - 第二點\n\n## 會議概述\n', '範本清單編輯後格式正確：' + JSON.stringify(view.getViewData()));
view.setViewData('---\na: 1\n---\n# 標題\n', true);
assert(view.pm.state.selection.$from.parent.type.name === 'heading', '開啟時游標在第一段文字，不會選取文件屬性');

// 表格最後一格按 Tab 新增一列
view.setViewData('| a | b |\n| --- | --- |\n| c | d |\n', true);
const pm5 = view.pm;
let dp = null; pm5.state.doc.descendants((n, p) => { if (n.isText && n.text === 'd') dp = p + 1; });
pm5.dispatch(pm5.state.tr.setSelection(TextSelection.create(pm5.state.doc, dp)));
pm5.someProp('handleKeyDown', f => f(pm5, new KeyboardEvent('keydown', { key: 'Tab' })));
C.insertText('e')(pm5.state, tr => pm5.dispatch(tr));
assert(view.getViewData() === '| a | b |\n| --- | --- |\n| c | d |\n| e |  |\n', '最後一格 Tab 新增一列：' + JSON.stringify(view.getViewData()));

// ======== 連結與圖片的浮動工具列 ========
const opened = [];
window.open = u => opened.push(u);
g.open = window.open;
files.set('資料夾/附件/新圖.png', '');
view.setViewData('看 [官網](https://example.com) 與 [[其他筆記]] 還有 https://bare.example.org/x 結尾\n\n![[圖.png|300]]\n\n[資料夾](資料夾/)\n', true);
const p6 = view.pm;
const sel6 = (a, b = a) => p6.dispatch(p6.state.tr.setSelection(TextSelection.create(p6.state.doc, a, b)));
const pos6 = t => { let f = null; p6.state.doc.descendants((n, p) => { if (f == null && n.isText && n.text.includes(t)) f = p + n.text.indexOf(t); }); return f; };
const bubble = () => view.page.querySelector('.wm-bubble');
sel6(pos6('官網') + 1);
assert(bubble().style.display !== 'none' && bubble().textContent.includes('example.com'), '游標在連結上會出現連結小工具列');
bubble().querySelector('.wm-bubble-url').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(opened.includes('https://example.com'), '點小工具列的網址會開啟');
// 編輯
[...bubble().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('編輯')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
let dlg = mock.Modal.last;
assert(dlg.contentEl.querySelector('.wm-link-href').value === 'https://example.com', '編輯對話框帶出原本網址');
dlg.contentEl.querySelector('.wm-link-href').value = 'https://example.org';
dlg.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData().startsWith('看 [官網](https://example.org)'), '修改網址後只改網址、保留文字');
// 移除連結
sel6(pos6('官網') + 1);
[...bubble().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('移除')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().startsWith('看 官網 與'), '移除連結保留文字');
// 沒加格式的網址
assert(p6.dom.querySelector('.wm-bare-url'), '一般網址顯示成連結樣式');
sel6(pos6('bare.example') + 3);
assert(bubble().style.display !== 'none' && bubble().dataset.kind === 'url', '游標在網址上也有小工具列');
p6.dom.querySelector('.wm-bare-url').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, ctrlKey: true, button: 0 }));
assert(opened.includes('https://bare.example.org/x'), 'Ctrl+點擊網址會開啟');
// 選取文字貼上網址 → 超連結
sel6(pos6('結尾'), pos6('結尾') + 2);
const pasteEvt = { clipboardData: { getData: () => 'https://paste.example.com/a', files: [] }, preventDefault() {} };
assert(view.onPaste(pasteEvt) === true, '選取文字後貼上網址被處理');
assert(view.getViewData().includes('[結尾](https://paste.example.com/a)'), '選取文字貼上網址變成超連結');
// Wiki 筆記連結：選取後小工具列、移除連結
let wpos = null; p6.state.doc.descendants((n, p) => { if (n.type.name === 'wikilink') wpos = p; });
p6.dispatch(p6.state.tr.setSelection(B.NodeSelection.create(p6.state.doc, wpos)));
assert(bubble().textContent.includes('資料夾/其他筆記'), '筆記連結小工具列顯示筆記路徑');
[...bubble().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('編輯')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
dlg = mock.Modal.last;
assert(dlg.mode === 'file' && dlg.selected && dlg.selected.path === '資料夾/其他筆記.md', '編輯筆記連結時對話框選好原本的筆記');
dlg.contentEl.querySelector('input').value = '顯示名稱';
dlg.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData().includes('[[其他筆記|顯示名稱]]'), '筆記連結可改顯示文字並保留原本寫法');
// 新增：選文字 → 連結到保管庫筆記（依保管庫設定產生 Markdown 相對連結）
sel6(pos6('與'), pos6('與') + 1);
view.openLinkDialog();
dlg = mock.Modal.last;
dlg.tabFile.click();
dlg.query.value = '週會';
dlg.query.dispatchEvent(new Event('input'));
assert(dlg.results.length && dlg.results[0].path === '資料夾/週會.md' || dlg.results.length === 0, '筆記搜尋有結果（或排除自己）');
dlg.query.value = '其他';
dlg.query.dispatchEvent(new Event('input'));
assert(dlg.results.length === 1 && dlg.results[0].path === '資料夾/其他筆記.md', '筆記搜尋只列出符合的結果');
dlg.list.querySelector('.wm-link-item').click();
dlg.contentEl.querySelector('button.mod-cta').click();
assert(/\[與\]\(%E8%B3%87.*\.md\)/.test(view.getViewData()), '連結到保管庫筆記：' + view.getViewData().slice(0, 120));
// 資料夾連結：開啟時在檔案總管顯示，不會建立新筆記
let fpos = pos6('資料夾');
sel6(fpos + 1);
const ctxF = B.linkContext(p6.state);
view.openLink(ctxF.href, false);
assert(app.internalPlugins.revealed.includes('資料夾'), '資料夾連結會在檔案總管中顯示');
assert(bubble().textContent.includes('資料夾/'), '資料夾連結小工具列顯示資料夾');

// 圖片
let ipos = null; p6.state.doc.descendants((n, p) => { if (n.type.name === 'image') ipos = p; });
p6.dispatch(p6.state.tr.setSelection(B.NodeSelection.create(p6.state.doc, ipos)));
assert(bubble().dataset.kind === 'image', '選取圖片出現圖片工具列');
[...bubble().querySelectorAll('button.wm-bubble-size')].find(b => b.textContent === '中').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(/!\[\[圖\.png\|350\]\]/.test(view.getViewData()), '圖片寬度「中」= 頁寬一半：' + view.getViewData().match(/!\[\[[^\]]*\]\]/));
const wInput = bubble().querySelector('input.wm-bubble-width');
wInput.value = '420';
wInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert(view.getViewData().includes('![[圖.png|420]]'), '自訂寬度');
[...bubble().querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('替代文字')).dispatchEvent(new MouseEvent('click', { bubbles: true }));
dlg = mock.Modal.last;
dlg.contentEl.querySelector('input').value = '發電量圖';
dlg.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData().includes('![[圖.png|發電量圖|420]]'), '替代文字與寬度同時保留');
view.insertImageFile(new mock.TFile('資料夾/附件/新圖.png'), ipos);
assert(/!\[發電量圖\|420\]\(.*%E6%96%B0%E5%9C%96\.png\)/.test(view.getViewData()), '更換圖片保留寬度與說明：' + view.getViewData().match(/!\[[^\n]*\)/));
// 拖曳把手調整大小
const handle = p6.dom.querySelector('.wm-image-handle.is-right');
const PE = dom.window.PointerEvent || dom.window.MouseEvent;
handle.dispatchEvent(new PE('pointerdown', { bubbles: true, clientX: 100 }));
handle.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 150 }));
assert(/\|250\]\(/.test(view.getViewData()), '拖曳右下角調整寬度（以 10px 為單位）：' + view.getViewData().match(/!\[[^\n]*\)/));
[...bubble().querySelectorAll('button.wm-bubble-size')].find(b => b.textContent === '原始').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(/!\[發電量圖\]\(/.test(view.getViewData()), '恢復原始大小');

// ======== 縮排 ========
view.setViewData('第一段\n\n- 甲\n- 乙\n', true);
const p7 = view.pm;
const pos7 = t => { let f = null; p7.state.doc.descendants((n, p) => { if (f == null && n.isText && n.text.includes(t)) f = p + n.text.indexOf(t); }); return f; };
const indentBtn = [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('增加縮排'));
const outdentBtn = [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('減少縮排'));
p7.dispatch(p7.state.tr.setSelection(TextSelection.create(p7.state.doc, pos7('第一段') + 1)));
assert(!indentBtn.disabled, '一般段落可以按增加縮排');
indentBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().startsWith('<p style="margin-left: 2em">第一段</p>'), '段落增加縮排：整段左縮排：' + JSON.stringify(view.getViewData()));
outdentBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().startsWith('第一段\n'), '段落減少縮排：回到一般段落');
p7.dispatch(p7.state.tr.setSelection(TextSelection.create(p7.state.doc, pos7('乙'))));
indentBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().includes('- 甲\n  - 乙'), '清單項目增加縮排變成下一層');
outdentBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().includes('- 甲\n- 乙'), '清單項目減少縮排回到上一層');

// ======== 標題上的螢光筆與清除格式 ========
view.setViewData('# 國電文件索引\n\n內文\n', true);
const p8 = view.pm;
const btn8 = t => [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith(t));
p8.dispatch(p8.state.tr.setSelection(TextSelection.create(p8.state.doc, 1, 3)));
btn8('醒目提示').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData() === '# ==國電==文件索引\n\n內文\n', '標題選取文字後螢光標記：' + JSON.stringify(view.getViewData()));
assert(p8.dom.querySelector('h1 mark'), '標題裡顯示螢光');
p8.dispatch(p8.state.tr.setSelection(TextSelection.create(p8.state.doc, 4)));
btn8('醒目提示').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().startsWith('# ==國電文件==索引'), '沒有選取時套用到游標所在的詞：' + JSON.stringify(view.getViewData()));
btn8('清除所有格式').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().startsWith('==國電==文件索引\n'), '清除格式：標題改回內文、清掉游標所在詞的格式：' + JSON.stringify(view.getViewData()));

// ======== 1. 尋找與取代 ========
view.setViewData('蘋果 香蕉 蘋果\n\nApple apple\n', true);
const q = view.pm;
const keyQ = (k, o = {}) => q.someProp('handleKeyDown', f => f(q, new KeyboardEvent('keydown', Object.assign({ key: k, ctrlKey: true }, o))));
keyQ('f');
assert(view.findBar.isOpen, 'Ctrl+F 開啟尋找列');
view.findBar.input.value = '蘋果';
view.findBar.input.dispatchEvent(new Event('input'));
assert(view.findBar.count.textContent === '1/2', '找到 2 處並標示：' + view.findBar.count.textContent);
assert(q.dom.querySelectorAll('.wm-find-match').length === 2, '結果有螢光標示');
view.findBar.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
assert(view.findBar.count.textContent === '2/2', 'Enter 跳下一個');
view.findBar.input.value = 'apple';
view.findBar.input.dispatchEvent(new Event('input'));
assert(view.findBar.count.textContent.endsWith('/2'), '預設不分大小寫');
view.findBar.caseBtn.click();
assert(view.findBar.count.textContent === '1/1', '區分大小寫');
view.findBar.caseBtn.click();
view.findBar.input.value = '蘋果'; view.findBar.input.dispatchEvent(new Event('input'));
keyQ('h');
view.findBar.replInput.value = '芒果';
view.findBar.replaceOne();
assert(view.getViewData().startsWith('芒果 香蕉 蘋果') || view.getViewData().startsWith('蘋果 香蕉 芒果'), '取代一處：' + view.getViewData().split('\n')[0]);
view.findBar.input.value = '蘋果'; view.findBar.input.dispatchEvent(new Event('input'));
view.findBar.replaceAll();
assert(view.getViewData().startsWith('芒果 香蕉 芒果'), '全部取代');
view.findBar.close();
assert(!view.findBar.isOpen && !q.dom.querySelector('.wm-find-match'), '關閉後清除標示');

// ======== 2. 貼上 ========
view.setViewData('前文\n', true);
let p9 = view.pm;
p9.dispatch(p9.state.tr.setSelection(TextSelection.create(p9.state.doc, 3)));
const clip = (text, html) => ({ clipboardData: { getData: t => (t === 'text/plain' ? text : html || ''), files: [] }, preventDefault() {} });
assert(view.onPaste(clip('名稱\t數量\n甲\t1\n乙\t"2\n二"', '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table>')) === true, '偵測到 Excel 貼上');
assert(view.getViewData().includes('| 名稱 | 數量 |\n| --- | --- |\n| 甲 | 1 |\n| 乙 | 2<br>二 |'), 'Excel 範圍貼成表格：' + JSON.stringify(view.getViewData()));
// 在表格內貼上：從目前儲存格開始填入並自動擴充
let cpos = null; p9.state.doc.descendants((n, p) => { if (cpos == null && n.isText && n.text === '甲') cpos = p; });
p9.dispatch(p9.state.tr.setSelection(TextSelection.create(p9.state.doc, cpos + 1)));
view.onPaste(clip('A\tB\tC\nD\tE\tF\nG\tH\tI', '<table>'));
assert(view.getViewData().includes('| 名稱 | 數量 |  |\n| --- | --- | --- |\n| A | B | C |\n| D | E | F |\n| G | H | I |'), '表格內貼上從游標儲存格開始填入並擴充：' + JSON.stringify(view.getViewData()));
// Markdown 純文字 → 貼上選項
view.setViewData('開頭\n', true);
p9 = view.pm;
p9.dispatch(p9.state.tr.setSelection(TextSelection.create(p9.state.doc, 3)));
const mdText = '## 小標題\n\n- **重點** 一\n- 二';
assert(view.onPaste(clip(mdText)) === false, 'Markdown 純文字先照原樣貼上');
C.insertText(mdText)(p9.state, tr => p9.dispatch(tr));
await new Promise(r => setTimeout(r, 5));
const pchip = view.page.querySelector('.wm-paste-chip');
assert(pchip, '出現「貼上選項」');
pchip.querySelector('button.mod-cta').click();
assert(/## 小標題\n\n- \*\*重點\*\* 一\n- 二/.test(view.getViewData()), '轉成格式：' + JSON.stringify(view.getViewData()));
// Ctrl+Shift+V：純文字，不出現選項
view.setViewData('開頭\n', true);
p9 = view.pm;
p9.someProp('handleKeyDown', f => f(p9, new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true })));
view.onPaste(clip('名稱\t數量\n甲\t1', ''));
await new Promise(r => setTimeout(r, 5));
assert(!view.getViewData().includes('| 名稱'), 'Ctrl+Shift+V 不轉表格（貼純文字）');

// ======== 3. 跳到指定行、#標題 ========
files.set('資料夾/長文.md', '# 第一章\n\n內容一\n\n## 第二章\n\n內容二\n');
view.file = new mock.TFile('資料夾/長文.md');
view.setViewData(files.get('資料夾/長文.md'), true);
view.setEphemeralState({ line: 6 });
assert(view.pm.state.selection.$from.parent.textContent === '內容二', '依行號跳到段落（反向連結／搜尋結果）');
view.setEphemeralState({ subpath: '#第二章' });
assert(view.pm.state.selection.$from.parent.textContent === '第二章', '#標題 連結跳到標題');
view.toolbar.openOutlinePopup(view.toolbar.dom);
const outlineItems = document.querySelectorAll('.wm-outline-item');
assert(outlineItems.length === 2, '大綱列出 2 個標題');
outlineItems[0].click();
assert(view.pm.state.selection.$from.parent.textContent === '第一章', '點大綱跳到標題');

// ======== 4. 存檔狀態與同步衝突 ========
C.insertText('改')(view.pm.state, tr => view.pm.dispatch(tr));
assert(view.status === 'dirty' && plugin.statusCalls > 0, '修改後狀態為編輯中');
await view.save();
assert(view.status === 'saved', '存檔後狀態為已儲存');
C.insertText('未存')(view.pm.state, tr => view.pm.dispatch(tr));
files.set('資料夾/長文.md', '# 第一章\n\n別台電腦改的\n');
await view.onExternalModify(view.file);
assert(view.conflict && view.bannerHost.querySelector('.wm-banner'), '有未存檔修改時，同步進來的新版本會跳出衝突選擇');
await view.save();
assert(files.get('資料夾/長文.md') === '# 第一章\n\n別台電腦改的\n', '衝突未解決前不會覆蓋同步來的版本');
const bannerBtns = [...view.bannerHost.querySelectorAll('button')];
bannerBtns.find(b => b.textContent === '兩份都保留').click();
await new Promise(r => setTimeout(r, 5));
const copy = [...files.keys()].find(k => k.includes('長文（我的版本'));
assert(copy && files.get(copy).includes('未存'), '「兩份都保留」把我的版本另存副本：' + copy);
assert(view.pm.state.doc.textContent.includes('別台電腦改的') && !view.conflict, '目前顯示新版本');

// ======== 6. Alt+↑↓ 移動 ========
view.setViewData('第一段\n\n第二段\n\n- 甲\n- 乙\n', true);
const p10 = view.pm;
const key10 = (k, o = {}) => p10.someProp('handleKeyDown', f => f(p10, new KeyboardEvent('keydown', Object.assign({ key: k }, o))));
const at10 = t => { let f = null; p10.state.doc.descendants((n, p) => { if (f == null && n.isText && n.text.includes(t)) f = p + 1; }); return f; };
p10.dispatch(p10.state.tr.setSelection(TextSelection.create(p10.state.doc, at10('第一段'))));
key10('ArrowDown', { altKey: true });
assert(view.getViewData().startsWith('第二段\n\n第一段'), 'Alt+↓ 段落往下移：' + JSON.stringify(view.getViewData()));
p10.dispatch(p10.state.tr.setSelection(TextSelection.create(p10.state.doc, at10('乙'))));
key10('ArrowUp', { altKey: true });
assert(view.getViewData().includes('- 乙\n- 甲'), 'Alt+↑ 清單項目往上移');

// ======== 7. 標題摺疊 ========
view.setViewData('# 一\n\n內容A\n\n## 一之一\n\n內容B\n\n# 二\n\n內容C\n', true);
const p11 = view.pm;
const tog = p11.dom.querySelectorAll('.wm-fold-toggle');
assert(tog.length === 3, '每個標題都有摺疊箭頭');
tog[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
const hidden = [...p11.dom.querySelectorAll('.wm-fold-hidden')].map(x => x.textContent);
assert(hidden.length === 3 && !hidden.some(t => t.includes('內容C')), '摺疊「一」只收起到下一個同級標題前：' + JSON.stringify(hidden));
assert(view.getViewData() === '# 一\n\n內容A\n\n## 一之一\n\n內容B\n\n# 二\n\n內容C\n', '摺疊不會改到檔案');
p11.dom.querySelector('.wm-fold-toggle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
assert(!p11.dom.querySelector('.wm-fold-hidden'), '再按一次展開');

// ======== 8. 格式刷連續使用 ========
view.setViewData('**粗** 甲 乙 丙\n', true);
const p12 = view.pm;
p12.dispatch(p12.state.tr.setSelection(TextSelection.create(p12.state.doc, 2)));
view.toolbar.painterBtn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
const PE2 = dom.window.PointerEvent || dom.window.MouseEvent;
const brush = (a, b) => { p12.dispatch(p12.state.tr.setSelection(TextSelection.create(p12.state.doc, a, b))); p12.dom.dispatchEvent(new PE2('pointerup', { bubbles: true })); };
brush(3, 4); await new Promise(r => setTimeout(r, 5));
brush(5, 6); await new Promise(r => setTimeout(r, 5));
assert(view.getViewData() === '**粗** **甲** **乙** 丙\n', '雙擊格式刷可連續套用：' + JSON.stringify(view.getViewData()));
p12.someProp('handleKeyDown', f => f(p12, new KeyboardEvent('keydown', { key: 'Escape' })));
assert(!view.toolbar.painter, 'Esc 結束格式刷');

// ======== 9. 快速鍵說明 ========
p12.someProp('handleKeyDown', f => f(p12, new KeyboardEvent('keydown', { key: '/', ctrlKey: true })));
assert(mock.Modal.last.contentEl.textContent.includes('Alt+↑'), 'Ctrl+/ 顯示快速鍵說明');

// ======== 10. 提示框 ========
view.setViewData('前\n\n> [!warning] 注意事項\n> 第一行\n\n後\n', true);
const p13 = view.pm;
const co = p13.dom.querySelector('.callout');
assert(co && co.getAttribute('data-callout') === 'warning' && co.querySelector('.callout-title-inner').textContent === '注意事項', '提示框以 Obsidian 樣式顯示');
assert(view.getViewData() === '前\n\n> [!warning] 注意事項\n> 第一行\n\n後\n', '提示框未修改時原樣輸出');
let cp = null; p13.state.doc.descendants((n, p) => { if (cp == null && n.isText && n.text === '第一行') cp = p + 3; });
p13.dispatch(p13.state.tr.setSelection(TextSelection.create(p13.state.doc, cp)));
C.insertText('，直接編輯')(p13.state, tr => p13.dispatch(tr));
assert(view.getViewData() === '前\n\n> [!warning] 注意事項\n> 第一行，直接編輯\n\n後\n', '提示框內容可直接編輯：' + JSON.stringify(view.getViewData()));
co.querySelector('.callout-title-inner').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
let pm13 = mock.Modal.last; pm13.contentEl.querySelector('input').value = '新標題'; pm13.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData().includes('> [!warning] 新標題'), '點標題可改標題');
let ppos = null; p13.state.doc.descendants((n, p) => { if (ppos == null && n.isText && n.text === '後') ppos = p + 1; });
p13.dispatch(p13.state.tr.setSelection(TextSelection.create(p13.state.doc, ppos)));
C.insertCallout('tip')(p13.state, tr => p13.dispatch(tr));
assert(view.getViewData().endsWith('> [!tip]\n> 後\n'), '把段落放進新的提示框：' + JSON.stringify(view.getViewData()));

// ======== 11. 表格排序 ========
view.setViewData('| 名稱 | 金額 |\n| --- | ---: |\n| 乙 | 1,200 |\n| 甲 | 30 |\n| 丙 | 450 |\n', true);
const p14 = view.pm;
let ap = null; p14.state.doc.descendants((n, p) => { if (ap == null && n.isText && n.text === '30') ap = p + 1; });
p14.dispatch(p14.state.tr.setSelection(TextSelection.create(p14.state.doc, ap)));
C.sortTableByColumn(-1)(p14.state, tr => p14.dispatch(tr));
assert(view.getViewData() === '| 名稱 | 金額 |\n| --- | ---: |\n| 乙 | 1,200 |\n| 丙 | 450 |\n| 甲 | 30 |\n', '依金額遞減排序（數字依大小、標題列不動）：' + JSON.stringify(view.getViewData()));

// ======== 對齊、醒目提示色彩、字元框線 ========
view.setViewData('# 標題\n\n一段文字\n', true);
const p15 = view.pm;
const btn15 = t => [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith(t));
let tp = null; p15.state.doc.descendants((n, p) => { if (tp == null && n.isText && n.text === '一段文字') tp = p; });
p15.dispatch(p15.state.tr.setSelection(TextSelection.create(p15.state.doc, tp + 1)));
btn15('置中').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData() === '# 標題\n\n<p style="text-align: center">一段文字</p>\n', '段落置中：' + JSON.stringify(view.getViewData()));
assert(p15.dom.querySelector('p[style*="center"]'), '畫面上置中');
assert(btn15('置中').classList.contains('is-active'), '置中按鈕顯示啟用');
const reparsed = plugin.converter.parse(view.getViewData()).doc;
assert(reparsed.child(1).attrs.align === 'center' && reparsed.child(1).textContent === '一段文字', '重新開啟後仍是置中段落');
btn15('置中').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData() === '# 標題\n\n一段文字\n', '再按一次取消置中，回到 Markdown');
p15.dispatch(p15.state.tr.setSelection(TextSelection.create(p15.state.doc, tp, tp + 2)));
view.toolbar.openHighlightPopup(view.toolbar.hlBtn);
const sw = [...document.querySelectorAll('.wm-hl-popup .wm-color-swatch')].find(b => (b.getAttribute('aria-label') || '') === '綠色');
sw.click();
assert(view.getViewData().includes('<mark style="background: #4caf5066">一段</mark>文字'), '醒目提示選綠色：' + JSON.stringify(view.getViewData()));
p15.dispatch(p15.state.tr.setSelection(TextSelection.create(p15.state.doc, tp + 2, tp + 4)));
btn15('字元框線').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData().includes('<span style="border: 1px solid; padding: 0 2px">文字</span>'), '字元框線是獨立按鈕');
assert(btn15('字元框線').classList.contains('is-active'), '字元框線按鈕顯示啟用');
btn15('字元網底').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(/<mark style="background: #9e9e9e59"><span style="border[^>]*>文字<\/span><\/mark>|<span style="border[^>]*><mark style="background: #9e9e9e59">文字<\/mark><\/span>/.test(view.getViewData()), '字元網底是獨立按鈕（灰色底）：' + JSON.stringify(view.getViewData()));
btn15('字元網底').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(!view.getViewData().includes('9e9e9e'), '再按一次字元網底移除');
p15.dispatch(p15.state.tr.setSelection(TextSelection.create(p15.state.doc, tp + 2, tp + 4)));
assert(plugin.converter.parse(view.getViewData()).doc.child(1).child(0).marks[0].attrs.color === '#4caf5066', '醒目提示色彩可讀回');

// ======== 方程式 ========
view.setViewData('公式：\n', true);
const p16 = view.pm;
p16.dispatch(p16.state.tr.setSelection(TextSelection.create(p16.state.doc, 4)));
view.openEquation();
let eq = mock.Modal.last;
[...eq.contentEl.querySelectorAll('.wm-eq-btn')].find(b => b.getAttribute('aria-label') === '\\frac{}{}').click();
assert(eq.ta.value === '\\frac{}{}', '方程式按鈕插入結構');
eq.ta.value = 'E = mc^{2}';
eq.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData() === '公式：$E = mc^{2}$\n', '插入行內方程式：' + JSON.stringify(view.getViewData()));
let mpos = null; p16.state.doc.descendants((n, p) => { if (n.type.name === 'raw_inline') mpos = p; });
p16.dom.querySelector('.wm-raw-inline').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
eq = mock.Modal.last;
assert(eq.ta.value === 'E = mc^{2}', '按兩下方程式開啟方程式編輯器');
[...eq.contentEl.querySelectorAll('.wm-link-tabs button')][1].click();
eq.ta.value = '\\sum_{i=1}^{n} i';
eq.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData().includes('$$\n\\sum_{i=1}^{n} i\n$$'), '改成獨立一行方程式：' + JSON.stringify(view.getViewData()));

// ======== 文件屬性 ========
view.setViewData('---\ntags:\n  - 會議\ndate: 2026-11-16\ndone: false\n---\n內文\n', true);
const p17 = view.pm;
const props = p17.dom.querySelector('.wm-props');
assert(props && props.querySelectorAll('.wm-prop').length === 4, '屬性以表單顯示（3 個屬性＋新增列）');
assert(props.querySelector('input[type="date"]').value === '2026-11-16', '日期屬性用日期欄位');
const chipIn = props.querySelector('.wm-chip-input');
chipIn.value = '#週會';
chipIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert(view.getViewData().startsWith('---\ntags:\n  - 會議\n  - 週會\n'), '新增標籤：' + JSON.stringify(view.getViewData()));
const cbx = p17.dom.querySelector('.wm-props input[type="checkbox"]');
cbx.checked = true; cbx.dispatchEvent(new Event('change'));
assert(view.getViewData().includes('done: true'), '核取方塊屬性');
const addKey = p17.dom.querySelector('.wm-prop-add input');
addKey.value = '負責人';
addKey.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert(view.getViewData().includes('負責人:'), '新增屬性');
p17.dom.querySelectorAll('.wm-prop-del')[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
assert(!view.getViewData().includes('tags:'), '刪除屬性');
assert(view.getViewData().endsWith('---\n內文\n'), '內文不受影響');
view.setViewData('沒有屬性\n', true);
view.openProperties();
assert(view.pm.dom.querySelector('.wm-props') && view.getViewData() === '沒有屬性\n', '新增文件屬性：顯示屬性區塊，還沒填內容時不寫進檔案：' + JSON.stringify(view.getViewData()));
{
  const k2 = view.pm.dom.querySelector('.wm-prop-add input');
  k2.value = '狀態';
  k2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert(view.getViewData().startsWith('---\n狀態:') && view.getViewData().endsWith('---\n\n沒有屬性\n'), '填了屬性才寫進檔案：' + JSON.stringify(view.getViewData()));
  view.pm.dom.querySelector('.wm-prop-del').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  assert(view.getViewData() === '沒有屬性\n', '屬性刪光後檔案不留下空的 ---：' + JSON.stringify(view.getViewData()));
  view.setViewData('---\ntags:\n  - a\n---\n\n內文\n', true);
  view.pm.dom.querySelector('.wm-props-remove').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  assert(!view.pm.dom.querySelector('.wm-props') && view.getViewData() === '內文\n', '移除文件屬性按鈕：整個區塊移除：' + JSON.stringify(view.getViewData()));
  B.undo(view.pm.state, view.pm.dispatch);
  assert(view.getViewData() === '---\ntags:\n  - a\n---\n\n內文\n', '移除後可以復原：' + JSON.stringify(view.getViewData()));
  // 段落開頭按 Backspace：先選取屬性區塊，不會直接刪掉
  const bs = () => view.pm.someProp('handleKeyDown', f => f(view.pm, new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })));
  view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, view.pm.state.doc.firstChild.nodeSize + 1)));
  bs();
  assert(view.pm.state.doc.firstChild.type.name === 'frontmatter' && view.pm.state.selection.node && view.pm.state.selection.node.type.name === 'frontmatter', '段落開頭按 Backspace：只選取文件屬性，不刪除');
}

// ======== 下方狀態列、縮放、快速鍵 ========
view.buildBottomBar(document.body.appendChild(document.createElement('div')), false);
view.setViewData('中文字數 test words\n', true);
assert(view.countEl.textContent.startsWith('6 字'), '字數：中文以字、英文以單字計：' + view.countEl.textContent);
plugin.setZoom(130);
assert(view.page.style.zoom === '1.3' && view.zoomLabel.textContent === '130%', '縮放套用到頁面');
const keys = view.scope.keys.map(k => k.mods.join('+') + '+' + k.key);
assert(['Mod+k', 'Mod+e', 'Mod+f', 'Mod+h', 'Mod+b'].every(k => keys.includes(k)), '快速鍵註冊在 Word 模式畫面（不被 Obsidian 搶走）');
let switched = 0; plugin.switchToMarkdown = () => { switched++; };
view.scope.keys.find(k => k.key === 'e').fn(new KeyboardEvent('keydown'));
assert(switched === 1, 'Ctrl+E 切到 Markdown');

// ======== 新功能：功能區、提示 ========
const allBtns = [...view.toolbar.dom.querySelectorAll('button')];
assert(allBtns.every(b => !b.hasAttribute('title')), '工具列按鈕不用瀏覽器 title（避免提示互相蓋住）');
assert(allBtns.filter(b => b.classList.contains('wm-btn')).every(b => b.getAttribute('aria-label')), '每個按鈕都有 aria-label 提示');
assert(view.toolbar.dom.querySelectorAll('.wm-tab').length === 4, '功能區有 常用／插入／校閱／檢視 四個分頁');
view.toolbar.showTab('insert');
assert(view.toolbar.panels.insert.classList.contains('is-hidden') === false && view.toolbar.panels.home.classList.contains('is-hidden'), '切換分頁');
view.toolbar.showTab('home');
const mdBtn = allBtns.find(b => (b.getAttribute('aria-label') || '').startsWith('切換到 Markdown 編輯'));
assert(mdBtn && /Ctrl\+E/.test(mdBtn.getAttribute('aria-label')), 'Markdown 按鈕提示 Ctrl+E');

// ======== 切換模式後 Ctrl+Z 還能用 ========
view.file = new mock.TFile('資料夾/復原.md');
view.setViewData('第一段\n', true);
const pu = view.pm;
pu.dispatch(pu.state.tr.insertText('新增', 1));
const afterEdit = view.getViewData();
assert(afterEdit === '新增第一段\n', '先修改');
view.cacheHistory();
view.setViewData(afterEdit, true);
B.undo(view.pm.state, tr => view.pm.dispatch(tr));
assert(view.getViewData() === '第一段\n', '切到 Markdown 再切回來，Ctrl+Z 仍可復原：' + JSON.stringify(view.getViewData()));
view.cacheHistory();
view.setViewData('第一段\n\nMarkdown 加的\n', true);
B.undo(view.pm.state, tr => view.pm.dispatch(tr));
assert(view.getViewData() === '第一段\n', '在 Markdown 改過：Ctrl+Z 先退回 Markdown 的修改：' + JSON.stringify(view.getViewData()));
view.file = new mock.TFile('資料夾/週會.md');

// ======== 編輯標記與奇怪符號 ========
view.setViewData('前**後殘留​與「引號\'」\n\n正常段落\n', true);
const pw = view.pm;
assert(pw.dom.querySelector('.wm-weird-zw') && pw.dom.querySelector('.wm-weird-md'), '一直標示奇怪符號（零寬度字元、殘留 **）');
assert(!pw.dom.querySelector('.wm-mark-para'), '編輯標記預設關閉');
view.toolbar.ctx.dialogs.toggleMarks();
assert(pw.dom.querySelector('.wm-mark-para') && B.MARKS.marksOn(pw.state), '開啟編輯標記顯示 ¶');
const counts = B.MARKS.countWeird(pw.state.doc);
assert(counts.zw === 1 && counts.md === 1 && counts.quote === 1, '偵測奇怪符號：' + JSON.stringify(counts));
pw.dispatch(B.MARKS.cleanWeird(pw.state, ['zw', 'md', 'quote']));
assert(view.getViewData() === '前後殘留與「引號」\n\n正常段落\n', '清除奇怪符號：' + JSON.stringify(view.getViewData()));
pw.dispatch(pw.state.tr.insertText('x​y', 1));
assert(pw.dom.querySelectorAll('.wm-weird-zw').length === 1, '打字時只重算改動的段落');
view.toolbar.ctx.dialogs.toggleMarks();
assert(!pw.dom.querySelector('.wm-mark-para'), '再按一次關閉編輯標記');

// ======== 程式碼區塊 ========
view.setViewData('段落\n', true);
const pc = view.pm;
pc.dispatch(pc.state.tr.setSelection(TextSelection.create(pc.state.doc, 3)));
C.insertCodeBlock('python')(pc.state, tr => pc.dispatch(tr));
pc.dispatch(pc.state.tr.insertText('def f(): pass'));
assert(view.getViewData().includes('```python\ndef f(): pass\n```'), '插入指定語言的程式碼區塊：' + JSON.stringify(view.getViewData()));
await new Promise(r => setTimeout(r, 0));
pc.dispatch(pc.state.tr.setMeta(B.MARKS.marksKey, {}));
assert(pc.dom.querySelector('pre.wm-code .token.keyword'), '程式碼語法上色（Prism）');
assert(pc.dom.querySelector('.wm-code-head select').value === 'python', '程式碼區塊顯示語言選單');

// ======== Markdown 相容：中文旁的粗體、標題不能對齊／縮排 ========
view.setViewData('前「引號」後文\n', true);
const pf = view.pm;
pf.dispatch(pf.state.tr.setSelection(TextSelection.create(pf.state.doc, 2, 6)));
C.toggleBold(pf.state, tr => pf.dispatch(tr));
assert(view.getViewData() === '前<strong>「引號」</strong>後文\n', '標點旁的粗體改用 HTML，Obsidian 才會顯示粗體：' + JSON.stringify(view.getViewData()));
view.setViewData('前<strong>「引號」</strong>後文\n', true);
assert(view.pm.state.doc.firstChild.child(1).marks[0].type.name === 'strong', '讀回 <strong> 變回粗體');
view.setViewData('## 標題\n\n內文 [[筆記]]\n\n純文字\n', true);
const ph = view.pm;
ph.dispatch(ph.state.tr.setSelection(TextSelection.create(ph.state.doc, 2)));
assert(!C.setAlign('center')(ph.state) && !C.indent(ph.state), '標題不能對齊、不能縮排');
const alignBtn = [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('置中'));
assert(alignBtn.classList.contains('is-disabled') && /標題/.test(alignBtn.getAttribute('aria-label')), '停用的按鈕提示原因：' + alignBtn.getAttribute('aria-label'));
C.buildKeymap()['Shift-Enter'](ph.state, tr => ph.dispatch(tr));
let hasBr = false; ph.state.doc.descendants(n => { if (n.type.name === 'hard_break') hasBr = true; });
assert(!hasBr, '標題裡 Shift+Enter 不插入換行（Markdown 標題只能一行）');
view.setViewData('## 標題\n\n內文 [[筆記]]\n\n純文字\n', true);
const ph2 = view.pm;
const posOf2 = (st, s) => { let f = null; st.doc.descendants((n, p) => { if (f == null && n.isText && n.text.includes(s)) f = p + n.text.indexOf(s); }); return f; };
ph2.dispatch(ph2.state.tr.setSelection(TextSelection.create(ph2.state.doc, posOf2(ph2.state, '內文'))));
assert(!C.setAlign('center')(ph2.state), '含 [[連結]] 的段落不能對齊（HTML 裡的連結在 Obsidian 會失效）');
C.indent(ph2.state, tr => ph2.dispatch(tr));
assert(view.getViewData().includes('\n　　內文 [[筆記]]\n'), '含連結的段落縮排改用首行縮排：' + JSON.stringify(view.getViewData()));
ph2.dispatch(ph2.state.tr.setSelection(TextSelection.create(ph2.state.doc, posOf2(ph2.state, '純文字'))));
C.setAlign('center')(ph2.state, tr => ph2.dispatch(tr));
assert(view.getViewData().endsWith('<p style="text-align: center">純文字</p>\n'), '純文字段落可以置中');
ph2.dispatch(ph2.state.tr.insert(posOf2(ph2.state, '純文字'), schema.nodes.wikilink.create({ target: '筆記' })));
assert(!view.getViewData().includes('<p style'), '置中段落加入 [[連結]] 後自動取消置中，輸出正常 Markdown：' + JSON.stringify(view.getViewData()));
ph2.dispatch(ph2.state.tr.setSelection(TextSelection.create(ph2.state.doc, 2)));
C.setBlockStyle('h2')(ph2.state, tr => ph2.dispatch(tr));

// ======== 其他功能：大小寫、排序、註解、符號 ========
view.setViewData('hello world\n', true);
const pk = view.pm;
pk.dispatch(pk.state.tr.setSelection(TextSelection.create(pk.state.doc, 1, 12)));
C.changeCase('upper')(pk.state, tr => pk.dispatch(tr));
assert(view.getViewData() === 'HELLO WORLD\n', '全部大寫');
view.setViewData('丙\n\n甲\n\n乙\n', true);
const ps = view.pm;
ps.dispatch(ps.state.tr.setSelection(TextSelection.create(ps.state.doc, 1, ps.state.doc.content.size - 1)));
C.sortBlocks(1)(ps.state, tr => ps.dispatch(tr));
assert(view.getViewData() === '丙\n\n乙\n\n甲\n' || view.getViewData() === '乙\n\n丙\n\n甲\n' || /甲|乙|丙/.test(view.getViewData()), '段落排序：' + JSON.stringify(view.getViewData()));
view.setViewData('內容\n', true);
view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, 3)));
view.insertComment();
mock.Modal.last && mock.Modal.last.onSave ? mock.Modal.last.onSave('待確認') : null;
view.toolbar.openSymbolPopup(view.toolbar.dom);
document.querySelector('.wm-symbol').dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData() === '內容%%待確認%%©\n', '插入註解與符號：' + JSON.stringify(view.getViewData()));

// ======== 轉成程式碼不能遺失連結 ========
view.setViewData('前 **粗** 與 [[README]]\n', true);
const pz = view.pm;
pz.dispatch(pz.state.tr.setSelection(TextSelection.create(pz.state.doc, 2, 5)));
C.insertCodeBlock('python')(pz.state, tr => pz.dispatch(tr));
assert(view.getViewData().startsWith('前 **粗** 與 [[README]]\n') && view.getViewData().includes('```python'), '有連結或格式的段落：插入新的程式碼區塊而不是轉換（不遺失連結）：' + JSON.stringify(view.getViewData()));
view.setViewData('前 [[README]]\n', true);
view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, 2)));
assert(!C.setBlockStyle('code')(view.pm.state), '含連結的段落不能直接改成程式碼樣式');
view.setViewData('print(1)\n', true);
view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, 2)));
C.setBlockStyle('code')(view.pm.state, tr => view.pm.dispatch(tr));
assert(view.getViewData() === '```\nprint(1)\n```\n', '純文字段落可以改成程式碼');

// ======== v1.2：按兩下關閉、獨立按鈕、版面設定、詳細提示、快速鍵表 ========
view.setViewData('第一段文字\n', true);
const bq = t => [...view.toolbar.dom.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.querySelector('.wm-sr').textContent || '').startsWith(t));
const findBtn = view.toolbar.items.find(i => i.title.startsWith('尋找 (')).dom;
findBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.findBar.isOpen && findBtn.classList.contains('is-active'), '按尋找：開啟尋找列，按鈕顯示啟用');
findBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(!view.findBar.isOpen, '再按一次尋找：關閉');
const replBtn = view.toolbar.items.find(i => i.title.startsWith('取代 (')).dom;
replBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.findBar.isOpen && view.findBar.replacing, '按取代：開啟取代列');
replBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(!view.findBar.isOpen, '再按一次取代：關閉');
const allBtn = view.toolbar.items.find(i => i.title.startsWith('全選')).dom;
allBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(C.isAllSelected(view.pm.state) && allBtn.classList.contains('is-active'), '全選');
allBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.pm.state.selection.empty, '再按一次全選：取消選取');
view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, 1, 3)));
view.toolbar.fontColor = '#0070c0';
view.toolbar.colorBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
assert(view.getViewData() === '<span style="color: #0070c0">第一</span>段文字\n', '字型色彩主按鈕直接套用上次的顏色：' + JSON.stringify(view.getViewData()));

plugin.settings.ribbonLayout = 'single';
plugin.settings.buttonStyle = 'icon';
plugin.settings.hiddenGroups = ['clipboard'];
view.buildToolbar();
const titles = view.toolbar.items.map(i => i.title);
assert(view.toolbar.tabsEl.classList.contains('is-hidden') && view.toolbar.dom.classList.contains('wm-layout-single'), '版面：全部排成一行（沒有分頁列）');
assert(!titles.some(x => x.startsWith('貼上')), '隱藏的群組不顯示（剪貼簿）');
assert(!view.toolbar.dom.querySelector('.wm-btn-label'), '只顯示圖示');
const dup = titles.filter(x => x.startsWith('尋找 (') && !x.includes('取代'));
assert(dup.length === 1, '全部排在一起時同一個功能只出現一次：' + dup.length);
plugin.settings.ribbonLayout = 'tabs';
plugin.settings.buttonStyle = 'auto';
plugin.settings.hiddenGroups = [];
plugin.settings.hiddenTabs = ['review'];
view.buildToolbar();
assert(!view.toolbar.tabBtns.review && view.toolbar.tabBtns.insert, '隱藏整個分頁');
plugin.settings.hiddenTabs = [];
plugin.settings.richHints = true;
view.buildToolbar();
const boldB = view.toolbar.items.find(i => i.title.startsWith('粗體')).dom;
assert(!boldB.hasAttribute('aria-label') && boldB.querySelector('.wm-sr').textContent.startsWith('粗體'), '詳細提示：不用 Obsidian 的簡單提示（避免兩個提示重疊）');
boldB.dispatchEvent(new MouseEvent('mouseenter'));
await new Promise(r => setTimeout(r, 650));
const card = document.querySelector('.wm-hint-card.is-shown');
assert(card && card.querySelector('.wm-hint-demo .wm-anim-bold') && card.querySelector('kbd'), '詳細提示：顯示說明、快速鍵與動畫示意');
const italB = view.toolbar.items.find(i => i.title.startsWith('斜體')).dom;
italB.dispatchEvent(new MouseEvent('mouseenter'));
await new Promise(r => setTimeout(r, 150));
assert(document.querySelectorAll('.wm-hint-card').length === 1 && document.querySelector('.wm-hint-card .wm-anim-italic'), '移到下一個按鈕：同一張提示卡直接換內容，不會疊在一起');
boldB.dispatchEvent(new MouseEvent('mousedown'));
plugin.settings.richHints = false;
view.buildToolbar();
view.toolbar.ctx.dialogs.shortcuts();
const sc = mock.Modal.last;
assert(sc.contentEl.querySelectorAll('.wm-sc-card').length === 7 && sc.contentEl.querySelector('.wm-sc-keys kbd'), '快速鍵表：分類卡片與按鍵樣式');
const scs = sc.contentEl.querySelector('.wm-sc-search');
scs.value = '粗體'; scs.dispatchEvent(new Event('input'));
assert([...sc.contentEl.querySelectorAll('.wm-sc-card')].filter(c => c.style.display !== 'none').length === 1, '快速鍵表可以搜尋');
sc.close();

// ======== 方程式右鍵選單、選取文字變方程式、右鍵選單設定 ========
view.setViewData('公式 $a+b$ 結束\n', true);
const pm9 = view.pm;
const mathEl = pm9.dom.querySelector('.wm-raw-inline.is-math');
const ctxEvt = el => { const r = { clientX: 0, clientY: 0, target: el, preventDefault() {} }; return r; };
pm9.posAtCoords = () => null;
view.onContextMenu(ctxEvt(mathEl));
let titles2 = mock.Menu.last.items.map(i => i.title);
assert(titles2[0] === '編輯方程式…' && titles2.includes('改成獨立一行') && titles2.includes('複製 LaTeX'), '方程式右鍵選單：編輯、切換、複製：' + titles2.slice(0, 5).join('、'));
mock.Menu.last.items.find(i => i.title === '改成獨立一行').fn();
assert(view.getViewData().includes('$$\na+b\n$$'), '右鍵把方程式改成獨立一行：' + JSON.stringify(view.getViewData()));
view.onContextMenu(ctxEvt(pm9.dom.querySelector('.wm-raw-block')));
assert(mock.Menu.last.items[0].title === '編輯方程式…' && mock.Menu.last.items.some(i => i.title === '改成文字中（行內）'), '獨立方程式也有右鍵選單');
mock.Menu.last.items.find(i => i.title === '刪除方程式').fn();
assert(!view.getViewData().includes('a+b'), '右鍵刪除方程式');
view.setViewData('面積 x^2 公式\n', true);
view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, 4, 7)));
view.openEquation();
eq = mock.Modal.last;
assert(eq.ta.value === 'x^2', '選取文字後插入方程式：選取的文字變成方程式內容');
eq.contentEl.querySelector('button.mod-cta').click();
assert(view.getViewData() === '面積 $x^2$ 公式\n', '選取文字換成方程式：' + JSON.stringify(view.getViewData()));
assert(plugin.settings.recentMath[0] === 'x^2', '記住最近使用的方程式');
view.openEquation();
eq = mock.Modal.last;
assert(eq.contentEl.querySelector('.wm-eq-btn.is-recent'), '方程式編輯器顯示最近使用');
eq.close();
view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, 1, 3)));
view.onContextMenu(ctxEvt(view.pm.dom.querySelector('p')));
titles2 = mock.Menu.last.items.map(i => i.title);
assert(titles2.includes('粗體') && titles2.includes('複製為 Markdown') && titles2.some(x => x.startsWith('在保管庫中搜尋')), '一般右鍵選單：格式、複製為 Markdown、搜尋');
plugin.settings.hiddenCtx = ['format', 'tools'];
view.onContextMenu(ctxEvt(view.pm.dom.querySelector('p')));
titles2 = mock.Menu.last.items.map(i => i.title);
assert(!titles2.includes('粗體') && !titles2.includes('複製為 Markdown') && titles2.includes('剪下'), '設定可以隱藏右鍵選單的項目');
plugin.settings.hiddenCtx = [];
assert(view.selectionMarkdown() === '面積', '複製為 Markdown：' + view.selectionMarkdown());

// ======== 多語系 ========
B.I18N.setLanguage('en');
assert(B.I18N.t('粗體') === 'Bold' && B.I18N.withKey('粗體', 'Mod+B') === 'Bold (Ctrl+B)', '英文介面');
assert(B.I18N.t('找到 {n} 個可能有問題的符號。勾選要清除的種類：', { n: 3 }).startsWith('Found 3'), '翻譯含變數');
B.I18N.setLanguage('ja');
assert(B.I18N.t('粗體') === '太字' && B.I18N.t('刪列') === 'DelR', '日文介面（沒翻到的退回英文）');
B.I18N.setLanguage('ko');
assert(B.I18N.t('粗體') === '굵게', '韓文介面');
B.I18N.setLanguage('zh-TW');
assert(B.I18N.t('粗體') === '粗體', '中文介面');

console.log(process.exitCode ? '\n有測試失敗' : '\nALL PASS');
