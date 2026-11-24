// 編輯測試（第三部分）：程式碼區塊裡停用的功能、表格右鍵選單、分頁列樣式、色彩面板、
// Markdown 工具列的版面、方程式編輯器的復原、圖表編輯器（各種圖表的表單、在圖上編輯）
import { B, mock, assert, finish, makeEnv, caret, press, sleep, TextSelection } from './harness.mjs';

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
  assert(sub('刪除列、欄或表格').join() === '刪除列,刪除欄,刪除表格,清除內容' && sub('選取').join() === '選取儲存格,選取整列,選取整欄,選取表格,全選' && !titles.includes('全選') && sub('移動列或欄').length === 4 && sub('整欄對齊').length === 3 && sub('依此欄排序').length === 2, '子選單：刪除、選取（全選也收在這裡）、移動、對齊、排序');
  assert(sub('段落').includes('項目符號') && sub('插入').some(x => x.includes('超連結')) && sub('工具').some(x => x.includes('字數統計')) && sub('工具').includes('表格轉成文字'), '表格裡：段落、插入、工具也收成子選單');
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
  // 選單按鈕還在，但只在打字時精簡功能區（wm-kb-compact）才出現
  assert(view.toolbar.dom.querySelectorAll('.wm-tab').length === 4 && view.toolbar.tabSwitch && view.toolbar.tabSwitch.classList.contains('is-compact-only'), '改回文字的分頁列');
}

