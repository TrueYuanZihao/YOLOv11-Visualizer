/* 检测头解剖：把「特征图 → 锚点 → 分类分数 → 阈值 → NMS → 检测框」这条链路摊开。

   左边是四个步骤，中间是那块 2100 个格点的画布，右边是当前
   「选中格点」的真实读数 —— 全部来自同一次前向的 output0，
   和界面上显示的检测框是同一份数据（都走 model/detect.js 的解码）。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import AnchorGrid from '../viz/AnchorGrid.jsx';
import { decodeCandidates, nmsTrace } from '../model/detect.js';
import {
  scaleGrids, analyzeOutput, classPlane, anchorDetail, anchorAt, sliceGrid,
  BOX_CHANNELS, DFL_BINS,
} from '../model/headAnatomy.js';

const STAGES = [
  {
    key: 'branches',
    title: '特征图 → 分支',
    desc: '三路不同分辨率的特征图，各自独立地预测框和类别。',
  },
  {
    key: 'anchors',
    title: '锚点网格',
    desc: '把 N 个格点铺回图像：每个格点独立预测一个框和一套类别分数。',
  },
  {
    key: 'filter',
    title: '置信度筛选',
    desc: '先按分数过一遍阈值。一个目标周围的多个格点会同时响应，此时都还留着。',
  },
  {
    key: 'nms',
    title: 'NMS 抑制',
    desc: '同类框互相重叠时只留分数最高的那个，被压掉的框在这里逐个退场。',
  },
];

const SCALE_COLOR = ['#4ea3ff', '#3ee6a4', '#ffb84d'];

export default function HeadAnatomy(props) {
  const {
    output, meta, imgsz, inputCanvas, headInputs = [], dets = [],
    conf, iou, onConf, onIou, viz, onClose, onGoToHead,
  } = props;

  const classNames = (meta && meta.classNames) || [];
  const [stage, setStage] = useState('branches');
  const [scale, setScale] = useState(0);
  const [mode, setMode] = useState('best');
  const [clsId, setClsId] = useState(-1);
  const [sel, setSel] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [nmsStep, setNmsStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const clsName = (id) => classNames[id] || '#' + id;

  /* ---------- 输出张量的三张总表：最高类分数、类别排行、每格读数 ---------- */
  const analysis = useMemo(
    () => analyzeOutput(output, imgsz, classNames),
    [output, imgsz, classNames],
  );
  const grids = analysis.grids.length ? analysis.grids : scaleGrids(imgsz);
  const grid = grids[Math.min(scale, grids.length - 1)];

  useEffect(() => {
    if (clsId < 0 && analysis.ranked.length) setClsId(analysis.ranked[0].id);
  }, [analysis, clsId]);

  /* ---------- 解码两步：候选框 -> NMS（与主界面共用同一份实现） ---------- */
  const candRes = useMemo(
    () => decodeCandidates(output, { conf, preNmsTop: 300 }),
    [output, conf],
  );
  const trace = useMemo(
    () => nmsTrace(candRes.cands, { iou, maxDet: 100 }),
    [candRes, iou],
  );

  useEffect(() => { setNmsStep(0); setPlaying(false); }, [conf, iou, output]);
  useEffect(() => {
    if (playing && nmsStep >= trace.log.length) setPlaying(false);
  }, [playing, nmsStep, trace]);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => setNmsStep((s) => s + 1), 620);
    return () => clearInterval(id);
  }, [playing]);

  /* ---------- 当前格点热力图：最高类分数 或 指定类的概率 ---------- */
  const plane = useMemo(() => {
    if (!output || !grid) return null;
    if (mode === 'class' && clsId >= 0) return sliceGrid(classPlane(output, clsId), grid);
    return analysis.bestScore ? sliceGrid(analysis.bestScore, grid) : null;
  }, [output, grid, mode, clsId, analysis]);

  const pos = useMemo(() => (sel == null ? null : anchorAt(grids, sel)), [grids, sel]);
  const detail = useMemo(
    () => (sel == null || !output ? null : anchorDetail(output, sel, classNames)),
    [sel, output, classNames],
  );
  const selCand = useMemo(
    () => (sel == null ? -1 : candRes.cands.findIndex((c) => c.anchor === sel)),
    [sel, candRes],
  );

  /* ---------- NMS 回放：第 step 步时每个候选框的状态 ---------- */
  const nmsStates = useMemo(() => {
    const st = new Array(candRes.cands.length).fill('pend');
    const log = trace.log;
    for (let s = 0; s < Math.min(nmsStep, log.length); s++) {
      st[log[s].keep] = 'keep';
      for (const k of log[s].kills) st[k] = 'drop';
    }
    if (nmsStep < log.length) st[log[nmsStep].keep] = 'now';
    return st;
  }, [candRes, trace, nmsStep]);

  /* ---------- 画布上的框：随步骤切换含义 ---------- */
  const boxes = useMemo(() => {
    const out = [];
    if (stage === 'anchors') {
      /* 锚点阶段只把最终结果淡淡画出来当参照 */
      for (const d of dets) out.push({ ...d, state: 'keep', label: '' });
      return out;
    }
    if (stage === 'filter') {
      const cands = candRes.cands;
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        const isSel = selCand === i;
        out.push({
          ...c,
          state: isSel ? 'now' : 'pend',
          label: isSel || i < 5 ? clsName(c.classId) + ' ' + (c.score * 100).toFixed(0) + '%' : '',
        });
      }
      return out;
    }
    if (stage === 'nms') {
      const cands = candRes.cands;
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        const st = nmsStates[i];
        out.push({
          ...c,
          state: st,
          label: st === 'keep' || st === 'now'
            ? clsName(c.classId) + ' ' + (c.score * 100).toFixed(0) + '%'
            : '',
        });
      }
      return out;
    }
    return out;
  }, [stage, dets, candRes, nmsStates, selCand, classNames]);

  const selectedCell = pos && pos.scale === scale ? { gx: pos.gx, gy: pos.gy } : null;
  const selectedBox = detail && pos && pos.scale === scale
    ? { x1: detail.cx - detail.w / 2, y1: detail.cy - detail.h / 2, x2: detail.cx + detail.w / 2, y2: detail.cy + detail.h / 2 }
    : null;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* 画布随中间栏尺寸走，方图不超出可视区域 */
  const centerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState(520);
  useEffect(() => {
    const el = centerRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth || 560;
      setCanvasSize(Math.max(260, Math.min(w - 34, (window.innerHeight || 900) - 232)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  /* 左侧步骤卡上的实时数字 */
  const stepCount = (key) => {
    if (key === 'branches') return '3 路输入 → ' + (BOX_CHANNELS + analysis.nc) + ' 通道';
    if (key === 'anchors') return analysis.n + ' 个格点';
    if (key === 'filter') return candRes.cands.length + ' 个候选';
    return trace.keep.length + ' / ' + candRes.cands.length + ' 保留';
  };

  const onPickCell = (cell) => {
    if (!cell || !grid) { setSel(null); return; }
    setSel(grid.offset + cell.index);
  };

  const stageInfo = STAGES.find((s) => s.key === stage) || STAGES[0];

  const rankMax = analysis.ranked.length ? analysis.ranked[0].max : 1;
  const hitClasses = new Set(dets.map((d) => d.classId));
  const topPlane = detail && detail.top.length ? detail.top[0].p || 1 : 1;

  /* 第一步用「这张图里分数最高的那个格点」当例子，把抽象数字落到具体位置 */
  const strongest = useMemo(() => {
    if (!output || !candRes.cands.length) return null;
    const c = candRes.cands[0];
    return { cand: c, pos: anchorAt(grids, c.anchor), detail: anchorDetail(output, c.anchor, classNames, 3) };
  }, [output, candRes, grids, classNames]);

  return (
    <div className="dh">
      <header className="dh-head">
        <div className="dh-title">
          <h2>检测头解剖</h2>
          <span className="pill">YOLO11 Detect · 真实权重</span>
          <span className="pill">{imgsz} × {imgsz}</span>
          <span className="pill">
            {grids.length} 个尺度 · {analysis.n} 个锚点 · 每个锚点 {BOX_CHANNELS + analysis.nc} 个数
          </span>
        </div>
        <div className="dh-head-right">
          <span className="so-hint">点格点读它的预测 · 拖滑杆改阈值不用重跑网络</span>
          {onGoToHead ? (
            <button type="button" className="btn ghost" onClick={onGoToHead}>回中间看 m23</button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>关闭 (Esc)</button>
        </div>
      </header>

      <div className="dh-body">
        <aside className="dh-flow">
          {STAGES.map((s, i) => (
            <button
              type="button"
              key={s.key}
              className={'dh-step' + (stage === s.key ? ' is-on' : '')}
              onClick={() => setStage(s.key)}
            >
              <span className="dh-step-no">{i + 1}</span>
              <span className="dh-step-body">
                <b>{s.title}</b>
                <i>{s.desc}</i>
                <em>{stepCount(s.key)}</em>
              </span>
            </button>
          ))}
          <p className="dh-flow-note">
            检测头不会「生成」网格：它只是对特征图的每个位置各做一次预测。
            40×40 就有 1600 个位置，每处给出 84 个数，三个尺度加起来 {analysis.n} 个锚点。
          </p>
        </aside>

        <section className="dh-center" ref={centerRef}>
          <div className="dh-stagebar">
            <h3>{stageInfo.title}</h3>
            <p>{stageInfo.desc}</p>
          </div>
          {stage === 'branches' ? (
            <BranchDiagram headInputs={headInputs} nc={analysis.nc} n={analysis.n} />
          ) : (
            <div className="dh-canvaswrap">
              <AnchorGrid
                size={canvasSize}
                imgsz={imgsz}
                inputCanvas={inputCanvas}
                grid={grid}
                plane={plane}
                planeLabel={mode === 'class'
                  ? '类别「' + clsName(clsId) + '」的概率（按百分位拉伸）'
                  : '锚点最高类分数（按 1%–99% 分位）'}
                colormap={viz.colormap}
                gamma={viz.gamma}
                rangeMode="p1p99"
                showCells={stage !== 'nms'}
                showGrid={showGrid}
                boxes={boxes}
                selected={stage === 'nms' ? null : selectedCell}
                selectedBox={stage === 'nms' ? null : selectedBox}
                onPick={onPickCell}
                version={nmsStep + (stage === 'filter' ? 7 : 0)}
              />
              <div className="dh-canvashint">
                {grid ? grid.scale + ' · stride ' + grid.stride + ' · ' + grid.gw + '×' + grid.gh + ' = ' + grid.count + ' 个格点' : ''}
                {' · 每个格子 = 图像上 ' + (grid ? grid.stride : 0) + '×' + (grid ? grid.stride : 0) + ' 像素的一块'}
              </div>
            </div>
          )}
        </section>

        <aside className="dh-side">
          <div className="panel">
            <div className="panel-title">
              选中格点
              <span className="tag">{sel == null ? '未选' : '#' + sel}</span>
            </div>
            {!detail || !pos ? (
              <p className="panel-desc">
                在图上点任意一个格子，这里会给出它的 4 个框回归量和 80 个类别分数 ——
                这就是「一个锚点」的全部内容。
              </p>
            ) : (
              <>
                <div className="kv">
                  <div><b>所属尺度</b><span>{pos.grid.scale} / stride {pos.grid.stride}</span></div>
                  <div><b>格点坐标</b><span>({pos.gx}, {pos.gy}) / {pos.grid.gw}×{pos.grid.gh}</span></div>
                  <div><b>中心 cx, cy</b><span>{fmt(detail.cx)}, {fmt(detail.cy)}</span></div>
                  <div><b>宽高 w, h</b><span>{fmt(detail.w)} × {fmt(detail.h)}</span></div>
                </div>
                <div className="chan-list">
                  <div className="chan-title">类别分数（该格点最高的 8 个，点击换热力图）</div>
                  {detail.top.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={'chan-row' + (mode === 'class' && s.id === clsId ? ' is-selected' : '')}
                      onClick={() => { setMode('class'); setClsId(s.id); }}
                    >
                      <span className="chan-name">{s.name}</span>
                      <span className="chan-bar"><i style={{ width: Math.max(2, (s.p / topPlane) * 100) + '%' }} /></span>
                      <span className="chan-val">{pct(s.p)}</span>
                    </button>
                  ))}
                </div>
                <div className="panel-sub">这个格点的命运</div>
                <p className="panel-desc dh-fate">{fateText(selCand, candRes.cands, trace, clsName)}</p>
              </>
            )}
          </div>

          {stage === 'branches' ? (
            <div className="panel">
              <div className="panel-title">三路输入<span className="tag">颈部 → 检测头</span></div>
              <p className="panel-desc">
                检测头自己不做特征提取：它把颈部给的三张特征图分别投影成预测，
                每一路都独立完成「框回归 + 分类」，这就是解耦检测头（decoupled head）。
              </p>
              {headInputs.map((h, i) => (
                <div className="dh-inrow" key={h.id}>
                  <span className="dh-swatch" style={{ background: SCALE_COLOR[i] }} />
                  <b>{h.id}</b>
                  <span className="tag">{h.scale}/s{h.stride}</span>
                  <span className="dh-inrow-shape">{h.coords}</span>
                  <span className="dh-inrow-n">{h.count} 格</span>
                </div>
              ))}
              <div className="panel-sub">每个格点预测什么</div>
              <div className="kv">
                <div><b>框回归</b><span>4 方向 × {DFL_BINS} bin = 64 通道</span></div>
                <div><b>类别分数</b><span>{analysis.nc} 通道 · sigmoid</span></div>
                <div><b>一个格点</b><span>{BOX_CHANNELS + analysis.nc} 个数</span></div>
                <div><b>全部格点</b><span>{analysis.n} × {BOX_CHANNELS + analysis.nc}</span></div>
              </div>
              {strongest ? (
                <>
                  <div className="panel-sub">拿这张图里分数最高的格点举例</div>
                  <div className="kv">
                    <div>
                      <b>它落在</b>
                      <span>{strongest.pos ? strongest.pos.grid.scale + ' · 格点 (' + strongest.pos.gx + ', ' + strongest.pos.gy + ')' : '—'}</span>
                    </div>
                    <div>
                      <b>解析出的框</b>
                      <span>{fmt(strongest.detail.cx)}, {fmt(strongest.detail.cy)} · {fmt(strongest.detail.w)}×{fmt(strongest.detail.h)}</span>
                    </div>
                    <div>
                      <b>判成</b>
                      <span>{strongest.detail.best.name} · {pct(strongest.detail.best.p)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      if (!strongest.pos) return;
                      setScale(strongest.pos.scale);
                      setSel(strongest.cand.anchor);
                      setStage('anchors');
                    }}
                  >在网格里定位这个格点</button>
                </>
              ) : null}
            </div>
          ) : null}

          {stage === 'anchors' ? (
            <div className="panel">
              <div className="panel-title">锚点网格</div>
              <Seg
                label="尺度（决定格子大小）"
                value={String(scale)}
                onChange={(v) => { setScale(Number(v)); setSel(null); }}
                options={grids.map((g, i) => ({ value: String(i), label: g.scale + ' ' + g.gw + '×' + g.gh }))}
              />
              <Seg
                label="着色"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'best', label: '最高类分数' },
                  { value: 'class', label: '指定类概率' },
                ]}
              />
              <Check label="显示网格线" value={showGrid} onChange={setShowGrid} />
              <div className="chan-title">类别排行（最高的 12 个，点击换热力图）</div>
              <div className="chan-list">
                {analysis.ranked.slice(0, 12).map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={'chan-row' + (mode === 'class' && r.id === clsId ? ' is-selected' : '')}
                    onClick={() => { setMode('class'); setClsId(r.id); }}
                    title={'该类最高分出现在格点 #' + r.anchor}
                  >
                    <span className="chan-name">{r.name}</span>
                    <span className="chan-bar"><i style={{ width: Math.max(2, (r.max / rankMax) * 100) + '%' }} /></span>
                    <span className="chan-val">
                      {hitClasses.has(r.id) ? <i className="dh-hit" title="出现在最终检测结果里" /> : null}
                      {pct(r.max)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="panel-desc">带绿点的是最终检测结果里出现过的类 —— 其余高分格点都被 NMS 当作重复框压掉了。</p>
              <p className="panel-desc">
                每个格子都是独立的一次预测。格子越大，说明这一路的感受野越大：
                P3 的格子看 8×8 像素，P5 的格子看 32×32 像素，所以小目标归 P3、大目标归 P5。
              </p>
            </div>
          ) : null}

          {stage === 'filter' ? (
            <div className="panel">
              <div className="panel-title">置信度筛选<span className="tag">{candRes.cands.length} 个候选</span></div>
              <Slider
                label="置信度阈值" value={conf} min={0.05} max={0.9} step={0.01} onChange={onConf}
                hint="候选 = 分数 ≥ 阈值的格点；改它只重算解码，不重跑网络"
              />
              <div className="kv">
                <div><b>全部格点</b><span>{analysis.n}</span></div>
                <div><b>过阈值</b><span>{candRes.cands.length}{candRes.cands.length >= 300 ? '（截断到 300）' : ''}</span></div>
                <div>
                  <b>最高分</b>
                  <span>{candRes.cands.length ? clsName(candRes.cands[0].classId) + ' ' + (candRes.cands[0].score * 100).toFixed(1) + '%' : '—'}</span>
                </div>
              </div>
              <div className="chan-title">分数最高的候选（点一行，图上定位它的框）</div>
              <div className="det-list">
                {candRes.cands.slice(0, 14).map((c) => (
                  <button
                    type="button"
                    key={c.anchor}
                    className={'det-row dh-detbtn' + (sel === c.anchor ? ' is-selected' : '')}
                    onClick={() => { const p = anchorAt(grids, c.anchor); if (p) { setScale(p.scale); setSel(c.anchor); } }}
                  >
                    <span className="det-cls">{clsName(c.classId)}</span>
                    <span className="det-score">{(c.score * 100).toFixed(1)}%</span>
                    <span className="det-box">#{c.anchor}</span>
                  </button>
                ))}
              </div>
              <p className="panel-desc">
                数量是关键：一个目标周围的许多格子会同时响应，框还互相叠着 ——
                这正是下一步 NMS 要处理的问题。
              </p>
            </div>
          ) : null}

          {stage === 'nms' ? (
            <div className="panel">
              <div className="panel-title">NMS 抑制回放<span className="tag">{trace.keep.length} / {candRes.cands.length}</span></div>
              <Slider label="NMS IoU 阈值" value={iou} min={0.1} max={0.9} step={0.01} onChange={onIou} hint="IoU 超过它就算重复框" />
              <Slider
                label="回放进度" value={nmsStep} min={0} max={trace.log.length} step={1}
                onChange={(v) => { setPlaying(false); setNmsStep(v); }}
                hint={'第 ' + nmsStep + ' / ' + trace.log.length + ' 步'}
              />
              <div className="dh-nmsctl">
                <button type="button" className="btn ghost" onClick={() => { setPlaying(false); setNmsStep((s) => Math.max(0, s - 1)); }}>◀ 上一步</button>
                <button type="button" className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 暂停' : '▶ 自动播放'}</button>
                <button type="button" className="btn ghost" onClick={() => { setPlaying(false); setNmsStep((s) => Math.min(trace.log.length, s + 1)); }}>下一步 ▶</button>
              </div>
              <div className="chan-title">抑制日志</div>
              <div className="dh-log">
                {trace.log.length === 0 ? (
                  <p className="panel-desc">当前阈值下一个候选都没有，把置信度调低再看。</p>
                ) : null}
                {trace.log.slice(0, nmsStep + 1).map((e, i) => (
                  <div className={'dh-logrow' + (i === nmsStep - 1 ? ' is-now' : '')} key={'step' + i}>
                    <span className="dh-logstep">{i + 1}</span>
                    <span className="dh-logbox">
                      <b>{clsName(candRes.cands[e.keep].classId)}</b>
                      <em>#{candRes.cands[e.keep].anchor} · {(candRes.cands[e.keep].score * 100).toFixed(0)}%</em>
                    </span>
                    <span className="dh-logkill">{e.kills.length ? '压掉 ' + e.kills.length + ' 个' : '无重叠'}</span>
                  </div>
                ))}
              </div>
              <p className="panel-desc">
                绿色 = 保留，红色虚线 = 被压掉，蓝色 = 当前正在判定的那个框。
                每一步都从剩下的框里挑分数最高的，把和它重叠超过 IoU 阈值的同类框全部移除。
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      <div className="dh-funnel">
        <span className="dh-fnode"><b>{grids.length}</b><i>张特征图</i></span>
        <span className="dh-farrow">→</span>
        <span className="dh-fnode"><b>{analysis.n}</b><i>个锚点 × {BOX_CHANNELS + analysis.nc} 个数</i></span>
        <span className="dh-farrow">→</span>
        <span className={'dh-fnode' + (candRes.cands.length ? ' is-hot' : '')}>
          <b>{candRes.cands.length}</b><i>分数 ≥ {conf.toFixed(2)}</i>
        </span>
        <span className="dh-farrow">→</span>
        <span className="dh-fnode is-ok"><b>{trace.keep.length}</b><i>NMS 之后保留</i></span>
        <span className="dh-fnote">左侧每一步点进去都能看到这一段的真实数据</span>
      </div>
    </div>
  );
}

/** 某个候选框的最终归宿：进候选了没、被谁压掉、还是留了下来 */
function fateText(idx, cands, trace, clsName) {
  if (idx < 0) return '这个格点的分数没到阈值，连候选都不是 —— 阈值筛掉的就是这种格点。';
  const c = cands[idx];
  const by = trace.by[idx];
  if (by >= 0) {
    const killer = cands[by];
    return '被 NMS 压掉了：它和 #' + killer.anchor + '（' + clsName(killer.classId) + ' '
      + (killer.score * 100).toFixed(0) + '%）高度重叠，同类只能留一个。';
  }
  const at = trace.keep.indexOf(idx);
  if (at >= 0) return '保留为最终检测框：第 ' + (at + 1) + ' 个被 NMS 接受的框，'
    + clsName(c.classId) + ' ' + (c.score * 100).toFixed(1) + '%。';
  return '还没轮到它：前面的框都没能把它压掉。';
}

/** 第一步的示意图：三路特征图 -> 两条分支 -> 拼成一个预测向量 */
function BranchDiagram({ headInputs, nc, n }) {
  if (!headInputs.length) return <div className="empty">还没有推理结果。</div>;
  return (
    <div className="dh-branches">
      {headInputs.map((h, i) => (
        <div className="dh-bcard" key={h.id}>
          <div className="dh-bcard-top">
            {h.url ? <img src={h.url} alt={h.id + ' 特征图'} /> : <span className="dh-bthumb-empty" />}
            <div className="dh-bcard-meta">
              <b style={{ color: SCALE_COLOR[i] }}>{h.scale} / stride {h.stride}</b>
              <span>{h.id} · {h.coords}</span>
              <span>{h.count} 个格点</span>
            </div>
          </div>
          <div className="dh-bcard-body">
            <div className="dh-bbox">
              <b>框回归 64 通道</b>
              <span>4 个方向 × {DFL_BINS} 个 bin（DFL）→ 4 个数</span>
            </div>
            <div className="dh-bbox">
              <b>类别分数 {nc} 通道</b>
              <span>每个格点 {nc} 个 sigmoid 概率</span>
            </div>
          </div>
          <div className="dh-bcard-foot">{BOX_CHANNELS + nc} 个数 × {h.count} 个格点</div>
        </div>
      ))}
      <p className="dh-branches-note">
        三路拼起来就是网络输出的那个张量：[1, {BOX_CHANNELS + nc}, {n}]。
        每一路用自己的 stride 负责一类尺度 —— 这也是为什么同一个目标会被多个尺度同时看到。
      </p>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, hint }) {
  return (
    <label className="ctl">
      <span className="ctl-label">{label}<b>{step >= 1 ? value : value.toFixed(2)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint ? <span className="ctl-hint">{hint}</span> : null}
    </label>
  );
}

function Seg({ label, value, options, onChange }) {
  return (
    <div className="ctl">
      <span className="ctl-label">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button type="button" key={o.value}
            className={'seg-btn' + (value === o.value ? ' is-on' : '')}
            onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function Check({ label, value, onChange }) {
  return (
    <label className="ctl check">
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function fmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(2);
  return v.toFixed(1);
}

/** 类别分数：sigmoid 之后大多是极小值，太小时改用科学计数，免得全显示 0.0% */
function pct(p) {
  if (!(p > 0)) return '0';
  if (p >= 0.01) return (p * 100).toFixed(1) + '%';
  if (p >= 0.0001) return (p * 100).toFixed(2) + '%';
  return p.toExponential(1);
}
