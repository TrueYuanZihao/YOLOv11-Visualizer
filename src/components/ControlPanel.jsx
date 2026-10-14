/* 右侧控制面板：可视化参数 + 推理参数 */
import { COLORMAPS, COLORMAP_LABELS } from '../viz/colormap.js';

function Slider({ label, value, min, max, step, onChange, hint }) {
  return (
    <label className="ctl">
      <span className="ctl-label">{label}<b>{typeof value === 'number' ? (step < 1 ? value.toFixed(2) : value) : value}</b></span>
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

export default function ControlPanel({ viz, setViz, view, channelCount, isDetectLayer, onRerun, onResetView, busy }) {
  const set = (patch) => setViz((v) => ({ ...v, ...patch }));
  const is3d = view === 'pyramid' || view === 'channels';

  return (
    <div className="panel">
      <div className="panel-title">可视化控制<span className="tag">{view === 'pyramid' ? '3D 金字塔' : view === 'channels' ? '3D 通道堆叠' : view === 'grid' ? '通道网格' : '2D'}</span></div>

      <div className="ctl-grid">
        <label className="ctl">
          <span className="ctl-label">配色</span>
          <select value={viz.colormap} onChange={(e) => set({ colormap: e.target.value })}>
            {COLORMAPS.map((c) => <option key={c} value={c}>{COLORMAP_LABELS[c] || c}</option>)}
          </select>
        </label>
        <label className="ctl">
          <span className="ctl-label">显示区间</span>
          <select value={viz.rangeMode} onChange={(e) => set({ rangeMode: e.target.value })}>
            <option value="p1p99">1% – 99% 分位（推荐）</option>
            <option value="p2p98">2% – 98% 分位</option>
            <option value="p0p999">0 – 99.9% 分位</option>
            <option value="minmax">真实最小 / 最大</option>
          </select>
        </label>
      </div>

      <Slider label="伽马 γ" value={viz.gamma} min={0.2} max={3} step={0.05} onChange={(v) => set({ gamma: v })} hint=">1 提亮弱激活，<1 强调强激活" />

      {!isDetectLayer ? (
        <Seg label="显示内容" value={viz.mapMode}
          options={[
            { value: 'channel', label: '单通道' },
            { value: 'pca', label: 'PCA 合成' },
            { value: 'mean', label: '均值' },
            { value: 'max', label: '最大' },
            { value: 'l2', label: 'L2' },
          ]}
          onChange={(v) => set({ mapMode: v })} />
      ) : null}

      {!isDetectLayer && viz.mapMode === 'channel' ? (
        <Slider label="通道 ch" value={viz.channel} min={0} max={Math.max(0, channelCount - 1)} step={1}
          onChange={(v) => set({ channel: v })} hint={'该层共 ' + channelCount + ' 个通道'} />
      ) : null}

      <div className="ctl-grid">
        <Check label="叠加原图" value={viz.overlay} onChange={(v) => set({ overlay: v })} />
        <Check label="显示检测框" value={viz.showBoxes} onChange={(v) => set({ showBoxes: v })} />
      </div>

      {is3d ? (
        <>
          <div className="panel-sub">3D 视角</div>
          <Slider label="堆叠间距" value={viz.explode} min={0.3} max={2.4} step={0.05} onChange={(v) => set({ explode: v })} />
          {view === 'channels' ? (
            <Slider label="起伏幅度" value={viz.heightScale} min={0} max={2.5} step={0.05} onChange={(v) => set({ heightScale: v })} hint="用激活值把平面顶起来" />
          ) : null}
          <Slider label="通道堆叠数量" value={viz.stackChannels} min={4} max={32} step={1} onChange={(v) => set({ stackChannels: v })} />
          <Seg label="切片配色" value={viz.stackSource}
            options={[
              { value: 'pca', label: 'PCA' },
              { value: 'channel', label: '单通道' },
              { value: 'mean', label: '均值' },
            ]}
            onChange={(v) => set({ stackSource: v })} />
          <div className="ctl-grid">
            <Check label="自动旋转" value={viz.autoRotate} onChange={(v) => set({ autoRotate: v })} />
            <button type="button" className="btn ghost" onClick={onResetView}>重置视角</button>
          </div>
        </>
      ) : null}

      <div className="panel-sub">推理参数</div>
      <Slider label="置信度阈值" value={viz.conf} min={0.05} max={0.9} step={0.01} onChange={(v) => set({ conf: v })} />
      <Slider label="NMS IoU" value={viz.iou} min={0.1} max={0.9} step={0.01} onChange={(v) => set({ iou: v })} />
      <button type="button" className="btn" disabled={busy} onClick={onRerun}>
        {busy ? '推理中…' : '重新推理'}
      </button>
    </div>
  );
}