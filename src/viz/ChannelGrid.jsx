/* 通道网格：把「能量最高的 K 个通道」铺成小图矩阵，一眼看清特征分化 */
import { useMemo } from 'react';
import { extractChannel, planeRange, normalizePlane, layerStats } from './field.js';
import { planeToCanvas } from './render.js';

function Thumb({ data, C, H, W, channel, energy, colormap, gamma, rangeMode, selected, onSelect, rank }) {
  const url = useMemo(() => {
    if (!data) return null;
    const plane = extractChannel(data, C, H, W, channel);
    const { lo, hi } = planeRange(plane, rangeMode);
    const norm = normalizePlane(plane, lo, hi);
    const cv = planeToCanvas(norm, W, H, { colormap, gamma, lo: 0, hi: 1 });
    return cv.toDataURL('image/png');
  }, [data, C, H, W, channel, colormap, gamma, rangeMode]);
  const stat = useMemo(() => (data ? layerStats(extractChannel(data, C, H, W, channel)) : null), [data, C, H, W, channel]);
  return (
    <button
      type="button"
      className={'thumb' + (selected ? ' is-selected' : '')}
      onClick={() => onSelect(channel)}
      title={'通道 #' + channel}
    >
      <span className="thumb-rank">#{rank}</span>
      {url ? <img src={url} alt={'通道 ' + channel} /> : <span className="thumb-empty" />}
      <span className="thumb-meta">
        <b>ch{channel}</b>
        <i>{energy != null ? 'E ' + energy.toFixed(2) : ''}</i>
      </span>
      {stat ? <span className="thumb-sub">max {stat.max.toFixed(2)}</span> : null}
    </button>
  );
}

export default function ChannelGrid({ tensor, shape, energy, topK = 12, colormap, gamma, rangeMode, selectedChannel, onSelect }) {
  const list = useMemo(() => {
    if (!energy) return [];
    const idx = Array.from(energy.keys());
    idx.sort((a, b) => energy[b] - energy[a]);
    return idx.slice(0, Math.min(topK, idx.length));
  }, [energy, topK]);

  if (!tensor) return <div className="empty">等待推理结果…</div>;
  return (
    <div className="grid-wrap">
      <div className="grid-title">能量最高的 {list.length} 个通道（点击可在右侧切换单通道视图）</div>
      <div className="grid">
        {list.map((c, i) => (
          <Thumb
            key={c}
            rank={i + 1}
            data={tensor.data}
            C={shape.C}
            H={shape.H}
            W={shape.W}
            channel={c}
            energy={energy[c]}
            colormap={colormap}
            gamma={gamma}
            rangeMode={rangeMode}
            selected={selectedChannel === c}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}