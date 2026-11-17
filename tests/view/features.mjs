// 編輯測試（第二部分）：自動套用格式、自動完成、尋找、內嵌、程式碼區塊預覽、Mermaid、方程式視覺化、註腳…
import { B, mock, assert, finish, makeEnv, type, press, caret, sleep, TextSelection } from './harness.mjs';

const env = await makeEnv({ '筆記/其他筆記.md': '# 其他\n', '筆記/圖.png': '' });
const { view, plugin, app } = env;
const out = () => view.getViewData();
const fresh = async (data = '') => { await env.open('筆記/測試.md', data); caret(view, 0); };
const undo = () => B.undo(view.pm.state, view.pm.dispatch);

// ======== 輸入時自動套用格式 ========
await fresh('');
type(view, '- 項目');
assert(out() === '- 項目\n', '打「- 」變成項目符號清單：' + JSON.stringify(out()));
await fresh('');
type(view, '- ');
assert(view.pm.state.doc.firstChild.type.name === 'bullet_list', '打「- 」後立刻是清單');
undo();
assert(view.pm.state.doc.firstChild.type.name === 'paragraph' && view.pm.state.doc.textContent === '- ', '按一次復原：取消清單格式，打的「- 」還在：' + JSON.stringify(view.pm.state.doc.textContent));
undo();
assert(view.pm.state.doc.textContent === '', '再按一次復原：連打的字也復原');
await fresh('');
type(view, '1. ');
assert(view.pm.state.doc.firstChild.type.name === 'ordered_list', '打「1. 」變成編號清單');
press(view, 'Backspace');
assert(view.pm.state.doc.firstChild.type.name === 'paragraph' && view.pm.state.doc.textContent === '1. ', '剛套用格式後按 Backspace：取消格式，文字還在');
await fresh('');
type(view, '## 標題');
assert(out() === '## 標題\n', '打「## 」變成標題 2：' + JSON.stringify(out()));
await fresh('');
type(view, '> 引用');
assert(out() === '> 引用\n', '打「> 」變成引文：' + JSON.stringify(out()));
await fresh('');
type(view, '[ ] 待辦');
assert(out() === '- [ ] 待辦\n', '打「[ ] 」變成核取清單：' + JSON.stringify(out()));
await fresh('');
type(view, '- [x] 完成');
assert(out() === '- [x] 完成\n', '清單裡打「[x] 」變成已完成的項目：' + JSON.stringify(out()));
await fresh('');
type(view, '這是 **粗體** 與 *斜體* 與 `碼` 與 ==螢光== 與 ~~刪~~');
assert(out() === '這是 **粗體** 與 *斜體* 與 `碼` 與 ==螢光== 與 ~~刪~~\n', '行內格式：' + JSON.stringify(out()));
{
  const marks = new Set();
  view.pm.state.doc.descendants(n => { n.marks.forEach(m => marks.add(m.type.name)); });
  assert(['strong', 'em', 'code', 'highlight', 'strike'].every(m => marks.has(m)), '打完 **、*、`、==、~~ 變成格式：' + [...marks].join(','));
}
await fresh('');
type(view, 'x **粗**');
undo();
assert(view.pm.state.doc.textContent === 'x **粗**', '行內格式也能復原成打的字：' + view.pm.state.doc.textContent);
await fresh('');
type(view, '見 [[其他筆記|別名]] 與 [連結](https://a.b) 與 $x^2$');
{
  const names = [];
  view.pm.state.doc.descendants(n => { if (n.isInline && !n.isText) names.push(n.type.name); });
  assert(names.join(',') === 'wikilink,raw_inline' && out() === '見 [[其他筆記|別名]] 與 [連結](https://a.b) 與 $x^2$\n', '打 [[筆記|別名]]、[文字](網址)、$數學$ 變成連結與方程式：' + names.join(',') + ' ' + JSON.stringify(out()));
}
await fresh('');
type(view, '價格 $5 到 $10');
assert(out() === '價格 \\$5 到 \\$10\n', '「$5 到 $10」不會被當成數學式：' + JSON.stringify(out()));
await fresh('');
type(view, 'snake_case_name 與 2*3*4');
assert(!view.pm.state.doc.firstChild.firstChild.marks.length, '底線變數名稱不會變斜體');
await fresh('');
type(view, '```python');
press(view, 'Enter');
type(view, 'x = 1');
assert(out() === '```python\nx = 1\n```\n', '打 ```python 再按 Enter 變成程式碼區塊：' + JSON.stringify(out()));
await fresh('');
type(view, '---');
press(view, 'Enter');
type(view, '後面');
assert(out() === '---\n\n後面\n', '打 --- 再按 Enter 變成分隔線：' + JSON.stringify(out()));
await fresh('');
type(view, '| 甲 | 乙 |');
press(view, 'Enter');
assert(view.pm.state.doc.firstChild.type.name === 'table' && out().startsWith('| 甲 | 乙 |\n| --- | --- |'), '打 | 甲 | 乙 | 再按 Enter 變成表格：' + JSON.stringify(out()));
await fresh('');
type(view, '> [!tip] 小技巧');
press(view, 'Enter');
type(view, '內容');
assert(out() === '> [!tip] 小技巧\n> 內容\n', '引文裡打 [!tip] 標題再按 Enter 變成提示框：' + JSON.stringify(out()));
await fresh('```\n\n```\n');
type(view, '- **x**');
assert(out() === '```\n- **x**\n```\n', '程式碼區塊裡不套用格式：' + JSON.stringify(out()));
B.AUTO.autoformatOptions.enabled = false;
await fresh('');
type(view, '- **x**');
assert(view.pm.state.doc.firstChild.type.name === 'paragraph' && view.pm.state.doc.textContent === '- **x**', '設定關閉後不自動套用格式');
B.AUTO.autoformatOptions.enabled = true;

