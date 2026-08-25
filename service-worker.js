/**
 * 无极 — Service Worker V5.2
 */

try {
  importScripts(
    'libs/adblock/adblock-parser.js',
    'libs/kb-core.js',
    'libs/kb-agent.js',
    'libs/tab-suspender.js',
    'libs/danmaku-crawler.js'
  );
} catch (e) {
  console.warn('[无极 SW] 模块初始化失败：', e.message);
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
  if (message.type === 'ADBLOCK_FETCH_RULES') { handleAdblockFetchRules(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_TOGGLE') { handleAdblockToggle(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_UPDATE_RULES') { handleAdblockUpdateRules(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_GET_STATS') { handleAdblockGetStats(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_GET_LISTS') { handleAdblockGetLists(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_SAVE_LISTS') { handleAdblockSaveLists(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_CLEAR_RULES') { handleAdblockClearRules(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_CLEAR_CUSTOM') { handleAdblockClearCustom(message, sender, sendResponse); return true; }
  if (message.type === 'ADBLOCK_WHITELIST_ADD') { handleAdblockWhitelistAdd(message, sender, sendResponse); return true; }
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
  if (message.type === 'CONSOLE_EVAL') { handleConsoleEvalDirect(message.tabId || sender.tab?.id, message.expression).then(r => sendResponse(r)); return true; }
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

  return false;
});

// ======== 各个消息处理器 ========
function handlePageContent(message, sender, sendResponse) {
  savePageContentToDB(message.payload).then(() => sendResponse({ success: true })).catch(e => sendResponse({ success: false, error: e.message }));
}
function savePageContentToDB(pageData) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AIBrowserDB', 2);
    request.onsuccess = (event) => {
      const db = event.target.result;
      try {
        const tx = db.transaction('memories', 'readwrite');
        const store = tx.objectStore('memories');
        store.add({ url: pageData.url, title: pageData.title, fullText: pageData.fullText, keyParagraphs: pageData.keyParagraphs || [], timestamp: pageData.timestamp || Date.now(), type: 'page_content' });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
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
// 统一 System Prompt 引擎（无极 V3.3 核心协同层）
// ============================================================
/**
 * 构建统一 System Prompt，让 AI 知晓：
 *   - 自己是"无极 V3.3"插件及其全部能力
 *   - 知识库统计数据（条目/标签/收藏/AI记忆）
 *   - 当前页面上下文
 *   - RAG 检索到的知识库相关条目
 *   - 可调用的工具能力
 */
async function buildUnifiedSystemPrompt(userQuery, pageUrl, pageTitle) {
  // 1. 插件元信息
  let prompt = `你是"无极 V3.3"，一款全能 AI 浏览器助手插件（Chrome 扩展）。
版本: 3.3.0
开发者: 无极
技术栈: Manifest V3 · Shadow DOM · IndexedDB · FTS 倒排索引 · RAG 检索增强

## 🔧 你能调用的工具（动态实时列表）
你可以通过返回 JSON 格式的 {"tool":"工具名","params":{...}} 来调用以下工具：`;
  
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
- **console_smart**: 智能探测元素(返回 tag/type/text/位置) → {"tool":"console_smart","params":{"selector":"#video-page-app"}}

**console_eval 铁律（违反=操作失败）**:
1. expression ≤200字符，只用精确CSS选择器，禁止 querySelectorAll('*')
2. class含特殊字符（如 text.right-2）→ 用 [class*="right-2"] 属性选择器
3. 最简单写法: document.querySelector('.class').innerText='新文字'
4. 返回 null → 用 console_smart 重新探测选择器
5. 不改 body/document 样式，不隐藏/删除容器

**智能路由（严格按照规则）**:
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
            callVisionStream([{ role: 'user', content: imageContent }], '你是无极 V3.3 的视觉模块，请基于图片内容回答问题。', visionConfig, model, tabId).catch(() => {});
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
    const provider = config.provider || '';
    let apiPath = '/v1/chat/completions';
    if (provider === 'zhipu') apiPath = '/v4/chat/completions';
    else if (provider === 'wenxin') apiPath = '/chat/completions';
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, stream: true, max_tokens: 4096 })
    });

    if (!response.ok) { const errText = await response.text(); throw new Error(`API ${response.status}: ${errText.substring(0, 200)}`); }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '', fullText = '';
    const tabId = sender.tab?.id;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.substring(6);
        if (dataStr === '[DONE]') break;
        try {
          const delta = JSON.parse(dataStr)?.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta }).catch(() => {});
          }
        } catch(e) {}
      }
    }
    
    // 检测工具调用意图并自动执行 → 多轮循环（最多 MAX_TOOL_ROUNDS 轮）
    let toolCallExecuted = false;
    try {
      const MAX_TOOL_ROUNDS = 5;
      let round = 0;
      let finalText = fullText;
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        // 1. 检测工具调用（去掉 markdown 包裹 + 自动 trim JSON 前空格）
        const stripped = fullText.replace(/```(?:json)?\s*/g, '').replace(/```/g, '')
          // 自动修复 AI 在 JSON 前多加的空格：{  "tool" → {"tool"
          .replace(/\{\s{2,}"tool"/g, '{"tool"');
        const toolRegex = /\{\s*"tool"\s*:\s*"(\w+)"\s*,\s*"params"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
        const toolCalls = [];
        let m;
        while ((m = toolRegex.exec(stripped)) !== null) {
          let p; try { p = JSON.parse(m[2]); } catch (e) { continue; }
          toolCalls.push({ name: m[1], params: p });
        }
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

        // 4. 工具结果回传 LLM，发起下一轮流式调用
        const toolFeedback = '### 工具执行结果\n以下是工具返回的数据，请直接回答用户最初的问题。' +
          (round >= MAX_TOOL_ROUNDS ? '（已达工具调用上限，请用现有信息给出最终答案）' : '如仍需其他工具，可继续返回 JSON 工具调用；否则用 Markdown 输出最终答案。') +
          '\n\n' + toolMsgs.join('\n\n');
        messages.push({ role: 'assistant', content: fullText });
        messages.push({ role: 'user', content: toolFeedback });

        const resp2 = await fetch(`${baseUrl}${apiPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages, stream: true, max_tokens: 4096 })
        });
        if (!resp2.ok) { finalText = fullText; break; }

        const reader2 = resp2.body.getReader();
        let b2 = '';
        fullText = '';
        while (true) {
          const { done, value } = await reader2.read();
          if (done) break;
          b2 += decoder.decode(value, { stream: true });
          const lines2 = b2.split('\n');
          b2 = lines2.pop() || '';
          for (const line2 of lines2) {
            const t2 = line2.trim();
            if (!t2 || !t2.startsWith('data: ')) continue;
            const ds2 = t2.substring(6);
            if (ds2 === '[DONE]') break;
            try {
              const delta2 = JSON.parse(ds2)?.choices?.[0]?.delta?.content;
              if (delta2) { fullText += delta2; if (tabId) chrome.tabs.sendMessage(tabId, { type: 'AI_STREAM_DELTA', delta: delta2 }).catch(() => {}); }
            } catch (e) {}
          }
        }
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
    const provider = config.provider || '';
    let apiPath = '/v1/chat/completions';
    if (provider === 'zhipu') apiPath = '/v4/chat/completions';
    else if (provider === 'wenxin') apiPath = '/chat/completions';
    const response = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: compressPrompt }], max_tokens: 500, temperature: 0.3 })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content?.trim() || '';
    const compressedTokens = Math.round(summary.length / 2.5);
    sendResponse({ success: true, summary, originalTokens, compressedTokens });
  } catch (error) { sendResponse({ success: false, error: error.message }); }
}

async function callAIStream(messages, systemPrompt, config, enableActions = false, tabId = null) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const provider = config.provider || '';
  let apiPath = '/v1/chat/completions';
  if (provider === 'zhipu') apiPath = '/v4/chat/completions';
  else if (provider === 'wenxin') apiPath = '/chat/completions';
  const sendToTab = (msg) => { if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {}); };
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: true, max_tokens: 4096 })
  });
  if (!response.ok) { const errText = await response.text(); throw new Error(`API ${response.status}: ${errText.substring(0, 200)}`); }
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer = '', totalText = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const trimmed = line.trim(); if (!trimmed || !trimmed.startsWith('data: ')) continue; const dataStr = trimmed.substring(6); if (dataStr === '[DONE]') break; try { const delta = JSON.parse(dataStr)?.choices?.[0]?.delta?.content; if (delta) { totalText += delta; sendToTab({ type: 'AI_STREAM_DELTA', delta }); } } catch (e) {} } }
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
    const baseUrl = config.baseUrl.replace(/\/+$/, ''); const provider = config.provider || ''; let apiPath = provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
    const response = await fetch(`${baseUrl}${apiPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: userPrompt }], stream: true, max_tokens: 1024 }) });
    if (!response.ok) { chrome.tabs.sendMessage(tabId, { type: 'POPUP_STREAM_ERROR', error: `API ${response.status}` }).catch(()=>{}); return; }
    const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const trimmed = line.trim(); if (!trimmed || !trimmed.startsWith('data: ')) continue; const dataStr = trimmed.substring(6); if (dataStr === '[DONE]') break; try { const delta = JSON.parse(dataStr)?.choices?.[0]?.delta?.content; if (delta) chrome.tabs.sendMessage(tabId, { type: 'POPUP_STREAM_DELTA', delta }).catch(()=>{}); } catch(e) {} } }
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
 * 核心用途：让 AI "看到"DOM 工具读不到的动态内容（B站评论区等）
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
    const apiPath = provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';

    const visionResp = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${visionConfig.visionApiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: analysisPrompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
        max_tokens: 1024
      })
    });
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
    const apiPath = provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';

    const visionResp = await fetch(`${baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${visionConfig.visionApiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: [
        { type: 'text', text: (prompt || '请描述截图中的内容') + '\n\n重要：只描述实际看到的，不要编造。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]}], max_tokens: 1024 })
    });
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
  const baseUrl = visionConfig.visionBaseUrl.replace(/\/+$/, ''); const provider = visionConfig.visionProvider || 'zhipu';
  const apiPath = provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
  const sendToTab = (msg) => { if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {}); };
  const response = await fetch(`${baseUrl}${apiPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${visionConfig.visionApiKey}` }, body: JSON.stringify({ model: model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: true, max_tokens: 2048 }) });
  if (!response.ok) throw new Error(`Vision API ${response.status}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer = '', totalText = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { const trimmed = line.trim(); if (!trimmed || !trimmed.startsWith('data: ')) continue; const dataStr = trimmed.substring(6); if (dataStr === '[DONE]') break; try { const delta = JSON.parse(dataStr)?.choices?.[0]?.delta?.content; if (delta) { totalText += delta; sendToTab({ type: 'AI_STREAM_DELTA', delta }); } } catch (e) {} } }
  sendToTab({ type: 'AI_STREAM_DONE', fullText: totalText });
}

