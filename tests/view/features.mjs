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
view.clear();

// ======== 同步衝突：照 Obsidian 真正的順序 ========
// 檔案在外面被改時，Obsidian 的 TextFileView 會先呼叫 getViewData() 拿目前的內容去合併，再把結果交給
// setViewData()。所以「有沒有還沒存檔的修改」不能靠 getViewData() 有沒有被呼叫來判斷
{
  const PATH = '筆記/測試.md';
  const BASE = '第一段\n\n第二段\n', THEIRS = '第一段\n\n第二段（別台電腦改的）\n';
  const disk = () => env.files.get(PATH);
  const text = () => view.pm.state.doc.textContent;
  const copies = () => [...env.files.keys()].filter(k => k.includes('我的版本'));
  const banner = label => [...view.bannerHost.querySelectorAll('button')].find(b => b.textContent === label);
  // 打字（還沒到自動存檔的時間），這時檔案被同步改掉
  const editThenSync = async () => {
    await fresh(BASE); type(view, '我打的字');
    env.files.set(PATH, THEIRS);
    await view.onModify(view.file); await sleep(5);
  };

  await editThenSync();
  assert(view.conflict && banner('載入新版本') && view.status === 'conflict' && text().includes('我打的字'), '打字後檔案被同步改掉：跳出衝突選擇，我的修改還在畫面上');
  await view.save();
  assert(disk() === THEIRS, '衝突還沒解決：自動存檔不會蓋掉同步進來的版本');
  banner('載入新版本').click(); await sleep(10);
  assert(!view.conflict && view.getViewData() === THEIRS && !text().includes('我打的字') && disk() === THEIRS, '選「載入新版本」：畫面是磁碟上的版本（不是合併過的）：' + JSON.stringify(view.getViewData()));
  assert(view.status === 'saved', '載入新版本之後狀態是已儲存：' + view.status);

  await editThenSync();
  banner('保留我的版本').click(); await sleep(10);
  assert(!view.conflict && disk().includes('我打的字') && !disk().includes('別台電腦改的') && view.status === 'saved', '選「保留我的版本」：用我的版本存檔：' + JSON.stringify(disk()));

  // 橫幅還在就關掉分頁：原檔要留給同步進來的版本，我的版本另存
  await editThenSync();
  let before = copies().length;
  await view.onUnloadFile(view.file);
  assert(disk() === THEIRS, '衝突沒解決就關閉：原檔還是同步進來的版本：' + JSON.stringify(disk()));
  assert(copies().length === before + 1 && env.files.get(copies().pop()).includes('我打的字'), '衝突沒解決就關閉：我的版本另存成副本');
  assert(!plugin.history.has(PATH), '衝突沒解決就關閉：不記住編輯狀態（下次開啟要看到磁碟上的版本）');

  // 連按兩下「兩份都保留」只另存一份
  await editThenSync();
  before = copies().length;
  const both = banner('兩份都保留'); both.click(); both.click(); await sleep(20);
  assert(copies().length === before + 1 && !view.conflict && view.getViewData() === THEIRS, '連按兩下「兩份都保留」：只另存一份，畫面是新版本');

  // 設定為「自動兩份都保留」
  plugin.settings.conflict = 'both';
  await editThenSync(); await sleep(20);
  assert(!view.conflict && view.getViewData() === THEIRS && disk() === THEIRS, '自動兩份都保留：畫面與原檔都是新版本');
  assert(env.files.get(copies().pop()).includes('我打的字'), '自動兩份都保留：我的版本另存成副本');
  plugin.settings.conflict = 'ask';

  // 存檔失敗（檔案被鎖）：狀態不能停在「儲存中」，之後檔案被改也不能悄悄蓋掉沒存到的修改
  await fresh(BASE); type(view, '我打的字');
  const modify = app.vault.modify;
  app.vault.modify = async () => { throw new Error('EBUSY'); };
  let threw = false;
  try { await view.save(); } catch { threw = true; }
  app.vault.modify = modify;
  assert(threw && view.status === 'dirty', '存檔失敗：狀態回到編輯中（不是停在儲存中）：' + view.status);
  env.files.set(PATH, THEIRS);
  await view.onModify(view.file); await sleep(5);
  assert(view.conflict && text().includes('我打的字'), '存檔失敗之後檔案被改：跳出衝突選擇，不會悄悄蓋掉');
  view.clear();

  // 已經存好之後檔案才被改：直接載入，不用問
  await fresh(BASE); type(view, '我打的字');
  await view.save();
  assert(view.status === 'saved' && disk().includes('我打的字'), '存檔成功');
  env.files.set(PATH, THEIRS);
  await view.onModify(view.file); await sleep(5);
  assert(!view.conflict && view.getViewData() === THEIRS, '已經存好之後檔案被改：直接載入新版本');

  // 同一份文件輸出過就不再重新轉換（Obsidian 存檔與合併時會連續呼叫 getViewData()）
  await fresh(BASE); type(view, '字');
  const conv = plugin.converter; const serialize = conv.serialize; let calls = 0;
  conv.serialize = (...a) => { calls++; return serialize.apply(conv, a); };
  view.getViewData(); view.getViewData(); view.getViewData();
  conv.serialize = serialize;
  assert(calls === 1, '文件沒變時，連續呼叫 getViewData() 只轉換一次：' + calls);
  await view.save();
}
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
  // 輸入法選字時按的 Enter 是「確定選這個字」，不能當成「找下一個」
  fb.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
  assert(fb.count.textContent === '1/4', '輸入法選字中的 Enter 不會跳到下一個：' + fb.count.textContent);
  fb.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert(fb.count.textContent === '2/4', '一般的 Enter 跳到下一個：' + fb.count.textContent);
  fb.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  fb.wordBtn.click();
  assert(fb.count.textContent === '1/2', '全字相符：只剩獨立的 cat 與 Cat（2 處）：' + fb.count.textContent);
  fb.wordBtn.click();
  fb.regexBtn.click();
  assert(find('(\\d{4})-(\\d{2})-(\\d{2})') === '1/2', '正規表示式：找到 2 個日期：' + fb.count.textContent);
  fb.showReplace(true);
  fb.replInput.value = '$1/$2/$3';
  fb.replaceAll();
  assert(out().includes('2026/11/17 與 2025/01/02'), '正規表示式取代可以用 $1 $2 $3：' + JSON.stringify(out()));
  // 看前後文的寫法：只拿找到的那幾個字重新比對會比對不到，「取代」了卻什麼都沒變
  assert(find('cat(?=2)') === '1/1', '正規表示式：後面要接 2 的 cat（1 處）：' + fb.count.textContent);
  fb.replInput.value = 'dog';
  fb.replaceAll();
  assert(out().startsWith('cat concat dog2 Cat'), '用到 (?=…) 的正規表示式也取代得到：' + JSON.stringify(out()));
  assert(find('\\Bcat') === '1/1', '正規表示式：不在字首的 cat（concat 裡的那個）：' + fb.count.textContent);
  fb.replInput.value = '[$&]';
  fb.replaceOne();
  const shown = () => view.pm.state.doc.firstChild.textContent;
  assert(shown() === 'cat con[cat] dog2 Cat', '用到 \\B 的正規表示式取代正確的那一處，$& 是找到的文字：' + JSON.stringify(shown()));
  assert(find('(c)(o)(n)') === '1/1', '正規表示式：三個括號：' + fb.count.textContent);
  fb.replInput.value = '$3$2$1$$$10';
  fb.replaceAll();
  assert(shown() === 'cat noc$c0[cat] dog2 Cat', '$$ 是錢字號；$10 沒有第 10 組時是第 1 組加上 0：' + JSON.stringify(shown()));
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
  const shape = qa('.wm-mmd-f-shape')[3];
  shape.value = 'stadium'; shape.dispatchEvent(new Event('change'));
  q('button.mod-cta').click();
  const o = out();
  assert(o.includes('A[起點]') && o.includes('N4([新步驟])') && o.includes('C -->|完成| N4') && o.includes('B -->|是| C'), '表單的修改寫回程式碼：' + JSON.stringify(o));
  assert(o.startsWith('前面\n\n```mermaid\nflowchart TD\n') && o.endsWith('```\n'), '仍是 mermaid 程式碼區塊');
  // 不支援的寫法：只能用程式碼
  await fresh('```mermaid\nsequenceDiagram\n    loop 每天\n    A->>B: hi\n    end\n```\n');
  view.pm.dom.querySelector('.wm-code-edit').click();
  mm = mock.Modal.last;
  assert(mm.tab === 'code' && mm.contentEl.querySelector('.wm-mmd-input').value.startsWith('sequenceDiagram'), '用了表單不支援的寫法（loop）：直接用程式碼編輯');
  mm.setTab('visual');
  assert(mm.contentEl.querySelector('.wm-mmd-note').textContent.includes('表單不支援的區塊'), '切到表單會說明原因：' + mm.contentEl.querySelector('.wm-mmd-note').textContent);
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

  // 上下標的版面：a_i^2 疊成一組；接在向量、括號後面的上下標跟那個結構包在一起；向量箭頭要佔高度
  await fresh('式 $a_i^2+\\vec{v}_1+\\left(x\\right)^2$ 完\n');
  view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  eq = mock.Modal.last;
  await sleep(25);
  const pair = eq.contentEl.querySelector('.wm-mv-scripts.is-pair');
  assert(pair && pair.querySelector(':scope > .wm-mv-sub') && pair.querySelector(':scope > .wm-mv-sup'), 'a_i^2：下標與上標疊成同一組');
  const attached = [...eq.contentEl.querySelectorAll('.wm-mv-attach')];
  assert(attached.length === 2 && attached[0].matches('.has-accent') && attached[0].querySelector(':scope > .wm-mv-group.has-accent > .wm-mv-inner')
    && attached[1].querySelector(':scope > .wm-mv-paren') && attached.every(a => a.querySelector(':scope > .wm-mv-scripts')), '接在向量、括號後面的上下標：跟前面的結構包在一起');
  // 只改畫面：格子的順序（游標移動的順序）跟模型一樣，沒有修改就交回原本的 LaTeX
  const cells = [...eq.contentEl.querySelectorAll('.wm-mv-text')].map(s => s.textContent).filter(Boolean).join(',');
  assert(cells === 'a,i,2,+,v,1,+,x,2', '格子的順序不變：' + cells);
  eq.contentEl.querySelector('button.mod-cta').click();
  assert(out() === '式 $a_i^2+\\vec{v}_1+\\left(x\\right)^2$ 完\n', '只改畫面，LaTeX 一字不動：' + JSON.stringify(out()));

  // 字上的符號畫成 SVG（不是疊上去的「→」「~」字元）；沒有上伸筆畫的小寫字母，符號放低（is-low）；打字後重新判斷
  await fresh('式 $\\vec{v}+\\tilde{N}+\\bar{x}$ 完\n');
  view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  eq = mock.Modal.last;
  await sleep(25);
  const accentOf = cmd => eq.contentEl.querySelector(`.wm-mv-group.has-accent[data-cmd="${cmd}"]`);
  const vec = accentOf('vec'), tilde = accentOf('tilde'), bar = accentOf('bar');
  assert(vec && vec.querySelector('.wm-mv-accent svg line') && vec.querySelector('.wm-mv-accent svg polyline') && !vec.querySelector('.wm-mv-accent').textContent, '向量：箭頭與線是同一個 SVG');
  assert(tilde && tilde.querySelector('.wm-mv-accent svg path') && bar && bar.querySelector('.wm-mv-accent svg line'), '~ 與上橫線也是 SVG');
  assert(vec.classList.contains('is-low') && !tilde.classList.contains('is-low') && bar.classList.contains('is-low'), '小寫 v、x 的符號放低，大寫 N 不放低');
  typeIn(tilde.querySelector('.wm-mv-text'), 'n');
  assert(tilde.classList.contains('is-low') && eq.ta.value.includes('\\tilde{n}'), '把 N 改成 n：符號跟著放低：' + eq.ta.value);

  // 上括號、下括號：以前格子裡照原文顯示「\overbrace」，標籤變成右上角的上標；現在畫出橫的大括號，標籤在括號外面一格
  await fresh('式 $\\overbrace{a+b}^{n}$ 完\n');
  view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  eq = mock.Modal.last;
  await sleep(25);
  const over = q('.wm-mv-hbrace.is-over');
  assert(over && over.querySelector(':scope > .wm-mv-hb-body > .wm-mv-hbmark svg path') && over.querySelector(':scope > .wm-mv-hb-label').textContent === 'n'
    && !q('.wm-mv').textContent.includes('\\overbrace') && !q('.wm-mv-sup'), '上括號：畫出括號，標籤在另一格，不顯示指令原文');
  const braceCells = qa('.wm-mv-text').map(s => s.textContent).filter(Boolean).join(',');
  assert(braceCells === 'a+b,n', '格子的順序：先內容、再標籤：' + braceCells);
  typeIn(over.querySelector('.wm-mv-hb-label .wm-mv-text'), 'm');
  assert(eq.ta.value === '\\overbrace{a+b}^{m}', '改標籤：' + eq.ta.value);
  // 打 \underbrace 再按空白：變成下括號（內容、標籤兩個空格子）
  // 游標要在打的字後面才認得「\指令 」（同 ui.mjs 的 typeIn）
  const braceTail = qa('.wm-mv-text').pop();
  braceTail.textContent = '+\\underbrace ';
  eq.field.place(braceTail, braceTail.textContent.length);
  braceTail.dispatchEvent(new Event('input', { bubbles: true }));
  assert(q('.wm-mv-hbrace.is-under .wm-mv-hb-body .wm-mv-text.is-slot') && q('.wm-mv-hbrace.is-under .wm-mv-hb-label .wm-mv-text.is-slot'), '打 \\underbrace 再按空白：出現下括號的兩格');
  typeIn(q('.wm-mv-hbrace.is-under .wm-mv-hb-body .wm-mv-text'), '1+1');
  typeIn(q('.wm-mv-hbrace.is-under .wm-mv-hb-label .wm-mv-text'), 'k');
  assert(eq.ta.value === '\\overbrace{a+b}^{m}+\\underbrace{1+1}_{k}', '下括號：' + eq.ta.value);
  // 空心字、花體：框線與標記（CSS 依 data-cmd 畫框）；功能區的按鈕顯示範例字，不是一個方框
  qa('.wm-eq-cat').find(b => b.textContent === '標記').click();
  snippet('\\mathbb{}').click();
  const bb = q('.wm-mv-group[data-cmd="mathbb"]');
  assert(bb && bb.querySelector(':scope > .wm-mv-tag').textContent === 'ℍ' && bb.querySelector('.wm-mv-text.is-slot'), '空心字：有標記與空格子');
  const demoOf = s => snippet(s).querySelector('.wm-eq-btn-math').textContent;
  assert(demoOf('\\mathbb{}') === '\\mathbb{ABC}' && demoOf('\\mathcal{}') === '\\mathcal{ABC}' && demoOf('\\mathbf{}') === '\\mathbf{abc}' && demoOf('\\overbrace{}^{}') === '\\overbrace{\\square}^{\\square}',
    '按鈕的示意圖：字型類放範例字：' + demoOf('\\mathbb{}'));
  eq.close();

  // 連按「上括號」「下括號」：第二個插在第一個的內容格裡。兩個括號排在同一個格線裡（is-stack），都貼著內容；
  // 以前外面的括號被裡面那個留的空白推開，離內容很遠，還多包住前後的空格子，看起來比裡面的寬
  await fresh('疊在一起：\n');
  view.openEquation();
  eq = mock.Modal.last;
  await sleep(25);
  qa('.wm-eq-cat').find(b => b.textContent === '標記').click();
  snippet('\\overbrace{}^{}').click();
  snippet('\\underbrace{}_{}').click();
  const stack = q('.wm-mv-hbrace.is-stack.is-inner-under');
  assert(stack && stack.querySelector(':scope > .wm-mv-hbmark.is-outer.is-over') && stack.querySelector(':scope > .wm-mv-hb-body > .wm-mv-hbmark.is-under')
    && stack.querySelector(':scope > .wm-mv-hb-label.is-outer.is-over') && stack.querySelector(':scope > .wm-mv-hb-label.is-under:not(.is-outer)')
    && !q('.wm-mv-hbrace:not(.is-stack)'), '上括號裡是下括號：疊在一起排，裡面的括號畫在它的內容旁邊');
  typeIn(stack.querySelector('.wm-mv-hb-body .wm-mv-text'), 'x');
  typeIn(stack.querySelector('.wm-mv-hb-label.is-under .wm-mv-text'), 'k');
  typeIn(stack.querySelector('.wm-mv-hb-label.is-over .wm-mv-text'), 'n');
  assert(eq.ta.value === '\\overbrace{\\underbrace{x}_{k}}^{n}', '疊在一起的括號：LaTeX 照巢狀寫：' + eq.ta.value);
  // 格子的順序（Tab）跟模型一樣：前面的內容、裡面的括號的內容與標籤、後面的內容、外面的標籤
  const stackCells = qa('.wm-mv-hbrace.is-stack .wm-mv-text').map(s => s.closest('.wm-mv-hb-edge, .wm-mv-hb-body, .wm-mv-hb-label').className.replace('wm-mv-', '')).join(',');
  assert(stackCells === 'row wm-mv-hb-edge is-lead,hb-body,hb-label is-under,row wm-mv-hb-edge is-trail,hb-label is-outer is-over', '格子的順序：' + stackCells);
  // 在內容前面打字：還是疊在一起排（外面的括號連這些字一起包住，由 CSS 排）
  typeIn(stack.querySelector('.wm-mv-hb-edge.is-lead .wm-mv-text'), 'a+');
  assert(q('.wm-mv-hbrace.is-stack') === stack && eq.ta.value === '\\overbrace{a+\\underbrace{x}_{k}}^{n}', '內容前面有字：' + eq.ta.value);
  // 前後有分數這類結構也一樣疊在一起排；有兩個相反方向的括號時用一般的排法
  eq.setEdit('latex');
  eq.ta.value = '\\overbrace{\\frac{1}{2}+\\underbrace{x}_{k}+c}^{n} + \\overbrace{\\underbrace{a}_{1}+\\underbrace{b}_{2}}^{m}';
  eq.setEdit('visual');
  const stacks = qa('.wm-mv-hbrace.is-stack');
  assert(stacks.length === 1 && stacks[0].querySelector(':scope > .wm-mv-hb-edge.is-lead .wm-mv-frac') && qa('.wm-mv-hbrace:not(.is-stack)').length === 3, '前面有分數：疊在一起排；兩個下括號：一般的排法');
  eq.close();

  // 編號：顯示成「(1)」的一格（括號由 CSS 加上），不是「\tag」；行內的方程式不會顯示編號，預覽上方提醒
  await fresh('質能：\n');
  view.openEquation();
  eq = mock.Modal.last;
  await sleep(25);
  const placeBtns = qa('.wm-eq-top .wm-seg:not(.wm-eq-modes) button');
  placeBtns[0].click(); // 文字中（行內）
  const eqText = qa('.wm-mv-text').pop();
  typeIn(eqText, 'E=mc');
  eq.field.place(eqText, 4); // 游標在打的字後面（jsdom 換掉文字後游標會留在開頭）
  qa('.wm-eq-cat').find(b => b.textContent === '結構').click();
  snippet('\\tag{1}').click();
  const tagEl = q('.wm-mv-group[data-cmd="tag"]');
  assert(tagEl && tagEl.textContent === '1' && !q('.wm-mv').textContent.includes('\\tag') && eq.ta.value === 'E=mc\\tag{1}', '編號：一格，不顯示指令原文：' + eq.ta.value);
  await sleep(200);
  assert(eq.err.textContent === '編號只會顯示在獨立一行的方程式', '行內的方程式有編號：提醒只有獨立一行才顯示：' + eq.err.textContent);
  placeBtns[1].click(); // 獨立一行
  assert(!eq.err.textContent, '改成獨立一行：提醒消失');
  eq.close();

  // 既有的方程式：沒有在格子裡改東西就不會動到原本的寫法
  await fresh('公式 $x^2 + \\sqrt{y}$ 結束\n');
  const math = view.pm.dom.querySelector('.wm-raw-inline.is-math');
  math.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  eq = mock.Modal.last;
  await sleep(25);
  assert(eq.contentEl.querySelector('.wm-mv-sup') && eq.contentEl.querySelector('.wm-mv-sqrt'), '既有的方程式拆成上標與根號的格子');
  // 根號畫成 SVG（跟著內容伸長），不是固定大小的「√」字元；開頭不會多出文字
  const radical = eq.contentEl.querySelector('.wm-mv-sqrt > .wm-mv-radical');
  assert(radical && radical.querySelector('svg line') && radical.querySelector('svg svg polyline') && radical.textContent === '', '根號是會伸長的 SVG');
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
  // 沒改到的 x^2 照原文（以前變成 x^{2}）
  assert(!eq.contentEl.querySelector('.wm-mv-sqrt') && eq.ta.value === 'x^2 +', '格子開頭按 Backspace：刪掉前面的根號：' + JSON.stringify(eq.ta.value));
  eq.setEdit('latex');
  assert(eq.ta.style.display !== 'none' && eq.contentEl.querySelector('.wm-eq-visual').style.display === 'none', '可以切到 LaTeX 模式');
  eq.ta.value = '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}';
  eq.setEdit('visual');
  assert(eq.contentEl.querySelectorAll('.wm-mv-cell').length === 4, '切回視覺化：矩陣顯示成 2×2 的格子');
  eq.contentEl.querySelector('.wm-mv-env-btn').click();
  assert(eq.contentEl.querySelectorAll('.wm-mv-cell').length === 6 && eq.ta.value.includes('3 & 4 \\\\  & '), '矩陣可以加一列：' + eq.ta.value);
  // 括號一律用同一套會伸長的畫法：矩陣類環境依種類畫括號（matrix 沒有、cases 只有左邊），\binom、\left…\right 也一樣；
  // 右側的括號是左側的鏡像；不認得的分隔符號照原文顯示，「.」不顯示
  eq.setEdit('latex');
  eq.ta.value = '\\begin{pmatrix} a \\end{pmatrix} \\begin{vmatrix} a \\end{vmatrix} \\begin{matrix} a \\end{matrix} \\begin{cases} a \\end{cases} \\binom{n}{k} \\left\\langle x \\right\\rangle \\left/ x \\right.';
  eq.setEdit('visual');
  const drawn = [...eq.contentEl.querySelectorAll('.wm-mv-delim.is-drawn')].map(d => d.dataset.delim + (d.classList.contains('is-mirror') ? 'R' : '')).join(' ');
  assert(drawn === '( (R | | { ( (R ⟨ ⟨R', '各種括號畫成會伸長的 SVG：' + drawn);
  const plainDelims = [...eq.contentEl.querySelectorAll('.wm-mv-delim:not(.is-drawn)')].map(d => d.textContent);
  // cases 的右邊、\right. 都是「.」：空的元素
  assert(plainDelims.join(',') === ',/,', '不認得的分隔符號照原文、\\right. 不顯示：' + JSON.stringify(plainDelims));
  assert(!eq.contentEl.querySelector('.wm-mv-env[data-env="matrix"] .wm-mv-delim'), 'matrix 兩側沒有括號');
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