// ======== 同步衝突：有未存檔的修改時，磁碟上的新版本不會直接蓋掉 ========
await fresh('原本\n');
type(view, '我打的字');
view.setViewData('別的裝置改的\n', false);
assert(view.status === 'conflict' && view.pm.state.doc.textContent.includes('我打的字'), '有未存檔修改時收到新版本：顯示衝突，不會蓋掉我的修改');
view.hideConflict(); view.changed = false; view.pending = false;
await fresh('原本\n');
view.setViewData('別的裝置改的\n', false);
assert(view.pm.state.doc.textContent === '別的裝置改的' && view.status === 'saved', '沒有未存檔修改時直接載入新版本');

// ======== [[ 與 # 自動完成 ========
env.caches.set('筆記/其他筆記.md', { tags: [{ tag: '#專案/甲' }, { tag: '#專題' }], headings: [{ heading: '第一章' }, { heading: '第二章' }] });
const popup = () => document.body.querySelector('.wm-suggest');
await fresh('');
type(view, '見 [[其');
assert(popup() && popup().querySelector('.wm-suggest-item.is-selected .wm-suggest-label').textContent === '其他筆記', '打 [[ 跳出筆記選單：' + (popup() && popup().textContent));
press(view, 'Enter');
assert(!popup() && out() === '見 [[其他筆記]]\n', '按 Enter 插入筆記連結：' + JSON.stringify(out()));
await fresh('');
type(view, '[[其他筆記#第');
assert(popup() && popup().querySelectorAll('.wm-suggest-item').length === 2, '打 [[筆記# 列出該筆記的標題');
press(view, 'ArrowDown');
press(view, 'Enter');
assert(out() === '[[其他筆記#第二章]]\n', '方向鍵選第二個標題：' + JSON.stringify(out()));
await fresh('# 本頁標題\n\n內文\n');
caret(view, 1);
type(view, ' [[#本');
press(view, 'Enter');
assert(out().includes('[[#本頁標題]]'), '打 [[# 選這份筆記的標題：' + JSON.stringify(out()));
await fresh('');
type(view, '標籤 #專');
assert(popup() && popup().querySelectorAll('.wm-suggest-item').length === 2, '打 # 跳出標籤選單');
press(view, 'Enter');
assert(out() === '標籤 #專案/甲 \n', '選標籤（後面補一個空白，可以接著打字）：' + JSON.stringify(out()));
await fresh('');
type(view, '[[其');
press(view, 'Escape');
assert(!popup(), '按 Esc 關閉選單');
type(view, '他');
assert(popup(), '繼續打字會再跳出來');
press(view, 'Escape');
plugin.settings.autoComplete = false;
await fresh('');
type(view, '[[其');
assert(!popup(), '設定關閉後不跳出選單');
plugin.settings.autoComplete = true;

// ======== #標籤、^區塊參照 的顯示 ========
await fresh('文字 #標籤 與 https://a.b/#x 與 #123 及 a#b\n\n段落 ^abc123\n');
{
  const tags = [...view.pm.dom.querySelectorAll('.wm-tag')].map(x => x.getAttribute('data-tag'));
  assert(tags.join(',') === '#標籤', '只有真正的 #標籤 會標示（網址裡的 #、純數字、字中間的 # 不算）：' + tags.join(','));
  assert(view.pm.dom.querySelector('.wm-block-id') && view.pm.dom.querySelector('.wm-block-id').textContent === '^abc123', '段落結尾的 ^區塊參照 淡化顯示');
  assert(view.pm.dom.querySelector('.wm-bare-url').getAttribute('data-href') === 'https://a.b/#x', '網址照常標示');
}

{
  const tagEl = view.pm.dom.querySelector('.wm-tag');
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
  Object.defineProperty(ev, 'target', { value: tagEl });
  view.onMouseDown(ev);
  assert(app.internalPlugins.searches.pop() === 'tag:#標籤', 'Ctrl+點擊標籤：在保管庫搜尋該標籤');
  assert(view.pm.dom.getAttribute('spellcheck') === 'true', '拼字檢查跟著 Obsidian 的設定');
}

// ======== 尋找：全字相符、正規表示式 ========
await fresh('cat concat cat2 Cat\n\n2026-11-17 與 2025-01-02\n');
{
  const fb = view.findBar;
  const find = q => { fb.input.value = q; fb.input.dispatchEvent(new Event('input')); return fb.count.textContent; };
  fb.open(false);
  assert(find('cat') === '1/4', '一般尋找：包含就算（4 處）：' + fb.count.textContent);
  fb.wordBtn.click();
  assert(fb.count.textContent === '1/2', '全字相符：只剩獨立的 cat 與 Cat（2 處）：' + fb.count.textContent);
  fb.wordBtn.click();
  fb.regexBtn.click();
  assert(find('(\\d{4})-(\\d{2})-(\\d{2})') === '1/2', '正規表示式：找到 2 個日期：' + fb.count.textContent);
  fb.showReplace(true);
  fb.replInput.value = '$1/$2/$3';
  fb.replaceAll();
  assert(out().includes('2026/11/17 與 2025/01/02'), '正規表示式取代可以用 $1 $2 $3：' + JSON.stringify(out()));
  assert(find('(') === '正規表示式有誤', '寫錯的正規表示式：顯示提示，不會出錯');
  fb.regexBtn.click();
  assert(find('(') === '找不到', '關閉正規表示式後 ( 只是一般文字');
  fb.close();
}

