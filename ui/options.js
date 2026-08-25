/**
 * 无极 — 设置页面逻辑 V4.1
 * 侧边栏导航 + 各板块独立管理 + 广告过滤
 */

// ============================================================
// 侧边栏导航
// ============================================================
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const sectionId = item.dataset.section;
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');
    if (sectionId === 'sec-kb') loadKBStats();
    if (sectionId === 'sec-adblock') loadAdblockConfig();
    if (sectionId === 'sec-agent') loadAgentPermissions();
    if (sectionId === 'sec-suspend') loadSuspendConfig();
  });
});

// ============================================================
// Toggle 组件
// ============================================================
document.querySelectorAll('.toggle').forEach(toggle => {
  toggle.addEventListener('click', () => toggle.classList.toggle('on'));
});

// ============================================================
// 通用状态提示
// ============================================================
function showStatus(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text; el.className = 'status-msg show ' + type;
  setTimeout(() => { el.classList.remove('show'); }, 3000);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ============================================================
// 1. 语言模型设置
// ============================================================
const providerDefaults = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-plus' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas', model: 'glm-4-flash' },
  moonshot: { baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  spark: { baseUrl: 'https://spark-api-open.xf-yun.com', model: 'generalv3.5' },
  yi: { baseUrl: 'https://api.lingyiwanwu.com', model: 'yi-large' },
  wenxin: { baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom', model: 'ernie-3.5' },
  openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  claude: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-haiku' },
  minimax: { baseUrl: 'https://api.minimax.chat', model: 'abab6.5s-chat' },
  baichuan: { baseUrl: 'https://api.baichuan-ai.com', model: 'Baichuan4' },
  stepfun: { baseUrl: 'https://api.stepfun.com', model: 'step-1-flash' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn', model: 'Qwen/Qwen2.5-7B-Instruct' },
  groq: { baseUrl: 'https://api.groq.com/openai', model: 'mixtral-8x7b-32768' },
  mistral: { baseUrl: 'https://api.mistral.ai', model: 'mistral-small' },
  cohere: { baseUrl: 'https://api.cohere.ai', model: 'command-r' },
  perplexity: { baseUrl: 'https://api.perplexity.ai', model: 'sonar' },
  custom: { baseUrl: '', model: '' }
};

function getLLMConfig() {
  const provider = document.getElementById('provider-select').value;
  return { provider, apiKey: document.getElementById('api-key').value, model: document.getElementById('model-input').value, baseUrl: document.getElementById('base-url').value || (providerDefaults[provider]?.baseUrl || '') };
}

async function loadLLMConfig() {
  try {
    const r = await chrome.storage.sync.get('apiConfig');
    const c = r.apiConfig || { provider: 'deepseek', apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' };
    document.getElementById('provider-select').value = c.provider || 'deepseek';
    document.getElementById('api-key').value = c.apiKey || '';
    document.getElementById('model-input').value = c.model || (providerDefaults[c.provider]?.model || '');
    document.getElementById('base-url').value = c.baseUrl || (providerDefaults[c.provider]?.baseUrl || '');
    updateModelHint();
  } catch (e) { /* ignore */ }
}

function updateModelHint() {
  const provider = document.getElementById('provider-select').value;
  const hints = { deepseek: '常用: deepseek-chat / deepseek-reasoner', zhipu: '常用: glm-4-flash / glm-4.6v-flash (视觉)', qwen: '常用: qwen-plus / qwen-max', moonshot: '常用: moonshot-v1-8k / moonshot-v1-32k', openai: '常用: gpt-4o-mini / gpt-4o' };
  document.getElementById('model-hint').textContent = hints[provider] || '';
}

document.getElementById('provider-select').addEventListener('change', () => {
  const p = document.getElementById('provider-select').value;
  const d = providerDefaults[p];
  if (d?.baseUrl) document.getElementById('base-url').value = d.baseUrl;
  if (d?.model) document.getElementById('model-input').value = d.model;
  updateModelHint();
});

document.getElementById('save-llm-btn').addEventListener('click', async () => {
  await chrome.storage.sync.set({ apiConfig: getLLMConfig() });
  showStatus('llm-status', '配置已保存', 'success');
});

document.getElementById('test-llm-btn').addEventListener('click', async () => {
  const config = getLLMConfig();
  if (!config.apiKey) { showStatus('llm-status', '请先输入 API Key', 'error'); return; }
  showStatus('llm-status', '正在测试连接...', 'info');
  try {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const path = config.provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
    const resp = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }) });
    if (resp.ok) showStatus('llm-status', '连接成功！API 可用', 'success');
    else { const err = await resp.text(); showStatus('llm-status', `API 返回错误 ${resp.status}: ${err.substring(0, 100)}`, 'error'); }
  } catch (e) { showStatus('llm-status', '连接失败: ' + e.message, 'error'); }
});

