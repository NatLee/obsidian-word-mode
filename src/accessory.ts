// 手機的方程式、圖表編輯器：貼在螢幕鍵盤上方的擴充列（鍵盤收起來時在畫面最下面）。
// 手機上這兩個對話框是整個畫面的編輯器（樣式表的「手機的方程式、圖表編輯器：整個畫面」）：最上面是取消、插入，
// 中間捲動，最下面是這一列。常用的鍵與符號放在這裡，打字時不用上下捲對話框去找。
// 最右邊的鍵盤按鈕：鍵盤開著時收起來，收著時叫出來（焦點放回剛才打字的欄位）；收起鍵盤時編輯器整個留著
import { el, hideKeyboard, keepFocus } from './dom.js';
import { isTypingTarget } from './keyboard.js';
import { t } from './i18n.js';

type IconFn = (target: HTMLElement, name: string, fallback: string) => void;

export interface AccKey {
  // 按鈕上的字（沒有圖示時）；圖示是 Lucide 的名稱
  text?: string;
  icon?: string;
  // 螢幕閱讀器念的名稱與長按的說明
  label: string;
  run(): void;
}

// 插入成對的括號、引號時游標放在中間：[]、()、{}、(())、{{}}、""
export function pairCaret(token: string): number {
  const m = /^([[({"]+)([\])}"]+)$/.exec(token);
  return m && m[1].length === m[2].length ? m[1].length : token.length;
}

export class Accessory {
  el: HTMLDivElement;
  // 第一列：鍵（各編輯器自己分組，切換模式時顯示或藏起一組）與最右邊的鍵盤按鈕
  row: HTMLDivElement;
  keys: HTMLDivElement;
  kb: HTMLButtonElement;
  // 最後一個打字的欄位：叫出鍵盤時把焦點放回去
  last: HTMLElement | null = null;
  constructor(modalEl: HTMLElement, private icon: IconFn, fallback: () => void) {
    this.el = el('div', 'wm-acc', modalEl);
    // Obsidian 手機版的滑動手勢（拉出側邊欄）不要接手這一列的左右滑動
    this.el.dataset.ignoreSwipe = 'true';
    this.row = el('div', 'wm-acc-row', this.el);
    this.keys = el('div', 'wm-acc-keys', this.row);
    this.kb = el('button', 'wm-acc-kb', this.row);
    this.kb.type = 'button';
    this.kb.setAttribute('aria-label', t('收起或叫出鍵盤'));
    // 兩個圖示都放著，樣式表照 body 的 wm-kb-up 只顯示一個（鍵盤開著：收起；收著：叫出）
    icon(el('span', 'wm-acc-kb-hide', this.kb), 'keyboard-toggle', '⌄');
    icon(el('span', 'wm-acc-kb-show', this.kb), 'keyboard', '⌨');
    keepFocus(this.kb);
    this.kb.addEventListener('click', () => {
      const doc = modalEl.ownerDocument;
      if (doc.body.classList.contains('wm-kb-up') && isTypingTarget(doc.activeElement)) { hideKeyboard(doc); return; }
      if (this.last && this.last.isConnected && this.last.offsetParent !== null) this.last.focus(); else fallback();
    });
    modalEl.addEventListener('focusin', e => {
      const target = e.target as HTMLElement | null;
      if (target && target.nodeType === 1 && isTypingTarget(target) && !this.el.contains(target)) this.last = target;
    });
  }

  // 一組鍵（例如「視覺化時」「LaTeX 時」），用 group.toggle() 切換
  group(cls: string, list: AccKey[], parent: HTMLElement = this.keys): HTMLDivElement {
    const g = el('div', 'wm-acc-group ' + cls, parent);
    this.fill(g, list);
    return g;
  }

  // 把一組鍵換成新的（例如圖表種類換了，程式碼的符號跟著換）
  fill(g: HTMLElement, list: AccKey[]): void {
    g.replaceChildren();
    for (const k of list) {
      const b = el('button', 'wm-acc-key' + (k.icon ? ' is-icon' : ''), g);
      b.type = 'button';
      b.setAttribute('aria-label', k.label);
      if (k.icon) this.icon(b, k.icon, k.text || '•'); else b.textContent = k.text || '';
      // 按鈕不搶焦點：游標留在欄位裡，鍵盤也不會收起來
      keepFocus(b);
      b.addEventListener('click', () => k.run());
    }
  }
}

// 在輸入框的游標位置插入文字（成對的括號把游標放中間），送出 input 事件讓編輯器更新
export function insertAt(ta: HTMLTextAreaElement | HTMLInputElement, token: string): void {
  const a = ta.selectionStart ?? ta.value.length;
  const b = ta.selectionEnd ?? a;
  ta.value = ta.value.slice(0, a) + token + ta.value.slice(b);
  const at = a + pairCaret(token);
  ta.focus();
  ta.setSelectionRange(at, at);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// 輸入框的游標往前（負數）或往後移幾格
export function moveCaret(ta: HTMLTextAreaElement | HTMLInputElement, d: number): void {
  const from = d < 0 ? (ta.selectionStart ?? 0) : (ta.selectionEnd ?? ta.value.length);
  const p = Math.max(0, Math.min(ta.value.length, from + d));
  ta.focus();
  ta.setSelectionRange(p, p);
}
