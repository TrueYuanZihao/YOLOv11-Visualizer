/* 中间视口：2D 特征图 / 通道网格 / 3D 特征金字塔 / 3D 通道堆叠 */
import FeatureCanvas from '../viz/FeatureCanvas.jsx';
import ChannelGrid from '../viz/ChannelGrid.jsx';
import VolStack from '../viz/VolStack.jsx';
import ReplayBar from './ReplayBar.jsx';

const TABS = [
  { value: '2d', label: '2D 特征图' },
  { value: 'grid', label: '通道网格' },
  { value: 'pyramid', label: '3D 特征金字塔' },
  { value: 'channels', label: '3D 通道堆叠' },
];

export default function Viewport(props) {
  const {
    view, setView, layer, tensor, shape, inputTensor, inputCanvas, dets, imgsz,
    viz, setViz, energy, stackItems, stackProgress, stackMode, onSelect,
    resetSignal, isDetectLayer, onOpenHead, version,
    onOpenRelation, concatInfo,
    replay, onReplayToggle, onReplayStep, onReplaySeek, onReplaySpeed, onReplayReset,
  } = props;

  const shownTensor = isDetectLayer ? inputTensor : tensor;
  // 1~3 通道的层（输入层 / Preprocess）本来就该按图像看
  const lowChannel = !!(shape && shape.C <= 3);
  const mapMode = (isDetectLayer || lowChannel) ? 'rgb' : viz.mapMode;
  const channelCount = shape ? shape.C : 0;

  return (
    <section className="viewport">
      <div className="tabs">
        {TABS.map((t) => (
          <button type="button" key={t.value}
            className={'tab' + (view === t.value ? ' is-on' : '')}
            onClick={() => setView(t.value)}>{t.label}</button>
        ))}
        <div className="tabs-spacer" />
        <div className="tabs-info">
          {layer ? <span className="pill">{layer.id} · {layer.block}</span> : null}
          {stackProgress < 1 && view !== '2d' && view !== 'grid'
            ? <span className="pill warn">正在生成 3D 纹理 {Math.round(stackProgress * 100)}%</span>
            : null}
          {viz.threads ? <span className="pill dim">wasm ×{viz.threads}</span> : null}
        </div>
      </div>

      {replay && replay.layers && replay.layers.length ? (
        <ReplayBar
          layers={replay.layers}
          shapes={replay.shapes}
          index={replay.index}
          playing={replay.playing}
          speed={replay.speed}
          touched={replay.touched}
          onToggle={onReplayToggle}
          onStep={onReplayStep}
          onSeek={onReplaySeek}
          onSpeed={onReplaySpeed}
          onReset={onReplayReset}
        />
      ) : null}

      <div className="viewport-body">
        {isDetectLayer ? (
          <div className="banner">
            <span>
              这一层是检测头输出，张量形状为 [1, 84, N]（4 个框坐标 + 80 类分数），并不是图像网格。
              因此这里显示 letterbox 后的输入图 + 真实检测框；上方「检测结果」面板里是所有检出目标。
            </span>
            {onOpenHead ? (
              <button type="button" className="btn accent banner-cta" onClick={onOpenHead}>检测头解剖</button>
            ) : null}
          </div>
        ) : null}

        {concatInfo ? (
          <div className="banner concat">
            <span>
              这一层是通道拼接：{concatInfo.segments.map((s) => s.from + ' ' + s.channels).join(' + ')}
              {' = '}{concatInfo.total} 通道。
              {concatInfo.segments.filter((s) => s.skip).map((s) => '其中 ' + s.from + ' 是跨层跳连搬过来的（' + s.channels + ' 通道）。').join('')}
              通道顺序就是 ONNX 算子的输入顺序，可以在「层间关系」里拆开验证。
            </span>
            {onOpenRelation ? (
              <button type="button" className="btn accent banner-cta" onClick={onOpenRelation}>拆开看</button>
            ) : null}
          </div>
        ) : null}

        {view === '2d' ? (
          <FeatureCanvas
            tensor={shownTensor}
            layerId={layer ? layer.id : null}
            mapMode={mapMode}
            channel={viz.channel}
            colormap={viz.colormap}
            gamma={viz.gamma}
            rangeMode={viz.rangeMode}
            overlay={viz.overlay}
            showBoxes={viz.showBoxes}
            dets={dets}
            imgsz={imgsz}
            inputCanvas={inputCanvas}
            version={version}
          />
        ) : null}

        {view === 'grid' ? (
          isDetectLayer
            ? <div className="empty">检测头输出是 [1,84,N] 的向量集合，没有通道网格可看。请切换到 3D 特征金字塔查看整体结构。</div>
            : (
              <ChannelGrid
                tensor={tensor}
                shape={shape}
                energy={energy}
                topK={12}
                colormap={viz.colormap}
                gamma={viz.gamma}
                rangeMode={viz.rangeMode}
                selectedChannel={viz.channel}
                onSelect={(c) => setViz((v) => ({ ...v, channel: c, mapMode: 'channel' }))}
              />
            )
        ) : null}

        {view === 'pyramid' || view === 'channels' ? (
          <div className="v3d-host">
            <VolStack
              items={stackItems}
              mode={stackMode}
              explode={viz.explode}
              heightScale={viz.heightScale}
              showLabels
              selectedKey={layer ? layer.id : null}
              onSelect={onSelect}
              autoRotate={viz.autoRotate}
              resetSignal={resetSignal}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
