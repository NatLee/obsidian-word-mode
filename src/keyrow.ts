// 手機、平板的控制鍵列：螢幕鍵盤沒有方向鍵、Tab、Esc、Ctrl（⌘），這一排補上。
// 功能區（RibbonShell，Word 模式與 Markdown 模式共用）在「收起鍵盤」左邊放一顆開關，按下去在按鈕列上方展開這一排。
// 鍵盤收著時沒有打字的地方，開關與這一排都不顯示（樣式表的 wm-kb-up）；展開與否記著，下次鍵盤出來時照樣
// - 方向鍵、Home、End：各模式自己移動游標（move）；Shift 開著時延伸選取。按住不放會連續移動
// - Tab、Esc：送一個鍵盤事件給正在打字的地方（ProseMirror、CodeMirror 都照自己的快速鍵處理）
// - Ctrl（Apple 的裝置是 ⌘）、Shift：點一下作用在下一個鍵、連點兩下鎖住、再點一下取消（像 iOS 的 Shift）。
//   Ctrl 開著時用螢幕鍵盤打一個字，改送成快速鍵（例如 Ctrl＋B 粗體、Ctrl＋Z 復原）
import { Platform } from 'obsidian';
import { el, keepFocus } from './dom.js';
import { t } from './i18n.js';
import type { I18nKey } from './i18n.js';

export type KeyId = 'esc' | 'tab' | 'mod' | 'shift' | 'left' | 'up' | 'down' | 'right' | 'home' | 'end';
export type MoveKey = 'left' | 'up' | 'down' | 'right' | 'home' | 'end';
export const KEY_IDS: readonly KeyId[] = ['esc', 'tab', 'mod', 'shift', 'left', 'up', 'down', 'right', 'home', 'end'];
const MOVE_KEYS: readonly KeyId[] = ['left', 'up', 'down', 'right', 'home', 'end'];
export interface KeyMods { mod: boolean; shift: boolean; }

// Apple 的裝置（macOS、iPhone、iPad）上 Mod 是 ⌘（跟 ProseMirror、Obsidian 的快速鍵一樣），其他是 Ctrl
export const APPLE = !!(Platform.isMacOS || Platform.isIosApp);

// 每顆鍵的名稱（螢幕閱讀器與設定頁用）與顯示的字或圖示
export const KEY_LOOK: Record<KeyId, { label: I18nKey; text?: string; icon?: string }> = {
  esc: { label: 'Esc', text: 'Esc' },
  tab: { label: 'Tab', text: 'Tab' },
  mod: { label: 'Ctrl', text: APPLE ? '⌘' : 'Ctrl' },
  shift: { label: 'Shift', icon: 'arrow-big-up', text: '⇧' },
  left: { label: '游標往左', icon: 'arrow-left', text: '←' },
  up: { label: '游標往上一行', icon: 'arrow-up', text: '↑' },
  down: { label: '游標往下一行', icon: 'arrow-down', text: '↓' },
  right: { label: '游標往右', icon: 'arrow-right', text: '→' },
  home: { label: 'Home', text: 'Home' },
  end: { label: 'End', text: 'End' },
};

// 設定裡的鍵（使用者可以拿掉用不到的）：照固定的順序，認不得的、重複的拿掉；不是清單（舊版沒有這個設定）時全部顯示
export function keyRowKeys(v: unknown): KeyId[] {
  if (!Array.isArray(v)) return [...KEY_IDS];
  return KEY_IDS.filter(k => v.includes(k));
}

// 按住移動鍵多久開始連續移動、之後每隔多久走一格（毫秒）
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 70;

export interface KeyRowOptions {
  keys: readonly KeyId[];
  icon: (el: HTMLElement, name: string, fallback: string) => void;
  // 方向鍵、Home、End：移動游標或延伸選取（mods.shift）；回傳 false 表示走不動（連續移動時停下來）
  move(key: MoveKey, mods: KeyMods): boolean;
}

// 送一個鍵盤事件給正在打字的地方（不是使用者真的按的鍵，瀏覽器不會自己動作，編輯器的快速鍵照常處理）
export function sendKey(target: Element | null, key: string, mods: KeyMods): boolean {
  if (!target) return false;
  const ev = new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
    shiftKey: mods.shift, metaKey: mods.mod && APPLE, ctrlKey: mods.mod && !APPLE,
  });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

