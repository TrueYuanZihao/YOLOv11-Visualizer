# 竞赛提交材料索引

更新时间：2026-11-03

## 可直接提交或上传的材料

| 官网要求 | 文件 | 状态 |
| --- | --- | --- |
| 技术文档 PDF | [`pdf/YOLO11-Visualizer-Technical-Report.pdf`](pdf/YOLO11-Visualizer-Technical-Report.pdf) | 20 页，A4，封面已填写 |
| 技术文档源 | [`TECHNICAL_REPORT.md`](TECHNICAL_REPORT.md) | 完成 |
| 打印样式 | [`report.css`](report.css) | 完成 |
| Prompt 索引 | [`AI_PROMPT_HISTORY.md`](AI_PROMPT_HISTORY.md) | 完成 |
| Prompt 快照 | [`ai-history/`](ai-history/) | 3 条完整链 |
| 演示视频脚本 | [`DEMO_VIDEO_SCRIPT.md`](DEMO_VIDEO_SCRIPT.md) | 完成，待录制 |
| 提交检查清单 | [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md) | 完成 |
| 10 分钟复现指南 | 仓库根目录 [`README.md`](../../README.md) | 完成 |
| 环境变量模板 | [`../../.env.example`](../../.env.example) | 完成，无密钥 |
| 界面截图 | [`assets/`](assets/) | 10 张，已嵌入 PDF |

PDF 快照 SHA-256：`8B8BB62EF86EE562798C0F1DDF5D592391BC9D3015B4B7BBA34FD41DEE51E4EC`

## 仍须人工完成

1. 录制 5–8 分钟 MP4（1080p，至少 2 分钟真实 IDE AI 协同）；
2. 导出或录制 IDE 对话证据；
3. 确认 GitHub/Gitee 仓库为 Public 或为评审开放访问；
4. 通过大赛官网提交仓库链接、PDF、MP4 与 Prompt 历史；
5. 最终在干净环境运行一次 `npm ci`、`npm run build` 和页面快速检查。

## 重新生成 PDF

需要 Pandoc 3.x 与 Microsoft Edge：

```powershell
cd docs/submission
pandoc TECHNICAL_REPORT.md -f markdown+raw_html -t html5 -s `
  --embed-resources --resource-path=. --css=report.css `
  --metadata charset=utf-8 `
  --metadata pagetitle="YOLO11 特征激活可视化工作坊 · 技术报告" `
  -o pdf/report.html

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$html = "file:///" + ((Resolve-Path pdf/report.html).Path -replace '\\','/')
$pdf = (Resolve-Path pdf).Path + "\YOLO11-Visualizer-Technical-Report.pdf"

& $edge --headless=new --disable-gpu --no-pdf-header-footer `
  --user-data-dir="$env:TEMP\codex-edge-pdf-profile" `
  --print-to-pdf="$pdf" $html
```

生成后务必用 PDF 阅读器检查页数 ≤ 30、图片无空白、封面信息已填写。

## 文件命名建议

- 技术文档：`YOLO11-Visualizer-Technical-Report.pdf`
- 演示视频：`YOLO11-Visualizer-Demo-1080p.mp4`
- Prompt 历史：`AI_PROMPT_HISTORY.md` + `ai-history/`

## 真实性说明

`ai-history/` 是从本机 Codex 会话导出的可见消息快照，已删除系统指令和冗长工具输出。它不能替代竞赛要求的真实 IDE 录屏；视频中应展示原始 Prompt、代码改动与至少一次 Bug 修复过程。
