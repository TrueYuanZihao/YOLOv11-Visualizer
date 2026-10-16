/* 前向回放条：一条从 input 走到 output、再走进检测头的时间轴。

   左端是播放/暂停与逐层按钮，中间是每一段（每层一段，按 backbone / neck / head 上色；
   检测头那几个阶段是琥珀色的独立一组），点任意一段就跳到那一步；
   右端显示当前阶段与「第几段 / 共几段」。改变选中阶段 = 中间视口、右侧面板、左侧列表一起跟着走
   （列表会自动滚动到当前行）。 */
export default function ReplayBar(props) {
  const {
    stages, index, playing, speed, touched,
    onToggle, onStep, onSeek, onSpeed, onReset,
  } = props;

  const list = stages || [];
  const total = list.length;
  const at = Math.max(0, Math.min(index, total - 1));
  const cur = list[at] || null;
  const inHead = !!(cur && cur.head);

  return (
    <div className={'rp' + (playing ? ' is-playing' : '') + (touched ? ' is-touched' : '')}>
      <button
        type="button"
        className={'rp-play' + (playing ? ' is-on' : '')}
        onClick={onToggle}
        title="从当前这一步继续往后放；走到最后一步会自动停，再点一次从头开始"
      >
        {playing ? '❚❚ 暂停' : '▶ 前向回放'}
      </button>

      <button type="button" className="rp-btn" onClick={() => onStep(-1)}
        disabled={at <= 0} title="上一步（←）">◀</button>
      <button type="button" className="rp-btn" onClick={() => onStep(1)}
        disabled={at >= total - 1} title="下一步（→）">▶</button>

      <div className="rp-track" role="list" aria-label="前向传播时间轴">
        {list.map((s, i) => {
          const state = i === at ? ' is-now' : (i < at ? ' is-passed' : '');
          const headStart = s.head && (i === 0 || !list[i - 1].head);
          return (
            <button
              type="button"
              key={s.id}
              role="listitem"
              className={'rp-seg' + state + (s.head ? ' is-head' : '') + (headStart ? ' is-headstart' : '')}
              style={{ '--seg': s.color }}
              onClick={() => onSeek(i)}
              title={s.title || s.label}
            >
              <i />
            </button>
          );
        })}
      </div>

      <span className={'rp-now' + (inHead ? ' is-head' : '')} title={cur ? cur.title || '' : ''}>
        <b>{cur ? cur.label : '—'}</b>
        {cur && cur.sub ? <span className="rp-sub">{cur.sub}</span> : null}
        {cur && cur.readout ? <i>{cur.readout}</i> : null}
      </span>
      <span className="rp-count">{total ? at + 1 : 0} / {total}</span>

      <div className="rp-speed">
        {[0.5, 1, 2].map((s) => (
          <button
            type="button"
            key={s}
            className={'rp-speedbtn' + (speed === s ? ' is-on' : '')}
            onClick={() => onSpeed(s)}
            title={s === 1 ? '每层约 0.9 秒（检测头阶段一步约 0.6 秒）' : '每层约 ' + (0.9 / s).toFixed(1) + ' 秒'}
          >{s}×</button>
        ))}
      </div>

      <button type="button" className="rp-btn" onClick={onReset}
        disabled={at <= 0} title="回到 input（起点）">⏮</button>
      <span className="rp-hint">空格 播放/暂停 · ← → 单步</span>
    </div>
  );
}
