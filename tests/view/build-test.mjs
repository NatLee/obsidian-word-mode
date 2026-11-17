// 把檢視與測試替身打包成 tests/view/bundle.mjs，給 test.mjs 在 jsdom 裡載入
import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
await esbuild.build({ entryPoints: [path.join(dir, 'entry.js')], bundle: true, format: 'esm', platform: 'neutral', outfile: path.join(dir, 'bundle.mjs'),
  alias: { obsidian: path.join(dir, 'obsidian-mock.js') }, mainFields: ['module', 'main'], logLevel: 'warning' });
