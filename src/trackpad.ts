// 工具列當觸控板（Editorial 的做法；手機、平板）：在按鈕上拖曳移動游標。Word 模式的功能區（toolbar.ts）、
// Markdown 模式的工具列（mdbar.ts）與 Obsidian 自己的手機工具列（nativebar.ts）共用這一份手勢，怎麼移動游標由各自的 hooks 決定。
//
// hold 是 0：按下去就可以拖（分頁選單按鈕）；沒拖超過 START 就放開還是一般的點擊。
// hold 大於 0：「整列按鈕」的版本。按鈕要留給點擊、按鈕列要留給左右捲動，所以先按住 hold 毫秒不動才變成觸控板
// （按鈕列上方出現說明、按鈕變淡），之後的拖曳才移動游標；按住了但沒拖就放開，照常算是按了那顆按鈕。
// 在按鈕列上拖曳不會碰到文字，iOS 不會接手（文字上的長按 iOS 一定在 0.5 秒左右接手，網頁擋不掉）
import { el } from './dom.js';
import { t } from './i18n.js';

// 整列按鈕當觸控板：按住多久不動才開始（設定，毫秒）。預設比 iOS 的長按（約 0.5 秒）短、比一般的點擊長
export const PAD_HOLD = { min: 150, max: 800, step: 50, default: 300 } as const;
// 移動速度（設定 1～5）：手指移動多少 px 走一格；換一行要多拖一點，免得左右拖的時候不小心換行
const PAD_STEP_X = [18, 15, 12, 9, 7] as const;
// 速度的設定值整理成 1～5（不是數字就用 3）
export function padSpeed(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3;
}
export function padSteps(speed: unknown): { x: number; y: number } {
  const x = PAD_STEP_X[padSpeed(speed) - 1];
  return { x, y: Math.round(x * 2.2) };
}
// 觸控板的加速度（像筆電的觸控板）：手指移動的速度（px/ms）換成倍數。慢慢移動時倍數小，一格一格對準；
// 快速滑過去倍數大，一下子走很遠。速度設定（padSteps）決定基本的距離，倍數乘在手指移動的距離上
export const PAD_GAIN = { slow: 0.12, fast: 1.2, min: 0.5, max: 2.2 } as const;
export function padGain(speed: number): number {
  const v = isFinite(speed) && speed > 0 ? speed : 0;
  const k = Math.max(0, Math.min(1, (v - PAD_GAIN.slow) / (PAD_GAIN.fast - PAD_GAIN.slow)));
  return PAD_GAIN.min + (PAD_GAIN.max - PAD_GAIN.min) * k;
}
export function padHold(v: unknown): number {
  const n = typeof v === 'number' && isFinite(v) ? v : PAD_HOLD.default;
  return Math.round(Math.max(PAD_HOLD.min, Math.min(PAD_HOLD.max, n)) / PAD_HOLD.step) * PAD_HOLD.step;
}

export interface TrackpadHooks {
  // 編輯區有焦點（鍵盤開著）才能開始：移動游標會把焦點放回去、叫出鍵盤，畫面一重排手指的相對位置就跳掉
  focused(): boolean;
  // 移動速度的設定值（開始拖的時候才讀，設定改了馬上生效）
  speed(): unknown;
  // 開始拖（放大鏡、收起彈出選單）
  begin(): void;
  // 走 nx 格、ny 行（負數是往前、往上）
  step(nx: number, ny: number): void;
  // 放開
  end(): void;
  // 拖過了（moved 為 true）：放開後那一下點擊不要開選單。每次按下時先設回 false
  moved?(moved: boolean): void;
  // 整列的版本不管從這些元素開始的觸控（例如分頁選單按鈕：它自己就是觸控板）
  skip?: string;
}

const START = 8;

