# Git 提交历史

> 本文件由仓库的真实 Git 提交对象自动导出，用于竞赛材料审阅。完整、可验证的提交历史以 GitHub 仓库和本地 .git 目录为准。

## 仓库信息

- 仓库：https://github.com/TrueYuanZihao/YOLOv11-Visualizer.git
- 分支：main
- 提交总数：12
- 时间范围：2026-10-13 至 2026-11-03
- 最新提交：`cc62e0b`
- 导出日期：2026-11-03

## 核验方式

```powershell
git clone https://github.com/TrueYuanZihao/YOLOv11-Visualizer.git
cd YOLOv11-Visualizer
git log --reverse --oneline --decorate
git show <提交哈希>
```

## 提交列表（按时间正序）

## e2fbaf3 — 初始化YOLOv11可视化仓库，构建项目的初始版本。

- 提交：`e2fbaf302d91a02af5e45b8487e25446fb25e153`
- 日期：2026-10-13T21:57:17+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                  | 125 +++++++++
 index.html                 | 152 +++++++++++
 js/app.js                  | 661 +++++++++++++++++++++++++++++++++++++++++++++
 js/detector.js             | 255 +++++++++++++++++
 js/kernels.js              | 255 +++++++++++++++++
 js/pipeline.js             | 424 +++++++++++++++++++++++++++++
 js/render.js               | 247 +++++++++++++++++
 js/samples.js              | 193 +++++++++++++
 shots/preview-output.png   | Bin 0 -> 668839 bytes
 shots/preview-overview.png | Bin 0 -> 351659 bytes
 styles.css                 | 271 +++++++++++++++++++
 tools/shot.ps1             |  44 +++
 12 files changed, 2627 insertions(+)

## 04841d4 — 使用真实yolo11n权重；使用基于Node的Vite + React组件重构了前端。

- 提交：`04841d4804418e6aeaede1232172102ed8c8b4b5`
- 日期：2026-10-14T21:44:47+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 .gitattributes                          |   16 +
 .gitignore                              |   88 ++
 README.md                               |  196 +++--
 index.html                              |  164 +---
 legacy/README.md                        |  125 +++
 legacy/index.html                       |  152 ++++
 {js => legacy/js}/app.js                |    0
 {js => legacy/js}/detector.js           |    0
 {js => legacy/js}/kernels.js            |    0
 {js => legacy/js}/pipeline.js           |    0
 {js => legacy/js}/render.js             |    0
 {js => legacy/js}/samples.js            |    0
 styles.css => legacy/styles.css         |    0
 package-lock.json                       | 1379 +++++++++++++++++++++++++++++++
 package.json                            |   29 +
 public/models/layers.json               |  522 ++++++++++++
 public/models/yolo11n_vis.onnx          |  Bin 0 -> 10602142 bytes
 public/samples/street.jpg               |  Bin 0 -> 87447 bytes
 src/App.jsx                             |  438 ++++++++++
 src/components/ControlPanel.jsx         |  119 +++
 src/components/DetectionList.jsx        |   39 +
 src/components/PipelineList.jsx         |   47 ++
 src/components/StatPanel.jsx            |   60 ++
 src/components/Viewport.jsx             |  106 +++
 src/main.jsx                            |    5 +
 src/model/detect.js                     |   75 ++
 src/model/layers.js                     |   35 +
 src/model/ortWorker.js                  |   30 +
 src/model/preprocess.js                 |   40 +
 src/model/runner.js                     |   65 ++
 src/model/session.js                    |   93 +++
 src/styles.css                          |  241 ++++++
 src/viz/ChannelGrid.jsx                 |   67 ++
 src/viz/FeatureCanvas.jsx               |  208 +++++
 src/viz/VolStack.jsx                    |  308 +++++++
 src/viz/colormap.js                     |   45 +
 src/viz/field.js                        |  268 ++++++
 src/viz/render.js                       |   47 ++
 tools/export_onnx.py                    |  211 +++++
 tools/layers.mjs                        |   43 +
 tools/probe.mjs                         |  100 +++
 tools/sync-ort.mjs                      |   24 +
 tools/verify_onnx.py                    |   53 ++
 ultralytics-main/ultralytics/yolo11n.pt |  Bin 0 -> 5613764 bytes
 vite.config.js                          |   20 +
 45 files changed, 5217 insertions(+), 241 deletions(-)