// ======== 色彩面板：醒目提示可以自訂色彩 ========
await fresh('一段文字\n');
{
  const C = B.COLOR;
  assert(C.toHex(C.parseHex('ABC')) === '#aabbcc' && C.toHex(C.parseHex('#12ab3480')) === '#12ab3480' && C.parseHex('xyz') === null, '色碼的讀寫');
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
  // 原文沒有大括號，改過之後還是一個字：照樣不加（以前變成 x^{3}）
  assert(eq2.ta.value === 'x^3', '改上標：' + eq2.ta.value);
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

  // 分類是用樣式表隱藏的：settingstab.ts 的每一類在樣式表裡都要有對應的隱藏規則，少了一條那一類就會出現在每個分類裡
  const main = readFileSync(new URL('../../src/settingstab.ts', import.meta.url), 'utf8');
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
  assert(count(mdEl) === count(wordBar) && /^\d+ 字$/.test(count(mdEl)), '字數跟 Word 模式一樣（Markdown 符號與文件屬性不算），只顯示字數：' + count(mdEl) + ' / ' + count(wordBar));
  await sleep(0);
  assert(mdEl.querySelector('.wm-bb-status').textContent === '已儲存', '內容跟檔案一樣：已儲存');
  md.text = text + '\n多打的字\n';
  sb.update();
  await sleep(0);
  // 算字數要解析整份筆記：還在打字時不算，連續兩次定時更新看到一樣的內容才算
  assert(mdEl.querySelector('.wm-bb-status').textContent === '編輯中（自動儲存）' && count(mdEl) === count(wordBar), '改了還沒存檔：馬上顯示編輯中，字數先不動');
  sb.update();
  assert(count(mdEl) !== count(wordBar), '下一次更新時內容沒再變：字數跟著更新');
  env.files.set('筆記/測試.md', md.text);
  sb.update();
  await sleep(0);
  assert(mdEl.querySelector('.wm-bb-status').textContent === '已儲存', 'Obsidian 存檔之後：已儲存');
  md.sel = '這是';
  sb.update(); sb.update();
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

// ======== 字數的算法：只算看得到的文字，或跟 Obsidian 內建的一樣 ========
{
  const text = '---\ntags: [a]\n---\n# 標題\n\n見 [連結](https://example.com) 與 **粗體**。\n';
  // Obsidian 不算文件屬性；字元數是剩下原文的長度
  const body = text.slice(text.indexOf('---\n', 4) + 4);
  await fresh(text);
  const bar = document.body.createDiv('wm-statusbar');
  view.buildBottomBar(bar, true);
  const box = () => bar.querySelector('.wm-bb-count');
  view.updateCount();
  assert(box().textContent === '8 字' && box().getAttribute('aria-label').includes('字元數（不含空白）：') && box().getAttribute('aria-label').includes('只算看得到的文字'),
    '只算看得到的文字：標題、見、連結、與、粗體共 8 字；提示裡有字元數與算法：' + box().textContent + ' / ' + box().getAttribute('aria-label'));
  plugin.settings.countMethod = 'obsidian';
  view.updateCount();
  assert(box().textContent === '11 字' && box().getAttribute('aria-label').includes('字元數（含空白）：' + body.length) && box().getAttribute('aria-label').includes('跟 Obsidian 內建的字數一樣'),
    '跟 Obsidian 一樣：算原文，網址也算（https、example、com 三個詞），字元數含空白與換行：' + box().textContent + ' / ' + box().getAttribute('aria-label'));
  let para = null;
  view.pm.state.doc.forEach((n, pos) => { if (n.type.name === 'paragraph') para = { from: pos + 1, to: pos + 1 + n.content.size }; });
  select(para.from, para.to);
  view.updateCount();
  assert(box().textContent === '已選取 9／11 字', '選取一段：也用原文算（連結網址也算）：' + box().textContent);
  click(box());
  const rows = mock.Modal.last.rows;
  assert(rows[1][0] === '字數' && rows[1][1] === '11' && rows[1][2] === '9' && rows[3][1] === String(body.length) && mock.Modal.last.note.includes('跟 Obsidian'),
    '字數統計視窗也用同一種算法：' + JSON.stringify(rows.slice(0, 4)));
  mock.Modal.last.close();
  // Markdown 模式的狀態列：跟 Word 模式同一個數字
  const mdEl = document.body.createDiv('wm-statusbar');
  const md = fakeMarkdown('筆記/算法.md', text);
  new B.MdStatusBar(plugin, mdEl, md);
  assert(mdEl.querySelector('.wm-bb-count').textContent === '11 字', 'Markdown 模式也是 11 字：' + mdEl.querySelector('.wm-bb-count').textContent);
  plugin.settings.countMethod = 'word';
  bar.remove(); mdEl.remove(); md.containerEl.remove();
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

// ======== 拼接的文字：用空格分詞的語言不能黏在一起 ========
// 以前英文的圖片選單是「Insertimage from vault…」、原始碼對話框是「EditingHTML」、動畫裡是「Cutthis text」
await fresh('<div>html</div>\n\n一段\n');
{
  B.I18N.setLanguage('en');
  // 游標放在「一段」（第一個文字區塊；HTML 原始區塊不算）
  caret(view, 0);
  view.openImageMenu(null);
  const insert = mock.Menu.last.items.map(i => i.title);
  view.openImageMenu(null, 1);
  const replace = mock.Menu.last.items.map(i => i.title);
  assert(insert.includes('Insert image from vault…') && insert.includes('Insert online image (URL)…') && replace.includes('Replace with image from vault…') && replace.includes('Replace with online image (URL)…'),
    '圖片選單：插入、更換都是整句翻譯：' + insert.join(' / ') + ' | ' + replace.join(' / '));
  view.pm.dom.querySelector('.wm-raw-block[data-kind="html"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert(mock.Modal.last.titleText === 'Edit HTML', '原始碼對話框的標題：' + mock.Modal.last.titleText);
  mock.Modal.last.contentEl.remove();

  // 示意動畫裡「動詞｜受詞」的交界：兩邊都是字母時中間要有空格。
  // 只看這些交界（上下標、註腳編號、韓文助詞本來就要黏在一起）；某一邊是空字串的不算（韓文、日文常把動詞放在後面）；
  // 左邊最後一個詞只有一個字母的也不算：希伯來文的 ל ו、阿拉伯文的 و 是要黏在下一個字上的前綴
  const letter = /[\p{L}\p{N}]/u;
  const pieces = name => {
    const box = document.createElement('div');
    B.buildDemo(name, box);
    // 輪流顯示的兩個字（wm-demo-swap）算一段，用第一個
    return [...box.querySelector('.wm-demo-line').childNodes].map(n => (n.classList && n.classList.contains('wm-demo-swap') ? n.firstChild.textContent : n.textContent));
  };
  const glued = [];
  for (const lang of ['en', 'ko', 'vi', 'fr', 'de', 'es', 'ar', 'he']) {
    B.I18N.setLanguage(lang);
    for (const [name, at] of [['notelink', [1]], ['cut', [1]], ['copy', [1]], ['replace', [1, 2]], ['link', [1]], ['bold', [1]]]) {
      const p = pieces(name);
      for (const i of at) {
        const a = p[i - 1], b = p[i];
        if (!a || !b || [...a.split(/\s+/).pop()].length === 1) continue;
        // 韓文的助詞（을、에、와…）黏在前面的名詞上
        if (lang === 'ko' && /^(을|를|이|가|은|는|에|와|과|의|으?로)/.test(b)) continue;
        if (letter.test(a.slice(-1)) && letter.test(b[0])) glued.push(lang + ' ' + name + '：' + p.join('|'));
      }
    }
  }
  B.I18N.setLanguage('zh-TW');
  assert(!glued.length, '示意動畫的「動詞｜受詞」之間有空格：' + (glued.join('；') || '全部正確'));
}

// ======== Markdown 功能區插入的文字不能弄壞前後的內容 ========
{
  const conv = new B.MarkdownConverter();
  const kinds = md => { const a = []; conv.parse(md).doc.forEach(n => a.push(n.type.name + (n.type.name === 'heading' ? n.attrs.level : ''))); return a.join(','); };
  // 水平線放在游標那一行的行尾
  const hr = (lines, at) => { const l = lines.slice(); l[at] += B.hrText(lines[at], at > 0 ? lines[at - 1] : null); return l.join('\n'); };
  assert(kinds(hr(['文字', '下一段'], 0)) === 'paragraph,horizontal_rule,paragraph', '在文字那一行插入水平線：那一行不會變成標題：' + kinds(hr(['文字', '下一段'], 0)));
  assert(kinds(hr(['文字', '', '下一段'], 1)) === 'paragraph,horizontal_rule,paragraph', '在文字下面的空行插入水平線：上一行不會變成標題');
  assert(kinds(hr(['文字', '', '', '下一段'], 2)) === 'paragraph,horizontal_rule,paragraph', '前面已經有空行：直接插入');
  assert(kinds(hr(['', '內文'], 0)) === 'horizontal_rule,paragraph', '在檔案第一行插入水平線：不會變成文件屬性的開頭：' + kinds(hr(['', '內文'], 0)));
  // 程式碼區塊取代選取的內容
  const empty = B.codeBlockText('', 'python', '', '');
  assert(empty.text === '```python\n\n```' && empty.cursorLine === 1, '沒有選取時插入程式碼區塊：中間留一個空行，游標放在那一行：' + JSON.stringify(empty));
  const mid = B.codeBlockText('', '', '前面的字', '後面的字');
  assert(mid.text === '\n```\n\n```\n' && mid.cursorLine === 2 && kinds('前面的字' + mid.text + '後面的字') === 'paragraph,code_block,paragraph', '游標在一行中間：圍欄自己一行，前後的字各自成段：' + JSON.stringify(mid));
  const sel = B.codeBlockText('a\nb', 'js', '', '');
  assert(sel.text === '```js\na\nb\n```' && sel.cursorLine === -1, '有選取時把選取的內容包起來：' + JSON.stringify(sel));
}

// ======== 格式刷開著的時候重建功能區：編輯區不留著刷子游標 ========
await fresh('**粗體** 一般\n');
{
  select(2, 4);
  view.toolbar.togglePainter(true);
  assert(view.pm.dom.classList.contains('wm-painting'), '格式刷開啟');
  view.buildToolbar();
  assert(!view.pm.dom.classList.contains('wm-painting') && !view.toolbar.painter, '重建功能區後格式刷已經停止');
}

// ======== 方程式編輯器：在格子裡改一個字，沒改到的內容原樣保留 ========
await fresh('公式 $n\\log n + \\text{learning_rate}$ 結束\n');
{
  const typeIn = (span, text) => { span.focus(); span.textContent = text; mock.Modal.last.field.place(span, text.length); span.dispatchEvent(new Event('input', { bubbles: true })); };
  view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const eq = mock.Modal.last;
  await sleep(25);
  const q = s => eq.contentEl.querySelector(s);
  const cells = () => [...eq.contentEl.querySelectorAll('.wm-mv > .wm-mv-row > .wm-mv-text')];
  const inText = () => q('.wm-mv-group[data-cmd="text"] .wm-mv-text');
  assert(inText() && inText().textContent === 'learning_rate' && !q('.wm-mv-sub'), '\\text{…} 裡的底線是一般的字，不是下標的格子');
  // 在第一格的結尾多打一個字：前面的 \log 與後面的 \text{…} 都不能變
  typeIn(cells()[0], cells()[0].textContent + '1');
  assert(eq.ta.value === 'n\\log n + 1\\text{learning_rate}', '改一個字，其他地方一字不動：' + eq.ta.value);
  // 打 \log 再按空白：前面緊接字母時反斜線也要留著
  typeIn(cells()[0], 'n\\log ');
  assert(eq.ta.value === 'n\\log \\text{learning_rate}', '緊接在字母後面打 \\log：' + eq.ta.value);
  // 文字的格子裡打 _：就是底線，不開下標的格子
  const ev = new KeyboardEvent('keydown', { key: '_', bubbles: true, cancelable: true });
  inText().dispatchEvent(ev);
  assert(!ev.defaultPrevented && !q('.wm-mv-sub'), '文字的格子裡打 _ 不會變成下標');

  // 分成好幾行寫的 LaTeX：換行是 \implies 與 b 之間唯一的分隔，改別的地方時不能被拿掉
  eq.setEdit('latex');
  eq.ta.value = 'a \\implies\nb + c';
  eq.setEdit('visual');
  typeIn(cells()[0], cells()[0].textContent + 'x');
  assert(eq.ta.value === 'a \\implies\nb + cx', '原本的換行留著：' + JSON.stringify(eq.ta.value));

  // 整段看不懂的 LaTeX（大括號不成對）：照原文顯示，改一個字不會動到其他地方
  eq.setEdit('latex');
  eq.ta.value = '\\frac{a}{\\text{max value} \\leq b';
  eq.setEdit('visual');
  assert(cells().length === 1 && cells()[0].textContent === eq.ta.value, '看不懂的 LaTeX 照原文顯示：' + cells()[0].textContent);
  typeIn(cells()[0], cells()[0].textContent + '}');
  assert(eq.ta.value === '\\frac{a}{\\text{max value} \\leq b}', '看不懂的 LaTeX 原文存回：' + eq.ta.value);
  eq.close();
}

// ======== 圖表編輯器：在表單把名稱清空再重打，引用它的訊息不會不見 ========
await fresh('第一段\n');
{
  view.openMermaid();
  const mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  const setInput = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  click(qa('.wm-mmd-kind').find(b => b.dataset.kind === 'sequence'));
  const name = q('.wm-mmd-row .wm-mmd-f-name');
  const messages = () => mm.src.split('\n').filter(l => l.includes(': ')).map(l => l.trim()).join('|');
  assert(name.value === '使用者' && messages() === '使用者->>系統: 送出請求|系統-->>使用者: 回覆結果', '循序圖的範本：' + messages());
  // 一個字一個字刪掉（中間會經過空的名稱），再打新的名稱
  for (const v of ['使用', '使', '']) setInput(name, v);
  assert(messages() === '使->>系統: 送出請求|系統-->>使: 回覆結果' && q('.wm-mmd-f-from').value === '使', '名稱清空的時候訊息還在：' + messages());
  for (const v of ['客', '客戶']) setInput(name, v);
  assert(messages() === '客戶->>系統: 送出請求|系統-->>客戶: 回覆結果' && mm.src.includes('participant 客戶'), '清空再重打：訊息一則都沒少，名稱都改了：' + messages());
  // 打成跟另一個參與者一樣的名稱：訊息不會混在一起；就這樣離開輸入框，名稱改回原本的
  setInput(name, '系統');
  assert(messages() === '客戶->>系統: 送出請求|系統-->>客戶: 回覆結果' && [...q('.wm-mmd-f-from').options].map(o => o.value).join() === '客戶,系統', '跟另一個參與者同名時訊息不變：' + messages());
  name.dispatchEvent(new Event('change', { bubbles: true }));
  assert(name.value === '客戶' && mm.src.split('\n').filter(l => l.includes('participant')).map(l => l.trim()).join('|') === 'participant 客戶|participant 系統', '離開時名稱還是重複的：改回原本的名稱：' + name.value);
  // 空著離開也一樣
  setInput(name, '');
  name.dispatchEvent(new Event('change', { bubbles: true }));
  assert(name.value === '客戶' && messages() === '客戶->>系統: 送出請求|系統-->>客戶: 回覆結果', '空著離開：改回原本的名稱：' + JSON.stringify(name.value));
  mm.close();
}

// ======== 兩條功能區共用同一份按鈕外觀（ribbon.ts 的 ACTIONS）：圖示、名稱、文字不會各寫各的 ========
await fresh('一段文字\n');
{
  const S = plugin.settings;
  const keep = { ...S };
  const keepTab = plugin.lastTab;
  Object.assign(S, { ribbonLayout: 'tabs', tabStyle: 'text', buttonStyle: 'auto', richHints: false, viewButtonLabels: true, hiddenTabs: [], hiddenGroups: [], groupNames: {}, groupTabs: {}, groupOrder: [], tabLabels: {} });
  const md = fakeMarkdown('筆記/測試.md', '一段文字\n');
  let bar = null;
  const rebuild = () => { view.buildToolbar(); if (bar) bar.destroy(); bar = new B.MarkdownBar(plugin, md); };
  rebuild();
  // 按鈕的提示（含快速鍵）、名稱（不含快速鍵）、樣子（圖示｜文字｜是不是有文字的大按鈕）
  const tip = b => (b.getAttribute('aria-label') || b.querySelector('.wm-sr').textContent).split('\n')[0];
  const base = b => tip(b).split(' (')[0];
  const look = b => { const i = b.querySelector('.wm-btn-icon'); const l = b.querySelector('.wm-btn-label'); return (i ? i.dataset.icon : '') + '｜' + (l ? l.textContent : '') + '｜' + b.classList.contains('has-label'); };
  const groupId = g => g.className.replace(/.*wm-group-(\w+).*/, '$1');
  const groups = root => [...root.querySelectorAll('.wm-toolbar .wm-group[class*="wm-group-"]')];
  const wordBtn = title => [...view.toolbar.dom.querySelectorAll('.wm-btn')].find(b => base(b) === title);
  const mdBtn = title => [...bar.dom.querySelectorAll('.wm-btn')].find(b => base(b) === title);

  // Markdown 功能區的每個按鈕：Word 模式同一個群組裡有同名的按鈕，而且長得一樣
  const wordGroups = new Map(groups(view.toolbar.dom).map(g => [groupId(g), [...g.querySelectorAll('.wm-btn')]]));
  let total = 0; const odd = [];
  for (const g of groups(bar.dom)) for (const b of g.querySelectorAll('.wm-btn')) {
    total++;
    const twin = (wordGroups.get(groupId(g)) || []).find(x => base(x) === base(b));
    if (!twin || look(twin) !== look(b)) odd.push(base(b));
  }
  assert(total >= 35 && odd.join() === '段落樣式,切換到 Word 模式,Markdown 編輯',
    'Markdown 功能區的按鈕跟 Word 模式同名的按鈕長得一樣（' + total + ' 個）；刻意不同的只有段落樣式的圖示與兩個檢視模式的名稱：' + odd.join());
  assert(look(mdBtn('查看文件屬性')) === 'clipboard-list｜查看屬性｜true' && look(mdBtn('查看文件屬性')) === look(wordBtn('查看文件屬性')), '「查看文件屬性」兩邊的按鈕文字一樣：' + look(mdBtn('查看文件屬性')));
  const quick = root => [...root.querySelectorAll('.wm-tabs-quick .wm-btn')].map(base).join();
  // Word 模式的尋找列也能取代；Markdown 那顆開的是 Obsidian 的尋找，所以名稱刻意不同
  assert(quick(view.toolbar.dom) === '尋找與取代,快速鍵說明,切換到 Markdown 編輯' && quick(bar.dom) === '尋找,切換到 Word 模式', '右上角的快速按鈕：Word 模式是「尋找與取代」，Markdown 是「尋找」：' + quick(bar.dom));
  assert(tip(wordBtn('底線')) === '底線 (Ctrl+U)' && tip(mdBtn('底線')) === '底線' && tip(mdBtn('粗體')) === '粗體 (Ctrl+B)' && tip(mdBtn('粗體')) === tip(wordBtn('粗體')),
    '只有 Word 模式綁的快速鍵不出現在 Markdown 功能區的提示；兩邊都有的照樣顯示：' + tip(mdBtn('底線')) + '、' + tip(mdBtn('粗體')));
  // 測試替身的 setIcon 不產生 svg，等於「這一版 Obsidian 沒有這個圖示」：兩條功能區都改顯示文字，按鈕不會空白
  const fallback = b => b.querySelector('.wm-btn-icon').textContent;
  assert(fallback(mdBtn('粗體')) === 'B' && fallback(mdBtn('粗體')) === fallback(wordBtn('粗體')) && fallback(mdBtn('復原')) === '復', '沒有圖示時兩條功能區顯示同樣的文字：' + fallback(mdBtn('粗體')) + fallback(mdBtn('復原')));

  // 外殼：分頁列、面板、群組的結構來自同一份程式
  const skeleton = root => [...root.children].map(c => c.className).join() + '｜' + [...root.querySelector('.wm-tabs').children].map(c => c.className.split(' ')[0] + ':' + c.textContent).join().replace(/(wm-tabs-quick):.*/, '$1');
  assert(skeleton(view.toolbar.dom) === 'wm-tabs,wm-toolbar｜wm-tab:常用,wm-tab:插入,wm-tab:校閱,wm-tab:檢視,wm-tabs-spacer:,wm-tabs-quick' && skeleton(bar.dom) === skeleton(view.toolbar.dom), '分頁版面：兩條功能區的分頁列結構一樣：' + skeleton(bar.dom));
  const order = root => groups(root).map(groupId);
  assert(order(view.toolbar.dom).filter(id => order(bar.dom).includes(id)).join() === order(bar.dom).join() && order(bar.dom).length >= 14, 'Markdown 功能區的群組順序跟 Word 模式一致：' + order(bar.dom).join());
  S.tabStyle = 'menu';
  rebuild();
  const menuShape = root => { const t = root.querySelector('.wm-toolbar'); return t.firstElementChild.className + ':' + t.firstElementChild.textContent.replace('▾', '') + ':' + t.lastElementChild.className + ':' + root.querySelector('.wm-tabs').className; };
  assert(menuShape(view.toolbar.dom) === 'wm-tab-switch:常用:wm-tabs-quick:wm-tabs is-hidden' && menuShape(bar.dom) === menuShape(view.toolbar.dom), '分頁收成選單：兩條功能區的選單按鈕與快速按鈕位置一樣：' + menuShape(bar.dom));
  click(bar.dom.querySelector('.wm-tab-switch'));
  assert(mock.Menu.last.items.map(i => i.title).join() === '常用,插入,校閱,檢視', 'Markdown 功能區的分頁選單列出所有分頁');
  mock.Menu.last.items[1].fn();
  assert(!bar.panels.insert.classList.contains('is-hidden') && bar.panels.home.classList.contains('is-hidden') && plugin.lastTab === 'insert' && bar.dom.querySelector('.wm-tab-switch').textContent.includes('插入'), 'Markdown 功能區從選單切換分頁，也會記住分頁');
  S.tabStyle = 'text'; S.ribbonLayout = 'wrap';
  rebuild();
  const flat = root => { const p = root.querySelectorAll('.wm-panel'); return p.length + ':' + p[0].lastElementChild.className + ':' + root.querySelector('.wm-tabs').className; };
  assert(flat(view.toolbar.dom) === '1:wm-tabs-quick:wm-tabs is-hidden' && flat(bar.dom) === flat(view.toolbar.dom), '全部排在一起的版面：只有一塊面板，快速按鈕在最後：' + flat(bar.dom));
  // 隱藏的分頁：兩條功能區都沒有那塊面板；Word 模式多一塊情境分頁「表格」的面板
  S.ribbonLayout = 'tabs'; S.hiddenTabs = ['home'];
  rebuild();
  assert(!view.toolbar.panels.home && !view.toolbar.tabBtns.home && view.toolbar.dom.querySelectorAll('.wm-panel').length === 4 && view.toolbar.panels.tabletab.querySelector('.wm-table-tools .wm-btn'),
    'Word 模式：隱藏「常用」分頁後沒有它的面板，表格工具在「表格」分頁');
  assert(!bar.panels.home && !bar.tabBtns.home && bar.dom.querySelectorAll('.wm-panel').length === 3 && !bar.dom.querySelector('.wm-panel.is-empty'), 'Markdown 功能區：隱藏的分頁沒有面板');

  // 詳細提示的說明：兩邊做法一樣的共用同一句；只有 Word 模式做得到的那句不出現在 Markdown 功能區
  S.hiddenTabs = []; S.richHints = true;
  rebuild();
  let wait = 650;
  const desc = async b => {
    b.dispatchEvent(new MouseEvent('mouseenter'));
    await sleep(wait); wait = 150;
    const c = document.querySelector('.wm-hint-card.is-shown');
    const d = c && c.querySelector('.wm-hint-desc');
    return c ? c.querySelector('.wm-hint-title').textContent + ':' + (d ? d.textContent : '-') : 'none';
  };
  const hints = [];
  for (const b of [wordBtn('斜體'), mdBtn('斜體'), wordBtn('粗體'), mdBtn('粗體'), wordBtn('段落樣式'), mdBtn('段落樣式')]) hints.push(await desc(b));
  assert(hints[0] === '斜體:把文字變斜體。' && hints[1] === hints[0], '做法一樣的功能，兩條功能區的說明是同一句：' + hints[1]);
  assert(hints[2] === '粗體:把選取的文字（或游標所在的詞）變粗體。' && hints[3] === '粗體:-', '說明只適用 Word 模式時（游標所在的詞），Markdown 功能區不顯示：' + hints[3]);
  assert(hints[4] === '段落樣式:把段落改成標題 1～6、內文或程式碼。' && hints[5] === '段落樣式:把這一行改成標題 1～6 或內文。', '做法不同的功能各有自己的說明：' + hints[5]);

  bar.destroy();
  md.containerEl.remove();
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, keep);
  plugin.lastTab = keepTab;
  view.buildToolbar();
}

// ======== 功能區的下拉面板按 Esc 關閉 ========
await fresh('一段文字\n');
{
  click(btn('段落樣式'));
  assert(view.toolbar.popup && view.toolbar.popup.isConnected, '段落樣式的下拉面板打開');
  // 按鈕不搶焦點，所以按鍵是送到編輯區
  press(view, 'Escape');
  assert(!view.toolbar.popup && !document.querySelector('.wm-popup'), '焦點在編輯區時按 Esc：面板關閉');
  click(btn('段落樣式'));
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  view.toolbar.popup.dispatchEvent(ev);
  assert(!view.toolbar.popup && ev.defaultPrevented, '焦點在面板裡按 Esc：面板關閉');
  click(btn('段落樣式'));
  view.toolbar.popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
  assert(view.toolbar.popup, '輸入法選字中的 Esc 不關面板');
  view.toolbar.closePopup();
}

// ======== 區塊右上角的小按鈕：方程式、HTML、註腳、註解的編輯、更多功能或複製、刪除，圖表的刪除 ========
const cornerNames = block => [...block.querySelectorAll('.wm-block-tools button')].filter(b => !b.hidden).map(b => b.getAttribute('aria-label')).join('、');
await fresh('前面\n\n$$\nE=mc^2\n$$\n\n<div>HTML</div>\n\n後面\n');
{
  const block = view.pm.dom.querySelector('.wm-raw-block[data-kind="math"]');
  const tools = block.querySelector('.wm-block-tools');
  assert(!tools.hidden && cornerNames(block) === '編輯方程式、更多功能、刪除方程式', '獨立方程式右上角：編輯、更多功能、刪除：' + cornerNames(block));
  const modal0 = mock.Modal.last;
  click(tools.querySelector('.wm-block-edit'));
  const eq = mock.Modal.last;
  assert(eq !== modal0 && eq.ta && eq.ta.value === 'E=mc^2', '按「編輯方程式」：打開方程式編輯器，內容是這個方程式');
  eq.close();
  const menu0 = mock.Menu.last;
  click(tools.querySelector('.wm-block-more'));
  const titles = mock.Menu.last !== menu0 ? mock.Menu.last.items.map(i => i.title) : [];
  assert(titles.join('、') === '改成文字中（行內）、複製 LaTeX、複製為 Markdown', '「更多功能」列出編輯、刪除以外的功能：' + titles.join('、'));
  const modal1 = mock.Modal.last;
  tools.querySelector('.wm-block-more').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert(mock.Modal.last === modal1, '很快連按兩下右上角的按鈕：不會當成按兩下方程式而打開編輯器');
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  tools.querySelector('.wm-block-delete').dispatchEvent(ev);
  assert(ev.defaultPrevented, '按下右上角的按鈕不搶走編輯區的焦點');
  click(tools.querySelector('.wm-block-delete'));
  assert(out() === '前面\n\n<div>HTML</div>\n\n後面\n', '按「刪除方程式」：整個方程式刪掉，其他內容原樣：' + JSON.stringify(out()));
  B.undo(view.pm.state, tr => view.pm.dispatch(tr));
  assert(out() === '前面\n\n$$\nE=mc^2\n$$\n\n<div>HTML</div>\n\n後面\n', '刪除可以復原：' + JSON.stringify(out()));
}
await fresh('```mermaid\nflowchart TD\n    A --> B\n```\n\n```dataview\nTABLE a\n```\n\n```python\nx = 1\n```\n');
{
  const [mmd, dv, py] = [...view.pm.dom.querySelectorAll('.wm-codeblock')].map(b => b.querySelector('.wm-code-delete'));
  assert(!mmd.hidden && mmd.getAttribute('aria-label') === '刪除圖表' && !dv.hidden && dv.getAttribute('aria-label') === '刪除這個區塊' && py.hidden,
    '顯示成結果的區塊右上角有刪除鍵（圖表叫「刪除圖表」），一般程式碼沒有');
  click(dv);
  assert(out() === '```mermaid\nflowchart TD\n    A --> B\n```\n\n```python\nx = 1\n```\n', '按刪除鍵：整個區塊刪掉：' + JSON.stringify(out()));
}
await fresh('```mermaid\nflowchart TD\n    A --> B\n```\n');
{
  click(view.pm.dom.querySelector('.wm-code-delete'));
  assert(out().trim() === '' && view.pm.state.doc.childCount === 1 && view.pm.state.doc.firstChild.type.name === 'paragraph', '筆記裡只有一張圖表時刪掉它：留下一個空段落可以繼續打字：' + JSON.stringify(out()));
}
// 其他原文區塊（HTML、註解、註腳）：編輯、複製原文、刪除
await fresh('前面[^1]，再一次[^1]。\n\n<div>HTML</div>\n\n%%\n區塊註解\n%%\n\n後面\n\n[^1]: 出處\n');
{
  const [html, comment, fn] = ['html', 'comment', 'footnote'].map(k => view.pm.dom.querySelector(`.wm-raw-block[data-kind="${k}"]`));
  assert(cornerNames(html) === '編輯原文、複製為 Markdown、刪除這個區塊' && cornerNames(comment) === cornerNames(html), 'HTML、註解右上角：編輯原文、複製、刪除：' + cornerNames(html) + '／' + cornerNames(comment));
  assert(cornerNames(fn) === '編輯註腳…、複製為 Markdown、刪除註腳（連同文中的編號）', '註腳右上角：編輯註腳、複製、刪除（連同文中的編號）：' + cornerNames(fn));
  const modal0 = mock.Modal.last;
  click(html.querySelector('.wm-block-edit'));
  assert(mock.Modal.last !== modal0, '按「編輯原文」：打開原文編輯');
  mock.Modal.last.close();
  // 複製：jsdom 沒有剪貼簿，換成記下寫了什麼的替身
  const copied = [];
  const keepClip = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async s => { copied.push(s); } }, configurable: true });
  click(html.querySelector('.wm-block-copy'));
  await sleep(0);
  assert(copied[0] === '<div>HTML</div>' && html.querySelector('.wm-block-copy').classList.contains('is-done'), '按「複製」：原文放進剪貼簿，按鈕變色表示好了：' + JSON.stringify(copied));
  if (keepClip) Object.defineProperty(navigator, 'clipboard', keepClip); else delete navigator.clipboard;
  click(comment.querySelector('.wm-block-delete'));
  assert(!out().includes('區塊註解') && out().includes('<div>HTML</div>'), '刪除註解區塊：' + JSON.stringify(out()));
  click(view.pm.dom.querySelector('.wm-raw-block[data-kind="footnote"] .wm-block-delete'));
  assert(out() === '前面，再一次。\n\n<div>HTML</div>\n\n後面\n', '刪除註腳：內容與文中的編號一起刪掉，不留下對不到內容的 [^1]：' + JSON.stringify(out()));
}

