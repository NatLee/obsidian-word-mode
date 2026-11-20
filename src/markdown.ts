// Markdown <-> ProseMirror 轉換。
// 原則：文件切成「原文區塊」，每個區塊記下原文；存檔時，沒有被修改的區塊一字不差輸出原文，
// 只有被修改（或新增）的區塊才重新產生 Markdown。
import MarkdownIt from 'markdown-it';
import markPlugin from 'markdown-it-mark';
import { MarkdownParser, MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import { Fragment } from 'prosemirror-model';
import type { Mark, Node as PMNode } from 'prosemirror-model';
// markdown-it 15 自帶型別定義；預設匯出是建構函式（值），實例的型別另外以具名的型別匯出
import type { MarkdownIt as MarkdownItInstance, StateCore, StateInline, Token } from 'markdown-it';
import type { ParseSpec } from 'prosemirror-markdown';
import { schema, IMAGE_PATH } from './schema.js';
import type {
  BidAttrs, CalloutAttrs, FrontmatterAttrs, HeadingAttrs, HorizontalRuleAttrs, ImageAttrs, LinkAttrs, ListItemAttrs,
  OrderedListAttrs, RawBlockAttrs, RawInlineAttrs, TableCellAttrs, WikilinkAttrs,
} from './schema.js';

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

// 切段時的原文區塊（行範圍，end 不含）。md＝交給 markdown-it 解析的頂層區塊，token 是它的第一個 token；
// 其餘種類整段保留原文
export type BlockRange =
  | { start: number; end: number; kind: 'md'; token: Token }
  | { start: number; end: number; kind: 'frontmatter' | 'raw' | 'footnote' | 'comment' | 'math'; token?: undefined };
export type BlockKind = BlockRange['kind'];
// 建立節點時的種類：md 區塊可能再細分成 html／math／comment
export type SegmentKind = BlockKind | 'html';

// 一個原文區塊的紀錄：存檔時沒有修改的區塊輸出 text（原文）
export interface SegmentMeta {
  text: string; // 原文（含行尾）
  gapBefore: string; // 與前一個區塊之間的原文（空行）
  canon: string; // 剛解析完時序列化的結果；存檔時結果相同就表示沒有修改
  trailing: string; // 區塊尾端的空行，修改後重新輸出時保留
  line: number; // 區塊第一行的行號（從 0 起算）
}

// parse() 回傳、serialize() 需要的文件資訊
export interface DocMeta {
  segments: SegmentMeta[];
  trailingGap: string; // 最後一個區塊之後的原文
  eol: string; // 檔案使用的換行字元
  endsWithNewline: boolean;
}

export interface ParseResult {
  doc: PMNode;
  meta: DocMeta;
}

// prosemirror-markdown 的 getAttrs 收到的 token：它的型別定義取自 @types/markdown-it（v14），
// 與上面 markdown-it 15 自帶的 Token 是不同的宣告，所以 getAttrs 用到的函式一律用這個型別
type ParseToken = Parameters<NonNullable<ParseSpec['getAttrs']>>[0];

type MarkSerializerSpec = MarkdownSerializer['marks'][string];

// 序列化選項：prosemirror-markdown 會把它原封不動傳給 state.options；obsidianEscapes 是這個外掛加的
export type SerializerOptions = MarkdownSerializerState['options'] & { obsidianEscapes?: boolean };

// 序列化狀態：prosemirror-markdown 的型別定義沒有公開的內部成員（@internal），以及這個外掛自己加的旗標
interface SerializerState extends MarkdownSerializerState {
  readonly options: SerializerOptions;
  nodes: MarkdownSerializer['nodes'];
  marks: MarkdownSerializer['marks'];
  out: string;
  delim: string;
  inTightList: boolean;
  inAutolink: boolean | undefined;
  flushClose(size?: number): void;
  inTable?: boolean; // 正在輸出表格儲存格（見 renderCell）
}
// 型別定義沒有宣告建構子的參數
type SerializerStateCtor = new (
  nodes: MarkdownSerializer['nodes'], marks: MarkdownSerializer['marks'], options: SerializerOptions,
) => SerializerState;

interface HtmlPair {
  name: string;
  kind?: string;
  open: RegExp;
  close: RegExp;
}

interface TableCellOut {
  text: string;
  align: string | null;
}


// ---------------------------------------------------------------------------
// markdown-it 設定與 Obsidian 語法擴充
// ---------------------------------------------------------------------------

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  let embed = false;
  let start = pos;
  if (src.charCodeAt(pos) === 0x21 /* ! */ && src.startsWith('[[', pos + 1)) { embed = true; start = pos + 1; }
  else if (!src.startsWith('[[', pos)) return false;
  const end = src.indexOf(']]', start + 2);
  if (end < 0) return false;
  const inner = src.slice(start + 2, end);
  if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return false;
  if (!silent) {
    let target = inner;
    let alias: string | null = null;
    const m = inner.match(/^(.*?)\\?\|(.*)$/);
    if (m) { target = m[1]; alias = m[2]; }
    if (embed && IMAGE_PATH.test(target.split('#')[0])) {
      // ![[圖.png|300]]、![[圖.png|說明]]、![[圖.png|說明|300]]
      let alt = alias;
      let width: string | null = null;
      const wm = alias != null ? alias.match(/^(?:(.*?)\\?\|)?(\d+(?:x\d+)?)$/) : null;
      if (wm) { width = wm[2]; alt = wm[1] != null ? wm[1] : null; }
      const tok = state.push('wiki_image', '', 0);
      tok.meta = { src: target, alt, title: null, wiki: true, width };
    } else {
      const tok = state.push('wikilink', '', 0);
      tok.meta = { target, alias, embed };
    }
  }
  state.pos = end + 2;
  return true;
}

// 行內無法以 Word 方式編輯的 Obsidian 語法：%%註解%%、$數學$、[^註腳]、^[行內註腳]
function rawInlineRule(state: StateInline, silent: boolean): boolean {
  const rest = state.src.slice(state.pos);
  let m: string | null = null;
  if (rest.startsWith('%%')) {
    const end = rest.indexOf('%%', 2);
    if (end > 0) m = rest.slice(0, end + 2);
  } else if (rest.startsWith('$$')) {
    const end = rest.indexOf('$$', 2);
    if (end > 0) m = rest.slice(0, end + 2);
  } else if (rest[0] === '$') {
    const mm = rest.match(/^\$(?=\S)([^$\n]*?\S)\$(?!\d)/);
    if (mm) m = mm[0];
  } else if (rest.startsWith('[^')) {
    const mm = rest.match(/^\[\^[^\]\s]+\]/);
    if (mm) m = mm[0];
  } else if (rest.startsWith('^[')) {
    const mm = rest.match(/^\^\[[^\]]*\]/);
    if (mm) m = mm[0];
  }
  if (!m) return false;
  if (!silent) { const tok = state.push('raw_md', '', 0); tok.content = m; }
  state.pos += m.length;
  return true;
}

