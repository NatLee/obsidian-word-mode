// 手機、平板上編輯區的觸控手勢（view.ts 在行動裝置上安裝）：
// 1. 表格儲存格：編輯中再點儲存格，自己放游標。交給 iOS 的話，點在游標所在的位置會跳出系統的選單（貼上、選取…），
//    儲存格很小、幾乎每一下都點在游標上，選單又剛好蓋住下一列，下一列就怎麼點都沒反應。
// 2. 兩指點一下：選取那一整段（Editorial 的做法）。
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { GapCursor } from 'prosemirror-gapcursor';
import type { ResolvedPos } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { selectBlockAt } from './commands.js';
import { trace } from './trace.js';

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
//    放大鏡跑去顯示別的地方。拖曳中先照 iOS 的位置（用 GapCursor 表示，DOM 的選取就不必改），放開之後再落到最近的一行文字。
//
//    只有「真的在長按拖曳」才這樣做，條件要嚴：一般的點擊絕對不能走到這裡。編輯區拿到焦點時 iOS 會先把選取放在
//    文件最前面（文件屬性前面的縫隙），當成拖曳接受的話，游標就停在那裡、系統的游標還被藏起來（1.31.0 在實機上
//    點一般的行叫不出游標就是這樣）。所以要同時符合：按下去時編輯區已經有焦點、按住超過 HOLD_MS、手指移動過、
//    最近還有收到觸控事件（放開的事件收不到時不會一直卡在「按著」）。
const HOLD_MS = 450;
const DRAG_MOVE = 8;
const STALE_MS = 2500;

// 放開手指：拖曳留下的縫隙游標移到最近的文字（y 是手指最後的位置，上下兩邊都有文字時挑近的那一邊）
function settleGap(view: EditorView, y: number): void {
  const sel = view.state.selection;
  if (!(sel instanceof GapCursor)) return;
  const before = Selection.findFrom(sel.$head, -1, true);
  const after = Selection.findFrom(sel.$head, 1, true);
  let pick = before || after;
  if (before && after) {
    try {
      const a = view.coordsAtPos(before.head); const b = view.coordsAtPos(after.head);
      pick = Math.abs(y - (b.top + b.bottom) / 2) < Math.abs(y - (a.top + a.bottom) / 2) ? after : before;
    } catch { /* 量不到就用前面那一個 */ }
  }
  trace('drag', 'settle gap @' + sel.head + ' -> ' + (pick ? pick.head : 'none'));
  if (pick) view.dispatch(view.state.tr.setSelection(pick));
}

// 長按拖曳放開時，系統的選取可能停在方程式、圖表這類不能編輯的區塊裡面：編輯器不認那個位置（狀態還在原本的文字上），
// 畫面上就沒有游標、打字也沒有反應。把系統的選取放回編輯器認為的位置
function resyncSelection(view: EditorView): void {
  if (!view.hasFocus() || !(view.state.selection instanceof TextSelection)) return;
  const dom = view.dom.ownerDocument.getSelection();
  const node = dom && dom.anchorNode;
  if (!node || !view.dom.contains(node)) return;
  const el = node.nodeType === 1 ? node as Element : node.parentElement;
  const island = el && el.closest('[contenteditable="false"]');
  if (!island || !view.dom.contains(island)) return;
  const head = view.state.selection.head;
  trace('drag', 'DOM selection left inside a block; put back @' + head);
  try {
    // 直接把 DOM 的選取放到編輯器狀態裡的那個位置（狀態沒有變，不必送 transaction）
    const at = view.domAtPos(head);
    dom.collapse(at.node, at.offset);
  } catch { /* 位置對不到就算了 */ }
}

// 4. 點在方程式、圖表這類不能編輯的區塊上：iOS 把系統的選取放進區塊裡面，編輯器不認那個位置，選取停在原本的地方。
//    編輯區剛拿到焦點時原本的地方就是文件最前面，看起來就是「點了之後游標跑到開頭」。
//    等 iOS 放完選取，如果還在區塊裡，就照點的位置選取那個區塊（像 Word 點圖片）；不能整個選取的就放在最近的文字上。
//    區塊裡的按鈕、輸入框自己處理點擊，不管
const OWN_TAP = 'button, input, select, textarea, a, label, [role="button"], .clickable-icon';
const ISLAND_WAIT_MS = 150;

