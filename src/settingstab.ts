// 設定頁
import { PluginSettingTab, Setting, Notice, Platform } from 'obsidian';
import { t, withKey, key, setLanguage, getLanguage, LANGUAGES, LANGUAGE_NAMES } from './i18n.js';
import { DEFAULTS } from './settings.js';
import { caretDemo, caretLook, caretPeriod, CARET_PERIOD } from './caret.js';
import { PAD_HOLD, padHold, padSpeed } from './toolbar.js';
import { LOUPE_WIDTH, LOUPE_ZOOM, loupeOptions } from './loupe.js';
import { KEY_IDS, KEY_LOOK, keyRowKeys } from './keyrow.js';
import { renderMathInto } from './mathrender.js';
import { mdToolbarMode } from './mdbar.js';
import { TABS } from './ribbon.js';
import { fillGroupSettings } from './groupsettings.js';
import { buildSettingNav, buildSettingSearch, revealSetting, settingTerms, showSettingSection, trackSettingPadding } from './settingsnav.js';
import { ShortcutModal } from './dialogs.js';
import { DIAGRAM_KINDS, detectKind } from './diagrams.js';
import { buildTemplateManager } from './templateui.js';
import type { App } from 'obsidian';
import type WordModePlugin from './main.js';
import type { ConflictMode, LanguageSetting, OutlinePlace, ToggleKey, ToolbarPosition } from './settings.js';
import type { I18nKey } from './i18n.js';
import type { PropsStyle } from './view.js';
import type { CaretBlink, CaretShape } from './caret.js';
import type { RibbonLayout, ButtonStyle, TabStyle } from './ribbon.js';
import type { EquationEditMode } from './dialogs.js';
import type { SettingNav, SettingSearchItem } from './settingsnav.js';
import type { MermaidTab } from './mermaid.js';

// 設定頁的內容只在 settingSections() 描述一次。Obsidian 1.13 以前由 display() 依序畫出來；
// 1.13 起 Obsidian 改用 getSettingDefinitions() 回傳的定義畫設定頁（有定義時不再呼叫 display()），設定搜尋也用這份定義。
// 兩條路徑的名稱、說明與控制項（含 onChange）都來自同一份資料

// 設定頁的一列；name、desc 是已翻譯的文字
//   setting：一般的設定列。build 在 Obsidian 的 Setting 上加控制項（開關、下拉選單、滑桿、文字框、按鈕）；
//            名稱與說明由畫設定頁的一方設定，build 不再設定。build 的回傳值不使用
//   grid：自訂的勾選區塊（顯示的分頁與按鈕群組、右鍵選單要顯示的項目）。fill 在格線容器裡放勾選框；
//         cls 是 display() 畫的區塊外框的 CSS class
//   note：一段說明文字，不是設定；cls 是 display() 畫的段落另外加的 CSS class；nosearch 為 true 時設定頁的搜尋找不到它
//   heading：一類裡的小節標題（一類的設定很多時分成幾節）。後面的列到下一個小節標題為止都屬於這一節；
//            Obsidian 1.13 起每一節是一個有標題的群組，舊版畫成 Setting 的標題列。設定頁的搜尋找不到它
// common 為 true 的列，在設定頁的搜尋框還沒打字時列在「常用的設定」
type SettingRow = { common?: boolean } & (
  | { kind: 'setting'; name: string; desc: string; build: (setting: Setting) => unknown }
  | { kind: 'grid'; name: string; desc?: string; cls: string; fill: (grid: HTMLElement) => void }
  | { kind: 'note'; desc: string; cls?: string; nosearch?: boolean }
  | { kind: 'heading'; name: string });

// 設定頁的分類。設定頁上方有一條分類列，一次只顯示一類（見 settingsnav.ts）。
// 加一類時，styles/word-mode.css 的「設定頁：分類列」也要加一條對應的隱藏規則
type SectionId = 'general' | 'edit' | 'display' | 'toolbar' | 'ctx' | 'math' | 'sync' | 'advanced';

// 設定頁的一類：heading 是分類列上的名稱，icon 是名稱前的圖示
interface SettingSection {
  id: SectionId;
  heading: I18nKey;
  icon: string;
  rows: SettingRow[];
}

// Obsidian 1.13 起 getSettingDefinitions() 回傳的設定定義。外掛支援 Obsidian 1.5.7 起的版本，
// obsidian 套件的型別刻意固定在 1.5.7，裡面沒有這些型別，所以只在這裡宣告用到的欄位；
// 欄位與 1.13 型別定義裡的 SettingDefinitionRender（name、desc、searchable、render）及 SettingDefinitionGroup（type、heading、items）相同
interface SettingDefinitionRender {
  name: string;
  desc?: string;
  // false：不列入設定搜尋
  searchable?: boolean;
  // Obsidian 建立這一列的 Setting、設好名稱與說明後呼叫，在 setting 上加控制項。
  // 回傳的函式會在這一列重畫或移除前呼叫；Obsidian 會把任何有值的回傳值當成這個函式，所以不要回傳別的東西
  render: (setting: Setting) => void | (() => void);
}
interface SettingDefinitionGroup {
  type: 'group';
  heading?: string;
  // 加在群組外框上的 CSS class（多個用空白分開）
  cls?: string;
  items: SettingDefinitionRender[];
}