async function handleTranslateBatch(message, sender, sendResponse) {
  const { texts, sourceLang, targetLang, delimiter } = message.payload;
  try {
    const config = await getAPIConfig();
    if (!config.apiKey) { sendResponse({ success: false, error: '请先配置 API Key' }); return; }
    const prompt = `翻译以下${texts.length}段文本从${sourceLang}到${targetLang}。用"${delimiter}"分隔。只返回翻译。\n\n${texts.join(` ${delimiter} `)}`;
    const baseUrl = config.baseUrl.replace(/\/+$/, ''); const provider = config.provider || ''; let apiPath = provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
    const response = await fetch(`${baseUrl}${apiPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 }) });
    if (!response.ok) { sendResponse({ success: false, error: `API ${response.status}` }); return; }
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content || '';
    const translations = content.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
    while (translations.length < texts.length) translations.push('');
    sendResponse({ success: true, translations: translations.slice(0, texts.length) });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}
async function handleTranslateSelection(message, sender, sendResponse) {
  const { text, targetLang } = message.payload;
  try {
    const config = await getAPIConfig();
    if (!config.apiKey) { sendResponse({ success: false, error: '请先配置 API Key' }); return; }
    const prompt = `翻译为${targetLang === 'zh-CN' ? '简体中文' : '英文'}，只返回译文：\n\n"${text}"`;
    const baseUrl = config.baseUrl.replace(/\/+$/, ''); const provider = config.provider || ''; let apiPath = provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
    const response = await fetch(`${baseUrl}${apiPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 1024 }) });
    if (!response.ok) { sendResponse({ success: false, error: `API ${response.status}` }); return; }
    const result = await response.json();
    sendResponse({ success: true, translation: result?.choices?.[0]?.message?.content?.trim() || '' });
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
const RESOURCE_TYPE_MAP = { 'script': 'script', 'image': 'image', 'stylesheet': 'stylesheet', 'xmlhttprequest': 'xmlhttprequest', 'subdocument': 'sub_frame', 'media': 'media', 'font': 'font', 'websocket': 'websocket', 'ping': 'ping', 'main_frame': 'main_frame', 'other': 'other' };

