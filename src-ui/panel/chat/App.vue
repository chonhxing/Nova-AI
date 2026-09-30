<script>
/**
 * 无极 — 悬浮聊天面板（Vue 3）
 * 从 libs/content.js 原样移植（本回合 Read 核对过原文 481-1354 行）：
 *   · 顶栏（品牌+版本+主题循环+压缩历史+关闭）
 *   · 对话/知识库双 Tab（胶囊分段）
 *   · 空态（球+3 张建议卡）· 消息行（用户/AI/系统气泡+头像+时间行）
 *   · 流式输出：rAF 逐字揭示 + 光标，追上即停（修掉原实现"每帧全量
 *     innerHTML 重建 + 永不停止的 rAF 空转"），完成后一次性 Markdown
 *   · 快捷操作栏（分析网页/识别图片/保存知识库）
 *   · 输入栏（Enter 发送/Shift+Enter 换行/IME keyCode 229 守卫/自动增高）
 *   · 状态行（状态点 error/busy）· 知识库列表（搜索防抖/收藏/删除）
 *   · 拖拽移动（v-drag 指令，document 级监听在 unmount 时移除——
 *     修掉原实现 document 监听永不移除的泄漏）
 * 业务消息（发送/AI 调用/历史持久化/压缩/KB）全部由 content.js 持有，
 * 经 bridge 双向通道对接；本组件是纯视图 + 本地 UI 状态。
 */
import { ICO } from '../icons.js';
import { renderMarkdown, cleanToolCallsFromText } from '../markdown.js';

const THEME_ICONS = { auto: () => ICO.monitor, light: () => ICO.sun, dark: () => ICO.moonCrescent };
const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };

