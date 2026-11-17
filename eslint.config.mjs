// ESLint 設定：使用 Obsidian 官方的規則（社群外掛目錄的自動審查用的是同一套）。
// 請從專案根目錄執行（npm run lint），這套規則也會檢查 package.json、manifest.json 與 LICENSE。
import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  // 建置產物、測試與 Node 腳本不是外掛的原始碼
  globalIgnores(['node_modules', 'dist', 'dist-test', '.worktrees', 'tests', 'docs', 'build.mjs', 'version-bump.mjs', 'release-local.mjs']),
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
  {
    // 以下規則的嚴重程度比照社群目錄的審查設定（見 eslint-plugin-obsidianmd 的
    // docs/configuration.md「Community plugin scanner configuration」）：審查時列為警告或停用。
    files: ['**/*.ts'],
    rules: {
      // ProseMirror 的 node.attrs 與部分 Obsidian API 的型別是 any，會一路傳到使用的地方
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      // 事件處理函式是 async 的地方
      'obsidianmd/no-misused-promises': 'warn',
      // 正規表示式裡多餘的跳脫字元：不影響行為，轉換用的規則不為了這個去動
      'no-useless-escape': 'warn',
    },
  },
]);
