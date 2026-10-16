/* 前向回放条：一条从 input 走到 output 的时间轴。

   左端是播放/暂停与逐层按钮，中间是 27 段（每层一段，按 backbone / neck / head 上色），
   点任意一段就跳到那一层；右端显示当前层与「第几层 / 共几层」。
   改变选中层 = 中间视口与左侧列表一起跟着走（列表会自动滚动到当前行）。 */
import { GROUP_COLOR } from '../state/graphLayout.js';

export default function ReplayBar(props) {
  const {
    layers, shapes, index, playing, speed, touched,
    onToggle, onStep, onSeek, onSpeed, onReset,
  } = props;

  const total = layers.length;
  const cur = layers[Math.min(index, total - 1)] || null;
  const shape = cur ? (shapes || {})[cur.id] : null;

  return (
    <div className={'rp' + (playing ? ' is-playing' : '') + (touched ? ' is-touched' : '')}>
      <button
        type="button"
        className={'rp-play' + (playing ? ' is-on' : '')}
        onClick={onToggle}
        title="从当前层继续往后放；放到最后一层会自动停，再点一次从头开始"
      >
        {playing ? '❚❚ 暂停' : '▶ 前向回放'}
      </button>

      <button type="button" className="rp-btn" onClick={() => onStep(-1)}
        disabled={index <= 0} title="上一层（←）">◀</button>
      <button type="button" className="rp-btn" onClick={() => onStep(1)}
        disabled={index >= total - 1} title="下一层（→）">▶</button>

      <div className="rp-track" role="list" aria-label="前向传播时间轴">
        {layers.map((l, i) => {
          const state = i === index ? ' is-now' : (i < index ? ' is-passed' : '');
          const color = GROUP_COLOR[l.group] || '#8ea0bd';
          return (
            <button
              type="button"
              key={l.id}
              role="listitem"
              className={'rp-seg' + state}
              style={{ '--seg': color }}
              onClick={() => onSeek(i)}
              title={l.id + ' · ' + l.block + (l.stride ? ' · s' + l.stride : '') + ' · ' + ((shapes || {})[l.id] || '—')}
            >
              <i />
            </button>
          );
        })}
      </div>

      <span className="rp-now" title={cur ? cur.desc || '' : ''}>
        <b>{cur ? cur.id : '—'}</b>
        {cur ? cur.block : ''}
        {shape ? <i>{shape}</i> : null}
      </span>
      <span className="rp-count">{total ? index + 1 : 0} / {total}</span>

      <div className="rp-speed">
        {[0.5, 1, 2].map((s) => (
          <button
            type="button"
            key={s}
            className={'rp-speedbtn' + (speed === s ? ' is-on' : '')}
            onClick={() => onSpeed(s)}
            title={s === 1 ? '每层约 0.9 秒' : '每层约 ' + (0.9 / s).toFixed(1) + ' 秒'}
          >{s}×</button>
        ))}
      </div>

      <button type="button" className="rp-btn" onClick={onReset}
        disabled={index <= 0} title="回到 input（起点）">⏮</button>
      <span className="rp-hint">空格 播放/暂停 · ← → 逐层</span>
    </div>
  );
}