// ======== 程式碼區塊顯示成結果（mermaid、dataview 等）========
await fresh('前面\n\n```mermaid\nflowchart TD\n    A[開始] --> B[結束]\n```\n\n```dataview\nTABLE a\n```\n\n```python\nx = 1\n```\n');
{
  const blocks = [...view.pm.dom.querySelectorAll('.wm-codeblock')];
  assert(blocks.length === 3 && blocks[0].classList.contains('has-preview') && blocks[1].classList.contains('has-preview') && !blocks[2].classList.contains('has-preview'),
    'mermaid 與其他外掛註冊的區塊（dataview）顯示成結果，一般程式碼不變');
  assert(blocks[0].querySelector('.wm-code-preview').textContent.startsWith('RENDERED:```mermaid\nflowchart TD'), '結果交給 Obsidian 顯示：' + blocks[0].querySelector('.wm-code-preview').textContent.slice(0, 40));
  assert(!blocks[0].querySelector('.wm-code-edit').hidden && blocks[1].querySelector('.wm-code-edit').hidden, 'mermaid 區塊有「編輯圖表」按鈕，其他沒有');
  assert(!blocks[0].classList.contains('wm-code-active'), '游標不在區塊裡：只顯示結果');
  blocks[0].querySelector('.wm-code-preview').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert(view.pm.dom.querySelector('.wm-codeblock').classList.contains('wm-code-active'), '按兩下結果：游標進到程式碼，顯示原始碼');
  type(view, '%% 註解\n'.replace('\n', ''));
  await sleep(450);
  assert(view.pm.dom.querySelector('.wm-code-preview').textContent.includes('%% 註解'), '修改程式碼後結果會更新');
  assert(out().includes('```mermaid\n%% 註解flowchart TD'), '存檔仍是一般的程式碼區塊：' + JSON.stringify(out().slice(0, 60)));
  plugin.settings.codePreview = false;
  await fresh('```mermaid\nflowchart TD\n    A --> B\n```\n');
  assert(!view.pm.dom.querySelector('.wm-codeblock').classList.contains('has-preview'), '設定關閉後只顯示程式碼');
  plugin.settings.codePreview = true;
}

// ======== Mermaid 圖表編輯器 ========
await fresh('前面\n\n```mermaid\nflowchart TD\n    A[開始] --> B{判斷}\n    B -->|是| C[結束]\n```\n');
{
  view.pm.dom.querySelector('.wm-code-edit').click();
  let mm = mock.Modal.last;
  const q = s => mm.contentEl.querySelector(s);
  const qa = s => [...mm.contentEl.querySelectorAll(s)];
  assert(q('.wm-mmd-visual') && qa('.wm-mmd-list')[0].querySelectorAll('.wm-mmd-row').length === 3 && qa('.wm-mmd-edge').length === 2, '流程圖以表單顯示：3 個步驟、2 條連線');
  assert(q('.wm-mmd-preview').textContent.startsWith('RENDERED:```mermaid\nflowchart TD'), '右邊有即時預覽');
  mm.close();
  assert(out().includes('    A[開始] --> B{判斷}\n    B -->|是| C[結束]'), '沒有修改就關閉：原本的程式碼一字不動');
  // 改文字、加下一步、改線上的文字
  view.pm.dom.querySelector('.wm-code-edit').click();
  mm = mock.Modal.last;
  const first = q('.wm-mmd-row input');
  first.value = '起點'; first.dispatchEvent(new Event('input'));
  qa('.wm-mmd-list')[0].querySelectorAll('.wm-mmd-row')[2].querySelectorAll('.wm-mmd-iconbtn')[0].click();
  assert(qa('.wm-mmd-list')[0].querySelectorAll('.wm-mmd-row').length === 4 && qa('.wm-mmd-edge').length === 3, '「新增下一步」：多一個步驟與一條連線');
  const lastEdge = qa('.wm-mmd-edge')[2].querySelector('input');
  lastEdge.value = '完成'; lastEdge.dispatchEvent(new Event('input'));
  const shape = qa('.wm-mmd-shape')[3];
  shape.value = 'stadium'; shape.dispatchEvent(new Event('change'));
  q('button.mod-cta').click();
  const o = out();
  assert(o.includes('A[起點]') && o.includes('N4([新步驟])') && o.includes('C -->|完成| N4') && o.includes('B -->|是| C'), '表單的修改寫回程式碼：' + JSON.stringify(o));
  assert(o.startsWith('前面\n\n```mermaid\nflowchart TD\n') && o.endsWith('```\n'), '仍是 mermaid 程式碼區塊');
  // 不支援的寫法：只能用程式碼
  await fresh('```mermaid\nsequenceDiagram\n    A->>B: hi\n```\n');
  view.pm.dom.querySelector('.wm-code-edit').click();
  mm = mock.Modal.last;
  assert(mm.tab === 'code' && mm.contentEl.querySelector('.wm-mmd-input').value.startsWith('sequenceDiagram'), '不是流程圖：直接用程式碼編輯');
  mm.setTab('visual');
  assert(mm.contentEl.querySelector('.wm-mmd-note').textContent.includes('不是流程圖'), '切到表單會說明原因');
  mm.setTab('code');
  const ta = mm.contentEl.querySelector('.wm-mmd-input');
  ta.value = 'sequenceDiagram\n    語法錯誤'; ta.dispatchEvent(new Event('input'));
  await sleep(350);
  assert(mm.contentEl.querySelector('.wm-eq-error').textContent.includes('Parse error'), '語法錯誤會顯示在預覽上方：' + mm.contentEl.querySelector('.wm-eq-error').textContent);
  mm.close();
  // 插入新的圖表
  await fresh('第一段\n');
  view.openMermaid();
  mm = mock.Modal.last;
  assert(mm.contentEl.querySelectorAll('.wm-mmd-list')[0].querySelectorAll('.wm-mmd-row').length === 2, '插入新圖表：預設是兩個步驟的流程圖');
  mm.contentEl.querySelector('button.mod-cta').click();
  assert(out() === '第一段\n\n```mermaid\nflowchart TD\n    A[開始] --> B[結束]\n```\n' || out().startsWith('第一段\n\n```mermaid\nflowchart TD\n    A[開始] --> B[結束]\n```\n'), '插入 mermaid 區塊：' + JSON.stringify(out()));
  assert(view.pm.state.selection.$from.parent.type.name === 'paragraph', '插入後游標在圖表後面（圖表顯示成結果）');
  plugin.settings.mermaidMode = 'code';
  view.openMermaid();
  assert(mock.Modal.last.tab === 'code', '設定可以讓圖表編輯器預設開在程式碼');
  mock.Modal.last.close();
  plugin.settings.mermaidMode = 'visual';
}

