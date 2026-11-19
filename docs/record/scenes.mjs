// 每支動畫的內容。筆記的文字依語言準備，跟介面語言一致。
// 每個場景：width／height 是視窗大小（預設 1000×640），run(rec, lang) 用 driver.mjs 的 Recorder 操作畫面。
const T = {
  en: {
    file: 'Weekly meeting', h: 'Weekly meeting',
    p1: "This week's ", b: 'focus', p2: ': finish the first version.',
    tasks: ['Update the docs', 'Prepare the demo'], see: 'See ', linkQ: 'Rel', link: 'Release plan',
    fmtPara: "This week's focus: finish the first version and prepare the demo.", fmtFrom: 'finish', fmtTo: 'version',
    tblFile: 'Project plan', tblH: 'Project plan', tblP: 'Tasks for this week:',
    tbl: [['Task', 'Owner', 'Due'], ['Testing', 'Sam', 'Fri'], ['Release', 'Alex', 'Mon'], ['Docs', 'Kim', 'Wed']],
    eqFile: 'Algebra notes', eqH: 'Quadratic equation', eqP: 'The roots of ax² + bx + c = 0 are:',
    mmdFile: 'Release process', mmdH: 'Release process', mmdP: 'How a change gets released:', mmd: ['Review', 'Publish'],
  },
  'zh-TW': {
    file: '週會紀錄', h: '週會紀錄',
    p1: '本週', b: '重點', p2: '：完成第一版。',
    tasks: ['更新文件', '準備示範'], see: '詳見 ', linkQ: '發佈', link: '發佈計畫',
    fmtPara: '本週重點：完成第一版，並準備示範。', fmtFrom: '完成', fmtTo: '第一版',
    tblFile: '專案計畫', tblH: '專案計畫', tblP: '本週工作：',
    tbl: [['工作', '負責人', '期限'], ['測試', '小華', '週五'], ['發佈', '小明', '週一'], ['文件', '小美', '週三']],
    eqFile: '代數筆記', eqH: '一元二次方程式', eqP: 'ax² + bx + c = 0 的解是：',
    mmdFile: '發佈流程', mmdH: '發佈流程', mmdP: '一項修改怎麼發佈：', mmd: ['審查', '發佈'],
  },
  ja: {
    file: '週次ミーティング', h: '週次ミーティング',
    p1: '今週の', b: '重点', p2: '：最初のバージョンを完成。',
    tasks: ['ドキュメントを更新', 'デモを準備'], see: '詳しくは ', linkQ: 'リリ', link: 'リリース計画',
    fmtPara: '今週の重点：最初のバージョンを完成し、デモを準備する。', fmtFrom: '最初の', fmtTo: 'バージョン',
    tblFile: 'プロジェクト計画', tblH: 'プロジェクト計画', tblP: '今週の作業：',
    tbl: [['作業', '担当者', '期限'], ['テスト', '佐藤', '金'], ['リリース', '田中', '月'], ['ドキュメント', '鈴木', '水']],
    eqFile: '代数ノート', eqH: '二次方程式', eqP: 'ax² + bx + c = 0 の解：',
    mmdFile: 'リリース手順', mmdH: 'リリース手順', mmdP: '変更をリリースするまで：', mmd: ['レビュー', '公開'],
  },
  ko: {
    file: '주간 회의', h: '주간 회의',
    p1: '이번 주 ', b: '핵심', p2: ': 첫 버전을 완성합니다.',
    tasks: ['문서 업데이트', '데모 준비'], see: '자세한 내용은 ', linkQ: '배포', link: '배포 계획',
    fmtPara: '이번 주 핵심: 첫 버전을 완성하고 데모를 준비합니다.', fmtFrom: '첫', fmtTo: '버전을',
    tblFile: '프로젝트 계획', tblH: '프로젝트 계획', tblP: '이번 주 작업:',
    tbl: [['작업', '담당자', '기한'], ['테스트', '지영', '금'], ['배포', '민수', '월'], ['문서', '서연', '수']],
    eqFile: '대수 노트', eqH: '이차방정식', eqP: 'ax² + bx + c = 0 의 해:',
    mmdFile: '배포 절차', mmdH: '배포 절차', mmdP: '변경 사항이 배포되기까지:', mmd: ['검토', '배포'],
  },
};

