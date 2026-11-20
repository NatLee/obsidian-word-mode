// Obsidian 沒有公開、但這個外掛用到的 API，全部集中宣告在這裡。
//
// 這些成員不在官方的型別定義裡，Obsidian 改版時可能改變或消失，所以一律宣告成「可能不存在」：
// 呼叫的地方要先檢查，或包在 try 裡，壞掉時只會少一項功能，不會讓外掛出錯。
// 新增非公開 API 的用法時，請加在這個檔案，不要在各處用 any 轉型。
import type { Command, TAbstractFile, TFile } from 'obsidian';

// ---- 第三方外掛：Templater（只描述用到的部分）
export interface TemplaterPlugin {
  settings: { templates_folder?: string };
  templater?: {
    write_template_to_file(template: TFile, file: TFile): Promise<void>;
    append_template_to_active_file(template: TFile): Promise<void>;
  };
}

// ---- 核心外掛
export interface FileExplorerInstance { revealInFolder(file: TAbstractFile): void; }
export interface GlobalSearchInstance { openGlobalSearch?(query: string): void; }
export interface TemplatesInstance { options?: { folder?: string }; }
export interface InternalPlugin<T = unknown> { enabled?: boolean; instance?: T; }

export interface InternalPlugins {
  getPluginById?(id: 'global-search'): InternalPlugin<GlobalSearchInstance> | null | undefined;
  getPluginById?(id: 'templates'): InternalPlugin<TemplatesInstance> | null | undefined;
  getPluginById?(id: string): InternalPlugin | null | undefined;
  getEnabledPluginById?(id: 'file-explorer'): FileExplorerInstance | null | undefined;
  getEnabledPluginById?(id: string): unknown;
}

// ---- 指令、設定視窗、外掛管理
export interface CommandManager {
  // 執行指令的入口；外掛會包一層來攔截 Ctrl+E（見 main.ts）
  executeCommand?(command: Command, ...rest: unknown[]): boolean;
  executeCommandById(id: string): boolean;
}
export interface SettingManager {
  open(): void;
  openTabById(id: string): void;
  activeTab?: { id: string } | null;
}
export interface PluginManager {
  plugins?: Record<string, unknown> & { 'templater-obsidian'?: TemplaterPlugin };
  disablePlugin?(id: string): Promise<void>;
  enablePlugin?(id: string): Promise<void>;
}

// ---- 拖曳、文件屬性的型別
export interface DragManager {
  draggable?: { type: string; file?: TFile; files?: TFile[] } | null;
}
export interface PropertyInfo { widget?: string; type?: string; }
export interface MetadataTypeManager {
  getPropertyInfo?(key: string): PropertyInfo | null | undefined;
  properties?: Record<string, PropertyInfo>;
}

declare module 'obsidian' {
  // 選單項目的子選單：回傳子選單，在裡面加項目。不是公開 API，使用前先檢查有沒有這個函式
  interface MenuItem {
    setSubmenu?(): Menu;
  }
  interface App {
    commands?: CommandManager;
    setting?: SettingManager;
    plugins?: PluginManager;
    internalPlugins?: InternalPlugins;
    dragManager?: DragManager;
    metadataTypeManager?: MetadataTypeManager;
  }
  interface SettingTab {
    // Obsidian 1.13 起：點設定搜尋的結果時，用這個方法找出那項設定畫在哪個元素上，再捲過去。
    // def 是 getSettingDefinitions() 回傳的其中一項定義
    getElementForDefinition?(def: object): HTMLElement | undefined;
  }
  interface TextFileView {
    // 上一次寫入還沒完成。1.5 的 Obsidian 有這個欄位（這時再呼叫 save() 不會寫，等寫完再存一次）；
    // 後來的版本改成等上一次寫完再寫，沒有這個欄位
    saving?: boolean;
  }
  interface Vault {
    // 讀取 Obsidian 自己的設定（例如 'spellcheck'）
    getConfig?(key: string): unknown;
  }
  interface MetadataCache {
    // 整個保管庫的標籤與使用次數：{ '#標籤': 次數 }
    getTags?(): Record<string, number> | null | undefined;
  }
  namespace MarkdownPreviewRenderer {
    // 其他外掛註冊的程式碼區塊處理器（dataview 等），以語言名稱為鍵
    let codeBlockPostProcessors: Record<string, unknown> | undefined;
  }
}
