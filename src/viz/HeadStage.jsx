/* 检测头阶段画布：层的回放走完 output 之后，接着把
   「2100 个锚点 -> 候选框 -> NMS 抑制 -> 最终框」画在 letterbox 后的输入图上。

   复用 AnchorGrid（与「检测头解剖」同一套画布），所以框的配色与状态含义完全一致：
   绿 = 保留，红虚线 = 被 NMS 压掉，蓝 = 下一步要判定的框，灰 = 还没轮到。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import AnchorGrid from './AnchorGrid.jsx';
import { analyzeOutput, sliceGrid } from '../model/headAnatomy.js';

const SCALE_COLOR = ['#4ea3ff', '#3ee6a4', '#ffb84d'];

export default function HeadStage(props) {
  const {
    stage, boxes, output, imgsz, inputCanvas, classNames,
    colormap = 'viridis', gamma = 1,
  } = props;

  const wrapRef = useRef(null);
  const [width, setWidth] = useState(560);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 560);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const cap = Math.max(200, (window.innerHeight || 900) - 300);

  /* 锚点阶段要按分数给格点着色，这里才算三张尺度的表（其它阶段不需要） */
  const analysis = useMemo(() => {
    if (!stage || stage.kind !== 'anchors' || !output) return null;
    return analyzeOutput(output, imgsz, classNames);
  }, [stage, output, imgsz, classNames]);

  if (!stage) return null;

  if (stage.kind === 'anchors' && analysis) {
    const gap = 12;
    const n = analysis.grids.length;
    const size = Math.max(140, Math.min((width - 30 - gap * (n - 1)) / n, cap));
    return (
      <div className="hstage is-multi" ref={wrapRef}>
        {analysis.grids.map((g, i) => (
          <div className="hstage-cell" key={g.id}>
            <AnchorGrid
              size={size}
              imgsz={imgsz}
              inputCanvas={inputCanvas}
              grid={g}
              plane={sliceGrid(analysis.bestScore, g)}
              planeLabel="最高类分数"
              colormap={colormap}
              gamma={gamma}
              rangeMode="p1p99"
              showCells
              showGrid
              boxes={[]}
            />
            <span className="hstage-cap">
              <b style={{ color: SCALE_COLOR[i] }}>{g.id}</b>
              {' · '}{g.scale} · stride {g.stride} · {g.gw}×{g.gh} = {g.count} 格
            </span>
          </div>
        ))}
      </div>
    );
  }

  const size = Math.max(200, Math.min(width - 30, cap));
  const counts = countStates(boxes);

  return (
    <div className="hstage" ref={wrapRef}>
      <AnchorGrid
        size={size}
        imgsz={imgsz}
        inputCanvas={inputCanvas}
        grid={null}
        showCells={false}
        boxes={boxes || []}
      />
      <div className="hstage-foot">
        <span className="hstage-key"><i className="k-keep" />保留 {counts.keep}</span>
        <span className="hstage-key"><i className="k-drop" />被压掉 {counts.drop}</span>
        <span className="hstage-key"><i className="k-pend" />还没轮到 {counts.pend}</span>
        {counts.now ? <span className="hstage-key"><i className="k-now" />下一步判定 1</span> : null}
        <span className="hstage-key dim">共 {boxes ? boxes.length : 0} 个框</span>
      </div>
    </div>
  );
}

function countStates(boxes) {
  const out = { keep: 0, drop: 0, pend: 0, now: 0 };
  if (!boxes) return out;
  for (const b of boxes) {
    const s = b.state || 'pend';
    if (out[s] === undefined) out[s] = 0;
    out[s] += 1;
  }
  return out;
}