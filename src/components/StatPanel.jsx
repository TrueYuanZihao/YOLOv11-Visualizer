/* 右侧统计面板：选中层的真实激活统计 + 通道能量排行 */
import { useMemo } from 'react';

function fmt(v) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(2);
  return v.toFixed(3);
}

export default function StatPanel({ layer, shape, shapeText, stats, energy, channel, onPickChannel }) {
  const top = useMemo(() => {
    if (!energy) return [];
    const idx = Array.from(energy.keys());
    idx.sort((a, b) => energy[b] - energy[a]);
    return idx.slice(0, 10);
  }, [energy]);
  const maxE = top.length ? energy[top[0]] : 1;

  if (!layer) return null;

  return (
    <div className="panel">
      <div className="panel-title">
        {layer.id} · {layer.block}
        <span className="tag">{layer.group}</span>
        {layer.stride ? <span className="tag">stride {layer.stride}</span> : null}
      </div>
      {layer.desc ? <p className="panel-desc">{layer.desc}</p> : null}

      <div className="kv">
        <div><b>张量形状</b><span>{shape ? shape.C + ' × ' + shape.H + ' × ' + shape.W : (shapeText || '—')}</span></div>
        <div><b>元素个数</b><span>{stats ? stats.count.toLocaleString() : '—'}</span></div>
        <div><b>均值</b><span>{fmt(stats && stats.mean)}</span></div>
        <div><b>标准差</b><span>{fmt(stats && stats.std)}</span></div>
        <div><b>最大 / 最小</b><span>{fmt(stats && stats.max)} / {fmt(stats && stats.min)}</span></div>
        <div><b>RMS 能量</b><span>{fmt(stats && stats.rms)}</span></div>
        <div><b>正值占比</b><span>{stats ? (stats.active * 100).toFixed(1) + '%' : '—'}</span></div>
      </div>

      {top.length ? (
        <div className="chan-list">
          <div className="chan-title">通道能量排行（RMS，点击切换单通道视图）</div>
          {top.map((c) => (
            <button
              type="button"
              key={c}
              className={'chan-row' + (c === channel ? ' is-selected' : '')}
              onClick={() => onPickChannel(c)}
            >
              <span className="chan-name">ch{c}</span>
              <span className="chan-bar"><i style={{ width: Math.max(2, (energy[c] / maxE) * 100) + '%' }} /></span>
              <span className="chan-val">{fmt(energy[c])}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}