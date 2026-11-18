// 編輯測試（第三部分）：程式碼區塊裡停用的功能、表格右鍵選單、分頁列樣式、色彩面板、
// Markdown 工具列的版面、方程式編輯器的復原、圖表編輯器（各種圖表的表單、在圖上編輯）
import { B, mock, assert, finish, makeEnv, caret, sleep, TextSelection } from './harness.mjs';

const env = await makeEnv({});
const { view, plugin } = env;
const out = () => view.getViewData();
const fresh = async (data = '') => { await env.open('筆記/測試.md', data); caret(view, 0); };
const btn = title => view.toolbar.items.find(i => i.title.startsWith(title)).dom;
const click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const select = (from, to) => view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, from, to)));
const ctx = target => { view.pm.posAtCoords = () => null; view.onContextMenu({ clientX: 0, clientY: 0, target, preventDefault() {} }); return mock.Menu.last.items; };
const posOf = text => { let p = null; view.pm.state.doc.descendants((n, pos) => { if (p == null && n.isText && n.text.includes(text)) p = pos + n.text.indexOf(text); }); return p; };

// ======== 程式碼區塊裡：不能用的功能會停用並說明原因 ========
await fresh('一段\n\n```python\nprint(1)\n```\n');
{
  caret(view, 1);
  assert(view.pm.state.selection.$from.parent.type.name === 'code_block', '游標在程式碼區塊裡');
  for (const title of ['粗體', '斜體', '醒目提示', '字型色彩', '項目符號', '超連結', '插入表格', '插入方程式', '插入圖片', '複製格式', '置中']) {
    assert(btn(title).classList.contains('is-disabled'), '程式碼區塊裡停用：' + title);
  }
  assert(btn('粗體').getAttribute('aria-label').includes('程式碼區塊裡只能放純文字'), '停用的按鈕提示原因：' + btn('粗體').getAttribute('aria-label'));
  for (const title of ['複製', '尋找', '全選', '大小寫', '插入符號', '插入程式碼區塊']) assert(!btn(title).classList.contains('is-disabled'), '程式碼區塊裡仍然可用：' + title);
  const before = out();
  click(btn('粗體')); click(btn('項目符號'));
  assert(out() === before, '按停用的按鈕不會改到內容');
  const notices = mock.log.length;
  view.openLinkDialog(); view.openEquation(); view.insertComment();
  assert(mock.log.length === notices + 3 && String(mock.log[mock.log.length - 1][1]).includes('程式碼區塊'), '用快速鍵或選單叫出插入功能：提示不能用');
  select(posOf('print'), posOf('print') + 5);
  const titles = ctx(view.pm.dom.querySelector('pre')).map(i => i.title);
  assert(titles.includes('複製程式碼') && titles.includes('複製') && !titles.includes('粗體') && !titles.includes('項目符號') && !titles.some(x => x.includes('超連結')), '程式碼區塊的右鍵選單沒有格式、段落、插入：' + titles.join('、'));
  caret(view, 0);
  assert(!btn('粗體').classList.contains('is-disabled') && !btn('插入表格').classList.contains('is-disabled'), '游標離開程式碼區塊後恢復');
}

// ======== 表格的右鍵選單：收成子選單 ========
await fresh('| 甲 | 乙 |\n| --- | --- |\n| a1 | b1 |\n');
{
  select(posOf('a1') + 1, posOf('a1') + 1);
  const items = ctx(view.pm.dom.querySelector('td'));
  const titles = items.map(i => i.title);
  assert(!titles.includes('在上方插入列') && !titles.includes('刪除表格'), '表格的功能不直接列在主選單');
  const sub = name => items.find(i => i.title === name).submenu.items.map(i => i.title);
  assert(sub('插入列或欄').join() === '在上方插入列,在下方插入列,在左側插入欄,在右側插入欄', '子選單：插入列或欄');
  assert(sub('刪除列、欄或表格').join() === '刪除列,刪除欄,刪除表格' && sub('移動列或欄').length === 4 && sub('整欄對齊').length === 3 && sub('依此欄排序').length === 2, '子選單：刪除、移動、對齊、排序');
  assert(sub('段落').includes('項目符號') && sub('插入').some(x => x.includes('超連結')) && sub('工具').some(x => x.includes('字數統計')), '表格裡：段落、插入、工具也收成子選單');
  assert(items.length <= 13, '表格右鍵選單的主選單不超過 13 項：' + items.length + '（' + titles.join('、') + '）');
  items.find(i => i.title === '插入列或欄').submenu.items.find(i => i.title === '在下方插入列').fn();
  assert(out() === '| 甲 | 乙 |\n| --- | --- |\n| a1 | b1 |\n|  |  |\n', '子選單的項目可以執行：' + JSON.stringify(out()));
  await fresh('一段文字\n');
  const plain = ctx(view.pm.dom.querySelector('p'));
  assert(plain.every(i => !i.submenu) && plain.some(i => i.title === '項目符號'), '不在表格裡：選單照原本的方式直接列出');
}

