/* 检测头解剖：把 output0 的 [1, 84, N] 还原成「三个尺度的锚点网格」。

   检测头输出的不是图像，而是 N 个格点的预测：每个格点 4 个框回归量 + 80 个类别分数。
   但光看这个数字向量说明不了任何问题 —— 得知道每个格点落在哪张特征图的哪个位置、
   对应原图多大一块区域。这个模块负责这层换算，供「检测头解剖」页面使用。 */

/** 检测头的三路输入：颈部交给检测头的 P3 / P4 / P5 特征图（见 graph.json 的 m23 入边）。 */
export const HEAD_INPUTS = [
  { id: 'm16', scale: 'P3', stride: 8 },
  { id: 'm19', scale: 'P4', stride: 16 },
  { id: 'm22', scale: 'P5', stride: 32 },
];

/** 每条分支的通道构成：4 个框回归量 + 80 个类别分数 = 84。 */
export const BOX_CHANNELS = 4;
export const DFL_BINS = 16;

/**
 * 三个尺度的网格表。offset 是该尺度在 output0 最后一维里的起始下标：
 * ultralytics 按 P3 → P4 → P5 拼接，同一尺度内按行优先展平（k = gy * gw + gx）。
 */
export function scaleGrids(imgsz) {
  const out = [];
  let offset = 0;
  for (const h of HEAD_INPUTS) {
    const g = Math.max(1, Math.round(imgsz / h.stride));
    out.push({ ...h, gw: g, gh: g, count: g * g, offset });
    offset += g * g;
  }
  return out;
}

/** 全局格点下标 -> { 属于哪个尺度, 网格坐标 }；越界返回 null。 */
export function anchorAt(grids, index) {
  for (let s = 0; s < grids.length; s++) {
    const g = grids[s];
    if (index >= g.offset && index < g.offset + g.count) {
      const k = index - g.offset;
      return { scale: s, gx: k % g.gw, gy: Math.floor(k / g.gw), grid: g };
    }
  }
  return null;
}

/** 把「全格点的一维数组」切成某个尺度的那一段（subarray，不复制）。 */
export function sliceGrid(plane, grid) {
  return plane.subarray(grid.offset, grid.offset + grid.count);
}

/**
 * 扫一遍整个输出，得到两张表：
 *   bestScore / bestClass —— 每个格点分数最高的那个类（「锚点网格」默认就按它着色）；
 *   classMax   / classArg —— 每个类在所有格点上的最大值及其位置（右侧类别排行）。
 * 2100 × 80 = 16.8 万次比较，一次几毫秒，改阈值不用重算。
 */
export function analyzeOutput(output, imgsz, classNames) {
  const grids = scaleGrids(imgsz);
  if (!output || !output.dims || output.dims.length < 3) {
    return { grids, n: 0, nc: 0, bestScore: null, bestClass: null, classMax: null, ranked: [] };
  }
  const n = output.dims[2];
  const nc = output.dims[1] - BOX_CHANNELS;
  const data = output.data;

  const bestScore = new Float32Array(n);
  const bestClass = new Int16Array(n);
  const classMax = new Float32Array(nc);
  const classArg = new Int32Array(nc);

  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestId = -1;
    for (let c = 0; c < nc; c++) {
      const s = data[(BOX_CHANNELS + c) * n + i];
      if (s > best) { best = s; bestId = c; }
      if (s > classMax[c]) { classMax[c] = s; classArg[c] = i; }
    }
    bestScore[i] = best;
    bestClass[i] = bestId;
  }

  const name = (c) => (classNames ? classNames[c] || '#' + c : '#' + c);
  const ranked = Array.from({ length: nc }, (_, c) => c)
    .map((c) => ({ id: c, name: name(c), max: classMax[c], anchor: classArg[c] }))
    .sort((a, b) => b.max - a.max);

  return { grids, n, nc, bestScore, bestClass, classMax, classArg, ranked };
}

/** 某一类在所有格点上的分数：在 output0 里本来就是连续的一段，直接取视图。 */
export function classPlane(output, c) {
  const n = output.dims[2];
  const off = (BOX_CHANNELS + c) * n;
  return output.data.subarray(off, off + n);
}

/** 单个格点的完整读数：4 个几何量 + 按分数排好序的 80 个类别分数。 */
export function anchorDetail(output, index, classNames, topK = 8) {
  const n = output.dims[2];
  const nc = output.dims[1] - BOX_CHANNELS;
  const d = output.data;
  const name = (c) => (classNames ? classNames[c] || '#' + c : '#' + c);

  const scores = [];
  for (let c = 0; c < nc; c++) scores.push({ id: c, name: name(c), p: d[(BOX_CHANNELS + c) * n + index] });
  scores.sort((a, b) => b.p - a.p);

  return {
    cx: d[index],
    cy: d[n + index],
    w: d[2 * n + index],
    h: d[3 * n + index],
    top: scores.slice(0, topK),
    best: scores[0],
  };
}