// ======== 方程式、圖表對話框：有還沒套用的修改時，Esc／點外面／× 不直接關，先問一次 ========
// Obsidian 的這三種關法都是呼叫對話框的 close()，所以測試直接呼叫 close()
await fresh('公式 $a+b$ 結束\n');
{
  const openEq = async () => {
    view.pm.dom.querySelector('.wm-raw-inline.is-math').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(25);
    return mock.Modal.last;
  };
  const shown = m => m.contentEl.isConnected;
  const bar = m => m.contentEl.querySelector('.wm-discard');
  const button = (m, label) => [...m.contentEl.querySelectorAll('button')].find(b => b.textContent === label);
  const before = out();

  let eq = await openEq();
  eq.close();
  assert(!shown(eq), '方程式沒有修改：直接關閉');

  eq = await openEq();
  eq.setEdit('latex'); eq.ta.value = 'a+b+c';
  eq.close();
  assert(shown(eq) && bar(eq) && bar(eq).textContent.includes('還沒套用的修改會不見'), '方程式改過：不關，在上方問要不要捨棄');
  assert(eq.contentEl.firstElementChild === bar(eq) && eq.contentEl.ownerDocument.activeElement === button(eq, '繼續編輯'), '詢問列在最上面，焦點在「繼續編輯」（再按 Enter 不會誤關）');
  eq.close();
  assert(shown(eq) && !bar(eq) && eq.ta.value === 'a+b+c', '問的時候再按一次 Esc：留下來繼續編輯，內容還在');
  eq.close();
  button(eq, '繼續編輯').click();
  assert(shown(eq) && !bar(eq), '按「繼續編輯」：留下來');
  eq.close();
  button(eq, '捨棄修改').click();
  assert(!shown(eq) && out() === before, '按「捨棄修改」：關閉，筆記沒有變');

  eq = await openEq();
  eq.setEdit('latex'); eq.ta.value = 'a+b+c';
  button(eq, '取消').click();
  assert(!shown(eq) && out() === before, '對話框自己的「取消」：已經表明要關，不再問');

  eq = await openEq();
  eq.setEdit('latex'); eq.ta.value = 'a+b+c';
  button(eq, '套用').click();
  assert(!shown(eq) && out().includes('$a+b+c$'), '「套用」照常寫回並關閉：' + JSON.stringify(out()));

  // 圖表：新的圖表一開就是範本，沒動過就能直接關；改過才問
  view.openMermaid();
  await sleep(30);
  let mm = mock.Modal.last;
  mm.close();
  assert(!shown(mm), '圖表沒有修改（還是範本）：直接關閉');
  view.openMermaid();
  await sleep(30);
  mm = mock.Modal.last;
  mm.src = mm.src + '\n    B --> Z[多一個]';
  mm.close();
  assert(shown(mm) && bar(mm), '圖表改過：先問');
  button(mm, '捨棄修改').click();
  assert(!shown(mm), '圖表：捨棄修改後關閉');
}

