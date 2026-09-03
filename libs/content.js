/**
 * 无极 — Content Script V3.3
 * 功能：
 *   1. 页面内容提取（发送到 SW 存储）
 *   2. 悬浮聊天窗（Shadow DOM 隔离）
 *   3. 选中文字轮盘（解释/翻译/改写）
 *   4. ActionExecutor 原子操作
 *   5. 视频字幕提取
 */

// ============================================================
// 全局状态
// ============================================================
let chatPanelVisible = false;
let chatPanelEl = null;       // 悬浮窗宿主
let shadowRoot = null;        // Shadow DOM 根
let isProcessing = false;
let streamingBubble = null;
let streamingContentEl = null;
let streamingContent = '';
let conversationHistory = [];
const MAX_HISTORY = 20;
const STORAGE_KEY = 'wuji_conversation';
let currentTab = 'chat';      // 'chat' | 'knowledge'
let panelJustCreated = false;

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
// 第三部分：悬浮聊天窗（Shadow DOM）
// ============================================================
const CHAT_STYLES = `
  :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :host {
    /* —— 色彩系统：克制、单一强调色 —— */
    --bg-primary: #ffffff;
    --bg-canvas: #fbfbfd;
    --bg-soft: #f5f6f8;
    --bg-input: #f4f4f6;
    --text-primary: #0d0d12;
    --text-secondary: #565869;
    --text-tertiary: #9b9ba7;
    --text-faint: #c8c8d0;
    --accent: #6366f1;
    --accent-hover: #4f46e5;
    --accent-soft: rgba(99,102,241,0.07);
    --accent-line: rgba(99,102,241,0.18);
    --border: rgba(20,20,40,0.07);
    --border-strong: rgba(20,20,40,0.12);
    --danger: #ef4444;
    --success: #22c55e;
    --radius-sm: 8px;
    --radius: 14px;
    --radius-lg: 20px;
    --radius-xl: 26px;
    --shadow-sm: 0 1px 2px rgba(20,20,40,0.04);
    --shadow-md: 0 6px 24px rgba(20,20,40,0.08);
    --shadow-lg: 0 18px 50px rgba(20,20,40,0.14), 0 0 0 1px rgba(20,20,40,0.04);
    --shadow-accent: 0 8px 24px rgba(99,102,241,0.28);
    --t: 0.18s cubic-bezier(0.4,0,0.2,1);
    --t-slow: 0.32s cubic-bezier(0.16,1,0.3,1);
  }

  /* —— 面板容器：浮起、大圆角、轻盈阴影 —— */
  .panel {
    width: 440px; height: 620px; display: flex; flex-direction: column;
    background: var(--bg-primary); border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg); overflow: hidden; position: relative;
    animation: panelIn 0.32s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes panelIn { 0% { opacity: 0; transform: translateY(12px) scale(0.97); } 100% { opacity: 1; transform: translateY(0) scale(1); } }

  /* —— 顶栏：极简、无边框、悬浮高亮 —— */
  .top-bar {
    display: flex; align-items: center; gap: 4px; padding: 14px 16px 10px;
    background: var(--bg-primary); cursor: move; flex-shrink: 0; user-select: none;
  }
  .top-bar .brand { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
  .top-bar .brand-mark {
    width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 3px 10px rgba(99,102,241,0.32);
  }
  .top-bar .brand-mark svg { width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .top-bar .title { font-size: 14.5px; font-weight: 620; color: var(--text-primary); letter-spacing: -0.3px; }
  .top-bar .title .ver { font-size: 10px; font-weight: 550; color: var(--text-tertiary); margin-left: 5px; vertical-align: 1px; }
  .icon-btn {
    width: 30px; height: 30px; border-radius: 9px; border: none;
    background: transparent; cursor: pointer; display: flex;
    align-items: center; justify-content: center; transition: all var(--t); flex-shrink: 0;
  }
  .icon-btn:hover { background: var(--bg-soft); }
  .icon-btn:hover svg { stroke: var(--accent); }
  .icon-btn svg { width: 16px; height: 16px; stroke: var(--text-tertiary); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--t); }
  .icon-btn--circle {
    width: 26px; height: 26px; border-radius: 50%;
    border: 1.5px solid var(--border); opacity: 0.6;
  }
  .icon-btn--circle:hover { border-color: var(--accent-line); opacity: 1; background: var(--accent-soft); }
  .icon-btn--circle:hover svg { stroke: var(--accent); }
  .icon-btn--circle svg { width: 13px; height: 13px; }

  /* —— 标签栏：胶囊式分段控件 —— */
  .tab-bar {
    display: flex; gap: 3px; padding: 0 14px 10px; background: var(--bg-primary);
    flex-shrink: 0;
  }
  .tab-btn {
    flex: 1; padding: 7px 0; border: none; border-radius: 9px; background: transparent;
    font-size: 12px; font-weight: 560; color: var(--text-tertiary); cursor: pointer;
    transition: all var(--t); font-family: inherit; letter-spacing: -0.1px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .tab-btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .tab-btn:hover { color: var(--text-secondary); background: var(--bg-soft); }
  .tab-btn.active { color: var(--accent); background: var(--accent-soft); }

  /* —— 消息区：大留白、纯净 —— */
  .message-area {
    flex: 1; overflow-y: auto; padding: 18px 16px 10px; display: flex; flex-direction: column; gap: 22px;
    background: var(--bg-canvas); scroll-behavior: smooth;
  }
  .message-area::-webkit-scrollbar { width: 5px; }
  .message-area::-webkit-scrollbar-track { background: transparent; }
  .message-area::-webkit-scrollbar-thumb { background: var(--text-faint); border-radius: 20px; }
  .message-area::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }

  /* —— 空状态 —— */
  .empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 20px 16px; gap: 6px; text-align: center;
    animation: fadeIn 0.4s ease-out;
  }
  @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
  .empty-state .orb {
    width: 52px; height: 52px; border-radius: 16px; margin-bottom: 14px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 10px 30px rgba(99,102,241,0.35); position: relative;
    animation: orbPulse 3.2s ease-in-out infinite;
  }
  .empty-state .orb::after {
    content: ''; position: absolute; inset: -4px; border-radius: 20px;
    background: linear-gradient(135deg, #6366f1, #d946ef); opacity: 0.25; z-index: -1;
    filter: blur(14px); animation: orbPulse 3.2s ease-in-out infinite;
  }
  @keyframes orbPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
  .empty-state .orb svg { width: 26px; height: 26px; stroke: #fff; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .empty-state .title { font-size: 19px; font-weight: 650; color: var(--text-primary); letter-spacing: -0.4px; }
  .empty-state .subtitle { font-size: 12.5px; color: var(--text-tertiary); margin-bottom: 18px; line-height: 1.5; }
  .empty-state .suggestions { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 320px; }
  .empty-state .suggestion {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 14px;
    border-radius: var(--radius); background: var(--bg-primary); border: 1px solid var(--border);
    cursor: pointer; transition: all var(--t); text-align: left; font-family: inherit;
    font-size: 12.5px; color: var(--text-secondary);
  }
  .empty-state .suggestion:hover { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
  .empty-state .suggestion .s-ico { width: 28px; height: 28px; border-radius: 8px; background: var(--bg-soft); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--t); }
  .empty-state .suggestion:hover .s-ico { background: var(--accent-soft); }
  .empty-state .suggestion .s-ico svg { width: 14px; height: 14px; stroke: var(--text-tertiary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--t); }
  .empty-state .suggestion:hover .s-ico svg { stroke: var(--accent); }
  .empty-state .suggestion .s-txt { flex: 1; line-height: 1.4; }
  .empty-state .suggestion .s-txt b { display: block; font-size: 12.5px; font-weight: 600; color: var(--text-primary); margin-bottom: 1px; }
  .empty-state .suggestion:hover .s-txt b { color: var(--accent); }
  .empty-state .suggestion .s-txt span { font-size: 11px; color: var(--text-tertiary); }

  /* —— 消息行 —— */
  .msg-row { display: flex; gap: 11px; max-width: 94%; animation: msgIn 0.28s cubic-bezier(0.16,1,0.3,1); align-items: flex-start; }
  @keyframes msgIn { 0% { opacity: 0; transform: translateY(6px); } 100% { opacity: 1; transform: translateY(0); } }
  .msg-row.user { align-self: flex-end; flex-direction: row-reverse; max-width: 82%; }
  .msg-row.ai { align-self: stretch; max-width: 92%; }
  .msg-row.system { align-self: center; max-width: 88%; }

  /* 头像 */
  .msg-avatar {
    width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0; margin-top: 2px;
    display: flex; align-items: center; justify-content: center; user-select: none;
  }
  .msg-avatar.ai-avatar { background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 3px 8px rgba(99,102,241,0.28); }
  .msg-avatar.ai-avatar svg { width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .msg-avatar.user-avatar { background: var(--bg-soft); }
  .msg-avatar.user-avatar svg { width: 14px; height: 14px; stroke: var(--text-secondary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .msg-avatar.sys-avatar { background: transparent; }
  .msg-avatar.sys-avatar svg { width: 14px; height: 14px; stroke: var(--text-tertiary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  /* 气泡块 */
  .bubble-block { display: flex; flex-direction: column; min-width: 0; }
  .msg-bubble {
    padding: 11px 15px; border-radius: var(--radius); font-size: 13.5px; line-height: 1.68;
    word-break: break-word;
  }
  /* 用户：实心渐变气泡 */
  .bubble-block.user-block .msg-bubble {
    background: linear-gradient(135deg, #6366f1, #7c3aed); color: #fff;
    border-bottom-right-radius: 6px; box-shadow: var(--shadow-accent);
  }
  /* AI：轻量卡片（极淡背景+左边框），既轻盈又有清晰边界 */
  .bubble-block.ai-block .msg-bubble {
    background: var(--bg-primary); color: var(--text-primary);
    padding: 12px 15px; border-radius: var(--radius);
    border: 1px solid var(--border); border-left: 3px solid var(--accent-line);
    font-size: 14px; line-height: 1.72; box-shadow: var(--shadow-sm);
  }
  /* 系统：细线条提示卡 */
  .bubble-block.system-block .msg-bubble {
    background: var(--bg-soft); color: var(--text-secondary);
    border-radius: var(--radius-sm); font-size: 12px; padding: 8px 12px;
    border: 1px solid var(--border); line-height: 1.55;
  }
  .bubble-block.system-block { align-items: center; }
  .bubble-block.system-block .msg-avatar { display: none; }
  .msg-row.system { gap: 0; }

  /* 时间行 */
  .msg-time-row {
    display: flex; align-items: center; gap: 6px; margin-top: 5px;
    font-size: 10px; color: var(--text-faint); letter-spacing: 0.3px; padding: 0 3px;
  }
  .bubble-block.user-block .msg-time-row { justify-content: flex-end; }
  .bubble-block.ai-block .msg-time-row { padding: 0 2px; margin-top: 3px; }

  /* 打字指示器 */
  .typing-dots { display: flex; align-items: center; gap: 5px; padding: 6px 2px;
    transition: opacity 0.35s ease, transform 0.35s ease; }
  .typing-dots.hiding { opacity: 0; transform: translateY(-4px) scale(0.95); }
  .typing-dots span { display: block; width: 7px; height: 7px; background: var(--text-faint); border-radius: 50%; animation: dotBounce 1.4s infinite both; }
  .typing-dots span:nth-child(2) { animation-delay: 0.18s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes dotBounce { 0%,60%,100%{transform:translateY(0);opacity:0.35} 30%{transform:translateY(-5px);opacity:1} }

  /* 流式内容气泡入场 */
  .stream-entering { opacity: 0; transform: translateY(6px); }
  .stream-active { opacity: 1; transform: translateY(0); transition: opacity 0.3s ease, transform 0.3s ease; }

  /* 流式光标 */
  .stream-cursor { display: inline-block; width: 2px; height: 1em; vertical-align: -1px; margin-left: 1px;
    background: var(--accent); border-radius: 1px; animation: cursorPulse 0.8s steps(2) infinite; }
  @keyframes cursorPulse { 50% { opacity: 0; } }
  .stream-cursor.done { animation: cursorFade 0.4s ease forwards; }
  @keyframes cursorFade { to { opacity: 0; } }

  /* —— Markdown 渲染 —— */
  .md { font-size: 14px; line-height: 1.72; color: var(--text-primary); }
  .md > *:first-child { margin-top: 0; }
  .md > *:last-child { margin-bottom: 0; }
  .md p { margin: 7px 0; }
  .md strong { color: var(--text-primary); font-weight: 660; }
  .md em { color: var(--text-secondary); }
  .md h1, .md h2, .md h3 { margin: 14px 0 7px; font-weight: 640; letter-spacing: -0.3px; color: var(--text-primary); }
  .md h1 { font-size: 16px; } .md h2 { font-size: 15px; } .md h3 { font-size: 14px; }
  .md ul, .md ol { margin: 7px 0; padding-left: 20px; }
  .md li { margin: 3px 0; }
  .md li::marker { color: var(--accent); }
  .md code { background: var(--bg-soft); padding: 1.5px 6px; border-radius: 5px; font-size: 12.5px; font-family: 'SF Mono','JetBrains Mono','Fira Code',monospace; color: var(--accent); }
  .md pre {
    background: #1e1e2e; color: #e4e4ef; padding: 13px 15px; border-radius: var(--radius);
    overflow-x: auto; margin: 10px 0; font-size: 12.5px; line-height: 1.6;
    font-family: 'SF Mono','JetBrains Mono','Fira Code',monospace; position: relative;
  }
  .md pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
  .md blockquote { border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; color: var(--text-secondary); background: var(--accent-soft); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-size: 12.5px; }
  .md blockquote p { margin: 3px 0; }
  .md a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-line); }
  .md a:hover { border-bottom-color: var(--accent); }
  .md hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
  .md table { width: 100%; border-collapse: collapse; margin: 9px 0; font-size: 12px; border-radius: var(--radius-sm); overflow: hidden; }
  .md th { background: var(--bg-soft); padding: 7px 10px; text-align: left; font-weight: 620; color: var(--text-primary); border-bottom: 1px solid var(--border-strong); }
  .md td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--text-secondary); }
  .md tr:last-child td { border-bottom: none; }

  /* —— 输入栏：浮起大圆角 —— */
  .input-bar {
    display: flex; flex-direction: column; gap: 6px; padding: 8px 14px 12px;
    background: var(--bg-primary); flex-shrink: 0;
  }
  .input-pill {
    display: flex; align-items: flex-end; gap: 4px; background: var(--bg-input);
    border-radius: var(--radius-lg); padding: 6px 6px 6px 8px;
    border: 1.5px solid transparent; transition: all var(--t);
  }
  .input-pill:focus-within { background: var(--bg-primary); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }

  /* —— 快捷操作栏（输入栏上方）—— */
  .action-bar {
    display: flex; align-items: center; gap: 6px; padding: 4px 14px 0;
    background: var(--bg-primary); flex-shrink: 0;
  }
  .action-btn {
    display: flex; align-items: center; gap: 5px;
    height: 30px; padding: 4px 12px; border-radius: 8px;
    border: 1px solid var(--border); background: transparent;
    cursor: pointer; transition: all var(--t); color: var(--text-tertiary);
    font-size: 12px; font-family: inherit;
  }
  .action-btn:hover { background: var(--bg-soft); color: var(--accent); border-color: var(--accent-line); }
  .action-btn svg { width: 14px; height: 14px; stroke: var(--text-tertiary); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--t); flex-shrink: 0; }
  .action-btn:hover svg { stroke: var(--accent); }
  .action-label { white-space: nowrap; }
  .input-pill textarea {
    flex: 1; min-height: 24px; max-height: 120px; padding: 6px 4px;
    border: none; background: transparent; color: var(--text-primary); font-size: 13.5px;
    font-family: inherit; resize: none; outline: none; line-height: 1.5;
  }
  .input-pill textarea::placeholder { color: var(--text-tertiary); }
  .send-btn {
    width: 34px; height: 34px; border-radius: 11px; background: var(--accent);
    border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all var(--t); flex-shrink: 0; box-shadow: 0 3px 10px rgba(99,102,241,0.32);
  }
  .send-btn:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 5px 14px rgba(99,102,241,0.4); }
  .send-btn:active { transform: translateY(0); }
  .send-btn:disabled { background: var(--text-faint); cursor: not-allowed; box-shadow: none; transform: none; }
  .send-btn svg { width: 16px; height: 16px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }

  /* 输入栏底部状态行（取代独立 status-bar） */
  .input-hint { display: flex; align-items: center; gap: 5px; padding: 0 6px; font-size: 10px; color: var(--text-faint); min-height: 13px; }
  .input-hint .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0; transition: background var(--t); }
  .input-hint .status-dot.error { background: var(--danger); }
  .input-hint .status-dot.busy { background: var(--accent); animation: blink 1s steps(2) infinite; }
  .input-hint .kbd { font-size: 9px; padding: 1px 4px; border-radius: 4px; background: var(--bg-soft); color: var(--text-tertiary); border: 1px solid var(--border); margin-left: auto; }

  /* —— 知识库 —— */
  .kb-area { flex: 1; display: none; flex-direction: column; overflow: hidden; background: var(--bg-canvas); }
  .kb-area.active { display: flex; }
  .kb-search { padding: 10px 12px 6px; }
  .kb-search input { width: 100%; padding: 9px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary); font-size: 12.5px; font-family: inherit; outline: none; transition: all var(--t); }
  .kb-search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .kb-list { flex: 1; overflow-y: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 7px; }
  .kb-list::-webkit-scrollbar { width: 5px; }
  .kb-list::-webkit-scrollbar-thumb { background: var(--text-faint); border-radius: 10px; }
  .kb-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 30px 18px; line-height: 1.7; }
  .kb-empty svg { width: 32px; height: 32px; stroke: var(--text-faint); fill: none; stroke-width: 1.6; }
  .kb-card { padding: 11px 14px; border-radius: var(--radius); background: var(--bg-primary); border: 1px solid var(--border); cursor: default; transition: all 0.16s; }
  .kb-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-sm); transform: translateY(-1px); }
  .kb-card-title { font-size: 12.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-card-url { font-size: 10.5px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .kb-card-preview { font-size: 11px; color: var(--text-secondary); margin-top: 4px; line-height: 1.45; max-height: 38px; overflow: hidden; }
  .kb-card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; font-size: 10px; color: var(--text-tertiary); }
  .kb-card-type { padding: 2px 7px; border-radius: 6px; font-size: 9.5px; font-weight: 600; background: var(--accent-soft); color: var(--accent); }
  .kb-card-del { border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 11px; padding: 3px 6px; border-radius: 5px; transition: all 0.14s; }
  .kb-card-del:hover { color: var(--danger); background: rgba(239,68,68,0.08); }

  /* 旧 status-bar 兼容（隐藏，逻辑已并入 input-hint） */
  .status-bar { display: none; }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
  .status-dot.error { background: var(--danger); }
`;

