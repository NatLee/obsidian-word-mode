// 在本機發佈目前的版本，不使用 GitHub Actions：
// 跑測試 → 建置 → 推 tag → 用 gh 建立 GitHub Release 並附上三個檔案。
// 需要已登入的 gh CLI，且工作目錄乾淨、main 已推上 GitHub。
import fs from 'fs';
import { execFileSync } from 'child_process';

const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
const fail = msg => { console.error(msg); process.exit(1); };

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (out('git', ['status', '--porcelain'])) fail('工作目錄有未 commit 的修改，請先 commit。');
if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('請在 main 分支上發佈。');
run('git', ['fetch', '--quiet', 'origin', 'main']);
if (out('git', ['rev-parse', 'HEAD']) !== out('git', ['rev-parse', 'origin/main'])) fail('本機的 main 與 origin/main 不同，請先 push 或 pull。');

// tag 已經存在時，必須指向現在要發佈的這個 commit；否則 Release 的檔案會跟 tag 的原始碼對不上
if (out('git', ['tag', '--list', version]) === version && out('git', ['rev-list', '-n', '1', version]) !== out('git', ['rev-parse', 'HEAD'])) {
  fail(`tag ${version} 已經存在，但指向的不是目前的 commit。請先升版（npm version），或確認要發佈的是哪一個 commit。`);
}

run('npm', ['test']);
run('npm', ['run', 'build:prod']);

// tag 與版本號完全相同（不加 v），Obsidian 才找得到這個 Release
const hasTag = out('git', ['tag', '--list', version]) === version;
if (!hasTag) run('git', ['tag', '-a', version, '-m', version]);
run('git', ['push', 'origin', version]);

run('gh', ['release', 'create', version,
  'dist/main.js', 'dist/manifest.json', 'dist/styles.css',
  '--title', version, '--generate-notes', '--verify-tag']);
