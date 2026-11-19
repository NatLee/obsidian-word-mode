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
  // 設定「檢視模式的按鈕顯示文字」關閉：兩條功能區的這三個按鈕都只剩圖示，其他大按鈕不變
  {
    plugin.settings.viewButtonLabels = false;
    view.buildToolbar();
    const bar2 = new B.MarkdownBar(plugin, md);
    const shape = root => [...root.querySelectorAll('.wm-group-views .wm-btn')].map(b => b.classList.contains('has-label') + ':' + !!b.querySelector('.wm-btn-label') + ':' + !!b.querySelector('.wm-btn-icon')).join();
    assert(shape(bar2.dom) === 'false:false:true,false:false:true,false:false:true' && shape(bar2.dom) === shape(view.toolbar.dom), '關閉「檢視模式的按鈕顯示文字」：三個按鈕只顯示圖示，兩條功能區一致：' + shape(bar2.dom));
    const names = root => [...root.querySelectorAll('.wm-group-views .wm-btn')].map(b => b.getAttribute('aria-label').split(' (')[0]).join();
    assert(names(bar2.dom) === '切換到 Word 模式,Markdown 編輯,閱讀模式' && names(view.toolbar.dom) === 'Word 模式（目前）,切換到 Markdown 編輯,閱讀模式', '名稱仍在提示裡：' + names(bar2.dom));
    assert(view.toolbar.dom.querySelector('.wm-group-show .wm-btn.has-label') && bar2.dom.querySelector('.wm-group-show .wm-btn.has-label'), '其他大按鈕（大綱等）照常顯示文字');
    plugin.settings.buttonStyle = 'label';
    view.buildToolbar();
    assert(shape(view.toolbar.dom) === 'false:false:true,false:false:true,false:false:true' && view.toolbar.dom.querySelector('.wm-group-clipboard .wm-btn.has-label'), '按鈕樣式是「圖示加文字」時，這三個按鈕仍然只顯示圖示（其他按鈕有文字）');
    plugin.settings.buttonStyle = 'auto';
    bar2.destroy();
    plugin.settings.viewButtonLabels = true;
    view.buildToolbar();
    assert(labels(view.toolbar.dom).join() === 'true:Word 模式,true:Markdown,true:閱讀', '重新開啟後恢復顯示文字');
  }
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

  // 工具列的高度記在 --wm-mdbar-height：樣式表用它把其他外掛貼在標題列正下方的東西（Pretty Properties 的按鈕列）往下移，不疊在工具列上
  const observers = [];
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.off = true; } };
  const sized = new B.MarkdownBar(plugin, md);
  const height = () => containerEl.style.getPropertyValue('--wm-mdbar-height');
  assert(height() === '0px' && observers.length === 1 && observers[0].target === sized.dom, 'Markdown 工具列：建立時記下高度，並跟著工具列的大小更新：' + height());
  Object.defineProperty(sized.dom, 'offsetHeight', { value: 71, configurable: true });
  observers[0].cb();
  assert(height() === '71px', '工具列變高（換分頁、換行）時更新高度：' + height());
  sized.destroy();
  assert(height() === '' && observers[0].off, '移除工具列時清掉高度，其他外掛的東西回到原位');
  delete globalThis.ResizeObserver;
  const plain = new B.MarkdownBar(plugin, md);
  assert(height() === '0px' && plain.sizer === null, '沒有 ResizeObserver 的環境：照常建立工具列');
  plain.destroy();
}

// ======== 自訂按鈕群組：改名稱、調順序、換分頁；設定頁與兩條功能區一致 ========
{
  const S = plugin.settings;
  const clean = () => { S.hiddenTabs = []; S.hiddenGroups = []; S.groupNames = {}; S.groupTabs = {}; S.groupOrder = []; S.tabLabels = {}; };
  clean();
  const of = (list, tab) => list.filter(g => g.tab === tab).map(g => g.id).join();
  assert(of(B.TB.groupLayout(null), 'home') === 'undo,clipboard,styles,font,paragraph,editing' && B.TB.groupLayout({}).length === B.TB.GROUPS.length, '沒有自訂：預設的分頁與順序');
  const odd = B.TB.groupLayout({ groupTabs: { font: 'nowhere', nope: 'home' }, groupOrder: ['nope', 'editing', 'editing'], groupNames: { font: '  ', undo: ' 回上一步 ' } });
  assert(of(odd, 'home') === 'editing,undo,clipboard,styles,font,paragraph' && odd.find(g => g.id === 'font').name === '字型' && odd.find(g => g.id === 'undo').name === '回上一步',
    '設定檔裡不認得的分頁、群組、空白名稱都忽略；沒列在順序裡的群組排在後面：' + of(odd, 'home'));
  assert(B.TB.moveGroup(null, 'undo', -1) === null && B.TB.moveGroup(null, 'editing', 1) === null, '已經在分頁的最前或最後：不能再移');

  // 設定頁的清單；changed 像外掛一樣重建兩條功能區
  const containerEl = document.createElement('div');
  const contentEl = containerEl.createDiv('view-content');
  const md = { containerEl, contentEl, leaf: {}, mode: 'source', getMode() { return this.mode; }, editor: { focus() {} }, getState() { return {}; }, async setState(st) { this.mode = st.mode; } };
  let bar = null; let changes = 0;
  const changed = () => { changes++; view.buildToolbar(); if (bar) bar.destroy(); bar = new B.MarkdownBar(plugin, md); };
  const grid = document.body.createDiv();
  B.fillGroupSettings(grid, S, changed);
  changed();
  const row = id => grid.querySelector('.wm-settings-grow[data-group="' + id + '"]');
  const col = tab => [...grid.querySelectorAll('.wm-settings-groups-col[data-tab="' + tab + '"] .wm-settings-grow')].map(r => r.dataset.group).join();
  const shown = panel => [...panel.querySelectorAll('.wm-group[class*="wm-group-"]')].map(g => [...g.classList].find(c => c.startsWith('wm-group-')).slice(9)).join();
  const change = el => el.dispatchEvent(new Event('change', { bubbles: true }));
  assert(col('home') === 'undo,clipboard,styles,font,paragraph,editing' && col('viewtab') === 'views,show,zoom,help' && grid.querySelector('.wm-settings-greset').disabled, '設定頁：每個分頁一欄，群組照預設順序；沒改過時「還原」停用');
  assert(row('undo').querySelector('.wm-settings-gup').disabled && !row('undo').querySelector('.wm-settings-gdown').disabled && row('editing').querySelector('.wm-settings-gdown').disabled, '最前面的群組不能上移，最後面的不能下移');

  // 改名稱
  const name = row('font').querySelector('.wm-settings-gname');
  assert(name.placeholder === '字型' && name.value === '', '名稱留白時顯示預設名稱');
  name.value = ' 字體 '; change(name);
  assert(S.groupNames.font === '字體' && view.toolbar.dom.querySelector('.wm-group-font .wm-group-name').textContent === '字體' && bar.dom.querySelector('.wm-group-font .wm-group-name').textContent === '字體', '改群組名稱：兩條功能區都換成新名稱');

  // 調順序
  click(row('font').querySelector('.wm-settings-gup'));
  assert(col('home') === 'undo,clipboard,font,styles,paragraph,editing' && shown(view.toolbar.panels.home) === col('home') && shown(bar.panels.home) === 'undo,font,styles,paragraph,editing',
    '上移一格：設定頁與兩條功能區的順序一致：' + shown(view.toolbar.panels.home) + '｜' + shown(bar.panels.home));
  assert(document.activeElement === row('font').querySelector('.wm-settings-gup') && row('font').querySelector('.wm-settings-gname').value === '字體', '重畫後焦點留在同一個群組的箭頭上，名稱還在');
  click(row('font').querySelector('.wm-settings-gup')); click(row('font').querySelector('.wm-settings-gup'));
  assert(col('home') === 'font,undo,clipboard,styles,paragraph,editing' && document.activeElement === row('font').querySelector('.wm-settings-gdown'), '移到最前面：上移停用，焦點換到下移');

  // 換分頁
  const tabSel = row('font').querySelector('.wm-settings-gtab');
  assert([...tabSel.options].map(o => o.value + ':' + o.textContent).join() === 'home:常用,insert:插入,review:校閱,viewtab:檢視' && tabSel.value === 'home', '分頁選單列出四個分頁');
  tabSel.value = 'insert'; change(tabSel);
  assert(S.groupTabs.font === 'insert' && col('insert') === 'tables,illustrations,links,code,text,obsidian,font' && !col('home').includes('font'), '移到別的分頁：排在那個分頁的最後');
  assert(shown(view.toolbar.panels.insert) === col('insert') && !view.toolbar.panels.home.querySelector('.wm-group-font') && bar.panels.insert.querySelector('.wm-group-font') && !bar.panels.home.querySelector('.wm-group-font'), '兩條功能區的「字型」都在插入分頁');
  assert(btn('粗體').closest('.wm-panel') === view.toolbar.panels.insert, '按鈕跟著群組走');
  const back = row('font').querySelector('.wm-settings-gtab');
  back.value = 'home'; change(back);
  assert(!('font' in S.groupTabs) && col('home') === 'undo,clipboard,styles,paragraph,editing,font', '移回原本的分頁：設定裡不留紀錄');

  // 群組都移走的分頁
  for (const id of ['proofing', 'stats', 'comments']) { const s = row(id).querySelector('.wm-settings-gtab'); s.value = 'viewtab'; change(s); }
  assert(grid.querySelector('.wm-settings-groups-col[data-tab="review"] .wm-settings-gempty') && !view.toolbar.tabBtns.review && !bar.tabBtns.review && col('viewtab') === 'views,show,zoom,help,proofing,stats,comments',
    '群組都移走的分頁：功能區不顯示這個分頁，設定頁仍列出來（可以再移回來）');

  // 顯示／隱藏
  const fontCb = row('font').querySelector('input[type="checkbox"]');
  fontCb.checked = false; change(fontCb);
  assert(S.hiddenGroups.join() === 'font' && !view.toolbar.dom.querySelector('.wm-group-font') && !bar.dom.querySelector('.wm-group-font'), '取消勾選群組：兩條功能區都不顯示');
  const homeCb = grid.querySelector('.wm-settings-groups-col[data-tab="home"] .wm-settings-tab input');
  homeCb.checked = false; change(homeCb);
  assert(S.hiddenTabs.join() === 'home' && row('undo').querySelector('input[type="checkbox"]').disabled && !view.toolbar.tabBtns.home, '取消勾選分頁：該分頁的群組勾選框停用');

  // 還原
  const before = changes;
  assert(!grid.querySelector('.wm-settings-greset').disabled, '改過之後可以還原');
  click(grid.querySelector('.wm-settings-greset'));
  assert(changes === before + 1 && !Object.keys(S.groupNames).length && !Object.keys(S.groupTabs).length && !S.groupOrder.length && col('review') === 'proofing,stats,comments' && col('home') === 'undo,clipboard,styles,font,paragraph,editing'
    && S.hiddenGroups.join() === 'font' && S.hiddenTabs.join() === 'home', '還原預設的群組名稱與排列（顯示／隱藏的勾選不變）');

  clean();
  changed();
  assert(shown(view.toolbar.panels.home) === 'undo,clipboard,styles,font,paragraph,editing' && view.toolbar.dom.querySelector('.wm-group-font .wm-group-name').textContent === '字型', '清掉自訂後功能區回到預設');
  bar.destroy();
  grid.remove();
  view.toolbar.showTab('home');
}