function createChatPanel() {
  if (chatPanelEl) return;

  // 宿主元素
  chatPanelEl = document.createElement('div');
  chatPanelEl.id = 'wuji-chat-host';
  chatPanelEl.setAttribute('data-ai-browser', 'chat-panel');
  chatPanelEl.style.cssText = 'position:fixed;z-index:99998;right:20px;bottom:20px;';

  const shadow = chatPanelEl.attachShadow({ mode: 'open' });
  shadowRoot = shadow;

  // 样式
  const style = document.createElement('style');
  style.textContent = CHAT_STYLES;
  shadow.appendChild(style);

  // 面板
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'panel';

  // 顶栏
  panel.innerHTML = `
    <div class="top-bar" id="top-bar">
      <div class="brand">
        <div class="brand-mark">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="38 12" transform="rotate(-90 12 12)"/><path d="M6 12 A 6 6 0 0 1 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M6 12 A 6 6 0 0 0 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/><circle cx="12" cy="12" r="1.4" fill="#fff"/></svg>
        </div>
        <span class="title">无极<span class="ver">v3.3</span></span>
      </div>
      <button class="icon-btn icon-btn--circle" id="btn-compress" title="压缩对话（省 tokens）">
        ${ICO.compress}
      </button>
      <button class="icon-btn" id="btn-close" title="关闭">
        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="chat">${ICO.chat} 对话</button>
      <button class="tab-btn" data-tab="knowledge">${ICO.book} 知识库</button>
    </div>
    <div class="message-area" id="msg-area">
      <div class="empty-state" id="empty-state">
        <div class="orb">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="38 12" transform="rotate(-90 12 12)"/><path d="M6 12 A 6 6 0 0 1 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M6 12 A 6 6 0 0 0 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/><circle cx="12" cy="12" r="1.4" fill="#fff"/></svg>
        </div>
        <div class="title">无极已就绪</div>
        <div class="subtitle">有什么想问的？</div>
        <div class="suggestions" id="suggestions">
          <button class="suggestion" data-prompt="请分析这个页面，总结 3-5 个主要要点。">
            <span class="s-ico">${ICO.bulb}</span>
            <span class="s-txt"><b>分析此页面</b><span>总结主要内容</span></span>
          </button>
          <button class="suggestion" data-prompt="总结这个页面的要点，用简洁的列表呈现。">
            <span class="s-ico">${ICO.doc}</span>
            <span class="s-txt"><b>总结要点</b><span>快速了解页面说了什么</span></span>
          </button>
          <button class="suggestion" data-prompt="基于知识库中相关内容，回答我的问题。">
            <span class="s-ico">${ICO.book}</span>
            <span class="s-txt"><b>查询知识库</b><span>搜索已保存的网页和笔记</span></span>
          </button>
        </div>
      </div>
    </div>
    <div class="kb-area" id="kb-area">
      <div class="kb-search"><input type="text" id="kb-search" placeholder="搜索知识库..." /></div>
      <div class="kb-list" id="kb-list"><div class="kb-empty"><svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>知识库为空<br>通过工具箱保存网页或聊天记录</div></div>
    </div>
    <div class="action-bar">
      <button class="action-btn" id="btn-analyze" title="分析此页">
        <svg viewBox="0 0 24 24"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>
        <span class="action-label">分析网页</span>
      </button>
      <button class="action-btn" id="btn-analyze-image" title="识别图片">
        ${ICO.image}
        <span class="action-label">识别图片</span>
      </button>
      <button class="action-btn" id="btn-save-kb" title="保存到知识库">
        ${ICO.save}
        <span class="action-label">保存知识库</span>
      </button>
    </div>
    <div class="input-bar">
      <div class="input-pill">
        <textarea id="user-input" placeholder="给无极发送消息…" rows="1" maxlength="4000"></textarea>
        <button class="send-btn" id="send-btn" title="发送">
          <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div class="input-hint">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">就绪</span>
        <span class="kbd">Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
    <div class="status-bar"><span class="status-dot" id="status-dot-legacy"></span><span id="status-text-legacy">就绪</span></div>
  `;

  shadow.appendChild(panel);
  document.body.appendChild(chatPanelEl);

  // 绑定事件
  bindPanelEvents(shadow);
  makeDraggable(shadow);

  // 加载对话历史
  loadConversation();

  chatPanelVisible = true;
  panelJustCreated = true;
  setTimeout(() => { panelJustCreated = false; }, 300);
}

