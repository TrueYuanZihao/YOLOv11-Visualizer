/* 网络结构图页面：整屏展示真实计算图，右侧是选中节点的详情。
   点节点 = 选中该层；「回中间看数据」按钮关闭本页，中间的视图就停在这一层上。 */
import { useEffect, useMemo } from 'react';
import GraphView from '../viz/GraphView.jsx';
import { GROUP_COLOR, levelTag } from '../state/graphLayout.js';

function fmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(2);
  return v.toFixed(3);
}

export default function StructureOverlay({
  graph, meta, selectedId, onSelect, onClose, previewUrl, stats, onGoToLayer,
  previewSource, onPreviewSource,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const incoming = useMemo(() => {
    const m = new Map();
    for (const e of graph.edges) {
      if (!m.has(e.to)) m.set(e.to, []);
      m.get(e.to).push(e);
    }
    return m;
  }, [graph]);
  const outgoing = useMemo(() => {
    const m = new Map();
    for (const e of graph.edges) {
      if (!m.has(e.from)) m.set(e.from, []);
      m.get(e.from).push(e);
    }
    return m;
  }, [graph]);
  const skips = useMemo(() => graph.edges.filter((e) => e.kind === 'skip'), [graph]);

  const node = byId.get(selectedId);
  const st = stats ? stats[selectedId] : null;
  const lv = node ? levelTag(node.stride) : null;
  const ins = (incoming.get(selectedId) || []).filter((e) => byId.has(e.from));
  const outs = (outgoing.get(selectedId) || []).filter((e) => byId.has(e.to));

  return (
    <div className="so">
      <header className="so-head">
        <div className="so-title">
          <h2>YOLO11 网络结构图</h2>
          <span className="pill">
            {meta.onnxNodes || '—'} 个算子 · {meta.modules || '—'} 个模块 · {graph.edges.length} 条连边
          </span>
          <span className="pill ok">连边由 ONNX 计算图自动提取</span>
        </div>
        <div className="so-head-right">
          <span className="so-hint">拖背景平移 · 滚轮缩放 · 拖节点摆位 · 点节点选中</span>
          <button type="button" className="btn" onClick={onClose}>关闭 (Esc)</button>
        </div>
      </header>

      <div className="so-body">
        <GraphView graph={graph} selectedId={selectedId} onSelect={onSelect} />

        <aside className="so-detail">
          {!node ? <p className="panel-desc">点击图中任意节点查看该层的输入来源、统计与说明。</p> : null}

          {node ? (
            <>
              <div className="so-node-head">
                <span className="so-dot" style={{ background: GROUP_COLOR[node.group] }} />
                <b>{node.id}</b>
                <span className="tag">{node.block}</span>
                {lv ? <span className="tag lv">{lv} / stride {node.stride}</span> : null}
              </div>

              <div className="so-seg">
                <span>预览</span>
                {[['pca', 'PCA'], ['channel', '单通道'], ['mean', '均值']].map(([v, label]) => (
                  <button
                    type="button" key={v}
                    className={'so-segbtn' + (previewSource === v ? ' is-on' : '')}
                    onClick={() => onPreviewSource(v)}
                  >{label}</button>
                ))}
              </div>
              <div className="so-preview">
                {previewUrl
                  ? <img src={previewUrl} alt={node.id + ' 特征图预览'} />
                  : <span className="so-preview-empty">该层没有可显示的图像网格</span>}
              </div>

              <div className="kv">
                <div><b>张量形状</b><span>{node.shape || '—'}</span></div>
                <div><b>深度 rank</b><span>{node.rank}</span></div>
                {st ? <div><b>均值 / 标准差</b><span>{fmt(st.mean)} / {fmt(st.std)}</span></div> : null}
                {st ? <div><b>最大 / RMS</b><span>{fmt(st.max)} / {fmt(st.rms)}</span></div> : null}
                {st ? <div><b>正值占比</b><span>{(st.active * 100).toFixed(1)}%</span></div> : null}
              </div>

              {node.desc ? <p className="panel-desc">{node.desc}</p> : null}

              <div className="so-links">
                <div className="so-links-title">输入来自（点击跳转）</div>
                {ins.length === 0 ? <span className="muted">无（网络起点）</span> : null}
                {ins.map((e) => (
                  <button type="button" key={e.from + '->' + e.to} className="so-link" onClick={() => onSelect(e.from)}>
                    <b>{e.from}</b>
                    <i>{byId.get(e.from) ? byId.get(e.from).block : ''}</i>
                    <span>{e.shape || '—'}</span>
                    {e.kind === 'skip' ? <em>跳连</em> : null}
                  </button>
                ))}
              </div>

              <div className="so-links">
                <div className="so-links-title">输出流向（点击跳转）</div>
                {outs.length === 0 ? <span className="muted">无（网络终点）</span> : null}
                {outs.map((e) => (
                  <button type="button" key={e.from + '->' + e.to} className="so-link" onClick={() => onSelect(e.to)}>
                    <b>{e.to}</b>
                    <i>{byId.get(e.to) ? byId.get(e.to).block : ''}</i>
                    <span>{byId.get(e.to) ? byId.get(e.to).shape || '' : ''}</span>
                    {e.kind === 'skip' ? <em>跳连</em> : null}
                  </button>
                ))}
              </div>

              <button type="button" className="btn" onClick={() => onGoToLayer(selectedId)}>
                回中间查看这一层的数据
              </button>
            </>
          ) : null}

          <div className="so-skips">
            <div className="so-links-title">跨层跳连（{skips.length} 条）</div>
            <p className="so-hint">
              这些边在左侧列表里是看不到的 —— 颈部 Concat 把骨干不同层级的特征直接搬了过来，
              正是 FPN/PAN 的结构。
            </p>
            {skips.map((e) => (
              <button type="button" key={e.from + '->' + e.to} className="so-skip" onClick={() => onSelect(e.to)}>
                <b>{e.from}</b>
                <span>{byId.get(e.from) ? byId.get(e.from).shape : ''}</span>
                <i>→</i>
                <b>{e.to}</b>
                <span>{byId.get(e.to) ? byId.get(e.to).block : ''}</span>
                <em>跨 {e.span} 层</em>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