// 設定頁的內容。每次畫設定頁或取得定義時重新建立，讀的是當時的 plugin.settings
function settingSections(settingTab: WordModeSettings): SettingSection[] {
  const p = settingTab.plugin;
  const S = p.settings;
  const save = async () => { p.applyOptions(); await p.saveSettings(); };
  const toggle = (setting: Setting, k: ToggleKey, after?: (v: boolean) => unknown) => setting.addToggle(tg => tg.setValue(!!(S[k] == null ? DEFAULTS[k] : S[k])).onChange(async v => { S[k] = v; await save(); if (after) after(v); }));
  const rebuild = async () => { await save(); p.refreshToolbars(); };
  const row = (name: string, desc: string, build: (setting: Setting) => unknown): SettingRow => ({ kind: 'setting', name, desc, build });
  const toggleRow = (name: string, desc: string, k: ToggleKey, after?: (v: boolean) => unknown): SettingRow => row(name, desc, s => toggle(s, k, after));
  // 常用的設定：設定頁的搜尋框還沒打字時先列出來
  const common = (r: SettingRow): SettingRow => Object.assign(r, { common: true });
  // 一類裡的小節標題
  const sub = (name: I18nKey): SettingRow => ({ kind: 'heading', name: t(name) });
  // 游標的預覽（caret.ts 的 caretDemo）：游標的設定改了就照新的設定重畫
  let demo: { update(): void } | null = null;
  const caretChanged = async () => { await save(); p.applyCaretLook(); if (demo) demo.update(); };

  return [
    // ------------------------------------------------ 一般
    { id: 'general', heading: '一般', icon: 'settings', rows: [
      common(row(t('介面語言'), t('Word 模式的按鈕、選單與提示文字使用的語言。「自動」會跟著 Obsidian 的語言。'),
        s => s.addDropdown(d => d.addOptions(Object.assign({ auto: t('自動（跟隨 Obsidian）') }, LANGUAGE_NAMES))
          .setValue(S.language || 'auto').onChange(v => p.changeLanguage(v as LanguageSetting))))),
      common(toggleRow(t('預設用 Word 模式開啟筆記'), t('開啟 .md 筆記時自動使用 Word 模式。可隨時用右上角按鈕切回 Markdown。'), 'openByDefault')),
      row(t('不使用 Word 模式的資料夾'), t('每行一個資料夾（例如模板資料夾），裡面的筆記一律用 Markdown 開啟。'),
        s => s.addTextArea(ta => ta.setValue(S.excludeFolders).onChange(async v => { S.excludeFolders = v; await save(); }))),
    ] },

    // ------------------------------------------------ 編輯
    { id: 'edit', heading: '編輯', icon: 'pencil', rows: [
      sub('輸入與格式'),
      toggleRow(t('沒有選取文字時，格式套用到游標所在的詞'),
        t('像 Word 一樣：游標在詞中間按粗體，整個詞會變粗體。關閉後只影響接下來輸入的文字。'), 'wordAtCursor'),
      toggleRow(t('輸入時自動套用格式'),
        t('段落開頭打「- 」「1. 」「# 」「> 」「[ ] 」會變成清單、編號、標題、引文、核取清單；打完 **粗體**、*斜體*、`程式碼`、[[筆記]] 也會直接變成格式。套用格式是獨立的一步：按一次 {k}（或緊接著按 Backspace）只取消格式，打的字還在。', { k: key('Mod+Z') }), 'autoFormat'),
      toggleRow(t('輸入 [[ 與 # 時顯示選單'),
        t('打 [[ 會列出筆記（[[筆記# 列出標題），打 # 會列出用過的標籤，用方向鍵與 Enter 選擇。'), 'autoComplete'),
      toggleRow(t('在段落開頭打 / 顯示插入選單'),
        t('在空白段落打 / 會列出標題、清單、表格、圖表、方程式等，繼續打字可以篩選，用方向鍵與 Enter 選擇。'), 'slashMenu'),
      toggleRow(t('貼上 Markdown 文字時顯示「轉成格式」選項'),
        t('從 ChatGPT 等地方複製的 Markdown 純文字，貼上後可一鍵轉成粗體、標題、清單等格式。'), 'pasteChip'),
      sub('切換模式'),
      toggleRow(withKey('切換 Word 模式與 Markdown', 'Mod+E'),
        t('開啟時，在 Markdown 畫面按 {k} 會回到 Word 模式（取代 Obsidian 原本的「切換閱讀／編輯」）。閱讀模式可用下方狀態列的按鈕開啟。', { k: key('Mod+E') }), 'ctrlE'),
      toggleRow(t('切換模式時保留復原紀錄'),
        t('切到 Markdown 編輯再切回來，仍可用 {k} 復原之前的修改（最多保留 30 份筆記、6 小時）。', { k: key('Mod+Z') }), 'keepHistory'),
    ] },

    // ------------------------------------------------ 顯示
    { id: 'display', heading: '顯示', icon: 'monitor', rows: [
      sub('頁面'),
      common(toggleRow(t('全寬頁面'), t('關閉時以 A4 紙張寬度顯示，開啟時使用整個視窗寬度。'), 'fullWidth', v => p.setFullWidth(v))),
      common(row(t('頁面縮放'), t('也可以用 {k}+滑鼠滾輪，或右下角的縮放列調整。', { k: key('Mod') }),
        s => s.addSlider(sl => sl.setLimits(50, 200, 10).setValue(S.zoom || 100).setDynamicTooltip().onChange(v => p.setZoom(v))))),
      sub('游標'),
      row(t('預覽'), t('照下面的設定畫出來的游標：每隔一下移到別的字，停下來的時候照設定閃爍。'),
        s => { demo = caretDemo(s.controlEl, t('像 Word 一樣編輯你的筆記'), () => Object.assign(caretLook(S.caretShape, S.caretBlink, S.caretSmooth), { color: S.caretColor || 'accent', custom: S.caretCustom || '', period: caretPeriod(S.caretPeriod) })); }),
      row(t('游標的樣式'), t('Word 模式裡打字位置的那條線。「細線」與「粗線」是圓角的直線，「方塊」蓋住一個字的寬度，「底線」畫在字的下方；「系統原本的」用瀏覽器內建的游標。手機與平板也一樣；長按準備拖曳選取時會暫時換回系統的游標（系統的放大鏡要用它）。'),
        s => s.addDropdown(d => d.addOptions({ line: t('細線'), thick: t('粗線'), block: t('方塊'), underline: t('底線'), native: t('系統原本的') })
          .setValue(caretLook(S.caretShape, S.caretBlink, S.caretSmooth).shape).onChange(async v => { S.caretShape = v as CaretShape; await caretChanged(); }))),
      row(t('游標的顏色'), t('「強調色」跟著 Obsidian 的主題；「自訂」用右邊選的顏色。'),
        s => s.addDropdown(d => d.addOptions({ accent: t('強調色'), text: t('跟文字一樣'), custom: t('自訂') })
          .setValue(S.caretColor || 'accent').onChange(async v => { S.caretColor = v as 'accent' | 'text' | 'custom'; await caretChanged(); }))
          .addColorPicker(c => c.setValue(S.caretCustom || DEFAULTS.caretCustom).onChange(async v => { S.caretCustom = v; S.caretColor = 'custom'; await caretChanged(); }))),
      row(t('游標的閃爍'), t('「淡入淡出」慢慢變淡再回來，比較不刺眼；「閃爍」是一亮一滅；「不閃」一直顯示。打字與移動游標的時候都不會閃。'),
        s => s.addDropdown(d => d.addOptions({ fade: t('淡入淡出'), blink: t('閃爍'), solid: t('不閃') })
          .setValue(caretLook(S.caretShape, S.caretBlink, S.caretSmooth).blink).onChange(async v => { S.caretBlink = v as CaretBlink; await caretChanged(); }))),
      row(t('游標閃爍的速度'), t('閃一次（或淡出再淡入一次）要幾秒，數字越小越快，預設 1.3 秒。選「不閃」或「系統原本的」游標時沒有作用。'),
        s => s.addSlider(sl => sl.setLimits(CARET_PERIOD.min, CARET_PERIOD.max, CARET_PERIOD.step).setValue(caretPeriod(S.caretPeriod)).setDynamicTooltip()
          .onChange(async v => { S.caretPeriod = caretPeriod(v); await caretChanged(); }))),
      toggleRow(t('游標平滑移動'), t('打字或移動游標時，游標滑到新的位置而不是直接跳過去（像 Word）。選「系統原本的」游標時沒有作用。'), 'caretSmooth', () => { p.applyCaretLook(); if (demo) demo.update(); }),
      sub('文件屬性'),
      toggleRow(t('文件屬性固定在頁面上方'),
        t('往下捲動、文件屬性捲出畫面之後，上方會浮出一條精簡的屬性列（每個屬性的名稱與值排成一行），隨時看得到。點一下展開完整清單；屬性很多時可以篩選，清單在框內捲動。'), 'propsSticky', v => p.setPropsSticky(v)),
      row(t('文件屬性的外觀'), t('「區塊」有框線與淡底色，一看就知道是屬性；「只有框線」沒有底色；「簡潔」沒有框線，只在下方有一條分隔線。'),
        s => s.addDropdown(d => d.addOptions({ card: t('區塊（框線加底色）'), outline: t('只有框線'), plain: t('簡潔（沒有框線）') })
          .setValue(S.propsStyle || 'card').onChange(async v => { S.propsStyle = v as PropsStyle; await save(); p.applyPropsLook(); }))),
      toggleRow(t('固定的屬性列顯示屬性名稱'), t('關閉後屬性列只顯示值，一行可以放更多屬性。'), 'pinLabels', () => p.applyPropsLook()),
      sub('文件內容'),
      toggleRow(t('開啟筆記時顯示編輯標記（¶）'),
        t('顯示空白（·）、全形空白（□）、Tab（→）、換行（↵）與段落結尾（¶）。也可以用工具列的 ¶ 按鈕隨時切換。'), 'showMarks'),
      toggleRow(t('一直標示奇怪符號'),
        t('即使沒開編輯標記，也用紅色波浪底線標出看不見的字元、亂碼、殘留的 ** == [[ 與落單的引號。可到「校閱 → 清理符號」一次清除。'), 'highlightWeird', () => p.refreshViews()),
      toggleRow(t('顯示圖表與查詢的結果'),
        t('Mermaid 圖表、Dataview 查詢與其他外掛的程式碼區塊顯示成結果（像 Obsidian 的閱讀畫面）。游標進到區塊裡，或按區塊上方的「原始碼」按鈕，才顯示程式碼。關閉後一律顯示程式碼。'), 'codePreview', () => p.refreshViews()),
      toggleRow(t('很長的圖表先收合'), t('圖表或查詢的結果很高時，先收合成固定的高度，下面有「顯示完整內容」可以展開。關閉後一律顯示完整的內容。'), 'collapseTall', () => p.refreshViews()),
      toggleRow(t('程式碼區塊顯示行號'),
        t('在程式碼左邊顯示行號。開啟時太長的行不會自動換行，改成左右捲動。'), 'codeLineNumbers', () => p.refreshViews()),
    ] },

    // ------------------------------------------------ 工具列
    { id: 'toolbar', heading: '工具列', icon: 'layout-panel-top', rows: [
      sub('版面與按鈕'),
      row(t('版面'), t('「分頁」像 Word（常用／插入／校閱／檢視）；「一行」把所有按鈕排成一行，可左右捲動；「自動換行」把所有按鈕都顯示出來，放不下就換行。'),
        s => s.addDropdown(d => d.addOptions({ tabs: t('分頁（像 Word）'), single: t('全部排成一行'), wrap: t('全部顯示（自動換行）') })
          .setValue(S.ribbonLayout || 'tabs').onChange(async v => { S.ribbonLayout = v as RibbonLayout; await rebuild(); }))),
      row(t('按鈕樣式'), t('「自動」：常用功能只顯示圖示，插入、校閱、檢視的按鈕下方有名稱。「只顯示圖示」最精簡；「圖示加文字」每個按鈕都有名稱。'),
        s => s.addDropdown(d => d.addOptions({ auto: t('自動'), icon: t('只顯示圖示'), label: t('圖示加文字') })
          .setValue(S.buttonStyle || 'auto').onChange(async v => { S.buttonStyle = v as ButtonStyle; S.buttonStyleSet = true; await rebuild(); }))),
      row(t('分頁列的樣式'), t('「常用／插入／校閱／檢視」這一列的顯示方式。「只顯示圖示」最省空間；「收成選單」不佔一列，改成按鈕列最前面的一個按鈕，按下去選分頁。版面是「分頁」時才有作用。'),
        s => s.addDropdown(d => d.addOptions({ text: t('文字'), icon: t('只顯示圖示'), both: t('圖示加文字'), menu: t('收成選單（不佔一列）') })
          .setValue(S.tabStyle || 'text').onChange(async v => { S.tabStyle = v as TabStyle; await rebuild(); }))),
      common(row(t('工具列位置'), t('「自動」在手機上放在畫面下方（靠近鍵盤，單手好按），平板與電腦放在上方。'),
        s => s.addDropdown(d => d.addOptions({ auto: t('自動'), top: t('上方'), bottom: t('下方') })
          .setValue(S.toolbarPosition || 'auto').onChange(async v => { S.toolbarPosition = v as ToolbarPosition; await rebuild(); })))),
      toggleRow(t('顯示群組名稱'), t('在每組按鈕下方顯示「剪貼簿」「字型」「段落」等名稱（像 Word）。'), 'groupLabels', () => p.refreshToolbars()),
      toggleRow(t('檢視模式的按鈕顯示文字'), t('功能區「檢視」分頁的 Word 模式、Markdown、閱讀三個按鈕下方顯示名稱。關閉後這三個按鈕只顯示圖示（名稱仍在提示裡），Word 模式與 Markdown／閱讀模式的工具列都一樣。'), 'viewButtonLabels', () => p.refreshToolbars()),
      toggleRow(t('詳細提示（含動畫示意）'),
        t('滑鼠停在按鈕上時，顯示功能說明、快速鍵，以及一段動畫示範這個按鈕會做什麼。適合剛開始使用的人。'), 'richHints', () => p.refreshToolbars()),
      sub('分頁與群組'),
      // 分頁與群組：顯示／隱藏，以及每個群組的名稱、順序、所在分頁
      { kind: 'grid', common: true, name: t('自訂分頁與按鈕群組'), desc: t('取消勾選可以隱藏不常用的分頁或群組。每個群組可以改名稱（留白就用預設名稱）、用箭頭調整順序，或移到別的分頁。Word 模式與 Markdown／閱讀模式的工具列都會套用。'), cls: 'wm-settings-groups', fill: grid => fillGroupSettings(grid, S, () => { void rebuild(); }) },
      { kind: 'grid', name: t('分頁名稱'), desc: t('可以把分頁改成自己習慣的名稱；留白就用預設名稱。'), cls: 'wm-settings-groups wm-settings-tabnames', fill: box => {
        for (const [tab, tabLabel] of TABS) {
          const l = box.createEl('label', { cls: 'wm-settings-tabname' });
          l.createSpan({ text: t(tabLabel) });
          const input = l.createEl('input', { type: 'text' });
          input.placeholder = t(tabLabel);
          input.value = (S.tabLabels || {})[tab] || '';
          input.maxLength = 20;
          input.addEventListener('change', () => {
            const labels = Object.assign({}, S.tabLabels);
            const v = input.value.trim();
            if (v) labels[tab] = v; else delete labels[tab];
            S.tabLabels = labels;
            void rebuild();
          });
        }
      } },
      sub('手機與平板'),
      toggleRow(t('打字時精簡工具列'), t('手機、平板的螢幕鍵盤開著時，工具列只留一列：分頁收成最前面的選單按鈕，按鈕只顯示圖示，多留一點地方打字。鍵盤收起來就恢復。'), 'compactOnKeyboard'),
      // 拖曳移動游標（手機、平板）：改了下一次拖曳就生效，不用重建工具列（整列觸控板的開關例外）
      toggleRow(t('鍵盤上方整列當觸控板'),
        t('手機、平板的鍵盤開著時，在鍵盤上方那一列按住一下、等按鈕變淡，再拖曳就能移動游標。關閉時只有最前面的分頁選單按鈕可以拖。'), 'padRow', () => p.refreshToolbars()),
      row(t('觸控板：按住多久開始'), t('按住按鈕列多久（毫秒）才變成觸控板。太短容易在捲動或點按鈕時不小心觸發，太長要等比較久。預設 300。'),
        s => s.addSlider(sl => sl.setLimits(PAD_HOLD.min, PAD_HOLD.max, PAD_HOLD.step).setValue(padHold(S.padHold)).setDynamicTooltip()
          .onChange(async v => { S.padHold = padHold(v); await save(); }))),
      row(t('拖曳移動游標的速度'), t('1 最慢、5 最快：手指移動同樣的距離，游標走的格數不同。想要一個字一個字慢慢對準就調慢。預設 3。'),
        s => s.addSlider(sl => sl.setLimits(1, 5, 1).setValue(padSpeed(S.padSpeed)).setDynamicTooltip()
          .onChange(async v => { S.padSpeed = padSpeed(v); await save(); }))),
      toggleRow(t('控制鍵'), t('在「收起鍵盤」左邊放一顆開關（鍵盤開著時才出現），按下去在工具列上方展開一排螢幕鍵盤沒有的鍵：Esc、Tab、Ctrl（Apple 的裝置是 ⌘）、Shift、方向鍵、Home、End。Ctrl、Shift 點一下作用在下一個鍵，連點兩下鎖住；Ctrl 開著時用鍵盤打字母就是快速鍵（例如 Ctrl＋B 粗體）。方向鍵按住不放會連續移動。Word 模式與 Markdown 編輯都能用，包括 Obsidian 自己的工具列。'), 'keyRow', () => p.refreshToolbars()),
      { kind: 'grid', name: t('控制鍵列要顯示的鍵'), desc: t('取消勾選用不到的鍵，控制鍵列就短一點，不用左右捲。'), cls: 'wm-settings-groups wm-settings-keys', fill: box => {
        for (const k of KEY_IDS) {
          const l = box.createEl('label', { cls: 'wm-settings-group' });
          const cb = l.createEl('input', { type: 'checkbox' });
          cb.checked = keyRowKeys(S.keyRowKeys).includes(k);
          const look = KEY_LOOK[k];
          l.createSpan({ text: (look.text && look.text !== t(look.label) ? look.text + ' ' : '') + t(look.label) });
          cb.addEventListener('change', () => {
            const set = new Set(keyRowKeys(S.keyRowKeys));
            if (cb.checked) set.add(k); else set.delete(k);
            S.keyRowKeys = KEY_IDS.filter(x => set.has(x));
            void rebuild();
          });
        }
      } },
      sub('放大鏡'),
      toggleRow(t('拖曳時顯示放大鏡'), t('拖曳移動游標時，在游標上方顯示放大的那一段文字，看得清楚游標停在哪兩個字中間。'), 'loupeShow'),
      toggleRow(t('放大鏡旁顯示位置資訊'), t('在放大鏡旁邊顯示游標現在在哪裡：哪一種段落（內文、標題、清單、表格第幾列第幾欄…）以及在這一段的第幾個字。'), 'loupeInfo'),
      row(t('放大鏡的外觀'), t('「膠囊」是圓頭的長條（像 iOS 的放大鏡）；「卡片」是圓角方框，下方有一個指向游標的小尖角。'),
        s => s.addDropdown(d => d.addOptions({ capsule: t('膠囊'), card: t('卡片') })
          .setValue(loupeOptions(S.loupeZoom, S.loupeWidth, S.loupeStyle).style).onChange(async v => { S.loupeStyle = v === 'card' ? 'card' : 'capsule'; await save(); }))),
      row(t('放大鏡的倍率'), t('放大幾倍。預設 1.6。'),
        s => s.addSlider(sl => sl.setLimits(LOUPE_ZOOM.min, LOUPE_ZOOM.max, LOUPE_ZOOM.step).setValue(loupeOptions(S.loupeZoom, S.loupeWidth, S.loupeStyle).scale).setDynamicTooltip()
          .onChange(async v => { S.loupeZoom = loupeOptions(v, S.loupeWidth, S.loupeStyle).scale; await save(); }))),
      row(t('放大鏡的寬度'), t('放大鏡有多寬（px），越寬看得到游標前後越多字。預設 260。'),
        s => s.addSlider(sl => sl.setLimits(LOUPE_WIDTH.min, LOUPE_WIDTH.max, LOUPE_WIDTH.step).setValue(loupeOptions(S.loupeZoom, S.loupeWidth, S.loupeStyle).width).setDynamicTooltip()
          .onChange(async v => { S.loupeWidth = loupeOptions(S.loupeZoom, v, S.loupeStyle).width; await save(); }))),
      sub('Markdown／閱讀模式'),
      toggleRow(t('Markdown 模式打字時讓出 Obsidian 的工具列'),
        t('手機上在 Markdown 模式打字時，Obsidian 自己的工具列會出現在鍵盤上方。開啟時這個外掛的工具列先藏起來，不會疊成兩列；鍵盤收起來就回來。'), 'mdYieldNative', () => p.refreshToolbars()),
      toggleRow(t('閱讀模式的工具列只留能用的按鈕'),
        t('手機的閱讀模式不能編輯，大半的按鈕按不了。開啟時工具列縮成一列，只留切換模式、大綱、屬性與設定。'), 'readingLite', () => p.refreshToolbars()),
      row(t('Markdown／閱讀模式的工具列'),
        t('切換到 Obsidian 的 Markdown 編輯或閱讀模式時，要不要在畫面上方顯示工具列（粗體、標題、清單、連結、尋找、大綱等）。可以只在其中一種模式顯示；閱讀模式只能檢視，編輯按鈕會停用。隱藏時可以用狀態列的按鈕（下一項設定）切回 Word 模式。'),
        s => s.addDropdown(d => d.addOptions({ both: t('兩種模式都顯示'), source: t('只在 Markdown 編輯顯示'), preview: t('只在閱讀模式顯示'), none: t('都隱藏') })
          .setValue(mdToolbarMode(S.mdToolbar)).onChange(async v => { S.mdToolbar = mdToolbarMode(v); await rebuild(); }))),
      sub('狀態列與大綱'),
      toggleRow(t('切換到 Markdown／閱讀模式時保留狀態列'),
        t('Obsidian 右下角的狀態列維持跟 Word 模式一樣：字數、存檔狀態、Word 模式／Markdown／閱讀的切換按鈕、查看文件屬性與縮放（縮放只用在 Word 模式，這時會停用），切換模式時按鈕不會突然不見。這時 Obsidian 內建的字數會藏起來，字數的算法見下一項設定。手機沒有 Obsidian 的狀態列：放在工具列下方，跟 Word 模式同一個位置。'), 'mdStatusBar', () => p.updateStatus(null)),
      row(t('字數的算法'), t('狀態列與「字數統計」視窗的字數怎麼算。「只算看得到的文字」像 Word：中文、日文、韓文一字算一個，英文一個單字算一個，Markdown 符號、連結網址與文件屬性不算。「跟 Obsidian 內建的一樣」算 Markdown 原文，符號與連結網址也算，數字跟 Obsidian 內建的字數相同。'),
        s => s.addDropdown(d => d.addOptions({ word: t('只算看得到的文字'), obsidian: t('跟 Obsidian 內建的一樣') })
          .setValue(S.countMethod === 'obsidian' ? 'obsidian' : 'word').onChange(async v => { S.countMethod = v === 'obsidian' ? 'obsidian' : 'word'; await save(); p.refreshCounts(); }))),
      row(t('手機上的字數與文件屬性'), t('「放到右上角」：文件屬性是右上角的一顆按鈕，字數統計與閱讀模式在右上角的「⋯」選單裡，畫面下方不放狀態列，編輯區比較大。「畫面下方的狀態列」：跟 1.37 以前一樣，放在工具列下方。只影響手機。'),
        s => s.addDropdown(d => d.addOptions({ header: t('放到右上角與「⋯」選單（建議）'), bar: t('畫面下方的狀態列') })
          .setValue(S.phoneStatus === 'bar' ? 'bar' : 'header').onChange(async v => { S.phoneStatus = v === 'bar' ? 'bar' : 'header'; await save(); p.refreshToolbars(); p.updateStatus(null); }))),
      toggleRow(t('在狀態列顯示筆記的路徑'),
        t('電腦上，在右下角的狀態列顯示這份筆記在保管庫裡的位置（資料夾與檔名）。按一下或按右鍵可以複製：保管庫內的路徑、電腦上的完整路徑、Obsidian 網址、檔名、所在資料夾。文件裡的連結與圖片按右鍵也能複製它們指向的檔案路徑。'), 'showPath', () => p.rebuildStatus()),
      row(t('大綱的位置'), t('「另開一欄」在筆記左邊再展開一個大綱欄（像第二個側邊欄，不會蓋掉檔案總管）；也可以放進 Obsidian 的左或右側邊欄，或用小型下拉選單。'),
        s => s.addDropdown(d => d.addOptions({ split: t('在筆記旁另開一欄（建議）'), left: t('左側邊欄（與檔案總管同一區）'), right: t('右側邊欄'), popup: t('下拉選單') })
          .setValue(S.outlinePlace || 'split').onChange(async v => {
            S.outlinePlace = v as OutlinePlace; await save();
            if (p.outlineOpen()) { await p.toggleOutline(); if (v !== 'popup') await p.toggleOutline(); }
          }))),
    ] },

    // ------------------------------------------------ 右鍵選單
    { id: 'ctx', heading: '右鍵選單', icon: 'mouse-pointer-click', rows: [
      toggleRow(t('使用 Word 模式的右鍵選單'),
        t('在編輯區按右鍵時，顯示依游標位置變化的選單（連結、方程式、表格、程式碼…），以及下面勾選的功能。關閉時使用 Obsidian／系統原本的選單。手機上長按仍是選取文字。'), 'ctxMenu'),
      { kind: 'grid', name: t('右鍵選單要顯示的項目'), cls: 'wm-settings-groups wm-settings-ctx', fill: ctxGrid => {
        for (const [id, label, desc] of [
          ['table', '表格', '插入／刪除列欄、整欄對齊、排序'],
          ['clipboard', '剪貼簿', '剪下、複製、貼上、只貼上文字、全選'],
          ['format', '格式', '有選取文字時：粗體、斜體、底線、醒目提示、清除格式'],
          ['paragraph', '段落', '項目符號、編號、增加／減少縮排'],
          ['insert', '插入', '超連結、連結到筆記、方程式、註解'],
          ['tools', '工具', '複製為 Markdown、在筆記或保管庫中搜尋、字數統計、編輯標記'],
        ] as const) {
          const l = ctxGrid.createEl('label', { cls: 'wm-settings-ctx-item' });
          const cb = l.createEl('input', { type: 'checkbox' });
          cb.checked = !(S.hiddenCtx || []).includes(id);
          const tx = l.createDiv();
          tx.createDiv({ cls: 'wm-settings-tab', text: t(label) });
          tx.createDiv({ cls: 'setting-item-description', text: t(desc) });
          cb.addEventListener('change', () => {
            const set = new Set(S.hiddenCtx || []);
            if (cb.checked) set.delete(id); else set.add(id);
            S.hiddenCtx = [...set];
            void save();
          });
        }
      } },
    ] },

    // ------------------------------------------------ 方程式與圖表
    { id: 'math', heading: '方程式與圖表', icon: 'sigma', rows: [
      sub('方程式'),
      row(t('方程式編輯器預設的編輯方式'), t('「視覺化」把分數、根號、上下標顯示成一格一格，可以直接點進去輸入；「LaTeX」直接編輯原始碼。在編輯器裡隨時可以切換。'),
        s => s.addDropdown(d => d.addOptions({ visual: t('視覺化'), latex: 'LaTeX' })
          .setValue(S.mathMode === 'latex' ? 'latex' : 'visual').onChange(async v => { S.mathMode = v as EquationEditMode; await save(); }))),
      toggleRow(t('新方程式預設為獨立一行'),
        t('關閉時新插入的方程式放在文字中（$…$），開啟時獨立一行置中（$$…$$）。在方程式編輯器裡都可以切換。'), 'mathDisplay'),
      row(t('清除最近使用的方程式'), t('方程式編輯器會記住最近 12 個方程式，方便重複使用。'),
        s => s.addButton(b => b.setButtonText(t('清除')).onClick(async () => { S.recentMath = []; await save(); new Notice(t('已清除')); }))),
      { kind: 'grid', name: t('我的公式'), desc: t('自己存的公式，在方程式編輯器的「我的公式」分類裡按一下就插入。在編輯器裡按預覽旁邊的書籤按鈕，可以把目前的方程式存進來；這裡可以改名、修改、調整順序與刪除。'), cls: 'wm-settings-groups', fill: box => {
        box.addClass('wm-tpl-manager');
        buildTemplateManager(box, {
          get: () => S.mathTemplates || [],
          set: list => { S.mathTemplates = list; void save(); },
          addLabel: t('＋ 新增公式'), newName: t('公式'), newSrc: 'E = mc^{2}', srcLabel: 'LaTeX',
          empty: t('還沒有自己的公式。'),
          // 公式直接顯示成結果，比一串 LaTeX 好認
          preview: (src, el) => {
            renderMathInto(src, el, false);
          },
        });
      } },
      sub('圖表'),
      row(t('圖表編輯器預設的編輯方式'), t('「表單」用清單編輯圖表的內容（流程圖、循序圖、甘特圖、圓餅圖、狀態圖、類別圖、心智圖、時間軸、ER 圖），也可以直接點預覽圖上的文字修改；用了表單不支援的寫法時，會自動改用程式碼。'),
        s => s.addDropdown(d => d.addOptions({ visual: t('表單'), code: t('程式碼') })
          .setValue(S.mermaidMode === 'code' ? 'code' : 'visual').onChange(async v => { S.mermaidMode = v as MermaidTab; await save(); }))),
      row(t('新圖表一開始的內容'), t('按「插入圖表」時，編輯器裡先放哪一種圖表。可以選內建的種類，或自己存的範本。'),
        s => s.addDropdown(d => {
          d.addOption('', t('流程圖'));
          for (const k of DIAGRAM_KINDS) if (k.id !== 'flowchart') d.addOption('kind:' + k.id, t(k.name));
          for (const x of S.diagramTemplates || []) d.addOption('tpl:' + x.name, t('我的範本') + t('：') + x.name);
          // 選的範本已經被改名或刪除：顯示成預設的流程圖
          const cur = S.defaultDiagram || '';
          d.setValue(cur.startsWith('tpl:') && !(S.diagramTemplates || []).some(x => 'tpl:' + x.name === cur) ? '' : cur)
            .onChange(async v => { S.defaultDiagram = v; await save(); });
        })),
      { kind: 'grid', name: t('圖表編輯器要列出的圖表種類'), desc: t('取消勾選用不到的種類，編輯器上方就不會列出來。已經畫好的圖表不受影響，仍然可以編輯。'), cls: 'wm-settings-groups', fill: box => {
        for (const k of DIAGRAM_KINDS) {
          const l = box.createEl('label', { cls: 'wm-settings-group' });
          const cb = l.createEl('input', { type: 'checkbox' });
          cb.checked = !(S.hiddenDiagramKinds || []).includes(k.id);
          l.createSpan({ text: t(k.name) });
          cb.addEventListener('change', () => {
            const set = new Set(S.hiddenDiagramKinds || []);
            if (cb.checked) set.delete(k.id); else set.add(k.id);
            S.hiddenDiagramKinds = [...set];
            void save();
          });
        }
      } },
      { kind: 'grid', name: t('我的圖表範本'), desc: t('自己存的圖表，在圖表編輯器上方的「我的範本」裡按一下就套用。在編輯器裡可以把目前的圖表存進來；這裡可以改名、修改、調整順序與刪除。'), cls: 'wm-settings-groups', fill: box => {
        box.addClass('wm-tpl-manager');
        buildTemplateManager(box, {
          get: () => S.diagramTemplates || [],
          set: list => { S.diagramTemplates = list; void save(); },
          addLabel: t('＋ 新增圖表範本'), newName: t('圖表'), newSrc: t('flowchart TD\n    A[開始] --> B[結束]'), srcLabel: t('Mermaid 程式碼'),
          empty: t('還沒有自己的圖表範本。'),
          badge: src => { const k = detectKind(src); return k ? t(k.name) : ''; },
        });
      } },
    ] },

    // ------------------------------------------------ 同步與檔案
    { id: 'sync', heading: '同步與檔案', icon: 'refresh-cw', rows: [
      row(t('同步衝突的處理方式'), t('筆記在這裡有未存檔的修改時，又被 Synology Drive 或其他裝置改過。'),
        s => s.addDropdown(d => d.addOptions({ ask: t('每次詢問（建議）'), both: t('自動兩份都保留（另存我的版本）') })
          .setValue(S.conflict || 'ask').onChange(async v => { S.conflict = v as ConflictMode; await save(); }))),
      row(t('檔案大小上限（MB）'), t('超過這個大小的筆記一律用 Markdown 開啟，避免太大的檔案讓編輯變慢。'),
        s => s.addText(tx => { tx.inputEl.type = 'number'; tx.inputEl.setAttribute('inputmode', 'decimal'); tx.setValue(String(S.maxSizeMB || 2)).onChange(async v => { const n = parseFloat(v); if (n > 0) { S.maxSizeMB = n; await save(); } }); })),
      { kind: 'note', desc: t('在 frontmatter 加上「word-mode: false」可讓單一筆記不使用 Word 模式。') },
    ] },

    // ------------------------------------------------ 進階
    { id: 'advanced', heading: '進階', icon: 'wrench', rows: [
      common(row(t('快速鍵說明'), t('查看 Word 模式所有的快速鍵。'),
        s => s.addButton(b => b.setButtonText(t('開啟')).onClick(() => { new ShortcutModal(p.app, p, () => refreshSettingTab(settingTab)).open(); })))),
      row(t('還原預設設定'), t('把以上所有設定改回預設值（不會修改任何筆記）。'),
        s => s.addButton(b => b.setButtonText(t('還原')).setWarning().onClick(async () => {
          const lang = S.language;
          p.settings = Object.assign({}, DEFAULTS, { language: lang });
          await save();
          p.refreshToolbars();
          await p.refreshViews();
          refreshSettingTab(settingTab);
        }))),
      { kind: 'note', desc: 'Word 模式 v' + p.manifest.version + ' · ' + getLanguage(), cls: 'wm-settings-version', nosearch: true },
    ] },
  ];
}