// ======== Markdown／閱讀模式的工具列：可以只在其中一種模式顯示 ========
{
  const { mdToolbarMode, wantsMdBar } = B;
  assert(mdToolbarMode(true) === 'both' && mdToolbarMode(undefined) === 'both' && mdToolbarMode(false) === 'none' && mdToolbarMode('preview') === 'preview' && mdToolbarMode('亂寫') === 'both',
    '舊版的開關設定換成新的值：開＝都顯示、關＝都隱藏；不認得的值當成都顯示');
  const table = ['both', 'source', 'preview', 'none'].map(m => m + ':' + wantsMdBar(m, 'source') + ',' + wantsMdBar(m, 'preview')).join(' ');
  assert(table === 'both:true,true source:true,false preview:false,true none:false,false', '四種設定在 Markdown 編輯／閱讀模式要不要顯示工具列：' + table);
  assert(wantsMdBar(true, 'source') && wantsMdBar(true, 'preview') && !wantsMdBar(false, 'source') && wantsMdBar('source', undefined), '還沒轉換的舊值照舊的意思；不知道模式時當成編輯');

  // 用工具列自己的按鈕切換模式：切完會請外掛重新決定哪些檢視要有工具列（這裡的替身照設定收掉它）
  const containerEl = document.createElement('div');
  const contentEl = containerEl.createDiv('view-content');
  document.body.appendChild(containerEl);
  const md = { containerEl, contentEl, leaf: {}, mode: 'source', getMode() { return this.mode; }, editor: { focus() {} }, getState() { return {}; }, async setState(st) { this.mode = st.mode; } };
  plugin.settings.mdToolbar = 'source';
  const bar = new B.MarkdownBar(plugin, md);
  let synced = 0;
  plugin.syncMdBars = () => { synced++; if (!wantsMdBar(plugin.settings.mdToolbar, md.getMode())) bar.destroy(); };
  await bar.setMode('source');
  assert(synced === 1 && bar.dom.isConnected && bar.mode === 'source', '設定「只在 Markdown 編輯顯示」：留在編輯模式時工具列還在');
  await bar.setMode('preview');
  assert(synced === 2 && md.mode === 'preview' && !bar.dom.isConnected && containerEl.style.getPropertyValue('--wm-mdbar-height') === '', '切到閱讀模式後工具列收起來');
  plugin.syncMdBars = () => {};
  delete plugin.settings.mdToolbar;
  containerEl.remove();
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
  assert(qa('.wm-mmd-kind[data-kind]').length === 11 && kind('flowchart').classList.contains('is-active') && q('.wm-mmd-kind.wm-mmd-mine'), '上方列出十一種圖表，標出目前的種類，最後是「我的範本」');
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
  inline.querySelector('input').value = '檢查';
  click(inline.querySelectorAll('.wm-mmd-inline-btn')[2]);
  assert(lists() === '5,5' && mm.src.includes('C --> N5') && document.activeElement.value === '新步驟', '在圖上新增下一步：多一個步驟與一條連線，游標在新步驟：' + JSON.stringify(mm.src));
  assert(mm.src.includes('C[檢查]') && !mm.src.includes('C[處理]'), '在圖上改了文字再按「新增下一步」：改的文字留下來：' + JSON.stringify(mm.src));
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
  q('.wm-mmd-inline input').value = '完成';
  click(inlineSw[1]);
  assert(!q('.wm-mmd-inline') && mm.src.includes('    style B fill:#ffe3e3,stroke:#9e8d8d,color:#1f2328'), '在圖上選底色：' + JSON.stringify(mm.src));
  assert(mm.src.includes('B[完成]') && !mm.src.includes('B[結束]'), '在圖上改了文字再選底色：改的文字留下來：' + JSON.stringify(mm.src));
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
  assert(mm.zoom === 0.25, '最小縮到 25%（很長的圖可以縮小看全貌）');
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

// ======== 圖表編輯器：我的範本、設定裡的預設圖表與要列出的種類 ========
{
  await fresh('第一段\n');
  plugin.settings.diagramTemplates = [{ name: '審核流程', src: 'flowchart LR\n    A[送出] --> B{主管審核}\n    B -->|通過| C[完成]' }];
  let saves = 0;
  plugin.saveSettings = () => { saves++; };
  view.openMermaid();
  let mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  assert(q('.wm-mmd-mine').textContent === '我的範本 1' && q('.wm-mmd-templates').style.display === 'none', '上方有「我的範本」按鈕與數量，面板預設收著');
  click(q('.wm-mmd-mine'));
  assert(q('.wm-mmd-templates').style.display !== 'none' && qa('.wm-mmd-tpl').map(b => b.textContent).join() === '審核流程' && q('.wm-mmd-tpl-name').value === '流程圖', '展開面板：列出存過的範本，新範本的名稱先填圖表的種類');
  // 把目前的圖表存成範本
  q('.wm-mmd-tpl-name').value = '我的流程';
  click(q('.wm-mmd-tpl-save button'));
  assert(plugin.settings.diagramTemplates.map(x => x.name).join() === '審核流程,我的流程' && plugin.settings.diagramTemplates[1].src === 'flowchart TD\n    A[開始] --> B[結束]' && saves === 1, '存成範本：寫進設定並存檔：' + JSON.stringify(plugin.settings.diagramTemplates[1]));
  assert(q('.wm-mmd-mine').textContent === '我的範本 2' && qa('.wm-mmd-tpl').length === 2 && mock.log.some(x => x[1] === '已存成範本「我的流程」'), '面板與按鈕上的數量跟著更新，並顯示通知');
  // 套用另一個範本：目前的內容就是剛存的範本，不用問
  click(qa('.wm-mmd-tpl')[0]);
  assert(mm.src.startsWith('flowchart LR\n    A[送出]') && q('.wm-mmd-confirm').style.display === 'none' && qa('.wm-mmd-list')[0].querySelectorAll('.wm-mmd-row').length === 3, '套用自己的範本：內容換掉，表單跟著更新');
  // 改過之後再換範本：先問
  const first = q('.wm-mmd-row input[type="text"]');
  first.value = '提出申請'; first.dispatchEvent(new Event('input', { bubbles: true }));
  click(qa('.wm-mmd-tpl')[1]);
  assert(q('.wm-mmd-confirm').style.display !== 'none' && q('.wm-mmd-confirm').textContent.includes('我的流程') && mm.src.includes('提出申請'), '內容改過之後套用範本：先確認，還沒換掉');
  click(q('.wm-mmd-confirm button.mod-warning'));
  assert(mm.src === 'flowchart TD\n    A[開始] --> B[結束]', '確認之後才換成範本的內容');
  // 同名：換掉內容，不會多一個
  first.dispatchEvent(new Event('focus'));
  const again = q('.wm-mmd-row input[type="text"]');
  again.value = '起點'; again.dispatchEvent(new Event('input', { bubbles: true }));
  q('.wm-mmd-tpl-name').value = '我的流程';
  click(q('.wm-mmd-tpl-save button'));
  assert(plugin.settings.diagramTemplates.length === 2 && plugin.settings.diagramTemplates[1].src.includes('A[起點]') && mock.log.some(x => x[1] === '已更新範本「我的流程」'), '同名的範本：換成新的內容');
  mm.close();
  // 設定：新圖表一開始的內容、要列出的種類
  plugin.settings.defaultDiagram = 'tpl:審核流程';
  plugin.settings.hiddenDiagramKinds = ['er', 'journey'];
  view.openMermaid();
  mm = mock.Modal.last;
  assert(mm.src.startsWith('flowchart LR\n    A[送出]') && mm.contentEl.querySelectorAll('.wm-mmd-kind[data-kind]').length === 9 && !mm.contentEl.querySelector('.wm-mmd-kind[data-kind="er"]'), '設定：新圖表從自己的範本開始，取消勾選的種類不列出來');
  mm.close();
  plugin.settings.defaultDiagram = 'kind:gantt';
  view.openMermaid();
  assert(mock.Modal.last.src.startsWith('gantt'), '設定：新圖表從內建的甘特圖開始');
  mock.Modal.last.close();
  plugin.settings.defaultDiagram = 'tpl:已經刪掉的';
  view.openMermaid();
  assert(mock.Modal.last.src.startsWith('flowchart TD'), '設定指到已經刪掉的範本：用預設的流程圖');
  mock.Modal.last.close();
  plugin.settings.defaultDiagram = ''; plugin.settings.hiddenDiagramKinds = [];
}

// ======== 圖表編輯器：自由編寫（自己寫程式碼，不限有表單的種類） ========
{
  await fresh('第一段\n');
  plugin.settings.diagramTemplates = [];
  view.openMermaid();
  let mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  const active = () => qa('.wm-mmd-kind.is-active').map(b => b.dataset.kind || (b.classList.contains('wm-mmd-free') ? 'free' : 'mine')).join();
  const code = v => { mm.ta.value = v; mm.ta.dispatchEvent(new Event('input', { bubbles: true })); };
  const GIT = 'gitGraph\n    commit\n    branch develop\n    commit';
  assert(q('.wm-mmd-free') && q('.wm-mmd-free').textContent === '自由編寫' && q('.wm-mmd-free').nextElementSibling === q('.wm-mmd-mine') && active() === 'flowchart', '種類的最後有「自由編寫」（在「我的範本」前面），一開始標的是流程圖');
  // 還沒動過的範本：直接清成空白，換到程式碼
  click(q('.wm-mmd-free'));
  assert(mm.src === '' && mm.ta.value === '' && mm.tab === 'code' && active() === 'free' && q('.wm-mmd-confirm').style.display === 'none', '按「自由編寫」：清成空白、換到程式碼、標在「自由編寫」：' + JSON.stringify([mm.src, mm.tab, active()]));
  assert(q('.wm-mmd-preview .wm-eq-empty') && mm.ta.placeholder.includes('gitGraph') && q('.wm-mmd-code .wm-mmd-hint'), '空白時預覽顯示提示，輸入框裡有例子，下面有說明');
  // 寫一種沒有表單的圖表：一樣有預覽，可以插入
  code(GIT);
  mm.preview();
  assert(q('.wm-mmd-preview').textContent.startsWith('RENDERED:```mermaid\ngitGraph') && active() === 'free' && q('.wm-mmd-tip').style.display === 'none', '沒有表單的種類（gitGraph）一樣畫預覽：' + JSON.stringify(q('.wm-mmd-preview').textContent.slice(0, 30)));
  click(mm.tabVisual);
  assert(q('.wm-mmd-blocked') && q('.wm-mmd-blocked').textContent.includes('還沒有表單'), '切到表單：說明這種圖表要用程式碼');
  // 正在寫上方沒有的種類時再按一次：只回到程式碼，內容留著
  click(q('.wm-mmd-free'));
  assert(mm.src === GIT && mm.tab === 'code' && q('.wm-mmd-confirm').style.display === 'none', '已經在自由編寫：再按一次不會清掉內容');
  // 打成有表單的種類：上方的標示跟著換
  code('flowchart LR\n    A[自己寫的] --> B[結束]');
  assert(active() === 'flowchart', '程式碼寫成流程圖：標示換到流程圖');
  // 內容是自己寫的：清空前先問
  click(q('.wm-mmd-free'));
  assert(q('.wm-mmd-confirm').style.display !== 'none' && q('.wm-mmd-confirm').textContent.includes('清空') && mm.src.includes('自己寫的'), '內容改過：清空前先問，還沒清掉');
  click([...q('.wm-mmd-confirm').querySelectorAll('button')][1]);
  assert(q('.wm-mmd-confirm').style.display === 'none' && mm.src.includes('自己寫的'), '按取消：內容留著');
  click(q('.wm-mmd-free'));
  click(q('.wm-mmd-confirm button.mod-warning'));
  assert(mm.src === '' && mm.tab === 'code' && active() === 'free', '確認之後才清空');
  // 空白不能插入；寫了再插入：存成一般的 mermaid 程式碼區塊
  click(mm.ok);
  assert(mock.Modal.last === mm && mm.contentEl.querySelector('.wm-mmd-free') && !out().includes('mermaid'), '空白時按插入：不會插入空的圖表');
  code(GIT);
  click(mm.ok);
  assert(out().includes('```mermaid\n' + GIT + '\n```'), '自由編寫的圖表插入成 mermaid 程式碼區塊：' + JSON.stringify(out()));
  // 筆記裡原本就是沒有表單的種類：開在程式碼，標在「自由編寫」
  await fresh('```mermaid\n' + GIT + '\n```\n\n後面\n');
  view.pm.dom.querySelector('.wm-code-edit').click();
  mm = mock.Modal.last;
  assert(mm.tab === 'code' && active() === 'free' && mm.ta.value === GIT, '既有的 gitGraph：開在程式碼，標在「自由編寫」');
  mm.close();
  assert(out() === '```mermaid\n' + GIT + '\n```\n\n後面\n', '沒有修改就關閉：原文不變');
  // 「我的範本」面板開著時，換種類或打程式碼不會把那顆按鈕的標示拿掉
  await fresh('第一段\n');
  view.openMermaid();
  mm = mock.Modal.last;
  click(q('.wm-mmd-mine'));
  click(q('.wm-mmd-free'));
  code(GIT);
  assert(active() === 'free,mine', '面板開著：「我的範本」的標示還在：' + active());
  mm.close();
}

// ======== 圖表編輯器：很長的圖表（表單分段、篩選、選單的選項按下去才產生）========
{
  const N = 100;
  const lines = ['flowchart TD'];
  for (let i = 1; i <= N; i++) lines.push('    S' + i + '[步驟 ' + i + ']');
  for (let i = 1; i < N; i++) lines.push('    S' + i + ' --> S' + (i + 1));
  await fresh('```mermaid\n' + lines.join('\n') + '\n```\n\n後面\n');
  view.pm.dom.querySelector('.wm-code-edit').click();
  const mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  const rowsOf = i => [...qa('.wm-mmd-list')[i].querySelectorAll('.wm-mmd-row')];
  assert(rowsOf(0).length === 40 && rowsOf(1).length === 40 && qa('.wm-mmd-count').map(x => x.textContent).join() === '100,99', '很長的清單只先畫前 40 列，數量顯示全部');
  assert(qa('.wm-mmd-morebtn').map(b => b.textContent).join('|') === '再顯示 40 列（還有 60 列）|再顯示 40 列（還有 59 列）', '下面有「再顯示」：' + qa('.wm-mmd-morebtn').map(b => b.textContent).join('|'));
  // 下拉選單：選項很多時只放目前選的那一個
  const from = rowsOf(1)[0].querySelector('select.wm-mmd-f-from');
  assert(from.options.length === 1 && from.value === 'S1' && from.options[0].textContent.includes('步驟 1'), '「從」的選單只有目前選的那一個選項：' + from.options.length);
  assert(mm.contentEl.querySelectorAll('option').length < 800, '整個表單的選項元素很少（原本是每個選單各放一百個）：' + mm.contentEl.querySelectorAll('option').length);
  from.dispatchEvent(new Event('focus'));
  assert(from.options.length === N && from.value === 'S1', '按下去（取得焦點）才補齊所有選項，選的值不變');
  from.value = 'S50'; from.dispatchEvent(new Event('change'));
  assert(mm.src.includes('    S50 --> S2') && !mm.src.includes('    S1 --> S2'), '補齊之後可以選別的步驟');
  from.dispatchEvent(new Event('blur'));
  assert(from.options.length === 1 && from.value === 'S50', '離開之後收回只剩一個');
  // 改步驟的名稱：連線選單上的名稱跟著改（不用補齊選項）
  const name = rowsOf(0)[1].querySelector('input[type="text"]');
  name.value = '第二步'; name.dispatchEvent(new Event('input', { bubbles: true }));
  const to = rowsOf(1)[0].querySelector('select.wm-mmd-f-to');
  assert(to.options.length === 1 && to.options[0].textContent.includes('第二步'), '步驟改名：只有一個選項的選單，名稱也跟著更新：' + to.options[0].textContent);
  // 再顯示
  click(qa('.wm-mmd-morebtn')[0]);
  assert(rowsOf(0).length === 80 && qa('.wm-mmd-morebtn')[0].textContent === '再顯示 20 列（還有 20 列）', '按「再顯示」多畫 40 列');
  // 篩選
  const filter = q('.wm-mmd-filter');
  filter.value = '步驟 9'; filter.dispatchEvent(new Event('input', { bubbles: true }));
  assert(rowsOf(0).map(r => r.querySelector('input').value).join() === '步驟 9,步驟 90,步驟 91,步驟 92,步驟 93,步驟 94,步驟 95,步驟 96,步驟 97,步驟 98,步驟 99' && qa('.wm-mmd-count')[0].textContent === '11 / 100', '篩選：只列出符合的列，數量顯示「符合／全部」');
  const edgeFilter = qa('.wm-mmd-filter')[1];
  edgeFilter.value = '第二步'; edgeFilter.dispatchEvent(new Event('input', { bubbles: true }));
  assert(rowsOf(1).length === 2, '篩選連線：比對選單上顯示的步驟名稱（不是代號）：' + rowsOf(1).length);
  filter.value = '沒有這個'; filter.dispatchEvent(new Event('input', { bubbles: true }));
  assert(rowsOf(0).length === 0 && qa('.wm-mmd-more')[0].textContent === '沒有符合的列', '沒有符合的列時說明');
  // 新增步驟：換到最後一段，游標在新的那一列
  click(qa('.wm-mmd-add')[0]);
  assert(rowsOf(0).length === 21 && rowsOf(0)[0].querySelector('input').value === '步驟 81' && document.activeElement.value === '新步驟' && q('.wm-mmd-filter').value === '' && qa('.wm-mmd-morebtn')[0].textContent === '顯示前面 40 列（前面還有 80 列）', '新增步驟：拿掉篩選、換到最後一段（第 81 列起）：' + qa('.wm-mmd-morebtn')[0].textContent);
  click(qa('.wm-mmd-morebtn')[0]);
  assert(rowsOf(0).length === 61 && rowsOf(0)[0].querySelector('input').value === '步驟 41', '按「顯示前面」往前多畫 40 列');
  // 點圖上的步驟：表單換到那一列所在的那一段
  const NS = 'http://www.w3.org/2000/svg';
  const fake = () => {
    // 假的預覽圖：每個步驟一個 g.node（代號跟 Mermaid 一樣寫在 id 上）
    const svg = document.createElementNS(NS, 'svg');
    for (const n of mm.data.model.lists.nodes) {
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'node'); g.id = 'flowchart-' + n.id + '-0';
      const tx = document.createElementNS(NS, 'text'); tx.textContent = n.text; g.appendChild(tx); svg.appendChild(g);
    }
    return svg;
  };
  mm.opts.render = (src, el) => { el.appendChild(fake()); return { unload() {} }; };
  mm.preview();
  const node = id => mm.canvas.querySelector('#flowchart-' + id + '-0 text');
  click(node('S5'));
  assert(q('.wm-mmd-inline input').value === '步驟 5' && q('.wm-mmd-row.is-current input').value === '步驟 5' && rowsOf(0).length === 40, '點圖上第 5 個步驟：表單換到它所在的那一段並標出來');
  assert(mm.prev.querySelector('.wm-mmd-marker:not(.is-hover)'), '圖上用外框標出表單目前的那一列');
  // Tab：套用並跳到下一段文字
  q('.wm-mmd-inline input').value = '第五步';
  q('.wm-mmd-inline input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert(mm.src.includes('S5[第五步]') && q('.wm-mmd-inline') && q('.wm-mmd-inline input').value === '步驟 6', '圖上按 Tab：套用，並在下一個步驟開輸入框：' + (q('.wm-mmd-inline') && q('.wm-mmd-inline input').value));
  q('.wm-mmd-inline input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert(q('.wm-mmd-inline input').value === '第五步', 'Shift+Tab：回到上一段（沒有修改就不重畫）');
  click(q('.wm-mmd-inline .wm-mmd-inline-btn:nth-child(3)'));
  assert(q('.wm-mmd-inline input').value === '步驟 6', '輸入框旁邊的「下一段文字」按鈕（螢幕鍵盤沒有 Tab）');
  mm.closeInline();
  // 游標進到表單的一列：圖上的外框跟著移過去
  rowsOf(0)[9].querySelector('input').dispatchEvent(new Event('focusin', { bubbles: true }));
  assert(mm.current.row.id === 'S10' && mm.prev.querySelectorAll('.wm-mmd-marker:not(.is-hover)').length === 1, '游標進到表單的一列：記下目前的那一列，圖上只有一個外框');
  // 滑鼠移到圖上可以改的文字：淡淡的外框
  node('S3').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  assert(mm.prev.querySelector('.wm-mmd-marker.is-hover'), '滑鼠移到圖上的文字：顯示可以修改的外框');
  mm.prev.dispatchEvent(new MouseEvent('mouseleave'));
  assert(!mm.prev.querySelector('.wm-mmd-marker.is-hover'), '滑鼠離開：外框消失');

  // 預覽重畫：新的圖先在背後畫，畫好才換上去（舊圖留著，不會閃、不會跳回最上面）
  let finishDraw = null; let unloaded = 0;
  mm.opts.render = (src, el) => {
    const ready = new Promise(res => { finishDraw = () => { el.appendChild(fake()); res(); }; });
    return { ready, unload() { unloaded++; } };
  };
  const old = mm.canvas;
  mm.preview();
  assert(mm.canvas === old && old.isConnected && mm.prev.contains(old) && mm.contentEl.querySelectorAll('.wm-mmd-canvas').length === 2 && mm.pending.canvas.classList.contains('is-pending'), '重畫時舊的圖還在畫面上，新的在背後');
  mm.preview();
  assert(mm.contentEl.querySelectorAll('.wm-mmd-canvas').length === 2 && unloaded === 1, '還沒畫好又重畫：放棄前一份，不會越積越多');
  finishDraw();
  await sleep(20);
  assert(mm.canvas !== old && !old.isConnected && mm.prev.contains(mm.canvas) && !mm.canvas.classList.contains('is-pending') && mm.contentEl.querySelectorAll('.wm-mmd-canvas').length === 1 && !mm.pending, '新的圖出現之後才換上去，舊的拿掉');
  // 縮放：圖以原本的大小為準；符合寬度
  const big = fake(); big.setAttribute('viewBox', '0 0 2000 800');
  mm.opts.render = (src, el) => { el.appendChild(big); return { unload() {} }; };
  mm.prev.empty(); mm.canvas = null;
  Object.defineProperty(mm.prev, 'clientWidth', { value: 424, configurable: true });
  mm.preview();
  assert(mm.natural === 2000 && big.style.width === '2000px' && big.classList.contains('wm-mmd-natural') && mm.zoom === 1, '很寬的圖：維持原本的大小（不整張縮小到字看不見），用捲的');
  click(q('.wm-mmd-fit'));
  assert(mm.zoom === 0.2 && q('.wm-mmd-zoomlabel').textContent === '20%' && mm.canvas.style.zoom === '0.2', '按「符合寬度」：縮到看得到整張圖：' + mm.zoom);
  const mid = fake(); mid.setAttribute('viewBox', '0 0 500 300');
  mm.opts.render = (src, el) => { el.appendChild(mid); return { unload() {} }; };
  mm.autoZoom = true; mm.prev.empty(); mm.canvas = null;
  mm.preview();
  assert(mm.zoom === 0.8 && q('.wm-mmd-zoomlabel').textContent === '80%', '只比預覽寬一點的圖：縮到剛好：' + mm.zoom);
  mm.close();
}

// ======== 方程式編輯器：我的公式 ========
{
  await fresh('面積\n');
  plugin.settings.mathTemplates = [{ name: '複利', src: 'A = P(1 + r)^{n}' }];
  let saves = 0;
  plugin.saveSettings = () => { saves++; };
  view.openEquation();
  let eq = mock.Modal.last;
  await sleep(25);
  const q = s => eq.contentEl.querySelector(s);
  const qa = s => [...eq.contentEl.querySelectorAll(s)];
  const cat = name => qa('.wm-eq-cat').find(b => b.textContent === name);
  assert(cat('我的公式') && qa('.wm-eq-cat').pop().textContent === '我的公式', '有存過公式：多一個「我的公式」分類');
  click(cat('我的公式'));
  const mine = qa('.wm-eq-btn.is-formula');
  assert(mine.length === 1 && mine[0].querySelector('.wm-eq-btn-label').textContent === '複利' && mine[0].getAttribute('aria-label') === 'A = P(1 + r)^{n}', '我的公式：顯示自己取的名稱');
  click(mine[0]);
  assert(eq.ta.value === 'A = P(1 + r)^{n}', '按一下插入整條公式：' + eq.ta.value);
  // 存成我的公式
  click(q('.wm-eq-keep'));
  assert(q('.wm-eq-save').style.display !== 'none' && q('.wm-eq-save-name').value === '公式', '按書籤按鈕：出現名稱輸入框，先填一個沒用過的名稱');
  q('.wm-eq-save-name').value = '本利和';
  click(q('.wm-eq-save button.mod-cta'));
  assert(plugin.settings.mathTemplates.map(x => x.name).join() === '複利,本利和' && plugin.settings.mathTemplates[1].src === 'A = P(1 + r)^{n}' && saves === 1 && q('.wm-eq-save').style.display === 'none', '存成我的公式：寫進設定並存檔');
  assert(qa('.wm-eq-btn.is-formula').length === 2 && cat('我的公式').classList.contains('is-active'), '存完之後「我的公式」馬上多一顆按鈕');
  eq.close();
  // 沒有內容時不能存
  plugin.settings.mathTemplates = [];
  view.openEquation();
  eq = mock.Modal.last;
  await sleep(25);
  assert(!cat('我的公式'), '沒有存過公式：不顯示「我的公式」分類');
  click(q('.wm-eq-keep'));
  assert(q('.wm-eq-save').style.display === 'none' && mock.log.some(x => x[1] === '先輸入方程式再存'), '還沒輸入方程式：不能存，並說明');
  eq.close();
}

// ======== 設定頁：管理我的公式與圖表範本 ========
{
  let list = [{ name: '甲', src: 'a' }, { name: '乙', src: 'b\nc' }, { name: '丙', src: 'd' }];
  const box = document.body.appendChild(document.createElement('div'));
  B.buildTemplateManager(box, {
    get: () => list, set: next => { list = next; },
    addLabel: '＋ 新增', newName: '範本', newSrc: 'x', srcLabel: '內容', empty: '還沒有',
    badge: src => (src === 'a' ? '流程圖' : ''),
  });
  const names = () => [...box.querySelectorAll('.wm-tpl-name')].map(i => i.value).join();
  const item = i => box.querySelectorAll('.wm-tpl-item')[i];
  const tool = (i, n) => item(i).querySelectorAll('.wm-tpl-btn')[n];
  const change = (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
  assert(names() === '甲,乙,丙' && item(1).querySelector('.wm-tpl-src').value === 'b\nc' && item(0).querySelector('.wm-tpl-badge').textContent === '流程圖' && !item(1).querySelector('.wm-tpl-badge'), '列出每個範本的名稱、內容與種類');
  assert(tool(0, 0).disabled && tool(2, 1).disabled && !tool(1, 0).disabled, '第一個不能上移、最後一個不能下移');
  change(item(1).querySelector('.wm-tpl-name'), '乙二');
  assert(names() === '甲,乙二,丙' && list[1].name === '乙二', '改名');
  change(item(1).querySelector('.wm-tpl-name'), '甲');
  assert(names() === '甲,乙二,丙' && mock.log.some(x => x[1] === '名稱不能是空的，也不能跟其他範本一樣'), '改成別的範本的名稱：改回原本的並說明');
  change(item(2).querySelector('.wm-tpl-src'), 'd\ne\n');
  assert(list[2].src === 'd\ne', '改內容');
  change(item(2).querySelector('.wm-tpl-src'), '   ');
  assert(list[2].src === 'd\ne' && item(2).querySelector('.wm-tpl-src').value === 'd\ne', '內容清空：不改，改回原本的');
  click(tool(2, 0));
  assert(names() === '甲,丙,乙二', '上移');
  click(tool(0, 1));
  assert(names() === '丙,甲,乙二', '下移');
  click(tool(1, 2));
  assert(names() === '丙,甲,乙二' && tool(1, 2).textContent === '確定刪除？', '刪除要按兩次：第一次只變成「確定刪除？」');
  click(tool(1, 2));
  assert(names() === '丙,乙二' && list.length === 2, '再按一次才刪除');
  click(box.querySelector('.wm-tpl-add'));
  assert(names() === '丙,乙二,範本' && list[2].src === 'x', '新增：加在最後，名稱不重複');
  click(box.querySelector('.wm-tpl-add'));
  assert(names() === '丙,乙二,範本,範本 2', '再新增：名稱自動加編號');
  list = [];
  box.remove();
  const empty = document.body.appendChild(document.createElement('div'));
  B.buildTemplateManager(empty, { get: () => list, set: next => { list = next; }, addLabel: '＋', newName: 'n', newSrc: 's', srcLabel: 'c', empty: '還沒有範本' });
  assert(empty.querySelector('.wm-tpl-empty').textContent === '還沒有範本' && !empty.querySelector('.wm-tpl-item'), '沒有範本時顯示說明');
  empty.remove();
}

// ======== 文件裡很高的圖表：先收合，按按鈕展開 ========
{
  await fresh('前面\n\n```mermaid\nflowchart TD\n    A --> B\n```\n\n後面\n');
  await sleep(20);
  const block = view.pm.dom.querySelector('.wm-codeblock');
  const more = block.querySelector('.wm-code-more');
  assert(more.hidden && !block.classList.contains('is-tall'), '一般大小的圖表：不收合，沒有按鈕');
  // jsdom 沒有版面，假裝這張圖有 2000 像素高，再改一下程式碼讓它重畫
  Object.defineProperty(block.querySelector('.wm-code-preview'), 'scrollHeight', { value: 2000, configurable: true });
  let pos = null; view.pm.state.doc.descendants((n, p) => { if (n.type.name === 'code_block') pos = p; });
  view.pm.dispatch(view.pm.state.tr.insertText('\n    B --> C', pos + view.pm.state.doc.nodeAt(pos).nodeSize - 1));
  await sleep(520);
  assert(block.classList.contains('is-tall') && !more.hidden && more.textContent === '顯示完整內容', '很高的圖表：先收合，下面有「顯示完整內容」');
  click(more);
  assert(!block.classList.contains('is-tall') && more.textContent === '收合', '按下去展開，按鈕變成「收合」');
  click(more);
  assert(block.classList.contains('is-tall'), '再按一次收回去');
  plugin.settings.collapseTall = false;
  view.pm.dispatch(view.pm.state.tr.insertText('\n    C --> D', pos + view.pm.state.doc.nodeAt(pos).nodeSize - 1));
  await sleep(540);
  assert(!block.classList.contains('is-tall') && more.hidden, '設定關閉「很長的圖表先收合」：一律顯示完整的內容');
  delete plugin.settings.collapseTall;
}

// ======== 設定頁的分類列：一次只顯示一類 ========
{
  const { readFileSync } = await import('node:fs');
  const box = document.body.createDiv();
  const items = [{ id: 'general', label: '一般', icon: 'settings' }, { id: 'edit', label: '編輯', icon: 'pencil' }, { id: 'toolbar', label: '工具列', icon: 'layout-panel-top' }];
  const picked = [];
  const nav = B.SETNAV.buildSettingNav(box, items, 'edit', id => { picked.push(id); B.SETNAV.showSettingSection(box, id); });
  const tabs = [...box.querySelectorAll('.wm-set-tab')];
  const state = () => tabs.map(b => (b.classList.contains('is-active') ? '*' : '') + b.dataset.tab + ':' + b.getAttribute('aria-selected') + ':' + b.tabIndex).join();
  const press = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  assert(tabs.length === 3 && nav.el.getAttribute('role') === 'tablist' && tabs[1].textContent === '編輯' && tabs[1].querySelector('[data-icon="pencil"]') && state() === 'general:false:-1,*edit:true:0,toolbar:false:-1',
    '分類列：每一類一個頁籤（圖示加名稱），標出目前的分類，整條列只有它佔一個 Tab 停駐點：' + state());
  click(tabs[2]);
  assert(picked.join() === 'toolbar' && box.dataset.wmTab === 'toolbar' && state() === 'general:false:-1,edit:false:-1,*toolbar:true:0', '按頁籤：換到那一類，外框記下目前顯示的分類');
  press(tabs[2], 'ArrowRight');
  assert(picked.join() === 'toolbar,general' && document.activeElement === tabs[0] && box.dataset.wmTab === 'general', '方向鍵：最後一類再往右回到第一類，焦點跟著移');
  press(tabs[0], 'ArrowLeft');
  press(tabs[2], 'Home');
  press(tabs[0], 'End');
  assert(picked.join() === 'toolbar,general,toolbar,general,toolbar' && document.activeElement === tabs[2], '往左、Home、End 也可以換分類：' + picked.join());
  press(tabs[2], 'a');
  nav.select('edit');
  assert(picked.length === 5 && state() === 'general:false:-1,*edit:true:0,toolbar:false:-1', '其他按鍵不換分類；select() 只換標示、不呼叫 onPick（設定搜尋跳到別類時用）');
  box.remove();

  // 分類列貼齊上緣：捲動時量出外框的上內距，每次畫設定頁之後只量一次
  const scroller = document.body.createDiv();
  scroller.style.paddingTop = '48px';
  const again = B.SETNAV.trackSettingPadding(scroller);
  assert(scroller.style.getPropertyValue('--wm-set-pad') === '', '還沒捲動：不量（設定頁可能還沒顯示）');
  scroller.dispatchEvent(new Event('scroll'));
  assert(scroller.style.getPropertyValue('--wm-set-pad') === '48px', '捲動時量出上內距，記在 --wm-set-pad');
  scroller.style.paddingTop = '20px';
  scroller.dispatchEvent(new Event('scroll'));
  assert(scroller.style.getPropertyValue('--wm-set-pad') === '48px', '之後捲動不重量');
  again();
  scroller.dispatchEvent(new Event('scroll'));
  assert(scroller.style.getPropertyValue('--wm-set-pad') === '20px', '重畫設定頁之後再量一次');
  scroller.remove();

  // 分類是用樣式表隱藏的：main.ts 的每一類在樣式表裡都要有對應的隱藏規則，少了一條那一類就會出現在每個分類裡
  const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../styles/word-mode.css', import.meta.url), 'utf8');
  const ids = [...main.match(/type SectionId = ([^;]+);/)[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]);
  const used = [...main.matchAll(/\{ id: '([a-z]+)', heading: /g)].map(m => m[1]);
  const missing = ids.filter(id => !css.includes('.wm-settings[data-wm-tab="' + id + '"] .wm-set-sec:not(.wm-set-' + id + ')'));
  assert(ids.length >= 8 && ids.join() === used.join() && !missing.length, '設定的每一類都有隱藏其他分類的樣式規則：' + (missing.join() || ids.join()));
}

// ======== 設定頁的搜尋框：打字時列出符合的設定，選一個就捲過去 ========
{
  const box = document.body.createDiv();
  const page = document.body.createDiv();
  // 假的設定頁：兩列設定，其中一列有下拉選單
  const zoomEl = page.createDiv('setting-item');
  zoomEl.createEl('input', { type: 'range' });
  const posEl = page.createDiv('setting-item');
  const sel = posEl.createEl('select');
  for (const x of ['自動', '上方', '下方']) sel.createEl('option', { text: x });
  const doc = (name, desc, el, extra = {}) => Object.assign({ name, desc, terms: [], alt: [], section: '顯示', icon: 'monitor', el }, extra);
  let docs = [];
  const picked = [];
  let asked = 0;
  const search = B.SETNAV.buildSettingSearch(box, () => { asked++; return docs; }, (item, byKeyboard) => picked.push(item.name + ':' + byKeyboard));
  const { input } = search;
  const pop = box.querySelector('.wm-set-find-pop');
  const items = () => [...box.querySelectorAll('.wm-set-find-item')];
  const shown = () => items().map(r => (r.getAttribute('aria-selected') === 'true' ? '*' : '') + r.querySelector('.wm-set-find-name').textContent).join();
  const head = () => box.querySelector('.wm-set-find-head').textContent;
  const type = v => { input.value = v; input.dispatchEvent(new Event('input')); };
  const key = k => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); input.dispatchEvent(e); return e; };

  assert(B.SETNAV.settingTerms(posEl).join() === '自動,上方,下方' && B.SETNAV.settingTerms(zoomEl).length === 0, '收集一列裡的選項文字（搜尋時也比對）');
  docs = [
    doc('頁面縮放', '也可以用 Ctrl+滑鼠滾輪調整。', zoomEl, { common: true, alt: [{ name: 'Page zoom', desc: '' }] }),
    doc('工具列位置', '「自動」在手機上放在畫面下方。', posEl, { common: true, section: '工具列', icon: 'layout-panel-top', terms: B.SETNAV.settingTerms(posEl), alt: [{ name: 'Toolbar position', desc: '' }] }),
    doc('全寬頁面', '使用整個視窗寬度。', zoomEl),
  ];
  assert(input.getAttribute('role') === 'combobox' && input.getAttribute('aria-expanded') === 'false' && pop.hidden && input.placeholder.includes('例如'), '搜尋框：一開始收起來，提示文字舉例可以搜尋什麼');
  input.dispatchEvent(new Event('focus'));
  assert(asked === 1 && !pop.hidden && input.getAttribute('aria-expanded') === 'true' && head() === '常用的設定' && shown() === '*頁面縮放,工具列位置', '取得焦點：還沒打字先列出常用的設定：' + shown());
  assert(input.getAttribute('aria-activedescendant') === items()[0].id && box.querySelector('.wm-set-find-list').id === input.getAttribute('aria-controls'), '反白的那一筆讓螢幕閱讀器知道');
  type('頁面');
  assert(head() === '2 項符合' && shown() === '*頁面縮放,全寬頁面', '打字：列出符合的設定：' + shown());
  assert([...items()[0].querySelectorAll('mark')].map(m => m.textContent).join() === '頁面' && items()[0].querySelector('.wm-set-find-sec').textContent === '顯示' && items()[0].querySelector('[data-icon="monitor"]'), '符合的字標出來，旁邊是所屬的分類');
  assert(!box.querySelector('.wm-set-find-clear').hidden, '有打字時出現清除按鈕');
  type('zoom');
  const snip = items()[0].querySelector('.wm-set-find-snip');
  assert(shown() === '*頁面縮放' && snip.textContent === 'Page zoom' && snip.querySelector('[data-icon="languages"]') && snip.dir === 'auto', '打英文也找得到，下面顯示符合的那個語言的名稱：' + snip.textContent);
  type('上方');
  assert(shown() === '*工具列位置', '選項的文字也找得到');
  type('自');
  assert(shown() === '*工具列位置', '說明裡有的也找得到');
  type('xyz');
  assert(head().includes('找不到「xyz」') && shown() === '*頁面縮放,工具列位置', '找不到：說明找不到，下面仍然列出常用的設定');
  type('頁');
  const down = key('ArrowDown');
  assert(shown() === '頁面縮放,*全寬頁面' && down.defaultPrevented, '方向鍵往下移');
  key('ArrowDown');
  assert(shown() === '*頁面縮放,全寬頁面', '最後一筆再往下回到第一筆');
  key('ArrowUp');
  key('Enter');
  assert(picked.join() === '全寬頁面:true' && pop.hidden && input.getAttribute('aria-expanded') === 'false', '按 Enter：選反白的那一筆，清單收起來');
  const esc1 = key('Escape');
  assert(input.value === '' && esc1.defaultPrevented === true && box.querySelector('.wm-set-find-clear').hidden, '清單收著時按 Esc：清掉打的字');
  const esc2 = key('Escape');
  assert(!esc2.defaultPrevented, '沒有字也沒有清單時，Esc 照常傳出去（關掉設定視窗）');
  type('寬');
  key('Escape');
  assert(pop.hidden && input.value === '寬', 'Esc 先收起清單，打的字還在');
  input.dispatchEvent(new Event('focus'));
  click(items()[0]);
  assert(picked.join() === '全寬頁面:true,全寬頁面:false' && pop.hidden, '用滑鼠點一筆：也會選，byKeyboard 為 false');
  input.dispatchEvent(new Event('focus'));
  click(box.querySelector('.wm-set-find-clear'));
  assert(input.value === '' && head() === '常用的設定', '按清除：清掉打的字，回到常用的設定');
  input.dispatchEvent(new Event('blur'));
  assert(pop.hidden, '離開搜尋框：清單收起來');

  // Esc 也可能先被 Obsidian 的按鍵處理收到：清單開著或有字時推一層 scope，先收清單、再清字，都沒有了才拿掉
  {
    const keymap = { stack: [], pushScope(s) { this.stack.push(s); }, popScope(s) { this.stack = this.stack.filter(x => x !== s); } };
    const host = document.body.createDiv();
    const s2 = B.SETNAV.buildSettingSearch(host, () => docs, () => {}, { keymap, scope: new mock.Scope() });
    const esc = () => keymap.stack[0].keys.find(k => k.key === 'Escape').fn(new KeyboardEvent('keydown', { key: 'Escape' }));
    s2.input.focus();
    const p2 = host.querySelector('.wm-set-find-pop');
    assert(keymap.stack.length === 1 && !p2.hidden, '取得焦點、清單打開：推上一層處理 Esc 的 scope');
    s2.input.value = '頁';
    s2.input.dispatchEvent(new Event('input'));
    assert(esc() === false && p2.hidden && s2.input.value === '頁' && keymap.stack.length === 1, 'Obsidian 先收到 Esc：收起清單（回傳 false 不再往外傳），還有字所以 scope 留著');
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    s2.input.dispatchEvent(handled);
    assert(s2.input.value === '頁', '已經處理過的 Esc 搜尋框不再處理一次');
    assert(esc() === false && s2.input.value === '' && keymap.stack.length === 0, '再按一次：清掉字，沒有東西可以收了，拿掉 scope（下一次 Esc 照常關掉設定視窗）');
    s2.input.dispatchEvent(new Event('input'));
    assert(keymap.stack.length === 1, '又打開清單：再推上去');
    s2.input.blur();
    assert(keymap.stack.length === 0 && p2.hidden, '離開搜尋框：一定拿掉 scope');
    host.remove();
  }

  // 選了之後：那一列閃一下；用鍵盤選的，焦點移到那一列的控制項
  B.SETNAV.revealSetting(posEl, true);
  assert(posEl.classList.contains('wm-set-flash') && document.activeElement === sel, '捲到那一列並閃一下，焦點移到下拉選單');
  B.SETNAV.revealSetting(zoomEl, false);
  assert(zoomEl.classList.contains('wm-set-flash') && document.activeElement === sel, '用滑鼠選的不移動焦點');
  await sleep(2300);
  assert(!posEl.classList.contains('wm-set-flash') && !zoomEl.classList.contains('wm-set-flash'), '閃完就拿掉');
  box.remove();
  page.remove();

  // 樣式表：用 hidden 收起來的元素自己設了 display，要另外寫 [hidden] 的規則，不然藏不起來
  const css = (await import('node:fs')).readFileSync(new URL('../../styles/word-mode.css', import.meta.url), 'utf8');
  assert(['.wm-set-find-pop[hidden]', '.wm-set-find-clear[hidden]', '.wm-set-find-more[hidden]'].every(s => css.includes(s)), '搜尋框用 hidden 收起來的元素在樣式表裡都有 [hidden] 規則');
}

// 假的 Markdown 檢視（Markdown 工具列、狀態列、查看文件屬性用）：text 是編輯中的原文，sel 是選取的文字
const fakeMarkdown = (path, text, mode = 'source') => {
  const containerEl = document.createElement('div');
  const contentEl = containerEl.createDiv('view-content');
  document.body.appendChild(containerEl);
  const md = {
    containerEl, contentEl, leaf: {}, mode, text, sel: '', scrolled: null, inserted: [],
    file: Object.assign(new mock.TFile(path), { stat: { size: 10, mtime: 0 } }),
    getMode() { return this.mode; }, getViewData() { return this.text; },
    getState() { return {}; }, async setState(st) { this.mode = st.mode; },
    currentMode: { applyScroll(n) { md.scrolled = n; } },
  };
  md.editor = { focus() {}, getSelection: () => md.sel, replaceRange: (s, at) => md.inserted.push([s, at]), setCursor() {} };
  return md;
};

// ======== 檢視模式的按鈕：提示卡都有動畫（兩條功能區與右下角的狀態列） ========
await fresh('一段文字\n');
{
  plugin.settings.richHints = true;
  view.buildToolbar();
  let wait = 650;
  // 滑鼠移到按鈕上：回傳提示卡的「標題:第一段動畫的 class」
  const hover = async b => {
    b.dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(wait); wait = 150;
    const c = document.querySelector('.wm-hint-card.is-shown');
    if (!c) return 'none';
    const demo = c.querySelector('.wm-hint-demo');
    return c.querySelector('.wm-hint-title').textContent + ':' + (demo && demo.firstElementChild ? demo.firstElementChild.className : '-');
  };
  const viewBtns = root => [...root.querySelectorAll('.wm-group-views .wm-btn')];
  const word = []; for (const b of viewBtns(view.toolbar.dom)) word.push(await hover(b));
  assert(word.length === 3 && word.every(x => !x.endsWith(':-') && x !== 'none') && word[0].startsWith('Word 模式（目前）:') && word[0].includes('wm-anim-wysiwyg'),
    'Word 模式的功能區：檢視模式三個按鈕都有動畫，Word 模式是「符號收起來、直接看到格式」：' + word.join(' / '));
  const md = fakeMarkdown('筆記/測試.md', '一段文字\n');
  const bar = new B.MarkdownBar(plugin, md);
  const mdHints = []; for (const b of viewBtns(bar.dom)) mdHints.push(await hover(b));
  assert(mdHints.length === 3 && mdHints.every(x => !x.endsWith(':-') && x !== 'none') && mdHints[0].includes('wm-anim-wysiwyg') && mdHints[1].startsWith('Markdown 編輯:') && mdHints[1].includes('wm-demo-mono'),
    'Markdown／閱讀模式的功能區：三個按鈕都有動畫，「切換到 Word 模式」不再用 Markdown 的動畫：' + mdHints.join(' / '));
  // 右下角狀態列的檢視按鈕也一樣（詳細提示開啟時不用 Obsidian 的一般提示）
  const sbar = document.body.createDiv('wm-statusbar');
  view.buildBottomBar(sbar, true);
  const sbtns = [...sbar.querySelectorAll('.wm-bb-views .wm-bb-btn')];
  assert(sbtns.length === 4 && sbtns.every(b => !b.hasAttribute('aria-label') && b.querySelector('.wm-sr')) && sbtns[1].querySelector('.wm-sr').textContent === 'Markdown 編輯 (Ctrl+E)',
    '狀態列的按鈕：詳細提示開啟時名稱放在看不見的文字裡：' + sbtns.map(b => b.querySelector('.wm-sr') && b.querySelector('.wm-sr').textContent).join('、'));
  const sHints = []; for (const b of sbtns) sHints.push(await hover(b));
  assert(sHints.every(x => !x.endsWith(':-') && x !== 'none') && sHints.map(x => x.split(':')[0]).join() === 'Word 模式（目前）,Markdown 編輯,閱讀模式,查看文件屬性',
    '狀態列的檢視按鈕與查看文件屬性：提示卡有動畫：' + sHints.join(' / '));
  sbtns[0].dispatchEvent(new MouseEvent('mousedown'));
  // 「設定」按鈕以前是唯一沒有說明、沒有動畫的按鈕：兩條功能區都示範設定頁的搜尋（打字、跳出結果、那一列閃一下）
  const iconBtn = (root, icon) => root.querySelector('.wm-btn [data-icon="' + icon + '"]').closest('.wm-btn');
  // 上面按下按鈕收起了提示卡，下一次要等完整的出現時間
  wait = 650;
  const setHints = [];
  for (const root of [view.toolbar.dom, bar.dom]) {
    setHints.push(await hover(iconBtn(root, 'settings')));
    const c = document.querySelector('.wm-hint-card.is-shown');
    assert(c && c.querySelector('.wm-hint-desc').textContent.includes('搜尋框') && c.querySelector('.wm-demo-setq-text').textContent === '縮放'
      && c.querySelector('.wm-demo-sethit-name').textContent === '頁面縮放' && c.querySelector('.wm-demo-setrow'),
    '「設定」按鈕的提示卡：說明設定頁可以搜尋，動畫是打「縮放」→ 跳出「頁面縮放」→ 那一列閃一下');
  }
  assert(setHints.every(x => x === 'Word 模式設定:wm-demo-setfind'), '兩條功能區的「設定」按鈕都有動畫：' + setHints.join(' / '));
  const undoRedo = [await hover(iconBtn(bar.dom, 'undo-2')), await hover(iconBtn(bar.dom, 'redo-2'))];
  assert(undoRedo.every(x => !x.endsWith(':-') && x !== 'none'), 'Markdown 工具列的復原、取消復原也有動畫（DEMOS 裡本來就有，只是沒接上）：' + undoRedo.join(' / '));
  bar.destroy(); md.containerEl.remove(); sbar.remove();
  plugin.settings.richHints = false;
  view.buildToolbar();
  const plain = document.body.createDiv('wm-statusbar');
  view.buildBottomBar(plain, true);
  assert([...plain.querySelectorAll('.wm-bb-views .wm-bb-btn')].map(b => b.getAttribute('aria-label')).join() === 'Word 模式（目前）,Markdown 編輯 (Ctrl+E),閱讀模式,查看文件屬性',
    '詳細提示關閉：狀態列的按鈕用一般提示');
  plain.remove();
}

// ======== 狀態列：Markdown／閱讀模式也保留同樣的按鈕 ========
{
  const text = '---\ntags: [a]\n---\n# 標題 Title\n\n這是 **粗體** 文字，hello world。\n';
  await fresh(text);
  const wordBar = document.body.createDiv('wm-statusbar');
  view.buildBottomBar(wordBar, true);
  view.updateCount();
  const mdEl = document.body.createDiv('wm-statusbar');
  const md = fakeMarkdown('筆記/測試.md', text);
  env.files.set('筆記/測試.md', text);
  plugin.switchToWord = () => { plugin.toWord = (plugin.toWord || 0) + 1; };
  plugin.setMarkdownMode = async (v, m) => { v.mode = m; plugin.modeSet = m; };
  const sb = new B.MdStatusBar(plugin, mdEl, md);
  // 版面：每一區的 class 與裡面的按鈕（目前的模式、停用的狀態不算）
  const shape = root => [...root.children].map(c => c.className.replace(/ is-[\w-]+/g, '') + '[' + [...c.querySelectorAll('button, input')].map(b => b.tagName + (b.dataset.mode ? ':' + b.dataset.mode : '')).join(' ') + ']').join(' | ');
  assert(shape(mdEl) === shape(wordBar) && shape(mdEl).includes('wm-bb-zoom') && shape(mdEl).includes('wm-bb-count'), 'Markdown 模式的狀態列跟 Word 模式一樣：字數、存檔狀態、檢視切換、文件屬性、縮放：' + shape(mdEl));
  assert(mdEl.querySelector('.wm-bb-btn.is-active').dataset.mode === 'source' && wordBar.querySelector('.wm-bb-btn.is-active').dataset.mode === 'word', '目前的模式顯示成按下的樣子');
  assert(mdEl.querySelector('.wm-bb-zoom').classList.contains('is-disabled') && mdEl.querySelector('.wm-bb-range').disabled && mdEl.querySelector('.wm-bb-zoom button').getAttribute('aria-label').includes('縮放只套用在 Word 模式'),
    '縮放只用在 Word 模式：Markdown 模式仍然顯示，但停用並說明原因');
  assert(!wordBar.querySelector('.wm-bb-zoom').classList.contains('is-disabled') && !wordBar.querySelector('.wm-bb-range').disabled, 'Word 模式的縮放可以用');
  const count = root => root.querySelector('.wm-bb-count').textContent;
  assert(count(mdEl) === count(wordBar) && /^\d+ 字・\d+ 個字元$/.test(count(mdEl)), '字數跟 Word 模式一樣（Markdown 符號與文件屬性不算）：' + count(mdEl) + ' / ' + count(wordBar));
  await sleep(0);
  assert(mdEl.querySelector('.wm-bb-status').textContent === '已儲存', '內容跟檔案一樣：已儲存');
  md.text = text + '\n多打的字\n';
  sb.update();
  await sleep(0);
  assert(mdEl.querySelector('.wm-bb-status').textContent === '編輯中（自動儲存）' && count(mdEl) !== count(wordBar), '改了還沒存檔：編輯中，字數跟著更新');
  env.files.set('筆記/測試.md', md.text);
  sb.update();
  await sleep(0);
  assert(mdEl.querySelector('.wm-bb-status').textContent === '已儲存', 'Obsidian 存檔之後：已儲存');
  md.sel = '這是';
  sb.update();
  assert(count(mdEl).startsWith('已選取 2／'), '選取文字時顯示選取的字數：' + count(mdEl));
  click(mdEl.querySelector('.wm-bb-count'));
  const rows = mock.Modal.last.rows;
  assert(rows[0].join() === ',整份文件,選取範圍' && rows[1][0] === '字數' && rows[1][2] === '2', '點字數：字數統計視窗（含選取範圍）：' + JSON.stringify(rows.slice(0, 2)));
  mock.Modal.last.close();
  const modeBtn = m => mdEl.querySelector('.wm-bb-btn[data-mode="' + m + '"]');
  click(modeBtn('preview'));
  await sleep(0);
  assert(plugin.modeSet === 'preview', '按「閱讀模式」切到閱讀模式');
  const before = plugin.toWord || 0;
  click(modeBtn('word'));
  assert(plugin.toWord === before + 1, '按「Word 模式」切回 Word 模式');
  wordBar.remove(); mdEl.remove(); md.containerEl.remove();
}

// ======== 查看文件屬性：功能區與狀態列的按鈕打開小視窗 ========
{
  await fresh('---\ntags: [會議, 專案]\ndate: 2026-11-19\ndone: true\nnote: ' + '很長的說明 '.repeat(60).trim() + '\n---\n內文\n');
  const peekBtn = view.toolbar.items.find(i => i.title.startsWith('查看文件屬性')).dom;
  const showOrder = [...view.toolbar.dom.querySelectorAll('.wm-group-show .wm-btn')].map(b => b.getAttribute('aria-label'));
  assert(peekBtn.closest('.wm-group-show') && showOrder.indexOf('查看文件屬性') === showOrder.indexOf('大綱') + 1, '功能區「檢視 → 顯示」有查看文件屬性（在大綱後面）：' + showOrder.join('、'));
  const peek = () => document.querySelector('.wm-peek');
  click(peekBtn);
  let p = peek();
  assert(p && p.querySelectorAll('.wm-peek-row').length === 4 && p.querySelector('.wm-peek-count').textContent === '4 個屬性', '打開小視窗：列出所有屬性');
  assert([...p.querySelectorAll('.wm-chip-tag')].map(c => c.textContent).join() === '#會議,#專案' && p.querySelector('.wm-peek-check').checked && p.querySelector('.wm-peek-check').disabled,
    '標籤顯示成 #標籤、核取方塊顯示勾選狀態（不能改）');
  assert(!p.querySelector('.wm-peek-filter') && p.querySelectorAll('.wm-peek-value.is-clamped').length === 3, '屬性不多時沒有篩選框；文字與清單的值可以收成三行');
  click(peekBtn);
  assert(!peek(), '再按一次同一個按鈕：關閉');
  click(peekBtn);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(!peek(), '按 Esc 關閉');
  click(peekBtn);
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  assert(!peek(), '點小視窗以外的地方關閉');
  click(peekBtn);
  view.propsOpen = false;
  assert(peek().querySelector('.wm-peek-go').textContent === '前往文件屬性', '有屬性時：前往文件屬性');
  click(peek().querySelector('.wm-peek-go'));
  assert(!peek() && view.propsOpen === true, '按「前往文件屬性」：關閉小視窗，展開文件裡的文件屬性');

  // 屬性很多：篩選框
  await fresh('---\n' + Array.from({ length: B.PEEK.PEEK_FILTER_MIN + 3 }, (_, i) => 'k' + i + ': v' + i).join('\n') + '\n---\n內文\n');
  click(peekBtn);
  p = peek();
  const f = p.querySelector('.wm-peek-filter');
  const shown = () => [...p.querySelectorAll('.wm-peek-row')].filter(r => !r.hidden).map(r => r.querySelector('.wm-peek-name').textContent);
  assert(f && shown().length === B.PEEK.PEEK_FILTER_MIN + 3, '屬性超過 ' + B.PEEK.PEEK_FILTER_MIN + ' 個：上方有篩選框');
  f.value = 'V3'; f.dispatchEvent(new Event('input'));
  assert(shown().join() === 'k3' && p.querySelector('.wm-peek-list ~ .wm-peek-empty').hidden, '篩選：名稱或值包含輸入的文字（不分大小寫）：' + shown().join());
  f.value = '找不到'; f.dispatchEvent(new Event('input'));
  assert(!shown().length && !p.querySelector('.wm-peek-list ~ .wm-peek-empty').hidden, '沒有符合的屬性：顯示說明');
  click(peekBtn);

  // 沒有文件屬性：可以新增
  await fresh('內文\n');
  click(peekBtn);
  p = peek();
  assert(p.textContent.includes('這份筆記沒有文件屬性') && p.querySelector('.wm-peek-go').textContent === '新增文件屬性', '沒有文件屬性：說明，按鈕是「新增文件屬性」');
  click(p.querySelector('.wm-peek-go'));
  assert(!peek() && view.pm.state.doc.firstChild.type.name === 'frontmatter', '按「新增文件屬性」：在文件最前面加上文件屬性');

  // 看不懂的 YAML：顯示原文
  await fresh('---\n這一行不是 YAML\n---\n內文\n');
  click(peekBtn);
  assert(peek().querySelector('.wm-peek-raw').textContent === '這一行不是 YAML' && !peek().querySelector('.wm-peek-row'), '看不懂的 YAML：顯示原文');
  click(peekBtn);

  // Markdown／閱讀模式：讀原文（還沒存檔的修改也看得到）
  const md = fakeMarkdown('筆記/屬性.md', '---\ntags: [a]\n---\n內文\n');
  const bar = new B.MarkdownBar(plugin, md);
  const mdPeek = bar.items.find(i => i.title.startsWith('查看文件屬性'));
  assert(mdPeek && mdPeek.dom.closest('.wm-group-show') && mdPeek.spec.always, 'Markdown 工具列也有查看文件屬性，閱讀模式也能用');
  click(mdPeek.dom);
  assert(peek() && peek().querySelectorAll('.wm-peek-row').length === 1 && peek().querySelector('.wm-chip-tag').textContent === '#a', 'Markdown 模式：讀原文的文件屬性');
  click(peek().querySelector('.wm-peek-go'));
  assert(!peek() && md.scrolled === 0, '前往文件屬性：捲到最上方（Obsidian 把屬性顯示在那裡）');
  md.text = '內文\n'; md.mode = 'preview';
  click(mdPeek.dom);
  assert(peek().textContent.includes('這份筆記沒有文件屬性') && !peek().querySelector('.wm-peek-go'), '閱讀模式沒有屬性：不能新增，沒有按鈕');
  bar.destroy();
  assert(!peek(), '工具列關閉時小視窗也關閉');
  md.mode = 'source';
  const statusBtn = document.body.createEl('button');
  B.openMarkdownPeek(plugin, md, statusBtn);
  click(peek().querySelector('.wm-peek-go'));
  assert(md.inserted.length === 1 && md.inserted[0][0] === '---\n\n---\n', 'Markdown 編輯模式新增文件屬性：沒有 Obsidian 的指令時直接在最前面加上 ---');
  statusBtn.remove(); md.containerEl.remove();
}

// ======== 文件屬性固定在上方（設定）：捲過文件屬性之後，上方浮出精簡的屬性列 ========
{
  await fresh('---\ntags: [會議, 專案, 週報, 月報, 年報]\ndate: 2026-11-19\ndone: true\nempty:\n---\n' + Array.from({ length: 12 }, (_, i) => '段落 ' + i).join('\n\n') + '\n');
  const fmDom = view.pm.nodeDOM(0);
  // 捲動區在畫面的 100～600；文件屬性已經捲到上面（下緣 50）
  view.scroller.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500, left: 0, right: 800, width: 800 });
  fmDom.getBoundingClientRect = () => ({ top: -100, bottom: 50, height: 150, left: 0, right: 800, width: 800 });
  Object.defineProperty(view.scroller, 'scrollTop', { value: 500, writable: true, configurable: true });
  view.updatePin();
  assert(!view.pin || !view.pin.classList.contains('is-shown'), '預設不顯示屬性列');
  plugin.settings.propsSticky = true;
  view.applyPropsSticky();
  const pin = view.pin;
  assert(pin && pin.classList.contains('is-shown') && pin.parentElement === view.pinHost && view.pinHost.nextElementSibling === view.scroller, '開啟設定、文件屬性捲出畫面：捲動區上方浮出屬性列（不在文件裡，文件不會跳動）');
  const items = [...pin.querySelectorAll('.wm-pin-item')].map(x => x.textContent);
  assert(items.join(' | ') === 'tags#會議#專案#週報+2 | date2026-11-19 | done☑ | empty—' && pin.querySelector('.wm-pin-check.is-on') && pin.querySelector('.wm-pin-count').textContent === '4 個屬性',
    '屬性列：一行列出名稱與值，清單最多 3 個標籤（其餘 +N），核取方塊用圖示，空的值是 —：' + items.join(' | '));
  assert(pin.querySelector('.wm-pin-bar').getAttribute('aria-expanded') === 'false' && !pin.querySelector('.wm-pin-card').childElementCount, '一開始收起來');
  click(pin.querySelector('.wm-pin-bar'));
  const card = pin.querySelector('.wm-pin-card');
  assert(pin.classList.contains('is-open') && card.querySelectorAll('.wm-peek-row').length === 4 && !card.querySelector('.wm-peek-head') && card.querySelector('.wm-peek-go'),
    '點屬性列：展開完整清單（跟查看文件屬性一樣，不重複標題）');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  assert(!pin.classList.contains('is-open') && !card.childElementCount, '點屬性列以外的地方：收起來');
  click(pin.querySelector('.wm-pin-bar'));
  pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert(!pin.classList.contains('is-open'), '按 Esc 收起來');
  // 改了文件屬性：屬性列跟著更新
  const src = view.pm.state.doc.firstChild.attrs.src.replace('date: 2026-11-19', 'date: 2026-12-01');
  view.pm.dispatch(view.pm.state.tr.setNodeMarkup(0, null, Object.assign({}, view.pm.state.doc.firstChild.attrs, { src })));
  assert(pin.textContent.includes('2026-12-01'), '改了文件屬性：屬性列跟著更新');
  // 游標被屬性列蓋住：往上捲到露出來
  pin.getBoundingClientRect = () => ({ top: 108, bottom: 144, height: 36, left: 0, right: 800, width: 800 });
  caret(view, 5);
  view.pm.coordsAtPos = () => ({ top: 120, bottom: 140, left: 0, right: 0 });
  assert(view.scrollPastProps(view.pm) === true && view.scroller.scrollTop === 468, '游標被屬性列蓋住：往上捲到露出來：' + view.scroller.scrollTop);
  view.pm.coordsAtPos = () => ({ top: 300, bottom: 320, left: 0, right: 0 });
  assert(view.scrollPastProps(view.pm) === false && view.scroller.scrollTop === 468, '游標沒有被蓋住：交給編輯器原本的捲動');
  // 按「前往文件屬性」：收起來，捲回文件屬性
  click(pin.querySelector('.wm-pin-bar'));
  view.propsOpen = false;
  click(pin.querySelector('.wm-peek-go'));
  assert(!pin.classList.contains('is-open') && view.propsOpen === true, '展開後按「前往文件屬性」：收起來，展開文件裡的文件屬性');
  // 文件屬性回到畫面裡：屬性列消失
  fmDom.getBoundingClientRect = () => ({ top: 150, bottom: 300, height: 150, left: 0, right: 800, width: 800 });
  view.updatePin();
  assert(!pin.classList.contains('is-shown'), '文件屬性回到畫面裡：屬性列消失');
  fmDom.getBoundingClientRect = () => ({ top: -100, bottom: 50, height: 150, left: 0, right: 800, width: 800 });
  view.scroller.scrollTop = 500;
  view.updatePin();
  assert(pin.classList.contains('is-shown'), '再捲下去又出現');
  plugin.settings.propsSticky = false;
  view.applyPropsSticky();
  assert(!pin.classList.contains('is-shown') && view.scrollPastProps(view.pm) === false, '關閉設定：屬性列消失');
  plugin.settings.propsSticky = true;
  await fresh('沒有文件屬性\n\n' + Array.from({ length: 12 }, (_, i) => '段落 ' + i).join('\n\n') + '\n');
  view.updatePin();
  assert(!pin.classList.contains('is-shown'), '筆記沒有文件屬性：不顯示屬性列');
  plugin.settings.propsSticky = false;
  delete view.pm.coordsAtPos; delete view.scroller.getBoundingClientRect; delete view.scroller.scrollTop; delete pin.getBoundingClientRect;
}