// ============================================================
// 2. 视觉模型设置
// ============================================================
const visionProviderDefaults = {
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas', model: 'glm-4.6v-flash' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-vl-plus' },
  moonshot: { baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k-vision-preview' },
  openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash' },
  claude: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-haiku' },
  stepfun: { baseUrl: 'https://api.stepfun.com', model: 'step-1v-flash' },
  custom: { baseUrl: '', model: '' }
};

function getVisionConfig() {
  const p = document.getElementById('vision-provider-select').value;
  return { visionProvider: p, visionApiKey: document.getElementById('vision-api-key').value, visionModel: document.getElementById('vision-model-input').value, visionBaseUrl: document.getElementById('vision-base-url').value || (visionProviderDefaults[p]?.baseUrl || '') };
}

async function loadVisionConfig() {
  try {
    const r = await chrome.storage.sync.get('visionConfig');
    const c = r.visionConfig || { visionProvider: 'zhipu', visionApiKey: '', visionModel: 'glm-4.6v-flash', visionBaseUrl: 'https://open.bigmodel.cn/api/paas' };
    document.getElementById('vision-provider-select').value = c.visionProvider || 'zhipu';
    document.getElementById('vision-api-key').value = c.visionApiKey || '';
    document.getElementById('vision-model-input').value = c.visionModel || '';
    document.getElementById('vision-base-url').value = c.visionBaseUrl || '';
  } catch (e) {}
}

document.getElementById('vision-provider-select').addEventListener('change', () => {
  const p = document.getElementById('vision-provider-select').value;
  const d = visionProviderDefaults[p];
  if (d?.baseUrl) document.getElementById('vision-base-url').value = d.baseUrl;
  if (d?.model) document.getElementById('vision-model-input').value = d.model;
});

document.getElementById('save-vision-btn').addEventListener('click', async () => {
  await chrome.storage.sync.set({ visionConfig: getVisionConfig() });
  showStatus('vision-status', '视觉模型配置已保存', 'success');
});

