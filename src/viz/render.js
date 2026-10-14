/* 把标量场 / RGBA 缓冲渲染成 canvas 的小工具 */
import { lut } from './colormap.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** 把 0..1 的标量场按配色表写成 RGBA 像素 */
export function fillPlaneImage(out, plane, opts = {}) {
  const colormap = opts.colormap || 'viridis';
  const gamma = opts.gamma == null ? 1 : opts.gamma;
  const lo = opts.lo == null ? 0 : opts.lo;
  const hi = opts.hi == null ? 1 : opts.hi;
  const table = lut(colormap);
  const inv = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0, j = 0; i < plane.length; i++, j += 4) {
    let v = (plane[i] - lo) * inv;
    if (!(v > 0)) v = 0;
    else if (v > 1) v = 1;
    if (gamma !== 1) v = Math.pow(v, gamma);
    const k = ((v * 255) | 0) * 3;
    out[j] = table[k];
    out[j + 1] = table[k + 1];
    out[j + 2] = table[k + 2];
    out[j + 3] = 255;
  }
  return out;
}

export function planeToCanvas(plane, W, H, opts) {
  const cv = makeCanvas(W, H);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  fillPlaneImage(img.data, plane, opts);
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function rgbaToCanvas(rgba, W, H) {
  const cv = makeCanvas(W, H);
  const data = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
  cv.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
  return cv;
}