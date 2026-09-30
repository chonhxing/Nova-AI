/**
 * 无极 — Content Script
 * 功能：
 *   1. 页面内容提取（发送到 SW 存储）
 *   2. 悬浮聊天窗（Shadow DOM 隔离）
 *   3. 选中文字轮盘（解释/翻译/改写）
 *   4. ActionExecutor 原子操作
 *   5. 视频字幕提取
 */

// 注入幂等守卫：扩展重载后旧脚本的监听器残留是错位消息的常见来源，二次执行直接退出
if (window.__wujiContentLoaded) {
  throw new Error('[无极] content script 已初始化，跳过重复注入');
}
window.__wujiContentLoaded = true;

// 版本号从 manifest 动态读取（单一数据源），UI 不再硬编码
const APP_VERSION = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '';

// ============================================================
// 全局状态
// ============================================================
let chatPanelVisible = false; // 面板挂载即 true，关闭即 unmount
let isProcessing = false;
let conversationHistory = [];
const MAX_HISTORY = 20;
const STORAGE_KEY = 'wuji_conversation';

// 悬浮轮盘状态
let toolbarEl = null;
let popupEl = null;
let selectedText = '';
let isToolbarVisible = false;
let popupJustOpened = false;
let popupStreamingContent = '';
let popupCurrentAction = '';

// ============================================================
// SVG 图标系统（统一风格，替代 emoji）
// ============================================================
const ICO = {
  // 16x16 内联 SVG，stroke 风格，与品牌色 #6366f1 一致
  doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  save: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  bulb: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  pen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  cross: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  trash: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  x: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  compress: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
  sun: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  monitor: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  moonCrescent: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
};

// ============================================================
// 第一部分：页面内容提取
// ============================================================
function getPageContent() {
  const title = document.title || window.location.href;
  const url = window.location.href;
  const bodyText = document.body ? document.body.innerText : '';
  const cleanedText = bodyText.replace(/[\r\n]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { url, title, fullText: cleanedText, keyParagraphs: extractKeyParagraphs(), timestamp: Date.now() };
}

function extractKeyParagraphs() {
  const paragraphs = [];
  const MAX = 20, MIN = 80;
  function collect(container) {
    if (!container) return;
    container.querySelectorAll('p').forEach(p => {
      if (paragraphs.length >= MAX) return;
      const t = p.innerText.trim().replace(/\s+/g, ' ');
      if (t.length >= MIN && !paragraphs.includes(t)) paragraphs.push(t);
    });
  }
  collect(document.querySelector('article'));
  collect(document.querySelector('main'));
  collect(document.querySelector('[role="main"]'));
  if (paragraphs.length < MAX) collect(document.body);
  return paragraphs;
}

function sendPageContentToBackground() {
  try {
    const data = getPageContent();
    chrome.runtime.sendMessage({ type: 'PAGE_CONTENT', payload: data }, r => {
      if (chrome.runtime.lastError) return;
    });
  } catch (e) { /* ignore */ }
}

// ============================================================
// 第二部分：ActionExecutor
// ============================================================
const ActionExecutor = {
  click(sel) { const el = document.querySelector(sel); if (!el) return { success: false, error: '未找到元素' }; el.click(); return { success: true, result: '已点击' }; },
  scrollToElement(sel) { const el = document.querySelector(sel); if (!el) return { success: false, error: '未找到元素' }; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return { success: true, result: '已滚动到' }; },
  extractTable(sel) {
    const table = document.querySelector(sel); if (!table) return { success: false, error: '未找到表格' };
    const headers = [], data = [];
    table.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('th, td'); const rowData = {};
      cells.forEach((c, j) => { const t = c.innerText.trim(); if (c.tagName === 'TH') headers[j] = t; else if (headers[j]) rowData[headers[j]] = t; else rowData['col_' + j] = t; });
      if (Object.keys(rowData).length) data.push(rowData);
    });
    return { success: true, result: { headers: headers.filter(Boolean), data, rowCount: data.length, columnCount: headers.filter(Boolean).length } };
  },
  getInnerText(sel) { const el = document.querySelector(sel); if (!el) return { success: false, error: '未找到元素' }; return { success: true, result: el.innerText.trim() }; },
  highlight(sel) {
    const el = document.querySelector(sel); if (!el) return { success: false, error: '未找到元素' };
    const orig = el.style.cssText;
    el.style.cssText += ';border:3px solid #ef5350!important;outline:2px solid rgba(239,83,80,0.4)!important;box-shadow:0 0 12px rgba(239,83,80,0.3)!important;transition:all 0.3s!important;';
    setTimeout(() => { el.style.cssText = orig; }, 3000);
    return { success: true, result: '已高亮（3秒）' };
  },
  scrollDown(params) {
    const px = params?.px || window.innerHeight * 0.8;
    window.scrollBy({ top: px, behavior: 'smooth' });
    return { success: true, result: `已向下滚动 ${px}px` };
  }
};

function executeActionsInPage(actions) {
  return actions.map(a => {
    if (!ActionExecutor[a.action]) return { action: a.action, selector: a.selector, success: false, error: '未知操作' };
    try { return { action: a.action, selector: a.selector, ...ActionExecutor[a.action](a.selector, a.params) }; }
    catch (e) { return { action: a.action, selector: a.selector, success: false, error: e.message }; }
  });
}

// ============================================================
// 第三部分：悬浮聊天窗（Vue 3 懒注入 + Shadow DOM）
// 面板 UI 是独立 IIFE 包（ui/panel-ui.js，Vue 3 编译产物）。首次打开时经
// SW chrome.scripting.executeScript 注入本隔离世界后挂载；关闭即 unmount，
// DOM/监听/响应式树全部释放 —— 未打开过面板的页面零 Vue 成本。
// 业务逻辑（AI 调用/历史持久化/压缩/KB）保留在本文件，经 bridge 双向通道
// 交给 Vue 视图层；本文件不再持有任何面板 DOM。
// ============================================================
let panelUIReady = false;     // ui/panel-ui.js 是否已注入本隔离世界
let panelHostEl = null;       // 面板宿主元素（挂载期间存在，关闭即移除）
let panelApi = null;          // Vue 根实例暴露的 API（addMessage/pushDelta/...）