// ======== 複製之後的通知只顯示開頭，不把整份內容貼出來 ========
{
  const written = [];
  const had = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async s => { written.push(s); } }, configurable: true });
  const long = '第一行程式碼\n' + 'x = 1\n'.repeat(80);
  view.copyText(long);
  await sleep(5);
  const notice = mock.log.filter(x => x[0] === 'notice').pop()[1];
  assert(written[0] === long, '剪貼簿拿到完整的內容');
  assert(notice.startsWith('已複製：第一行程式碼 x = 1') && notice.endsWith('…') && notice.length < 80, '通知只顯示開頭一小段：' + notice.length + ' 個字');
  view.copyText('短的');
  await sleep(5);
  assert(mock.log.filter(x => x[0] === 'notice').pop()[1] === '已複製：短的', '短的內容照樣完整顯示');
  if (had) Object.defineProperty(globalThis.navigator, 'clipboard', had); else delete globalThis.navigator.clipboard;
}

// ======== 跳到指定的行（大綱、反向連結、搜尋結果）：文件改過之後行號還是對得上 ========
{
  await fresh('# 一\n\n段落一\n\n# 二\n\n段落二\n\n# 三\n\n段落三\n');
  const at = () => view.pm.state.selection.$from.parent.textContent;
  const lineOf = text => view.getViewData().split('\n').indexOf(text);
  view.setEphemeralState({ line: lineOf('# 二') });
  assert(at() === '二', '沒改過：跳到第二個標題：' + at());
  // 在最前面加兩段、把第一個標題整個刪掉：後面每一段的行號都變了
  const P = B.schema.nodes.paragraph;
  view.pm.dispatch(view.pm.state.tr.insert(0, [P.create(null, B.schema.text('新的第一段')), P.create(null, B.schema.text('新的第二段'))]));
  view.setEphemeralState({ line: lineOf('# 二') });
  assert(at() === '二', '前面加了兩段之後：還是跳到第二個標題：' + at());
  view.setEphemeralState({ line: lineOf('新的第二段') });
  assert(at() === '新的第二段', '新加的段落也跳得到：' + at());
  view.setEphemeralState({ line: lineOf('段落三') });
  assert(at() === '段落三', '最後一段：' + at());
  await view.save();
}

