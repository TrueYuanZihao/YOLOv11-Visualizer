/* 层间关系冒烟测试：A/B 对比 + 跳连拆解
   用法：node tools/probe-relations.mjs [url] [outDir]
   除了点得动，还会校验两条真数据：
   - 探针不变量：同一块图像区域在两层里的格点下标必须差整数倍（m10 10×10 / m11 20×20 -> 2 倍）
   - Concat 不变量：目标层里来自源层的那一段通道，逐通道差值必须为 0 */
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

const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.topbar-mid .btn')].find((x) => x.textContent.includes('层间关系'));
  if (!b) return false;
  b.click();
  return true;
});
await new Promise((r) => setTimeout(r, 1800));
console.log('打开层间关系:', opened, await page.evaluate(() => !!document.querySelector('.lr')));

const head = await page.evaluate(() => ({
  pills: [...document.querySelectorAll('.lr-title .pill')].map((p) => p.textContent.trim()),
  stage: document.querySelector('.lr-stagebar h3').textContent,
  stageDesc: document.querySelector('.lr-stagebar p').textContent,
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
  canvases: [...document.querySelectorAll('.ab-frame canvas')].map((c) => c.width + 'x' + c.height),
  foot: document.querySelector('.lr-foot').textContent.replace(/\s+/g, ' ').trim(),
  presets: [...document.querySelectorAll('.lr-preset')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
}));
console.log('A/B:', JSON.stringify(head, null, 1));
await page.screenshot({ path: outDir + '/rel-1-ab.png' });

/* 探针：同一块图像区域 -> 两层的格点下标必须成整数倍 */
const probeHits = [];
for (const [fx, fy] of [[0.22, 0.31], [0.55, 0.62], [0.81, 0.18], [0.4, 0.85]]) {
  await page.evaluate((x, y) => {
    const cv = document.querySelectorAll('.ab-frame canvas')[0];
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: r.x + r.width * x, clientY: r.y + r.height * y,
    }));
  }, fx, fy);
  await new Promise((r) => setTimeout(r, 240));
  const got = await page.evaluate(() => {
    const txt = [...document.querySelectorAll('.ab-probe-item')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
    const cells = txt.map((t) => {
      const m = /\((\d+), (\d+)\)/.exec(t);
      const v = /=\s*([-\d.e+]+)/.exec(t);
      return m ? { cx: +m[1], cy: +m[2], value: v ? +v[1] : null } : null;
    });
    return { txt, cells };
  });
  if (got.cells.length === 2 && got.cells[0] && got.cells[1]) {
    const a = got.cells[0];
    const b = got.cells[1];
    probeHits.push({
      a: a.cx + ',' + a.cy, b: b.cx + ',' + b.cy,
      ok: (b.cx === a.cx * 2 || b.cx === a.cx * 2 + 1) && (b.cy === a.cy * 2 || b.cy === a.cy * 2 + 1),
      dv: a.value != null && b.value != null ? Math.abs(a.value - b.value) : null,
      same: a.value != null && b.value != null ? Math.abs(a.value - b.value) < 1e-6 : null,
    });
  } else {
    probeHits.push({ ok: false, why: 'no probe', txt: got.txt });
  }
}
console.log('探针不变量（m10 -> m11 应差 2 倍）:', JSON.stringify(probeHits));
console.log('格点倍数通过:', probeHits.filter((p) => p.ok).length + ' / ' + probeHits.length);
console.log('数值一致（Upsample 不改变数值）通过:',
  probeHits.filter((p) => p.same === true).length + ' / ' + probeHits.length);
await page.screenshot({ path: outDir + '/rel-2-probe.png' });

/* 缩放联动 */
const beforeZoom = await page.evaluate(() => document.querySelector('.ab-zoom').textContent);
await page.evaluate(() => {
  const cv = document.querySelectorAll('.ab-frame canvas')[0];
  const r = cv.getBoundingClientRect();
  cv.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaY: -260,
    clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
  }));
});
await new Promise((r) => setTimeout(r, 500));
const afterZoom = await page.evaluate(() => document.querySelector('.ab-zoom').textContent);
console.log('滚轮缩放:', beforeZoom, '->', afterZoom);
await page.screenshot({ path: outDir + '/rel-3-zoom.png' });