async function ensurePanelUI() {
  if (panelUIReady && window.__WUJI_PANEL__) return true;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'INJECT_PANEL_UI' });
    if (resp?.success && window.__WUJI_PANEL__) { panelUIReady = true; return true; }
    console.warn('[无极] 面板 UI 注入失败:', resp?.error);
  } catch (e) {
    console.warn('[无极] 面板 UI 注入请求失败:', e.message);
  }
  return false;
}

// 对话持久化（契约不变：chrome.storage.local 'wuji_conversation'，老用户历史无损）
function saveConversation() {
  try { chrome.storage.local.set({ [STORAGE_KEY]: conversationHistory.slice(-MAX_HISTORY) }); } catch (e) { /* ignore */ }
}

async function loadConversation() {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    if (Array.isArray(r[STORAGE_KEY])) conversationHistory = r[STORAGE_KEY];
  } catch (e) { /* ignore */ }
}

// ============================================================
// bridge：Vue → content。content 持有业务与持久化，Vue 是纯视图。
// ============================================================
const panelBridge = {
  getVersion: () => APP_VERSION,
  requestClose: () => toggleChatPanel(false),
  getHistory: () => conversationHistory.slice(),
  async sendPrompt(text) {
    if (isProcessing) throw new Error('正在处理中，请稍候');
    isProcessing = true;
    conversationHistory.push({ role: 'user', content: text });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    saveConversation();
    const resp = await chrome.runtime.sendMessage({
      type: 'AI_CHAT',
      payload: {
        userMessage: text,
        pageUrl: window.location.href,
        pageTitle: document.title,
        enableActions: true,
        conversationHistory: conversationHistory.slice(0, -1)
      }
    });
    if (!resp || !resp.success) throw new Error(resp?.error || '请求失败');
    // 流式内容经 AI_STREAM_DELTA/AI_STREAM_DONE 消息异步下发，由 panelApi 承接
  },
  persistAssistant(text) {
    conversationHistory.push({ role: 'assistant', content: text });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory = conversationHistory.slice(-MAX_HISTORY);
    saveConversation();
    isProcessing = false;
  },
  abortProcessing() { isProcessing = false; },
  async compress() {
    if (conversationHistory.length < 2) return { ok: false, error: '对话太短，无需压缩' };
    isProcessing = true;
    try {
      const r = await chrome.runtime.sendMessage({
        type: 'AI_COMPRESS',
        payload: { conversationHistory: conversationHistory.slice(), pageUrl: window.location.href, pageTitle: document.title }
      });
      if (r?.success && r.summary) {
        conversationHistory = [{ role: 'system', content: '【对话摘要】' + r.summary }];
        saveConversation();
        return { ok: true, summary: r.summary, originalTokens: r.originalTokens, compressedTokens: r.compressedTokens };
      }
      return { ok: false, error: r?.error || '未知错误' };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      isProcessing = false;
    }
  },
  async saveToKB() {
    try {
      const pc = getPageContent();
      const r = await chrome.runtime.sendMessage({
        type: 'KB_V2_SAVE',
        payload: { url: window.location.href, title: document.title, content: pc.fullText.substring(0, 50000), source_type: 'page', auto_tag: true }
      });
      if (conversationHistory.length > 0) {
        chrome.runtime.sendMessage({
          type: 'KB_V2_SAVE',
          payload: { url: window.location.href, title: document.title + ' - 对话', content: JSON.stringify(conversationHistory.slice(-10)), source_type: 'chat', auto_tag: false }
        }).catch(() => {});
      }
      return { ok: !!r?.success, message: r?.success ? '✅ 页面已保存到知识库（含内容块+索引+自动标签）' : '保存失败: ' + (r?.error || '未知错误') };
    } catch (e) {
      return { ok: false, message: '保存失败: ' + e.message };
    }
  },
  async saveAsPdf() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SAVE_AS_PDF' });
      return { ok: !!r?.success, message: r?.success ? 'PDF 已生成并开始下载' : 'PDF 生成失败: ' + (r?.error || '未知错误') };
    } catch (e) {
      return { ok: false, message: 'PDF 生成失败: ' + e.message };
    }
  },
  async videoSummary() {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'VIDEO_SUMMARY' });
      if (r?.success && r.streaming) {
        // 摘要走流式链路，不走 AI_CHAT 历史链路，这里补记保持对话连贯（原实现一致）
        conversationHistory.push({ role: 'user', content: '请总结当前视频内容' });
        saveConversation();
        isProcessing = true;
        return { streaming: true };
      }
      if (r?.success) return { ok: true, message: '视频摘要生成完成' };
      return { ok: false, message: '视频摘要失败: ' + (r?.error || '未知错误') };
    } catch (e) {
      return { ok: false, message: '失败: ' + e.message };
    }
  },
  analyzeImage: () => { try { handleAnalyzeImage(); } catch (e) { /* ignore */ } },
  async loadKB() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_GET_ALL', payload: { limit: 50 } });
      if (resp?.success) return (resp.data || []).map(d => ({ ...d, _store: 'kb_items' }));
    } catch (e) { /* ignore */ }
    return [];
  },
  async searchKB(q) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_SEARCH', payload: { query: q, limit: 20 } });
      if (resp?.success) return (resp.data || []).map(d => ({ ...d, _store: 'kb_items' }));
    } catch (e) { /* ignore */ }
    return [];
  },
  async toggleKBFavorite(id) {
    try { const r = await chrome.runtime.sendMessage({ type: 'KB_V2_TOGGLE_FAVORITE', payload: { id } }); return !!r?.success; }
    catch (e) { return false; }
  },
  async deleteKB(id) {
    try { await chrome.runtime.sendMessage({ type: 'KB_V2_DELETE', payload: { id } }); return true; }
    catch (e) { return false; }
  },
};

async function mountChatPanel() {
  if (panelApi) return;
  if (!(await ensurePanelUI())) return;
  await loadConversation();
  panelHostEl = document.createElement('div');
  panelHostEl.id = 'wuji-chat-host';
  panelHostEl.setAttribute('data-ai-browser', 'chat-panel');
  panelHostEl.style.cssText = 'position:fixed;z-index:99998;right:20px;bottom:20px;';
  document.body.appendChild(panelHostEl);
  const shadow = panelHostEl.attachShadow({ mode: 'open' });
  panelApi = window.__WUJI_PANEL__.mountChat({ shadowRoot: shadow, host: panelHostEl, bridge: panelBridge });
  chatPanelVisible = true;
}

