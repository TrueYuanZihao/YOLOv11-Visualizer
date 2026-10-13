/* =============================================================================
 * 画布渲染：特征图查看器（缩放 / 平移 / 叠加原图 / 网格 / 标注）
 * ========================================================================== */
window.YV = window.YV || {};
(function (YV) {
  'use strict';

  var GRID_TILE = 112, GRID_GAP = 14, GRID_LABEL = 13;

  function Viewer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.content = document.createElement('canvas');
    this.content.width = 1; this.content.height = 1;
    this.zoom = 1; this.tx = 0; this.ty = 0;
    this.annotations = [];
    this.cellGrid = null;
    this.showGrid = false;
    this.blocky = true;
    this.empty = true;
    this._bind();
  }

  Viewer.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var r = this.cv.getBoundingClientRect();
    var w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.cw = w; this.ch = h;
    this.draw();
  };

  Viewer.prototype.reset = function () {
    this.zoom = 1; this.tx = 0; this.ty = 0;
  };

  /* 计算内容 -> 屏幕的变换 */
  Viewer.prototype.xform = function () {
    var cw = this.cw || this.cv.width, ch = this.ch || this.cv.height;
    var fit = Math.min(cw / this.content.width, ch / this.content.height);
    var s = fit * this.zoom;
    var dw = this.content.width * s, dh = this.content.height * s;
    return { s: s, x: (cw - dw) / 2 + this.tx, y: (ch - dh) / 2 + this.ty, w: dw, h: dh };
  };

  /* ---------------------------------------------------- 设置内容：特征图 */
  Viewer.prototype.setPlanes = function (planes, opt) {
    opt = opt || {};
    var self = this, i;
    var W = planes[0].w, H = planes[0].h;
    var lut = YV.cmapLUT(opt.cmap || 'viridis');
    var gamma = opt.gamma === undefined ? 1 : opt.gamma;
    var buf = new Uint8ClampedArray(W * H * 4);
    var one = document.createElement('canvas'); one.width = W; one.height = H;
    var octx = one.getContext('2d');
    var img = octx.createImageData(W, H);

    if (opt.grid && planes.length > 1) {
      var cols = 4, rows = Math.ceil(planes.length / cols);
      var cw = cols * (GRID_TILE + GRID_GAP) + GRID_GAP;
      var chh = rows * (GRID_TILE + GRID_GAP) + GRID_GAP;
      this.content.width = cw; this.content.height = chh;
      var c = this.content.getContext('2d');
      c.fillStyle = '#0b0f17'; c.fillRect(0, 0, cw, chh);
      c.imageSmoothingEnabled = false;
      for (i = 0; i < planes.length; i++) {
        YV.colorizeInto(planes[i], lut, gamma, buf);
        img.data.set(buf);
        octx.putImageData(img, 0, 0);
        var cx = GRID_GAP + (i % cols) * (GRID_TILE + GRID_GAP);
        var cy = GRID_GAP + Math.floor(i / cols) * (GRID_TILE + GRID_GAP);
        c.drawImage(one, cx, cy, GRID_TILE, GRID_TILE);
        c.strokeStyle = i === opt.channel ? '#5ee2c5' : 'rgba(120,150,190,0.35)';
        c.lineWidth = i === opt.channel ? 2 : 1;
        c.strokeRect(cx - 0.5, cy - 0.5, GRID_TILE + 1, GRID_TILE + 1);
        c.font = GRID_LABEL + 'px ui-monospace, Consolas, monospace';
        c.fillStyle = i === opt.channel ? '#5ee2c5' : 'rgba(150,175,205,0.8)';
        c.fillText('#' + i, cx + 3, cy + GRID_LABEL);
      }
      this.cellGrid = null;
      this.empty = false;
      this.draw();
      return;
    }

    /* 单通道模式：内容 = 该通道的伪彩色图（可叠加原图） */
    this.content.width = W; this.content.height = H;
    var ctx = this.content.getContext('2d');
    YV.colorizeInto(planes[opt.channel || 0], lut, gamma, buf);
    img.data.set(buf);
    octx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    if (opt.overlay && opt.overlayAlpha > 0) {
      ctx.drawImage(opt.overlay, 0, 0, W, H);
      ctx.globalAlpha = opt.overlayAlpha;
      ctx.drawImage(one, 0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(one, 0, 0, W, H);
    }
    this.cellGrid = this.showGrid ? { w: W, h: H } : null;
    this.empty = false;
    this.draw();
  };

  /* ------------------------------------------------ 设置内容：原始 RGB 图 */
  Viewer.prototype.setRGB = function (source, opt) {
    opt = opt || {};
    this.content.width = source.width;
    this.content.height = source.height;
    var c = this.content.getContext('2d');
    c.clearRect(0, 0, source.width, source.height);
    c.drawImage(source, 0, 0);
    this.cellGrid = null;
    this.empty = false;
    this.draw();
  };

  Viewer.prototype.setEmpty = function () {
    this.empty = true;
    this.content.width = 1; this.content.height = 1;
    this.draw();
  };

  /* ---------------------------------------------------------------- 绘制 */
  Viewer.prototype.draw = function () {
    var ctx = this.ctx, dpr = this.dpr || 1;
    var cw = this.cw || this.cv.width, ch = this.ch || this.cv.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#060910';
    ctx.fillRect(0, 0, cw, ch);
    var g = ctx.createRadialGradient(cw * 0.5, ch * 0.42, 10, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.72);
    g.addColorStop(0, 'rgba(30,52,84,0.55)');
    g.addColorStop(1, 'rgba(6,9,16,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    if (this.empty) {
      ctx.fillStyle = 'rgba(140,165,200,0.55)';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('选择左侧任意一层，查看该层的特征图', cw / 2, ch / 2);
      ctx.textAlign = 'left';
      return;
    }
    var t = this.xform();
    ctx.imageSmoothingEnabled = !this.blocky || t.s < 2.2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.content, t.x, t.y, t.w, t.h);
    if (this.cellGrid && t.s > 9) this.paintCells(ctx, t);
    this.paintAnnotations(ctx, t);
  };

  Viewer.prototype.paintCells = function (ctx, t) {
    var g = this.cellGrid, W = g.w, H = g.h;
    var cw = t.w / W, ch = t.h / H;
    ctx.strokeStyle = 'rgba(160,200,240,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 1; x < W; x++) { var px = Math.round(t.x + x * cw) + 0.5; ctx.moveTo(px, t.y); ctx.lineTo(px, t.y + t.h); }
    for (var y = 1; y < H; y++) { var py = Math.round(t.y + y * ch) + 0.5; ctx.moveTo(t.x, py); ctx.lineTo(t.x + t.w, py); }
    ctx.stroke();
    if (cw > 22 && ch > 18 && W <= 24 && H <= 24) {
      ctx.font = Math.min(14, cw * 0.34) + 'px ui-monospace, Consolas, monospace';
      ctx.fillStyle = 'rgba(190,215,240,0.5)';
      for (var yy = 0; yy < H; yy++) {
        for (var xx = 0; xx < W; xx++) {
          ctx.fillText(xx + ',' + yy, t.x + xx * cw + 4, t.y + yy * ch + Math.min(13, ch * 0.42));
        }
      }
    }
  };

  Viewer.prototype.paintAnnotations = function (ctx, t) {
    var sc = t.w / this.content.width;
    for (var i = 0; i < this.annotations.length; i++) {
      var a = this.annotations[i];
      var x = t.x + a.x * sc, y = t.y + a.y * sc;
      var w = a.w * sc, h = a.h * sc;
      ctx.lineWidth = a.width || 2;
      ctx.strokeStyle = a.color;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      if (a.label) {
        ctx.font = '12px ui-monospace, Consolas, monospace';
        var tw = ctx.measureText(a.label).width + 10;
        var ly = y - 18 < 0 ? y + 2 : y - 18;
        ctx.fillStyle = a.color;
        ctx.fillRect(x, ly, tw, 16);
        ctx.fillStyle = '#06090f';
        ctx.fillText(a.label, x + 5, ly + 12);
      }
    }
    if (this.cellHighlight) {
      var c = this.cellHighlight;
      ctx.strokeStyle = '#5ee2c5';
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x + c.x * sc - 1, t.y + c.y * sc - 1, c.w * sc + 2, c.h * sc + 2);
    }
  };

  /* -------------------------------------------------------------- 交互 */
  Viewer.prototype.toContent = function (clientX, clientY) {
    var r = this.cv.getBoundingClientRect();
    var t = this.xform();
    var s = t.w / this.content.width;
    return { x: (clientX - r.left - t.x) / s, y: (clientY - r.top - t.y) / s, scale: s };
  };

  Viewer.prototype._bind = function () {
    var self = this, dragging = false, lx = 0, ly = 0;
    this.cv.style.cursor = 'grab';
    this.cv.addEventListener('mousedown', function (e) {
      dragging = true; lx = e.clientX; ly = e.clientY;
      self.cv.style.cursor = 'grabbing';
    });
    window.addEventListener('mouseup', function () { dragging = false; self.cv.style.cursor = 'grab'; });
    window.addEventListener('mousemove', function (e) {
      if (dragging) {
        self.tx += e.clientX - lx; self.ty += e.clientY - ly;
        lx = e.clientX; ly = e.clientY;
        self.draw();
      } else if (self.onHover && e.target === self.cv) {
        self.onHover(self.toContent(e.clientX, e.clientY), e);
      }
    });
    this.cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var c = self.toContent(e.clientX, e.clientY);
      var k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      var nz = Math.max(0.5, Math.min(24, self.zoom * k));
      k = nz / self.zoom;
      self.zoom = nz;
      var r = self.cv.getBoundingClientRect();
      var cx = e.clientX - r.left, cy = e.clientY - r.top;
      self.tx = cx - (cx - self.tx) * k;
      self.ty = cy - (cy - self.ty) * k;
      self.draw();
    }, { passive: false });
    this.cv.addEventListener('dblclick', function () { self.reset(); self.draw(); });
  };

  YV.Viewer = Viewer;
  YV.GRID_TILE = GRID_TILE;
})(window.YV);
