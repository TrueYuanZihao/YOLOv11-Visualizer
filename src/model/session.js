/* 主线程侧的推理会话封装：优先用 Worker，Worker 不可用时退回主线程执行。 */
let workerPromise = null;

class WorkerSession {
  constructor(worker, info) {
    this.worker = worker;
    this.info = info;
    this.seq = 0;
    this.pending = new Map();
    worker.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'result') {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p.resolve(m.outputs); }
      } else if (m.type === 'error') {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p.reject(new Error(m.message)); }
        else this.onerror && this.onerror(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      const err = new Error('推理 Worker 出错：' + (e.message || 'unknown'));
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  static async create(opts) {
    const worker = new Worker(new URL('./ortWorker.js', import.meta.url), { type: 'module' });
    const info = await new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        const m = ev.data || {};
        if (m.type === 'ready') { cleanup(); resolve(m); }
        else if (m.type === 'error') { cleanup(); reject(new Error(m.message)); }
      };
      const onErr = (e) => { cleanup(); reject(new Error('Worker 启动失败：' + (e.message || 'unknown'))); };
      const cleanup = () => {
        worker.removeEventListener('message', onMsg);
        worker.removeEventListener('error', onErr);
      };
      worker.addEventListener('message', onMsg);
      worker.addEventListener('error', onErr);
      worker.postMessage({ type: 'init', ...opts });
    });
    return new WorkerSession(worker, info);
  }

  run(data, dims) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'run', id, data, dims }, [data.buffer]);
    });
  }

  dispose() {
    try { this.worker.terminate(); } catch (e) { /* noop */ }
    this.pending.clear();
  }
}

class MainThreadSession {
  constructor(info) { this.info = info; this.mod = null; }

  static async create(opts) {
    const mod = await import('./runner.js');
    const info = await mod.initRunner(opts);
    const s = new MainThreadSession(info);
    s.mod = mod;
    return s;
  }

  async run(data, dims) {
    return this.mod.runInference(data, dims);
  }

  dispose() {}
}

/** 建会话：先试 Worker；失败则在主线程兜底（少数环境会禁用 module worker）。 */
export async function createSession(opts) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    try {
      return await WorkerSession.create(opts);
    } catch (err) {
      console.warn('[session] Worker 不可用，退回主线程推理：', err.message);
      return await MainThreadSession.create(opts);
    }
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}