function unmountChatPanel() {
  panelApi = null;
  if (window.__WUJI_PANEL__) { try { window.__WUJI_PANEL__.unmountChat(); } catch (e) { /* ignore */ } }
  if (panelHostEl) { panelHostEl.remove(); panelHostEl = null; }
  chatPanelVisible = false;
  isProcessing = false; // 面板卸载时如有在途流式，直接作废，避免状态卡死
}

async function toggleChatPanel(show) {
  if (show) { await mountChatPanel(); return; }   // await 保证后续 panelApi 就绪
  unmountChatPanel();
}

// HTML 转义（保留区在用：轮盘流式弹窗、图片选择器、图片分析气泡）
function escHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// ============================================================
// 第四部分：悬浮轮盘（选中文字）
// ============================================================
function createToolbar() {
  if (toolbarEl) return;
  toolbarEl = document.createElement('div');
  toolbarEl.id = 'ai-browser-toolbar';
  toolbarEl.setAttribute('data-ai-browser', 'toolbar');
  toolbarEl.style.cssText = 'position:fixed;z-index:99999;display:none;flex-direction:row;align-items:center;gap:6px;padding:6px 10px;background:#ffffff;border:1px solid rgba(99,102,241,0.18);border-radius:28px;box-shadow:0 4px 24px rgba(0,0,0,0.18),0 0 0 1px rgba(99,102,241,0.06);transition:opacity 0.15s,transform 0.15s;user-select:none;-webkit-user-select:none;';

  [
    { action: 'explain', label: '解释', title: '解释选中文字' },
    { action: 'translate', label: '翻译', title: '翻译选中文字' },
    { action: 'rewrite', label: '改写', title: '改写选中文字' }
  ].forEach(cfg => {
    const btn = document.createElement('button');
    btn.setAttribute('data-action', cfg.action);
    btn.title = cfg.title;
    btn.textContent = cfg.label;
    btn.setAttribute('data-ai-browser', 'tool-btn');
    btn.style.cssText = 'height:32px;padding:0 14px;border-radius:20px;border:1px solid rgba(0,0,0,0.10);background:#ffffff;color:#374151;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;outline:none;font-family:inherit;user-select:none;-webkit-user-select:none;';
    btn.addEventListener('mouseenter', () => { btn.style.background = '#6366f1'; btn.style.color = '#fff'; btn.style.borderColor = '#6366f1'; btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#ffffff'; btn.style.color = '#374151'; btn.style.borderColor = 'rgba(0,0,0,0.12)'; btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); handleToolAction(cfg.action); });
    btn.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
    toolbarEl.appendChild(btn);
  });

  document.body.appendChild(toolbarEl);
  createPopup();
}

function createPopup() {
  if (popupEl) return;
  popupEl = document.createElement('div');
  popupEl.id = 'ai-browser-popup';
  popupEl.setAttribute('data-ai-browser', 'popup');
  popupEl.style.cssText = 'position:fixed;z-index:100000;display:none;flex-direction:column;min-width:220px;max-width:340px;padding:16px 18px;background:#ffffff;border:1px solid rgba(99,102,241,0.18);border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.20),0 0 0 1px rgba(99,102,241,0.08);color:#1a1a2e;font-size:13px;line-height:1.6;user-select:text;-webkit-user-select:text;transition:opacity 0.2s,transform 0.2s;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:600;font-size:12px;color:#6366f1;text-transform:uppercase;letter-spacing:0.5px;';
  const titleSpan = document.createElement('span');
  titleSpan.id = 'ai-popup-title'; titleSpan.textContent = '无极';
  header.appendChild(titleSpan);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕'; closeBtn.title = '关闭';
  closeBtn.style.cssText = 'width:24px;height:24px;border-radius:50%;border:none;background:rgba(0,0,0,0.06);color:#6b7280;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;padding:0;outline:none;line-height:1;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(239,83,80,0.15)'; closeBtn.style.color = '#ef4444'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'rgba(0,0,0,0.06)'; closeBtn.style.color = '#6b7280'; });
  closeBtn.addEventListener('click', e => { e.stopPropagation(); hidePopup(); });
  header.appendChild(closeBtn);
  popupEl.appendChild(header);

  const content = document.createElement('div');
  content.id = 'ai-popup-content';
  content.style.cssText = 'max-height:200px;overflow-y:auto;font-size:13px;color:#374151;white-space:pre-wrap;word-break:break-word;';
  popupEl.appendChild(content);
  document.body.appendChild(popupEl);
}

function hideToolbar() { if (!toolbarEl) return; toolbarEl.style.display = 'none'; toolbarEl.style.opacity = '0'; isToolbarVisible = false; }
function hidePopup() { if (!popupEl) return; popupEl.style.display = 'none'; popupEl.style.opacity = '0'; }

function showToolbarAt(x, y) {
  if (!toolbarEl) createToolbar();
  const w = 140, h = 48;
  let fx = x - w / 2, fy = y - h - 10;
  if (fx < 8) fx = 8; if (fx + w > window.innerWidth - 8) fx = window.innerWidth - w - 8;
  if (fy < 8) fy = y + 16;
  toolbarEl.style.left = fx + 'px'; toolbarEl.style.top = fy + 'px';
  toolbarEl.style.display = 'flex'; toolbarEl.style.opacity = '1'; toolbarEl.style.transform = 'scale(1)';
  isToolbarVisible = true;
}

function showPopupAt(x, y, title, contentText) {
  if (!popupEl) createPopup();
  const ts = document.getElementById('ai-popup-title');
  const cd = document.getElementById('ai-popup-content');
  if (ts) ts.textContent = title;
  if (cd) cd.textContent = contentText;
  const pw = 280, ph = 180;
  let fx = x - pw / 2, fy = y - ph - 14;
  if (fx < 8) fx = 8; if (fx + pw > window.innerWidth - 8) fx = window.innerWidth - pw - 8;
  if (fy < 8) fy = y + 16; if (fy + ph > window.innerHeight - 8) fy = window.innerHeight - ph - 8;
  popupEl.style.left = fx + 'px'; popupEl.style.top = fy + 'px';
  clearTimeout(popupEl._t);
  popupEl._t = setTimeout(() => {
    popupEl.style.display = 'flex'; popupEl.style.opacity = '1'; popupEl.style.transform = 'scale(1)';
    popupJustOpened = true;
    setTimeout(() => { popupJustOpened = false; }, 200);
  }, 30);
}

