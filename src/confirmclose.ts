// 編輯內容的對話框（方程式、圖表、原文）共用的基底：有還沒套用的修改時，按 Esc、點對話框外面、
// 或按右上角的 × 不直接關掉，先在對話框上方問一次。打了半天的公式不會因為手滑按到 Esc 就不見。
// Obsidian 的這三種關法最後都是呼叫 close()，所以只要接手 close()
import { Modal, setIcon } from 'obsidian';
import { t } from './i18n.js';

export abstract class EditingModal extends Modal {
  // 正在問要不要捨棄時的那一條；沒有在問時是 null
  private discardBar: HTMLElement | null = null;
  // 已經確定要關（按了對話框自己的取消／套用／刪除，或剛剛選了捨棄）
  private sure = false;

  // 目前的內容跟打開時不一樣
  abstract hasChanges(): boolean;

  // 對話框自己的取消、套用、刪除用這個：使用者已經表明要關，不用再問
  closeNow(): void {
    this.sure = true;
    this.close();
  }

  close(): void {
    if (this.sure) { this.discardBar = null; super.close(); return; }
    // 已經在問了又按一次 Esc（或又點了外面）：當成「不關了」，回去繼續編輯
    if (this.discardBar) { this.keepEditing(); return; }
    let changed = false;
    try { changed = this.hasChanges(); } catch { changed = false; }
    if (!changed) { super.close(); return; }
    this.askDiscard();
  }

  private askDiscard(): void {
    const back = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    // 用 contentEl 建立（不是全域的 createDiv）：筆記在獨立視窗時，對話框屬於那個視窗的文件
    const bar = this.discardBar = this.contentEl.createDiv('wm-banner wm-discard');
    bar.setAttribute('role', 'alert');
    const msg = bar.createDiv('wm-banner-text');
    setIcon(msg.createSpan('wm-banner-icon'), 'alert-triangle');
    msg.createSpan({ text: t('還沒套用的修改會不見，要關閉嗎？') });
    const actions = bar.createDiv('wm-banner-actions');
    const keep = actions.createEl('button', { text: t('繼續編輯'), cls: 'mod-cta' });
    keep.addEventListener('click', () => this.keepEditing(back));
    actions.createEl('button', { text: t('捨棄修改'), cls: 'mod-warning' }).addEventListener('click', () => this.closeNow());
    this.contentEl.prepend(bar);
    // 焦點放在「繼續編輯」：這時再按 Enter 是留下來，不會誤關
    keep.focus();
  }

  private keepEditing(back?: HTMLElement | null): void {
    if (this.discardBar) this.discardBar.remove();
    this.discardBar = null;
    if (back && back.isConnected) back.focus();
  }
}
