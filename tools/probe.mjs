/* 用 puppeteer-core 驱动本机 Edge 做端到端验证：
   收集控制台日志 / 页面异常，等待推理完成，然后按视图截图。
   用法：node tools/probe.mjs [url] [outDir] */
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const outDir = process.argv[3] || 'shots';

const candidates = [
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) { console.error('Edge not found'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1760,1020',
  ],
  defaultViewport: { width: 1760, height: 1020 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
page.on('response', (r) => {
  if (r.status() >= 400) logs.push('[http ' + r.status() + '] ' + r.url());
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

const statusOf = () => page.evaluate(() => {
  const pill = document.querySelector('.topbar-right .pill:last-child');
  const err = document.querySelector('.errbar');
  return { status: pill ? pill.textContent : '', error: err ? err.textContent : '' };
});

let ok = false;
for (let i = 0; i < 90; i++) {
  const s = await statusOf();
  if (s.error) { console.log('ERROR STATE:', s.error); break; }
  if (/前向完成|就绪|失败/.test(s.status)) { ok = true; break; }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('final status:', JSON.stringify(await statusOf()));
console.log('waited ok:', ok);

async function shot(name) {
  await page.screenshot({ path: outDir + '/' + name + '.png' });
  console.log('shot ->', name);
}

async function clickTab(label) {
  const done = await page.evaluate((lb) => {
    const b = [...document.querySelectorAll('.tab')].find((x) => x.textContent.trim() === lb);
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!done) console.log('tab not found:', label);
  await new Promise((r) => setTimeout(r, 3500));
}

await shot('probe-2d');
await clickTab('通道网格'); await shot('probe-grid');
await clickTab('3D 特征金字塔'); await shot('probe-pyramid');
await clickTab('3D 通道堆叠'); await shot('probe-channels');

const info = await page.evaluate(() => {
  const det = [...document.querySelectorAll('.det-row')].slice(0, 6).map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  const stat = [...document.querySelectorAll('.kv > div')].map((d) => d.textContent.trim());
  const foot = document.querySelector('.featcanvas-foot');
  const canvases = [...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height);
  return {
    dets: det,
    stat,
    foot: foot ? foot.textContent : '',
    canvases,
    labels: [...document.querySelectorAll('.v3d-label')].slice(0, 4).map((l) => l.textContent),
  };
});
console.log('DETS:', JSON.stringify(info.dets, null, 1));
console.log('KV:', JSON.stringify(info.stat, null, 1));
console.log('FOOT:', info.foot);
console.log('CANVAS:', JSON.stringify(info.canvases));
console.log('LABELS:', JSON.stringify(info.labels));
console.log('--- console (' + logs.length + ') ---');
console.log(logs.slice(0, 60).join('\n'));

await browser.close();