function handleToolAction(action) {
  if (!selectedText) return;
  const rect = toolbarEl.getBoundingClientRect();
  const px = rect.left + rect.width / 2, py = rect.top;
  hideToolbar();
  popupStreamingContent = '';
  popupCurrentAction = action;

  const msgType = { explain: 'EXPLAIN_TEXT', translate: 'TRANSLATE_TEXT', rewrite: 'REWRITE_TEXT' }[action];
  const title = { explain: '解释', translate: '翻译', rewrite: '改写' }[action];
  // 翻译时先显示原文，再在下方显示翻译结果；其他功能直接显示结果
  if (action === 'translate') {
    showPopupAt(px, py, title, '正在翻译…');
  } else {
    showPopupAt(px, py, title, '正在调用 AI…');
  }

  chrome.runtime.sendMessage({ type: msgType, text: selectedText }, resp => {
    if (chrome.runtime.lastError || !resp || !resp.success) {
      const cd = document.getElementById('ai-popup-content');
      if (cd) cd.textContent = '调用失败: ' + ((resp && resp.error) || '请检查 API 配置');
    }
  });
}

// ============================================================
// 第五部分：视频字幕提取
// ============================================================
function getVideoSubtitles() {
  const url = window.location.href, title = document.title || '';
  if (url.includes('bilibili.com') || url.includes('b23.tv')) return extractBilibiliSubtitle(title);
  if (url.includes('youtube.com') || url.includes('youtu.be')) return extractYouTubeSubtitle(title);
  return extractGenericVideoInfo(title);
}

function extractBilibiliSubtitle(title) {
  try {
    const pi = window.__playinfo__;
    if (pi?.data?.subtitle?.subtitles?.length) {
      const zh = pi.data.subtitle.subtitles.find(s => s.lan === 'zh-CN') || pi.data.subtitle.subtitles[0];
      return { platform: 'bilibili', title, subtitleUrl: zh.subtitle_url, needFetch: true };
    }
    const descEl = document.querySelector('.desc-info-text, .basic-desc-info, #v_desc, .desc-v2');
    const desc = descEl ? descEl.innerText.trim() : '';
    return { platform: 'bilibili', title, subtitles: [], fullText: desc ? '视频简介：' + desc : '', needFetch: false };
  } catch (e) { return { platform: 'bilibili', title, subtitles: [], fullText: '', error: e.message, needFetch: false }; }
}

function extractYouTubeSubtitle(title) {
  try {
    const pr = window.ytInitialPlayerResponse;
    if (pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
      const tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      const zh = tracks.find(t => t.languageCode === 'zh') || tracks.find(t => t.languageCode === 'zh-Hans') || tracks[0];
      return { platform: 'youtube', title, subtitleUrl: zh.baseUrl, needFetch: true };
    }
    const descEl = document.querySelector('#description-inner, #description');
    const desc = descEl ? descEl.innerText.trim() : '';
    return { platform: 'youtube', title, subtitles: [], fullText: desc ? '视频简介：' + desc : '', needFetch: false };
  } catch (e) { return { platform: 'youtube', title, subtitles: [], fullText: '', error: e.message, needFetch: false }; }
}

function extractGenericVideoInfo(title) {
  try {
    const videoEl = document.querySelector('video');
    const durRaw = videoEl ? videoEl.duration : 0;
    const dur = Number.isFinite(durRaw) ? Math.round(durRaw) : 0;
    const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const desc = meta ? meta.content : '';
    return { platform: 'other', title, subtitles: [], fullText: (desc ? '描述：' + desc : '') + (dur ? `\n视频时长：${Math.floor(dur/60)}分${dur%60}秒` : ''), needFetch: false };
  } catch (e) { return { platform: 'other', title, subtitles: [], fullText: '', error: e.message, needFetch: false }; }
}

// ============================================================
// 5.5 DOM 结构读取（供 AI 实时查询页面结构）
// ============================================================
function readDOMStructure(selector = 'body', maxDepth = 4, maxChildren = 8, waitMs = 0) {
  const el = document.querySelector(selector);
  if (el) return buildTreeResult(el, selector, maxDepth, maxChildren);
  // 支持等待：轮询直到目标元素出现（懒加载/动态渲染场景）
  if (waitMs > 0) {
    return waitForElement(selector, waitMs).then(found => {
      return found ? buildTreeResult(found, selector, maxDepth, maxChildren)
                   : { error: '等待超时: ' + selector + ' (' + waitMs + 'ms)' };
    });
  }
  return { error: '未找到元素: ' + selector };
}

function buildTreeResult(el, selector, maxDepth, maxChildren) {
  function buildTree(node, depth) {
    if (depth > maxDepth) return { tag: node.nodeName, _truncated: true };

    const info = { tag: node.tagName?.toLowerCase() || '#text' };

    // 属性（简化：只保留 id/class/role/type/href/placeholder）
    if (node.attributes) {
      const attrs = {};
      if (node.id) attrs.id = node.id;
      if (node.className && typeof node.className === 'string') attrs.class = node.className.substring(0, 80);
      if (node.getAttribute('role')) attrs.role = node.getAttribute('role');
      if (node.getAttribute('type')) attrs.type = node.getAttribute('type');
      if (node.getAttribute('placeholder')) attrs.placeholder = node.getAttribute('placeholder').substring(0, 40);
      if (Object.keys(attrs).length > 0) info.attrs = attrs;
    }

    // 文本内容（只提取直接文本，不包含子节点）
    let directText = '';
    node.childNodes?.forEach(c => {
      if (c.nodeType === 3) directText += c.textContent;
    });
    directText = directText.replace(/\s+/g, ' ').trim();
    if (directText.length > 0) info.text = directText.substring(0, 120);

    // 子元素（递归，限制数量）
    if (node.children && node.children.length > 0) {
      const children = [];
      for (let i = 0; i < Math.min(node.children.length, maxChildren); i++) {
        children.push(buildTree(node.children[i], depth + 1));
      }
      if (node.children.length > maxChildren) {
        children.push({ tag: '_more', count: node.children.length - maxChildren });
      }
      if (children.length > 0) info.children = children;
    }

    return info;
  }

  const result = buildTree(el, 0);
  result._selector = selector;
  result._depth = maxDepth;
  result._childCount = el.children?.length || 0;
  return result;
}

