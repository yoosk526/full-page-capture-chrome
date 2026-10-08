// 확장 프로그램 화면들(HTML)과 서비스 워커를 빌드한다. content script는 vite.content.config.ts에서 따로(IIFE) 빌드한다.
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const src = resolve(__dirname, 'src');

export default defineConfig({
  root: src,
  base: './',
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(src, 'popup.html'),
        result: resolve(src, 'result.html'),
        editor: resolve(src, 'editor.html'),
        options: resolve(src, 'options.html'),
        gallery: resolve(src, 'gallery.html'),
        background: resolve(src, 'background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
