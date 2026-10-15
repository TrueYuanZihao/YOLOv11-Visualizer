/* 网络结构图：把 YOLO11 的真实计算图（含 neck 的跨层跳连）画成可交互的二维图。
   - 滚轮缩放 / 拖背景平移 / 拖节点自由摆放
   - 点节点 = 选中该层；选中后高亮它的全部上游依赖路径
   - 跨层跳连自动用虚线 + 不同颜色标出（rank 跨度 > 1） */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildLayout, buildArchLayout, edgePath, archEdgePath, ancestorsOf, descendantsOf,
  GROUP_COLOR, ROW_LABELS, levelTag, blockColor, BLOCK_COLOR,
} from '../state/graphLayout.js';

const MIN_K = 0.18;
const MAX_K = 3;

export default function GraphView({ graph, selectedId, onSelect, layoutKey, mode = 'arch' }) {
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const fittedRef = useRef(false);

  const layout = useMemo(
    () => (mode === 'arch' ? buildArchLayout(graph) : buildLayout(graph, layoutKey)),
    [graph, layoutKey, mode],
  );
  const [offsets, setOffsets] = useState({});
  const [view, setView] = useState({ x: 0, y: 0, k: 0.75 });
  const [hoverId, setHoverId] = useState(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });

  useEffect(() => {
    fittedRef.current = false;
    setOffsets({});
  }, [layout, mode]);

  const nodes = useMemo(() => layout.nodes.map((n) => {
    const o = offsets[n.id];
    return o ? { ...n, x: n.x + o.dx, y: n.y + o.dy } : n;
  }), [layout, offsets]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const edges = useMemo(() => layout.edges.map((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const route = layout.arch ? archEdgePath : edgePath;
    return { ...e, a, b, geo: route(a, b), len: Math.hypot(b.x - a.x, b.y - a.y) };
  }), [layout, byId]);

  const hot = useMemo(
    () => (selectedId ? ancestorsOf(selectedId, layout.edges) : null),
    [selectedId, layout.edges],
  );
  const cold = useMemo(
    () => (selectedId ? descendantsOf(selectedId, layout.edges) : null),
    [selectedId, layout.edges],
  );

  /* ---------- 视图尺寸与自动取景 ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const measure = () => {
      const w = host.clientWidth || 1000;
      const h = host.clientHeight || 700;
      setSize({ w, h });
      if (!fittedRef.current) {
        fittedRef.current = true;
        const k = clamp(Math.min((w - 24) / layout.width, (h - 24) / layout.height), MIN_K, 1.1);
        setView({ x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2, k });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [layout]);

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth || size.w;
    const h = host.clientHeight || size.h;
    const k = clamp(Math.min((w - 24) / layout.width, (h - 24) / layout.height), MIN_K, 1.1);
    setView({ x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2, k });
    setOffsets({});
  }, [layout, size]);

  /* ---------- 滚轮缩放（必须用非 passive 监听才能 preventDefault） ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0014), MIN_K, MAX_K);
        const r = k / v.k;
        return { k, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
      });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (f) => setView((v) => {
    const k = clamp(v.k * f, MIN_K, MAX_K);
    const r = k / v.k;
    return { k, x: size.w / 2 - (size.w / 2 - v.x) * r, y: size.h / 2 - (size.h / 2 - v.y) * r };
  });

  /* ---------- 拖拽（背景平移 / 节点移动） ---------- */
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const host = hostRef.current;
    const el = e.target && e.target.closest ? e.target.closest('[data-node-id]') : null;
    try { host.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    if (el) {
      const id = el.getAttribute('data-node-id');
      const start = offsets[id] || { dx: 0, dy: 0 };
      dragRef.current = { kind: 'node', id, sx: e.clientX, sy: e.clientY, ox: start.dx, oy: start.dy, moved: 0 };
    } else {
      dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: 0 };
    }
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    } else {
      const k = view.k;
      setOffsets((o) => ({ ...o, [d.id]: { dx: d.ox + dx / k, dy: d.oy + dy / k } }));
    }
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { hostRef.current.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
    if (d && d.kind === 'node' && d.moved < 5) onSelect(d.id);
  };


  const detail = view.k >= 0.62;
  const showId = view.k >= 0.34;
  const focusId = hoverId || selectedId;
  const focusNode = hoverId ? byId.get(hoverId) : null;

  return (
    <div
      className="graphview"
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg className="graph-svg" width={size.w} height={size.h}>
        <defs>
          <marker id="gv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#5b6f8f" />
          </marker>
          <marker id="gv-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#4ea3ff" />
          </marker>
        </defs>

        <g transform={'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')'}>
          {/* 行背景带 */}
          {layout.arch ? (
            <g className="gv-archbg">
              {layout.bands.map((b) => (
                <g key={'band' + b.key}>
                  <rect
                    className="gv-bandrect"
                    x={layout.gutter - 96} y={b.y}
                    width={layout.width - 34} height={b.h} rx={9}
                    fill={b.strong ? 'rgba(78,163,255,0.055)' : 'rgba(126,146,182,0.032)'}
                  />
                  <text className="gv-bandlabel" x={layout.gutter - 24} y={b.y + b.h / 2 - 8} textAnchor="end">{b.label}</text>
                  <text className="gv-bandtag" x={layout.gutter - 24} y={b.y + b.h / 2 + 7} textAnchor="end">{b.tag}</text>
                  <text className="gv-bandtag" x={layout.gutter - 24} y={b.y + b.h / 2 + 21} textAnchor="end">{b.res}</text>
                </g>
              ))}
              {layout.lanes.map((l) => (
                <g key={'lane' + l.key} className="gv-lane">
                  <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={12} />
                  <text className="gv-lanetitle" x={l.x + l.w / 2} y={l.y - 26} textAnchor="middle">{l.label}</text>
                  <text className="gv-lanesub" x={l.x + l.w / 2} y={l.y - 11} textAnchor="middle">{l.sub}</text>
                </g>
              ))}
            </g>
          ) : ROW_LABELS.slice(0, layout.rowCount).map((label, r) => (
            <g key={'row' + r}>
              <rect
                x={0} y={layout.rowY[r] - 36}
                width={layout.width} height={layout.nodeH + 72}
                rx={10} fill={r % 2 ? 'rgba(62,230,164,0.030)' : 'rgba(78,163,255,0.032)'}
              />
              <text className="gv-rowlabel" x={10} y={layout.rowY[r] - 46}>{label}</text>
            </g>
          ))}

          {/* 连边 */}
          {edges.map((e) => {
            const isHot = !!(hot && hot.edgeKeys.has(e.key));
            const isCold = !!(cold && cold.edgeKeys.has(e.key) && !isHot);
            const isFocus = e.from === focusId || e.to === focusId;
            const cls = 'gv-edge' + (e.kind === 'skip' ? ' is-skip' : '')
              + (isHot ? ' is-hot' : '') + (isCold ? ' is-cold' : '')
              + (isFocus ? ' is-focus' : '') + (selectedId && !isHot && !isCold && !isFocus ? ' is-dim' : '');
            return (
              <g key={e.key} className={cls}>
                <path d={e.geo.d} markerEnd={isHot || isFocus ? 'url(#gv-arrow-hot)' : 'url(#gv-arrow)'} />
                {(e.kind === 'skip' || (detail && isFocus && e.len > 150)) && e.shape ? (
                  <g className="gv-elabel" transform={'translate(' + e.geo.mid[0] + ',' + e.geo.mid[1] + ')'}>
                    <rect x={-38} y={-9} width={76} height={17} rx={5} />
                    <text x={0} y={3} textAnchor="middle">{e.shape}</text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* 节点 */}
          {nodes.map((n) => {
            const color = layout.arch
              ? (n.color || blockColor(n.block))
              : (GROUP_COLOR[n.group] || '#8ea0bd');
            const isSel = n.id === selectedId;
            const isHotNode = !!(hot && hot.nodes.has(n.id));
            const cls = 'gv-node' + (isSel ? ' is-selected' : '')
              + (!isSel && isHotNode ? ' is-hot' : '')
              + (selectedId && !isSel && !isHotNode ? ' is-dim' : '');
            const lv = levelTag(n.stride);
            return (
              <g
                key={n.id}
                data-node-id={n.id}
                className={cls}
                transform={'translate(' + n.x + ',' + n.y + ')'}
                style={layout.arch ? { '--nc': color, '--nc-soft': color + '1f' } : undefined}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
              >
                <rect className="gv-box" width={n.w} height={n.h} rx={9} />
                <rect className="gv-accent" width={4} height={n.h} rx={2} fill={color} />
                {showId ? <text className="gv-id" x={14} y={detail ? 21 : 29}>{n.id}</text> : null}
                {detail ? <text className="gv-block" x={14} y={36}>{n.block}</text> : null}
                {n.shape && detail ? (
                  <text className="gv-shape" x={n.w - 8} y={21} textAnchor="end">{n.shape}</text>
                ) : null}
                {lv ? <text className="gv-level" x={n.w - 8} y={38} textAnchor="end">{lv}/s{n.stride}</text> : null}
                {!detail ? <text className="gv-id-mini" x={n.w / 2} y={n.h / 2 + 4} textAnchor="middle">{n.id.replace(/^m/, '')}</text> : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="graph-tools">
        <button type="button" onClick={() => zoomBy(1.25)} title="放大">＋</button>
        <button type="button" onClick={() => zoomBy(0.8)} title="缩小">－</button>
        <button type="button" onClick={fit} title="适应窗口">适应</button>
        <span className="graph-zoom">{Math.round(view.k * 100)}%</span>
      </div>

      <div className="graph-legend">
        {layout.arch ? (
          <>
            {['Conv', 'C3k2', 'SPPF', 'Upsample', 'Concat', 'Detect'].map((b) => (
              <span key={b}><i style={{ background: BLOCK_COLOR[b] }} />{b}</span>
            ))}
            <span className="sep" />
            <span><i className="line" />顺序连接</span>
            <span><i className="line dash" />跨层跳连</span>
          </>
        ) : (
          <>
            <span><i style={{ background: GROUP_COLOR.backbone }} />骨干</span>
            <span><i style={{ background: GROUP_COLOR.neck }} />颈部</span>
            <span><i style={{ background: GROUP_COLOR.head }} />检测头</span>
            <span className="sep" />
            <span><i className="line" />顺序连接</span>
            <span><i className="line dash" />跨层跳连</span>
          </>
        )}
      </div>

      {focusNode ? (
      <div className="graph-tip" style={{ left: 12, top: 12 }}>
          <b>{focusNode.id} · {focusNode.block}</b>
          <span>{focusNode.shape || '—'}{focusNode.stride ? ' · s' + focusNode.stride : ''}</span>
          {focusNode.desc ? <p>{focusNode.desc}</p> : null}
          {layout.incoming.get(focusNode.id) && layout.incoming.get(focusNode.id).length > 1 ? (
            <em>多路输入：{layout.incoming.get(focusNode.id).join(' + ')}</em>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}