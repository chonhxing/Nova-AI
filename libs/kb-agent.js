/**
 * 无极 — AI Agent 框架 V2.0
 * 借鉴 Everything Capture 的 AI Agent 架构：
 *   - 多模式：chat | ask | agent
 *   - Agent 权限控制
 *   - 工具调用事件流
 *   - RAG 引用系统
 *   - 审批流程（危险操作）
 *   - Dashboard 智能推荐
 *   - 自动标签
 */

// ============================================================
// Agent 权限模型（借鉴 EC Settings.ai_agent_can_*）
// ============================================================
const AgentPermissions = {
  can_manage_folders: true,
  can_parse_content: true,
  can_sync_obsidian: false,
  can_sync_notion: false,
  can_execute_commands: false,
  can_web_search: true,
  can_run_computer_commands: false,

  /** 加载权限配置 */
  async load() {
    try {
      const result = await chrome.storage.sync.get('agentPermissions');
      if (result.agentPermissions) {
        Object.assign(AgentPermissions, result.agentPermissions);
      }
    } catch(e) {}
  },

  /** 保存权限配置 */
  async save() {
    await chrome.storage.sync.set({ agentPermissions: { ...AgentPermissions } });
  },

  /** 检查指定权限 */
  check(permissionName) {
    return AgentPermissions[permissionName] === true;
  },

  /** 获取已启用的权限列表 */
  getEnabled() {
    return Object.keys(AgentPermissions)
      .filter(k => k.startsWith('can_') && AgentPermissions[k] === true);
  }
};

