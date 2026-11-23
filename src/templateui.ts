// 設定頁裡管理「我的公式」「我的圖表範本」的清單：改名、改內容、調整順序、刪除、新增。
// 資料操作在 templates.ts（純函式）；這裡只負責畫面。
import { keyboardHints } from './dom.js';
import { Notice, setIcon } from 'obsidian';
import { t } from './i18n.js';
import { editTemplate, moveTemplate, removeTemplate, renameTemplate, saveTemplate, uniqueName, MAX_TEMPLATES } from './templates.js';
import type { SavedTemplate } from './templates.js';

export interface TemplateManagerOptions {
  // 目前的清單，以及把改過的清單存回設定
  get(): SavedTemplate[];
  set(list: SavedTemplate[]): void;
  // 「新增」按鈕的文字、新範本預設的名稱與內容、內容欄位的說明、沒有範本時顯示的文字（都是已翻譯的）
  addLabel: string;
  newName: string;
  newSrc: string;
  srcLabel: string;
  empty: string;
  // 名稱旁邊的小標籤（圖表的種類）；沒有就不顯示
  badge?(src: string): string;
  // 把內容顯示成結果（公式）；沒有就不顯示
  preview?(src: string, el: HTMLElement): void;
}

export function buildTemplateManager(box: HTMLElement, o: TemplateManagerOptions): void {
  // focus：重畫之後把游標放進第幾個範本的名稱（新增之後）
  const render = (focus = -1): void => {
    box.empty();
    const list = o.get();
    if (!list.length) box.createDiv({ cls: 'setting-item-description wm-tpl-empty', text: o.empty });
    list.forEach((item, i) => {
      const row = box.createDiv('wm-tpl-item');
      const head = row.createDiv('wm-tpl-head');
      const name = head.createEl('input', { type: 'text', cls: 'wm-tpl-name' });
      name.value = item.name;
      name.setAttribute('aria-label', t('範本名稱'));
      name.addEventListener('change', () => {
        const next = renameTemplate(o.get(), i, name.value);
        if (next[i].name === item.name && name.value.replace(/\s+/g, ' ').trim() !== item.name) {
          // 名稱是空的，或跟別的範本一樣：改回原本的
          new Notice(t('名稱不能是空的，也不能跟其他範本一樣'));
          name.value = item.name;
          return;
        }
        o.set(next);
        render();
      });
      const badge = o.badge ? o.badge(item.src) : '';
      if (badge) head.createSpan({ cls: 'wm-tpl-badge', text: badge });
      const tools = head.createDiv('wm-tpl-tools');
      const icon = (iconName: string, label: string, run: (b: HTMLButtonElement) => void, off?: boolean): HTMLButtonElement => {
        const b = tools.createEl('button', { cls: 'clickable-icon wm-tpl-btn' });
        b.type = 'button';
        b.setAttribute('aria-label', label);
        setIcon(b, iconName);
        b.disabled = !!off;
        b.addEventListener('click', () => run(b));
        return b;
      };
      icon('arrow-up', t('上移'), () => { o.set(moveTemplate(o.get(), i, -1)); render(); }, i === 0);
      icon('arrow-down', t('下移'), () => { o.set(moveTemplate(o.get(), i, 1)); render(); }, i === list.length - 1);
      // 刪除要按兩次：第一次按鈕變成「確定刪除？」，三秒內再按一次才刪（避免誤觸；刪掉就救不回來）
      let armed = 0;
      icon('trash-2', t('刪除這個範本'), b => {
        if (armed) { window.clearTimeout(armed); o.set(removeTemplate(o.get(), i)); render(); return; }
        b.addClass('is-armed');
        b.empty();
        b.setText(t('確定刪除？'));
        armed = window.setTimeout(() => { armed = 0; render(); }, 3000);
      });
      const src = keyboardHints(row.createEl('textarea', { cls: 'wm-tpl-src' }), { plain: true });
      src.value = item.src;
      src.spellcheck = false;
      src.rows = Math.max(2, Math.min(8, item.src.split('\n').length));
      src.setAttribute('aria-label', o.srcLabel);
      let pv: HTMLElement | null = null;
      if (o.preview) { pv = row.createDiv('wm-tpl-preview'); o.preview(item.src, pv); }
      src.addEventListener('change', () => {
        if (!src.value.trim()) { new Notice(t('內容不能是空的；不要這個範本的話請按刪除')); src.value = item.src; return; }
        o.set(editTemplate(o.get(), i, src.value));
        render();
      });
      if (i === focus) window.setTimeout(() => { name.focus(); name.select(); }, 0);
    });
    const add = box.createEl('button', { cls: 'wm-tpl-add', text: o.addLabel });
    add.type = 'button';
    add.disabled = list.length >= MAX_TEMPLATES;
    add.addEventListener('click', () => {
      const cur = o.get();
      o.set(saveTemplate(cur, uniqueName(cur, o.newName), o.newSrc));
      render(cur.length);
    });
  };
  render();
}