function bindPanelEvents(shadow) {
  const $ = sel => shadow.querySelector(sel);

  // 关闭
  $('#btn-close').addEventListener('click', () => toggleChatPanel(false));

  // 压缩对话
  $('#btn-compress').addEventListener('click', () => { if (!isProcessing) handleCompress(); });

  // 分析（已移至输入栏，保留顶栏无 home 按钮）
  $('#btn-analyze').addEventListener('click', () => {
    if (isProcessing) return;
    const preset = '分析这个页面，总结主要内容。';
    $('#user-input').value = preset;
    handleSend(preset);
  });

  // 示例问题卡片（空状态）
  shadow.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      if (isProcessing) return;
      const prompt = btn.dataset.prompt;
      if (!prompt) return;
      $('#user-input').value = prompt;
      handleSend(prompt);
    });
  });

  // 识别图片按钮（输入栏）
  const btnImg = $('#btn-analyze-image');
  if (btnImg) btnImg.addEventListener('click', () => { if (!isProcessing) handleAnalyzeImage(); });

  // 保存到知识库按钮（输入栏）
  const btnSave = $('#btn-save-kb');
  if (btnSave) btnSave.addEventListener('click', () => { if (!isProcessing) handleSaveToKB(); });

  // 标签切换
  shadow.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === currentTab) return;
      currentTab = tab;
      shadow.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      if (tab === 'chat') {
        $('#msg-area').style.display = 'flex';
        $('#kb-area').classList.remove('active');
      } else {
        $('#msg-area').style.display = 'none';
        $('#kb-area').classList.add('active');
        loadKnowledgeBase();
      }
    });
  });

  // 发送
  $('#send-btn').addEventListener('click', () => handleSend());
  $('#user-input').addEventListener('keydown', (e) => {
    // 中文输入法组词中的 Enter 不发送（isComposing / keyCode 229 均为输入法态）
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); handleSend(); }
  });
  $('#user-input').addEventListener('input', () => {
    const ta = $('#user-input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  });

  // 知识库搜索（V2 全文搜索）
  let kbTimer = null;
  $('#kb-search').addEventListener('input', () => {
    clearTimeout(kbTimer);
    kbTimer = setTimeout(async () => {
      const q = $('#kb-search').value.trim();
      if (!q) { loadKnowledgeBase(); return; }
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_SEARCH', payload: { query: q, limit: 20 } });
        if (resp?.success) {
          const items = (resp.data || []).map(d => ({ ...d, _store: 'kb_items' }));
          renderKBList(items);
        }
      } catch (e) { /* ignore */ }
    }, 300);
  });
}

// 拖拽
function makeDraggable(shadow) {
  const topBar = shadow.querySelector('#top-bar');
  const host = chatPanelEl;
  let dragging = false, startX, startY, origX, origY;

  topBar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.icon-btn')) return; // 不拦截按钮
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = host.getBoundingClientRect();
    origX = rect.left; origY = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    host.style.left = (origX + dx) + 'px';
    host.style.top = (origY + dy) + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => { dragging = false; });
}