// ============================================================
// 工具定义（Agent 可调用的工具）
// ============================================================
const AgentTools = {
  /** 搜索知识库 */
  search_knowledge: {
    name: 'search_knowledge',
    description: '搜索知识库，查找相关网页、对话和文件',
    handler: async (params) => {
      const results = await KBIndex.search(params.query, params.limit || 5);
      return {
        success: true,
        summary: `找到 ${results.length} 个相关结果`,
        detail: results.map(r => `[${r.title}] ${r.preview}`).join('\n'),
        data: results
      };
    }
  },

  /** 保存笔记 */
  create_note: {
    name: 'create_note',
    description: '为知识库条目创建笔记',
    handler: async (params) => {
      const noteId = await KBPageNote.create({
        item_id: params.item_id,
        title: params.title,
        content: params.content
      });
      return {
        success: true,
        summary: `笔记已创建: ${params.title}`,
        detail: `ID: ${noteId}`,
        data: { id: noteId }
      };
    }
  },

  /** 添加标签 */
  add_tag: {
    name: 'add_tag',
    description: '为知识库条目添加标签',
    handler: async (params) => {
      if (!AgentPermissions.check('can_manage_folders')) {
        return { success: false, summary: '标签管理权限未启用' };
      }
      const tagId = await KBTag.create(params.tag_name);
      await KBTag.linkItem(params.item_id, tagId, 'ai');
      return {
        success: true,
        summary: `已添加标签: ${params.tag_name}`,
        detail: `标签 ID: ${tagId}`
      };
    }
  },

  /** 收藏条目 */
  favorite: {
    name: 'favorite',
    description: '收藏知识库条目',
    handler: async (params) => {
      if (!AgentPermissions.check('can_manage_folders')) {
        return { success: false, summary: '文件夹管理权限未启用' };
      }
      await KBItem.toggleFavorite(params.item_id);
      return { success: true, summary: '已切换收藏状态' };
    }
  },

  /** 分析内容 */
  analyze_content: {
    name: 'analyze_content',
    description: '分析知识库条目的内容，生成摘要、要点和思考问题',
    handler: async (params) => {
      if (!AgentPermissions.check('can_parse_content')) {
        return { success: false, summary: '内容分析权限未启用' };
      }
      const item = await KBItem.get(params.item_id);
      if (!item) return { success: false, summary: '条目不存在' };
      
      return {
        success: true,
        summary: `分析完成: ${item.title}`,
        detail: JSON.stringify({
          title: item.title,
          word_count: item.word_count,
          image_count: (item.image_urls || []).length,
          has_content: !!item.content
        }),
        data: { item }
      };
    }
  },

  /** 读取页面 DOM 结构（增强版：支持 wait 等待懒加载） */
  read_dom: {
    name: 'read_dom',
    description: '读取当前页面的实时 DOM 结构树。参数：{selector:"CSS选择器", maxDepth:3, maxChildren:8, wait:3000}。wait 可选，等待目标元素出现（毫秒），用于懒加载内容如 B站评论区',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };

        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'GET_DOM_STRUCTURE',
          timestamp: Date.now(),
          selector: params.selector || 'body',
          maxDepth: params.maxDepth || 3,
          maxChildren: params.maxChildren || 8,
          wait: params.wait || 0
        });

        if (resp?.success) {
          const json = JSON.stringify(resp.data, null, 1).substring(0, 3000);
          const extra = resp.data._childCount ? ` (${resp.data._childCount} 个子元素)` : '';
          return {
            success: true,
            summary: `已读取 DOM 结构${extra}: ${params.selector || 'body'}, 深度${params.maxDepth || 3}`,
            detail: '```json\n' + json + '\n```',
            data: resp.data
          };
        }
        return { success: false, summary: resp?.error || '读取失败' };
      } catch (e) {
        return { success: false, summary: 'DOM 读取异常: ' + e.message };
      }
    }
  },

  /** 滚动页面触发懒加载后读取内容 */
  scroll_and_wait: {
    name: 'scroll_and_wait',
    description: '滚动页面以触发懒加载，等待新内容出现后读取。用于 B站评论区、知乎等无限滚动页面。参数：{selector:"评论区容器选择器", scrollPx:2000, waitMs:3000}',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };

        // 第一步：滚动触发懒加载
        const scrollResp = await chrome.tabs.sendMessage(tabId, {
          type: 'SCROLL_AND_WAIT',
          timestamp: Date.now(),
          selector: params.selector || null,
          scrollPx: params.scrollPx || 2000,
          waitMs: params.waitMs || 3000
        });

        if (!scrollResp?.success) {
          return { success: false, summary: '滚动失败: ' + (scrollResp?.error || '未知错误') };
        }

        // 第二步：读取滚动后的 DOM
        const domResp = await chrome.tabs.sendMessage(tabId, {
          type: 'GET_DOM_STRUCTURE',
          timestamp: Date.now(),
          selector: params.selector || 'body',
          maxDepth: params.maxDepth || 3,
          maxChildren: params.maxChildren || 10
        });

        if (domResp?.success) {
          const json = JSON.stringify(domResp.data, null, 1).substring(0, 3000);
          const info = scrollResp.data;
          return {
            success: true,
            summary: `滚动后读取完成：新增 ${info.newItems} 项，耗时 ${info.elapsed}ms`,
            detail: '```json\n' + json + '\n```',
            data: { ...domResp.data, _scrollInfo: info }
          };
        }
        return { success: false, summary: '滚动后读取失败: ' + (domResp?.error || '未知错误') };
      } catch (e) {
        return { success: false, summary: '滚动读取异常: ' + e.message };
      }
    }
  },

  /** 监听 DOM 变化（用于持续跟踪评论区等动态内容） */
  watch_dom: {
    name: 'watch_dom',
    description: '注册 MutationObserver 监听目标容器变化（如 B站评论区滚动加载）。参数：{selector:"CSS选择器", debounceMs:500}。之后用 get_watch_report 获取内容。',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };

        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'WATCH_DOM',
          timestamp: Date.now(),
          selector: params.selector,
          debounceMs: params.debounceMs || 500,
          subtree: params.subtree !== false
        });

        if (resp?.success) {
          return {
            success: true,
            summary: `已开始监听: ${params.selector} (ID: ${resp.data.watcherId})`,
            detail: `监听器 ID: ${resp.data.watcherId}。使用 get_watch_report 获取最新内容，使用 stop_dom_watch 停止。`,
            data: resp.data
          };
        }
        return { success: false, summary: resp?.error || '监听失败' };
      } catch (e) {
        return { success: false, summary: '监听异常: ' + e.message };
      }
    }
  },

  /** 获取 DOM 监听报告 */
  get_watch_report: {
    name: 'get_watch_report',
    description: '获取已注册 DOM 监听器的最新内容。参数：{watcherId:"监听器ID"}',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };

        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'GET_DOM_WATCH_REPORT',
          timestamp: Date.now(),
          watcherId: params.watcherId
        });

        if (resp?.success) {
          return {
            success: true,
            summary: `监听报告: ${resp.data.selector} (${resp.data.childCount} 个子元素)`,
            detail: resp.data.text?.substring(0, 2000) || '(空)',
            data: resp.data
          };
        }
        return { success: false, summary: resp?.error || '获取失败' };
      } catch (e) {
        return { success: false, summary: '获取异常: ' + e.message };
      }
    }
  },

  /** 停止 DOM 监听 */
  stop_dom_watch: {
    name: 'stop_dom_watch',
    description: '停止已注册的 DOM 监听器。参数：{watcherId:"监听器ID"}',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };

        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'STOP_DOM_WATCH',
          timestamp: Date.now(),
          watcherId: params.watcherId
        });

        return resp?.success ? { success: true, summary: '监听已停止: ' + params.watcherId } : { success: false, summary: resp?.error || '停止失败' };
      } catch (e) {
        return { success: false, summary: '停止异常: ' + e.message };
      }
    }
  },

  /** 主动抓取 API（利用页面 cookies 跨域） */
  fetch_api: {
    name: 'fetch_api',
    description: '从当前页面上下文主动抓取 API 数据（利用页面 cookies）。用于 B站评论区接口等。参数：{url:"完整URL", method:"GET", headers:{}}',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'FETCH_API',
          timestamp: Date.now(),
          url: params.url,
          method: params.method || 'GET',
          headers: params.headers || {}
        });
        if (resp?.success) {
          return {
            success: true,
            summary: `API 响应: HTTP ${resp.data.status}, ${resp.data.body.length} 字符`,
            detail: resp.data.body.substring(0, 3000),
            data: resp.data
          };
        }
        return { success: false, summary: resp?.error || '请求失败' };
      } catch (e) {
        return { success: false, summary: 'API 请求异常: ' + e.message };
      }
    }
  },

  /** 读取已拦截的 API 数据 */
  get_intercepted: {
    name: 'get_intercepted',
    description: '读取无极自动拦截到的 XHR/fetch API 响应（页面加载后自动收集）。参数：{filter:"关键词"} 可按 URL 筛选。常用于获取 B站评论等 JSON 数据',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'GET_INTERCEPTED',
          timestamp: Date.now(),
          filter: params.filter || ''
        });
        if (resp?.success) {
          const d = resp.data;
          if (d.matches.length === 0) {
            return { success: true, summary: `已拦截 ${d.total} 个 API 请求，无匹配项`, detail: '尝试刷新页面以重新拦截' };
          }
          const last = d.matches[d.matches.length - 1];
          return {
            success: true,
            summary: `找到 ${d.matches.length}/${d.total} 个匹配的 API 响应`,
            detail: `URL: ${last.url}\n${last.data.substring(0, 3000)}`,
            data: d.matches
          };
        }
        return { success: false, summary: resp?.error || '读取失败' };
      } catch (e) {
        return { success: false, summary: '读取异常: ' + e.message };
      }
    }
  },

  /** 深度 DOM 监听（先等父元素出现再挂 observer） */
  deep_watch: {
    name: 'deep_watch',
    description: '深度监听动态渲染的深层子树（如 B站 #video-page-app）。先轮询等父元素出现，再挂 MutationObserver。参数：{selector:"CSS选择器", waitParentMs:10000}。之后用 get_watch_report 获取内容',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        const resp = await chrome.tabs.sendMessage(tabId, {
          type: 'DEEP_WATCH',
          timestamp: Date.now(),
          selector: params.selector,
          debounceMs: params.debounceMs || 500,
          waitParentMs: params.waitParentMs || 10000
        });
        if (resp?.success) {
          return {
            success: true,
            summary: `深度监听已启动: ${params.selector} (ID: ${resp.data.watcherId})`,
            detail: `监听器 ID: ${resp.data.watcherId}。之后用 get_watch_report 获取最新内容。`,
            data: resp.data
          };
        }
        return { success: false, summary: resp?.error || '启动失败' };
      } catch (e) {
        return { success: false, summary: '深度监听异常: ' + e.message };
      }
    }
  },

  /** 获取相关条目 */
  get_related: {
    name: 'get_related',
    description: '获取与指定条目的相关的其他条目',
    handler: async (params) => {
      const related = await KBGraph.getRelated(params.item_id, 3);
      return {
        success: true,
        summary: `找到 ${related.length} 个相关条目`,
        detail: related.map(r => `[${r.title}]`).join(', '),
        data: related
      };
    }
  },

  /** 广告过滤白名单 */
  whitelist_site: {
    name: 'whitelist_site',
    description: '将当前网站加入广告过滤白名单。参数：{domain: "example.com"}，留空自动用当前页域名',
    handler: async (params) => {
      try {
        let domain = params.domain;
        if (!domain) { const tabs = await chrome.tabs.query({ active: true, currentWindow: true }); domain = new URL(tabs[0].url).hostname.replace(/^www\./, ''); }
        if (!domain) return { success: false, summary: '无法获取域名' };
        const r = await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_ADD', domain });
        return r;
      } catch (e) { return { success: false, summary: '白名单操作失败: ' + e.message }; }
    }
  },

  /** 切换广告过滤 */
  toggle_adblock: {
    name: 'toggle_adblock',
    description: '开启或关闭无极的广告过滤。参数：{enabled: true} 或 {enabled: false}',
    handler: async (params) => {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_TOGGLE', enabled: params.enabled });
        return resp?.success ? { success: true, summary: params.enabled ? '广告过滤已开启' : '广告过滤已关闭' } : { success: false, summary: resp?.error || '操作失败' };
      } catch (e) { return { success: false, summary: '操作失败: ' + e.message }; }
    }
  },

  /** 截图分析 — 视觉模型"看到"页面 */
  analyze_screen: {
    name: 'analyze_screen',
    description: '截图当前可视区域，交给视觉模型分析。用于 DOM 工具读不到内容的动态页面（B站评论区、SPA等）。参数：{prompt:"分析什么", scrollFirst:true/false}',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleAnalyzeScreenDirect === 'function') {
          return await handleAnalyzeScreenDirect(tabId, params.prompt || '请详细描述截图中的文字内容', params.scrollFirst || false);
        }
        return { success: false, summary: '截图分析模块未就绪' };
      } catch (e) { return { success: false, summary: '截图分析异常: ' + e.message }; }
    }
  },

  /** 向下滚动页面 */
  scroll_down: {
    name: 'scroll_down',
    description: '向下滚动页面指定像素，触发懒加载。参数：{px:500}',
    handler: async (params) => {
      try {
        const tabId = await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        await chrome.tabs.sendMessage(tabId, {
          type: 'EXECUTE_ACTIONS',
          timestamp: Date.now(),
          actions: [{ action: 'scrollDown', selector: '' }]
        });
        return { success: true, summary: `已向下滚动` };
      } catch (e) { return { success: false, summary: '滚动异常: ' + e.message }; }
    }
  },

  /** 接入浏览器控制台 */
  console_attach: {
    name: 'console_attach',
    description: '接入当前页面的浏览器控制台（Chrome DevTools Protocol），开始收集 console 日志、异常、网络请求。之后用 console_get_logs 读取',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        // 直接调用 SW 内部函数（kb-agent 被 importScripts 加载到 SW 上下文）
        if (typeof handleConsoleAttachDirect === 'function') {
          return await handleConsoleAttachDirect(tabId);
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '接入异常: ' + e.message }; }
    }
  },

  /** 断开控制台 */
  console_detach: {
    name: 'console_detach',
    description: '断开当前页面的浏览器控制台连接',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleDetachDirect === 'function') {
          return await handleConsoleDetachDirect(tabId);
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '断开异常: ' + e.message }; }
    }
  },

  /** 读取控制台日志 */
  console_get_logs: {
    name: 'console_get_logs',
    description: '读取已收集的控制台日志（console.log/warn/error + 异常）。参数：{filter:"关键词"} 可按内容筛选',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleGetLogsDirect === 'function') {
          return await handleConsoleGetLogsDirect(tabId, params.filter || '');
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '读取异常: ' + e.message }; }
    }
  },

  /** 在页面中执行 JS */
  console_eval: {
    name: 'console_eval',
    description: '在当前页面中执行 JavaScript 表达式并返回结果（通过 CDP Runtime.evaluate）。参数：{expression:"document.title"}',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleEvalDirect === 'function') {
          return await handleConsoleEvalDirect(tabId, params.expression);
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '执行异常: ' + e.message }; }
    }
  },

  /** 点击页面元素 */
  console_click: {
    name: 'console_click',
    description: '通过 CDP 点击页面元素。参数：{selector:"CSS选择器"}',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleClickDirect === 'function') {
          return await handleConsoleClickDirect(tabId, params.selector);
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '点击异常: ' + e.message }; }
    }
  },

  /** 填写输入框 */
  console_fill: {
    name: 'console_fill',
    description: '通过 CDP 填写页面输入框。参数：{selector:"CSS选择器", value:"内容"}',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleFillDirect === 'function') {
          return await handleConsoleFillDirect(tabId, params.selector, params.value);
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '填写异常: ' + e.message }; }
    }
  },

  /** 获取页面 HTML/文本 */
  console_get_html: {
    name: 'console_get_html',
    description: '通过 CDP 获取页面的 innerText。参数：{selector:"CSS选择器"}，不传则获取 body 全部文本',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleGetHTMLDirect === 'function') {
          return await handleConsoleGetHTMLDirect(tabId, params.selector || '');
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '读取异常: ' + e.message }; }
    }
  },

  /** 自适应智能操作 */
  console_smart: {
    name: 'console_smart',
    description: '自适应智能操作：自动检查元素是否存在，返回其 tag/type/text/value/位置。用于不确定目标时先探测。参数：{selector:"CSS选择器"}',
    handler: async (params) => {
      try {
        const tabId = params?.tabId || await getActiveTabId();
        if (!tabId) return { success: false, summary: '无活跃标签页' };
        if (typeof handleConsoleSmartDirect === 'function') {
          return await handleConsoleSmartDirect(tabId, params.intent || 'detect', params.selector);
        }
        return { success: false, summary: '控制台模块未就绪' };
      } catch (e) { return { success: false, summary: '操作异常: ' + e.message }; }
    }
  },

};