/**
 * 异步轮询等待目标元素出现（非阻塞，供 readDOMStructure 使用）
 */
function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }
      if (Date.now() >= deadline) { resolve(null); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

function buildTreeSync(el, maxDepth, maxChildren) {
  const result = buildTreeStatic(el, 0, maxDepth, maxChildren);
  result._childCount = el.children?.length || 0;
  return result;
}

function buildTreeStatic(node, depth, maxDepth, maxChildren) {
  if (depth > maxDepth) return { tag: node.nodeName, _truncated: true };
  const info = { tag: node.tagName?.toLowerCase() || '#text' };
  if (node.attributes) {
    const attrs = {};
    if (node.id) attrs.id = node.id;
    if (node.className && typeof node.className === 'string') attrs.class = node.className.substring(0, 80);
    if (node.getAttribute('role')) attrs.role = node.getAttribute('role');
    if (node.getAttribute('type')) attrs.type = node.getAttribute('type');
    if (Object.keys(attrs).length > 0) info.attrs = attrs;
  }
  let directText = '';
  node.childNodes?.forEach(c => { if (c.nodeType === 3) directText += c.textContent; });
  directText = directText.replace(/\s+/g, ' ').trim();
  if (directText.length > 0) info.text = directText.substring(0, 120);
  if (node.children && node.children.length > 0) {
    const children = [];
    for (let i = 0; i < Math.min(node.children.length, maxChildren); i++) {
      children.push(buildTreeStatic(node.children[i], depth + 1, maxDepth, maxChildren));
    }
    if (node.children.length > maxChildren) children.push({ tag: '_more', count: node.children.length - maxChildren });
    if (children.length > 0) info.children = children;
  }
  return info;
}

/**
 * 滚动到指定元素/位置以触发懒加载，然后等待新内容出现
 * 用于 B站评论区、知乎、Twitter 等无限滚动/懒加载场景
 */
function scrollAndWaitForContent(selector, scrollPx = 2000, waitMs = 2000) {
  const el = selector ? document.querySelector(selector) : null;
  const target = el || document.scrollingElement || document.documentElement;

  // 记录当前子元素数量
  const beforeCount = el ? (el.children?.length || 0) : document.body.children.length;

  // 滚动触发懒加载
  if (el) {
    el.scrollTop = el.scrollHeight;
  } else {
    window.scrollBy({ top: scrollPx, behavior: 'smooth' });
  }

  // 等待新内容加载
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const afterCount = el ? (el.children?.length || 0) : document.body.children.length;
      if (afterCount > beforeCount || Date.now() - start > waitMs) {
        resolve({
          beforeCount, afterCount,
          newItems: afterCount - beforeCount,
          elapsed: Date.now() - start
        });
      } else {
        setTimeout(check, 200);
      }
    }
    setTimeout(check, 300);
  });
}

/**
 * watch_dom: 注册 MutationObserver 监听目标容器，持续报告变化
 * 返回监听 ID，可通过 STOP_DOM_WATCH 停止
 * 所有监听器都有自动超时（AI 忘记调 STOP 也不会永久挂住）
 */
const _domWatchers = {};
const WATCHER_AUTO_STOP_MS = 10 * 60 * 1000; // 10 分钟
const MAX_WATCHERS = 10;

function autoStopWatcher(watcherId) {
  const w = _domWatchers[watcherId];
  if (!w) return;
  w.observer.disconnect();
  if (w.stopTimer) clearTimeout(w.stopTimer);
  delete _domWatchers[watcherId];
}

function registerWatcher(id, entry) {
  // 数量上限：超出时优先淘汰最早的监听器
  const ids = Object.keys(_domWatchers);
  if (ids.length >= MAX_WATCHERS) {
    autoStopWatcher(ids[0]);
  }
  entry.stopTimer = setTimeout(() => autoStopWatcher(id), entry.stopMs || WATCHER_AUTO_STOP_MS);
  _domWatchers[id] = entry;
}

function watchDOM(selector, reportFn, options = {}) {
  const el = document.querySelector(selector);
  if (!el) return { error: '未找到元素: ' + selector };

  const watcherId = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const changes = [];
  let timer = null;

  const observer = new MutationObserver((mutations) => {
    if (!reportFn) return; // 无上报回调时只监听不收集，防止 changes 无限增长
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          const tag = node.tagName?.toLowerCase() || '';
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 100);
          if (text) changes.push({ type: 'added', tag, text });
        }
      });
    });
    // 容量保护：最多保留最近 200 条变化
    if (changes.length > 200) changes.splice(0, changes.length - 200);
    // 防抖上报
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (changes.length > 0 && reportFn) {
        reportFn({ watcherId, selector, changes: changes.slice(), time: Date.now() });
        changes.length = 0;
      }
    }, options.debounceMs || 500);
  });

  observer.observe(el, { childList: true, subtree: options.subtree !== false });
  registerWatcher(watcherId, { observer, selector, el });
  return { watcherId, selector, status: 'watching', autoStopMinutes: 10 };
}

function stopDOMWatch(watcherId) {
  const w = _domWatchers[watcherId];
  if (!w) return { error: '未找到监听器: ' + watcherId };
  autoStopWatcher(watcherId);
  return { watcherId, status: 'stopped' };
}

/**
 * deepWatchDOM: 先轮询等待父元素出现，再挂 MutationObserver
 * 解决 #video-page-app 这类深层动态渲染节点的问题
 * 观察器 5 分钟后自动断开（此前会带着空回调挂到页面卸载，阻碍 GC）
 */
function deepWatchDOM(selector, debounceMs = 500, waitParentMs = 10000) {
  const start = Date.now();
  const watcherId = 'dw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  function tryObserve() {
    if (!_domWatchers[watcherId] && Date.now() - start > waitParentMs) return; // 超时或已被清理，静默失败
    const el = document.querySelector(selector);
    if (el) {
      // 找到了，注册 MutationObserver
      const observer = new MutationObserver(() => {
        // 变化发生时不做额外操作，等 get_watch_report 来取
      });
      observer.observe(el, { childList: true, subtree: true });
      registerWatcher(watcherId, { observer, selector, el, type: 'deep', stopMs: 5 * 60 * 1000 });
      return;
    }
    setTimeout(tryObserve, 300);
  }
  tryObserve();
  return { watcherId, selector, status: 'deep_watching' };
}

