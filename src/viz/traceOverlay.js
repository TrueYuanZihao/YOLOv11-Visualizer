import { TRACE_SCALE_COLORS } from '../model/causalTrace.js';

export function drawCausalTrace(ctx, trace, scale = 1, opts = {}) {
  if (!ctx || !trace || !trace.detection) return;
  const det = trace.detection;
  const labels = opts.labels !== false;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const a of trace.anchors) {
    const color = a.color || TRACE_SCALE_COLORS[a.scale] || '#ffd166';
    const cx = a.x * scale;
    const cy = a.y * scale;
    const rf = a.rf * scale;
    const cell = a.cell * scale;
    const line = Math.max(1, scale * (a.exact ? 1.8 : 1.25));

    ctx.globalAlpha = a.exact ? 0.5 : 0.32;
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.setLineDash([Math.max(4, scale * 5), Math.max(3, scale * 4)]);
    ctx.strokeRect(cx - rf / 2, cy - rf / 2, rf, rf);

    ctx.globalAlpha = a.exact ? 0.2 : 0.11;
    ctx.fillStyle = color;
    ctx.fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    ctx.globalAlpha = a.exact ? 1 : 0.78;
    ctx.setLineDash(a.exact ? [] : [Math.max(2, scale * 2.5), Math.max(2, scale * 2.5)]);
    ctx.strokeRect(cx - cell / 2, cy - cell / 2, cell, cell);

    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx - Math.max(3, scale * 4), cy);
    ctx.lineTo(cx + Math.max(3, scale * 4), cy);
    ctx.moveTo(cx, cy - Math.max(3, scale * 4));
    ctx.lineTo(cx, cy + Math.max(3, scale * 4));
    ctx.stroke();

    if (labels) {
      const label = (a.exact ? '★ ' : '') + a.scale + ' · ' + a.cell + 'px';
      const fs = Math.max(9, Math.min(13, scale * 7.5));
      ctx.font = '600 ' + fs + 'px ui-monospace, Consolas, monospace';
      const tw = ctx.measureText(label).width;
      const lx = clamp(cx - tw / 2, 2, trace.imgsz * scale - tw - 2);
      const ly = clamp(cy - cell / 2 - fs - 5, 2, trace.imgsz * scale - fs - 2);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(5,10,18,0.82)';
      ctx.fillRect(lx - 3, ly - fs, tw + 6, fs + 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(label, lx, ly);
    }
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = Math.max(2, scale * 2.2);
  ctx.strokeRect(det.x1 * scale, det.y1 * scale, (det.x2 - det.x1) * scale, (det.y2 - det.y1) * scale);

  if (labels) {
    const label = det.className + ' ' + (det.score * 100).toFixed(1) + '%';
    const fs = Math.max(10, Math.min(14, scale * 8));
    ctx.font = '650 ' + fs + 'px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 8;
    const lx = clamp(det.x1 * scale, 2, trace.imgsz * scale - tw - 2);
    const ly = clamp(det.y1 * scale - fs - 4, 2, trace.imgsz * scale - fs - 2);
    ctx.fillStyle = 'rgba(52,36,5,0.9)';
    ctx.fillRect(lx, ly, tw, fs + 5);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(label, lx + 4, ly + fs);
  }

  ctx.restore();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
