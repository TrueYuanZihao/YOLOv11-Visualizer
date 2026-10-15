# YOLO11 特征激活可视化工作坊

用 **真实预训练权重**（`yolo11n.pt`）在浏览器里逐层查看 YOLO11 的特征激活。
不是示意图：网页里跑的是一次真正的 ONNX 前向传播，每一层的热力图都来自该次推理的真实张量。

技术栈：**Vite + React 19 + Three.js + onnxruntime-web（WASM）**。

---

## 快速开始

```powershell
npm install          # 会自动把 onnxruntime-web 的 wasm 运行时复制到 public/ort
npm run dev          # http://localhost:5173
```

想自己重新导出模型（需要仓库里的 Python 环境）：

```powershell
npm run export:onnx  # .venv312 里跑 tools/export_onnx.py --imgsz 320
npm run verify:onnx  # 与 torch 输出对比，验证导出正确
npm run export:graph # 解析 ONNX 计算图，生成网络拓扑 public/models/graph.json
```

### 仓库里有什么

入库（约 **16 MB / 50 个文件**）：

| 内容 | 说明 |
| --- | --- |
| `src/` `index.html` `vite.config.js` `package*.json` `tools/` | 全部源码与配置 |
| `public/models/yolo11n_vis.onnx` | 10 MB，跑起来必需，已入库 |
| `public/models/layers.json` `public/samples/street.jpg` | 层清单与示例图 |
| `public/models/graph.json` | 约 10 KB，网络拓扑（节点 + 连边），结构图必需 |
| `ultralytics-main/ultralytics/yolo11n.pt` | 5.4 MB，只为「重新导出 ONNX」保留 |

不入库（`.gitignore` 已排除，都能一条命令再生）：

| 内容 | 体积 | 怎么回来 |
| --- | --- | --- |
| `node_modules/` | 240 MB | `npm install` |
| `.venv/` `.venv312/` | 1.0 GB | 重建 Python 环境（仅重新导出模型时才需要） |
| `dist/` | 121 MB | `npm run build` |
| `public/ort/` | 82 MB | `npm install` 的 postinstall 自动执行 `tools/sync-ort.mjs` |
| `ultralytics-main/`（除权重） | 25 MB | 从上游仓库重新拉取 |
| `shots/` | — | `npm run probe` 生成的截图与无头浏览器 profile |

验过一遍：把入库文件复制到空目录后执行 `npm install` → `npm run dev`，模型加载正常、前向 165 ms、25 个张量齐全、四个视图均无报错。

---

## 它是怎么工作的

```
street.jpg ──letterbox(114灰边,320×320)──▶ Float32 NCHW ──▶ ONNX Runtime (wasm)
                                                              │
                          24 个图输出 + output0 ◀──────────────┘
                                    │
        ┌───────────────────────────┼────────────────────────────┐
   逐层统计/RMS 通道能量       检测解码 + NMS              可视化渲染
   （右侧统计面板）           （检测结果面板）       （2D 热力图 / 3D 堆叠）
```

一次前向大约 **180 ms**（CPU / wasm，4 线程），拿到 25 个张量。

### 模型契约

`tools/export_onnx.py` 把 YOLO11 的中间张量加进 ONNX 的 `graph.output`：

- 输入：`images` `[1, 3, 320, 320]` float32（动态维度）
- 输出：`output0` `[1, 84, 2100]`（4 个框坐标 + 80 类分数，DFL 已在导出时解码）
- 另外 23 个输出：`/model.0/act/Mul_output_0` … `/model.22/cv2/act/Mul_output_0`
- 附带 `images` 本身作为输出，方便直接查看预处理后的输入张量

`public/models/layers.json` 描述这 27 个阶段（input / pre / m0…m23 / output），
包含模块名、stride、所属分组和一段中文说明。

---

## 界面

- **左侧 流水线**：backbone / neck / head 分组的 27 个阶段。点选任意层，右侧条形长度表示该层激活的 RMS 能量（检测头 logits 量级过大，已排除在归一化之外）。
  多路输入的层（颈部 Concat、Detect）会标出来路提示 `← m11 + m6`，一眼看出这不是一条直线。
- **中间 视口**：四个视图
  - `2D 特征图`：单通道 / PCA 三通道合成 / 通道均值 / 最大值 / L2，可叠加原图、叠加检测框，鼠标悬停可读出**某个像素的真实激活值**，底部有色标图例与显示区间。
  - `通道网格`：按能量排序的前 12 个通道小图矩阵，一眼看出特征分化。
  - `3D 特征金字塔`：每一层的特征图作为一块切片，沿深度斜向堆成一摞，点击切片切换选中层。
  - `3D 通道堆叠`：把选中层能量最高的若干通道叠成多层「地形图」，**激活值直接做高度位移**，可调起伏幅度。
- **右侧 控制面板**：配色（viridis/inferno/turbo/ice/灰度/冷暖）、伽马、显示区间（百分位/minmax）、通道、堆叠间距、通道数量、置信度阈值与 NMS IoU。
- **右侧 统计面板**：选中层的均值/标准差/极值/RMS/正值占比，以及通道能量排行。

### 真实 vs. 推断

