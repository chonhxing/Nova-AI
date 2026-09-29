import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// 以 src-ui 为根；产物直接输出到 ../ui，文件名保持 popup.js / options.js（与 manifest 一致）。
// ui/ 中的构建产物随仓库提交，普通用户无需 npm 也能"加载已解压的扩展程序"。
export default defineConfig({
  root: 'src-ui',
  plugins: [vue()],
  base: './',
  build: {
    outDir: '../ui',
    emptyOutDir: false, // ui/ 里还有手写的 suspended.html 等，不清空
    rollupOptions: {
      input: {
        popup: resolve(root, 'src-ui/popup.html'),
        options: resolve(root, 'src-ui/options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
