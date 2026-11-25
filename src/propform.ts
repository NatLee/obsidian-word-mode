// 文件屬性的表單：每一列（依類型的欄位、標籤、核取方塊…）、新增屬性、換類型、改名。
// Word 模式文件開頭的文件屬性（nodeviews.ts 的 FrontmatterView）與手機的「查看文件屬性」視窗（propview.ts 的 showProps）
// 共用這一份；資料從哪裡讀、寫回哪裡由 host 決定（Word 模式是編輯器的節點，Markdown 模式是筆記開頭的 YAML）
import { t } from './i18n.js';
import { el, onPress, keyboardHints } from './dom.js';
import { propType, isTagKey, summarize, propLink, convertProp, renameProp, PROP_ICONS as TYPE_ICON } from './props.js';
import type { PropType } from './props.js';
import type { I18nKey } from './i18n.js';
import type { NodeViewContext, NodeViewMenuItem, PropValues } from './nodeviews.js';

// 按住 Ctrl／Cmd（開在新分頁）
const isMod = (e: MouseEvent | KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

// 不是 <button> 的元素當按鈕或連結用：讓 Tab 走得到，也讓輔助工具知道它能按。
// 不直接換成 <button>：Obsidian 與佈景主題給 button 的底色、陰影、高度會跑出來，樣子就變了
export function focusable(target: HTMLElement, role: 'button' | 'link'): void {
  target.setAttribute('role', role);
  target.tabIndex = 0;
}

// ctx.menu 照滑鼠事件的位置開選單。用鍵盤開的時候沒有滑鼠位置：改給一個位置在控制項左下角的滑鼠事件。
// 用 Enter、空白鍵按 <button> 時，瀏覽器送的是 click，但沒有滑鼠位置（detail 是 0）
export function menuEvent(e: MouseEvent | KeyboardEvent, anchor: HTMLElement): MouseEvent {
  if (e.type !== 'keydown' && !(e.type === 'click' && e.detail === 0)) return e as MouseEvent;
  const r = anchor.getBoundingClientRect();
  return new MouseEvent('click', { clientX: r.left, clientY: r.bottom, view: anchor.ownerDocument.defaultView });
}

// 文件屬性（frontmatter / metadata）：像 Word 的「摘要資訊」，以表單編輯，存回 YAML。
// 類型的判斷與轉換在 props.ts。
const TYPE_LABEL: Record<PropType, string> = { text: t('文字'), list: t('清單'), number: t('數字'), checkbox: t('核取方塊'), date: t('日期'), datetime: t('日期時間'), object: t('其他') };
// 可以從選單換成的類型（巢狀資料只能用原文編輯）
const EDITABLE_TYPES: Exclude<PropType, 'object'>[] = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];

// 重畫時把元素整批換新的區塊，用這個留住焦點（不然改一個值、按一顆按鈕，焦點就掉到整個視窗上，鍵盤接不下去）。
// 畫的時候替每個能取得焦點的控制項取一個重畫前後不變的名稱（keep），重畫之後焦點回到同名的控制項
export class FocusKeeper {
  // 這一次畫出來的控制項，依畫面上的順序
  declare now: Map<string, HTMLElement>;
  // 每個登記過的元素叫什麼；已經被換掉的舊元素也要認得（follow 用）
  declare names: WeakMap<EventTarget, string>;
  constructor() { this.now = new Map(); this.names = new WeakMap(); }
  keep<T extends HTMLElement>(name: string, target: T): T {
    this.now.set(name, target);
    this.names.set(target, name);
    return target;
  }
  // 執行 draw（把 root 裡的元素換新，並用 keep 登記新的控制項）；焦點原本在 root 的某個控制項上就接回去
  redraw(root: HTMLElement, draw: () => void): void {
    const active = root.ownerDocument.activeElement;
    const name = active ? this.names.get(active) : undefined;
    const order = [...this.now.keys()];
    const had = name != null && this.now.get(name) === active;
    // 文字欄位才有游標位置（數字、日期欄位讀不到）
    const field = had && (active as HTMLInputElement).type === 'text' ? active as HTMLInputElement : null;
    const caret = field ? { value: field.value, start: field.selectionStart, end: field.selectionEnd } : null;
    this.now = new Map();
    draw();
    if (!had) return;
    // 原本的控制項不在了（刪掉的那一列、最後一個標籤的 ×）：給畫面上接在它後面的那一個，後面沒有就往前找
    const at = order.indexOf(name);
    const next = [name, ...order.slice(at + 1), ...order.slice(0, at).reverse()].find(n => this.now.has(n));
    const target = next != null ? this.now.get(next) : undefined;
    if (!target) return;
    target.focus({ preventScroll: true });
    // 同一個欄位、內容也沒變：游標放回原來的位置
    if (next === name && caret && (target as HTMLInputElement).value === caret.value) (target as HTMLInputElement).setSelectionRange(caret.start, caret.end);
  }
  // 焦點正要移過去的元素（blur 事件的 relatedTarget）已經在重畫時被換掉了：接到新畫出來的同名控制項。
  // 離開輸入框時才存檔、重畫的欄位會這樣：重畫發生在焦點移過去之前，使用者按 Tab 或用滑鼠點的那個控制項就不在了
  follow(next: EventTarget | null): void {
    const name = next ? this.names.get(next) : undefined;
    const target = name != null ? this.now.get(name) : undefined;
    if (target && target !== next) target.focus({ preventScroll: true });
  }
}

