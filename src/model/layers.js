/* 资源路径 + layers.json 加载与索引 */

export function assetUrl(p) {
  return new URL(import.meta.env.BASE_URL + p, window.location.href).href;
}

export const MODEL_URL = () => assetUrl('models/yolo11n_vis.onnx');
export const ORT_WASM_BASE = () => assetUrl('ort/');
export const SAMPLE_URL = () => assetUrl('samples/street.jpg');

export async function loadLayers() {
  const res = await fetch(assetUrl('models/layers.json'));
  if (!res.ok) throw new Error('layers.json 加载失败：HTTP ' + res.status);
  return res.json();
}

/** 真实计算图（tools/export_graph.py 从 ONNX 提取） */
export async function loadGraph() {
  const res = await fetch(assetUrl('models/graph.json'));
  if (!res.ok) throw new Error('graph.json 加载失败：HTTP ' + res.status);
  return res.json();
}

/** layers.json 有 27 个条目；能直接拿到激活张量的只有 pre / m0..m23 / output。 */
export function buildLayerIndex(layers) {
  const byId = new Map();
  const byTensor = new Map();
  for (const l of layers) {
    byId.set(l.id, l);
    if (l.tensor && l.tensor !== 'images') byTensor.set(l.tensor, l);
  }
  return { byId, byTensor };
}

export function groupLabel(g) {
  if (g === 'input') return '输入';
  if (g === 'backbone') return '主干 Backbone';
  if (g === 'neck') return '颈部 Neck';
  if (g === 'head') return '检测头 Head';
  if (g === 'output') return '输出';
  return g;
}