// ======== 文件屬性標題列的圖釘：切換「固定在頁面上方」 ========
await fresh('---\ntags: [會議]\n---\n內文\n');
{
  const pinBtn = () => view.pm.dom.querySelector('.wm-props-head .wm-props-pin');
  const press1 = b => b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  plugin.settings.propsSticky = false;
  view.applyPropsSticky();
  assert(pinBtn() && pinBtn().getAttribute('aria-label') === '文件屬性固定在頁面上方' && pinBtn().getAttribute('aria-pressed') === 'false' && !pinBtn().classList.contains('is-active'),
    '文件屬性標題列有圖釘按鈕，設定關閉時沒有按下');
  const open0 = view.propsOpen;
  const notices = mock.log.length;
  press1(pinBtn());
  assert(plugin.settings.propsSticky === true && pinBtn().getAttribute('aria-pressed') === 'true' && pinBtn().classList.contains('is-active'), '按圖釘：開啟「文件屬性固定在頁面上方」，按鈕顯示成按下');
  assert(view.propsOpen === open0, '按圖釘不會連帶收合文件屬性');
  assert(mock.log.slice(notices).some(x => x[0] === 'notice' && x[1] === '往下捲動時，文件屬性會固定在頁面上方'), '開啟時說明要往下捲才看得到');
  press1(pinBtn());
  assert(plugin.settings.propsSticky === false && pinBtn().getAttribute('aria-pressed') === 'false', '再按一次：關閉');
  plugin.settings.propsSticky = true;
  view.applyPropsSticky();
  assert(pinBtn().getAttribute('aria-pressed') === 'true', '從設定頁改：圖釘跟著變');
  plugin.settings.propsSticky = false;
  view.applyPropsSticky();
}

