/* 逐层冒烟测试：点选 input / pre / m0 / m12 / output，检查各自的渲染与统计 */
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
for (const id of ['input', 'pre', 'm0', 'm12', 'm22', 'output']) {
  await page.evaluate((x) => {
    const b = [...document.querySelectorAll('.pipe-item')].find((el) => el.querySelector('.pipe-id').textContent === x);
    if (b) b.click();
  }, id);
  await new Promise((r) => setTimeout(r, 1200));
  const info = await page.evaluate(() => {
    const foot = document.querySelector('.featcanvas-foot .meta');
    const legend = document.querySelector('.legend');
    const banner = document.querySelector('.banner');
    const kv = [...document.querySelectorAll('.kv > div')].map((d) => d.textContent.trim());
    return {
      foot: foot ? foot.textContent : '(none)',
      legend: legend ? legend.textContent : '(none)',
      banner: banner ? 'yes' : 'no',
      shape: (kv[0] || '').replace('张量形状', ''),
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });
  console.log(id, '=>', JSON.stringify(info));
  await page.screenshot({ path: outDir + '/layer-' + id + '.png' });
}
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await browser.close();