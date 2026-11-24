// 自動完成選單（suggest.js）需要的保管庫資料：筆記清單、標題、標籤，以及依保管庫設定產生連結
import { prepareFuzzySearch, getAllTags, TFile } from 'obsidian';
import { schema, IMAGE_EXT } from './schema.js';
import { tagsInDoc } from './links.js';
import type { Node as PMNode } from 'prosemirror-model';
import type { WordModeView } from './view.js';
import * as C from './commands.js';
import { t } from './i18n.js';
import type { I18nKey } from './i18n.js';
import type { Command } from 'prosemirror-state';
import type { SuggestContext, SuggestFileItem, SlashItem } from './suggest.js';


// 依名稱搜尋保管庫裡的檔案（筆記優先）；沒有輸入時列出最近修改的筆記
export function searchFiles(view: WordModeView, query: string): SuggestFileItem[] {
  const app = view.app;
  const files = app.vault.getFiles().filter(f => !f.path.startsWith(app.vault.configDir + '/') && f.path !== (view.file && view.file.path));
  const q = query.trim();
  const row = (f: TFile): SuggestFileItem => ({
    file: f,
    label: f.extension === 'md' ? f.basename : f.name,
    detail: f.parent && f.parent.path && f.parent.path !== '/' ? f.parent.path : '',
    icon: f.extension === 'md' ? 'file-text' : IMAGE_EXT.test(f.extension) ? 'image' : 'file',
  });
  if (!q) {
    return files.filter(f => f.extension === 'md')
      .sort((a, b) => ((b.stat && b.stat.mtime) || 0) - ((a.stat && a.stat.mtime) || 0)).slice(0, 8).map(row);
  }
  const fuzzy = prepareFuzzySearch(q);
  const scored: { f: TFile; score: number }[] = [];
  for (const f of files) {
    const a = fuzzy(f.extension === 'md' ? f.basename : f.name);
    const b = a ? null : fuzzy(f.path);
    const hit = a || b;
    if (!hit) continue;
    // 檔名符合的排在路徑符合的前面，筆記排在其他檔案前面
    scored.push({ f, score: hit.score + (a ? 0 : -10) + (f.extension === 'md' ? 0 : -1) });
  }
  return scored.sort((x, y) => y.score - x.score || x.f.path.length - y.f.path.length).slice(0, 8).map(x => row(x.f));
}

// 保管庫與這份筆記用過的標籤
function searchTags(view: WordModeView, query: string): string[] {
  const app = view.app;
  const all = new Set<string>(view.pm ? tagsInDoc(view.pm.state) : []);
  const mc = app.metadataCache;
  if (mc.getTags) { for (const tag of Object.keys(mc.getTags() || {})) all.add(tag); } else {
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = mc.getFileCache(f);
      for (const tag of (cache && getAllTags(cache)) || []) all.add(tag);
    }
  }
  const q = query.toLowerCase();
  const typed = '#' + q;
  // 以 typed 開頭的排前面（Number 把 true／false 變成 1／0 再相減），其餘照字母
  return [...all].filter(tag => tag.toLowerCase().includes(q) && tag.toLowerCase() !== typed)
    .sort((a, b) => (Number(b.toLowerCase().startsWith(typed)) - Number(a.toLowerCase().startsWith(typed))) || a.localeCompare(b));
}

// 筆記裡的標題；file 為 null 表示目前這份筆記
function headingsOf(view: WordModeView, file: TFile | null): string[] {
  if (!file) {
    const out: string[] = [];
    // 自動完成選單只在編輯器裡出現，這時 view.pm 一定已經建立
    view.pm!.state.doc.forEach(n => { if (n.type === schema.nodes.heading && n.textContent.trim()) out.push(n.textContent.trim()); });
    return out;
  }
  const cache = view.app.metadataCache.getFileCache(file);
  return ((cache && cache.headings) || []).map(h => h.heading);
}

