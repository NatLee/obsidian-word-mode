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


finish();