## 110cdfa — 新增YOLOv11完整网络结构视图；能够直观展示输入数据的处理逻辑与每一层的特征图。 AI提示词：目前前端页面左侧的一系列卷积层都是顺序排列的，但真实的YOLOv11模型网络不是完全顺序排列的，颈部层会使用骨干层多个层级的信息作为输入。所以我想在前端页面里完整展示YOLOv11网络的真实结构，而不是简单的将每一层顺序放置。这个模型网络展示可以单独放在一个按钮触发的页面，或者直接将当前左侧列表变成一个可以拖动的二维图，点击图中的一个卷积层就可以在中间展示这个层中的数据是如何处理的。你可以根据实际情况进行页面的美化和功能的完善。

- 提交：`110cdfad99240176e4a5b162f262f7e5cda0c658`
- 日期：2026-10-15T09:30:25+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 .gitignore                          |   1 +
 README.md                           |  44 ++-
 package.json                        |   4 +-
 public/models/graph.json            | 595 ++++++++++++++++++++++++++++++++++++
 src/App.jsx                         |  55 +++-
 src/components/PipelineList.jsx     |  13 +-
 src/components/StructureOverlay.jsx | 159 ++++++++++
 src/model/layers.js                 |   7 +
 src/state/graphLayout.js            | 126 ++++++++
 src/styles.css                      | 137 ++++++++-
 src/viz/GraphView.jsx               | 263 ++++++++++++++++
 tools/export_graph.py               | 231 ++++++++++++++
 tools/probe-structure.mjs           | 145 +++++++++
 13 files changed, 1773 insertions(+), 7 deletions(-)

## eb493c6 — 加入完整YOLOv11可互动架构图，清晰展示Backbone、Neck、Head之间的连接关系。 AI提示词：目前左上角网络结构图将Backbone、Neck、Head层中的结构排成一列展示，我感觉这还是不够直观。我现在给你提供了YOLOv11 架构.svg作为网络结构参考，我希望左上角网络结构图以这种结构进行展示。YOLOv11 架构.svg的内容可能并不准确，请你根据实际情况进行判断。

- 提交：`eb493c6af792b94e3c8b607d13d519c0dbea54cf`
- 日期：2026-10-15T10:50:24+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                           |  40 ++++++--
 YOLOv11 架构.svg                    |   1 +
 src/App.jsx                         |   3 +
 src/components/StructureOverlay.jsx |  14 ++-
 src/state/graphLayout.js            | 194 ++++++++++++++++++++++++++++++++++++
 src/styles.css                      |  15 ++-
 src/viz/GraphView.jsx               |  76 +++++++++++---
 tools/probe-structure.mjs           |  44 +++++++-
 8 files changed, 359 insertions(+), 28 deletions(-)

## 496b69b — 增加检测头解剖模块；将特征图如何变成最终的检测定位框进行可视化。 AI提示词：1.我这个项目是想可视化展示YOLOv11如何处理图像。目前项目已经有了一些内容，但我觉得还是比较少，请你帮我分析一下，这个项目还能增加哪些可视化内容？ 2.请你帮我引入 检测头解剖 这个功能或模块,，应该对应你说的检测解码链路。因为目前的项目对于检测头是如何将特征图转换成锚点和分类这一块没有解释清楚，我希望引入这个模块，增加对于模型目标检测的理解。前端具体样式你根据情况制作，要求美观且和之前的风格一致。

