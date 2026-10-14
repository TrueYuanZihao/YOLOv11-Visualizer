/* 检测结果面板：类别分布 + 框列表 */
export default function DetectionList({ dets, hist, imgsz, onHover }) {
  return (
    <div className="panel">
      <div className="panel-title">
        检测结果
        <span className="tag">{dets.length} 个框</span>
      </div>
      {dets.length === 0 ? (
        <p className="panel-desc">当前阈值下没有检出目标。可调低右侧「置信度阈值」再看看。</p>
      ) : (
        <>
          <div className="chips">
            {hist.map((h) => (
              <span className="chip" key={h.name}>{h.name}<b>{h.count}</b></span>
            ))}
          </div>
          <div className="det-list">
            {dets.slice(0, 40).map((d, i) => (
              <div
                className="det-row"
                key={i}
                onMouseEnter={() => onHover && onHover(d)}
                onMouseLeave={() => onHover && onHover(null)}
              >
                <span className="det-cls">{d.className}</span>
                <span className="det-score">{(d.score * 100).toFixed(1)}%</span>
                <span className="det-box">
                  {d.x1.toFixed(0)},{d.y1.toFixed(0)} → {d.x2.toFixed(0)},{d.y2.toFixed(0)}
                  <i> / {imgsz}</i>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}