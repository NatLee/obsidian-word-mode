// 在元素裡放 Obsidian 的圖示。圖示名稱隨 Obsidian 版本增減，這一版沒有的圖示改顯示文字，
// 按鈕才不會變成空白
import { setIcon, getIcon } from 'obsidian';

export type IconFn = (el: HTMLElement, name: string, fallback: string) => void;

// Lucide 改過名字的圖示：新名字 → Obsidian 目前內建的舊名字
const ALIASES: Record<string, string> = { 'arrow-down-a-z': 'arrow-down-az', 'arrow-up-z-a': 'arrow-up-za' };

// 這一版 Obsidian 認得的圖示名稱：name 沒有就換成它的別名（給 Menu 的 setIcon 這種沒辦法顯示替代文字的地方用）
export function iconId(name: string): string {
  if (typeof getIcon !== 'function' || getIcon(name)) return name;
  const other = ALIASES[name];
  return other && getIcon(other) ? other : name;
}

export const iconOr: IconFn = (el, name, fallback) => {
  setIcon(el, iconId(name));
  if (!el.querySelector('svg') && fallback) el.setText(fallback);
};
