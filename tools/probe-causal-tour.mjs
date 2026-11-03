/* 因果回溯 × 新手引导端到端验证：
   1. 从第 1 步开始走完 12 步引导；
   2. 第 10 步必须真实点击检测框，结构图自动打开；
   3. m16/m19/m22 三个检测头节点与上游路径必须点亮；
   4. 继续到第 11 步时结构图关闭、回溯状态清除；
   5. 最后启动回放并完成导览。 */
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const outDir = process.argv[3] || 'shots';
mkdirSync(outDir, { recursive: true });
const exe = ['C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await puppeteer.launch({
  executablePath: exe, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1760, height: 1020 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, label, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(120);
  }
  throw new Error('等待超时：' + label);
};
const clickSelector = async (sel) => {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('未找到 ' + s);
    el.click();
  }, sel);
};
const clickText = async (selector, text) => {
  const ok = await page.evaluate(({ selector, text }) => {
    const el = [...document.querySelectorAll(selector)].find((x) => x.textContent.includes(text));
    if (!el) return false;
    el.click();
    return true;
  }, { selector, text });
  if (!ok) throw new Error('未找到文本按钮：' + text);
};
const progress = () => page.$eval('.tour-progress', (e) => e.textContent.trim());
const nextEnabled = () => page.$eval('.tour-next', (e) => !e.disabled);
const clickNext = async () => {
  if (!(await nextEnabled())) throw new Error('下一步仍被禁用');
  await clickSelector('.tour-next');
  await sleep(180);
};

await page.goto(process.argv[2] || 'http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await waitFor(() => document.querySelector('.topbar-right .pill:last-child')?.textContent.includes('前向完成'), '前向完成');

await clickSelector('.guide-btn');
await waitFor(() => !!document.querySelector('.tour-card'), '引导打开');
if ((await progress()) !== '1 / 12') throw new Error('引导起始步骤错误：' + await progress());

// 1 → 2 → 3
await clickNext();
await clickNext();
if ((await progress()) !== '3 / 12') throw new Error('第 3 步未到达');
await clickSelector('[data-tour-layer="m12"]');
await waitFor(() => !document.querySelector('.tour-next')?.disabled, 'm12 点击验收');
await clickNext();

// 4：热力图 pointermove
await page.evaluate(() => {
  const el = document.querySelector('[data-tour="feature-canvas"]');
  if (!el) throw new Error('缺少 feature-canvas');
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 420, clientY: 420 }));
});
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '热力图交互验收');
await clickNext();

// 5：修改配色
await page.evaluate(() => {
  const el = document.querySelector('[data-tour="colormap"]');
  if (!el) throw new Error('缺少 colormap');
  el.value = 'turbo';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '配色修改验收');
await clickNext();

// 6：3D 金字塔
await clickText('.tab', '3D 特征金字塔');
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '3D 切换验收');
await clickNext();

// 7：结构图
await clickSelector('[data-tour="structure-open"]');
await waitFor(() => !!document.querySelector('.so'), '结构图打开');
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '结构图步骤验收');
await clickNext();

// 8：层间关系
await clickSelector('[data-tour="relations-open"]');
await waitFor(() => !!document.querySelector('.lr'), '层间关系打开');
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '层间关系步骤验收');
await clickNext();

// 9：检测头解剖
await clickSelector('[data-tour="head-open"]');
await waitFor(() => !!document.querySelector('.dh'), '检测头解剖打开');
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '检测头步骤验收');
await clickNext();

// 10：因果回溯
if ((await progress()) !== '10 / 12') throw new Error('未到因果回溯步骤：' + await progress());
await page.screenshot({ path: outDir + '/causal-tour-step10.png' });
await clickSelector('.det-row');
await waitFor(() => !!document.querySelector('.so'), '点击检测框后结构图打开');
await waitFor(() => document.querySelectorAll('.gv-node.is-trace-head').length === 3, '三路头节点高亮');
const trace = await page.evaluate(() => ({
  heads: [...document.querySelectorAll('.gv-node.is-trace-head .gv-id')].map((e) => e.textContent.trim()),
  edges: document.querySelectorAll('.gv-edge.is-trace').length,
  source: document.querySelector('.gv-node.is-trace-source .gv-id')?.textContent.trim() || null,
  progress: document.querySelector('.tour-progress')?.textContent.trim(),
  nextEnabled: !document.querySelector('.tour-next')?.disabled,
  cardHasScale: document.querySelector('.tour-body')?.textContent.includes('P3/P4/P5'),
}));
if (!trace.heads.includes('m16') || !trace.heads.includes('m19') || !trace.heads.includes('m22')) {
  throw new Error('三路头节点不完整：' + JSON.stringify(trace.heads));
}
if (!trace.source || trace.edges < 1 || !trace.nextEnabled || !trace.cardHasScale) {
  throw new Error('回溯或引导状态不完整：' + JSON.stringify(trace));
}
await page.screenshot({ path: outDir + '/causal-tour-trace.png' });

// 11：离开第 10 步必须清理结构图与回溯
await clickNext();
if ((await progress()) !== '11 / 12') throw new Error('未到回放步骤：' + await progress());
const cleaned = await page.evaluate(() => ({
  structureClosed: !document.querySelector('.so'),
  traceGone: document.querySelectorAll('.gv-node.is-trace-head').length === 0,
}));
if (!cleaned.structureClosed || !cleaned.traceGone) throw new Error('离开第 10 步后状态残留：' + JSON.stringify(cleaned));

await clickSelector('[data-tour="replay-play"]');
await waitFor(() => !document.querySelector('.tour-next')?.disabled, '回放启动验收');
await clickNext();
if ((await progress()) !== '12 / 12') throw new Error('未到完成步骤：' + await progress());
await clickNext();
await waitFor(() => !document.querySelector('.tour-card'), '完成导览');
const done = await page.evaluate(() => ({
  stored: localStorage.getItem('yolo11-guide-done') === '1',
  button: document.querySelector('.guide-btn')?.textContent.trim(),
}));

console.log('因果回溯引导:', JSON.stringify({ trace, cleaned, done }, null, 1));
console.log('ERRORS:', errs.length ? errs.slice(0, 10).join(' | ') : 'none');
await browser.close();
if (errs.length) process.exitCode = 1;