const HTML_PAIRS: HtmlPair[] = [
  { name: 'b', kind: 'strong', open: /^<b>$/i, close: /^<\/b>$/i },
  { name: 'strong', open: /^<strong>$/i, close: /^<\/strong>$/i },
  { name: 'i', kind: 'em', open: /^<i>$/i, close: /^<\/i>$/i },
  { name: 'em', open: /^<em>$/i, close: /^<\/em>$/i },
  { name: 's', open: /^<s>$/i, close: /^<\/s>$/i },
  { name: 'del', kind: 's', open: /^<del>$/i, close: /^<\/del>$/i },
  { name: 'u', open: /^<u>$/i, close: /^<\/u>$/i },
  { name: 'sup', open: /^<sup>$/i, close: /^<\/sup>$/i },
  { name: 'sub', open: /^<sub>$/i, close: /^<\/sub>$/i },
  { name: 'kbd', open: /^<kbd>$/i, close: /^<\/kbd>$/i },
  { name: 'mark', open: /^<mark>$/i, close: /^<\/mark>$/i },
  { name: 'markcolor', open: /^<mark\s+style\s*=\s*["'][^"']*?background(?:-color)?\s*:\s*([^;"']+)[^"']*["']\s*>$/i, close: /^<\/mark>$/i },
  { name: 'border', open: /^<span\s+style\s*=\s*["'](?:[^"']*?[^-\w"'])??border\s*:[^"']*["']\s*>$/i, close: /^<\/span>$/i },
  { name: 'colorspan', open: /^<span\s+style\s*=\s*["'](?:[^"']*?[^-\w"'])??color\s*:\s*([^;"']+)[^"']*["']\s*>$/i, close: /^<\/span>$/i },
  { name: 'colorfont', open: /^<font\s+color\s*=\s*["']?([^"'\s>]+)["']?\s*>$/i, close: /^<\/font>$/i },
];

function htmlToMarks(children: Token[]): void {
  for (let i = 0; i < children.length; i++) {
    const t = children[i];
    if (t.type !== 'html_inline') continue;
    if (/^<br\s*\/?>$/i.test(t.content)) { t.type = 'hardbreak'; continue; }
    for (const p of HTML_PAIRS) {
      const om = t.content.match(p.open);
      if (!om) continue;
      // 找對應的結尾標籤：中間同一種標籤的開頭都要算一層，不管它是哪一種格式。
      // 框線裡包顏色都是 <span>，只數「框線的開頭」會把裡面那個 </span> 當成框線的結尾
      const sameTag = new RegExp('^<' + /^<([a-z]+)/i.exec(t.content)![1] + '(?:\\s[^>]*)?>$', 'i');
      let depth = 0;
      for (let j = i + 1; j < children.length; j++) {
        const c = children[j];
        if (c.type !== 'html_inline') continue;
        if (sameTag.test(c.content)) depth++;
        else if (p.close.test(c.content)) {
          if (depth === 0) {
            const kind = p.name === 'colorfont' ? 'colorspan' : (p.kind || p.name);
            t.type = kind + '_open'; t.nesting = 1;
            c.type = kind + '_close'; c.nesting = -1;
            if (kind === 'colorspan' || kind === 'markcolor') t.attrs = [['color', om[1].trim()]];
            break;
          }
          depth--;
        }
      }
      break;
    }
  }
}

function obsidianCore(state: StateCore): void {
  const tokens = state.tokens;
  const out: Token[] = [];
  let lines: string[] | null = null; // 原文的每一行：用到才切
  const lineOf = (n: number): string => { if (!lines) lines = state.src.split('\n'); return lines[n] || ''; };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 任務清單 - [ ] / - [x]
    if (t.type === 'list_item_open' && tokens[i + 1] && tokens[i + 1].type === 'paragraph_open'
      && tokens[i + 2] && tokens[i + 2].type === 'inline') {
      const inl = tokens[i + 2];
      // 任何單一字元都算任務狀態（- [/]、- [-]、- [>] 等自訂狀態，Tasks 外掛與佈景主題會用）
      let m = inl.content.match(/^\[([^[\]\n])\][ \t]/);
      if (!m) {
        // 方框後面什麼都沒有（剛加、還沒打字的待辦事項「- [ ] 」）也是任務：markdown-it 會去掉行尾的空白，
        // 所以回頭看原文那一行。原文連空白都沒有時只認 [ ] 與 [x]，免得「- [1]」這種項目變成任務
        const bare = inl.content.match(/^\[([^[\]\n])\]$/);
        if (bare && (/[ xX]/.test(bare[1]) || (inl.map && /\][ \t]+$/.test(lineOf(inl.map[0]))))) m = bare;
      }
      const first = inl.children && inl.children[0];
      if (m && first && first.type === 'text' && first.content.startsWith(m[0])) {
        t.meta = Object.assign({}, t.meta, { checked: m[1] !== ' ', status: m[1] === ' ' || m[1] === 'x' ? null : m[1] });
        first.content = first.content.slice(m[0].length);
        inl.content = inl.content.slice(m[0].length);
      }
    }
    if (t.type === 'inline' && t.children) htmlToMarks(t.children);
    // 表格儲存格的內容包成段落（ProseMirror 表格儲存格需要區塊內容）
    if ((t.type === 'th_open' || t.type === 'td_open') && tokens[i + 1] && tokens[i + 1].type === 'inline') {
      out.push(t);
      if (tokens[i + 1].children) htmlToMarks(tokens[i + 1].children!);
      const po = new state.Token('paragraph_open', 'p', 1);
      const pc = new state.Token('paragraph_close', 'p', -1);
      out.push(po, tokens[i + 1], pc);
      i++;
      continue;
    }
    out.push(t);
  }
  state.tokens = out;
}

function createTokenizer(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true, breaks: true, linkify: false, typographer: false });
  md.use(markPlugin);
  md.normalizeLink = s => s;
  md.normalizeLinkText = s => s;
  md.inline.ruler.before('link', 'wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'obsidian_raw', rawInlineRule);
  md.core.ruler.push('obsidian_core', obsidianCore);
  return md;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

// 以清單內第一個段落判斷是否為緊密清單；全是空項目時視為緊密清單
function listIsTight(tokens: ParseToken[], i: number): boolean {
  const level = tokens[i].level;
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.level === level && /_list_close$/.test(t.type)) break;
    if (t.type === 'paragraph_open' && t.level === level + 2) return !!t.hidden;
  }
  return true;
}
const alignAttr = (tok: ParseToken): { align: string | null } => {
  const st = tok.attrGet('style') || '';
  const m = st.match(/text-align:\s*(left|center|right)/);
  return { align: m ? m[1] : null };
};

// 圖片說明文字的純文字：格式符號不算，[[連結]]、行內數學式等照原文
function altText(children: ParseToken[] | null): string {
  let out = '';
  for (const c of children || []) {
    if (c.type === 'image') out += altText(c.children);
    else if (c.type === 'softbreak' || c.type === 'hardbreak') out += ' ';
    else if (c.type === 'wikilink') { const a = c.meta as WikilinkAttrs; out += (a.embed ? '!' : '') + '[[' + a.target + (a.alias != null ? '|' + a.alias : '') + ']]'; }
    else out += c.content;
  }
  return out;
}

