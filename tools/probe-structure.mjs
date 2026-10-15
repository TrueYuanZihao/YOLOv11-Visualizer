/* 结构图冒烟测试：打开结构图 -> 检查节点/连边 -> 点击节点 -> 校验中间视图是否跟着切换 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
const outDir = process.argv[3] || 'shots';
mkdirSync(outDir, { recursive: true });
const exe = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1760, height: 1020 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

await page.goto(process.argv[2] || 'http://localhost:5173/', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 60; i++) {
  const t = await page.evaluate(() => { const p = document.querySelector('.topbar-right .pill:last-child'); return p ? p.textContent : ''; });
  if (/前向完成/.test(t)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('推理就绪');

const listHint = await page.evaluate(() =>
  [...document.querySelectorAll('.pipe-in')].map((e) => e.textContent.trim()));
console.log('左侧列表的跳连提示:', JSON.stringify(listHint));

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.btn')].find((x) => x.textContent.includes('网络结构图'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const stats = await page.evaluate(() => ({
  open: !!document.querySelector('.so'),
  nodes: document.querySelectorAll('.gv-node').length,
  edges: document.querySelectorAll('.gv-edge').length,
  skipEdges: document.querySelectorAll('.gv-edge.is-skip').length,
  rowLabels: [...document.querySelectorAll('.gv-rowlabel')].map((t) => t.textContent),
  skips: [...document.querySelectorAll('.so-skip')].map((t) => t.textContent.replace(/\s+/g, ' ').trim()),
  detailTitle: document.querySelector('.so-node-head') ? document.querySelector('.so-node-head').textContent.replace(/\s+/g, ' ').trim() : null,
  hasPreview: !!document.querySelector('.so-preview img'),
  zoom: document.querySelector('.graph-zoom') ? document.querySelector('.graph-zoom').textContent : null,
}));
console.log('结构图:', JSON.stringify(stats, null, 1));
await page.screenshot({ path: outDir + '/structure-open.png' });

// 点击 m12（颈部 Concat，两路输入）
const clicked = await page.evaluate(() => {
  const g = document.querySelector('[data-node-id="m12"]');
  if (!g) return false;
  const r = g.getBoundingClientRect();
  const ev = (type, opts) => g.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0, pointerId: 1, ...opts }));
  ev('pointerdown'); ev('pointerup');
  return true;
});
await new Promise((r) => setTimeout(r, 1600));
const after = await page.evaluate(() => ({
  clicked: !!document.querySelector('.gv-node.is-selected'),
  selectedId: document.querySelector('.gv-node.is-selected') ? document.querySelector('.gv-node.is-selected').getAttribute('data-node-id') : null,
  hotNodes: document.querySelectorAll('.gv-node.is-hot').length,
  hotEdges: document.querySelectorAll('.gv-edge.is-hot').length,
  detail: document.querySelector('.so-node-head') ? document.querySelector('.so-node-head').textContent.replace(/\s+/g, ' ').trim() : null,
  inputs: [...document.querySelectorAll('.so-links')][0] ? [...document.querySelectorAll('.so-links')][0].textContent.replace(/\s+/g, ' ').trim() : null,
}));
console.log('点击 m12 之后:', JSON.stringify(after, null, 1));
await page.screenshot({ path: outDir + '/structure-m12.png' });

// 预览源切换：PCA / 单通道 / 均值 应渲染出不同的图像
const srcs = {};
for (const [label, key] of [['PCA', 'pca'], ['单通道', 'channel'], ['均值', 'mean']]) {
  await page.evaluate((lb) => {
    const b = [...document.querySelectorAll('.so-segbtn')].find((x) => x.textContent.trim() === lb);
    if (b) b.click();
  }, label);
  await new Promise((r) => setTimeout(r, 800));
  srcs[key] = await page.evaluate(() => {
    const i = document.querySelector('.so-preview img');
    const on = document.querySelector('.so-segbtn.is-on');
    return { src: i ? i.src : '', on: on ? on.textContent.trim() : null };
  });
}
console.log('预览源切换:', JSON.stringify({
  distinct: new Set(Object.values(srcs).map((s) => s.src)).size,
  len: Object.fromEntries(Object.entries(srcs).map(([k, v]) => [k, v.src.length])),
  active: Object.fromEntries(Object.entries(srcs).map(([k, v]) => [k, v.on])),
}));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.so-segbtn')].find((x) => x.textContent.trim() === 'PCA');
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 600));

// 节点拖动：拖 m16 应产生偏移（且不改变选中层），点「适应」后复位
const dragBefore = await page.evaluate(() => {
  const g = document.querySelector('[data-node-id="m16"]');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const fire = (type, x, y) => g.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', isPrimary: true,
  }));
  fire('pointerdown', cx, cy);
  fire('pointermove', cx + 80, cy - 50);
  fire('pointermove', cx + 120, cy - 70);
  fire('pointerup', cx + 120, cy - 70);
  return g.getAttribute('transform');
});
await new Promise((r) => setTimeout(r, 400));
const dragAfter = await page.evaluate(() => {
  const g = document.querySelector('[data-node-id="m16"]');
  const sel = document.querySelector('.gv-node.is-selected');
  return { t: g ? g.getAttribute('transform') : null, sel: sel ? sel.getAttribute('data-node-id') : null };
});
console.log('节点拖动 m16:', JSON.stringify({
  moved: dragBefore !== dragAfter.t,
  stillSelected: dragAfter.sel,
}));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.graph-tools button')].find((x) => x.textContent.includes('适应'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 500));
const dragReset = await page.evaluate(() => {
  const g = document.querySelector('[data-node-id="m16"]');
  return g ? g.getAttribute('transform') : null;
});
console.log('「适应」复位:', JSON.stringify({ back: dragReset === dragBefore }));

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.so-detail .btn')].find((x) => x.textContent.includes('回中间'));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1400));
const closed = await page.evaluate(() => ({
  overlayGone: !document.querySelector('.so'),
  middleLayer: document.querySelector('.featcanvas-foot .meta') ? document.querySelector('.featcanvas-foot .meta').textContent.slice(0, 40) : null,
  selectedInList: document.querySelector('.pipe-item.is-selected') ? document.querySelector('.pipe-item.is-selected .pipe-id').textContent : null,
}));
console.log('关闭之后:', JSON.stringify(closed, null, 1));
await page.screenshot({ path: outDir + '/structure-after.png' });

console.log('ERRORS:', errs.length ? errs.slice(0, 8).join(' | ') : 'none');
await browser.close();