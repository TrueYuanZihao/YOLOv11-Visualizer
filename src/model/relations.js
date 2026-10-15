/* 层与层之间的关系：A/B 对比与跳连拆解的数据层。

   两条真实依据：
   1) graph.json 的连边顺序 = ONNX 算子的输入顺序（tools/export_graph.py 按
      node.input 去重保序生成），所以 Concat 的通道归属可以直接从连边顺序推出来：
      m12 的输入是 [m11(256ch), m6(128ch)] -> 通道 0..255 来自 m11、256..383 来自 m6。
   2) 一次前向已经把每个中间层的激活张量都返回了，所以下面这些函数都能算出真数：
      段内能量占比、段内通道与源层逐通道是否完全相等（Concat 是纯拷贝，理论上差值为 0）。*/

const SEP = /[×x*]/;

/** "384×20×20" -> { C, H, W }；解不出来返回 null */
export function parseShapeText(text) {
  if (!text) return null;
  const parts = String(text).split(SEP).map((t) => Number(t.trim()));
  if (parts.length !== 3 || parts.some((v) => !isFinite(v))) return null;
  return { C: parts[0], H: parts[1], W: parts[2] };
}

/** 张量 dims -> { C, H, W }（只认 4D） */
export function chwOf(tensor) {
  const d = tensor && tensor.dims;
  if (!d || d.length !== 4) return null;
  return { C: d[1], H: d[2], W: d[3] };
}

/** 进入某个节点的连边，顺序就是 ONNX 算子的输入顺序 */
export function edgesInto(graph, id) {
  return graph.edges.filter((e) => e.to === id);
}

/** 跨层跳连（rank 跨度 > 1 的边） */
export function skipEdges(graph) {
  return graph.edges.filter((e) => e.kind === 'skip');
}

/**
 * 把一个多路输入层拆成通道段。
 * ok=true 才算真的「按通道拼接」：所有输入空间尺寸相同，且通道数之和 = 输出通道数。
 * 否则给出原因（spatial = 空间尺寸不同，是并行分支不是拼接）。
 */
export function concatBreakdown(graph, id) {
  const ins = edgesInto(graph, id);
  const node = graph.nodes.find((n) => n.id === id) || null;
  const target = node ? parseShapeText(node.shape) : null;
  if (ins.length < 2) {
    return { ok: false, reason: 'single', total: target ? target.C : 0, segments: [], target, inputs: [] };
  }
  const parsed = ins.map((e) => ({ edge: e, shape: parseShapeText(e.shape) }));
  const inputs = parsed.map((p) => ({ from: p.edge.from, kind: p.edge.kind, shape: p.edge.shape }));
  if (parsed.some((p) => !p.shape)) {
    return { ok: false, reason: 'unknown', total: 0, segments: [], target, inputs };
  }
  const first = parsed[0].shape;
  const total = parsed.reduce((s, p) => s + p.shape.C, 0);
  const sameSpatial = parsed.every((p) => p.shape.H === first.H && p.shape.W === first.W);
  if (!sameSpatial) {
    return { ok: false, reason: 'spatial', total, segments: [], target, inputs };
  }
  if (target && target.C !== total) {
    return { ok: false, reason: 'mismatch', total, segments: [], target, inputs };
  }
  let start = 0;
  const segments = parsed.map((p) => {
    const seg = {
      from: p.edge.from,
      skip: p.edge.kind === 'skip',
      span: p.edge.span || 1,
      channels: p.shape.C,
      start,
      end: start + p.shape.C,
      H: p.shape.H,
      W: p.shape.W,
    };
    start = seg.end;
    return seg;
  });
  return {
    ok: true, reason: 'concat', total, segments, target, inputs,
    spatial: { H: first.H, W: first.W },
  };
}

/** 通道区间 [start, end) 的均值平面 */
export function segmentPlane(tensor, start, end) {
  const s = chwOf(tensor);
  if (!s) return null;
  const n = s.H * s.W;
  const out = new Float32Array(n);
  const lo = Math.max(0, start);
  const hi = Math.min(s.C, end);
  const k = hi - lo;
  if (k <= 0) return out;
  for (let c = lo; c < hi; c++) {
    const off = c * n;
    for (let i = 0; i < n; i++) out[i] += tensor.data[off + i];
  }
  const inv = 1 / k;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/** 通道区间 [start, end) 的 L2 能量之和（= 这一段的激活强度） */
export function segmentEnergy(tensor, start, end) {
  const s = chwOf(tensor);
  if (!s) return 0;
  const n = s.H * s.W;
  const lo = Math.max(0, start);
  const hi = Math.min(s.C, end);
  let sum = 0;
  for (let c = lo; c < hi; c++) {
    const off = c * n;
    for (let i = 0; i < n; i++) {
      const v = tensor.data[off + i];
      sum += v * v;
    }
  }
  return sum;
}

/**
 * 源层与目标层某一段通道是否逐元素完全一致（Concat 只是拷贝，这里应当为 0 差值）。
 * 要求源层通道数 = 段宽、空间尺寸相同，否则返回 comparable=false。
 */
export function compareChannelBlock(source, target, seg) {
  const a = chwOf(source);
  const b = chwOf(target);
  if (!a || !b || !seg) return { comparable: false };
  if (a.C !== seg.channels || a.H !== b.H || a.W !== b.W) return { comparable: false };
  const n = a.H * a.W;
  let maxDiff = 0;
  let sumDiff = 0;
  const count = seg.channels * n;
  for (let c = 0; c < seg.channels; c++) {
    const ao = c * n;
    const bo = (seg.start + c) * n;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(source.data[ao + i] - target.data[bo + i]);
      if (d > maxDiff) maxDiff = d;
      sumDiff += d;
    }
  }
  return {
    comparable: true, maxDiff, meanDiff: count ? sumDiff / count : 0, count,
    identical: maxDiff === 0,
  };
}

/** A -> B 的形状变化摘要（A/B 对比页右侧那几行） */
export function describePair(aShape, bShape) {
  if (!aShape || !bShape) return [];
  const cell = (s) => s.H + '×' + s.W;
  const count = (s) => s.C * s.H * s.W;
  return [
    { label: '空间分辨率', from: cell(aShape), to: cell(bShape), note: ratioNote(aShape.H, bShape.H) },
    { label: '通道数', from: String(aShape.C), to: String(bShape.C), note: deltaNote(bShape.C - aShape.C) },
    { label: '张量元素', from: fmtInt(count(aShape)), to: fmtInt(count(bShape)), note: ratioNote(count(aShape), count(bShape)) },
  ];
}

function ratioNote(from, to) {
  if (!from || !to) return '';
  const q = to / from;
  if (Math.abs(q - 1) < 1e-3) return '不变';
  if (q > 1 && Math.abs(q - Math.round(q)) < 1e-3) return '放大 ' + Math.round(q) + '×';
  const inv = 1 / q;
  if (q < 1 && Math.abs(inv - Math.round(inv)) < 1e-3) return '缩小 ' + Math.round(inv) + '×';
  return q > 1 ? '放大到 ' + q.toFixed(2) + ' 倍' : '缩小到 ' + q.toFixed(3) + ' 倍';
}

function deltaNote(d) {
  if (Math.abs(d) < 1) return '不变';
  return (d > 0 ? '+' : '') + d;
}

function fmtInt(v) {
  if (!isFinite(v)) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
}