// ======== 裝飾的局部更新：改動之後，跟整份重算的結果一樣 ========
// 編輯標記、程式碼上色、標籤與網址的裝飾在文件改動時只重算有變的區塊（decoutil.js）。
// 這裡用固定的亂數種子改很多次，每次都跟「同一份文件從頭算」比對
{
  await fresh('第一段 有 空白\t與 #標籤 和 https://example.com/a 網址\n\n- 項目一​零寬\n- 項目二  兩個空白\n\n```python\ndef f(): pass\ndef g(): pass\n```\n\n> 引文 **粗體** 結尾\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 def | 2 |\n\n```js\nlet a = 1\n```\n\n最後一段\n');
  await sleep(0); // 等 Prism 載入
  const pm = view.pm;
  const marksOn = { on: true, always: true };
  pm.dispatch(pm.state.tr.setMeta(B.MARKS.marksKey, marksOn));
  const watched = pm.state.plugins.filter(p => /^wm(Marks|Code|Inline)\$/.test(p.key));
  const dump = state => watched.map(p => {
    const set = p.props.decorations.call(p, state);
    return (set ? set.find() : []).map(d => JSON.stringify([d.from, d.to, d.type.attrs || null, (d.spec && d.spec.key) || null])).sort().join('\n');
  });
  const rebuilt = state => {
    const s = state.constructor.create({ doc: state.doc, plugins: watched });
    return dump(s.apply(s.tr.setMeta(B.MARKS.marksKey, marksOn)));
  };
  assert(watched.length === 3 && dump(pm.state).every(d => d.length > 0), '編輯標記、程式碼上色、標籤與網址都有裝飾');
  let seed = 20261120;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pieces = ['字', ' ', '  ', '\t', '　', '​', ' #標籤 ', ' https://a.b/c ', 'def ', '**', 'x'];
  const piece = () => pieces[rnd(pieces.length)];
  // 隨機挑一個可以打字的位置
  const textPos = () => {
    const spots = [];
    pm.state.doc.descendants((n, pos) => { if (n.isTextblock) for (let i = 0; i <= n.content.size; i++) spots.push(pos + 1 + i); });
    return spots[rnd(spots.length)];
  };
  let bad = null; let edits = 0;
  for (let i = 0; i < 400 && !bad; i++) {
    const st = pm.state; const tr = st.tr; const kind = rnd(6);
    try {
      if (kind === 0) tr.insertText(piece(), textPos());
      else if (kind === 1) { const a = textPos(), b = textPos(); tr.delete(Math.min(a, b), Math.max(a, b)); } // 可能跨好幾個區塊
      else if (kind === 2) tr.split(textPos());
      else if (kind === 3) { const second = textPos(); tr.insertText(piece(), textPos()); tr.insertText(piece(), tr.mapping.map(second)); } // 一筆交易兩個步驟
      else if (kind === 4) { const p = textPos(); tr.delete(p, Math.min(p + 1 + rnd(3), st.doc.content.size)); }
      else {
        // 把一個頂層區塊換成新的段落
        const idx = rnd(st.doc.childCount); let pos = 0;
        for (let j = 0; j < idx; j++) pos += st.doc.child(j).nodeSize;
        tr.replaceWith(pos, pos + st.doc.child(idx).nodeSize, B.schema.nodes.paragraph.create(null, B.schema.text('新的 一段 def #新標籤')));
      }
    } catch { continue; } // 這個位置不能這樣改（例如表格裡不能分段），換下一個
    if (!tr.docChanged) continue;
    pm.dispatch(tr); edits++;
    const a = dump(pm.state), b = rebuilt(pm.state);
    for (let j = 0; j < watched.length; j++) {
      if (a[j] === b[j]) continue;
      const only = (x, y) => { const set = new Set(y.split('\n')); return x.split('\n').filter(l => l && !set.has(l)).slice(0, 3).join(' '); };
      bad = `第 ${i} 次（動作 ${kind}）${watched[j].key}；步驟 ${JSON.stringify(tr.steps.map(s => s.toJSON()))}；只有局部更新有：${only(a[j], b[j])}；只有重算有：${only(b[j], a[j])}`;
    }
  }
  assert(!bad && edits > 200, `隨機改 ${edits} 次，局部更新的裝飾都跟整份重算一樣` + (bad ? '：不一樣，' + bad : ''));
}

