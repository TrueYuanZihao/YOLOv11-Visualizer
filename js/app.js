/* =============================================================================
 * 交互主程序：状态、事件、视图渲染
 * ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var LAST = 0;

  var state = {
    base: 320, cmap: 'viridis', gamma: 1.0, view: 'single', channel: 0,
    overlayAlpha: 0.55, showGrid: true, blocky: true,
    conf: 0.40, iou: 0.45, stage: 2, play: false, timer: null,
    debug: false, pendingStage: null,
    source: null, sourceName: '', run: null, nms: null, hover: -1,
    sampleIdx: 0
  };
  var viewer = null;

  /* ------------------------------------------------------------ 错误提示 */
  function ensureErrBox() {
    var el = document.createElement('div');
    el.id = 'errbox';
    el.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:99;' +
      'display:none;padding:10px 14px;border-radius:10px;background:#3a1220;' +
      'border:1px solid #ff6b6b;color:#ffd9d9;font:12px ui-monospace,Consolas,monospace;' +
      'white-space:pre-wrap;max-height:40vh;overflow:auto';
    document.body.appendChild(el);
    window.addEventListener('error', function (e) {
      el.style.display = 'block';
      el.textContent += 'JS ERROR: ' + e.message + '  @' + (e.filename || '').split('/').pop() +
        ':' + e.lineno + '\n';
    });
  }

  /* ---------------------------------------------------------------- 工具 */
  function fmtMACs(v) {
    if (!v) return '0';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' G';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + ' M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + ' K';
    return String(Math.round(v));
  }

  function shapeOf(i) {
    if (!state.run) return '—';
    var res = state.run.stages[i], st = YV.STAGES[i];
    if (!res) return '—';
    return res.W + '×' + res.H + '×' + st.cn;
  }

  function totalMACs() {
    if (!state.run) return 1;
    var s = 0;
    for (var i = 0; i < state.run.stages.length; i++) s += state.run.stages[i].macs || 0;
    return s || 1;
  }

  /* ------------------------------------------------------------- 初始化 */
  function init() {
    LAST = YV.STAGES.length - 1;
    applyQuery();
    viewer = new YV.Viewer($('view'));
    viewer.onHover = onHover;
    viewer.blocky = state.blocky;
    viewer.showGrid = state.showGrid;
    buildCmapSelect();
    buildSamples();
    bindControls();
    syncControls();
    viewer.resize();
    window.addEventListener('resize', function () { viewer.resize(); });
    window.addEventListener('keydown', onKey);

    selectSample(state.sampleIdx);
    window.setTimeout(function () { viewer.resize(); }, 80);
  }

  function buildCmapSelect() {
    var sel = $('cmap');
    var names = { viridis: 'Viridis', inferno: 'Inferno', turbo: 'Turbo', ice: 'Ice', gray: '灰度' };
    for (var i = 0; i < YV.cmaps.length; i++) {
      var o = document.createElement('option');
      o.value = YV.cmaps[i];
      o.textContent = names[YV.cmaps[i]] || YV.cmaps[i];
      sel.appendChild(o);
    }
    sel.value = state.cmap;
  }

  function buildSamples() {
    var box = $('samples');
    box.textContent = '';
    for (var i = 0; i < YV.samples.length; i++) {
      (function (idx) {
        var row = document.createElement('div');
        row.className = 'sample' + (idx === state.sampleIdx ? ' on' : '');
        row.setAttribute('data-i', idx);
        var cnv = document.createElement('canvas');
        cnv.width = 64; cnv.height = 64;
        var ctx = cnv.getContext('2d');
        ctx.drawImage(YV.makeSample(idx, 512), 0, 0, 64, 64);
        var sp = document.createElement('span');
        sp.textContent = YV.samples[idx].name;
        row.appendChild(cnv); row.appendChild(sp);
        row.addEventListener('click', function () { selectSample(idx); });
        box.appendChild(row);
      })(i);
    }
  }

  function selectSample(idx) {
    state.sampleIdx = idx;
    state.sourceName = YV.samples[idx].name;
    var rows = document.querySelectorAll('.sample');
    for (var k = 0; k < rows.length; k++) {
      rows[k].classList.toggle('on', parseInt(rows[k].getAttribute('data-i'), 10) === idx);
    }
    state.source = YV.makeSample(idx, 512);
    rerun();
  }

  /* --------------------------------------------------------- 计算整条链路 */
  function rerun() {
    $('computing').classList.add('on');
    window.setTimeout(function () {
      try {
        var t = (window.performance || Date).now();
        state.run = YV.pipeline.run(state.source, state.base);
        state.run.ms = Math.round((window.performance || Date).now() - t);
        $('statTime').textContent = '整网 ' + state.run.ms + ' ms';
        buildPipeline();
        selectStage(state.stage >= YV.STAGES.length ? 2 : state.stage);
        if (state.pendingStage !== null) {
          var ps = state.pendingStage;
          state.pendingStage = null;
          selectStage(ps);
        }
        selftest();
      } catch (err) {
        var eb = $('errbox');
        eb.style.display = 'block';
        eb.textContent += 'RUN ERROR: ' + (err && err.stack ? err.stack : String(err)) + '\n';
      }
      $('computing').classList.remove('on');
    }, 40);
  }

  /* ------------------------------------------------------------ 结构列表 */
  function buildPipeline() {
    var ST = YV.STAGES, html = '', lastGroup = '', i;
    var groups = { input: '输入', backbone: '主干 Backbone', neck: '颈部 Neck',
                   head: '检测头 Head', output: '输出' };
    for (i = 0; i < ST.length; i++) {
      var st = ST[i];
      if (st.group !== lastGroup) {
        html += '<div class="pgroup">' + groups[st.group] + '</div>';
        lastGroup = st.group;
      }
      var macs = state.run.stages[i] ? state.run.stages[i].macs : 0;
      html += '<div class="pstage' + (i === state.stage ? ' on' : '') + '" data-i="' + i + '">' +
        '<div class="bar"></div>' +
        '<div class="nm">' + st.name + '<i>' + st.block + ' · s' + st.stride +
        (macs ? ' · ' + fmtMACs(macs) + ' MACs' : '') + '</i></div>' +
        '<div class="cn">' + shapeOf(i) + '</div></div>';
    }
    var el = $('pipeline');
    el.innerHTML = html;
    var rows = el.querySelectorAll('.pstage');
    for (i = 0; i < rows.length; i++) {
      rows[i].addEventListener('click', function () {
        selectStage(parseInt(this.getAttribute('data-i'), 10));
      });
    }
    scrollStageIntoView();
  }

  function scrollStageIntoView() {
    var rows = document.querySelectorAll('.pstage');
    var row = rows[state.stage];
    if (!row || !row.scrollIntoView) return;
    var box = $('pipeline');
    var rt = row.offsetTop, rb = rt + row.offsetHeight;
    if (rt < box.scrollTop + 8 || rb > box.scrollTop + box.clientHeight - 8) {
      box.scrollTop = rt - box.clientHeight / 2 + row.offsetHeight / 2;
    }
  }

  /* ------------------------------------------------------------ 选择层 */
  function selectStage(i) {
    if (!state.run) return;
    i = Math.max(0, Math.min(LAST, i));
    state.stage = i;
    var rows = document.querySelectorAll('.pstage');
    for (var k = 0; k < rows.length; k++) rows[k].classList.toggle('on', k === i);
    scrollStageIntoView();
    updateStageBar();
    updateStrip();
    paint();
    updateInfo();
    updateAttention();
    $('btnPrev').disabled = i === 0;
    $('btnNext').disabled = i === LAST;
  }

  function updateStageBar() {
    var st = YV.STAGES[state.stage], res = state.run.stages[state.stage];
    $('stageName').textContent = st.name;
    $('stageBlock').textContent = st.block;
    $('stageShape').textContent = res.W + '×' + res.H + '×' + st.cn;
    $('stageIdx').textContent = (state.stage + 1) + ' / ' + YV.STAGES.length;
    var d = st.desc;
    if (res.meta && res.meta.note) d += ' <em>' + res.meta.note + '</em>';
    if (res.meta && res.meta.concat) {
      d += ' <em>拼接：' + res.meta.concat.left + ' ⊕ ' + res.meta.concat.right + '</em>';
    }
    $('stageDesc').innerHTML = d;
  }

  /* --------------------------------------------------------- 画布渲染 */
  function toSourceBox(c) {
    var m = state.run.letterbox;
    var s = m.rect.dw / state.source.width;
    return { x: (c.cx - c.w / 2 - m.rect.dx) / s, y: (c.cy - c.h / 2 - m.rect.dy) / s,
             w: c.w / s, h: c.h / s };
  }

  function paint() {
    var res = state.run.stages[state.stage];
    var st = YV.STAGES[state.stage];
    var det = state.run.det;
    var out = det ? YV.detector.nms(det.cand, state.conf, state.iou)
                  : { kept: [], raw: 0, removed: 0 };
    state.nms = out;
    updateDetList(out);

    var ann = [], i, c;
    viewer.cellHighlight = null;

    if (res.rgb) {
      if (state.stage === LAST) {
        for (i = 0; i < out.kept.length; i++) {
          c = out.kept[i];
          var b = toSourceBox(c);
          ann.push({ x: b.x, y: b.y, w: b.w, h: b.h,
                     color: YV.CLASSES[c.cls].color,
                     width: state.hover === i ? 4 : 2,
                     label: c.clsName + ' ' + Math.round(c.score * 100) + '%' });
        }
      }
      viewer.annotations = ann;
      viewer.blocky = false;
      viewer.setRGB(res.rgb);
      return;
    }

    if (st.group === 'head' && det) {
      var n = 0;
      for (i = 0; i < det.cand.length && n < 70; i++) {
        c = det.cand[i];
        if (c.scale !== st.stride || c.score < state.conf) continue;
        n++;
        ann.push({ x: (c.cx - c.w / 2) / st.stride, y: (c.cy - c.h / 2) / st.stride,
                   w: c.w / st.stride, h: c.h / st.stride,
                   color: YV.CLASSES[c.cls].color, width: 1.5, label: null });
      }
      if (state.hover >= 0 && out.kept[state.hover] && out.kept[state.hover].scale === st.stride) {
        c = out.kept[state.hover];
        viewer.cellHighlight = { x: (c.cx - c.w / 2) / st.stride, y: (c.cy - c.h / 2) / st.stride,
                                 w: c.w / st.stride, h: c.h / st.stride };
      }
    }

    var overlay = state.view === 'overlay' ? state.run.stages[1].rgb : null;
    viewer.annotations = ann;
    viewer.blocky = state.blocky;
    viewer.setPlanes(res.planes, {
      channel: state.channel, cmap: state.cmap, gamma: state.gamma,
      grid: state.view === 'grid', overlay: overlay, overlayAlpha: state.overlayAlpha
    });
  }

  /* ------------------------------------------------------------ 通道条 */
  var PRE_REFS = ['亮度 L', '红绿拮抗 R-G', '蓝黄拮抗 B-Y', '边缘梯度 |∇L|'];

  function updateStrip() {
    var res = state.run.stages[state.stage];
    var el = $('strip');
    var isInput = state.stage <= 1;
    el.textContent = '';
    if (!res || !res.planes) {
      var d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '输出层为最终检测结果，不含特征图';
      el.appendChild(d);
      $('stripInfo').textContent = '—';
      return;
    }
    var lut = YV.cmapLUT(state.cmap);
    var W = res.planes[0].w, H = res.planes[0].h;
    for (var i = 0; i < res.planes.length; i++) {
      var cnv = document.createElement('canvas');
      cnv.width = W; cnv.height = H;
      var ctx = cnv.getContext('2d');
      var img = ctx.createImageData(W, H);
      YV.colorizeInto(res.planes[i], lut, state.gamma, img.data);
      ctx.putImageData(img, 0, 0);
      if (isInput) {
        cnv.className = 'dim';
        cnv.title = PRE_REFS[i] || ('参考平面 #' + i);
      } else {
        if (i === state.channel) cnv.className = 'on';
        cnv.title = '通道 #' + i + ' · ' + W + '×' + H;
        cnv.setAttribute('data-i', i);
        cnv.addEventListener('click', function () {
          setChannel(parseInt(this.getAttribute('data-i'), 10));
        });
      }
      el.appendChild(cnv);
    }
    var sl = $('chan');
    sl.disabled = isInput;
    sl.max = Math.max(0, res.planes.length - 1);
    sl.value = isInput ? 0 : state.channel;
    if (isInput) {
      $('stripInfo').textContent = state.stage === 0
        ? '原始 RGB 图像（尚未进入网络）'
        : '内部参考平面：' + PRE_REFS.join(' / ');
    } else {
      $('stripInfo').textContent = '#' + state.channel + ' / ' + res.planes.length +
        ' · 共 ' + YV.STAGES[state.stage].cn + ' 通道 · 步长 ' + YV.STAGES[state.stage].stride;
    }
  }

  function setChannel(i) {
    state.channel = i;
    var el = $('strip');
    for (var k = 0; k < el.children.length; k++) {
      var ch = el.children[k];
      if (ch.tagName === 'CANVAS') ch.classList.toggle('on', k === i);
    }
    $('chan').value = i;
    paint();
    updateStrip();
  }

  /* ------------------------------------------------------------ 检测列表 */
  function updateDetList(out) {
    var det = state.run.det;
    $('kRaw').textContent = det ? det.cand.length + ' / 8400' : '0';
    $('kKeep').textContent = out.kept.length;
    var box = $('detList');
    box.textContent = '';
    if (!det || !det.cand.length) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.style.cssText = 'font-size:11.5px;color:#64799a';
      e.textContent = '没有候选框';
      box.appendChild(e);
      return;
    }
    var lim = Math.min(36, out.kept.length);
    for (var i = 0; i < lim; i++) {
      (function (idx) {
        var c = out.kept[idx];
        var row = document.createElement('div');
        row.className = 'det';
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = YV.CLASSES[c.cls].color;
        var nm = document.createElement('span');
        nm.className = 'nm';
        nm.textContent = c.clsName;
        var sm = document.createElement('span');
        sm.className = 'hint';
        sm.textContent = ' P' + Math.round(Math.log(c.scale) / Math.LN2);
        nm.appendChild(sm);
        var cf = document.createElement('span');
        cf.className = 'cf';
        cf.textContent = c.score.toFixed(2);
        row.appendChild(dot); row.appendChild(nm); row.appendChild(cf);
        row.addEventListener('mouseenter', function () { state.hover = idx; paint(); });
        row.addEventListener('mouseleave', function () { state.hover = -1; paint(); });
        row.addEventListener('click', function () {
          if (state.stage !== LAST) selectStage(LAST);
          state.hover = idx; paint();
        });
        box.appendChild(row);
      })(i);
    }
  }

  /* ------------------------------------------------------------ 注意力 */
  function updateAttention() {
    var res = state.run.stages[state.stage];
    var a = res.meta && res.meta.attention;
    var el = $('attn');
    el.textContent = '';
    if (!a) {
      $('attnNote').textContent = '选中 C2PSA 层时显示该层的通道注意力权重。';
      return;
    }
    var mx = 0, i;
    for (i = 0; i < a.length; i++) if (a[i] > mx) mx = a[i];
    for (i = 0; i < a.length; i++) {
      var d = document.createElement('div');
      d.style.height = Math.max(3, Math.round(a[i] / mx * 100)) + '%';
      if (a[i] > mx * 0.8) d.className = 'top';
      d.title = '通道 #' + i + '：' + (a[i] * 100).toFixed(2) + '%';
      el.appendChild(d);
    }
    $('attnNote').textContent = '16 个可视化通道的注意力分布；峰值通道 #' +
      a.indexOf(mx) + '，权重 ' + (mx * 100).toFixed(1) + '%。';
  }

  /* ------------------------------------------------------------ 层信息 */
  function updateInfo() {
    var st = YV.STAGES[state.stage], res = state.run.stages[state.stage];
    $('kStage').textContent = (state.stage + 1) + ' / ' + YV.STAGES.length + ' · ' + st.block;
    $('kShape').textContent = res.W + '×' + res.H + '×' + st.cn;
    $('kStride').textContent = st.stride > 1 ? '1 / ' + st.stride : '不变';
    $('kMacs').textContent = fmtMACs(res.macs || 0);
    var sum = 0;
    for (var i = 0; i <= state.stage; i++) sum += state.run.stages[i].macs || 0;
    $('kMacsSum').textContent = fmtMACs(sum) + ' · ' +
      (sum / totalMACs() * 100).toFixed(1) + '%';
    $('kTime').textContent = state.run.ms + ' ms';
  }

  /* ------------------------------------------------------------ 悬停提示 */
  function onHover(c) {
    if (!state.run) return;
    var res = state.run.stages[state.stage];
    var st = YV.STAGES[state.stage];
    var hint = $('hint');
    if (res.planes) {
      var W = res.planes[0].w, H = res.planes[0].h;
      if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) {
        hint.textContent = '拖拽平移 · 滚轮缩放 · 双击复位';
        return;
      }
      var gx = Math.floor(c.x), gy = Math.floor(c.y);
      var rf = '原图 ≈ (' + Math.round(c.x * (state.base / W)) + ', ' +
        Math.round(c.y * (state.base / H)) + ')';
      hint.textContent = '格点 (' + gx + ',' + gy + ') · 感受野中心 ' + rf +
        ' · 步长 ' + st.stride;
    } else {
      hint.textContent = '原图像素 (' + Math.round(c.x) + ', ' + Math.round(c.y) + ')';
    }
  }

  /* ------------------------------------------------------- URL 参数 / 同步 */
  function applyQuery() {
    var s = window.location.search.replace(/^\?/, '');
    if (!s) return;
    var parts = s.split('&'), q = {}, i;
    for (i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    }
    var b = parseInt(q.base, 10);
    if ([256, 320, 384, 448].indexOf(b) >= 0) state.base = b;
    if (['single', 'grid', 'overlay'].indexOf(q.view) >= 0) state.view = q.view;
    if (q.cmap && YV.cmaps.indexOf(q.cmap) >= 0) state.cmap = q.cmap;
    if (q.channel) state.channel = Math.max(0, Math.min(YV.NCH - 1, parseInt(q.channel, 10) || 0));
    if (q.gamma) state.gamma = parseFloat(q.gamma) || 1;
    if (q.conf) state.conf = parseFloat(q.conf);
    if (q.iou) state.iou = parseFloat(q.iou);
    if (q.grid === '0') state.showGrid = false;
    if (q.blocky === '0') state.blocky = false;
    if (q.sample !== undefined && q.sample !== '') {
      state.sampleIdx = Math.max(0, Math.min(YV.samples.length - 1, parseInt(q.sample, 10) || 0));
    }
    state.debug = q.debug === '1';
    if (q.stage !== undefined && q.stage !== '') state.pendingStage = parseInt(q.stage, 10) || 0;
  }

  function syncControls() {
    $('gamma').value = state.gamma; $('vGamma').textContent = state.gamma.toFixed(2);
    $('conf').value = state.conf; $('vConf').textContent = state.conf.toFixed(2);
    $('iou').value = state.iou; $('vIou').textContent = state.iou.toFixed(2);
    $('cmap').value = state.cmap;
    $('alpha').value = state.overlayAlpha;
    $('vAlpha').textContent = Math.round(state.overlayAlpha * 100) + '%';
    $('grid').checked = state.showGrid;
    $('blocky').checked = state.blocky;
    var i, bs = $('segView').querySelectorAll('button');
    for (i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-v') === state.view);
    bs = $('segBase').querySelectorAll('button');
    for (i = 0; i < bs.length; i++) {
      bs[i].classList.toggle('on', parseInt(bs[i].getAttribute('data-b'), 10) === state.base);
    }
  }

  /* ------------------------------------------------------------ 控件绑定 */
  function mark(container, btn) {
    var bs = container.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i] === btn);
  }

  function bindControls() {
    $('segView').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      state.view = b.getAttribute('data-v');
      mark($('segView'), b);
      paint();
    });

    $('segBase').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var v = parseInt(b.getAttribute('data-b'), 10);
      if (v === state.base) return;
      state.base = v;
      mark($('segBase'), b);
      rerun();
    });

    $('cmap').addEventListener('change', function () {
      state.cmap = this.value; paint(); updateStrip();
    });
    $('gamma').addEventListener('input', function () {
      state.gamma = parseFloat(this.value);
      $('vGamma').textContent = state.gamma.toFixed(2);
      paint(); updateStrip();
    });
    $('alpha').addEventListener('input', function () {
      state.overlayAlpha = parseFloat(this.value);
      $('vAlpha').textContent = Math.round(state.overlayAlpha * 100) + '%';
      if (state.view === 'overlay') paint();
    });
    $('grid').addEventListener('change', function () {
      state.showGrid = this.checked; viewer.showGrid = this.checked; paint();
    });
    $('blocky').addEventListener('change', function () {
      state.blocky = this.checked; paint();
    });
    $('conf').addEventListener('input', function () {
      state.conf = parseFloat(this.value);
      $('vConf').textContent = state.conf.toFixed(2);
      paint();
    });
    $('iou').addEventListener('input', function () {
      state.iou = parseFloat(this.value);
      $('vIou').textContent = state.iou.toFixed(2);
      paint();
    });
    $('chan').addEventListener('input', function () {
      if (!state.run.stages[state.stage].planes) return;
      setChannel(parseInt(this.value, 10));
    });

    $('btnPrev').addEventListener('click', function () { selectStage(state.stage - 1); });
    $('btnNext').addEventListener('click', function () { selectStage(state.stage + 1); });
    $('btnResetView').addEventListener('click', function () { viewer.reset(); viewer.draw(); });
    $('btnUpload').addEventListener('click', function () { $('file').click(); });
    $('file').addEventListener('change', onFile);
    $('btnPlay').addEventListener('click', togglePlay);

    var wrap = document.querySelector('.canvas-wrap');
    wrap.addEventListener('dragover', function (e) { e.preventDefault(); wrap.classList.add('drop'); });
    wrap.addEventListener('dragleave', function () { wrap.classList.remove('drop'); });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      wrap.classList.remove('drop');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
  }

  function loadFile(f) {
    if (!f || !/^image\//.test(f.type)) return;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var MAX = 1024;
        var s = Math.min(1, MAX / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.max(16, Math.round(img.width * s));
        cv.height = Math.max(16, Math.round(img.height * s));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        state.source = cv;
        state.sourceName = f.name;
        var rows = document.querySelectorAll('.sample');
        for (var k = 0; k < rows.length; k++) rows[k].classList.remove('on');
        rerun();
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
  }

  function onFile() { loadFile(this.files && this.files[0]); }

  /* ------------------------------------------------------------ 逐层播放 */
  function togglePlay() {
    state.play = !state.play;
    var b = $('btnPlay');
    b.classList.toggle('on', state.play);
    b.textContent = state.play ? '❚❚ 暂停' : '▶ 逐层播放';
    if (state.timer) { window.clearInterval(state.timer); state.timer = null; }
    if (state.play) {
      state.timer = window.setInterval(function () {
        if (state.stage >= LAST) { togglePlay(); return; }
        selectStage(state.stage + 1);
      }, 1150);
    }
  }

  function onKey(e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'ArrowRight') { selectStage(state.stage + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { selectStage(state.stage - 1); e.preventDefault(); }
    else if (e.key === ' ') { togglePlay(); e.preventDefault(); }
  }

  /* -------------------------------------------------------- 自检（隐藏） */
  function selftest() {
    var info = { stages: YV.STAGES.length, base: state.base, ms: state.run.ms,
                 cand: state.run.det ? state.run.det.cand.length : -1,
                 kept: state.nms ? state.nms.kept.length : -1,
                 scale: state.run.det ? state.run.det.debug : null };
    try {
      var bad = [];
      for (var i = 0; i < state.run.stages.length; i++) {
        var r = state.run.stages[i], st = YV.STAGES[i];
        if (r.planes && i > 1 && r.planes.length !== YV.NCH) bad.push(st.id + ':nch=' + r.planes.length);
        if (r.planes && (r.planes[0].w !== r.W || r.planes[0].h !== r.H)) bad.push(st.id + ':size');
        if (!r.planes && !r.rgb) bad.push(st.id + ':empty');
      }
      info.bad = bad.length ? bad.join(',') : 'none';
      info.ok = bad.length === 0;
    } catch (e) { info.ok = false; info.err = String(e); }
    var d = document.getElementById('selftest');
    if (!d) {
      d = document.createElement('div');
      d.id = 'selftest';
      d.style.cssText = 'position:fixed;top:70px;left:12px;z-index:98;display:none;' +
        'padding:8px 12px;border-radius:8px;background:rgba(8,20,32,0.94);' +
        'border:1px solid #2c6f9a;color:#9fe8ff;font:11px ui-monospace,Consolas,monospace;' +
        'max-width:660px;white-space:pre-wrap';
      document.body.appendChild(d);
    }
    d.style.display = state.debug ? 'block' : 'none';
    d.textContent = 'SELFTEST ' + JSON.stringify(info);
  }

  /* ---------------------------------------------------------------- 启动 */
  try { ensureErrBox(); } catch (e) {}

  function boot() {
    try { init(); } catch (e) {
      var eb = document.getElementById('errbox');
      if (eb) { eb.style.display = 'block'; eb.textContent += 'INIT ERROR: ' + (e && e.stack ? e.stack : String(e)) + '\n'; }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else window.setTimeout(boot, 0);
})();
