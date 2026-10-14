/* 真正跑推理的执行器：既能在 Web Worker 里跑，也能在主线程兜底。
   负责：加载 onnxruntime-web -> 指定本地 wasm 路径 -> 建 session -> 跑一次前向。
   返回模型暴露的全部张量（含 23 个中间层激活 + output0）。 */
import * as ort from 'onnxruntime-web';

let session = null;
let inputName = null;
let outputNames = [];
let threadsUsed = 1;
let loading = null;

async function createSession(opts, threads) {
  ort.env.logLevel = 'error';
  ort.env.wasm.wasmPaths = opts.wasmPaths;
  ort.env.wasm.numThreads = threads;
  const s = await ort.InferenceSession.create(opts.modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return s;
}

function info() {
  return { inputName, outputNames: outputNames.slice(), threads: threadsUsed };
}

export function runnerInfo() {
  return session ? info() : null;
}

export async function initRunner(opts) {
  if (session) return info();
  if (loading) return loading;
  loading = (async () => {
    const wanted = Math.max(1, Math.min(4, Math.floor(opts.numThreads || 1)));
    try {
      session = await createSession(opts, wanted);
      threadsUsed = wanted;
    } catch (err) {
      // 多线程 / SharedArrayBuffer 不可用时退回单线程
      session = await createSession(opts, 1);
      threadsUsed = 1;
    }
    inputName = session.inputNames[0];
    outputNames = session.outputNames.slice();
    return info();
  })();
  return loading;
}

export async function runInference(data, dims) {
  if (!session) throw new Error('推理后端尚未初始化');
  const feeds = {};
  feeds[inputName] = new ort.Tensor('float32', data, dims);
  const raw = await session.run(feeds);
  const payload = {};
  for (const name of outputNames) {
    const t = raw[name];
    if (!t) continue;
    const src = t.data;
    const copy = src instanceof Float32Array ? src.slice() : Float32Array.from(src);
    payload[name] = { dims: Array.from(t.dims), data: copy };
  }
  return payload;
}