// ======== 文件屬性：鍵盤也能操作（Enter、空白鍵） ========
await fresh('---\ntags:\n  - 會議\n  - 專案\nrelated:\n  - [[其他筆記]]\nsite: https://example.com\ncount: 3\n---\n內文\n');
{
  const q = sel => [...view.pm.dom.querySelectorAll(sel)];
  const one = sel => view.pm.dom.querySelector(sel);
  const rowOf = name => q('.wm-prop').find(r => r.querySelector('.wm-prop-name') && r.querySelector('.wm-prop-name').textContent === name);
  const key = (el, k, init = {}) => { const e = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, init)); el.dispatchEvent(e); return e; };
  const collapsed = () => one('.wm-props').classList.contains('is-collapsed');

  // 標題：收合、展開
  const title = () => one('.wm-props-title');
  assert(title().tagName === 'SPAN' && title().getAttribute('role') === 'button' && title().tabIndex === 0 && title().getAttribute('aria-expanded') === 'true',
    '文件屬性的標題用 Tab 走得到，並標示目前是展開的');
  const e1 = key(title(), 'Enter');
  assert(collapsed() && e1.defaultPrevented && title().getAttribute('aria-expanded') === 'false', '在標題上按 Enter：收合');
  key(title(), ' ');
  assert(!collapsed() && q('.wm-prop').length === 5, '在標題上按空白鍵：展開');
  key(title(), 'a'); key(title(), 'Tab'); key(title(), 'Enter', { repeat: true });
  assert(!collapsed(), '其他按鍵、按住不放的重複按鍵不會收合');

  // 標籤的 ×
  const xs = () => [...rowOf('tags').querySelectorAll('.wm-chip-x')];
  assert(xs().length === 2 && xs().every(x => x.tagName === 'SPAN' && x.getAttribute('role') === 'button' && x.tabIndex === 0), '標籤的 × 用 Tab 走得到');
  key(xs()[0], 'Enter');
  assert(/tags:\n {2}- 專案\nrelated:/.test(out()), '在標籤的 × 上按 Enter：移除那個標籤：' + JSON.stringify(out()));
  const same = out();
  key(rowOf('tags').querySelector('.wm-chip-input'), ' ');
  assert(out() === same && !collapsed(), '在輸入框裡按空白鍵只是打字，不會觸發別的動作');

  // 類型圖示：鍵盤沒有滑鼠位置，選單開在圖示旁邊
  mock.Menu.last = null;
  let shownAt = null;
  const showAt = mock.Menu.prototype.showAtMouseEvent;
  mock.Menu.prototype.showAtMouseEvent = function (evt) { shownAt = evt; return showAt.call(this, evt); };
  key(rowOf('site').querySelector('.wm-prop-icon'), 'Enter');
  mock.Menu.prototype.showAtMouseEvent = showAt;
  assert(mock.Menu.last && mock.Menu.last.items.length === 7 && shownAt instanceof MouseEvent && shownAt.view === window && typeof shownAt.pageX === 'number',
    '在類型圖示上按 Enter：開啟類型選單（給選單的是帶位置的滑鼠事件）');

  // 連結
  const link = rowOf('related').querySelector('.wm-chip-link .wm-chip-text');
  assert(link.getAttribute('role') === 'link' && link.tabIndex === 0, '清單裡的連結用 Tab 走得到');
  const before = app.workspace.opened.length;
  key(link, 'Enter');
  assert(app.workspace.opened.length === before + 1 && String(app.workspace.opened[before]).includes('其他筆記'), '在連結上按 Enter：開啟');
  assert(!rowOf('site').querySelector('.wm-prop-name').hasAttribute('tabindex') && !rowOf('tags').querySelector('.wm-chip-text').hasAttribute('tabindex'), '不能按的文字不會多出停駐點');

  // 原文
  key(one('.wm-props-raw[aria-label="編輯 YAML 原文"]'), 'Enter');
  const src = mock.Modal.last;
  assert(src.contentEl.querySelector('textarea') && src.contentEl.querySelector('textarea').value.startsWith('---\n') && !collapsed(), '在「原文」按鈕上按 Enter：開啟原文編輯，不會連帶收合');
  src.close();

  // 刪除一個屬性
  key(rowOf('site').querySelector('.wm-prop-del'), ' ');
  assert(!out().includes('site:') && out().includes('count: 3'), '在刪除按鈕上按空白鍵：刪除這個屬性：' + JSON.stringify(out()));

  // 新增
  one('.wm-prop-add input').value = '負責人';
  key(one('.wm-prop-addbtn'), 'Enter');
  assert(/\n負責人:/.test(out()), '在「新增」按鈕上按 Enter：新增屬性：' + JSON.stringify(out()));

  // 滑鼠照舊：按下就動作，不會把焦點從原本的地方搶走
  const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  rowOf('count').querySelector('.wm-prop-del').dispatchEvent(md);
  assert(md.defaultPrevented && !out().includes('count:') && !one('.wm-props').contains(document.activeElement), '滑鼠按下去照舊立刻動作，而且焦點不會跑進文件屬性');
  const mh = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  title().dispatchEvent(mh);
  assert(collapsed() && mh.defaultPrevented, '滑鼠按標題：只收合一次（不會標題與標題列各算一次）');
  one('.wm-props-head').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert(!collapsed(), '滑鼠按標題列：展開');

  // 移除整個區塊
  key(one('.wm-props-remove'), 'Enter');
  assert(!one('.wm-props') && out() === '內文\n', '在「移除」按鈕上按 Enter：移除文件屬性：' + JSON.stringify(out()));
}

