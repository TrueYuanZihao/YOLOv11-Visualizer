/* =============================================================================
 * YOLOv11 可视化工作台 —— 图像算子 / 色彩映射 / 示例场景
 * 纯前端实现，无任何外部依赖。所有特征图都是对真实图像做真实卷积/池化算出来的，
 * 只是卷积核为“固定的人工核”而非训练权重（详见 README）。
 * ========================================================================== */
window.YV = window.YV || {};
(function (YV) {
  'use strict';

  /* ------------------------------------------------------------- 伪随机数 */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------------- 平面 */
  function plane(w, h) { return { w: w, h: h, d: new Float32Array(w * h) }; }
  function clonePlane(p) { return { w: p.w, h: p.h, d: p.d.slice() }; }

  /* ------------------------------------------------------------- 3x3 卷积 */
  function conv3(src, k, stride) {
    stride = stride || 1;
    var w = src.w, h = src.h, s = src.d;
    var ow = (w / stride) | 0, oh = (h / stride) | 0;
    var o = new Float32Array(ow * oh);
    var k0 = k[0], k1 = k[1], k2 = k[2], k3 = k[3], k4 = k[4],
        k5 = k[5], k6 = k[6], k7 = k[7], k8 = k[8];
    for (var y = 0; y < oh; y++) {
      var cy = y * stride, oRow = y * ow;
      var y0 = cy - 1, y2 = cy + 1;
      var r0 = y0 >= 0 ? y0 * w : -1, r1 = cy * w, r2 = y2 < h ? y2 * w : -1;
      for (var x = 0; x < ow; x++) {
        var cx = x * stride;
        var x0 = cx - 1, x2 = cx + 1;
        var inL = x0 >= 0, inR = x2 < w, acc = 0;
        if (r0 >= 0) {
          if (inL) acc += s[r0 + x0] * k0;
          acc += s[r0 + cx] * k1;
          if (inR) acc += s[r0 + x2] * k2;
        }
        if (inL) acc += s[r1 + x0] * k3;
        acc += s[r1 + cx] * k4;
        if (inR) acc += s[r1 + x2] * k5;
        if (r2 >= 0) {
          if (inL) acc += s[r2 + x0] * k6;
          acc += s[r2 + cx] * k7;
          if (inR) acc += s[r2 + x2] * k8;
        }
        o[oRow + x] = acc;
      }
    }
    return { w: ow, h: oh, d: o };
  }

  var K_GAUSS = [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625];
  var K_SOBEL_X = [-0.25, 0, 0.25, -0.5, 0, 0.5, -0.25, 0, 0.25];
  var K_SOBEL_Y = [-0.25, -0.5, -0.25, 0, 0, 0, 0.25, 0.5, 0.25];

  function blur(src, passes) {
    var out = src;
    passes = passes || 1;
    for (var i = 0; i < passes; i++) out = conv3(out, K_GAUSS, 1);
    return out;
  }

  function maxPool(src, k) {
    var w = src.w, h = src.h, s = src.d, p = (k / 2) | 0;
    var o = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var best = -1e30;
        for (var dy = -p; dy <= p; dy++) {
          var yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (var dx = -p; dx <= p; dx++) {
            var xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            var v = s[yy * w + xx];
            if (v > best) best = v;
          }
        }
        o[y * w + x] = best;
      }
    }
    return { w: w, h: h, d: o };
  }

  /* --------------------------------------------------------------- 重采样 */
  function resizeArea(src, ow, oh) {
    if (src.w === ow && src.h === oh) return clonePlane(src);
    var out = plane(ow, oh), o = out.d, s = src.d, w = src.w, h = src.h;
    var sx = w / ow, sy = h / oh;
    for (var y = 0; y < oh; y++) {
      var y0 = Math.floor(y * sy);
      var y1 = Math.min(h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
      for (var x = 0; x < ow; x++) {
        var x0 = Math.floor(x * sx);
        var x1 = Math.min(w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
        var acc = 0, n = 0;
        for (var yy = y0; yy < y1; yy++) {
          var row = yy * w;
          for (var xx = x0; xx < x1; xx++) { acc += s[row + xx]; n++; }
        }
        o[y * ow + x] = n ? acc / n : 0;
      }
    }
    return out;
  }

  function resizeBilinear(src, ow, oh) {
    if (src.w === ow && src.h === oh) return clonePlane(src);
    var out = plane(ow, oh), o = out.d, s = src.d, w = src.w, h = src.h;
    var fx = w / ow, fy = h / oh;
    for (var y = 0; y < oh; y++) {
      var sy0 = (y + 0.5) * fy - 0.5;
      var y0 = Math.floor(sy0), ty = sy0 - y0;
      var ya = y0 < 0 ? 0 : y0, yb = y0 + 1 >= h ? h - 1 : y0 + 1;
      for (var x = 0; x < ow; x++) {
        var sx0 = (x + 0.5) * fx - 0.5;
        var x0 = Math.floor(sx0), tx = sx0 - x0;
        var xa = x0 < 0 ? 0 : x0, xb = x0 + 1 >= w ? w - 1 : x0 + 1;
        var v00 = s[ya * w + xa], v01 = s[ya * w + xb];
        var v10 = s[yb * w + xa], v11 = s[yb * w + xb];
        var top = v00 + (v01 - v00) * tx, bot = v10 + (v11 - v10) * tx;
        o[y * ow + x] = top + (bot - top) * ty;
      }
    }
    return out;
  }

  function resize(src, ow, oh) {
    if (ow < src.w && oh < src.h) return resizeArea(src, ow, oh);
    if (ow === src.w && oh === src.h) return clonePlane(src);
    return resizeBilinear(src, ow, oh);
  }

  function gradMag(src) {
    var gx = conv3(src, K_SOBEL_X, 1), gy = conv3(src, K_SOBEL_Y, 1);
    var n = gx.d.length, o = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var a = gx.d[i], b = gy.d[i];
      o[i] = Math.sqrt(a * a + b * b);
    }
    return { w: src.w, h: src.h, d: o };
  }

  /* ------------------------------------------------------------- 统计工具 */
  function stats(p) {
    var s = p.d, n = s.length, sum = 0, mn = 1e30, mx = -1e30;
    for (var i = 0; i < n; i++) { var v = s[i]; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
    var mean = sum / n, acc = 0;
    for (i = 0; i < n; i++) { var d = s[i] - mean; acc += d * d; }
    return { mean: mean, std: Math.sqrt(acc / n), min: mn, max: mx };
  }

  function percentile(p, q) {
    var n = p.d.length;
    var step = Math.max(1, Math.floor(n / 4096));
    var buf = [];
    for (var i = 0; i < n; i += step) buf.push(p.d[i]);
    buf.sort(function (a, b) { return a - b; });
    var idx = Math.min(buf.length - 1, Math.max(0, Math.round(q * (buf.length - 1))));
    return buf[idx];
  }

  function robustStretch(p, lo, hi) {
    var l = percentile(p, lo === undefined ? 0.01 : lo);
    var h = percentile(p, hi === undefined ? 0.99 : hi);
    var out = plane(p.w, p.h), o = out.d, s = p.d;
    var inv = (h - l) < 1e-6 ? 0 : 1 / (h - l);
    for (var i = 0; i < s.length; i++) {
      var v = (s[i] - l) * inv;
      o[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return out;
  }

  /* 标准化 + 压缩 + 拉伸：保证每个通道都有可见结构，不会“整张黑” */
  function softNorm(p) {
    var st = stats(p);
    var inv = 1 / (st.std + 1e-6);
    var tmp = plane(p.w, p.h), t = tmp.d, s = p.d;
    for (var i = 0; i < s.length; i++) {
      t[i] = 1 / (1 + Math.exp(-1.6 * (s[i] - st.mean) * inv));
    }
    var out = robustStretch(tmp, 0.01, 0.99);
    var d = out.d;
    for (var k = 0; k < d.length; k++) d[k] = Math.pow(d[k], 0.78);
    return out;
  }

  /* --------------------------------------------------------------- 伪彩色 */
  var CMAP_STOPS = {
    viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
              [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]],
    inferno: [[0, 0, 4], [22, 11, 57], [66, 10, 104], [106, 23, 110], [147, 38, 103],
              [188, 55, 84], [221, 81, 58], [243, 120, 25], [252, 165, 10], [246, 215, 70],
              [252, 255, 164]],
    turbo:   [[48, 18, 59], [70, 107, 227], [37, 187, 213], [31, 231, 141], [151, 247, 58],
              [253, 196, 45], [240, 101, 26], [200, 34, 5], [122, 4, 3]],
    ice:     [[3, 6, 20], [10, 42, 84], [16, 100, 146], [42, 174, 202], [152, 232, 240],
              [255, 255, 255]],
    gray:    [[4, 5, 9], [255, 255, 255]]
  };
  var CMAP_LUT = {};

  function cmapLUT(name) {
    if (CMAP_LUT[name]) return CMAP_LUT[name];
    var stops = CMAP_STOPS[name] || CMAP_STOPS.viridis;
    var lut = new Uint8Array(256 * 3);
    for (var i = 0; i < 256; i++) {
      var t = (i / 255) * (stops.length - 1);
      var j = Math.min(stops.length - 2, Math.floor(t));
      var f = t - j, a = stops[j], b = stops[j + 1];
      lut[i * 3] = a[0] + (b[0] - a[0]) * f;
      lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
      lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
    }
    CMAP_LUT[name] = lut;
    return lut;
  }

  /* 把 0..1 的平面写进 RGBA 缓冲区 */
  function colorizeInto(p, lut, gamma, out) {
    var s = p.d, n = s.length;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var v = s[i];
      if (gamma !== 1) v = Math.pow(v < 0 ? 0 : v, gamma);
      var idx = (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0) * 3;
      out[j] = lut[idx]; out[j + 1] = lut[idx + 1]; out[j + 2] = lut[idx + 2]; out[j + 3] = 255;
    }
  }
  YV.mulberry32 = mulberry32;
  YV.plane = plane;
  YV.clonePlane = clonePlane;
  YV.conv3 = conv3;
  YV.blur = blur;
  YV.maxPool = maxPool;
  YV.resize = resize;
  YV.resizeArea = resizeArea;
  YV.resizeBilinear = resizeBilinear;
  YV.gradMag = gradMag;
  YV.stats = stats;
  YV.percentile = percentile;
  YV.robustStretch = robustStretch;
  YV.softNorm = softNorm;
  YV.cmapLUT = cmapLUT;
  YV.colorizeInto = colorizeInto;
  YV.cmaps = Object.keys(CMAP_STOPS);
})(window.YV);