function createParser(tokenizer: MarkdownItInstance): MarkdownParser {
  return new MarkdownParser(schema, tokenizer, {
    blockquote: { block: 'blockquote' },
    paragraph: { block: 'paragraph' },
    // tok.meta 是 obsidianCore 為任務項目記下的 { checked, status }；一般項目是 null
    list_item: { block: 'list_item', getAttrs: tok => { const meta = tok.meta as ListItemAttrs | null; return { checked: meta && meta.checked != null ? meta.checked : null, status: (meta && meta.status) || null }; } },
    bullet_list: { block: 'bullet_list', getAttrs: (tok, tokens, i) => ({ tight: listIsTight(tokens, i), bullet: tok.markup || '-' }) },
    ordered_list: { block: 'ordered_list', getAttrs: (tok, tokens, i) => ({ order: +tok.attrGet('start')! || 1, tight: listIsTight(tokens, i) }) },
    heading: { block: 'heading', getAttrs: tok => ({ level: +tok.tag.slice(1) }) },
    code_block: { block: 'code_block', noCloseToken: true },
    fence: { block: 'code_block', getAttrs: tok => ({ params: tok.info || '' }), noCloseToken: true },
    hr: { node: 'horizontal_rule', getAttrs: tok => ({ markup: tok.markup || '---' }) },
    image: { node: 'image', getAttrs: tok => {
      // ![說明|300](圖.png)：Obsidian 的寬度寫在說明文字後面。
      // 說明文字裡有格式（![**粗** 字](圖.png)）時會切成好幾個 token，要全部接起來，只看第一個會整段不見
      let alt = altText(tok.children) || null;
      let width: string | null = null;
      const m = alt ? alt.match(/^(.*?)\|(\d+(?:x\d+)?)$/) : null;
      if (m) { alt = m[1] || null; width = m[2]; }
      return { src: tok.attrGet('src'), title: tok.attrGet('title') || null, alt, wiki: false, width };
    } },
    hardbreak: { node: 'hard_break' },
    softbreak: { node: 'hard_break' },
    em: { mark: 'em' },
    strong: { mark: 'strong' },
    s: { mark: 'strike' },
    mark: { mark: 'highlight' },
    markcolor: { mark: 'highlight', getAttrs: tok => ({ color: tok.attrGet('color') }) },
    border: { mark: 'border' },
    sup: { mark: 'sup' },
    sub: { mark: 'sub' },
    kbd: { mark: 'kbd' },
    u: { mark: 'underline' },
    colorspan: { mark: 'color', getAttrs: tok => ({ color: tok.attrGet('color') }) },
    link: { mark: 'link', getAttrs: tok => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }) },
    code_inline: { mark: 'code', noCloseToken: true },
    table: { block: 'table' },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: 'table_row' },
    th: { block: 'table_header', getAttrs: alignAttr },
    td: { block: 'table_cell', getAttrs: alignAttr },
    html_block: { node: 'raw_block', getAttrs: tok => ({ src: tok.content.replace(/\n$/, ''), kind: 'html' }) },
    html_inline: { node: 'raw_inline', getAttrs: tok => ({ src: tok.content }) },
    // tok.meta 是 wikilinkRule 建立的節點屬性
    wikilink: { node: 'wikilink', getAttrs: tok => tok.meta as WikilinkAttrs },
    wiki_image: { node: 'image', getAttrs: tok => tok.meta as ImageAttrs },
    raw_md: { node: 'raw_inline', getAttrs: tok => ({ src: tok.content }) },
  });
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

const URL_SPLIT = /(https?:\/\/[^\s<>()[\]]+)/;

// Obsidian 額外的特殊字元（== 螢光、$ 數學、%% 註解、< HTML、| 表格）。
// 只跳脫前面沒有反斜線（或有偶數個反斜線）的字元，避免重複跳脫。
// eslint-disable-next-line @typescript-eslint/unbound-method -- the original method is kept so the wrapper can call it with the right `this`
const origEsc = MarkdownSerializerState.prototype.esc;
MarkdownSerializerState.prototype.esc = function (this: SerializerState, str: string, startOfLine = false): string {
  let s = origEsc.call(this, str, startOfLine);
  if (this.options.obsidianEscapes) {
    // # 與 ^ 保留（Obsidian 標籤、區塊參照）；= 與 % 只在成對（== 螢光、%% 註解）時跳脫
    s = s.replace(/[=$%<|]/g, (m: string, i: number) => {
      if ((m === '=' || m === '%') && s[i + 1] !== m && s[i - 1] !== m) return m;
      let k = i; let n = 0;
      while (k > 0 && s[k - 1] === '\\') { k--; n++; }
      return n % 2 ? m : '\\' + m;
    });
  }
  return s;
};


// ---------------------------------------------------------------------------
// 對齊／縮排的段落：寫成一行 HTML（<p style="text-align: center">…</p>），讀回時再轉回段落
// ---------------------------------------------------------------------------
const escHtml = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescHtml = (s: string): string => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// ---- 中文與標點相鄰時 ** == ~~ 會失效（CommonMark 的 flanking 規則）：改用 HTML 標籤
// 例如「前**「引號」**後」在 Obsidian 會顯示成原本的 **，所以改寫成「前<strong>「引號」</strong>後」
const PUNCT = /[\p{P}\p{S}]/u;
const isWs = (c: string): boolean => !c || /\s/.test(c);
const isP = (c: string): boolean => !!c && PUNCT.test(c);
const DELIM_MARKS = new Set(['em', 'strong', 'strike', 'highlight', 'code', 'underline', 'sup', 'sub', 'kbd', 'border', 'color', 'link']);
function nodeChars(n: PMNode): string { return n.isText ? n.text! : n.type.name === 'hard_break' ? '\n' : 'a'; }
function lastChar(s: string): string { const a = Array.from(s); return a[a.length - 1] || ''; }
function firstChar(s: string): string { return Array.from(s)[0] || ''; }

// mark 從 parent 的 index 開始（open）或在 index 之前結束（close）：判斷用 Markdown 符號是否能正確解析
function delimiterOk(parent: PMNode, index: number, mark: Mark, open: boolean): boolean {
  let start = open ? index : index - 1;
  if (start < 0 || start >= parent.childCount || !mark.isInSet(parent.child(start).marks)) return true;
  let end = start + 1;
  while (start > 0 && mark.isInSet(parent.child(start - 1).marks)) start--;
  while (end < parent.childCount && mark.isInSet(parent.child(end).marks)) end++;
  let text = '';
  for (let i = start; i < end; i++) text += nodeChars(parent.child(i));
  const inner = text.trim();
  if (!inner) return true;
  const lead = /^\s/.test(text); const trail = /\s$/.test(text);
  const prevNode = start > 0 ? parent.child(start - 1) : null;
  const nextNode = end < parent.childCount ? parent.child(end) : null;
  const firstNode = parent.child(start); const lastNode = parent.child(end - 1);
  // 其他格式在同一個位置開始或結束時，會多出符號（* = ~ < [ 等，都算標點）
  const extra = (a: PMNode | null, b: PMNode | null): boolean => !!a && a.marks.some(m => m !== mark && DELIM_MARKS.has(m.type.name) && !(b && m.isInSet(b.marks)));
  let before = lead ? ' ' : prevNode ? lastChar(nodeChars(prevNode)) : '';
  let after = trail ? ' ' : nextNode ? firstChar(nodeChars(nextNode)) : '';
  let first = firstChar(inner); let last = lastChar(inner);
  if (!lead && extra(firstNode, prevNode)) first = '*';
  if (!trail && extra(lastNode, nextNode)) last = '*';
  if (!lead && extra(prevNode, firstNode)) before = '*';
  if (!trail && extra(nextNode, lastNode)) after = '*';
  const leftFlank = !isWs(first) && (!isP(first) || isWs(before) || isP(before));
  const rightFlank = !isWs(last) && (!isP(last) || isWs(after) || isP(after));
  return leftFlank && rightFlank;
}

