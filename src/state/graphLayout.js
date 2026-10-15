/* 结构图布局：横向 = 真实 rank（最长路径深度），纵向 = layers.json 里的 group。
   连边全部来自 public/models/graph.json（由 ONNX 图提取），不是手画的。 */

export const NODE_W = 112;
export const NODE_H = 48;

export const GROUP_COLOR = {
  input: '#8ea0bd',
  backbone: '#4ea3ff',
  neck: '#3ee6a4',
  head: '#ffb84d',
  output: '#c78bff',
};

export const ROW_LABELS = ['骨干 Backbone', '颈部 Neck', '检测头 / 输出'];

/** 由 graph.json 算出每个节点的画布坐标 */
export function buildLayout(graph, opts = {}) {
  const colGap = opts.colGap || 134;
  const rowGap = opts.rowGap || 238;
  const padX = 56;
  const padY = 92;

  const rows = new Map();
  for (const n of graph.nodes) {
    if (!rows.has(n.row)) rows.set(n.row, []);
    rows.get(n.row).push(n);
  }

  const nodes = [];
  const rowY = [];
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    rowY[row] = padY + row * rowGap;
    const list = rows.get(row).slice().sort((a, b) => a.rank - b.rank);
    list.forEach((n, i) => {
      nodes.push({
        ...n,
        index: i,
        x: padX + i * colGap,
        y: padY + row * rowGap,
        w: NODE_W,
        h: NODE_H,
      });
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({ ...e, key: e.from + '->' + e.to }));
  const incoming = new Map();
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e.from);
  }

  const width = Math.max(...nodes.map((n) => n.x + n.w)) + padX;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + padY * 0.7;

  return { nodes, byId, edges, incoming, width, height, rowY, rowGap, padY, rowCount: rows.size, nodeW: NODE_W, nodeH: NODE_H };
}

/** 三次贝塞尔连线：同行的走左右，跨行的走上下 */
export function edgePath(a, b) {
  if (!a || !b) return null;
  const down = b.y > a.y + 4;
  let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
  if (down) {
    x1 = a.x + a.w / 2; y1 = a.y + a.h;
    x2 = b.x + b.w / 2; y2 = b.y;
    const dy = Math.max(36, (y2 - y1) * 0.45);
    c1x = x1; c1y = y1 + dy;
    c2x = x2; c2y = y2 - dy;
  } else {
    const forward = b.x >= a.x;
    x1 = forward ? a.x + a.w : a.x; y1 = a.y + a.h / 2;
    x2 = forward ? b.x : b.x + b.w; y2 = b.y + b.h / 2;
    const dx = Math.max(28, Math.abs(x2 - x1) * 0.5) * (forward ? 1 : -1);
    c1x = x1 + dx; c1y = y1;
    c2x = x2 - dx; c2y = y2;
  }
  const d = 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + x2 + ' ' + y2;
  const mx = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
  const my = (y1 + 3 * c1y + 3 * c2y + y2) / 8;
  return { d, mid: [mx, my], start: [x1, y1], end: [x2, y2] };
}

/** 反向追溯：所有能到达 id 的节点与连边（= 这一层的「上游依赖」） */
export function ancestorsOf(id, edges) {
  const nodes = new Set([id]);
  const edgeKeys = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!nodes.has(e.to) || edgeKeys.has(e.key)) continue;
      edgeKeys.add(e.key);
      if (!nodes.has(e.from)) { nodes.add(e.from); changed = true; }
    }
  }
  return { nodes, edgeKeys };
}

/** 从 id 出发能到达的节点（= 下游影响） */
export function descendantsOf(id, edges) {
  const nodes = new Set([id]);
  const edgeKeys = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!nodes.has(e.from) || edgeKeys.has(e.key)) continue;
      edgeKeys.add(e.key);
      if (!nodes.has(e.to)) { nodes.add(e.to); changed = true; }
    }
  }
  return { nodes, edgeKeys };
}

/** stride -> 特征层级标签 */
export function levelTag(stride) {
  if (stride === 8) return 'P3';
  if (stride === 16) return 'P4';
  if (stride === 32) return 'P5';
  return null;
}

