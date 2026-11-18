// 設定頁上方的分類列：設定分成幾類，一次只顯示一類。
// 從 main.ts 獨立出來是為了能在介面測試裡實際操作（main.ts 整個外掛進入點沒辦法放進測試）
import { setIcon } from 'obsidian';
import { t } from './i18n.js';

// 分類列的一個按鈕；label 是已翻譯的文字
export interface SettingNavItem<T extends string> { id: T; label: string; icon: string; }

// 畫好的分類列：el 是整條列；select 只更新按鈕的狀態（由外部換分類時用，不會呼叫 onPick）
export interface SettingNav<T extends string> { el: HTMLElement; select(id: T): void; }

// 讓 container（設定頁的外框）只顯示 id 這一類。
// 實際的隱藏寫在 CSS（.wm-settings[data-wm-tab="…"]）：不用 Obsidian 設定定義的 visible，
// 因為 visible 為 false 的群組會被排除在設定搜尋之外，其他分類的設定就搜尋不到了
export function showSettingSection(container: HTMLElement, id: string): void {
  container.dataset.wmTab = id;
}

// 分類列用 position: sticky 留在捲動範圍的上緣，但 sticky 是以外框的內容區為準：外框有上內距時，
// 分類列會停在內距下面，上方空出一截。這裡量出內距記在 --wm-set-pad，樣式表用它把分類列往上移到貼齊上緣。
// 設定頁還沒顯示時量不到，所以等到捲動（這時分類列才需要固定）再量，每次畫設定頁之後只量一次。
// 回傳的函式在重畫設定頁時呼叫，下次捲動會重新量（佈景主題可能換過）
export function trackSettingPadding(container: HTMLElement): () => void {
  let measured = false;
  container.addEventListener('scroll', () => {
    if (measured) return;
    measured = true;
    const pad = parseFloat(getComputedStyle(container).paddingTop);
    container.style.setProperty('--wm-set-pad', (pad > 0 ? pad : 0) + 'px');
  }, { passive: true });
  return () => { measured = false; };
}

// 在 host 裡畫出分類列。按下按鈕（或用方向鍵移動）時呼叫 onPick
export function buildSettingNav<T extends string>(host: HTMLElement, items: readonly SettingNavItem<T>[], active: T, onPick: (id: T) => void): SettingNav<T> {
  const bar = host.createDiv('wm-pills wm-set-tabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', t('設定分類'));
  const buttons = new Map<T, HTMLButtonElement>();
  const select = (id: T) => {
    for (const [k, b] of buttons) {
      const on = k === id;
      b.toggleClass('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      // 整條列只佔一個 Tab 停駐點，列內用方向鍵移動（頁籤的慣例）
      b.tabIndex = on ? 0 : -1;
    }
  };
  const pick = (id: T, focus?: boolean) => {
    select(id);
    if (focus) buttons.get(id)?.focus();
    onPick(id);
  };
  items.forEach((item, i) => {
    const b = bar.createEl('button', { cls: 'wm-pill wm-set-tab' });
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.tab = item.id;
    setIcon(b.createSpan('wm-pill-icon'), item.icon);
    b.createSpan({ text: item.label });
    b.addEventListener('click', () => pick(item.id));
    b.addEventListener('keydown', e => {
      const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1
          : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
      if (to == null) return;
      e.preventDefault();
      // Obsidian 的設定視窗自己也用方向鍵在各列之間移動，這裡處理掉就不要再往外傳
      e.stopPropagation();
      pick(items[(to + items.length) % items.length].id, true);
    });
    buttons.set(item.id, b);
  });
  select(active);
  return { el: bar, select };
}
