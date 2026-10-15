/* 锚点网格：把检测头那 2100 个格点铺回图像上。

   底图是 letterbox 之后的输入图；每个格点用一块正方形表示，边长正好是一个 stride，
   颜色来自该格点的分数（最高类分数 / 指定类的概率）。热力图用 gw×gh 的小画布放大绘制，
   不做插值，所以格子边界是清晰的 —— 「一个格点 = 一个 stride 见方的区域」直接看得见。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { planeRange, normalizePlane } from './field.js';
import { makeCanvas } from './render.js';
import { lut } from './colormap.js';

/** 检测框的状态配色：保留 / 被 NMS 压掉 / 待处理 / 当前正在处理 */
const BOX_COLOR = {
  keep: '#3ee6a4',
  drop: '#ff6b6b',
  pend: '#7f8ea9',
  now: '#4ea3ff',
};

export default function AnchorGrid(props) {
  const {
    size = 520, imgsz = 320, inputCanvas = null,
    grid = null, plane = null, planeLabel = '', colormap = 'viridis',
    gamma = 1, rangeMode = 'p1p99',
    showCells = true, showGrid = true, dimBase = true,
    boxes = [], selected = null, selectedBox = null,
    onHover, onPick, version = 0,
  } = props;

  const canvasRef = useRef(null);
  const [hover, setHover] = useState(null);

  /* 每格一个像素的小画布，放大后就是格点热力图 */
  const cellImage = useMemo(() => {
    if (!showCells || !plane || !grid || grid.count !== plane.length) return null;
    const { lo, hi } = planeRange(plane, rangeMode);
    const norm = normalizePlane(plane, lo, hi);
    const table = lut(colormap);
    const rgba = new Uint8ClampedArray(grid.count * 4);
    for (let i = 0; i < grid.count; i++) {
      const v = norm[i];
      const k = ((v * 255) | 0) * 3;
      rgba[i * 4] = table[k];
      rgba[i * 4 + 1] = table[k + 1];
      rgba[i * 4 + 2] = table[k + 2];
      rgba[i * 4 + 3] = Math.min(255, Math.pow(v, 0.65) * 242) | 0;
    }
    const cv = makeCanvas(grid.gw, grid.gh);
    cv.getContext('2d').putImageData(new ImageData(rgba, grid.gw, grid.gh), 0, 0);
    return { canvas: cv, lo, hi };
  }, [showCells, plane, grid, rangeMode, colormap]);

  /* 画布：底图 -> 格点热力图 -> 网格线 -> 检测框 -> 选中/悬停高亮 */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080b12';
    ctx.fillRect(0, 0, size, size);

    const s = size / imgsz;                       // letterbox 像素 -> 画布像素
    if (inputCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(inputCanvas, 0, 0, size, size);
    }

    if (cellImage) {
      if (dimBase) {
        ctx.fillStyle = 'rgba(6,10,18,0.55)';
        ctx.fillRect(0, 0, size, size);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cellImage.canvas, 0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
    }

    const cw = grid ? size / grid.gw : 0;
    const ch = grid ? size / grid.gh : 0;

    /* 网格线：每格一条细线，每 4 格加粗一条，方便数格子 */
    if (grid && showGrid) {
      for (let i = 0; i <= grid.gw; i++) {
        const major = i % 4 === 0;
        ctx.strokeStyle = major ? 'rgba(150,180,220,0.30)' : 'rgba(150,180,220,0.11)';
        ctx.lineWidth = major ? 1 : 0.6;
        const x = Math.round(i * cw) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
      }
      for (let j = 0; j <= grid.gh; j++) {
        const major = j % 4 === 0;
        ctx.strokeStyle = major ? 'rgba(150,180,220,0.30)' : 'rgba(150,180,220,0.11)';
        ctx.lineWidth = major ? 1 : 0.6;
        const y = Math.round(j * ch) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
      }
      /* 格点坐标刻度：格子够大时才标，免得糊成一片 */
      if (cw >= 20) {
        ctx.fillStyle = 'rgba(180,200,225,0.55)';
        ctx.font = '9.5px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (let i = 5; i < grid.gw; i += 5) ctx.fillText(String(i), i * cw + 2, 2);
        ctx.textBaseline = 'bottom';
        for (let j = 5; j < grid.gh; j += 5) ctx.fillText(String(j), 2, j * ch - 2);
      }
    }

    /* 检测框：坐标是解码之后的 letterbox 像素。
       被压掉 / 待处理的先画，保留和当前判定的后画 —— 否则重叠的重复框会把结论盖住。 */
    for (const b of drawOrder(boxes)) {
      const st = b.state || 'pend';
      ctx.save();
      ctx.setLineDash(st === 'drop' ? [5, 4] : []);
      ctx.globalAlpha = st === 'drop' ? 0.5 : 1;
      ctx.strokeStyle = BOX_COLOR[st] || BOX_COLOR.pend;
      ctx.lineWidth = st === 'now' ? 2.4 : 1.3;
      ctx.strokeRect(b.x1 * s, b.y1 * s, (b.x2 - b.x1) * s, (b.y2 - b.y1) * s);
      if ((st === 'keep' || st === 'now') && b.label) {
        ctx.font = '10.5px ui-monospace, Menlo, monospace';
        const tw = ctx.measureText(b.label).width + 7;
        const ty = Math.max(12, b.y1 * s);
        ctx.fillStyle = 'rgba(8,20,16,0.85)';
        ctx.fillRect(b.x1 * s, ty - 12, tw, 12);
        ctx.fillStyle = BOX_COLOR[st];
        ctx.textBaseline = 'bottom';
        ctx.fillText(b.label, b.x1 * s + 3.5, ty - 1.5);
      }
      ctx.restore();
    }

    /* 选中的格点：格子白框 + 该格预测框 */
    if (grid && selected) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(selected.gx * cw + 1, selected.gy * ch + 1, cw - 2, ch - 2);
      ctx.restore();
    }
    if (selectedBox) {
      ctx.save();
      ctx.strokeStyle = '#c78bff';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(selectedBox.x1 * s, selectedBox.y1 * s,
        (selectedBox.x2 - selectedBox.x1) * s, (selectedBox.y2 - selectedBox.y1) * s);
      ctx.restore();
    }

    /* 悬停格点：亮一圈，鼠标在哪格看得清楚 */
    if (grid && hover) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(hover.gx * cw + 0.5, hover.gy * ch + 0.5, cw - 1, ch - 1);
      ctx.restore();
    }
  }, [
    size, imgsz, inputCanvas, grid, cellImage, dimBase, showGrid, boxes,
    selected, selectedBox, hover, version,
  ]);

  /* 鼠标位置 -> 格点坐标（横幅比例与画布一致，直接按比例换算） */
  const cellFromEvent = (ev) => {
    if (!grid) return null;
    const rect = ev.currentTarget.getBoundingClientRect();
    const gx = Math.floor(((ev.clientX - rect.left) / rect.width) * grid.gw);
    const gy = Math.floor(((ev.clientY - rect.top) / rect.height) * grid.gh);
    if (gx < 0 || gy < 0 || gx >= grid.gw || gy >= grid.gh) return null;
    return { gx, gy, index: gy * grid.gw + gx };
  };

  const onMove = (ev) => {
    const cell = cellFromEvent(ev);
    setHover(cell);
    if (onHover) onHover(cell);
  };

  const onLeave = () => {
    setHover(null);
    if (onHover) onHover(null);
  };

  const onClick = (ev) => {
    if (onPick) onPick(cellFromEvent(ev));
  };

  return (
    <div className="agrid">
      <canvas
        ref={canvasRef}
        className="agrid-canvas"
        style={{ width: size, height: size }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={onClick}
      />
      {cellImage ? (
        <div className="legend">
          <span>{cellImage.lo.toFixed(3)}</span>
          <i style={{ background: legendGradient(colormap, gamma) }} />
          <span>{cellImage.hi.toFixed(3)}</span>
          <em>{planeLabel}</em>
        </div>
      ) : null}
    </div>
  );
}

/** 把配色 + 伽马映射成一条 CSS 渐变，给色标图例用 */
const STACK_ORDER = { drop: 0, pend: 1, keep: 2, now: 3 };

/** 画框顺序：结论（保留、当前判定）压在最上面 */
function drawOrder(boxes) {
  let needsSort = false;
  for (let i = 1; i < boxes.length; i++) {
    if ((STACK_ORDER[boxes[i].state] || 0) < (STACK_ORDER[boxes[i - 1].state] || 0)) { needsSort = true; break; }
  }
  if (!needsSort) return boxes;
  return boxes.slice().sort((a, b) => (STACK_ORDER[a.state] || 0) - (STACK_ORDER[b.state] || 0));
}

export function legendGradient(colormap, gamma = 1) {
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
