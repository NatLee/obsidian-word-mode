// 產生 README 用的示意圖（SVG）：修改一個段落後，存檔只重新輸出那個區塊。
// 用法（在專案根目錄執行）：node docs/images/generate.mjs
// 會覆蓋 docs/images/ 底下四種語言的 saving.*.svg。功能的操作畫面是錄製的動畫，見 docs/record/record.mjs。
import fs from 'fs';

// ---------------------------------------------------------------- 各語言的示範內容
const CONTENT = {
  en: {
    title: 'Weekly meeting',
    tasks: ['Update the docs', 'Prepare the demo'],
    th: ['Item', 'Owner'], rows: [['Testing', 'Alex'], ['Release', 'Sam']],
    col1: 'Markdown file', col2: 'You change one paragraph', col3: 'Saved file',
    unchanged: 'unchanged', rewritten: 'rewritten',
    before: "This week's **focus**: finish v1.", after: "This week's **focus**: finish v1 by Friday.",
    edited: ["This week's ", { b: 'focus' }, ': finish v1', { ins: ' by Friday' }, '.'],
    note: 'Only the block you changed is written again. Everything else is kept character for character.',
    illus: 'Illustration',
  },
  'zh-TW': {
    title: '週會紀錄',
    tasks: ['更新文件', '準備示範'],
    th: ['項目', '負責人'], rows: [['測試', '小明'], ['發佈', '小華']],
    col1: 'Markdown 檔案', col2: '在 Word 模式改了一個段落', col3: '存檔後的檔案',
    unchanged: '原樣保留', rewritten: '重新輸出',
    before: '本週**重點**：完成第一版。', after: '本週**重點**：週五前完成第一版。',
    edited: ['本週', { b: '重點' }, '：', { ins: '週五前' }, '完成第一版。'],
    note: '只有修改過的區塊會重新輸出，其餘部分一字不差保留原文。',
    illus: '示意圖',
  },
  ja: {
    title: '週次ミーティング',
    tasks: ['ドキュメントを更新', 'デモを準備'],
    th: ['項目', '担当者'], rows: [['テスト', '田中'], ['リリース', '佐藤']],
    col1: 'Markdown ファイル', col2: 'Word モードで段落を 1 つ変更', col3: '保存後のファイル',
    unchanged: '変更なし', rewritten: '書き直し',
    before: '今週の**重点**：v1 を完成。', after: '今週の**重点**：金曜までに v1 を完成。',
    edited: ['今週の', { b: '重点' }, '：', { ins: '金曜までに ' }, 'v1 を完成。'],
    note: '変更したブロックだけが書き直され、それ以外は一文字も変わりません。',
    illus: 'イメージ図',
  },
  ko: {
    title: '주간 회의',
    tasks: ['문서 업데이트', '데모 준비'],
    th: ['항목', '담당자'], rows: [['테스트', '민수'], ['배포', '지영']],
    col1: 'Markdown 파일', col2: 'Word 모드에서 문단 하나를 수정', col3: '저장된 파일',
    unchanged: '그대로 유지', rewritten: '다시 기록',
    before: '이번 주 **핵심**: v1 완성.', after: '이번 주 **핵심**: 금요일까지 v1 완성.',
    edited: ['이번 주 ', { b: '핵심' }, ': ', { ins: '금요일까지 ' }, 'v1 완성.'],
    note: '변경한 블록만 다시 기록되고 나머지는 한 글자도 바뀌지 않습니다.',
    illus: '예시 그림',
  },
};

