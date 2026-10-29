import { HEAD_INPUTS, scaleGrids, anchorAt } from './headAnatomy.js';
import { ancestorsOf } from '../state/graphLayout.js';

export const TRACE_SCALE_COLORS = {
  P3: '#6ab6ff',
  P4: '#ffb84d',
  P5: '#c78bff',
};

export const TRACE_HEAD_IDS = HEAD_INPUTS.map((h) => h.id);

export function detectionKey(det) {
  if (!det) return null;
  return String(det.classId) + ':' + String(det.anchor);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function classScore(output, index, classId) {
  if (!output || !output.dims || output.dims.length < 3 || classId == null) return null;
  const n = output.dims[2];
  const nc = output.dims[1] - 4;
  if (classId < 0 || classId >= nc) return null;
  return output.data[(4 + classId) * n + index];
}

export function buildCausalTrace({ detection, imgsz = 320, output = null, graph = null }) {
  if (!detection || !imgsz) return null;
  const grids = scaleGrids(imgsz);
  const source = anchorAt(grids, detection.anchor);
  const cx = (detection.x1 + detection.x2) / 2;
  const cy = (detection.y1 + detection.y2) / 2;

  const anchors = grids.map((g) => {
    const isSource = !!(source && source.grid.id === g.id);
    const gx = isSource ? source.gx : clamp(Math.floor(cx / g.stride), 0, g.gw - 1);
    const gy = isSource ? source.gy : clamp(Math.floor(cy / g.stride), 0, g.gh - 1);
    const index = isSource ? detection.anchor : g.offset + gy * g.gw + gx;
    return {
      id: g.id,
      scale: g.scale,
      stride: g.stride,
      gx,
      gy,
      index,
      exact: isSource,
      x: (gx + 0.5) * g.stride,
      y: (gy + 0.5) * g.stride,
      cell: g.stride,
      rf: Math.min(imgsz, g.stride * 4),
      score: classScore(output, index, detection.classId),
      color: TRACE_SCALE_COLORS[g.scale] || '#ffd166',
    };
  });

  const sourceAnchor = anchors.find((a) => a.exact) || anchors[0] || null;
  const edges = graph && Array.isArray(graph.edges)
    ? graph.edges.map((e) => ({ ...e, key: e.key || (e.from + '->' + e.to) }))
    : [];

  const upstream = graph ? ancestorsOf('m23', edges) : { nodes: new Set(), edgeKeys: new Set() };
  const primary = sourceAnchor ? ancestorsOf(sourceAnchor.id, edges) : { nodes: new Set(), edgeKeys: new Set() };
  upstream.nodes.add('m23');
  primary.nodes.add('m23');
  if (sourceAnchor) {
    for (const e of edges) {
      if (e.from === sourceAnchor.id && e.to === 'm23') primary.edgeKeys.add(e.key);
    }
  }

  return {
    key: detectionKey(detection),
    detection,
    imgsz,
    anchors,
    sourceAnchor,
    sourceId: sourceAnchor ? sourceAnchor.id : null,
    sourceScale: sourceAnchor ? sourceAnchor.scale : null,
    headIds: TRACE_HEAD_IDS.filter((id) => upstream.nodes.has(id)),
    rootId: 'm23',
    nodeIds: upstream.nodes,
    edgeKeys: upstream.edgeKeys,
    primaryNodeIds: primary.nodes,
    primaryEdgeKeys: primary.edgeKeys,
  };
}
