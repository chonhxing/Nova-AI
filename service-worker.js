/**
 * 无极 — Service Worker
 */

try {
  importScripts(
    'libs/providers.js',
    'libs/adblock/adblock-parser.js',
    'libs/wasm/wasm-kernels.js',
    'libs/kb-core.js',
    'libs/kb-agent.js',
    'libs/tab-suspender.js',
    'libs/danmaku-crawler.js',
    'libs/bili-downloader.js'
  );
  // 预加载 WASM 内核（失败自动降级 JS 兜底，不阻塞启动）
  if (typeof WasmKernels !== 'undefined' && WasmKernels.init) WasmKernels.init();
} catch (e) {
  console.warn('[无极 SW] 模块初始化失败：', e.message);
}

// ============================================================
// 通用：AI 请求路径 + 超时（所有 fetch 必须有超时，防止一个挂起卡死整条消息）
// ============================================================
/** chat/completions 请求路径：从 providers 目录取（智谱 v4 / 千帆 v2 / Gemini / Cohere 兼容层为非标准路径） */
function chatApiPath(provider, kind) {
  if (typeof WUJI_CHAT_PATH === 'function') return WUJI_CHAT_PATH(provider, kind);
  return WUJI_DEFAULT_PATH || '/v1/chat/completions';
}

/** 非流式请求：20 秒内必须拿到响应头，否则中止 */
async function fetchJSON(url, init = {}, headerTimeout = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), headerTimeout);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 流式请求：读流时每块之间闲置超过 idleMs 判定挂死，主动断开 */
async function fetchStream(url, init = {}, headerTimeout = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), headerTimeout);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 逐行解析 SSE 流，delta 回调逐段输出；返回是否正常读完全流 */
async function readSSE(response, onDelta, idleMs = 60000) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    let chunk;
    if (idleMs) {
      const idle = setTimeout(() => reader.cancel().catch(() => {}), idleMs);
      try {
        chunk = await reader.read();
      } finally {
        clearTimeout(idle);
      }
    } else {
      chunk = await reader.read();
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.substring(6);
      if (dataStr === '[DONE]') return true;
      try {
        const delta = JSON.parse(dataStr)?.choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch (e) { /* 单行解析失败不影响整体 */ }
    }
  }
  return true;
}

// ============================================================
// 数据库初始化
// ============================================================
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AIBrowserDB', 2);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('memories')) {
        const os = db.createObjectStore('memories', { keyPath: 'id', autoIncrement: true });
        os.createIndex('timestamp', 'timestamp', { unique: false });
        os.createIndex('type', 'type', { unique: false });
        os.createIndex('url', 'url', { unique: false });
      }
      if (!db.objectStoreNames.contains('kb_pages')) {
        const s = db.createObjectStore('kb_pages', { keyPath: 'id', autoIncrement: true });
        s.createIndex('url', 'url'); s.createIndex('timestamp', 'timestamp'); s.createIndex('title', 'title');
      }
      if (!db.objectStoreNames.contains('kb_chats')) {
        const s = db.createObjectStore('kb_chats', { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp'); s.createIndex('pageUrl', 'pageUrl');
      }
      if (!db.objectStoreNames.contains('kb_files')) {
        const s = db.createObjectStore('kb_files', { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp'); s.createIndex('name', 'name');
      }
    };
    request.onsuccess = (event) => { event.target.result.close(); resolve(); };
    request.onerror = (event) => reject(event.target.error);
  });
}

// ============================================================
// 安装/更新
// ============================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[无极 SW] onInstalled:', details.reason);
  try { await initDatabase(); } catch (e) { console.error(e); }
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'wuji-translate-page', title: '🌐 翻译此页为中文', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'wuji-restore-page', title: '↩ 显示原文', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'wuji-separator2', type: 'separator', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'wuji-open-chat', title: '💬 打开无极对话窗', contexts: ['page'] });
  });
  if (details.reason === 'install' || details.reason === 'update') {
    initAdblockRules().catch(e => console.error('[无极 SW] 广告过滤初始化失败:', e));
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'wuji-translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_START', config: { targetLang: 'zh-CN', displayMode: 'bilingual' } }).catch(() => {});
  } else if (info.menuItemId === 'wuji-restore-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_RESTORE' }).catch(() => {});
  } else if (info.menuItemId === 'wuji-open-chat') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CHAT_PANEL' }).catch(() => {});
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CHAT_PANEL' }).catch(() => {});
});

