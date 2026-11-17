// Word 模式的文件結構（ProseMirror schema）
import { Schema } from 'prosemirror-model';
import type { Attrs, AttributeSpec, Node as PMNode } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

// 每個頂層區塊都帶 bid（原文區塊編號），用來判斷存檔時能否原樣輸出原文
const bid: Record<string, AttributeSpec> = { bid: { default: null } };

// 段落對齊與左縮排（Markdown 沒有這些語法，存檔時寫成 <p style="…">，Obsidian 閱讀畫面也會套用）
const blockFormat: Record<string, AttributeSpec> = { align: { default: null }, indent: { default: 0 } };
function blockStyle(n: PMNode): { style?: string } {
  const st: string[] = [];
  if (n.attrs.align) st.push('text-align: ' + n.attrs.align);
  if (n.attrs.indent) st.push('margin-left: ' + (n.attrs.indent * 2) + 'em');
  return st.length ? { style: st.join('; ') } : {};
}
function readBlockFormat(dom: HTMLElement): Attrs {
  const a = dom.style && dom.style.textAlign;
  const ml = dom.style && parseFloat(dom.style.marginLeft);
  return {
    align: /^(left|center|right|justify)$/.test(a || '') ? a : (dom.getAttribute && /^(center|right|justify)$/.test(dom.getAttribute('align') || '') ? dom.getAttribute('align') : null),
    indent: ml > 0 && /em$/.test(dom.style.marginLeft) ? Math.min(8, Math.round(ml / 2)) : 0,
  };
}