async function setup(rec, lang, o) {
  await rec.eval(`stage.setup(${JSON.stringify(Object.assign({ lang }, o))})`);
  await rec.wait(400);
  await rec.settle();
}
const caretAtEnd = rec => rec.eval('stage.select(stage.env.view.pm.state.doc.content.size - 1)');
const hidePointer = rec => rec.eval('stage.hideCursor()');
const tab = (rec, i) => rec.clickOn('.wm-tab', '', { index: i, ms: 450 });

export const SCENES = {
  // 輸入時自動套用格式，最後切到 Markdown 看存成的檔案
  typing: {
    async run(rec, lang) {
      const t = T[lang];
      await setup(rec, lang, { path: t.file + '.md', title: t.file, content: '', files: { [t.link + '.md']: '# ' + t.link + '\n', 'Ideas.md': '' } });
      await rec.move(560, 420, 10);
      await rec.hold(500);
      await rec.moveTo('.ProseMirror', '', { ms: 500, dy: -120 });
      await rec.click();
      await hidePointer(rec);
      await rec.keys(['#', 'Space']);
      await rec.type('# ', 140);
      await rec.keys(null);
      await rec.type(t.h, 70);
      await rec.key('Enter');
      await rec.type(t.p1, 60);
      await rec.keys(['**' + t.b + '**']);
      await rec.type('**' + t.b + '**', 80);
      await rec.hold(400);
      await rec.keys(null);
      await rec.type(t.p2, 60);
      await rec.key('Enter');
      await rec.keys(['[ ]', 'Space']);
      await rec.type('[ ] ', 110);
      await rec.hold(200);
      await rec.keys(null);
      await rec.type(t.tasks[0], 60);
      await rec.key('Enter');
      await rec.type(t.tasks[1], 60);
      await rec.key('Enter');
      await rec.key('Enter');
      await rec.type(t.see, 60);
      await rec.keys(['[[']);
      await rec.type('[[', 130);
      await rec.keys(null);
      await rec.type(t.linkQ, 120);
      await rec.hold(600);
      await rec.key('Enter', [], { show: ['Enter'], ms: 200 });
      await rec.hold(900);
      // 按檢視標題列的按鈕切到 Markdown，再切回來
      await rec.moveTo('.view-action:not(.wm-rec-back)', '', { ms: 700 });
      await rec.hold(300);
      await rec.click({ after: 300, ms: 300 });
      await rec.hold(3000);
      await rec.moveTo('.wm-rec-back', '', { ms: 200 });
      await rec.click({ after: 300, ms: 300 });
      await rec.hold(1600);
    },
  },

  // 功能區：選取文字設定格式、選顏色，再看看其他分頁
  ribbon: {
    async run(rec, lang) {
      const t = T[lang];
      await setup(rec, lang, { path: t.file + '.md', title: t.file, content: `# ${t.h}\n\n${t.fmtPara}\n\n- [ ] ${t.tasks[0]}\n- [ ] ${t.tasks[1]}\n` });
      const a = await rec.eval(`stage.coords(stage.textPos(${JSON.stringify(t.fmtFrom)}))`);
      const b = await rec.eval(`stage.coords(stage.textPos(${JSON.stringify(t.fmtTo)}) + ${t.fmtTo.length})`);
      await rec.move(620, 470, 10);
      await rec.hold(400);
      await rec.move(a.x + 1, a.y, 500);
      await rec.drag(b.x, b.y, 450);
      await rec.hold(300);
      await rec.clickOn('.wm-btn:has(.lucide-bold)', '', { ms: 200 });
      await rec.hold(400);
      await rec.clickOn('.wm-color-btn + .wm-split-arrow');
      await rec.hold(500);
      await rec.moveTo('.wm-cp-swatch', '', { index: 3, ms: 350 });
      await rec.hold(150);
      await rec.clickOn('.wm-cp-swatch', '', { index: 8, ms: 350 });
      await rec.hold(400);
      await rec.clickOn('.wm-hl-btn + .wm-split-arrow');
      await rec.hold(500);
      await rec.clickOn('.wm-cp-swatch', '', { index: 0, ms: 350 });
      await rec.hold(300);
      // 在段落後面按一下，取消選取看結果
      const end = await rec.eval(`stage.coords(stage.textPos(${JSON.stringify(t.fmtPara.slice(-1))}, 1))`);
      await rec.move(end.x + 40, end.y, 400);
      await rec.click();
      await rec.hold(1000);
      for (const i of [1, 2, 3]) { await tab(rec, i); await rec.hold(1100); }
      await tab(rec, 0);
      await rec.hold(1200);
    },
  },

  // 表格：選大小、用 Tab 輸入、從右鍵選單排序
  table: {
    height: 680,
    async run(rec, lang) {
      const t = T[lang];
      await setup(rec, lang, { path: t.tblFile + '.md', title: t.tblFile, content: `# ${t.tblH}\n\n${t.tblP}\n\n` });
      await caretAtEnd(rec);
      await rec.move(560, 450, 10);
      await rec.hold(300);
      await tab(rec, 1);
      await rec.hold(300);
      await rec.clickOn('.wm-btn:has(.lucide-table)');
      await rec.hold(300);
      for (const [r, c] of [[1, 1], [2, 2], [3, 3]]) { await rec.moveTo(`.wm-table-cell[data-r="${r}"][data-c="${c}"]`, '', { ms: 220 }); await rec.hold(120); }
      await rec.hold(300);
      await rec.click();
      await hidePointer(rec);
      await rec.hold(400);
      const cells = t.tbl.flat();
      for (let i = 0; i < cells.length; i++) {
        await rec.type(cells[i], 65);
        if (i < cells.length - 1) await rec.key('Tab', [], { show: i === 0 || i === 8 ? ['Tab'] : null, ms: 120, showMs: 300 });
      }
      await rec.hold(700);
      // 在第一欄的儲存格按右鍵，依這一欄排序
      const p = await rec.eval(`stage.coords(stage.textPos(${JSON.stringify(t.tbl[1][0])}, 1))`);
      await rec.move(p.x, p.y, 500);
      await rec.click({ button: 'right', ms: 300 });
      await rec.hold(500);
      const sortTitle = await rec.eval(`WM.t('依此欄排序')`);
      await rec.moveTo('.menu-item', sortTitle, { ms: 400 });
      await rec.hold(500);
      const asc = await rec.eval(`WM.t('依此欄排序（遞增）')`);
      await rec.moveTo('.menu .menu .menu-item, .menu-item', asc, { ms: 300 });
      await rec.hold(300);
      await rec.click({ ms: 300 });
      await hidePointer(rec);
      await rec.hold(2200);
    },
  },

  // 方程式編輯器：只用鍵盤打出一元二次方程式的解
  equation: {
    height: 820,
    async run(rec, lang) {
      const t = T[lang];
      await setup(rec, lang, { path: t.eqFile + '.md', title: t.eqFile, content: `# ${t.eqH}\n\n${t.eqP}\n\n` });
      await caretAtEnd(rec);
      await rec.move(560, 450, 10);
      await rec.hold(300);
      await tab(rec, 1);
      await rec.hold(300);
      await rec.clickOn('.wm-btn:has(.lucide-sigma)');
      await rec.wait(300);
      await rec.settle();
      await rec.hold(700);
      // 獨立一行（置中）
      await rec.clickOn('.wm-eq-top .wm-seg:not(.wm-eq-modes) button', '', { index: 1 });
      await rec.clickOn('.wm-eq-visual', '', { ms: 400 });
      await hidePointer(rec);
      await rec.hold(300);
      await rec.type('x=', 110);
      for (const [s, keys] of [['\\frac ', ['\\frac', 'Space']], ['-b', null], ['\\pm ', ['\\pm', 'Space']], ['\\sqrt ', ['\\sqrt', 'Space']], ['b', null], ['^', ['^']], ['2', null]]) {
        if (keys) await rec.keys(keys);
        await rec.type(s, 110);
        if (keys) { await rec.hold(350); await rec.keys(null); }
      }
      await rec.key('ArrowRight', [], { show: ['→'], showMs: 350 });
      await rec.type('-4ac', 110);
      await rec.key('ArrowDown', [], { show: ['↓'], showMs: 350 });
      await rec.type('2a', 110);
      await rec.wait(300);
      await rec.hold(1500);
      await rec.clickOn('.modal button.mod-cta', '', { ms: 600 });
      await rec.wait(500);
      await rec.hold(500);
      // 游標放回上面的文字，方程式才會顯示成算式（游標在旁邊時顯示原文）
      const end = await rec.eval(`stage.coords(stage.textPos(${JSON.stringify(t.eqP.slice(-1))}, 1))`);
      await rec.move(end.x + 30, end.y, 500);
      await rec.click();
      await rec.wait(500);
      await rec.settle();
      await hidePointer(rec);
      await rec.hold(2500);
    },
  },

  // 圖表編輯器：在圖上改步驟名稱、新增下一步、選底色，再插入筆記
  diagram: {
    height: 700,
    async run(rec, lang) {
      const t = T[lang];
      await setup(rec, lang, { path: t.mmdFile + '.md', title: t.mmdFile, content: `# ${t.mmdH}\n\n${t.mmdP}\n\n` });
      await caretAtEnd(rec);
      await rec.move(560, 450, 10);
      await rec.hold(300);
      await tab(rec, 1);
      await rec.hold(300);
      await rec.clickOn('.wm-btn:has(.lucide-workflow)');
      await rec.wait(800);
      await rec.settle();
      await rec.hold(900);
      // 直接在圖上把「結束」改名；先按 Enter 套用，因為小框裡的「新增下一步」不會先套用輸入框裡改到一半的文字
      await rec.clickOn('.wm-mmd-canvas .node', '', { index: 1, ms: 600 });
      await rec.hold(400);
      await rec.type(t.mmd[0], 90);
      await rec.key('Enter', [], { show: ['Enter'] });
      await rec.wait(700); await rec.settle();
      await rec.hold(500);
      // 從同一個小框新增下一步
      await rec.clickOn('.wm-mmd-canvas .node', '', { index: 1, ms: 400 });
      await rec.hold(400);
      const addNext = await rec.eval(`WM.t('新增下一步（接在這個步驟後面）')`).catch(() => 'Add next');
      await rec.clickOn('.wm-mmd-inline button', addNext, { ms: 400 });
      await rec.wait(700); await rec.settle();
      await rec.hold(400);
      await rec.type(t.mmd[1], 90);
      await rec.wait(900); await rec.settle();
      await rec.hold(600);
      // 替新的步驟選底色
      await rec.clickOn('.wm-mmd-canvas .node', '', { index: 2, ms: 500 });
      await rec.hold(300);
      await rec.clickOn('.wm-mmd-swatch', '', { index: 4, ms: 400 });
      await rec.wait(700); await rec.settle();
      await rec.hold(1000);
      await rec.clickOn('.modal button.mod-cta', '', { ms: 600 });
      await rec.wait(1200);
      await rec.settle();
      await hidePointer(rec);
      await rec.hold(2500);
    },
  },
};