// ============================================================
// 消息路由
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 旧 API
  if (message.type === 'PAGE_CONTENT' && message.payload) { handlePageContent(message, sender, sendResponse); return true; }
  if (message.type === 'AI_CHAT' && message.payload) { handleAIChat(message, sender, sendResponse); return true; }
  if (message.type === 'AI_COMPRESS' && message.payload) { handleAICompress(message, sender, sendResponse); return true; }
  if (message.type === 'SEARCH_MEMORIES' && message.payload) { handleSearchMemories(message, sender, sendResponse); return true; }
  if (message.type === 'GET_API_CONFIG') { handleGetApiConfig(sendResponse); return true; }
  if (message.type === 'EXPLAIN_TEXT') { handleExplainText(message, sender, sendResponse); return true; }
  if (message.type === 'TRANSLATE_TEXT') { handleTranslateText(message, sender, sendResponse); return true; }
  if (message.type === 'REWRITE_TEXT') { handleRewriteText(message, sender, sendResponse); return true; }
  if (message.type === 'SAVE_AS_PDF') { handleSaveAsPdf(sender, sendResponse); return true; }
  if (message.type === 'VIDEO_SUMMARY') { handleVideoSummary(sender, sendResponse); return true; }
  if (message.type === 'KB_SAVE_PAGE') { handleKBSavePage(message, sender, sendResponse); return true; }
  if (message.type === 'KB_SAVE_CHAT') { handleKBSaveChat(message, sender, sendResponse); return true; }
  if (message.type === 'KB_SEARCH') { handleKBSearch(message, sender, sendResponse); return true; }
  if (message.type === 'KB_GET_ALL') { handleKBGetAll(message, sender, sendResponse); return true; }
  if (message.type === 'KB_DELETE') { handleKBDelete(message, sender, sendResponse); return true; }
  if (message.type === 'KB_CLEAR') { handleKBClear(message, sender, sendResponse); return true; }
  if (message.type === 'KB_STATS') { handleKBStats(sendResponse); return true; }
  if (message.type === 'OPEN_OPTIONS') { chrome.runtime.openOptionsPage(); sendResponse({ success: true }); return true; }
  if (message.type === 'ANALYZE_IMAGE' && message.payload) { handleAnalyzeImage(message, sender, sendResponse); return true; }
  if (message.type === 'ANALYZE_SCREEN' && message.payload) { handleAnalyzeScreen(message, sender, sendResponse); return true; }
  if (message.type === 'GET_VISION_CONFIG') { handleGetVisionConfig(sendResponse); return true; }
  if (message.type === 'GET_PAGE_IMAGES') { handleGetPageImages(sender, sendResponse); return true; }
  if (message.type === 'TRANSLATE_BATCH' && message.payload) { handleTranslateBatch(message, sender, sendResponse); return true; }
  if (message.type === 'TRANSLATE_SELECTION_SYNC' && message.payload) { handleTranslateSelection(message, sender, sendResponse); return true; }
  if (message.type === 'TRANSLATE_ENGINE_TEST' && message.payload) { handleTranslateEngineTest(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_FETCH_RULES') { handleAdblockFetchRules(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_TOGGLE') { handleAdblockToggle(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_UPDATE_RULES') { handleAdblockUpdateRules(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_GET_STATS') { handleAdblockGetStats(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_GET_LISTS') { handleAdblockGetLists(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_SAVE_LISTS') { handleAdblockSaveLists(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_CLEAR_RULES') { handleAdblockClearRules(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_CLEAR_CUSTOM') { handleAdblockClearCustom(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_ADD') { handleAdblockWhitelistAdd(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_TOGGLE') { handleAdblockWhitelistToggle(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_ADD_NAMED') { handleAdblockWhitelistAddNamed(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_LIST') { handleAdblockWhitelistList(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_REMOVE') { handleAdblockWhitelistRemove(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_CLEAR') { handleAdblockWhitelistClear(message, sender, sendResponse); return true; }

  // ======== KB V2 API ========
  if (message.type === 'KB_V2_SAVE') { handleKBV2Save(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_SEARCH') { handleKBV2Search(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_GET_ALL') { handleKBV2GetAll(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_GET_ITEM') { handleKBV2GetItem(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_DELETE') { handleKBV2Delete(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_TOGGLE_FAVORITE') { handleKBV2ToggleFavorite(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_STATS') { handleKBV2Stats(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_TAG_LIST') { handleKBV2TagList(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_TAG_CREATE') { handleKBV2TagCreate(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_TAG_LINK') { handleKBV2TagLink(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_TAG_UNLINK') { handleKBV2TagUnlink(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_ITEM_TAGS') { handleKBV2ItemTags(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_TAG_DELETE') { handleKBV2TagDelete(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_HIGHLIGHT_CREATE') { handleKBV2HighlightCreate(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_HIGHLIGHT_LIST') { handleKBV2HighlightList(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_HIGHLIGHT_DELETE') { handleKBV2HighlightDelete(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_NOTE_CREATE') { handleKBV2NoteCreate(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_NOTE_LIST') { handleKBV2NoteList(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_NOTE_DELETE') { handleKBV2NoteDelete(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_GRAPH') { handleKBV2Graph(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_RELATED') { handleKBV2Related(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_ANALYZE_ITEM') { handleKBV2AnalyzeItem(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_AGENT_CHAT') { handleKBV2AgentChat(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_DASHBOARD') { handleKBV2Dashboard(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_MEMORY_RECALL') { handleKBV2MemoryRecall(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_AUTO_TAG') { handleKBV2AutoTag(message, sender, sendResponse); return true; }
  if (message.type === 'KB_V2_AGENT_PERMISSIONS') { handleKBV2AgentPermissions(message, sender, sendResponse); return true; }

  // ======== Console / Debugger 工具 ========
  if (message.type === 'CONSOLE_ATTACH') { handleConsoleAttachDirect(message.tabId || sender.tab?.id).then(r => sendResponse(r)); return true; }
  if (message.type === 'CONSOLE_DETACH') { handleConsoleDetachDirect(message.tabId || sender.tab?.id).then(r => sendResponse(r)); return true; }
  if (message.type === 'CONSOLE_GET_LOGS') { handleConsoleGetLogsDirect(message.tabId || sender.tab?.id, message.filter).then(r => sendResponse(r)); return true; }
  if (message.type === 'CONSOLE_EVAL') { handleConsoleEvalDirect(message.tabId || sender.tab?.id, message.expression).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, summary: e.message })); return true; }
  if (message.type === 'CONSOLE_CLICK') { handleConsoleClickDirect(message.tabId || sender.tab?.id, message.selector).then(r => sendResponse(r)); return true; }
  if (message.type === 'CONSOLE_FILL') { handleConsoleFillDirect(message.tabId || sender.tab?.id, message.selector, message.value).then(r => sendResponse(r)); return true; }
  if (message.type === 'CONSOLE_GET_HTML') { handleConsoleGetHTMLDirect(message.tabId || sender.tab?.id, message.selector).then(r => sendResponse(r)); return true; }
  if (message.type === 'CONSOLE_SMART') { handleConsoleSmartDirect(message.tabId || sender.tab?.id, message.intent, message.selector).then(r => sendResponse(r)); return true; }

  // ======== 标签页休眠 API ========
  if (message.type === 'TAB_SUSPEND_TOGGLE') { handleTabSuspendToggle(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_NOW') { handleTabSuspendNow(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_UNSUSPEND') { handleTabUnsuspend(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_RESTORE_CURRENT') { handleTabRestoreCurrent(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_WHITELIST_ADD') { handleTabWhitelistAdd(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_GET_STATS') { handleTabSuspendStats(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_GET_SETTINGS') { handleTabSuspendGetSettings(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_SAVE_SETTINGS') { handleTabSuspendSaveSettings(message, sender, sendResponse); return true; }
  if (message.type === 'TAB_SUSPEND_FETCH_ICON') { handleTabSuspendFetchIcon(message, sender, sendResponse); return true; }

  // ======== 弹幕管理姬 API ========
  if (message.type === 'DANMAKU_CRAWL') { handleDanmakuCrawl(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_LIST') { handleDanmakuList(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_DELETE') { handleDanmakuDelete(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_SET_ACTIVE') { handleDanmakuSetActive(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_GET_ACTIVE') { handleDanmakuGetActive(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_LOAD_TO_TAB') { handleDanmakuLoadToTab(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_UNLOAD_FROM_TAB') { handleDanmakuUnloadFromTab(message, sender, sendResponse); return true; }
  if (message.type === 'DANMAKU_TOGGLE_IN_TAB') { handleDanmakuToggleInTab(message, sender, sendResponse); return true; }

  // ======== 面板 UI 懒注入（Vue 3 编译产物，IIFE 单文件，executeScript 懒执行）========
  if (message.type === 'INJECT_PANEL_UI') { handleInjectPanelUI(message, sender, sendResponse); return true; }
  if (message.type === 'INJECT_DANMAKU_UI') { handleInjectDanmakuUI(message, sender, sendResponse); return true; }
  if (message.type === 'OPEN_DANMAKU_PANEL') { handleOpenDanmakuPanel(sender, sendResponse); return true; }

  // ======== B 站视频下载（引擎：libs/bili-downloader.js，算法移植自 Bili23）========
  if (message.type === 'BILI_GET_INFO' && message.payload) { handleBiliGetInfo(message, sender, sendResponse); return true; }
  if (message.type === 'BILI_RESOLVE' && message.payload) { handleBiliResolve(message, sender, sendResponse); return true; }
  if (message.type === 'BILI_OPEN_PANEL') { handleBiliOpenPanel(sender, sendResponse); return true; }
  if (message.type === 'BILI_DL_START' && message.payload) { handleBiliDlStart(message, sendResponse); return true; }

  return false;
});

// ============================================================
// 面板 UI 懒注入：ui/panel-ui.js 是 Vue 3 IIFE 单文件（懒注入 IIFE）。
// executeScript 注入到 content script 同一隔离世界（默认 isolated world），
// 注入后 window.__WUJI_PANEL__ 对 content.js / danmaku-player.js 直接可见。
// 文件自带幂等守卫（重复注入直接复用已挂载实例），关闭即 unmount，
// DOM/监听/响应式树全部释放 —— 未打开过面板的页面零 Vue 解析与内存成本
// （原实现 155KB 每页常驻解析）。
// ============================================================
async function handleInjectPanelUI(message, sender, sendResponse) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: '无法确定目标标签页' }); return; }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['ui/panel-ui.js'] });
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// 弹幕引擎懒注入：libs/danmaku-player.js 从 manifest 静态注入改为按需注入
// （B 站/YouTube 视频页由 tabs.onUpdated 自动注入，其余站点仅在打开弹幕
// 面板时注入），未注入过的页面省 43KB 解析 + 引擎常驻内存
async function handleInjectDanmakuUI(message, sender, sendResponse) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: '无法确定目标标签页' }); return; }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['libs/danmaku-player.js'] });
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// 弹幕引擎注入去重（标签页维度；导航后由 onUpdated/onRemoved 清除）
const DANMAKU_VIDEO_SITES = /(^|\.)((bilibili|bilibilitv)\.com|youtube\.com)$/i;
const danmakuInjectedTabs = new Set();

async function ensureDanmakuInjected(tabId) {
  if (danmakuInjectedTabs.has(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['libs/danmaku-player.js'] });
    danmakuInjectedTabs.add(tabId);
    return true;
  } catch (e) { return false; }
}

// 弹窗中继：popup 发 runtime 消息，SW 注入引擎+面板 UI 后转发 OPEN_DANMAKU_PANEL 到标签页
async function handleOpenDanmakuPanel(sender, sendResponse) {
  try {
    let tabId = sender.tab?.id;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    }
    if (!tabId) { sendResponse({ success: false, error: '无法确定目标标签页' }); return; }
    // 引擎 + 面板 UI 一次注入（两文件都有自身幂等守卫，重复注入无害）
    await chrome.scripting.executeScript({ target: { tabId }, files: ['libs/danmaku-player.js', 'ui/panel-ui.js'] });
    danmakuInjectedTabs.add(tabId);
    chrome.tabs.sendMessage(tabId, { type: 'OPEN_DANMAKU_PANEL' }, () => void chrome.runtime.lastError);
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// ============================================================
// B 站视频下载（引擎：libs/bili-downloader.js；WBI 签名/playurl 算法移植自
// 开源项目 Bili23-Downloader。Cookie 随 credentials:'include' 自动附带，
// Referer 由 declarativeNetRequest 会话规则对扩展发起的第三方请求注入）
// ============================================================
async function handleBiliGetInfo(message, sender, sendResponse) {
  try { sendResponse({ success: true, data: await BiliDownloader.getVideoInfo(message.payload?.bvid || '') }); }
  catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleBiliResolve(message, sender, sendResponse) {
  try { sendResponse({ success: true, data: await BiliDownloader.resolveStreams(message.payload || {}) }); }
  catch (e) { sendResponse({ success: false, error: e.message }); }
}

// 面板中继：B站视频页悬浮入口发 runtime 消息，SW 注入面板 UI 后转发
async function handleBiliOpenPanel(sender, sendResponse) {
  try {
    let tabId = sender.tab?.id;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    }
    if (!tabId) { sendResponse({ success: false, error: '无法确定目标标签页' }); return; }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['ui/panel-ui.js'] });
    chrome.tabs.sendMessage(tabId, { type: 'BILI_OPEN_PANEL' }, () => void chrome.runtime.lastError);
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// 面板流式下载的第一跳：确保 offscreen 落盘文档存在后转发 START
// （缺失时面板的 CHUNK/END 会被静默吞掉——上一版卡 100% 无文件正是这个原因）
async function handleBiliDlStart(message, sendResponse) {
  try {
    const { key, filename } = message.payload || {};
    if (!key || !filename) { sendResponse({ success: false, error: '参数缺失' }); return; }
    await ensureBiliOffscreen();
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'BILI_DL_START', key, filename });
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function ensureBiliOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'B站视频下载落盘：分块写入 OPFS 后经 chrome.downloads 保存'
  });
}

// ======== 各个消息处理器 ========
function handlePageContent(message, sender, sendResponse) {
  savePageContentToDB(message.payload).then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }));
}

// 页面存档约束：单条全文上限 / 同 URL 去重窗口 / 总量上限，防止 IndexedDB 无限膨胀
const PAGE_ARCHIVE_MAX_TEXT = 50000;
const PAGE_ARCHIVE_DEDUPE_MS = 24 * 60 * 60 * 1000;
const PAGE_ARCHIVE_MAX_RECORDS = 500;

function savePageContentToDB(pageData) {
  const fullText = (pageData.fullText || '').substring(0, PAGE_ARCHIVE_MAX_TEXT);
  const record = {
    url: pageData.url, title: pageData.title, fullText,
    keyParagraphs: pageData.keyParagraphs || [],
    timestamp: pageData.timestamp || Date.now(),
    type: 'page_content'
  };
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AIBrowserDB', 2);
    request.onsuccess = (event) => {
      const db = event.target.result;
      let failed = false;
      const tx = db.transaction('memories', 'readwrite');
      const store = tx.objectStore('memories');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { failed = true; db.close(); reject(tx.error); };
      tx.onabort = () => { if (!failed) { db.close(); reject(tx.error || new Error('存档事务中止')); } };

      // 同 URL 24 小时内只更新原记录，不追加新记录
      const dedupeReq = store.index('url').openCursor(IDBKeyRange.only(pageData.url));
      dedupeReq.onsuccess = () => {
        const cursor = dedupeReq.result;
        if (!cursor) { store.add(record); return; }
        if (record.timestamp - (cursor.value?.timestamp || 0) < PAGE_ARCHIVE_DEDUPE_MS) {
          record.id = cursor.value.id;
          cursor.update(record);
        } else {
          cursor.continue();
        }
      };
      dedupeReq.onerror = () => store.add(record);

      // 总量超限：删除最旧的记录（主键自增 ≈ 插入顺序）
      const countReq = store.count();
      countReq.onsuccess = () => {
        const overflow = countReq.result - PAGE_ARCHIVE_MAX_RECORDS;
        if (overflow <= 0) return;
        let removed = 0;
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || removed >= overflow) return;
          removed++;
          c.delete();
          c.continue();
        };
      };
    };
    request.onerror = () => reject(new Error('DB open failed'));
  });
}

function getAPIConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('apiConfig', result => {
      const config = result.apiConfig || { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', provider: 'deepseek' };
      resolve(config);
    });
  });
}
function handleGetApiConfig(sendResponse) { getAPIConfig().then(c => sendResponse({ success: true, data: c })).catch(e => sendResponse({ success: false, error: e.message })); }

// ============================================================
// 统一 System Prompt 引擎
// ============================================================
/**
 * 构建统一 System Prompt，让 AI 知晓：
 *   - 自己是"无极"插件（版本号从 manifest 动态读取）及其全部能力
 *   - 知识库统计数据（条目/标签/收藏/AI记忆）
 *   - 当前页面上下文
 *   - RAG 检索到的知识库相关条目
 *   - 可调用的工具能力
 */
async function buildUnifiedSystemPrompt(userQuery, pageUrl, pageTitle) {
  // 1. 插件元信息
  let prompt = `你是"无极"，一个 Chrome 浏览器扩展助手。
版本: ${chrome.runtime.getManifest().version}
功能: 网页翻译、AI 对话、图片识别、知识库、广告过滤、标签页管理、弹幕管理姬

## 工具
你可以返回 JSON 格式的 {"tool":"工具名","params":{...}} 来调用以下工具：`;
  
  const toolNames = Object.keys(AgentTools);
  toolNames.forEach(name => {
    prompt += `\n- **${name}**: ${AgentTools[name].description}`;
  });
  
  prompt += `
## ⚡ CDP 控制台规则（浏览器直接操控）

你有 **chrome.debugger API** 直接控制浏览器。每条操作都必须通过工具 JSON 真正执行。

**可用 CDP 工具（无需先调 console_attach，自动接入）**：
- **console_eval**: 在页面运行 JS → {"tool":"console_eval","params":{"expression":"document.title"}}
- **console_click**: CDP 真实鼠标点击 → {"tool":"console_click","params":{"selector":"button.submit"}}
- **console_fill**: CDP 填写输入框 → {"tool":"console_fill","params":{"selector":"input","value":"文字"}}
- **console_get_html**: CDP 读页面文本 → {"tool":"console_get_html","params":{"selector":"#app"}}
- **console_smart**: 探测元素(返回 tag/type/text/位置) → {"tool":"console_smart","params":{"selector":"#video-page-app"}}

**console_eval 铁律（违反=操作失败）**:
1. expression ≤200字符，只用精确CSS选择器，禁止 querySelectorAll('*')
2. class含特殊字符（如 text.right-2）→ 用 [class*="right-2"] 属性选择器
3. 最简单写法: document.querySelector('.class').innerText='新文字'
4. 返回 null → 用 console_smart 重新探测选择器
5. 不改 body/document 样式，不隐藏/删除容器

**路由规则（严格按照规则）**:
- 用户说"改/替换/修改/删除页面上某内容" → console_eval
- 用户说"点X按钮" → console_click
- 用户说"看/读页面内容" → console_get_html 或 read_dom
- 用户说"在X输入Y" → console_fill
- 不确定元素 → console_smart 探测

**🚫 铁律**：
- 禁止在回答文本里写 JS 并假装已执行。必须输出工具调用 JSON。
- 禁止连续两轮回答无工具 JSON（除非用户纯闲聊）
- 每次页面操作都要有对应的 JSON 工具调用

`;

  // 2. 知识库统计（仅 KB 引擎就绪时加载）
  if (typeof KBItem !== 'undefined') {
    try {
      const stats = await KBItem.getStats();
      const tagCount = await _dbCount('kb_tags');
      const convCount = await _dbCount('kb_ai_conversations');
      const memCount = await _dbCount('kb_ai_memories');
      prompt += '\n## 📊 你的知识库';
      prompt += `\n- 已保存 ${stats.total || 0} 个条目（${stats.favorites || 0} 个收藏）`;
      prompt += `\n- ${tagCount || 0} 个标签 · ${convCount || 0} 个历史对话 · ${memCount || 0} 条 AI 记忆`;
      try {
        const tags = await KBTag.getAll();
        if (tags.length > 0) {
          prompt += `\n- 可用标签: ${tags.slice(0, 15).map(t => t.name).join('、')}${tags.length > 15 ? '...' : ''}`;
        }
      } catch(e) {}
    } catch(e) {}
  }

  // 3. 当前页面上下文（仅 KB 引擎就绪时查询）
  if (pageUrl) {
    prompt += '\n\n## 📄 当前页面';
    prompt += `\n标题: ${pageTitle || '未知'}`;
    prompt += `\nURL: ${pageUrl}`;
    try { if (typeof KBIndex !== 'undefined') {
      const pageInKB = await KBIndex.search(pageUrl, 1);
      if (pageInKB.length > 0) {
        prompt += `\n🟢 此页面已保存到知识库`;
        try { const tags = await KBTag.getItemTags(pageInKB[0].id); if (tags.length > 0) prompt += `，标签: ${tags.map(t => t.name).join('、')}`; } catch(e) {}
      }
    }} catch(e) {}
  }

  // 4. RAG 检索（仅 KB 引擎就绪时）
  if (userQuery && userQuery.trim().length > 1 && typeof KBIndex !== 'undefined') {
    try {
      const ragResults = await KBIndex.search(userQuery, 5);
      if (ragResults.length > 0) {
        prompt += '\n\n## 🔍 知识库相关内容（RAG 检索）';
        ragResults.forEach((r, i) => {
          const typeLabel = r.source_type === 'page' ? '🌐' : r.source_type === 'chat' ? '💬' : '📁';
          prompt += `\n${i + 1}. ${typeLabel} **${r.title || '无标题'}**`;
          if (r.url) prompt += ` — ${r.url.substring(0, 60)}`;
          if (r.content_summary) prompt += `\n   摘要: ${r.content_summary.substring(0, 150)}`;
          else if (r.content) prompt += `\n   预览: ${r.content.substring(0, 150)}`;
        });
      }
    } catch(e) {}
  }

  // 5. AI 记忆（仅 KB 引擎就绪时）
  try { if (typeof KBAiMemory !== 'undefined') {
    const memories = await KBAiMemory.recall(userQuery, 3);
    if (memories.length > 0) {
      prompt += '\n\n## 🧠 AI 记忆（用户偏好）';
      memories.forEach(m => { prompt += `\n- [${m.type}] ${m.content.substring(0, 200)}`; });
    }
  }} catch(e) {}

  // 6. 行为准则（工具列表已在开头动态生成）
  prompt += `

## ⚡ 行为准则
1. **说实话** — 如果你不知道或不确定，直接说"我不确定"或"信息不足"。绝不编造数据、人名、时间、URL。
2. **引用来源** — 引用知识库内容时标注条目名称和来源；视觉分析时注明"👁️ 基于截图分析"。
3. **知识库优先** — 当用户提及"我的知识库"、"搜索"、"记住"等关键词时，主动搜索知识库
4. **视觉模型可用** — 当 DOM 工具读不到内容时（B站评论区等动态页面），可调用 **analyze_screen** 截图+视觉分析，或先 **scroll_down** 滚动再分析
5. **简洁** — 重点数据用**加粗**，回答精炼
6. **工具调用** — 返回 JSON: {"tool":"工具名","params":{...}}

## 👤 用户消息
${userQuery}`;

  return prompt;
}

// ============================================================
// 工具调用 JSON 提取（括号配对，支持嵌套 params 对象/数组）
// 供 handleAIChat 与 kb-agent 共用；同时剥离文本中的工具 JSON
// ============================================================
function extractToolCallBlocks(text) {
  const calls = [];
  // 归一化 {  "tool" → {"tool"
  let cleaned = String(text || '').replace(/\{\s+"tool"/g, '{"tool"');
  let searchFrom = 0;
  let guard = 0;
  while (guard++ < 50) {
    const idx = cleaned.indexOf('{"tool"', searchFrom);
    if (idx < 0) break;
    let depth = 0, start = -1, end = -1;
    for (let i = idx; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      else if (c === '"') {
        // 跳过字符串字面量（含转义）
        let j = i + 1;
        while (j < cleaned.length && cleaned[j] !== '"') { if (cleaned[j] === '\\') j++; j++; }
        i = j;
      }
    }
    if (start < 0 || end < 0) break; // 未闭合 JSON，放弃
    const block = cleaned.substring(start, end + 1);
    let parsed = null;
    try { parsed = JSON.parse(block); } catch (e) {}
    if (parsed && parsed.tool && parsed.params && typeof parsed.params === 'object') {
      calls.push({ name: String(parsed.tool), params: parsed.params });
      cleaned = cleaned.substring(0, start) + cleaned.substring(end + 1);
      searchFrom = start;
    } else {
      searchFrom = idx + 6;
    }
  }
  return { calls, cleanedText: cleaned.replace(/\n{3,}/g, '\n\n').trim() };
}

async function handleAIChat(message, sender, sendResponse) {
  const { userMessage, pageUrl, pageTitle, enableActions, conversationHistory } = message.payload;
  try {
    const config = await getAPIConfig();
    if (!config.apiKey) { sendResponse({ success: false, error: '请先配置 API Key' }); return; }
    
    // 图片识别意图检测
    const imageKeywords = /图片|照片|截图|图像|图里|图上的|image|picture|photo|screenshot|ocr/i;
    if (imageKeywords.test(userMessage)) {
      try {
        const visionConfig = await getVisionConfig();
        if (visionConfig.visionApiKey) {
          const tabId = sender.tab?.id;
          let images = [];
          if (tabId) {
            try { const imgResp = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_IMAGES' }); if (imgResp?.success && imgResp.images?.length > 0) { images = imgResp.images; } } catch (e) {}
          }
          if (images.length > 0) {
            const model = visionConfig.visionModel === 'vision-custom' && visionConfig.visionCustomModel ? visionConfig.visionCustomModel : visionConfig.visionModel;
            const imageContent = [{ type: 'text', text: userMessage }];
            for (const img of images.slice(0, 3)) { imageContent.push({ type: 'image_url', image_url: { url: img.src } }); }
            callVisionStream([{ role: 'user', content: imageContent }], `你是无极 V${chrome.runtime.getManifest().version} 的视觉模块，请基于图片内容回答问题。`, visionConfig, model, tabId).catch(() => {});
            sendResponse({ success: true, streaming: true }); return;
          }
        }
      } catch (e) {}
    }

    // 构建统一 System Prompt
    const systemPrompt = await buildUnifiedSystemPrompt(userMessage, pageUrl, pageTitle);

    // 发送到 AI
    const messages = [{ role: 'system', content: systemPrompt }, ...(conversationHistory || []), { role: 'user', content: userMessage }];
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const apiPath = chatApiPath(config.provider);
    const response = await fetchStream(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, stream: true, max_tokens: 4096 })
    });

    if (!response.ok) { const errText = await response.text(); throw new Error(`API ${response.status}: ${errText.substring(0, 200)}`); }

    let fullText = '';
    const tabId = sender.tab?.id;

    await readSSE(response, (delta) => {
      fullText += delta;
      if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta }).catch(() => {});
    });
    
    // 检测工具调用意图并自动执行 → 多轮循环（最多 MAX_TOOL_ROUNDS 轮）
    let toolCallExecuted = false;
    try {
      const MAX_TOOL_ROUNDS = 5;
      let round = 0;
      let finalText = '';
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        // 1. 检测工具调用（括号配对解析，支持嵌套 params）
        const { calls: toolCalls } = extractToolCallBlocks(fullText);
        // 2. 无工具调用 → 本轮即最终答案
        if (toolCalls.length === 0) { finalText = fullText; break; }

        // 3. 执行所有工具调用
        const toolMsgs = [];
        for (const tc of toolCalls) {
          if (!AgentTools[tc.name]) { toolMsgs.push(`[工具 ${tc.name} 执行结果]\n错误: 未知工具 "${tc.name}"`); continue; }
          let r;
          try { r = await AgentTools[tc.name].handler(tc.params || {}); } catch (e) { r = { success: false, summary: '工具执行异常: ' + e.message }; }
          toolCallExecuted = true;
          // 推送工具状态到 UI：仅用独立 TOOL_RESULT 系统气泡显示（✅ 🔧），
          // 不再往 AI 流式正文里塞 > 🔧 文本，避免与系统气泡重复显示。
          if (tabId) {
            chrome.tabs.sendMessage(tabId, { type: 'TOOL_RESULT', tool: tc.name, success: r.success, summary: r.summary, detail: r.detail }).catch(() => {});
          }
          toolMsgs.push(`[工具 ${tc.name} 执行结果]\n${r.detail || r.summary || '执行完成'}`);
        }

        // 4. 轮次耗尽：剥离工具 JSON 后的文本才是答案；全 JSON 则兜底说明
        if (round >= MAX_TOOL_ROUNDS) {
          const { cleanedText } = extractToolCallBlocks(fullText);
          finalText = cleanedText || '抱歉，连续多轮调用工具后仍未完成任务，请简化问题或稍后重试。';
          if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta: '\n\n> 🔧 工具调用已达上限\n\n' }).catch(() => {});
          break;
        }

        // 5. 工具结果回传 LLM，发起下一轮流式调用
        const toolFeedback = '### 工具执行结果\n以下是工具返回的数据，请直接回答用户最初的问题。' +
          '如仍需其他工具，可继续返回 JSON 工具调用；否则用 Markdown 输出最终答案。' +
          '\n\n' + toolMsgs.join('\n\n');
        messages.push({ role: 'assistant', content: fullText });
        messages.push({ role: 'user', content: toolFeedback });

        const resp2 = await fetchStream(`${baseUrl}${apiPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages, stream: true, max_tokens: 4096 })
        });
        if (!resp2.ok) {
          // 失败降级：上一轮文本剥离工具 JSON 后仍有内容则用之，否则给错误提示
          const { cleanedText } = extractToolCallBlocks(fullText);
          finalText = cleanedText || '抱歉，模型服务暂时不可用，请稍后重试。';
          if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_ERROR', error: '模型调用失败 (HTTP ' + resp2.status + ')' }).catch(() => {});
          break;
        }

        fullText = '';
        await readSSE(resp2, (delta2) => {
          fullText += delta2;
          if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta: delta2 }).catch(() => {});
        });
        // 回到循环顶部：检测本轮 fullText 是否还含工具调用
      }
      if (finalText) fullText = finalText;
    } catch(e) {}

    // 自动学习用户意图
    if (fullText.length > 50) {
      try { await KBAiMemory.remember('learned', `用户: ${userMessage.substring(0, 100)}`); } catch(e) {}
    }

    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DONE', fullText }).catch(() => {});
    sendResponse({ success: true, streaming: true });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

async function handleAICompress(message, sender, sendResponse) {
  const { conversationHistory } = message.payload;
  try {
    const config = await getAPIConfig();
    if (!config.apiKey) { sendResponse({ success: false, error: '请先配置 API Key' }); return; }
    const historyText = conversationHistory.map(m => `[${m.role}]: ${m.content}`).join('\n');
    const originalTokens = Math.round(historyText.length / 2.5);
    const compressPrompt = `请将以下对话历史压缩为一段简洁摘要（200字以内），保留关键信息：用户问题、回答要点、重要上下文。只输出摘要，不要其他内容。\n\n${historyText}`;
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const response = await fetchJSON(`${baseUrl}${chatApiPath(config.provider)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: compressPrompt }], max_tokens: 500, temperature: 0.3 })
    }, 30000);
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() || '';
    const compressedTokens = Math.round(summary.length / 2.5);
    sendResponse({ success: true, summary, originalTokens, compressedTokens });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