function toggleChatPanel(show) {
  if (show && !chatPanelEl) {
    createChatPanel();
    return;
  }
  if (chatPanelEl) {
    chatPanelEl.style.display = show ? '' : 'none';
    chatPanelVisible = show;
    if (show) {
      const ta = shadowRoot?.querySelector('#user-input');
      if (ta) setTimeout(() => ta.focus(), 100);
    }
  }
}

// ============================================================
// 聊天功能
// ============================================================
function $(sel) { return shadowRoot?.querySelector(sel); }

function updateStatus(text, isError = false, isBusy = false) {
  const el = $('#status-text');
  const dot = $('#status-dot');
  if (el) el.textContent = text;
  if (dot) {
    dot.classList.toggle('error', isError);
    dot.classList.toggle('busy', isBusy);
  }
}

function hideEmptyState() {
  const el = $('#empty-state');
  if (el) el.style.display = 'none';
}

function scrollToBottom() {
  const area = $('#msg-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function createBubble(type, content, meta = null) {
  const row = document.createElement('div');
  row.className = `msg-row ${type}`;

  // 头像
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  if (type === 'user') {
    avatar.classList.add('user-avatar');
    avatar.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  } else if (type === 'ai') {
    avatar.classList.add('ai-avatar');
    avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="38 12" transform="rotate(-90 12 12)"/><path d="M6 12 A 6 6 0 0 1 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M6 12 A 6 6 0 0 0 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/><circle cx="12" cy="12" r="1.4" fill="#fff"/></svg>';
  } else {
    avatar.classList.add('sys-avatar');
    avatar.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  }

  // 气泡块
  const block = document.createElement('div');
  block.className = `bubble-block ${type}-block`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = content;
  block.appendChild(bubble);

  // 时间行
  if (meta) {
    const timeRow = document.createElement('div');
    timeRow.className = 'msg-time-row';
    timeRow.textContent = meta;
    block.appendChild(timeRow);
  }

  row.appendChild(avatar);
  row.appendChild(block);
  return row;
}

function createAIBubble() {
  const row = document.createElement('div');
  row.className = 'msg-row ai';

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar ai-avatar';
  avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="38 12" transform="rotate(-90 12 12)"/><path d="M6 12 A 6 6 0 0 1 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M6 12 A 6 6 0 0 0 18 12" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/><circle cx="12" cy="12" r="1.4" fill="#fff"/></svg>';

  const block = document.createElement('div');
  block.className = 'bubble-block ai-block';

  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';
  row._typingDots = dots;
  block.appendChild(dots);

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble stream-entering';
  bubble.style.display = 'none';
  row._contentBubble = bubble;
  block.appendChild(bubble);

  const timeRow = document.createElement('div');
  timeRow.className = 'msg-time-row';
  timeRow.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  block.appendChild(timeRow);

  row.appendChild(avatar);
  row.appendChild(block);
  return row;
}

async function handleSend(messageOverride) {
  const input = $('#user-input');
  const message = messageOverride || (input ? input.value.trim() : '');
  if (!message || isProcessing) return;

  isProcessing = true;
  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.disabled = true;
  updateStatus('正在处理...', false, true);

  try {
    hideEmptyState();
    const area = $('#msg-area');

    // 用户消息
    area.appendChild(createBubble('user', message, new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));

    // AI 气泡占位
    streamingBubble = createAIBubble();
    area.appendChild(streamingBubble);
    streamingContent = '';

    if (input) { input.value = ''; input.style.height = 'auto'; }
    scrollToBottom();
    updateStatus('AI 思考中...', false, true);

    // 对话历史
    conversationHistory.push({ role: 'user', content: message });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory = conversationHistory.slice(-MAX_HISTORY);

    // 发送到 AI_CHAT
    const response = await chrome.runtime.sendMessage({
      type: 'AI_CHAT',
      payload: {
        userMessage: message,
        pageUrl: window.location.href,
        pageTitle: document.title,
        enableActions: true,
        conversationHistory: conversationHistory.slice(0, -1)
      }
    });

    if (!response || !response.success) {
      throw new Error(response?.error || '请求失败');
    }
  } catch (error) {
    if (streamingBubble) { streamingBubble.remove(); streamingBubble = null; }
    const area = $('#msg-area');
    if (area) area.appendChild(createBubble('system', '错误: ' + error.message));
    scrollToBottom();
    updateStatus('错误: ' + error.message, true);
    isProcessing = false;
    const sendBtn = $('#send-btn');
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ============================================================
// Gemini 风格流式动画引擎
// ============================================================
let _streamBuffer = '';      // 已收到但尚未渲染的文本
let _streamRendered = '';    // 已渲染到 DOM 的文本
let _streamRAF = null;       // requestAnimationFrame ID
let _streamBubble = null;    // 当前正在流式输出的气泡元素
let _streamCursor = null;    // 流式光标元素

function _startStreamAnimation(bubble) {
  _streamBubble = bubble;
  _streamBuffer = '';
  _streamRendered = '';
  _streamCursor = document.createElement('span');
  _streamCursor.className = 'stream-cursor';
  _tickStream();
}

function _tickStream() {
  if (!_streamBubble) return;
  const charsPerFrame = 3;
  if (_streamBuffer.length > 0) {
    const chunk = _streamBuffer.substring(0, charsPerFrame);
    _streamBuffer = _streamBuffer.substring(charsPerFrame);
    _streamRendered += chunk;
    _renderStreamPartial(_streamRendered, _streamBubble);
  }
  _streamRAF = requestAnimationFrame(_tickStream);
}

function _renderStreamPartial(text, bubble) {
  const cleaned = cleanToolCallsFromText(text);
  const html = renderStreamMarkdown(cleaned);
  bubble.innerHTML = html;
  bubble.appendChild(_streamCursor);
  scrollToBottom();
}

function _stopStreamAnimation(finalBubble) {
  if (_streamRAF) { cancelAnimationFrame(_streamRAF); _streamRAF = null; }
  // 捕获局部引用：闭包执行时 _streamCursor 已被置 null，直接读会抛 TypeError
  const cursor = _streamCursor;
  if (cursor && cursor.isConnected) {
    cursor.classList.add('done');
    setTimeout(() => { if (cursor.isConnected) cursor.remove(); }, 500);
  }
  _streamBubble = null;
  _streamBuffer = '';
  _streamRendered = '';
  _streamCursor = null;
}

/**
 * 流式轻量 Markdown：只处理最常见的格式，速度优先
 * 完成后会用完整 renderMarkdown 重新渲染
 */
function renderStreamMarkdown(text) {
  // 先整体转义再套 Markdown，杜绝 LLM 输出中的 HTML 注入
  let h = escHtml(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^- (.+)$/gm, '• $1');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

// ============================================================
// 流式响应处理
// ============================================================
function handleStreamDelta(delta) {
  if (!streamingBubble) return;
  // 首次收到内容时，平滑过渡：淡出打字圆点，淡入内容气泡
  if (streamingBubble._typingDots && streamingBubble._typingDots.style.display !== 'none') {
    streamingBubble._typingDots.classList.add('hiding');
    const bubble = streamingBubble._contentBubble;
    if (bubble) {
      bubble.style.display = '';
      requestAnimationFrame(() => { bubble.classList.remove('stream-entering'); bubble.classList.add('stream-active'); });
    }
    setTimeout(() => { if (streamingBubble && streamingBubble._typingDots) streamingBubble._typingDots.style.display = 'none'; }, 350);
    // 启动动画引擎
    _startStreamAnimation(bubble || streamingBubble.querySelector('.msg-bubble'));
  }
  streamingContent += delta;
  _streamBuffer += delta;
}

function handleStreamDone() {
  if (streamingBubble) {
    const bubble = streamingBubble._contentBubble || streamingBubble.querySelector('.msg-bubble');
    if (bubble && streamingContent) {
      _stopStreamAnimation(bubble);
      const cleaned = cleanToolCallsFromText(streamingContent);
      bubble.innerHTML = renderMarkdown(cleaned);
      bubble.classList.add('md');
      conversationHistory.push({ role: 'assistant', content: cleaned });
      saveConversation();
    }
  }
  streamingBubble = null; streamingContentEl = null; streamingContent = '';
  isProcessing = false;
  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.disabled = false;
  updateStatus('就绪');
  const input = $('#user-input');
  if (input) input.focus();
}

/**
 * 从流式文本中剥离工具调用 JSON 及其 markdown 代码块包裹。
 * 多轮工具调用下，第一轮的 {"tool":...} 不应显示在最终答案里。
 * 保留 > 🔧 工具状态行（blockquote）和正常文本。
 */
function cleanToolCallsFromText(text) {
  // 1. 剥离包裹工具 JSON 的 markdown 代码块：```json\n{...}\n``` 或 ```\n{...}\n```
  let out = text.replace(/```(?:json)?\s*\n?\s*(\{"tool"[\s\S]*?\})\s*\n?\s*```/g, '');
  // 2. 剥离裸露的工具调用 JSON
  out = out.replace(/\{"tool"\s*:\s*"\w+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g, '');
  // 3. 清理多余空行
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out || text; // 若清理后为空（极端情况），返回原文
}

function handleStreamError(errorMsg) {
  _stopStreamAnimation();
  if (streamingBubble) {
    const bubble = streamingBubble._contentBubble || streamingBubble.querySelector('.msg-bubble');
    if (bubble) {
      bubble.style.display = '';
      bubble.textContent = '❌ 调用失败: ' + errorMsg;
    }
  }
  streamingBubble = null; streamingContentEl = null; streamingContent = '';
  isProcessing = false;
  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.disabled = false;
  updateStatus('调用失败', true);
}

function handleActionResults(results) {
  if (!results || !results.length) return;
  const area = $('#msg-area');
  if (!area) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'msg system';
  wrapper.style.maxWidth = '95%';

  const hdr = document.createElement('div');
  hdr.className = 'hdr'; hdr.textContent = '操作结果';
  wrapper.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'body';
  let text = '';
  results.forEach((r, i) => {
    const icon = r.success ? '✓' : '✗';
    text += `${icon} ${r.action} ${r.selector || ''}\n`;
    if (r.success && r.result) text += typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 1);
    else if (r.error) text += '错误: ' + r.error;
    if (i < results.length - 1) text += '\n---\n';
  });
  body.textContent = text;
  body.style.whiteSpace = 'pre-wrap';
  body.style.fontSize = '12px';
  wrapper.appendChild(body);

  area.appendChild(wrapper);
  scrollToBottom();
}

// ============================================================
// 工具调用结果展示（AI Agent 自动执行工具后显示）
// ============================================================
function handleToolResult(msg) {
  const area = $('#msg-area');
  if (!area) return;
  const toolNames = {
    search_knowledge: '🔍 搜索知识库',
    create_note: '📝 创建笔记',
    add_tag: '🏷️ 添加标签',
    favorite: '⭐ 收藏',
    analyze_content: '📊 分析内容',
    get_related: '🔗 查找相关',
    read_dom: '🌐 读取页面',
    whitelist_site: '🛡️ 广告白名单',
    toggle_adblock: '🚫 广告过滤'
  };
  const label = toolNames[msg.tool] || '🔧 ' + msg.tool;
  const icon = msg.success ? '✅' : '❌';
  area.appendChild(createBubble('system', `${icon} ${label}: ${msg.summary}`));
  scrollToBottom();
  // 注意：不再把工具结果 push 进 conversationHistory。
  // 多轮工具调用循环已在 service-worker 的 messages 里自行管理上下文，
  // 这里再塞会污染下次对话的历史，导致 LLM 收到伪 user 消息而困惑。
}

// ============================================================
// 工具箱功能
// ============================================================
async function handleSaveAsPdf() {
  hideEmptyState();
  const area = $('#msg-area');
  const b = createBubble('system', '正在生成 PDF...');
  area.appendChild(b); scrollToBottom(); updateStatus('正在生成 PDF...');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'SAVE_AS_PDF' });
    b.querySelector('.msg-bubble').textContent = r?.success ? 'PDF 已生成并开始下载' : 'PDF 生成失败: ' + (r?.error || '未知错误');
  } catch (e) { b.querySelector('.msg-bubble').textContent = 'PDF 生成失败: ' + e.message; }
  updateStatus('就绪');
}

async function handleVideoSummary() {
  hideEmptyState();
  const area = $('#msg-area');
  const b = createBubble('system', '正在获取视频字幕并生成摘要...');
  area.appendChild(b); scrollToBottom(); updateStatus('正在生成视频摘要...');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'VIDEO_SUMMARY' });
    if (r?.success && r.streaming) {
      b.remove();
      streamingBubble = createAIBubble();
      area.appendChild(streamingBubble);
      streamingContent = '';
      isProcessing = true;
      // 视频摘要经 tabs.sendMessage 流式下发，不走 AI_CHAT 历史链路，这里补记保持对话连贯
      conversationHistory.push({ role: 'user', content: '请总结当前视频内容' });
      const sendBtn = $('#send-btn'); if (sendBtn) sendBtn.disabled = true;
      updateStatus('生成中...', false, true);
      return;
    } else if (r?.success) {
      b.querySelector('.msg-bubble').textContent = '视频摘要生成完成';
      updateStatus('就绪');
      return;
    } else {
      b.querySelector('.msg-bubble').textContent = '视频摘要失败: ' + (r?.error || '未知错误');
    }
  } catch (e) { b.querySelector('.msg-bubble').textContent = '失败: ' + e.message; }
  updateStatus('就绪');
}

