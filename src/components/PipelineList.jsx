/* 左侧流水线：把 27 个阶段按 backbone / neck / head 分组列出，
   每项显示层 id、模块名、张量形状，以及一条「激活强度」小条。 */
import { groupLabel } from '../model/layers.js';

export default function PipelineList({ layers, selectedId, onSelect, shapes, stats, rmsMax, groupLabel: gl }) {
  const groups = [];
  for (const l of layers) {
    const g = l.group || 'other';
    let bucket = groups.find((x) => x.g === g);
    if (!bucket) { bucket = { g, items: [] }; groups.push(bucket); }
    bucket.items.push(l);
  }
  const maxRms = rmsMax && rmsMax > 0 ? rmsMax : Math.max(1e-9, ...Object.values(stats || {}).map((s) => s.rms));

  return (
    <div className="pipeline">
      {groups.map((b) => (
        <div className="pipe-group" key={b.g}>
          <div className="pipe-group-title">
            {gl ? gl(b.g) : groupLabel(b.g)}
            <i>{b.items.length}</i>
          </div>
          {b.items.map((l) => {
            const st = (stats || {})[l.id];
            const w = st ? Math.min(100, Math.max(6, Math.round(Math.sqrt(st.rms / maxRms) * 100))) : 0;
            return (
              <button
                key={l.id}
                type="button"
                className={'pipe-item' + (l.id === selectedId ? ' is-selected' : '')}
                onClick={() => onSelect(l.id)}
                title={(l.desc || '') + (st ? '  ·  RMS 能量 ' + st.rms.toFixed(3) + '  ·  极值 ' + st.min.toFixed(2) + ' ~ ' + st.max.toFixed(2) : '')}
              >
                <span className="pipe-id">{l.id}</span>
                <span className="pipe-body">
                  <span className="pipe-name">{l.block}{l.stride ? ' · s' + l.stride : ''}</span>
                  <span className="pipe-shape">{(shapes || {})[l.id] || '—'}</span>
                </span>
                <span className="pipe-bar"><i style={{ width: w + '%' }} /></span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}