// ============================================================
// 工具方法
// ============================================================
function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id || null);
    });
  });
}

// ============================================================
// RAG 引用系统（借鉴 EC AiCitationResponse）
// ============================================================
function buildCitation(item, score = 0, excerpt = '') {
  return {
    reference_index: null,
    note_id: String(item.id),
    library_item_id: String(item.id),
    title: item.title || '未命名',
    summary: item.content_summary || (item.content || '').substring(0, 300),
    folder: item.source_type === 'page' ? '网页' : item.source_type === 'chat' ? '对话' : '文件',
    tags: item.tag_ids || [],
    source: item.url || '',
    relative_path: '',
    created_at: new Date(item.timestamp).toISOString(),
    score: score,
    excerpt: excerpt || (item.content || '').substring(0, 200),
  };
}

/**
 * RAG 检索：从知识库中查找相关上下文
 */
async function buildRagContext(query, topK = 5) {
  const results = await KBIndex.search(query, topK);
  if (results.length === 0) return { citations: [], context: '' };
  
  const citations = results.map(r => buildCitation(r, r._score || 0));
  
  let context = '## 知识库相关内容\n\n';
  results.forEach((r, i) => {
    context += `### [${i + 1}] ${r.title}\n`;
    context += `来源: ${r.url || '无'}\n`;
    context += `内容摘要: ${r.content_summary || r.content?.substring(0, 300) || '无'}\n\n`;
  });
  
  return { citations, context };
}

