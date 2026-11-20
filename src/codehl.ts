// 程式碼區塊語法上色（使用 Obsidian 內建的 Prism）
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { CodeBlockAttrs } from './schema.js';
import { buildBlockDecorations, updateBlockDecorations } from './decoutil.js';

// Prism 由 Obsidian 的 loadPrism() 提供；這裡只描述用得到的部分
export interface PrismToken {
  type: string;
  content: string | PrismToken | (string | PrismToken)[];
  alias?: string | string[];
  length: number;
}
export interface PrismLike {
  languages: Record<string, unknown>;
  tokenize(text: string, grammar: unknown): (string | PrismToken)[];
}
export type GetPrism = () => PrismLike | null | undefined;

interface ClassRange { from: number; to: number; cls: string; }

export const codeKey = new PluginKey<DecorationSet>('wmCode');
const ALIAS: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', ps: 'powershell', ps1: 'powershell', yml: 'yaml', md: 'markdown', 'c#': 'csharp', cs: 'csharp', 'c++': 'cpp', html: 'markup', xml: 'markup', svg: 'markup' };

function flatten(tokens: (string | PrismToken)[], start: number, out: ClassRange[], classes: string[]): void {
  let pos = start;
  for (const tk of tokens) {
    if (typeof tk === 'string') { pos += tk.length; continue; }
    const cls = classes.concat(['token', tk.type]).concat(tk.alias ? ([] as string[]).concat(tk.alias) : []);
    const len = typeof tk.content === 'string' ? tk.content.length : tk.length;
    if (typeof tk.content === 'string') out.push({ from: pos, to: pos + len, cls: cls.join(' ') });
    else if (Array.isArray(tk.content)) flatten(tk.content, pos, out, cls);
    else if (tk.content) flatten([tk.content], pos, out, cls);
    pos += len;
  }
}

function langOf(node: PMNode): string {
  const lang = ((node.attrs as CodeBlockAttrs).params || '').trim().split(/\s+/)[0].toLowerCase();
  return ALIAS[lang] || lang;
}

function blockDecos(Prism: PrismLike, node: PMNode, pos: number): Decoration[] {
  const grammar = Prism.languages[langOf(node)];
  if (!grammar || !node.textContent) return [];
  const ranges: ClassRange[] = [];
  try { flatten(Prism.tokenize(node.textContent, grammar), pos + 1, ranges, []); } catch { return []; }
  return ranges.filter(r => r.to > r.from).map(r => Decoration.inline(r.from, r.to, { class: r.cls }));
}

const isCodeBlock = (node: PMNode): boolean => node.type.name === 'code_block';

function build(doc: PMNode, getPrism: GetPrism): DecorationSet {
  const Prism = getPrism();
  if (!Prism) return DecorationSet.empty;
  return buildBlockDecorations(doc, (node, pos) => blockDecos(Prism, node, pos), isCodeBlock);
}

// 只重算有改動的程式碼區塊
function update(tr: Transaction, set: DecorationSet, getPrism: GetPrism): DecorationSet {
  const Prism = getPrism();
  if (!Prism) return DecorationSet.empty;
  return updateBlockDecorations(tr, set, (node, pos) => blockDecos(Prism, node, pos), isCodeBlock);
}

// 游標所在的程式碼區塊加上 wm-code-active：會顯示結果的區塊（mermaid、dataview…）在游標進去時才顯示程式碼
export const codeActivePlugin = new Plugin({
  props: {
    decorations(state) {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'code_block') {
          return DecorationSet.create(state.doc, [Decoration.node($from.before(d), $from.after(d), { class: 'wm-code-active' })]);
        }
      }
      return null;
    },
  },
});

export function codePlugin(getPrism: GetPrism): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: codeKey,
    state: {
      init: (_, state) => build(state.doc, getPrism),
      apply: (tr, old, _o, state) => (tr.getMeta(codeKey) ? build(state.doc, getPrism) : tr.docChanged ? update(tr, old, getPrism) : old),
    },
    props: { decorations(state) { return codeKey.getState(state); } },
  });
}