async function handleSaveToKB() {
  hideEmptyState();
  const area = $('#msg-area');
  const b = createBubble('system', '正在保存到知识库（V2 引擎）...');
  area.appendChild(b); scrollToBottom(); updateStatus('正在保存...');
  try {
    const pc = getPageContent();
    const r = await chrome.runtime.sendMessage({
      type: 'KB_V2_SAVE',
      payload: { url: window.location.href, title: document.title, content: pc.fullText.substring(0, 50000), source_type: 'page', auto_tag: true }
    });
    b.querySelector('.msg-bubble').textContent = r?.success ? '✅ 页面已保存到知识库（含内容块+索引+自动标签）' : '保存失败: ' + (r?.error || '未知错误');
    if (conversationHistory.length > 0) {
      chrome.runtime.sendMessage({
        type: 'KB_V2_SAVE',
        payload: { url: window.location.href, title: document.title + ' - 对话', content: JSON.stringify(conversationHistory.slice(-10)), source_type: 'chat', auto_tag: false }
      }).catch(() => {});
    }
  } catch (e) { b.querySelector('.msg-bubble').textContent = '保存失败: ' + e.message; }
  updateStatus('就绪');
}

async function handleCompress() {
  if (conversationHistory.length < 2) {
    updateStatus('对话太短，无需压缩', false, false);
    setTimeout(() => updateStatus('就绪'), 2000);
    return;
  }
  hideEmptyState();
  const area = $('#msg-area');
  const b = createBubble('system', '🗜️ 正在压缩对话历史...');
  area.appendChild(b); scrollToBottom();
  updateStatus('压缩中...', false, true);
  isProcessing = true;
  const sendBtn = $('#send-btn'); if (sendBtn) sendBtn.disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'AI_COMPRESS',
      payload: { conversationHistory: conversationHistory.slice(), pageUrl: window.location.href, pageTitle: document.title }
    });
    if (r?.success && r.summary) {
      const summary = r.summary;
      conversationHistory = [{ role: 'system', content: '【对话摘要】' + summary }];
      saveConversation();
      b.querySelector('.msg-bubble').textContent = '✅ 对话已压缩（' + r.originalTokens + ' → ' + r.compressedTokens + ' tokens）';
      // 清除历史气泡，重新渲染摘要
      const msgArea = $('#msg-area');
      msgArea.querySelectorAll('.msg-row').forEach(el => el.remove());
      const summaryBubble = createBubble('system', '📝 对话摘要：\n' + summary);
      msgArea.appendChild(summaryBubble);
      // 恢复空状态中的建议（如果只剩系统消息）
      const emptyState = $('#empty-state');
      if (emptyState) emptyState.style.display = 'none';
    } else {
      b.querySelector('.msg-bubble').textContent = '压缩失败: ' + (r?.error || '未知错误');
    }
  } catch (e) { b.querySelector('.msg-bubble').textContent = '压缩失败: ' + e.message; }
  isProcessing = false;
  if (sendBtn) sendBtn.disabled = false;
  updateStatus('就绪');
  scrollToBottom();
}
async function loadKnowledgeBase() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_GET_ALL', payload: { limit: 50 } });
    if (resp?.success) {
      const items = (resp.data || []).map(d => ({ ...d, _store: 'kb_items' }));
      renderKBList(items);
    }
  } catch (e) { /* ignore */ }
}

