import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 面板 UI 独立构建：IIFE 单文件（Vue 打进包内），经 chrome.scripting.executeScript 懒注入。
// 注入发生在隔离世界，与 content.js 同世界 —— window.__WUJI_PANEL__ 对 content.js 直接可见。
// 约束：IIFE 不能用 top-level await / dynamic import；样式走 JS 字符串模块（挂载时注入
// adoptedStyleSheets），不产生独立 CSS 产物。outDir 相对项目根 → 无极/ui/panel-ui.js。
export default defineConfig({
  plugins: [vue()],
  // lib 模式不会自动替换 process.env.NODE_ENV（浏览器无 process，IIFE 求值即崩），
  // 必须显式定义为生产态
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'ui',
    emptyOutDir: false, // ui/ 同时容纳 popup/options/suspended 等手写产物
    lib: {
      entry: 'src-ui/panel/main.js',
      formats: ['iife'],
      name: '__WUJI_PANEL__',
      fileName: () => 'panel-ui.js',
    },
    minify: true,
  },
});
