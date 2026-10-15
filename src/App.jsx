/* YOLO11 真实权重激活可视化工作坊 —— 主应用
   流程：加载 layers.json -> 初始化 ORT(wasm) -> letterbox 预处理 ->
        一次前向拿到 23 个中间层激活 + output0 -> 解码检测框 -> 各种可视化 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadLayers, loadGraph, buildLayerIndex, MODEL_URL, ORT_WASM_BASE, SAMPLE_URL,
} from './model/layers.js';
import { createSession } from './model/session.js';
import { letterbox, toNCHW } from './model/preprocess.js';
import { decodeDetections, classHistogram } from './model/detect.js';
import {
  shapeOf, layerStats, channelEnergy, extractChannel, reduceChannels,
  planeRange, normalizePlane, pcaComposite,
} from './viz/field.js';
import { planeToCanvas, rgbaToCanvas } from './viz/render.js';
import PipelineList from './components/PipelineList.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import DetectionList from './components/DetectionList.jsx';
import StatPanel from './components/StatPanel.jsx';
import Viewport from './components/Viewport.jsx';
import StructureOverlay from './components/StructureOverlay.jsx';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败：' + src));
    img.src = src;
  });
}

/** 把一张张量画成可直接当贴图用的 canvas */
function makeMapCanvas(tensor, shape, opts) {
  const { C, H, W } = shape;
  const n = H * W;
  if (C <= 3) {
    const rgba = new Uint8ClampedArray(n * 4);
    const planes = [];
    for (let c = 0; c < Math.min(3, C); c++) {
      const plane = extractChannel(tensor.data, C, H, W, c);
      const { lo, hi } = planeRange(plane, 'p1p99');
      planes.push(normalizePlane(plane, lo, hi));
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        const p = planes[Math.min(c, planes.length - 1)];
        rgba[i * 4 + c] = (p[i] * 255) | 0;
      }
      rgba[i * 4 + 3] = 255;
    }
    return rgbaToCanvas(rgba, W, H);
  }
  if (opts.source === 'pca') {
    const { rgba } = pcaComposite(tensor.data, C, H, W, { gamma: opts.gamma });
    return rgbaToCanvas(rgba, W, H);
  }
  const plane = opts.source === 'channel'
    ? extractChannel(tensor.data, C, H, W, Math.min(opts.channel, C - 1))
    : reduceChannels(tensor.data, C, H, W, 'mean');
  const { lo, hi } = planeRange(plane, opts.rangeMode);
  return planeToCanvas(normalizePlane(plane, lo, hi), W, H, {
    colormap: opts.colormap, gamma: opts.gamma, lo: 0, hi: 1,
  });
}

const DEFAULT_VIZ = {
  colormap: 'viridis',
  gamma: 1,
  rangeMode: 'p1p99',
  mapMode: 'channel',
  channel: 0,
  overlay: true,
  showBoxes: true,
  conf: 0.25,
  iou: 0.45,
  explode: 1,
  heightScale: 1,
  stackChannels: 16,
  stackSource: 'pca',
  autoRotate: false,
  threads: 0,
};