// ============================================================
// 第六部分：事件监听
// ============================================================

// 选中文字 → 显示轮盘
document.addEventListener('mouseup', e => {
  setTimeout(() => {
    // 点击轮盘按钮/弹窗本身（mousedown 已 preventDefault 保留选区）时不再重复弹出
    if (toolbarEl?.contains(e.target) || popupEl?.contains(e.target)) return;
    // 聊天面板（Shadow DOM）内部的选区不触发页面轮盘
    try { if (e.target.getRootNode() !== document) return; } catch (_) {}
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hideToolbar(); hidePopup(); return;
    }
    const text = sel.toString().trim();
    if (text.length <= 5) { hideToolbar(); return; }
    selectedText = text;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.width === 0)) return;
    hidePopup();
    showToolbarAt(rect.left + rect.width / 2, rect.top);
  }, 0);
});

// 点击外部关闭轮盘/弹窗
document.addEventListener('mousedown', e => {
  if (popupJustOpened) return;
  if (toolbarEl?.contains(e.target) || popupEl?.contains(e.target)) return;
  if (isToolbarVisible) hideToolbar();
  if (popupEl && popupEl.style.display !== 'none') hidePopup();
});

// ESC 关闭
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    hideToolbar(); hidePopup();
    if (chatPanelVisible) toggleChatPanel(false);
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
  }
});

window.addEventListener('resize', () => { hideToolbar(); hidePopup(); });
// rAF 节流：高频 scroll 下每个事件写样式造成无谓回流
let _scrollPending = false;
window.addEventListener('scroll', () => {
  if (_scrollPending) return;
  _scrollPending = true;
  requestAnimationFrame(() => { _scrollPending = false; hideToolbar(); hidePopup(); });
}, { passive: true });

