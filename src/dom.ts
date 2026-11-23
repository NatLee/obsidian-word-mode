// 建立 DOM 元素的小工具（各個介面元件共用）
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, parent?: Node | null, text?: string | null): HTMLElementTagNameMap[K];
export function el(tag: string, cls?: string | null, parent?: Node | null, text?: string | null): HTMLElement;
export function el(tag: string, cls?: string | null, parent?: Node | null, text?: string | null): HTMLElement {
  const e = createEl(tag as keyof HTMLElementTagNameMap);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// 元素是不是由右到左排。Obsidian 1.15 的介面語言是阿拉伯文、希伯來文時，工作區與對話框是 direction: rtl。
// 看元素實際的方向而不是 body 的 mod-rtl：舊版 Obsidian 沒有 mod-rtl，佈景主題也可能自己改方向
export function isRtl(e: Element): boolean {
  const win = e.ownerDocument.defaultView || window;
  return win.getComputedStyle(e).direction === 'rtl';
}

// 浮動面板的左緣：由左到右時面板左緣對齊錨點左緣，往右展開；由右到左時面板右緣對齊錨點右緣，往左展開。
// 兩種都不超出 margin 到 vw - margin 的範圍
export function popupLeft(anchor: { left: number; right: number }, w: number, vw: number, rtl: boolean, margin = 4): number {
  return Math.max(margin, Math.min(rtl ? anchor.right - w : anchor.left, vw - w - margin));
}

// 畫面上實際看得到的範圍的下緣（視窗座標）。iOS 的螢幕鍵盤彈出來時 innerHeight 不變，只有 visualViewport 變矮；
// 浮動面板、功能區要以這個為準，不然會放到鍵盤後面
export function visibleBottom(win: Window): number {
  const vv = win.visualViewport;
  return vv ? Math.min(win.innerHeight, vv.offsetTop + vv.height) : win.innerHeight;
}

// 版面（還沒被螢幕鍵盤、iOS 往上推影響時）的高度。innerHeight 與 documentElement.clientHeight 各有不準的時候：
// 一般的 WKWebView 裡 iOS 往上推畫面時 innerHeight 會少掉推上去的那一段、clientHeight 不變；Obsidian 手機版把 app 縮到
// 鍵盤上方之後 clientHeight 可能跟著變矮、innerHeight 不變（實機上只用 clientHeight 會把鍵盤扣兩次，功能區與鍵盤之間空一大塊）。
// 兩個都只會偏小，取大的
export function layoutHeight(win: Window): number {
  return Math.max(win.document.documentElement.clientHeight || 0, win.innerHeight || 0);
}

// 下緣在 bottom 的元素有多少像素被擋在看得到的範圍外面（螢幕鍵盤後面）
export function hiddenBelow(bottom: number, visible: number): number {
  return Math.max(0, Math.round(bottom - visible));
}

// 按鈕按下時不搶走輸入位置的焦點（編輯區、方程式的格子、圖上的輸入框）。
// 觸控裝置要連 pointerdown 一起擋，螢幕鍵盤才不會收起來
export function keepFocus(b: HTMLElement): void {
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
}

// target 自己有焦點時按 Enter 或空白鍵就執行 run，跟按鈕被按下一樣。
// 補給只聽滑鼠的控制項，鍵盤才操作得到；不是 <button> 的元素另外要有 role 與 tabindex
export function onKeyPress(target: HTMLElement, run: (e: KeyboardEvent) => void): void {
  target.addEventListener('keydown', e => {
    // 裡面的輸入框、按鈕傳出來的按鍵不算；按住不放的重複按鍵也不算（刪除這類動作不能連發）
    if (e.target !== target || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    run(e);
  });
}

// 滑鼠一按下就執行（不等放開），而且不搶走輸入位置的焦點；鍵盤的 Enter、空白鍵也一樣執行。
// 這裡不用 keepFocus()：它連觸控的 pointerdown 也取消，照 Pointer Events 的規範，之後瀏覽器就不再送 mousedown，
// 靠 mousedown 動作的控制項在手機上會按不動（keepFocus 是給靠 click 動作的按鈕用的）
export function onPress(target: HTMLElement, run: (e: MouseEvent | KeyboardEvent) => void): void {
  target.addEventListener('mousedown', e => { e.preventDefault(); run(e); });
  onKeyPress(target, run);
}

// 元素捲到看得到的範圍（或快要看到）才執行 run，只執行一次；回傳取消的函式。
// 用在比較花時間的顯示（圖表、查詢結果、內嵌的筆記）：有幾十張圖的長筆記，開啟時只畫看得到的那幾張。
// 以最近的可捲動外框為準（root 選擇器），往外多算 margin 像素，捲過去時通常已經畫好了。
// 沒有 IntersectionObserver 的環境（測試）直接執行
export function whenVisible(target: Element, run: () => void, root = '.wm-scroller', margin = 900): () => void {
  if (typeof IntersectionObserver === 'undefined') { run(); return () => { /* 已經執行了 */ }; }
  let io: IntersectionObserver | null = null;
  let done = false;
  // NodeView 建立時元素還沒放進文件，找不到外框；等放進去之後再開始看
  const timer = window.setTimeout(() => {
    if (done) return;
    if (!target.isConnected) { done = true; run(); return; }
    io = new IntersectionObserver(entries => {
      if (done || !entries.some(e => e.isIntersecting)) return;
      done = true;
      if (io) io.disconnect();
      run();
    }, { root: target.closest(root), rootMargin: margin + 'px 0px' });
    io.observe(target);
  }, 0);
  return () => { done = true; window.clearTimeout(timer); if (io) io.disconnect(); };
}

// 收起螢幕鍵盤：把焦點從正在打字的地方拿掉（iOS、Android 沒有別的辦法從網頁裡收鍵盤）
export function hideKeyboard(doc: Document): void {
  const a = doc.activeElement as HTMLElement | null;
  if (a && typeof a.blur === 'function') a.blur();
}

// 「收起鍵盤」按鈕（手機、平板）：平常藏著，螢幕鍵盤開著時（body 的 wm-kb-up）才顯示。
// iPhone 的鍵盤沒有收起來的鍵，Obsidian 也沒有，鍵盤一開就只能點別的地方碰運氣
export function keyboardHideButton(parent: HTMLElement, label: string, icon: (el: HTMLElement, name: string, fallback: string) => void): HTMLButtonElement {
  const b = el('button', 'wm-kb-hide', parent);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  icon(b, 'chevrons-down', '⌄');
  b.addEventListener('click', e => { e.preventDefault(); hideKeyboard(b.ownerDocument); });
  return b;
}

// 螢幕鍵盤的提示（手機、平板的鍵盤照這些屬性決定行為；桌機沒有影響）：
// plain：不自動大寫、不自動修正、不檢查拼字，給程式碼、LaTeX、色碼、網址、搜尋字這類「打什麼就是什麼」的欄位；
// mode：要出現哪一種鍵盤（numeric 數字、decimal 有小數點、url 有 / 與 .com、search）；
// enter：右下角那顆鍵顯示的字（search 搜尋、done 完成、go 前往、next 下一個）
export interface KeyboardHints { plain?: boolean; mode?: 'numeric' | 'decimal' | 'url' | 'search' | 'text'; enter?: 'search' | 'done' | 'go' | 'next' | 'enter'; }
export function keyboardHints<T extends HTMLElement>(e: T, h: KeyboardHints): T {
  if (h.plain) {
    e.setAttribute('autocapitalize', 'off');
    e.setAttribute('autocorrect', 'off');
    e.setAttribute('autocomplete', 'off');
    e.spellcheck = false;
  }
  if (h.mode) e.setAttribute('inputmode', h.mode);
  if (h.enter) e.setAttribute('enterkeyhint', h.enter);
  return e;
}
