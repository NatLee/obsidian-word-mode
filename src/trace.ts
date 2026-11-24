// 觸控與游標的紀錄（手機、平板）：點了沒有游標、放大鏡消失、游標亂跳這類問題只在實機上出現，模擬器常常重現不出來。
// 這裡在背景記住最近幾十秒的觸控、系統放的選取、編輯器的選取，使用者重現問題後用指令「複製觸控與游標的紀錄」貼出來。
//
// 不記錄筆記的文字：元素只記標籤與外掛自己的類別，文字節點只記長度，位置只記編號與區塊的種類。
// 紀錄只在記憶體裡，不寫檔、不送到任何地方，使用者自己複製才會離開這台裝置。
import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// 保留多久、最多幾筆；移動的事件太密，隔一段時間才記一筆
const KEEP_MS = 40000;
const MAX = 900;
const MOVE_EVERY_MS = 60;

interface Entry { t: number; kind: string; text: string; }

const entries: Entry[] = [];
let enabled = false;
// 目前開著的 Word 模式編輯器（把系統的選取換算成編輯器的位置用）
const views = new Set<EditorView>();

export function trace(kind: string, text: string): void {
  if (!enabled) return;
  const t = Date.now();
  entries.push({ t, kind, text });
  while (entries.length > MAX || (entries.length && t - entries[0].t > KEEP_MS)) entries.shift();
}

// 元素的描述：標籤、外掛與 ProseMirror 的類別、是不是不能編輯的區塊。不含文字與屬性值
function describeEl(el: Element | null): string {
  if (!el) return '?';
  const cls = Array.from(el.classList).filter(c => /^(wm-|ProseMirror|math|callout|is-|mod-|tappable|mobile-tap|cm-|menu|modal)/.test(c)).slice(0, 3);
  const ce = el.getAttribute('contenteditable');
  return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '') + (ce === 'false' ? '[ce=false]' : '');
}

export function describeNode(n: Node | null): string {
  if (!n) return 'none';
  if (n.nodeType === 3) return 'text(' + (n.textContent || '').length + ')<' + describeEl(n.parentElement);
  return n.nodeType === 1 ? describeEl(n as Element) : '#' + n.nodeName;
}

// 編輯器選取的描述：種類（text、node、gapcursor、cell、all；壓縮過的程式碼裡類別名稱看不出來，用 toJSON 的 type）、位置、所在區塊的種類
export function describeSel(sel: Selection): string {
  let type = '?';
  try { type = String((sel.toJSON() as { type?: string }).type); } catch { /* 不認得的選取 */ }
  return type + ' ' + sel.from + (sel.empty ? '' : '-' + sel.to) + ' in ' + sel.$head.parent.type.name;
}

const viewOf = (n: Node | null): EditorView | null => {
  if (!n) return null;
  for (const v of views) if (v.dom.contains(n)) return v;
  return null;
};

const island = (v: EditorView, n: Node): boolean => {
  const el = n.nodeType === 1 ? n as Element : n.parentElement;
  const c = el && el.closest('[contenteditable="false"]');
  return !!c && v.dom.contains(c);
};