- 提交：`496b69b7b25ca5b9e9adb6bbcece3769338f1ec9`
- 日期：2026-10-15T16:28:10+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                      |  45 ++-
 package.json                   |   3 +-
 src/App.jsx                    |  48 +++-
 src/components/HeadAnatomy.jsx | 624 +++++++++++++++++++++++++++++++++++++++++
 src/components/Viewport.jsx    |  13 +-
 src/model/detect.js            |  54 +++-
 src/model/headAnatomy.js       | 116 ++++++++
 src/styles.css                 | 132 ++++++++-
 src/viz/AnchorGrid.jsx         | 236 ++++++++++++++++
 tools/probe-head.mjs           | 213 ++++++++++++++
 10 files changed, 1462 insertions(+), 22 deletions(-)

## 272fb15 — 添加层与层之间关系的可视化模块；包括连续两层之间的对比图以及跨层连接之间的对比图。 AI提示词：1.我从大模型总结的建议中，看到：层与层的关系（目前完全空白，也是最能补"理解"的） - A/B 对比视图：左右并排两层同步缩放，专治 Upsample/Concat 前后（m6 / m11 / m12 三联，直接看到 Concat 就是把两摞通道拼起来）。 - 层间相似度矩阵：每层全局平均池化 → 25×25 余弦/CKA 热力图，回答"哪些层学到的表示其实很像"。这就是你最初想要的"层级权重/注意力"分析，而且不需要梯度、完全真实。 - 跳连拆解：点结构图里一条跳连，并排显示源层与目标层，并标出 m12 里哪段通道来自 m6（Concat 切分可从 graph 的输入顺序推出）。 我不太理解这个功能是在干什么，请你解释一下 2.请你进行A/B 对比 + 跳连拆解这两块功能模块的实现，通过此模块向用户展示层与层之间是如何进行交互的。具体排版和样式请你结合具体情况进行设计。

- 提交：`272fb15dc561b93ad12c4b352c3c624e4403d0bb`
- 日期：2026-10-15T20:16:52+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                           |  43 +++
 package.json                        |   3 +-
 src/App.jsx                         |  47 +++
 src/components/LayerRelations.jsx   | 657 ++++++++++++++++++++++++++++++++++++
 src/components/StructureOverlay.jsx |  33 +-
 src/components/Viewport.jsx         |  15 +
 src/model/relations.js              | 181 ++++++++++
 src/styles.css                      | 155 +++++++++
 src/viz/SyncPair.jsx                | 359 ++++++++++++++++++++
 tools/probe-relations.mjs           | 292 ++++++++++++++++
 10 files changed, 1776 insertions(+), 9 deletions(-)

## dc72239 — 增加自动播放图像处理功能；方便用户理解yolov11处理图像的全过程。 AI提示词：我记得在最开始不使用Node的版本中，主界面有一个可以自动播放图像处理过程的按钮，但在 后面有Node的版本中被去掉了。我想要添加一个前向回放按钮：时间轴/自动播放从 input 走到 output，左侧列表同步高亮 。按钮的具体位置你可以根据页面实际情况进行布局。

- 提交：`dc722399aaa33aa6d84bb443ce9fc02c19e0fd24`
- 日期：2026-10-16T11:21:44+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                       |  28 +++++++
 package.json                    |   3 +-
 src/App.jsx                     |  87 +++++++++++++++++++++
 src/components/PipelineList.jsx |  17 ++++-
 src/components/ReplayBar.jsx    |  78 +++++++++++++++++++
 src/components/Viewport.jsx     |  18 +++++
 src/styles.css                  |  65 ++++++++++++++++
 src/viz/FeatureCanvas.jsx       |   4 +-
 tools/probe-replay.mjs          | 162 ++++++++++++++++++++++++++++++++++++++++
 9 files changed, 456 insertions(+), 6 deletions(-)