function delimMark(md: string, open: string, close: string): MarkSerializerSpec {
  return {
    open: (_s, mark, parent, index) => (delimiterOk(parent, index, mark, true) ? md : open),
    close: (_s, mark, parent, index) => (delimiterOk(parent, index, mark, false) ? md : close),
    mixable: true, expelEnclosingWhitespace: true,
  };
}

// 對齊／縮排的段落會存成 HTML；HTML 裡的 [[連結]]、![[圖片]]、$數學$、%%註解%% 在 Obsidian 不會作用，
// 所以只有內容都是「文字＋一般格式＋外部網址連結」的段落可以對齊／縮排
export function htmlSafeBlock(node: PMNode): boolean {
  if (node.type.name !== 'paragraph') return false;
  let ok = true;
  node.forEach(c => {
    if (!ok) return;
    if (c.isText || c.type.name === 'hard_break') {
      for (const m of c.marks) if (m.type.name === 'link' && !/^[a-z][a-z0-9+.-]*:/i.test((m.attrs as LinkAttrs).href || '')) ok = false;
    } else ok = false;
  });
  return ok;
}

function hasBlockFormat(node: PMNode): boolean { return !!(node.attrs.align || node.attrs.indent); }

function blockStyleText(node: PMNode): string {
  const st: string[] = [];
  if (node.attrs.align) st.push('text-align: ' + node.attrs.align);
  if (node.attrs.indent) st.push('margin-left: ' + node.attrs.indent * 2 + 'em');
  return st.join('; ');
}

const MARK_HTML: Record<string, (m: Mark) => [string, string]> = {
  strong: () => ['<strong>', '</strong>'],
  em: () => ['<em>', '</em>'],
  underline: () => ['<u>', '</u>'],
  strike: () => ['<s>', '</s>'],
  code: () => ['<code>', '</code>'],
  sup: () => ['<sup>', '</sup>'],
  sub: () => ['<sub>', '</sub>'],
  kbd: () => ['<kbd>', '</kbd>'],
  highlight: m => [m.attrs.color ? `<mark style="background: ${escHtml(m.attrs.color)}">` : '<mark>', '</mark>'],
  border: () => ['<span style="border: 1px solid; padding: 0 2px">', '</span>'],
  color: m => [`<span style="color: ${escHtml(m.attrs.color)}">`, '</span>'],
  link: m => [`<a href="${escHtml(m.attrs.href)}">`, '</a>'],
};

function inlineToHtml(node: PMNode): string {
  let out = '';
  node.forEach(child => {
    let inner: string;
    if (child.isText) inner = escHtml(child.text);
    else if (child.type.name === 'hard_break') inner = '<br>';
    else if (child.type.name === 'wikilink') {
      const a = child.attrs as WikilinkAttrs;
      inner = `<a class="internal-link" data-href="${escHtml(a.target)}" href="${escHtml(a.target)}">${escHtml(a.alias || a.target.replace(/\.md$/i, ''))}</a>`;
    } else if (child.type.name === 'image') {
      const a = child.attrs as ImageAttrs;
      inner = `<img src="${escHtml(a.src)}"${a.alt ? ` alt="${escHtml(a.alt)}"` : ''}${a.width ? ` width="${escHtml(String(a.width).split('x')[0])}"` : ''}${a.wiki ? ' data-wiki="1"' : ''}>`;
    } else if (child.type.name === 'raw_inline') inner = (child.attrs as RawInlineAttrs).src;
    else inner = escHtml(child.textContent);
    const marks = child.marks.slice();
    for (let i = marks.length - 1; i >= 0; i--) {
      const f = MARK_HTML[marks[i].type.name];
      if (f) { const [o, c] = f(marks[i]); inner = o + inner + c; }
    }
    out += inner;
  });
  return out;
}

function blockHtml(node: PMNode): string {
  const tag = node.type.name === 'heading' ? 'h' + node.attrs.level : 'p';
  return `<${tag} style="${blockStyleText(node)}">${inlineToHtml(node)}</${tag}>`;
}

// 解析我們自己寫出的對齊段落 HTML（只認得上面那幾種標籤，其餘一律當作原文保留）
function parseFormattedBlock(src: string): PMNode | null {
  const m = src.trim().match(/^<(p|h[1-6])\s+style="([^"]*)">([\s\S]*)<\/\1>$/);
  if (!m || /\n\s*\n/.test(m[3])) return null;
  const style = m[2];
  const am = style.match(/text-align:\s*(left|center|right|justify)/);
  const im = style.match(/margin-left:\s*(\d+(?:\.\d+)?)em/);
  if (!am && !im) return null;
  if (style.replace(/(text-align|margin-left):[^;]*;?/g, '').trim()) return null;
  const S = schema;
  const inline: PMNode[] = [];
  const stack: { tag: string; mark: Mark }[] = [];
  const re = /<(\/?)([a-z]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi;
  let t: RegExpExecArray | null;
  let pos = 0;
  const attr = (a: string, n: string): string | null => { const x = (a || '').match(new RegExp('\\b' + n + '="([^"]*)"')); return x ? unescHtml(x[1]) : null; };
  let pendingLink: { target: string | null; text: string } | null = null;
  while ((t = re.exec(m[3]))) {
    if (t.index !== pos) return null;
    pos = re.lastIndex;
    if (t[4] != null) {
      const text = unescHtml(t[4]);
      if (pendingLink) { pendingLink.text += text; continue; }
      inline.push(S.text(text, stack.map(x => x.mark).filter(Boolean)));
      continue;
    }
    const close = !!t[1];
    const tag = t[2].toLowerCase();
    const attrs = t[3] || '';
    if (tag === 'br' && !close) { inline.push(S.nodes.hard_break.create()); continue; }
    if (tag === 'img' && !close) {
      const w = attr(attrs, 'width');
      inline.push(S.nodes.image.create({ src: attr(attrs, 'src') || '', alt: attr(attrs, 'alt'), wiki: attr(attrs, 'data-wiki') === '1', width: w }));
      continue;
    }
    if (tag === 'a' && ((!close && /class="internal-link"/.test(attrs)) || (close && pendingLink))) {
      if (!close) { pendingLink = { target: attr(attrs, 'data-href') || attr(attrs, 'href'), text: '' }; continue; }
      // close 為真時，進入這裡的條件保證 pendingLink 不是 null；target 在 <a> 沒有 data-href 與 href 時才會是 null
      const tgt = pendingLink!.target!;
      const alias = pendingLink!.text && pendingLink!.text !== tgt.replace(/\.md$/i, '') ? pendingLink!.text : null;
      inline.push(S.nodes.wikilink.create({ target: tgt, alias }));
      pendingLink = null;
      continue;
    }
    if (close) {
      const i = stack.map(x => x.tag).lastIndexOf(tag);
      if (i < 0) return null;
      stack.splice(i, 1);
      continue;
    }
    let mark: Mark | null = null;
    if (tag === 'strong' || tag === 'b') mark = S.marks.strong.create();
    else if (tag === 'em' || tag === 'i') mark = S.marks.em.create();
    else if (tag === 'u') mark = S.marks.underline.create();
    else if (tag === 's' || tag === 'del') mark = S.marks.strike.create();
    else if (tag === 'code') mark = S.marks.code.create();
    else if (tag === 'sup') mark = S.marks.sup.create();
    else if (tag === 'sub') mark = S.marks.sub.create();
    else if (tag === 'kbd') mark = S.marks.kbd.create();
    else if (tag === 'mark') { const bg = (attr(attrs, 'style') || '').match(/background(?:-color)?:\s*([^;]+)/); mark = S.marks.highlight.create({ color: bg ? bg[1].trim() : null }); }
    else if (tag === 'a') mark = S.marks.link.create({ href: attr(attrs, 'href') || '' });
    else if (tag === 'span') {
      const st = attr(attrs, 'style') || '';
      if (/(^|;)\s*border\s*:/.test(st)) mark = S.marks.border.create();
      else { const c = st.match(/(?:^|;)\s*color:\s*([^;]+)/); if (!c) return null; mark = S.marks.color.create({ color: c[1].trim() }); }
    } else return null;
    stack.push({ tag, mark });
  }
  if (pos !== m[3].length || stack.length || pendingLink) return null;
  const blockAttrs = { align: am ? am[1] : null, indent: im ? Math.max(0, Math.min(8, Math.round(parseFloat(im[1]) / 2))) : 0 };
  if (m[1] === 'p') return S.nodes.paragraph.create(blockAttrs, inline);
  return S.nodes.heading.create(Object.assign({ level: +m[1].slice(1) }, blockAttrs), inline);
}

