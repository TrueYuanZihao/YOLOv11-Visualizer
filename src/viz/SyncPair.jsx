/* A/B 双联画布：两块画布共用同一套缩放 / 平移 / 探针。

   坐标系固定在 letterbox 之后的输入图空间（imgsz × imgsz），
   所以 20×20 和 40×40 的特征图并排时，看到的是「同一块图像区域的不同采样密度」——
   鼠标停在任意位置，两块画布同时报出各自格点的真实激活值。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractChannel, reduceChannels, planeRange, normalizePlane, pcaComposite,
} from './field.js';
import { planeToCanvas, rgbaToCanvas } from './render.js';
import { lut } from './colormap.js';
import { segmentPlane } from '../model/relations.js';

const MIN_K = 0.4;
const MAX_K = 26;

export default function SyncPair(props) {
  const {
    items, imgsz, inputCanvas, colormap, gamma, rangeMode,
    sharedRange, showGrid, showImage, maxHeight, version,
  } = props;

  const wrapRef = useRef(null);
  const paneRefs = useRef([]);
  const dragRef = useRef(null);
  const sizeRef = useRef(0);
  const [paneSize, setPaneSize] = useState(400);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [probe, setProbe] = useState(null);
  const [dragging, setDragging] = useState(false);

  /* ---------- 尺寸：两块方形画布并排，不超过可视高度 ---------- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth || 800;
      const cap = maxHeight || (window.innerHeight || 900);
      const next = Math.max(180, Math.min(Math.floor((w - 14) / 2), cap));
      setPaneSize(next);
      const prev = sizeRef.current;
      sizeRef.current = next;
      setView((v) => {
        if (!prev) {
          const k = Math.max(MIN_K, Math.min(MAX_K, (next - 4) / imgsz));
          return { k, x: (next - imgsz * k) / 2, y: (next - imgsz * k) / 2 };
        }
        const r = next / prev;
        return { k: v.k * r, x: v.x * r, y: v.y * r };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [imgsz, maxHeight]);

  /* ---------- 平面与配色：先算原始平面，再决定色标区间 ---------- */
  const raw = useMemo(
    () => items.map((it) => buildPlane(it, { gamma })),
    [items, gamma, version],
  );
  const ranges = useMemo(
    () => raw.map((r) => (r && r.plane ? planeRange(r.plane, rangeMode) : null)),
    [raw, rangeMode],
  );
  const used = useMemo(() => {
    if (!sharedRange) return ranges;
    const valid = ranges.filter(Boolean);
    if (!valid.length) return ranges;
    const lo = Math.min(...valid.map((r) => r.lo));
    const hi = Math.max(...valid.map((r) => r.hi));
    return ranges.map((r) => (r ? { lo, hi } : null));
  }, [ranges, sharedRange]);
  const panes = useMemo(
    () => raw.map((r, i) => {
      if (!r) return null;
      const rg = used[i] || { lo: 0, hi: 1 };
      const canvas = r.rgb
        ? r.canvas
        : planeToCanvas(normalizePlane(r.plane, rg.lo, rg.hi), r.W, r.H, {
          colormap, gamma, lo: 0, hi: 1,
        });
      return { ...r, lo: rg.lo, hi: rg.hi, canvas };
    }),
    [raw, used, colormap, gamma],
  );

  /* ---------- 交互：探针 / 平移 / 缩放 ---------- */
  const panePoint = (ev, i) => {
    const cv = paneRefs.current[i];
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const scale = paneSize ? rect.width / paneSize : 1;
    return { x: (ev.clientX - rect.left) / scale, y: (ev.clientY - rect.top) / scale };
  };

  const toImageUnit = (pt) => {
    if (!pt) return null;
    const ix = (pt.x - view.x) / view.k;
    const iy = (pt.y - view.y) / view.k;
    if (ix < 0 || iy < 0 || ix > imgsz || iy > imgsz) return null;
    return { u: ix / imgsz, v: iy / imgsz };
  };

  const onPointerDown = (i) => (ev) => {
    if (ev.button !== 0) return;
    const cv = paneRefs.current[i];
    try { cv.setPointerCapture(ev.pointerId); } catch (err) { /* noop */ }
    dragRef.current = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: 0 };
  };

  const onPointerMove = (i) => (ev) => {
    const d = dragRef.current;
    if (d) {
      const dx = ev.clientX - d.sx;
      const dy = ev.clientY - d.sy;
      d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
      setDragging(true);
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
      return;
    }
    setProbe(toImageUnit(panePoint(ev, i)));
  };

  const onPointerUp = (ev) => {
    try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch (err) { /* noop */ }
    dragRef.current = null;
    setDragging(false);
  };

  useEffect(() => {
    const nodes = paneRefs.current.filter(Boolean);
    const onWheel = (ev) => {
      ev.preventDefault();
      const rect = ev.currentTarget.getBoundingClientRect();
      const scale = paneSize ? rect.width / paneSize : 1;
      const px = (ev.clientX - rect.left) / scale;
      const py = (ev.clientY - rect.top) / scale;
      setView((v) => {
        const k = Math.max(MIN_K, Math.min(MAX_K, v.k * Math.exp(-ev.deltaY * 0.0014)));
        const r = k / v.k;
        return { k, x: px - (px - v.x) * r, y: py - (py - v.y) * r };
      });
    };
    for (const n of nodes) n.addEventListener('wheel', onWheel, { passive: false });
    return () => { for (const n of nodes) n.removeEventListener('wheel', onWheel); };
  }, [paneSize, panes.length]);

  const fit = () => {
    const k = Math.max(MIN_K, Math.min(MAX_K, (paneSize - 4) / imgsz));
    setView({ k, x: (paneSize - imgsz * k) / 2, y: (paneSize - imgsz * k) / 2 });
  };
  const zoomBy = (f) => setView((v) => {
    const k = Math.max(MIN_K, Math.min(MAX_K, v.k * f));
    const r = k / v.k;
    return { k, x: paneSize / 2 - (paneSize / 2 - v.x) * r, y: paneSize / 2 - (paneSize / 2 - v.y) * r };
  });

  /* ---------- 绘制 ---------- */
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(paneSize * dpr);
    for (let i = 0; i < 2; i++) {
      const cv = paneRefs.current[i];
      if (!cv) continue;
      if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
      const ctx = cv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#080b12';
      ctx.fillRect(0, 0, px, px);
      const p = panes[i];
      if (!p) continue;
      ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(p.canvas, 0, 0, imgsz, imgsz);
      if (showImage && inputCanvas) {
        ctx.globalAlpha = 0.34;
        ctx.drawImage(inputCanvas, 0, 0, imgsz, imgsz);
        ctx.globalAlpha = 1;
      }
      if (showGrid) {
        const step = imgsz / p.W;
        ctx.lineWidth = Math.max(0.6 / view.k, 0.35);
        ctx.strokeStyle = 'rgba(150,180,225,0.26)';
        ctx.beginPath();
        for (let x = 0; x <= p.W; x++) { const gx = x * step; ctx.moveTo(gx, 0); ctx.lineTo(gx, imgsz); }
        for (let y = 0; y <= p.H; y++) { const gy = y * step; ctx.moveTo(0, gy); ctx.lineTo(imgsz, gy); }
        ctx.stroke();
      }
      if (probe) {
        const gx = Math.min(p.W - 1, Math.floor(probe.u * p.W));
        const gy = Math.min(p.H - 1, Math.floor(probe.v * p.H));
        const step = imgsz / p.W;
        ctx.lineWidth = Math.max(1 / view.k, 0.6);
        ctx.strokeStyle = 'rgba(62,230,164,0.9)';
        ctx.strokeRect(gx * step, gy * step, step, step);
        ctx.strokeStyle = 'rgba(62,230,164,0.42)';
        ctx.beginPath();
        ctx.moveTo((gx + 0.5) * step, 0); ctx.lineTo((gx + 0.5) * step, imgsz);
        ctx.moveTo(0, (gy + 0.5) * step); ctx.lineTo(imgsz, (gy + 0.5) * step);
        ctx.stroke();
      }
    }
  }, [panes, view, paneSize, probe, showGrid, showImage, inputCanvas, imgsz]);

  const readouts = useMemo(
    () => items.map((it, i) => probeOf(panes[i], probe)),
    [items, panes, probe],
  );

  return (
    <div className="ab">
      <div className="ab-tools">
        <button type="button" onClick={() => zoomBy(1.3)} title="放大">＋</button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} title="缩小">－</button>
        <button type="button" onClick={fit} title="适应窗口">适应</button>
        <span className="ab-zoom">{Math.round(view.k * 100)}%</span>
        <span className="ab-sync">两块画布共用同一套缩放与平移</span>
      </div>

      <div className={'ab-pair' + (dragging ? ' is-drag' : '')} ref={wrapRef}
        onPointerLeave={() => setProbe(null)}>
        {items.map((it, i) => (
          <div className="ab-pane" key={it.key || i}>
            <div className="ab-pane-head">
              {it.color ? <span className="ab-swatch" style={{ background: it.color }} /> : null}
              <b>{it.label}</b>
              {it.tag ? <span className="tag">{it.tag}</span> : null}
              <span className="ab-pane-sub">{it.sub || ''}</span>
            </div>

            <div className="ab-frame" style={{ width: paneSize, height: paneSize }}>
              <canvas
                ref={(el) => { paneRefs.current[i] = el; }}
                style={{ width: paneSize, height: paneSize }}
                onPointerDown={onPointerDown(i)}
                onPointerMove={onPointerMove(i)}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              {!panes[i] ? <span className="ab-empty">{it.empty || '这一层没有图像网格'}</span> : null}
              {panes[i] && readouts[i] ? (
                <span className="ab-cell">格点 ({readouts[i].cx}, {readouts[i].cy})</span>
              ) : null}
            </div>

            <div className="ab-pane-foot">
              {panes[i] ? (
                <>
                  <span className="legend">
                    <span>{fmt(panes[i].lo)}</span>
                    <i style={{ background: gradientOf(colormap, gamma) }} />
                    <span>{fmt(panes[i].hi)}</span>
                  </span>
                  <span className="ab-note">{sourceLabel(it)}</span>
                  {readouts[i] ? (
                    <span className="probe">
                      此处 <b>{fmt(readouts[i].value, 4)}</b>
                    </span>
                  ) : <span className="probe dim">移到图上读激活值</span>}
                </>
              ) : <span className="ab-pane-sub">这一层没有可显示的网格</span>}
            </div>
          </div>
        ))}
      </div>

      {probe ? (
        <div className="ab-probe">
          <span className="ab-probe-title">同一块图像区域</span>
          {items.map((it, i) => (
            <span className="ab-probe-item" key={it.key || i}>
              <b style={{ color: it.color }}>{it.label}</b>
              {readouts[i]
                ? <span>格点 ({readouts[i].cx}, {readouts[i].cy}) = <b>{fmt(readouts[i].value, 4)}</b></span>
                : <span className="muted">这一层没有网格</span>}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 一块画布要画的平面：按 item.source 决定怎么把通道压成一张图 */
function buildPlane(item, opts) {
  const { tensor, shape, source, channel, segRange } = item;
  if (!tensor || !shape || !shape.C || !shape.H || !shape.W) return null;
  const { C, H, W } = shape;
  const n = H * W;
  const wantRgb = source === 'rgb' || (source === 'auto' && C <= 3);
  if (wantRgb) {
    const rgba = new Uint8ClampedArray(n * 4);
    const planes = [];
    for (let c = 0; c < 3; c++) {
      const plane = extractChannel(tensor.data, C, H, W, Math.min(c, C - 1));
      const { lo, hi } = planeRange(plane, 'p1p99');
      planes.push(normalizePlane(plane, lo, hi));
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        let v = planes[c][i];
        if (opts.gamma !== 1) v = Math.pow(v, opts.gamma);
        rgba[i * 4 + c] = (v * 255) | 0;
      }
      rgba[i * 4 + 3] = 255;
    }
    return { plane: reduceChannels(tensor.data, C, H, W, 'mean'), rgb: true, canvas: rgbaToCanvas(rgba, W, H), W, H };
  }
  if (source === 'pca') {
    const { rgba, variance } = pcaComposite(tensor.data, C, H, W, { gamma: opts.gamma });
    return { plane: null, rgb: true, variance, canvas: rgbaToCanvas(rgba, W, H), W, H };
  }
  let plane;
  if (source === 'channel') plane = extractChannel(tensor.data, C, H, W, Math.min(channel || 0, C - 1));
  else if (source === 'seg' && segRange) plane = segmentPlane(tensor, segRange[0], segRange[1]);
  else if (source === 'max') plane = reduceChannels(tensor.data, C, H, W, 'max');
  else plane = reduceChannels(tensor.data, C, H, W, 'mean');
  return { plane, rgb: false, W, H };
}

function probeOf(pane, probe) {
  if (!pane || !pane.plane || !probe) return null;
  const cx = Math.min(pane.W - 1, Math.max(0, Math.floor(probe.u * pane.W)));
  const cy = Math.min(pane.H - 1, Math.max(0, Math.floor(probe.v * pane.H)));
  return { cx, cy, value: pane.plane[cy * pane.W + cx] };
}

function sourceLabel(item) {
  if (item.source === 'rgb') return '原图 RGB';
  if (item.source === 'pca') return 'PCA 三通道合成';
  if (item.source === 'channel') return '单通道 ch' + (item.channel || 0);
  if (item.source === 'max') return '通道最大';
  if (item.source === 'seg') {
    return '通道 ' + item.segRange[0] + '–' + (item.segRange[1] - 1) + ' 的均值';
  }
  return '通道均值';
}

function gradientOf(colormap, gamma) {
  const table = lut(colormap);
  const stops = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const v = gamma !== 1 ? Math.pow(t, gamma) : t;
    const k = Math.min(255, Math.round(v * 255)) * 3;
    stops.push('rgb(' + table[k] + ',' + table[k + 1] + ',' + table[k + 2] + ') ' + (t * 100).toFixed(0) + '%');
  }
  return 'linear-gradient(90deg,' + stops.join(',') + ')';
}

function fmt(v, digits) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(2);
  return v.toFixed(digits == null ? 3 : digits);
}