// ======== 方程式編輯器：改一格，沒改到的寫法一字不動 ========
// 以前改一個字，整個方程式都換成編輯器自己的寫法：x^2 → x^{2}、\leq → \le、max → \max、\left(y\right) → \left( y \right)
await fresh('公式 $x^2 + a_i \\leq b_{max} + \\left(y\\right)$ 結束\n');
{
  const typeIn = (span, text) => { span.focus(); span.textContent = text; mock.Modal.last.field.place(span, text.length); span.dispatchEvent(new Event('input', { bubbles: true })); };
  view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  const eq = mock.Modal.last;
  await sleep(25);
  const q = s => eq.contentEl.querySelector(s);
  const qa = s => [...eq.contentEl.querySelectorAll(s)];
  const top = () => qa('.wm-mv > .wm-mv-row > .wm-mv-text');
  // 在 ≤ 那一格多打一個字：同一格的 \leq、別的格子的 x^2、a_i、\left(y\right) 都不變
  const leq = top().find(s => s.textContent.includes('≤'));
  typeIn(leq, leq.textContent + 'c');
  assert(eq.ta.value === 'x^2 + a_i \\leq bc_{max} + \\left(y\\right)', '改一個字，其他寫法一字不動：' + eq.ta.value);
  // 下標的 max 後面多打一個字：原本的 max 不會變成 \max
  const max = qa('.wm-mv-sub .wm-mv-text').find(s => s.textContent === 'max');
  typeIn(max, 'max2');
  assert(eq.ta.value === 'x^2 + a_i \\leq bc_{max2} + \\left(y\\right)', '原本的 max 不會變成 \\max：' + eq.ta.value);
  // 改上標：原文沒有大括號，改過還是一個字就照樣不加
  typeIn(q('.wm-mv-sup .wm-mv-text'), '3');
  assert(eq.ta.value === 'x^3 + a_i \\leq bc_{max2} + \\left(y\\right)', '改上標，還是沒有大括號：' + eq.ta.value);
  // 新打的函數名稱照樣換成指令；打 \leq 再按空白，存的就是 \leq（不是同一個符號的 \le）
  const last = top().pop();
  typeIn(last, ' + sin');
  typeIn(last, ' + sin \\leq ');
  assert(last.textContent === ' + sin ≤' && eq.ta.value === 'x^3 + a_i \\leq bc_{max2} + \\left(y\\right) + \\sin \\leq', '新打的 sin 與 \\leq：' + eq.ta.value);
  // 復原到沒改過：交回一字不差的原文
  for (let i = 0; i < 10 && !eq.undoBtn.disabled; i++) click(eq.undoBtn);
  assert(eq.ta.value === 'x^2 + a_i \\leq b_{max} + \\left(y\\right)', '全部復原：' + eq.ta.value);
  // 刪掉根號這類結構：其他地方照原文
  eq.setEdit('latex'); eq.ta.value = 'x^2 + \\sqrt{y} + \\begin{pmatrix}\n1 & 0\n\\end{pmatrix}'; eq.setEdit('visual');
  const afterSqrt = q('.wm-mv-sqrt').nextElementSibling;
  eq.field.place(afterSqrt, 0);
  afterSqrt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  assert(!q('.wm-mv-sqrt') && eq.ta.value === 'x^2 +  + \\begin{pmatrix}\n1 & 0\n\\end{pmatrix}', '刪掉根號，x^2 與分成兩行的矩陣不變：' + JSON.stringify(eq.ta.value));

  // 不認得的指令的參數（\color{…} 的顏色）：打 tan 不會變成 \tan
  eq.setEdit('latex'); eq.ta.value = '\\color{red}{x} + y'; eq.setEdit('visual');
  typeIn(qa('.wm-mv-braces .wm-mv-text').find(s => s.textContent === 'red'), 'tan');
  assert(eq.ta.value === '\\color{tan}{x} + y', '顏色的名稱打 tan 不會變成 \\tan：' + eq.ta.value);

  // 打出不成對的 {：寫成看得到的 \{，方程式不會壞掉；打完 } 就是一組大括號
  eq.setEdit('latex'); eq.ta.value = '\\frac{a}{b} + \\text{if } x'; eq.setEdit('visual');
  const num = q('.wm-mv-num .wm-mv-text');
  typeIn(num, 'a{');
  assert(eq.ta.value === '\\frac{a\\{}{b} + \\text{if } x', '不成對的 { 寫成 \\{：' + eq.ta.value);
  typeIn(num, 'a{c}');
  assert(eq.ta.value === '\\frac{a{c}}{b} + \\text{if } x', '成對的 { } 照打的寫：' + eq.ta.value);
  // 游標在 \text{…} 裡按功能區的結構：插在文字的後面（以前插進文字裡，變成 \text{if \sqrt{}}，畫不出來）
  click(qa('.wm-eq-cat').find(b => b.textContent === '結構'));
  const snippet = s => qa('.wm-eq-btn').find(b => b.getAttribute('aria-label') === s);
  const inText = q('.wm-mv-group[data-cmd="text"] .wm-mv-text');
  inText.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  eq.field.place(inText, 2);
  click(snippet('\\sqrt{}'));
  assert(eq.ta.value === '\\frac{a{c}}{b} + \\text{if }\\sqrt{} x' && q('.wm-mv-radicand .wm-mv-text').contains(document.getSelection().anchorNode),
    '在文字裡按根號：插在文字後面，游標在根號裡：' + eq.ta.value);
  // 新插入的結構照編輯器的寫法（上標加大括號）
  typeIn(q('.wm-mv-radicand .wm-mv-text'), 'z');
  click(snippet('^{}'));
  typeIn(q('.wm-mv-radicand .wm-mv-sup .wm-mv-text'), '2');
  assert(eq.ta.value === '\\frac{a{c}}{b} + \\text{if }\\sqrt{z^{2}} x', '按按鈕插入的上標有大括號：' + eq.ta.value);
  eq.close();
}

