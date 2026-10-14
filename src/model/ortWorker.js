/* Web Worker 外壳：把 ORT 推理放到后台线程，避免阻塞 UI。
   协议：
     in  { type:'init', modelUrl, wasmPaths, numThreads }  -> out { type:'ready', inputName, outputNames, threads }
     in  { type:'run',  id, data, dims }                   -> out { type:'result', id, outputs }
     任何异常                                              -> out { type:'error', id?, message }        */
import { initRunner, runInference } from './runner.js';

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'init') {
      const info = await initRunner({
        modelUrl: msg.modelUrl,
        wasmPaths: msg.wasmPaths,
        numThreads: msg.numThreads,
      });
      self.postMessage({ type: 'ready', ...info });
      return;
    }
    if (msg.type === 'run') {
      const outputs = await runInference(msg.data, msg.dims);
      const transfer = [];
      for (const key of Object.keys(outputs)) transfer.push(outputs[key].data.buffer);
      self.postMessage({ type: 'result', id: msg.id, outputs }, transfer);
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: (err && err.message) || String(err) });
  }
};