// ======== 分頁列的樣式與名稱 ========
{
  plugin.settings.tabStyle = 'both';
  plugin.settings.tabLabels = { home: '我的常用' };
  view.buildToolbar();
  const tabs = [...view.toolbar.dom.querySelectorAll('.wm-tab')];
  assert(tabs.length === 4 && tabs[0].querySelector('.wm-tab-icon').dataset.icon === 'home' && tabs[0].textContent === '我的常用' && tabs[1].textContent === '插入', '分頁：圖示加文字、自訂名稱：' + tabs.map(x => x.textContent).join('、'));
  plugin.settings.tabStyle = 'icon';
  view.buildToolbar();
  assert(view.toolbar.dom.querySelector('.wm-tab').getAttribute('aria-label') === '我的常用' && view.toolbar.dom.classList.contains('wm-tabstyle-icon'), '分頁：只顯示圖示時名稱在提示裡');
  plugin.settings.tabStyle = 'menu';
  view.buildToolbar();
  const tb = view.toolbar;
  assert(tb.tabsEl.classList.contains('is-hidden') && tb.tabSwitch && tb.tabSwitch.textContent.includes('我的常用') && !tb.dom.querySelector('.wm-tab'), '分頁收成選單：分頁列不佔一列');
  assert(tb.toolbarEl.querySelector(':scope > .wm-tabs-quick .wm-btn'), '收成選單時右邊的快速按鈕放在按鈕列');
  click(tb.tabSwitch);
  const menu = [...document.querySelectorAll('.wm-menu-popup .wm-menu-item')];
  assert(menu.map(x => x.textContent).join() === '我的常用,插入,校閱,檢視', '選單列出所有分頁：' + menu.map(x => x.textContent).join());
  click(menu[1]);
  assert(!tb.panels.insert.classList.contains('is-hidden') && tb.panels.home.classList.contains('is-hidden') && tb.tabSwitch.textContent.includes('插入'), '從選單切換分頁');
  plugin.settings.tabStyle = 'text';
  plugin.settings.tabLabels = {};
  view.buildToolbar();
  assert(view.toolbar.dom.querySelectorAll('.wm-tab').length === 4 && !view.toolbar.tabSwitch, '改回文字的分頁列');
}

// ======== 色彩面板：醒目提示可以自訂色彩 ========
await fresh('一段文字\n');
{
  const C = B.COLOR;
  assert(C.normalizeColor('ABC') === '#aabbcc' && C.normalizeColor('#12ab3480') === '#12ab3480' && C.normalizeColor('xyz') === null, '色碼整理');
  assert(C.shade('#000000', 0.5) === '#808080' && C.shade('#ff0000', -0.5) === '#800000', '深淺變化的計算');
  select(1, 3);
  view.toolbar.openHighlightPopup(view.toolbar.hlBtn);
  let p = document.querySelector('.wm-hl-popup');
  assert(p.querySelectorAll('.wm-cp-swatch').length === 16 && p.querySelector('.wm-cp-range'), '醒目提示面板：兩排色彩、可調不透明度');
  const hex = p.querySelector('.wm-cp-hex');
  hex.value = 'zz'; hex.dispatchEvent(new Event('input'));
  assert(p.querySelector('.wm-cp-apply').disabled && hex.classList.contains('is-invalid'), '色碼打錯：不能套用');
  hex.value = '#12AB34'; hex.dispatchEvent(new Event('input'));
  const range = p.querySelector('.wm-cp-range');
  range.value = '50'; range.dispatchEvent(new Event('input'));
  assert(!p.querySelector('.wm-cp-apply').disabled && p.querySelector('.wm-cp-alpha-value').textContent === '50%', '調整不透明度');
  click(p.querySelector('.wm-cp-apply'));
  assert(out() === '<mark style="background: #12ab3480">一段</mark>文字\n', '自訂的醒目提示色彩：' + JSON.stringify(out()));
  assert(plugin.settings.recentHighlights[0] === '#12ab3480' && plugin.settings.lastHighlight === '#12ab3480', '記住自訂的醒目提示色彩');
  select(3, 5);
  click(view.toolbar.hlBtn);
  assert(out() === '<mark style="background: #12ab3480">一段文字</mark>\n', '主按鈕直接套用上次的色彩：' + JSON.stringify(out()));
  view.toolbar.openHighlightPopup(view.toolbar.hlBtn);
  p = document.querySelector('.wm-hl-popup');
  assert(p.querySelectorAll('.wm-cp-swatch').length === 17 && p.querySelector('.wm-cp-swatch.is-active').getAttribute('aria-label') === '#12AB3480', '面板列出最近使用的自訂色彩，並標出目前的色彩');
  select(1, 5);
  click(p.querySelector('.wm-cp-clear'));
  assert(out() === '一段文字\n', '無色彩：移除醒目提示');
  plugin.settings.lastHighlight = '';
  view.buildToolbar();
  // 字型色彩
  select(1, 3);
  view.toolbar.openColorPopup(view.toolbar.colorBtn);
  p = document.querySelector('.wm-color-popup');
  assert(p.querySelectorAll('.wm-cp-swatch').length === 50 && !p.querySelector('.wm-cp-range'), '字型色彩面板：標準色彩與深淺變化');
  const fhex = p.querySelector('.wm-cp-hex');
  fhex.value = '#336699'; fhex.dispatchEvent(new Event('input'));
  fhex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(out() === '<span style="color: #336699">一段</span>文字\n' && plugin.settings.recentFontColors[0] === '#336699' && plugin.settings.lastFontColor === '#336699', '自訂的字型色彩（按 Enter 套用）：' + JSON.stringify(out()));
  select(1, 3);
  view.toolbar.openColorPopup(view.toolbar.colorBtn);
  click(document.querySelector('.wm-color-popup .wm-cp-clear'));
  assert(out() === '一段文字\n', '自動：清除字型色彩');
}

