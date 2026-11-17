// 執行環境提供、但不在公開型別定義裡的全域物件
import type { moment } from 'obsidian';

declare global {
  interface Window {
    // Obsidian 把 moment 掛在 window 上
    moment?: typeof moment;
  }
}

export {};
