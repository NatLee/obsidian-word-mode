// ESLint 設定：使用 Obsidian 官方的規則（社群外掛目錄的自動審查用的是同一套）。
// 請從專案根目錄執行（npm run lint），這套規則也會檢查 package.json、manifest.json 與 LICENSE。
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  // 建置產物、測試、Node 腳本與草稿檔不是外掛的原始碼
  globalIgnores(['node_modules', 'dist', 'dist-test', '.worktrees', 'tests', 'docs', 'build.mjs', 'version-bump.mjs', 'release-local.mjs', 'scratch*.mjs']),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs'],
        },
      },
    },
  },
]);