function renderCell(state: SerializerState, cell: PMNode): string {
  const sub = new (MarkdownSerializerState as unknown as SerializerStateCtor)(state.nodes, state.marks, Object.assign({}, state.options));
  sub.inTable = true;
  if (cell.firstChild) sub.renderInline(cell.firstChild);
  return sub.out.replace(/\n/g, '<br>').replace(/\\\||\|/g, m => (m === '|' ? '\\|' : m)).trim();
}

// 節點與 mark 的序列化函式收到的 state 其實是 SerializerState（多了內部成員與 inTable 等旗標），用到時轉型
function createSerializer(): MarkdownSerializer {
  return new MarkdownSerializer({
    blockquote(state, node) { state.wrapBlock('> ', null, node, () => state.renderContent(node)); },
    callout(state, node) {
      const a = node.attrs as CalloutAttrs;
      state.wrapBlock('> ', null, node, () => {
        state.write('[!' + a.type + ']' + (a.fold || '') + (a.title ? ' ' + a.title : ''));
        const only = node.childCount === 1 && node.firstChild!.type.name === 'paragraph' && node.firstChild!.content.size === 0;
        if (!only) { state.ensureNewLine(); state.renderContent(node); }
        else state.closeBlock(node);
      });
    },
    code_block(state, node) {
      const ticks = node.textContent.match(/`{3,}/gm);
      const fence = ticks ? (ticks.sort().slice(-1)[0] + '`') : '```';
      state.write(fence + (node.attrs.params || '') + '\n');
      state.text(node.textContent, false);
      state.write('\n');
      state.write(fence);
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(state.repeat('#', (node.attrs as HeadingAttrs).level) + ' ');
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    horizontal_rule(state, node) { state.write((node.attrs as HorizontalRuleAttrs).markup || '---'); state.closeBlock(node); },
    bullet_list(state, node) { state.renderList(node, '  ', () => (node.attrs.bullet || '-') + ' '); },
    ordered_list(state, node) {
      const a = node.attrs as OrderedListAttrs;
      const start = a.order == null ? 1 : a.order;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(' ', maxW + 2);
      state.renderList(node, space, i => {
        const n = String(start + i);
        return state.repeat(' ', maxW - n.length) + n + '. ';
      });
    },
    list_item(state, node) {
      if (node.attrs.checked != null) state.write('[' + (node.attrs.checked ? (node.attrs.status || 'x') : ' ') + '] ');
      node.forEach((child, _, i) => {
        if (i && (state as SerializerState).inTightList) (state as SerializerState).flushClose(1);
        state.render(child, node, i);
      });
    },
    paragraph(state, node) {
      if (hasBlockFormat(node) && htmlSafeBlock(node) && !(state as SerializerState).inTable && !(state as SerializerState).delim) { state.text(blockHtml(node), false); state.closeBlock(node); return; }
      state.renderInline(node); state.closeBlock(node);
    },
    image(state, node) {
      const a = node.attrs as ImageAttrs;
      if (a.wiki) {
        const sep = (state as SerializerState).inTable ? '\\|' : '|';
        const extra = [a.alt, a.width].filter(x => x != null && x !== '').join(sep);
        state.write('![[' + a.src + (extra ? sep + extra : '') + ']]');
      } else {
        const src = /[\s()]/.test(a.src) && !/^<.*>$/.test(a.src) ? '<' + a.src + '>' : a.src;
        const size = a.width ? ((state as SerializerState).inTable ? '\\|' : '|') + a.width : '';
        state.write('![' + state.esc(a.alt || '') + size + '](' + src + (a.title ? ' "' + a.title.replace(/"/g, '\\"') + '"' : '') + ')');
      }
    },
    wikilink(state, node) {
      const a = node.attrs as WikilinkAttrs;
      state.write((a.embed ? '!' : '') + '[[' + a.target + (a.alias != null ? ((state as SerializerState).inTable ? '\\|' : '|') + a.alias : '') + ']]');
    },
    raw_inline(state, node) { state.text((node.attrs as RawInlineAttrs).src, false); },
    raw_block(state, node) { state.text((node.attrs as RawBlockAttrs).src, false); state.closeBlock(node); },
    frontmatter(state, node) { state.text((node.attrs as FrontmatterAttrs).src, false); state.closeBlock(node); },
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          if ((state as SerializerState).inTable || parent.type.name === 'heading') state.write('<br>');
          else state.text('\n', false);
          return;
        }
      }
    },
    text(state, node) {
      if ((state as SerializerState).inAutolink) { state.text(node.text!, false); return; }
      const parts = node.text!.split(URL_SPLIT);
      parts.forEach((p, i) => { if (p) state.text(p, i % 2 === 0); });
    },
    table(state, node) {
      const rows: TableCellOut[][] = [];
      node.forEach(row => {
        const cells: TableCellOut[] = [];
        row.forEach(cell => cells.push({ text: renderCell(state as SerializerState, cell), align: (cell.attrs as TableCellAttrs).align }));
        rows.push(cells);
      });
      const cols = Math.max(1, ...rows.map(r => r.length));
      const line = (cells: TableCellOut[]): string => '| ' + Array.from({ length: cols }, (_, i) => (cells[i] ? cells[i].text : '')).join(' | ') + ' |';
      const sep = '| ' + Array.from({ length: cols }, (_, i) => {
        const a = rows[0] && rows[0][i] ? rows[0][i].align : null;
        return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
      }).join(' | ') + ' |';
      const lines = [line(rows[0] || []), sep, ...rows.slice(1).map(line)];
      state.text(lines.join('\n'), false);
      state.closeBlock(node);
    },
  }, {
    em: delimMark('*', '<em>', '</em>'),
    strong: delimMark('**', '<strong>', '</strong>'),
    underline: { open: '<u>', close: '</u>', mixable: true, expelEnclosingWhitespace: true },
    strike: delimMark('~~', '<s>', '</s>'),
    highlight: {
      open: (_s, mark, parent, index) => (mark.attrs.color ? `<mark style="background: ${mark.attrs.color}">` : delimiterOk(parent, index, mark, true) ? '==' : '<mark>'),
      close: (_s, mark, parent, index) => (mark.attrs.color ? '</mark>' : delimiterOk(parent, index, mark, false) ? '==' : '</mark>'),
      mixable: true, expelEnclosingWhitespace: true,
    },
    border: { open: '<span style="border: 1px solid; padding: 0 2px">', close: '</span>', mixable: true, expelEnclosingWhitespace: true },
    sup: { open: '<sup>', close: '</sup>', mixable: true, expelEnclosingWhitespace: true },
    sub: { open: '<sub>', close: '</sub>', mixable: true, expelEnclosingWhitespace: true },
    kbd: { open: '<kbd>', close: '</kbd>', mixable: true, expelEnclosingWhitespace: true },
    color: {
      open: (_s, mark) => `<span style="color: ${mark.attrs.color}">`,
      close: '</span>', mixable: true, expelEnclosingWhitespace: true,
    },
    link: {
      // 沒有目標的連結（例如從網頁貼上的 <a href="">）寫成純文字：[文字]() 讀回來不是連結
      open(state, mark, parent, index) {
        if (!(mark.attrs as LinkAttrs).href.trim()) return '';
        (state as SerializerState).inAutolink = isPlainURL(mark, parent, index);
        return (state as SerializerState).inAutolink ? '<' : '[';
      },
      close(state, mark) {
        if (!(mark.attrs as LinkAttrs).href.trim()) return '';
        const { inAutolink } = state as SerializerState;
        (state as SerializerState).inAutolink = undefined;
        if (inAutolink) return '>';
        const a = mark.attrs as LinkAttrs;
        const href = /[\s]/.test(a.href) && !/^<.*>$/.test(a.href) ? '<' + a.href + '>' : a.href.replace(/[()]/g, '\\$&');
        return '](' + href + (a.title ? ` "${a.title.replace(/"/g, '\\"')}"` : '') + ')';
      },
      mixable: true,
    },
    code: {
      open(_s, _m, parent, index) { return backticksFor(parent.child(index), -1); },
      close(_s, _m, parent, index) { return backticksFor(parent.child(index - 1), 1); },
      escape: false,
    },
  }, { obsidianEscapes: true, tightLists: true, strict: true } as SerializerOptions);
}

