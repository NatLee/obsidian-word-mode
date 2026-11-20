// 兩條功能區共用的部分（Word 模式的 toolbar.ts、Markdown／閱讀模式的 mdbar.ts）：
// 分頁與群組的清單，以及套用使用者自訂之後的群組版面
import { t } from './i18n.js';
import { el } from './dom.js';
import type { IconFn } from './icons.js';
import type { I18nKey } from './i18n.js';

// 分頁 id（TABS 的第一欄；也是設定 hiddenTabs 存的值）
export type TabId = 'home' | 'insert' | 'review' | 'viewtab';
// 按鈕群組 id（GROUPS 的第一欄；也是設定 hiddenGroups 存的值）
export type GroupId =
  | 'undo' | 'clipboard' | 'styles' | 'font' | 'paragraph' | 'editing'
  | 'tables' | 'illustrations' | 'links' | 'code' | 'text' | 'obsidian'
  | 'proofing' | 'stats' | 'comments'
  | 'views' | 'show' | 'zoom' | 'help';
// [分頁 id, 分頁名稱（翻譯前的原文，顯示時再用 t() 翻譯）]
export type TabEntry = readonly [id: TabId, label: I18nKey];
// [群組 id, 所在分頁, 群組名稱（翻譯前的原文）]
export type GroupEntry = readonly [id: GroupId, tab: TabId, label: I18nKey];

// 設定裡的版面：分頁、全部排成一行、全部自動換行
export type RibbonLayout = 'tabs' | 'single' | 'wrap';
// 設定裡的按鈕樣式：自動（大按鈕才加文字）、只顯示圖示、圖示加文字
export type ButtonStyle = 'auto' | 'icon' | 'label';
// 分頁列的樣式：文字、圖示、圖示加文字、收成一個選單按鈕（不佔一列）
export type TabStyle = 'text' | 'icon' | 'both' | 'menu';

// 分頁與群組（設定頁用同一份清單，讓使用者勾選要顯示的項目）
export const TABS: readonly TabEntry[] = [['home', '常用'], ['insert', '插入'], ['review', '校閱'], ['viewtab', '檢視']];
export const GROUPS: readonly GroupEntry[] = [
  ['undo', 'home', '復原'], ['clipboard', 'home', '剪貼簿'], ['styles', 'home', '樣式'], ['font', 'home', '字型'],
  ['paragraph', 'home', '段落'], ['editing', 'home', '編輯'],
  ['tables', 'insert', '表格'], ['illustrations', 'insert', '圖例'], ['links', 'insert', '連結'], ['code', 'insert', '程式碼'],
  ['text', 'insert', '文字'], ['obsidian', 'insert', 'Obsidian'],
  ['proofing', 'review', '校對'], ['stats', 'review', '統計'], ['comments', 'review', '註解'],
  ['views', 'viewtab', '檢視模式'], ['show', 'viewtab', '顯示'], ['zoom', 'viewtab', '縮放'], ['help', 'viewtab', '說明'],
];

// 使用者自訂的按鈕群組（設定裡的三個欄位）。內容來自 data.json，可能有舊版留下或手改的值，所以鍵與值都當成一般字串，用的時候再檢查
export interface GroupCustom {
  // 群組 id → 自訂名稱；沒有或空白時用預設名稱
  groupNames?: Partial<Record<string, string>> | null;
  // 群組 id → 移到哪個分頁；沒有或不認得的分頁時留在預設分頁
  groupTabs?: Partial<Record<string, string>> | null;
  // 群組的順序（群組 id）；沒列到的群組排在所屬分頁的最後，彼此依預設順序
  groupOrder?: readonly string[] | null;
}
// 一個群組實際的位置與名稱：label 是預設名稱（翻譯前的原文），name 是要顯示的名稱
export interface GroupPlace { id: GroupId; tab: TabId; label: I18nKey; name: string; }

// 套用自訂之後的群組清單：先依分頁（TABS 的順序），同一個分頁裡依自訂的順序。
// 兩條功能區與設定頁都用這一份，所以改名、換分頁、調順序在三個地方一致
export function groupLayout(custom?: GroupCustom | null): GroupPlace[] {
  const c = custom || {};
  const tabIndex = new Map<string, number>(TABS.map(([id], i) => [id, i]));
  const order = new Map<string, number>();
  (c.groupOrder || []).forEach((id, i) => { if (!order.has(id)) order.set(id, i); });
  const list = GROUPS.map(([id, tab, label], i) => {
    const moved = c.groupTabs ? c.groupTabs[id] : null;
    const name = c.groupNames ? c.groupNames[id] : null;
    return {
      place: { id, tab: (moved && tabIndex.has(moved) ? moved : tab) as TabId, label, name: name && name.trim() ? name.trim() : t(label) },
      // 沒列在自訂順序裡的排在後面（新版本加的群組、或使用者沒調過順序）
      rank: order.has(id) ? order.get(id)! : GROUPS.length + i,
    };
  });
  list.sort((a, b) => tabIndex.get(a.place.tab)! - tabIndex.get(b.place.tab)! || a.rank - b.rank);
  return list.map(x => x.place);
}

// 把群組在所屬分頁裡往前（-1）或往後（1）移一格，回傳新的 groupOrder；已經在最前或最後時回傳 null
export function moveGroup(custom: GroupCustom | null | undefined, id: GroupId, dir: -1 | 1): GroupId[] | null {
  const list = groupLayout(custom);
  const i = list.findIndex(g => g.id === id);
  const j = i + dir;
  if (i < 0 || !list[j] || list[j].tab !== list[i].tab) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list.map(g => g.id);
}

// 把群組移到另一個分頁（排在該分頁最後），回傳新的 groupTabs 與 groupOrder
export function moveGroupToTab(custom: GroupCustom | null | undefined, id: GroupId, tab: TabId): { groupTabs: Partial<Record<GroupId, TabId>>; groupOrder: GroupId[] } {
  const layout = groupLayout(custom);
  // 從實際的位置重新整理：只留下不在預設分頁的群組（移回預設分頁就不留紀錄，不認得的舊值也順便清掉）
  const groupTabs: Partial<Record<GroupId, TabId>> = {};
  for (const [gid, home] of GROUPS) {
    const now = gid === id ? tab : layout.find(g => g.id === gid)!.tab;
    if (now !== home) groupTabs[gid] = now;
  }
  const groupOrder = layout.map(g => g.id).filter(x => x !== id);
  groupOrder.push(id);
  return { groupTabs, groupOrder };
}

// 分頁的圖示（分頁列樣式為「圖示」「圖示加文字」「收成選單」時顯示）
export const TAB_ICONS: Record<TabId, string> = { home: 'home', insert: 'plus-circle', review: 'spell-check', viewtab: 'eye' };

// 分頁顯示的名稱：使用者在設定裡自訂的名稱，沒有時用預設名稱
export function tabName(id: TabId, label: I18nKey, custom?: Partial<Record<string, string>> | null): string {
  const c = custom && custom[id];
  return c && c.trim() ? c.trim() : t(label);
}

// 在分頁按鈕裡放圖示與名稱（依分頁列的樣式）；只有圖示時名稱放在提示裡
export function fillTab(b: HTMLElement, id: TabId, name: string, style: TabStyle, icon: IconFn): void {
  b.replaceChildren();
  if (style !== 'text') icon(el('span', 'wm-tab-icon', b), TAB_ICONS[id], '');
  if (style !== 'icon' || !b.querySelector('svg')) el('span', 'wm-tab-text', b, name);
  if (style === 'icon') b.setAttribute('aria-label', name);
}