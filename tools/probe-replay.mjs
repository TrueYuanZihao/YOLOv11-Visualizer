/* 前向回放冒烟测试：时间轴 / 自动播放 / 左侧列表同步高亮 / 键盘快捷键
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
  return {
    now: document.querySelector('.rp-now b') ? document.querySelector('.rp-now b').textContent : null,
    nowBlock: document.querySelector('.rp-now') ? document.querySelector('.rp-now').textContent.replace(/\s+/g, ' ').trim() : null,
    count: document.querySelector('.rp-count') ? document.querySelector('.rp-count').textContent.trim() : null,
    selected: sel ? sel.textContent : null,
    playing: !!document.querySelector('.rp.is-playing'),
    playLabel: document.querySelector('.rp-play').textContent.trim(),
    passed: document.querySelectorAll('.pipe-item.is-passed').length,
    segs: document.querySelectorAll('.rp-seg').length,
    nowSeg: [...document.querySelectorAll('.rp-seg')].findIndex((s) => s.classList.contains('is-now')),
    speedOn: [...document.querySelectorAll('.rp-speedbtn.is-on')].map((b) => b.textContent)[0],
    arrowLeftDisabled: document.querySelectorAll('.rp-btn')[0].disabled,
    visible,
    scrollTop: left ? Math.round(left.scrollTop) : null,
  };
});

const base = await snap();
console.log('初始:', JSON.stringify(base));
console.log('时间轴段数 27 / 与列表同步 1:', base.segs, base.now === base.selected, base.count);
await page.screenshot({ path: outDir + '/replay-1-idle.png' });

/* 点第 21 段（m18）跳层 */
const seek = await page.evaluate(() => {
  const segs = [...document.querySelectorAll('.rp-seg')];
  segs[20].click();
  return segs[20].title;
});
await new Promise((r) => setTimeout(r, 900));
const afterSeek = await snap();
console.log('点时间轴跳到:', seek, '->', JSON.stringify(afterSeek));
await page.screenshot({ path: outDir + '/replay-2-seek.png' });

/* 从当前位置自动播放 */
await page.evaluate(() => document.querySelector('.rp-play').click());
await new Promise((r) => setTimeout(r, 3200));
const playing = await snap();
console.log('自动播放 3.2 秒后:', JSON.stringify(playing));
await page.screenshot({ path: outDir + '/replay-3-playing.png' });

/* 播放中手动选别的层，回放要从新位置继续 */
await page.evaluate(() => {
  const it = [...document.querySelectorAll('.pipe-item')].find((x) => x.querySelector('.pipe-id').textContent === 'm0');
  if (it) it.click();
});
await new Promise((r) => setTimeout(r, 2400));
const takeover = await snap();
console.log('播放中接管到 m0 之后:', JSON.stringify(takeover));

/* 暂停 */
await page.evaluate(() => document.querySelector('.rp-play').click());
await new Promise((r) => setTimeout(r, 400));
const paused = await snap();
console.log('暂停:', JSON.stringify({ playing: paused.playing, label: paused.playLabel, count: paused.count }));

/* 键盘：→ 一层 / ← 一层 / 空格播放 */
await page.evaluate(() => document.body.focus());
await page.keyboard.press('ArrowRight');
await new Promise((r) => setTimeout(r, 500));
const afterRight = await snap();
await page.keyboard.press('ArrowLeft');
await new Promise((r) => setTimeout(r, 500));
const afterLeft = await snap();
console.log('键盘 → 再 ←:', afterRight.count, afterRight.now, '->', afterLeft.count, afterLeft.now,
  '同步:', afterRight.now === afterRight.selected && afterLeft.now === afterLeft.selected);

/* 空格播放 / 再空格暂停 */
await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, 1500));
const bySpace = await snap();
await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, 400));
console.log('空格播放:', bySpace.playing, bySpace.playLabel, bySpace.now, '-> 停止:',
  !(await snap()).playing);

/* 2× 速度 + 走到终点自动停：先跳到倒数第二段再播 */
await page.evaluate(() => {
  [...document.querySelectorAll('.rp-speedbtn')].find((b) => b.textContent === '2×').click();
  const segs = [...document.querySelectorAll('.rp-seg')];
  segs[segs.length - 2].click();
});
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => document.querySelector('.rp-play').click());
await new Promise((r) => setTimeout(r, 2600));
const end = await snap();
console.log('2× 走到终点:', JSON.stringify(end));
await page.screenshot({ path: outDir + '/replay-4-end.png' });

/* 在终点再点播放：应当从 input 重新开始 */
await page.evaluate(() => document.querySelector('.rp-play').click());
await new Promise((r) => setTimeout(r, 700));
const restart = await snap();
await page.evaluate(() => { const b = document.querySelector('.rp-play'); if (document.querySelector('.rp.is-playing')) b.click(); });
console.log('终点再点播放 -> 回到', restart.now, '（应从 input 重新起步）:', restart.now === 'input' || restart.count === '1 / 27' || parseInt(restart.count, 10) <= 4);
await page.screenshot({ path: outDir + '/replay-5-restart.png' });

/* ⏮ 回到起点 */
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.rp-btn')];
  btns[btns.length - 1].click();
});
await new Promise((r) => setTimeout(r, 700));
const home = await snap();
console.log('回到起点:', JSON.stringify({ now: home.now, count: home.count, left: home.arrowLeftDisabled }));

/* ⏮ 之后跑到终点：左侧列表应当自动往下滚，且当前行留在可视区内 */
await page.evaluate(() => {
  const segs = [...document.querySelectorAll('.rp-seg')];
  segs[segs.length - 1].click();
});
await new Promise((r) => setTimeout(r, 1600));
const bottom = await snap();
console.log('跳到最后一层:', JSON.stringify({ now: bottom.now, count: bottom.count, scrollTop: bottom.scrollTop, visible: bottom.visible }));

/* 走过的层在左侧列表中留下痕迹 */
console.log('已走过标记:', bottom.passed, '层（应为 26）· 起点时:', home.passed, '层 · 当前行在可视区内:', bottom.visible && home.visible);

console.log('ERRORS:', errs.length ? errs.slice(0, 10).join(' | ') : 'none');
await browser.close();