/* 从右图悬停：两块画布必须同时响应 */
const canvasCount = await page.evaluate(() => {
  const cvs = [...document.querySelectorAll('.ab-frame canvas')];
  const r = cvs[1].getBoundingClientRect();
  cvs[1].dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, clientX: r.x + r.width * 0.63, clientY: r.y + r.height * 0.27,
  }));
  return cvs.length;
});
await new Promise((r) => setTimeout(r, 320));
const bothRead = await page.evaluate(() => ({
  probe: [...document.querySelectorAll('.ab-probe-item')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
  cells: [...document.querySelectorAll('.ab-cell')].map((n) => n.textContent.trim()),
}));
console.log('从右图悬停（画布数 ' + canvasCount + '）:', JSON.stringify(bothRead));
await page.screenshot({ path: outDir + '/rel-3b-hover-b.png' });

/* 预设：切到 Concat 前后 */
const preset = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.lr-preset')].find((x) => x.textContent.includes('m11') && x.textContent.includes('m12'));
  if (!b) return null;
  b.click();
  return b.textContent.replace(/\s+/g, ' ').trim();
});
await new Promise((r) => setTimeout(r, 1400));
const clip = await page.evaluate(() => {
  const kv = [...document.querySelectorAll('.lr-detail .kv > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim());
  const box = [...document.querySelectorAll('.lr-detail input[type=checkbox]')][0];
  if (box && !box.checked) box.click();
  return { kv, foot: document.querySelector('.lr-foot').textContent.replace(/\s+/g, ' ').trim() };
});
await new Promise((r) => setTimeout(r, 1400));
const clipAfter = await page.evaluate(() => ({
  kv: [...document.querySelectorAll('.lr-detail .kv > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
  note: [...document.querySelectorAll('.lr-detail .panel-desc')].map((p) => p.textContent.trim()).slice(-1)[0],
}));
console.log('预设 + 只取源段:', preset, JSON.stringify({ ...clip, after: clipAfter }, null, 1));
await page.screenshot({ path: outDir + '/rel-4-concat-clip.png' });

/* 跳连拆解 */
await page.evaluate(() => {
  [...document.querySelectorAll('.lr-head-right .so-segbtn')].find((b) => b.textContent.includes('跳连')).click();
});
await new Promise((r) => setTimeout(r, 1600));
const skip = await page.evaluate(() => ({
  stage: document.querySelector('.lr-stagebar h3').textContent,
  rows: [...document.querySelectorAll('.lr-skiprow')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
  segbar: [...document.querySelectorAll('.lr-seg')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
  kv: [...document.querySelectorAll('.lr-detail .kv > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
  notes: [...document.querySelectorAll('.lr-detail .panel-desc')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
  foot: document.querySelector('.lr-foot').textContent.replace(/\s+/g, ' ').trim(),
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
}));
console.log('跳连拆解:', JSON.stringify(skip, null, 1));
await page.screenshot({ path: outDir + '/rel-5-skip.png' });

/* 点第一个通道段：源层应当从当前跳连的源换成该段的来源 */
const segPick = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.lr-seg')];
  const idx = btns.length > 1 ? 1 : 0;
  btns[idx].click();
  return btns[idx].textContent.replace(/\s+/g, ' ').trim();
});
await new Promise((r) => setTimeout(r, 1400));
const segAfter = await page.evaluate(() => ({
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
  kv: [...document.querySelectorAll('.lr-detail .kv > div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
  verify: [...document.querySelectorAll('.lr-detail .panel-desc')].map((p) => p.textContent.trim()).slice(-1)[0],
}));
console.log('切换通道段:', segPick, JSON.stringify(segAfter, null, 1));
await page.screenshot({ path: outDir + '/rel-6-segment.png' });

/* 选一条「汇入检测头」的跳连：拆不出通道段，但要说清楚 */
const headSkip = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.lr-skiprow')].find((x) => x.textContent.includes('m23'));
  if (!b) return null;
  b.click();
  return b.textContent.replace(/\s+/g, ' ').trim();
});
await new Promise((r) => setTimeout(r, 1500));
const headSkipAfter = await page.evaluate(() => ({
  notes: [...document.querySelectorAll('.lr-detail .panel-desc')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
  empty: [...document.querySelectorAll('.ab-empty')].map((p) => p.textContent.trim()),
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
}));
console.log('汇入检测头的跳连:', headSkip, JSON.stringify(headSkipAfter, null, 1));
await page.screenshot({ path: outDir + '/rel-7-head-skip.png' });

/* 回到一条能拆的跳连，试「只看其余通道」 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.lr-skiprow')].find((x) => x.textContent.includes('m12'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1200));
const restPick = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.lr-detail .seg-btn')].find((x) => x.textContent.includes('其余'));
  if (!b) return null;
  b.click();
  return b.textContent.trim();
});
await new Promise((r) => setTimeout(r, 1200));
const restAfter = await page.evaluate(() => ({
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
  foot: document.querySelector('.lr-foot').textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('只看其余通道:', restPick, JSON.stringify(restAfter));
await page.screenshot({ path: outDir + '/rel-7b-rest.png' });

/* A/B 看一组「浅层 vs 深层」：分辨率差 8 倍，格点网格最密 */
await page.evaluate(() => {
  [...document.querySelectorAll('.lr-head-right .so-segbtn')].find((b) => b.textContent.includes('A/B')).click();
});
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.lr-preset')].find((x) => x.textContent.includes('m2') && x.textContent.includes('m22'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1500));
const deep = await page.evaluate(() => ({
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
  foot: document.querySelector('.lr-foot').textContent.replace(/\s+/g, ' ').trim(),
  canvases: [...document.querySelectorAll('.ab-frame canvas')].map((c) => c.width + 'x' + c.height),
}));
console.log('浅层 vs 深层:', JSON.stringify(deep, null, 1));
await page.screenshot({ path: outDir + '/rel-7c-deep.png' });

/* Esc 关闭 */
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 700));
console.log('Esc 关闭:', !(await page.evaluate(() => !!document.querySelector('.lr'))));

/* 入口 2：结构图里的「拆解」 */
await page.evaluate(() => {
  [...document.querySelectorAll('.topbar-mid .btn')].find((b) => b.textContent.includes('网络结构图')).click();
});
await new Promise((r) => setTimeout(r, 2000));
const dissect = await page.evaluate(() => {
  const b = document.querySelector('.so-skip-dissect');
  if (!b) return false;
  b.click();
  return true;
});
await new Promise((r) => setTimeout(r, 1800));
const viaGraph = await page.evaluate(() => ({
  lr: !!document.querySelector('.lr'),
  so: !!document.querySelector('.so'),
  stage: document.querySelector('.lr-stagebar h3') ? document.querySelector('.lr-stagebar h3').textContent : null,
}));
console.log('从结构图拆解:', dissect, JSON.stringify(viaGraph));
await page.screenshot({ path: outDir + '/rel-8-from-graph.png' });

/* 入口 3：中间视口里拼接层的横幅 */
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 700));
const viaBanner = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.pipe-item')];
  const m12 = items.find((x) => x.querySelector('.pipe-id') && x.querySelector('.pipe-id').textContent === 'm12');
  if (!m12) return null;
  m12.click();
  return true;
});
await new Promise((r) => setTimeout(r, 900));
const banner = await page.evaluate(() => {
  const b = document.querySelector('.banner.concat');
  if (!b) return null;
  const text = b.textContent.replace(/\s+/g, ' ').trim();
  const btn = b.querySelector('.banner-cta');
  if (btn) btn.click();
  return text;
});
await new Promise((r) => setTimeout(r, 1800));
const bannerAfter = await page.evaluate(() => ({
  lr: !!document.querySelector('.lr'),
  stage: document.querySelector('.lr-stagebar h3') ? document.querySelector('.lr-stagebar h3').textContent : null,
  panes: [...document.querySelectorAll('.ab-pane')].map((p) => p.querySelector('.ab-pane-head').textContent.replace(/\s+/g, ' ').trim()),
}));
console.log('从拼接层横幅进入:', viaBanner, banner, JSON.stringify(bannerAfter));
await page.screenshot({ path: outDir + '/rel-9-from-banner.png' });

console.log('ERRORS:', errs.length ? errs.slice(0, 10).join(' | ') : 'none');
await browser.close();
