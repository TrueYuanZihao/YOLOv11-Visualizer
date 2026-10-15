/* 层间关系：A/B 对比 + 跳连拆解。

   这一页回答的都是「层与层之间」的问题，而不是「某一层长什么样」：
   - A/B 对比：同一张图、同一次前向，两块画布共用缩放/平移/探针，
     专门看 Upsample 和 Concat 前后「同一块图像区域被两层各自怎么看」。
   - 跳连拆解：跨层跳连把哪一层搬到了哪一层，目标层里哪一段通道来自源层，
     并用真实激活验证「Concat 就是逐通道拷贝」。

   通道归属来自 graph.json 的连边顺序（= ONNX 算子输入顺序），不是猜的；
   能量占比、逐通道差值都是这一次前向的真数。 */
import { useEffect, useMemo, useState } from 'react';
import SyncPair from '../viz/SyncPair.jsx';
import { layerStats } from '../viz/field.js';
import { COLORMAPS, COLORMAP_LABELS } from '../viz/colormap.js';
import {
  chwOf, concatBreakdown, compareChannelBlock, describePair, edgesInto,
  segmentEnergy, skipEdges,
} from '../model/relations.js';

const SKIP_REASON = {
  single: '这一层只有一个输入，没有可以拆分的通道段。',
  unknown: '连边上的张量形状缺失，无法判断是不是通道拼接。',
  spatial: '多路输入的空间尺寸不同 —— 这是并行的三条分支，不是按通道拼接，拆不出通道段。',
  mismatch: '各路通道数之和与输出通道数对不上，不能按输入顺序切分。',
};

const SEG_COLORS = ['#4ea3ff', '#3ee6a4', '#ffb84d', '#c78bff', '#ff8fa3'];
const OUT_COLOR = '#c78bff';