// 工具调用结果展示名（content.js:1099-1109 原样）
const TOOL_NAMES = {
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

// 空态建议卡（content.js:534-545 原样）
const SUGGESTIONS = [
  { icon: ICO.bulb, prompt: '请分析这个页面，总结 3-5 个主要要点。', title: '分析此页面', desc: '总结主要内容' },
  { icon: ICO.doc, prompt: '总结这个页面的要点，用简洁的列表呈现。', title: '总结要点', desc: '快速了解页面说了什么' },
  { icon: ICO.book, prompt: '基于知识库中相关内容，回答我的问题。', title: '查询知识库', desc: '搜索已保存的网页和笔记' },
];

let nextMsgId = 1;

export default {
  name: 'ChatPanelApp',
  inject: ['bridge', 'host'],
  data() {
    return {
      ICO,   // 模板需访问图标表
      version: '',
      tab: 'chat',
      messages: [],            // { id, role: 'user'|'assistant'|'system', content, html?, time? }
      streaming: false,
      streamText: '',
      revealed: 0,
      draft: '',
      processing: false,
      statusText: '就绪',
      statusError: false,
      statusBusy: false,
      theme: 'auto',
      kbItems: [],
      kbSearch: '',
      _raf: null,
      _kbTimer: null,
      _onStorageChanged: null,
    };
  },
  computed: {
    themeIcon() { return (THEME_ICONS[this.theme] || THEME_ICONS.auto)(); },
    themeLabel() { return THEME_LABELS[this.theme] || THEME_LABELS.auto; },
    revealedText() { return this.streamText.slice(0, this.revealed); },
    // 流式期间同样剥离工具调用 JSON（原实现每帧清理；未闭合的 JSON 连同其后内容先隐藏）
    revealedDisplay() { return cleanToolCallsFromText(this.revealedText); },
    showEmpty() { return !this.messages.length && !this.streaming; },
    suggestions() { return SUGGESTIONS; },
  },
  mounted() {
    this.version = this.bridge.getVersion() || '';
    this.loadTheme();
    this.hydrateHistory();
    // 其他页面（设置页/弹窗）改外观偏好时，已打开的面板实时跟随；
    // 监听在 unmount 时移除（修掉原实现 document/storage 监听不释放的问题）
    this._onStorageChanged = (changes, area) => {
      if (area === 'sync' && changes.uiConfig) {
        const t = changes.uiConfig.newValue?.theme;
        if (t === 'light' || t === 'dark' || t === 'auto') this.applyTheme(t);
      }
    };
    try { chrome.storage.onChanged.addListener(this._onStorageChanged); } catch (e) { /* ignore */ }
    setTimeout(() => { this.$refs.inputEl?.focus(); }, 100);
  },
  beforeUnmount() {
    this.stopReveal();
    if (this._kbTimer) { clearTimeout(this._kbTimer); this._kbTimer = null; }
    if (this._onStorageChanged) {
      try { chrome.storage.onChanged.removeListener(this._onStorageChanged); } catch (e) { /* ignore */ }
      this._onStorageChanged = null;
    }
  },
  methods: {
    // ============================================================
    // 流式渲染（性能核心重写）
    // 流式中：纯文本逐字揭示（每帧 ~3 字符），追上即停 rAF——
    // 修掉原实现"每帧全量 innerHTML 重建 + 追上后 rAF 继续空转"；
    // 完成后：一次性 v-html 渲染完整 Markdown。
    // ============================================================
    beginStream() {
      this.stopReveal();
      this.streaming = true;
      this.streamText = '';
      this.revealed = 0;
      this.scheduleReveal();
    },
    pushDelta(delta) {
      if (!this.streaming) this.beginStream();
      this.streamText += delta;
      this.scheduleReveal();   // 新内容到达：续拍揭示循环（追上即停）
    },
    scheduleReveal() {
      if (this._raf) return;
      const tick = () => {
        this._raf = null;
        const target = this.streamText.length;
        if (this.revealed >= target) return;      // 追上即停，不再空转 rAF
        this.revealed = Math.min(target, this.revealed + 3);
        this.maybeAutoScroll();
        if (this.revealed < this.streamText.length) this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    },
    stopReveal() {
      if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    },
    streamDone() {
      this.stopReveal();
      const raw = cleanToolCallsFromText(this.streamText);
      const html = renderMarkdown(raw);
      this.messages.push({ id: nextMsgId++, role: 'assistant', content: raw, html, time: this.now() });
      this.streaming = false;
      this.streamText = '';
      this.revealed = 0;
      this.processing = false;
      this.setStatus('就绪');
      this.bridge.persistAssistant(raw);        // content.js 落历史 + 关闭处理中
      this.maybeAutoScroll(true);
      setTimeout(() => { this.$refs.inputEl?.focus(); }, 100);
    },
    streamError(msg) {
      this.stopReveal();
      this.messages.push({ id: nextMsgId++, role: 'system', content: '❌ 调用失败: ' + (msg || '未知错误') });
      this.streaming = false;
      this.streamText = '';
      this.revealed = 0;
      this.processing = false;
      this.setStatus('调用失败', true);
      this.bridge.abortProcessing?.();
      this.maybeAutoScroll(true);
    },
    // ============================================================
    // 消息与状态（content.js:768-859 对应功能的响应式移植）
    // ============================================================
    now() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); },
    // 存储契约用 assistant，样式沿用原实现的 ai（.msg-row.ai / .ai-block）
    rowClass(role) { return role === 'assistant' ? 'ai' : role; },
    addMessage(msg) {
      const m = { id: nextMsgId++, time: this.now(), ...msg };
      if (m.role === 'assistant' && !m.html) m.html = renderMarkdown(m.content || '');
      this.messages.push(m);
      this.maybeAutoScroll(true);
      return m;
    },
    setStatus(text, isError = false, isBusy = false) {
      this.statusText = text;
      this.statusError = !!isError;
      this.statusBusy = !!isBusy;
    },
    setProcessing(v) { this.processing = !!v; },
    maybeAutoScroll(force = false) {
      const el = this.$refs.msgArea;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
      if (force || nearBottom) el.scrollTop = el.scrollHeight;   // 仅在用户贴近底部时跟随
    },
    // ============================================================
    // 发送（content.js handleSend 861-916 的职责拆分：UI 在此，业务在 bridge）
    // ============================================================
    async send() {
      const text = this.draft.trim();
      if (!text || this.processing) return;
      this.addMessage({ role: 'user', content: text });
      this.draft = '';
      this.autoGrow();
      this.processing = true;
      this.beginStream();
      this.setStatus('AI 思考中...', false, true);
      try {
        await this.bridge.sendPrompt(text);
        // 成功受理后流式内容经 AI_STREAM_DELTA 异步到达，DONE 时 streamDone 收尾
      } catch (e) {
        this.streamError(e.message);
      }
    },
    onKeydown(e) {
      // 中文输入法组词中的 Enter 不发送（isComposing / keyCode 229 均为输入法态）
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        this.send();
      }
    },
    autoGrow() {
      const ta = this.$refs.inputEl;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
    },
    quickPrompt(prompt) {
      if (this.processing || !prompt) return;
      this.draft = prompt;
      this.send();
    },
    // ============================================================
    // 快捷操作栏（content.js:647-671 对应功能）
    // ============================================================
    async compress() {
      if (this.processing) return;
      this.processing = true;
      const b = this.systemStatus('🗜️ 正在压缩对话历史...');
      this.setStatus('压缩中...', false, true);
      const r = await this.bridge.compress();
      if (r.ok) {
        this.messages = [{ id: nextMsgId++, role: 'system', content: '📝 对话摘要：\n' + r.summary }];
        const extra = r.originalTokens != null ? `（${r.originalTokens} → ${r.compressedTokens} tokens）` : '';
        this.setStatus('✅ 对话已压缩' + extra);
      } else {
        this.updateSystem(b.id, '压缩失败: ' + (r.error || '未知错误'));
        this.setStatus('就绪');
      }
      this.processing = false;
      this.maybeAutoScroll(true);
    },
    async saveKB() {
      if (this.processing) return;
      const b = this.systemStatus('正在保存到知识库（V2 引擎）...');
      this.setStatus('正在保存...');
      const r = await this.bridge.saveToKB();
      this.updateSystem(b.id, r.message);
      this.setStatus('就绪');
    },
    async videoSummary() {
      const b = this.systemStatus('正在获取视频字幕并生成摘要...');
      this.setStatus('正在生成视频摘要...');
      const r = await this.bridge.videoSummary();
      if (r.streaming) {
        // 摘要走流式链路：移除占位气泡，开流（与原实现一致：不补用户气泡，仅 history 补记）
        this.messages = this.messages.filter(m => m.id !== b.id);
        this.processing = true;
        this.beginStream();
        this.setStatus('生成中...', false, true);
        return;
      }
      this.updateSystem(b.id, r.message);
      this.setStatus('就绪');
    },
    analyzeImage() {
      if (this.processing) return;
      this.bridge.analyzeImage();   // 图片选择器弹窗仍由 content.js 原生实现
    },
    // ============================================================
    // 工具/动作结果（content.js:1061-1117 移植）
    // ============================================================
    actionResults(results) {
      if (!results || !results.length) return;
      let text = '';
      results.forEach((r, i) => {
        const icon = r.success ? '✓' : '✗';
        text += `${icon} ${r.action} ${r.selector || ''}\n`;
        if (r.success && r.result) text += typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 1);
        else if (r.error) text += '错误: ' + r.error;
        if (i < results.length - 1) text += '\n---\n';
      });
      this.addMessage({ role: 'system', content: '操作结果\n' + text, pre: true });
    },
    toolResult(msg) {
      const label = TOOL_NAMES[msg.tool] || '🔧 ' + msg.tool;
      const icon = msg.success ? '✅' : '❌';
      this.addMessage({ role: 'system', content: `${icon} ${label}: ${msg.summary}` });
      // 注意：不把工具结果 persist 进历史（多轮工具上下文由 SW 自行管理）
    },
    systemStatus(text) { return this.addMessage({ role: 'system', content: text }); },
    updateSystem(id, text) {
      const m = this.messages.find(x => x.id === id);
      if (m) m.content = text;
    },
    // ============================================================
    // 知识库 Tab（content.js:703-718 / 1225-1282 移植）
    // ============================================================
    switchTab(tab) {
      this.tab = tab;
      if (tab === 'knowledge') this.loadKB();
    },
    async loadKB() {
      this.kbItems = await this.bridge.loadKB();
    },
    onKbSearch() {
      clearTimeout(this._kbTimer);
      this._kbTimer = setTimeout(async () => {
        const q = this.kbSearch.trim();
        if (!q) { this.loadKB(); return; }
        this.kbItems = await this.bridge.searchKB(q);
      }, 300);
    },
    async toggleFav(item) {
      if (await this.bridge.toggleKBFavorite(item.id)) this.loadKB();
    },
    async deleteKB(item) {
      if (!confirm('确定删除？这将同时删除相关内容块、标签关联、高亮和笔记。')) return;
      await this.bridge.deleteKB(item.id);
      this.loadKB();
    },
    sourceLabel(t) { return t === 'page' ? '🌐 网页' : t === 'chat' ? '💬 对话' : '📁 文件'; },
    fmtTime(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    tagBg(color) { return /^#[0-9a-fA-F]{3,8}$/.test(color || '') ? color : '#e5e7eb'; },
    // ============================================================
    // 外观（content.js:604-632 移植；监听在 beforeUnmount 释放）
    // ============================================================
    loadTheme() {
      try {
        chrome.storage.sync.get('uiConfig', (r) => {
          const t = r?.uiConfig?.theme;
          if (t === 'light' || t === 'dark' || t === 'auto') this.applyTheme(t);
        });
      } catch (e) { /* ignore */ }
    },
    applyTheme(theme) {
      this.theme = theme;
      // colorScheme 设在宿主上，light-dark() 随之解析（与原 applyChatTheme 一致）
      this.host.style.colorScheme = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : 'light dark';
    },
    cycleTheme() {
      const next = this.theme === 'auto' ? 'light' : this.theme === 'light' ? 'dark' : 'auto';
      this.applyTheme(next);
      try {
        // 合并写入避免覆盖 uiConfig 其他键（原代码整对象覆盖，这里顺手修正）
        chrome.storage.sync.get('uiConfig', (r) => {
          chrome.storage.sync.set({ uiConfig: { ...(r.uiConfig || {}), theme: next } });
        });
      } catch (e) { /* ignore */ }
    },
    close() {
      this.bridge.requestClose();   // content.js 真卸载（unmount + 移除宿主）
    },
    hydrateHistory() {
      const history = this.bridge.getHistory() || [];
      for (const m of history) {
        if (m.role === 'user') this.messages.push({ id: nextMsgId++, role: 'user', content: m.content });
        else if (m.role === 'assistant') this.messages.push({ id: nextMsgId++, role: 'assistant', content: m.content, html: renderMarkdown(m.content) });
        else this.messages.push({ id: nextMsgId++, role: 'system', content: m.content });
      }
      if (this.messages.length) this.maybeAutoScroll(true);
    },
  },
  directives: {
    // 拖拽（content.js makeDraggable 722-746 移植）：
    // document 级监听在 unmount 时移除——修掉原实现"拖拽后监听永不移除"的泄漏
    drag: {
      mounted(el, binding) {
        const host = binding.value;
        let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
        const onMove = (e) => {
          if (!dragging) return;
          host.style.left = (origLeft + e.clientX - startX) + 'px';
          host.style.top = (origTop + e.clientY - startY) + 'px';
          host.style.right = 'auto';
          host.style.bottom = 'auto';
          e.preventDefault();
        };
        const onUp = () => { dragging = false; };
        el.addEventListener('mousedown', (e) => {
          if (e.target.closest('.icon-btn')) return;  // 不拦截顶栏按钮
          dragging = true;
          startX = e.clientX; startY = e.clientY;
          const rect = host.getBoundingClientRect();
          origLeft = rect.left; origTop = rect.top;
          e.preventDefault();
        });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        el.__wujiDragCleanup = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
      },
      unmounted(el) {
        if (el.__wujiDragCleanup) { el.__wujiDragCleanup(); delete el.__wujiDragCleanup; }
      },
    },
  },
};
</script>

