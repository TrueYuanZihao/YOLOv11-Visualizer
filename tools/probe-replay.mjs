/* 前向回放冒烟测试：时间轴 / 自动播放 / 检测头阶段 / 左侧列表同步高亮 / 键盘快捷键
   用法：node tools/probe-replay.mjs [url] [outDir] */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || 'shots';
mkdirSync(outDir, { recursive: true });
const exe = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
if (!exe) { console.error('Edge not found'); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: exe, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1760, height: 1020 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 90; i++) {
  const t = await page.evaluate(() => {
    const p = document.querySelector('.topbar-right .pill:last-child');
    return p ? p.textContent : '';
  });
  if (/前向完成/.test(t)) break;
  await new Promise((r) => setTimeout(r, 1000));
}

/* 读当前状态：回放条的读数 + 左侧列表的高亮行（两者必须一致） */
const snap = () => page.evaluate(() => {
  const sel = document.querySelector('.pipe-item.is-selected .pipe-id');
  const left = document.querySelector('.col-left');
  const row = document.querySelector('.pipe-item.is-selected');
  let visible = null;
  if (left && row) {
    const a = left.getBoundingClientRect();
    const b = row.getBoundingClientRect();
    visible = b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
  }
  const segs = [...document.querySelectorAll('.rp-seg')];
  return {
    now: document.querySelector('.rp-now b') ? document.querySelector('.rp-now b').textContent : null,
    nowBlock: document.querySelector('.rp-now') ? document.querySelector('.rp-now').textContent.replace(/\s+/g, ' ').trim() : null,
    count: document.querySelector('.rp-count') ? document.querySelector('.rp-count').textContent.trim() : null,
    selected: sel ? sel.textContent : null,
    playing: !!document.querySelector('.rp.is-playing'),
    playLabel: document.querySelector('.rp-play').textContent.trim(),
    passed: document.querySelectorAll('.pipe-item.is-passed').length,
    segs: segs.length,
    headStart: segs.findIndex((s) => s.classList.contains('is-head')),
    headSegs: segs.filter((s) => s.classList.contains('is-head')).length,
    nowSeg: segs.findIndex((s) => s.classList.contains('is-now')),
    speedOn: [...document.querySelectorAll('.rp-speedbtn.is-on')].map((b) => b.textContent)[0],
    arrowLeftDisabled: document.querySelectorAll('.rp-btn')[0].disabled,
    visible,
    scrollTop: left ? Math.round(left.scrollTop) : null,
  };
});

/* 读检测头阶段的画面：横幅 / 画布 / 框的统计 / 右侧「检测结果」的框数 */
const headSnap = () => page.evaluate(() => {
  const banner = document.querySelector('.banner.head');
  const warn = document.querySelector('.tabs-info .pill.warn');
  const detTitle = [...document.querySelectorAll('.col-right .panel-title')]
    .find((x) => x.textContent.includes('检测结果'));
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
  return {
    banner: banner ? txt(banner).slice(0, 60) : null,
    tabPill: warn ? txt(warn) : null,
    multi: !!document.querySelector('.hstage.is-multi'),
    canvases: document.querySelectorAll('.hstage .agrid-canvas').length,
    caps: [...document.querySelectorAll('.hstage-cap')].map((c) => txt(c)),
    foot: txt(document.querySelector('.hstage-foot')),
    featureCanvas: !!document.querySelector('.featcanvas'),
    view2dOn: !!document.querySelector('.tab.is-on') && document.querySelector('.tab.is-on').textContent.includes('2D'),
    detTag: detTitle ? txt(detTitle.querySelector('.tag')) : null,
  };
});

const headNums = (foot) => {
  const keep = /保留 (\d+)/.exec(foot || '');
  const drop = /被压掉 (\d+)/.exec(foot || '');
  const pend = /还没轮到 (\d+)/.exec(foot || '');
  const now = /下一步判定 (\d+)/.exec(foot || '');
  const all = /共 (\d+) 个框/.exec(foot || '');
  return {
    keep: keep ? +keep[1] : null,
    drop: drop ? +drop[1] : null,
    pend: pend ? +pend[1] : null,
    now: now ? +now[1] : 0,
    all: all ? +all[1] : null,
  };
};
const clickSeg = (i) => page.evaluate((k) => { document.querySelectorAll('.rp-seg')[k].click(); }, i);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 层的阶段 ---------- */
const base = await snap();
console.log('初始:', JSON.stringify(base));
console.log('时间轴段数（27 层 + 检测头）:', base.segs, '· 检测头段:', base.headSegs, '· 从第', base.headStart + 1, '段开始');
console.log('与左侧列表同步:', base.now === base.selected, base.count);
await page.screenshot({ path: outDir + '/replay-1-idle.png' });