| 内容 | 来源 |
| --- | --- |
| 每层张量数值、形状、统计、热力图 | **真实** 权重前向结果 |
| 检测框、类别、置信度 | **真实** NMS 解码结果 |
| PCA / 通道能量 / 高斯起伏 | 对真实张量的后处理 |
| 层的语义说明（`layers.json` 的 `desc`） | 人工撰写，属解释性文字 |
| 结构图的节点与连边（含 6 条跨层跳连） | **真实** ONNX 计算图自动提取，非人工绘制 |

---

## 网络结构图（真实拓扑）

左上角 **网络结构图** 按钮打开整屏的结构视图。它不是按 `layers.json` 顺序画的一条线，
而是 `tools/export_graph.py` 解析 `yolo11n_vis.onnx` 的 **581 个算子**、按 `/model.<N>/` 前缀
归并成 24 个模块，再统计每个模块真正吃进的外来张量，由此得到 **32 条连边**，其中
**6 条是跨层跳连**：

| 跳连 | 跨度 | 张量 | 含义 |
| --- | --- | --- | --- |
| m6 → m12 | 跨 6 层 | 128×20×20 | 骨干 P4 直接进颈部 Concat |
| m4 → m15 | 跨 11 层 | 128×40×40 | 骨干 P3 直接进颈部 Concat |
| m13 → m18 | 跨 5 层 | 128×20×20 | 颈部内部再融合 |
| m10 → m21 | 跨 11 层 | 256×10×10 | 骨干 SPPF/C2PSA 进颈部 Concat |
| m16 → m23 | 跨 7 层 | 64×40×40 | P3 特征直送 Detect |
| m19 → m23 | 跨 4 层 | 128×20×20 | P4 特征直送 Detect |

交互方式：

- 滚轮缩放、拖背景平移、**拖节点自由摆位**（只改排布，不动数据）。
- 点节点 = 选中该层：图上蓝色高亮它的全部上游依赖、绿色高亮下游流向，其余压暗。
- 右侧详情给出张量形状、数值统计、可点击的「输入来自 / 输出流向」列表，以及 6 条跳连清单一键跳转。
- 「回中间查看这一层的数据」关掉浮层，中间视图就停在刚选的那层上，左侧列表同步选中。
- 详情里的 **PCA / 单通道 / 均值** 可换预览图的通道合成方式（与右侧控制面板的「切片配色」是同一个设置）。
- 缩放到 62% 以上才显示模块名与形状，32% 以上才显示节点编号，避免缩小时糊成一团。

> 拓扑是从 ONNX 图里算出来的，不是照着论文画的；模块归属、`span`、连边都可复现（`npm run export:graph`）。

---

## 目录结构

```
index.html              入口
src/
  App.jsx               状态编排：加载模型 → 预处理 → 前向 → 分发可视化
  state/
    graphLayout.js      拓扑 → 二维布局（分带 / 分层 / 贝塞尔连边）
  model/
    runner.js           ORT 执行器（Worker / 主线程共用）
    ortWorker.js        Web Worker 外壳
    session.js          会话封装，Worker 不可用时退回主线程
    preprocess.js       ultralytics 一致的 letterbox + NCHW 归一化
    detect.js           output0 解码 + 逐类 NMS
    layers.js           资源路径 + layers.json 加载
  viz/
    field.js            统计、百分位归一化、通道能量、PCA 合成
    colormap.js         伪彩色表
    render.js           标量场 → canvas
    FeatureCanvas.jsx   2D 视图
    ChannelGrid.jsx     通道网格
    VolStack.jsx        Three.js 3D 堆叠（金字塔 / 通道地形）
    GraphView.jsx       SVG 网络结构图（缩放 / 平移 / 拖节点 / 高亮依赖路径）
  components/           流水线、控制面板、检测结果、统计面板、结构图浮层
public/
  models/               yolo11n_vis.onnx + layers.json
  ort/                  onnxruntime-web 运行时（postinstall 自动同步）
  samples/street.jpg
tools/
  export_onnx.py        导出带中间层的 ONNX
  export_graph.py       解析 ONNX 计算图 → 网络拓扑 graph.json
  verify_onnx.py        与 torch 结果比对
  sync-ort.mjs          同步 wasm 运行时
  probe.mjs             用 Edge 做端到端验证（控制台日志 + 四个视图截图）
  layers.mjs            逐层冒烟测试（input / pre / m0 / m12 / m22 / output）
  probe-structure.mjs   结构图冒烟测试（节点 / 连边 / 跳连 / 拖动 / 预览源切换）
legacy/                 第一版「示意内核」可视化，保留作对照
```

---

## 已知限制

- 只支持 CPU（wasm）执行；WebGPU 后端未启用。
- 模型按 `imgsz=320` 导出，位置编码与锚点数量（2100）与之绑定；换尺寸需重新导出。
- 3D 金字塔的「单通道」配色对所有层使用同一个通道索引，不同层的通道语义并不对齐，仅作参考。
- `public/ort` 下的 wasm 从本地加载（CDN 不可达），构建产物因此偏大，属预期行为。
- 结构图的模块划分依赖导出时张量名的 `/model.<N>/` 前缀；若改用别的方式导出 ONNX，需要重跑 `npm run export:graph` 校对。
- 结构图里 `rank`（深度层级）由最长路径松弛算出，仅用于排序与标注，不代表计算依赖的先后约束。