function compileAdblockRules(ruleText) {
  if (!ruleText || typeof ruleText !== 'string') return { dnrRules: [], cosmeticGlobal: [], cosmeticDomain: {} };
  const lines = ruleText.split('\n'); const dnrRules = []; const cosmeticGlobal = []; const cosmeticDomain = {};
  for (const line of lines) {
    const trimmed = line.trim(); if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[') || trimmed.startsWith('@@')) continue;
    const parsed = typeof AdblockParser !== 'undefined' ? AdblockParser.parse(trimmed) : null;
    if (parsed && parsed.type === 2) {
      if (parsed.domains && parsed.domains.length > 0) { parsed.domains.forEach(d => { if (!cosmeticDomain[d]) cosmeticDomain[d] = []; cosmeticDomain[d].push(parsed.selector); }); }
      else { cosmeticGlobal.push(parsed.selector); }
      continue;
    }
    const dnrRule = filterToDNRRule(trimmed);
    if (dnrRule && dnrRules.length < 5000) dnrRules.push(dnrRule);
  }
  return { dnrRules, cosmeticGlobal, cosmeticDomain };
}
function filterToDNRRule(ruleLine) {
  let pattern = ruleLine; const options = {};
  const dollarIdx = ruleLine.lastIndexOf('$');
  if (dollarIdx >= 0) { pattern = ruleLine.substring(0, dollarIdx); ruleLine.substring(dollarIdx + 1).split(',').forEach(opt => { const t = opt.trim(); if (RESOURCE_TYPE_MAP[t]) options.resourceType = t; else if (t.startsWith('domain=')) { const dl = t.substring(7).split('|'); options.includeDomains = dl.filter(d => !d.startsWith('~')); options.excludeDomains = dl.filter(d => d.startsWith('~')).map(d => d.substring(1)); } else if (t === 'third-party') options.thirdParty = true; else if (t === '~third-party' || t === 'first-party') options.firstParty = true; else if (t === 'badfilter') options.badfilter = true; }); }
  if (options.badfilter) return null;
  let urlFilter = pattern;
  if (urlFilter.startsWith('||')) urlFilter = '*://*.' + urlFilter.substring(2);
  else if (urlFilter.startsWith('|')) urlFilter = urlFilter.substring(1);
  else if (/^[a-zA-Z0-9._-]+\^?$/.test(urlFilter)) urlFilter = '*://*.' + urlFilter + '/*';
  urlFilter = urlFilter.replace(/\^/g, '*');
  const rule = { id: 0, priority: 1, action: { type: 'block' }, condition: { urlFilter } };
  if (options.resourceType) rule.condition.resourceTypes = [RESOURCE_TYPE_MAP[options.resourceType] || options.resourceType];
  if (options.includeDomains && options.includeDomains.length > 0) rule.condition.initiatorDomains = options.includeDomains;
  if (options.excludeDomains && options.excludeDomains.length > 0) rule.condition.excludedInitiatorDomains = options.excludeDomains;
  if (options.thirdParty) rule.condition.domainType = 'thirdParty';
  if (options.firstParty) rule.condition.domainType = 'firstParty';
  return rule;
}
async function updateDNRRules(dnrRules) {
  try {
    const rules = dnrRules.map((r, i) => ({ ...r, id: ADBLOCK_DYNAMIC_RULE_ID_START + i }));
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) });
    if (rules.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules.slice(0, 5000) });
    await chrome.storage.local.set({ adblock_dnr_meta: { ruleCount: rules.length, updatedAt: Date.now() } });
    return { success: true, ruleCount: rules.length };
  } catch (error) { return { success: false, error: error.message }; }
}
async function fetchFilterList(url) { try { const resp = await fetch(url, { cache: 'no-cache' }); if (!resp.ok) throw new Error(`HTTP ${resp.status}`); return await resp.text(); } catch (e) { return null; } }
async function initAdblockRules() {
  const config = await getAdblockConfig(); if (!config.enabled) return;
  let filterLists;
  if (config.filterLists && config.filterLists.length > 0) filterLists = config.filterLists;
  else { try { const resp = await fetch(chrome.runtime.getURL('libs/adblock/adblock-filter-lists.json')); const data = await resp.json(); filterLists = (data.lists || []).filter(l => l.enabled); } catch (e) { filterLists = []; } }
  let allDNR = []; let allCosmeticGlobal = []; let allCosmeticDomain = {};
  for (const list of filterLists) { if (!list.enabled) continue; const text = await fetchFilterList(list.url); if (!text) continue; const compiled = compileAdblockRules(text); allDNR = allDNR.concat(compiled.dnrRules); compiled.cosmeticGlobal.forEach(s => allCosmeticGlobal.push(s)); for (const [domain, selectors] of Object.entries(compiled.cosmeticDomain)) { if (!allCosmeticDomain[domain]) allCosmeticDomain[domain] = []; allCosmeticDomain[domain] = allCosmeticDomain[domain].concat(selectors); } }
  allCosmeticGlobal = [...new Set(allCosmeticGlobal)]; for (const d of Object.keys(allCosmeticDomain)) allCosmeticDomain[d] = [...new Set(allCosmeticDomain[d])];
  const dnrResult = await updateDNRRules(allDNR);
  await chrome.storage.local.set({ adblock_cosmetic_rules: { global: allCosmeticGlobal, domain: allCosmeticDomain } });
  const tabs = await chrome.tabs.query({}); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_UPDATE_COSMETIC', rules: { global: allCosmeticGlobal, domain: allCosmeticDomain } }).catch(() => {}); });
  chrome.alarms.create('adblock-update', { periodInMinutes: 1440 });
}
async function getAdblockConfig() { const r = await chrome.storage.sync.get('adblockConfig'); return r.adblockConfig || { enabled: true, customRules: [], filterLists: null }; }
async function saveAdblockConfig(config) { await chrome.storage.sync.set({ adblockConfig: config }); }