// ======== 文件屬性：重畫之後焦點還在原本的地方 ========
await fresh('---\ntags:\n  - 會議\n  - 專案\ndate: 2026-11-16\ndone: false\ntitle: 舊標題\ncount: 3\n---\n內文\n');
{
  const q = sel => [...view.pm.dom.querySelectorAll(sel)];
  const one = sel => view.pm.dom.querySelector(sel);
  const rowOf = name => q('.wm-prop').find(r => r.querySelector('.wm-prop-name') && r.querySelector('.wm-prop-name').textContent === name);
  const input = name => rowOf(name).querySelector('.wm-prop-value input');
  const change = el => el.dispatchEvent(new Event('change', { bubbles: true }));
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const focused = () => document.activeElement;

  // 清單：按 Enter 加一個之後，可以接著打下一個
  const chip = input('tags');
  chip.focus(); chip.value = '週會';
  let edits = 0;
  const dispatch = view.dispatch;
  view.dispatch = function (tr) { if (tr.docChanged) edits++; return dispatch.call(this, tr); };
  key(chip, 'Enter');
  view.dispatch = dispatch;
  assert(out().includes('  - 週會\n') && input('tags') !== chip && focused() === input('tags') && input('tags').value === '', '加了標籤之後焦點還在輸入框，可以接著打下一個');
  // 舊的輸入框被換掉、失去焦點時還會收到一次 blur，不能因此再存一次
  assert(edits === 1, '加一個標籤只改一次文件：' + edits);

  // 核取方塊
  const cb = input('done');
  cb.focus(); cb.checked = true; change(cb);
  assert(out().includes('done: true') && input('done') !== cb && focused() === input('done') && input('done').checked, '勾了核取方塊之後焦點還在核取方塊上');

  // 日期欄位每改完一段（年、月、日）就送出 change，這時人還在欄位裡：存檔，但欄位不能換成新的（換了就接不下去打）
  const date = input('date');
  date.focus(); date.value = '2026-12-01'; change(date);
  assert(out().includes('date: 2026-12-01') && input('date') === date && focused() === date, '日期改到一半：存檔，欄位還是同一個、焦點還在');
  date.value = '2026-12-31'; change(date);
  date.value = '2026-11-16'; change(date);
  assert(out().includes('date: 2026-11-16') && input('date') === date, '接著改、改回原本的值都會存：' + JSON.stringify(out()));
  date.value = '2027-03-04'; change(date);
  // 這時別的列還是原本畫的那一批，它們存檔時不能把日期蓋回去
  input('done').checked = false; change(input('done'));
  assert(out().includes('date: 2027-03-04') && out().includes('done: false'), '日期改完沒重畫，接著改別的屬性不會把日期蓋回去：' + JSON.stringify(out()));

  // 改完按 Tab（或用滑鼠點別的控制項）：瀏覽器先把焦點拿走、送出 change（存檔），再送出 blur（這時才重畫，要去的那個控制項換成新的）。
  // jsdom 不會自己做這一串，照真的瀏覽器的順序送
  const leave = (el, next) => { el.blur(); change(el); el.dispatchEvent(new window.FocusEvent('blur', { relatedTarget: next })); };
  const text = input('title');
  const oldDel = rowOf('title').querySelector('.wm-prop-del');
  text.focus(); text.value = 'https://example.com/新';
  leave(text, oldDel);
  assert(out().includes('title: https://example.com/新') && !oldDel.isConnected && focused() === rowOf('title').querySelector('.wm-prop-del'), '改完按 Tab：焦點到下一個控制項，不會掉出文件屬性');
  assert(rowOf('title').querySelector('.wm-prop-open'), '離開欄位後重畫：值變成網址，旁邊出現開啟按鈕');

  // 筆記在別處被改了（同步、復原）而重畫：被換掉的輸入框還會收到 change、blur，不能拿它手上的舊資料存回去
  const stale = input('title');
  stale.focus(); stale.value = '打到一半';
  view.pm.dispatch(view.pm.state.tr.setNodeMarkup(0, null, Object.assign({}, view.pm.state.doc.firstChild.attrs, { src: '---\ntags:\n  - 會議\n  - 專案\n  - 週會\ndate: 2027-03-04\ndone: false\ntitle: 別處改的\ncount: 99\n---' })));
  stale.blur(); change(stale); stale.dispatchEvent(new window.FocusEvent('blur'));
  assert(!stale.isConnected && out().includes('title: 別處改的') && out().includes('count: 99') && q('.wm-props-head').length === 1, '被換掉的欄位不會拿舊資料蓋掉新的：' + JSON.stringify(out()));
  // 清單的輸入框是離開時（blur）才存
  const chip2 = input('tags');
  const oldType = rowOf('date').querySelector('.wm-prop-icon');
  chip2.focus(); chip2.value = '月會';
  chip2.dispatchEvent(new window.FocusEvent('blur', { relatedTarget: oldType }));
  assert(out().includes('  - 月會\n') && !oldType.isConnected && focused() === rowOf('date').querySelector('.wm-prop-icon'), '清單打到一半按 Tab：存起來，焦點到下一個控制項');

  // 滑鼠按別的按鈕（焦點留在輸入框）造成重畫時，游標留在原位
  const t2 = input('title');
  t2.focus(); t2.setSelectionRange(1, 2);
  rowOf('tags').querySelector('.wm-chip-x').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert(input('title') !== t2 && focused() === input('title') && input('title').selectionStart === 1 && input('title').selectionEnd === 2, '別處造成重畫時，正在用的文字欄位保有焦點與游標位置');

  // 用鍵盤按按鈕之後，焦點留在同一個位置
  one('.wm-props-title').focus();
  key(one('.wm-props-title'), 'Enter');
  assert(one('.wm-props').classList.contains('is-collapsed') && focused() === one('.wm-props-title'), '用鍵盤收合後焦點還在標題上，可以直接再按一次');
  key(one('.wm-props-title'), 'Enter');
  const xs = () => [...rowOf('tags').querySelectorAll('.wm-chip-x')];
  const left = xs().length;
  xs()[0].focus();
  key(xs()[0], 'Enter');
  assert(xs().length === left - 1 && focused() === xs()[0], '用鍵盤移除標籤後，焦點在補上來的下一個標籤的 × 上');
  while (xs().length > 1) key(xs()[0], 'Enter');
  key(xs()[0], 'Enter');
  assert(xs().length === 0 && focused() === input('tags'), '最後一個標籤也移除之後，焦點到新增標籤的輸入框');
  const del = rowOf('title').querySelector('.wm-prop-del');
  del.focus();
  key(del, 'Enter');
  assert(!out().includes('title:') && focused() === rowOf('count').querySelector('.wm-prop-icon'), '用鍵盤刪除一列後，焦點移到下一列的第一個控制項');
  const lastDel = rowOf('count').querySelector('.wm-prop-del');
  lastDel.focus();
  key(lastDel, 'Enter');
  assert(!out().includes('count:') && focused() === one('.wm-prop-add input'), '刪掉最後一列：焦點到新增屬性的欄位');
  one('.wm-prop-add input').value = '負責人';
  key(one('.wm-prop-add input'), 'Enter');
  assert(/\n負責人:/.test(out()) && focused() === one('.wm-prop-add input') && focused().value === '', '按 Enter 新增屬性後，焦點還在新增的欄位，可以接著加下一個');

  // 焦點不在文件屬性裡（在內文打字、復原）時，重畫不會把焦點搶過來
  focused().blur();
  undo();
  assert(!out().includes('負責人') && !one('.wm-props').contains(focused()), '焦點在別處時，文件屬性重畫不會搶焦點');
}