// 把設定頁的一列換成 Obsidian 1.13 的設定定義。Obsidian 會先建立這一列的 Setting、設好名稱與說明，再呼叫 render。
// placed 在畫好時收到這一列的元素（設定頁的搜尋框要捲到那裡）。小節標題不是一列（是群組的標題），不會傳進來
function settingDefinition(row: Exclude<SettingRow, { kind: 'heading' }>, placed: (el: HTMLElement) => void): SettingDefinitionRender {
  switch (row.kind) {
    case 'setting':
      // 大括號不能省：build 可能回傳 Setting，而 render 的回傳值會被當成清除用的函式
      return { name: row.name, desc: row.desc, render: setting => { placed(setting.settingEl); row.build(setting); } };
    case 'grid':
      // 勾選框放在名稱與說明下方；這一列重畫或設定頁關閉前，先拿掉這次放的勾選框，重畫時才不會多出一份
      return {
        name: row.name, desc: row.desc,
        render: setting => {
          placed(setting.settingEl);
          const grid = setting.infoEl.createDiv('wm-settings-groups-grid');
          row.fill(grid);
          return () => grid.remove();
        },
      };
    case 'note':
      // 只是說明文字：沒有名稱與控制項，也不列入設定搜尋（搜尋結果以名稱當標題，空白的標題沒有意義）
      return { name: '', desc: row.desc, searchable: false, render: setting => { placed(setting.settingEl); } };
  }
}

