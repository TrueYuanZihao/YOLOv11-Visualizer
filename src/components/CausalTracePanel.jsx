import { useEffect, useRef } from 'react';
import { drawCausalTrace } from '../viz/traceOverlay.js';

function TracePreview({ trace, inputCanvas }) {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !trace) return;
    const px = trace.imgsz || 320;
    cv.width = px;
    cv.height = px;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = '#07101c';
    ctx.fillRect(0, 0, px, px);
    if (inputCanvas) ctx.drawImage(inputCanvas, 0, 0, px, px);
    drawCausalTrace(ctx, trace, 1, { labels: true });
  }, [trace, inputCanvas]);

  return <canvas ref={ref} className="trace-preview-canvas" />;
}

export default function CausalTracePanel({ trace, inputCanvas, onOpenGraph, onClear, compact = false }) {
  if (!trace) return null;
  const det = trace.detection;
  return (
    <div className={'panel trace-panel' + (compact ? ' compact' : '')} data-trace-panel>
      <div className="panel-title">
        因果回溯
        <span className="tag trace-tag">{trace.sourceScale} 锚点</span>
        {onClear ? (
          <button type="button" className="trace-clear" onClick={onClear} title="清除回溯">×</button>
        ) : null}
      </div>

      <div className="trace-det">
        <span className="trace-cls">{det.className}</span>
        <b>{(det.score * 100).toFixed(1)}%</b>
        <span>#{det.anchor}</span>
      </div>

      <div className="trace-preview">
        <TracePreview trace={trace} inputCanvas={inputCanvas} />
      </div>

      <div className="trace-anchor-list">
        {trace.anchors.map((a) => (
          <div className={'trace-anchor' + (a.exact ? ' is-source' : '')} key={a.scale}>
            <span className="trace-scale" style={{ color: a.color, borderColor: a.color + '66' }}>{a.scale}</span>
            <b>{a.id}</b>
            <span>{a.gx},{a.gy}</span>
            <span>{a.score == null ? '—' : (a.score * 100).toFixed(1) + '%'}</span>
            <em>{a.exact ? '预测源' : '同位置'}</em>
          </div>
        ))}
      </div>

      <p className="trace-note">
        预测实际来自 {trace.sourceId} 的一个格点；另外两个尺度显示同一图像位置的格点投影。
        虚线框是按 4×stride 估算的近似感受野。
      </p>

      {onOpenGraph ? (
        <button type="button" className="btn trace-openbtn" onClick={onOpenGraph}>
          在网络结构图中查看传播路径
        </button>
      ) : null}
    </div>
  );
}
