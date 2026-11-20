// 用 Obsidian 內建的 MathJax 把 LaTeX 畫進元素（文件裡的方程式、方程式對話框的預覽、設定頁的公式清單共用）
import { loadMathJax, renderMath, finishRenderMath } from 'obsidian';

let flushing: Promise<void> | null = null;

// finishRenderMath() 的意思是「這一批畫完了」，它會整理 MathJax 的樣式表。
// 開一份有幾十條方程式的筆記時，每一條各呼叫一次是白做工：同一輪畫的合起來呼叫一次
function finishBatch(): Promise<void> {
  if (!flushing) flushing = Promise.resolve().then(() => { flushing = null; return finishRenderMath(); });
  return flushing;
}

// MathJax 是第一次用到才載入的；還沒畫好之前先顯示原始碼。畫不出來時顯示 fallback（預設是原始碼）
export function renderMathInto(src: string, el: HTMLElement, display: boolean, fallback: string = src): void {
  el.setText(src);
  Promise.resolve(loadMathJax())
    .then(() => { el.empty(); el.appendChild(renderMath(src, display)); return finishBatch(); })
    .catch(() => el.setText(fallback));
}
