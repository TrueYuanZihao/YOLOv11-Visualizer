# 竞赛提交检查清单

审计日期：2026-11-03

## 1. 代码仓库与演进记录

- [x] 细粒度 Git 历史：`main` 上 11 次提交，无“initial commit 包含全部功能”。
- [x] 提交信息带有对应 AI Prompt 摘要。
- [x] 三条核心 Prompt 链已导出：[`AI_PROMPT_HISTORY.md`](AI_PROMPT_HISTORY.md)。
- [x] 原始 Codex 会话的 ID、时间与 SHA-256 快照已记录。
- [ ] **人工确认** GitHub/Gitee 仓库为 Public，或给评审账号访问权限。
- [ ] **人工录制** 真实 IDE 对话窗口；文字快照不能替代竞赛要求的视频证据。

仓库：`https://github.com/TrueYuanZihao/YOLOv11-Visualizer.git`

## 2. README 与复现性

- [x] 根 README 提供 10 分钟复现路线、Node 版本、依赖与成功标志。
- [x] `.env.example` 说明本项目无 API Key / 后端依赖。
- [x] 模型、示例图、`layers.json`、`graph.json` 已入库。
- [x] ORT WASM 由 `npm ci` 的 `postinstall` 自动生成。
- [x] 构建与 6 个自动化探针命令已写入 README。
- [x] 真实 vs 推断、近似感受野、回放顺序等边界已声明。
- [x] 已按锁文件执行 `npm ci` → `npm run dev`，模型加载、前向与探针均通过。

## 3. 演示视频

- [ ] **人工录制** 5–8 分钟、1920×1080、MP4 / H.264。
- [ ] 至少 2 分钟真实 AI 协同过程，展示 IDE 中的原始 Prompt、修改建议、代码 diff 与 Bug 修复。
- [ ] 展示新手引导第 10/12 步与 `m16/m19/m22` 因果路径。
- [x] 逐镜头脚本与旁白：[`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md)。

建议命名：`YOLO11-Visualizer-Demo-1080p.mp4`。

## 4. 技术文档

- [x] Markdown 源：[`TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md)。
- [x] 打印样式：[`report.css`](report.css)。
- [x] 覆盖意图控制、架构设计、可复现性、AI 协同与真实性边界。
- [x] 10 张界面证据截图位于 `assets/`。
- [x] 生成 PDF、逐页检查，确认 **20 页 ≤ 30 页**，10 张截图完整。
- [x] 封面已填写：袁子豪 · 西安交通大学 · 2026 年 11 月 4 日。

建议命名：`YOLO11-Visualizer-Technical-Report.pdf`。

## 5. 交付前最终检查

- [x] `npm ci` 成功（63 个包，0 漏洞）。
- [x] `npm run build` 成功（54 个模块）。
- [x] `npm run dev` 加载模型并完成前向（25 个张量）。
- [x] 新手引导 12 步可完整走通。
- [x] 因果回溯高亮 `m16/m19/m22`。
- [x] 结构图拖拽不选中文字，箭头为开放式 marker。
- [x] 仓库无 `.env`、密钥、`node_modules`、虚拟环境或测试截图。
- [ ] README、PDF、MP4、Prompt 快照与仓库链接均已上传官网。

## 6. 材料映射

| 官网要求 | 仓库内材料 | 仍需人工完成 |
| --- | --- | --- |
| 代码仓库 | Git 历史 + README | 检查公开访问权限 |
| Prompt 快照 | `AI_PROMPT_HISTORY.md` + `ai-history/` | IDE 录屏 / 截图 |
| 重现指南 | 根 `README.md` + `.env.example` | 干净环境复跑 |
| 演示视频 | `DEMO_VIDEO_SCRIPT.md` | 录制、剪辑、上传 |
| 技术文档 | `TECHNICAL_REPORT.md` + `report.css` + PDF | 最终校对 |
