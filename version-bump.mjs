// 由 `npm version <新版本>` 自動執行：把 package.json 的版本號同步到 manifest.json，
// 並在最低 Obsidian 版本有變動時更新 versions.json。
import fs from 'fs';

const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = version;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// versions.json 只需要在 minAppVersion 改變時新增一筆
const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
if (!Object.values(versions).includes(manifest.minAppVersion)) {
  versions[version] = manifest.minAppVersion;
  fs.writeFileSync('versions.json', JSON.stringify(versions, null, 2) + '\n');
}