// ======== 內嵌：筆記、標題、影音、PDF、YouTube ========
{
  const noteMd = '---\ntags: [x]\n---\n# 第一章\n\n第一章的內容\n\n# 第二章\n\n第二章的內容\n';
  env.files.set('筆記/被嵌入.md', noteMd);
  env.caches.set('筆記/被嵌入.md', {
    frontmatterPosition: { end: { offset: noteMd.indexOf('# 第一章') } },
    headings: [
      { heading: '第一章', level: 1, position: { start: { offset: noteMd.indexOf('# 第一章') } } },
      { heading: '第二章', level: 1, position: { start: { offset: noteMd.indexOf('# 第二章') } } },
    ],
  });
  env.files.set('筆記/錄音.mp3', '');
  env.files.set('筆記/影片.mp4', '');
  env.files.set('筆記/文件.pdf', '');
  await fresh('![[被嵌入]]\n\n![[被嵌入#第一章]]\n\n![[錄音.mp3]] ![[影片.mp4]]\n\n![[文件.pdf#page=2]]\n\n![](https://www.youtube.com/watch?v=abc12345)\n\n![影片](影片.mp4)\n\n![[不存在的筆記]]\n\n[[被嵌入]]\n');
  await sleep(30);
  const embeds = [...view.pm.dom.querySelectorAll('.wm-embed')];
  assert(embeds.length === 8, '內嵌都顯示成內容區塊（8 個）：' + embeds.length);
  assert(embeds[0].querySelector('.wm-embed-body').textContent === 'RENDERED:# 第一章\n\n第一章的內容\n\n# 第二章\n\n第二章的內容\n', '內嵌整份筆記：顯示內容（不含文件屬性）：' + JSON.stringify(embeds[0].querySelector('.wm-embed-body').textContent));
  assert(embeds[1].querySelector('.wm-embed-body').textContent === 'RENDERED:# 第一章\n\n第一章的內容\n\n' && embeds[1].querySelector('.wm-embed-title').textContent === '被嵌入 › 第一章', '內嵌某個標題：只顯示那一段');
  assert(embeds[2].querySelector('audio') && embeds[2].querySelector('audio').getAttribute('src') === 'app://res/筆記/錄音.mp3', '錄音顯示成播放器');
  assert(embeds[3].querySelector('video'), '影片顯示成播放器');
  assert(embeds[4].querySelector('.wm-embed-body').textContent === 'RENDERED:![[文件.pdf#page=2]]', 'PDF 交給 Obsidian 顯示');
  assert(embeds[5].querySelector('iframe') && embeds[5].querySelector('iframe').getAttribute('src') === 'https://www.youtube.com/embed/abc12345', 'YouTube 網址顯示成影片');
  assert(embeds[6].querySelector('video'), '![](影片.mp4) 也顯示成播放器，不是破圖');
  assert(embeds[7].textContent.includes('找不到要內嵌的檔案'), '找不到的內嵌會說明');
  const link = [...view.pm.dom.querySelectorAll('.wm-wikilink')].pop();
  assert(!link.classList.contains('wm-embed') && link.textContent === '被嵌入', '一般的 [[連結]] 不受影響');
  link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  assert(app.workspace.hovers.pop() === '被嵌入', '滑鼠移到連結上：通知 Obsidian 的頁面預覽');
  assert(out().startsWith('![[被嵌入]]\n\n![[被嵌入#第一章]]\n'), '沒修改時原文不變');
}

