// 建立 DOM 元素的小工具（各個介面元件共用）
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, parent?: Node | null, text?: string | null): HTMLElementTagNameMap[K];
export function el(tag: string, cls?: string | null, parent?: Node | null, text?: string | null): HTMLElement;
export function el(tag: string, cls?: string | null, parent?: Node | null, text?: string | null): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