function backticksFor(node: PMNode, side: number): string {
  const ticks = /`+/g; let m: RegExpExecArray | null; let len = 0;
  if (node.isText) while ((m = ticks.exec(node.text!))) len = Math.max(len, m[0].length);
  let r = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) r += '`';
  if (len > 0 && side < 0) r += ' ';
  return r;
}
function isPlainURL(link: Mark, parent: PMNode, index: number): boolean {
  if (link.attrs.title || !/^\w+:/.test((link.attrs as LinkAttrs).href)) return false;
  const c = parent.child(index);
  if (!c.isText || c.text !== link.attrs.href || c.marks[c.marks.length - 1] !== link) return false;
  return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

// ---------------------------------------------------------------------------
// 文件切段與往返
// ---------------------------------------------------------------------------

function splitLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) || [];
}
const isBlank = (l: string): boolean => /^[ \t]*(\r\n|\n|\r)?$/.test(l);
const stripEol = (l: string): string => l.replace(/(\r\n|\n|\r)$/, '');
// 文字的最後是不是一個空行（只看結尾的一小段；先把 \r\n 換成 \n，免得 \r\n 被當成兩個換行）
const endsWithBlankLine = (s: string): boolean => /\n[ \t]*\n$/.test(s.slice(-200).replace(/\r\n?/g, '\n'));

const CALLOUT_RE = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/;

// 把「第一段以 [!type] 開頭的引文」轉成提示框節點（可以巢狀）
function liftCallouts(node: PMNode, serializeInline: (nodes: PMNode[]) => string): PMNode {
  if (node.isText || node.isLeaf || node.isTextblock) return node;
  const children: PMNode[] = [];
  node.forEach(c => children.push(liftCallouts(c, serializeInline)));
  const first = children[0];
  if (node.type === schema.nodes.blockquote && first && first.type === schema.nodes.paragraph
    && first.firstChild && first.firstChild.isText && CALLOUT_RE.test(first.firstChild.text!)) {
    // 上面的條件已確定第一個子節點是文字、且符合 CALLOUT_RE
    const m = first.firstChild.text!.match(CALLOUT_RE)!;
    const inline: (PMNode | null)[] = [];
    first.forEach(c => inline.push(c));
    const rest = inline[0]!.text!.slice(m[0].length);
    inline[0] = rest ? schema.text(rest, inline[0]!.marks) : null;
    const items = inline.filter(Boolean) as PMNode[];
    const br = items.findIndex(c => c.type === schema.nodes.hard_break);
    const titleInline = br < 0 ? items : items.slice(0, br);
    const bodyInline = br < 0 ? [] : items.slice(br + 1);
    const title = titleInline.length ? serializeInline(titleInline).trim() : null;
    const content: PMNode[] = [];
    if (bodyInline.length) content.push(schema.nodes.paragraph.create(null, bodyInline));
    content.push(...children.slice(1));
    if (!content.length) content.push(schema.nodes.paragraph.create());
    return schema.nodes.callout.create({ type: m[1], fold: m[2] || '', title: title || null, bid: (node.attrs as BidAttrs).bid }, content);
  }
  return node.copy(Fragment.from(children));
}

// 中間有空行的 %%註解%% 與 $$數學式$$：markdown-it 會在空行把它切成兩段，後半段就變成一般文字
// （編輯後結尾還會被跳脫成 \%\%）。這裡先找出這種範圍，整段保留為原文區塊。
function protectedRanges(lines: string[], from: number): BlockRange[] {
  const out: BlockRange[] = [];
  let fence: string | null = null;
  for (let i = from; i < lines.length; i++) {
    const l = stripEol(lines[i]);
    const fm = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && !fm[2].trim()) fence = null;
      continue;
    }
    if (fm) { fence = fm[1]; continue; }
    const m = l.match(/^ {0,3}(%%|\$\$)/);
    if (!m) continue;
    const mark = m[1];
    if (l.slice(m[0].length).includes(mark)) continue; // 同一行就結束了
    let j = i + 1;
    let blank = false;
    while (j < lines.length && !stripEol(lines[j]).includes(mark)) { if (isBlank(lines[j])) blank = true; j++; }
    if (j >= lines.length) continue; // 沒有結尾：照一般文字處理
    if (blank) out.push({ start: i, end: j + 1, kind: mark === '%%' ? 'comment' : 'math' });
    i = j;
  }
  return out;
}

// 把保護範圍從原本的區塊切出來（只處理頂層的段落、原文與 HTML 區塊；清單、引文、表格、程式碼裡的不動）
function carveProtected(ranges: BlockRange[], prot: BlockRange[]): BlockRange[] {
  let out = ranges;
  for (const p of prot) {
    const hit = out.filter(r => r.start < p.end && r.end > p.start);
    if (hit.some(r => r.kind === 'frontmatter' || (r.kind === 'md' && !/^(paragraph_open|html_block)$/.test(r.token.type)))) continue;
    const next: BlockRange[] = [];
    let placed = false;
    for (const r of out) {
      if (r.end <= p.start) { next.push(r); continue; }
      if (r.start >= p.end) { if (!placed) { next.push(p); placed = true; } next.push(r); continue; }
      if (r.start < p.start) next.push(Object.assign({}, r, { end: p.start }));
      if (!placed) { next.push(p); placed = true; }
      if (r.end > p.end) next.push(Object.assign({}, r, { start: p.end }));
    }
    if (!placed) next.push(p);
    out = next;
  }
  return out;
}

