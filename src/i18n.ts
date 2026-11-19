// 多語系：介面文字以繁體中文為鍵，英文翻譯放在 en.js
import { Platform } from 'obsidian';
import * as obsidian from 'obsidian';
import EN from './i18n-en.js';
import JA from './i18n-ja.js';
import KO from './i18n-ko.js';
import NAN from './i18n-nan.js';
import ZH_CN from './i18n-zh-cn.js';
import ES from './i18n-es.js';
import AR from './i18n-ar.js';
import HE from './i18n-he.js';
import YUE from './i18n-yue.js';
import VI from './i18n-vi.js';
import FR from './i18n-fr.js';
import DE from './i18n-de.js';

// nan-TW 是台文（台語漢字），yue-HK 是粵語（香港書面粵語，繁體字）
export type Language = 'zh-TW' | 'en' | 'ja' | 'ko' | 'nan-TW' | 'yue-HK' | 'zh-CN' | 'vi' | 'fr' | 'de' | 'es' | 'ar' | 'he';
export type TranslationVars = Record<string, string | number>;

// 設定頁「介面語言」的選項：每種語言用它自己的寫法顯示，看不懂目前介面的人也找得到自己的語言
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  'zh-TW': '繁體中文', 'nan-TW': '台文', 'yue-HK': '粵語', 'zh-CN': '简体中文', en: 'English', ja: '日本語', ko: '한국어',
  vi: 'Tiếng Việt', fr: 'Français', de: 'Deutsch', es: 'Español', ar: 'العربية', he: 'עברית',
};
export const LANGUAGES = Object.keys(LANGUAGE_NAMES) as Language[];

const DICTS: Record<string, Record<string, string>> = {
  en: EN, ja: JA, ko: KO, 'nan-TW': NAN, 'yue-HK': YUE, 'zh-CN': ZH_CN, vi: VI, fr: FR, de: DE, es: ES, ar: AR, he: HE,
};
// 沒有翻到的字串退回繁體中文原文（而不是英文）的語言：讀台文、粵語的人都看得懂中文
const ZH_FALLBACK = new Set(['zh-TW', 'nan-TW', 'yue-HK']);

let lang: string = 'zh-TW';
// 快速鍵要顯示 Cmd／Option 的平台：macOS、iPhone、iPad
const isMac = Platform.isMacOS || Platform.isIosApp;

// getLanguage() 是 Obsidian 1.8.7 才有的公開 API，1.5.7 的型別定義裡沒有；較舊的版本沒有這個函式
const getAppLanguage = (obsidian as { getLanguage?: () => string }).getLanguage;

export function detectLanguage(): Language {
  let l: string | null | undefined = null;
  try { l = getAppLanguage ? getAppLanguage() : null; } catch { /* 預設 */ }
  if (!l) { try { l = window.moment && window.moment.locale(); } catch { /* 預設 */ } }
  if (!l) l = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  // 粵語：yue 或 zh-yue。香港的 zh-HK 是書面中文，照舊用繁體中文
  if (/^(yue|zh[-_]yue)/i.test(l)) return 'yue-HK';
  // Obsidian 的簡體中文是「zh」、繁體中文是「zh-TW」；系統語言可能寫成 zh-Hant、zh-HK
  if (/^zh[-_](tw|hk|mo|hant)/i.test(l)) return 'zh-TW';
  if (/^zh/i.test(l)) return 'zh-CN';
  if (/^nan/i.test(l)) return 'nan-TW';
  if (/^ja/i.test(l)) return 'ja';
  if (/^ko/i.test(l)) return 'ko';
  if (/^vi/i.test(l)) return 'vi';
  if (/^fr/i.test(l)) return 'fr';
  if (/^de/i.test(l)) return 'de';
  if (/^es/i.test(l)) return 'es';
  if (/^ar/i.test(l)) return 'ar';
  // 希伯來文的舊代碼是 iw
  if (/^(he|iw)/i.test(l)) return 'he';
  return 'en';
}

export function setLanguage(setting?: string | null): void {
  lang = !setting || setting === 'auto' ? detectLanguage() : setting;
}

export function getLanguage(): string { return lang; }

// t('粗體') → 依語言回傳；{name} 會換成 vars.name
export type I18nKey = keyof typeof EN;
export function t(s: I18nKey, vars?: TranslationVars | null): string {
  const d = DICTS[lang];
  // 沒有翻到的字串用英文；台文、粵語退回繁體中文原文（見 ZH_FALLBACK）
  let out = d && d[s] != null ? d[s] : (!ZH_FALLBACK.has(lang) && (EN as Record<string, string>)[s] != null ? (EN as Record<string, string>)[s] : s);
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

export function withKey(label: I18nKey, combo: string): string { return t(label) + ' (' + key(combo) + ')'; }

export { isMac };