// ======== 介面由右到左（Obsidian 的 mod-rtl）：下拉面板對齊按鈕的右緣、往左展開，而且不超出畫面 ========
await fresh('一段文字\n');
{
  // jsdom 沒有版面：按鈕的位置自己給，面板寬度是 openPopup 的預設值 200，視窗寬 1024
  const owner = btn('段落樣式');
  const at = (left, right) => { owner.getBoundingClientRect = () => ({ left, right, top: 10, bottom: 40, width: right - left, height: 30 }); };
  const leftOf = () => { click(owner); const x = view.toolbar.popup.style.left; view.toolbar.closePopup(); return x; };
  at(600, 700);
  const ltr = leftOf();
  owner.style.direction = 'rtl';
  const rtl = leftOf();
  at(20, 120);
  const rtlEdge = leftOf();
  owner.style.direction = '';
  delete owner.getBoundingClientRect;
  assert(ltr === '600px', '由左到右：面板左緣對齊按鈕左緣：' + ltr);
  assert(rtl === '500px', '由右到左：面板右緣對齊按鈕右緣（700 - 200）：' + rtl);
  assert(rtlEdge === '4px', '由右到左、按鈕靠近左邊：面板不超出畫面左緣：' + rtlEdge);
}

// ======== 表格：右上角的按鈕、列與欄的把手、「表格」情境分頁 ========
await fresh('前面\n\n| 甲 | 乙 |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n\n後面\n');
{
  const wrap = () => view.pm.dom.querySelector('.wm-table');
  const corner = label => wrap().querySelector(`.wm-table-corner button[aria-label="${label}"]`);
  assert(wrap() && wrap().querySelector(':scope > .tableWrapper > table') && corner('複製為 Markdown') && corner('表格選項') && corner('刪除表格'), '表格外層有右上角的按鈕：複製、表格選項、刪除');
  assert(!wrap().classList.contains('is-active') && !view.pm.dom.querySelector('.wm-table-grip'), '游標不在表格裡：沒有把手，按鈕只在滑鼠移上來時顯示');
  assert(!view.toolbar.tabBtns.tabletab, '游標不在表格裡：還沒有「表格」分頁');

  select(posOf('a1') + 1, posOf('a1') + 1);
  const grips = kind => [...view.pm.dom.querySelectorAll('.wm-table-grip.is-' + kind)];
  assert(wrap().classList.contains('is-active') && grips('row').length === 3 && grips('col').length === 2, '游標在表格裡：每一列一個列把手、每一欄一個欄把手：' + grips('row').length + '/' + grips('col').length);
  const state = list => list.map(g => g.classList.contains('is-selected') ? 'S' : g.classList.contains('is-current') ? 'C' : '-').join('');
  assert(state(grips('row')) === '-C-' && state(grips('col')) === 'C-', '游標所在的列與欄的把手標成 is-current：' + state(grips('row')) + '/' + state(grips('col')));
  select(posOf('b2') + 1, posOf('b2') + 1);
  assert(state(grips('row')) === '--C' && state(grips('col')) === '-C', '游標移動：標示跟著換：' + state(grips('row')) + '/' + state(grips('col')));
  click(grips('row')[1]);
  assert(state(grips('row')) === '-S-' && state(grips('col')) === '--', '選取整列：那一列的把手標成 is-selected，欄的把手不標：' + state(grips('row')) + '/' + state(grips('col')));
  select(posOf('a1') + 1, posOf('a1') + 1);
  const tab = view.toolbar.tabBtns.tabletab;
  assert(tab && !tab.hidden && tab.classList.contains('is-context') && tab.textContent === '表格', '游標在表格裡：出現「表格」分頁');
  assert(view.toolbar.activeTab === 'home', '「表格」分頁出現時不自動切過去');
  click(tab);
  assert(!view.toolbar.panels.tabletab.classList.contains('is-hidden') && plugin.lastTab === 'home', '切到「表格」分頁：顯示表格工具，但不記成下次開啟的分頁');
  const groupNames = [...view.toolbar.panels.tabletab.querySelectorAll('.wm-group-name')].map(x => x.textContent).join();
  assert(groupNames === '表格,列與欄,移動,對齊,排序', '「表格」分頁的群組：' + groupNames);

  // 欄把手：選取整欄、開選單；選單裡的指令作用在選取的那一欄
  click(grips('col')[1]);
  const sel = view.pm.state.selection;
  assert(typeof sel.isColSelection === 'function' && sel.isColSelection() && !sel.isRowSelection(), '按欄把手：選取整欄');
  let menu = mock.Menu.last.items.map(i => i.title);
  assert(menu.includes('在右側插入欄') && menu.includes('整欄置中') && menu.includes('依此欄排序（遞增）') && menu.includes('刪除欄') && !menu.includes('刪除列'), '欄把手的選單：插入、移動、對齊、排序、刪除欄：' + menu.join('、'));
  mock.Menu.last.items.find(i => i.title === '刪除欄').fn();
  assert(out() === '前面\n\n| 甲 |\n| --- |\n| a1 |\n| a2 |\n\n後面\n', '欄把手選單的「刪除欄」刪掉那一欄：' + JSON.stringify(out()));

  // 列把手 + Backspace：選取整列後按 Backspace 刪掉那一列
  select(posOf('a2') + 1, posOf('a2') + 1);
  click(grips('row')[2]);
  menu = mock.Menu.last.items.map(i => i.title);
  assert(menu.includes('在下方插入列') && menu.includes('列上移') && menu.includes('刪除列') && !menu.includes('刪除欄'), '列把手的選單：' + menu.join('、'));
  press(view, 'Backspace');
  assert(out() === '前面\n\n| 甲 |\n| --- |\n| a1 |\n\n後面\n', '選取整列按 Backspace：刪掉那一列：' + JSON.stringify(out()));

  // 離開表格：「表格」分頁消失，回到原本的分頁
  caret(view, 0);
  assert(view.toolbar.tabBtns.tabletab.hidden && view.toolbar.activeTab === 'home' && !view.toolbar.panels.home.classList.contains('is-hidden'), '離開表格：「表格」分頁消失，回到「常用」');

  // 表格下方的段落開頭按 Backspace：先選取整張表（prosemirror-tables 把它換成所有儲存格都選取，看得到反白），
  // 再按一次刪除。以前第二下只會清空內容，表格永遠刪不掉
  select(posOf('後面'), posOf('後面'));
  press(view, 'Backspace');
  const all = view.pm.state.selection;
  assert(typeof all.isRowSelection === 'function' && all.isRowSelection() && all.isColSelection() && view.pm.dom.querySelectorAll('.selectedCell').length === 2 && out().includes('| 甲 |'), '表格下方的段落開頭按 Backspace：先選取整張表（每一格都反白）');
  assert(!view.toolbar.tabBtns.tabletab.hidden, '整張表被選取時「表格」分頁也出現');
  press(view, 'Backspace');
  assert(out() === '前面\n\n後面\n', '再按一次 Backspace：刪掉表格：' + JSON.stringify(out()));
}

