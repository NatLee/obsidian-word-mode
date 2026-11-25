// 手機、平板上編輯區的觸控手勢（view.ts 在行動裝置上安裝）：
// 1. 表格儲存格：編輯中再點儲存格，自己放游標。交給 iOS 的話，點在游標所在的位置會跳出系統的選單（貼上、選取…），
//    儲存格很小、幾乎每一下都點在游標上，選單又剛好蓋住下一列，下一列就怎麼點都沒反應。
// 2. 兩指點一下：選取那一整段（Editorial 的做法）。
// 5. 編輯中點一般的文字（設定 tapNoMenu，預設開）：也自己放游標，iOS 就不會在點到游標所在位置時跳出「貼上、選取、全選」的選單
//    （網頁改不了那個選單的項目，只能不讓它出現）。連點兩下自己選取那個詞；長按、拖曳照常交給 iOS（放大鏡、拉選取範圍）。
// 6. 點兩個表格（或其他不能打字的區塊）之間的縫隙：在那裡插入一個空段落並把游標放進去。手機沒有 Ctrl+Enter，原本沒辦法在那裡打字
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { selectBlockAt } from './commands.js';

// installTouch 的選項：tapNoMenu 每次點擊時讀（設定改了馬上生效）
export interface TouchOptions { tapNoMenu?: () => boolean; }

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

// 編輯中點一般的文字時要把游標放在哪裡（見第 5 點）；不該接手時回傳 null。
// 正在用輸入法組字（注音、拼音的候選字）時不接手：組字的範圍由 iOS 管，自己移游標會打斷組字
export function textTapPos(view: EditorView, target: EventTarget | null, x: number, y: number): number | null {
  const el = target as Element | null;
  if (!view.hasFocus() || view.composing || !el || el.nodeType !== 1 || !view.dom.contains(el) || el.closest(OWN_CLICK)) return null;
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const $p = view.state.doc.resolve(hit.pos);
  return $p.parent.inlineContent ? hit.pos : null;
}

// 連點兩下選取的詞：pos 所在的那一段裡，包含 pos 的那個詞（中文、日文用瀏覽器的斷詞；沒有斷詞功能時用英數字與空白分）。
// 點在詞與詞之間的空白、標點上時選那一個字元
export function wordAt(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $p = doc.resolve(pos);
  const parent = $p.parent;
  if (!parent.inlineContent || !parent.content.size) return null;
  const start = $p.start();
  // 不是文字的行內節點（圖片、方程式）算一個字元，位置才對得上
  const text = parent.textBetween(0, parent.content.size, undefined, '\ufffc');
  const off = Math.min($p.parentOffset, text.length - 1);
  type Seg = { segment: string; index: number; isWordLike?: boolean };
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<Seg> } }).Segmenter;
  let from = off; let to = off + 1;
  if (Seg) {
    for (const g of new Seg(undefined, { granularity: 'word' }).segment(text)) {
      if (g.index <= off && off < g.index + g.segment.length) { from = g.index; to = g.index + g.segment.length; break; }
    }
  } else {
    const word = /[\p{L}\p{N}_]/u;
    if (word.test(text[off])) {
      while (from > 0 && word.test(text[from - 1])) from--;
      while (to < text.length && word.test(text[to])) to++;
    }
  }
  return { from: start + from, to: start + to };
}

// 點在兩個區塊之間的縫隙時，要插入段落的位置（見第 6 點）；不是這種地方時回傳 null。
// 只管兩邊都不能直接打字的縫隙（表格、程式碼、圖表、方程式之間）：旁邊是一般段落時點那個段落就好
export function gapTapPos(view: EditorView, target: EventTarget | null, y: number): number | null {
  // 手指碰到的要是編輯區本身（縫隙裡沒有別的元素），點在表格、段落上的照常處理
  if (target !== view.dom) return null;
  const doc = view.state.doc;
  const typable = (n: PMNode | null | undefined) => !!n && (n.isTextblock || n.type.name === 'bullet_list' || n.type.name === 'ordered_list' || n.type.name === 'blockquote');
  let prev: { node: PMNode; end: number; bottom: number } | null = null;
  let found: number | null = null;
  doc.forEach((node, offset) => {
    if (found != null) return;
    const dom = view.nodeDOM(offset);
    if (!dom || dom.nodeType !== 1) { prev = null; return; }
    const r = (dom as HTMLElement).getBoundingClientRect();
    const p = prev;
    if (p && y > p.bottom && y < r.top && !typable(p.node) && !typable(node)) found = p.end;
    prev = { node, end: offset + node.nodeSize, bottom: r.bottom };
  });
  return found;
}