/* 点第 21 段（m18）跳层 */
const seekTitle = await page.evaluate(() => {
  const segs = [...document.querySelectorAll('.rp-seg')];
  segs[20].click();
  return segs[20].title;
});
await wait(900);
const afterSeek = await snap();
console.log('点时间轴跳到:', seekTitle, '->', JSON.stringify({ now: afterSeek.now, count: afterSeek.count, selected: afterSeek.selected }));
await page.screenshot({ path: outDir + '/replay-2-seek.png' });

/* 从当前位置自动播放 */
await page.evaluate(() => document.querySelector('.rp-play').click());
await wait(3200);
const playing = await snap();
console.log('自动播放 3.2 秒后:', JSON.stringify({ now: playing.now, count: playing.count, playing: playing.playing, scrollTop: playing.scrollTop }));
await page.screenshot({ path: outDir + '/replay-3-playing.png' });

/* 播放中手动选别的层，回放要从新位置继续 */
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.pipe-item')].find((x) => x.querySelector('.pipe-id').textContent === 'm0');
  if (it) it.click();
});
await wait(2400);
const takeover = await snap();
console.log('播放中接管到 m0 之后:', JSON.stringify({ now: takeover.now, count: takeover.count, playing: takeover.playing }));

/* 暂停 */
await page.evaluate(() => document.querySelector('.rp-play').click());
await wait(400);
const paused = await snap();
console.log('暂停:', JSON.stringify({ playing: paused.playing, label: paused.playLabel, count: paused.count }));

/* 键盘：→ 一层 / ← 一层 / 空格播放 */
await page.evaluate(() => document.body.focus());
await page.keyboard.press('ArrowRight');
await wait(500);
const afterRight = await snap();
await page.keyboard.press('ArrowLeft');
await wait(500);
const afterLeft = await snap();
console.log('键盘 → 再 ←:', afterRight.count, afterRight.now, '->', afterLeft.count, afterLeft.now,
  '同步:', afterRight.now === afterRight.selected && afterLeft.now === afterLeft.selected);

/* 空格播放 / 再空格暂停 */
await page.keyboard.press('Space');
await wait(1500);
const bySpace = await snap();
await page.keyboard.press('Space');
await wait(400);
console.log('空格播放:', bySpace.playing, bySpace.playLabel, bySpace.now, '-> 停止:', !(await snap()).playing);

/* ⏮ 回到起点 */
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.rp-btn')];
  btns[btns.length - 1].click();
});
await wait(700);
const home = await snap();
console.log('回到起点:', JSON.stringify({ now: home.now, count: home.count, left: home.arrowLeftDisabled }));

/* 跳到最后一层（output）：左侧列表要自动滚到底，当前行留在可视区内 */
await clickSeg(base.headStart - 1);
await wait(1600);
const lastLayer = await snap();
console.log('跳到最后一层:', JSON.stringify({ now: lastLayer.now, count: lastLayer.count, scrollTop: lastLayer.scrollTop, visible: lastLayer.visible }));
console.log('已走过标记:', lastLayer.passed, '层（应为 26）· 起点时:', home.passed, '层 · 当前行在可视区内:', lastLayer.visible && home.visible);

/* ---------- 2. 检测头阶段 ---------- */
console.log('\n-- 检测头阶段 --');
const H = base.headStart;

/* 2.1 锚点网格：三路尺度并排 */
await clickSeg(H);
await wait(1200);
const anchors = await headSnap();
const anchorsCount = await snap();
console.log('锚点网格:', JSON.stringify({ banner: anchors.banner, tabPill: anchors.tabPill, multi: anchors.multi, canvases: anchors.canvases, caps: anchors.caps }));
console.log('  · 左侧仍停在:', anchorsCount.selected, '· 走过标记:', anchorsCount.passed, '层');
await page.screenshot({ path: outDir + '/replay-6-head-anchors.png' });

/* 2.2 候选框 */
await clickSeg(H + 1);
await wait(1200);
const cand = await headSnap();
const candNums = headNums(cand.foot);
console.log('候选框:', JSON.stringify({ banner: cand.banner, multi: cand.multi, nums: candNums, detTag: cand.detTag }));
await page.screenshot({ path: outDir + '/replay-7-head-cand.png' });