const tables = tableNodes({
  tableGroup: 'block',
  cellContent: 'paragraph',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => dom.style.textAlign || null,
      setDOMAttr: (value, attrs) => { if (value) attrs.style = ((attrs.style as string | undefined) || '') + `text-align: ${value};`; },
    },
  },
});
tables.table.attrs = Object.assign({}, tables.table.attrs || {}, bid);

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      content: 'inline*', group: 'block', attrs: { ...bid, ...blockFormat },
      parseDOM: [{ tag: 'p', getAttrs: readBlockFormat }], toDOM: n => ['p', blockStyle(n), 0],
    },

    heading: {
      attrs: { level: { default: 1 }, ...bid, ...blockFormat },
      content: 'inline*', group: 'block', defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map(l => ({ tag: 'h' + l, getAttrs: d => Object.assign({ level: l }, readBlockFormat(d)) })),
      toDOM: n => ['h' + n.attrs.level, blockStyle(n), 0],
    },

    blockquote: {
      content: 'block+', group: 'block', defining: true, attrs: { ...bid },
      parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0],
    },

    // Obsidian 提示框：> [!type]± 標題
    callout: {
      attrs: { type: { default: 'note' }, title: { default: null }, fold: { default: '' }, ...bid },
      content: 'block+', group: 'block', defining: true,
      parseDOM: [{
        tag: 'div.callout',
        getAttrs: d => ({ type: d.getAttribute('data-callout') || 'note', title: null, fold: '' }),
        contentElement: '.callout-content',
      }],
      toDOM: n => ['div', { class: 'callout', 'data-callout': n.attrs.type }, ['div', { class: 'callout-content' }, 0]],
    },

    horizontal_rule: {
      group: 'block', attrs: { markup: { default: '---' }, ...bid },
      parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'],
    },

    code_block: {
      content: 'text*', marks: '', group: 'block', code: true, defining: true,
      attrs: { params: { default: '' }, ...bid },
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: n => ['pre', { 'data-lang': n.attrs.params || '' }, ['code', 0]],
    },

    bullet_list: {
      content: 'list_item+', group: 'block',
      attrs: { tight: { default: true }, bullet: { default: '-' }, ...bid },
      parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0],
    },

    ordered_list: {
      content: 'list_item+', group: 'block',
      attrs: { order: { default: 1 }, tight: { default: true }, ...bid },
      parseDOM: [{ tag: 'ol', getAttrs: d => ({ order: +d.getAttribute('start')! || 1 }) }],
      toDOM: n => ['ol', n.attrs.order === 1 ? {} : { start: n.attrs.order }, 0],
    },

    list_item: {
      content: 'block+', defining: true,
      // checked：null＝一般項目、false／true＝任務；status：自訂任務狀態的字元（- [/] 的「/」），一般的 x 為 null
      attrs: { checked: { default: null }, status: { default: null } },
      parseDOM: [{ tag: 'li' }],
      toDOM: n => ['li', n.attrs.checked == null ? {} : { 'data-checked': String(n.attrs.checked), class: 'wm-task' }, 0],
    },

    // 無法以 Word 方式編輯的 Markdown（callout、HTML 區塊、數學式、註腳定義等）：整段保留原文
    raw_block: {
      group: 'block', atom: true, selectable: true,
      attrs: { src: { default: '' }, kind: { default: 'raw' }, ...bid },
      toDOM: n => ['div', { class: 'wm-raw-block' }, n.attrs.src],
    },

    // YAML frontmatter：原樣保留
    frontmatter: {
      group: 'block', atom: true, selectable: true,
      attrs: { src: { default: '' }, ...bid },
      toDOM: n => ['div', { class: 'wm-frontmatter' }, n.attrs.src],
    },

    ...tables,

    text: { group: 'inline' },

    image: {
      inline: true, group: 'inline', draggable: true,
      attrs: { src: {}, alt: { default: null }, title: { default: null }, wiki: { default: false }, width: { default: null } },
      parseDOM: [{ tag: 'img[src]', getAttrs: d => ({ src: d.getAttribute('src'), alt: d.getAttribute('alt') }) }],
      toDOM: n => ['img', { src: n.attrs.src, alt: n.attrs.alt }],
    },

    // [[筆記]]、[[筆記|別名]]、![[筆記]]（非圖片嵌入）
    wikilink: {
      inline: true, group: 'inline', atom: true, selectable: true,
      attrs: { target: {}, alias: { default: null }, embed: { default: false } },
      toDOM: n => ['span', { class: 'wm-wikilink' }, n.attrs.alias || n.attrs.target],
    },

    // 行內無法編輯的語法（行內數學、註解 %%、註腳參照、未知 HTML 標籤）
    raw_inline: {
      inline: true, group: 'inline', atom: true, selectable: true,
      attrs: { src: { default: '' } },
      toDOM: n => ['span', { class: 'wm-raw-inline' }, n.attrs.src],
    },

    hard_break: {
      inline: true, group: 'inline', selectable: false,
      parseDOM: [{ tag: 'br' }], toDOM: () => ['br'],
    },
  },

  marks: {
    link: {
      attrs: { href: {}, title: { default: null } }, inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: d => ({ href: d.getAttribute('href'), title: d.getAttribute('title') }) }],
      toDOM: m => ['a', { href: m.attrs.href, class: 'wm-link' }, 0],
    },
    em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }], toDOM: () => ['em', 0] },
    strong: { parseDOM: [{ tag: 'b' }, { tag: 'strong' }], toDOM: () => ['strong', 0] },
    underline: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }], toDOM: () => ['s', 0] },
    // 螢光（醒目提示）：沒有顏色時存成 ==文字==，有顏色時存成 <mark style="background: …">
    highlight: {
      attrs: { color: { default: null } },
      parseDOM: [
        { tag: 'mark', getAttrs: d => ({ color: (d.style && (d.style.backgroundColor || d.style.background)) || null }) },
        { style: 'background-color', getAttrs: v => (/^(transparent|initial|inherit|none|white|#fff(fff)?|rgba?\(\s*255,\s*255,\s*255)/i.test(v.trim()) ? false : { color: v.trim() }) },
      ],
      toDOM: m => ['mark', m.attrs.color ? { style: `background-color: ${m.attrs.color}`, class: 'wm-hl-color' } : {}, 0],
    },
    // 上標、下標、鍵盤按鍵（存成 <sup>、<sub>、<kbd>）
    sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
    sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    kbd: { parseDOM: [{ tag: 'kbd' }], toDOM: () => ['kbd', 0] },
    // 字元框線
    border: {
      parseDOM: [{ style: 'border', getAttrs: v => (/none|^0/.test(v) ? false : null) }],
      toDOM: () => ['span', { class: 'wm-char-border', style: 'border: 1px solid; padding: 0 2px' }, 0],
    },
    color: {
      attrs: { color: {} },
      // 從 Word／網頁貼上時，忽略預設的黑色與繼承色
      parseDOM: [{
        style: 'color',
        getAttrs: v => (/^(black|windowtext|inherit|initial|currentcolor|#000(000)?|rgb\(0,\s*0,\s*0\)|var\(.*\))$/i.test(v.trim()) ? false : { color: v }),
      }],
      toDOM: m => ['span', { style: `color: ${m.attrs.color}` }, 0],
    },
    code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
  },
});

export const TOP_LEVEL_WITH_BID = new Set(
  Object.keys(schema.nodes).filter(n => schema.nodes[n].spec.attrs && 'bid' in schema.nodes[n].spec.attrs));