// ---------------------------------------------------------------- 繪圖工具
const C = { bg: '#f6f8fa', card: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#656d76', faint: '#8c959f', accent: '#6f52d9', accentBg: '#efeafd', bar: '#f3f4f6', hl: '#fff3b0', green: '#1a7f37', greenBg: '#e6f4ea', orange: '#b35900', orangeBg: '#fff1e0', orangeBd: '#f0a54a', code: '#f0f2f4' };
const CJK_FONTS = { en: '', 'zh-TW': "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', ", ja: "'Yu Gothic UI', 'Hiragino Sans', 'Noto Sans JP', ", ko: "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', " };
let SANS = '';
let MONO = '';
function setFonts(lang) {
  SANS = `${CJK_FONTS[lang]}'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`;
  MONO = `ui-monospace, 'Cascadia Mono', Consolas, ${CJK_FONTS[lang]}monospace`;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wide = ch => /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿︰-﹏＀-￯]/.test(ch);
const width = (s, fs, mono) => [...String(s)].reduce((w, ch) => w + (wide(ch) ? fs : fs * (mono ? 0.6 : 0.56)), 0);
// 文字太長時壓縮到 maxW 以內
function text(x, y, s, o = {}) {
  const fs = o.size || 13;
  const w = width(s, fs, o.mono);
  const fit = o.maxW && w > o.maxW ? ` textLength="${o.maxW}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${fs}" fill="${o.fill || C.text}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.deco ? ` text-decoration="${o.deco}"` : ''}${fit}>${esc(s)}</text>`;
}
const rect = (x, y, w, h, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 6}" fill="${o.fill || 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const line = (x1, y1, x2, y2, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke || C.border}" stroke-width="${o.sw || 1}"${o.cap ? ' stroke-linecap="round"' : ''}/>`;
// 一行裡混合粗體、連結、新增文字
function rich(x, y, parts, o = {}) {
  const fs = o.size || 14;
  const spans = parts.map(p => {
    if (typeof p === 'string') return `<tspan>${esc(p)}</tspan>`;
    if (p.b) return `<tspan font-weight="700">${esc(p.b)}</tspan>`;
    if (p.link) return `<tspan fill="${C.accent}" text-decoration="underline">${esc(p.link)}</tspan>`;
    if (p.ins) return `<tspan fill="${C.orange}" font-weight="600">${esc(p.ins)}</tspan>`;
    return '';
  }).join('');
  const plain = parts.map(p => (typeof p === 'string' ? p : p.b || p.link || p.ins)).join('');
  const fit = o.maxW && width(plain, fs) > o.maxW ? ` textLength="${o.maxW}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${fs}" fill="${C.text}" xml:space="preserve"${fit}>${spans}</text>`;
}
const arrow = (x1, y, x2, color = C.faint) => `<line x1="${x1}" y1="${y}" x2="${x2 - 7}" y2="${y}" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M${x2 - 9} ${y - 6} L${x2} ${y} L${x2 - 9} ${y + 6}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">\n<title>${esc(title)}</title>\n${rect(0.5, 0.5, w - 1, h - 1, { fill: C.bg, stroke: C.border, r: 10 })}\n${body.join('\n')}\n</svg>\n`;

// ---------------------------------------------------------------- 示意圖：存檔時只重寫改過的區塊
function saving(lang) {
  const L = CONTENT[lang];
  const W = 1200, H = 430, b = [];
  const cw = 330, gap = 75, x1 = 30, x2 = x1 + cw + gap, x3 = x2 + cw + gap, top = 66, bh = 56, bg = 12;
  const blocks = (before) => ['# ' + L.title, before ? L.before : L.after, `- [x] ${L.tasks[0]}  …`, `| ${L.th[0]} | ${L.th[1]} |  …`];
  [[x1, L.col1], [x2, L.col2], [x3, L.col3]].forEach(([x, cap]) => b.push(text(x, 44, cap, { size: 15, weight: 600, maxW: cw })));
  // 左：原本的檔案
  blocks(true).forEach((s, i) => { const y = top + i * (bh + bg); b.push(rect(x1, y, cw, bh, { fill: C.card, stroke: C.border, r: 7 }), text(x1 + 16, y + 34, s, { size: 13, mono: true, maxW: cw - 32 })); });
  // 中：Word 模式的頁面
  const ph = 4 * bh + 3 * bg;
  b.push(rect(x2, top, cw, ph, { fill: C.card, stroke: C.border, r: 7 }));
  b.push(text(x2 + 22, top + 42, L.title, { size: 21, weight: 700, maxW: cw - 44 }));
  b.push(rect(x2 + 12, top + bh + bg + 2, cw - 24, bh - 4, { fill: C.orangeBg, stroke: C.orangeBd, r: 6 }));
  b.push(rich(x2 + 22, top + bh + bg + 35, L.edited, { size: 14, maxW: cw - 44 }));
  const ly = top + 2 * (bh + bg) + 34;
  b.push(rect(x2 + 23, ly - 13, 14, 14, { fill: C.accent, r: 3 }), `<path d="M${x2 + 26} ${ly - 5.5}l3 3 5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`, text(x2 + 46, ly, L.tasks[0], { size: 14, fill: C.muted, deco: 'line-through', maxW: cw - 70 }));
  const ty = top + 3 * (bh + bg) + 8;
  b.push(rect(x2 + 22, ty, 200, 20, { fill: C.bar, r: 0 }), text(x2 + 30, ty + 14.5, L.th[0], { size: 12, weight: 600, maxW: 84 }), text(x2 + 130, ty + 14.5, L.th[1], { size: 12, weight: 600, maxW: 84 }), text(x2 + 30, ty + 34.5, L.rows[0][0], { size: 12, maxW: 84 }), text(x2 + 130, ty + 34.5, L.rows[0][1], { size: 12, maxW: 84 }));
  for (const yy of [ty, ty + 20, ty + 40]) b.push(line(x2 + 22, yy, x2 + 222, yy, { stroke: '#c9d1d9' }));
  for (const xx of [x2 + 22, x2 + 122, x2 + 222]) b.push(line(xx, ty, xx, ty + 40, { stroke: '#c9d1d9' }));
  // 右：存檔後的檔案
  blocks(false).forEach((s, i) => {
    const y = top + i * (bh + bg), changed = i === 1;
    b.push(rect(x3, y, cw, bh, { fill: changed ? C.orangeBg : C.card, stroke: changed ? C.orangeBd : C.border, r: 7 }));
    b.push(text(x3 + 16, y + 24, s, { size: 13, mono: true, maxW: cw - 32 }));
    const label = changed ? L.rewritten : L.unchanged, col = changed ? C.orange : C.green;
    if (!changed) b.push(`<path d="M${x3 + 17} ${y + 41}l3 3 5.5-6.5" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
    else b.push(`<path d="M${x3 + 17} ${y + 45}l8-8M${x3 + 22} ${y + 37}h3v3" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
    b.push(text(x3 + 32, y + 46, label, { size: 11.5, fill: col, weight: 600, maxW: cw - 48 }));
  });
  const my = top + ph / 2;
  b.push(arrow(x1 + cw + 16, my, x2 - 16), arrow(x2 + cw + 16, my, x3 - 16));
  b.push(text(W / 2, H - 46, L.note, { size: 14, fill: C.text, anchor: 'middle', maxW: W - 120 }));
  b.push(text(W - 28, H - 16, L.illus, { size: 11.5, fill: C.faint, anchor: 'end' }));
  return svg(W, H, L.note, b);
}

// ---------------------------------------------------------------- 輸出
const out = 'docs/images';
fs.mkdirSync(out, { recursive: true });
for (const lang of ['en', 'zh-TW', 'ja', 'ko']) {
  setFonts(lang);
  const file = `${out}/saving.${lang}.svg`;
  fs.writeFileSync(file, saving(lang));
  console.log('wrote', file);
}
