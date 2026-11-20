// 設定頁的「自訂分頁與按鈕群組」：顯示／隱藏分頁與群組，以及每個群組的名稱、順序、所在分頁。
// 從 main.ts 獨立出來是為了能在介面測試裡實際操作（main.ts 整個外掛進入點沒辦法放進測試）
import { setIcon } from 'obsidian';
import { t } from './i18n.js';
import { TABS, tabName, groupLayout, moveGroup, moveGroupToTab } from './ribbon.js';
import type { I18nKey } from './i18n.js';
import type { TabId, GroupId } from './ribbon.js';

// 這一塊會讀寫的設定欄位（main.ts 的 Settings 的一部分）
export interface GroupSettings {
  hiddenTabs: TabId[];
  hiddenGroups: GroupId[];
  groupNames: Partial<Record<GroupId, string>>;
  groupTabs: Partial<Record<GroupId, TabId>>;
  groupOrder: GroupId[];
  tabLabels: Partial<Record<TabId, string>>;
}

// 在 grid（設定頁的格線容器）裡畫出每個分頁一欄、每個群組一列的清單。
// 直接改 S；每次改完呼叫 changed()（存檔並重建功能區）
export function fillGroupSettings(grid: HTMLElement, S: GroupSettings, changed: () => void): void {
  // 自己的外框佔滿整列。調順序或換分頁後整個重畫（群組會換位置）
  const list = grid.createDiv('wm-settings-glist');
  // focus：重畫後把鍵盤焦點放回同一個群組的同一個控制項（不然按一次箭頭焦點就不見了）
  const draw = (focus?: { id: GroupId; cls: string }) => {
    list.empty();
    const layout = groupLayout(S);
    for (const [tab, tabLabel] of TABS) {
      const col = list.createDiv('wm-settings-groups-col');
      col.dataset.tab = tab;
      const tl = col.createEl('label', { cls: 'wm-settings-tab' });
      const tcb = tl.createEl('input', { type: 'checkbox' });
      const shown = !(S.hiddenTabs || []).includes(tab);
      tcb.checked = shown;
      tl.createSpan({ text: tabName(tab, tabLabel, S.tabLabels) });
      tcb.addEventListener('change', () => {
        const set = new Set(S.hiddenTabs || []);
        if (tcb.checked) set.delete(tab); else set.add(tab);
        S.hiddenTabs = [...set];
        changed();
        draw();
      });
      const mine = layout.filter(g => g.tab === tab);
      // 群組都移走的分頁仍然列出來，才能再把群組移回來
      if (!mine.length) col.createDiv({ cls: 'wm-settings-gempty', text: t('這個分頁沒有群組') });
      mine.forEach((g, i) => {
        const r = col.createDiv('wm-settings-grow');
        r.dataset.group = g.id;
        const cb = r.createEl('input', { type: 'checkbox' });
        cb.checked = !(S.hiddenGroups || []).includes(g.id);
        cb.disabled = !shown;
        cb.setAttribute('aria-label', t('顯示這個群組'));
        cb.addEventListener('change', () => {
          const set = new Set(S.hiddenGroups || []);
          if (cb.checked) set.delete(g.id); else set.add(g.id);
          S.hiddenGroups = [...set];
          changed();
        });
        // 名稱：留白時顯示預設名稱（placeholder）；改過名稱後，提示裡仍看得到原本是哪個群組
        const input = r.createEl('input', { type: 'text', cls: 'wm-settings-gname' });
        input.placeholder = t(g.label);
        input.value = (S.groupNames || {})[g.id] || '';
        input.maxLength = 20;
        input.setAttribute('aria-label', t('群組名稱') + t('：') + t(g.label));
        input.addEventListener('change', () => {
          const names = Object.assign({}, S.groupNames);
          const v = input.value.trim();
          if (v) names[g.id] = v; else delete names[g.id];
          S.groupNames = names;
          changed();
        });
        const sel = r.createEl('select', { cls: 'dropdown wm-settings-gtab' });
        for (const [id, label] of TABS) sel.createEl('option', { value: id, text: tabName(id, label, S.tabLabels) });
        sel.value = g.tab;
        sel.setAttribute('aria-label', t('移到分頁'));
        sel.addEventListener('change', () => {
          Object.assign(S, moveGroupToTab(S, g.id, sel.value as TabId));
          changed();
          draw({ id: g.id, cls: 'wm-settings-gtab' });
        });
        const move = (dir: -1 | 1, icon: string, label: I18nKey, cls: string, off: boolean) => {
          const b = r.createEl('button', { cls: 'clickable-icon wm-settings-gmove ' + cls });
          b.type = 'button';
          setIcon(b, icon);
          b.setAttribute('aria-label', t(label));
          b.disabled = off;
          b.addEventListener('click', () => {
            const order = moveGroup(S, g.id, dir);
            if (!order) return;
            S.groupOrder = order;
            changed();
            draw({ id: g.id, cls });
          });
        };
        move(-1, 'arrow-up', '上移', 'wm-settings-gup', i === 0);
        move(1, 'arrow-down', '下移', 'wm-settings-gdown', i === mine.length - 1);
      });
    }
    const reset = list.createEl('button', { cls: 'wm-settings-greset', text: t('還原預設的群組名稱與排列') });
    reset.type = 'button';
    reset.disabled = !Object.keys(S.groupNames || {}).length && !Object.keys(S.groupTabs || {}).length && !(S.groupOrder || []).length;
    reset.addEventListener('click', () => {
      S.groupNames = {}; S.groupTabs = {}; S.groupOrder = [];
      changed();
      draw();
    });
    if (focus) {
      const row = [...list.querySelectorAll<HTMLElement>('.wm-settings-grow')].find(x => x.dataset.group === focus.id);
      const ctl = row && row.querySelector<HTMLButtonElement | HTMLSelectElement>('.' + focus.cls);
      // 移到最前或最後時那個箭頭會停用，改把焦點放到另一個箭頭
      const alt = row && row.querySelector<HTMLButtonElement>('.wm-settings-gmove:not(:disabled)');
      if (ctl && !ctl.disabled) ctl.focus(); else if (alt) alt.focus();
    }
  };
  draw();
}
