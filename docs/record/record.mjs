// 錄製 README 裡的動畫（docs/images/<場景>.<語言>.webp）。
// 用法（在專案根目錄執行）：
//   node docs/record/record.mjs table equation             重錄這幾個場景（四種語言）
//   node docs/record/record.mjs table --lang en,zh-TW      只錄這幾種語言
//   node docs/record/record.mjs typing --lang en --png     不錄動畫，只存最後一個畫面（調整場景時看結果用）
//   node docs/record/record.mjs --all                      全部場景
// 只重錄介面有變的場景：每次重錄的檔案都會永久留在 git 歷史裡，所以要指名場景，全部重錄要明確加 --all。
// 需要 Google Chrome（或用環境變數 CHROME 指定路徑）、PATH 上的 ffmpeg，以及網路（從 jsDelivr 載入 Lucide、Mermaid、MathJax）。
// 外掛的程式碼是真的（src/ 打包進來），只有 Obsidian 的 API 換成 mock.js 的替身。
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { launch, Recorder } from './driver.mjs';
import { SCENES } from './scenes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const cache = path.join(here, '.cache');
const images = path.join(repo, 'docs/images');
const LANGS = ['en', 'zh-TW', 'ja', 'ko'];

const args = process.argv.slice(2);
const langArg = args.indexOf('--lang');
const langs = langArg >= 0 ? args[langArg + 1].split(',') : LANGS;
const pngOnly = args.includes('--png');
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--lang');
for (const n of names) if (!SCENES[n]) { console.error(`沒有「${n}」這個場景。可用的場景：${Object.keys(SCENES).join('、')}`); process.exit(1); }
if (!names.length && !args.includes('--all')) {
  console.error(`請指定要重錄的場景（${Object.keys(SCENES).join('、')}），只重錄介面有變的；全部重錄請加 --all。`);
  process.exit(1);
}
for (const l of langs) if (!LANGS.includes(l)) { console.error(`不支援的語言：${l}`); process.exit(1); }

// ---- 打包：外掛的檢視 + Obsidian 替身 → .cache/bundle.js；外掛的樣式 → .cache/plugin.css
fs.mkdirSync(cache, { recursive: true });
const main = fs.readFileSync(path.join(repo, 'src/main.ts'), 'utf8');
const m = /const DEFAULTS: Settings = (\{[\s\S]*?\n\});/.exec(main);
if (!m) throw new Error('src/main.ts 裡找不到 DEFAULTS');
// DEFAULTS 是一般的物件常值（含註解），直接當 JavaScript 求值
fs.writeFileSync(path.join(cache, 'defaults.json'), JSON.stringify(new Function('return ' + m[1])()));
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');
await esbuild.build({
  entryPoints: [path.join(here, 'entry.js')],
  bundle: true, format: 'iife', globalName: 'WM', platform: 'browser', target: 'es2020',
  outfile: path.join(cache, 'bundle.js'),
  alias: { obsidian: path.join(here, 'mock.js') },
  logLevel: 'error',
});
fs.writeFileSync(path.join(cache, 'plugin.css'), ['node_modules/prosemirror-view/style/prosemirror.css', 'node_modules/prosemirror-gapcursor/style/gapcursor.css', 'styles/word-mode.css']
  .map(f => fs.readFileSync(path.join(repo, f), 'utf8')).join('\n'));

// ---- 錄製：每支動畫開一個新的 Chrome，彼此不受影響
let port = 9333;
for (const name of names.length ? names : Object.keys(SCENES)) {
  const scene = SCENES[name];
  const size = { width: scene.width || 1000, height: scene.height || 640 };
  for (const lang of langs) {
    const cdp = await launch({ ...size, port: port++, profile: path.join(cache, 'profile') });
    const rec = new Recorder(cdp, size);
    try {
      await rec.goto(path.join(here, 'page.html'));
      await scene.run(rec, lang);
      if (pngOnly) { await rec.png(path.join(cache, `${name}.${lang}.png`)); console.log(`  ${path.join(cache, `${name}.${lang}.png`)}`); }
      else await rec.webp(path.join(images, `${name}.${lang}.webp`), cache);
    } catch (e) {
      // 失敗時存下當時的畫面，看得出卡在哪一步
      const shot = path.join(cache, `${name}.${lang}.error.png`);
      try { await rec.png(shot); } catch { /* 頁面已經關閉 */ }
      console.error(`${name}.${lang} 失敗：${e.message}\n  當時的畫面：${shot}`);
      process.exitCode = 1;
    } finally { cdp.close(); }
  }
}
