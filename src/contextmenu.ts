// Word 模式的右鍵選單：先放游標所在內容的專屬功能（連結、方程式、表格…），
// 再放剪貼簿、格式、段落、插入、工具（可在設定中關閉）
import { Menu, Platform } from 'obsidian';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import * as C from './commands.js';
import { schema } from './schema.js';
import { t } from './i18n.js';
import { linkContext } from './links.js';
import { marksOn } from './marks.js';
import { removeFootnote } from './footnotes.js';
import { PromptModal } from './dialogs.js';
import type { Command } from 'prosemirror-state';
import type { CodeBlockAttrs } from './schema.js';
import type { WordModeView, ElementEvent } from './view.js';

// 右鍵選單的一個項目
interface MenuEntry { title: string; icon: string; run: () => void; enabled: boolean; }

// Obsidian 的選單能不能放子選單（MenuItem.setSubmenu 不是公開 API，舊版可能沒有）；只檢查一次
let submenuSupport: boolean | null = null;
function canSubmenu(): boolean {
  if (submenuSupport == null) {
    submenuSupport = false;
    try { new Menu().addItem(i => { submenuSupport = typeof i.setSubmenu === 'function'; }); } catch { submenuSupport = false; }
  }
  return submenuSupport;
}

// e 是 contextmenu 事件；回傳 true 表示已經處理（不要再出現系統的選單）
export function openContextMenu(view: WordModeView, e: ElementEvent): boolean {
  // 手機長按是用來選取文字，保留系統行為（表格、連結、圖片操作都在工具列與小工具列上）
  if (Platform.isMobile) return false;
  const S = view.plugin.settings;
  if (S.ctxMenu === false) return false;
  const hidden = new Set(S.hiddenCtx || []);
  const pmPos = view.pm!.posAtCoords({ left: e.clientX, top: e.clientY });
  // 右鍵點在選取範圍外：游標移到點的位置（像 Word）
  const sel0 = view.pm!.state.selection;
  if (pmPos && (sel0.empty || pmPos.pos < sel0.from || pmPos.pos > sel0.to)) {
    try {
      const $p = view.pm!.state.doc.resolve(pmPos.pos);
      if ($p.parent.inlineContent) view.pm!.dispatch(view.pm!.state.tr.setSelection(TextSelection.create(view.pm!.state.doc, pmPos.pos)));
    } catch { /* 非文字位置 */ }
  }
  const st = view.pm!.state;
  const hasSel = !st.selection.empty && !(st.selection instanceof NodeSelection);
  const selText = hasSel ? st.doc.textBetween(st.selection.from, st.selection.to, ' ') : '';
  const m = new Menu();
  let section = false;
  const sep = () => { if (section) m.addSeparator(); section = false; };
  const put = (menu: Menu, e: MenuEntry) => menu.addItem(i => { i.setTitle(e.title).setIcon(e.icon).onClick(() => { e.run(); }); if (!e.enabled) i.setDisabled(true); });
  // bucket 不是 null 時，item() 加的項目先收集起來，之後放進子選單
  let bucket = null as MenuEntry[] | null;
  const item = (title: string, icon: string, run: () => void, enabled = true) => {
    const e: MenuEntry = { title, icon, run, enabled };
    if (bucket) { bucket.push(e); return; }
    section = true;
    put(m, e);
  };
  // 把 fill 裡加的項目收進一個子選單，主選單只多一項；Obsidian 不支援子選單（或 fold 為 false）時直接列在主選單
  const submenu = (title: string, icon: string, fill: () => void, fold = true) => {
    if (!fold || !canSubmenu()) { fill(); return; }
    bucket = [];
    fill();
    const entries = bucket;
    bucket = null;
    if (!entries.length) return;
    section = true;
    m.addItem(i => { i.setTitle(title).setIcon(icon); const sm = i.setSubmenu!(); for (const e of entries) put(sm, e); });
  };
  const cmd = (title: string, icon: string, c: Command, check = true) => item(title, icon, () => { c(view.pm!.state, v => view.pm!.dispatch(v), view.pm!); view.pm!.focus(); }, check ? !!c(st) : true);

  // ---- 專屬：方程式
  const math = view.mathAt(e.target);
  if (math) { for (const it of view.mathMenuItems(math)) item(it.title, it.icon, it.run); sep(); }
  // ---- 專屬：Markdown 原文區塊、註解、註腳
  const raw = !math && e.target.closest && (e.target.closest('.wm-raw-block') || e.target.closest('.wm-raw-inline'));
  // ---- 專屬：註腳
  const fnEl = !math && e.target.closest && e.target.closest('.wm-raw-inline.is-footnote:not(.is-footnote-inline)');
  const fnId = fnEl ? fnEl.textContent.replace(/^\[|\]$/g, '') : null;
  if (fnId) {
    item(t('跳到註腳內容'), 'arrow-down-to-line', () => view.gotoFootnote(fnId));
    item(t('編輯註腳…'), 'pencil', () => view.editFootnote(fnId));
    item(t('刪除註腳（含內容）'), 'trash-2', () => { removeFootnote(fnId)(view.pm!.state, tr => view.pm!.dispatch(tr)); view.pm!.focus(); });
    sep();
  } else if (raw) { item(t('編輯原文'), 'pencil', () => raw.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); sep(); }
  // ---- 專屬：連結
  const a = e.target.closest && (e.target.closest('a.wm-link') || e.target.closest('.wm-bare-url'));
  if (a) {
    const href = (a.getAttribute('href') || a.getAttribute('data-href'))!;
    item(t('開啟連結'), 'external-link', () => view.openLink(href, false));
    item(t('在新分頁開啟'), 'file-plus', () => view.openLink(href, true));
    item(t('編輯連結…'), 'pencil', () => view.openLinkDialog());
    item(t('複製連結'), 'copy', () => view.copyText(href));
    if (a.matches('a.wm-link')) item(t('移除連結'), 'unlink', () => { const c = linkContext(view.pm!.state); if (c) view.unlink(c); });
    sep();
  }
  // ---- 專屬：程式碼區塊
  const $f = st.selection.$from;
  if ($f.parent.type === schema.nodes.code_block) {
    const code = $f.parent;
    const params = (code.attrs as CodeBlockAttrs).params;
    item(t('複製程式碼'), 'copy', () => view.copyText(code.textContent));
    item(t('程式語言') + '：' + (params || t('純文字')), 'code', () => {
      new PromptModal(view.app, t('程式語言'), params || '', 'python, sql, json…', v => {
        const pos = $f.before();
        view.pm!.dispatch(view.pm!.state.tr.setNodeMarkup(pos, null, Object.assign({}, code.attrs, { params: String(v || '').trim() })));
      }).open();
    });
    sep();
  }
  // ---- 專屬：表格
  // 表格的功能很多：分成五個子選單（插入、刪除、移動、對齊、排序），主選單才不會太長
  const inTable = C.table.isIn(st);
  if (inTable && !hidden.has('table')) {
    const T = C.table;
    submenu(t('插入列或欄'), 'plus', () => {
      cmd(t('在上方插入列'), 'arrow-up-to-line', T.addRowBefore);
      cmd(t('在下方插入列'), 'arrow-down-to-line', T.addRowAfter);
      cmd(t('在左側插入欄'), 'arrow-left-to-line', T.addColumnBefore);
      cmd(t('在右側插入欄'), 'arrow-right-to-line', T.addColumnAfter);
    });
    submenu(t('刪除列、欄或表格'), 'trash-2', () => {
      cmd(t('刪除列'), 'rows-3', T.deleteRow);
      cmd(t('刪除欄'), 'columns-3', T.deleteColumn);
      cmd(t('刪除表格'), 'trash-2', T.deleteTable, false);
    });
    submenu(t('移動列或欄'), 'move', () => {
      cmd(t('列上移'), 'arrow-up', C.moveBlock(-1));
      cmd(t('列下移'), 'arrow-down', C.moveBlock(1));
      cmd(t('欄左移'), 'arrow-left', C.moveTableColumn(-1));
      cmd(t('欄右移'), 'arrow-right', C.moveTableColumn(1));
    });
    submenu(t('整欄對齊'), 'align-center', () => {
      cmd(t('整欄靠左'), 'align-left', T.alignColumn('left'), false);
      cmd(t('整欄置中'), 'align-center', T.alignColumn('center'), false);
      cmd(t('整欄靠右'), 'align-right', T.alignColumn('right'), false);
    });
    submenu(t('依此欄排序'), 'arrow-down-a-z', () => {
      cmd(t('依此欄排序（遞增）'), 'arrow-down-a-z', C.sortTableByColumn(1));
      cmd(t('依此欄排序（遞減）'), 'arrow-up-z-a', C.sortTableByColumn(-1));
    });
    sep();
  }
  // 程式碼區塊裡只能放純文字：格式、段落、插入都用不到，不列出來
  const inCode = C.inCode(st);
  // ---- 剪貼簿
  if (!hidden.has('clipboard')) {
    item(t('剪下'), 'scissors', () => view.clipboardAction('cut'), hasSel);
    item(t('複製'), 'copy', () => view.clipboardAction('copy'), hasSel);
    item(t('貼上'), 'clipboard-paste', () => { void view.pasteFromClipboard('auto'); });
    item(t('只貼上文字'), 'type', () => { void view.pasteFromClipboard('text'); });
    item(t('全選'), 'text-select', () => { C.selectAll(view.pm!.state, v => view.pm!.dispatch(v)); view.pm!.focus(); });
    sep();
  }
  // ---- 格式（有選取文字時，像 Word 的迷你工具列）
  if (!hidden.has('format') && hasSel && !inCode) {
    cmd(t('粗體'), 'bold', C.toggleBold, false);
    cmd(t('斜體'), 'italic', C.toggleItalic, false);
    cmd(t('底線'), 'underline', C.toggleUnderline, false);
    cmd(t('醒目提示'), 'highlighter', C.toggleHighlight, false);
    cmd(t('清除所有格式'), 'remove-formatting', C.clearFormatting, false);
    sep();
  }
  // ---- 段落
  if (!hidden.has('paragraph') && !inCode) {
    submenu(t('段落'), 'pilcrow', () => {
      cmd(t('項目符號'), 'list', C.toggleList('bullet'));
      cmd(t('編號'), 'list-ordered', C.toggleList('ordered'));
      cmd(t('增加縮排'), 'indent-increase', C.indent);
      cmd(t('減少縮排'), 'indent-decrease', C.outdent);
    }, inTable);
    if (!inTable) sep();
  }
  // ---- 插入
  if (!hidden.has('insert') && !inCode) {
    submenu(t('插入'), 'plus-circle', () => {
      item(hasSel ? t('把選取文字變成超連結…') : t('插入超連結…'), 'link', () => view.openLinkDialog());
      item(t('連結到筆記…'), 'file-symlink', () => view.openNoteLinkPicker());
      item(hasSel ? t('把選取文字變成方程式…') : t('插入方程式…'), 'sigma', () => view.openEquation());
      item(t('插入註解…'), 'message-square', () => view.insertComment());
    }, inTable);
    if (!inTable) sep();
  }
  // ---- 工具
  if (!hidden.has('tools')) submenu(t('工具'), 'wrench', () => {
    if (hasSel) {
      item(t('複製為 Markdown'), 'file-code', () => view.copyText(view.selectionMarkdown()));
      const short = selText.length > 16 ? selText.slice(0, 15) + '…' : selText;
      if (selText.trim() && !selText.includes('\n')) {
        item(t('在這份筆記中尋找「{q}」', { q: short }), 'search', () => { view.findBar.input.value = selText; view.findBar.open(false); });
        item(t('在保管庫中搜尋「{q}」', { q: short }), 'search-code', () => view.searchVault(selText));
      }
      item(t('字數統計（選取範圍）'), 'bar-chart-3', () => view.openWordCount());
    } else {
      item(t('字數統計'), 'bar-chart-3', () => view.openWordCount());
    }
    item(marksOn(st) ? t('隱藏編輯標記') : t('顯示編輯標記'), 'pilcrow', () => view.setMarks(!marksOn(view.pm!.state)));
  }, inTable);
  m.showAtMouseEvent(e);
  e.preventDefault();
  return true;
}
