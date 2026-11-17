// 自動完成選單（suggest.js）需要的保管庫資料：筆記清單、標題、標籤，以及依保管庫設定產生連結
import { prepareFuzzySearch, getAllTags, TFile } from 'obsidian';
import { schema } from './schema.js';
import { tagsInDoc } from './links.js';

const IMAGE_EXT = /^(png|jpe?g|gif|bmp|svg|webp|avif)$/i;

// 依名稱搜尋保管庫裡的檔案（筆記優先）；沒有輸入時列出最近修改的筆記
export function searchFiles(view, query) {
  const app = view.app;
  const files = app.vault.getFiles().filter(f => !f.path.startsWith(app.vault.configDir + '/') && f.path !== (view.file && view.file.path));
  const q = query.trim();
  const row = f => ({
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
  const scored = [];
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
export function searchTags(view, query) {
  const app = view.app;
  const all = new Set(view.pm ? tagsInDoc(view.pm.state) : []);
  const mc = app.metadataCache;
  if (mc.getTags) { for (const tag of Object.keys(mc.getTags() || {})) all.add(tag); } else {
    for (const f of app.vault.getMarkdownFiles()) {
      const cache = mc.getFileCache(f);
      for (const tag of (cache && getAllTags(cache)) || []) all.add(tag);
    }
  }
  const q = query.toLowerCase();
  const typed = '#' + q;
  return [...all].filter(tag => tag.toLowerCase().includes(q) && tag.toLowerCase() !== typed)
    .sort((a, b) => (b.toLowerCase().startsWith(typed) - a.toLowerCase().startsWith(typed)) || a.localeCompare(b));
}

// 筆記裡的標題；file 為 null 表示目前這份筆記
export function headingsOf(view, file) {
  if (!file) {
    const out = [];
    view.pm.state.doc.forEach(n => { if (n.type === schema.nodes.heading && n.textContent.trim()) out.push(n.textContent.trim()); });
    return out;
  }
  const cache = view.app.metadataCache.getFileCache(file);
  return ((cache && cache.headings) || []).map(h => h.heading);
}

// 產生連結節點：依保管庫設定用 [[Wiki 連結]] 或 [Markdown 連結](路徑)
export function linkNode(view, file, heading, embed) {
  const N = schema.nodes;
  if (!file) return heading ? N.wikilink.create({ target: '#' + heading, alias: null, embed: !!embed }) : null;
  const l = view.buildLink(file);
  if (embed && IMAGE_EXT.test(file.extension)) return N.image.create(l.wiki ? { src: l.target, wiki: true } : { src: l.href, alt: file.basename, wiki: false });
  if (l.wiki) return N.wikilink.create({ target: l.target + (heading ? '#' + heading : ''), alias: heading ? null : l.alias, embed: !!embed });
  const href = l.href + (heading ? '#' + encodeURIComponent(heading) : '');
  if (embed) return N.image.create({ src: href, alt: file.basename, wiki: false });
  return schema.text(heading ? file.basename + ' › ' + heading : l.text, [schema.marks.link.create({ href })]);
}

export function suggestContext(view, icon) {
  return {
    enabled: () => view.plugin.settings.autoComplete !== false,
    files: q => searchFiles(view, q),
    resolve: name => { const f = view.app.metadataCache.getFirstLinkpathDest(name, view.sourcePath()); return f instanceof TFile ? f : null; },
    headings: file => headingsOf(view, file),
    tags: q => searchTags(view, q),
    linkNode: (file, heading, embed) => linkNode(view, file, heading, embed),
    icon,
  };
}