// 設定頁的搜尋框裡的一筆：row 是它在設定頁上的那一列，section 是所屬的分類
interface SearchItem extends SettingSearchItem { row: SettingRow; sectionId: SectionId; }

// 每一列在每種介面語言的名稱與說明，依 settingSections() 的順序：texts[語言][分類][列]。
// 設定頁的內容在每種語言都一樣，只是文字不同，所以暫時切換語言、各取一次（同步執行，畫面不會變），最後一定切回原本的語言
function settingTextsByLanguage(settingTab: WordModeSettings): Map<string, { name: string; desc: string }[][]> {
  const out = new Map<string, { name: string; desc: string }[][]>();
  const cur = getLanguage();
  try {
    // 英文排第一：幾種語言同樣符合時，搜尋結果顯示英文（打英文找設定的人最多）
    for (const lang of ['en', ...LANGUAGES.filter(l => l !== 'en')]) {
      setLanguage(lang);
      out.set(lang, settingSections(settingTab).map(sec => sec.rows.map(r => r.kind === 'note' ? { name: r.desc, desc: '' } : r.kind === 'heading' ? { name: r.name, desc: '' } : { name: r.name, desc: r.desc || '' })));
    }
  } finally {
    setLanguage(cur);
  }
  return out;
}

// 設定改變後重畫整個設定頁。Obsidian 1.13 起 settingItems（getSettingDefinitions() 的結果）有內容時，
// 設定頁由 Obsidian 依定義畫、不呼叫 display()，要用 update() 重新取得定義並重畫；舊版 Obsidian 沒有 update()，直接呼叫 display()
function refreshSettingTab(settingTab: WordModeSettings): void {
  if (settingTab.update && settingTab.settingItems && settingTab.settingItems.length > 0) settingTab.update();
  else settingTab.display();
}