async function callAIStream(messages, systemPrompt, config, enableActions = false, tabId = null) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const sendToTab = (msg) => { if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {}); };
  const response = await fetchStream(`${baseUrl}${chatApiPath(config.provider)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: true, max_tokens: 4096 })
  });
  if (!response.ok) { const errText = await response.text(); throw new Error(`API ${response.status}: ${errText.substring(0, 200)}`); }
  let totalText = '';
  await readSSE(response, (delta) => { totalText += delta; sendToTab({ type: 'AI_STREAM_DELTA', delta }); });
  sendToTab({ type: 'AI_STREAM_DONE', fullText: totalText });
}

// ============================================================
// 旧知识库 + 视觉 + 翻译 + 广告过滤处理器（保持精简版）
// ============================================================
function handleSearchMemories(message, sender, sendResponse) {
  try { sendResponse({ success: true, data: [] }); } catch(e) { sendResponse({ success: false }); }
}
function searchMemories() { return Promise.resolve([]); }

async function handleExplainText(message, sender, sendResponse) { const config = await getAPIConfig(); if (!config.apiKey) { sendResponse({ success: false }); return; } streamToTab(sender.tab?.id, `请简洁解释：\n\n"${message.text}"`, config); sendResponse({ success: true }); }
async function handleTranslateText(message, sender, sendResponse) { const config = await getAPIConfig(); if (!config.apiKey) { sendResponse({ success: false }); return; } streamToTab(sender.tab?.id, `翻译为简体中文：\n\n"${message.text}"`, config); sendResponse({ success: true }); }
async function handleRewriteText(message, sender, sendResponse) { const config = await getAPIConfig(); if (!config.apiKey) { sendResponse({ success: false }); return; } streamToTab(sender.tab?.id, `改写润色：\n\n"${message.text}"`, config); sendResponse({ success: true }); }
async function streamToTab(tabId, userPrompt, config) {
  try {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const response = await fetchStream(`${baseUrl}${chatApiPath(config.provider)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: userPrompt }], stream: true, max_tokens: 1024 }) });
    if (!response.ok) { chrome.tabs.sendMessage(tabId, { type: 'POPUP_STREAM_ERROR', error: `API ${response.status}` }).catch(()=>{}); return; }
    await readSSE(response, (delta) => chrome.tabs.sendMessage(tabId, { type: 'POPUP_STREAM_DELTA', delta }).catch(()=>{}));
    chrome.tabs.sendMessage(tabId, { type: 'POPUP_STREAM_DONE' }).catch(()=>{});
  } catch (error) { chrome.tabs.sendMessage(tabId, { type: 'POPUP_STREAM_ERROR', error: error.message }).catch(()=>{}); }
}

function getVisionConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get('visionConfig', result => {
      resolve(result.visionConfig || { visionProvider: 'zhipu', visionBaseUrl: 'https://open.bigmodel.cn/api/paas', visionApiKey: '', visionModel: 'glm-4.6v-flash' });
    });
  });
}
function handleGetVisionConfig(sendResponse) { getVisionConfig().then(c => sendResponse({ success: true, data: c })); }
async function handleGetPageImages(sender, sendResponse) {
  try { const tabId = sender.tab?.id; if (tabId) { const resp = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_IMAGES' }); sendResponse(resp || { success: false }); } else sendResponse({ success: false }); } catch (e) { sendResponse({ success: false }); }
}
async function handleAnalyzeImage(message, sender, sendResponse) {
  const { imageUrl, prompt } = message.payload;
  try {
    const visionConfig = await getVisionConfig();
    if (!visionConfig.visionApiKey) { sendResponse({ success: false, error: '请先配置视觉模型 API Key' }); return; }
    const model = visionConfig.visionModel === 'vision-custom' && visionConfig.visionCustomModel ? visionConfig.visionCustomModel : visionConfig.visionModel;
    await callVisionStream([{ role: 'user', content: [{ type: 'text', text: prompt || '请详细描述这张图片的内容' }, { type: 'image_url', image_url: { url: imageUrl } }] }], '请基于图片内容回答问题。', visionConfig, model, sender.tab?.id);
    sendResponse({ success: true, streaming: true });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

/**
 * 截图分析：截图当前页面 → 视觉模型分析 → 联动语言模型
 */
async function handleAnalyzeScreen(message, sender, sendResponse) {
  const { prompt, scrollFirst } = message.payload || {};
  try {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: '无标签页' }); return; }

    // 1. 如果要求滚动，先执行滚动
    if (scrollFirst) {
      try { await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTIONS', actions: [{ action: 'scrollDown', selector: '' }], timestamp: Date.now() }); }
      catch(e) {}
      await new Promise(r => setTimeout(r, 800)); // 等滚动动画+渲染
    }

    // 2. 截图可视区域
    const dataUrl = await chrome.tabs.captureVisibleTab(tabId.windowId, { format: 'png', quality: 80 });
    if (!dataUrl) { sendResponse({ success: false, error: '截图失败' }); return; }

    // 3. 视觉模型分析截图
    const visionConfig = await getVisionConfig();
    if (!visionConfig.visionApiKey) { sendResponse({ success: false, error: '请配置视觉模型 API Key' }); return; }
    const model = visionConfig.visionModel === 'vision-custom' && visionConfig.visionCustomModel ? visionConfig.visionCustomModel : visionConfig.visionModel;

    const analysisPrompt = (prompt || '请描述截图中的内容') + 
      '\n\n重要：只描述你实际看到的内容，不要编造。如果截图看不清或信息不完整，请如实说明。';

    // 4. 视觉模型 → 语言模型 联动（两步流水线）
    const baseUrl = visionConfig.visionBaseUrl.replace(/\/+$/, '');
    const provider = visionConfig.visionProvider || 'zhipu';

    const visionResp = await fetchJSON(`${baseUrl}${chatApiPath(provider, 'vision')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${visionConfig.visionApiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: analysisPrompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        max_tokens: 1024
      })
    }, 60000);
    if (!visionResp.ok) throw new Error(`Vision API ${visionResp.status}`);
    const visionData = await visionResp.json();
    const visionText = visionData?.choices?.[0]?.message?.content?.trim() || '';

    // 5. 将视觉分析结果返回给用户（流式输出）
    if (tabId && visionText) {
      chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta: '👁️ **视觉分析结果**：\n\n' + visionText + '\n\n' }).catch(() => {});
      chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DONE', fullText: '👁️ **视觉分析结果**：\n\n' + visionText }).catch(() => {});
    }
    sendResponse({ success: true, data: { visionText, dataUrl: dataUrl.substring(0, 100) + '...' } });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

// Direct 版本供 kb-agent 直接调用（不走消息路由）
async function handleAnalyzeScreenDirect(tabId, prompt, scrollFirst) {
  try {
    if (scrollFirst) {
      try { await chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_ACTIONS', actions: [{ action: 'scrollDown', selector: '' }], timestamp: Date.now() }); } catch(e) {}
      await new Promise(r => setTimeout(r, 800));
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tabId, { format: 'png', quality: 80 });
    if (!dataUrl) return { success: false, summary: '截图失败' };

    const visionConfig = await getVisionConfig();
    if (!visionConfig.visionApiKey) return { success: false, summary: '请配置视觉模型 API Key' };
    const model = visionConfig.visionModel === 'vision-custom' && visionConfig.visionCustomModel ? visionConfig.visionCustomModel : visionConfig.visionModel;

    const baseUrl = visionConfig.visionBaseUrl.replace(/\/+$/, '');
    const provider = visionConfig.visionProvider || 'zhipu';

    const visionResp = await fetchJSON(`${baseUrl}${chatApiPath(provider, 'vision')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${visionConfig.visionApiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: [
        { type: 'text', text: (prompt || '请描述截图中的内容') + '\n\n重要：只描述实际看到的，不要编造。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]}], max_tokens: 1024 })
    }, 60000);
    if (!visionResp.ok) throw new Error(`Vision API ${visionResp.status}`);
    const visionData = await visionResp.json();
    const visionText = visionData?.choices?.[0]?.message?.content?.trim() || '';

    if (visionText) {
      chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta: '👁️ 视觉分析：\n\n' + visionText }).catch(() => {});
      chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DONE', fullText: '👁️ 视觉分析：\n\n' + visionText }).catch(() => {});
    }
    return { success: true, summary: '👁️ 视觉分析完成', detail: visionText, data: { visionText } };
  } catch (e) { return { success: false, summary: '截图分析失败: ' + e.message }; }
}
async function callVisionStream(messages, systemPrompt, visionConfig, model, tabId = null) {
  const baseUrl = visionConfig.visionBaseUrl.replace(/\/+$/, '');
  const sendToTab = (msg) => { if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {}); };
  const response = await fetchStream(`${baseUrl}${chatApiPath(visionConfig.visionProvider, 'vision')}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${visionConfig.visionApiKey}` }, body: JSON.stringify({ model: model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: true, max_tokens: 2048 }) });
  if (!response.ok) throw new Error(`Vision API ${response.status}`);
  let totalText = '';
  await readSSE(response, (delta) => { totalText += delta; sendToTab({ type: 'AI_STREAM_DELTA', delta }); });
  sendToTab({ type: 'AI_STREAM_DONE', fullText: totalText });
}

