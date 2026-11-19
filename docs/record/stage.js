// 頁面這一側的輔助函式，record.mjs 透過 DevTools Protocol 呼叫（window.stage.*）。
// 真正的滑鼠與鍵盤輸入走 DevTools Protocol；這裡只負責擺好畫面，以及畫出看得見的游標與按鍵提示。
(function () {
  // 依語言挑字型：日文用中文字型會變成中文字形，所以每種語言把自己的字型放在前面
  const FONTS = {
    en: '"Segoe UI", "Microsoft JhengHei UI", system-ui, sans-serif',
    'zh-TW': '"Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", sans-serif',
    ja: '"Segoe UI", "Yu Gothic UI", "Meiryo UI", sans-serif',
    ko: '"Segoe UI", "Malgun Gothic", sans-serif',
  };
  const MONO = { en: 'Consolas', 'zh-TW': 'Consolas, "Microsoft JhengHei UI"', ja: 'Consolas, "Yu Gothic UI"', ko: 'Consolas, "Malgun Gothic"' };
  const S = window.stage = {};
  const $ = s => document.querySelector(s);

  // 開一份筆記：path 是保管庫裡的路徑，content 是筆記內容，files 是保管庫裡其他的檔案（給 [[ 的建議清單用）
  S.setup = async function ({ lang, path, content, files = {}, settings = {}, caches = {}, title }) {
    const root = document.documentElement;
    root.lang = lang;
    root.style.setProperty('--font-interface', FONTS[lang]);
    root.style.setProperty('--font-text', FONTS[lang]);
    root.style.setProperty('--font-monospace', MONO[lang] + ', monospace');
    const ribbon = $('#side-ribbon');
    for (const i of ['folder-closed', 'search', 'bookmark', 'git-fork', 'calendar-days', 'layout-dashboard']) WM.mock.setIcon(ribbon.createDiv('clickable-icon'), i);
    const tab = $('#tab');
    WM.mock.setIcon(tab.createSpan(), 'file-text');
    tab.createSpan({ cls: 'tab-title', text: title });

    const env = S.env = await WM.makeEnv({ lang, files, settings, caches, mount: $('#leaf') });
    const v = env.view;
    v.containerEl.setAttribute('data-type', 'word-mode');
    const folder = path.includes('/') ? path.split('/').slice(0, -1).join(' / ') + ' / ' : '';
    v.titleEl.append(folder, Object.assign(document.createElement('b'), { textContent: title }));
    // 外掛自己的「切換到 Markdown」按鈕，以及 Obsidian 的 Markdown 檢視上切回來的按鈕
    S.modeBtn = v.actionsEl.querySelector('.view-action');
    S.backBtn = createDiv({ cls: 'clickable-icon view-action wm-rec-back' });
    WM.mock.setIcon(S.backBtn, 'file-text');
    S.backBtn.addEventListener('click', () => S.showSource(false));
    S.backBtn.hide();
    v.actionsEl.prepend(S.backBtn);
    S.sourceEl = v.containerEl.createDiv('source-view');
    S.sourceEl.createEl('pre');
    await env.open(path, content);
    return true;
  };

  // 顯示這份筆記存成的 Markdown（外掛的 getViewData()，也就是真正寫進檔案的內容），Markdown 符號淡色
  S.showSource = function (on) {
    const pre = S.sourceEl.querySelector('pre');
    if (on) {
      pre.replaceChildren();
      for (const line of S.env.view.getViewData().split('\n')) {
        const row = pre.createSpan();
        row.style.display = 'block';
        row.style.minHeight = '1.6em';
        const h = /^(#{1,6} )(.*)$/.exec(line);
        const parts = h ? [[h[1], 'md-syntax'], [h[2], 'md-h']] : [[line, '']];
        for (const [txt, cls] of parts) {
          // 淡色的部分：清單符號、待辦方框、粗體、醒目提示、連結、表格的直線、程式碼區塊與數學式的界線
          const re = /(^\s*(?:[-*+]|\d+\.)\s(?:\[.\]\s)?|^>\s?|\*\*|==|\[\[|\]\]|\*(?=\S)|\||^---$|^```\w*|\$\$?)/g;
          let last = 0, m;
          while ((m = re.exec(txt))) {
            if (m.index > last) row.createSpan({ cls, text: txt.slice(last, m.index) });
            row.createSpan({ cls: 'md-syntax', text: m[0] });
            last = m.index + m[0].length;
          }
          if (last < txt.length) row.createSpan({ cls, text: txt.slice(last) });
        }
      }
    }
    S.sourceEl.classList.toggle('is-shown', on);
    S.modeBtn.toggle(!on);
    S.backBtn.toggle(on);
  };

  // ---- 畫出來的滑鼠游標（transition 讓移動是連續的）、點擊的圓圈、按鍵提示
  S.cursor = function (x, y, ms) {
    const c = $('#cursor');
    c.classList.remove('hidden');
    c.style.transitionDuration = (ms || 0) + 'ms';
    c.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
  };
  S.hideCursor = function () { $('#cursor').classList.add('hidden'); };
  S.ring = function (x, y) {
    const r = document.body.createDiv('click-ring');
    r.style.left = x + 'px';
    r.style.top = y + 'px';
    setTimeout(() => r.remove(), 500);
  };
  S.keys = function (list) {
    const k = $('#keys');
    k.replaceChildren();
    if (!list || !list.length) { k.classList.add('hidden'); return; }
    list.forEach((x, i) => { if (i) k.createEl('i', { text: '+' }); k.createSpan({ text: x }); });
    k.classList.remove('hidden');
  };

  // 第 index 個看得見、且文字（或 aria-label、title）含有 text 的元素：回傳中心點與邊界
  S.find = function (sel, text, index) {
    const all = [...document.querySelectorAll(sel)].filter(e => {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      return !text || (e.textContent || '').includes(text) || (e.getAttribute('aria-label') || '').includes(text) || (e.getAttribute('title') || '').includes(text);
    });
    const e = all[index || 0];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  // 編輯器裡某個位置在畫面上的座標
  S.coords = function (pos) {
    const c = S.env.view.pm.coordsAtPos(pos);
    return { x: Math.round(c.left), y: Math.round((c.top + c.bottom) / 2) };
  };
  // 文件裡第一次出現 needle 的位置（再加上 offset）
  S.textPos = function (needle, offset) {
    let found = -1;
    S.env.view.pm.state.doc.descendants((n, p) => {
      if (found >= 0) return false;
      if (n.isText) { const i = n.text.indexOf(needle); if (i >= 0) found = p + i; }
      return true;
    });
    return found < 0 ? null : found + (offset || 0);
  };
  S.select = function (from, to) {
    const v = S.env.view.pm;
    v.dispatch(v.state.tr.setSelection(WM.TextSelection.create(v.state.doc, from, to == null ? from : to)));
    v.focus();
  };
  // 等畫面上正在畫的 Mermaid 圖完成，再多等兩個畫格
  S.settled = async function () {
    for (let i = 0; i < 100; i++) {
      const busy = [...document.querySelectorAll('.wm-mmd-canvas')].some(e => !e.querySelector('svg') && !(e.textContent || '').trim());
      if (!busy) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  };
})();