// 註腳定義（[^1]: 內容）：每一個定義各自成為一個原文區塊，Word 模式才能把它顯示成註腳、個別編輯
const FOOTNOTE_DEF_LINE = /^\[\^[^\]\s]+\]:/;
function splitFootnotes(ranges: BlockRange[], lines: string[]): BlockRange[] {
  const out: BlockRange[] = [];
  for (const r of ranges) {
    const plain = r.kind === 'raw' || (r.kind === 'md' && r.token.type === 'paragraph_open');
    if (!plain || !FOOTNOTE_DEF_LINE.test(stripEol(lines[r.start]))) { out.push(r); continue; }
    let s = r.start;
    for (let i = r.start + 1; i <= r.end; i++) {
      if (i === r.end || FOOTNOTE_DEF_LINE.test(stripEol(lines[i]))) { out.push({ start: s, end: i, kind: 'footnote' }); s = i; }
    }
  }
  return out;
}

// 表格的每一列有幾格（只認沒有跳脫的 |，與 markdown-it 相同）
function rowCells(line: string): number {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  // 不用 regex lookbehind（iOS 16.4 以前不支援）：前一個字元是反斜線的 | 算跳脫，其餘才是分隔
  if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1);
  return (s.match(/\\\||\|/g) || []).filter(m => m === '|').length + 1;
}
// 有任何一列的格數比標題列多：markdown-it 會丟掉多出來的內容，重新輸出就會遺失
function tableHasExtraCells(src: string): boolean {
  const ls = src.split('\n').filter(l => l.trim());
  if (ls.length < 3) return false;
  const n = rowCells(ls[0]);
  return ls.slice(2).some(l => rowCells(l) > n);
}

// 文件屬性裡沒有任何內容（只有 --- 與 ---）
function emptyFrontmatter(src: string): boolean {
  return !String(src).replace(/^---[^\n]*\r?\n?/, '').replace(/\r?\n?(---|\.\.\.)\s*$/, '').trim();
}

function withBid(node: PMNode, bid: number): PMNode {
  if (!('bid' in (node.type.spec.attrs || {}))) return node;
  return node.type.create(Object.assign({}, node.attrs, { bid }), node.content, node.marks);
}

export class MarkdownConverter {
  declare tokenizer: MarkdownItInstance;
  declare parser: MarkdownParser;
  declare serializer: MarkdownSerializer;

  constructor() {
    this.tokenizer = createTokenizer();
    this.parser = createParser(this.tokenizer);
    this.serializer = createSerializer();
  }

  // 解析一段 Markdown（不切段、不帶 bid），提示框會轉成 callout 節點
  parseFragment(src: string): PMNode {
    const d = this.parser.parse(src, {});
    const inl = (nodes: PMNode[]): string => this.serializeNodes([schema.nodes.paragraph.create(null, nodes)]);
    const out: PMNode[] = [];
    d.forEach(n => out.push(liftCallouts(n, inl)));
    return schema.topNodeType.create(null, out.length ? out : [schema.nodes.paragraph.create()]);
  }

  serializeNodes(nodes: readonly PMNode[]): string {
    return this.serializer.serialize(schema.topNodeType.create(null, nodes));
  }

  // 解析：回傳 { doc, meta }
  parse(text: string): ParseResult {
    const lines = splitLines(text);
    const eolMatch = text.match(/\r\n|\n|\r/);
    const meta: DocMeta = {
      segments: [],
      trailingGap: '',
      eol: eolMatch ? eolMatch[0] : '\n',
      endsWithNewline: /(\r\n|\n|\r)$/.test(text) || text === '',
    };
    let ranges: BlockRange[] = []; // {start, end, kind}
    let bodyStart = 0;

    // frontmatter
    if (lines.length && stripEol(lines[0]) === '---') {
      for (let i = 1; i < lines.length; i++) {
        const l = stripEol(lines[i]);
        if (l === '---' || l === '...') { ranges.push({ start: 0, end: i + 1, kind: 'frontmatter' }); bodyStart = i + 1; break; }
      }
    }

    // 以 markdown-it 找出頂層區塊的行範圍
    const body = lines.slice(bodyStart).map(stripEol).join('\n');
    const env = {};
    let tokens: Token[] = [];
    try { tokens = this.tokenizer.parse(body, env); } catch { tokens = []; }
    const covered: [number, number, Token][] = [];
    for (const t of tokens) {
      if (t.level === 0 && t.map && t.nesting >= 0) covered.push([t.map[0] + bodyStart, t.map[1] + bodyStart, t]);
    }
    // 補上沒被任何區塊涵蓋、但不是空白的行（例如參照定義、註腳定義）
    let cursor = bodyStart;
    const pushGapRaw = (from: number, to: number): void => {
      let s: number | null = null;
      for (let i = from; i <= to; i++) {
        const blank = i === to || isBlank(lines[i]);
        if (!blank && s === null) s = i;
        if (blank && s !== null) { ranges.push({ start: s, end: i, kind: 'raw' }); s = null; }
      }
    };
    for (const [s, e, t] of covered) {
      if (s < cursor) continue;
      if (s > cursor) pushGapRaw(cursor, s);
      ranges.push({ start: s, end: Math.max(e, s + 1), kind: 'md', token: t });
      cursor = Math.max(e, s + 1);
    }
    if (cursor < lines.length) pushGapRaw(cursor, lines.length);
    ranges.sort((a, b) => a.start - b.start);
    ranges = splitFootnotes(ranges, lines);
    ranges = carveProtected(ranges, protectedRanges(lines, bodyStart));

    // 每段建立節點
    const nodes: PMNode[] = [];
    let prevEnd = 0;
    ranges.forEach((r, idx) => {
      const gapBefore = lines.slice(prevEnd, r.start).join('');
      const segText = lines.slice(r.start, r.end).join('');
      const src = lines.slice(r.start, r.end).map(stripEol).join('\n');
      prevEnd = r.end;
      let segNodes: PMNode[] | null = null;
      // 這個區塊重新輸出的結果：存檔時拿來判斷區塊有沒有被改過
      let canon: string | null = null;
      let kind: SegmentKind = r.kind;
      if (kind === 'md') {
        const first = stripEol(lines[r.start]);
        // kind 是 md 時 r 一定是 md 區塊（有 token）
        if (r.token!.type === 'html_block') kind = 'html';
        else if (/^\s*\$\$/.test(first)) kind = 'math';
        else if (/^\s*%%/.test(first)) kind = 'comment';
      }
      if (kind === 'html') {
        try {
          const fb = parseFormattedBlock(src);
          if (fb && this.serializeNodes([fb]).trim() === src.trim()) segNodes = [withBid(fb, idx)];
        } catch { segNodes = null; }
      }
      if (kind === 'frontmatter') {
        segNodes = [schema.nodes.frontmatter.create({ src, bid: idx })];
      } else if (kind === 'md') {
        try {
          let psrc = src;
          if (r.token!.type === 'table_open') {
            // 表格裡 [[筆記|別名]] 沒有跳脫的 |：當成同一格（重新輸出時會寫成 \|）
            psrc = src.replace(/!?\[\[[^[\]\n]*\]\]/g, w => w.replace(/\\\||\|/g, m => (m === '|' ? '\\|' : m)));
            if (tableHasExtraCells(psrc)) throw new Error('表格的格數比標題列多，保留原文');
          }
          const d = this.parser.parse(psrc, Object.assign({}, env));
          if (r.token!.type === 'table_open' && !(d.childCount === 1 && d.firstChild!.type === schema.nodes.table)) throw new Error('不是單純的表格，保留原文');
          segNodes = [];
          const inl = (nodes2: PMNode[]): string => this.serializeNodes([schema.nodes.paragraph.create(null, nodes2)]);
          d.forEach(n => segNodes!.push(withBid(liftCallouts(n, inl), idx)));
          if (!segNodes.length) segNodes = null;
          else canon = this.serializeNodes(segNodes); // 確認可序列化；結果就是這個區塊的 canon，下面不用再算一次
        } catch {
          segNodes = null;
        }
      }
      if (!segNodes) segNodes = [schema.nodes.raw_block.create({ src, kind: kind === 'md' ? 'raw' : kind, bid: idx })];
      if (canon == null) {
        try { canon = this.serializeNodes(segNodes); }
        catch {
          segNodes = [schema.nodes.raw_block.create({ src, kind: 'raw', bid: idx })];
          canon = this.serializeNodes(segNodes);
        }
      }
      // 區塊尾端的空行（markdown-it 有時把清單後的空行算進區塊）：修改後重新輸出時保留
      let k = r.end;
      while (k > r.start + 1 && isBlank(lines[k - 1])) k--;
      const trailing = lines.slice(k, r.end).join('');
      meta.segments.push({ text: segText, gapBefore, canon, trailing, line: r.start });
      nodes.push(...segNodes);
    });
    meta.trailingGap = lines.slice(prevEnd).join('');
    if (!nodes.length) nodes.push(schema.nodes.paragraph.create());
    return { doc: schema.topNodeType.create(null, nodes), meta };
  }