// ============================================================
// 翻译引擎（V6）：
//   1. Google 翻译免费接口 —— 零配置、机翻品质即谷歌级别
//   2. Microsoft 翻译免费接口 —— 国内可用的免费兜底
//   3. 百度通用翻译 —— AppID+密钥 MD5 签名鉴权（标准版 QPS=1，1.1s 节流）
//   4. 百度大模型文本翻译 —— Bearer API Key 或 MD5 签名双鉴权，支持翻译指令
//      端点与参数见官方文档 https://api.fanyi.baidu.com/doc/21
//   5. AI 模型引擎 —— 需要 API Key，JSON 编号协议保证多段译文不错位
// ============================================================
function getTranslatorAPIConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['translatorApiConfig', 'apiConfig'], (r) => {
      const t = r.translatorApiConfig || {};
      const baidu = {
        baiduAppid: (t.baiduAppid || '').trim(),
        baiduSecret: (t.baiduSecret || '').trim(),
        baiduApiKey: (t.baiduApiKey || '').trim(),
        baiduLlmInstruction: (t.baiduLlmInstruction || '').trim(),
      };
      if (t.apiKey) {
        resolve({ apiKey: t.apiKey, baseUrl: t.baseUrl || 'https://api.deepseek.com', model: t.model || 'deepseek-chat', provider: t.provider || 'deepseek', engine: t.engine || 'ai', ...baidu });
        return;
      }
      const main = r.apiConfig || { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', provider: 'deepseek' };
      resolve({ ...main, engine: t.engine || (main.apiKey ? 'ai' : 'auto'), ...baidu });
    });
  });
}

function mapGoogleLang(lang) {
  if (!lang || lang === 'auto' || lang === 'zh') return lang === 'zh' ? 'zh-CN' : 'auto';
  if (lang === 'zh-CN' || lang === 'zh-TW' || lang === 'en') return lang;
  // 其他 BCP-47 代码（ja/ko/fr/de 等）原样透传
  return lang;
}

function mapMicrosoftLang(lang) {
  if (!lang || lang === 'auto' || lang === 'zh') return null; // null = 自动检测（省略 from 参数）
  if (lang === 'zh-CN' || lang === 'zh') return 'zh-Hans';
  if (lang === 'zh-TW') return 'zh-Hant';
  return lang;
}

