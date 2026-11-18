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

// 按鈕按下時不搶走輸入位置的焦點（編輯區、方程式的格子、圖上的輸入框）。
// 觸控裝置要連 pointerdown 一起擋，螢幕鍵盤才不會收起來
export function keepFocus(b: HTMLElement): void {
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') e.preventDefault(); });
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