// ============================================================
// AI 分析服务（借鉴 EC AiItemAnalysis + AiDashboard）
// ============================================================
const KBAnalysis = {
  /**
   * 条目详细分析（借鉴 EC AiItemAnalysisResponse）
   */
  async analyzeItem(itemId) {
    const item = await KBItem.get(itemId);
    if (!item) throw new Error('条目不存在');
    
    const tags = await KBTag.getItemTags(itemId);
    const related = await KBGraph.getRelated(itemId, 3);
    const highlights = await KBHighlight.getByItem(itemId);
    const notes = await KBPageNote.getByItem(itemId);
    
    return {
      item_id: String(itemId),
      title: item.title,
      source_url: item.url,
      source_type: item.source_type,
      tags: tags.map(t => ({ id: t.id, name: t.name, color: t.color })),
      highlights_count: highlights.length,
      notes_count: notes.length,
      related_items: related.map(r => ({
        id: String(r.id),
        title: r.title,
        url: r.url,
      })),
      word_count: item.word_count || 0,
      image_count: (item.image_urls || []).length,
      is_favorite: item.is_favorite || false,
      saved_at: new Date(item.timestamp).toLocaleString('zh-CN'),
      content_summary: item.content_summary || (item.content || '').substring(0, 500),
    };
  },

  /**
   * Dashboard 智能推荐（借鉴 EC AiDashboardResponse）
   */
  async getDashboard() {
    const allItems = await KBItem.getAll(30);
    const allTags = await KBTag.getAll();
    
    // 统计数据（借鉴 EC AiDashboardStats）
    const stats = {
      total_count: await _dbCount('kb_items'),
      favorites_count: 0,
      pages_count: 0,
      chats_count: 0,
      files_count: 0,
    };
    
    allItems.forEach(item => {
      if (item.is_favorite) stats.favorites_count++;
      if (item.source_type === 'page') stats.pages_count++;
      else if (item.source_type === 'chat') stats.chats_count++;
      else if (item.source_type === 'file') stats.files_count++;
    });
    
    // 推荐条目（最近收藏/最近查看）
    const recommendations = allItems
      .filter(i => i.is_favorite || i.last_viewed_at)
      .sort((a, b) => (b.last_viewed_at || b.timestamp) - (a.last_viewed_at || a.timestamp))
      .slice(0, 5)
      .map(item => ({
        item: {
          id: String(item.id),
          title: item.title,
          url: item.url,
          source_type: item.source_type,
          preview: (item.content || '').substring(0, 150),
          timestamp: item.timestamp,
        },
        reason: item.is_favorite ? '已收藏' : '最近查看',
        topic: item.source_type === 'page' ? '网页' : item.source_type === 'chat' ? '对话' : '文件',
        score: item.is_favorite ? 1.0 : 0.5,
        action_label: '打开',
      }));
    
    // 主题聚类
    const topics = allTags.slice(0, 10).map(tag => ({
      label: tag.name,
      count: 0,
      item_ids: [],
      description: tag.color ? `颜色: ${tag.color}` : '无描述',
      reason: 'AI 标签',
    }));
    
    return { recommendations, topics, stats, all_tags: allTags };
  },
};