function renderKBList(items) {
  const list = $('#kb-list');
  if (!list) return;
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="kb-empty">知识库为空，通过工具箱保存网页或聊天记录</div>';
    return;
  }
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'kb-card';
    const sourceLabel = item.source_type === 'page' ? '🌐 网页' : item.source_type === 'chat' ? '💬 对话' : '📁 文件';
    // 标签徽章
    let tagBadges = '';
    if (item.tags && item.tags.length > 0) {
      tagBadges = '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">' +
        item.tags.map(t => `<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:${/^#[0-9a-fA-F]{3,8}$/.test(t.color || '') ? t.color : '#e5e7eb'};color:#fff;font-weight:500;">${esc(t.name)}</span>`).join('') +
        '</div>';
    }
    const favIcon = item.is_favorite ? ' ⭐' : '';
    card.innerHTML = `
      <div class="kb-card-title">${esc(item.title || '未命名')}${favIcon}</div>
      ${item.url ? `<div class="kb-card-url">${esc(item.url.substring(0, 60))}</div>` : ''}
      <div class="kb-card-preview">${esc((item.content || '').substring(0, 150))}</div>
      ${tagBadges}
      <div class="kb-card-meta">
        <span class="kb-card-type">${sourceLabel}</span>
        <span>${item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
        <button class="kb-card-del" title="删除"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
    `;
    // 删除（使用 V2 API — 级联删除）
    card.querySelector('.kb-card-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('确定删除？这将同时删除相关内容块、标签关联、高亮和笔记。')) {
        await chrome.runtime.sendMessage({ type: 'KB_V2_DELETE', payload: { id: item.id } });
        loadKnowledgeBase();
      }
    });
    // 点击卡片 — 切换收藏
    card.style.cursor = 'pointer';
    card.addEventListener('click', async () => {
      const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_TOGGLE_FAVORITE', payload: { id: item.id } });
      if (resp?.success) loadKnowledgeBase();
    });
    list.appendChild(card);
  });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
