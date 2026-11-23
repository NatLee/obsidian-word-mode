// 手機、平板上編輯區的觸控手勢（view.ts 在行動裝置上安裝）：
// 1. 表格儲存格：編輯中再點儲存格，自己放游標。交給 iOS 的話，點在游標所在的位置會跳出系統的選單（貼上、選取…），
//    儲存格很小、幾乎每一下都點在游標上，選單又剛好蓋住下一列，下一列就怎麼點都沒反應。
// 2. 兩指點一下：選取那一整段（Editorial 的做法）。
import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { selectBlockAt } from './commands.js';

// 多久以內放開、移動多少以內算「點一下」
const TAP_MS = 350;
const TAP_MOVE = 10;
// 連點兩下：兩下之間的時間與距離
const DOUBLE_MS = 350;
const DOUBLE_DIST = 24;

interface Down { x: number; y: number; t: number; }

// 點到這些就不接手：連結、核取方塊、圖片與各種自己處理點擊的小工具
const OWN_CLICK = 'a, button, input, select, textarea, img, [contenteditable="false"]';

// 編輯中點表格儲存格時要把游標放在哪裡；不該接手時回傳 null。target 是手指碰到的元素
export function cellTapPos(view: EditorView, target: EventTarget | null, x: number, y: number): number | null {
  // 不用 instanceof：彈出視窗有自己的一份 Element
  const el = target as Element | null;
  if (!view.hasFocus() || !el || el.nodeType !== 1 || !view.dom.contains(el)) return null;
  if (!el.closest('td, th') || el.closest(OWN_CLICK)) return null;
  const hit = view.posAtCoords({ left: x, top: y });
  return hit ? hit.pos : null;
}

export function installTouch(host: HTMLElement, getView: () => EditorView | null): void {
  let one: Down | null = null;
  // 兩指：x、y 是兩指的中點
  let two: Down | null = null;
  let last: Down | null = null;
  const far = (a: { clientX: number; clientY: number }, d: Down) => Math.abs(a.clientX - d.x) > TAP_MOVE || Math.abs(a.clientY - d.y) > TAP_MOVE;

  host.addEventListener('touchstart', e => {
    const ts = e.touches;
    if (ts.length === 1) { one = { x: ts[0].clientX, y: ts[0].clientY, t: e.timeStamp }; two = null; return; }
    // 第二指要跟第一指差不多同時放下，不然是「按著一指、另一指做別的事」。兩指同一瞬間碰到時只會有這一次 touchstart
    const first = one ? one.t : e.changedTouches.length === 2 ? e.timeStamp : -1;
    two = ts.length === 2 && first >= 0 && e.timeStamp - first < TAP_MS
      ? { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2, t: first } : null;
    one = null;
  }, { passive: true });

  host.addEventListener('touchmove', e => {
    const ts = e.touches;
    if (one && (ts.length !== 1 || far(ts[0], one))) one = null;
    if (two && (ts.length !== 2 || far({ clientX: (ts[0].clientX + ts[1].clientX) / 2, clientY: (ts[0].clientY + ts[1].clientY) / 2 }, two))) two = null;
  }, { passive: true });

  host.addEventListener('touchcancel', () => { one = null; two = null; });

  host.addEventListener('touchend', e => {
    const view = getView();
    if (two) {
      // 兩指都放開才算；先放開的那一指也要擋掉，不然 iOS 會把它當成一般的點擊去移動游標
      if (e.cancelable) e.preventDefault();
      if (e.touches.length) return;
      const d = two; two = null;
      if (!view || e.timeStamp - d.t > TAP_MS) return;
      const hit = view.posAtCoords({ left: d.x, top: d.y });
      if (!hit) return;
      // 先給焦點再選取：沒有焦點時 iOS 不會畫出選取範圍
      if (!view.hasFocus()) view.focus();
      selectBlockAt(hit.pos)(view.state, view.dispatch);
      return;
    }
    const d = one; one = null;
    if (!d || !view || e.touches.length || e.timeStamp - d.t > TAP_MS) return;
    const pos = cellTapPos(view, e.target, d.x, d.y);
    if (pos == null) return;
    // 擋掉之後 iOS 不會移動游標、也不會跳出選單，鍵盤維持開著（編輯區本來就有焦點）
    if (e.cancelable) e.preventDefault();
    const again = last && d.t - last.t < DOUBLE_MS && Math.abs(d.x - last.x) < DOUBLE_DIST && Math.abs(d.y - last.y) < DOUBLE_DIST;
    last = again ? null : d;
    // 連點兩下：選取這一格的整段文字（iOS 的連點選字被上面擋掉了，儲存格裡通常就是要整格）
    if (again && selectBlockAt(pos)(view.state, view.dispatch)) return;
    const $p = view.state.doc.resolve(pos);
    const sel = $p.parent.inlineContent ? TextSelection.create(view.state.doc, pos) : Selection.near($p);
    view.dispatch(view.state.tr.setSelection(sel));
  });
}