// 3. 長按拖曳游標（iOS 內建的手勢與放大鏡）：拖曳中 iOS 一直在改系統的選取，ProseMirror 每收到一次就讀進來，
//    覺得 DOM 的寫法跟它要的不一樣就再寫回去。兩邊一來一回（每 8ms 一次），游標跳、放大鏡失效。實機紀錄裡看到的有：
//    游標進到方程式裡（編輯器不認）、段落結尾在行內方程式後面時兩邊對同一個位置寫法不同（PM 放在結尾的分隔圖片前面，
//    iOS 放在後面）、游標到了表格與段落之間的縫隙。所以拖曳中不讓 ProseMirror 收到選取的變動，iOS 自己畫游標與放大鏡；
//    放開的那一刻再照 iOS 最後放的位置設定編輯器的選取（落在不能打字的地方就找最近的文字）。
//
//    拖曳選取範圍時也一樣：範圍的一端拖到兩個區塊之間的縫隙，ProseMirror 就把那一端改回段落裡，同樣互搶
//    （1.31.4 的實機紀錄：鍵盤收著時長按會選取一個詞，接著拖曳就是在拉範圍）。
//
//    條件要嚴，一般的點擊絕對不能走到這裡（1.31.0 在實機上點一般的行叫不出游標就是條件太鬆）：手指是從編輯區裡按下的、
//    移動過、最近還有收到觸控事件（放開的事件收不到時不會一直擋著），而且是「按住超過 HOLD_MS 才開始拖」（長按拖曳），
//    或「按下時已經選取了一段文字」（拉選取範圍）。後者也包含選取中捲動畫面：捲動不會改選取，擋著也沒有影響。
//    不再要求按下時編輯區已有焦點：鍵盤收著時長按，焦點是在按住的途中才拿到的。
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
  view.dispatch(view.state.tr.setSelection(sel));
}

// 回傳拆掉的函式（selectionchange 掛在 window 上，檢視關掉時要拿掉）
export function installTouch(host: HTMLElement, getView: () => EditorView | null, opts: TouchOptions = {}): () => void {
  // 這一次觸控：按下的時間與位置、是不是在編輯區裡按下的、按下時有沒有選取範圍、有沒有移動過、最後一次收到事件的時間
  let down = false; let inEditor = false; let ranged = false; let downAt = 0; let moved = false; let seen = 0;
  let startX = 0; let startY = 0;
  // 這次觸控變成拖曳了沒有
  let drag = false;
  const holding = (): boolean => down && drag && Date.now() - seen < STALE_MS;
  const win = host.ownerDocument.defaultView || window;
  // selectionchange 是送給 document 的事件，掛在 window 的捕獲階段會比 ProseMirror 掛在 document 上的早收到，
  // 在這裡停下來 ProseMirror 就收不到
  const onSelection = (e: Event): void => {
    if (!holding()) return;
    e.stopImmediatePropagation();
  };
  win.addEventListener('selectionchange', onSelection, true);
  // 掛在捕獲階段：要比 ProseMirror 讀選取早知道
  host.addEventListener('touchstart', e => {
    const view = getView();
    const t = e.touches[0];
    down = e.touches.length === 1; moved = false; drag = false; downAt = seen = Date.now();
    inEditor = !!view && !!e.target && view.dom.contains(e.target as Node);
    const s = host.ownerDocument.getSelection();
    ranged = !!view && !!s && !s.isCollapsed && !!s.anchorNode && view.dom.contains(s.anchorNode);
    if (t) { startX = t.clientX; startY = t.clientY; }
  }, { capture: true, passive: true });
  host.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!t) return;
    seen = Date.now();
    if (Math.abs(t.clientX - startX) > DRAG_MOVE || Math.abs(t.clientY - startY) > DRAG_MOVE) moved = true;
    if (!drag && down && inEditor && moved && (ranged || seen - downAt >= HOLD_MS)) drag = true;
  }, { capture: true, passive: true });
  const lift = (e: TouchEvent): void => {
    if (e.touches.length) return;
    const was = holding();
    down = false;
    if (!drag) return;
    drag = false;
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
    // 兩個表格之間的縫隙：插入一個空段落（第 6 點）
    const gap = view.editable ? gapTapPos(view, e.target, d.y) : null;
    if (gap != null) {
      if (e.cancelable) e.preventDefault();
      if (!view.hasFocus()) view.focus();
      const tr = view.state.tr.insert(gap, view.state.schema.nodes.paragraph.create());
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, gap + 1)).scrollIntoView());
      return;
    }
    const cell = cellTapPos(view, e.target, d.x, d.y);
    const pos = cell != null ? cell : opts.tapNoMenu && opts.tapNoMenu() ? textTapPos(view, e.target, d.x, d.y) : null;
    if (pos == null) return;
    // 擋掉之後 iOS 不會移動游標、也不會跳出選單，鍵盤維持開著（編輯區本來就有焦點）
    if (e.cancelable) e.preventDefault();
    const again = last && d.t - last.t < DOUBLE_MS && Math.abs(d.x - last.x) < DOUBLE_DIST && Math.abs(d.y - last.y) < DOUBLE_DIST;
    last = again ? null : d;
    // 連點兩下：儲存格選取這一格的整段文字（儲存格裡通常就是要整格）；一般的文字選取那個詞（iOS 的連點選字被上面擋掉了）
    if (again && cell != null && selectBlockAt(pos)(view.state, view.dispatch)) return;
    if (again) {
      const w = wordAt(view.state.doc, pos);
      if (w) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, w.from, w.to))); return; }
    }
    const $p = view.state.doc.resolve(pos);
    const sel = $p.parent.inlineContent ? TextSelection.create(view.state.doc, pos) : Selection.near($p);
    view.dispatch(view.state.tr.setSelection(sel));
  });
  return () => win.removeEventListener('selectionchange', onSelection, true);
}
