// 페이지에 넣는 content script는 import 없는 한 파일(IIFE)이어야 한다.
// 기본: content.js(스크롤 촬영), --mode area: area.js(페이지 일부 영역 고르기)
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const area = mode === 'area';
  return {
    publicDir: false,
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: false,
      target: 'chrome116',
      sourcemap: false,
      lib: {
        entry: resolve(__dirname, area ? 'src/content/area.ts' : 'src/content/index.ts'),
        formats: ['iife'],
        name: area ? 'HanjangCaptureArea' : 'HanjangCaptureContent',
        fileName: () => (area ? 'area.js' : 'content.js'),
      },
    },
  };
});