// ======== Markdown／閱讀模式的工具列：版面跟 Word 模式的功能區一樣 ========
{
  const containerEl = document.createElement('div');
  const contentEl = containerEl.createDiv('view-content');
  document.body.appendChild(containerEl);
  const md = { containerEl, contentEl, leaf: {}, mode: 'source', getMode() { return this.mode; }, editor: { focus() {} }, getState() { return {}; }, async setState(st) { this.mode = st.mode; } };
  plugin.lastTab = 'viewtab';
  plugin.switchToWord = () => { plugin.toWord = (plugin.toWord || 0) + 1; };
  const bar = new B.MarkdownBar(plugin, md);
  assert(bar.dom.classList.contains('wm-layout-tabs') && bar.dom.querySelectorAll('.wm-tab').length === 4 && containerEl.firstChild === bar.dom, 'Markdown 工具列也有同樣的四個分頁');
  assert(!bar.panels.viewtab.classList.contains('is-hidden') && bar.panels.home.classList.contains('is-hidden'), '切換模式後停在同一個分頁（檢視）');
  const labels = root => [...root.querySelectorAll('.wm-group-views .wm-btn')].map(b => b.classList.contains('has-label') + ':' + b.querySelector('.wm-btn-label').textContent);
  assert(labels(bar.dom).join() === 'true:Word 模式,true:Markdown,true:閱讀' && labels(bar.dom).join() === labels(view.toolbar.dom).join(), '檢視模式的三個按鈕跟 Word 模式一樣大、一樣的位置：' + labels(bar.dom).join());
  const groups = root => [...root.querySelectorAll('.wm-panel:not(.is-hidden) .wm-group[class*="wm-group-"]')].map(g => g.className.replace(/.*wm-group-(\w+).*/, '$1'));
  view.toolbar.showTab('viewtab');
  assert(groups(bar.dom)[0] === 'views' && groups(view.toolbar.dom)[0] === 'views', '檢視分頁的第一個群組都是檢視模式');
  const first = bar.dom.querySelector('.wm-group-views .wm-btn');
  const mdBtn = [...bar.dom.querySelectorAll('.wm-group-views .wm-btn')][1];
  assert(mdBtn.classList.contains('is-active'), 'Markdown 按鈕顯示成目前的模式');
  await bar.setMode('preview');
  assert(bar.dom.querySelector('.wm-group-views .wm-btn') === first && bar.mode === 'preview' && !mdBtn.classList.contains('is-active'), '切換編輯／閱讀：只更新按鈕狀態，不重畫工具列');
  const bold = bar.items.find(i => i.title.startsWith('粗體')).dom;
  assert(bold.classList.contains('is-disabled') && bold.getAttribute('aria-label').includes('閱讀模式不能編輯'), '閱讀模式：編輯按鈕停用並說明原因');
  click(bar.tabBtns.home);
  assert(plugin.lastTab === 'home' && !bar.panels.home.classList.contains('is-hidden'), 'Markdown 工具列切換分頁，也會記住分頁');
  click(first);
  assert(plugin.toWord === 1, '按「Word 模式」切回 Word 模式');
  bar.destroy();
  plugin.settings.ribbonLayout = 'wrap';
  const flat = new B.MarkdownBar(plugin, md);
  const finds = flat.items.filter(i => i.title.startsWith('尋找'));
  assert(flat.dom.querySelector('.wm-tabs').classList.contains('is-hidden') && finds.length === 2, '全部排在一起的版面：同一個功能只出現一次（外加右邊的快速按鈕）：' + finds.length);
  flat.destroy();
  delete plugin.settings.ribbonLayout;
  view.toolbar.showTab('home');
}

