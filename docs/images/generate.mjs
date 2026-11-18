// 產生 README 用的示意圖（SVG）。介面文字取自外掛的翻譯字典，確保跟實際畫面一致。
// 用法（在專案根目錄執行）：node docs/images/generate.mjs
// 介面文字或功能區有變動時重新執行，會覆蓋 docs/images/ 底下四種語言的 SVG。
import fs from 'fs';
import esbuild from 'esbuild';

async function loadDict(lang) {
  const r = await esbuild.build({ entryPoints: [`src/i18n-${lang}.ts`], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  return (await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'))).default;
}
async function loadModule(file) {
  const r = await esbuild.build({ entryPoints: [file], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}
const { DIAGRAM_KINDS, NODE_FILLS } = await loadModule('src/diagrams.ts');
const EN = await loadDict('en');
const DICT = { 'zh-TW': {}, en: EN, ja: await loadDict('ja'), ko: await loadDict('ko') };

// ---------------------------------------------------------------- 各語言的示範內容
const CONTENT = {
  en: {
    file: 'Weekly meeting.md', title: 'Weekly meeting',
    para: ["This week's ", { b: 'focus' }, ': finish the first version. See ', { link: 'Release plan' }, '.'],
    paraMd: "This week's **focus**: finish the first version. See [[Release plan]].",
    tasks: ['Update the docs', 'Prepare the demo'],
    th: ['Item', 'Owner'], rows: [['Testing', 'Alex'], ['Release', 'Sam']],
    mdCap: 'Saved on disk: plain Markdown', wmCap: 'What you edit: Word mode', same: 'same note',
    col1: 'Markdown file', col2: 'You change one paragraph', col3: 'Saved file',
    unchanged: 'unchanged', rewritten: 'rewritten',
    before: "This week's **focus**: finish v1.", after: "This week's **focus**: finish v1 by Friday.",
    edited: ["This week's ", { b: 'focus' }, ': finish v1', { ins: ' by Friday' }, '.'],
    note: 'Only the block you changed is written again. Everything else is kept character for character.',
    illus: 'Illustration',
    eqTips: [['Click a box and type.', 'Fractions, roots and matrices are boxes.'], ['Backspace in an empty box', 'removes the structure around it.'], ['Undo and redo, or switch', 'to plain LaTeX at any time.']],
  },
  'zh-TW': {
    file: '週會紀錄.md', title: '週會紀錄',
    para: ['本週', { b: '重點' }, '：完成第一版，詳見 ', { link: '發佈計畫' }, '。'],
    paraMd: '本週**重點**：完成第一版，詳見 [[發佈計畫]]。',
    tasks: ['更新文件', '準備示範'],
    th: ['項目', '負責人'], rows: [['測試', '小明'], ['發佈', '小華']],
    mdCap: '存在磁碟上的：純 Markdown', wmCap: '你編輯的：Word 模式', same: '同一份筆記',
    col1: 'Markdown 檔案', col2: '在 Word 模式改了一個段落', col3: '存檔後的檔案',
    unchanged: '原樣保留', rewritten: '重新輸出',
    before: '本週**重點**：完成第一版。', after: '本週**重點**：週五前完成第一版。',
    edited: ['本週', { b: '重點' }, '：', { ins: '週五前' }, '完成第一版。'],
    note: '只有修改過的區塊會重新輸出，其餘部分一字不差保留原文。',
    illus: '示意圖',
    eqTips: [['點格子直接輸入，', '分數、根號、矩陣都是格子。'], ['在空格子裡按 Backspace，', '拿掉外面的結構。'], ['可以復原、取消復原，', '也能隨時切到 LaTeX。']],
  },
  ja: {
    file: '週次ミーティング.md', title: '週次ミーティング',
    para: ['今週の', { b: '重点' }, '：最初のバージョンを完成。詳しくは ', { link: 'リリース計画' }, '。'],
    paraMd: '今週の**重点**：最初のバージョンを完成。詳しくは [[リリース計画]]。',
    tasks: ['ドキュメントを更新', 'デモを準備'],
    th: ['項目', '担当者'], rows: [['テスト', '田中'], ['リリース', '佐藤']],
    mdCap: 'ディスク上の保存内容：プレーンな Markdown', wmCap: '編集画面：Word モード', same: '同じノート',
    col1: 'Markdown ファイル', col2: 'Word モードで段落を 1 つ変更', col3: '保存後のファイル',
    unchanged: '変更なし', rewritten: '書き直し',
    before: '今週の**重点**：v1 を完成。', after: '今週の**重点**：金曜までに v1 を完成。',
    edited: ['今週の', { b: '重点' }, '：', { ins: '金曜までに ' }, 'v1 を完成。'],
    note: '変更したブロックだけが書き直され、それ以外は一文字も変わりません。',
    illus: 'イメージ図',
    eqTips: [['マスを選んで入力します。', '分数、根号、行列はマスです。'], ['空のマスで Backspace を押すと', '外側の構造を取り除きます。'], ['元に戻す・やり直しができ、', 'いつでも LaTeX に切り替えられます。']],
  },
  ko: {
    file: '주간 회의.md', title: '주간 회의',
    para: ['이번 주 ', { b: '핵심' }, ': 첫 버전을 완성합니다. 자세한 내용은 ', { link: '배포 계획' }, ' 참고.'],
    paraMd: '이번 주 **핵심**: 첫 버전을 완성합니다. 자세한 내용은 [[배포 계획]] 참고.',
    tasks: ['문서 업데이트', '데모 준비'],
    th: ['항목', '담당자'], rows: [['테스트', '민수'], ['배포', '지영']],
    mdCap: '디스크에 저장되는 내용: 일반 Markdown', wmCap: '편집 화면: Word 모드', same: '같은 노트',
    col1: 'Markdown 파일', col2: 'Word 모드에서 문단 하나를 수정', col3: '저장된 파일',
    unchanged: '그대로 유지', rewritten: '다시 기록',
    before: '이번 주 **핵심**: v1 완성.', after: '이번 주 **핵심**: 금요일까지 v1 완성.',
    edited: ['이번 주 ', { b: '핵심' }, ': ', { ins: '금요일까지 ' }, 'v1 완성.'],
    note: '변경한 블록만 다시 기록되고 나머지는 한 글자도 바뀌지 않습니다.',
    illus: '예시 그림',
    eqTips: [['칸을 선택해 바로 입력합니다.', '분수, 근호, 행렬이 모두 칸입니다.'], ['빈 칸에서 Backspace를 누르면', '바깥 구조를 없앱니다.'], ['실행 취소와 다시 실행이 되고,', '언제든 LaTeX로 바꿀 수 있습니다.']],
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

// 小圖示（20×20 的範圍，左上角在 x, y）
const S = `fill="none" stroke="${C.muted}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
const ICONS = {
  table: (x, y) => `<rect x="${x + 2}" y="${y + 3}" width="16" height="14" rx="2" ${S}/><path d="M${x + 2} ${y + 8}h16M${x + 2} ${y + 12.5}h16M${x + 8} ${y + 3}v14M${x + 13} ${y + 3}v14" ${S}/>`,
  image: (x, y) => `<rect x="${x + 2}" y="${y + 3}" width="16" height="14" rx="2" ${S}/><circle cx="${x + 7}" cy="${y + 8}" r="1.6" ${S}/><path d="M${x + 3} ${y + 15}l4.5-4.5 3 3 2.5-2.5 4 4" ${S}/>`,
  sigma: (x, y) => `<path d="M${x + 15} ${y + 5.5}v-2h-10l6 6.5-6 6.5h10v-2" ${S}/>`,
  workflow: (x, y) => `<rect x="${x + 2}" y="${y + 2}" width="7" height="6" rx="1.5" ${S}/><rect x="${x + 11}" y="${y + 12}" width="7" height="6" rx="1.5" ${S}/><path d="M${x + 5.5} ${y + 8}v4.5a2.5 2.5 0 0 0 2.5 2.5h3" ${S}/>`,
  omega: (x, y) => `<path d="M${x + 3} ${y + 16.5}h4v-1.8a6.2 6.2 0 1 1 6 0v1.8h4" ${S}/>`,
  link: (x, y) => `<path d="M${x + 8.5} ${y + 11.5}a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1" ${S}/><path d="M${x + 11.5} ${y + 8.5}a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1" ${S}/>`,
  note: (x, y) => `<path d="M${x + 5} ${y + 2}h7l4 4v12h-11z" ${S}/><path d="M${x + 12} ${y + 2}v4h4M${x + 8} ${y + 13}h4M${x + 10.5} ${y + 11}l2 2-2 2" ${S}/>`,
  asterisk: (x, y) => `<path d="M${x + 10} ${y + 4}v12M${x + 4.8} ${y + 7}l10.4 6M${x + 15.2} ${y + 7}l-10.4 6" ${S}/>`,
  code: (x, y) => `<path d="M${x + 7} ${y + 6}l-4 4 4 4M${x + 13} ${y + 6}l4 4-4 4" ${S}/>`,
  codeblock: (x, y) => `<rect x="${x + 2}" y="${y + 2}" width="16" height="16" rx="2.5" ${S}/><path d="M${x + 8} ${y + 7.5}l-2.5 2.5 2.5 2.5M${x + 12} ${y + 7.5}l2.5 2.5-2.5 2.5" ${S}/>`,
  keyboard: (x, y) => `<rect x="${x + 1.5}" y="${y + 5}" width="17" height="11" rx="2" ${S}/><path d="M${x + 5} ${y + 9}h.01M${x + 8.3} ${y + 9}h.01M${x + 11.6} ${y + 9}h.01M${x + 15} ${y + 9}h.01M${x + 6} ${y + 12.5}h8" ${S}/>`,
  info: (x, y) => `<circle cx="${x + 10}" cy="${y + 10}" r="7.5" ${S}/><path d="M${x + 10} ${y + 9.5}v4M${x + 10} ${y + 6.5}h.01" ${S}/>`,
  comment: (x, y) => `<path d="M${x + 3} ${y + 4}h14v10h-8l-4 3.5v-3.5h-2z" ${S}/>`,
  calendar: (x, y) => `<rect x="${x + 2.5}" y="${y + 4}" width="15" height="13.5" rx="2" ${S}/><path d="M${x + 2.5} ${y + 8.5}h15M${x + 6.5} ${y + 2.5}v3M${x + 13.5} ${y + 2.5}v3" ${S}/>`,
  minus: (x, y) => `<path d="M${x + 3} ${y + 10}h14" ${S}/>`,
  template: (x, y) => `<rect x="${x + 2.5}" y="${y + 2.5}" width="15" height="5" rx="1.2" ${S}/><rect x="${x + 2.5}" y="${y + 10.5}" width="6" height="7" rx="1.2" ${S}/><rect x="${x + 11.5}" y="${y + 10.5}" width="6" height="7" rx="1.2" ${S}/>`,
  props: (x, y) => `<path d="M${x + 3} ${y + 5}h9M${x + 3} ${y + 10}h9M${x + 3} ${y + 15}h6M${x + 15} ${y + 12}v6M${x + 12} ${y + 15}h6" ${S}/>`,
};

// 功能區的分頁列
function tabs(t, x, y, w, active) {
  const out = [rect(x, y, w, 32, { fill: C.card, r: 0 }), line(x, y + 32, x + w, y + 32)];
  let cx = x + 10;
  for (const name of ['常用', '插入', '校閱', '檢視']) {
    const label = t(name);
    const tw = Math.max(46, width(label, 13) + 24);
    const on = name === active;
    out.push(text(cx + tw / 2, y + 21, label, { size: 13, anchor: 'middle', fill: on ? C.accent : C.muted, weight: on ? 600 : null }));
    if (on) out.push(rect(cx, y + 30, tw, 2.5, { fill: C.accent, r: 1 }));
    cx += tw + 2;
  }
  return out;
}

// ---------------------------------------------------------------- 圖一：同一份筆記的兩種樣子
function overview(lang, t) {
  const L = CONTENT[lang];
  const W = 1200, H = 520, b = [];
  // 左：Markdown 原文
  const lx = 28, ly = 64, lw = 420, lh = 412;
  b.push(text(lx, 42, L.mdCap, { size: 15, weight: 600, maxW: lw }));
  b.push(rect(lx, ly, lw, lh, { fill: C.card, stroke: C.border, r: 8 }));
  b.push(`<path d="M${lx} ${ly + 34}V${ly + 8}a8 8 0 0 1 8-8h${lw - 16}a8 8 0 0 1 8 8v26z" fill="${C.bar}"/>`, line(lx, ly + 34, lx + lw, ly + 34));
  b.push(text(lx + 14, ly + 22, L.file, { size: 12.5, fill: C.muted, mono: true, maxW: lw - 28 }));
  const md = ['# ' + L.title, '', L.paraMd, '', '- [x] ' + L.tasks[0], '- [ ] ' + L.tasks[1], '', `| ${L.th[0]} | ${L.th[1]} |`, '| --- | --- |', ...L.rows.map(r => `| ${r[0]} | ${r[1]} |`)];
  // 段落太長時在空白處換行（Markdown 原文裡是同一行）
  const wrapped = [];
  for (const l of md) {
    if (width(l, 13, true) <= lw - 36) { wrapped.push(l); continue; }
    let cur = '';
    for (const tok of l.match(/[^ 。，、：]*[ 。，、：]?/g).filter(Boolean)) { if (cur && width(cur + tok, 13, true) > lw - 36) { wrapped.push(cur); cur = tok; } else cur += tok; }
    if (cur) wrapped.push(cur);
  }
  wrapped.forEach((l, i) => { if (l) b.push(text(lx + 18, ly + 62 + i * 24, l, { size: 13, mono: true, fill: /^#/.test(l) ? C.accent : C.text, maxW: lw - 36 })); });

  // 中間：同一份筆記
  const mx = 474;
  b.push(text(mx + 26, 246, L.same, { size: 12.5, fill: C.muted, anchor: 'middle', maxW: 62 }));
  b.push(`<path d="M${mx + 8} 262h36M${mx + 8} 272h36" stroke="${C.faint}" stroke-width="2.4" stroke-linecap="round"/>`);

  // 右：Word 模式
  const rx = 552, ry = 64, rw = 620, rh = 412;
  b.push(text(rx, 42, L.wmCap, { size: 15, weight: 600, maxW: rw }));
  b.push(`<clipPath id="win"><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="8"/></clipPath>`);
  b.push(`<g clip-path="url(#win)">`, rect(rx, ry, rw, rh, { fill: '#eceef1', r: 0 }), ...tabs(t, rx, ry, rw, '常用'));
  // 工具列
  const ty = ry + 33;
  b.push(rect(rx, ty, rw, 42, { fill: C.card, r: 0 }), line(rx, ty + 42, rx + rw, ty + 42));
  let bx = rx + 12;
  const btn = (label, o = {}) => { const w = o.w || 28; b.push(rect(bx, ty + 8, w, 26, { fill: o.on ? C.accentBg : 'none', stroke: o.box ? C.border : null, r: 4 })); b.push(text(bx + (o.left ? 9 : w / 2), ty + 26, label, { size: o.size || 14, anchor: o.left ? null : 'middle', fill: o.on ? C.accent : (o.fill || C.text), weight: o.weight, italic: o.italic, deco: o.deco, maxW: o.left ? w - 26 : null })); if (o.caret) b.push(text(bx + w - 14, ty + 25, '▾', { size: 10, fill: C.faint })); bx += w + 3; };
  const sep = () => { b.push(line(bx + 4, ty + 9, bx + 4, ty + 33)); bx += 12; };
  btn('↶'); btn('↷'); sep();
  btn(t('內文'), { w: 96, box: true, left: true, caret: true, size: 12.5 }); sep();
  btn('B', { weight: 700, on: true }); btn('I', { italic: true }); btn('U', { deco: 'underline' }); btn('S', { deco: 'line-through' }); btn('x²', { size: 12.5 });
  b.push(rect(bx + 4, ty + 28, 20, 4, { fill: '#ffd84d', r: 1 })); btn('H', { weight: 600 });
  b.push(rect(bx + 4, ty + 28, 20, 4, { fill: '#e5484d', r: 1 })); btn('A', { weight: 600 }); sep();
  for (const g of ['list', 'num', 'check']) {
    const x = bx, y = ty + 11;
    if (g === 'list') b.push(`<path d="M${x + 6} ${y + 5}h.01M${x + 6} ${y + 10}h.01M${x + 6} ${y + 15}h.01M${x + 11} ${y + 5}h11M${x + 11} ${y + 10}h11M${x + 11} ${y + 15}h11" ${S}/>`);
    if (g === 'num') b.push(text(x + 4, y + 8, '1', { size: 8, fill: C.muted }), text(x + 4, y + 17, '2', { size: 8, fill: C.muted }), `<path d="M${x + 11} ${y + 5}h11M${x + 11} ${y + 14}h11" ${S}/>`);
    if (g === 'check') b.push(`<rect x="${x + 4}" y="${y + 3}" width="7" height="7" rx="1.5" ${S}/><path d="M${x + 14} ${y + 6.5}h8M${x + 5.5} ${y + 15}l2 2 3.5-4M${x + 14} ${y + 15}h8" ${S}/>`);
    bx += 31;
  }
  sep();
  for (const k of [0, 1]) { const x = bx, y = ty + 11, o = [0, 3, 6][k]; b.push(`<path d="M${x + 5 + (k === 2 ? 6 : k === 1 ? 3 : 0)} ${y + 5}h12M${x + 5} ${y + 10}h18M${x + 5 + (k === 2 ? 6 : k === 1 ? 3 : 0)} ${y + 15}h12" ${S}/>`); bx += 31; void o; }
  // 紙張
  const px = rx + 46, py = ty + 62, pw = rw - 92;
  b.push(rect(px, py, pw, rh, { fill: C.card, stroke: '#dfe3e8', r: 3 }));
  const cx = px + 40;
  b.push(text(cx, py + 54, L.title, { size: 26, weight: 700, maxW: pw - 80 }));
  b.push(rich(cx, py + 92, L.para, { size: 14.5, maxW: pw - 80 }));
  L.tasks.forEach((s, i) => {
    const y = py + 124 + i * 28;
    b.push(rect(cx + 2, y - 13, 15, 15, { fill: i === 0 ? C.accent : C.card, stroke: i === 0 ? C.accent : C.faint, r: 3 }));
    if (i === 0) b.push(`<path d="M${cx + 5.5} ${y - 5.5}l3 3 5-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
    b.push(text(cx + 28, y, s, { size: 14.5, fill: i === 0 ? C.muted : C.text, deco: i === 0 ? 'line-through' : null }));
  });
  const tx = cx, tyy = py + 178, cw = 150, ch = 30;
  b.push(rect(tx, tyy, cw * 2, ch, { fill: C.bar, r: 0 }));
  [L.th, ...L.rows].forEach((row, r) => row.forEach((cell, c) => b.push(text(tx + c * cw + 12, tyy + r * ch + 20, cell, { size: 13.5, weight: r === 0 ? 600 : null, maxW: cw - 24 }))));
  for (let r = 0; r <= 3; r++) b.push(line(tx, tyy + r * ch, tx + cw * 2, tyy + r * ch, { stroke: '#c9d1d9' }));
  for (let c = 0; c <= 2; c++) b.push(line(tx + c * cw, tyy, tx + c * cw, tyy + ch * 3, { stroke: '#c9d1d9' }));
  b.push('</g>', rect(rx, ry, rw, rh, { stroke: C.border, r: 8 }));
  b.push(text(W - 28, H - 16, L.illus, { size: 11.5, fill: C.faint, anchor: 'end' }));
  return svg(W, H, `${L.mdCap} / ${L.wmCap}`, b);
}

// ---------------------------------------------------------------- 圖二：功能區（插入分頁）
function ribbon(lang, t) {
  const L = CONTENT[lang];
  const W = 1200, H = 176, b = [];
  const x0 = 20, y0 = 20, w0 = W - 40, h0 = 126;
  b.push(`<clipPath id="rb"><rect x="${x0}" y="${y0}" width="${w0}" height="${h0}" rx="8"/></clipPath>`, `<g clip-path="url(#rb)">`, rect(x0, y0, w0, h0, { fill: C.card, r: 0 }), ...tabs(t, x0, y0, w0, '插入'));
  const groups = [
    ['表格', [['table', '表格']]],
    ['圖例', [['image', '圖片'], ['sigma', '方程式'], ['workflow', '圖表'], ['omega', '符號']]],
    ['連結', [['link', '連結'], ['note', '筆記'], ['asterisk', '註腳']]],
    ['程式碼', [['code', '行內'], ['codeblock', '程式碼區塊'], ['keyboard', '按鍵']]],
    ['文字', [['info', '提示框'], ['comment', '註解'], ['calendar', '日期'], ['minus', '分隔線']]],
    ['Obsidian', [['template', '範本'], ['props', '屬性']]],
  ];
  const bw = 62, by = y0 + 40;
  let gx = x0 + 14;
  groups.forEach(([gname, items], gi) => {
    items.forEach(([icon, label], i) => {
      const x = gx + i * bw;
      b.push(ICONS[icon](x + bw / 2 - 10, by + 6));
      b.push(text(x + bw / 2, by + 44, t(label), { size: 11.5, anchor: 'middle', fill: C.text, maxW: bw - 6 }));
    });
    const gw = items.length * bw;
    b.push(text(gx + gw / 2, by + 72, t(gname), { size: 10.5, anchor: 'middle', fill: C.faint, maxW: gw - 4 }));
    gx += gw + 8;
    if (gi < groups.length - 1) { b.push(line(gx, by + 4, gx, by + 76)); gx += 9; }
  });
  b.push('</g>', rect(x0, y0, w0, h0, { stroke: C.border, r: 8 }));
  b.push(text(W - 24, H - 10, L.illus, { size: 11.5, fill: C.faint, anchor: 'end' }));
  return svg(W, H, `${t('插入')}`, b);
}

// ---------------------------------------------------------------- 圖三：存檔時只重寫改過的區塊
function saving(lang, t) {
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

// ---------------------------------------------------------------- 對話框裡共用的小元件
// 分段按鈕（一排選項，其中一個是選取的）；回傳畫出來的寬度
function segment(b, x, y, labels, on) {
  const ws = labels.map(l => width(l, 12.5) + 24);
  const total = ws.reduce((a, w) => a + w, 0) + 4;
  b.push(rect(x, y, total, 30, { fill: '#e9ecf0', r: 8 }));
  let cx = x + 2;
  labels.forEach((l, i) => {
    if (i === on) b.push(rect(cx, y + 2, ws[i], 26, { fill: C.card, stroke: '#d5dae0', r: 6 }));
    b.push(text(cx + ws[i] / 2, y + 19.5, l, { size: 12.5, anchor: 'middle', fill: i === on ? C.text : C.muted, weight: i === on ? 600 : null }));
    cx += ws[i];
  });
  return total;
}
const card = (x, y, w, h) => rect(x, y, w, h, { fill: C.bg, stroke: C.border, r: 10 });
const SERIF = "'Cambria Math', 'STIX Two Math', 'Times New Roman', serif";
const math = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-family="${SERIF}" font-size="${o.size || 20}" fill="${C.text}"${o.italic ? ' font-style="italic"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`;
const slot = (x, y, w, h, o = {}) => rect(x, y, w, h, { stroke: o.on ? C.accent : C.faint, dash: o.on ? null : '3 2', fill: o.on ? C.accentBg : 'none', r: 3 });

// ---------------------------------------------------------------- 圖四：方程式編輯器
function equation(lang, t) {
  const L = CONTENT[lang];
  const W = 1200, H = 440, b = [];
  const dx = 28, dy = 22, dw = 770, dh = 396;
  b.push(rect(dx, dy, dw, dh, { fill: C.card, stroke: C.border, r: 12 }));
  b.push(text(dx + 22, dy + 34, t('插入方程式'), { size: 17, weight: 600 }));
  let sx = dx + 22;
  sx += segment(b, sx, dy + 48, [t('文字中（行內）'), t('獨立一行（置中）')], 0) + 10;
  segment(b, sx, dy + 48, [t('視覺化'), 'LaTeX'], 0);
  // 結構與符號
  const px = dx + 22, py = dy + 90, pw = dw - 44;
  b.push(card(px, py, pw, 112));
  let cx = px + 14;
  ['結構', '運算', '標記', '關係', '希臘字母', '常用公式'].forEach((name, i) => {
    const label = t(name); const w = width(label, 12.5) + 20;
    b.push(text(cx + w / 2, py + 24, label, { size: 12.5, anchor: 'middle', fill: i === 0 ? C.accent : C.muted, weight: i === 0 ? 600 : null }));
    if (i === 0) b.push(rect(cx, py + 33, w, 2.5, { fill: C.accent, r: 1 }));
    cx += w + 2;
  });
  b.push(line(px + 12, py + 35.5, px + pw - 12, py + 35.5));
  const tiles = [['分數', 'frac'], ['根號', 'sqrt'], ['上標', 'sup'], ['下標', 'sub'], ['括號', 'paren'], ['矩陣', 'matrix'], ['分段函數', 'cases']];
  tiles.forEach(([name, kind], i) => {
    const x = px + 14 + i * 84, y = py + 44, w = 76, h = 58, mx = x + w / 2, my = y + 20;
    b.push(rect(x, y, w, h, { fill: C.card, stroke: C.border, r: 7 }));
    if (kind === 'frac') b.push(slot(mx - 6, my - 14, 12, 11), line(mx - 11, my, mx + 11, my, { stroke: C.text }), slot(mx - 6, my + 3, 12, 11));
    if (kind === 'sqrt') b.push(math(mx - 15, my + 8, '√', { size: 19 }), line(mx - 3, my - 9, mx + 14, my - 9, { stroke: C.text }), slot(mx, my - 5, 12, 12));
    if (kind === 'sup') b.push(math(mx - 10, my + 8, 'x', { size: 18, italic: true }), slot(mx + 1, my - 12, 9, 9));
    if (kind === 'sub') b.push(math(mx - 10, my + 5, 'x', { size: 18, italic: true }), slot(mx + 1, my + 3, 9, 9));
    if (kind === 'paren') b.push(math(mx - 14, my + 8, '(', { size: 20 }), slot(mx - 6, my - 7, 12, 13), math(mx + 8, my + 8, ')', { size: 20 }));
    if (kind === 'matrix') b.push(math(mx - 17, my + 9, '[', { size: 26 }), math(mx - 9, my - 1, 'a  b', { size: 12, italic: true }), math(mx - 9, my + 12, 'c  d', { size: 12, italic: true }), math(mx + 11, my + 9, ']', { size: 26 }));
    if (kind === 'cases') b.push(math(mx - 20, my + 10, '{', { size: 28 }), math(mx - 8, my - 1, 'x,  x ≥ 0', { size: 11, italic: true }), math(mx - 8, my + 12, '−x, x < 0', { size: 11, italic: true }));
    b.push(text(mx, y + h - 8, t(name), { size: 10.5, anchor: 'middle', fill: C.muted, maxW: w - 8 }));
  });
  // 編輯區
  const ey = py + 122;
  b.push(card(px, ey, pw, 112));
  b.push(text(px + 14, ey + 23, t('編輯'), { size: 12.5, weight: 600, fill: C.muted }));
  ['‹', '›', '⌫', '↶', '↷'].forEach((g, i) => b.push(text(px + pw - 132 + i * 26 + (i > 2 ? 10 : 0), ey + 24, g, { size: i === 2 ? 14 : 17, fill: C.muted, anchor: 'middle' })));
  b.push(line(px + pw - 132 + 3 * 26 - 8, ey + 12, px + pw - 132 + 3 * 26 - 8, ey + 28));
  b.push(rect(px + 12, ey + 34, pw - 24, 66, { fill: C.card, stroke: C.accent, sw: 1.5, r: 8 }));
  const fx = px + 36, fy = ey + 73;
  b.push(math(fx, fy, 'x =', { size: 22 }));
  b.push(line(fx + 46, fy - 7, fx + 226, fy - 7, { stroke: C.text, sw: 1.2 }));
  b.push(math(fx + 54, fy - 15, '−b ±', { size: 20 }), math(fx + 104, fy - 14, '√', { size: 22 }), line(fx + 118, fy - 32, fx + 220, fy - 32, { stroke: C.text, sw: 1.2 }));
  b.push(math(fx + 122, fy - 15, 'b', { size: 20 }), math(fx + 134, fy - 24, '2', { size: 13 }), math(fx + 146, fy - 15, '− 4ac', { size: 20 }));
  b.push(slot(fx + 120, fy + 1, 30, 22, { on: true }), math(fx + 124, fy + 19, '2a', { size: 20 }), line(fx + 147, fy + 4, fx + 147, fy + 20, { stroke: C.accent, sw: 1.5 }));
  // 預覽
  const vy = ey + 122;
  b.push(card(px, vy, pw, 50));
  b.push(text(px + 14, vy + 30, t('預覽'), { size: 12.5, weight: 600, fill: C.muted }));
  const vx = px + pw / 2 - 70;
  b.push(math(vx, vy + 32, 'x =', { size: 17, italic: true }), line(vx + 34, vy + 26, vx + 152, vy + 26, { stroke: C.text }));
  b.push(math(vx + 93, vy + 21, '−b ± √(b² − 4ac)', { size: 13, italic: true, anchor: 'middle' }), math(vx + 93, vy + 41, '2a', { size: 13, italic: true, anchor: 'middle' }));
  // 右邊的三點說明
  L.eqTips.forEach((lines, i) => {
    const x = 836, y = 130 + i * 96;
    b.push(`<circle cx="${x + 13}" cy="${y}" r="13" fill="${C.accentBg}"/>`, text(x + 13, y + 5, String(i + 1), { size: 13.5, weight: 700, fill: C.accent, anchor: 'middle' }));
    lines.forEach((l, j) => b.push(text(x + 38, y + 5 + j * 22, l, { size: 14, fill: j === 0 ? C.text : C.muted, maxW: 300 })));
  });
  b.push(text(W - 28, H - 16, L.illus, { size: 11.5, fill: C.faint, anchor: 'end' }));
  return svg(W, H, t('插入方程式'), b);
}

// ---------------------------------------------------------------- 圖五：圖表編輯器
function diagram(lang, t) {
  const L = CONTENT[lang];
  const W = 1200, H = 500, b = [];
  const flow = DIAGRAM_KINDS[0];
  const model = flow.parse(t(flow.template)); // 外掛實際插入的流程圖範本
  const nodes = model.lists.nodes; const edges = model.lists.edges;
  const fill = NODE_FILLS[3][0];
  const dx = 24, dy = 20, dw = W - 48, dh = 456;
  b.push(rect(dx, dy, dw, dh, { fill: C.card, stroke: C.border, r: 12 }));
  b.push(text(dx + 22, dy + 34, t('插入圖表（Mermaid）'), { size: 17, weight: 600 }));
  // 圖表種類
  // 名稱較長的語言一排放不下：把文字壓窄到剛好排滿
  const names = DIAGRAM_KINDS.map(k => t(k.name));
  const raw = names.map(l => width(l, 12.5));
  const gap = 6, pad = 24;
  const squeeze = Math.min(1, (dw - 44 - gap * (names.length - 1) - pad * names.length) / raw.reduce((a, w) => a + w, 0));
  let cx = dx + 22;
  names.forEach((label, i) => {
    const tw = raw[i] * squeeze; const w = tw + pad;
    b.push(rect(cx, dy + 48, w, 28, { fill: i === 0 ? C.accent : C.bg, stroke: i === 0 ? C.accent : C.border, r: 14 }));
    b.push(text(cx + w / 2, dy + 66.5, label, { size: 12.5, anchor: 'middle', fill: i === 0 ? '#ffffff' : C.muted, weight: i === 0 ? 600 : null, maxW: squeeze < 1 ? tw : null }));
    cx += w + gap;
  });
  segment(b, dx + 22, dy + 86, [t('表單'), t('程式碼')], 0);
  // 左：表單
  const lx = dx + 22, ly = dy + 126, lw = 640, lh = 312;
  b.push(card(lx, ly, lw, lh));
  const badge = t(flow.name); const bw = width(badge, 12.5) + 24;
  b.push(rect(lx + 14, ly + 12, bw, 24, { fill: C.accentBg, r: 12 }), text(lx + 14 + bw / 2, ly + 28.5, badge, { size: 12.5, anchor: 'middle', fill: C.accent, weight: 600 }));
  let ox = lx + 14 + bw + 14;
  for (const [label, value] of [[t('方向'), t('由上到下')], [t('外觀'), t('跟著 Obsidian')]]) {
    b.push(text(ox, ly + 28.5, label, { size: 12.5, fill: C.muted }));
    ox += width(label, 12.5) + 8;
    const w = width(value, 12.5) + 36;
    b.push(rect(ox, ly + 11, w, 26, { fill: C.card, stroke: C.border, r: 5 }), text(ox + 10, ly + 28.5, value, { size: 12.5 }), text(ox + w - 14, ly + 28, '▾', { size: 10, fill: C.faint }));
    ox += w + 14;
  }
  b.push(line(lx + 14, ly + 46, lx + lw - 14, ly + 46));
  const head = t('步驟（節點）');
  b.push(text(lx + 14, ly + 68, head, { size: 13, weight: 600 }), rect(lx + 22 + width(head, 13), ly + 55, 22, 18, { fill: '#e9ecf0', r: 9 }), text(lx + 33 + width(head, 13), ly + 68, String(nodes.length), { size: 11.5, fill: C.muted, anchor: 'middle' }));
  const shapes = { rect: t('方形'), diamond: t('菱形（判斷）') };
  nodes.forEach((n, i) => {
    const y = ly + 80 + i * 40; const on = i === 2;
    if (on) b.push(rect(lx + 10, y - 4, lw - 20, 38, { fill: C.accentBg, stroke: '#c9bdf3', r: 6 }));
    b.push(rect(lx + 14, y, 300, 30, { fill: C.card, stroke: C.border, r: 5 }), text(lx + 24, y + 20, n.text, { size: 13, maxW: 280 }));
    b.push(rect(lx + 320, y, 150, 30, { fill: C.card, stroke: C.border, r: 5 }), text(lx + 330, y + 20, shapes[n.shape] || n.shape, { size: 12.5, maxW: 118 }), text(lx + 456, y + 19.5, '▾', { size: 10, fill: C.faint }));
    b.push(rect(lx + 476, y, 32, 30, { fill: C.card, stroke: C.border, r: 5 }), rect(lx + 484, y + 7, 16, 16, { fill: on ? fill : 'none', stroke: C.faint, r: 4 }));
    if (!on) b.push(line(lx + 485, y + 22, lx + 499, y + 8, { stroke: C.faint }));
    ['↳', '↑', '↓', '✕'].forEach((g, j) => b.push(text(lx + 530 + j * 26, y + 20.5, g, { size: 14, fill: on ? C.muted : C.faint, anchor: 'middle' })));
  });
  const add = t('＋ 新增步驟'); const aw = width(add, 12.5) + 24;
  b.push(rect(lx + 14, ly + 246, aw, 28, { stroke: C.faint, dash: '4 3', r: 5 }), text(lx + 14 + aw / 2, ly + 264.5, add, { size: 12.5, fill: C.muted, anchor: 'middle' }));
  // 右：預覽
  const rx = lx + lw + 14, rw = dw - 44 - lw - 14;
  b.push(card(rx, ly, rw, lh));
  b.push(text(rx + 14, ly + 28.5, t('預覽'), { size: 12.5, weight: 600, fill: C.muted }));
  b.push(text(rx + 24 + width(t('預覽'), 12.5), ly + 28.5, t('點圖上的文字可以直接修改'), { size: 12, fill: C.accent, maxW: rw - 150 - width(t('預覽'), 12.5) }));
  b.push(text(rx + rw - 14, ly + 28.5, '−   100%   +', { size: 12.5, fill: C.muted, anchor: 'end' }));
  b.push(rect(rx + 12, ly + 42, rw - 24, lh - 54, { fill: C.card, stroke: C.border, r: 8 }));
  const mx = rx + rw / 2 - 40;
  const box = (y, label, o = {}) => { const w = Math.max(84, width(label, 13) + 28); b.push(rect(mx - w / 2, y, w, 30, { fill: o.fill || '#ecebff', stroke: o.stroke || '#9a8fe6', r: 3 }), text(mx, y + 20, label, { size: 13, anchor: 'middle', maxW: w - 10 })); };
  const down = (y1, y2) => b.push(line(mx, y1, mx, y2 - 6, { stroke: C.muted, sw: 1.4 }), `<path d="M${mx - 4.5} ${y2 - 7} L${mx} ${y2} L${mx + 4.5} ${y2 - 7}" fill="none" stroke="${C.muted}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  const y0 = ly + 54;
  box(y0, nodes[0].text);
  down(y0 + 30, y0 + 48);
  const dyc = y0 + 76; const dwid = Math.max(70, width(nodes[1].text, 13) / 2 + 34);
  b.push(`<path d="M${mx} ${dyc - 28} L${mx + dwid} ${dyc} L${mx} ${dyc + 28} L${mx - dwid} ${dyc} Z" fill="#ecebff" stroke="#9a8fe6"/>`, text(mx, dyc + 5, nodes[1].text, { size: 13, anchor: 'middle', maxW: dwid * 2 - 36 }));
  down(dyc + 28, y0 + 142);
  b.push(text(mx + 8, y0 + 126, edges[1] ? edges[1].text : '', { size: 11.5, fill: C.muted }));
  box(y0 + 142, nodes[2].text, { fill, stroke: '#a39a66' });
  down(y0 + 172, y0 + 206);
  box(y0 + 206, nodes[3].text);
  b.push(`<path d="M${mx - dwid} ${dyc} C ${mx - dwid - 46} ${dyc + 40}, ${mx - dwid - 46} ${y0 + 200}, ${mx - 46} ${y0 + 220}" fill="none" stroke="${C.muted}" stroke-width="1.4"/>`, text(mx - dwid - 40, y0 + 150, edges[2] ? edges[2].text : '', { size: 11.5, fill: C.muted, anchor: 'end' }));
  // 在圖上編輯：蓋在節點上的小輸入框，下面是底色的色塊
  const ix = mx - 36, iy = y0 + 136, iw = 250;
  b.push(rect(ix, iy, iw, 74, { fill: C.card, stroke: C.accent, sw: 1.5, r: 8 }));
  const tw = width(nodes[2].text, 13) + 6;
  b.push(rect(ix + 10, iy + 9, tw, 20, { fill: '#cfe0ff', r: 2 }), text(ix + 13, iy + 24, nodes[2].text, { size: 13 }), line(ix + 12 + tw, iy + 9, ix + 12 + tw, iy + 29, { stroke: C.accent, sw: 1.5 }));
  ['✓', '↳', '✕'].forEach((g, j) => b.push(text(ix + iw - 76 + j * 26, iy + 24.5, g, { size: 14, fill: j === 0 ? C.accent : C.muted, anchor: 'middle' })));
  b.push(line(ix + 8, iy + 38, ix + iw - 8, iy + 38));
  b.push(rect(ix + 10, iy + 46, 20, 20, { stroke: C.faint, r: 5 }), line(ix + 12, iy + 64, ix + 28, iy + 48, { stroke: C.faint }));
  NODE_FILLS.forEach(([c], j) => b.push(rect(ix + 36 + j * 26, iy + 46, 20, 20, { fill: c, stroke: j === 3 ? C.accent : '#b7bdc6', sw: j === 3 ? 2 : 1, r: 5 })));
  b.push(text(W - 28, H - 14, L.illus, { size: 11.5, fill: C.faint, anchor: 'end' }));
  return svg(W, H, t('插入圖表（Mermaid）'), b);
}

// ---------------------------------------------------------------- 輸出
const out = 'docs/images';
fs.mkdirSync(out, { recursive: true });
for (const lang of ['en', 'zh-TW', 'ja', 'ko']) {
  const d = DICT[lang];
  setFonts(lang);
  const t = s => (lang === 'zh-TW' ? s : (d[s] != null ? d[s] : (EN[s] != null ? EN[s] : s)));
  for (const [name, fn] of [['overview', overview], ['ribbon', ribbon], ['saving', saving], ['equation', equation], ['diagram', diagram]]) {
    const file = `${out}/${name}.${lang}.svg`;
    fs.writeFileSync(file, fn(lang, t));
    console.log('wrote', file);
  }
}
