/* =============================================================================
 * 内置示例场景（用 Canvas 现场绘制，不依赖任何外部图片资源）
 * ========================================================================== */
window.YV = window.YV || {};
(function (YV) {
  'use strict';

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function drawStreet(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S * 0.62);
    g.addColorStop(0, '#1a2740'); g.addColorStop(0.55, '#4b7fb5'); g.addColorStop(1, '#9dc0dd');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S * 0.62);
    ctx.fillStyle = 'rgba(255,240,200,0.95)';
    ctx.beginPath(); ctx.arc(S * 0.75, S * 0.15, S * 0.075, 0, 6.284); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,190,0.16)';
    ctx.beginPath(); ctx.arc(S * 0.75, S * 0.15, S * 0.16, 0, 6.284); ctx.fill();

    var bld = [[0.01, 0.13, 0.42, '#2b3244'], [0.15, 0.13, 0.28, '#3b3546'],
               [0.29, 0.17, 0.50, '#242a3a'], [0.76, 0.12, 0.44, '#332f42'],
               [0.885, 0.115, 0.30, '#28303f']];
    for (var i = 0; i < bld.length; i++) {
      var b = bld[i], x = S * b[0], w = S * b[1], h = S * b[2];
      ctx.fillStyle = b[3]; ctx.fillRect(x, S * 0.62 - h, w, h);
      ctx.fillStyle = '#f7d47a';
      for (var k = 0; k < 7; k++) {
        for (var m = 0; m < 2; m++) {
          if ((i + k + m) % 3 === 0) continue;
          ctx.fillRect(x + S * (0.012 + m * 0.05), S * (0.62 - h + 0.03 + k * 0.045),
                       S * 0.028, S * 0.026);
        }
      }
    }
    ctx.fillStyle = '#2a2a30'; ctx.fillRect(0, S * 0.62, S, S * 0.38);
    ctx.fillStyle = '#3c3c44'; ctx.fillRect(0, S * 0.62, S, S * 0.03);
    ctx.fillStyle = '#e6dcb4';
    for (var l = 0; l < 7; l++) {
      var lx = S * (0.03 + l * 0.145);
      ctx.beginPath();
      ctx.moveTo(lx, S * 0.955); ctx.lineTo(lx + S * 0.055, S * 0.955);
      ctx.lineTo(lx + S * 0.042, S * 0.875); ctx.lineTo(lx + S * 0.013, S * 0.875);
      ctx.closePath(); ctx.fill();
    }
    function car(cx, cy, w, h, col) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.10, w * 0.55, h * 0.16, 0, 0, 6.284); ctx.fill();
      ctx.fillStyle = col; rr(ctx, cx - w / 2, cy - h, w, h, h * 0.22);
      ctx.fillStyle = '#2c3a52';
      rr(ctx, cx - w * 0.30, cy - h * 1.52, w * 0.60, h * 0.82, h * 0.16);
      ctx.fillStyle = '#12121a';
      ctx.beginPath(); ctx.arc(cx - w * 0.30, cy - h * 0.06, h * 0.30, 0, 6.284); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + w * 0.30, cy - h * 0.06, h * 0.30, 0, 6.284); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,180,0.95)';
      ctx.beginPath(); ctx.arc(cx + w * 0.42, cy - h * 0.45, h * 0.13, 0, 6.284); ctx.fill();
    }
    car(S * 0.30, S * 0.855, S * 0.30, S * 0.085, '#c43e3a');
    car(S * 0.71, S * 0.815, S * 0.245, S * 0.072, '#dee1e6');
    ctx.fillStyle = '#4a4a50'; ctx.fillRect(S * 0.505, S * 0.52, S * 0.016, S * 0.17);
    ctx.fillStyle = '#1d1d21'; rr(ctx, S * 0.487, S * 0.40, S * 0.048, S * 0.13, S * 0.008);
    ctx.fillStyle = '#e6463c';
    ctx.beginPath(); ctx.arc(S * 0.511, S * 0.432, S * 0.014, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#e0a020';
    ctx.beginPath(); ctx.arc(S * 0.511, S * 0.466, S * 0.014, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#2f7d4f';
    ctx.beginPath(); ctx.arc(S * 0.511, S * 0.500, S * 0.014, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#2f5fa8';
    rr(ctx, S * 0.145, S * 0.688, S * 0.052, S * 0.115, S * 0.012);
    ctx.fillStyle = '#d8a684';
    ctx.beginPath(); ctx.arc(S * 0.171, S * 0.665, S * 0.028, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#1e2a3c';
    ctx.fillRect(S * 0.140, S * 0.800, S * 0.020, S * 0.075);
    ctx.fillRect(S * 0.178, S * 0.800, S * 0.020, S * 0.075);
    ctx.fillStyle = '#2d5a33';
    ctx.beginPath(); ctx.arc(S * 0.92, S * 0.60, S * 0.055, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.arc(S * 0.895, S * 0.645, S * 0.038, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#4a3524'; ctx.fillRect(S * 0.912, S * 0.64, S * 0.016, S * 0.09);
  }

  function drawIndoor(ctx, S) {
    var g = ctx.createLinearGradient(0, 0, 0, S * 0.72);
    g.addColorStop(0, '#39414f'); g.addColorStop(1, '#222833');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S * 0.72);
    ctx.fillStyle = '#6b5236';
    ctx.fillRect(0, S * 0.72, S, S * 0.28);
    for (var i = 0; i < 9; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(0, S * (0.72 + i * 0.031), S, S * 0.006);
    }
    ctx.fillStyle = '#cfe6ff'; ctx.fillRect(S * 0.06, S * 0.08, S * 0.26, S * 0.30);
    ctx.fillStyle = 'rgba(255,248,220,0.35)'; ctx.fillRect(S * 0.06, S * 0.08, S * 0.26, S * 0.30);
    ctx.fillStyle = '#2b3038'; ctx.fillRect(S * 0.185, S * 0.08, S * 0.010, S * 0.30);
    ctx.fillRect(S * 0.06, S * 0.225, S * 0.26, S * 0.010);
    ctx.fillStyle = 'rgba(220,235,255,0.10)';
    ctx.beginPath(); ctx.moveTo(S * 0.32, S * 0.08); ctx.lineTo(S * 0.72, S * 0.72);
    ctx.lineTo(S * 0.42, S * 0.72); ctx.lineTo(S * 0.32, S * 0.30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8a6a44'; rr(ctx, S * 0.30, S * 0.58, S * 0.62, S * 0.045, S * 0.008);
    ctx.fillStyle = '#5f4a30'; ctx.fillRect(S * 0.34, S * 0.625, S * 0.03, S * 0.20);
    ctx.fillRect(S * 0.85, S * 0.625, S * 0.03, S * 0.20);
    ctx.fillStyle = '#c9ccd4'; rr(ctx, S * 0.36, S * 0.40, S * 0.20, S * 0.135, S * 0.008);
    ctx.fillStyle = '#9aa2b0'; rr(ctx, S * 0.355, S * 0.395, S * 0.21, S * 0.018, S * 0.006);
    ctx.fillStyle = 'rgba(120,190,255,0.55)'; ctx.fillRect(S * 0.368, S * 0.415, S * 0.184, S * 0.105);
    ctx.fillStyle = '#e8e8ee';
    rr(ctx, S * 0.585, S * 0.505, S * 0.055, S * 0.058, S * 0.012);
    ctx.fillStyle = '#3a2a1c';
    ctx.beginPath(); ctx.ellipse(S * 0.612, S * 0.512, S * 0.030, S * 0.010, 0, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#8d8f98';
    ctx.beginPath(); ctx.ellipse(S * 0.70, S * 0.545, S * 0.105, S * 0.045, 0, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.arc(S * 0.775, S * 0.512, S * 0.042, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.moveTo(S * 0.752, S * 0.478); ctx.lineTo(S * 0.762, S * 0.452);
    ctx.lineTo(S * 0.775, S * 0.474); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(S * 0.782, S * 0.474); ctx.lineTo(S * 0.797, S * 0.452);
    ctx.lineTo(S * 0.803, S * 0.484); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b2f38';
    ctx.beginPath(); ctx.arc(S * 0.762, S * 0.508, S * 0.008, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.arc(S * 0.790, S * 0.508, S * 0.008, 0, 6.284); ctx.fill();
    ctx.strokeStyle = '#8d8f98'; ctx.lineWidth = S * 0.014; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(S * 0.61, S * 0.552);
    ctx.quadraticCurveTo(S * 0.545, S * 0.545, S * 0.575, S * 0.495); ctx.stroke();
    ctx.fillStyle = '#3f7a4a';
    ctx.beginPath(); ctx.ellipse(S * 0.135, S * 0.505, S * 0.045, S * 0.018, -0.6, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.ellipse(S * 0.155, S * 0.470, S * 0.042, S * 0.017, -1.1, 0, 6.284); ctx.fill();
    ctx.beginPath(); ctx.ellipse(S * 0.115, S * 0.545, S * 0.040, S * 0.016, -0.2, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#b5643c';
    ctx.beginPath(); ctx.moveTo(S * 0.095, S * 0.575); ctx.lineTo(S * 0.185, S * 0.575);
    ctx.lineTo(S * 0.170, S * 0.665); ctx.lineTo(S * 0.110, S * 0.665); ctx.closePath(); ctx.fill();
  }

  function drawShapes(ctx, S) {
    ctx.fillStyle = '#101623'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(90,140,190,0.18)'; ctx.lineWidth = 1;
    for (var i = 1; i < 16; i++) {
      ctx.beginPath(); ctx.moveTo(S * i / 16, 0); ctx.lineTo(S * i / 16, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, S * i / 16); ctx.lineTo(S, S * i / 16); ctx.stroke();
    }
    ctx.fillStyle = '#25c2c2';
    ctx.beginPath(); ctx.arc(S * 0.26, S * 0.26, S * 0.145, 0, 6.284); ctx.fill();
    ctx.fillStyle = '#f2892c';
    ctx.beginPath(); ctx.moveTo(S * 0.74, S * 0.13); ctx.lineTo(S * 0.88, S * 0.44);
    ctx.lineTo(S * 0.60, S * 0.44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d048c8'; rr(ctx, S * 0.11, S * 0.60, S * 0.26, S * 0.26, S * 0.02);
    ctx.strokeStyle = '#f5e35c'; ctx.lineWidth = S * 0.028;
    ctx.beginPath(); ctx.arc(S * 0.71, S * 0.70, S * 0.135, 0, 6.284); ctx.stroke();
    ctx.fillStyle = '#5cd07a';
    ctx.beginPath();
    for (var k = 0; k < 10; k++) {
      var ang = -Math.PI / 2 + k * Math.PI / 5;
      var rad = k % 2 === 0 ? S * 0.105 : S * 0.045;
      var px = S * 0.46 + Math.cos(ang) * rad, py = S * 0.50 + Math.sin(ang) * rad;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    var gg = ctx.createLinearGradient(S * 0.40, 0, S * 0.62, 0);
    gg.addColorStop(0, '#101623'); gg.addColorStop(1, '#ffffff');
    ctx.fillStyle = gg; ctx.fillRect(S * 0.40, S * 0.885, S * 0.22, S * 0.055);
  }

  var SAMPLES = [
    { id: 'street', name: '街景 · 车辆 / 行人', draw: drawStreet },
    { id: 'indoor', name: '室内 · 桌面 / 宠物', draw: drawIndoor },
    { id: 'shapes', name: '几何 · 边缘 / 角点', draw: drawShapes }
  ];

  var cache = {};

  /* 生成示例图；加一点传感器噪声，让特征图更接近真实输入 */
  function makeSample(idx, S) {
    S = S || 512;
    var key = idx + '@' + S;
    if (cache[key]) return cache[key];
    var cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    var ctx = cv.getContext('2d');
    SAMPLES[idx].draw(ctx, S);
    var im = ctx.getImageData(0, 0, S, S);
    var d = im.data;
    var rnd = YV.mulberry32(9001 + idx * 131);
    for (var i = 0; i < d.length; i += 4) {
      var n = (rnd() - 0.5) * 9;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(im, 0, 0);
    cache[key] = cv;
    return cv;
  }

  YV.samples = SAMPLES;
  YV.makeSample = makeSample;
})(window.YV);