// ======== 表格：右上角的刪除、表格選項，複製時的純文字 ========
await fresh('前面\n\n| 甲 | 乙 |\n| --- | --- |\n| a1 | b1 |\n\n後面\n');
{
  const corner = label => view.pm.dom.querySelector(`.wm-table-corner button[aria-label="${label}"]`);
  // 游標不在表格裡也能直接按右上角的按鈕
  click(corner('表格選項'));
  const sel = view.pm.state.selection;
  const menu = mock.Menu.last.items.map(i => i.title);
  assert(typeof sel.isColSelection === 'function' && sel.isRowSelection() && sel.isColSelection(), '表格選項：先選取整張表');
  assert(menu.join() === '選取表格,複製為 Markdown,表格轉成文字,清除內容,刪除表格', '表格選項的選單：' + menu.join());
  const text = view.pm.someProp('clipboardTextSerializer', f => f(view.pm.state.selection.content(), view.pm));
  assert(text === '甲\t乙\na1\tb1', '複製整張表：純文字是 Tab 分隔（貼到 Excel 會分好欄）：' + JSON.stringify(text));
  mock.Menu.last.items.find(i => i.title === '表格轉成文字').fn();
  assert(out() === '前面\n\n甲\t乙\n\na1\tb1\n\n後面\n', '表格轉成文字：' + JSON.stringify(out()));
  press(view, 'z', { ctrlKey: true });
  assert(out().includes('| 甲 | 乙 |'), '復原：表格回來');
  click(corner('刪除表格'));
  assert(out() === '前面\n\n後面\n', '右上角的刪除：一按就刪掉整張表：' + JSON.stringify(out()));
}