export class WordModeSettings extends PluginSettingTab {
  declare plugin: WordModePlugin;
  // Obsidian 1.13 起 SettingTab 才有的成員（1.5.7 的型別定義裡沒有，較舊的版本執行時也沒有）：
  // settingItems 是 Obsidian 存下的 getSettingDefinitions() 結果；update() 重新取得定義、更新設定搜尋並重畫開著的設定頁
  declare settingItems?: unknown[];
  declare update?: () => void;
  // 目前顯示的分類。記在這裡，關掉設定再打開、或設定頁重畫之後，仍停在同一類
  section: SectionId = 'general';
  // 畫在設定頁上的分類列（每次畫設定頁時換成新的）
  nav: SettingNav<SectionId> | null = null;
  // 1.13 的設定定義各屬於哪一類：點設定搜尋的結果時，用來先切到那一類
  sectionOf = new WeakMap<object, SectionId>();
  // 重畫設定頁之後呼叫：下次捲動時重新量外框的上內距（見 trackSettingPadding）
  remeasure: () => void;
  // 最近一次畫設定頁（或取得定義）用的內容，以及每一列畫在哪個元素：設定頁的搜尋框用
  sections: SettingSection[] = [];
  rowEls = new Map<SettingRow, HTMLElement>();
  // 每一列在每種語言的文字（見 settingTextsByLanguage）。介面文字不會在執行時改變，第一次搜尋時算一次就好
  texts: Map<string, { name: string; desc: string }[][]> | null = null;

