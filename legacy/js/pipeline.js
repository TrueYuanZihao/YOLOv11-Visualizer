/* =============================================================================
 * YOLOv11 网络结构与逐层前向计算
 *   - STAGES 按 Ultralytics yolo11.yaml (n 尺度) 的真实拓扑定义
 *   - 每一层的特征图都是对上一层做真实的 卷积 / 池化 / 上采样 / 拼接 得到
 *   - 卷积核为固定人工核（不是训练权重），因此形状与流程忠实、数值为示意
 * ========================================================================== */
window.YV = window.YV || {};
(function (YV) {
  'use strict';

  var NCH = 16;   /* 每个阶段计算并可视化的通道数 */
  var NC = 80;    /* COCO 类别数 */

  var K = {
    id:      [0, 0, 0, 0, 1, 0, 0, 0, 0],
    gauss:   [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625],
    sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    lap:     [0, 1, 0, 1, -4, 1, 0, 1, 0],
    sobelX:  [-0.25, 0, 0.25, -0.5, 0, 0.5, -0.25, 0, 0.25],
    sobelY:  [-0.25, -0.5, -0.25, 0, 0, 0, 0.25, 0.5, 0.25],
    emboss:  [-2, -1, 0, -1, 1, 1, 0, 1, 2],
    lineH:   [-1, -1, -1, 2, 2, 2, -1, -1, -1],
    lineV:   [-1, 2, -1, -1, 2, -1, -1, 2, -1],
    diag:    [2, -1, -1, -1, 2, -1, -1, -1, 2],
    ring:    [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    box:     [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9]
  };
  var BANK = [K.id, K.gauss, K.sharpen, K.lap, K.sobelX, K.sobelY,
              K.emboss, K.lineH, K.lineV, K.diag, K.ring, K.box];
  var BANK_NAME = ['恒等', '高斯', '锐化', '拉普拉斯', 'Sobel-X', 'Sobel-Y',
                   '浮雕', '横线', '竖线', '对角', '环状', '均值'];
  var NF = BANK.length + 1;   /* +1 = 粗尺度（两次高斯） */

  /* ---------------------------------------------------------------- 结构表 */
  var STAGES = [
    { id: 'input', name: '输入图像', block: 'Input', cn: 3, stride: 1, group: 'input',
      desc: '原始 RGB 图像，进入网络前会被缩放到统一尺寸。' },
    { id: 'pre', name: '预处理 · Letterbox', block: 'Preprocess', cn: 3, stride: 1, group: 'input',
      desc: '等比缩放 + 灰边填充到正方形，并把像素归一化到 0~1；这是网络真正看到的输入。' },
    { id: 'p1', name: 'Conv k3 s2', block: 'Conv', cn: 64, stride: 2, group: 'backbone',
      desc: '第一次卷积并把分辨率降一半（160×160 @640）。学到的多为边缘、色块等低级特征。' },
    { id: 'p2', name: 'Conv k3 s2', block: 'Conv', cn: 128, stride: 4, group: 'backbone',
      desc: '第二次下采样。感受野变大，开始出现纹理与局部结构。' },
    { id: 'c3k2_p2', name: 'C3k2 特征提取块', block: 'C3k2', cn: 256, stride: 4, group: 'backbone',
      desc: 'YOLOv11 的 C2f 升级版：通道先分开再走不同数量的瓶颈分支，最后拼接。' },
    { id: 'p3', name: 'Conv k3 s2', block: 'Conv', cn: 256, stride: 8, group: 'backbone',
      desc: '进入 P3/8 尺度，这里是检测小目标的主力尺度。' },
    { id: 'c3k2_p3', name: 'C3k2 特征提取块', block: 'C3k2', cn: 512, stride: 8, group: 'backbone',
      desc: '通道数继续翻倍，语义信息增强，空间细节开始丢失。' },
    { id: 'p4', name: 'Conv k3 s2', block: 'Conv', cn: 512, stride: 16, group: 'backbone',
      desc: '进入 P4/16 尺度，中等大小目标的主要尺度。' },
    { id: 'c3k2_p4', name: 'C3k2 特征提取块', block: 'C3k2', cn: 512, stride: 16, group: 'backbone',
      desc: '深层特征，单个像素已经对应原图 16×16 的区域。' },
    { id: 'p5', name: 'Conv k3 s2', block: 'Conv', cn: 1024, stride: 32, group: 'backbone',
      desc: '进入 P5/32 尺度，特征图很小但感受野覆盖整幅图。' },
    { id: 'c3k2_p5', name: 'C3k2 特征提取块', block: 'C3k2', cn: 1024, stride: 32, group: 'backbone',
      desc: '主干最深处，表征的是“那里有什么”而不是“长什么样”。' },
    { id: 'sppf', name: 'SPPF 空间金字塔池化', block: 'SPPF', cn: 1024, stride: 32, group: 'neck',
      desc: '用 5×5 / 9×9 / 13×13 最大池化并联，一次拿到多个尺度的上下文。' },
    { id: 'c2psa', name: 'C2PSA 自注意力', block: 'C2PSA', cn: 1024, stride: 32, group: 'neck',
      desc: 'YOLOv11 新增的位置敏感注意力：按通道算出注意力权重再回乘特征（看右侧权重条）。' },
    { id: 'up1', name: 'Upsample ×2', block: 'Upsample', cn: 1024, stride: 16, group: 'neck',
      desc: '把深层特征放大一倍，准备和 P4 的特征拼接。' },
    { id: 'c3k2_n1', name: 'Concat + C3k2', block: 'Concat', cn: 512, stride: 16, group: 'neck',
      desc: '↓up1 与 ↑c3k2_p4 在通道维拼接（前 8 个通道来自上支路，后 8 个来自主干跳连）。' },
    { id: 'up2', name: 'Upsample ×2', block: 'Upsample', cn: 512, stride: 8, group: 'neck',
      desc: '再放大一次，准备与 P3 特征拼接。' },
    { id: 'c3k2_n2', name: 'Concat + C3k2 → P3 输出', block: 'Concat', cn: 256, stride: 8, group: 'neck',
      desc: '小目标检测头使用的特征：分辨率最高、细节最丰富。' },
    { id: 'down1', name: 'Conv k3 s2 下采样', block: 'Conv', cn: 256, stride: 16, group: 'neck',
      desc: '自顶向下之后再自底向上：把浅层的定位信息带回中层。' },
    { id: 'c3k2_n3', name: 'Concat + C3k2 → P4 输出', block: 'Concat', cn: 512, stride: 16, group: 'neck',
      desc: '中目标检测头使用的特征。' },
    { id: 'down2', name: 'Conv k3 s2 下采样', block: 'Conv', cn: 512, stride: 32, group: 'neck',
      desc: '同样操作，把信息继续带到最深尺度。' },
    { id: 'c3k2_n4', name: 'Concat + C3k2 → P5 输出', block: 'Concat', cn: 1024, stride: 32, group: 'neck',
      desc: '大目标检测头使用的特征。' },
    { id: 'head_p3', name: 'Detect 检测头 · P3/8', block: 'Detect', cn: 144, stride: 8, group: 'head',
      desc: '解耦头：一半通道回归边框（DFL 分布），一半通道做 80 类分类。输出 ' +
            '80×80 = 6400 个候选。' },
    { id: 'head_p4', name: 'Detect 检测头 · P4/16', block: 'Detect', cn: 144, stride: 16, group: 'head',
      desc: '40×40 = 1600 个候选，负责中等目标。' },
    { id: 'head_p5', name: 'Detect 检测头 · P5/32', block: 'Detect', cn: 144, stride: 32, group: 'head',
      desc: '20×20 = 400 个候选，负责大目标。' },
    { id: 'output', name: '输出层 · NMS 之后', block: 'Output', cn: 84, stride: 1, group: 'output',
      desc: '三个尺度汇总共 8400 个候选，经置信度筛选与非极大值抑制后得到最终结果。' }
  ];

  function stageIndex(id) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return i;
    return -1;
  }

  /* ------------------------------------------------------- 深度/通道先验 */
  function depthProfile(t) {
    var p = new Float32Array(NF);
    for (var i = 0; i < BANK.length; i++) {
      var n = BANK_NAME[i], v;
      if (n === '恒等') v = 1.00 * (1 - t);
      else if (n === '高斯') v = 0.70 * (1 - 0.55 * t);
      else if (n === '均值') v = 0.55 + 0.95 * t;
      else if (n === '拉普拉斯' || n === '环状') v = 0.45 * (1 - t) + 0.12;
      else if (n === 'Sobel-X' || n === 'Sobel-Y') v = 0.95 * (1 - 0.65 * t);
      else if (n === '锐化') v = 0.55 * (1 - 0.85 * t);
      else v = 0.45 * (1 - 0.5 * t);
      p[i] = v;
    }
    p[NF - 1] = 0.15 + 1.75 * t;
    return p;
  }

  /* 让同一层里的 16 个通道各有性格：0 低通(像原图) 1 带通(边缘纹理) 2 粗尺度 3 混合 */
  function chanProfile(c, t) {
    var w = depthProfile(t);
    var kind = c % 4;
    if (kind === 0) {
      for (var i = 0; i < NF; i++) w[i] *= 0.30;
      w[0] += 0.95 * (1 - t) + 0.15;
      w[1] += 0.70;
      w[11] += 0.65;
    } else if (kind === 1) {
      for (i = 0; i < BANK.length; i++) {
        var n = BANK_NAME[i];
        if (n === 'Sobel-X' || n === 'Sobel-Y' || n === '拉普拉斯' || n === '环状' || n === '锐化') w[i] *= 2.4;
      }
      w[NF - 1] *= 0.35;
    } else if (kind === 2) {
      for (i = 0; i < NF; i++) w[i] *= 0.22;
      w[NF - 1] += 1.70;
      w[11] += 0.85;
    }
    return w;
  }

  function corr(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var sa = 0, sb = 0, sab = 0;
    for (i = 0; i < n; i++) {
      var da = a[i] - ma, db = b[i] - mb;
      sa += da * da; sb += db * db; sab += da * db;
    }
    var den = Math.sqrt(sa * sb);
    return den < 1e-9 ? 0 : sab / den;
  }

  /* 从上一层特征里挑 4 个“能量最大且彼此最不相关”的通道当参考平面 */
  function pickRefs(planes, k) {
    k = k || 4;
    var order = [], i;
    for (i = 0; i < planes.length; i++) order.push(i);
    var stds = {};
    for (i = 0; i < planes.length; i++) stds[i] = YV.stats(planes[i]).std;
    order.sort(function (a, b) { return stds[b] - stds[a]; });
    var refs = [order[0]];
    while (refs.length < k && refs.length < planes.length) {
      var best = -1, bestScore = 1e9;
      for (i = 0; i < order.length; i++) {
        var idx = order[i];
        if (refs.indexOf(idx) >= 0) continue;
        var s = 0;
        for (var j = 0; j < refs.length; j++) {
          var c = Math.abs(corr(planes[idx].d, planes[refs[j]].d));
          if (c > s) s = c;
        }
        if (s < bestScore) { bestScore = s; best = idx; }
      }
      if (best < 0) break;
      refs.push(best);
    }
    while (refs.length < k) refs.push(refs[refs.length - 1]);
    var out = [];
    for (i = 0; i < refs.length; i++) out.push(planes[refs[i]]);
    return out;
  }

  /* 参考平面 -> 滤波器响应集合 */
  function buildFeatures(planes, W, H) {
    var res = [], i;
    for (i = 0; i < planes.length; i++) res.push(YV.resize(planes[i], W, H));
    var refs = pickRefs(res, 4);
    var feat = [];
    for (i = 0; i < refs.length; i++) {
      var r = refs[i];
      for (var k = 0; k < BANK.length; k++) feat.push(YV.conv3(r, BANK[k], 1));
      feat.push(YV.blur(r, 2));
    }
    return feat;
  }

  function meanAbs(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i] < 0 ? -arr[i] : arr[i];
    return arr.length ? s / arr.length : 0;
  }

  /* 核心：把特征响应混合成 NCH 张“像 CNN 激活图”的通道 */
  function channelsFromFeatures(feat, W, H, t, seed, count, kind, chOffset) {
    var out = [], nF = feat.length, n = W * H, c, f, i;
    chOffset = chOffset || 0;
    for (c = 0; c < count; c++) {
      var rnd = YV.mulberry32((seed + 1) * 7919 + (c + chOffset) * 104729 + 17);
      var prof = chanProfile(c + chOffset, t);
      var y = new Float32Array(n);
      for (f = 0; f < nF; f++) {
        var wf = prof[f % NF] * (0.40 + 1.10 * rnd());
        if (rnd() < 0.5) wf = -wf;
        if (wf === 0) continue;
        var fd = feat[f].d;
        for (i = 0; i < n; i++) y[i] += wf * fd[i];
      }
      var pos = 0;
      for (i = 0; i < n; i++) if (y[i] > 0) pos++;
      if (pos < n * 0.12) for (i = 0; i < n; i++) y[i] = -y[i];
      for (i = 0; i < n; i++) if (y[i] < 0) y[i] = 0;
      if (kind === 'c2psa') {
        var e = meanAbs(y);
        var g = 0.55 + 2.6 * e;
        for (i = 0; i < n; i++) y[i] *= g;
      }
      var pl = { w: W, h: H, d: y };
      var passes = t > 0.30 ? (c % 3) : 0;
      if (passes) pl = YV.blur(pl, passes);
      out.push(YV.softNorm(pl));
    }
    return out;
  }

  /* --------------------------------------------------------- 预处理与输入 */
  function letterbox(source, base) {
    var cv = document.createElement('canvas');
    cv.width = base; cv.height = base;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, base, base);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var s = Math.min(base / source.width, base / source.height);
    var dw = Math.max(1, Math.round(source.width * s));
    var dh = Math.max(1, Math.round(source.height * s));
    var dx = Math.round((base - dw) / 2), dy = Math.round((base - dh) / 2);
    ctx.drawImage(source, dx, dy, dw, dh);
    return { canvas: cv, rect: { dx: dx, dy: dy, dw: dw, dh: dh }, scale: s };
  }

  function refsFromImageData(im) {
    var w = im.width, h = im.height, d = im.data, n = w * h, i, j;
    var L = YV.plane(w, h), A = YV.plane(w, h), B = YV.plane(w, h);
    for (i = 0, j = 0; i < n; i++, j += 4) {
      var r = d[j] / 255, g = d[j + 1] / 255, b = d[j + 2] / 255;
      L.d[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      A.d[i] = (r - g) * 0.5;
      B.d[i] = (b - (r + g) * 0.5) * 0.5;
    }
    return [L, A, B, YV.gradMag(L)];
  }

  /* ------------------------------------------------------------ 复杂度估算 */
  function estimateMACs(st, inCn, H, W) {
    var cn = st.cn, k = st.block;
    if (k === 'Conv') return 9 * inCn * cn * H * W;
    if (k === 'C3k2') return Math.round(4.5 * inCn * cn * H * W);
    if (k === 'SPPF') return Math.round(2.5 * cn * cn * H * W);
    if (k === 'C2PSA') return Math.round(3.0 * cn * cn * H * W);
    if (k === 'Detect') return Math.round((64 + NC) * inCn * H * W);
    if (k === 'Concat') return Math.round(3.0 * (inCn + cn) * cn * H * W);
    return 0;
  }

  /* --------------------------------------------------------- 注意力权重 */
  function attentionFromPlanes(planes) {
    var n = planes.length, i, h;
    var stat = [];
    for (i = 0; i < n; i++) {
      var s = YV.stats(planes[i]);
      stat.push(s.std * (1.0 + 0.5 * s.mean));
    }
    var m = 0;
    for (i = 0; i < n; i++) m += stat[i];
    m /= n;
    var v = 0;
    for (i = 0; i < n; i++) { var d0 = stat[i] - m; v += d0 * d0; }
    v = Math.sqrt(v / n) + 1e-6;
    for (i = 0; i < n; i++) stat[i] = (stat[i] - m) / v;

    var rnd = YV.mulberry32(20240513);
    var H = 8, W1 = [], b1 = [], W2 = [], j;
    for (i = 0; i < H; i++) {
      var row = [];
      for (j = 0; j < n; j++) row.push((rnd() - 0.5) * 1.7);
      W1.push(row); b1.push((rnd() - 0.5) * 0.4);
    }
    for (i = 0; i < n; i++) {
      var r2 = [];
      for (j = 0; j < H; j++) r2.push((rnd() - 0.5) * 1.35);
      W2.push(r2);
    }
    var hid = [];
    for (h = 0; h < H; h++) {
      var acc = b1[h];
      for (i = 0; i < n; i++) acc += W1[h][i] * stat[i];
      hid.push(Math.tanh(acc));
    }
    var logits = [];
    for (i = 0; i < n; i++) {
      var a = 0;
      for (h = 0; h < H; h++) a += W2[i][h] * hid[h];
      logits.push(a);
    }
    var mx = -1e30;
    for (i = 0; i < n; i++) if (logits[i] > mx) mx = logits[i];
    var sum = 0;
    for (i = 0; i < n; i++) { logits[i] = Math.exp(logits[i] - mx); sum += logits[i]; }
    for (i = 0; i < n; i++) logits[i] /= sum;
    return logits;
  }

  var CONCAT_SRC = { c3k2_n1: 'c3k2_p4', c3k2_n2: 'c3k2_p3', c3k2_n3: 'c3k2_n1', c3k2_n4: 'c2psa' };

  /* ============================================================ 主前向流程 */
  function run(source, base, onProgress) {
    var t0 = (window.performance || Date).now();
    var lb = letterbox(source, base);
    var im = lb.canvas.getContext('2d').getImageData(0, 0, base, base);
    var baseRefs = refsFromImageData(im);
    var det = (YV.detector && YV.detector.analyze) ? YV.detector.analyze(im) : null;

    var results = new Array(STAGES.length);
    results[0] = { id: 'input', W: source.width, H: source.height, planes: null,
                   rgb: source, macs: 0, meta: {} };
    results[1] = { id: 'pre', W: base, H: base, planes: baseRefs, rgb: lb.canvas, macs: 0,
                   meta: { letterbox: lb.rect, scale: lb.scale } };

    for (var i = 2; i < STAGES.length; i++) {
      var st = STAGES[i];
      var W = Math.max(2, Math.round(base / st.stride));
      var H = W;
      var t = Math.min(0.92, 0.06 + 0.86 * (Math.log(Math.max(2, st.stride)) / Math.log(32)));
      var planes = [], meta = {};
      var blocks = 1;

      if (st.block === 'Upsample') {
        var src = results[i - 1].planes;
        for (var u = 0; u < src.length; u++) planes.push(YV.resizeBilinear(src[u], W, H));
        meta.note = '双线性放大 ×2，为与主干特征拼接做准备';
        results[i] = { id: st.id, W: W, H: H, planes: planes, rgb: null, macs: 0, meta: meta };
        if (onProgress) onProgress(i, STAGES.length);
        continue;
      }

      if (st.block === 'Concat') {
        var upPlanes = results[i - 1].planes;
        var skipIdx = stageIndex(CONCAT_SRC[st.id]);
        var skipPlanes = results[skipIdx].planes;
        var featA = buildFeatures(upPlanes, W, H);
        var featB = buildFeatures(skipPlanes, W, H);
        var half = NCH / 2;
        planes = channelsFromFeatures(featA, W, H, t, i * 31 + 3, half, 'conv', 0)
          .concat(channelsFromFeatures(featB, W, H, t, i * 31 + 7, half, 'conv', half));
        meta.concat = {
          left: '上采样支路 · ' + STAGES[i - 1].name,
          right: '主干跳连 · ' + STAGES[skipIdx].name,
          split: half
        };
        meta.note = '通道维拼接后走 C3k2 融合，前 ' + half + ' 个通道来自上支路，后 ' +
                    half + ' 个来自主干';
      } else if (st.block === 'Detect') {
        if (det) {
          var objS = YV.resizeArea(det.obj, W, H);
          for (var b = 0; b < 8; b++) planes.push(YV.robustStretch(YV.blur(objS, 1 + (b % 3)), 0.02, 0.985 - b * 0.012));
          for (var q = 0; q < 8; q++) planes.push(YV.resizeArea(det.cls[q], W, H));
          meta.candCount = W * H;
          meta.role = { box: [0, 8], cls: [8, 16] };
          meta.note = '前 8 个通道 = 边框回归 (DFL) 响应，后 8 个通道 = 类别置信度';
        } else {
          planes = channelsFromFeatures(buildFeatures(results[i - 1].planes, W, H), W, H, t, i, NCH, 'conv', 0);
        }
      } else {
        var feat = buildFeatures(results[i - 1].planes, W, H);
        if (st.block === 'SPPF') {
          var q1 = [], q2 = [], q3 = [];
          for (var f = 0; f < feat.length; f++) {
            q1.push(feat[f]);
            q2.push(YV.maxPool(feat[f], 3));
            q3.push(YV.maxPool(q2[f], 3));
          }
          feat = feat.concat(q1, q2, q3);
          meta.note = '最大池化串行堆叠 3 次（感受野 1 / 3 / 5）后并联融合';
        }
        planes = channelsFromFeatures(feat, W, H, t, i * 977 + 5, NCH,
                                     st.block === 'C2PSA' ? 'c2psa' : 'conv', 0);
        if (st.block === 'C2PSA') {
          meta.attention = attentionFromPlanes(planes);
          meta.note = '注意力按通道加权输出：增强显著通道、抑制冗余通道';
        }
      }

      var inCn = STAGES[i - 1].cn;
      if (st.block === 'Concat') inCn = STAGES[i - 1].cn + STAGES[stageIndex(CONCAT_SRC[st.id])].cn;
      results[i] = { id: st.id, W: W, H: H, planes: planes, rgb: null,
                     macs: estimateMACs(st, inCn, H, W), meta: meta };
      if (onProgress) onProgress(i, STAGES.length);
    }

    results[STAGES.length - 1] = {
      id: 'output', W: source.width, H: source.height, planes: null, rgb: source, macs: 0,
      meta: { detections: det ? det.cand : [], letterbox: lb.rect, scale: lb.scale }
    };

    return {
      base: base, stages: results, det: det,
      letterbox: { rect: lb.rect, scale: lb.scale },
      ms: Math.round((window.performance || Date).now() - t0)
    };
  }

  YV.STAGES = STAGES;
  YV.NCH = NCH;
  YV.NC = NC;
  YV.BANK_NAME = BANK_NAME;
  YV.stageIndex = stageIndex;
  YV.pipeline = { run: run, STAGES: STAGES, NCH: NCH };
})(window.YV);
