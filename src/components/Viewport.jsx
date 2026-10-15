/* 中间视口：2D 特征图 / 通道网格 / 3D 特征金字塔 / 3D 通道堆叠 */
import FeatureCanvas from '../viz/FeatureCanvas.jsx';
import ChannelGrid from '../viz/ChannelGrid.jsx';
import VolStack from '../viz/VolStack.jsx';

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