// ======== 第一份開啟的筆記就有註腳 ========
{
  // 編輯器是在載入第一份筆記時建立的，註腳記號在這個過程中就要讀得到註腳的內容
  const env2 = await makeEnv({});
  let err = null;
  try { await env2.open('筆記/註腳.md', '內文[^1] 與[^沒有]\n\n[^1]: 註腳的內容\n'); } catch (e) { err = e; }
  const refs = env2.view.pm ? [...env2.view.pm.dom.querySelectorAll('.wm-raw-inline.is-footnote')] : [];
  assert(!err && refs.length === 2, '第一份開啟的筆記有註腳也開得起來' + (err ? '：' + err.message : ''));
  assert(refs.length === 2 && refs[0].getAttribute('aria-label').includes('註腳的內容') && !refs[0].classList.contains('is-missing') && refs[1].classList.contains('is-missing'),
    '註腳記號的提示是註腳的內容；找不到定義的另外標示');
  env2.view.containerEl.remove();
}

// ======== 圖表還沒捲到就先被改過：捲到時畫的是現在的內容 ========
{
  // jsdom 沒有 IntersectionObserver（結果一開啟就畫）；裝一個假的，才等得到「捲到看得到才畫」
  const observers = [];
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.off = true; } };
  await fresh('前文\n\n```mermaid\ngraph TD; A-->B\n```\n');
  await sleep(10);
  const io = observers.find(o => o.target && o.target.classList.contains('wm-codeblock'));
  const preview = () => view.pm.dom.querySelector('.wm-code-preview').textContent;
  assert(io && preview() === '', '還沒捲到圖表：先不畫');
  // 這時內容被改了（全部取代、復原都不用先捲過去）
  let end = 0;
  view.pm.state.doc.descendants((n, pos) => { if (n.type.name === 'code_block') end = pos + 1 + n.content.size; });
  view.pm.dispatch(view.pm.state.tr.insertText('\nB-->C', end));
  // 打字後延後重畫的時間還沒到，就捲到看得到了
  io.cb([{ isIntersecting: true }]);
  assert(preview().includes('A-->B') && preview().includes('B-->C'), '捲到時畫的是改過之後的內容：' + JSON.stringify(preview()));
  await sleep(700);
  assert(preview().includes('B-->C'), '之後也不會停在舊的內容：' + JSON.stringify(preview()));
  delete globalThis.IntersectionObserver;
}

