// 用 DevTools Protocol 操作無頭 Chrome：真的滑鼠點擊、真的打字，每一步截一張圖，最後用 ffmpeg 合成 WebP 動畫
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const WEBP_QUALITY = 75; // 為什麼是 75 見 webp()

export async function launch({ width, height, port, profile }) {
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--allow-file-access-from-files', '--hide-scrollbars', '--force-device-scale-factor=1', '--font-render-hinting=none', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { /* 還沒啟動 */ }
    if (!target) await sleep(100);
  }
  if (!target) { proc.kill(); throw new Error(`Chrome 沒有啟動（${CHROME}）。可以用環境變數 CHROME 指定路徑。`); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); if (m.error) rej(new Error(m.error.message)); else res(m.result); }
    // 頁面上的錯誤印出來，錄出奇怪的畫面時才查得到原因
    else if (m.method === 'Runtime.exceptionThrown') console.error('  頁面錯誤：', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('  console.error：', m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  // 沒有這一行，無頭模式的頁面沒有焦點：focus 事件不會發生，打字也打不進去
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return { send, close: () => { try { ws.close(); } catch { /* 已關閉 */ } proc.kill(); } };
}

export class Recorder {
  constructor(cdp, { width, height }) { this.cdp = cdp; this.w = width; this.h = height; this.frames = []; this.mouse = { x: width / 2, y: height / 2 }; }

  async eval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('頁面執行失敗：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  ' + expr.slice(0, 200));
    return r.result.value;
  }
  async goto(file) {
    await this.cdp.send('Page.navigate', { url: pathToFileURL(file).href });
    for (let i = 0; i < 200; i++) {
      if (await this.eval('!!(window.stage && window.WM && window.lucide && window.mermaid)').catch(() => false)) return;
      await sleep(100);
    }
    throw new Error('頁面沒有載入完成（需要網路連線，從 jsDelivr 載入 Lucide、Mermaid、MathJax）');
  }
  async wait(ms) { await sleep(ms); }
  async settle() { await this.eval('stage.settled()'); }

  // 截一張圖，在動畫裡顯示 ms 毫秒（動畫的時間由這裡決定，跟實際花的時間無關）
  async snap(ms = 100) {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: this.w, height: this.h, scale: 1 } });
    this.frames.push({ data, ms });
  }
  // 停留一段時間；先等點擊的圓圈消失，免得停在畫面上
  async hold(ms) {
    await this.eval('new Promise(r => { const f = () => document.querySelector(".click-ring") ? setTimeout(f, 30) : r(true); f(); })');
    await this.snap(ms);
  }
  async keys(list, ms) { await this.eval(`stage.keys(${JSON.stringify(list)})`); if (ms) await this.snap(ms); }
  async find(sel, text, index) {
    const p = await this.eval(`stage.find(${JSON.stringify(sel)}, ${JSON.stringify(text || '')}, ${index || 0})`);
    if (!p) throw new Error('找不到 ' + sel + (text ? `「${text}」` : '') + (index ? ` 第 ${index} 個` : ''));
    return p;
  }

  // 畫出來的游標移到 (x, y)，移動過程截幾張圖；最後把真的滑鼠移過去（觸發 hover）
  async move(x, y, ms = 450) {
    await this.eval(`stage.cursor(${this.mouse.x}, ${this.mouse.y}, 0)`);
    await sleep(20);
    await this.eval(`stage.cursor(${x}, ${y}, ${ms})`);
    const steps = Math.max(2, Math.round(ms / 70));
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const due = t0 + (ms * i) / steps;
      while (Date.now() < due) await sleep(5);
      await this.snap(Math.round(ms / steps));
    }
    this.mouse = { x, y };
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  }
  async moveTo(sel, text, opt = {}) {
    const p = await this.find(sel, text, opt.index);
    await this.move(p.x + (opt.dx || 0), p.y + (opt.dy || 0), opt.ms);
    return p;
  }
  // 在目前的位置按一下（button: 'right' 是右鍵，count: 2 是連按兩下）
  async click(opt = {}) {
    const { x, y } = this.mouse;
    const button = opt.button || 'left';
    await this.eval(`stage.ring(${x}, ${y})`);
    for (let c = 1; c <= (opt.count || 1); c++) {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: c, buttons: button === 'right' ? 2 : 1 });
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: c });
    }
    await sleep(opt.after ?? 60);
    await this.snap(opt.ms ?? 120);
  }
  async clickOn(sel, text, opt = {}) { await this.moveTo(sel, text, opt); await this.click(opt); }
  // 按住滑鼠拖到 (x, y)，例如選取文字
  async drag(x, y, ms = 500) {
    const from = { ...this.mouse };
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1, buttons: 1 });
    const steps = Math.max(3, Math.round(ms / 70));
    for (let i = 1; i <= steps; i++) {
      const px = Math.round(from.x + ((x - from.x) * i) / steps), py = Math.round(from.y + ((y - from.y) * i) / steps);
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'left', buttons: 1 });
      await this.eval(`stage.cursor(${px}, ${py}, 0)`);
      await this.snap(Math.round(ms / steps));
    }
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    this.mouse = { x, y };
  }
  // 真的打字，一個字一張圖；\n 是 Enter
  async type(text, perChar = 75) {
    for (const ch of text) {
      if (ch === '\n') { await this.key('Enter'); continue; }
      await this.cdp.send('Input.insertText', { text: ch });
      await sleep(15);
      await this.snap(ch === ' ' ? perChar * 1.3 : perChar);
    }
  }
  // 按一個鍵。opt.show 是畫面下方要顯示的按鍵提示（例如 ['Tab']），顯示 opt.showMs 毫秒
  async key(key, mods = [], opt = {}) {
    const K = { Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'], Escape: [27, 'Escape'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'] };
    const [code, codeName, text] = K[key] || [key.toUpperCase().charCodeAt(0), 'Key' + key.toUpperCase(), key];
    const modifiers = (mods.includes('Alt') ? 1 : 0) | (mods.includes('Ctrl') ? 2 : 0) | (mods.includes('Meta') ? 4 : 0) | (mods.includes('Shift') ? 8 : 0);
    if (opt.show) await this.eval(`stage.keys(${JSON.stringify(opt.show)})`);
    const ev = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, code: codeName, key, modifiers };
    const plain = !(modifiers & ~8);
    await this.cdp.send('Input.dispatchKeyEvent', { type: plain ? 'keyDown' : 'rawKeyDown', ...ev, ...(text && plain ? { text } : {}) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev });
    await sleep(40);
    await this.snap(opt.ms ?? 140);
    if (opt.show) { await this.snap(opt.showMs ?? 500); await this.eval('stage.keys(null)'); }
  }

  // 寫出截圖再合成 WebP 動畫：相鄰的相同畫面合併成一張，停住不動的時間不佔空間。
  // 用 WebP 而不是 GIF：同樣的畫面小四成多，GitHub 與 Obsidian（Chromium）都能播放。
  // 品質 75（WEBP_QUALITY）是實測的結果：60 只再小一成，但常變動的地方會留下前幾張的殘影；
  // 85 以上沒有殘影，但大三成；無損大兩成多
  async webp(out, workDir) {
    const dir = path.join(workDir, path.basename(out, path.extname(out)) + '.frames');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const merged = [];
    for (const f of this.frames) { const last = merged[merged.length - 1]; if (last && last.data === f.data) last.ms += f.ms; else merged.push({ ...f }); }
    let list = '';
    merged.forEach((f, i) => {
      const n = `f${String(i).padStart(4, '0')}.png`;
      fs.writeFileSync(path.join(dir, n), Buffer.from(f.data, 'base64'));
      list += `file '${n}'\nduration ${(Math.max(20, f.ms) / 1000).toFixed(3)}\n`;
    });
    // concat 格式要把最後一張再列一次，最後一張的停留時間才會算進去
    list += `file 'f${String(merged.length - 1).padStart(4, '0')}.png'\n`;
    fs.writeFileSync(path.join(dir, 'list.txt'), list);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
      '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', String(WEBP_QUALITY), '-compression_level', '6',
      '-fps_mode', 'vfr', '-loop', '0', out]);
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`  ${path.basename(out)}：${merged.length} 張，${(merged.reduce((s, f) => s + f.ms, 0) / 1000).toFixed(1)} 秒，${kb} KB`);
    this.frames = [];
  }
  async png(out) {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: this.w, height: this.h, scale: 1 } });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
  }
}