// ======== 註腳 ========
await fresh('第一句話。\n\n第二句話。\n');
{
  caret(view, 0);
  view.insertFootnoteDialog();
  const input = mock.Modal.last.contentEl.querySelector('input');
  input.value = '出處：某本書';
  mock.Modal.last.contentEl.querySelector('button.mod-cta').click();
  assert(out() === '第一句話。[^1]\n\n第二句話。\n\n[^1]: 出處：某本書\n', '插入註腳：編號在游標處，內容放在文件最後：' + JSON.stringify(out()));
  caret(view, 1);
  view.insertFootnoteDialog();
  mock.Modal.last.contentEl.querySelector('input').value = '第二個';
  mock.Modal.last.contentEl.querySelector('button.mod-cta').click();
  assert(out() === '第一句話。[^1]\n\n第二句話。[^2]\n\n[^1]: 出處：某本書\n\n[^2]: 第二個\n', '第二個註腳自動編號，接在前一個後面：' + JSON.stringify(out()));
  const ref = view.pm.dom.querySelector('.wm-raw-inline.is-footnote');
  ref.dispatchEvent(new MouseEvent('mouseenter'));
  assert(ref.textContent === '[1]' && ref.getAttribute('aria-label').includes('出處：某本書'), '滑鼠移到編號上顯示註腳內容');
  const defs = [...view.pm.dom.querySelectorAll('.wm-raw-block[data-kind="footnote"]')];
  assert(defs.length === 2 && defs[0].querySelector('.wm-raw-label').textContent.startsWith('註腳 1') && defs[0].querySelector('.wm-raw-body').textContent === 'RENDERED:出處：某本書', '註腳內容顯示成註腳區塊');
  view.editFootnote('1');
  const ta = mock.Modal.last.contentEl.querySelector('textarea');
  assert(ta.value === '出處：某本書', '編輯註腳：只編輯內容，不用管 [^1]: 的寫法');
  ta.value = '改過的出處\n第二行';
  mock.Modal.last.contentEl.querySelector('button.mod-cta').click();
  assert(out().includes('[^1]: 改過的出處\n    第二行\n'), '多行的註腳內容會自動縮排：' + JSON.stringify(out()));
  view.gotoFootnote('2');
  assert(view.pm.state.selection.node && view.pm.state.selection.node.attrs.src.startsWith('[^2]:'), '跳到註腳內容');
  view.onContextMenu({ clientX: 0, clientY: 0, target: ref, preventDefault() {} });
  const items = mock.Menu.last.items;
  assert(items.some(i => i.title === '跳到註腳內容') && items.some(i => i.title === '刪除註腳（含內容）'), '註腳的右鍵選單');
  items.find(i => i.title === '刪除註腳（含內容）').fn();
  assert(out() === '第一句話。\n\n第二句話。[^2]\n\n[^2]: 第二個\n', '刪除註腳：編號與內容一起刪：' + JSON.stringify(out()));
  await fresh('有行內註腳^[這是內容] 與沒有定義的[^x]\n');
  const inl = view.pm.dom.querySelector('.is-footnote-inline');
  assert(inl && inl.getAttribute('aria-label').includes('這是內容'), '行內註腳 ^[內容] 顯示成註腳記號');
  const missing = [...view.pm.dom.querySelectorAll('.wm-raw-inline.is-footnote')].pop();
  assert(missing.classList.contains('is-missing'), '找不到內容的註腳會標示出來');
}

