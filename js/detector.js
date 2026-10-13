/* =============================================================================
 * 检测头 / 输出层
 *   - 目标性(显著度)与 8 类“类别响应图”由输入图像真实计算得到
 *   - 候选框由多尺度局部极大值给出，并用真实 NMS 按 IoU 阈值过滤
 *   - 未使用训练权重，因此类别标签是启发式推断（界面中标注为“示意”）
 * ========================================================================== */
window.YV = window.YV || {};
(function (YV) {
  'use strict';

  var CLASSES = [
    { name: '人',      color: '#ff6b6b' },
    { name: '车',      color: '#4dabf7' },
    { name: '交通灯',  color: '#ffd43b' },
    { name: '动物',    color: '#a78bfa' },
    { name: '家具',    color: '#4ade80' },
    { name: '杯子',    color: '#22d3ee' },
    { name: '笔记本',  color: '#f472b6' },
    { name: '其他物体', color: '#94a3b8' }
  ];

  var SCALES = [
    { stride: 8,  minRel: 0.0015, maxRel: 0.12, gain: 1.00 },
    { stride: 16, minRel: 0.0120, maxRel: 0.45, gain: 1.04 },
    { stride: 32, minRel: 0.0600, maxRel: 1.20, gain: 1.08 }
  ];

  /* ------------------------------------------------------------ 显著度计算 */
  function saliency(im) {
    var w = im.width, h = im.height, d = im.data, n = w * h, i, j;
    var L = YV.plane(w, h), S = YV.plane(w, h);
    for (i = 0, j = 0; i < n; i++, j += 4) {
      var r = d[j] / 255, g = d[j + 1] / 255, b = d[j + 2] / 255;
      L.d[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      S.d[i] = mx - mn;
    }
    var edge = YV.robustStretch(YV.gradMag(L), 0.02, 0.985);
    var sat = YV.robustStretch(S, 0.02, 0.985);
    var lo = YV.blur(L, 4);
    var cs = YV.plane(w, h);
    for (i = 0; i < n; i++) cs.d[i] = Math.abs(L.d[i] - lo.d[i]);
    cs = YV.robustStretch(cs, 0.02, 0.985);

    var dens = YV.blur(edge, 3);
    var obj = YV.plane(w, h);
    for (i = 0; i < n; i++) {
      obj.d[i] = (0.28 * edge.d[i] + 0.40 * sat.d[i] + 0.32 * cs.d[i]) *
                 (0.50 + 0.55 * dens.d[i]);
    }
    obj = YV.blur(obj, 1);
    obj = YV.robustStretch(obj, 0.05, 0.995);
    return { obj: obj, L: L, sat: sat, edge: edge };
  }

  /* --------------------------------------------------------- 局部极大值 */
  function localMaxima(m, minVal) {
    var out = [];
    for (var y = 1; y < m.h - 1; y++) {
      for (var x = 1; x < m.w - 1; x++) {
        var v = m.d[y * m.w + x];
        if (v < minVal) continue;
        var ok = true;
        for (var dy = -1; dy <= 1 && ok; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (m.d[(y + dy) * m.w + (x + dx)] > v) { ok = false; break; }
          }
        }
        if (ok) out.push({ x: x, y: y, v: v });
      }
    }
    return out;
  }

  /* 从峰值向四周扩张，估计斑块半径（用于自适应框大小） */
  function blobExtent(m, x, y, ratio) {
    var v = m.d[y * m.w + x], t = v * ratio;
    function scan(dx, dy) {
      var k = 0, xx = x, yy = y;
      while (true) {
        xx += dx; yy += dy;
        if (xx < 0 || yy < 0 || xx >= m.w || yy >= m.h) break;
        if (m.d[yy * m.w + xx] < t) break;
        k++;
        if (k > 40) break;
      }
      return k;
    }
    var rx = Math.min(scan(1, 0), scan(-1, 0));
    var ry = Math.min(scan(0, 1), scan(0, -1));
    return { rx: rx, ry: ry };
  }

  /* ------------------------------------------------- 类别推断（启发式） */
  function hueSatVal(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), dv = mx - mn;
    var hu = 0;
    if (dv > 1e-6) {
      if (mx === r) hu = ((g - b) / dv + 6) % 6;
      else if (mx === g) hu = (b - r) / dv + 2;
      else hu = (r - g) / dv + 4;
      hu /= 6;
    }
    return { h: hu, s: mx > 0 ? dv / mx : 0, v: mx };
  }

  function regionColor(im, cx, cy, hw, hh, L, sat) {
    var w = im.width, h = im.height, d = im.data;
    var x0 = Math.max(0, Math.round(cx - hw)), x1 = Math.min(w - 1, Math.round(cx + hw));
    var y0 = Math.max(0, Math.round(cy - hh)), y1 = Math.min(h - 1, Math.round(cy + hh));
    var sr = 0, sg = 0, sb = 0, cnt = 0, se = 0, ss = 0;
    var stepX = Math.max(1, Math.round((x1 - x0) / 24)), stepY = Math.max(1, Math.round((y1 - y0) / 24));
    for (var y = y0; y <= y1; y += stepY) {
      for (var x = x0; x <= x1; x += stepX) {
        var p = (y * w + x) * 4;
        sr += d[p]; sg += d[p + 1]; sb += d[p + 2]; cnt++;
        se += L.d[y * w + x]; ss += sat.d[y * w + x];
      }
    }
    if (!cnt) return { r: 0, g: 0, b: 0, edge: 0, sat: 0 };
    return { r: sr / cnt / 255, g: sg / cnt / 255, b: sb / cnt / 255,
             edge: se / cnt, sat: ss / cnt };
  }

  function classify(feat) {
    var hsv = hueSatVal(feat.r, feat.g, feat.b);
    var aspect = feat.w / Math.max(1e-6, feat.h);
    var rel = feat.rel, cy = feat.cy;
    var scores = [
      /* 人：竖长 */      1.30 * clamp01((0.88 - aspect) * 2.6) +
                          0.40 * clamp01((0.10 - Math.abs(rel - 0.06) * 6)),
      /* 车：扁宽 */      1.38 * clamp01((aspect - 1.45) * 1.5) +
                          0.60 * clamp01((cy - 0.40) * 2.2),
      /* 交通灯：小且艳 */ 1.00 * clamp01((0.035 - rel) * 28) +
                          0.70 * clamp01((0.62 - cy) * 1.8) + 0.55 * clamp01((hsv.s - 0.35) * 2.2),
      /* 动物：圆润低饱和 */ 0.90 * clamp01((0.42 - hsv.s) * 2.2) +
                          0.50 * clamp01((1.6 - Math.abs(aspect - 1.1) * 2.4)),
      /* 家具：大块偏暗 */  0.90 * clamp01((rel - 0.12) * 4.5) +
                          0.50 * clamp01((0.68 - hsv.v) * 2.2) +
                          0.40 * clamp01((1.8 - Math.abs(aspect - 1.15) * 2.2)),
      /* 杯子：小且亮 */    0.85 * clamp01((0.05 - rel) * 30) + 0.55 * clamp01((hsv.v - 0.50) * 2.0),
      /* 笔记本：方正低饱和 */ 0.80 * clamp01((0.32 - hsv.s) * 2.6) +
                          0.50 * clamp01((rel - 0.03) * 10) +
                          0.35 * clamp01((1.6 - Math.abs(aspect - 1.15) * 2.2)),
      /* 其他物体 */        0.72
    ];
    var mx = -1e9, sum = 0, i;
    for (i = 0; i < scores.length; i++) {
      scores[i] = Math.exp(scores[i] * 1.7);
      sum += scores[i];
      if (scores[i] > mx) mx = scores[i];
    }
    for (i = 0; i < scores.length; i++) scores[i] /= sum;
    var best = 0;
    for (i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    return { cls: best, probs: scores };
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ------------------------------------------------------------ 主入口 */
  function analyze(im) {
    var base = im.width, n = base * base;
    var sal = saliency(im);
    var obj = sal.obj;
    var cand = [];
    var dbg = [];

    for (var s = 0; s < SCALES.length; s++) {
      var sc = SCALES[s];
      var gs = Math.max(2, Math.round(base / sc.stride));
      var m = YV.resizeArea(obj, gs, gs);
      var pk = [], i;
      var mm = 0;
      for (i = 0; i < m.d.length; i++) if (m.d[i] > mm) mm = m.d[i];
      pk = localMaxima(m, Math.max(0.20, mm * 0.28));
      pk.sort(function (a, b) { return b.v - a.v; });
      if (pk.length > 48) pk = pk.slice(0, 48);
      dbg.push(sc.stride + ':' + pk.length);
      for (i = 0; i < pk.length; i++) {
        var p = pk[i];
        var ex = blobExtent(m, p.x, p.y, 0.55);
        var cx = (p.x + 0.5) * sc.stride, cy = (p.y + 0.5) * sc.stride;
        var hw = Math.max(sc.stride * 0.85, (ex.rx + 1) * sc.stride * 1.05);
        var hh = Math.max(sc.stride * 0.85, (ex.ry + 1) * sc.stride * 1.05);
        var rel = (hw * 2 * hh * 2) / n;
        if (rel < sc.minRel || rel > sc.maxRel) continue;
        var feat = regionColor(im, cx, cy, hw, hh, sal.L, sal.sat);
        feat.rel = rel; feat.cy = cy / base; feat.w = hw * 2; feat.h = hh * 2;
        var cl = classify(feat);
        var conf = clamp01(p.v * sc.gain) * (0.62 + 0.38 * cl.probs[cl.cls]);
        if (conf < 0.15) continue;
        cand.push({ cx: cx, cy: cy, w: hw * 2, h: hh * 2, score: conf,
                    cls: cl.cls, clsName: CLASSES[cl.cls].name, probs: cl.probs,
                    scale: sc.stride, peak: p.v });
      }
    }

    /* 类别响应图：把候选按类别累积成高斯斑，得到“类别置信度热力图” */
    var cls = [];
    for (var q = 0; q < CLASSES.length; q++) cls.push(YV.plane(base, base));
    for (i = 0; i < cand.length; i++) {
      var c = cand[i], p2 = cls[c.cls];
      var r = Math.max(3, Math.min(c.w, c.h) * 0.55);
      var ix0 = Math.max(0, Math.floor(c.cx - r)), ix1 = Math.min(base - 1, Math.ceil(c.cx + r));
      var iy0 = Math.max(0, Math.floor(c.cy - r)), iy1 = Math.min(base - 1, Math.ceil(c.cy + r));
      var inv = 1 / (2 * r * r);
      for (var y = iy0; y <= iy1; y++) {
        for (var x = ix0; x <= ix1; x++) {
          var dx = x - c.cx, dy = y - c.cy;
          p2.d[y * base + x] += c.score * Math.exp(-(dx * dx + dy * dy) * inv);
        }
      }
    }
    for (q = 0; q < cls.length; q++) cls[q] = YV.robustStretch(YV.blur(cls[q], 1), 0.01, 0.995);

    cand.sort(function (a, b) { return b.score - a.score; });
    if (cand.length > 160) cand = cand.slice(0, 160);
    return { obj: obj, cls: cls, cand: cand, debug: dbg.join(' '),
             classNames: CLASSES.map(function (c) { return c.name; }) };
  }

  /* ------------------------------------------------------------ NMS */
  function iou(a, b) {
    var ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2, ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
    var bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2, bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
    var ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    var iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    var inter = ix * iy;
    var uni = a.w * a.h + b.w * b.h - inter;
    return uni <= 0 ? 0 : inter / uni;
  }

  function nms(list, confThr, iouThr) {
    var keep = [];
    for (var i = 0; i < list.length; i++) if (list[i].score >= confThr) keep.push(list[i]);
    keep.sort(function (a, b) { return b.score - a.score; });
    var out = [], removed = 0;
    var alive = keep.map(function () { return true; });
    for (i = 0; i < keep.length; i++) {
      if (!alive[i]) continue;
      out.push(keep[i]);
      for (var j = i + 1; j < keep.length; j++) {
        if (!alive[j]) continue;
        if (iou(keep[i], keep[j]) > iouThr) { alive[j] = false; removed++; }
      }
    }
    return { kept: out, raw: keep.length, removed: removed };
  }

  YV.CLASSES = CLASSES;
  YV.detector = { analyze: analyze, nms: nms, iou: iou, saliency: saliency };
})(window.YV);