  constructor(app: App, plugin: WordModePlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.remeasure = trackSettingPadding(this.containerEl);
    // 點設定搜尋的結果時，Obsidian 用這個（非公開的）方法找出那一列再捲過去；那一列在別的分類時是隱藏的，要先切過去。
    // 這個方法不存在或改了名稱時，只是搜尋結果不會自動切換分類
    if (typeof this.getElementForDefinition === 'function') {
      const find = this.getElementForDefinition.bind(this);
      this.getElementForDefinition = def => {
        const id = this.sectionOf.get(def);
        if (id) this.showSection(id);
        return find(def);
      };
    }
  }

  // 換到 id 這一類
  showSection(id: SectionId): void {
    this.section = id;
    showSettingSection(this.containerEl, id);
    if (this.nav) this.nav.select(id);
  }

  // 在 host 裡畫搜尋框與分類列；回傳畫出來的元素（重畫前要拿掉）
  buildNav(host: HTMLElement, sections: SettingSection[]): HTMLElement[] {
    const search = buildSettingSearch(host, () => this.searchItems(), (item, byKeyboard) => this.reveal(item, byKeyboard), { keymap: this.app.keymap, scope: this.app.scope });
    const nav = buildSettingNav(host, sections.map(x => ({ id: x.id, label: t(x.heading), icon: x.icon })), this.section, id => {
      this.showSection(id);
      // 每一類的長度不同，換過去之後從頭看起
      this.containerEl.scrollTop = 0;
    });
    this.nav = nav;
    this.remeasure();
    return [search.el, nav.el];
  }

