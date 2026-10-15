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