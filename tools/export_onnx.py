"""导出 YOLO11n 为 ONNX，并把中间层张量暴露成图输出，供前端逐层可视化。

用法:
    .venv312\Scripts\python.exe tools\export_onnx.py --imgsz 320

产物:
    public/models/yolo11n_vis.onnx   —— 带中间层输出的模型
    public/models/layers.json        —— 层清单（名称/形状/说明/ONNX 张量名）
"""
import argparse
import json
import shutil
from pathlib import Path

import onnx

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = ROOT / "ultralytics-main" / "ultralytics" / "yolo11n.pt"
OUT_DIR = ROOT / "public" / "models"

# --------------------------------------------------------------------------
# 与 yolo11.yaml 对应的中文元信息（key = model.<i> 的模块序号）
# --------------------------------------------------------------------------
LAYER_META = {
    0:  ("Conv k3 s2",            "Conv",   "backbone", 2,  "第一次卷积并把分辨率降一半。学到的多是边缘、色块等低级特征。"),
    1:  ("Conv k3 s2",            "Conv",   "backbone", 4,  "第二次下采样。感受野变大，开始出现纹理与局部结构。"),
    2:  ("C3k2 特征提取块",        "C3k2",   "backbone", 4,  "通道先分裂再走不同数量的瓶颈分支，最后拼接融合。"),
    3:  ("Conv k3 s2",            "Conv",   "backbone", 8,  "进入 P3/8 尺度，检测小目标的主力尺度。"),
    4:  ("C3k2 特征提取块",        "C3k2",   "backbone", 8,  "通道数翻倍，语义信息增强，空间细节开始丢失。"),
    5:  ("Conv k3 s2",            "Conv",   "backbone", 16, "进入 P4/16 尺度，中等目标的主要尺度。"),
    6:  ("C3k2 特征提取块",        "C3k2",   "backbone", 16, "深层特征，一个像素已对应原图 16x16 的区域。"),
    7:  ("Conv k3 s2",            "Conv",   "backbone", 32, "进入 P5/32 尺度，特征图很小但感受野覆盖整幅图。"),
    8:  ("C3k2 特征提取块",        "C3k2",   "backbone", 32, "主干最深处，表征的是“那里有什么”而不是“长什么样”。"),
    9:  ("SPPF 空间金字塔池化",    "SPPF",   "backbone", 32, "三次最大池化串行堆叠（感受野 5/9/13）后并联，一次拿到多尺度上下文。"),
    10: ("C2PSA 自注意力",        "C2PSA",  "backbone", 32, "YOLO11 新增的位置敏感注意力：按通道算注意力权重再回乘特征。"),
    11: ("Upsample x2",          "Upsample", "neck",   16, "把深层特征放大一倍，准备与 P4 的特征拼接。"),
    12: ("Concat (主干 P4)",       "Concat", "neck",    16, "与主干第 6 层输出在通道维拼接，把浅层定位信息带进深层。"),
    13: ("C3k2 融合",             "C3k2",   "neck",    16, "拼接后融合，得到中等尺度特征。"),
    14: ("Upsample x2",          "Upsample", "neck",   8,  "再放大一次，准备与 P3 特征拼接。"),
    15: ("Concat (主干 P3)",       "Concat", "neck",    8,  "与主干第 4 层输出拼接，小目标检测的关键路径。"),
    16: ("C3k2 -> P3 输出",        "C3k2",   "neck",    8,  "小目标检测头使用的特征：分辨率最高、细节最丰富。"),
    17: ("Conv k3 s2 下采样",      "Conv",   "neck",    16, "自顶向下之后再自底向上，把定位信息带回中层。"),
    18: ("Concat (颈部 P4)",       "Concat", "neck",    16, "与颈部第 13 层输出拼接。"),
    19: ("C3k2 -> P4 输出",        "C3k2",   "neck",    16, "中目标检测头使用的特征。"),
    20: ("Conv k3 s2 下采样",      "Conv",   "neck",    32, "把信息继续带到最深尺度。"),
    21: ("Concat (颈部 P5)",       "Concat", "neck",    32, "与颈部第 10 层输出拼接。"),
    22: ("C3k2 -> P5 输出",        "C3k2",   "neck",    32, "大目标检测头使用的特征。"),
    23: ("Detect 解耦检测头",      "Detect", "head",    0,  "三条尺度分支各自输出 64 通道边框回归(DFL) + 80 通道类别分数。"),
}

GROUP_LABEL = {"input": "输入", "backbone": "主干 Backbone", "neck": "颈部 Neck",
               "head": "检测头 Head", "output": "输出"}


def module_output(model, idx):
    """取 model.<idx> 这个模块最终输出的张量名。"""
    prefix = "/model.%d/" % idx
    order = {}
    for k, n in enumerate(model.graph.node):
        for t in n.output:
            order[t] = k
    nodes = [n for n in model.graph.node if n.name.startswith(prefix)]
    if not nodes:
        return None
    produced, consumed = [], set()
    for n in nodes:
        produced.extend(n.output)
        consumed.update(n.input)
    cand = [t for t in produced if t not in consumed]
    cand.sort(key=lambda t: order.get(t, -1))
    return cand[-1] if cand else None


