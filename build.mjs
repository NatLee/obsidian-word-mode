import esbuild from 'esbuild';
import fs from 'fs';

// 版本號的唯一來源是 package.json。根目錄的 manifest.json 由 `npm version` 同步（見 version-bump.mjs），
// 這裡檢查兩者一致，避免發佈出版本號對不上的檔案。
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
if (manifest.version !== version) {
  console.error(`manifest.json 的版本（${manifest.version}）與 package.json（${version}）不一致。請用 \`npm version <新版本>\` 更新版本號。`);
  process.exit(1);
}

const prod = process.argv.includes('--prod');
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  outfile: 'dist/main.js',
  minify: prod,
  legalComments: 'eof',
  banner: { js: '/* Word Mode for Obsidian. Bundles ProseMirror, markdown-it and their dependencies (MIT, BSD-2-Clause). Source and credits: https://github.com/NatLee/obsidian-word-mode */' },
  logLevel: 'info',
});
const css = [
  'node_modules/prosemirror-view/style/prosemirror.css',
  'node_modules/prosemirror-gapcursor/style/gapcursor.css',
  'styles/word-mode.css',
].map(f => fs.readFileSync(f, 'utf8')).join('\n');
fs.writeFileSync('dist/styles.css', css);
fs.copyFileSync('manifest.json', 'dist/manifest.json');
