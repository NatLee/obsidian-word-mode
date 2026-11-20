// 在元素裡放 Obsidian 的圖示。圖示名稱隨 Obsidian 版本增減，這一版沒有的圖示改顯示文字，
// 按鈕才不會變成空白
import { setIcon } from 'obsidian';

export type IconFn = (el: HTMLElement, name: string, fallback: string) => void;

export const iconOr: IconFn = (el, name, fallback) => {
  setIcon(el, name);
  if (!el.querySelector('svg') && fallback) el.setText(fallback);
};