export interface PropsFormHost {
  ctx: Pick<NodeViewContext, 'icon' | 'menu' | 'prompt' | 'openLink' | 'propertyType'>;
  // 寫回整份屬性（之後由 host 決定要不要呼叫 render 重畫）
  commit(obj: PropValues): void;
  // 整塊重畫（元素換新，焦點由 keeper 接回去）
  render(): void;
}

export class PropsForm {
  keeper = new FocusKeeper();
  // 畫了幾次。每一列記著自己是第幾次畫的，整塊重畫之後那一列就作廢（見 row 的 set）
  drawn = 0;
  // 這次存檔先不重畫（人可能還在欄位裡，見 row 的 save）
  quiet = false;
  constructor(private host: PropsFormHost) {}
  // 每個屬性一列，最後是新增屬性的那一列
  fill(body: HTMLElement, obj: PropValues): void {
    for (const key of Object.keys(obj)) this.row(body, obj, key);
    this.addRow(body, obj);
  }
  row(body: HTMLElement, obj: PropValues, key: string): void {
    const value = obj[key];
    const type = propType(key, value, this.host.ctx.propertyType && this.host.ctx.propertyType(key));
    const r = el('div', 'wm-prop wm-prop-' + type, body);
    const k = el('div', 'wm-prop-key', r);
    // 整塊重畫之後，這一列的元素已經不在畫面上，手上的 obj 也是舊的：不能再存。
    // 被換掉的輸入框還會收到 change、blur（瀏覽器拿掉有焦點的元素時送出）；放著不管，打到一半的內容會連同那份舊資料
    // 一起存回去，把文件裡新的內容蓋掉（例如筆記剛被同步改過）
    const drawn = this.drawn;
    const set = (nv: unknown): void => {
      if (drawn !== this.drawn) return;
      const o = Object.assign({}, obj); o[key] = nv; this.host.commit(o);
    };
    // 這一列的控制項在重畫前後的名稱：種類＋屬性名稱（清單裡的再加第幾個）
    const keep = <T extends HTMLElement>(kind: string, target: T, i?: number): T => this.keeper.keep(kind + '\n' + key + (i == null ? '' : '\n' + i), target);
    // 類型圖示：點一下換類型或改名
    const ic = keep('type', el('button', 'wm-prop-icon', k)); ic.type = 'button'; this.host.ctx.icon(ic, TYPE_ICON[type], '');
    ic.setAttribute('aria-label', t('變更類型或重新命名'));
    onPress(ic, e => this.keyMenu(menuEvent(e, ic), obj, key, type));
    const name = el('span', 'wm-prop-name', k, key);
    name.addEventListener('dblclick', e => { e.preventDefault(); this.rename(obj, key); });
    // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    name.setAttribute('aria-label', key + t('（') + t(TYPE_LABEL[type] as I18nKey) + t('）'));
    const v = el('div', 'wm-prop-value', r);
    if (type === 'list') {
      const arr: unknown[] = Array.isArray(value) ? value.slice() : (value == null || value === '' ? [] : [value]);
      const tag = isTagKey(key);
      arr.forEach((item, i) => {
        const link = propLink(item);
        const chip = el('span', 'wm-chip' + (tag ? ' wm-chip-tag' : '') + (link ? ' wm-chip-link' : ''), v);
        const text = summarize(item);
        const label = el('span', 'wm-chip-text', chip, link ? link.text : (tag && !text.startsWith('#') ? '#' : '') + text);
        if (link) { focusable(keep('link', label, i), 'link'); this.linkify(label, link.target); }
        const x = keep('unlist', el('span', 'wm-chip-x', chip, '×'), i);
        x.setAttribute('aria-label', t('移除'));
        focusable(x, 'button');
        onPress(x, () => { const a = arr.slice(); a.splice(i, 1); set(a); });
      });
      const inp = keep('value', el('input', 'wm-prop-input wm-chip-input', v));
      inp.placeholder = t('新增…');
      // 標籤、別名：不自動大寫；Enter 是「加入這一項」
      inp.setAttribute('autocapitalize', 'off');
      keyboardHints(inp, { enter: 'done' });
      const add = () => {
        const tv = inp.value.trim().replace(/^#/, '');
        if (!tv) return;
        // [[筆記|別名]] 裡的逗號不是分隔
        set(arr.concat(/^\[\[.*\]\]$/.test(tv) ? [tv] : tv.split(/[,，]\s*/).filter(Boolean)));
      };
      // isComposing：輸入法選字中的 Enter 是確定選字，不是加入這一項
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
      inp.addEventListener('blur', e => { add(); this.keeper.follow(e.relatedTarget); });
    } else if (type === 'checkbox') {
      const cb = keep('value', el('input', 'wm-prop-check', v)); cb.type = 'checkbox'; cb.checked = !!value;
      cb.addEventListener('change', () => set(cb.checked));
    } else if (type === 'object') {
      // 巢狀資料：照結構一層一層列出來（唯讀），要改請用「原文」
      this.tree(v, value);
      v.setAttribute('aria-label', t('巢狀資料請用「原文」編輯'));
    } else {
      const inp = keep('value', el('input', 'wm-prop-input', v));
      inp.type = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text';
      if (type === 'number') keyboardHints(inp, { mode: 'decimal' });
      // 文字、數字、日期欄位的值是 YAML 的純量（文字、數字或布林）
      const scalar = value as string | number | boolean | null | undefined;
      inp.value = scalar == null ? '' : String(scalar).slice(0, type === 'datetime' ? 16 : undefined);
      inp.placeholder = t('（空白）');
      // 這個欄位目前存在文件裡的值
      let saved = value;
      const save = () => {
        let nv: string | number | null = inp.value;
        if (type === 'number') nv = nv === '' ? null : Number(nv);
        else if (nv === '') nv = null;
        if (nv === saved || (nv === null && saved == null)) return;
        saved = nv;
        // 先存檔、不重畫，離開欄位（blur）時才畫。日期欄位每改完一段（年、月、日）、數字欄位每按一次上下鍵，
        // 瀏覽器就送出 change，人還在欄位裡；這時重畫會把欄位換成新的，打到一半就斷了。
        // 沒重畫，其他列手上的 obj（同一個物件）就要跟著改，否則它們下次存檔會把這個值蓋回去
        obj[key] = nv;
        this.quiet = true;
        try { set(nv); } finally { this.quiet = false; }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('change', save);
      inp.addEventListener('blur', e => {
        // 改過才重畫（值變了，類型、旁邊的開啟按鈕可能跟著變）；這一列已經作廢（整塊重畫過）就不用
        if (saved !== value && drawn === this.drawn) this.host.render();
        this.keeper.follow(e.relatedTarget);
      });
      // 值是 [[筆記]] 或網址：旁邊放一個開啟的按鈕
      const link = type === 'text' ? propLink(value) : null;
      if (link) {
        const open = keep('open', el('button', 'wm-prop-open', v)); open.type = 'button'; this.host.ctx.icon(open, 'external-link', '↗');
        open.setAttribute('aria-label', t('開啟連結'));
        this.linkify(open, link.target);
      }
    }
    const del = keep('delete', el('button', 'wm-prop-del', r)); del.type = 'button'; del.setAttribute('aria-label', t('刪除這個屬性')); this.host.ctx.icon(del, 'x', '×');
    onPress(del, () => { const o = Object.assign({}, obj); delete o[key]; this.host.commit(o); });
  }
  // 點一下（或按 Enter）開啟連結；按住 Ctrl／Cmd 或 Shift 開在新分頁
  linkify(target: HTMLElement, link: string): void {
    onPress(target, e => { e.stopPropagation(); this.host.ctx.openLink(link, isMod(e) || e.shiftKey); });
  }
  // 巢狀資料的唯讀樹狀顯示
  tree(parent: HTMLElement, value: unknown): void {
    const box = el('div', 'wm-prop-tree', parent);
    const entries: [string, unknown][] = Array.isArray(value) ? value.map((item, i): [string, unknown] => [String(i + 1), item]) : Object.entries(value as PropValues);
    for (const [k, item] of entries) {
      const row = el('div', 'wm-prop-tree-row', box);
      el('span', 'wm-prop-tree-key', row, k);
      if (item && typeof item === 'object' && !(item instanceof Date)) this.tree(row, item);
      else el('span', 'wm-prop-tree-value', row, summarize(item));
    }
  }
  // 類型圖示的選單：換類型（內容盡量保留）、重新命名
  keyMenu(e: MouseEvent, obj: PropValues, key: string, type: PropType): void {
    const items: NodeViewMenuItem[] = [];
    if (type !== 'object') {
      for (const ty of EDITABLE_TYPES) {
        items.push({
          // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
          title: t(TYPE_LABEL[ty] as I18nKey) + (ty === type ? '  ✓' : ''), icon: TYPE_ICON[ty],
          run: () => { if (ty === type) return; const o = Object.assign({}, obj); o[key] = convertProp(obj[key], ty); this.host.commit(o); },
        });
      }
    }
    items.push({ title: t('重新命名…'), icon: 'pencil', run: () => this.rename(obj, key) });
    this.host.ctx.menu(e, items);
  }
  rename(obj: PropValues, key: string): void {
    this.host.ctx.prompt(t('重新命名屬性'), key, '', value => { const o = renameProp(obj, key, value); if (o) this.host.commit(o); });
  }
  addRow(body: HTMLElement, obj: PropValues): void {
    const r = el('div', 'wm-prop wm-prop-add', body);
    // 名稱不跟各列的（種類＋換行＋屬性名稱）撞在一起：這三個沒有換行
    const k = this.keeper.keep('new-name', el('input', 'wm-prop-input', r)); k.placeholder = t('＋ 新增屬性名稱');
    keyboardHints(k, { plain: true, enter: 'done' });
    const tv = this.keeper.keep('new-type', el('select', 'wm-prop-type dropdown', r));
    // TYPE_LABEL 的值是載入時 t() 的結果，不一定是鍵；再翻一次，找不到時 t() 原樣回傳
    for (const [val, label] of Object.entries(TYPE_LABEL)) { if (val === 'object') continue; const o = el('option', null, tv, t(label as I18nKey)); o.value = val; }
    const go = () => {
      const key = k.value.trim();
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(obj, key)) { k.select(); return; }
      const init = { text: '', list: [], number: 0, checkbox: false, date: (window.moment ? window.moment().format('YYYY-MM-DD') : new Date().toISOString().slice(0, 10)), datetime: (window.moment ? window.moment().format('YYYY-MM-DDTHH:mm') : new Date().toISOString().slice(0, 16)) }[tv.value as Exclude<PropType, 'object'>];
      const o = Object.assign({}, obj); o[key] = init === '' ? null : init;
      this.host.commit(o);
    };
    k.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    const b = this.keeper.keep('new-add', el('button', 'wm-prop-addbtn', r, t('新增'))); b.type = 'button';
    onPress(b, go);
  }
}