// 開始記錄：掛在整份文件的捕獲階段（工具列、選單、編輯區的觸控都看得到）。回傳停止的函式
export function enableTrace(win: Window): () => void {
  enabled = true;
  const doc = win.document;
  let lastMove = 0;
  const pt = (e: TouchEvent, list: TouchList) => {
    const t = list[0];
    return t ? Math.round(t.clientX) + ',' + Math.round(t.clientY) : '-';
  };
  const onTouch = (e: TouchEvent) => {
    if (e.type === 'touchmove') {
      if (e.timeStamp - lastMove < MOVE_EVERY_MS) return;
      lastMove = e.timeStamp;
    }
    const list = e.type === 'touchend' || e.type === 'touchcancel' ? e.changedTouches : e.touches;
    trace(e.type.replace('touch', 't-'), pt(e, list) + ' n=' + e.touches.length + ' @' + describeNode(e.target as Node | null));
  };
  // 冒泡到最後才看：有沒有人把這次觸控擋掉（擋掉的話 iOS 不會移動游標、不會叫出選單）
  const onTouchLate = (e: TouchEvent) => { if (e.defaultPrevented) trace(e.type.replace('touch', 't-'), 'prevented'); };
  const onMouse = (e: MouseEvent) => trace(e.type, Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' @' + describeNode(e.target as Node | null) + (e.defaultPrevented ? ' prevented' : ''));
  const onFocus = (e: FocusEvent) => trace(e.type, describeNode(e.target as Node | null));
  const onSelection = () => {
    const s = doc.getSelection();
    if (!s || !s.anchorNode) { trace('dom-sel', 'none'); return; }
    const v = viewOf(s.anchorNode);
    let text = describeNode(s.anchorNode) + ':' + s.anchorOffset;
    if (!s.isCollapsed) text += ' ~ ' + describeNode(s.focusNode) + ':' + s.focusOffset;
    if (!v) { trace('dom-sel', text + ' (outside editor)'); return; }
    let pos = -1;
    try { pos = v.posAtDOM(s.anchorNode, s.anchorOffset); } catch { /* 對不到 */ }
    if (island(v, s.anchorNode)) text += ' IN-BLOCK';
    trace('dom-sel', text + ' pos=' + pos);
    // 等編輯器處理完再看一次：兩邊不一樣就是編輯器把系統的選取改掉了（或沒跟上）
    if (s.isCollapsed) {
      win.requestAnimationFrame(() => {
        const st = v.state.selection;
        if (pos >= 0 && (st.head !== pos || !st.empty)) trace('mismatch', 'dom pos=' + pos + ' state=' + describeSel(st));
      });
    }
  };
  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    doc.addEventListener(t, onTouch as EventListener, { capture: true, passive: true });
    win.addEventListener(t, onTouchLate as EventListener, { passive: true });
  }
  for (const t of ['mousedown', 'click']) doc.addEventListener(t, onMouse as EventListener, true);
  doc.addEventListener('focusin', onFocus, true);
  doc.addEventListener('focusout', onFocus, true);
  doc.addEventListener('selectionchange', onSelection);
  return () => {
    enabled = false;
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      doc.removeEventListener(t, onTouch as EventListener, true);
      win.removeEventListener(t, onTouchLate as EventListener);
    }
    for (const t of ['mousedown', 'click']) doc.removeEventListener(t, onMouse as EventListener, true);
    doc.removeEventListener('focusin', onFocus, true);
    doc.removeEventListener('focusout', onFocus, true);
    doc.removeEventListener('selectionchange', onSelection);
    entries.length = 0;
  };
}

// 編輯器外掛：記下每一次選取或內容的變動，以及它是怎麼來的（手指、貼上、輸入法…）
export function tracePlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs) {
      if (!enabled) return null;
      for (const tr of trs) {
        if (!tr.selectionSet && !tr.docChanged) continue;
        const ui = tr.getMeta('uiEvent') as string | undefined;
        const how = [tr.getMeta('pointer') ? 'pointer' : '', ui || '', tr.getMeta('composition') != null ? 'ime' : '', tr.docChanged ? 'doc' : ''].filter(Boolean).join(',');
        trace('state', describeSel(tr.selection) + (how ? ' (' + how + ')' : ''));
      }
      return null;
    },
    view(view) {
      views.add(view);
      return { destroy: () => { views.delete(view); } };
    },
  });
}

// 文件的骨架：每個頂層區塊的種類、起點與大小（對照紀錄裡的位置用），不含文字
function outline(doc: PMNode): string {
  const out: string[] = [];
  doc.forEach((n, off, i) => { if (i < 80) out.push(i + ':' + n.type.name + '@' + off + '+' + n.nodeSize); });
  if (doc.childCount > 80) out.push('…' + (doc.childCount - 80) + ' more');
  return out.join(' ');
}

// 整份紀錄：開頭是裝置與版面，接著是文件骨架與目前的選取，最後是時間由舊到新的事件（時間是距離複製當下的秒數）
export function traceReport(header: string[], view: EditorView | null): string {
  const now = Date.now();
  const lines = [...header];
  if (view) {
    lines.push('doc: ' + outline(view.state.doc));
    lines.push('selection: ' + describeSel(view.state.selection) + ' focus=' + view.hasFocus());
  }
  lines.push('events (' + entries.length + '):');
  for (const e of entries) lines.push((((e.t - now) / 1000).toFixed(3)).padStart(8) + ' ' + e.kind.padEnd(9) + ' ' + e.text);
  return lines.join('\n');
}
