// 多語系：介面文字以繁體中文為鍵，英文翻譯放在 en.js
import EN from './i18n-en.js';
import JA from './i18n-ja.js';
import KO from './i18n-ko.js';

export type Language = 'zh-TW' | 'en' | 'ja' | 'ko';
export type TranslationVars = Record<string, string | number>;

const DICTS: Record<string, Record<string, string>> = { en: EN, ja: JA, ko: KO };

let lang: string = 'zh-TW';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

export function detectLanguage(): Language {
  let l: string | null | undefined = null;
  try { l = window.localStorage.getItem('language'); } catch (e) { /* 預設 */ }
  if (!l) { try { l = window.moment && window.moment.locale(); } catch (e) { /* 預設 */ } }
  if (!l) l = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  if (/^zh/i.test(l)) return 'zh-TW';
  if (/^ja/i.test(l)) return 'ja';
  if (/^ko/i.test(l)) return 'ko';
  return 'en';
}

export function setLanguage(setting?: string | null): void {
  lang = !setting || setting === 'auto' ? detectLanguage() : setting;
}

export function getLanguage(): string { return lang; }

// t('粗體') → 依語言回傳；{name} 會換成 vars.name
export function t(s: string, vars?: TranslationVars | null): string {
  const d = DICTS[lang];
  // 日文、韓文沒有翻到的字串用英文
  let out = d && d[s] != null ? d[s] : (lang !== 'zh-TW' && (EN as Record<string, string>)[s] != null ? (EN as Record<string, string>)[s] : s);
  if (vars) for (const k of Object.keys(vars)) out = out.split('{' + k + '}').join(vars[k] as string);
  return out;
}

// 快速鍵顯示：Mod → Ctrl 或 ⌘
export function key(combo: string): string {
  return combo.split('+').map(p => {
    if (p === 'Mod') return isMac ? 'Cmd' : 'Ctrl';
    if (p === 'Alt') return isMac ? 'Option' : 'Alt';
    return p;
  }).join('+');
}

export function withKey(label: string, combo: string): string { return t(label) + ' (' + key(combo) + ')'; }

export { isMac };
