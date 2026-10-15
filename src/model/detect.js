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
  const classNames = opts.classNames || null;
  if (!output) return [];
  const { cands } = decodeCandidates(output, opts);
  if (!cands.length) return [];
  const { keep } = nmsTrace(cands, opts);
  return keep.map((i) => {
    const a = cands[i];
    return {
      ...a,
      w: a.x2 - a.x1,
      h: a.y2 - a.y1,
      className: classNames ? classNames[a.classId] || ('#' + a.classId) : String(a.classId),
    };
  });
}

/** 第一步：把 [1,84,N] 铺回「每格一个预测」。
    DFL 已经在导出时解码过，所以每格的 4 个数值就是 (cx, cy, w, h)；
    剩下的 80 个是类别分数（sigmoid 之后）。按分数降序、取前 preNmsTop 个。
    检测头解剖页面直接复用这一步，保证和界面上显示的框是同一份数据。 */
export function decodeCandidates(output, opts = {}) {
  const { conf, preNmsTop } = { ...DEFAULTS, ...opts };
  if (!output) return { nc: 0, n: 0, cands: [] };
  const { dims, data } = output;
  if (!dims || dims.length < 3) return { nc: 0, n: 0, cands: [] };
  const n = dims[2];
  const nc = dims[1] - 4;

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
      anchor: i,
      cx, cy, w, h,
      x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2,
      score: best, classId: bestId,
    });
  }

  cands.sort((a, b) => b.score - a.score);
  if (cands.length > preNmsTop) cands.length = preNmsTop;
  return { nc, n, cands };
}

/** 第二步：逐类 NMS，并记下「谁被谁压掉」。
    keep 是保留候选在 cands 里的下标；by[j] 是压掉候选项 j 的候选项下标（-1 = 没被压掉）；
    log 按抑制顺序记录每一步保留了谁、压掉了哪几个 —— 解剖页面的回放就靠它。 */
export function nmsTrace(cands, opts = {}) {
  const { iou: iouThr, maxDet } = { ...DEFAULTS, ...opts };
  const keep = [];
  const taken = new Uint8Array(cands.length);
  const by = new Int32Array(cands.length).fill(-1);
  const log = [];

  for (let i = 0; i < cands.length && keep.length < maxDet; i++) {
    if (taken[i]) continue;
    const a = cands[i];
    const kills = [];
    for (let j = i + 1; j < cands.length; j++) {
      if (taken[j] || cands[j].classId !== a.classId) continue;
      if (iou(a, cands[j]) > iouThr) { taken[j] = 1; by[j] = i; kills.push(j); }
    }
    keep.push(i);
    log.push({ keep: i, kills });
  }
  return { keep, by, log };
}

/** 统计检测结果的类别分布，给右侧面板用 */
export function classHistogram(dets) {
  const m = new Map();
  for (const d of dets) m.set(d.className, (m.get(d.className) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}