export function installTrackpad(b: HTMLElement, holdMs: number | (() => number), hooks: TrackpadHooks): void {
  const hold = holdMs !== 0;
  let STEP_X = 12; let STEP_Y = 26;
  // 這次觸控的編號；沒有在追蹤時是 null（iOS 的編號可能是負數，不能拿 -1 當「沒有」）
  let id: number | null = null; let x = 0; let y = 0; let active = false;
  // 加速度：上一次的時間、乘上倍數之後還沒用掉的距離（不滿一格的留到下一次）
  let lastT = 0; let ax = 0; let ay = 0;
  // 整列的版本：按住的計時器、已經可以拖了（還沒拖）、說明
  let timer = 0; let ready = false; let tip: HTMLElement | null = null;
  const win = b.ownerDocument.defaultView || window;
  const unready = () => {
    win.clearTimeout(timer); ready = false;
    b.classList.remove('is-trackpad');
    if (tip) { tip.remove(); tip = null; }
  };
  // 用觸控事件而不是指標事件：拖曳中每一下 touchmove 都擋掉預設行為，iOS 才不會中途把這次觸控收走去做別的
  // （捲動、系統手勢），指標事件被收走時只會收到 pointercancel、放大鏡跟著不見。
  // Obsidian 自己的滑動手勢由功能區的 data-ignore-swipe 擋掉（見 ribbon.ts）
  const find = (e: TouchEvent) => { for (const tt of Array.from(e.changedTouches)) if (tt.identifier === id) return tt; return null; };
  b.addEventListener('touchstart', e => {
    unready();
    const target = e.target as Element | null;
    if (e.touches.length !== 1 || (hold && hooks.skip && target && target.nodeType === 1 && target.closest(hooks.skip))) { id = null; return; }
    const tt = e.touches[0];
    id = tt.identifier; x = tt.clientX; y = tt.clientY; active = false;
    if (hooks.moved) hooks.moved(false);
    lastT = e.timeStamp; ax = 0; ay = 0;
    if (!hold) return;
    const wait = typeof holdMs === 'function' ? holdMs() : holdMs;
    timer = win.setTimeout(() => {
      if (id === null || !hooks.focused()) return;
      ready = true;
      b.classList.add('is-trackpad');
      // 說明蓋在按鈕列上（固定在畫面上的位置，按鈕列捲動也不跟著動）
      const r = b.getBoundingClientRect();
      tip = el('div', 'wm-pad-tip', b.ownerDocument.body, t('左右拖移動游標，上下拖換行'));
      tip.style.left = Math.round(r.left) + 'px';
      tip.style.top = Math.round(r.top) + 'px';
      tip.style.width = Math.round(r.width) + 'px';
      tip.style.height = Math.round(r.height) + 'px';
    }, wait);
  }, { passive: true });
  b.addEventListener('touchmove', e => {
    const tt = find(e);
    if (!tt) return;
    let dx = tt.clientX - x; let dy = tt.clientY - y;
    if (!active) {
      // 整列的版本可以拖了：手指的小晃動也擋掉，按鈕列才不會開始左右捲
      if (hold && ready && e.cancelable) e.preventDefault();
      if (Math.abs(dx) < START && Math.abs(dy) < START) return;
      // 整列的版本：還沒按夠久就動了，是在捲按鈕列、往上滑按鍵或往下滑收鍵盤，不接手
      if (hold && !ready) { win.clearTimeout(timer); id = null; return; }
      // 從這裡開始算距離，不然一開始就跳好幾格
      if (hold) { unready(); b.classList.add('is-trackpad'); x = tt.clientX; y = tt.clientY; dx = 0; dy = 0; lastT = e.timeStamp; }
      if (!hooks.focused()) { id = null; return; }
      active = true;
      if (hooks.moved) hooks.moved(true);
      b.classList.add('is-caret-pad');
      ({ x: STEP_X, y: STEP_Y } = padSteps(hooks.speed()));
      hooks.begin();
    }
    if (e.cancelable) e.preventDefault();
    // 這一段的速度決定倍數；乘上倍數的距離累積起來，滿一格走一格
    const gain = padGain(Math.hypot(dx, dy) / Math.max(1, e.timeStamp - lastT));
    ax += dx * gain; ay += dy * gain;
    x = tt.clientX; y = tt.clientY; lastT = e.timeStamp;
    const nx = Math.trunc(ax / STEP_X); const ny = Math.trunc(ay / STEP_Y);
    ax -= nx * STEP_X; ay -= ny * STEP_Y;
    if (nx || ny) hooks.step(nx, ny);
  }, { passive: false });
  const end = (e: TouchEvent) => {
    if (!find(e)) return;
    // 拖曳過：擋掉放開之後的那一下點擊，不然會打開分頁選單
    if (active && e.cancelable) e.preventDefault();
    // 整列的版本：按住了但沒拖，照常是按了那顆按鈕
    unready();
    b.classList.remove('is-trackpad');
    const was = active;
    id = null; active = false;
    b.classList.remove('is-caret-pad');
    if (was) hooks.end();
  };
  b.addEventListener('touchend', end);
  b.addEventListener('touchcancel', end);
}