<template>
  <div class="panel">
    <!-- 顶栏 -->
    <div class="top-bar" v-drag="host">
      <div class="brand">
        <div class="brand-mark" v-html="ICO.brand"></div>
        <span class="title">无极<span v-if="version" class="ver">v{{ version }}</span></span>
      </div>
      <button class="icon-btn" :title="'外观：' + themeLabel" v-html="themeIcon" @click="cycleTheme"></button>
      <button class="icon-btn icon-btn--circle" title="压缩对话（省 tokens）" v-html="ICO.compress" @click="compress"></button>
      <button class="icon-btn" title="关闭" v-html="ICO.x" @click="close"></button>
    </div>

    <!-- 标签栏 -->
    <div class="tab-bar">
      <button class="tab-btn" :class="{ active: tab === 'chat' }" @click="tab = 'chat'">
        <span v-html="ICO.chat"></span>对话
      </button>
      <button class="tab-btn" :class="{ active: tab === 'knowledge' }" @click="switchTab('knowledge')">
        <span v-html="ICO.book"></span>知识库
      </button>
    </div>

    <!-- 消息区 -->
    <div v-show="tab === 'chat'" ref="msgArea" class="message-area">
      <div v-if="showEmpty" class="empty-state">
        <div class="orb" v-html="ICO.brand"></div>
        <div class="title">无极已就绪</div>
        <div class="subtitle">有什么想问的？</div>
        <div class="suggestions">
          <button v-for="s in suggestions" :key="s.title" class="suggestion" @click="quickPrompt(s.prompt)">
            <span class="s-ico" v-html="s.icon"></span>
            <span class="s-txt"><b>{{ s.title }}</b><span>{{ s.desc }}</span></span>
          </button>
        </div>
      </div>

      <div v-for="m in messages" :key="m.id" class="msg-row" :class="rowClass(m.role)">
        <div v-if="m.role !== 'system'" class="msg-avatar" :class="m.role === 'user' ? 'user-avatar' : 'ai-avatar'"
          v-html="m.role === 'user' ? ICO.user : ICO.ai"></div>
        <div class="bubble-block" :class="rowClass(m.role) + '-block'">
          <div v-if="m.role === 'assistant'" class="msg-bubble md" v-html="m.html"></div>
          <div v-else-if="m.html" class="msg-bubble" v-html="m.html"></div>
          <div v-else class="msg-bubble" :style="m.pre ? 'white-space:pre-wrap;font-size:12px;text-align:left;' : ''">{{ m.content }}</div>
          <div v-if="m.time && m.role !== 'system'" class="msg-time-row">{{ m.time }}</div>
        </div>
      </div>

      <!-- 流式气泡：逐字揭示 + 光标（追上即停 rAF；完成后一次性 Markdown） -->
      <div v-if="streaming" class="msg-row ai">
        <div class="msg-avatar ai-avatar" v-html="ICO.ai"></div>
        <div class="bubble-block ai-block">
          <div v-if="!streamText" class="typing-dots"><span></span><span></span><span></span></div>
          <div v-else class="msg-bubble stream-active">{{ revealedDisplay }}<span class="stream-cursor"></span></div>
        </div>
      </div>
    </div>

    <!-- 知识库 -->
    <div v-show="tab === 'knowledge'" class="kb-area">
      <div class="kb-search">
        <input v-model="kbSearch" placeholder="搜索知识库..." @input="onKbSearch" />
      </div>
      <div class="kb-list">
        <div v-if="!kbItems.length" class="kb-empty">知识库为空，通过工具箱保存网页或聊天记录</div>
        <div v-for="item in kbItems" :key="item.id" class="kb-card" @click="toggleFav(item)">
          <div class="kb-card-title">{{ item.title || '未命名' }}{{ item.is_favorite ? ' ⭐' : '' }}</div>
          <div v-if="item.url" class="kb-card-url">{{ item.url.substring(0, 60) }}</div>
          <div class="kb-card-preview">{{ (item.content || '').substring(0, 150) }}</div>
          <div v-if="item.tags && item.tags.length" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">
            <span v-for="t in item.tags" :key="t.name"
              :style="'font-size:9px;padding:1px 6px;border-radius:8px;background:' + tagBg(t.color) + ';color:#fff;font-weight:500;'">{{ t.name }}</span>
          </div>
          <div class="kb-card-meta">
            <span class="kb-card-type">{{ sourceLabel(item.source_type) }}</span>
            <span>{{ fmtTime(item.timestamp) }}</span>
            <button class="kb-card-del" title="删除" v-html="ICO.trash" @click.stop="deleteKB(item)"></button>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作栏 -->
    <div class="action-bar">
      <button class="action-btn" :disabled="processing" @click="quickPrompt('分析这个页面，总结主要内容。')">
        <span v-html="ICO.globe"></span><span class="action-label">分析网页</span>
      </button>
      <button class="action-btn" :disabled="processing" @click="analyzeImage">
        <span v-html="ICO.image"></span><span class="action-label">识别图片</span>
      </button>
      <button class="action-btn" :disabled="processing" @click="saveKB">
        <span v-html="ICO.save"></span><span class="action-label">保存知识库</span>
      </button>
    </div>

    <!-- 输入栏 -->
    <div class="input-bar">
      <div class="input-pill">
        <textarea ref="inputEl" v-model="draft" rows="1" maxlength="4000" placeholder="给无极发送消息…"
          @keydown="onKeydown" @input="autoGrow"></textarea>
        <button class="send-btn" :disabled="processing || !draft.trim()" v-html="ICO.send" @click="send"></button>
      </div>
      <div class="input-hint">
        <span class="status-dot" :class="{ error: statusError, busy: statusBusy }"></span>
        <span>{{ statusText }}</span>
        <span class="kbd">Enter 发送 · Shift+Enter 换行</span>
      </div>
    </div>
  </div>
</template>