// ============================================================
// Agent 执行引擎
// ============================================================
const KBAgent = {
  /**
   * 执行 Agent 对话（借鉴 EC AiAssistant）
   * @param {Object} params
   * @param {string} params.mode - chat | ask | agent
   * @param {Object[]} params.messages - [{role, content}]
   * @param {number} params.top_k - RAG 检索数量
   * @param {string} params.current_item_id - 当前上下文条目
   * @returns {Object} { message, citations, tool_events, note_count, insufficient_context, updated_items, pending_approval }
   */
  async execute(params) {
    const { mode = 'chat', messages = [], top_k = 5, current_item_id = null } = params;
    
    // 1. RAG 检索上下文
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const query = lastUserMsg ? lastUserMsg.content : '';
    const { citations, context } = await buildRagContext(query, top_k);
    
    // 2. 获取当前条目的上下文
    let itemContext = '';
    if (current_item_id) {
      const item = await KBItem.get(current_item_id);
      if (item) {
        itemContext = `\n## 当前条目\n标题: ${item.title}\nURL: ${item.url}\n类型: ${item.source_type}\n内容预览: ${(item.content || '').substring(0, 2000)}\n`;
      }
    }
    
    // 3. 获取 AI 记忆
    const memories = await KBAiMemory.recall(query, 3);
    const memoryContext = memories.length > 0
      ? '\n## AI 记忆\n' + memories.map(m => `- [${m.type}] ${m.content}`).join('\n') + '\n'
      : '';
    
    // 4. 构建系统提示词
    const systemPrompt = buildAgentSystemPrompt(mode, context, itemContext, memoryContext);
    
    // 5. 获取 API 配置并调用
    const config = await getAgentApiConfig();
    if (!config.apiKey) {
      return {
        message: '请先配置 AI API Key 才能使用 Agent 功能。',
        citations,
        tool_events: [],
        note_count: citations.length,
        insufficient_context: citations.length === 0,
      };
    }
    
    // 6. 检测是否需要工具调用
    const toolNames = Object.keys(AgentTools);
    const toolDescriptions = toolNames.map(name => 
      `${name}: ${AgentTools[name].description}`
    ).join('\n');
    
    const toolPrompt = mode === 'agent' ? 
      `\n\n## 可用工具\n你可以调用以下工具（返回 JSON 格式）：\n${toolDescriptions}\n\n## 工具调用规则（重要）\n1. 调用格式：{"tool": "工具名", "params": {...}}\n2. **工具调用 JSON 必须独占一行、直接输出，禁止用 markdown 代码块（\\\`\\\`\\\`）包裹**，否则无法被识别执行。\n3. 一次回复中可以输出多个工具调用 JSON，每个独占一行。\n4. 如果不需调用工具，正常回答问题。\n\n## 视频/多媒体页面策略\n- 对于"这个视频里讲了什么/某产品性能多强"类问题：先用 read_dom 读取 #video_desc（视频简介）和 body（页面文本）。\n- **关键认知**：视频的性能评测数据在视频本身（画面+语音），DOM 文字通常只有标题和简介，read_dom 多半读不到具体跑分/帧率。\n- **兜底规则**：若调用 read_dom 后仍无具体数据，**不要**只说"无法提取，建议你看视频"。应基于你自身训练知识给出该产品/主题的一般性介绍（架构、定位、典型性能区间、竞品对比等），并明确标注"⚠️ 以下为通用信息，非本视频实测数据，具体以视频为准"。\n- 若该产品不在你的知识范围，诚实说明并建议获取视频字幕或观看视频。` : '';
    
    const fullMessages = [
      { role: 'system', content: systemPrompt + toolPrompt },
      ...messages
    ];
    
    // 返回 Agent 响应结构
    return {
      mode,
      citations,
      tool_events: [],
      note_count: citations.length,
      insufficient_context: citations.length === 0,
      agent_permissions: AgentPermissions.getEnabled(),
      updated_items: [],
      pending_approval: null,
      _config: config, // 内部使用
      _messages: fullMessages,
    };
  },

  /**
   * 流式执行 Agent 对话
   * @param {Function} onDelta - 文本增量回调
   * @param {Function} onDone - 完成回调
   * @param {Function} onError - 错误回调
   * @param {Function} [onToolEvent] - 工具执行事件回调 (toolName, result) => void
   */
  async executeStream(params, onDelta, onDone, onError, onToolEvent) {
    try {
      const result = await KBAgent.execute(params);
      
      if (result.message && !result._config) {
        onDelta(result.message);
        onDone(result);
        return;
      }
      
      const config = result._config;
      const messages = result._messages;
      
      const baseUrl = config.baseUrl.replace(/\/+$/, '');
      const provider = config.provider || '';
      let apiPath = '/v1/chat/completions';
      if (provider === 'zhipu') apiPath = '/v4/chat/completions';
      else if (provider === 'wenxin') apiPath = '/chat/completions';
      
      const response = await fetch(`${baseUrl}${apiPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || 'deepseek-chat',
          messages: messages,
          stream: true,
          max_tokens: 4096,
          temperature: 0.7,
        })
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API ${response.status}: ${errText.substring(0, 200)}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '', fullText = '';
      
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
              onDelta(delta);
            }
          } catch(e) {}
        }
      }
      
      // ===== 多轮工具调用循环（最多 MAX_TOOL_ROUNDS 轮） =====
      // 修复：原来工具执行后结果未回传 LLM，导致 read_dom 等工具"白调"，
      // AI 仍答"无法获取"。现在每轮把工具结果追加为 user 消息，继续对话，
      // 直到 LLM 不再请求工具或达到上限。
      const MAX_TOOL_ROUNDS = 5;
      let toolEvents = [];
      let round = 0;
      let finalText = fullText; // 最终展示给用户的文本
      
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        // 1. 检测本轮输出里是否包含工具调用（兼容单个与多个工具调用）
        //    先剥离 markdown 代码块标记（```...``` 和单行 `...`），提高识别率
        const stripped = fullText
          .replace(/```(?:json)?\s*/g, '')
          .replace(/```/g, '');
        const toolRegex = /\{"tool"\s*:\s*"(\w+)"\s*,\s*"params"\s*:\s*(\{[\s\S]*?\})\s*\}/g;
        const toolCalls = [];
        let m;
        while ((m = toolRegex.exec(stripped)) !== null) {
          let params;
          try { params = JSON.parse(m[2]); } catch (e) { continue; }
          toolCalls.push({ name: m[1], params });
        }
        
        // 2. 没有工具调用 → 本轮即最终答案，结束循环
        if (toolCalls.length === 0) {
          finalText = fullText;
          break;
        }
        
        // 3. 执行所有工具调用，收集结果
        const toolMsgs = [];
        for (const tc of toolCalls) {
          if (!AgentTools[tc.name]) {
            toolMsgs.push(`[工具 ${tc.name} 执行结果]\n错误: 未知工具 "${tc.name}"`);
            continue;
          }
          let toolResult;
          try {
            toolResult = await AgentTools[tc.name].handler(tc.params || {});
          } catch (e) {
            toolResult = { success: false, summary: '工具执行异常: ' + e.message };
          }
          toolEvents.push({
            name: tc.name,
            status: toolResult.success ? 'completed' : 'failed',
            summary: toolResult.summary,
            detail: toolResult.detail,
          });
          // 实时推送工具状态，避免 UI 长时间空白
          onDelta(`\n\n> 🔧 ${tc.name}: ${toolResult.summary}\n\n`);
          // 同时通过 onToolEvent 通知 UI 层显示独立工具状态气泡（TOOL_RESULT）
          if (typeof onToolEvent === 'function') {
            try { onToolEvent(tc.name, toolResult); } catch (e) {}
          }
          toolMsgs.push(`[工具 ${tc.name} 执行结果]\n${toolResult.detail || toolResult.summary || '执行完成'}`);
        }
        
        // 4. 把工具结果回传 LLM，发起下一轮流式调用
        const toolFeedback = '### 工具执行结果\n以下是工具返回的数据。请基于这些数据直接回答用户最初的问题。' +
          (round >= MAX_TOOL_ROUNDS ? '（已达工具调用上限，请用现有信息给出最终答案）' : '如仍需其他工具，可继续返回 JSON 工具调用；否则用 Markdown 输出最终答案。') +
          '\n\n' + toolMsgs.join('\n\n');
        
        messages.push({ role: 'assistant', content: fullText });
        messages.push({ role: 'user', content: toolFeedback });
        
        const nextResp = await fetch(`${baseUrl}${apiPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model: config.model || 'deepseek-chat',
            messages: messages,
            stream: true,
            max_tokens: 4096,
            temperature: 0.7,
          })
        });
        
        if (!nextResp.ok) {
          // 第二轮起失败 → 降级用上一轮文本作答
          finalText = fullText;
          break;
        }
        
        const reader2 = nextResp.body.getReader();
        let buffer2 = '';
        fullText = ''; // 重置为本轮输出
        while (true) {
          const { done, value } = await reader2.read();
          if (done) break;
          buffer2 += decoder.decode(value, { stream: true });
          const lines2 = buffer2.split('\n');
          buffer2 = lines2.pop() || '';
          for (const line2 of lines2) {
            const t2 = line2.trim();
            if (!t2 || !t2.startsWith('data: ')) continue;
            const ds2 = t2.substring(6);
            if (ds2 === '[DONE]') break;
            try {
              const delta2 = JSON.parse(ds2)?.choices?.[0]?.delta?.content;
              if (delta2) { fullText += delta2; onDelta(delta2); }
            } catch (e) {}
          }
        }
        // 循环回到顶部：检测本轮 fullText 是否还含工具调用
      }
      
      // 达到上限后若最后一轮仍是工具调用，finalText 保持为最后一轮文本
      // 自动学习用户偏好（AiMemory）— 用原始用户查询，避免取到 system/工具反馈消息
      if (finalText.length > 50) {
        try {
          const origUserQuery = (params.messages || []).filter(m => m.role === 'user').pop()?.content;
          if (origUserQuery) {
            await KBAiMemory.remember('learned', `用户查询: ${origUserQuery.substring(0, 100)}`);
          }
        } catch(e) {}
      }
      
      const finalResult = {
        ...result,
        message: finalText,
        tool_events: toolEvents,
        _config: undefined,
        _messages: undefined,
      };
      
      onDone(finalResult);
    } catch(e) {
      onError(e.message);
    }
  }
};

