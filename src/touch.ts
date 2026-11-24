// 手機、平板上編輯區的觸控手勢（view.ts 在行動裝置上安裝）：
// 1. 表格儲存格：編輯中再點儲存格，自己放游標。交給 iOS 的話，點在游標所在的位置會跳出系統的選單（貼上、選取…），
//    儲存格很小、幾乎每一下都點在游標上，選單又剛好蓋住下一列，下一列就怎麼點都沒反應。
// 2. 兩指點一下：選取那一整段（Editorial 的做法）。
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { selectBlockAt } from './commands.js';
import { trace, describeNode } from './trace.js';

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

// 3. 長按拖曳游標（iOS 內建的手勢與放大鏡）：拖曳中 iOS 一直在改系統的選取，ProseMirror 每收到一次就讀進來，
//    覺得 DOM 的寫法跟它要的不一樣就再寫回去。兩邊一來一回（每 8ms 一次），游標跳、放大鏡失效。實機紀錄裡看到的有：
//    游標進到方程式裡（編輯器不認）、段落結尾在行內方程式後面時兩邊對同一個位置寫法不同（PM 放在結尾的分隔圖片前面，
//    iOS 放在後面）、游標到了表格與段落之間的縫隙。所以拖曳中不讓 ProseMirror 收到選取的變動，iOS 自己畫游標與放大鏡；
//    放開的那一刻再照 iOS 最後放的位置設定編輯器的選取（落在不能打字的地方就找最近的文字）。
//
//    只有「真的在長按拖曳」才這樣做，條件要嚴：一般的點擊絕對不能走到這裡（1.31.0 在實機上點一般的行叫不出游標就是
//    條件太鬆）。要同時符合：按下去時編輯區已經有焦點、按住超過 HOLD_MS、手指移動過、最近還有收到觸控事件
//    （放開的事件收不到時不會一直擋著）。
const HOLD_MS = 450;
const DRAG_MOVE = 8;
const STALE_MS = 2500;

// 放開時：照系統最後的選取設定編輯器的選取。TextSelection.between 遇到不能打字的位置會自己找附近的文字
function commitDomSelection(view: EditorView): void {
  const s = view.dom.ownerDocument.getSelection();
  if (!s || !s.anchorNode || !s.focusNode || !view.dom.contains(s.anchorNode) || !view.dom.contains(s.focusNode)) return;
  let anchor: number; let head: number;
  try { anchor = view.posAtDOM(s.anchorNode, s.anchorOffset); head = view.posAtDOM(s.focusNode, s.focusOffset); } catch { return; }
  const doc = view.state.doc;
  const clamp = (p: number) => Math.max(0, Math.min(p, doc.content.size));
  const sel = TextSelection.between(doc.resolve(clamp(anchor)), doc.resolve(clamp(head)));
  trace('drag', 'commit ' + anchor + (anchor === head ? '' : '-' + head) + ' -> ' + sel.from + (sel.empty ? '' : '-' + sel.to));
  if (!view.state.selection.eq(sel)) view.dispatch(view.state.tr.setSelection(sel));
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

// 回傳拆掉的函式（selectionchange 掛在 window 上，檢視關掉時要拿掉）
export function installTouch(host: HTMLElement, getView: () => EditorView | null): () => void {
  // 這一次觸控：按下的時間與位置、按下時編輯區有沒有焦點、有沒有移動過、最後一次收到事件的時間
  let down = false; let focused = false; let downAt = 0; let moved = false; let seen = 0;
  let startX = 0; let startY = 0;
  // 這次觸控變成長按拖曳了沒有；拖曳中擋掉了幾次選取的變動（紀錄用）
  let drag = false; let held = 0;
  const holding = (): boolean => down && drag && Date.now() - seen < STALE_MS;
  const win = host.ownerDocument.defaultView || window;
  // selectionchange 是送給 document 的事件，掛在 window 的捕獲階段會比 ProseMirror 掛在 document 上的早收到，
  // 在這裡停下來 ProseMirror 就收不到
  const onSelection = (e: Event): void => {
    if (!holding()) return;
    held++;
    e.stopImmediatePropagation();
    // 紀錄：被擋下來的選取在哪裡（不含文字）
    const s = host.ownerDocument.getSelection();
    const view = getView();
    let pos = -1;
    if (s && s.anchorNode && view) { try { pos = view.posAtDOM(s.anchorNode, s.anchorOffset); } catch { /* 對不到 */ } }
    trace('held-sel', (s && s.anchorNode ? describeNode(s.anchorNode) + ':' + s.anchorOffset : 'none') + ' pos=' + pos);
  };
  win.addEventListener('selectionchange', onSelection, true);
  // 掛在捕獲階段：要比 ProseMirror 讀選取早知道
  host.addEventListener('touchstart', e => {
    const view = getView();
    const t = e.touches[0];
    down = e.touches.length === 1; moved = false; drag = false; held = 0; downAt = seen = Date.now();
    focused = !!view && view.hasFocus();
    if (t) { startX = t.clientX; startY = t.clientY; }
  }, { capture: true, passive: true });
  host.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!t) return;
    seen = Date.now();
    if (Math.abs(t.clientX - startX) > DRAG_MOVE || Math.abs(t.clientY - startY) > DRAG_MOVE) moved = true;
    if (!drag && down && focused && moved && seen - downAt >= HOLD_MS) { drag = true; trace('drag', 'press-and-drag: editor stops reading the selection'); }
  }, { capture: true, passive: true });
  const lift = (e: TouchEvent): void => {
    if (e.touches.length) return;
    const was = holding();
    down = false;
    if (!drag) return;
    drag = false;
    trace('drag', 'end (' + e.type + '), ' + held + ' selection changes held back');
    const view = getView();
    // 放開的當下就設定：再晚一點，iOS 放開後送來的 selectionchange 會讓 ProseMirror 用舊的選取把 DOM 改回去
    if (view && was) commitDomSelection(view);
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
  return () => win.removeEventListener('selectionchange', onSelection, true);
}
