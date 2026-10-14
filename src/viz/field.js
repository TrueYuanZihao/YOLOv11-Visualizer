/* 特征图（标量场）工具：形状解析、通道能量排序、百分位归一化、
   以及把 C 通道张量压成一张 RGB 的 PCA 合成（幂迭代 + deflate，不建 C×C 矩阵）。 */

export function shapeOf(dims) {
  if (!dims || dims.length < 4) return { C: 1, H: 1, W: 1, N: 1 };
  const N = dims[0] || 1;
  const C = dims[1] || 1;
  const H = dims[2] || 1;
  const W = dims[3] || 1;
  return { C, H, W, N };
}

export function layerStats(data) {
  let min = Infinity, max = -Infinity, s = 0, s2 = 0, pos = 0;
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    s += v;
    s2 += v * v;
    if (v > 0) pos++;
  }
  const d = n || 1;
  const mean = s / d;
  const varc = Math.max(0, s2 / d - mean * mean);
  return {
    min: n ? min : 0,
    max: n ? max : 0,
    mean,
    std: Math.sqrt(varc),
    rms: Math.sqrt(s2 / d),
    active: pos / d,
    count: n,
  };
}

/** 每个通道的 RMS 能量，用来挑「最活跃的通道」 */
export function channelEnergy(data, C, H, W) {
  const n = H * W;
  const out = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    const off = c * n;
    let s = 0;
    for (let i = 0; i < n; i++) { const v = data[off + i]; s += v * v; }
    out[c] = Math.sqrt(s / n);
  }
  return out;
}

export function topChannels(energy, k) {
  const idx = Array.from(energy.keys());
  idx.sort((a, b) => energy[b] - energy[a]);
  return idx.slice(0, Math.min(k, idx.length));
}

export function extractChannel(data, C, H, W, c) {
  const n = H * W;
  const out = new Float32Array(n);
  const off = ((c % C) + C) % C * n;
  out.set(data.subarray(off, off + n));
  return out;
}

export function reduceChannels(data, C, H, W, mode) {
  const n = H * W;
  const out = new Float32Array(n);
  if (mode === 'max') {
    out.fill(-Infinity);
    for (let c = 0; c < C; c++) {
      const off = c * n;
      for (let i = 0; i < n; i++) { const v = data[off + i]; if (v > out[i]) out[i] = v; }
    }
    for (let i = 0; i < n; i++) if (!isFinite(out[i])) out[i] = 0;
  } else if (mode === 'l2') {
    for (let c = 0; c < C; c++) {
      const off = c * n;
      for (let i = 0; i < n; i++) { const v = data[off + i]; out[i] += v * v; }
    }
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i] / C);
  } else if (mode === 'abs') {
    for (let c = 0; c < C; c++) {
      const off = c * n;
      for (let i = 0; i < n; i++) out[i] += Math.abs(data[off + i]);
    }
    for (let i = 0; i < n; i++) out[i] /= C;
  } else {
    for (let c = 0; c < C; c++) {
      const off = c * n;
      for (let i = 0; i < n; i++) out[i] += data[off + i];
    }
    for (let i = 0; i < n; i++) out[i] /= C;
  }
  return out;
}

/** 按百分位求显示区间，避免极少数离群值把整张图压平 */
export function planeRange(plane, mode) {
  if (mode === 'minmax') {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { lo, hi };
  }
  const p = mode === 'p2p98' ? [0.02, 0.98] : mode === 'p0p999' ? [0, 0.999] : [0.01, 0.99];
  const sorted = Float32Array.from(plane).sort();
  const lo = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p[0]))];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p[1]) - 1 < 0 ? 0 : Math.floor(sorted.length * p[1]))];
  return { lo, hi: hi > lo ? hi : lo + 1e-6 };
}

export function normalizePlane(src, lo, hi) {
  const out = new Float32Array(src.length);
  const inv = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < src.length; i++) {
    const v = (src[i] - lo) * inv;
    out[i] = v <= 0 ? 0 : v >= 1 ? 1 : v;
  }
  return out;
}

/* ---------------- PCA 合成：C 通道 -> RGB ---------------- */

function sampleIndices(n, maxSamples) {
  const stride = Math.max(1, Math.floor(n / maxSamples));
  const out = [];
  for (let i = 0; i < n; i += stride) out.push(i);
  return out;
}

/**
 * 把 [C,H,W] 张量压成一张 RGB：
 * 每个像素看成 C 维向量 -> 通道维 PCA 取前 3 个主成分 -> 归一化到 RGB。
 * 用采样估计均值/方差 + 幂迭代求特征向量，复杂度 O(n*C)。
 */