// ======== 方程式：視覺化編輯 ========
await fresh('面積公式：\n');
{
  const typeIn = (span, text) => { span.focus(); span.textContent = text; span.dispatchEvent(new Event('input', { bubbles: true })); };
  const keyOn = (span, key) => { span.focus(); span.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); };
  view.openEquation();
  let eq = mock.Modal.last;
  await sleep(25);
  const q = s => eq.contentEl.querySelector(s);
  const qa = s => [...eq.contentEl.querySelectorAll(s)];
  const snippet = s => qa('.wm-eq-btn').find(b => b.getAttribute('aria-label') === s);
  assert(eq.editMode === 'visual' && q('.wm-mv') && q('.wm-eq-input').style.display === 'none', '方程式編輯器預設開在視覺化模式');
  snippet('\\frac{}{}').click();
  assert(q('.wm-mv-frac') && q('.wm-mv-num .wm-mv-text').classList.contains('is-slot'), '按「分數」：出現上下兩格');
  typeIn(q('.wm-mv-num .wm-mv-text'), 'a');
  typeIn(q('.wm-mv-den .wm-mv-text'), 'b');
  assert(eq.ta.value === '\\frac{a}{b}', '在兩格裡打字：LaTeX 是 \\frac{a}{b}：' + eq.ta.value);
  const last = qa('.wm-mv-text').pop();
  keyOn(last, '^');
  assert(q('.wm-mv-sup'), '按 ^：開一個上標的格子');
  typeIn(q('.wm-mv-sup .wm-mv-text'), '2');
  assert(eq.ta.value === '\\frac{a}{b}^{2}', '上標：' + eq.ta.value);
  qa('.wm-eq-cat').find(b => b.textContent === '希臘字母').click();
  const tail = qa('.wm-mv-row')[0].lastElementChild;
  tail.dispatchEvent(new Event('focus')); // jsdom 的 focus() 不會對可編輯的 span 發出 focus 事件
  snippet('\\alpha').click();
  assert(eq.ta.value === '\\frac{a}{b}^{2}\\alpha' && qa('.wm-mv-text').pop().textContent === 'α', '按符號按鈕：顯示成 α，LaTeX 是 \\alpha：' + eq.ta.value);
  typeIn(qa('.wm-mv-text').pop(), 'α+sin x');
  assert(eq.ta.value === '\\frac{a}{b}^{2}\\alpha+\\sin x', '直接打字：sin 變成 \\sin：' + eq.ta.value);
  q('button.mod-cta').click();
  assert(out() === '面積公式：$\\frac{a}{b}^{2}\\alpha+\\sin x$\n', '套用後存成 LaTeX：' + JSON.stringify(out()));

  // 既有的方程式：沒有在格子裡改東西就不會動到原本的寫法
  await fresh('公式 $x^2 + \\sqrt{y}$ 結束\n');
  const math = view.pm.dom.querySelector('.wm-raw-inline.is-math');
  math.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  eq = mock.Modal.last;
  await sleep(25);
  assert(eq.contentEl.querySelector('.wm-mv-sup') && eq.contentEl.querySelector('.wm-mv-sqrt'), '既有的方程式拆成上標與根號的格子');
  eq.contentEl.querySelector('button.mod-cta').click();
  assert(out() === '公式 $x^2 + \\sqrt{y}$ 結束\n', '沒有修改：原本的 LaTeX 一字不動：' + JSON.stringify(out()));
  math.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  eq = mock.Modal.last;
  await sleep(25);
  // 在根號後面那一格的開頭按 Backspace：刪掉根號
  const spans = [...eq.contentEl.querySelectorAll('.wm-mv > .wm-mv-row > .wm-mv-text')];
  const afterSqrt = spans[spans.length - 1];
  eq.field.place(afterSqrt, 0);
  keyOn(afterSqrt, 'Backspace');
  assert(!eq.contentEl.querySelector('.wm-mv-sqrt') && eq.ta.value === 'x^{2} +', '格子開頭按 Backspace：刪掉前面的根號：' + JSON.stringify(eq.ta.value));
  eq.setEdit('latex');
  assert(eq.ta.style.display !== 'none' && eq.contentEl.querySelector('.wm-eq-visual').style.display === 'none', '可以切到 LaTeX 模式');
  eq.ta.value = '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}';
  eq.setEdit('visual');
  assert(eq.contentEl.querySelectorAll('.wm-mv-cell').length === 4, '切回視覺化：矩陣顯示成 2×2 的格子');
  eq.contentEl.querySelector('.wm-mv-env-btn').click();
  assert(eq.contentEl.querySelectorAll('.wm-mv-cell').length === 6 && eq.ta.value.includes('3 & 4 \\\\  & '), '矩陣可以加一列：' + eq.ta.value);
  eq.close();
  plugin.settings.mathMode = 'latex';
  view.openEquation();
  await sleep(25);
  assert(mock.Modal.last.editMode === 'latex', '設定可以讓方程式編輯器預設開在 LaTeX 模式');
  mock.Modal.last.close();
  delete plugin.settings.mathMode;
}

