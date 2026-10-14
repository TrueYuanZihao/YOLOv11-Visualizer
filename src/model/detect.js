/* 从 output0 [1,84,N] 解出真正的检测框：DFL 已在导出时解码完，
   这里只需要取每格最大类别分数 + 做逐类 NMS。坐标是 letterbox 后的 imgsz 像素坐标。 */

export const DEFAULTS = { conf: 0.25, iou: 0.45, maxDet: 100, preNmsTop: 300 };

function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = ix2 - ix1;
  const ih = iy2 - iy1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua > 0 ? inter / ua : 0;
}

export function decodeDetections(output, opts = {}) {
  const { conf, iou: iouThr, maxDet, preNmsTop } = { ...DEFAULTS, ...opts };
  const classNames = opts.classNames || null;
  if (!output) return [];
  const { dims, data } = output;
  if (!dims || dims.length < 3) return [];
  const ch = dims[1];
  const n = dims[2];
  const nc = ch - 4;

  const cands = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestId = -1;
    for (let c = 0; c < nc; c++) {
      const s = data[(4 + c) * n + i];
      if (s > best) { best = s; bestId = c; }
    }
    if (best < conf) continue;
    const cx = data[i];
    const cy = data[n + i];
    const w = data[2 * n + i];
    const h = data[3 * n + i];
    cands.push({
      x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2,
      score: best, classId: bestId,
    });
  }

  cands.sort((a, b) => b.score - a.score);
  if (cands.length > preNmsTop) cands.length = preNmsTop;

  const keep = [];
  const taken = new Uint8Array(cands.length);
  for (let i = 0; i < cands.length && keep.length < maxDet; i++) {
    if (taken[i]) continue;
    const a = cands[i];
    keep.push({
      ...a,
      w: a.x2 - a.x1,
      h: a.y2 - a.y1,
      className: classNames ? classNames[a.classId] || ('#' + a.classId) : String(a.classId),
    });
    for (let j = i + 1; j < cands.length; j++) {
      if (taken[j] || cands[j].classId !== a.classId) continue;
      if (iou(a, cands[j]) > iouThr) taken[j] = 1;
    }
  }
  return keep;
}

/** 统计检测结果的类别分布，给右侧面板用 */
export function classHistogram(dets) {
  const m = new Map();
  for (const d of dets) m.set(d.className, (m.get(d.className) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}