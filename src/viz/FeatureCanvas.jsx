/* 2D 特征图查看器：把任意中间层张量画成可交互的热力图
   - 单通道 / 通道均值 / 通道最大 / L2 / PCA 三通道合成 / 原图 RGB
   - 可叠加原图、画出检测框
   - 鼠标悬停探测某个像素的真实激活值 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  shapeOf, extractChannel, reduceChannels, planeRange, normalizePlane,
  layerStats, pcaComposite,
} from './field.js';
import { planeToCanvas, rgbaToCanvas } from './render.js';
import { lut } from './colormap.js';

function buildRgb(data, C, H, W, gamma) {
  const n = H * W;
  const rgba = new Uint8ClampedArray(n * 4);
  const planes = [];
  for (let c = 0; c < 3; c++) {
    const plane = extractChannel(data, C, H, W, c);
    const { lo, hi } = planeRange(plane, 'p1p99');
    planes.push(normalizePlane(plane, lo, hi));
  }
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      let v = planes[c][i];
      if (gamma !== 1) v = Math.pow(v, gamma);
      rgba[i * 4 + c] = (v * 255) | 0;
    }
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export default function FeatureCanvas(props) {
  const {
    tensor, layerId, mapMode, channel, colormap, gamma, rangeMode,
    overlay, showBoxes, dets, imgsz, inputCanvas, version,
  } = props;

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState(480);
  const [probe, setProbe] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth || 480;
      setSize(Math.max(180, Math.min(w, (window.innerHeight || 900) - 250)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const shape = useMemo(() => (tensor ? shapeOf(tensor.dims) : { C: 0, H: 0, W: 0 }), [tensor]);

  const built = useMemo(() => {
    if (!tensor || !shape.C) return null;
    const { C, H, W } = shape;
    if (mapMode === 'pca') {
      const { rgba, variance } = pcaComposite(tensor.data, C, H, W, { gamma });
      return { canvas: rgbaToCanvas(rgba, W, H), plane: null, lo: 0, hi: 1, variance };
    }
    if (mapMode === 'rgb') {
      const rgba = buildRgb(tensor.data, C, H, W, gamma);
      return { canvas: rgbaToCanvas(rgba, W, H), plane: null, lo: 0, hi: 1 };
    }
    const plane = mapMode === 'channel'
      ? extractChannel(tensor.data, C, H, W, Math.min(channel, C - 1))
      : reduceChannels(tensor.data, C, H, W, mapMode);
    const { lo, hi } = planeRange(plane, rangeMode);
    const norm = normalizePlane(plane, lo, hi);
    return { canvas: planeToCanvas(norm, W, H, { colormap, gamma, lo: 0, hi: 1 }), plane, lo, hi };
  }, [tensor, shape, mapMode, channel, colormap, gamma, rangeMode]);

  const stats = useMemo(() => {
    if (!tensor) return null;
    if (mapMode === 'channel') return layerStats(extractChannel(tensor.data, shape.C, shape.H, shape.W, Math.min(channel, shape.C - 1)));
    return layerStats(tensor.data);
  }, [tensor, shape, mapMode, channel]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    cv.width = px;
    cv.height = px;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#080b12';
    ctx.fillRect(0, 0, px, px);
    if (!built) {
      ctx.fillStyle = '#46506a';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('等待推理结果…', px / 2, px / 2);
      return;
    }
    ctx.drawImage(built.canvas, 0, 0, px, px);
    if (overlay && inputCanvas) {
      ctx.globalAlpha = 0.38;
      ctx.drawImage(inputCanvas, 0, 0, px, px);
      ctx.globalAlpha = 1;
    }
    if (showBoxes && dets && dets.length && imgsz) {
      const s = px / imgsz;
      ctx.lineWidth = Math.max(1.2, px / 320);
      ctx.font = Math.max(10, px / 34) + 'px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      for (const d of dets) {
        ctx.strokeStyle = 'rgba(120,255,190,0.95)';
        ctx.strokeRect(d.x1 * s, d.y1 * s, (d.x2 - d.x1) * s, (d.y2 - d.y1) * s);
        const label = d.className + ' ' + d.score.toFixed(2);
        const tw = ctx.measureText(label).width + 6;
        const ty = Math.max(10, d.y1 * s);
        ctx.fillStyle = 'rgba(10,30,24,0.82)';
        ctx.fillRect(d.x1 * s, ty - Math.max(10, px / 34) - 2, tw, Math.max(10, px / 34) + 2);
        ctx.fillStyle = '#8affd0';
        ctx.fillText(label, d.x1 * s + 3, ty);
      }
    }
  }, [built, overlay, showBoxes, dets, imgsz, size, inputCanvas, tensor]);

  /* 色标图例：把当前配色 + 伽马映射成一条渐变，两端标出真实数值 */
  const legend = useMemo(() => {
    if (!built || !built.plane) return null;
    const table = lut(colormap);
    const stops = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const v = gamma !== 1 ? Math.pow(t, gamma) : t;
      const k = Math.min(255, Math.round(v * 255)) * 3;
      stops.push('rgb(' + table[k] + ',' + table[k + 1] + ',' + table[k + 2] + ') ' + (t * 100).toFixed(0) + '%');
    }
    return 'linear-gradient(90deg,' + stops.join(',') + ')';
  }, [built, colormap, gamma]);

  const onMove = (ev) => {
    if (!built || !built.plane) { setProbe(null); return; }
    const rect = ev.currentTarget.getBoundingClientRect();
    const W = shape.W;
    const H = shape.H;
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * W);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * H);
    if (x < 0 || y < 0 || x >= W || y >= H) { setProbe(null); return; }
    setProbe({ x, y, value: built.plane[y * W + x] });
  };

  return (
    <div className="featcanvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="featcanvas-canvas"
        style={{ width: size, height: size }}
        onMouseMove={onMove}
        onMouseLeave={() => setProbe(null)}
      />
      {legend ? (
        <div className="legend" title="颜色与激活值的对应关系">
          <span>{fmt(built.lo)}</span>
          <i style={{ background: legend }} />
          <span>{fmt(built.hi)}</span>
        </div>
      ) : null}
      <div className="featcanvas-foot">
        {lastInfo(layerId, mapMode, channel, shape, built, stats)}
        {probe ? (
          <span className="probe">
            像素 ({probe.x}, {probe.y}) = <b>{probe.value.toFixed(4)}</b>
          </span>
        ) : (
          <span className="probe dim">鼠标移到图上可读取激活值</span>
        )}
      </div>
    </div>
  );
}

function lastInfo(layerId, mapMode, channel, shape, built, stats) {
  const parts = [];
  if (layerId) parts.push('层 ' + layerId);
  parts.push(shape.C + '×' + shape.H + '×' + shape.W);
  if (mapMode === 'channel') parts.push('通道 ch' + channel);
  else if (mapMode === 'pca') parts.push('PCA 三通道合成');
  else if (mapMode === 'rgb') parts.push('原图 RGB');
  else if (mapMode === 'mean') parts.push('通道均值');
  else if (mapMode === 'max') parts.push('通道最大');
  else if (mapMode === 'l2') parts.push('通道 L2');
  else if (mapMode === 'abs') parts.push('通道 |均值|');
  if (built && built.plane) parts.push('显示区间 [' + fmt(built.lo) + ', ' + fmt(built.hi) + ']');
  if (built && built.variance) {
    parts.push('主成分方差占比 ' + built.variance.map((v) => (v * 100).toFixed(0) + '%').join(' / '));
  }
  if (stats) parts.push('均值 ' + fmt(stats.mean) + ' · 最大 ' + fmt(stats.max));
  return <span className="meta">{parts.join('  ·  ')}</span>;
}

function fmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1000)) return v.toExponential(2);
  return v.toFixed(3);
}