async function handleAdblockToggle(message, sender, sendResponse) { try { const config = await getAdblockConfig(); if (typeof message.enabled === 'boolean') config.enabled = message.enabled; await saveAdblockConfig(config); const tabs = await chrome.tabs.query({}); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_TOGGLE', enabled: config.enabled }).catch(() => {}); }); sendResponse({ success: true, config }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockUpdateRules(message, sender, sendResponse) { try { const cosmeticRules = await chrome.storage.local.get('adblock_cosmetic_rules'); if (cosmeticRules.adblock_cosmetic_rules) { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_UPDATE_COSMETIC', rules: cosmeticRules.adblock_cosmetic_rules }).catch(() => {}); }); } sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockGetStats(message, sender, sendResponse) { try { const config = await getAdblockConfig(); const meta = await chrome.storage.local.get('adblock_dnr_meta'); const cosmeticRules = await chrome.storage.local.get('adblock_cosmetic_rules'); let cg = 0, cd = 0; if (cosmeticRules.adblock_cosmetic_rules) { cg = (cosmeticRules.adblock_cosmetic_rules.global || []).length; cd = Object.values(cosmeticRules.adblock_cosmetic_rules.domain || {}).flat().length; } sendResponse({ success: true, stats: { enabled: config.enabled, dnrRuleCount: meta.adblock_dnr_meta?.ruleCount || 0, cosmeticGlobalCount: cg, cosmeticDomainCount: cd, customRuleCount: (config.customRules || []).length, updatedAt: meta.adblock_dnr_meta?.updatedAt || null } }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockGetLists(message, sender, sendResponse) { try { const config = await getAdblockConfig(); if (config.filterLists && config.filterLists.length > 0) sendResponse({ success: true, lists: config.filterLists }); else { try { const resp = await fetch(chrome.runtime.getURL('libs/adblock/adblock-filter-lists.json')); const data = await resp.json(); sendResponse({ success: true, lists: data.lists || [] }); } catch (e) { sendResponse({ success: true, lists: [] }); } } } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockSaveLists(message, sender, sendResponse) { try { const config = await getAdblockConfig(); config.filterLists = message.lists; await saveAdblockConfig(config); sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockClearRules(message, sender, sendResponse) { try { const existing = await chrome.declarativeNetRequest.getDynamicRules(); if (existing.length > 0) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map(r => r.id) }); await chrome.storage.local.remove('adblock_dnr_meta'); await chrome.storage.local.remove('adblock_cosmetic_rules'); const tabs = await chrome.tabs.query({}); tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ADBLOCK_UPDATE_COSMETIC', rules: { global: [], domain: {} } }).catch(() => {}); }); sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockClearCustom(message, sender, sendResponse) { try { const config = await getAdblockConfig(); config.customRules = []; await saveAdblockConfig(config); sendResponse({ success: true }); } catch (e) { sendResponse({ success: false, error: e.message }); } }
async function handleAdblockWhitelistAdd(message, sender, sendResponse) {
  try {
    const domain = message.domain;
    if (!domain) { sendResponse({ success: false, error: '缺少域名' }); return; }
    const items = await getWhitelistItems();
    if (!items.some(i => i.domain === domain)) {
      items.push({ domain, name: domain });
      await saveWhitelistItems(items);
      broadcastWhitelist({ items });
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
    sendResponse({ success: true });
  } catch (e) { sendResponse({ success: false, error: e.message }); }
}

async function handleAdblockWhitelistClear(message, sender, sendResponse) {
  try {
    await saveWhitelistItems([]);
    broadcastWhitelist({ items: [] });
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
  try { const config = await getAPIConfig(); if (!config.apiKey) { sendResponse({ success: false, error: '请先配置 API Key' }); return; } const baseUrl = config.baseUrl.replace(/\/+$/, ''); const apiPath = config.provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions'; const response = await fetch(`${baseUrl}${apiPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: '你是广告过滤规则专家。生成 CSS 选择器规则用于广告屏蔽。返回 JSON 数组：[{"selector":"选择器","note":"说明"}]。不超过20条。' }], max_tokens: 4096, temperature: 0.5 }) }); if (!response.ok) { sendResponse({ success: false, error: `API ${response.status}` }); return; } const result = await response.json(); const content = result?.choices?.[0]?.message?.content || ''; let rules = []; try { const m = content.match(/\[[\s\S]*\]/); if (m) rules = JSON.parse(m[0]); } catch (e) {} const validRules = (rules || []).filter(r => r.selector && r.selector.length > 3).map(r => ({ selector: r.selector, note: r.note || 'AI 生成' })); if (validRules.length > 0) { const storageResult = await chrome.storage.sync.get('adblockConfig'); const adConfig = storageResult.adblockConfig || {}; const existingSelectors = new Set(adConfig.customRules || []); const newRules = validRules.map(r => r.selector).filter(s => !existingSelectors.has(s)); adConfig.customRules = [...(adConfig.customRules || []), ...newRules]; await chrome.storage.sync.set({ adblockConfig: adConfig }); sendResponse({ success: true, rules: validRules, newCount: newRules.length }); } else { sendResponse({ success: false, error: 'AI 未返回有效规则' }); } } catch (e) { sendResponse({ success: false, error: e.message }); }
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
  try { const results = await KBIndex.search(message.payload.query, message.payload.limit || 20); sendResponse({ success: true, data: results, total: results.length }); }
  catch(e) { sendResponse({ success: false, error: e.message }); }
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

async function handleConsoleEvalDirect(tabId, expression) {
  try {
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

/** 自适应智能操作：用 JSON.stringify 传参避免字符串注入 */
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
});

// 闹钟监听：安全网检查
if (chrome.alarms) {
  const _origAlarmListener = chrome.alarms.onAlarm.hasListeners ? null : null;
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'adblock-update') {
      await initAdblockRules();
    } else if (alarm.name === 'wuji-tab-suspend-check') {
      TabSuspender.runSafetyCheck();
    }
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
      const set = await DanmakuCrawler.crawlDanmaku(bvid, (progress) => {
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

// 初始化标签页休眠
TabSuspender.init().catch(() => {});

// ============================================================
// 启动
// ============================================================
initKBEngine().then(() => {
  console.log('[无极 SW] 知识库引擎 V2 已就绪');
  try { AgentPermissions.load(); } catch (e) {}
});
console.log('[无极 SW] Service Worker 已启动');