// ======== 插入表格：插入後切到「表格」分頁、把選取文字轉成表格 ========
await fresh('名稱\t數量\n\n蘋果\t3\n');
{
  view.toolbar.showTab('insert');
  select(posOf('名稱'), posOf('3') + 1);
  click(btn('插入表格'));
  const conv = document.querySelector('.wm-table-popup .wm-table-convert');
  assert(conv && conv.textContent === '把選取文字轉成表格', '選取了文字：插入表格的面板多一個「把選取文字轉成表格」');
  click(conv);
  assert(out() === '| 名稱 | 數量 |\n| --- | --- |\n| 蘋果 | 3 |\n', '把選取文字轉成表格：' + JSON.stringify(out()));
  assert(view.toolbar.activeTab === 'tabletab', '轉成表格之後切到「表格」分頁');
  await fresh('一段\n');
  view.toolbar.showTab('insert');
  caret(view, 0);
  click(btn('插入表格'));
  assert(!document.querySelector('.wm-table-popup .wm-table-convert'), '沒有選取文字：沒有「把選取文字轉成表格」');
  const cell = document.querySelector('.wm-table-popup .wm-table-cell[data-r="2"][data-c="3"]');
  // jsdom 沒有 PointerEvent：用 MouseEvent 加上 pointerType
  const up = new MouseEvent('pointerup', { bubbles: true });
  Object.defineProperty(up, 'pointerType', { value: 'mouse' });
  cell.dispatchEvent(up);
  assert(view.pm.state.doc.child(1).type.name === 'table' && view.toolbar.activeTab === 'tabletab', '插入表格之後切到「表格」分頁');
  // 剛插入的空表格：第一格開頭按 Backspace 刪掉整張表
  press(view, 'Backspace');
  assert(!view.pm.dom.querySelector('table') && view.toolbar.activeTab === 'insert', '空表格第一格按 Backspace：刪掉表格，回到原本的分頁');
}