// ============================================================
// System Prompt 构建
// ============================================================
function buildAgentSystemPrompt(mode, ragContext, itemContext, memoryContext) {
  let prompt = `你是无极 AI 助手，一个智能浏览器知识库助手。

## 你的能力
- 帮助用户管理知识库（网页、对话、文件的收藏和检索）
- 基于知识库内容回答问题
- 分析网页内容并提供洞察
- 建议标签和分类
- 查找相关内容

## 当前模式
`;
  
  if (mode === 'chat') prompt += '对话模式：自由交流，可引用知识库内容。\n';
  else if (mode === 'ask') prompt += '问答模式：基于知识库内容精准回答问题。\n';
  else if (mode === 'agent') prompt += 'Agent 模式：可调用工具执行操作（添加标签、创建笔记、搜索知识库等）。\n';
  
  prompt += '\n' + ragContext + '\n';
  prompt += itemContext + '\n';
  prompt += memoryContext + '\n';
  
  prompt += `## 回答格式
- 使用 Markdown 格式
- 引用知识库内容时注明来源
- 如果信息不足，诚实说明
- 保持回答简洁、准确`;
  
  return prompt;
}

// ============================================================
// API 配置获取
// ============================================================
async function getAgentApiConfig() {
  try {
    const result = await chrome.storage.sync.get('apiConfig');
    const config = result.apiConfig || {
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-chat',
      provider: 'deepseek',
    };
    return config;
  } catch(e) {
    return { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat', provider: 'deepseek' };
  }
}

// ============================================================
// 自动标签（借鉴 EC ai_auto_tag）
// ============================================================
const KBAutoTagger = {
  /** 为条目自动生成标签建议 */
  async suggestTags(itemId) {
    const item = await KBItem.get(itemId);
    if (!item || !item.content) return [];
    
    const existingTags = await KBTag.getAll();
    const existingNames = new Set(existingTags.map(t => t.name));
    
    // 基于内容关键词匹配现有标签
    const content = (item.title + ' ' + item.content).toLowerCase();
    const suggested = [];
    
    existingTags.forEach(tag => {
      if (!existingNames.has(tag.name)) return;
      if (content.includes(tag.name.toLowerCase())) {
        suggested.push({ tag, score: 1, reason: '内容匹配' });
        existingNames.delete(tag.name);
      }
    });
    
    // 基于 URL 域名建议标签
    if (item.url) {
      try {
        const domain = new URL(item.url).hostname.replace('www.', '');
        const domainTag = domain.split('.')[0];
        if (domainTag.length > 2 && domainTag.length < 30 && !existingNames.has(domainTag)) {
          suggested.push({ name: domainTag, score: 0.5, reason: '域名来源' });
        }
      } catch(e) {}
    }
    
    return suggested;
  },

  /** 自动应用标签 */
  async autoTag(itemId) {
    const suggestions = await KBAutoTagger.suggestTags(itemId);
    for (const s of suggestions) {
      let tagId;
      if (s.tag) {
        tagId = s.tag.id;
      } else if (s.name) {
        tagId = await KBTag.create(s.name);
      }
      if (tagId) {
        await KBTag.linkItem(itemId, tagId, 'ai');
      }
    }
    return suggestions;
  }
};

// 导出
if (typeof self !== 'undefined') {
  self.AgentPermissions = AgentPermissions;
  self.AgentTools = AgentTools;
  self.KBAnalysis = KBAnalysis;
  self.KBAgent = KBAgent;
  self.KBAutoTagger = KBAutoTagger;
  self.buildRagContext = buildRagContext;
  self.buildCitation = buildCitation;
}