/* 2.3 NMS 抑制：分几段，逐段压掉重复框 */
await clickSeg(H + 2);
await wait(1100);
const nms1 = await headSnap();
const nms1n = headNums(nms1.foot);
await clickSeg(H + base.headSegs - 2);
await wait(1100);
const nms2 = await headSnap();
const nms2n = headNums(nms2.foot);
console.log('NMS 第一段:', JSON.stringify({ banner: nms1.banner, nums: nms1n }),
  '\n           最后一段:', JSON.stringify({ banner: nms2.banner, nums: nms2n }));
console.log('  · 被压掉的框在增加:', nms2n.drop > nms1n.drop, '(', nms1n.drop, '->', nms2n.drop, ') · 总数守恒:',
  nms1n.keep + nms1n.drop + nms1n.pend + nms1n.now === nms1n.all,
  nms2n.keep + nms2n.drop + nms2n.pend + nms2n.now === nms2n.all);
await page.screenshot({ path: outDir + '/replay-8-head-nms.png' });

/* 2.4 最终输出：剩下的框 = 右侧「检测结果」里的框 */
await clickSeg(H + base.headSegs - 1);
await wait(1200);
const final = await headSnap();
const finalNums = headNums(final.foot);
const finalCount = await snap();
console.log('最终输出:', JSON.stringify({ banner: final.banner, nums: finalNums, detTag: final.detTag }));
console.log('  · 与右侧面板一致:', finalNums.keep + ' 个 vs ' + final.detTag, '· 走过标记:', finalCount.passed, '层（应为 27）');
await page.screenshot({ path: outDir + '/replay-9-head-final.png' });

/* 2.5 从最后一层自动播放：应当自己走进检测头阶段（并切回 2D） */
await page.evaluate(() => {
  [...document.querySelectorAll('.rp-speedbtn')].find((b) => b.textContent === '1×').click();
});
await clickSeg(H - 1);
await wait(600);
await page.evaluate(() => document.querySelector('.rp-play').click());
await wait(2400);
const auto = await snap();
const autoHead = await headSnap();
console.log('从 output 自动播放 2.4 秒:', JSON.stringify({ now: auto.now, count: auto.count, playing: auto.playing, inHead: autoHead.multi || autoHead.canvases > 0, view2d: autoHead.view2dOn }));
await page.screenshot({ path: outDir + '/replay-10-head-auto.png' });
await page.evaluate(() => { if (document.querySelector('.rp.is-playing')) document.querySelector('.rp-play').click(); });

/* 2.6 点标签页 = 退出检测头阶段 */
await clickSeg(H + 1);
await wait(900);
await page.evaluate(() => {
  [...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('2D 特征图')).click();
});
await wait(700);
const exited = await spotCheck();
console.log('点 2D 标签退出检测头:', JSON.stringify(exited));

/* ⏮ 之后跑到终点：走过的层应当只剩 0 */
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.rp-btn')];
  btns[btns.length - 1].click();
});
await wait(900);
const reset = await snap();
console.log('⏮ 回起点:', JSON.stringify({ now: reset.now, count: reset.count, passed: reset.passed }));
await page.screenshot({ path: outDir + '/replay-5-restart.png' });

/* 在终点（最终输出）再点播放：应当从 input 重新起步 */
await clickSeg(base.headStart + base.headSegs - 1);
await wait(700);
const beforeRestart = await snap();
await page.evaluate(() => document.querySelector('.rp-play').click());
await wait(700);
const restart = await snap();
console.log('终点（' + beforeRestart.now + '）再点播放 ->', restart.now, restart.count,
  '· 应从 input 重新起步:', restart.now === 'input' || parseInt(restart.count, 10) <= 4);
await page.evaluate(() => { if (document.querySelector('.rp.is-playing')) document.querySelector('.rp-play').click(); });

console.log('ERRORS:', errs.length ? errs.slice(0, 10).join(' | ') : 'none');
await browser.close();

async function spotCheck() {
  return page.evaluate(() => ({
    headGone: !document.querySelector('.hstage'),
    bannerGone: !document.querySelector('.banner.head'),
    feature: !!document.querySelector('.featcanvas'),
    now: document.querySelector('.rp-now b') ? document.querySelector('.rp-now b').textContent : null,
    selected: document.querySelector('.pipe-item.is-selected .pipe-id').textContent,
  }));
}