// ======== 不分頁的版面：表格工具跟其他按鈕排在一起，游標在表格裡才出現 ========
{
  plugin.settings.ribbonLayout = 'wrap';
  view.buildToolbar();
  await fresh('前面\n\n| 甲 | 乙 |\n| --- | --- |\n| a1 | b1 |\n');
  const groups = () => [...view.toolbar.dom.querySelectorAll('.wm-table-tools')];
  assert(groups().length === 5 && groups().every(g => g.classList.contains('is-hidden')) && !view.toolbar.tabBtns.tabletab, '不分頁的版面：表格工具平常隱藏，沒有情境分頁');
  select(posOf('a1') + 1, posOf('a1') + 1);
  assert(groups().every(g => !g.classList.contains('is-hidden')), '游標在表格裡：表格工具出現');
  plugin.settings.ribbonLayout = 'tabs';
  view.buildToolbar();
}

// ======== 狀態列顯示筆記的路徑；連結與圖片的右鍵選單可以複製路徑 ========
{
  const keepFile = view.file, keepAdapter = env.app.vault.adapter, keepName = env.app.vault.getName;
  view.file = new B.mock.TFile('專案/會議/紀錄.md');
  env.app.vault.adapter = new B.mock.FileSystemAdapter();
  env.app.vault.getName = () => '我的 vault';
  env.files.set('專案/附件/圖.png', '');
  const bar = document.body.createDiv('wm-statusbar');
  view.buildBottomBar(bar, true);
  const p = bar.querySelector('.wm-bb-path');
  assert(p && p.querySelector('.wm-bb-path-dir').textContent === '專案/會議/' && p.querySelector('.wm-bb-path-name').textContent === '紀錄.md', '狀態列顯示路徑：資料夾與檔名分開');
  B.mock.Menu.last = null;
  p.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const titles = B.mock.Menu.last ? B.mock.Menu.last.items.map(i => i.title) : [];
  assert(titles.join('|') === '複製保管庫內的路徑|複製電腦上的完整路徑|複製 Obsidian 網址|複製檔名|複製所在資料夾的路徑', '路徑按右鍵：五種可以複製的路徑：' + titles.join('|'));
  const copied = [];
  const clip = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: v => { copied.push(v); return Promise.resolve(); } }, configurable: true });
  for (const it of B.mock.Menu.last.items) it.fn();
  assert(copied.join('|') === '專案/會議/紀錄.md|/vault/專案/會議/紀錄.md|obsidian://open?vault=' + encodeURIComponent('我的 vault') + '&file=' + encodeURIComponent('專案/會議/紀錄.md') + '|紀錄.md|專案/會議', '複製出來的內容：' + copied.join('|'));
  // 改名之後跟著換
  view.file = new B.mock.TFile('專案/新名字.md');
  view.renderStatus();
  assert(p.querySelector('.wm-bb-path-name').textContent === '新名字.md' && p.querySelector('.wm-bb-path-dir').textContent === '專案/', '筆記改名、搬移：路徑跟著換');
  // 文件裡的連結
  const items = view.pathItems('專案/附件/圖.png');
  assert(items.length === 4 && items[0].title === '專案/附件/圖.png' && items[0].disabled === true && items[1].title === '複製保管庫內的路徑', '連結指向的檔案：第一項寫出路徑，接著是複製：' + items.map(i => i.title).join('|'));
  assert(view.pathItems('https://example.com/a.png').length === 0 && view.pathItems('沒有這個檔案.md').length === 0, '網址、找不到的檔案：沒有路徑項目');
  // 設定關掉就不顯示
  plugin.settings.showPath = false;
  const bar2 = document.body.createDiv('wm-statusbar');
  view.buildBottomBar(bar2, true);
  assert(!bar2.querySelector('.wm-bb-path'), '設定關掉：狀態列不顯示路徑');
  // 手機的列不顯示
  plugin.settings.showPath = true;
  const bar3 = document.body.createDiv('wm-bottombar');
  view.buildBottomBar(bar3, false);
  assert(!bar3.querySelector('.wm-bb-path'), '手機的列不顯示路徑');
  if (clip) Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true }); else delete navigator.clipboard;
  view.file = keepFile; env.app.vault.adapter = keepAdapter; env.app.vault.getName = keepName;
  bar.remove(); bar2.remove(); bar3.remove();
}

finish();
