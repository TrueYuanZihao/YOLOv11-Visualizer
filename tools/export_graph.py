r"""从导出的 ONNX 图里提取 YOLO11 的**真实**计算拓扑，供前端画结构图。

不是手画的：按 `/model.<N>/` 前缀把 581 个算子节点归到 24 个模块，
再求出每个模块的「外部输入张量」来自哪个模块 —— 这样 neck 的跨层跳连
（Concat 拿骨干 P3/P4/P5 的输出）就会自动浮现出来。

用法:
    .venv312\Scripts\python.exe tools/export_graph.py

产物:
    public/models/graph.json
"""
import json
import re
from collections import defaultdict
from pathlib import Path

import onnx

ROOT = Path(__file__).resolve().parent.parent
ONNX = ROOT / "public" / "models" / "yolo11n_vis.onnx"
LAYERS = ROOT / "public" / "models" / "layers.json"
OUT = ROOT / "public" / "models" / "graph.json"

MODULE_RE = re.compile(r"^/model\.(\d+)/")


def shape_label(dims, imgsz, stride, nc=None):
    """张量形状 -> "C×H×W"。动态维用 stride 反推：H = imgsz / stride。"""
    if not dims:
        return None
    if len(dims) == 4:
        c = dims[1] if isinstance(dims[1], int) else None
        if c is None:
            return None
        h = dims[2] if isinstance(dims[2], int) else None
        if h is None and stride:
            h = imgsz // stride
        if h is None:
            return "%d×?×?" % c
        return "%d×%d×%d" % (c, h, h)
    if len(dims) == 3:
        # Detect 头输出 [1, 4+nc, anchors]，动态维按 imgsz 推算
        if nc:
            anchors = sum((imgsz // s) ** 2 for s in (8, 16, 32))
            return "%d×%d" % (4 + nc, anchors)
        return None
    return None


def node_shape(nid, L, imgsz, nc):
    """每个展示节点的 "C×H×W" 标签。"""
    if nid in ("input", "pre"):
        return "3×%d×%d" % (imgsz, imgsz)
    if nid == "output":
        return "%d×%d" % (4 + nc, sum((imgsz // s) ** 2 for s in (8, 16, 32)))
    return shape_label(L.get("shape"), imgsz, L.get("stride", 0), nc)


def main():
    model = onnx.load(str(ONNX))
    layers_doc = json.loads(LAYERS.read_text(encoding="utf-8"))
    meta = layers_doc["meta"]
    imgsz = meta["imgsz"]
    nc = meta["nc"]

    by_id = {L["id"]: L for L in layers_doc["layers"]}
    stride_of = {L["id"]: L.get("stride", 0) for L in layers_doc["layers"]}

    # 张量 -> 产出它的算子节点名
    producer = {}
    for n in model.graph.node:
        for t in n.output:
            producer[t] = n.name

    # 模块 -> 节点列表 / 张量集合
    group_nodes = defaultdict(list)
    for n in model.graph.node:
        mt = MODULE_RE.match(n.name)
        if mt:
            group_nodes[int(mt.group(1))].append(n)

    group_produced = {k: {t for n in v for t in n.output} for k, v in group_nodes.items()}
    module_ids = sorted(group_nodes.keys())

    # 正向：模块输出张量 -> 模块 id
    tensor_owner = {}
    for k, ts in group_produced.items():
        for t in ts:
            tensor_owner.setdefault(t, k)
    # 模块的输出张量（layers.json 里记录的那个）
    out_tensor = {L["module"]: L["tensor"] for L in layers_doc["layers"] if "module" in L}

    # 形状表
    dims_of = {}
    for coll in (model.graph.value_info, model.graph.input, model.graph.output):
        for v in coll:
            tt = v.type.tensor_type
            if not tt.HasField("shape"):
                continue
            dims = []
            for d in tt.shape.dim:
                if d.HasField("dim_value"):
                    dims.append(d.dim_value)
                else:
                    dims.append(d.dim_param or "?")
            dims_of[v.name] = dims

    edges = []
    seen = set()

    # 每个模块的外部输入
    ext_inputs = {}
    for i in module_ids:
        nodes_i = group_nodes[i]
        ins = []
        for n in nodes_i:
            for t in n.input:
                if not t:
                    continue
                if t in group_produced[i]:
                    continue           # 模块内部张量
                if t in producer and producer[t] in {x.name for x in nodes_i}:
                    continue
                ins.append(t)
        # 去重保序
        uniq = []
        for t in ins:
            if t not in uniq:
                uniq.append(t)
        ext_inputs[i] = uniq

    # 把外部输入张量解析成「来自哪个模块」
    for i in module_ids:
        mid = "m%d" % i
        for t in ext_inputs[i]:
            src = None
            if t in tensor_owner:
                src = "m%d" % tensor_owner[t]
            elif t == "images":
                src = "pre"
            elif t in model.graph.input[0].name:
                src = "input"
            if src is None:
                continue               # 常量 / 初始化器，不算连边
            if src == mid:
                continue
            key = (src, mid)
            if key in seen:
                continue
            seen.add(key)
            stride = stride_of.get(src, 0)
            edges.append({
                "from": src,
                "to": mid,
                "tensor": t,
                "shape": shape_label(dims_of.get(t), imgsz, stride, nc),
            })

    # 两条 UI 层的边：letterbox 预处理、检测头解码，ONNX 图里不存在
    edges.append({"from": "input", "to": "pre", "tensor": None, "shape": None, "synthetic": True})
    edges.append({"from": "m23", "to": "output", "tensor": "output0", "shape": None, "synthetic": True})

    all_nodes = ["input", "pre"] + ["m%d" % i for i in module_ids] + ["output"]

    # ---- 最长路径分层 rank ----
    succ = defaultdict(list)
    pred = defaultdict(list)
    for e in edges:
        succ[e["from"]].append(e["to"])
        pred[e["to"]].append(e["from"])

    rank = {n: 0 for n in all_nodes}
    # 按拓扑序做松弛（节点数很少，直接迭代到收敛）
    for _ in range(len(all_nodes) + 2):
        changed = False
        for e in edges:
            if rank[e["to"]] < rank[e["from"]] + 1:
                rank[e["to"]] = rank[e["from"]] + 1
                changed = True
        if not changed:
            break

    for e in edges:
        e["span"] = rank[e["to"]] - rank[e["from"]]
        e["kind"] = "skip" if e["span"] > 1 else "main"

    # ---- 行：骨干一行、颈部一行、检测头一行（来自 layers.json 的 group）----
    row_of_group = {"input": 0, "backbone": 0, "neck": 1, "head": 2, "output": 2}
    out_nodes = []
    for nid in all_nodes:
        L = by_id.get(nid, {})
        group = L.get("group") or ("input" if nid in ("input", "pre") else "output")
        out_nodes.append({
            "id": nid,
            "label": nid,
            "name": L.get("name", nid),
            "block": L.get("block", nid),
            "group": group,
            "stride": L.get("stride", 0),
            "shape": node_shape(nid, L, imgsz, nc),
            "desc": L.get("desc", ""),
            "rank": rank.get(nid, 0),
            "row": row_of_group.get(group, 3),
        })

    doc = {
        "meta": {
            "imgsz": imgsz,
            "source": "public/models/yolo11n_vis.onnx",
            "onnxNodes": len(model.graph.node),
            "modules": len(module_ids),
            "generatedBy": "tools/export_graph.py",
        },
        "nodes": out_nodes,
        "edges": edges,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")

    print("saved ->", OUT)
    print("\n%-8s %-14s %-6s %-4s %-4s" % ("id", "block", "group", "rank", "row"))
    for n in out_nodes:
        print("%-8s %-14s %-6s %-4d %-4d" % (n["id"], n["block"], n["group"], n["rank"], n["row"]))
    print("\n=== edges (%d) ===" % len(edges))
    for e in edges:
        flag = "  <== 跳连" if e["kind"] == "skip" else ""
        print("  %-6s -> %-6s  span=%-2d  %-12s%s" % (e["from"], e["to"], e["span"], e["shape"] or "-", flag))


if __name__ == "__main__":
    main()