  // 兩個區塊的文字緊接著寫（中間沒有空行）會不會讀成別的東西，而且補一個空行就能分開。
  // 比的是「各自單獨讀」的結果：緊接著寫讀出來一樣就不用空行（筆記原本寫得很緊的地方不會被重排）；
  // 補了空行也不一樣的（例如參照式連結的定義在別處）就維持緊接著寫，不多加空行
  private needsBlankLine(before: string, after: string, atStart: boolean, eol: string): boolean {
    // 文件屬性只認檔案的第一行：前一個區塊不在檔案開頭時，前面墊一段文字，免得 --- 被當成文件屬性
    const blocks = (text: string, first: boolean): PMNode[] => {
      const out: PMNode[] = [];
      this.parse(first ? text : 'x' + eol + eol + text).doc.forEach(n => out.push(withBid(n, 0)));
      return first ? out : out.slice(1);
    };
    const same = (a: PMNode[], b: PMNode[]): boolean => a.length === b.length && a.every((n, i) => n.eq(b[i]));
    try {
      const apart = blocks(before, atStart).concat(blocks(after, false));
      if (same(blocks(before + after, atStart), apart)) return false;
      return same(blocks(before + eol + after, atStart), apart);
    } catch { return true; }
  }

  // 序列化：未修改的區塊輸出原文
  serialize(doc: PMNode, meta: DocMeta): string {
    const eol = meta.eol || '\n';
    const runs: { bid: number | null; nodes: PMNode[] }[] = [];
    doc.forEach(node => {
      // 頂層節點都有 bid 屬性（見 schema.ts）；沒有時與 null 相同
      const a = node.attrs as Partial<BidAttrs>;
      const b = a && a.bid != null ? a.bid : null;
      const last = runs[runs.length - 1];
      if (last && b != null && last.bid === b) last.nodes.push(node);
      else runs.push({ bid: b, nodes: [node] });
    });
    const used = new Set<number | null>();
    let out = '';
    let prevSeg = -1;
    let lastModified = false;
    let pending: string | null = null; // 已修改區塊原本尾端的空行，只在後面接回原本的下一段時使用
    const toEol = (s: string): string => s.replace(/\r\n|\r|\n/g, eol);
    const defaultSep = (): string => (out === '' ? '' : eol);
    // 檔案最後一個區塊的原文可能沒有行尾：後面還要再接東西時先補上，否則兩段會黏成同一行或同一段
    const endLine = (): void => { if (out !== '' && !/[\r\n]$/.test(out)) out += eol; };
    // 目前這一串「中間沒有空行」的區塊各自寫出的文字。檢查時帶上前面幾個：緊接在有空行的註解、數學式後面的
    // 文字，怎麼讀要看更前面的內容（markdown-it 把它們看成同一段）
    let chain: string[] = [];
    let chainAtStart = false; // 這一串是不是從檔案的第一行開始（第一行才可能是文件屬性）
    const CONTEXT = 3;
    for (const run of runs) {
      const ser = this.serializeNodes(run.nodes);
      const seg = run.bid != null && !used.has(run.bid) ? meta.segments[run.bid] : null;
      // 沒有任何屬性的文件屬性區塊（剛新增還沒填、或屬性被刪光）：不寫進檔案；原本就在檔案裡且沒動過的照舊
      if (run.nodes.length === 1 && run.nodes[0].type === schema.nodes.frontmatter && emptyFrontmatter((run.nodes[0].attrs as FrontmatterAttrs).src)
        && !(seg && ser === seg.canon)) {
        if (seg) { used.add(run.bid); lastModified = true; }
        continue;
      }
      const follows = seg && run.bid === prevSeg + 1;
      endLine();
      let sep = follows ? (pending != null ? pending : '') + seg.gapBefore : defaultSep();
      pending = null;
      if (seg) {
        used.add(run.bid);
        const same = ser === seg.canon;
        const text = same ? seg.text : toEol(ser) + eol;
        // 原文裡這兩段是緊接著寫的（# 標題的下一行就是內文）。其中一段重新產生之後，緊接著寫可能會被讀成
        // 同一段，或讓後面的內容被吃進 HTML 區塊：這時才補一個空行。兩段都沒改過就照原文，不必檢查
        const tight = sep === '' && out !== '' && !endsWithBlankLine(out);
        if (tight && !(same && !lastModified)
          && this.needsBlankLine(chain.slice(-CONTEXT).join(''), text, chainAtStart && chain.length <= CONTEXT, eol)) sep = eol;
        if (!tight || sep !== '') { chain = []; chainAtStart = out === '' && sep === ''; }
        chain.push(text);
        out += sep + text;
        lastModified = !same;
        if (!same && seg.trailing) pending = seg.trailing;
        prevSeg = run.bid!; // 有 seg 就表示 bid 不是 null
      } else {
        if (run.nodes.length === 1 && run.nodes[0].type.name === 'paragraph' && run.nodes[0].childCount === 0
          && runs.length > 1) {
          // 空白段落：Word 的空行，用一個空行表示
          out += defaultSep();
          prevSeg = -2;
          continue;
        }
        out += defaultSep() + toEol(ser) + eol;
        prevSeg = -2;
        lastModified = true;
      }
    }
    if (prevSeg === meta.segments.length - 1) out += (pending || '') + meta.trailingGap;
    else if (lastModified && !meta.endsWithNewline) out = out.replace(/(\r\n|\n|\r)$/, '');
    return out;
  }
}