/* ==========================================================================
   架构图布局（与 YOLOv8/11 官方架构图同构）
   纵向 = 特征分辨率：越往下 stride 越大（P1/2 → P5/32），所以骨干是「一路向下」。
   横向 = 处理阶段：骨干 → 颈部 FPN（自下而上，上采样）→ 颈部 PAN（自上而下，下采样）→ 检测头。
   颈部因此被画成真实的 U 形；6 条跨层跳连变成骨干指向颈部的横线，一眼看出谁融谁。
   ========================================================================== */

export const NODE_W_ARCH = 118;
export const NODE_H_ARCH = 40;

/** 按算子类型上色（参考官方架构图的配色语言） */
export const BLOCK_COLOR = {
  Input: '#8ea0bd',
  Preprocess: '#8296b3',
  Conv: '#5aa2f0',
  C3k2: '#f0b45f',
  SPPF: '#b98cf5',
  C2PSA: '#8f7bf0',
  Upsample: '#f0799a',
  Concat: '#4fd6a0',
  Detect: '#ffd166',
  Output: '#c78bff',
};

export function blockColor(block) {
  return BLOCK_COLOR[block] || '#8ea0bd';
}

export const ARCH_LANES = [
  { key: 'backbone', label: '骨干 Backbone', sub: '逐级步幅下采样' },
  { key: 'fpn', label: '颈部 · 自顶向下 (FPN)', sub: '上采样 · 语义回流' },
  { key: 'pan', label: '颈部 · 自底向上 (PAN)', sub: '下采样 · 定位回流' },
  { key: 'head', label: '检测头 Head', sub: 'P3 / P4 / P5 三尺度' },
];

/* cells = 该尺度带最多容纳几个节点；strong = 该尺度会送进检测头 */
const ARCH_BANDS = [
  { key: 'in', label: '输入', tag: '原图', stride: 0, cells: 2 },
  { key: 'p1', label: 'P1', tag: 'stride 2', stride: 2, cells: 1 },
  { key: 'p2', label: 'P2', tag: 'stride 4', stride: 4, cells: 2 },
  { key: 'p3', label: 'P3', tag: 'stride 8', stride: 8, cells: 3, strong: true },
  { key: 'p4', label: 'P4', tag: 'stride 16', stride: 16, cells: 3, strong: true },
  { key: 'p5', label: 'P5', tag: 'stride 32', stride: 32, cells: 4, strong: true },
];

/* 每条流水线里节点的归属：[节点 id, 尺度带]，顺序 = 真实的计算顺序 */
const ARCH_SLOTS = {
  backbone: [
    ['input', 'in'], ['pre', 'in'],
    ['m0', 'p1'],
    ['m1', 'p2'], ['m2', 'p2'],
    ['m3', 'p3'], ['m4', 'p3'],
    ['m5', 'p4'], ['m6', 'p4'],
    ['m7', 'p5'], ['m8', 'p5'], ['m9', 'p5'], ['m10', 'p5'],
  ],
  fpn: [
    ['m11', 'p4'], ['m12', 'p4'], ['m13', 'p4'],
    ['m14', 'p3'], ['m15', 'p3'], ['m16', 'p3'],
  ],
  pan: [
    ['m17', 'p4'], ['m18', 'p4'], ['m19', 'p4'],
    ['m20', 'p5'], ['m21', 'p5'], ['m22', 'p5'],
  ],
};