// Markdown 渲染
// ============================================================
function escHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Markdown 链接只允许 http/https，杜绝 javascript: 等协议注入
function safeHref(href) {
  const h = String(href || '').trim();
  return /^https?:\/\//i.test(h) ? escHtml(h) : '#';
}

// ============================================================
// Markdown 渲染（安全版：先整体 HTML 转义，再套 Markdown 语法）
// ============================================================
function renderMarkdown(text) {
  let h = escHtml(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${safeHref(href)}" target="_blank" style="color:var(--accent)">${label}</a>`);
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^---$/gm, '<hr>');
  h = h.replace(/\n\n/g, '<br><br>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

// ============================================================
// 对话持久化
// ============================================================
function saveConversation() {
  try { chrome.storage.local.set({ [STORAGE_KEY]: conversationHistory.slice(-MAX_HISTORY) }); } catch (e) { /* ignore */ }
}

async function loadConversation() {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    if (r[STORAGE_KEY] && Array.isArray(r[STORAGE_KEY])) {
      conversationHistory = r[STORAGE_KEY];
      if (conversationHistory.length > 0) {
        hideEmptyState();
        const area = $('#msg-area');
        if (!area) return;
        conversationHistory.forEach(msg => {
          if (msg.role === 'user') {
            area.appendChild(createBubble('user', msg.content));
          } else if (msg.role === 'assistant') {
            const b = createBubble('ai', '');
            const bubble = b.querySelector('.msg-bubble');
            if (bubble) { bubble.innerHTML = renderMarkdown(msg.content); bubble.classList.add('md'); }
            area.appendChild(b);
          } else {
            // 压缩后的历史摘要等 system 消息也要渲染，否则面板打开后是空白
            area.appendChild(createBubble('system', msg.content));
          }
        });
        scrollToBottom();
      }
    }
  } catch (e) { /* ignore */ }
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
 */
const _domWatchers = {};
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
  _domWatchers[watcherId] = { observer, selector, el };
  return { watcherId, selector, status: 'watching' };
}

function stopDOMWatch(watcherId) {
  const w = _domWatchers[watcherId];
  if (!w) return { error: '未找到监听器: ' + watcherId };
  w.observer.disconnect();
  delete _domWatchers[watcherId];
  return { watcherId, status: 'stopped' };
}

/**
 * deepWatchDOM: 先轮询等待父元素出现，再挂 MutationObserver
 * 解决 #video-page-app 这类深层动态渲染节点的问题
 */
function deepWatchDOM(selector, debounceMs = 500, waitParentMs = 10000) {
  const start = Date.now();
  const watcherId = 'dw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

  function tryObserve() {
    const el = document.querySelector(selector);
    if (el) {
      // 找到了，注册 MutationObserver
      const observer = new MutationObserver(() => {
        // 变化发生时不做额外操作，等 get_watch_report 来取
      });
      observer.observe(el, { childList: true, subtree: true });
      _domWatchers[watcherId] = { observer, selector, el, type: 'deep' };
      return;
    }
    if (Date.now() - start > waitParentMs) return; // 超时，静默失败
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

  // AI 流式 delta
  if (message.type === 'AI_STREAM_DELTA' && message.delta) {
    handleStreamDelta(message.delta);
    return false;
  }
  if (message.type === 'AI_STREAM_DONE') {
    handleStreamDone();
    return false;
  }
  if (message.type === 'AI_STREAM_ERROR') {
    handleStreamError(message.error);
    return false;
  }
  if (message.type === 'ACTION_RESULTS') {
    handleActionResults(message.results);
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
    handleToolResult(message);
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

  // 确保聊天面板可见
  if (!chatPanelVisible) toggleChatPanel(true);

  // 提取页面图片
  const images = extractPageImages();

  if (images.length === 0) {
    const area = $('#msg-area');
    if (area) { hideEmptyState(); area.appendChild(createBubble('system', '当前页面未发现可识别的图片。')); scrollToBottom(); }
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

  hideEmptyState();
  const area = $('#msg-area');

  // 在聊天中显示用户选择的图片
  const userMsg = document.createElement('div');
  userMsg.className = 'msg user';
  const userHdr = document.createElement('div');
  userHdr.className = 'hdr';
  userHdr.textContent = '你';
  userMsg.appendChild(userHdr);
  const userBody = document.createElement('div');
  userBody.className = 'body';
  userBody.innerHTML = `📷 识别图片${altText ? '：' + escHtml(altText.substring(0, 50)) : ''}<br><img src="${escHtml(imageSrc)}" style="max-width:100%;max-height:150px;border-radius:8px;margin-top:6px;" onerror="this.style.display='none'" />`;
  userMsg.appendChild(userBody);
  area.appendChild(userMsg);

  // AI 气泡占位
  streamingBubble = createAIBubble();
  area.appendChild(streamingBubble);
  streamingContent = '';
  isProcessing = true;
  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.disabled = true;
  scrollToBottom();
  updateStatus('视觉模型分析中...');

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

  // 发送到 SW
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
    if (streamingBubble) { streamingBubble.remove(); streamingBubble = null; }
    area.appendChild(createBubble('system', '图片识别失败: ' + error.message));
    scrollToBottom();
    isProcessing = false;
    if (sendBtn) sendBtn.disabled = false;
    updateStatus('识别失败', true);
  }
}

// ============================================================
// 第九部分：网页翻译入口
// ============================================================
function handleTranslatePage() {
  try {
    chrome.runtime.sendMessage({ type: 'TRANSLATE_START', config: {} }, (resp) => {
      if (chrome.runtime.lastError) return;
      updateStatus('翻译已启动');
    });
    hideEmptyState();
    const area = $('#msg-area');
    if (area) {
      area.appendChild(createBubble('system', '🌐 正在翻译当前页面...\n翻译过程中页面会逐步显示译文，请稍候。'));
      scrollToBottom();
    }
  } catch (e) {
    updateStatus('翻译启动失败', true);
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