  // 設定頁的搜尋框要找的設定：目前畫在設定頁上的每一列（說明文字也算，例如 frontmatter 的用法），
  // 加上這一列的選項文字，以及其他語言的名稱與說明（介面是中文、打英文也找得到）
  searchItems(): SearchItem[] {
    if (!this.texts) this.texts = settingTextsByLanguage(this);
    const texts = this.texts;
    const cur = getLanguage();
    const out: SearchItem[] = [];
    this.sections.forEach((section, si) => section.rows.forEach((row, ri) => {
      if ((row.kind === 'note' && row.nosearch) || row.kind === 'heading') return;
      const el = this.rowEls.get(row);
      const alt: { name: string; desc: string }[] = [];
      for (const [lang, secs] of texts) {
        const x = lang === cur ? null : secs[si] && secs[si][ri];
        if (x) alt.push(x);
      }
      out.push({
        row, sectionId: section.id, section: t(section.heading), icon: section.icon, common: row.common,
        name: row.kind === 'note' ? row.desc : row.name,
        desc: row.kind === 'note' ? '' : row.desc || '',
        terms: el ? settingTerms(el) : [],
        alt,
      });
    }));
    return out;
  }

  // 搜尋框選了一筆：換到那一類、捲到那一列並閃一下。
  // 用鍵盤選的把焦點移到那一列的控制項；手機上不移（會跳出螢幕鍵盤蓋住畫面）
  reveal(item: SearchItem, byKeyboard: boolean): void {
    const el = this.rowEls.get(item.row);
    if (!el || !el.isConnected) return;
    this.showSection(item.sectionId);
    revealSetting(el, byKeyboard && !Platform.isMobile);
  }