function tapInBlock(view: EditorView, x: number, y: number, before: Selection): void {
  // 這段時間裡有別人處理了這次點擊（提示框標題、區塊按鈕改了選取或焦點）就不管
  if (!view.hasFocus() || view.state.selection !== before) return;
  const dom = view.dom.ownerDocument.getSelection();
  const node = dom && dom.anchorNode;
  if (!node || !view.dom.contains(node)) return;
  const el = node.nodeType === 1 ? node as Element : node.parentElement;
  const island = el && el.closest('[contenteditable="false"]');
  if (!island || !view.dom.contains(island)) return;
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return;
  const doc = view.state.doc;
  const inside = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
  let sel: Selection;
  // 段落、標題裡的小東西（摺疊箭頭、註腳）：游標放在旁邊的字上。其他（方程式、圖表、程式碼、圖片）整個選起來
  const plain = inside && (inside.type.name === 'paragraph' || inside.type.name === 'heading');
  if (inside && !plain && NodeSelection.isSelectable(inside)) sel = NodeSelection.create(doc, hit.inside);
  else sel = Selection.near(doc.resolve(hit.pos));
  trace('tap', 'DOM selection inside a block; select ' + sel.from + (sel.empty ? '' : '-' + sel.to));
  view.dispatch(view.state.tr.setSelection(sel));
}

// 給編輯器 createSelectionBetween 用的函式：長按拖曳中、選取落在區塊之間時回傳 GapCursor，其餘回傳 null（照 ProseMirror 原本的做法）
export type TouchGap = ($anchor: ResolvedPos, $head: ResolvedPos) => Selection | null;

export function installTouch(host: HTMLElement, getView: () => EditorView | null): TouchGap {
  // 這一次觸控：按下的時間與位置、按下時編輯區有沒有焦點、有沒有移動過、最後一次收到事件的時間
  let down = false; let focused = false; let downAt = 0; let moved = false; let seen = 0;
  let startX = 0; let startY = 0; let lastY = 0;
  // 這次拖曳有沒有放過縫隙游標（有才需要在放開後整理），以及整理用的計時器
  let madeGap = false; let settleTimer = 0;
  // 這次觸控有沒有變成長按拖曳（放開後要確認系統的選取還在編輯器認得的地方）
  let wasDrag = false;
  const dragging = (): boolean => { const now = Date.now(); return down && focused && moved && now - downAt >= HOLD_MS && now - seen < STALE_MS; };
  const settle = (): void => {
    if (dragging()) return;
    const view = getView();
    if (!view) return;
    if (madeGap) { madeGap = false; settleGap(view, lastY); }
    if (wasDrag) { wasDrag = false; resyncSelection(view); }
  };
  const later = (ms: number): void => { window.clearTimeout(settleTimer); settleTimer = window.setTimeout(settle, ms); };
  const gap: TouchGap = ($anchor, $head) => {
    if (!dragging() || $anchor.pos !== $head.pos || $head.parent.inlineContent) return null;
    if (!madeGap) trace('drag', 'accept gap @' + $head.pos);
    madeGap = true;
    // 保險：放開的事件沒收到（手指底下的元素被重畫時事件不會傳到這裡）也會在一段時間後整理
    later(STALE_MS + 100);
    return new GapCursor($head);
  };
  // 掛在捕獲階段：要比 ProseMirror 讀選取早知道
  host.addEventListener('touchstart', e => {
    const view = getView();
    const t = e.touches[0];
    down = e.touches.length === 1; moved = false; downAt = seen = Date.now();
    focused = !!view && view.hasFocus();
    if (t) { startX = t.clientX; startY = lastY = t.clientY; }
  }, { capture: true, passive: true });
  host.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!t) return;
    seen = Date.now(); lastY = t.clientY;
    if (Math.abs(t.clientX - startX) > DRAG_MOVE || Math.abs(t.clientY - startY) > DRAG_MOVE) moved = true;
    if (dragging() && !wasDrag) { wasDrag = true; trace('drag', 'press-and-drag'); }
  }, { capture: true, passive: true });
  const lift = (e: TouchEvent): void => {
    if (e.touches.length) return;
    down = false;
    // 等 iOS 把這次手勢最後的選取交出來（touchend 之後才有 selectionchange）再整理
    later(60);
  };
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
    // 點在不能編輯的區塊上（不是區塊裡的按鈕）：等 iOS 放完選取再看（見上面第 4 點）
    const tgt = e.target as Element | null;
    if (tgt && tgt.nodeType === 1 && tgt.closest('[contenteditable="false"]') && !tgt.closest(OWN_TAP) && view.dom.contains(tgt)) {
      const x = d.x, y = d.y, before = view.state.selection;
      window.setTimeout(() => tapInBlock(view, x, y, before), ISLAND_WAIT_MS);
    }
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
  return gap;
}