export default function LayerRelations(props) {
  const {
    graph, layers, imgsz, inputCanvas, version, byId, tensorOf,
    seed, onClose, onGoToLayer, onOpenHead,
  } = props;

  const skips = useMemo(() => (graph ? skipEdges(graph) : []), [graph]);
  const [mode, setMode] = useState(seed && seed.mode === 'skip' ? 'skip' : 'ab');
  const [skipKey, setSkipKey] = useState(
    (seed && seed.edge) || (skips[0] ? skips[0].from + '->' + skips[0].to : null),
  );
  const [pair, setPair] = useState((seed && seed.pair) || { a: 'm10', b: 'm11' });
  const [segFrom, setSegFrom] = useState(null);
  const [targetScope, setTargetScope] = useState('seg');
  const [source, setSource] = useState('mean');
  const [channel, setChannel] = useState(0);
  const [colormap, setColormap] = useState('viridis');
  const [gamma, setGamma] = useState(1);
  const [rangeMode, setRangeMode] = useState('p1p99');
  const [sharedRange, setSharedRange] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showImage, setShowImage] = useState(false);
  const [abClip, setAbClip] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* ---------- 层 -> 张量 / 形状 ---------- */
  const metaOf = (id) => {
    const layer = id ? byId.get(id) || null : null;
    const tensor = layer ? tensorOf(layer) : null;
    const shape = tensor ? chwOf(tensor) : null;
    return {
      id, layer, tensor, shape,
      text: shape
        ? shape.C + '×' + shape.H + '×' + shape.W
        : (layer && Array.isArray(layer.shape) ? layer.shape.join('×') : ((layer && layer.shape) || '—')),
      block: layer ? layer.block : '',
    };
  };

  const options = useMemo(() => layers.map((l) => {
    const t = tensorOf(l);
    const s = t ? chwOf(t) : null;
    if (!s) return null;
    return { id: l.id, block: l.block, shape: s, text: s.C + '×' + s.H + '×' + s.W };
  }).filter(Boolean), [layers, tensorOf]);

  /* ---------- 常见对照：直接从真实的 Upsample / Concat 连边推出来 ---------- */
  const presets = useMemo(() => {
    if (!graph) return [];
    const has = new Set(options.map((o) => o.id));
    const out = [];
    const seen = new Set();
    const push = (a, b, hint) => {
      if (!a || !b || a === b || !has.has(a) || !has.has(b)) return;
      const key = a + '->' + b;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ a, b, hint });
    };
    for (const l of layers) {
      if (l.block !== 'Upsample') continue;
      const src = edgesInto(graph, l.id).find((e) => e.kind === 'main');
      if (src) push(src.from, l.id, 'Upsample 前后');
    }
    for (const l of layers) {
      if (l.block !== 'Concat') continue;
      const ins = edgesInto(graph, l.id);
      if (ins.length > 1) push(ins[0].from, l.id, 'Concat 前后（第 1 路）');
      const skip = ins.find((e) => e.kind === 'skip');
      if (skip) push(skip.from, l.id, '跳连汇入 Concat');
    }
    push('m2', 'm22', '浅层 vs 深层');
    push('m4', 'm16', '骨干 vs 颈部输出');
    return out;
  }, [graph, layers, options]);

  /* ---------- 跳连模式的数据 ---------- */
  const edge = useMemo(
    () => skips.find((e) => e.from + '->' + e.to === skipKey) || skips[0] || null,
    [skips, skipKey],
  );
  const breakdown = useMemo(
    () => (edge && graph ? concatBreakdown(graph, edge.to) : { ok: false, reason: 'single', segments: [] }),
    [graph, edge],
  );
  const seg = useMemo(() => {
    if (!breakdown.ok) return null;
    if (segFrom) return breakdown.segments.find((s) => s.from === segFrom) || null;
    return breakdown.segments.find((s) => s.from === (edge && edge.from)) || breakdown.segments[0];
  }, [breakdown, segFrom, edge]);

  const aMeta = mode === 'skip' ? metaOf(seg ? seg.from : (edge && edge.from)) : metaOf(pair.a);
  const bMeta = mode === 'skip' ? metaOf(edge && edge.to) : metaOf(pair.b);

  const segRows = useMemo(() => {
    if (!breakdown.ok || !bMeta.tensor) return [];
    const total = segmentEnergy(bMeta.tensor, 0, bMeta.shape.C) || 1;
    return breakdown.segments.map((s) => ({
      ...s,
      energy: segmentEnergy(bMeta.tensor, s.start, s.end),
      share: segmentEnergy(bMeta.tensor, s.start, s.end) / total,
    }));
  }, [breakdown, bMeta.tensor, bMeta.shape]);

  const verify = useMemo(() => {
    if (!seg || !aMeta.tensor || !bMeta.tensor) return null;
    return compareChannelBlock(aMeta.tensor, bMeta.tensor, seg);
  }, [seg, aMeta.tensor, bMeta.tensor]);

  const restRange = useMemo(() => {
    if (!seg || !bMeta.shape) return null;
    if (seg.start === 0) return [seg.end, bMeta.shape.C];
    if (seg.end === bMeta.shape.C) return [0, seg.start];
    return null;
  }, [seg, bMeta.shape]);

  /* A/B 模式下，B 若正好拼接了 A，就可以只显示来自 A 的那一段通道 */
  const pairConcat = useMemo(
    () => (mode === 'ab' && graph ? concatBreakdown(graph, pair.b) : { ok: false, segments: [] }),
    [mode, graph, pair.b],
  );
  const pairSeg = useMemo(
    () => (pairConcat.ok ? pairConcat.segments.find((s) => s.from === pair.a) || null : null),
    [pairConcat, pair.a],
  );
  const abClipVerify = useMemo(
    () => (pairSeg && aMeta.tensor && bMeta.tensor
      ? compareChannelBlock(aMeta.tensor, bMeta.tensor, pairSeg) : null),
    [pairSeg, aMeta.tensor, bMeta.tensor],
  );

  /* ---------- 两块画布要画什么 ---------- */
  const items = useMemo(() => {
    const effSource = (s) => (s && s.C <= 3 ? 'rgb' : source);
    const asItem = (m, key, color, extra) => ({
      key, label: m.id, sub: m.text, color, tag: m.block,
      tensor: m.tensor, shape: m.shape, source: effSource(m.shape), channel,
      empty: m.shape ? null : (m.id === 'm23' || (m.layer && m.layer.tensor === 'output0')
        ? '检测头输出是 [1, 84, 2100] 的向量集，没有图像网格'
        : '这一层在本次推理里没有拿到 4D 激活张量'),
      ...extra,
    });

    if (mode === 'skip' && edge) {
      const a = asItem(aMeta, 'a', '#3ee6a4');
      const b = asItem(bMeta, 'b', OUT_COLOR);
      if (targetScope === 'seg' && seg) {
        b.source = 'seg';
        b.segRange = [seg.start, seg.end];
        b.tag = '通道 ' + seg.start + '–' + (seg.end - 1);
      } else if (targetScope === 'rest' && restRange) {
        b.source = 'seg';
        b.segRange = restRange;
        b.tag = '其余通道 ' + restRange[0] + '–' + (restRange[1] - 1);
      } else if (targetScope === 'all') {
        b.tag = bMeta.block;
      }
      return [a, b];
    }

    const a = asItem(aMeta, 'a', '#4ea3ff');
    const b = asItem(bMeta, 'b', OUT_COLOR);
    if (abClip && pairSeg) {
      b.source = 'seg';
      b.segRange = [pairSeg.start, pairSeg.end];
      b.tag = '只取来自 ' + pair.a + ' 的通道 ' + pairSeg.start + '–' + (pairSeg.end - 1);
    }
    return [a, b];
  }, [mode, edge, aMeta, bMeta, source, channel, targetScope, seg, restRange, abClip, pairSeg, pair]);

  const stats = useMemo(() => [aMeta, bMeta].map((m) => (m.tensor ? layerStats(m.tensor.data) : null)),
    [aMeta, bMeta]);
  const digest = useMemo(() => describePair(aMeta.shape, bMeta.shape), [aMeta.shape, bMeta.shape]);

  const pickSeg = (s) => {
    setSegFrom(s.from);
    setTargetScope('seg');
    setChannel(0);
  };

  const stage = mode === 'skip' && edge ? {
    title: edge.from + '  →  ' + edge.to + '：这条跳连带过来了什么',
    desc: '左边是跳连的源层，右边是汇入的那一层。目标是 Concat 时，可以只显示「来自源层的那一段通道」—— 数值上它应当和源层完全一样。',
  } : {
    title: pair.a + '  →  ' + pair.b,
    desc: '两块画布显示的是同一块图像区域上的两层特征图。分辨率不同就说明采样密度不同，缩放和平移是联动的。',
  };

  const segShare = seg ? (segRows.find((s) => s.from === seg.from) || {}).share : null;
  const footNote = mode === 'skip'
    ? (breakdown.ok ? '通道归属按 ONNX 算子输入顺序切分，逐通道差值可验证' : '这一层拆不出通道段')
    : '预设组合由真实连边推出，探针同时读两块画布';

  return (
    <div className="lr">
      <header className="lr-head">
        <div className="lr-title">
          <h2>层间关系</h2>
          <span className="pill">A/B 对比 · 跳连拆解</span>
          <span className="pill ok">连边与通道顺序来自 ONNX 计算图</span>
          <span className="pill dim">{skips.length} 条跨层跳连 · {options.length} 层可对比</span>
        </div>
        <div className="lr-head-right">
          <div className="so-modes">
            {[['ab', 'A/B 对比'], ['skip', '跳连拆解']].map(([v, label]) => (
              <button
                type="button" key={v}
                className={'so-segbtn' + (mode === v ? ' is-on' : '')}
                onClick={() => setMode(v)}
              >{label}</button>
            ))}
          </div>
          <span className="so-hint">滚轮缩放 · 拖拽平移 · 鼠标移到图上同时读两块画布</span>
          <button type="button" className="btn" onClick={onClose}>关闭 (Esc)</button>
        </div>
      </header>

      <div className="lr-body">
        <aside className="lr-side">
          {mode === 'ab' ? (
            <>
              <div className="panel">
                <div className="panel-title">选择两层<span className="tag">同一张图 · 同一次前向</span></div>
                <label className="ctl">
                  <span className="ctl-label">A（左）</span>
                  <select value={pair.a} onChange={(e) => setPair((p) => ({ ...p, a: e.target.value }))}>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.block} · {o.text}</option>)}
                  </select>
                </label>
                <label className="ctl">
                  <span className="ctl-label">B（右）</span>
                  <select value={pair.b} onChange={(e) => setPair((p) => ({ ...p, b: e.target.value }))}>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.block} · {o.text}</option>)}
                  </select>
                </label>
                <div className="lr-quick">
                  <button type="button" className="btn ghost" onClick={() => setPair((p) => ({ a: p.b, b: p.a }))}>交换左右</button>
                  <button type="button" className="btn ghost" onClick={() => stepPair(setPair, options, -1)}>各退一层</button>
                  <button type="button" className="btn ghost" onClick={() => stepPair(setPair, options, 1)}>各进一层</button>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">常见对照<span className="tag">{presets.length} 组</span></div>
                <p className="panel-desc">从真实的 Upsample / Concat 连边推出来的组合，点一下就换。</p>
                <div className="lr-presets">
                  {presets.map((p) => (
                    <button
                      type="button" key={p.a + p.b} className="lr-preset"
                      onClick={() => setPair({ a: p.a, b: p.b })}
                    >
                      <b>{p.a} → {p.b}</b>
                      <span>{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="panel">
              <div className="panel-title">跨层跳连<span className="tag">{skips.length} 条</span></div>
              <p className="panel-desc">
                跳连 = 骨干某一层的特征图被直接搬到颈部更后面的层。
                它们正是 FPN / PAN 的骨架，在左侧那一列顺次列表里是完全看不到的。
              </p>
              <div className="lr-skips">
                {skips.map((e) => (
                  <button
                    type="button" key={e.from + '->' + e.to}
                    className={'lr-skiprow' + (edge && e.from === edge.from && e.to === edge.to ? ' is-on' : '')}
                    onClick={() => { setSkipKey(e.from + '->' + e.to); setSegFrom(null); }}
                  >
                    <b>{e.from}</b>
                    <i>→</i>
                    <b>{e.to}</b>
                    <span>{e.shape || '—'}</span>
                    <em>跨 {e.span} 层</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-title">显示设置</div>
            <Seg
              label="着色来源"
              value={source}
              onChange={setSource}
              options={[
                { value: 'mean', label: '通道均值' },
                { value: 'channel', label: '单通道' },
                { value: 'max', label: '通道最大' },
                { value: 'pca', label: 'PCA' },
              ]}
            />
            {source === 'channel' ? (
              <Slider
                label="通道号" value={channel} min={0}
                max={Math.max(0, Math.min(aMeta.shape ? aMeta.shape.C : 1, bMeta.shape ? bMeta.shape.C : 1) - 1)}
                step={1} onChange={setChannel}
                hint="两张图取同一个通道号；某一层通道数不够时自动取最后一层"
              />
            ) : null}
            <Seg
              label="配色"
              value={colormap}
              onChange={setColormap}
              options={COLORMAPS.slice(0, 4).map((c) => ({ value: c, label: COLORMAP_LABELS[c] }))}
            />
            <Slider label="gamma" value={gamma} min={0.3} max={2} step={0.05} onChange={setGamma} />
            <Seg
              label="值域"
              value={rangeMode}
              onChange={setRangeMode}
              options={[{ value: 'p1p99', label: '1%–99% 分位' }, { value: 'minmax', label: '最小/最大' }]}
            />
            <Check label="两块共用同一色标区间（亮度可直接比）" value={sharedRange} onChange={setSharedRange} />
            <Check label="画出每层的格点网格" value={showGrid} onChange={setShowGrid} />
            <Check label="叠上 letterbox 后的原图" value={showImage} onChange={setShowImage} />
          </div>
        </aside>

        <section className="lr-center">
          <div className="lr-stagebar">
            <h3>{stage.title}</h3>
            <p>{stage.desc}</p>
          </div>
          <SyncPair
            items={items}
            imgsz={imgsz}
            inputCanvas={inputCanvas}
            colormap={colormap}
            gamma={gamma}
            rangeMode={rangeMode}
            sharedRange={sharedRange}
            showGrid={showGrid}
            showImage={showImage}
            maxHeight={Math.max(240, (window.innerHeight || 900) - 250)}
            version={version}
          />
        </section>

        <aside className="lr-detail">
          {mode === 'ab' ? (
            <>
              <div className="panel">
                <div className="panel-title">形状变化<span className="tag">{pair.a} → {pair.b}</span></div>
                <div className="kv">
                  {digest.map((d) => (
                    <div key={d.label}>
                      <b>{d.label}</b>
                      <span>{d.from} → {d.to}{d.note ? '  ' + d.note : ''}</span>
                    </div>
                  ))}
                </div>
                <p className="panel-desc">
                  {aMeta.shape && bMeta.shape && aMeta.shape.H === bMeta.shape.H && aMeta.shape.W === bMeta.shape.W
                    ? '两层分辨率相同：同一个格点覆盖的是同一块图像区域，可以逐点对着看。'
                    : '两层分辨率不同：同样是「一个格点」，在两层里覆盖的图像区域大小不一样 —— 这就是采样密度的差别。'}
                </p>
              </div>

              <div className="panel">
                <div className="panel-title">两层各自的统计<span className="tag">整层 · 本次前向的真数</span></div>
                <div className="lr-table">
                  <div className="lr-tr lr-th"><span>层</span><span>均值</span><span>最大</span><span>RMS</span><span>正值</span></div>
                  {[aMeta, bMeta].map((m, i) => (
                    <div className="lr-tr" key={m.id + i}>
                      <span className="lr-tid">{m.id}</span>
                      <span>{stats[i] ? fmt(stats[i].mean) : '—'}</span>
                      <span>{stats[i] ? fmt(stats[i].max) : '—'}</span>
                      <span>{stats[i] ? fmt(stats[i].rms) : '—'}</span>
                      <span>{stats[i] ? (stats[i].active * 100).toFixed(1) + '%' : '—'}</span>
                    </div>
                  ))}
                </div>
                <p className="panel-desc">两块画布的亮度只有在「共用色标区间」时才可以直接比大小。</p>
              </div>

              {pairSeg ? (
                <div className="panel">
                  <div className="panel-title">B 是拼接层<span className="tag">{pairConcat.segments.length} 路输入</span></div>
                  <div className="kv">
                    {pairConcat.segments.map((s) => (
                      <div key={s.from}>
                        <b>{s.from}{s.skip ? '（跳连）' : ''}</b>
                        <span>通道 {s.start}–{s.end - 1} · {s.channels} 个</span>
                      </div>
                    ))}
                  </div>
                  <Check
                    label={'B 只显示来自 ' + pair.a + ' 的那一段'}
                    value={abClip}
                    onChange={setAbClip}
                  />
                  {abClipVerify && abClipVerify.comparable ? (
                    <div className="kv">
                      <div><b>逐通道最大差值</b><span>{fmt(abClipVerify.maxDiff, 6)}</span></div>
                      <div><b>逐通道平均差值</b><span>{fmt(abClipVerify.meanDiff, 6)}</span></div>
                    </div>
                  ) : null}
                  <p className="panel-desc">
                    {abClipVerify && abClipVerify.comparable && abClipVerify.maxDiff === 0
                      ? '差值为 0：' + pair.a + ' 的这段通道在 B 里是原样搬过来的，两块画布逐点完全一致 —— 这就是 Concat 干的事。'
                      : 'Concat 不改变任何数值，勾上以后 B 只保留这一段，两块画布应当逐点相同。'}
                  </p>
                </div>
              ) : null}

              <div className="panel">
                <div className="panel-title">这一组怎么读</div>
                <p className="panel-desc">{abNote(pair.a, pair.b, aMeta, bMeta, pairConcat, pairSeg)}</p>
                <div className="lr-quick">
                  <button type="button" className="btn ghost" onClick={() => onGoToLayer(pair.b)}>回中间看 {pair.b}</button>
                </div>
              </div>
            </>
          ) : null}

          {mode === 'skip' && edge ? (
            <>
              <div className="panel">
                <div className="panel-title">这条跳连<span className="tag">跨 {edge.span} 层</span></div>
                <div className="kv">
                  <div><b>源层</b><span>{edge.from} · {aMeta.block} · {aMeta.text}</span></div>
                  <div><b>汇入</b><span>{edge.to} · {bMeta.block} · {bMeta.text}</span></div>
                  <div><b>连边张量</b><span>{edge.tensor || '—'}</span></div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  目标层的通道归属
                  <span className="tag">{breakdown.ok ? breakdown.total + ' 通道' : '拆不开'}</span>
                </div>
                {breakdown.ok ? (
                  <>
                    <div className="lr-segbar">
                      {segRows.map((s, i) => (
                        <button
                          type="button" key={s.from}
                          className={'lr-seg' + (seg && s.from === seg.from ? ' is-on' : '')}
                          style={{
                            flexGrow: s.channels,
                            borderColor: SEG_COLORS[i % SEG_COLORS.length],
                            background: SEG_COLORS[i % SEG_COLORS.length] + '22',
                          }}
                          onClick={() => pickSeg(s)}
                          title={s.from + ' 提供 ' + s.channels + ' 个通道'}
                        >
                          <b>{s.from}</b>
                          <i>{s.channels}</i>
                        </button>
                      ))}
                    </div>
                    <div className="chan-list">
                      {segRows.map((s, i) => (
                        <button
                          type="button" key={s.from}
                          className={'chan-row' + (seg && s.from === seg.from ? ' is-selected' : '')}
                          onClick={() => pickSeg(s)}
                        >
                          <span className="chan-name" style={{ color: SEG_COLORS[i % SEG_COLORS.length] }}>{s.from}</span>
                          <span className="chan-bar"><i style={{ width: Math.max(2, s.share * 100) + '%' }} /></span>
                          <span className="chan-val">{s.channels} · {(s.share * 100).toFixed(1)}%</span>
                        </button>
                      ))}
                    </div>
                    <p className="panel-desc">
                      条上的数字是通道数，右侧百分比是这一段的 L2 能量占整层的比例。
                      通道数多不等于贡献大 —— 两个数都摆出来才看得清。
                    </p>
                  </>
                ) : <p className="panel-desc">{SKIP_REASON[breakdown.reason] || '无法拆分。'}</p>}
              </div>

              <div className="panel">
                <div className="panel-title">目标显示范围</div>
                <Seg
                  label="右图画什么"
                  value={targetScope}
                  onChange={setTargetScope}
                  options={seg ? [
                    { value: 'seg', label: '只看 ' + seg.from + ' 这一段' },
                    { value: 'all', label: '全部通道' },
                    ...(restRange ? [{ value: 'rest', label: '只看其余通道' }] : []),
                  ] : [{ value: 'all', label: '全部通道（这层拆不出段）' }]}
                />
                <p className="panel-desc">切到「只看这一段」时，右图就是源层那一摞通道的均值图，和左图才有可比性。</p>
              </div>

              <div className="panel">
                <div className="panel-title">验证<span className="tag">{seg ? '逐通道比对' : '不可比'}</span></div>
                {verify && verify.comparable ? (
                  <>
                    <div className="kv">
                      <div><b>比对通道</b><span>{seg.channels} 个（{seg.start}–{seg.end - 1}）</span></div>
                      <div><b>最大差值</b><span>{fmt(verify.maxDiff, 6)}</span></div>
                      <div><b>平均差值</b><span>{fmt(verify.meanDiff, 6)}</span></div>
                    </div>
                    <p className="panel-desc">
                      {verify.maxDiff === 0
                        ? '差值全为 0：' + seg.from + ' 的 ' + seg.channels + ' 个通道在这层里是原样搬过来的（Concat 只搬运、不计算）。'
                        : '差值不为 0：这一段还经过了别的算子改写。'}
                    </p>
                  </>
                ) : (
                  <p className="panel-desc">
                    {seg ? '源层通道数或空间尺寸和这一段对不上，无法逐通道比对。'
                      : '这条跳连汇入的层不是按通道拼接，没有可比的通道段 —— 它更像三条并行分支。'}
                  </p>
                )}
              </div>

              <div className="lr-quick">
                <button type="button" className="btn ghost" onClick={() => onGoToLayer(edge.to)}>回中间看 {edge.to}</button>
                {onOpenHead && !bMeta.shape ? (
                  <button type="button" className="btn ghost" onClick={onOpenHead}>去检测头解剖</button>
                ) : null}
              </div>
            </>
          ) : null}
        </aside>
      </div>

      <div className="lr-foot">
        <span className="lr-fnode"><b>{aMeta.id || '—'}</b><i>{aMeta.text}</i></span>
        <span className="lr-farrow">→</span>
        <span className="lr-fnode is-ok"><b>{bMeta.id || '—'}</b><i>{bMeta.text}</i></span>
        {digest.map((d) => (
          <span className="lr-fchip" key={d.label}>
            {d.label} {d.from} → {d.to}{d.note ? '（' + d.note + '）' : ''}
          </span>
        ))}
        {mode === 'skip' && seg ? (
          <span className="lr-fchip is-hot">
            {seg.from} 提供 {seg.channels} 通道{segShare != null ? ' · 能量 ' + (segShare * 100).toFixed(1) + '%' : ''}
          </span>
        ) : null}
        <span className="lr-fnote">{footNote}</span>
      </div>
    </div>
  );
}

/** A/B 那一组的解释文字：按目标层的类型说人话 */
function abNote(aId, bId, aMeta, bMeta, pairConcat, pairSeg) {
  if (!aMeta.shape || !bMeta.shape) return '其中一层没有图像网格（检测头输出是向量集），只能对比形状与统计。';
  if (pairSeg && pairConcat.ok && pairConcat.segments.length > 1) {
    return 'Concat 不改变任何数值，只在通道维上把几路特征图堆在一起：'
      + pairConcat.segments.map((s) => s.from + ' ' + s.channels).join(' + ')
      + ' = ' + pairConcat.total + '。所以 ' + bId + ' 里有一段和 ' + aId + ' 完全相同，'
      + '勾上「只显示来自 ' + aId + ' 的那一段」就能看到这一点。';
  }
  if (bMeta.block === 'Upsample') {
    return 'Upsample 不产生新信息：每个格点被放大成 2×2，所以右图看起来是块状的 ——'
      + '同一块图像区域在左图是 1 个格点，在右图是 4 个格点。打开「格点网格」可以直接数出这个倍数。';
  }
  if (aMeta.shape.H === bMeta.shape.H && aMeta.shape.C === bMeta.shape.C) {
    return '两层的形状完全一样。如果两张图看起来也几乎一样，说明中间那一步基本没有改变表示。';
  }
  if (bMeta.shape.C > aMeta.shape.C) {
    return '右图通道更多：如果它显示的是「通道均值」，通道变多会把均值压低，两图的亮度差异不等于内容差异。';
  }
  if (bMeta.shape.H < aMeta.shape.H) {
    return '右图分辨率更低（下采样或带 stride 的卷积）：每个格点看的范围更大，细节更少、语义更强。';
  }
  return '两块画布用的是同一次前向：差别只来自这两层之间的算子，不是两次推理之间的抖动。';
}

/** 让 A/B 同时沿层序前进或后退 */
function stepPair(setPair, options, dir) {
  setPair((p) => {
    const ia = options.findIndex((o) => o.id === p.a);
    const ib = options.findIndex((o) => o.id === p.b);
    if (ia < 0 || ib < 0) return p;
    const clampAt = (i) => Math.max(0, Math.min(options.length - 1, i));
    return { a: options[clampAt(ia + dir)].id, b: options[clampAt(ib + dir)].id };
  });
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
      {label ? <span className="ctl-label">{label}</span> : null}
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

function fmt(v, digits) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(2);
  return v.toFixed(digits == null ? 3 : digits);
}