// 產生連結節點：依保管庫設定用 [[Wiki 連結]] 或 [Markdown 連結](路徑)
export function linkNode(view: WordModeView, file: TFile | null, heading: string | null, embed: boolean | undefined): PMNode | null {
  const N = schema.nodes;
  if (!file) return heading ? N.wikilink.create({ target: '#' + heading, alias: null, embed: !!embed }) : null;
  const l = view.buildLink(file);
  if (embed && IMAGE_EXT.test(file.extension)) return N.image.create(l.wiki ? { src: l.target, wiki: true } : { src: l.href, alt: file.basename, wiki: false });
  if (l.wiki) return N.wikilink.create({ target: l.target + (heading ? '#' + heading : ''), alias: heading ? null : l.alias, embed: !!embed });
  const href = l.href + (heading ? '#' + encodeURIComponent(heading) : '');
  if (embed) return N.image.create({ src: href, alt: file.basename, wiki: false });
  return schema.text(heading ? file.basename + ' › ' + heading : l.text, [schema.marks.link.create({ href })]);
}

// 斜線選單（在段落開頭打 /）的項目。名稱用功能區按鈕的同一組字；keys 是英文的別名，中文介面下打英文也找得到
export function slashItems(view: WordModeView): SlashItem[] {
  const cmd = (c: Command) => () => { const pm = view.pm; if (pm) { c(pm.state, pm.dispatch); pm.focus(); } };
  const item = (label: I18nKey, icon: string, keys: string, run: () => void): SlashItem => ({ label: t(label), icon, keys, run });
  return [
    item('標題 1', 'heading-1', 'h1 heading title', cmd(C.setBlockStyle('h1'))),
    item('標題 2', 'heading-2', 'h2 heading', cmd(C.setBlockStyle('h2'))),
    item('標題 3', 'heading-3', 'h3 heading', cmd(C.setBlockStyle('h3'))),
    item('項目符號', 'list', 'ul bullet list', cmd(C.toggleList('bullet'))),
    item('編號', 'list-ordered', 'ol number ordered list', cmd(C.toggleList('ordered'))),
    item('核取清單', 'list-checks', 'todo task check list', cmd(C.toggleList('task'))),
    item('引文', 'quote', 'quote blockquote', cmd(C.toggleQuote)),
    item('插入表格', 'table', 'table grid', cmd(C.insertTable(3, 3))),
    item('插入程式碼區塊', 'square-code', 'code block pre', cmd(C.insertCodeBlock(''))),
    item('插入提示框', 'info', 'callout note tip warning', () => view.openCalloutMenu(null)),
    item('插入方程式', 'sigma', 'math equation latex formula', () => view.openEquation()),
    item('插入圖表（Mermaid）', 'workflow', 'mermaid diagram chart flow gantt', () => view.openMermaid()),
    item('插入圖片', 'image', 'image img picture photo', () => view.openImageMenu(null)),
    item('連結到筆記', 'file-symlink', 'note link wiki', () => view.openNoteLinkPicker()),
    item('超連結', 'link', 'link url href', () => view.openLinkDialog()),
    item('水平線', 'minus', 'hr line divider rule', cmd(C.insertHr)),
    item('插入註腳', 'asterisk', 'footnote fn', () => view.insertFootnoteDialog()),
  ];
}

export function suggestContext(view: WordModeView, icon: SuggestContext['icon']): SuggestContext {
  return {
    enabled: () => view.plugin.settings.autoComplete !== false,
    files: q => searchFiles(view, q),
    resolve: name => { const f = view.app.metadataCache.getFirstLinkpathDest(name, view.sourcePath()); return f instanceof TFile ? f : null; },
    headings: file => headingsOf(view, file),
    tags: q => searchTags(view, q),
    linkNode: (file, heading, embed) => linkNode(view, file, heading, embed),
    slash: () => view.plugin.settings.slashMenu === true ? slashItems(view) : [],
    icon,
  };
}
