import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开启 COOP/COEP，让 onnxruntime-web 能用 SharedArrayBuffer 多线程跑 WASM
const coiHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { headers: coiHeaders },
  preview: { headers: coiHeaders },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
  },
  worker: { format: 'es' },
});