def shape_of(vi_map, name):
    """返回 [dims...]，动态维用字符串占位。"""
    v = vi_map.get(name)
    if v is None or not v.type.HasField("tensor_type"):
        return None
    dims = []
    for d in v.type.tensor_type.shape.dim:
        if d.HasField("dim_value"):
            dims.append(d.dim_value)
        elif d.HasField("dim_param"):
            dims.append(d.dim_param)
        else:
            dims.append(None)
    return dims


def tensor_report(model):
    vi = {}
    for coll in (model.graph.value_info, model.graph.input, model.graph.output):
        for v in coll:
            vi[v.name] = v
    rows = []
    for k, n in enumerate(model.graph.node):
        for t in n.output:
            rows.append({"k": k, "node": n.name, "op": n.op_type, "tensor": t,
                         "shape": shape_of(vi, t)})
    return rows


def build_layers(model):
    vi = {}
    for coll in (model.graph.value_info, model.graph.input, model.graph.output):
        for v in coll:
            vi[v.name] = v
    layers = []
    layers.append({"id": "input", "name": "输入图像", "block": "Input", "group": "input",
                   "stride": 1, "tensor": None, "shape": None,
                   "desc": "原始 RGB 图像，进入网络前会被缩放并 letterbox 到统一尺寸。"})
    layers.append({"id": "pre", "name": "预处理 · Letterbox", "block": "Preprocess", "group": "input",
                   "stride": 1, "tensor": model.graph.input[0].name,
                   "shape": shape_of(vi, model.graph.input[0].name),
                   "desc": "等比缩放 + 灰边填充到正方形，像素归一化到 0~1；这就是网络真正看到的张量。"})
    for i in range(24):
        t = module_output(model, i)
        if t is None:
            continue
        name, block, group, stride, desc = LAYER_META[i]
        layers.append({"id": "m%d" % i, "name": name, "block": block, "group": group,
                       "stride": stride, "tensor": t, "shape": shape_of(vi, t), "desc": desc,
                       "module": i})
    layers.append({"id": "output", "name": "输出层 · NMS 之后", "block": "Output", "group": "output",
                   "stride": 1, "tensor": "output0", "shape": shape_of(vi, "output0"),
                   "desc": "三个尺度汇总的候选，经置信度筛选与非极大值抑制后得到最终检测框。"})
    return layers


def patch_outputs(model, layers):
    vi = {}
    for coll in (model.graph.value_info, model.graph.input, model.graph.output):
        for v in coll:
            vi[v.name] = v
    existing = {o.name for o in model.graph.output}
    added = []
    for L in layers:
        t = L.get("tensor")
        if not t or t in existing:
            continue
        v = vi.get(t)
        if v is not None:
            model.graph.output.append(v)
        else:
            model.graph.output.append(onnx.helper.make_tensor_value_info(t, onnx.TensorProto.FLOAT, None))
        existing.add(t)
        added.append(t)
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--static", action="store_true")
    ap.add_argument("--name", default="yolo11n_vis.onnx")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not WEIGHTS.exists():
        raise SystemExit("weights not found: %s" % WEIGHTS)

    from ultralytics import YOLO
    print("exporting from", WEIGHTS.name, "imgsz=%d dynamic=%s opset=%d" %
          (args.imgsz, not args.static, args.opset))
    yolo = YOLO(str(WEIGHTS))
    exported = Path(yolo.export(format="onnx", imgsz=args.imgsz, dynamic=not args.static,
                                opset=args.opset, simplify=False, half=False,
                                device="cpu", verbose=False))
    print("exported ->", exported)

    model = onnx.load(str(exported))
    try:
        model = onnx.shape_inference.infer_shapes(model, strict_mode=False)
    except Exception as e:
        print("WARN shape inference failed:", e)

    layers = build_layers(model)
    added = patch_outputs(model, layers)
    print("added %d intermediate outputs" % len(added))

    dst = OUT_DIR / args.name
    onnx.save(model, str(dst))
    print("saved ->", dst, "(%.1f MB)" % (dst.stat().st_size / 1e6))

    names = yolo.names if isinstance(yolo.names, dict) else {i: n for i, n in enumerate(yolo.names)}
    meta = {"imgsz": args.imgsz, "dynamic": not args.static, "opset": args.opset,
            "nc": len(names), "classNames": [names[i] for i in sorted(names)],
            "weights": WEIGHTS.name, "groups": GROUP_LABEL}
    (OUT_DIR / "layers.json").write_text(
        json.dumps({"meta": meta, "layers": layers}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("saved ->", OUT_DIR / "layers.json")

    print("\n=== layers ===")
    for i, L in enumerate(layers):
        print("%2d  %-22s %-9s %-12s %s" % (i, L["name"], L["block"], L["group"], L["shape"]))

    # ---- 用 onnxruntime 跑一遍，确认所有输出都能拿到 ----
    import numpy as np
    import onnxruntime as ort
    sess = ort.InferenceSession(str(dst), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    x = np.random.rand(1, 3, args.imgsz, args.imgsz).astype(np.float32)
    outs = sess.run(None, {inp.name: x})
    print("\n=== onnxruntime smoke test: %d outputs ===" % len(outs))
    for o, val in zip(sess.get_outputs(), outs):
        print("  %-60s %s" % (o.name, list(val.shape)))


if __name__ == "__main__":
    main()
