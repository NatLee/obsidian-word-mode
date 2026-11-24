// 檔案的路徑：狀態列上的顯示，以及「複製路徑」選單（筆記自己的路徑、文件裡連結與圖片指向的檔案）。
// 像 Word 的「複製路徑」，加上 Obsidian 才有的保管庫內路徑與 obsidian:// 網址
import { FileSystemAdapter, Menu, Notice, TFile, setIcon } from 'obsidian';
import { t } from './i18n.js';
import type { App, TAbstractFile } from 'obsidian';

export interface PathEntry { title: string; icon: string; value: string; }

// 這個檔案（或資料夾）可以複製的幾種路徑。brief：只列路徑本身（文件裡的連結用，選單短一點）
export function pathEntries(app: App, file: TAbstractFile, brief = false): PathEntry[] {
  const out: PathEntry[] = [{ title: t('複製保管庫內的路徑'), icon: 'folder-tree', value: file.path }];
  // 電腦上的完整路徑只有桌機有（手機的保管庫不是一般的資料夾）
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) out.push({ title: t('複製電腦上的完整路徑'), icon: 'hard-drive', value: adapter.getFullPath(file.path) });
  if (file instanceof TFile) {
    out.push({ title: t('複製 Obsidian 網址'), icon: 'link', value: 'obsidian://open?vault=' + encodeURIComponent(app.vault.getName()) + '&file=' + encodeURIComponent(file.path) });
  }
  if (brief) return out;
  out.push({ title: t('複製檔名'), icon: 'file', value: file.name });
  if (file.parent && file.parent.path && file.parent.path !== '/') out.push({ title: t('複製所在資料夾的路徑'), icon: 'folder', value: file.parent.path });
  return out;
}

export function copyPath(value: string): void {
  navigator.clipboard.writeText(value).then(() => new Notice(t('已複製：') + value), () => new Notice(t('無法複製')));
}

// 狀態列的路徑按一下或按右鍵：列出可以複製的路徑
export function openPathMenu(app: App, file: TAbstractFile, evt: MouseEvent): void {
  evt.preventDefault();
  const m = new Menu();
  for (const e of pathEntries(app, file)) m.addItem(i => i.setTitle(e.title).setIcon(e.icon).onClick(() => copyPath(e.value)));
  m.showAtMouseEvent(evt);
}

// 狀態列上的路徑：資料夾與檔名分開放，太長時縮的是資料夾，檔名留著
export function renderPath(el: HTMLElement, file: TAbstractFile | null): void {
  el.empty();
  el.toggleClass('is-empty', !file);
  if (!file) return;
  setIcon(el.createSpan('wm-bb-icon'), 'folder-open');
  const dir = file.parent && file.parent.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
  if (dir) el.createSpan({ cls: 'wm-bb-path-dir', text: dir });
  el.createSpan({ cls: 'wm-bb-path-name', text: file.name });
  el.setAttribute('aria-label', file.path + '\n' + t('按一下複製路徑'));
}