## f724c88 — 自动播放功能中新增检测头的原理解析；方便用户理解检测头的机制原理。 AI提示词：目前的自动播放图对于检测头的机制一笔带过，直接从特征图跳到最终的输出图像。能不能将检测头的步骤也展示在自动播放中，比如先将图中所有的预选框都标出来，然后展示yolov11是如何从这些预选框中找到最终需要输出的框图的。具体原理肯定比这复杂，请你结合具体检测头步骤，完善目前的自动播放功能。

- 提交：`f724c88e789bee4297f1fb4998e6ffcb8b98428f`
- 日期：2026-10-16T14:20:29+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                    |  39 +++++++-
 src/App.jsx                  | 155 +++++++++++++++++++++++--------
 src/components/ReplayBar.jsx |  57 ++++++------
 src/components/Viewport.jsx  |  38 ++++++--
 src/model/headReplay.js      | 160 ++++++++++++++++++++++++++++++++
 src/styles.css               |  42 ++++++++-
 src/viz/AnchorGrid.jsx       |  20 +++-
 src/viz/HeadStage.jsx        | 107 ++++++++++++++++++++++
 tools/probe-replay.mjs       | 213 +++++++++++++++++++++++++++++++++----------
 9 files changed, 699 insertions(+), 132 deletions(-)

## a51daad — 增加新手引导按钮，介绍前端功能，方便用户使用网站。 AI提示词：我想要加入一个新手引导模式，目前的前端页面包含很多内容，对于专业的人来说很好理解，但是对于新手来说过于复杂。请你加入一个新手引导模式模块，该模块能引导用户主动操作前端页面，理解每个功能的意义。具体引导和界面风格，请你结合项目已有的内容进行设计。

- 提交：`a51daad129e10694e4342b68436106dbd20de291`
- 日期：2026-10-20T16:27:10+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                       |   9 +
 src/App.jsx                     |  83 ++++++-
 src/components/ControlPanel.jsx |   4 +-
 src/components/GuidedTour.jsx   | 483 ++++++++++++++++++++++++++++++++++++++++
 src/components/PipelineList.jsx |   1 +
 src/components/ReplayBar.jsx    |   1 +
 src/components/Viewport.jsx     |   2 +-
 src/styles.css                  | 110 +++++++++
 src/viz/FeatureCanvas.jsx       |   2 +-
 9 files changed, 684 insertions(+), 11 deletions(-)

## 78f9baf — 新增检测框回溯功能，将检测结果、检测头、结构图、特征图相关联，方便用户理解。 AI提示词：请你帮我实现功能：检测框因果回溯。点击任意检测框，自动高亮 P3/P4/P5 中命中的锚点，并在结构图中点亮 m16/m19/m22 → 颈部 → 骨干 的传播路径，同时在输入图上标出对应区域或近似感受野 。

- 提交：`78f9bafcdb4155720b8ac83eaefe663c008d76b2`
- 日期：2026-10-29T19:56:18+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                           |  2 +
 src/App.jsx                         | 58 +++++++++++++++++++++++-
 src/components/CausalTracePanel.jsx | 71 ++++++++++++++++++++++++++++++
 src/components/DetectionList.jsx    | 16 ++++---
 src/components/StructureOverlay.jsx | 16 ++++++-
 src/components/Viewport.jsx         | 19 +++++++-
 src/model/causalTrace.js            | 88 +++++++++++++++++++++++++++++++++++++
 src/styles.css                      | 65 +++++++++++++++++++++++++++
 src/viz/FeatureCanvas.jsx           | 45 ++++++++++++++++---
 src/viz/GraphView.jsx               | 84 +++++++++++++++++++++++++++++------
 src/viz/traceOverlay.js             | 81 ++++++++++++++++++++++++++++++++++
 11 files changed, 518 insertions(+), 27 deletions(-)