// ======== 可摺疊的提示框、任務狀態、核心外掛的範本 ========
await fresh('> [!note]- 預設收合\n> 內容\n\n> [!tip] 一般\n> 內容\n');
{
  const cs = [...view.pm.dom.querySelectorAll('.wm-callout')];
  assert(cs[0].classList.contains('is-collapsed') && !cs[0].querySelector('.callout-fold').hidden, '[!note]- 預設收合，有摺疊箭頭');
  assert(!cs[1].classList.contains('is-collapsed') && cs[1].querySelector('.callout-fold').hidden, '一般的提示框沒有摺疊箭頭');
  cs[0].querySelector('.callout-fold').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert(!view.pm.dom.querySelector('.wm-callout').classList.contains('is-collapsed') && out() === '> [!note]- 預設收合\n> 內容\n\n> [!tip] 一般\n> 內容\n', '點箭頭展開：只影響畫面，檔案不變');
  cs[1].querySelector('.callout-icon').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  mock.Menu.last.items.find(i => i.title === '可摺疊，預設展開').fn();
  assert(out().includes('> [!tip]+ 一般'), '可以把提示框設成可摺疊：' + JSON.stringify(out()));

  await fresh('- [ ] 寫報告\n- [x] 開會\n');
  const cb = view.pm.dom.querySelector('input.task-list-item-checkbox');
  cb.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert(mock.Menu.last.items.length === 7, '核取方塊按右鍵：列出任務狀態');
  mock.Menu.last.items.find(i => i.title.startsWith('進行中')).fn();
  assert(out() === '- [/] 寫報告\n- [x] 開會\n' && view.pm.dom.querySelector('li.wm-task').getAttribute('data-task') === '/', '選「進行中」：存成 - [/]，並加上 data-task 給佈景主題：' + JSON.stringify(out()));
  view.pm.dom.querySelector('input.task-list-item-checkbox').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert(out() === '- [ ] 寫報告\n- [x] 開會\n', '自訂狀態點一下回到未完成');

  env.files.set('範本/會議.md', '---\ntags: [範本]\n---\n## {{title}} 的會議\n\n日期：{{date:YYYY}}\n');
  env.templatesFolder = '範本';
  await fresh('開頭\n');
  view.openTemplatePicker();
  const picker = mock.FuzzySuggestModal.last;
  assert(picker.getItems().length === 1, '沒有 Templater 時，改用核心外掛「範本」的資料夾');
  picker.onChooseItem(picker.getItems()[0]);
  await sleep(20);
  // 測試環境沒有 moment，日期用系統語系的寫法（各地不同），所以只確認有換成內容
  assert(/^開頭\n\n## 測試 的會議\n\n日期：[^{\s]|^開頭## 測試/.test(out()) && !out().includes('{{') && !out().includes('tags'), '插入範本：{{title}}、{{date}} 會換成內容，範本的屬性不插入：' + JSON.stringify(out()));
}

// ======== 編輯器還沒載入時，工具列與尋找列的動作不應該出錯 ========
// 開啟分頁到筆記載入完成之間，以及筆記解析失敗時，view.pm 是 null，但工具列已經可以按。
{
  const { view } = await makeEnv();
  assert(view.pm == null, '還沒開啟筆記時沒有編輯器');
  const btn = document.createElement('button');
  document.body.appendChild(btn);
  const d = view.toolbar.ctx.dialogs;
  const tb = view.toolbar;
  const fb = view.findBar;
  const actions = {
    find: () => d.find(), replace: () => d.replace(), paste: () => d.paste('text'), clip: () => d.clip('copy'),
    toggleMarks: () => d.toggleMarks(), image: () => d.image(btn), equation: () => d.equation(), mermaid: () => d.mermaid(),
    link: () => d.link(), noteLink: () => d.noteLink(), footnote: () => d.footnote(), callout: () => d.callout(btn),
    comment: () => d.comment(), template: () => d.template && d.template(), properties: () => d.properties(),
    cleanup: () => d.cleanup(), wordCount: () => d.wordCount(), outline: () => d.outline(btn), foldAll: () => d.foldAll(true),
    scrollTo: () => d.scrollTo(1),
    sort: () => tb.sortCmd(1), stylePopup: () => tb.openStylePopup(btn), tablePopup: () => tb.openTablePopup(btn),
    findStep: () => fb.step(1), findReveal: () => fb.reveal(), findReplaceOne: () => fb.replaceOne(), findReplaceAll: () => fb.replaceAll(),
    findCase: () => fb.caseBtn.click(), findWord: () => fb.wordBtn.click(), findRegex: () => fb.regexBtn.click(),
  };
  const failed = [];
  for (const [name, run] of Object.entries(actions)) {
    try { await run(); } catch (e) { failed.push(name + '（' + e.message + '）'); }
  }
  assert(failed.length === 0, '編輯器還沒載入時按工具列與尋找列不會出錯' + (failed.length ? '：' + failed.join('、') : ''));
  btn.remove();
}

// ======== 文件屬性：連結、標籤、換類型、改名、收合時的摘要 ========
await fresh('---\ntags:\n  - 會議\nrelated:\n  - [[其他筆記]]\n  - https://example.com/a\nsite: https://example.com\ncount: 3\n---\n內文\n');
{
  const q = sel => [...view.pm.dom.querySelectorAll(sel)];
  const down = el => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert(q('.wm-chip-tag .wm-chip-text').map(e => e.textContent).join() === '#會議', '標籤顯示成 #標籤：' + q('.wm-chip-tag .wm-chip-text').map(e => e.textContent).join());
  const links = q('.wm-chip-link .wm-chip-text');
  assert(links.length === 2 && links[0].textContent === '其他筆記' && links[1].textContent === 'example.com/a', '清單裡的 [[筆記]] 與網址顯示成連結：' + links.map(e => e.textContent).join());
  const before = app.workspace.opened.length;
  down(links[0]);
  assert(app.workspace.opened.length === before + 1 && String(app.workspace.opened[before]).includes('其他筆記'), '點一下屬性裡的筆記連結會開啟：' + app.workspace.opened.slice(before).join());
  assert(out().includes('  - [[其他筆記]]\n'), '點連結不會改到內容');
  assert(q('.wm-prop-open').length === 1, '文字屬性的值是網址時，旁邊有開啟按鈕');
  // 換類型：文字 → 清單
  const rowOf = name => q('.wm-prop').find(r => r.querySelector('.wm-prop-name') && r.querySelector('.wm-prop-name').textContent === name);
  down(rowOf('site').querySelector('.wm-prop-icon'));
  let items = mock.Menu.last.items;
  assert(items.length === 7 && items.some(i => i.title.includes('✓') && i.title.includes('文字')), '類型選單：六種類型（目前的打勾）＋重新命名：' + items.map(i => i.title).join('|'));
  items.find(i => i.title.startsWith('清單')).fn();
  assert(out().includes('site:\n  - https://example.com\n'), '文字換成清單，內容保留：' + JSON.stringify(out()));
  // 換類型：數字 → 核取方塊
  down(rowOf('count').querySelector('.wm-prop-icon'));
  mock.Menu.last.items.find(i => i.title.startsWith('核取方塊')).fn();
  assert(out().includes('count: true\n'), '數字換成核取方塊：' + JSON.stringify(out()));
  // 改名：位置不變
  down(rowOf('related').querySelector('.wm-prop-icon'));
  items = mock.Menu.last.items;
  items[items.length - 1].fn();
  const pm1 = mock.Modal.last;
  pm1.contentEl.querySelector('input').value = '相關';
  pm1.contentEl.querySelector('button.mod-cta').click();
  assert(/^---\ntags:\n {2}- 會議\n相關:\n {2}- \[\[其他筆記\]\]/.test(out()), '重新命名屬性，位置不變：' + JSON.stringify(out()));
  // 改成已經有的名稱：不變
  down(rowOf('相關').querySelector('.wm-prop-icon'));
  items = mock.Menu.last.items;
  items[items.length - 1].fn();
  const pm2 = mock.Modal.last;
  const same = out();
  pm2.contentEl.querySelector('input').value = 'tags';
  pm2.contentEl.querySelector('button.mod-cta').click();
  assert(out() === same, '改成已經存在的名稱時不動');
  // 收合：標題列顯示摘要
  down(view.pm.dom.querySelector('.wm-props-head'));
  const sum = view.pm.dom.querySelector('.wm-props-count').textContent;
  assert(view.pm.dom.querySelector('.wm-props').classList.contains('is-collapsed') && sum.includes('tags: 會議') && !view.pm.dom.querySelector('.wm-prop'), '收合時標題列顯示內容摘要：' + sum);
  down(view.pm.dom.querySelector('.wm-props-head'));
  assert(/^\d+ 個屬性$/.test(view.pm.dom.querySelector('.wm-props-count').textContent), '展開時顯示屬性數量：' + view.pm.dom.querySelector('.wm-props-count').textContent);
}

// ======== 程式碼區塊的行號 ========
{
  await fresh('```python\nx = 0\n```\n');
  let block = view.pm.dom.querySelector('.wm-codeblock');
  assert(!block.classList.contains('has-lines') && block.querySelector('.wm-code-gutter').textContent === '', '預設不顯示行號');
  plugin.settings.codeLineNumbers = true;
  await fresh('```python\na = 1\nb = 2\nc = 3\n```\n\n後面\n');
  block = view.pm.dom.querySelector('.wm-codeblock');
  assert(block.classList.contains('has-lines') && block.querySelector('.wm-code-gutter').textContent === '1\n2\n3', '開啟設定後顯示行號：' + JSON.stringify(block.querySelector('.wm-code-gutter').textContent));
  const st = view.pm.state;
  view.pm.dispatch(st.tr.insertText('\nd = 4', st.doc.firstChild.nodeSize - 1));
  assert(view.pm.dom.querySelector('.wm-code-gutter').textContent === '1\n2\n3\n4', '加一行後行號跟著增加：' + JSON.stringify(view.pm.dom.querySelector('.wm-code-gutter').textContent));
  assert(out() === '```python\na = 1\nb = 2\nc = 3\nd = 4\n```\n\n後面\n', '行號不會寫進檔案：' + JSON.stringify(out()));
  plugin.settings.codeLineNumbers = false;
}

// ======== 表格：搬移列與欄 ========
{
  const cellAt = text => { let p = -1; view.pm.state.doc.descendants((n, pos) => { if (p < 0 && n.isText && n.text === text) p = pos; }); return p; };
  const put = text => { const p = cellAt(text); view.pm.dispatch(view.pm.state.tr.setSelection(TextSelection.create(view.pm.state.doc, p + 1))); };
  const run = c => c(view.pm.state, tr => view.pm.dispatch(tr), view.pm);
  await fresh('| 甲 | 乙 | 丙 |\n| :--- | :---: | ---: |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n');
  put('b1');
  assert(run(B.C.moveTableColumn(1)), '欄右移：可以執行');
  assert(out() === '| 甲 | 丙 | 乙 |\n| :--- | ---: | :---: |\n| a1 | c1 | b1 |\n| a2 | c2 | b2 |\n', '欄右移：整欄（含標題與對齊）一起搬：' + JSON.stringify(out()));
  assert(view.pm.state.selection.$from.parent.textContent === 'b1' && view.pm.state.selection.$from.parentOffset === 1, '欄右移後游標還在同一格、同一個位置');
  assert(!run(B.C.moveTableColumn(1)), '已經在最右邊：不能再右移');
  run(B.C.moveTableColumn(-1)); run(B.C.moveTableColumn(-1));
  assert(out() === '| 乙 | 甲 | 丙 |\n| :---: | :--- | ---: |\n| b1 | a1 | c1 |\n| b2 | a2 | c2 |\n', '欄左移兩次：' + JSON.stringify(out()));
  assert(!run(B.C.moveTableColumn(-1)), '已經在最左邊：不能再左移');
  undo(); undo(); undo();
  assert(out() === '| 甲 | 乙 | 丙 |\n| :--- | :---: | ---: |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n', '搬移欄可以復原：' + JSON.stringify(out()));
  // 列：標題列固定在最上面
  put('a1');
  assert(!run(B.C.moveBlock(-1)), '第一列資料不能搬到標題列上面');
  assert(run(B.C.moveBlock(1)) && out().endsWith('| a2 | b2 | c2 |\n| a1 | b1 | c1 |\n'), '列下移：' + JSON.stringify(out()));
  put('甲');
  assert(!run(B.C.moveBlock(1)), '標題列不能往下搬');
  const first = view.pm.state.doc.firstChild.firstChild;
  assert(first.firstChild.type.name === 'table_header' && first.textContent === '甲乙丙', '標題列還是標題列');
}

//@@MORE@@

finish();
