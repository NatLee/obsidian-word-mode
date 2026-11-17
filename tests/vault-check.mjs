// 在裝置上對 vault 內所有 .md 做唯讀往返檢查；只輸出統計與路徑，不輸出筆記內容
import fs from 'fs';
import path from 'path';
import { MarkdownConverter } from '../src/markdown.js';
const root = process.argv[2];
const skip = new Set(['.obsidian', '.trash']);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skip.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.toLowerCase().endsWith('.md')) files.push(p); } })(root);
const c = new MarkdownConverter();
const stat = { files: 0, exact: 0, notExact: [], errors: [], blocks: 0, raw: {}, lossy: 0, lossyByType: {}, lossyFiles: new Set(), ms: 0 };
const t0 = Date.now();
for (const f of files) {
  stat.files++;
  const rel = path.relative(root, f);
  let text; try { text = fs.readFileSync(f, 'utf8'); } catch (e) { stat.errors.push([rel, 'read: ' + e.message]); continue; }
  try {
    const { doc, meta } = c.parse(text);
    const out = c.serialize(doc, meta);
    if (out === text) stat.exact++; else {
      let i = 0; while (i < out.length && out[i] === text[i]) i++;
      stat.notExact.push([rel, 'first diff at char ' + i + ' of ' + text.length]);
    }
    doc.forEach(n => {
      stat.blocks++;
      if (n.type.name === 'raw_block') { stat.raw[n.attrs.kind] = (stat.raw[n.attrs.kind] || 0) + 1; return; }
      if (n.type.name === 'frontmatter') return;
      try {
        const s = c.serializeNodes([n]);
        const re = (c.parseFragment ? c.parseFragment.bind(c) : c.parser.parse.bind(c.parser))(s);
        const strip = (k, v) => (k === 'bid' ? undefined : v);
        const a = JSON.stringify(n.toJSON(), strip);
        const b = re.childCount === 1 ? JSON.stringify(re.firstChild.toJSON(), strip) : 'MULTI';
        if (a !== b) { stat.lossy++; stat.lossyByType[n.type.name] = (stat.lossyByType[n.type.name] || 0) + 1; stat.lossyFiles.add(rel); }
      } catch (e) { stat.lossy++; stat.lossyByType['ERR:' + n.type.name] = (stat.lossyByType['ERR:' + n.type.name] || 0) + 1; stat.lossyFiles.add(rel); }
    });
  } catch (e) { stat.errors.push([rel, e.message.slice(0, 120)]); }
}
stat.ms = Date.now() - t0;
console.log(JSON.stringify({ files: stat.files, exactRoundtrip: stat.exact, notExact: stat.notExact.length, errors: stat.errors.length, blocks: stat.blocks, rawBlocks: stat.raw, lossyBlocks: stat.lossy, lossyByType: stat.lossyByType, lossyFiles: stat.lossyFiles.size, ms: stat.ms }, null, 1));
for (const [r, m] of stat.notExact.slice(0, 15)) console.log('NOT EXACT', r, m);
for (const [r, m] of stat.errors.slice(0, 15)) console.log('ERROR', r, m);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify([...stat.lossyFiles], null, 1));