## ccd49f7 — 修复因果回溯功能未加载进引导界面的Bug。 AI提示词：因果回溯功能是否加载到了之前做的引导部分当中呢，请你确认一下。如果没有，请将其加入引导部分。

- 提交：`ccd49f7596648ab867054c97d7d6a9e4478339ff`
- 日期：2026-11-02T20:21:53+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 README.md                        |  2 +-
 src/App.jsx                      |  6 ++++++
 src/components/DetectionList.jsx |  2 +-
 src/components/GuidedTour.jsx    | 36 ++++++++++++++++++++++++++++++++++++
 4 files changed, 44 insertions(+), 2 deletions(-)

## cc62e0b — 对项目结构进行文档化介绍，提供竞赛提交需要的内容；删除非运行需要的额外文件；设定复现要求。

- 提交：`cc62e0b001dc29e841fa8b17fe50350838de2028`
- 日期：2026-11-03T10:54:51+08:00
- 作者：YuanShin <Yzh840146078@hotmail.com>


### 变更统计


 .env.example                                       |  11 +
 .gitignore                                         |   3 +-
 .node-version                                      |   1 +
 .npmrc                                             |   1 +
 .nvmrc                                             |   1 +
 README.md                                          |  72 +-
 YOLOv11 架构.svg                                   |   1 -
 docs/submission/AI_PROMPT_HISTORY.md               |  74 ++
 docs/submission/DEMO_VIDEO_SCRIPT.md               |  90 +++
 docs/submission/README.md                          |  61 ++
 docs/submission/SUBMISSION_CHECKLIST.md            |  65 ++
 docs/submission/TECHNICAL_REPORT.md                | 792 +++++++++++++++++++++
 docs/submission/ai-history/01-network-topology.md  |  71 ++
 docs/submission/ai-history/02-detection-head.md    |  77 ++
 .../ai-history/03-guided-tour-causal-trace.md      | 131 ++++
 docs/submission/assets/causal-trace-graph.jpg      | Bin 0 -> 115242 bytes
 docs/submission/assets/causal-trace-input.jpg      | Bin 0 -> 157932 bytes
 docs/submission/assets/channel-grid.jpg            | Bin 0 -> 117913 bytes
 docs/submission/assets/feature-pyramid.jpg         | Bin 0 -> 102208 bytes
 docs/submission/assets/guided-tour.jpg             | Bin 0 -> 113054 bytes
 docs/submission/assets/head-anchors.jpg            | Bin 0 -> 118722 bytes
 docs/submission/assets/head-nms.jpg                | Bin 0 -> 124742 bytes
 docs/submission/assets/layer-relations.jpg         | Bin 0 -> 110420 bytes
 docs/submission/assets/network-architecture.jpg    | Bin 0 -> 101026 bytes
 docs/submission/assets/replay-candidates.jpg       | Bin 0 -> 139130 bytes
 .../pdf/YOLO11-Visualizer-Technical-Report.pdf     | Bin 0 -> 2331873 bytes
 docs/submission/report.css                         | 188 +++++
 legacy/README.md                                   | 125 ----
 legacy/index.html                                  | 152 ----
 legacy/js/app.js                                   | 661 -----------------
 legacy/js/detector.js                              | 255 -------
 legacy/js/kernels.js                               | 255 -------
 legacy/js/pipeline.js                              | 424 -----------
 legacy/js/render.js                                | 247 -------
 legacy/js/samples.js                               | 193 -----
 legacy/styles.css                                  | 271 -------
 package-lock.json                                  |   3 +
 package.json                                       |  10 +-
 shots/preview-output.png                           | Bin 668839 -> 0 bytes
 shots/preview-overview.png                         | Bin 351659 -> 0 bytes
 tools/check-node.mjs                               |  25 +
 tools/probe-causal-tour.mjs                        | 159 +++++
 tools/shot.ps1                                     |  44 --
 43 files changed, 1825 insertions(+), 2638 deletions(-)