// ---- 百度翻译（通用版 + 大模型）----------------------------------------
// SubtleCrypto 不提供 MD5，签名需自实现（RFC 1321，输入转 UTF-8 字节后计算）
function md5Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const total = (Math.floor((len + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitLen = len * 8;
  const bitLenLo = bitLen >>> 0, bitLenHi = Math.floor(bitLen / 4294967296);
  padded[total - 8] = bitLenLo & 0xff;
  padded[total - 7] = (bitLenLo >>> 8) & 0xff;
  padded[total - 6] = (bitLenLo >>> 16) & 0xff;
  padded[total - 5] = (bitLenLo >>> 24) & 0xff;
  padded[total - 4] = bitLenHi & 0xff;
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) {
      M[j] = padded[off + j * 4] | (padded[off + j * 4 + 1] << 8) | (padded[off + j * 4 + 2] << 16) | (padded[off + j * 4 + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i & 3)];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  let out = '';
  for (const w of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) out += ((w >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

// 百度语种代码与 BCP-47 差异项（其余原样透传；详见官方语种对照表）
function mapBaiduLang(lang) {
  if (!lang || lang === 'auto') return 'auto';
  if (lang === 'zh-CN' || lang === 'zh') return 'zh';
  if (lang === 'zh-TW' || lang === 'zh-HK') return 'cht';
  const map = { ja: 'jp', ko: 'kor', fr: 'fra', es: 'spa', ar: 'ara', he: 'heb', sv: 'swe', da: 'dan', fi: 'fin', no: 'nor', ro: 'rom', ms: 'may', tl: 'fil' };
  return map[lang] || lang;
}

const BAIDU_VIP_URL = 'https://fanyi-api.baidu.com/api/trans/vip/translate';
const BAIDU_LLM_URL = 'https://fanyi-api.baidu.com/ait/api/aiTextTranslate';
const BAIDU_QPS_INTERVAL_MS = 1100; // 标准版 QPS=1，留余量；高级版自动兼容
const BAIDU_MAX_Q_BYTES = 5000;     // 官方上限 6000 字，UTF-8 字节计留余量
let baiduLastCallAt = 0;

async function baiduQpsWait() {
  const wait = BAIDU_QPS_INTERVAL_MS - (Date.now() - baiduLastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  baiduLastCallAt = Date.now();
}

function baiduErrorText(code, msg) {
  const map = {
    '52001': '请求超时', '52002': '百度服务错误，请重试', '52003': 'AppID 无效或未开通对应翻译服务',
    '54000': '必填参数为空', '54001': '签名错误：请检查 AppID/密钥是否填写正确',
    '54003': '请求频率超限（标准版 QPS=1）', '54004': '账户余额不足', '54005': '长文本请求频繁',
    '58001': '不支持该语言方向（个人版支持 28 个常用语种）', '58002': '翻译服务未开通，请前往百度翻译开放平台开启',
    '58003': 'IP 已被百度封禁（当日多个 AppID 混用所致，次日解封）', '58004': 'model_type 参数错误',
    '59002': '翻译指令超过 500 字上限', '59003': '请求文本超过 6000 字上限', '59004': 'QPS 超限',
    '90107': '开发者认证未通过', '20003': '请求内容存在安全风险'
  };
  return '百度翻译错误 ' + code + '：' + (map[code] || msg || '未知错误');
}

// 按 UTF-8 字节把段落打包成多个请求（避免超过单次 6000 字上限）
function baiduChunk(texts) {
  const enc = new TextEncoder();
  const chunks = [];
  let cur = [], curBytes = 0;
  for (const t of texts) {
    const b = enc.encode(t).length + 1;
    if (cur.length && curBytes + b > BAIDU_MAX_Q_BYTES) { chunks.push(cur); cur = []; curBytes = 0; }
    cur.push(t);
    curBytes += b;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function baiduRequest(texts, sourceLang, targetLang, cfg, llm) {
  const from = mapBaiduLang(sourceLang) || 'auto';
  const to = mapBaiduLang(targetLang);
  if (!to || to === 'auto') throw new Error('百度翻译需要明确的目标语言');
  let translations = [];
  for (const chunk of baiduChunk(texts)) {
    // 段内换行压成空格，避免与多行分隔符混淆导致行数错位
    const lines = chunk.map(t => t.replace(/\s*\n+\s*/g, ' ').trim());
    const q = lines.join('\n');
    const params = { q, from, to, appid: cfg.baiduAppid };
    if (llm) {
      params.model_type = 'llm';
      if (cfg.baiduLlmInstruction) params.reference = cfg.baiduLlmInstruction.slice(0, 500);
    }
    // 大模型接口配了 API Key 时用 Bearer 鉴权；否则走 MD5(appid+q+salt+密钥) 签名（两接口通用）
    const useBearer = llm && cfg.baiduApiKey;
    if (!useBearer) {
      params.salt = String(Date.now()) + String(Math.floor(Math.random() * 100000));
      params.sign = md5Hex(cfg.baiduAppid + q + params.salt + cfg.baiduSecret);
    }
    await baiduQpsWait();
    const init = { method: 'POST' };
    if (llm) {
      init.headers = { 'Content-Type': 'application/json' };
      if (useBearer) init.headers['Authorization'] = 'Bearer ' + cfg.baiduApiKey;
      init.body = JSON.stringify(params);
    } else {
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = new URLSearchParams(params).toString();
    }
    const resp = await fetchJSON(llm ? BAIDU_LLM_URL : BAIDU_VIP_URL, init, llm ? 25000 : 15000);
    if (!resp.ok) throw new Error('百度翻译接口 HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error_code) {
      const err = new Error(baiduErrorText(String(data.error_code), data.error_msg));
      err.code = String(data.error_code);
      throw err;
    }
    const dst = Array.isArray(data.trans_result) ? data.trans_result.map(r => (r && r.dst) || '') : [];
    if (dst.length === lines.length) { translations.push(...dst); continue; }
    // 行数错位（空段/特殊字符导致）：逐条重译兜底
    for (const line of lines) {
      try {
        const one = await baiduRequest([line], sourceLang, targetLang, cfg, llm);
        translations.push(one[0] || '');
      } catch (e) { translations.push(''); }
    }
  }
  return translations;
}

// 限频/系统错误自动退避重试（54003/59004 QPS、54005 长 query、52001/52002 系统错误）
const BAIDU_RETRY_CODES = new Set(['52001', '52002', '54003', '54005', '59004']);
async function baiduTranslate(texts, sourceLang, targetLang, cfg, llm) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await baiduRequest(texts, sourceLang, targetLang, cfg, llm);
    } catch (e) {
      lastErr = e;
      if (!e.code || !BAIDU_RETRY_CODES.has(e.code) || attempt === 2) throw e;
      await new Promise(r => setTimeout(r, e.code === '54005' ? 3100 : 1300));
    }
  }
  throw lastErr;
}

async function translateWithBaidu(texts, sourceLang, targetLang, cfg) {
  return baiduTranslate(texts, sourceLang, targetLang, cfg, false);
}

async function translateWithBaiduLlm(texts, sourceLang, targetLang, cfg) {
  return baiduTranslate(texts, sourceLang, targetLang, cfg, true);
}

// 百度凭证是否够用：通用版需 AppID+密钥；大模型可 AppID+密钥 或 AppID+API Key
function baiduCredsOk(cfg, llm) {
  if (!cfg.baiduAppid) return false;
  return llm ? !!(cfg.baiduApiKey || cfg.baiduSecret) : !!cfg.baiduSecret;
}

async function translateWithGoogle(texts, sourceLang, targetLang) {
  const sl = mapGoogleLang(sourceLang), tl = mapGoogleLang(targetLang);
  const joined = texts.join('\n');
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(joined);
  const resp = await fetchJSON(url, {}, 20000);
  if (!resp.ok) throw new Error('Google 翻译接口 HTTP ' + resp.status);
  const data = await resp.json();
  const full = (Array.isArray(data?.[0]) ? data[0] : []).map(seg => (Array.isArray(seg) && seg[0]) ? seg[0] : '').join('');
  const lines = full.split('\n');
  if (lines.length === texts.length) return lines;
  // 换行被合并时逐条兜底
  const out = [];
  for (const text of texts) {
    const oneUrl = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(text);
    const oneResp = await fetchJSON(oneUrl, {}, 20000);
    if (!oneResp.ok) { out.push(''); continue; }
    const oneData = await oneResp.json();
    out.push((Array.isArray(oneData?.[0]) ? oneData[0] : []).map(seg => (Array.isArray(seg) && seg[0]) ? seg[0] : '').join(''));
    await new Promise(r => setTimeout(r, 60)); // 避免瞬时请求过多
  }
  return out;
}

// Microsoft Edge 内置翻译接口（与 Edge 浏览器同源，海外/国内均可访问）
async function translateWithMicrosoft(texts, sourceLang, targetLang) {
  const from = mapMicrosoftLang(sourceLang), to = mapMicrosoftLang(targetLang) || 'en';
  const authResp = await fetchJSON('https://edge.microsoft.com/translate/auth', { method: 'GET' }, 15000);
  if (!authResp.ok) throw new Error('Microsoft 翻译鉴权失败 HTTP ' + authResp.status);
  const authToken = (await authResp.text()).trim();
  if (!authToken) throw new Error('Microsoft 翻译鉴权失败');
  const baseUrl = 'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0' + (from ? '&from=' + from : '') + '&to=' + to;
  const resp = await fetchJSON(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': authToken,
      'Or-Referer': 'https://cn.bing.com'
    },
    body: JSON.stringify(texts.map(t => ({ Text: t })))
  }, 30000);
  if (!resp.ok) throw new Error('Microsoft 翻译接口 HTTP ' + resp.status);
  const data = await resp.json();
  if (!Array.isArray(data)) throw new Error('Microsoft 翻译接口返回异常');
  return data.map(item => item?.translations?.[0]?.text || '');
}

// 免费引擎链：自动模式先 Google 后 Microsoft，任一失败自动切换下一个
async function translateFree(texts, sourceLang, targetLang, engine) {
  const order = engine === 'google' ? ['google'] : engine === 'microsoft' ? ['microsoft'] : ['google', 'microsoft'];
  let lastErr = null;
  for (const e of order) {
    try {
      return await (e === 'google' ? translateWithGoogle(texts, sourceLang, targetLang) : translateWithMicrosoft(texts, sourceLang, targetLang));
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('免费翻译接口不可用');
}

function parseNumberedTranslations(content, n) {
  if (!content) return [];
  const cleaned = content.replace(/```(?:json)?\s*/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(cleaned.substring(start, end + 1));
      const out = [];
      for (let i = 0; i < n; i++) {
        const v = obj[String(i + 1)] ?? obj[i + 1];
        out.push(typeof v === 'string' ? v.trim() : '');
      }
      if (out.some(s => s)) return out;
    } catch (e) { /* 落入行解析兜底 */ }
  }
  // 兜底1：逐行解析 "1. 译文" 前缀
  const out = new Array(n).fill('');
  let idx = 0;
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim().replace(/^[-*>\s]+/, '');
    if (!line) continue;
    const m = line.match(/^(\d+)\s*(?:\.\s+|、\s*|\)\s*|[:：]\s*)(.*)$/);
    const body = m ? m[2].trim() : line;
    if (!body) continue;
    const num = m ? (parseInt(m[1], 10) - 1) : idx;
    if (num >= 0 && num < n) out[num] = body;
    idx++;
  }
  if (out.some(s => s)) return out;
  // 兜底2：按行顺序 1:1 映射
  const plain = cleaned.split('\n').map(s => s.replace(/^\d+[.、)\]]*\s*/, '').trim()).filter(Boolean);
  return plain.length ? plain : [];
}

async function translateWithAI(texts, sourceLang, targetLang, cfg) {
  const targetName = targetLang === 'zh-CN' || targetLang === 'zh' ? '简体中文' : (targetLang === 'en' ? '英文' : targetLang);
  const numbered = texts.map((t, i) => (i + 1) + '. ' + t).join('\n');
  const prompt = [
    '你是一个专业的网页翻译引擎。请把下面的 ' + texts.length + ' 段文本翻译成' + targetName + '。',
    '要求：每段独立翻译，语义准确、表达自然地道，符合母语阅读习惯；代码、函数名、变量名、命令名、URL、邮箱、数字、符号保持原样，一律不翻译；不要添加任何解释、注释、前后缀、原文或引号。',
    '严格按 JSON 返回，不要输出其他内容：{"1":"译文1","2":"译文2",...}，键为段落编号 1..' + texts.length + '。',
    '',
    '待翻译文本：',
    numbered
  ].join('\n');
  const baseUrl = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const response = await fetchJSON(`${baseUrl}${chatApiPath(cfg.provider)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: cfg.model || 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 4096, temperature: 0.3 }) }, 45000);
  if (!response.ok) throw new Error(`API ${response.status}`);
  const result = await response.json();
  return parseNumberedTranslations(result?.choices?.[0]?.message?.content || '', texts.length);
}

async function handleTranslateBatch(message, sender, sendResponse) {
  const { texts, sourceLang, targetLang } = message.payload || {};
  if (!texts || !texts.length) { sendResponse({ success: true, translations: [] }); return; }
  try {
    const cfg = await getTranslatorAPIConfig();
    let translations;
    if (cfg.engine === 'ai') {
      if (!cfg.apiKey) { sendResponse({ success: false, error: 'AI 翻译引擎需要 API Key，可在设置中切换为免费引擎' }); return; }
      try {
        translations = await translateWithAI(texts, sourceLang, targetLang, cfg);
      } catch (e) {
        // AI 引擎失败自动降级免费引擎
        translations = await translateFree(texts, sourceLang, targetLang, 'auto');
      }
    } else if (cfg.engine === 'baidu' || cfg.engine === 'baiduLlm') {
      const llm = cfg.engine === 'baiduLlm';
      if (!baiduCredsOk(cfg, llm)) {
        sendResponse({ success: false, error: '百度翻译未配置 AppID/密钥，请在设置 → 网页翻译中填写，或切换为免费引擎' });
        return;
      }
      try {
        translations = await (llm ? translateWithBaiduLlm : translateWithBaidu)(texts, sourceLang, targetLang, cfg);
      } catch (e) {
        // 百度引擎失败自动降级免费引擎
        translations = await translateFree(texts, sourceLang, targetLang, 'auto');
      }
    } else {
      translations = null;
      // 自动模式：配置过百度凭证时优先百度（配了 API Key 优先大模型），失败再走免费链
      if (cfg.engine === 'auto' && baiduCredsOk(cfg, !!cfg.baiduApiKey)) {
        try {
          translations = await (cfg.baiduApiKey ? translateWithBaiduLlm : translateWithBaidu)(texts, sourceLang, targetLang, cfg);
        } catch (e) { translations = null; }
      }
      if (!translations) translations = await translateFree(texts, sourceLang, targetLang, cfg.engine);
    }
    while (translations.length < texts.length) translations.push('');
    sendResponse({ success: true, translations: translations.slice(0, texts.length) });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTranslateSelection(message, sender, sendResponse) {
  const { text, targetLang } = message.payload || {};
  if (!text) { sendResponse({ success: true, translation: '' }); return; }
  try {
    const cfg = await getTranslatorAPIConfig();
    let translation = '';
    if (cfg.engine === 'ai') {
      if (!cfg.apiKey) throw new Error('AI 翻译引擎需要 API Key');
      try {
        const result = await translateWithAI([text], 'auto', targetLang, cfg);
        translation = result[0] || '';
      } catch (e) {
        const result = await translateFree([text], 'auto', targetLang, 'auto');
        translation = result[0] || '';
      }
    } else if (cfg.engine === 'baidu' || cfg.engine === 'baiduLlm') {
      const llm = cfg.engine === 'baiduLlm';
      if (!baiduCredsOk(cfg, llm)) throw new Error('百度翻译未配置 AppID/密钥，请前往设置 → 网页翻译填写');
      const result = await (llm ? translateWithBaiduLlm : translateWithBaidu)([text], 'auto', targetLang, cfg);
      translation = result[0] || '';
    } else {
      let result = null;
      if (cfg.engine === 'auto' && baiduCredsOk(cfg, !!cfg.baiduApiKey)) {
        try {
          result = await (cfg.baiduApiKey ? translateWithBaiduLlm : translateWithBaidu)([text], 'auto', targetLang, cfg);
        } catch (e) { result = null; }
      }
      if (!result) result = await translateFree([text], 'auto', targetLang, cfg.engine);
      translation = result[0] || '';
    }
    sendResponse({ success: true, translation });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// 设置页"测试翻译引擎"：用未保存的凭证直接调百度接口（复用与正式翻译完全相同的代码路径）
async function handleTranslateEngineTest(message, sender, sendResponse) {
  const { engine, config } = message.payload || {};
  try {
    const llm = engine === 'baiduLlm';
    if (engine !== 'baidu' && engine !== 'baiduLlm') throw new Error('该引擎无需凭证测试');
    if (!baiduCredsOk(config || {}, llm)) throw new Error(llm ? '请填写 AppID 和密钥（或 API Key）' : '请填写 AppID 和密钥');
    const result = await baiduTranslate(['Hello, world! This is a connection test.'], 'en', 'zh-CN', config || {}, llm);
    sendResponse({ success: true, text: result[0] || '' });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleSaveAsPdf(sender, sendResponse) {
  let tabId = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length || !tabs[0].id) { sendResponse({ success: false }); return; }
    tabId = tabs[0].id;
    await chrome.debugger.attach({ tabId }, '1.3');
    const result = await chrome.debugger.sendCommand({ tabId }, 'Page.printToPDF', { printBackground: true });
    await chrome.debugger.detach({ tabId });
    const safeName = (tabs[0].title||'page').replace(/[\\/:*?"<>|]/g,'_').substring(0, 80);
    await chrome.downloads.download({ url: `data:application/pdf;base64,${result.data}`, filename: `${safeName}.pdf`, saveAs: true });
    sendResponse({ success: true });
  } catch (error) { if (tabId) await chrome.debugger.detach({ tabId }).catch(()=>{}); sendResponse({ success: false, error: error.message }); }
}
async function handleVideoSummary(sender, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length || !tabs[0].id) { sendResponse({ success: false }); return; }
    const tabId = tabs[0].id;
    let subtitleData;
    try { subtitleData = await chrome.tabs.sendMessage(tabId, { type: 'GET_VIDEO_SUBTITLES' }); } catch (e) { sendResponse({ success: false }); return; }
    if (!subtitleData || subtitleData.error || !subtitleData.fullText || subtitleData.fullText.trim().length < 10) { sendResponse({ success: false }); return; }
    const config = await getAPIConfig();
    if (!config.apiKey) { sendResponse({ success: false }); return; }
    callAIStream([{ role: 'user', content: `视频标题：${subtitleData.title||tabs[0].title}\n字幕：\n${subtitleData.fullText.substring(0, 8000)}` }], '生成中文摘要：概要(1-2句) + 关键要点(3-5个) + 总结(1句)', config, false, tabId).catch(()=>{});
    sendResponse({ success: true, streaming: true });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

// ============================================================
// 旧知识库操作（兼容旧调用）
// ============================================================
function handleKBSavePage(message, sender, sendResponse) { dbAddRecord('kb_pages', { url: message.payload.url, title: message.payload.title, content: message.payload.content, timestamp: Date.now(), type: 'page' }).then(id => sendResponse({ success: true, id })).catch(e => sendResponse({ success: false, error: e.message })); }
function handleKBSaveChat(message, sender, sendResponse) { dbAddRecord('kb_chats', { pageUrl: message.payload.pageUrl, pageTitle: message.payload.pageTitle, messages: message.payload.messages, timestamp: Date.now(), type: 'chat' }).then(id => sendResponse({ success: true, id })).catch(e => sendResponse({ success: false, error: e.message })); }
function handleKBSearch(message, sender, sendResponse) { const { query, limit } = message.payload; Promise.all([dbSearchStore('kb_pages',query,limit||10), dbSearchStore('kb_chats',query,limit||10), dbSearchStore('kb_files',query,limit||10)]).then(([pages,chats,files]) => sendResponse({ success:true, data:{pages,chats,files} })).catch(e => sendResponse({ success:false, error:e.message })); }
function handleKBGetAll(message, sender, sendResponse) { dbGetAll(message.payload.store||'kb_pages', message.payload.limit||50, message.payload.offset||0).then(r => sendResponse({ success:true, data:r })).catch(e => sendResponse({ success:false, error:e.message })); }
function handleKBDelete(message, sender, sendResponse) { dbDeleteRecord(message.payload.store, message.payload.id).then(() => sendResponse({ success:true })).catch(e => sendResponse({ success:false, error:e.message })); }
function handleKBClear(message, sender, sendResponse) { const stores = message.payload.store ? [message.payload.store] : ['kb_pages', 'kb_chats', 'kb_files']; Promise.all(stores.map(s=>dbClearStore(s))).then(()=>sendResponse({success:true})).catch(e=>sendResponse({success:false,error:e.message})); }
function handleKBStats(sendResponse) { Promise.all([dbCount('kb_pages'),dbCount('kb_chats'),dbCount('kb_files')]).then(([pages,chats,files])=>sendResponse({success:true,data:{pages,chats,files,total:pages+chats+files}})).catch(e=>sendResponse({success:false,error:e.message})); }

function dbAddRecord(storeName, record) { return new Promise((resolve, reject) => { const req = indexedDB.open('AIBrowserDB', 2); req.onsuccess = (e) => { const db=e.target.result; try { const tx=db.transaction(storeName,'readwrite'); const s=tx.objectStore(storeName); const a=s.add(record); a.onsuccess=()=>{db.close();resolve(a.result);}; a.onerror=()=>{db.close();reject(a.error);}; } catch(er){db.close();reject(er);} }; req.onerror = () => reject(new Error('DB open failed')); }); }
function dbGetAll(storeName, limit, offset) { return new Promise((resolve, reject) => { const req = indexedDB.open('AIBrowserDB', 2); req.onsuccess = (e) => { const db=e.target.result; const results=[]; let skipped=0; try { const cr=db.transaction(storeName,'readonly').objectStore(storeName).openCursor(null,'prev'); cr.onsuccess=(ev)=>{ const c=ev.target.result; if(!c||results.length>=limit){db.close();resolve(results);return;} if(skipped<offset){skipped++;c.continue();return;} results.push(c.value);c.continue();}; } catch(er){db.close();reject(er);} }; req.onerror = () => reject(new Error('DB open failed')); }); }
function dbSearchStore(storeName, query, limit) { return new Promise((resolve, reject) => { const req = indexedDB.open('AIBrowserDB', 2); req.onsuccess = (e) => { const db=e.target.result; const results=[]; try { const cr=db.transaction(storeName,'readonly').objectStore(storeName).openCursor(null,'prev'); const kws=query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g,' ').split(/\s+/).filter(k=>k.length>0).map(k=>k.toLowerCase()); cr.onsuccess=(ev)=>{ const c=ev.target.result; if(!c||results.length>=limit){db.close();resolve(results);return;} const r=c.value; const st=JSON.stringify(r).toLowerCase(); if(kws.some(kw=>st.includes(kw))||kws.length===0){results.push({id:r.id,title:r.title||r.pageTitle||r.name||'',url:r.url||r.pageUrl||'',timestamp:r.timestamp,type:r.type||'unknown',preview:(r.content||r.messages?.[0]?.content||'').substring(0,200)});} c.continue();}; } catch(er){db.close();reject(er);} }; req.onerror = () => reject(new Error('DB open failed')); }); }
function dbDeleteRecord(storeName, id) { return new Promise((resolve, reject) => { const req = indexedDB.open('AIBrowserDB', 2); req.onsuccess = (e) => { const db=e.target.result; try { const d=db.transaction(storeName,'readwrite').objectStore(storeName).delete(id); d.onsuccess=()=>{db.close();resolve();}; d.onerror=()=>{db.close();reject(d.error);}; } catch(er){db.close();reject(er);} }; req.onerror = () => reject(new Error('DB open failed')); }); }
function dbClearStore(storeName) { return new Promise((resolve, reject) => { const req = indexedDB.open('AIBrowserDB', 2); req.onsuccess = (e) => { const db=e.target.result; try { const c=db.transaction(storeName,'readwrite').objectStore(storeName).clear(); c.onsuccess=()=>{db.close();resolve();}; c.onerror=()=>{db.close();reject(c.error);}; } catch(er){db.close();reject(er);} }; req.onerror = () => reject(new Error('DB open failed')); }); }
function dbCount(storeName) { return new Promise((resolve, reject) => { const req = indexedDB.open('AIBrowserDB', 2); req.onsuccess = (e) => { const db=e.target.result; try { const c=db.transaction(storeName,'readonly').objectStore(storeName).count(); c.onsuccess=()=>{db.close();resolve(c.result);}; c.onerror=()=>{db.close();reject(c.error);}; } catch(er){db.close();reject(er);} }; req.onerror = () => reject(new Error('DB open failed')); }); }

// ============================================================
// 广告过滤
// ============================================================
const ADBLOCK_DYNAMIC_RULE_ID_START = 5000;
const RESOURCE_TYPE_MAP = { 'script': 'script', 'image': 'image', 'stylesheet': 'stylesheet', 'xmlhttprequest': 'xmlhttprequest', 'subdocument': 'sub_frame', 'media': 'media', 'font': 'font', 'websocket': 'websocket', 'ping': 'ping', 'main_frame': 'main_frame', 'document': 'main_frame', 'popup': 'main_frame', 'object': 'object', 'csp_report': 'csp_report', 'other': 'other' };
// DNR 不支持的"修改型"规则选项，整体跳过（强行转 block 会误伤内容）
const DNR_UNSUPPORTED_OPTIONS = ['removeparam', 'csp', 'redirect', 'redirect-rule', 'replace', 'elemhide', 'specifichide'];

/**
 * DNR urlFilter 只接受 URL 字符及 | * ^；含非法字符的规则会让整批添加失败。
 * 这里做预校验：非法/正则式/超长模式的规则直接丢弃。
 */
function sanitizeURLFilter(urlFilter) {
  if (!urlFilter || typeof urlFilter !== 'string' || urlFilter.length < 2 || urlFilter.length > 200) return null;
  // ABP 正则规则（/.../ 含 | ( ) [ ] { } \ ? + $ 等元字符）DNR 无法表达 → 丢弃；
  // 纯路径子串（如 /ads/path/）是合法 urlFilter，保留
  if (urlFilter.startsWith('/') && urlFilter.endsWith('/') && urlFilter.length > 3) {
    const body = urlFilter.substring(1, urlFilter.length - 1);
    if (/[|()\[\]{}<>\\?+$]/.test(body)) return null;
  }
  // 非法字符：DNR 校验会拒绝整批
  if (/[\[\]{}<>"\\]|\s/.test(urlFilter)) return null;
  return urlFilter;
}

function compileAdblockRules(ruleText) {
  if (!ruleText || typeof ruleText !== 'string') return { dnrRules: [], cosmeticGlobal: [], cosmeticDomain: {} };
  const lines = ruleText.split('\n'); const dnrRules = []; const cosmeticGlobal = []; const cosmeticDomain = {};
  for (const line of lines) {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[') || trimmed.startsWith('@@') || trimmed.includes('#$#')) continue;
    const parsed = typeof AdblockParser !== 'undefined' ? AdblockParser.parse(trimmed) : null;
    if (parsed && parsed.type === 2) {
      // #@# 例外规则如果是"取消隐藏"语义，绝对不能当隐藏规则用
      if (parsed.exception) continue;
      if (parsed.domains && parsed.domains.length > 0) {
        const exclude = parsed.domains.some(d => d.startsWith('~'));
        if (exclude) continue; // 负域名限定暂不支持，跳过避免误伤
        parsed.domains.forEach(d => { if (!cosmeticDomain[d]) cosmeticDomain[d] = []; cosmeticDomain[d].push(parsed.selector); });
      }
      else { cosmeticGlobal.push(parsed.selector); }
      continue;
    }
    const dnrRule = filterToDNRRule(trimmed);
    if (dnrRule && dnrRules.length < 5000) dnrRules.push(dnrRule);
  }
  return { dnrRules, cosmeticGlobal, cosmeticDomain };
}

/**
 * 编译用户自定义规则（AI 生成或手填）：支持 ## 元素隐藏规则与 || 网络过滤规则，
 * 裸 CSS 选择器（如 .ad-banner）按全局元素隐藏处理。
 */
function compileCustomRuleLines(customRules) {
  const dnrRules = []; const cosmeticGlobal = []; const cosmeticDomain = {};
  if (!Array.isArray(customRules)) return { dnrRules, cosmeticGlobal, cosmeticDomain };
  for (const raw of customRules) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('!') || line.startsWith('[') || line.startsWith('@@') || line.includes('#$#')) continue;
    const parsed = typeof AdblockParser !== 'undefined' ? AdblockParser.parse(line) : null;
    if (parsed && parsed.type === 2) {
      if (parsed.exception) continue;
      if (parsed.domains && parsed.domains.length > 0) {
        if (parsed.domains.some(d => d.startsWith('~'))) continue;
        parsed.domains.forEach(d => { if (!cosmeticDomain[d]) cosmeticDomain[d] = []; cosmeticDomain[d].push(parsed.selector); });
      } else cosmeticGlobal.push(parsed.selector);
      continue;
    }
    // 裸 CSS 选择器（.ad-banner / #ad / [data-ad] / :has(...)）→ 元素隐藏
    if (/^[.#\[:]/.test(line)) {
      cosmeticGlobal.push(line);
      continue;
    }
    const looksNetwork = (/^[\w.-]+(\.[\w.-]+)+\^?$/.test(line)) || line.startsWith('|') || line.includes('^') || /^\/[A-Za-z0-9._]/.test(line);
    if (looksNetwork) {
      const rule = filterToDNRRule(line);
      if (rule) dnrRules.push(rule);
      continue;
    }
  }
  return { dnrRules, cosmeticGlobal, cosmeticDomain };
}
function filterToDNRRule(ruleLine) {
  let pattern = ruleLine; const options = {};
  const dollarIdx = ruleLine.lastIndexOf('$');
  if (dollarIdx >= 0) { pattern = ruleLine.substring(0, dollarIdx); ruleLine.substring(dollarIdx + 1).split(',').forEach(opt => { const t = opt.trim(); if (DNR_UNSUPPORTED_OPTIONS.includes(t)) { options.skip = true; return; } const rt = RESOURCE_TYPE_MAP[t]; if (rt) options.resourceType = rt; else if (t.startsWith('domain=')) { const dl = t.substring(7).split('|'); options.includeDomains = dl.filter(d => !d.startsWith('~')); options.excludeDomains = dl.filter(d => d.startsWith('~')).map(d => d.substring(1)); } else if (t === 'third-party') options.thirdParty = true; else if (t === '~third-party' || t === 'first-party') options.firstParty = true; }); }
  if (options.skip || options.badfilter) return null;
  let urlFilter = pattern;
  if (urlFilter.startsWith('||')) urlFilter = '*://*.' + urlFilter.substring(2);
  else if (urlFilter.startsWith('|')) urlFilter = urlFilter.substring(1);
  else if (/^[a-zA-Z0-9._-]+\^?$/.test(urlFilter) && urlFilter.includes('.')) urlFilter = '*://*.' + urlFilter.replace(/\^?$/, '') + '/*';
  urlFilter = urlFilter.replace(/\^/g, '*');
  urlFilter = sanitizeURLFilter(urlFilter);
  if (!urlFilter) return null;
  const rule = { id: 0, priority: 1, action: { type: 'block' }, condition: { urlFilter } };
  if (options.resourceType) rule.condition.resourceTypes = [options.resourceType];
  if (options.includeDomains && options.includeDomains.length > 0) rule.condition.initiatorDomains = options.includeDomains;
  if (options.excludeDomains && options.excludeDomains.length > 0) rule.condition.excludedInitiatorDomains = options.excludeDomains;
  if (options.thirdParty) rule.condition.domainType = 'thirdParty';
  if (options.firstParty) rule.condition.domainType = 'firstParty';
  return rule;
}
async function updateDNRRules(dnrRules, excludedInitiatorDomains = []) {
  try {
    const rules = dnrRules
      .map((r, i) => {
        const rule = { ...r, id: ADBLOCK_DYNAMIC_RULE_ID_START + i };
        // 白名单域名写入 excludedInitiatorDomains：由这些域名发起的请求不被拦截
        if (excludedInitiatorDomains.length > 0) {
          rule.condition.excludedInitiatorDomains = [...new Set([...(rule.condition.excludedInitiatorDomains || []), ...excludedInitiatorDomains])];
        }
        return rule;
      })
      .filter(r => !!sanitizeURLFilter(r.condition?.urlFilter))
      .slice(0, 5000);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) });
    let failed = 0;
    const CHUNK = 500;
    for (let i = 0; i < rules.length; i += CHUNK) {
      const chunk = rules.slice(i, i + CHUNK);
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: chunk });
      } catch (e) {
        // 整批失败时逐条降级：跳过单条无效规则，避免一个坏规则拖垮全部广告屏蔽
        for (const rule of chunk) {
          try { await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] }); }
          catch (e2) { failed++; }
        }
      }
    }
    await chrome.storage.local.set({ adblock_dnr_meta: { ruleCount: rules.length - failed, failedCount: failed, updatedAt: Date.now() } });
    if (failed > 0) console.warn('[无极 SW] 广告规则: 跳过 ' + failed + ' 条无效规则, 生效 ' + (rules.length - failed) + ' 条');
    return { success: true, ruleCount: rules.length - failed, failedCount: failed };
  } catch (error) { return { success: false, error: error.message }; }
}
async function fetchFilterList(url) { try { const resp = await fetchJSON(url, { cache: 'no-cache' }, 30000); if (!resp.ok) throw new Error(`HTTP ${resp.status}`); return await resp.text(); } catch (e) { return null; } }
async function initAdblockRules() {
  const config = await getAdblockConfig(); if (!config.enabled) return;
  let filterLists;
  if (config.filterLists && config.filterLists.length > 0) filterLists = config.filterLists;
  else { try { const resp = await fetch(chrome.runtime.getURL('libs/adblock/adblock-filter-lists.json')); const data = await resp.json(); filterLists = (data.lists || []).filter(l => l.enabled); } catch (e) { filterLists = []; } }
  let allDNR = []; let allCosmeticGlobal = []; let allCosmeticDomain = {};
  for (const list of filterLists) { if (!list.enabled) continue; const text = await fetchFilterList(list.url); if (!text) continue; const compiled = compileAdblockRules(text); allDNR = allDNR.concat(compiled.dnrRules); compiled.cosmeticGlobal.forEach(s => allCosmeticGlobal.push(s)); for (const [domain, selectors] of Object.entries(compiled.cosmeticDomain)) { if (!allCosmeticDomain[domain]) allCosmeticDomain[domain] = []; allCosmeticDomain[domain] = allCosmeticDomain[domain].concat(selectors); } }
  // 用户自定义规则（AI 生成 / 手填）一并生效
  const custom = compileCustomRuleLines(config.customRules);
  allDNR = allDNR.concat(custom.dnrRules);
  custom.cosmeticGlobal.forEach(s => allCosmeticGlobal.push(s));
  for (const [domain, selectors] of Object.entries(custom.cosmeticDomain)) { if (!allCosmeticDomain[domain]) allCosmeticDomain[domain] = []; allCosmeticDomain[domain] = allCosmeticDomain[domain].concat(selectors); }
  allCosmeticGlobal = [...new Set(allCosmeticGlobal)]; for (const d of Object.keys(allCosmeticDomain)) allCosmeticDomain[d] = [...new Set(allCosmeticDomain[d])];
  const whitelist = await getWhitelistItems();
  const dnrResult = await updateDNRRules(allDNR, whitelist.map(i => i.domain));
  await chrome.storage.local.set({ adblock_cosmetic_rules: { global: allCosmeticGlobal, domain: allCosmeticDomain } });
  const tabs = await chrome.tabs.query({}); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_UPDATE_COSMETIC', rules: { global: allCosmeticGlobal, domain: allCosmeticDomain } }).catch(() => {}); });
  chrome.alarms.create('adblock-update', { periodInMinutes: 1440 });
}
async function getAdblockConfig() { const r = await chrome.storage.sync.get('adblockConfig'); return r.adblockConfig || { enabled: true, customRules: [], filterLists: null }; }
async function saveAdblockConfig(config) { await chrome.storage.sync.set({ adblockConfig: config }); }

async function handleAdblockToggle(message, sender, sendResponse) { try { const config = await getAdblockConfig(); if (typeof message.enabled === 'boolean') config.enabled = message.enabled; await saveAdblockConfig(config); const tabs = await chrome.tabs.query({}); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_TOGGLE', enabled: config.enabled }).catch(() => {}); }); if (!config.enabled) { const existing = await chrome.declarativeNetRequest.getDynamicRules(); if (existing.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) }); } else { initAdblockRules().catch(e => console.error('[无极 SW] 广告过滤重载失败:', e)); } sendResponse({ success: true, config }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockUpdateRules(message, sender, sendResponse) { try { const cosmeticRules = await chrome.storage.local.get('adblock_cosmetic_rules'); if (cosmeticRules.adblock_cosmetic_rules) { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_UPDATE_COSMETIC', rules: cosmeticRules.adblock_cosmetic_rules }).catch(() => {}); }); } sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockGetStats(message, sender, sendResponse) { try { const config = await getAdblockConfig(); const meta = await chrome.storage.local.get('adblock_dnr_meta'); const cosmeticRules = await chrome.storage.local.get('adblock_cosmetic_rules'); let cg = 0, cd = 0; if (cosmeticRules.adblock_cosmetic_rules) { cg = (cosmeticRules.adblock_cosmetic_rules.global || []).length; cd = Object.values(cosmeticRules.adblock_cosmetic_rules.domain || {}).flat().length; } sendResponse({ success: true, stats: { enabled: config.enabled, dnrRuleCount: meta.adblock_dnr_meta?.ruleCount || 0, cosmeticGlobalCount: cg, cosmeticDomainCount: cd, customRuleCount: (config.customRules || []).length, updatedAt: meta.adblock_dnr_meta?.updatedAt || null } }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockGetLists(message, sender, sendResponse) { try { const config = await getAdblockConfig(); if (config.filterLists && config.filterLists.length > 0) sendResponse({ success: true, lists: config.filterLists }); else { try { const resp = await fetch(chrome.runtime.getURL('libs/adblock/adblock-filter-lists.json')); const data = await resp.json(); sendResponse({ success: true, lists: data.lists || [] }); } catch (e) { sendResponse({ success: true, lists: [] }); } } } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockSaveLists(message, sender, sendResponse) { try { const config = await getAdblockConfig(); config.filterLists = message.lists; await saveAdblockConfig(config); sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockClearRules(message, sender, sendResponse) { try { const existing = await chrome.declarativeNetRequest.getDynamicRules(); if (existing.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) }); await chrome.storage.local.remove('adblock_dnr_meta'); await chrome.storage.local.remove('adblock_cosmetic_rules'); const tabs = await chrome.tabs.query({}); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_UPDATE_COSMETIC', rules: { global: [], domain: {} } }).catch(() => {}); }); sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockClearCustom(message, sender, sendResponse) { try { const config = await getAdblockConfig(); config.customRules = []; await saveAdblockConfig(config); initAdblockRules().catch(e => console.error('[无极 SW] 清空自定义规则后重建失败:', e)); sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockWhitelistAdd(message, sender, sendResponse) {
  try {
    const domain = message.domain;
    if (!domain) { sendResponse({ success: false, error: '缺少域名' }); return; }
    const items = await getWhitelistItems();
    if (!items.some(i => i.domain === domain)) {
      items.push({ domain, name: domain });
      await saveWhitelistItems(items);
      broadcastWhitelist({ items });
      // 白名单变更必须重建 DNR，否则网络请求仍被拦截（白名单对 DNR 无效的根因）
      initAdblockRules().catch(e => console.error('[无极 SW] 白名单后重建广告规则失败:', e));
    }
    sendResponse({ success: true, summary: `已将 ${domain} 加入广告过滤白名单` });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleAdblockWhitelistToggle(message, sender, sendResponse) {
  try {
    const domain = message.domain;
    if (!domain) { sendResponse({ success: false, error: '缺少域名' }); return; }
    const items = await getWhitelistItems();
    const idx = items.findIndex(i => i.domain === domain);
    let added = false;
    if (idx >= 0) { items.splice(idx, 1); }
    else { items.push({ domain, name: domain }); added = true; }
    await saveWhitelistItems(items);
    broadcastWhitelist({ items });
    initAdblockRules().catch(e => console.error('[无极 SW] 白名单切换后重建广告规则失败:', e));
    sendResponse({ success: true, added, summary: added ? `已暂停屏蔽 ${domain} 的广告` : `已恢复屏蔽 ${domain} 的广告` });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleAdblockWhitelistAddNamed(message, sender, sendResponse) {
  try {
    const { domain, name } = message;
    if (!domain) { sendResponse({ success: false, error: '缺少域名' }); return; }
    const items = await getWhitelistItems();
    if (items.some(i => i.domain === domain)) {
      sendResponse({ success: false, error: '该域名已在白名单中' });
      return;
    }
    items.push({ domain, name: name || domain });
    await saveWhitelistItems(items);
    broadcastWhitelist({ items });
    initAdblockRules().catch(e => console.error('[无极 SW] 白名单添加后重建广告规则失败:', e));
    sendResponse({ success: true, summary: `已添加 ${name || domain} 到白名单` });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleAdblockWhitelistList(message, sender, sendResponse) {
  try {
    const items = await getWhitelistItems();
    sendResponse({ success: true, items });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleAdblockWhitelistRemove(message, sender, sendResponse) {
  try {
    const domain = message.domain;
    const items = await getWhitelistItems();
    const filtered = items.filter(i => i.domain !== domain);
    await saveWhitelistItems(filtered);
    broadcastWhitelist({ items: filtered });
    initAdblockRules().catch(e => console.error('[无极 SW] 白名单移除后重建广告规则失败:', e));
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleAdblockWhitelistClear(message, sender, sendResponse) {
  try {
    await saveWhitelistItems([]);
    broadcastWhitelist({ items: [] });
    initAdblockRules().catch(e => console.error('[无极 SW] 白名单清空后重建广告规则失败:', e));
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

function broadcastWhitelist(wl) {
  const domains = (wl.items || []).map(i => i.domain);
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_WHITELIST_UPDATE', domains }).catch(() => {});
    });
  });
}

async function getWhitelistItems() {
  const r = await chrome.storage.local.get('adblock_whitelist');
  const raw = r.adblock_whitelist;
  if (!raw) return [];
  // 新格式 { items: [{domain, name}] }
  if (raw.items && Array.isArray(raw.items)) return raw.items;
  // 旧格式 { domains: ['youtube.com'] } → 迁移
  if (raw.domains && Array.isArray(raw.domains)) {
    const items = raw.domains.map(d => ({ domain: d, name: d }));
    await chrome.storage.local.set({ adblock_whitelist: { items } });
    return items;
  }
  return [];
}

async function saveWhitelistItems(items) {
  await chrome.storage.local.set({ adblock_whitelist: { items } });
}
async function handleAdblockFetchRules(message, sender, sendResponse) {
  try { const config = await getAPIConfig(); if (!config.apiKey) { sendResponse({ success: false, error: '请先配置 API Key' }); return; } const baseUrl = config.baseUrl.replace(/\/+$/, ''); const response = await fetchJSON(`${baseUrl}${chatApiPath(config.provider)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '你是广告过滤规则专家。生成 CSS 选择器规则用于广告屏蔽。返回 JSON 数组：[{"selector":"选择器","note":"说明"}]。不超过20条。' }], max_tokens: 4096, temperature: 0.5 }) }, 45000); if (!response.ok) { sendResponse({ success: false, error: `API ${response.status}` }); return; } const result = await response.json(); const content = result?.choices?.[0]?.message?.content || ''; let rules = []; try { const m = content.match(/\[[\s\S]*\]/); if (m) rules = JSON.parse(m[0]); } catch (e) {} const validRules = (rules || []).filter(r => r.selector && r.selector.length > 3).map(r => ({ selector: r.selector, note: r.note || 'AI 生成' })); if (validRules.length > 0) { const storageResult = await chrome.storage.sync.get('adblockConfig'); const adConfig = storageResult.adblockConfig || {}; const existingSelectors = new Set(adConfig.customRules || []); const newRules = validRules.map(r => r.selector).filter(s => !existingSelectors.has(s)); adConfig.customRules = [...(adConfig.customRules || []), ...newRules]; await chrome.storage.sync.set({ adblockConfig: adConfig }); initAdblockRules().catch(e => console.error('[无极 SW] AI 规则保存后重建失败:', e)); sendResponse({ success: true, rules: validRules, newCount: newRules.length }); } else { sendResponse({ success: false, error: 'AI 未返回有效规则' }); } } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// ============================================================
// KB V2 处理器实现
// ============================================================
async function handleKBV2Save(message, sender, sendResponse) {
  try {
    const data = message.payload;
    const id = await KBItem.save({ url: data.url, title: data.title, content: data.content, source_type: data.source_type || 'page', metadata: data.metadata || {} });
    if (data.auto_tag !== false) { try { await KBAutoTagger.autoTag(id); } catch(e) {} }
    sendResponse({ success: true, id });
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}
async function handleKBV2Search(message, sender, sendResponse) {
  try {
    const results = await KBIndex.search(message.payload.query, message.payload.limit || 20);
    // 无结果时给出模糊搜索建议（"您是不是要找…"，WASM 编辑距离驱动）
    let suggestions = [];
    if (results.length === 0 && typeof KBIndex.suggest === 'function') {
      try { suggestions = await KBIndex.suggest(message.payload.query, 3); } catch (e) { /* 建议失败不影响主结果 */ }
    }
    sendResponse({ success: true, data: results, suggestions, total: results.length });
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}
async function handleKBV2GetAll(message, sender, sendResponse) {
  try {
    const items = await KBItem.getAll(message.payload?.limit || 50, message.payload?.offset || 0);
    const enriched = await Promise.all(items.map(async item => { const tags = await KBTag.getItemTags(item.id); return { ...item, tags }; }));
    sendResponse({ success: true, data: enriched });
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}
async function handleKBV2GetItem(message, sender, sendResponse) {
  try { const item = await KBItem.get(message.payload.id); if (!item) { sendResponse({ success: false, error: '条目不存在' }); return; } const tags = await KBTag.getItemTags(item.id); const blocks = await KBBlock.getByItem(item.id); const highlights = await KBHighlight.getByItem(item.id); const notes = await KBPageNote.getByItem(item.id); sendResponse({ success: true, data: { ...item, tags, blocks, highlights, notes } }); }
  catch(e) { sendResponse({ success: false, error: e.message }); }
}
async function handleKBV2Delete(message, sender, sendResponse) { try { await KBIndex.removeFromIndex(message.payload.id); await KBItem.delete(message.payload.id); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2ToggleFavorite(message, sender, sendResponse) { try { const item = await KBItem.toggleFavorite(message.payload.id); sendResponse({ success: true, data: item }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2Stats(message, sender, sendResponse) {
  try {
    const stats = await KBItem.getStats();
    const tagCount = await _dbCount('kb_tags');
    const convCount = await _dbCount('kb_ai_conversations');
    sendResponse({ success: true, data: { ...stats, tags: tagCount, conversations: convCount } });
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}
async function handleKBV2TagList(message, sender, sendResponse) { try { const tags = await KBTag.getAll(); sendResponse({ success: true, data: tags }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2TagCreate(message, sender, sendResponse) { try { const tagId = await KBTag.create(message.payload.name, message.payload.color); sendResponse({ success: true, id: tagId }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2TagLink(message, sender, sendResponse) { try { await KBTag.linkItem(message.payload.item_id, message.payload.tag_id, message.payload.source || 'manual'); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2TagUnlink(message, sender, sendResponse) { try { await KBTag.unlinkItem(message.payload.item_id, message.payload.tag_id); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2ItemTags(message, sender, sendResponse) { try { const tags = await KBTag.getItemTags(message.payload.item_id); sendResponse({ success: true, data: tags }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2TagDelete(message, sender, sendResponse) { try { await KBTag.delete(message.payload.id); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2HighlightCreate(message, sender, sendResponse) { try { const id = await KBHighlight.create(message.payload); sendResponse({ success: true, id }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2HighlightList(message, sender, sendResponse) { try { const highlights = await KBHighlight.getByItem(message.payload.item_id); sendResponse({ success: true, data: highlights }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2HighlightDelete(message, sender, sendResponse) { try { await KBHighlight.delete(message.payload.id); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2NoteCreate(message, sender, sendResponse) { try { const id = await KBPageNote.create(message.payload); sendResponse({ success: true, id }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2NoteList(message, sender, sendResponse) { try { const notes = await KBPageNote.getByItem(message.payload.item_id); sendResponse({ success: true, data: notes }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2NoteDelete(message, sender, sendResponse) { try { await KBPageNote.delete(message.payload.id); sendResponse({ success: true }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2Graph(message, sender, sendResponse) { try { const graph = await KBGraph.buildGraph(); sendResponse({ success: true, data: graph }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2Related(message, sender, sendResponse) { try { const related = await KBGraph.getRelated(message.payload.item_id, message.payload.limit || 5); sendResponse({ success: true, data: related }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2AnalyzeItem(message, sender, sendResponse) { try { const analysis = await KBAnalysis.analyzeItem(message.payload.item_id); sendResponse({ success: true, data: analysis }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2AgentChat(message, sender, sendResponse) {
  try {
    const { messages, mode, top_k, current_item_id } = message.payload;
    sendResponse({ success: true, streaming: true });
    const tabId = sender.tab?.id;
    // onToolEvent 预留扩展点：当前工具状态已通过 onDelta 的 "> 🔧" 文本
    // 在流式气泡内显示（顺序正确）。如需独立 TOOL_RESULT 气泡，可在此转发，
    // 但需注意会打断流式气泡顺序，故暂不启用。
    KBAgent.executeStream({ messages, mode: mode || 'chat', top_k: top_k || 5, current_item_id },
      (delta) => { if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AGENT_STREAM_DELTA', delta }).catch(() => {}); },
      (result) => { if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AGENT_STREAM_DONE', message: result.message, citations: result.citations, tool_events: result.tool_events }).catch(() => {}); },
      (error) => { if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AGENT_STREAM_ERROR', error }).catch(() => {}); }
    );
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}
async function handleKBV2Dashboard(message, sender, sendResponse) { try { const dashboard = await KBAnalysis.getDashboard(); sendResponse({ success: true, data: dashboard }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2MemoryRecall(message, sender, sendResponse) { try { const memories = await KBAiMemory.recall(message.payload.query, message.payload.limit || 5); sendResponse({ success: true, data: memories }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2AutoTag(message, sender, sendResponse) { try { const suggestions = await KBAutoTagger.suggestTags(message.payload.item_id); if (message.payload.apply) await KBAutoTagger.autoTag(message.payload.item_id); sendResponse({ success: true, data: suggestions }); } catch(e) { sendResponse({ success: false, error: e.message }); } }
async function handleKBV2AgentPermissions(message, sender, sendResponse) {
  try {
    if (message.payload?.action === 'load') { await AgentPermissions.load(); sendResponse({ success: true, data: AgentPermissions }); }
    else if (message.payload?.action === 'save') { Object.assign(AgentPermissions, message.payload.permissions || {}); await AgentPermissions.save(); sendResponse({ success: true, data: AgentPermissions }); }
    else { sendResponse({ success: true, data: AgentPermissions }); }
  } catch(e) { sendResponse({ success: false, error: e.message }); }
}

// ============================================================
// Console / Debugger 控制台（供 kb-agent 直接调用，全 CDP 权限）
// ============================================================
const _consoleSessions = {};
let _cdpListenersRegistered = false;

async function handleConsoleAttachDirect(tabId) {
  try {
    if (_consoleSessions[tabId]) return { success: true, summary: '已接入', data: { tabId, status: 'attached', logCount: _consoleSessions[tabId].logs.length } };
    await chrome.debugger.attach({ tabId }, '1.3');
    _consoleSessions[tabId] = { logs: [], maxLogs: 200 };
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
    chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `window.__wuji={sel:document.querySelectorAll(sel),ctx(v){console.__wuji_latest=v;return v}};true`
    }).catch(() => {});
    if (!_cdpListenersRegistered) {
      _cdpListenersRegistered = true;
      chrome.debugger.onEvent.addListener(_cdpEventRouter);
      chrome.debugger.onDetach.addListener(function _cdpDetach(tId) { delete _consoleSessions[tId]; });
    }
    return { success: true, summary: '🔓 全 CDP 已接入 (Runtime+DOM+Input+Page+Network+Log)', detail: '可用: console_eval, console_click, console_fill, console_get_html, console_get_logs' };
  } catch (e) { return { success: false, summary: '接入失败: ' + e.message }; }
}

function _cdpEventRouter(source, method, params) {
  const tId = source?.tabId;
  if (!tId || !_consoleSessions[tId]) return;
  if (method === 'Runtime.consoleAPICalled') {
    _consoleSessions[tId].logs.push({
      type: params.type,
      text: (params.args || []).map(a => a.type === 'string' ? a.value : (a.description || '').substring(0, 300)).join(' ').substring(0, 500),
      time: Date.now()
    });
  } else if (method === 'Runtime.exceptionThrown') {
    _consoleSessions[tId].logs.push({
      type: 'exception',
      text: (params.exceptionDetails?.exception?.className || 'Error') + ': ' + (params.exceptionDetails?.text || '').substring(0, 400),
      time: Date.now()
    });
  }
  if (_consoleSessions[tId].logs.length > _consoleSessions[tId].maxLogs) _consoleSessions[tId].logs.shift();
}

async function handleConsoleDetachDirect(tabId) {
  try { delete _consoleSessions[tabId]; await chrome.debugger.detach({ tabId }).catch(() => {}); return { success: true, summary: '已断开' }; }
  catch (e) { return { success: false, summary: '断开失败: ' + e.message }; }
}

async function handleConsoleGetLogsDirect(tabId, filter) {
  const s = _consoleSessions[tabId];
  if (!s) return { success: false, summary: '未接入控制台，请先 console_attach' };
  let logs = s.logs;
  if (filter) { try { const re = new RegExp(filter, 'i'); logs = logs.filter(l => re.test(l.text)); } catch(e) {} }
  const recent = logs.slice(-30);
  return { success: true, summary: '共 ' + logs.length + ' 条日志', detail: recent.map(l => '[' + l.type + '] ' + l.text).join('\n').substring(0, 5000), data: { total: logs.length, recent } };
}

// console_eval 域名白名单：CDP 任意执行 JS 是最高危能力，
// 默认全站拒绝，用户需在设置中显式添加允许的域名（如 www.bilibili.com）
async function isDomainEvalAllowed(tabId) {
  try {
    const r = await chrome.storage.sync.get('agentSecurityConfig');
    const allowlist = (r.agentSecurityConfig?.evalAllowlist || []).map(d => String(d).trim().toLowerCase()).filter(Boolean);
    if (allowlist.length === 0) return { allowed: false, reason: '未启用「允许 AI 操作网页」，请在设置中为该网站授权' };
    const tab = await chrome.tabs.get(tabId);
    let hostname = '';
    try { hostname = new URL(tab.url || tab.pendingUrl || '').hostname.toLowerCase(); } catch (e) { return { allowed: false, reason: '无法识别页面域名' }; }
    if (!hostname) return { allowed: false, reason: '页面域名不可用' };
    const hit = allowlist.some(d => hostname === d || hostname.endsWith('.' + d));
    return hit ? { allowed: true } : { allowed: false, reason: `域名 ${hostname} 未授权网页操作，请在设置中添加` };
  } catch (e) { return { allowed: false, reason: e.message }; }
}

async function handleConsoleEvalDirect(tabId, expression) {
  try {
    const gate = await isDomainEvalAllowed(tabId);
    if (!gate.allowed) return { success: false, summary: gate.reason };
    await handleConsoleAttachDirect(tabId);
    if (expression.length > 800) return { success: false, summary: '表达式过长（>800字符），请拆分' };
    if (/querySelectorAll\s*\(\s*['"]\*['"]/.test(expression)) {
      return { success: false, summary: '禁止遍历全DOM(*)，请用精确选择器' };
    }
    if (/body|documentElement|window\./i.test(expression) && /style|display|visibility|opacity/i.test(expression)) {
      return { success: false, summary: '禁止修改body/html样式，仅改具体元素' };
    }
    const safeExpr = `(function(){try{return (function(){${expression}})();}catch(e){return e.message||'Error';}})()`;
    const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: safeExpr, returnByValue: true, timeout: 5000 });
    if (r.exceptionDetails) {
      const exc = r.exceptionDetails;
      const errMsg = (exc.exception?.description || exc.text || 'Unknown').substring(0, 200);
      const line = exc.lineNumber || '?', col = exc.columnNumber || '?';
      return { success: false, summary: `执行异常(line ${line}:${col}): ${errMsg}` };
    }
    const val = r.result?.value !== undefined ? r.result.value : r.result?.description || '';
    const str = typeof val === 'string' ? val.substring(0, 2000) : JSON.stringify(val).substring(0, 2000);
    return { success: true, summary: '执行完成', detail: str, data: { result: str } };
  } catch (e) { return { success: false, summary: '执行失败: ' + e.message }; }
}

/** 点击页面元素（通过 CDP） */
async function handleConsoleClickDirect(tabId, selector) {
  try {
    if (!_consoleSessions[tabId]) await handleConsoleAttachDirect(tabId);
    // 用 Runtime.callFunctionOn 传参，避免字符串拼接转义问题
    const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(function(sel){var e=document.querySelector(sel);if(!e)return 'NOT_FOUND';e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,text:(e.textContent||'').substring(0,80)});}).apply(null, [${JSON.stringify(selector)}])`,
      returnByValue: true, timeout: 3000
    });
    if (!r.result || r.result.value === 'NOT_FOUND') return { success: false, summary: '未找到元素: ' + selector };
    let pos;
    try { pos = JSON.parse(r.result.value); } catch(e) { return { success: false, summary: '解析元素位置失败: ' + e.message }; }
    if (!pos || !pos.x) return { success: false, summary: '无法获取元素坐标' };
    // 鼠标点击
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    return { success: true, summary: '已点击: ' + selector, detail: '坐标(' + Math.round(pos.x) + ',' + Math.round(pos.y) + '), 文本: ' + (pos.text || '') };
  } catch (e) { return { success: false, summary: '点击失败: ' + e.message }; }
}

/** 填写输入框（通过 CDP） */
async function handleConsoleFillDirect(tabId, selector, value) {
  try {
    if (!_consoleSessions[tabId]) await handleConsoleAttachDirect(tabId);
    const escVal = JSON.stringify(String(value)); // JSON 序列化保证安全转义
    const escSel = JSON.stringify(selector);
    const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(function(sel,val){var e=document.querySelector(sel);if(!e)return 'NOT_FOUND';var desc=Object.getOwnPropertyDescriptor(e.tagName==='INPUT'||e.tagName==='TEXTAREA'?e.constructor.prototype:Object.getPrototypeOf(e),'value');if(desc&&desc.set){desc.set.call(e,val)}else{e.value=val};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.focus();return 'OK:'+e.tagName;}).apply(null,[${escSel},${escVal}])`,
      returnByValue: true, timeout: 3000
    });
    const result = r.result?.value || '';
    if (result === 'NOT_FOUND') return { success: false, summary: '未找到: ' + selector };
    return { success: true, summary: '已填入: ' + selector, detail: '标签:' + result.replace('OK:','') + ', 值: ' + value.substring(0, 100) };
  } catch (e) { return { success: false, summary: '填写失败: ' + e.message }; }
}

/** 获取页面完整 HTML/文本（通过 CDP） */
async function handleConsoleGetHTMLDirect(tabId, selector) {
  try {
    if (!_consoleSessions[tabId]) await handleConsoleAttachDirect(tabId);
    const escSel = JSON.stringify(selector || 'body');
    const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(function(sel){var e=document.querySelector(sel);return e?e.innerText:'NOT_FOUND';}).apply(null,[${escSel}])`,
      returnByValue: true, timeout: 3000
    });
    if (r.result?.value === 'NOT_FOUND') return { success: false, summary: '未找到: ' + (selector || 'body') };
    const text = String(r.result?.value || '').substring(0, 5000);
    return { success: true, summary: '读取完成: ' + (selector || 'body'), detail: text, data: { text } };
  } catch (e) { return { success: false, summary: '读取失败: ' + e.message }; }
}

/** 自适应操作：用 JSON.stringify 传参避免字符串注入 */
async function handleConsoleSmartDirect(tabId, intent, selector) {
  try {
    if (!_consoleSessions[tabId]) await handleConsoleAttachDirect(tabId);
    const escSel = JSON.stringify(selector || 'body');
    const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(function(sel){try{var e=document.querySelector(sel);if(!e)return JSON.stringify({found:false,bodyText:document.body.innerText.substring(0,2000)});return JSON.stringify({found:true,tag:e.tagName,type:e.type||'',text:(e.innerText||'').substring(0,1500),value:e.value||'',placeholder:e.placeholder||'',rect:JSON.parse(JSON.stringify(e.getBoundingClientRect()))});}catch(x){return JSON.stringify({error:x.message})}}).apply(null,[${escSel}])`,
      returnByValue: true, timeout: 5000
    });
    let data;
    try { data = JSON.parse(r.result?.value || '{}'); } catch(e) { return { success: false, summary: '解析失败: ' + e.message }; }
    if (!data.found) return { success: false, summary: '未找到: ' + (selector || '元素'), detail: '页面文本预览: ' + (data.bodyText || '').substring(0, 500) };
    return { success: true, summary: `找到 <${data.tag}>, ${data.text ? '文本:"' + data.text.substring(0,80) + '"' : '无文本'}`, detail: JSON.stringify({tag:data.tag,type:data.type,text:data.text?.substring(0,500),placeholder:data.placeholder}).substring(0,2000), data };
  } catch (e) { return { success: false, summary: '操作失败: ' + e.message }; }
}

// ============================================================
// 启动
// ============================================================
// ============================================================
// 标签页休眠处理器
// ============================================================
async function handleTabSuspendToggle(message, sender, sendResponse) {
  try {
    const settings = await TabSuspender.loadSettings();
    if (typeof message.enabled === 'boolean') settings.enabled = message.enabled;
    await TabSuspender.saveSettings(settings);
    if (settings.enabled) {
      TabSuspender.resetTimerForAllTabs();
    } else {
      // 清除所有定时器
      try { await chrome.alarms.clear('wuji-tab-suspend-check'); } catch(e) {}
    }
    sendResponse({ success: true, settings });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabSuspendNow(message, sender, sendResponse) {
  try {
    if (message.tabId) {
      const tab = await chrome.tabs.get(message.tabId);
      const ok = await TabSuspender.suspendTab(tab, message.forceLevel || 1);
      sendResponse({ success: true, suspended: ok });
    } else {
      // 休眠当前活跃标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const ok = await TabSuspender.suspendTab(tab, message.forceLevel || 1);
        sendResponse({ success: true, suspended: ok });
      } else {
        sendResponse({ success: false, error: '未找到标签页' });
      }
    }
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabUnsuspend(message, sender, sendResponse) {
  try {
    if (message.tabId) {
      const tab = await chrome.tabs.get(message.tabId);
      const ok = await TabSuspender.unsuspendTab(tab);
      sendResponse({ success: true, unsuspended: ok });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const ok = await TabSuspender.unsuspendTab(tab);
        sendResponse({ success: true, unsuspended: ok });
      } else {
        sendResponse({ success: false, error: '未找到标签页' });
      }
    }
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabRestoreCurrent(message, sender, sendResponse) {
  try {
    // 优先用 sender.tab 直接定位（suspended 页面发出的消息自带 sender）
    let tab = sender?.tab;
    if (tab && !TabSuspender.isSuspendedTab(tab)) tab = null;
    if (!tab && message.url) {
      const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('ui/suspended.html') + '*', currentWindow: true });
      for (const t of tabs) {
        if (TabSuspender.getOriginalUrl(t.url) === message.url) { tab = t; break; }
      }
    }
    if (tab) {
      const ok = await TabSuspender.unsuspendTab(tab);
      sendResponse({ success: true, restored: ok });
    } else {
      sendResponse({ success: false, error: '未找到休眠的标签页' });
    }
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabWhitelistAdd(message, sender, sendResponse) {
  try {
    const settings = await TabSuspender.loadSettings();
    const newItem = message.url || message.domain || '';
    if (!newItem) { sendResponse({ success: false, error: '缺少 URL' }); return; }
    if (!settings.whitelist) settings.whitelist = newItem;
    else if (!settings.whitelist.split(/[\s\n]+/).some(item => item === newItem)) {
      settings.whitelist += '\n' + newItem;
    }
    await TabSuspender.saveSettings(settings);
    sendResponse({ success: true, summary: '已加入白名单: ' + newItem });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabSuspendStats(message, sender, sendResponse) {
  try {
    const stats = await TabSuspender.getStats();
    sendResponse({ success: true, stats });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabSuspendGetSettings(message, sender, sendResponse) {
  try {
    const settings = await TabSuspender.loadSettings();
    sendResponse({ success: true, settings });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabSuspendSaveSettings(message, sender, sendResponse) {
  try {
    const settings = message.settings || message.payload;
    if (!settings) { sendResponse({ success: false, error: '缺少设置' }); return; }
    await TabSuspender.saveSettings(settings);
    if (settings.enabled) {
      TabSuspender.resetTimerForAllTabs();
      chrome.alarms.create('wuji-tab-suspend-check', { periodInMinutes: 5 });
    } else {
      try { await chrome.alarms.clear('wuji-tab-suspend-check'); } catch(e) {}
    }
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleTabSuspendFetchIcon(message, sender, sendResponse) {
  try {
    const tabInfo = await TabSuspender.fetchTabInfo(message.url);
    sendResponse({ success: true, favIconUrl: tabInfo?.favIconUrl || null });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// ============================================================
// 标签页事件：管理休眠定时器
// ============================================================
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    // 切换到新标签页时，重置该标签页的定时器
    TabSuspender.resetTimerForTab(tab);
    // 如果开启"聚焦时恢复"，自动恢复已休眠的标签页
    const settings = await TabSuspender.loadSettings();
    if (settings.unsuspendOnFocus && TabSuspender.isSuspendedTab(tab)) {
      TabSuspender.unsuspendTab(tab);
    }
  } catch (e) {}
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (tab.id && TabSuspender.isNormalTab(tab)) {
      TabSuspender.resetTimerForTab(tab);
    }
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    // 标签页加载完成时重置定时器
    if (changeInfo.status === 'complete' && TabSuspender.isNormalTab(tab)) {
      TabSuspender.resetTimerForTab(tab);
    }
    // B 站/YouTube 视频页：自动注入弹幕引擎（播放器按钮），面板 UI 仍按需懒注入
    if (changeInfo.status === 'complete' && tab?.url) {
      try {
        if (DANMAKU_VIDEO_SITES.test(new URL(tab.url).hostname)) ensureDanmakuInjected(tabId).catch(() => {});
      } catch (e) { /* URL 解析失败忽略 */ }
    }
    // 标签页被丢弃(discarded)时，自动恢复
    if (changeInfo.discarded && TabSuspender.isSuspendedTab(tab)) {
      // 如果标签页被 Chrome 丢弃但处于休眠状态，自动恢复
      // 否则会被 Chrome 显示为空白
    }
    // 音频状态变化
    if (changeInfo.hasOwnProperty('audible')) {
      const settings = await TabSuspender.loadSettings();
      if (settings.dontSuspendAudible && !changeInfo.audible) {
        TabSuspender.resetTimerForTab(tab);
      }
    }
    // 固定状态变化
    if (changeInfo.hasOwnProperty('pinned')) {
      const settings = await TabSuspender.loadSettings();
      if (settings.dontSuspendPinned && !changeInfo.pinned) {
        TabSuspender.resetTimerForTab(tab);
      }
    }
  } catch (e) {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  TabSuspender.clearTimerForTabId(tabId);
  danmakuInjectedTabs.delete(tabId);
});

// 闹钟监听：安全网检查
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
      if (alarm.name === 'adblock-update') {
        await initAdblockRules();
      } else if (alarm.name === 'wuji-tab-suspend-check') {
        if (typeof TabSuspender !== 'undefined' && TabSuspender && typeof TabSuspender.runSafetyCheck === 'function') {
          TabSuspender.runSafetyCheck();
        }
      }
    } catch (e) { console.warn('[无极 SW] alarm 任务失败:', alarm?.name, e?.message || e); }
  });
}

// ============================================================
// 弹幕管理姬处理器
// ============================================================
async function handleDanmakuCrawl(message, sender, sendResponse) {
  try {
    const input = (message.bvid || '').trim();
    if (!input) { sendResponse({ success: false, error: '请输入B站视频链接或BV号' }); return; }

    // 从各种格式中提取BV号
    let bvid = null;
    // 精确BV号: BV1xx411c7mD (BV + 10位字母数字)
    const bvMatch = input.match(/BV[a-zA-Z0-9]{10}/);
    if (bvMatch) bvid = bvMatch[0];
    // AV号: av12345 或 aid=12345
    if (!bvid) {
      const avMatch = input.match(/[aA][vV](\d+)/);
      if (avMatch) bvid = input; // AV号直接传原值，后续API用aid参数
    }
    if (!bvid) { sendResponse({ success: false, error: '无法识别BV号，请粘贴完整的B站视频链接' }); return; }

    sendResponse({ success: true, status: 'crawling' });
    try {
      // 读取 SESSDATA cookie 与完整模式配置（优先使用消息传入的值）
      const cookie = message.cookie || (await DanmakuCrawler.getCookie());
      if (message.cookie) await DanmakuCrawler.setCookie(message.cookie);
      const options = {
        cookie,
        useHistory: !!message.useHistory,
        pageIndex: message.pageIndex || 0
      };
      const set = await DanmakuCrawler.crawlDanmaku(bvid, options, (progress) => {
        console.log('[Danmaku]', progress.message);
      });
      await DanmakuCrawler.saveDanmakuSet(set);
      await DanmakuCrawler.setActiveDanmaku(bvid);
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'DANMAKU_LOAD', data: set }).catch(() => {});
      }
    } catch (e) {
      console.error('[Danmaku] crawl error:', e.message);
    }
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuList(message, sender, sendResponse) {
  try {
    const list = await DanmakuCrawler.listDanmakuSets();
    sendResponse({ success: true, data: list });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuDelete(message, sender, sendResponse) {
  try {
    await DanmakuCrawler.deleteDanmakuSet(message.bvid);
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuSetActive(message, sender, sendResponse) {
  try {
    await DanmakuCrawler.setActiveDanmaku(message.bvid);
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuGetActive(message, sender, sendResponse) {
  try {
    const set = await DanmakuCrawler.getActiveDanmaku();
    sendResponse({ success: true, data: set });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuLoadToTab(message, sender, sendResponse) {
  try {
    const bvid = message.bvid;
    const set = await DanmakuCrawler.loadDanmakuSet(bvid);
    if (!set) { sendResponse({ success: false, error: '未找到弹幕数据' }); return; }
    let tabId = message.tabId;
    if (!tabId) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) tabId = tabs[0].id;
    }
    if (tabId) {
      await DanmakuCrawler.setActiveDanmaku(bvid);
      chrome.tabs.sendMessage(tabId, { type: 'DANMAKU_LOAD', data: set }).catch(() => {});
    }
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuUnloadFromTab(message, sender, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'DANMAKU_UNLOAD' }).catch(() => {});
    }
    await DanmakuCrawler.setActiveDanmaku('');
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleDanmakuToggleInTab(message, sender, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'DANMAKU_TOGGLE' }).catch(() => {});
    }
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

// 初始化标签页休眠（importScripts 失败时模块缺失，降级跳过而非击穿 SW）
if (typeof TabSuspender !== 'undefined' && TabSuspender && typeof TabSuspender.init === 'function') {
  TabSuspender.init().catch(() => {});
} else {
  console.warn('[无极 SW] tab-suspender 模块加载失败，标签页休眠功能不可用');
}

// ============================================================
// 启动
// ============================================================
if (typeof initKBEngine === 'function') {
  initKBEngine().then(() => {
    console.log('[无极 SW] 知识库引擎 V2 已就绪');
    try { AgentPermissions.load(); } catch (e) {}
  }).catch(e => console.warn('[无极 SW] 知识库引擎初始化失败:', e?.message || e));
} else {
  console.warn('[无极 SW] kb-core 模块加载失败，知识库功能不可用');
}
console.log('[无极 SW] Service Worker 已启动');