// 內嵌（![[筆記]]、![[筆記#標題]]、![[錄音.mp3]]、![[影片.mp4]]、![[文件.pdf]]、![](YouTube 網址)…）的顯示。
// Obsidian 的閱讀畫面會把這些顯示成內容，Word 模式也要看得到，不能只剩一個連結。
import { TFile, resolveSubpath, setIcon } from 'obsidian';
import { t, key } from './i18n.js';
import { el } from './dom.js';
import type { WordModeView } from './view.js';

// mediaKind 的結果：missing 是找不到的檔案，file 是交給 renderEmbed 的其他檔案
export type MediaKind = 'youtube' | 'audio' | 'video' | 'image' | 'missing' | 'file';

// renderEmbed 回傳的釋放把手（view.renderBlock 回傳的也是這個形狀）
export interface EmbedHandle { unload(): void; }

const IMAGE = /^(png|jpe?g|gif|bmp|svg|webp|avif|heic|tiff?)$/i;
const AUDIO = /^(mp3|wav|m4a|ogg|3gp|flac|oga|opus)$/i;
const VIDEO = /^(mp4|webm|ogv|mov|mkv)$/i;
const YOUTUBE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i;

const extOf = (s: string): string => { const m = /\.([A-Za-z0-9]+)$/.exec(String(s).split(/[?#]/)[0]); return m ? m[1] : ''; };

// 圖片節點（![](…)、![[…]]）實際上是什麼：image 照原本的圖片顯示，其餘交給 renderEmbed
export function mediaKind(view: WordModeView, src: string): MediaKind {
  if (/^https?:/i.test(src)) {
    if (YOUTUBE.test(src)) return 'youtube';
    const ext = extOf(src);
    return AUDIO.test(ext) ? 'audio' : VIDEO.test(ext) ? 'video' : 'image';
  }
  if (/^data:/i.test(src)) return 'image';
  const f = view.resolveFile(src);
  if (!f) return IMAGE.test(extOf(src)) || !extOf(src) ? 'image' : 'missing';
  return IMAGE.test(f.extension) ? 'image' : 'file';
}

// 取出要內嵌的那一段 Markdown：整份筆記（去掉文件屬性）、某個標題底下、或某個區塊
export async function embedSource(view: WordModeView, file: TFile, subpath: string): Promise<string | null> {
  const app = view.app;
  const data = await app.vault.cachedRead(file);
  const cache = app.metadataCache.getFileCache(file);
  if (subpath && subpath !== '#') {
    const r = cache ? resolveSubpath(cache, subpath) : null;
    if (!r) return null;
    return data.slice(r.start.offset, r.end ? r.end.offset : data.length);
  }
  if (cache && cache.frontmatterPosition) return data.slice(cache.frontmatterPosition.end.offset);
  return data.replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/, '');
}

// 在 box 裡顯示內嵌的內容；回傳 { unload() }（重畫或節點被刪除時釋放）
export function renderEmbed(view: WordModeView, target: string, box: HTMLElement): EmbedHandle {
  const app = view.app;
  let handle: EmbedHandle | null = null;
  let dead = false;
  const out: EmbedHandle = { unload() { dead = true; if (handle) { try { handle.unload(); } catch (e) { /* 忽略 */ } handle = null; } } };
  box.replaceChildren();
  const note = (icon: string, text: string, cls?: string) => {
    const d = el('span', 'wm-embed-note' + (cls ? ' ' + cls : ''), box);
    setIcon(el('span', 'wm-inline-icon', d), icon);
    d.appendChild(document.createTextNode(text));
    return d;
  };

  // ---- 網路上的影片與媒體
  const yt = YOUTUBE.exec(target);
  if (yt) {
    const f = el('iframe', 'wm-embed-frame external-embed', box);
    f.setAttribute('src', 'https://www.youtube.com/embed/' + yt[1]);
    f.setAttribute('allow', 'fullscreen');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('sandbox', 'allow-forms allow-presentation allow-same-origin allow-scripts allow-popups');
    return out;
  }
  if (/^https?:/i.test(target)) {
    const ext = extOf(target);
    const m = el(AUDIO.test(ext) ? 'audio' : 'video', 'wm-embed-media', box);
    m.controls = true; m.preload = 'metadata'; m.src = target;
    return out;
  }

  // ---- 保管庫裡的檔案
  const hash = target.indexOf('#');
  const path = hash < 0 ? target : target.slice(0, hash);
  const subpath = hash < 0 ? '' : target.slice(hash);
  const file = path ? view.resolveFile(path) : view.file;
  if (!(file instanceof TFile)) { note('file-question', t('找不到要內嵌的檔案：') + target, 'is-missing'); return out; }
  const ext = file.extension.toLowerCase();
  if (AUDIO.test(ext) || VIDEO.test(ext)) {
    const m = el(AUDIO.test(ext) ? 'audio' : 'video', 'wm-embed-media', box);
    m.controls = true; m.preload = 'metadata'; m.src = app.vault.getResourcePath(file);
    return out;
  }
  if (ext === 'md') {
    if (view.file && file.path === view.file.path && !subpath) { note('file-warning', t('這份筆記不能內嵌自己')); return out; }
    const head = el('span', 'wm-embed-title', box);
    setIcon(el('span', 'wm-inline-icon', head), 'file-text');
    head.appendChild(document.createTextNode(file.basename + (subpath ? ' › ' + subpath.replace(/^#\^?/, '').split('#').join(' › ') : '')));
    const body = el('span', 'wm-embed-body markdown-rendered', box);
    body.textContent = t('載入中…');
    embedSource(view, file, subpath).then(md => {
      if (dead) return;
      body.replaceChildren();
      if (md == null) { body.textContent = t('找不到這個標題或區塊：') + subpath; body.classList.add('is-missing'); return; }
      if (!md.trim()) { body.textContent = t('（空白）'); return; }
      handle = view.renderBlock(md, body, file.path);
    }).catch(e => { if (!dead) body.textContent = String(e && e.message ? e.message : e); });
    return out;
  }
  // ---- PDF、Canvas、Bases 與其他：交給 Obsidian 顯示；它沒顯示出東西時，至少留一個可以開啟的檔案連結
  const body = el('span', 'wm-embed-body', box);
  handle = view.renderBlock('![[' + target + ']]', body);
  setTimeout(() => {
    if (dead) return;
    const shown = body.querySelector('iframe, canvas, embed, object, img, video, audio, .pdf-embed, .canvas-embed, .bases-embed, .is-loaded');
    if (!shown && !body.textContent.trim()) note(ext === 'pdf' ? 'file-text' : 'file', file.name + t('（按住 {k} 點一下開啟）', { k: key('Mod') }));
  }, 800);
  return out;
}