// ======== 方程式編輯器：復原、拆掉結構、打指令 ========
await fresh('公式：\n');
{
  const typeIn = (span, text) => { span.focus(); span.textContent = text; mock.Modal.last.field.place(span, text.length); span.dispatchEvent(new Event('input', { bubbles: true })); };
  const keyOn = (span, key, mods = {}) => { span.focus(); span.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, mods))); };
  view.openEquation();
  const eq = mock.Modal.last;
  await sleep(25);
  const q = s => eq.contentEl.querySelector(s);
  const qa = s => [...eq.contentEl.querySelectorAll(s)];
  const snippet = s => qa('.wm-eq-btn').find(b => b.getAttribute('aria-label') === s);
  assert(eq.undoBtn.disabled && eq.redoBtn.disabled, '一開始沒有東西可以復原');
  click(snippet('\\frac{}{}'));
  click(snippet('\\frac{}{}'));
  assert(qa('.wm-mv-frac').length === 2 && qa('.wm-mv-text.is-slot').length === 3, '分數裡再放一個分數：三個格子');
  // 在裡面那個（空的）分數按 Backspace：變回原本的分數
  const inner = q('.wm-mv-num .wm-mv-num .wm-mv-text');
  eq.field.place(inner, 0);
  keyOn(inner, 'Backspace');
  assert(qa('.wm-mv-frac').length === 1 && qa('.wm-mv-text.is-slot').length === 2 && eq.ta.value === '\\frac{}{}', '空格子裡按 Backspace：拿掉裡面的分數，變回一個分數：' + eq.ta.value);
  assert(!eq.undoBtn.disabled, '有東西可以復原');
  click(eq.undoBtn);
  assert(qa('.wm-mv-frac').length === 2 && eq.ta.value === '\\frac{\\frac{}{}}{}', '復原：回到分數裡的分數：' + eq.ta.value);
  click(eq.undoBtn);
  assert(qa('.wm-mv-frac').length === 1 && !eq.redoBtn.disabled, '再復原：回到一個分數');
  click(eq.redoBtn);
  assert(qa('.wm-mv-frac').length === 2, '取消復原');
  keyOn(qa('.wm-mv-text')[0], 'z', { ctrlKey: true });
  keyOn(qa('.wm-mv-text')[0], 'z', { ctrlKey: true });
  assert(!q('.wm-mv-frac') && eq.ta.value === '' && eq.undoBtn.disabled, 'Ctrl+Z 一路復原到空白：' + JSON.stringify(eq.ta.value));
  keyOn(qa('.wm-mv-text')[0], 'y', { ctrlKey: true });
  assert(qa('.wm-mv-frac').length === 1, 'Ctrl+Y 取消復原');
  // 有內容的結構：拆掉結構，內容留著
  typeIn(q('.wm-mv-num .wm-mv-text'), 'a');
  typeIn(q('.wm-mv-den .wm-mv-text'), 'b');
  const den = q('.wm-mv-den .wm-mv-text');
  eq.field.place(den, 0);
  keyOn(den, 'Backspace');
  assert(!q('.wm-mv-frac') && eq.ta.value === 'ab', '有內容的分數按 Backspace：拿掉分數，內容留著：' + eq.ta.value);
  click(eq.undoBtn);
  assert(eq.ta.value === '\\frac{a}{b}', '復原回分數：' + eq.ta.value);
  // 打「\指令」再按空白
  const tail = qa('.wm-mv > .wm-mv-row > .wm-mv-text').pop();
  typeIn(tail, '+\\sqrt ');
  assert(q('.wm-mv-sqrt') && eq.ta.value === '\\frac{a}{b}+\\sqrt{}', '打 \\sqrt 再按空白：變成根號的格子：' + eq.ta.value);
  typeIn(q('.wm-mv-radicand .wm-mv-text'), '\\alpha ');
  assert(q('.wm-mv-radicand .wm-mv-text').textContent === 'α' && eq.ta.value === '\\frac{a}{b}+\\sqrt{\\alpha}', '打 \\alpha 再按空白：顯示成 α：' + eq.ta.value);
  // 格子結尾按 Delete：刪掉後面的結構
  const head = qa('.wm-mv > .wm-mv-row > .wm-mv-text')[0];
  eq.field.place(head, 0);
  keyOn(head, 'Delete');
  assert(eq.ta.value === '+\\sqrt{\\alpha}', '格子結尾按 Delete：刪掉後面的分數：' + eq.ta.value);
  // Enter：跳到下一格
  const spans = qa('.wm-mv-text');
  keyOn(spans[0], 'Enter');
  assert(spans[1].contains(document.getSelection().anchorNode), 'Enter 跳到下一格');
  eq.close();

  // 既有的方程式：改了再復原，交回一字不差的原文
  await fresh('公式 $x^2$ 結束\n');
  view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const eq2 = mock.Modal.last;
  await sleep(25);
  typeIn(eq2.contentEl.querySelector('.wm-mv-sup .wm-mv-text'), '3');
  assert(eq2.ta.value === 'x^{3}', '改上標：' + eq2.ta.value);
  click(eq2.undoBtn);
  assert(eq2.ta.value === 'x^2', '復原到沒改過的狀態：原本的寫法一字不動：' + eq2.ta.value);
  // 在 LaTeX 模式改過再切回視覺化：也是可以復原的一步
  eq2.setEdit('latex');
  assert(eq2.undoBtn.style.display === 'none', 'LaTeX 模式不顯示復原按鈕（輸入框自己能復原）');
  eq2.ta.value = '\\frac{1}{2}';
  eq2.setEdit('visual');
  assert(eq2.contentEl.querySelector('.wm-mv-frac') && !eq2.undoBtn.disabled, '從 LaTeX 切回視覺化：重新建立格子');
  click(eq2.undoBtn);
  assert(eq2.ta.value === 'x^2' && eq2.contentEl.querySelector('.wm-mv-sup'), '復原 LaTeX 模式的修改：' + eq2.ta.value);
  eq2.close();
}