/** 由 graph.json 算出架构图坐标：{ nodes, edges, lanes, bands, width, height } */
export function buildArchLayout(graph) {
  const imgsz = (graph.meta && graph.meta.imgsz) || 320;
  const SLOT = 50;
  const BAND_GAP = 10;
  const gutter = 104;
  const padTop = 58;
  const laneW = NODE_W_ARCH + 20;
  const laneGap = 58;
  const rightPad = 26;

  /* 尺度带：高度 = 格数 × SLOT */
  const bands = [];
  let y = padTop;
  for (const b of ARCH_BANDS) {
    const h = b.cells * SLOT;
    const side = b.stride ? imgsz / b.stride : imgsz;
    bands.push({ ...b, y, h, res: side + '×' + side });
    y += h + BAND_GAP;
  }
  const bandByKey = new Map(bands.map((b) => [b.key, b]));
  const bandsTop = bands[0].y;
  const bandsBottom = bands[bands.length - 1].y + bands[bands.length - 1].h;

  /* 阶段列 */
  const lanes = ARCH_LANES.map((l, i) => ({
    ...l, x: gutter + i * (laneW + laneGap), w: laneW, y: bandsTop, h: bandsBottom - bandsTop,
  }));
  const laneByKey = new Map(lanes.map((l) => [l.key, l]));

  /* 节点 */
  const src = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = [];
  const place = (id, laneKey, bandKey, order, dir) => {
    const n = src.get(id);
    if (!n) return;
    const band = bandByKey.get(bandKey);
    const lane = laneByKey.get(laneKey);
    const row = dir === 'up' ? band.cells - order - 1 : order;
    const cy = band.y + (row + 0.5) * SLOT;
    nodes.push({
      ...n,
      lane: laneKey,
      band: bandKey,
      color: blockColor(n.block),
      x: lane.x + (lane.w - NODE_W_ARCH) / 2,
      y: cy - NODE_H_ARCH / 2,
      w: NODE_W_ARCH,
      h: NODE_H_ARCH,
    });
  };
  const counters = new Map();
  const fill = (laneKey, dir, list) => {
    for (const [id, bandKey] of list) {
      const ck = laneKey + '|' + bandKey;
      const order = counters.get(ck) || 0;
      counters.set(ck, order + 1);
      place(id, laneKey, bandKey, order, dir);
    }
  };
  fill('backbone', 'down', ARCH_SLOTS.backbone);
  fill('fpn', 'up', ARCH_SLOTS.fpn);
  fill('pan', 'down', ARCH_SLOTS.pan);

  /* 检测头：Detect 对着金字塔中部，output 挂在它下面 */
  const p4 = bandByKey.get('p4');
  const headLane = laneByKey.get('head');
  const detect = src.get('m23');
  const outNode = src.get('output');
  const center = p4.y + p4.h / 2;
  if (detect) {
    nodes.push({
      ...detect, lane: 'head', band: 'p4', color: blockColor(detect.block),
      x: headLane.x + (headLane.w - NODE_W_ARCH) / 2,
      y: center - NODE_H_ARCH / 2, w: NODE_W_ARCH, h: NODE_H_ARCH,
    });
  }
  if (outNode) {
    nodes.push({
      ...outNode, lane: 'head', band: 'p5', color: blockColor(outNode.block),
      x: headLane.x + (headLane.w - NODE_W_ARCH) / 2,
      y: center + SLOT * 1.5, w: NODE_W_ARCH, h: NODE_H_ARCH,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => ({ ...e, key: e.from + '->' + e.to }));
  const incoming = new Map();
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e.from);
  }

  const width = gutter + lanes.length * laneW + (lanes.length - 1) * laneGap + rightPad;
  const height = bandsBottom + 44;

  return {
    nodes, byId, edges, incoming, lanes, bands, gutter,
    width, height, nodeW: NODE_W_ARCH, nodeH: NODE_H_ARCH, arch: true,
    top: bandsTop,
  };
}

/** 架构图连线：同列走纵向，跨列走横向（跳连就是一条横线/短 S 弯） */
export function archEdgePath(a, b) {
  if (!a || !b) return null;
  let x1; let y1; let x2; let y2; let c1x; let c1y; let c2x; let c2y;
  if (a.lane === b.lane) {
    const down = b.y >= a.y;
    x1 = a.x + a.w / 2; y1 = down ? a.y + a.h : a.y;
    x2 = b.x + b.w / 2; y2 = down ? b.y : b.y + b.h;
    /* dy 必须 ≤ 间距的一半，否则控制点会越过端点，曲线来回摆出小尾巴 */
    const dy = Math.min(Math.abs(y2 - y1) * 0.5, 30) * (down ? 1 : -1);
    c1x = x1; c1y = y1 + dy; c2x = x2; c2y = y2 - dy;
  } else {
    const right = b.x >= a.x;
    x1 = right ? a.x + a.w : a.x; y1 = a.y + a.h / 2;
    x2 = right ? b.x : b.x + b.w; y2 = b.y + b.h / 2;
    const dx = Math.abs(x2 - x1) * 0.4 * (right ? 1 : -1);
    c1x = x1 + dx; c1y = y1; c2x = x2 - dx; c2y = y2;
  }
  const d = 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + x2 + ' ' + y2;
  const mx = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
  const my = (y1 + 3 * c1y + 3 * c2y + y2) / 8;
  return { d, mid: [mx, my], start: [x1, y1], end: [x2, y2] };
}