// markdown-it-mark（==螢光== 語法）沒有附型別定義，也沒有 @types 套件：只描述 markdown.ts 用到的預設匯出
declare module 'markdown-it-mark' {
  import type { MarkdownIt } from 'markdown-it';
  const markPlugin: (md: MarkdownIt) => void;
  export default markPlugin;
}
