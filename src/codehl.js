// 程式碼區塊語法上色（使用 Obsidian 內建的 Prism）
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export const codeKey = new PluginKey('wmCode');
const ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', ps: 'powershell', ps1: 'powershell', yml: 'yaml', md: 'markdown', 'c#': 'csharp', cs: 'csharp', 'c++': 'cpp', html: 'markup', xml: 'markup', svg: 'markup' };

function flatten(tokens, start, out, classes) {
  let pos = start;
  for (const tk of tokens) {
    if (typeof tk === 'string') { pos += tk.length; continue; }
    const cls = classes.concat(['token', tk.type]).concat(tk.alias ? [].concat(tk.alias) : []);
    const len = typeof tk.content === 'string' ? tk.content.length : tk.length;
    if (typeof tk.content === 'string') out.push({ from: pos, to: pos + len, cls: cls.join(' ') });
    else if (Array.isArray(tk.content)) flatten(tk.content, pos, out, cls);
    else if (tk.content) flatten([tk.content], pos, out, cls);
    pos += len;
  }
}

function langOf(node) {
  const lang = (node.attrs.params || '').trim().split(/\s+/)[0].toLowerCase();
  return ALIAS[lang] || lang;
}

function blockDecos(Prism, node, pos) {
  const grammar = Prism.languages[langOf(node)];
  if (!grammar || !node.textContent) return [];
  const ranges = [];
  try { flatten(Prism.tokenize(node.textContent, grammar), pos + 1, ranges, []); } catch (e) { return []; }
  return ranges.filter(r => r.to > r.from).map(r => Decoration.inline(r.from, r.to, { class: r.cls }));
}

function build(doc, getPrism) {
  const Prism = getPrism();
  if (!Prism) return DecorationSet.empty;
  const decos = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true;
    for (const d of blockDecos(Prism, node, pos)) decos.push(d);
    return false;
  });
  return DecorationSet.create(doc, decos);
}

// 只重算有改動的程式碼區塊
function update(tr, set, getPrism) {
  const Prism = getPrism();
  if (!Prism) return DecorationSet.empty;
  set = set.map(tr.mapping, tr.doc);
  const doc = tr.doc;
  const done = new Set();
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((oS, oE, nS, nE) => {
      const from = Math.max(0, Math.min(rest.map(nS, -1), doc.content.size));
      const to = Math.max(from, Math.min(rest.map(nE, 1), doc.content.size));
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'code_block') return !node.isTextblock;
        if (done.has(pos)) return false;
        done.add(pos);
        set = set.remove(set.find(pos + 1, pos + node.nodeSize - 1));
        set = set.add(doc, blockDecos(Prism, node, pos));
        return false;
      });
    });
  });
  return set;
}

export function codePlugin(getPrism) {
  return new Plugin({
    key: codeKey,
    state: {
      init: (_, state) => build(state.doc, getPrism),
      apply: (tr, old, _o, state) => (tr.getMeta(codeKey) ? build(state.doc, getPrism) : tr.docChanged ? update(tr, old, getPrism) : old),
    },
    props: { decorations(state) { return codeKey.getState(state); } },
  });
}