  // Obsidian 1.13 以前畫設定頁的方式（1.13 起 getSettingDefinitions() 有內容時，Obsidian 不呼叫這裡）
  display(): void {
    const c = this.containerEl;
    const sections = settingSections(this);
    this.sections = sections;
    this.rowEls.clear();
    c.empty();
    c.addClass('wm-settings');
    showSettingSection(c, this.section);
    this.buildNav(c.createDiv('wm-set-nav'), sections);
    for (const section of sections) {
      const box = c.createDiv('wm-set-sec wm-set-' + section.id);
      for (const row of section.rows) {
        if (row.kind === 'heading') {
          const h = new Setting(box).setName(row.name).setHeading();
          h.settingEl.addClass('wm-set-sub');
          this.rowEls.set(row, h.settingEl);
        } else if (row.kind === 'setting') {
          const setting = new Setting(box).setName(row.name).setDesc(row.desc);
          this.rowEls.set(row, setting.settingEl);
          row.build(setting);
        } else if (row.kind === 'grid') {
          const g = box.createDiv(row.cls);
          this.rowEls.set(row, g);
          g.createDiv({ cls: 'setting-item-name', text: row.name });
          if (row.desc) g.createDiv({ cls: 'setting-item-description', text: row.desc });
          row.fill(g.createDiv('wm-settings-groups-grid'));
        } else this.rowEls.set(row, box.createEl('p', { cls: 'setting-item-description' + (row.cls ? ' ' + row.cls : ''), text: row.desc }));
      }
    }
  }

  // Obsidian 1.13 起：回傳設定定義，Obsidian 依這份定義畫設定頁（不再呼叫 display()），也用來做設定搜尋。
  // Obsidian 在加入設定頁時與每次 update() 時呼叫；舊版 Obsidian 不會呼叫
  getSettingDefinitions(): SettingDefinitionGroup[] {
    const sections = settingSections(this);
    this.sections = sections;
    this.rowEls.clear();
    this.containerEl.addClass('wm-settings');
    showSettingSection(this.containerEl, this.section);
    // 搜尋框與分類列自己是一個群組（群組是設定頁外框的直接子元素，才能固定在捲動範圍的上緣），裡面只有一列，不列入設定搜尋
    const nav: SettingDefinitionGroup = {
      type: 'group', cls: 'wm-set-nav',
      items: [{
        name: '', searchable: false,
        render: setting => {
          setting.settingEl.addClass('wm-set-navrow');
          const els = this.buildNav(setting.settingEl, sections);
          // 這一列重畫前先拿掉舊的搜尋框與分類列，才不會多出一份
          return () => { for (const el of els) el.remove(); };
        },
      }],
    };
    // 每一類的每個小節是一個群組（都帶著這一類的 class，換分類時一起隱藏）；小節標題是群組的標題。
    // 分類的名稱已經在分類列上，第一個小節標題前面的列（沒有小節的分類就是全部）是沒有標題的群組
    const groups: SettingDefinitionGroup[] = [nav];
    for (const section of sections) {
      let group: SettingDefinitionGroup | null = null;
      for (const row of section.rows) {
        if (row.kind === 'heading' || !group) {
          // 每一類的第一個群組（wm-set-first）緊接在分類列下面，間距比群組之間小（見樣式表）
          group = { type: 'group', cls: 'wm-set-sec wm-set-' + section.id + (group ? '' : ' wm-set-first'), items: [] };
          if (row.kind === 'heading') group.heading = row.name;
          groups.push(group);
          if (row.kind === 'heading') continue;
        }
        const item = settingDefinition(row, el => this.rowEls.set(row, el));
        this.sectionOf.set(item, section.id);
        group.items.push(item);
      }
    }
    return groups;
  }
}