export class KeyRow {
  declare el: HTMLDivElement;
  // 修飾鍵的狀態：0 沒開、1 作用在下一個鍵、2 鎖住
  declare state: { mod: 0 | 1 | 2; shift: 0 | 1 | 2 };
  declare buttons: Map<KeyId, HTMLButtonElement>;
  declare onInput: (e: InputEvent) => void;

  constructor(parent: HTMLElement, readonly opts: KeyRowOptions) {
    this.el = el('div', 'wm-keyrow', parent);
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', t('控制鍵'));
    this.state = { mod: 0, shift: 0 };
    this.buttons = new Map();
    for (const k of opts.keys) this.addKey(k);
    // Ctrl 開著時打的字改送成快速鍵。掛在 document 的捕獲階段：比編輯器先收到，才擋得掉這個字
    const doc = parent.ownerDocument;
    this.onInput = e => {
      if (!this.state.mod || e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
      const target = e.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      e.preventDefault();
      sendKey(target, e.data, this.mods());
      this.release();
    };
    doc.addEventListener('beforeinput', this.onInput as EventListener, true);
  }

  mods(): KeyMods { return { mod: !!this.state.mod, shift: !!this.state.shift }; }

  addKey(k: KeyId): void {
    const look = KEY_LOOK[k];
    const b = el('button', 'wm-key is-' + k, this.el);
    b.type = 'button';
    b.setAttribute('aria-label', t(look.label));
    if (look.icon) this.opts.icon(b, look.icon, look.text || '');
    else b.textContent = look.text || '';
    // 按鍵不能搶走打字位置的焦點（螢幕鍵盤會收起來）
    keepFocus(b);
    this.buttons.set(k, b);
    if (k === 'mod' || k === 'shift') {
      b.addEventListener('click', () => { this.state[k] = ((this.state[k] + 1) % 3) as 0 | 1 | 2; this.paint(); });
      return;
    }
    if (MOVE_KEYS.includes(k)) {
      this.repeat(b, () => this.opts.move(k as MoveKey, this.mods()));
      return;
    }
    b.addEventListener('click', () => {
      sendKey(b.ownerDocument.activeElement, k === 'esc' ? 'Escape' : 'Tab', this.mods());
      this.release();
    });
  }

  // 點一下執行一次；按住 REPEAT_DELAY 之後每 REPEAT_EVERY 執行一次，走不動就停。放開後那一下點擊不再多走一格
  repeat(b: HTMLButtonElement, step: () => boolean): void {
    const win = b.ownerDocument.defaultView || window;
    let wait = 0; let loop = 0; let repeated = false;
    const stop = (): void => { win.clearTimeout(wait); win.clearInterval(loop); wait = 0; loop = 0; };
    b.addEventListener('click', () => {
      if (repeated) { repeated = false; return; }
      step();
      this.release();
    });
    b.addEventListener('pointerdown', () => {
      stop(); repeated = false;
      wait = win.setTimeout(() => {
        repeated = true;
        if (!step()) return;
        loop = win.setInterval(() => { if (!step()) stop(); }, REPEAT_EVERY);
      }, REPEAT_DELAY);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { if (loop || wait) { stop(); if (repeated) this.release(); } });
  }

  // 用過一次的修飾鍵放開（鎖住的留著）
  release(): void {
    if (this.state.mod === 1) this.state.mod = 0;
    if (this.state.shift === 1) this.state.shift = 0;
    this.paint();
  }

  paint(): void {
    for (const k of ['mod', 'shift'] as const) {
      const b = this.buttons.get(k);
      if (!b) continue;
      b.classList.toggle('is-on', this.state[k] === 1);
      b.classList.toggle('is-locked', this.state[k] === 2);
      b.setAttribute('aria-pressed', this.state[k] ? 'true' : 'false');
    }
  }

  destroy(): void {
    this.el.ownerDocument.removeEventListener('beforeinput', this.onInput as EventListener, true);
    this.el.remove();
  }
}