// ======== 文件屬性的外觀（設定）：區塊、只有框線、簡潔；屬性列只顯示值 ========
{
  const has = c => view.contentEl.classList.contains(c);
  const look = () => ['wm-props-style-outline', 'wm-props-style-plain', 'wm-pin-nolabels'].filter(has).join() || '（預設）';
  view.applyPropsLook();
  assert(look() === '（預設）', '預設：區塊（框線加底色），屬性列顯示名稱：' + look());
  plugin.settings.propsStyle = 'plain'; plugin.settings.pinLabels = false;
  view.applyPropsLook();
  assert(look() === 'wm-props-style-plain,wm-pin-nolabels', '簡潔、屬性列只顯示值：' + look());
  plugin.settings.propsStyle = 'outline';
  view.applyPropsLook();
  assert(look() === 'wm-props-style-outline,wm-pin-nolabels', '只有框線：' + look());
  plugin.settings.propsStyle = '不認得的值'; plugin.settings.pinLabels = true;
  view.applyPropsLook();
  assert(look() === '（預設）', '不認得的值當成預設的區塊：' + look());
  delete plugin.settings.propsStyle; delete plugin.settings.pinLabels;
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../styles/word-mode.css', import.meta.url), 'utf8');
  assert(css.includes('.wm-props-style-outline .wm-editor .wm-props { background: transparent; }') && css.includes('.wm-props-style-plain .wm-editor .wm-props { background: transparent; border: none;') && css.includes('.wm-pin-nolabels .wm-pin-key { display: none; }'),
    '樣式表有三種外觀與只顯示值的規則');
}

finish();
