import { createApp } from 'vue';
import App from './App.vue';
import '../shared/wuji.css';
import '../shared/ui.css';
import { initTheme } from '../shared/theme.js';

// 先应用主题再挂载，避免闪一下错误的配色
initTheme().then(() => createApp(App).mount('#app'));
