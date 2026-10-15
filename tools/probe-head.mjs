/* 检测头解剖冒烟测试：打开浮层 -> 逐步切换四个阶段 -> 点格点 -> NMS 回放 -> 校验数据自洽
   用法：node tools/probe-head.mjs [url] [outDir] */
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
for (let i = 0; i < 60; i++) {
  const t = await page.evaluate(() => {
    const p = document.querySelector('.topbar-right .pill:last-child');
    return p ? p.textContent : '';
  });
  if (/前向完成/.test(t)) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.topbar-mid .btn')].find((x) => x.textContent.includes('检测头解剖'));
  if (!b) return false;
  b.click();
  return true;
});
console.log('打开浮层:', opened);
await new Promise((r) => setTimeout(r, 2200));

const head = await page.evaluate(() => ({
  open: !!document.querySelector('.dh'),
  pills: [...document.querySelectorAll('.dh-title .pill')].map((p) => p.textContent.trim()),
  steps: [...document.querySelectorAll('.dh-step')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
  funnel: document.querySelector('.dh-funnel') ? document.querySelector('.dh-funnel').textContent.replace(/\s+/g, ' ').trim() : null,
  cards: [...document.querySelectorAll('.dh-bcard')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  canvases: [...document.querySelectorAll('.agrid-canvas')].map((c) => c.width + 'x' + c.height),
}));
console.log('浮层:', JSON.stringify(head, null, 1));
await page.screenshot({ path: outDir + '/head-1-branches.png' });

const goStage = async (idx) => {
  await page.evaluate((i) => { document.querySelectorAll('.dh-step')[i].click(); }, idx);
  await new Promise((r) => setTimeout(r, 1600));
};

/* 第 2 步：锚点网格 —— 点一个格点，看右侧读数 */
await goStage(1);
const gridInfo = await page.evaluate(() => {
  const cv = document.querySelector('.agrid-canvas');
  if (!cv) return null;
  const r = cv.getBoundingClientRect();
  const ev = (type, x, y) => cv.dispatchEvent(new MouseEvent(type, {
    bubbles: true, clientX: r.x + x, clientY: r.y + y,
  }));
  ev('mousemove', r.width * 0.42, r.height * 0.55);
  ev('click', r.width * 0.42, r.height * 0.55);
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
await new Promise((r) => setTimeout(r, 900));
const anchor = await page.evaluate(() => ({
  tag: document.querySelector('.dh-side .panel .tag') ? document.querySelector('.dh-side .panel .tag').textContent : null,
  kv: [...document.querySelectorAll('.dh-side .kv > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
  classes: [...document.querySelectorAll('.dh-side .chan-row')].slice(0, 3).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  fate: document.querySelector('.dh-fate') ? document.querySelector('.dh-fate').textContent.trim() : null,
  legend: document.querySelector('.agrid .legend') ? document.querySelector('.agrid .legend').textContent.trim() : null,
}));
console.log('点击格点:', JSON.stringify({ canvas: gridInfo, ...anchor }, null, 1));
await page.screenshot({ path: outDir + '/head-2-anchors.png' });

/* 选一个「指定类概率」 */
const clsPicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.dh-side .chan-row')];
  if (rows.length < 2) return null;
  rows[1].click();
  return rows[1].textContent.replace(/\s+/g, ' ').trim();
});
await new Promise((r) => setTimeout(r, 1200));
console.log('切到指定类:', clsPicked);
await page.screenshot({ path: outDir + '/head-2b-class.png' });

/* 映射自洽性：逐尺度点若干格点，用面板上的真实读数断言
   |cx - 格点中心| <= 半个框宽（因为 cx = 格点中心 + (右距 - 左距) / 2，而左右距都落在框内）。
   如果 output0 的拼接顺序或行优先展平搞错了，这条不变量几乎必然被打破。 */
const invariant = [];
for (const scaleIdx of [0, 1, 2]) {
  await page.evaluate((i) => { document.querySelectorAll('.dh-side .seg-btn')[i].click(); }, scaleIdx);
  await new Promise((r) => setTimeout(r, 700));
  for (const [fx, fy] of [[0.12, 0.12], [0.5, 0.5], [0.85, 0.3], [0.3, 0.8]]) {
    await page.evaluate((x, y) => {
      const cv = document.querySelector('.agrid-canvas');
      const r = cv.getBoundingClientRect();
      const ev = (type) => cv.dispatchEvent(new MouseEvent(type, {
        bubbles: true, clientX: r.x + r.width * x, clientY: r.y + r.height * y,
      }));
      ev('mousemove'); ev('click');
    }, fx, fy);
    await new Promise((r) => setTimeout(r, 260));
    const vals = await page.evaluate(() => {
      const txt = [...document.querySelectorAll('.dh-side .kv > div')].map((d) => d.textContent).join('|');
      const pos = /\((\d+), (\d+)\) \/ (\d+)×/.exec(txt);
      const c = /中心 cx, cy([-\d.e]+), ([-\d.e]+)/.exec(txt);
      const wh = /宽高 w, h([-\d.e]+) × ([-\d.e]+)/.exec(txt);
      const sc = /stride (\d+)/.exec(txt);
      if (!pos || !c || !wh || !sc) return null;
      return {
        gx: +pos[1], gy: +pos[2], stride: +sc[1],
        cx: +c[1], cy: +c[2], w: +wh[1], h: +wh[2],
      };
    });
    if (!vals) { invariant.push({ scaleIdx, ok: false, why: 'no readout' }); continue; }
    const ax = (vals.gx + 0.5) * vals.stride;
    const ay = (vals.gy + 0.5) * vals.stride;
    invariant.push({
      scale: 'P' + (scaleIdx + 1),
      cell: vals.gx + ',' + vals.gy,
      dx: +(vals.cx - ax).toFixed(1),
      halfW: +(vals.w / 2).toFixed(1),
      dy: +(vals.cy - ay).toFixed(1),
      halfH: +(vals.h / 2).toFixed(1),
      ok: Math.abs(vals.cx - ax) <= vals.w / 2 + 0.6 && Math.abs(vals.cy - ay) <= vals.h / 2 + 0.6,
    });
  }
}
console.log('格点映射不变量:', JSON.stringify(invariant));
console.log('不变量通过:', invariant.filter((v) => v.ok).length + ' / ' + invariant.length);

/* 第 3 步：置信度筛选 */
await goStage(2);
const filter = await page.evaluate(() => ({
  kv: [...document.querySelectorAll('.dh-side .kv > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
  rows: [...document.querySelectorAll('.dh-side .dh-detbtn')].slice(0, 4).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  funnel: document.querySelector('.dh-funnel').textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('置信度筛选:', JSON.stringify(filter, null, 1));
await page.screenshot({ path: outDir + '/head-3-filter.png' });

/* 第 4 步：NMS 回放 */
await goStage(3);
const nms0 = await page.evaluate(() => ({
  tag: document.querySelector('.dh-side .panel-title .tag').textContent,
  log0: document.querySelectorAll('.dh-logrow').length,
}));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dh-nmsctl .btn')].find((x) => x.textContent.includes('下一步'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: outDir + '/head-4a-nms-step1.png' });
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dh-nmsctl .btn')].find((x) => x.textContent.includes('下一步'));
  if (b) { b.click(); b.click(); }
});
await new Promise((r) => setTimeout(r, 700));
const nms1 = await page.evaluate(() => ({
  hint: [...document.querySelectorAll('.dh-side .ctl-hint')].pop().textContent,
  log: [...document.querySelectorAll('.dh-logrow')].slice(0, 4).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  nowRows: document.querySelectorAll('.dh-logrow.is-now').length,
  heatmapHidden: !document.querySelector('.agrid .legend'),
}));
console.log('NMS:', JSON.stringify({ ...nms0, after: nms1 }, null, 1));
await page.screenshot({ path: outDir + '/head-4-nms.png' });

/* 自动播放几帧 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dh-nmsctl .btn')].find((x) => x.textContent.includes('自动播放'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2600));
const playing = await page.evaluate(() => ({
  hint: [...document.querySelectorAll('.dh-side .ctl-hint')].pop().textContent,
  paused: [...document.querySelectorAll('.dh-nmsctl .btn')].some((b) => b.textContent.includes('暂停')),
}));
console.log('自动播放:', JSON.stringify(playing));
await page.screenshot({ path: outDir + '/head-4b-nms-play.png' });

/* 「回中间看 m23」应关闭浮层并选中 m23 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.dh-head-right .btn')].find((x) => x.textContent.includes('回中间'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1200));
const closed = await page.evaluate(() => ({
  overlayGone: !document.querySelector('.dh'),
  selected: document.querySelector('.pipe-item.is-selected') ? document.querySelector('.pipe-item.is-selected .pipe-id').textContent : null,
  banner: document.querySelector('.banner') ? document.querySelector('.banner').textContent.replace(/\s+/g, ' ').trim().slice(-40) : null,
}));
console.log('关闭后:', JSON.stringify(closed, null, 1));
await page.screenshot({ path: outDir + '/head-5-back.png' });

/* 检测头那一层里的入口按钮 */
const viaLayer = await page.evaluate(() => {
  const b = document.querySelector('.banner .banner-cta');
  if (!b) return false;
  b.click();
  return true;
});
await new Promise((r) => setTimeout(r, 1500));
console.log('从检测头层再打开:', viaLayer, await page.evaluate(() => !!document.querySelector('.dh')));

console.log('ERRORS:', errs.length ? errs.slice(0, 10).join(' | ') : 'none');
await browser.close();