// ======== 手機的螢幕鍵盤：檢視下方被鍵盤蓋住多少就留多少，功能區才會在鍵盤上方 ========
{
  await fresh('一段\n');
  const el = view.contentEl;
  const inset = () => el.style.getPropertyValue('--wm-kb-inset');
  const cover = () => document.body.style.getPropertyValue('--wm-kb-cover');
  const realRect = el.getBoundingClientRect;
  // 檢視的下緣在 520；視窗高 768（jsdom 的預設）
  el.getBoundingClientRect = () => ({ left: 0, top: 100, right: 390, bottom: 520, width: 390, height: 420 });
  const vv = { offsetTop: 0, height: 768, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  const scrolls = [];
  const realScrollTo = window.scrollTo;
  window.scrollTo = (x, y) => scrolls.push([x, y]);
  const kb = new B.KeyboardWatch(window);
  const stop = kb.start();
  plugin.keyboard = kb;
  const unsub = kb.subscribe(() => view.syncKeyboard());
  const input = document.body.appendChild(document.createElement('input'));
  input.focus();
  kb.measure();
  assert(!el.classList.contains('wm-kb-open') && !view.kbInset && !document.body.classList.contains('wm-kb-up'), '有焦點但鍵盤沒升起（外接鍵盤）：不留空間');
  // visualViewport 變矮：只看得到上面 400
  vv.height = 400;
  kb.measure();
  assert(el.classList.contains('wm-kb-open') && inset() === '120px', '鍵盤升起，檢視下方有 120 被蓋住：留 120，得到 ' + inset());
  assert(document.body.classList.contains('wm-kb-up') && cover() === '368px', 'body 記下鍵盤蓋住的高度，對話框用它避開鍵盤：' + cover());
  // 打字時精簡功能區：只切換樣式，不重建功能區（重建會搶走焦點、收起鍵盤）
  const tbDom = view.toolbar.dom;
  assert(el.classList.contains('wm-kb-compact') && view.toolbar.dom === tbDom && view.toolbar.tabSwitch.classList.contains('is-compact-only'), '鍵盤開著：功能區精簡成一列（wm-kb-compact），分頁改用選單按鈕');
  plugin.settings.compactOnKeyboard = false;
  view.syncKeyboard();
  assert(!el.classList.contains('wm-kb-compact') && el.classList.contains('wm-kb-open'), '關掉「打字時精簡工具列」：鍵盤開著也維持完整的功能區');
  plugin.settings.compactOnKeyboard = true;
  view.syncKeyboard();
  await sleep(30);
  assert(!scrolls.length, '畫面沒有被往上推：不去動它');
  vv.height = 600;
  kb.measure();
  assert(el.classList.contains('wm-kb-open') && inset() === '0px', 'Obsidian 自己縮得夠（檢視沒有被蓋住）：不多留，但還是算鍵盤開著');
  // visualViewport 沒有變，Obsidian 的 --keyboard-height 有值：一樣算數
  vv.height = 768;
  document.documentElement.style.setProperty('--keyboard-height', '300px');
  kb.measure();
  assert(cover() === '300px' && inset() === '52px', '只有 --keyboard-height 有值：用它，檢視留 52，得到 ' + cover() + '、' + inset());
  // Obsidian 手機版把 app 縮到鍵盤上方之後，documentElement.clientHeight 跟著變矮、innerHeight 不變：
  // 版面高度要取大的那個，只看 clientHeight 會把鍵盤扣兩次（實機上功能區與鍵盤之間空了一整個鍵盤的高度）
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 468, configurable: true });
  vv.height = 468;
  view.kbInset = -1;
  kb.measure();
  view.syncKeyboard();
  assert(cover() === '300px' && inset() === '52px', 'clientHeight 已經扣掉鍵盤（468）：鍵盤還是 300、檢視只留 52，不重複扣，得到 ' + cover() + '、' + inset());
  delete document.documentElement.clientHeight;
  vv.height = 768;
  kb.measure();
  // 實機（iPhone）：visualViewport 不變，鍵盤高度只有 --keyboard-height；動畫期間 app 還是整個畫面高（檢視下緣 768），
  // 動畫結束 Obsidian 才把 app 縮到鍵盤上方（下緣 468）。鍵盤高度沒變，檢視也要跟著重算，不能留著動畫前的 300
  document.documentElement.style.setProperty('--keyboard-height', '300px');
  el.getBoundingClientRect = () => ({ left: 0, top: 100, right: 390, bottom: 768, width: 390, height: 668 });
  view.kbInset = -1;
  kb.measure();
  view.syncKeyboard();
  assert(inset() === '300px', '鍵盤升起的動畫期間 app 還沒縮：檢視先留一整個鍵盤的高度，得到 ' + inset());
  el.getBoundingClientRect = () => ({ left: 0, top: 100, right: 390, bottom: 468, width: 390, height: 368 });
  kb.measure();
  assert(cover() === '300px' && inset() === '0px', 'Obsidian 把 app 縮到鍵盤上方之後：鍵盤高度沒變，檢視也重算成不用留，得到 ' + inset());
  el.getBoundingClientRect = () => ({ left: 0, top: 100, right: 390, bottom: 520, width: 390, height: 420 });
  kb.measure();
  // 鍵盤事件帶的高度比另外兩個大：取最大的
  window.dispatchEvent(Object.assign(new Event('keyboardWillShow'), { keyboardHeight: 340 }));
  kb.measure();
  assert(cover() === '340px' && inset() === '92px', '鍵盤事件說 340：三個來源取最大的，得到 ' + cover());
  window.dispatchEvent(new Event('keyboardDidHide'));
  document.documentElement.style.removeProperty('--keyboard-height');
  kb.measure();
  assert(cover() === '0px' && !el.classList.contains('wm-kb-open') && !el.classList.contains('wm-kb-compact'), '鍵盤收起來：不留空間，功能區恢復完整');
  // iOS 把畫面往上推
  await sleep(30);
  scrolls.length = 0;
  vv.height = 400; vv.offsetTop = 30;
  kb.measure();
  await sleep(30);
  // 鍵盤一樣蓋住 368（版面高度減掉看得到的高度，跟推了多少無關），推回原位之後檢視要留的就是 120，一次到位不再跳第二次
  assert(cover() === '368px' && inset() === '120px' && scrolls.length === 1 && scrolls[0][1] === 0, 'iOS 把畫面往上推了 30：鍵盤高度不變、留 120，並把畫面推回原位，得到 ' + cover() + '、' + inset());
  vv.offsetTop = 0;
  input.blur();
  kb.measure();
  assert(!el.classList.contains('wm-kb-open') && inset() === '0px', '沒有在輸入：就算 visualViewport 還沒恢復也不留空間');
  const box = document.body.appendChild(document.createElement('input'));
  box.type = 'checkbox';
  box.focus();
  kb.measure();
  assert(cover() === '0px', '焦點在核取方塊上不會叫出鍵盤：不留空間');
  box.remove();
  assert(/inner=\d+x768/.test(kb.report(['x'])) && kb.log.length > 3, '診斷資訊有視窗大小與最近幾次量到的數字');
  // 手機：在分頁選單按鈕上拖曳移動游標（一格 12px）；沒拖動就放開還是一般的點擊
  {
    const pm = view.pm;
    const dispatchCmd = cmd => cmd(pm.state, tr => pm.dispatch(tr));
    // 這時的文件只有「一段」兩個字：先放三段夠長的文字，再把游標放在第一段的第一個字後面
    await view.loadFile(view.file, '第一段有幾個字\n\n第二段也有幾個字\n\n第三段');
    dispatchCmd(B.C.moveCaretBy(-99999)); dispatchCmd(B.C.moveCaretBy(1));
    const head0 = pm.state.selection.head;
    assert(dispatchCmd(B.C.moveCaretBy(1)) && pm.state.selection.empty && pm.state.selection.head > head0, 'moveCaretBy(1)：游標往後一格');
    dispatchCmd(B.C.moveCaretBy(-1));
    assert(pm.state.selection.head === head0, 'moveCaretBy(-1)：回到原位');
    dispatchCmd(B.C.moveCaretBy(-99999));
    assert(pm.state.selection.head <= 2 && !dispatchCmd(B.C.moveCaretBy(-1)), '到文件開頭就停，再往前回報不能執行');
    const pad = document.body.appendChild(document.createElement('button'));
    view.toolbar.caretPad(pad);
    const ev = (type, x) => pad.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerId: 7, pointerType: 'touch', clientX: x, clientY: 0 }));
    pm.dom.blur();
    const blurred = pm.state.selection.head;
    ev('pointerdown', 100); ev('pointermove', 160); ev('pointerup', 160);
    assert(!view.toolbar.padMoved && pm.state.selection.head === blurred, '編輯區沒有焦點：拖曳不作用（不叫出鍵盤），放開後還是一般的點擊');
    pm.focus();
    const start = pm.state.selection.head;
    ev('pointerdown', 100); ev('pointermove', 104);
    assert(!view.toolbar.padMoved && pm.state.selection.head === start, '手指只動了一點點：不算拖曳，游標不動');
    ev('pointermove', 137);
    assert(view.toolbar.padMoved && pad.classList.contains('is-caret-pad') && pm.state.selection.head > start, '往右拖 37px：游標往後移（3 格），按鈕標成拖曳中');
    const after = pm.state.selection.head;
    ev('pointermove', 113);
    assert(pm.state.selection.head < after, '往回拖：游標往前移');
    ev('pointerup', 113);
    assert(!pad.classList.contains('is-caret-pad') && view.toolbar.padMoved, '放開：結束拖曳，接下來那一下點擊不開選單');
    pad.remove();
    view.toolbar.padMoved = false;
  }
  // 彈出選單要放在看得到的範圍裡：按鈕在鍵盤正上方時往上開
  input.focus();
  kb.measure();
  view.toolbar.showTab('insert');
  const owner = view.toolbar.dom.querySelector('button.wm-btn');
  const ownerRect = owner.getBoundingClientRect;
  owner.getBoundingClientRect = () => ({ left: 10, top: 360, right: 50, bottom: 396, width: 40, height: 36 });
  view.toolbar.openPopup(owner, p => { p.textContent = '選單'; });
  assert(parseFloat(view.toolbar.popup.style.top) < 360, '功能區在鍵盤上方時，選單往上開（不放到鍵盤後面）：top = ' + view.toolbar.popup.style.top);
  view.toolbar.closePopup();
  // 手機（body 有 is-phone）：面板改成底部抽屜，不跟著按鈕定位，後面有一層底；關掉時一起拿掉
  document.body.classList.add('is-phone');
  view.toolbar.openPopup(owner, p => { p.textContent = '選單'; });
  const sheet = view.toolbar.popup;
  assert(sheet.classList.contains('is-sheet') && !sheet.style.top && !sheet.style.left && document.querySelector('.wm-sheet-backdrop'), '手機：下拉面板是底部抽屜（is-sheet），位置交給樣式表，並有變暗的底');
  view.toolbar.closePopup();
  assert(!document.querySelector('.wm-sheet-backdrop') && !document.querySelector('.wm-popup'), '關掉抽屜：面板與底都拿掉');
  document.body.classList.remove('is-phone');
  owner.getBoundingClientRect = ownerRect;
  input.remove();
  unsub();
  stop();
  assert(!document.body.classList.contains('wm-kb-up') && cover() === '0px', '停止監聽之後 body 恢復原狀');
  view.syncKeyboard();
  delete plugin.keyboard;
  el.getBoundingClientRect = realRect;
  window.scrollTo = realScrollTo;
  delete window.visualViewport;
}

//@@MORE@@

finish();
