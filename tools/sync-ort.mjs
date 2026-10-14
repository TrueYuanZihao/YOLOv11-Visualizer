// 把 onnxruntime-web 的 wasm / mjs 运行时复制到 public/ort，
// 这样离线（且没有 CDN 访问）时也能正常加载推理后端。
import { cpSync, mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const dist = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const out = join(root, 'public', 'ort');

if (!existsSync(dist)) {
  console.warn('[sync-ort] onnxruntime-web not installed yet, skip');
  process.exit(0);
}
mkdirSync(out, { recursive: true });

let n = 0;
for (const f of readdirSync(dist)) {
  if (!/\.(wasm|mjs)$/.test(f)) continue;
  if (f.startsWith('ort.')) continue; // 只需要运行时，不需要打包好的 js bundle
  copyFileSync(join(dist, f), join(out, f));
  n++;
}
console.log('[sync-ort] copied ' + n + ' runtime files -> public/ort');
