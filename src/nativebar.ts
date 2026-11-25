// Obsidian 自己的手機工具列（Markdown 模式打字時出現在鍵盤上方；設定「Markdown 模式打字時讓出 Obsidian 的工具列」開著時，
// 這個外掛的工具列會讓給它）：加上跟 Word 模式一樣的控制鍵與觸控板。
// - 控制鍵的開關：做成跟 Obsidian「切換鍵盤」一樣的圓形按鈕（用 Obsidian 的類別，外觀跟著佈景主題），放在它左邊
// - 控制鍵列：放在工具列正上方；開著時把 Obsidian 留給工具列的空間（.mobile-toolbar-spacer）加高一列，編輯區不會被蓋住
// - 觸控板：在 Obsidian 的按鈕列上按住一下再拖，移動游標（trackpad.ts）
// 工具列的 DOM 不是公開 API：找不到（Obsidian 改版）時什麼都不做，只是少這些功能
import { MarkdownView, Platform } from 'obsidian';
import type { Editor } from 'obsidian';
import { el, keepFocus } from './dom.js';
import { iconOr } from './icons.js';
import { t } from './i18n.js';
import { KeyRow, keyRowKeys } from './keyrow.js';
import { installTrackpad, padHold } from './trackpad.js';
import { editorKeyMove, editorStep, padPosition } from './mdbar.js';
import type WordModePlugin from './main.js';

export class NativeBar {
  // 裝上去的 Obsidian 工具列（.mobile-toolbar）與加進去的元素
  wrapper: HTMLElement | null = null;
  toggle: HTMLElement | null = null;
  row: KeyRow | null = null;

  constructor(readonly plugin: WordModePlugin) {}

  // 正在編輯的 Obsidian 編輯器（Markdown 檢視的編輯模式；其他地方嵌入的編輯器也算）
  editor(): Editor | null {
    const ws = this.plugin.app.workspace;
    const info = ws.activeEditor;
    if (info && info.editor) return info.editor;
    const v = ws.getActiveViewOfType(MarkdownView);
    return v && v.getMode() === 'source' ? v.editor : null;
  }

  // 找到 Obsidian 的手機工具列就裝上（它只建立一次，顯示、隱藏時接上或拿下）。可以重複呼叫：已經裝好就只更新開關的狀態
  sync(): void {
    if (!Platform.isMobile) return;
    const mt = this.plugin.app.mobileToolbar;
    const w = (mt && mt.wrapperEl) || activeDocument.querySelector<HTMLElement>('.mobile-toolbar');
    if (w && w !== this.wrapper) { this.remove(); this.wrapper = w; this.install(w); }
    this.paint();
  }

  install(w: HTMLElement): void {
    const S = this.plugin.settings;
    const container = w.querySelector<HTMLElement>('.mobile-toolbar-options-container');
    const list = w.querySelector<HTMLElement>('.mobile-toolbar-options-list-container');
    if (S.keyRow !== false && container) {
      this.row = new KeyRow(w, { keys: keyRowKeys(S.keyRowKeys), icon: iconOr, move: (k, m) => { const ed = this.editor(); return !!ed && editorKeyMove(ed, k, m); } });
      this.row.el.addClass('wm-native-keyrow');
      const box = el('div', 'mobile-toolbar-floating-options mod-raised wm-native-keys');
      const b = el('div', 'mobile-toolbar-option', box);
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', t('控制鍵'));
      iconOr(b, 'move', '⌨');
      keepFocus(b);
      b.addEventListener('click', e => { e.preventDefault(); this.setOpen(!this.plugin.settings.keyRowOpen); });
      // 放在 Obsidian「切換鍵盤」那顆的左邊；沒有那顆（Android）就放最後
      container.insertBefore(box, container.querySelector('.mobile-toolbar-floating-options'));
      this.toggle = box;
    }
    // 觸控板只裝一次（事件拿不掉）；設定關掉時 focused() 回傳 false，不會啟動
    if (list && !list.dataset.wmPad) {
      list.dataset.wmPad = 'true';
      let pos: ReturnType<typeof padPosition> | null = null;
      installTrackpad(list, () => padHold(this.plugin.settings.padHold), {
        focused: () => { const ed = this.editor(); return this.plugin.settings.padRow !== false && !!ed && ed.hasFocus(); },
        speed: () => this.plugin.settings.padSpeed,
        // 沒有放大鏡：工具列上方顯示游標的位置與旁邊的字（mdbar.ts 的 padPosition）
        begin: () => { const ed = this.editor(); pos = ed ? padPosition(list, ed) : null; },
        step: (nx, ny) => { const ed = this.editor(); if (ed) editorStep(ed, nx, ny); if (pos) pos.update(); },
        end: () => { if (pos) { pos.remove(); pos = null; } },
      });
    }
  }

  setOpen(open: boolean): void {
    this.plugin.settings.keyRowOpen = open;
    void this.plugin.saveSettings();
    this.paint();
  }

  // 照設定開關控制鍵列、開關按鈕亮不亮、要不要把 Obsidian 留給工具列的空間加高
  paint(): void {
    const open = !!this.row && !!this.plugin.settings.keyRowOpen;
    if (this.row) this.row.el.toggleClass('is-open', open);
    if (this.toggle) this.toggle.toggleClass('is-active', open);
    this.body().toggleClass('wm-native-keys-open', open);
  }

  remove(): void {
    if (this.row) { this.row.destroy(); this.row = null; }
    if (this.toggle) { this.toggle.remove(); this.toggle = null; }
    this.body().removeClass('wm-native-keys-open');
    this.wrapper = null;
  }

  // 工具列所在視窗的 body（加高工具列空間的類別放在這裡）
  body(): HTMLElement { return (this.wrapper ? this.wrapper.ownerDocument : activeDocument).body; }

  // 設定改了（要不要控制鍵、哪些鍵）：拿掉重裝
  refresh(): void { this.remove(); this.sync(); }
}