// ======== 圖表編輯器：每種圖表都有表單，也可以在圖上編輯 ========
await fresh('第一段\n');
{
  view.openMermaid();
  const mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  const kind = id => qa('.wm-mmd-kind').find(b => b.dataset.kind === id);
  const lists = () => qa('.wm-mmd-list').map(l => l.querySelectorAll('.wm-mmd-row').length).join();
  const setInput = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  assert(qa('.wm-mmd-kind').length === 11 && kind('flowchart').classList.contains('is-active'), '上方列出十一種圖表，標出目前的種類');
  // 每一種範本都開在表單
  for (const k of ['sequence', 'gantt', 'pie', 'state', 'class', 'mindmap', 'timeline', 'er', 'journey', 'quadrant', 'flowchart']) {
    click(kind(k));
    assert(mm.tab === 'visual' && !q('.wm-mmd-blocked') && qa('.wm-mmd-row').length >= 2 && kind(k).classList.contains('is-active'), '範本可以用表單編輯：' + k + '（' + lists() + '）');
  }
  // 循序圖：參與者改名、新增訊息、移動順序
  click(kind('sequence'));
  assert(lists() === '2,2', '循序圖：兩個參與者、兩則訊息');
  setInput(q('.wm-mmd-row .wm-mmd-f-name'), '客戶');
  assert(mm.src.includes('participant 客戶') && mm.src.includes('客戶->>系統: 送出請求') && mm.src.includes('系統-->>客戶: 回覆結果'), '參與者改名：訊息裡的名稱一起改：' + JSON.stringify(mm.src));
  assert(q('.wm-mmd-f-from').value === '客戶' && [...q('.wm-mmd-f-from').options].map(o => o.value).join() === '客戶,系統', '下拉選單的選項跟著更新');
  click(qa('.wm-mmd-add')[1]);
  assert(lists() === '2,3' && mm.src.endsWith('客戶->>系統: 新訊息'), '新增訊息：' + JSON.stringify(mm.src.split('\n').pop()));
  const lastRow = qa('.wm-mmd-list')[1].querySelectorAll('.wm-mmd-row')[2];
  click([...lastRow.querySelectorAll('.wm-mmd-iconbtn')].find(b => b.getAttribute('aria-label') === '上移'));
  assert(mm.src.split('\n').slice(-2).join('|') === '    客戶->>系統: 新訊息|    系統-->>客戶: 回覆結果', '上移一列：' + JSON.stringify(mm.src.split('\n').slice(-2)));
  const arrow = qa('.wm-mmd-list')[1].querySelectorAll('.wm-mmd-f-arrow')[1];
  arrow.value = 'note-right'; arrow.dispatchEvent(new Event('change'));
  assert(mm.src.includes('Note right of 客戶: 新訊息'), '訊息改成備註：' + JSON.stringify(mm.src));
  // 內容改過：換種類前先問
  const before = mm.src;
  click(kind('pie'));
  assert(q('.wm-mmd-confirm').style.display !== 'none' && mm.src === before, '內容改過：換範本前先問，不會直接蓋掉');
  click([...q('.wm-mmd-confirm').querySelectorAll('button')][1]);
  assert(q('.wm-mmd-confirm').style.display === 'none' && mm.src === before, '取消：內容不變');
  click(kind('pie'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  assert(mm.src.startsWith('pie title 佔比') && lists() === '3' && q('.wm-mmd-head .wm-mmd-f-title').value === '佔比', '取代成圓餅圖的範本');
  // 圓餅圖：改數值、勾選顯示數值、刪除一列
  setInput(qa('.wm-mmd-f-value')[0], '60');
  const show = q('.wm-mmd-check input');
  show.checked = true; show.dispatchEvent(new Event('change'));
  assert(mm.src.startsWith('pie showData title 佔比\n    "項目一" : 60'), '圓餅圖：改數值、顯示數值：' + JSON.stringify(mm.src));
  // ---- 在圖上編輯：點圖上的文字，直接改
  const NS = 'http://www.w3.org/2000/svg';
  const draw = (...texts) => {
    mm.prev.replaceChildren();
    const svg = document.createElementNS(NS, 'svg');
    for (const tx of texts) { const el = document.createElementNS(NS, 'text'); el.textContent = tx; svg.appendChild(el); }
    mm.prev.appendChild(svg);
    return [...svg.querySelectorAll('text')];
  };
  let [legend, pct] = draw('項目二 [30]', '32%');
  click(pct);
  assert(!q('.wm-mmd-inline'), '點到不是欄位的文字（百分比）：沒有反應');
  click(legend);
  let inline = q('.wm-mmd-inline');
  assert(inline && inline.querySelector('input').value === '項目二' && qa('.wm-mmd-row.is-current').length === 1, '點圖例：在圖上出現輸入框，表單也標出那一列');
  inline.querySelector('input').value = '乙';
  inline.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(!q('.wm-mmd-inline') && mm.src.includes('"乙" : 30') && qa('.wm-mmd-f-label')[1].value === '乙', '在圖上改文字：程式碼與表單都更新：' + JSON.stringify(mm.src));
  // 正在圖上編輯時按 Esc：只關掉輸入框
  [legend] = draw('乙');
  click(legend);
  q('.wm-mmd-inline input').value = '不要';
  mm.close();
  assert(!q('.wm-mmd-inline') && document.body.contains(mm.contentEl) && !mm.src.includes('不要'), '圖上編輯時按 Esc：只關掉輸入框，不套用、也不關閉編輯器');
  // 在圖上刪除一列
  [legend] = draw('乙');
  click(legend);
  click(q('.wm-mmd-inline .is-danger'));
  assert(lists() === '2' && !mm.src.includes('乙'), '在圖上刪除一列：' + JSON.stringify(mm.src));
  // 流程圖：點節點的形狀也可以（用節點代號對應）；圖上可以新增下一步
  click(kind('flowchart'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  mm.prev.replaceChildren();
  const svg = document.createElementNS(NS, 'svg');
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'node'); g.id = 'flowchart-C-3';
  const rect = document.createElementNS(NS, 'rect');
  const label = document.createElementNS(NS, 'text'); label.textContent = '處理';
  g.appendChild(rect); g.appendChild(label); svg.appendChild(g); mm.prev.appendChild(svg);
  click(rect);
  inline = q('.wm-mmd-inline');
  assert(inline && inline.querySelector('input').value === '處理', '流程圖：點節點的方框也能編輯');
  click(inline.querySelectorAll('.wm-mmd-inline-btn')[1]);
  assert(lists() === '5,5' && mm.src.includes('C --> N5') && document.activeElement.value === '新步驟', '在圖上新增下一步：多一個步驟與一條連線，游標在新步驟：' + JSON.stringify(mm.src));
  // 狀態圖：在圖上改名，所有出現的地方一起改
  click(kind('state'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  const [st] = draw('進行中');
  click(st);
  q('.wm-mmd-inline input').value = '處理中';
  q('.wm-mmd-inline input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(mm.src.includes('待處理 --> 處理中') && mm.src.includes('處理中 --> 完成') && !mm.src.includes('進行中'), '狀態圖在圖上改名：前後的轉換一起改：' + JSON.stringify(mm.src));
  // 心智圖：階層
  click(kind('mindmap'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  const rows = () => qa('.wm-mmd-row');
  assert(rows().length === 4 && rows()[0].querySelectorAll('.wm-mmd-iconbtn').length === 1 && rows()[2].style.getPropertyValue('--wm-mmd-level') === '2', '心智圖：中心主題不能刪除，分支依階層縮排');
  click(rows()[3].querySelectorAll('.wm-mmd-levelbtn')[1]);
  assert(mm.src.endsWith('      細項\n      分支二'), '心智圖：往內一層：' + JSON.stringify(mm.src));
  click(rows()[1].querySelector('.wm-mmd-iconbtn'));
  assert(rows().length === 5 && mm.src.includes('    分支一\n      新分支\n      細項'), '心智圖：新增子分支：' + JSON.stringify(mm.src));
  // 套用：寫進筆記
  click(q('button.mod-cta'));
  assert(out().startsWith('第一段\n\n```mermaid\nmindmap\n  root((主題))\n    分支一\n      新分支\n      細項\n      分支二\n```\n'), '套用後存成 mermaid 區塊：' + JSON.stringify(out()));

  // 既有的圖表：沒有修改就關閉，原本的程式碼一字不動
  await fresh('```mermaid\npie title 佔比\n  "甲" : 1\n  "乙" : 2\n```\n');
  view.pm.dom.querySelector('.wm-code-edit').click();
  const m2 = mock.Modal.last;
  assert(m2.tab === 'visual' && m2.contentEl.querySelectorAll('.wm-mmd-row').length === 2, '既有的圓餅圖開在表單');
  m2.contentEl.querySelector('button.mod-cta').click();
  assert(out() === '```mermaid\npie title 佔比\n  "甲" : 1\n  "乙" : 2\n```\n', '沒有修改：原本的寫法（含縮排）不變：' + JSON.stringify(out()));
}

// ======== 方程式編輯器：觸控裝置用的按鈕與輸入 ========
await fresh('公式：\n');
{
  const typeIn = (span, text) => { span.focus(); span.textContent = text; mock.Modal.last.field.place(span, text.length); span.dispatchEvent(new Event('input', { bubbles: true })); };
  view.openEquation();
  const eq = mock.Modal.last;
  await sleep(25);
  const q = s => eq.contentEl.querySelector(s);
  const qa = s => [...eq.contentEl.querySelectorAll(s)];
  const tool = name => qa('.wm-eq-tool').find(b => b.getAttribute('aria-label').startsWith(name));
  assert(qa('.wm-eq-tool').length === 5 && tool('上一格') && tool('下一格') && tool('拿掉游標所在的結構'), '編輯區有上一格、下一格、拿掉結構、復原、取消復原');
  // 螢幕鍵盤打的 ^、_ 沒有按鍵事件，字直接進到格子裡
  typeIn(qa('.wm-mv-text')[0], 'x^');
  assert(q('.wm-mv-sup') && eq.ta.value === 'x^{}' && q('.wm-mv-sup .wm-mv-text').contains(document.getSelection().anchorNode), '打進格子裡的 ^ 變成上標的格子：' + eq.ta.value);
  typeIn(q('.wm-mv-sup .wm-mv-text'), '2');
  typeIn(qa('.wm-mv > .wm-mv-row > .wm-mv-text').pop(), '+a_');
  assert(q('.wm-mv-sub') && eq.ta.value === 'x^{2}+a_{}', '打進格子裡的 _ 變成下標的格子：' + eq.ta.value);
  typeIn(q('.wm-mv-sub .wm-mv-text'), 'i');
  // 上一格、下一格
  click(tool('上一格'));
  const spans = qa('.wm-mv-text');
  assert(spans[spans.indexOf(q('.wm-mv-sub .wm-mv-text')) - 1].contains(document.getSelection().anchorNode), '「上一格」把游標移到前一格');
  click(tool('下一格'));
  assert(q('.wm-mv-sub .wm-mv-text').contains(document.getSelection().anchorNode), '「下一格」把游標移回來');
  // 拿掉結構：游標在下標裡，內容留著
  click(tool('拿掉游標所在的結構'));
  assert(!q('.wm-mv-sub') && eq.ta.value === 'x^{2}+ai', '「拿掉結構」拿掉游標所在的下標，內容留著：' + eq.ta.value);
  // 游標在最外層：拿掉前面最近的一個結構
  click(tool('拿掉游標所在的結構'));
  assert(!q('.wm-mv-sup') && eq.ta.value === 'x+ai', '游標不在結構裡：拿掉前面最近的結構（上標）：' + eq.ta.value);
  click(eq.undoBtn);
  assert(eq.ta.value === 'x^{2}+ai', '按鈕做的事也能復原：' + eq.ta.value);
  // 常用公式
  click(qa('.wm-eq-cat').find(b => b.textContent === '常用公式'));
  const formulas = qa('.wm-eq-btn.is-formula');
  assert(formulas.length === 6 && formulas[1].querySelector('.wm-eq-btn-label').textContent === '畢氏定理', '常用公式：六條，公式下面有名稱');
  eq.setEdit('latex'); eq.ta.value = ''; eq.setEdit('visual');
  click(formulas[1]);
  assert(eq.ta.value === 'a^{2} + b^{2} = c^{2}' && qa('.wm-mv-sup').length === 3, '插入常用公式：變成可以直接改的格子：' + eq.ta.value);
  eq.close();
}

// ======== 圖表編輯器：外觀、節點底色、預覽縮放、旅程圖與象限圖 ========
await fresh('第一段\n');
{
  view.openMermaid();
  const mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  const kind = id => qa('.wm-mmd-kind').find(b => b.dataset.kind === id);
  const setInput = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  // 外觀：每種圖表的設定列都有，寫成最前面的一行
  const theme = q('.wm-mmd-head .wm-mmd-f-theme');
  assert(theme && theme.options.length === 6 && theme.value === '', '設定列有「外觀」，預設跟著 Obsidian');
  theme.value = 'forest'; theme.dispatchEvent(new Event('change'));
  assert(mm.src.startsWith('%%{init: {"theme": "forest"}}%%\nflowchart TD\n'), '選外觀：寫在最前面：' + JSON.stringify(mm.src.split('\n')[0]));
  mm.setTab('code'); mm.setTab('visual');
  assert(q('.wm-mmd-head .wm-mmd-f-theme').value === 'forest' && !q('.wm-mmd-blocked'), '有外觀設定的圖仍然開在表單');
  q('.wm-mmd-head .wm-mmd-f-theme').value = ''; q('.wm-mmd-head .wm-mmd-f-theme').dispatchEvent(new Event('change'));
  assert(mm.src.startsWith('flowchart TD\n'), '改回跟著 Obsidian：拿掉那一行');
  // 節點的底色：按鈕展開色塊
  const colorBtn = q('.wm-mmd-row .wm-mmd-color');
  assert(colorBtn && colorBtn.querySelector('.wm-mmd-color-dot').classList.contains('is-none') && !q('.wm-mmd-swatches'), '步驟有底色按鈕，預設沒有顏色');
  click(colorBtn);
  const sw = qa('.wm-mmd-row .wm-mmd-swatches .wm-mmd-swatch');
  assert(sw.length === 9 && sw[0].classList.contains('is-active') && sw[4].getAttribute('aria-label') === '綠色', '展開色塊：預設加八種顏色');
  click(sw[4]);
  assert(mm.src.endsWith('    style A fill:#d3f9d8,stroke:#839a86,color:#1f2328') && !q('.wm-mmd-swatches') && !q('.wm-mmd-row .wm-mmd-color-dot').classList.contains('is-none'), '選底色：寫成 style 行，色塊收起來：' + JSON.stringify(mm.src.split('\n').pop()));
  // 在圖上選底色
  const NS = 'http://www.w3.org/2000/svg';
  mm.prev.replaceChildren();
  const svg = document.createElementNS(NS, 'svg');
  const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node'); g.id = 'flowchart-B-1';
  const label = document.createElementNS(NS, 'text'); label.textContent = '結束';
  g.appendChild(label); svg.appendChild(g); mm.prev.appendChild(svg);
  click(label);
  const inlineSw = qa('.wm-mmd-inline .wm-mmd-swatch');
  assert(inlineSw.length === 9, '圖上的輸入框也有色塊');
  click(inlineSw[1]);
  assert(!q('.wm-mmd-inline') && mm.src.includes('    style B fill:#ffe3e3,stroke:#9e8d8d,color:#1f2328'), '在圖上選底色：' + JSON.stringify(mm.src));
  click(q('.wm-mmd-row .wm-mmd-color'));
  click(qa('.wm-mmd-row .wm-mmd-swatches .wm-mmd-swatch')[0]);
  assert(!mm.src.includes('style A'), '選「預設的色彩」：拿掉那一行 style');
  // 預覽縮放
  const zoom = qa('.wm-mmd-zoombtn');
  click(zoom[1]); click(zoom[1]);
  assert(mm.zoom === 1.5 && q('.wm-mmd-zoomlabel').textContent === '150%', '放大預覽：' + q('.wm-mmd-zoomlabel').textContent);
  mm.preview();
  assert(q('.wm-mmd-canvas').style.zoom === '1.5' && q('.wm-mmd-canvas').textContent.startsWith('RENDERED:'), '重畫之後保留縮放倍率');
  for (let i = 0; i < 9; i++) click(zoom[0]);
  assert(mm.zoom === 0.5, '最小縮到 50%');
  click(q('.wm-mmd-zoomlabel'));
  assert(mm.zoom === 1 && q('.wm-mmd-canvas').style.zoom === '1', '按百分比恢復 100%');
  // 旅程圖
  click(kind('journey'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  assert(mm.src.startsWith('journey\n    title 我的一天') && qa('.wm-mmd-row').length === 3 && q('.wm-mmd-f-score').value === '5', '旅程圖的範本開在表單');
  q('.wm-mmd-f-score').value = '1'; q('.wm-mmd-f-score').dispatchEvent(new Event('change'));
  setInput(qa('.wm-mmd-f-actors')[0], '我, 主管');
  assert(mm.src.includes('      泡茶: 1: 我, 主管'), '旅程圖：改分數與參與的人：' + JSON.stringify(mm.src));
  // 象限圖：座標軸與象限在設定列，圖上的象限名稱可以直接改
  click(kind('quadrant'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  assert(qa('.wm-mmd-head input').length === 9 && q('.wm-mmd-head .wm-mmd-f-q1').value === '馬上做' && qa('.wm-mmd-row').length === 2, '象限圖的範本開在表單：座標軸、象限、項目');
  setInput(qa('.wm-mmd-f-x')[1], '0.25');
  assert(mm.src.endsWith('    "整理信箱": [0.25, 0.2]'), '象限圖：改項目的位置：' + JSON.stringify(mm.src.split('\n').pop()));
  mm.prev.replaceChildren();
  const svg2 = document.createElementNS(NS, 'svg');
  const quad = document.createElementNS(NS, 'text'); quad.textContent = '馬上做';
  svg2.appendChild(quad); mm.prev.appendChild(svg2);
  click(quad);
  assert(q('.wm-mmd-inline input').value === '馬上做' && !q('.wm-mmd-inline .is-danger'), '點圖上的象限名稱：可以改，沒有刪除（它是設定，不是清單的一列）');
  q('.wm-mmd-inline input').value = '現在做';
  q('.wm-mmd-inline input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(mm.src.includes('    quadrant-1 "現在做"') && q('.wm-mmd-head .wm-mmd-f-q1').value === '現在做', '在圖上改象限名稱：' + JSON.stringify(mm.src));
  mm.close();
}

finish();
