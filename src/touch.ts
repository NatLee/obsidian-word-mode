// 手機、平板上編輯區的觸控手勢（view.ts 在行動裝置上安裝）：
// 1. 表格儲存格：編輯中再點儲存格，自己放游標。交給 iOS 的話，點在游標所在的位置會跳出系統的選單（貼上、選取…），
//    儲存格很小、幾乎每一下都點在游標上，選單又剛好蓋住下一列，下一列就怎麼點都沒反應。
// 2. 兩指點一下：選取那一整段（Editorial 的做法）。
import { Selection, TextSelection } from 'prosemirror-state';
import { GapCursor } from 'prosemirror-gapcursor';
import type { ResolvedPos } from 'prosemirror-model';
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

// 3. 長按拖曳游標（iOS 內建的手勢與放大鏡）：iOS 會把游標放在段落與分隔線、方程式、文件屬性這類區塊「之間」的縫隙。
//    ProseMirror 不認這個位置，會把選取改回原本的文字位置；iOS 下一格又放回縫隙，兩邊互搶，游標在兩個地方跳、
//    放大鏡跑去顯示別的地方。手指還按著的時候先照 iOS 的位置（用 GapCursor 表示，DOM 的選取就不必改），
//    放開之後再落到最近的一行文字。
let touching = false;

// 給編輯器的 createSelectionBetween：手指按著、選取落在區塊之間時回傳 GapCursor，其餘回傳 null（照 ProseMirror 原本的做法）
export function touchGapSelection($anchor: ResolvedPos, $head: ResolvedPos): Selection | null {
  if (!touching || $anchor.pos !== $head.pos || $head.parent.inlineContent) return null;
  return new GapCursor($head);
}

// 放開手指：游標還停在不能打字的縫隙就移到最近的文字（y 是手指最後的位置，上下兩邊都有文字時挑近的那一邊）
function settleGap(view: EditorView, y: number): void {
  const sel = view.state.selection;
  if (!(sel instanceof GapCursor)) return;
  // 本來就可以放游標的縫隙（兩個不能打字的區塊之間、文件開頭的表格前面）留著：那裡打字會新增一段。
  // valid 沒有寫在型別裡，舊版沒有時就一律移到文字上
  const valid = (GapCursor as unknown as { valid?: ($pos: ResolvedPos) => boolean }).valid;
  if (valid && valid(sel.$head)) return;
  const before = Selection.findFrom(sel.$head, -1, true);
  const after = Selection.findFrom(sel.$head, 1, true);
  let pick = before || after;
  if (before && after) {
    try {
      const a = view.coordsAtPos(before.head); const b = view.coordsAtPos(after.head);
      pick = Math.abs(y - (b.top + b.bottom) / 2) < Math.abs(y - (a.top + a.bottom) / 2) ? after : before;
    } catch { /* 量不到就用前面那一個 */ }
  }
  if (pick) view.dispatch(view.state.tr.setSelection(pick));
}

export function installTouch(host: HTMLElement, getView: () => EditorView | null): void {
  // 手指是不是還按在編輯區上（長按拖曳游標用，見上面第 3 點）。掛在捕獲階段：要比 ProseMirror 讀選取早知道
  let lastY = 0;
  const lift = (e: TouchEvent): void => {
    if (e.touches.length) return;
    touching = false;
    const view = getView();
    // 等 iOS 把這次手勢最後的選取交出來（touchend 之後才有 selectionchange）再整理
    if (view) window.setTimeout(() => { if (!touching) settleGap(view, lastY); }, 60);
  };
  host.addEventListener('touchstart', e => { touching = true; if (e.touches.length) lastY = e.touches[0].clientY; }, { capture: true, passive: true });
  host.addEventListener('touchmove', e => { if (e.touches.length) lastY = e.touches[0].clientY; }, { capture: true, passive: true });
  host.addEventListener('touchend', lift, { capture: true, passive: true });
  host.addEventListener('touchcancel', lift, { capture: true, passive: true });

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
