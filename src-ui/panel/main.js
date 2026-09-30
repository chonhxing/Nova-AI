/**
 * 无极 — 面板 UI 入口（IIFE 单文件，经 chrome.scripting.executeScript 懒注入）
 *
 * 注入发生在扩展隔离世界（executeScript 默认 world），与 libs/content.js 同世界，
 * 因此 window.__WUJI_PANEL__ 对 content.js / danmaku-player.js 直接可见。
 *
 * 幂等性：executeScript 可能重复执行本文件 —— Vue 运行时会重新求值，但
 * 挂载状态存放在 window.__WUJI_PANEL_STATE__（跨注入持久），已挂载时直接
 * 复用 API，绝不会双重挂载；未挂载时重新执行也无全局 let/const 冲突
 * （IIFE 包裹，模块级变量都在闭包里）。
 */
import { createApp } from 'vue';
import ChatApp from './chat/App.vue';
import DanmakuApp from './danmaku/App.vue';
import BiliApp from './bili/App.vue';
import { CHAT_STYLES, DANMAKU_STYLES, BILI_STYLES } from './styles.js';

// 跨注入持久的状态仓：重复注入时复用，防止双重挂载
const state = (window.__WUJI_PANEL_STATE__ = window.__WUJI_PANEL_STATE__ || { chat: null, danmaku: null, bili: null });

function adoptStyles(shadowRoot, css) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
  } catch (e) {
    // adoptedStyleSheets 不可用（老内核）时退回 <style> 注入
    const style = document.createElement('style');
    style.textContent = css;
    shadowRoot.appendChild(style);
  }
}

// ============================================================
// 聊天面板（业务桥由 content.js 提供：sendPrompt/persistAssistant/...）
// ============================================================
export function mountChat({ shadowRoot, host, bridge }) {
  if (state.chat) return state.chat.api;
  adoptStyles(shadowRoot, CHAT_STYLES);
  const mountEl = document.createElement('div');
  shadowRoot.appendChild(mountEl);
  const app = createApp(ChatApp);
  app.provide('bridge', bridge);
  app.provide('host', host);
  const api = app.mount(mountEl);
  state.chat = { app, mountEl };
  return api;
}

export function unmountChat() {
  const c = state.chat;
  if (!c) return;
  try { c.app.unmount(); } catch (e) { /* ignore */ }
  if (c.mountEl) c.mountEl.remove();
  state.chat = null;
}

// ============================================================
// 弹幕管理面板（业务桥由 danmaku-player.js 提供：crawl/getSets/...）
// ============================================================
export function mountDanmaku({ shadowRoot, host, bridge }) {
  if (state.danmaku) return state.danmaku.api;
  adoptStyles(shadowRoot, DANMAKU_STYLES);
  const mountEl = document.createElement('div');
  shadowRoot.appendChild(mountEl);
  const app = createApp(DanmakuApp);
  app.provide('bridge', bridge);
  app.provide('host', host);
  const api = app.mount(mountEl);
  state.danmaku = { app, mountEl };
  return api;
}

export function unmountDanmaku() {
  const c = state.danmaku;
  if (!c) return;
  try { c.app.unmount(); } catch (e) { /* ignore */ }
  if (c.mountEl) c.mountEl.remove();
  state.danmaku = null;
}

// ============================================================
// B站视频下载面板（业务桥由 bili-entry.js 提供：getBvid/getPage/send/close）
// ============================================================
export function mountBili({ shadowRoot, host, bridge }) {
  if (state.bili) return state.bili.api;
  adoptStyles(shadowRoot, BILI_STYLES);
  const mountEl = document.createElement('div');
  shadowRoot.appendChild(mountEl);
  const app = createApp(BiliApp);
  app.provide('bridge', bridge);
  app.provide('host', host);
  const api = app.mount(mountEl);
  state.bili = { app, mountEl };
  return api;
}

export function unmountBili() {
  const c = state.bili;
  if (!c) return;
  try { c.app.unmount(); } catch (e) { /* ignore */ }
  if (c.mountEl) c.mountEl.remove();
  state.bili = null;
}
