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
