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
import { HEAD_INPUTS } from './model/headAnatomy.js';
import { buildCausalTrace, detectionKey } from './model/causalTrace.js';
import { buildHeadReplay, boxesForStage, HEAD_COLOR } from './model/headReplay.js';
import { GROUP_COLOR } from './state/graphLayout.js';
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
import HeadAnatomy from './components/HeadAnatomy.jsx';
import LayerRelations from './components/LayerRelations.jsx';
import GuidedTour from './components/GuidedTour.jsx';
import CausalTracePanel from './components/CausalTracePanel.jsx';
import { concatBreakdown } from './model/relations.js';

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

const NO_STAGES = [];

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
  const [headOpen, setHeadOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);
  const [relSeed, setRelSeed] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideDone, setGuideDone] = useState(() => {
    try { return window.localStorage.getItem('yolo11-guide-done') === '1'; } catch (err) { return false; }
  });
  const [graphMode, setGraphMode] = useState('arch');
  const [selectedDetKey, setSelectedDetKey] = useState(null);
  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState({ phase: 'boot', text: '正在初始化…' });
  const [error, setError] = useState(null);
  const [imageEl, setImageEl] = useState(null);
  const [imageName, setImageName] = useState('');
  const [pre, setPre] = useState(null);        // { lb, inputCanvas, inputTensor }
  const [result, setResult] = useState(null);  // { id, t0, ms, map }

  const [selId, setSelIdRaw] = useState('m3');
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

  /* 层间关系浮层：seed 决定打开时停在 A/B 还是某条跳连上 */
  const openRelations = useCallback((seed) => {
    setRelSeed(seed || null);
    setRelOpen(true);
  }, []);

  /* ---------- 前向回放：沿 layers 顺序从 input 走到 output，再接上检测头解码 ----------
     层阶段就是换 selId；检测头阶段不是「层」，selId 停在 output，
     由 headIdx 决定中间视口画哪一步（锚点网格 / 候选框 / NMS 抑制 / 最终框）。 */
  const layerIds = useMemo(() => layers.map((l) => l.id), [layers]);
  const layerCount = layerIds.length;
  const [headIdx, setHeadIdx] = useState(null);
  const [replay, setReplay] = useState({ playing: false, speed: 1, touched: false });

  /* 检测头那几个阶段：候选框与 NMS 过程（和「检测头解剖」共用同一份解码） */
  const head = useMemo(() => buildHeadReplay({
    output: result && result.map.output0 ? result.map.output0 : null,
    imgsz: meta ? meta.imgsz : 320,
    conf: viz.conf,
    iou: viz.iou,
  }), [result, meta, viz.conf, viz.iou]);
  const headStages = head ? head.stages : NO_STAGES;
  const headStageIdx = headIdx == null ? null : Math.min(headIdx, Math.max(0, headStages.length - 1));
  const headStage = headStageIdx == null ? null : (headStages[headStageIdx] || null);
  const inHead = headIdx != null;

  const totalStages = layerCount + headStages.length;
  const pos = headIdx == null
    ? Math.max(0, layerIds.indexOf(selId))
    : Math.min(layerCount + (headStageIdx || 0), Math.max(0, totalStages - 1));

  const posRef = useRef(pos);
  posRef.current = pos;
  const layerIdsRef = useRef(layerIds);
  layerIdsRef.current = layerIds;
  const headLenRef = useRef(headStages.length);
  headLenRef.current = headStages.length;

  /* 跳到第 p 个阶段：前 layerCount 个是层，之后是检测头 */
  const goTo = useCallback((p) => {
    const ids = layerIdsRef.current;
    const n = ids.length;
    const total = n + headLenRef.current;
    if (!n || !total) return;
    const q = Math.max(0, Math.min(total - 1, p));
    if (q < n) { setHeadIdx(null); setSelIdRaw(ids[q]); return; }
    setHeadIdx(q - n);
    setSelIdRaw(ids[n - 1]);
  }, []);

  /* 自动播放：每 delay 毫秒推进一个阶段；检测头那几步走得快些（NMS 的一段就是好几步） */
  useEffect(() => {
    if (!replay.playing) return undefined;
    const delay = Math.round((inHead ? 620 : 900) / replay.speed);
    const timer = setInterval(() => {
      const total = layerIdsRef.current.length + headLenRef.current;
      if (posRef.current < total - 1) goTo(posRef.current + 1);
    }, delay);
    return () => clearInterval(timer);
  }, [replay.playing, replay.speed, inHead, goTo]);

  /* 走到最后一个阶段就自动停 */
  useEffect(() => {
    if (replay.playing && totalStages > 0 && pos >= totalStages - 1) {
      setReplay((r) => ({ ...r, playing: false }));
    }
  }, [replay.playing, pos, totalStages]);

  /* 走进检测头阶段时切回 2D：那几步只有 2D 画布画得出来 */
  useEffect(() => {
    if (inHead) setView('2d');
  }, [inHead]);

  const stepStage = useCallback((delta) => {
    goTo(posRef.current + delta);
    setReplay((r) => ({ ...r, touched: true }));
  }, [goTo]);

  const toggleReplay = useCallback(() => {
    if (replay.playing) { setReplay((r) => ({ ...r, playing: false })); return; }
    const total = layerIdsRef.current.length + headLenRef.current;
    if (total && posRef.current >= total - 1) goTo(0);
    setReplay((r) => ({ ...r, playing: true, touched: true }));
  }, [replay.playing, goTo]);

  const seekStage = useCallback((i) => {
    goTo(i);
    setReplay((r) => ({ ...r, playing: false, touched: true }));
  }, [goTo]);

  const setReplaySpeed = useCallback((speed) => setReplay((r) => ({ ...r, speed })), []);

  const resetReplay = useCallback(() => {
    goTo(0);
    setReplay((r) => ({ ...r, playing: false, touched: true }));
  }, [goTo]);

  /* 空格播放/暂停，← → 逐层（走到检测头后这两键继续一步一步走）；浮层打开或焦点在控件里时不抢键 */
  useEffect(() => {
    const onKey = (e) => {
      if (headOpen || structureOpen || relOpen || guideOpen) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight') { stepStage(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { stepStage(-1); e.preventDefault(); }
      else if (e.key === ' ') { toggleReplay(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepStage, toggleReplay, headOpen, structureOpen, relOpen, guideOpen]);

  /* 用回放过以后，左侧列表把已经走过的层标出来（走到检测头阶段时 27 层全亮） */
  const passedIds = useMemo(
    () => (replay.touched ? new Set(layerIds.slice(0, Math.min(pos, layerCount))) : null),
    [replay.touched, layerIds, pos, layerCount],
  );

  /* 手动选层 / 点标签页 = 退出检测头阶段 */
  const setSelId = useCallback((id) => { setHeadIdx(null); setSelIdRaw(id); }, []);

  const selectDetection = useCallback((det) => {
    if (!det) { setSelectedDetKey(null); return; }
    setSelectedDetKey(detectionKey(det));
    setView('2d');
    setHeadIdx(null);
    setSelIdRaw('m23');
    setReplay((r) => (r.playing ? { ...r, playing: false } : r));
    setStructureOpen(true);
  }, []);

  const clearDetection = useCallback(() => setSelectedDetKey(null), []);
  const openCausalGraph = useCallback(() => setStructureOpen(true), []);

  /* ---------- 新手引导 ---------- */
  const closeGuideOverlays = useCallback(() => {
    setHeadOpen(false);
    setStructureOpen(false);
    setRelOpen(false);
  }, []);

  const startGuide = useCallback(() => {
    closeGuideOverlays();
    setSelectedDetKey(null);
    setView('2d');
    setHeadIdx(null);
    setSelIdRaw('m3');
    setReplay((r) => ({ ...r, playing: false }));
    setGuideOpen(true);
  }, [closeGuideOverlays]);

  const leaveGuideStep = useCallback(() => {
    closeGuideOverlays();
    setReplay((r) => (r.playing ? { ...r, playing: false } : r));
  }, [closeGuideOverlays]);

  const enterGuideStep = useCallback((id) => {
    if (id !== 'replay') return;
    goTo(0);
    setReplay((r) => ({ ...r, playing: false, touched: false }));
  }, [goTo]);

  const closeGuide = useCallback(() => {
    setGuideOpen(false);
    leaveGuideStep();
  }, [leaveGuideStep]);

  const finishGuide = useCallback(() => {
    closeGuide();
    setGuideDone(true);
    try { window.localStorage.setItem('yolo11-guide-done', '1'); } catch (err) { /* noop */ }
  }, [closeGuide]);

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

  const selectedDet = useMemo(
    () => (selectedDetKey ? dets.find((d) => detectionKey(d) === selectedDetKey) || null : null),
    [dets, selectedDetKey],
  );
  const causalTrace = useMemo(
    () => (selectedDet && graph ? buildCausalTrace({
      detection: selectedDet,
      imgsz: meta ? meta.imgsz : 320,
      output: result ? result.map.output0 : null,
      graph,
    }) : null),
    [selectedDet, graph, meta, result],
  );

  useEffect(() => {
    setSelectedDetKey(null);
  }, [imageEl, result ? result.id : null]);

  useEffect(() => {
    if (selectedDetKey && !selectedDet) setSelectedDetKey(null);
  }, [selectedDetKey, selectedDet]);

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

  /* 回放条上的阶段：27 个层（按分组上色）+ 检测头那几个阶段（琥珀色，一眼看出不再是层） */
  const replayStages = useMemo(() => {
    const out = layers.map((l) => ({
      id: l.id,
      color: GROUP_COLOR[l.group] || '#8ea0bd',
      label: l.id,
      sub: l.block,
      readout: shapes[l.id] || '',
      title: l.id + ' · ' + l.block + (l.stride ? ' · s' + l.stride : '')
        + (shapes[l.id] ? ' · ' + shapes[l.id] : '') + (l.desc ? ' · ' + l.desc : ''),
    }));
    for (const s of headStages) {
      out.push({
        id: s.key,
        color: s.color || HEAD_COLOR,
        head: true,
        label: s.label,
        sub: s.sub,
        readout: s.readout,
        title: s.desc,
      });
    }
    return out;
  }, [layers, shapes, headStages]);

  /* 检测头阶段该画哪些框、每框什么状态 */
  const headBoxes = useMemo(
    () => (headStage ? boxesForStage(headStage, head, meta ? meta.classNames : null) : null),
    [headStage, head, meta],
  );

  /* 点标签页 = 退出检测头阶段，回到层的视图 */
  const onSetView = useCallback((v) => { setView(v); setHeadIdx(null); }, []);

  /* 中间视口里的入口：选中层若是「多路输入按通道拼接」，就给一条通往层间关系的横幅 */
  const relationCta = useMemo(() => {
    if (!result || !graph || !layer) return null;
    const bd = concatBreakdown(graph, layer.id);
    if (!bd.ok) return null;
    const skip = bd.segments.find((s) => s.skip) || null;
    return {
      info: bd,
      open: () => openRelations(skip
        ? { mode: 'skip', edge: skip.from + '->' + layer.id }
        : { mode: 'ab', pair: { a: bd.segments[0].from, b: layer.id } }),
    };
  }, [result, graph, layer, openRelations]);

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

  /* 检测头解剖的三路输入：m16 / m19 / m22 的缩略图与形状（颈部交给检测头的特征图） */
  const headInputs = useMemo(() => {
    if (!result) return [];
    return HEAD_INPUTS.map((h) => {
      const l = index.byId.get(h.id);
      const t = l ? tensorOf(l) : null;
      if (!t || t.dims.length !== 4) return null;
      const s = shapeOf(t.dims);
      return {
        id: h.id,
        scale: h.scale,
        stride: h.stride,
        block: l.block,
        coords: s.C + '×' + s.H + '×' + s.W,
        count: s.H * s.W,
        url: makeMapCanvas(t, s, {
          source: viz.stackSource, colormap: viz.colormap, gamma: viz.gamma,
          rangeMode: viz.rangeMode, channel: viz.channel,
        }).toDataURL('image/png'),
      };
    }).filter(Boolean);
  }, [result, index, tensorOf, viz.stackSource, viz.colormap, viz.gamma, viz.rangeMode, viz.channel]);

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
        <div className="topbar-mid" data-tour="topbar-actions">
          <button type="button" className="btn" onClick={() => fileRef.current && fileRef.current.click()}>选择图片</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
          <button type="button" className="btn ghost" onClick={useSample}>示例图</button>
          <button
            type="button"
            className={guideDone ? 'guide-btn is-done' : 'guide-btn'}
            disabled={!result || !graph}
            onClick={startGuide}
            title="约 6 分钟，边操作边理解界面"
          >
            <span className="guide-mark">?</span>{guideDone ? '复习引导' : '新手引导'}
          </button>
          <button type="button" className="btn accent" data-tour="head-open" disabled={!result} onClick={() => setHeadOpen(true)}>检测头解剖</button>
          <button type="button" className="btn accent" data-tour="relations-open" disabled={!result || !graph} onClick={() => openRelations(null)}>层间关系</button>
          <button type="button" className="btn accent" data-tour="structure-open" disabled={!graph} onClick={() => setStructureOpen(true)}>网络结构图</button>
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
            passed={passedIds}
          />
        </aside>

        <Viewport
          view={view} setView={onSetView}
          layer={layer} tensor={tensor} shape={shape}
          inputTensor={pre ? pre.inputTensor : null}
          inputCanvas={pre ? pre.inputCanvas : null}
          dets={dets} imgsz={imgsz}
          viz={viz} setViz={setViz}
          energy={energy}
          stackItems={stackItems} stackProgress={stackProgress} stackMode={stackMode}
          onSelect={setSelId} resetSignal={resetSignal}
          isDetectLayer={isDetectLayer}
          onOpenHead={result ? () => setHeadOpen(true) : null}
          onOpenRelation={relationCta ? relationCta.open : null}
          concatInfo={relationCta ? relationCta.info : null}
          replay={{
            stages: replayStages, index: pos, playing: replay.playing,
            speed: replay.speed, touched: replay.touched,
          }}
          headStage={headStage ? {
            stage: headStage,
            boxes: headBoxes,
            output: result ? result.map.output0 : null,
            classNames: meta ? meta.classNames : null,
          } : null}
          onReplayToggle={toggleReplay}
          onReplayStep={stepStage}
          onReplaySeek={seekStage}
          onReplaySpeed={setReplaySpeed}
          onReplayReset={resetReplay}
          version={result ? result.id : 0}
          causalTrace={causalTrace}
          onSelectDet={selectDetection}
          onClearTrace={clearDetection}
          onOpenCausalGraph={openCausalGraph}
        />

        <aside className="col-right" data-tour="right-rail">
          {causalTrace ? (
            <CausalTracePanel
              trace={causalTrace}
              inputCanvas={pre ? pre.inputCanvas : null}
              onOpenGraph={openCausalGraph}
              onClear={clearDetection}
            />
          ) : null}
          <ControlPanel
            viz={viz} setViz={setViz} view={view}
            channelCount={shape ? shape.C : 0}
            isDetectLayer={isDetectLayer}
            busy={status.phase === 'running'}
            onRerun={runInference}
            onResetView={() => setResetSignal((s) => s + 1)}
          />
          <DetectionList
            dets={dets} hist={detHist} imgsz={imgsz}
            selectedKey={selectedDetKey} onSelect={selectDetection}
          />
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

      {headOpen && result && result.map.output0 ? (
        <HeadAnatomy
          output={result.map.output0}
          meta={meta || {}}
          imgsz={imgsz}
          inputCanvas={pre ? pre.inputCanvas : null}
          headInputs={headInputs}
          dets={dets}
          conf={viz.conf}
          iou={viz.iou}
          onConf={(v) => setViz((s) => ({ ...s, conf: v }))}
          onIou={(v) => setViz((s) => ({ ...s, iou: v }))}
          viz={viz}
          onClose={() => setHeadOpen(false)}
          onGoToHead={() => { setHeadOpen(false); setSelId('m23'); }}
        />
      ) : null}

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
          causalTrace={causalTrace}
          inputCanvas={pre ? pre.inputCanvas : null}
          onDissect={(from, to) => {
            setStructureOpen(false);
            openRelations({ mode: 'skip', edge: from + '->' + to });
          }}
        />
      ) : null}

      {relOpen && result && graph ? (
        <LayerRelations
          graph={graph}
          layers={layers}
          imgsz={imgsz}
          inputCanvas={pre ? pre.inputCanvas : null}
          version={result.id}
          byId={index.byId}
          tensorOf={tensorOf}
          seed={relSeed}
          onClose={() => setRelOpen(false)}
          onGoToLayer={(id) => { setRelOpen(false); if (id) setSelId(id); }}
          onOpenHead={result.map.output0 ? () => { setRelOpen(false); setHeadOpen(true); } : null}
        />
      ) : null}

      {guideOpen ? (
        <GuidedTour
          ctx={{
            selId,
            view,
            structureOpen,
            headOpen,
            relOpen,
            replayPlaying: replay.playing,
          }}
          onLeaveStep={leaveGuideStep}
          onStepEnter={enterGuideStep}
          onClose={closeGuide}
          onFinish={finishGuide}
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
