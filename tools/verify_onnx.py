"""验证导出结果：对比 onnxruntime 与 PyTorch 原模型的输出，并导出中间层统计。"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

ROOT = Path(__file__).resolve().parent.parent
WEIGHTS = ROOT / "ultralytics-main" / "ultralytics" / "yolo11n.pt"
ONNX = ROOT / "public" / "models" / "yolo11n_vis.onnx"
IMGSZ = 320

torch.manual_seed(0)
x = np.random.RandomState(7).rand(1, 3, IMGSZ, IMGSZ).astype(np.float32)

# ---- torch 原模型 ----
m = torch.load(str(WEIGHTS), map_location="cpu", weights_only=False)["model"].float().eval()
with torch.no_grad():
    y = m(torch.from_numpy(x))
if isinstance(y, (list, tuple)):
    y = y[0]
y = y.numpy()
print("torch output0:", y.shape)

# ---- onnxruntime ----
sess = ort.InferenceSession(str(ONNX), providers=["CPUExecutionProvider"])
names = [o.name for o in sess.get_outputs()]
outs = sess.run(None, {sess.get_inputs()[0].name: x})
res = dict(zip(names, outs))
print("ort  output0:", res["output0"].shape)

diff = np.abs(res["output0"] - y)
print("max abs diff  : %.3e" % diff.max())
print("mean abs diff : %.3e" % diff.mean())
print("allclose(1e-3):", bool(np.allclose(res["output0"], y, atol=1e-3)))

# ---- 中间层统计（给前端做合理性对照） ----
layers = json.loads((ROOT / "public" / "models" / "layers.json").read_text(encoding="utf-8"))["layers"]
print()
print("%-24s %-22s %8s %8s %8s" % ("layer", "shape", "min", "max", "mean"))
for L in layers:
    t = L.get("tensor")
    if not t or t not in res:
        continue
    a = res[t]
    print("%-24s %-22s %8.3f %8.3f %8.3f" % (L["name"], str(list(a.shape)), a.min(), a.max(), a.mean()))

ok = bool(np.allclose(res["output0"], y, atol=1e-3))
print()
print("VERIFY:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