export default function App() {
  const [layers, setLayers] = useState([]);
  const [graph, setGraph] = useState(null);
  const [structureOpen, setStructureOpen] = useState(false);
  const [graphMode, setGraphMode] = useState('arch');
  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState({ phase: 'boot', text: '正在初始化…' });
  const [error, setError] = useState(null);
  const [imageEl, setImageEl] = useState(null);
  const [imageName, setImageName] = useState('');
  const [pre, setPre] = useState(null);        // { lb, inputCanvas, inputTensor }
  const [result, setResult] = useState(null);  // { id, t0, ms, map }

  const [selId, setSelId] = useState('m3');
  const [view, setView] = useState('2d');
  const [viz, setViz] = useState(DEFAULT_VIZ);
  const [stackItems, setStackItems] = useState([]);
  const [stackProgress, setStackProgress] = useState(1);
  const [resetSignal, setResetSignal] = useState(0);

  const sessionRef = useRef(null);
  const indexRef = useRef({ byId: new Map(), byTensor: new Map() });
  const runIdRef = useRef(0);
  const busyRef = useRef(false);
  const fileRef = useRef(null);

  const index = useMemo(() => buildLayerIndex(layers), [layers]);
  indexRef.current = index;

  const imgsz = meta ? meta.imgsz : 320;

  /* ---------- 启动：结构 -> 模型 -> 样例图 ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setStatus({ phase: 'meta', text: '读取模型结构 layers.json …' });
        const data = await loadLayers();
        if (!alive) return;
        setMeta(data.meta);
        setLayers(data.layers);
        try {
          const g = await loadGraph();
          if (alive) setGraph(g);
        } catch (gErr) {
          console.warn('[boot] graph.json 缺失，结构图不可用：', gErr.message);
        }
        setStatus({ phase: 'model', text: '加载 yolo11n_vis.onnx（10.6 MB）并初始化 wasm 后端 …' });
        const sess = await createSession({
          modelUrl: MODEL_URL(),
          wasmPaths: ORT_WASM_BASE(),
          numThreads: Math.min(4, navigator.hardwareConcurrency || 1),
        });
        if (!alive) return;
        sessionRef.current = sess;
        setViz((v) => ({ ...v, threads: sess.info.threads }));
        setStatus({ phase: 'image', text: '加载示例图片 …' });
        const img = await loadImage(SAMPLE_URL());
        if (!alive) return;
        setImageName('street.jpg（示例）');
        setImageEl(img);
        setStatus({ phase: 'ready', text: '模型与图片就绪' });
      } catch (err) {
        if (!alive) return;
        setError(err.message || String(err));
        setStatus({ phase: 'error', text: err.message || String(err) });
      }
    })();
    return () => { alive = false; };
  }, []);
  /* ---------- 预处理 ---------- */
  useEffect(() => {
    if (!imageEl || !meta) return;
    const lb = letterbox(imageEl, meta.imgsz);
    const { data, dims } = toNCHW(lb.canvas);
    setPre({ lb, inputCanvas: lb.canvas, inputTensor: { dims, data } });
  }, [imageEl, meta]);

  const preRef = useRef(null);
  const metaRef = useRef(null);
  preRef.current = pre;
  metaRef.current = meta;

  /* ---------- 一次真实前向 ---------- */
  const runInference = useCallback(async () => {
    const sess = sessionRef.current;
    const p = preRef.current;
    if (!sess || !p || busyRef.current) return;
    const id = ++runIdRef.current;
    busyRef.current = true;
    setStatus({ phase: 'running', text: '正在执行前向传播（CPU / wasm）…' });
    try {
      const t0 = performance.now();
      const outs = await sess.run(p.inputTensor.data.slice(), p.inputTensor.dims);
      const ms = performance.now() - t0;
      if (id !== runIdRef.current) return;
      setResult({ id, ms, map: outs });
      setStatus({
        phase: 'done',
        text: '前向完成 · ' + ms.toFixed(0) + ' ms · 拿到 ' + Object.keys(outs).length + ' 个张量',
      });
    } catch (err) {
      setError(err.message || String(err));
      setStatus({ phase: 'error', text: err.message || String(err) });
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => { if (pre && sessionRef.current) runInference(); }, [pre, runInference]);

  /* ---------- 解码检测框（只依赖原始输出，改阈值不用重跑网络） ---------- */
  const dets = useMemo(() => {
    if (!result || !meta || !result.map.output0) return [];
    return decodeDetections(result.map.output0, {
      conf: viz.conf, iou: viz.iou, classNames: meta.classNames,
    });
  }, [result, meta, viz.conf, viz.iou]);

  const detHist = useMemo(() => classHistogram(dets), [dets]);

  /* ---------- 每一层的形状与统计 ---------- */
  const tensorOf = useCallback((layer) => {
    if (!layer || !result) return null;
    if (layer.id === 'input') return pre ? pre.inputTensor : null;
    if (layer.tensor === 'images') return result.map.images || null;
    if (layer.tensor === 'output0') return result.map.output0 || null;
    return result.map[layer.tensor] || null;
  }, [result, pre]);

  const { shapes, stats } = useMemo(() => {
    const sh = {};
    const st = {};
    if (result && layers.length) {
      for (const l of layers) {
        const t = tensorOf(l);
        if (!t) continue;
        const s = shapeOf(t.dims);
        sh[l.id] = t.dims.length === 3 ? t.dims[1] + ' × ' + t.dims[2] : s.C + '×' + s.H + '×' + s.W;
        st[l.id] = layerStats(t.data);
      }
    }
    return { shapes: sh, stats: st };
  }, [result, layers, tensorOf]);

  /* 激活强度条：把检测头的超大 logits 排除在外，否则其它层全被压平 */
  const rmsMax = useMemo(() => {
    let m = 0;
    for (const [id, s] of Object.entries(stats)) {
      const l = index.byId.get(id);
      if (l && l.tensor === 'output0') continue;
      if (s.rms > m) m = s.rms;
    }
    return m;
  }, [stats, index]);

  /* 每个节点的上游来源（给左侧列表标注多路输入的 Concat / Detect） */
  const incoming = useMemo(() => {
    const m = new Map();
    if (!graph) return m;
    for (const e of graph.edges) {
      if (!m.has(e.to)) m.set(e.to, []);
      m.get(e.to).push(e.from);
    }
    return m;
  }, [graph]);


  const layer = index.byId.get(selId) || null;
  const tensor = useMemo(() => tensorOf(layer), [tensorOf, layer]);
  const shape = useMemo(() => (tensor && tensor.dims.length === 4 ? shapeOf(tensor.dims) : null), [tensor]);
  const isDetectLayer = !!(layer && layer.tensor === 'output0');

  /* 结构图右侧的缩略预览：和 3D 切片用的是同一套渲染 */
  const previewUrl = useMemo(() => {
    if (!tensor || !shape || shape.C < 1 || shape.H * shape.W < 4) return null;
    const cv = makeMapCanvas(tensor, shape, {
      source: viz.stackSource, colormap: viz.colormap, gamma: viz.gamma,
      rangeMode: viz.rangeMode, channel: viz.channel,
    });
    return cv.toDataURL('image/png');
  }, [tensor, shape, viz.stackSource, viz.colormap, viz.gamma, viz.rangeMode, viz.channel]);

  const energy = useMemo(() => {
    if (!tensor || !shape || shape.C < 2 || shape.H * shape.W < 4) return null;
    return channelEnergy(tensor.data, shape.C, shape.H, shape.W);
  }, [tensor, shape]);

  useEffect(() => {
    if (shape && viz.channel > shape.C - 1) setViz((v) => ({ ...v, channel: 0 }));
  }, [shape, viz.channel]);
  /* ---------- 3D 堆叠切片：分批构建，避免一次性卡住界面 ---------- */
  useEffect(() => {
    if (view !== 'pyramid' || !result || !meta) return undefined;
    const jobs = [];
    for (const l of layers) {
      if (l.id === 'input') {
        if (!pre) continue;
        jobs.push(() => ({
          key: 'input', label: 'input', sub: '3×' + imgsz + '×' + imgsz,
          H: imgsz, W: imgsz, size: 8, canvas: pre.inputCanvas, plane: null,
        }));
        continue;
      }
      const t = tensorOf(l);
      if (!t || t.dims.length !== 4) continue;
      const s = shapeOf(t.dims);
      if (s.H * s.W < 4 || s.C < 1) continue;
      const size = 2 + 6 * Math.sqrt(s.H / imgsz);
      jobs.push(() => ({
        key: l.id, label: l.id, sub: s.C + '×' + s.H + '×' + s.W,
        H: s.H, W: s.W, size,
        canvas: makeMapCanvas(t, s, {
          source: viz.stackSource, colormap: viz.colormap, gamma: viz.gamma,
          rangeMode: viz.rangeMode, channel: viz.channel,
        }),
        plane: null,
      }));
    }
    return scheduleJobs(jobs, setStackItems, setStackProgress);
  }, [view, result, pre, layers, meta, tensorOf, imgsz, viz.stackSource, viz.colormap, viz.gamma, viz.rangeMode, viz.channel]);

  useEffect(() => {
    if (view !== 'channels') return undefined;
    if (!tensor || !shape || shape.C < 2) { setStackItems([]); setStackProgress(1); return undefined; }
    const { C, H, W } = shape;
    const k = Math.min(viz.stackChannels, C);
    const order = energy ? topChannelsSafe(energy, k) : Array.from({ length: k }, (_, i) => i);
    const jobs = order.map((c) => () => {
      const plane = extractChannel(tensor.data, C, H, W, c);
      const { lo, hi } = planeRange(plane, viz.rangeMode);
      const norm = normalizePlane(plane, lo, hi);
      return {
        key: 'ch' + c, label: 'ch' + c,
        sub: energy ? 'E ' + energy[c].toFixed(2) : '',
        H, W, size: 6,
        canvas: planeToCanvas(norm, W, H, {
          colormap: viz.colormap, gamma: viz.gamma, lo: 0, hi: 1,
        }),
        plane: norm,
      };
    });
    return scheduleJobs(jobs, setStackItems, setStackProgress);
  }, [view, tensor, shape, energy, viz.stackChannels, viz.colormap, viz.gamma, viz.rangeMode]);

  /* ---------- 换图 ---------- */
  const useSample = useCallback(async () => {
    try {
      const img = await loadImage(SAMPLE_URL());
      setImageName('street.jpg（示例）');
      setImageEl(img);
      setResult(null);
      setStackItems([]);
    } catch (err) { setError(err.message); }
  }, []);

  const onFile = useCallback(async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImage(url);
      setImageName(f.name);
      setImageEl(img);
      setResult(null);
      setStackItems([]);
    } catch (err) { setError(err.message); }
    finally { URL.revokeObjectURL(url); }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !fileRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    fileRef.current.files = dt.files;
    fileRef.current.dispatchEvent(new Event('change', { bubbles: true }));
  }, []);

  const stackMode = view === 'channels' ? 'channels' : 'pyramid';

  const onPickChannel = useCallback((c) => {
    setViz((v) => ({ ...v, channel: c, mapMode: 'channel' }));
  }, []);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">YOLO11</span>
          <div>
            <h1>特征激活可视化工作坊</h1>
            <p>真实预训练权重 · 逐层激活 · 3D 特征堆叠</p>
          </div>
        </div>
        <div className="topbar-mid">
          <button type="button" className="btn" onClick={() => fileRef.current && fileRef.current.click()}>选择图片</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          <button type="button" className="btn ghost" onClick={useSample}>示例图</button>
          <button type="button" className="btn accent" disabled={!graph} onClick={() => setStructureOpen(true)}>网络结构图</button>
          <span className="pill" title="也可以把图片直接拖到页面上">{imageName || '未选择图片'}</span>
        </div>
        <div className="topbar-right">
          {meta ? <span className="pill">imgsz {meta.imgsz}</span> : null}
          {meta ? <span className="pill">{meta.nc} 类 COCO</span> : null}
          <span className={'pill ' + phaseClass(status.phase)} title={error || status.text}>{status.text}</span>
        </div>
      </header>

      {error ? <div className="errbar">⚠ {error}</div> : null}

      <main className="layout">
        <aside className="col-left">
          <PipelineList
            layers={layers} selectedId={selId} onSelect={setSelId}
            shapes={shapes} stats={stats} rmsMax={rmsMax}
            incoming={incoming} onOpenGraph={graph ? () => setStructureOpen(true) : null}
          />
        </aside>

        <Viewport
          view={view} setView={setView}
          layer={layer} tensor={tensor} shape={shape}
          inputTensor={pre ? pre.inputTensor : null}
          inputCanvas={pre ? pre.inputCanvas : null}
          dets={dets} imgsz={imgsz}
          viz={viz} setViz={setViz}
          energy={energy}
          stackItems={stackItems} stackProgress={stackProgress} stackMode={stackMode}
          onSelect={setSelId} resetSignal={resetSignal}
          isDetectLayer={isDetectLayer}
          version={result ? result.id : 0}
        />

        <aside className="col-right">
          <ControlPanel
            viz={viz} setViz={setViz} view={view}
            channelCount={shape ? shape.C : 0}
            isDetectLayer={isDetectLayer}
            busy={status.phase === 'running'}
            onRerun={runInference}
            onResetView={() => setResetSignal((s) => s + 1)}
          />
          <DetectionList dets={dets} hist={detHist} imgsz={imgsz} />
          <StatPanel
            layer={layer}
            shape={shape}
            shapeText={shapes[selId]}
            stats={stats[selId]}
            energy={energy}
            channel={viz.channel}
            onPickChannel={onPickChannel}
          />
        </aside>
      </main>

      {structureOpen && graph ? (
        <StructureOverlay
          graph={graph}
          meta={{ ...graph.meta, ...(meta || {}) }}
          selectedId={selId}
          onSelect={setSelId}
          onClose={() => setStructureOpen(false)}
          previewUrl={previewUrl}
          previewSource={viz.stackSource}
          onPreviewSource={(m) => setViz((v) => ({ ...v, stackSource: m }))}
          stats={stats}
          onGoToLayer={() => setStructureOpen(false)}
          graphMode={graphMode}
          onGraphMode={setGraphMode}
        />
      ) : null}
    </div>
  );
}

function topChannelsSafe(energy, k) {
  const idx = Array.from(energy.keys());
  idx.sort((a, b) => energy[b] - energy[a]);
  return idx.slice(0, k);
}

function phaseClass(phase) {
  if (phase === 'error') return 'bad';
  if (phase === 'ready' || phase === 'done') return 'ok';
  return 'warn';
}

function scheduleJobs(jobs, commit, onProgress) {
  let cancelled = false;
  let i = 0;
  const items = new Array(jobs.length);
  onProgress(jobs.length ? 0 : 1);
  const step = () => {
    if (cancelled) return;
    const t0 = performance.now();
    while (i < jobs.length && performance.now() - t0 < 22) {
      items[i] = jobs[i]();
      i++;
    }
    onProgress(jobs.length ? i / jobs.length : 1);
    if (i < jobs.length) setTimeout(step, 0);
    else commit(items);
  };
  step();
  return () => { cancelled = true; };
}