document.getElementById('test-vision-btn').addEventListener('click', async () => {
  const config = getVisionConfig();
  if (!config.visionApiKey) { showStatus('vision-status', '请先输入 API Key', 'error'); return; }
  showStatus('vision-status', '正在测试...', 'info');
  try {
    const baseUrl = config.visionBaseUrl.replace(/\/+$/, '');
    const path = config.visionProvider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
    const resp = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.visionApiKey}` }, body: JSON.stringify({ model: config.visionModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }) });
    if (resp.ok) showStatus('vision-status', '连接成功！', 'success');
    else { const err = await resp.text(); showStatus('vision-status', `错误 ${resp.status}: ${err.substring(0, 100)}`, 'error'); }
  } catch (e) { showStatus('vision-status', '连接失败: ' + e.message, 'error'); }
});

// ============================================================
// 3. 网页翻译设置
// ============================================================
const tranProviderDefaults = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-plus' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas', model: 'glm-4-flash' },
  moonshot: { baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  spark: { baseUrl: 'https://spark-api-open.xf-yun.com', model: 'generalv3.5' },
  yi: { baseUrl: 'https://api.lingyiwanwu.com', model: 'yi-large' },
  wenxin: { baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom', model: 'ernie-3.5' },
  claude: { baseUrl: 'https://api.anthropic.com', model: 'claude-3-haiku' },
  minimax: { baseUrl: 'https://api.minimax.chat', model: 'abab6.5s-chat' },
  baichuan: { baseUrl: 'https://api.baichuan-ai.com', model: 'Baichuan4' },
  stepfun: { baseUrl: 'https://api.stepfun.com', model: 'step-1-flash' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn', model: 'Qwen/Qwen2.5-7B-Instruct' },
  groq: { baseUrl: 'https://api.groq.com/openai', model: 'mixtral-8x7b-32768' },
  mistral: { baseUrl: 'https://api.mistral.ai', model: 'mistral-small' },
  cohere: { baseUrl: 'https://api.cohere.ai', model: 'command-r' },
  perplexity: { baseUrl: 'https://api.perplexity.ai', model: 'sonar' },
  custom: { baseUrl: '', model: '' }
};

function getTranApiConfig() {
  const provider = document.getElementById('tran-provider-select').value;
  return { provider, apiKey: document.getElementById('tran-api-key').value, model: document.getElementById('tran-model-input').value, baseUrl: document.getElementById('tran-base-url').value || (tranProviderDefaults[provider]?.baseUrl || '') };
}

async function loadTranslateConfig() {
  try {
    const r = await chrome.storage.sync.get('translatorConfig');
    const c = r.translatorConfig || { hoverEnabled: true, inputEnabled: false, targetLang: 'zh-CN', displayMode: 'bilingual', fontSize: '13px', transColor: '#6366f1', cacheEnabled: true };
    document.getElementById('tran-hover-toggle').classList.toggle('on', c.hoverEnabled !== false);
    document.getElementById('tran-input-toggle').classList.toggle('on', c.inputEnabled === true);
    document.getElementById('tran-target-lang').value = c.targetLang || 'zh-CN';
    document.getElementById('tran-display-mode').value = c.displayMode || 'bilingual';
    document.getElementById('tran-color').value = c.transColor || '#6366f1';
    document.getElementById('tran-font-size').value = c.fontSize || '13px';
    const tApi = await chrome.storage.sync.get('translatorApiConfig');
    const tApiConfig = tApi.translatorApiConfig || {};
    document.getElementById('tran-provider-select').value = tApiConfig.provider || 'deepseek';
    document.getElementById('tran-api-key').value = tApiConfig.apiKey || '';
    document.getElementById('tran-model-input').value = tApiConfig.model || '';
    document.getElementById('tran-base-url').value = tApiConfig.baseUrl || '';
  } catch (e) { /* ignore */ }
}

document.getElementById('tran-provider-select').addEventListener('change', () => {
  const p = document.getElementById('tran-provider-select').value;
  const d = tranProviderDefaults[p];
  if (d?.baseUrl) document.getElementById('tran-base-url').value = d.baseUrl;
  if (d?.model) document.getElementById('tran-model-input').value = d.model;
});

async function testTranApi() {
  const config = getTranApiConfig();
  let apiKey = config.apiKey;
  if (!apiKey) {
    const r = await chrome.storage.sync.get('apiConfig');
    apiKey = r.apiConfig?.apiKey || '';
  }
  if (!apiKey) { showStatus('tran-status', '请先输入翻译 API Key 或配置语言模型 API Key', 'error'); return; }
  showStatus('tran-status', '正在测试翻译 API...', 'info');
  try {
    const baseUrl = (config.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const path = config.provider === 'zhipu' ? '/v4/chat/completions' : '/v1/chat/completions';
    const resp = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }, body: JSON.stringify({ model: config.model || 'deepseek-chat', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }) });
    if (resp.ok) showStatus('tran-status', '翻译 API 连接成功！', 'success');
    else { const err = await resp.text(); showStatus('tran-status', `API 返回错误 ${resp.status}: ${err.substring(0, 100)}`, 'error'); }
  } catch (e) { showStatus('tran-status', '连接失败: ' + e.message, 'error'); }
}

async function saveTranslate() {
  const config = {
    hoverEnabled: document.getElementById('tran-hover-toggle').classList.contains('on'),
    inputEnabled: document.getElementById('tran-input-toggle').classList.contains('on'),
    targetLang: document.getElementById('tran-target-lang').value,
    displayMode: document.getElementById('tran-display-mode').value,
    fontSize: document.getElementById('tran-font-size').value,
    transColor: document.getElementById('tran-color').value,
    cacheEnabled: true
  };
  const tApiConfig = getTranApiConfig();
  await chrome.storage.sync.set({ translatorConfig: config, translatorApiConfig: tApiConfig });
  showStatus('tran-status', '翻译设置和 API 配置已保存', 'success');
}

async function clearTranslateCache() {
  await chrome.storage.local.remove('translatorCache');
  showStatus('tran-status', '翻译缓存已清空', 'success');
}

document.getElementById('save-tran-btn').addEventListener('click', saveTranslate);
document.getElementById('test-tran-api-btn').addEventListener('click', testTranApi);
document.getElementById('clear-tran-cache-btn').addEventListener('click', clearTranslateCache);

// ============================================================
// 4. 知识库
// ============================================================
async function loadKBStats() {
  try {
    // 使用 V2 API 获取统计
    const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_STATS' });
    if (resp?.success && resp.data) {
      const d = resp.data;
      document.getElementById('stat-pages').textContent = d.total || '0';
      document.getElementById('stat-chats').textContent = d.favorites || '0';
      document.getElementById('stat-files').textContent = d.tags || '0';
      // 更新标签文案
      document.querySelector('#stat-pages').parentElement.querySelector('.label').textContent = '条目总数';
      document.querySelector('#stat-chats').parentElement.querySelector('.label').textContent = '收藏';
      document.querySelector('#stat-files').parentElement.querySelector('.label').textContent = '标签';
    }
    // 同时用旧 API 获取兼容数据（旧版 kb_pages/kb_chats/kb_files 表）
    try {
      const oldResp = await chrome.runtime.sendMessage({ type: 'KB_STATS' });
      if (oldResp?.success && (!resp?.success || oldResp.data.total > 0)) {
        document.getElementById('stat-pages').textContent = oldResp.data.pages || '0';
        // 还原标签
        document.querySelector('#stat-pages').parentElement.querySelector('.label').textContent = '网页';
        document.querySelector('#stat-chats').parentElement.querySelector('.label').textContent = '对话';
        document.querySelector('#stat-files').parentElement.querySelector('.label').textContent = '文件';
      }
    } catch(e) {}
  } catch (e) { /* ignore */ }
}

async function clearKBStore(store) {
  try { await chrome.runtime.sendMessage({ type: 'KB_CLEAR', payload: { store } }); showStatus('kb-status', '已清空', 'success'); loadKBStats(); }
  catch (e) { showStatus('kb-status', '操作失败', 'error'); }
}

document.getElementById('clear-pages-btn').addEventListener('click', () => clearKBStore('kb_pages'));
document.getElementById('clear-chats-btn').addEventListener('click', () => clearKBStore('kb_chats'));
document.getElementById('clear-all-kb-btn').addEventListener('click', async () => {
  if (confirm('确定清空全部知识库数据？此操作不可恢复。')) {
    try { await chrome.runtime.sendMessage({ type: 'KB_CLEAR', payload: {} }); showStatus('kb-status', '知识库已全部清空', 'success'); loadKBStats(); }
    catch (e) { showStatus('kb-status', '操作失败', 'error'); }
  }
});

// ============================================================
// 5. 聊天缓存与重置
// ============================================================
document.getElementById('clear-chat-cache-btn').addEventListener('click', async () => {
  try { await chrome.storage.local.remove('wuji_conversation'); showStatus('cache-status', '聊天记录已清空', 'success'); }
  catch (e) { showStatus('cache-status', '操作失败', 'error'); }
});

document.getElementById('reset-all-btn').addEventListener('click', async () => {
  if (!confirm('确定重置全部配置？这将清除所有 API 设置。此操作不可恢复！')) return;
  try { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); setTimeout(() => window.location.reload(), 500); showStatus('cache-status', '全部配置已重置，页面即将刷新', 'success'); }
  catch (e) { showStatus('cache-status', '重置失败', 'error'); }
});

// ============================================================
// 6. 广告过滤设置
// ============================================================
async function loadAdblockConfig() {
  try {
    const statsResp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_GET_STATS' });
    if (statsResp?.success) {
      const s = statsResp.stats;
      document.getElementById('adblock-dnr-num').textContent = s.dnrRuleCount || '0';
      document.getElementById('adblock-css-num').textContent = (s.cosmeticGlobalCount || 0) + (s.cosmeticDomainCount || 0);
      document.getElementById('adblock-enabled-toggle').classList.toggle('on', s.enabled !== false);
      if (s.updatedAt) {
        document.getElementById('adblock-updated-at').textContent = '最后更新：' + new Date(s.updatedAt).toLocaleString('zh-CN');
      }
    }

    const listsResp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_GET_LISTS' });
    if (listsResp?.success && listsResp.lists?.length > 0) {
      const container = document.getElementById('filter-lists-container');
      container.innerHTML = '';
      listsResp.lists.forEach(list => {
        const item = document.createElement('div');
        item.className = 'filter-list-item';
        item.innerHTML = '<div style="flex:1;"><div class="list-name">' + esc(list.name) + '</div><div class="list-desc">' + esc(list.description || '') + '</div></div><div class="toggle ' + (list.enabled ? 'on' : '') + '" data-list-id="' + list.id + '"></div>';
        item.querySelector('.toggle').addEventListener('click', () => {
          list.enabled = !list.enabled;
          item.querySelector('.toggle').classList.toggle('on', list.enabled);
          saveFilterLists(listsResp.lists);
        });
        container.appendChild(item);
      });
    }
  } catch (e) { /* ignore */ }
  loadWhitelistUI();
}

async function saveFilterLists(lists) {
  await chrome.runtime.sendMessage({ type: 'ADBLOCK_SAVE_LISTS', lists });
  showStatus('adblock-status', '过滤列表已保存，下次更新规则时生效', 'success');
}

document.getElementById('adblock-enabled-toggle').addEventListener('click', async () => {
  const toggle = document.getElementById('adblock-enabled-toggle');
  const enabled = !toggle.classList.contains('on');
  toggle.classList.toggle('on');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_TOGGLE', enabled });
    if (resp?.success) showStatus('adblock-status', enabled ? '广告过滤已启用' : '广告过滤已禁用', 'success');
  } catch (e) { showStatus('adblock-status', '操作失败: ' + e.message, 'error'); }
});

document.getElementById('adblock-update-btn').addEventListener('click', async () => {
  showStatus('adblock-status', '正在更新规则，可能需要几十秒...', 'info');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_UPDATE_RULES' });
    if (resp?.success) { showStatus('adblock-status', '规则已更新到所有页面', 'success'); setTimeout(() => loadAdblockConfig(), 1000); }
    else showStatus('adblock-status', '更新失败: ' + (resp?.error || '未知错误'), 'error');
  } catch (e) { showStatus('adblock-status', '更新失败: ' + e.message, 'error'); }
});

document.getElementById('adblock-clear-btn').addEventListener('click', async () => {
  if (!confirm('确定清除所有广告过滤规则？')) return;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_CLEAR_RULES' });
    if (resp?.success) { showStatus('adblock-status', '所有规则已清除', 'success'); loadAdblockConfig(); }
  } catch (e) { showStatus('adblock-status', '清除失败: ' + e.message, 'error'); }
});

// ============================================================
// 广告过滤白名单管理
// ============================================================
function detectSiteName(domain) {
  const clean = domain.replace(/^www\./, '').replace(/\.[^.]+$/, '');
  if (clean.length <= 3) return clean.toUpperCase();
  // 驼峰化每个部分
  return clean.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

async function loadWhitelistUI() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_LIST' });
    const items = resp?.success ? (resp.items || []) : [];
    document.getElementById('adblock-wl-count').textContent = `当前白名单：${items.length} 个网站`;
    const listEl = document.getElementById('adblock-wl-list');
    if (items.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text-tertiary);">暂无白名单网站</div>';
    } else {
      listEl.innerHTML = items.map(item => `
        <div class="filter-list-item" style="margin-bottom:4px;">
          <div style="flex:1;"><span style="font-weight:500;">${esc(item.name || item.domain)}</span>
            <span style="font-size:11px;color:var(--text-tertiary);margin-left:8px;">${esc(item.domain)}</span></div>
          <button class="btn btn-sm" style="background:rgba(239,68,68,0.08);color:var(--danger);border:1px solid rgba(239,68,68,0.2);padding:3px 10px;font-size:11px;" data-domain="${esc(item.domain)}">移除</button>
        </div>
      `).join('');
      // 绑定移除按钮
      listEl.querySelectorAll('[data-domain]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_REMOVE', domain: btn.dataset.domain });
          if (resp?.success) { showStatus('adblock-status', '已从白名单移除', 'success'); loadWhitelistUI(); }
        });
      });
    }
  } catch (e) { /* ignore */ }
}

document.getElementById('adblock-wl-add-btn').addEventListener('click', async () => {
  const input = document.getElementById('adblock-wl-input');
  let domain = input.value.trim().toLowerCase();
  if (!domain) { showStatus('adblock-status', '请输入域名', 'error'); return; }
  // 从完整URL中提取域名
  try { domain = new URL(domain.includes('://') ? domain : 'https://' + domain).hostname; }
  catch(e) { /* 保持原值 */ }
  const name = detectSiteName(domain);
  const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_ADD_NAMED', domain, name });
  if (resp?.success) { showStatus('adblock-status', `已添加 ${name} (${domain}) 到白名单`, 'success'); input.value = ''; loadWhitelistUI(); }
  else { showStatus('adblock-status', resp?.error || '添加失败', 'error'); }
});

document.getElementById('adblock-wl-current-btn').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { showStatus('adblock-status', '无法获取当前网站', 'error'); return; }
    const domain = new URL(tab.url).hostname;
    const name = detectSiteName(domain);
    const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_ADD_NAMED', domain, name });
    if (resp?.success) { showStatus('adblock-status', `已添加 ${name} (${domain}) 到白名单`, 'success'); loadWhitelistUI(); }
    else { showStatus('adblock-status', resp?.error || '添加失败', 'error'); }
  } catch (e) { showStatus('adblock-status', '获取当前网站失败', 'error'); }
});

document.getElementById('adblock-wl-clear-btn').addEventListener('click', async () => {
  if (!confirm('确定清空所有白名单网站？')) return;
  const resp = await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_CLEAR' });
  if (resp?.success) { showStatus('adblock-status', '白名单已清空', 'success'); loadWhitelistUI(); }
});

// 输入框回车添加
document.getElementById('adblock-wl-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('adblock-wl-add-btn').click();
});

// ============================================================
// 7. Agent 权限设置
// ============================================================
async function loadAgentPermissions() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_AGENT_PERMISSIONS', payload: { action: 'load' } });
    if (resp?.success && resp.data) {
      const perms = resp.data;
      document.getElementById('agent-can-manage-folders').classList.toggle('on', perms.can_manage_folders !== false);
      document.getElementById('agent-can-parse-content').classList.toggle('on', perms.can_parse_content !== false);
      document.getElementById('agent-can-web-search').classList.toggle('on', perms.can_web_search !== false);
      document.getElementById('agent-can-execute-commands').classList.toggle('on', perms.can_execute_commands === true);
      document.getElementById('agent-auto-tag').classList.toggle('on', perms.can_auto_tag === true);
    }
  } catch(e) { /* ignore */ }
}

document.getElementById('save-agent-perms-btn').addEventListener('click', async () => {
  const perms = {
    can_manage_folders: document.getElementById('agent-can-manage-folders').classList.contains('on'),
    can_parse_content: document.getElementById('agent-can-parse-content').classList.contains('on'),
    can_web_search: document.getElementById('agent-can-web-search').classList.contains('on'),
    can_execute_commands: document.getElementById('agent-can-execute-commands').classList.contains('on'),
    can_auto_tag: document.getElementById('agent-auto-tag').classList.contains('on'),
  };
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'KB_V2_AGENT_PERMISSIONS', payload: { action: 'save', permissions: perms } });
    if (resp?.success) showStatus('agent-status', 'Agent 权限已保存', 'success');
    else showStatus('agent-status', '保存失败', 'error');
  } catch(e) { showStatus('agent-status', '保存失败: ' + e.message, 'error'); }
});

// ============================================================
// 8. 标签页休眠设置
// ============================================================
async function loadSuspendConfig() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_GET_SETTINGS' });
    if (resp?.success && resp.settings) {
      const s = resp.settings;
      document.getElementById('suspend-enabled-toggle').classList.toggle('on', s.enabled !== false);
      document.getElementById('suspend-time-select').value = String(s.suspendTime || 60);
      document.getElementById('suspend-pinned-toggle').classList.toggle('on', s.dontSuspendPinned !== false);
      document.getElementById('suspend-audible-toggle').classList.toggle('on', s.dontSuspendAudible !== false);
      document.getElementById('suspend-forms-toggle').classList.toggle('on', s.dontSuspendForms !== false);
      document.getElementById('suspend-active-toggle').classList.toggle('on', s.dontSuspendActiveTabs !== false);
      document.getElementById('suspend-focus-toggle').classList.toggle('on', s.unsuspendOnFocus === true);
      document.getElementById('suspend-whitelist').value = s.whitelist || '';
    }
  } catch (e) { /* ignore */ }
}

document.getElementById('save-suspend-btn').addEventListener('click', async () => {
  const settings = {
    enabled: document.getElementById('suspend-enabled-toggle').classList.contains('on'),
    suspendTime: parseInt(document.getElementById('suspend-time-select').value) || 60,
    dontSuspendPinned: document.getElementById('suspend-pinned-toggle').classList.contains('on'),
    dontSuspendAudible: document.getElementById('suspend-audible-toggle').classList.contains('on'),
    dontSuspendForms: document.getElementById('suspend-forms-toggle').classList.contains('on'),
    dontSuspendActiveTabs: document.getElementById('suspend-active-toggle').classList.contains('on'),
    unsuspendOnFocus: document.getElementById('suspend-focus-toggle').classList.contains('on'),
    whitelist: document.getElementById('suspend-whitelist').value,
    screenCapture: '0'
  };
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_SAVE_SETTINGS', settings });
    if (resp?.success) showStatus('suspend-status', '标签页休眠设置已保存', 'success');
    else showStatus('suspend-status', '保存失败: ' + (resp?.error || '未知错误'), 'error');
  } catch (e) { showStatus('suspend-status', '保存失败: ' + e.message, 'error'); }
});

// ============================================================
// 初始化
// ============================================================
async function init() {
  loadLLMConfig();
  loadVisionConfig();
  loadTranslateConfig();
  loadKBStats();
}
init();
