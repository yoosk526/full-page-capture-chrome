// 페이지에 넣는 content script는 import 없는 한 파일(IIFE)이어야 한다
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'HanjangCaptureContent',
      fileName: () => 'content.js',
    },
  },
});
