// 執行會直接匯入 src/ 的測試：原始碼是 TypeScript，Node 不能直接載入，
// 所以先用 esbuild 把測試檔和它匯入的原始碼打包成一個檔案，再執行。
// 用法：node tests/run.mjs tests/basic.mjs [傳給測試的參數...]
import esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const test = process.argv[2];
if (!test) { console.error('用法：node tests/run.mjs <測試檔> [參數...]'); process.exit(2); }

const outfile = path.join(dir, '.build', path.basename(test).replace(/\.[^.]+$/, '') + '.mjs');
await esbuild.build({
  entryPoints: [test], bundle: true, format: 'esm', platform: 'node', outfile,
  packages: 'external', // 套件留給 Node 自己載入，只打包專案自己的檔案
  logLevel: 'warning',
});

process.argv.splice(2, 1); // 讓測試看到的參數位置跟直接執行時一樣
await import(pathToFileURL(outfile).href);