// ============================================================
// 第七部分：消息监听（来自 Service Worker）
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 切换悬浮窗
  if (message.type === 'TOGGLE_CHAT_PANEL') {
    toggleChatPanel(!chatPanelVisible);
    sendResponse({ success: true });
    return true;
  }

  // 赞助图片弹窗
  if (message.type === 'SHOW_SPONSOR_IMAGE') {
    showSponsorModal(message.imgUrl);
    sendResponse({ success: true });
    return true;
  }

  // 视频字幕
  if (message.type === 'GET_VIDEO_SUBTITLES') {
    try { sendResponse(getVideoSubtitles()); } catch (e) { sendResponse({ error: e.message }); }
    return true;
  }

  // 页面内容
  if (message.type === 'GET_PAGE_CONTENT') {
    try { sendResponse(getPageContent()); } catch (e) { sendResponse({ error: e.message }); }
    return true;
  }

  // 执行操作
  if (message.type === 'EXECUTE_ACTIONS' && Array.isArray(message.actions)) {
    sendResponse({ success: true, results: executeActionsInPage(message.actions) });
    return true;
  }

  // 提取页面图片
  if (message.type === 'EXTRACT_PAGE_IMAGES') {
    try { sendResponse({ success: true, images: extractPageImages() }); } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // DOM 结构读取（支持 wait 参数等待懒加载，异步轮询不阻塞页面）
  if (message.type === 'GET_DOM_STRUCTURE') {
    try {
      const sel = message.selector || 'body';
      const depth = message.maxDepth || 3;
      const maxChildren = message.maxChildren || 6;
      const waitMs = message.wait || 0;
      const result = readDOMStructure(sel, depth, maxChildren, waitMs);
      if (result && typeof result.then === 'function') {
        result.then(r => sendResponse({ success: true, data: r }))
              .catch(e => sendResponse({ success: false, error: e.message }));
      } else {
        sendResponse({ success: true, data: result });
      }
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 滚动以触发懒加载
  if (message.type === 'SCROLL_AND_WAIT') {
    try {
      const sel = message.selector || null;
      const scrollPx = message.scrollPx || 2000;
      const waitMs = message.waitMs || 2000;
      scrollAndWaitForContent(sel, scrollPx, waitMs).then(r => {
        sendResponse({ success: true, data: r });
      }).catch(e => sendResponse({ success: false, error: e.message }));
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 注册 DOM 变化监听
  if (message.type === 'WATCH_DOM') {
    try {
      const result = watchDOM(message.selector, null, { debounceMs: message.debounceMs || 500, subtree: message.subtree !== false });
      sendResponse({ success: true, data: result });
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 停止 DOM 监听
  if (message.type === 'STOP_DOM_WATCH') {
    try { sendResponse({ success: true, data: stopDOMWatch(message.watcherId) }); }
    catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 获取 DOM 监听报告
  if (message.type === 'GET_DOM_WATCH_REPORT') {
    try {
      const w = _domWatchers[message.watcherId];
      if (!w) { sendResponse({ success: false, error: '监听器不存在' }); return true; }
      // 提取最新内容
      const el = w.el;
      const text = (el?.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 2000);
      sendResponse({ success: true, data: { watcherId: message.watcherId, selector: w.selector, text, childCount: el?.children?.length || 0 } });
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 读取 MAIN world 拦截到的 API 数据
  if (message.type === 'GET_INTERCEPTED') {
    try {
      const filter = message.filter || '';
      const raw = window.__wuji_intercepted__?.requests || [];
      let matches = raw;
      if (filter) {
        const re = new RegExp(filter, 'i');
        matches = raw.filter(r => re.test(r.url));
      }
      sendResponse({ success: true, data: { total: raw.length, matches: matches.slice(-10) } });
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 主动 fetch API（内容脚本有页面 cookies，可跨域）
  if (message.type === 'FETCH_API') {
    try {
      const url = message.url;
      if (!url) { sendResponse({ success: false, error: '缺少 url' }); return true; }
      fetch(url, { method: message.method || 'GET', headers: message.headers || {} })
        .then(async r => {
          const text = await r.text();
          sendResponse({ success: true, data: { status: r.status, body: text.substring(0, 5000) } });
        })
        .catch(e => sendResponse({ success: false, error: e.message }));
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // 深度监听：先轮询等父元素出现，再挂 MutationObserver
  if (message.type === 'DEEP_WATCH') {
    try {
      const result = deepWatchDOM(message.selector, message.debounceMs || 500, message.waitParentMs || 10000);
      sendResponse({ success: true, data: result });
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  }

  // AI 流式（面板未挂载时丢弃，与原实现一致——流式内容本就不落历史）
  if (message.type === 'AI_STREAM_DELTA' && message.delta) {
    panelApi?.pushDelta(message.delta);
    return false;
  }
  if (message.type === 'AI_STREAM_DONE') {
    if (panelApi) panelApi.streamDone();
    else isProcessing = false; // 面板已关闭：作废在途流式，避免发送键永久卡死
    return false;
  }
  if (message.type === 'AI_STREAM_ERROR') {
    if (panelApi) panelApi.streamError(message.error);
    else isProcessing = false;
    return false;
  }
  if (message.type === 'ACTION_RESULTS') {
    panelApi?.actionResults(message.results);
    return false;
  }

  // 弹窗流式（轮盘翻译等）
  if (message.type === 'POPUP_STREAM_DELTA' && message.delta) {
    popupStreamingContent += message.delta;
    const cd = document.getElementById('ai-popup-content');
    if (cd) {
      if (popupCurrentAction === 'translate' && selectedText) {
        // 翻译：显示原文 + 分隔线 + 译文
        cd.innerHTML = '<div style="color:#6b7280;font-size:12px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(0,0,0,0.08);">' + escHtml(selectedText) + '</div>' + escHtml(popupStreamingContent);
      } else {
        cd.textContent = popupStreamingContent;
      }
    }
    return false;
  }
  if (message.type === 'POPUP_STREAM_DONE') {
    // 翻译完成时更新标题
    if (popupCurrentAction === 'translate') {
      const ts = document.getElementById('ai-popup-title');
      if (ts) ts.textContent = '翻译结果';
    } else if (popupCurrentAction === 'explain') {
      const ts = document.getElementById('ai-popup-title');
      if (ts) ts.textContent = '解释结果';
    } else if (popupCurrentAction === 'rewrite') {
      const ts = document.getElementById('ai-popup-title');
      if (ts) ts.textContent = '改写结果';
    }
    popupStreamingContent = '';
    popupCurrentAction = '';
    return false;
  }
  if (message.type === 'POPUP_STREAM_ERROR') {
    const cd = document.getElementById('ai-popup-content');
    if (cd) cd.textContent = '请求失败: ' + (message.error || '未知错误');
    popupStreamingContent = '';
    return false;
  }

  // 工具调用结果（AI Agent 自动执行工具后返回）
  if (message.type === 'TOOL_RESULT') {
    panelApi?.toolResult(message);
    return false;
  }

  // Agent 任务状态更新 — 已移除
  // Agent 安全确认弹窗 — 已移除

  return false;
});

// ============================================================
// 第八部分：图片识别（视觉模型）
// ============================================================
let imagePickerEl = null;

function extractPageImages() {
  const images = [];
  const seen = new Set();

  // 收集 <img> 标签
  document.querySelectorAll('img').forEach(img => {
    const src = img.src || img.dataset.src || img.dataset.original || '';
    if (!src || src.startsWith('data:image/svg+xml') || seen.has(src)) return;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    // 过滤掉太小的图标
    if (w > 0 && h > 0 && (w < 50 || h < 50)) return;
    seen.add(src);
    images.push({ src, alt: img.alt || '', width: w, height: h });
  });

  // 收集背景图片（跳过非视觉标签 + 满 30 张提前退出，避免全树 getComputedStyle）
  const SKIP_BG_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE']);
  const allEls = document.querySelectorAll('*');
  for (const el of allEls) {
    if (images.length >= 30) break;
    if (SKIP_BG_TAGS.has(el.tagName)) continue;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const match = bg.match(/url\(["']?(.*?)["']?\)/);
    if (match && match[1] && !seen.has(match[1])) {
      seen.add(match[1]);
      images.push({ src: match[1], alt: '', width: 0, height: 0 });
    }
  }

  // 限制最多 30 张
  return images.slice(0, 30);
}

async function handleAnalyzeImage() {
  if (imagePickerEl) { closeImagePicker(); return; }

  // 确保聊天面板已挂载（懒注入，await 保证后续 panelApi 就绪）
  if (!chatPanelVisible) await toggleChatPanel(true);

  // 提取页面图片
  const images = extractPageImages();

  if (images.length === 0) {
    panelApi?.addMessage({ role: 'system', content: '当前页面未发现可识别的图片。' });
    return;
  }

  showImagePicker(images);
}

function showImagePicker(images) {
  closeImagePicker();

  imagePickerEl = document.createElement('div');
  imagePickerEl.id = 'wuji-image-picker';
  imagePickerEl.setAttribute('data-ai-browser', 'image-picker');
  imagePickerEl.style.cssText = `
    position:fixed; z-index:100001; top:50%; left:50%; transform:translate(-50%,-50%);
    width:520px; max-height:80vh; background:#fff; border-radius:16px;
    box-shadow:0 20px 60px rgba(0,0,0,0.25),0 0 0 1px rgba(99,102,241,0.1);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    display:flex; flex-direction:column; overflow:hidden;
  `;

  // 头部
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(0,0,0,0.08);flex-shrink:0;';
  header.innerHTML = `
    <div style="font-size:15px;font-weight:700;color:#1a1a2e;">📷 选择要识别的图片</div>
    <button id="wuji-ip-close" style="width:28px;height:28px;border-radius:50%;border:none;background:rgba(0,0,0,0.06);color:#6b7280;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s;padding:0;">✕</button>
  `;
  imagePickerEl.appendChild(header);

  // 图片网格
  const grid = document.createElement('div');
  grid.style.cssText = 'flex:1;overflow-y:auto;padding:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;';
  grid.id = 'wuji-ip-grid';

  images.forEach((img, idx) => {
    const card = document.createElement('div');
    card.style.cssText = `
      position:relative;border-radius:10px;overflow:hidden;cursor:pointer;
      border:2px solid transparent;transition:all 0.2s;
      aspect-ratio:1;background:#f3f4f6;
    `;
    card.innerHTML = `
      <img src="${escHtml(img.src)}" alt="${escHtml(img.alt)}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;\\'>加载失败</div>';" />
      ${img.alt ? `<div style="position:absolute;bottom:0;left:0;right:0;padding:4px 6px;background:linear-gradient(transparent,rgba(0,0,0,0.7));color:#fff;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(img.alt.substring(0, 30))}</div>` : ''}
    `;

    card.addEventListener('mouseenter', () => { card.style.borderColor = '#6366f1'; card.style.transform = 'scale(1.03)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = 'transparent'; card.style.transform = 'scale(1)'; });
    card.addEventListener('click', () => selectImageForAnalysis(img.src, img.alt));
    grid.appendChild(card);
  });

  imagePickerEl.appendChild(grid);

  // 底部：自定义 URL 输入
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:10px 14px;border-top:1px solid rgba(0,0,0,0.08);flex-shrink:0;';
  footer.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;">
      <input id="wuji-ip-url" type="text" placeholder="或输入图片 URL..." style="flex:1;padding:8px 14px;border-radius:20px;border:1px solid rgba(0,0,0,0.12);font-size:12px;outline:none;font-family:inherit;" />
      <button id="wuji-ip-url-btn" style="padding:8px 16px;border-radius:20px;background:#6366f1;color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s;">识别</button>
    </div>
  `;
  imagePickerEl.appendChild(footer);

  // 遮罩
  const overlay = document.createElement('div');
  overlay.id = 'wuji-ip-overlay';
  overlay.setAttribute('data-ai-browser', 'image-picker');
  overlay.style.cssText = 'position:fixed;z-index:100000;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(2px);';

  document.body.appendChild(overlay);
  document.body.appendChild(imagePickerEl);

  // 事件
  document.getElementById('wuji-ip-close').addEventListener('click', closeImagePicker);
  overlay.addEventListener('click', closeImagePicker);

  document.getElementById('wuji-ip-url-btn').addEventListener('click', () => {
    const urlInput = document.getElementById('wuji-ip-url');
    const url = urlInput?.value.trim();
    if (url) selectImageForAnalysis(url, '');
  });
  document.getElementById('wuji-ip-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const url = e.target.value.trim();
      if (url) selectImageForAnalysis(url, '');
    }
  });
}

function closeImagePicker() {
  const overlay = document.getElementById('wuji-ip-overlay');
  if (overlay) overlay.remove();
  if (imagePickerEl) { imagePickerEl.remove(); imagePickerEl = null; }
}

async function selectImageForAnalysis(imageSrc, altText) {
  closeImagePicker();
  if (!panelApi) return;   // 入口按钮在面板内，面板未挂载时不应到达这里

  // 用户消息（含图片预览；html 由本脚本拼装，escHtml 转义文本节点）
  panelApi.addMessage({
    role: 'user',
    html: `📷 识别图片${altText ? '：' + escHtml(altText.substring(0, 50)) : ''}<br><img src="${escHtml(imageSrc)}" style="max-width:100%;max-height:150px;border-radius:8px;margin-top:6px;" onerror="this.style.display='none'" />`
  });
  panelApi.beginStream();
  panelApi.setProcessing(true);
  panelApi.setStatus('视觉模型分析中...', false, true);

  // 将图片 URL 转为 base64（如果是同源图片），否则直接用 URL
  let finalImageUrl = imageSrc;

  // 如果是相对路径，转为绝对路径
  if (imageSrc && !imageSrc.startsWith('http') && !imageSrc.startsWith('data:')) {
    try { finalImageUrl = new URL(imageSrc, window.location.href).href; } catch (e) { /* keep original */ }
  }

  // 尝试将图片转为 base64（CORS 允许的情况下）
  if (finalImageUrl.startsWith('http')) {
    try {
      const imgEl = new Image();
      imgEl.crossOrigin = 'anonymous';
      const loaded = await new Promise((resolve, reject) => {
        imgEl.onload = () => resolve(true);
        imgEl.onerror = () => reject(new Error('load failed'));
        imgEl.src = finalImageUrl;
        setTimeout(() => reject(new Error('timeout')), 5000);
      });
      if (loaded) {
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0);
        finalImageUrl = canvas.toDataURL('image/jpeg', 0.85);
      }
    } catch (e) {
      // 无法转 base64，直接用 URL（需要视觉 API 支持 URL 方式）
      console.log('[无极] 无法转为 base64，直接使用 URL:', e.message);
    }
  }

  // 发送到 SW（视觉结果经 AI_STREAM_* 流式下发，与文本对话同一管线）
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_IMAGE',
      payload: {
        imageUrl: finalImageUrl,
        prompt: '',
        pageUrl: window.location.href,
        pageTitle: document.title
      }
    });

    if (!response || !response.success) {
      throw new Error(response?.error || '视觉识别请求失败');
    }
  } catch (error) {
    panelApi.streamError(error.message);
  }
}

// ============================================================
// 赞助弹窗
// ============================================================
function showSponsorModal(imgUrl) {
  const existing = document.getElementById('wuji-sponsor-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'wuji-sponsor-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;font-family:"PingFang SC","Microsoft YaHei",sans-serif;';

  overlay.innerHTML = `
    <img src="${imgUrl}" style="max-width:90vw;max-height:75vh;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,0.5);" alt="赞助二维码">
    <div style="display:flex;gap:12px;">
      <button id="wuji-sponsor-close" style="padding:10px 28px;border-radius:10px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:#fff;font-size:14px;cursor:pointer;font-family:inherit;backdrop-filter:blur(8px);">关闭</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.id === 'wuji-sponsor-close') closeSponsor();
  });

  // ESC 关闭（统一清理 keydown 监听，所有关闭路径都走 closeSponsor）
  const onKey = (e) => { if (e.key === 'Escape') closeSponsor(); };
  document.addEventListener('keydown', onKey);
  function closeSponsor() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
}

// ============================================================
// 初始化
// ============================================================
function init() {
  console.log('[无极] Content Script 已加载');
  // 面板外观跟随：由 Vue 面板自行监听 uiConfig（卸载时一并移除监听）
  // 页面全文自动存档默认关闭（隐私 + 存储膨胀），需在设置中开启"自动记忆访问页面"
  try {
    chrome.storage.sync.get('privacyConfig', r => {
      if (r.privacyConfig?.autoSavePages) setTimeout(sendPageContentToBackground, 1500);
    });
  } catch (e) { /* ignore */ }
  createToolbar(); // 预创建轮盘 DOM
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}