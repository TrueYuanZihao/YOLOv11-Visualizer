/* 预处理：与 ultralytics 完全一致的 letterbox + NCHW 归一化 */
export const PAD = 114;

export function letterbox(source, imgsz) {
  const scale = Math.min(imgsz / source.width, imgsz / source.height);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const dx = Math.round((imgsz - w) / 2);
  const dy = Math.round((imgsz - h) / 2);
  const cv = document.createElement('canvas');
  cv.width = imgsz; cv.height = imgsz;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgb(114,114,114)';           // ultralytics 用 114 灰边
  ctx.fillRect(0, 0, imgsz, imgsz);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, dx, dy, w, h);
  return { canvas: cv, scale, dx, dy, w, h, imgsz };
}

export function toNCHW(canvas) {
  const W = canvas.width, H = canvas.height, n = W * H;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const out = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = d[j] / 255;
    out[n + i] = d[j + 1] / 255;
    out[2 * n + i] = d[j + 2] / 255;
  }
  return { data: out, dims: [1, 3, H, W] };
}

/** 把 letterbox 坐标还原到原图坐标 */
export function unletterboxBox(b, lb) {
  const s = lb.scale;
  return {
    x1: (b.x1 - lb.dx) / s, y1: (b.y1 - lb.dy) / s,
    x2: (b.x2 - lb.dx) / s, y2: (b.y2 - lb.dy) / s,
  };
}
