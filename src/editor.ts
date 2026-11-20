// 建立 ProseMirror 編輯器狀態（不依賴 Obsidian）
import { EditorState, Plugin, Selection, TextSelection } from 'prosemirror-state';
import { t } from './i18n.js';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { tableEditing, fixTables } from 'prosemirror-tables';
import { buildKeymap, baseKeymap, compatPlugin } from './commands.js';
import { bareUrlPlugin } from './links.js';
import { autoformatPlugin } from './autoformat.js';
import type { Node as PMNode } from 'prosemirror-model';

// 文件是空的時候顯示提示文字
const placeholder = new Plugin({
  props: {
    decorations(state) {
      const d = state.doc;
      if (d.childCount !== 1 || !d.firstChild!.isTextblock || d.firstChild!.content.size) return null;
      return DecorationSet.create(d, [Decoration.node(0, d.firstChild!.nodeSize, { class: 'wm-empty', 'data-placeholder': t('開始輸入內容…') })]);
    },
  },
});

function buildPlugins(extraPlugins: Plugin[] = []): Plugin[] {
  // spec.priority 的外掛（自動完成選單）要排在快速鍵之前，才攔得到 Enter 與方向鍵
  const first = extraPlugins.filter(p => p.spec.priority);
  const rest = extraPlugins.filter(p => !p.spec.priority);
  return [
    ...first,
    history({ depth: 300, newGroupDelay: 600 }),
    keymap(buildKeymap()),
    keymap(baseKeymap),
    dropCursor({ color: 'var(--interactive-accent, #4a7bd0)' }),
    gapCursor(),
    tableEditing(),
    placeholder,
    bareUrlPlugin,
    compatPlugin,
    autoformatPlugin,
    ...rest,
  ];
}

// 切換 Word／Markdown 後回來：沿用原本的編輯狀態（含復原紀錄）
export function restoreEditorState(state: EditorState, extraPlugins: Plugin[] = []): EditorState {
  return state.reconfigure({ plugins: buildPlugins(extraPlugins) });
}

export function createEditorState(doc: PMNode, extraPlugins: Plugin[] = []): EditorState {
  let state = EditorState.create({ doc, plugins: buildPlugins(extraPlugins) });
  // 不規則的表格（欄數不一）先補齊，避免編輯時出錯；補齊後該表格會在存檔時重新輸出
  const fix = fixTables(state);
  if (fix) state = state.apply(fix.setMeta('addToHistory', false));
  // 游標放在第一個可輸入文字的位置（避免一開啟就選取文件屬性區塊）
  const first = Selection.findFrom(state.doc.resolve(0), 1, true);
  if (first) state = state.apply(state.tr.setSelection(first).setMeta('addToHistory', false));
  else state = state.apply(state.tr.setSelection(TextSelection.atStart(state.doc)).setMeta('addToHistory', false));
  return state;
}