export function pcaComposite(data, C, H, W, opts = {}) {
  const n = H * W;
  const rgba = new Uint8ClampedArray(n * 4);
  const iters = opts.iters || 24;
  const maxSamples = opts.maxSamples || 2048;

  if (C <= 3) {
    // 本来就少于 3 通道，直接当 RGB/灰度
    for (let i = 0; i < n; i++) {
      const r = C >= 1 ? data[i] : 0;
      const g = C >= 2 ? data[n + i] : r;
      const b = C >= 3 ? data[2 * n + i] : r;
      rgba[i * 4] = clamp255(r * 255);
      rgba[i * 4 + 1] = clamp255(g * 255);
      rgba[i * 4 + 2] = clamp255(b * 255);
      rgba[i * 4 + 3] = 255;
    }
    return { rgba, comps: [], variance: [], C, H, W };
  }

  const samples = sampleIndices(n, maxSamples);
  const S = samples.length;

  const mu = new Float32Array(C);
  for (let s = 0; s < S; s++) {
    const p = samples[s];
    for (let c = 0; c < C; c++) mu[c] += data[c * n + p];
  }
  for (let c = 0; c < C; c++) mu[c] /= S;

  const inv = new Float32Array(C);
  {
    const sd = new Float32Array(C);
    for (let s = 0; s < S; s++) {
      const p = samples[s];
      for (let c = 0; c < C; c++) { const d = data[c * n + p] - mu[c]; sd[c] += d * d; }
    }
    for (let c = 0; c < C; c++) inv[c] = 1 / (Math.sqrt(sd[c] / S) || 1);
  }

  const tmp = new Float32Array(S);
  // out = X^T X u / S（X 已标准化），返回 ||out||^2（≈ 特征值）
  const covApply = (u, out) => {
    for (let s = 0; s < S; s++) {
      const p = samples[s];
      let acc = 0;
      for (let c = 0; c < C; c++) acc += (data[c * n + p] - mu[c]) * inv[c] * u[c];
      tmp[s] = acc;
    }
    out.fill(0);
    for (let s = 0; s < S; s++) {
      const p = samples[s];
      const t = tmp[s];
      for (let c = 0; c < C; c++) out[c] += (data[c * n + p] - mu[c]) * inv[c] * t;
    }
    let sum = 0;
    for (let c = 0; c < C; c++) sum += out[c] * out[c];
    const len = Math.sqrt(sum) || 1;
    for (let c = 0; c < C; c++) out[c] /= len;
    return sum / S;
  };

  const comps = [];
  const variance = [];
  const K = 3;
  for (let k = 0; k < K; k++) {
    let u = new Float32Array(C);
    for (let c = 0; c < C; c++) u[c] = Math.sin(1.7 * (k + 1) * (c + 1)) + Math.cos(0.9 * (c + 1));
    norm(u);
    let lam = 0;
    const v = new Float32Array(C);
    for (let it = 0; it < iters; it++) {
      lam = covApply(u, v);
      // 对已求出的主成分做正交化（deflation）
      for (const prev of comps) {
        let dot = 0;
        for (let c = 0; c < C; c++) dot += v[c] * prev[c];
        for (let c = 0; c < C; c++) v[c] -= dot * prev[c];
      }
      norm(v);
      u.set(v);
    }
    comps.push(u);
    variance.push(lam);
  }

  // 把所有像素投影到 3 个主成分上
  const proj = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let k = 0; k < 3; k++) {
    const v = comps[k];
    const pk = proj[k];
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let c = 0; c < C; c++) acc += (data[c * n + i] - mu[c]) * inv[c] * v[c];
      pk[i] = acc;
    }
  }

  const g = opts.gamma || 1;
  const scales = proj.map((pk, k) => {
    const sorted = Float32Array.from(pk).sort();
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    return { lo, hi: hi > lo ? hi : lo + 1e-6 };
  });

  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const { lo, hi } = scales[k];
      let t = (proj[k][i] - lo) / (hi - lo);
      t = t <= 0 ? 0 : t >= 1 ? 1 : t;
      if (g !== 1) t = Math.pow(t, g);
      rgba[i * 4 + k] = (t * 255) | 0;
    }
    rgba[i * 4 + 3] = 255;
  }
  const total = variance.reduce((a, b) => a + b, 0) || 1;
  return { rgba, comps, variance: variance.map((v) => v / total), C, H, W };
}

function norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = 1 / (Math.sqrt(s) || 1);
  for (let i = 0; i < v.length; i++) v[i] *= inv;
}

function clamp255(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
}