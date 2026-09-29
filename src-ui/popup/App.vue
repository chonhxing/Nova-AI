<script>
import WIcon from '../shared/WIcon.vue';
import { APP_VERSION, HAS_CHROME, sendMessage, storage, tabMessage, getActiveTab } from '../shared/chrome.js';
import { initTheme, cycleTheme as cycleThemePref, onThemeChange } from '../shared/theme.js';
import '../../libs/providers.js';

const PROVIDERS = (typeof window !== 'undefined' && window.WUJI_PROVIDERS) || {};

export default {
  name: 'PopupApp',
  components: { WIcon },
  data() {
    return {
      version: APP_VERSION,
      hasChrome: HAS_CHROME,
      tabUrl: '',
      apiConfig: null,
      adblockWhitelisted: false,
      theme: 'auto',
    };
  },
  computed: {
    themeIcon() {
      return { auto: 'monitor', light: 'sun', dark: 'moon' }[this.theme] || 'monitor';
    },
    themeLabel() {
      return { auto: '跟随系统', light: '浅色', dark: '深色' }[this.theme] || '跟随系统';
    },
    isSuspended() {
      return this.tabUrl.includes('suspended.html');
    },
    providerName() {
      if (!this.apiConfig?.apiKey) return null;
      const p = PROVIDERS[this.apiConfig.provider];
      return p ? p.name : this.apiConfig.provider;
    },
  },
  async created() {
    this.theme = await initTheme();
    onThemeChange((t) => { this.theme = t; });
    try {
      const [tab, r] = await Promise.all([getActiveTab(), storage.sync.get('apiConfig')]);
      this.tabUrl = tab?.url || '';
      this.apiConfig = r.apiConfig || null;
      if (this.tabUrl) {
        const host = new URL(this.tabUrl).hostname;
        const resp = await sendMessage({ type: 'ADBLOCK_WHITELIST_LIST' });
        const items = resp?.success ? resp.items || [] : [];
        this.adblockWhitelisted = items.some((i) => i.domain === host);
      }
    } catch {
      /* 预览环境 */
    }
  },
  methods: {
    cycleTheme() {
      this.theme = cycleThemePref(this.theme);
    },
    async openChat() {
      await tabMessage({ type: 'TOGGLE_CHAT_PANEL' });
      setTimeout(() => window.close(), 80);
    },
    async translate() {
      await tabMessage({ type: 'TRANSLATE_START', config: { targetLang: 'zh-CN', displayMode: 'bilingual' } });
      window.close();
    },
    async restore() {
      await tabMessage({ type: 'TRANSLATE_RESTORE' });
      window.close();
    },
    async savePdf() {
      try { await sendMessage({ type: 'SAVE_AS_PDF' }); } catch { /* ignore */ }
      window.close();
    },
    async toggleSuspend() {
      try {
        const tab = await getActiveTab();
        if (tab?.id) {
          if (this.isSuspended) await sendMessage({ type: 'TAB_SUSPEND_UNSUSPEND', tabId: tab.id });
          else await sendMessage({ type: 'TAB_SUSPEND_NOW', tabId: tab.id, forceLevel: 1 });
        }
      } catch { /* ignore */ }
      window.close();
    },
    async suspendWhitelist() {
      try {
        const tab = await getActiveTab();
        if (tab?.url) {
          await sendMessage({ type: 'TAB_SUSPEND_WHITELIST_ADD', domain: new URL(tab.url).hostname });
        }
      } catch { /* ignore */ }
      window.close();
    },
    async toggleAdblockWhitelist() {
      try {
        const tab = await getActiveTab();
        if (tab?.url) {
          await sendMessage({ type: 'ADBLOCK_WHITELIST_TOGGLE', domain: new URL(tab.url).hostname });
        }
      } catch { /* ignore */ }
      window.close();
    },
    async openDanmaku() {
      await tabMessage({ type: 'OPEN_DANMAKU_PANEL' });
      window.close();
    },
    openOptions() {
      if (HAS_CHROME) chrome.runtime.openOptionsPage();
      window.close();
    },
    async sponsor() {
      try {
        const tab = await getActiveTab();
        if (tab?.id && HAS_CHROME) {
          const imgUrl = chrome.runtime.getURL('icons/sponsor.jpg');
          chrome.tabs.sendMessage(tab.id, { type: 'SHOW_SPONSOR_IMAGE', imgUrl }).catch(() => {});
        }
      } catch { /* ignore */ }
      window.close();
    },
  },
};
</script>

<template>
  <div class="popup">
    <!-- 顶栏 -->
    <header class="header">
      <div class="brand">
        <div class="brand-mark"><WIcon name="logo" :size="18" /></div>
        <div class="brand-text">
          <div class="name-row">
            <span class="name">无极</span>
            <span v-if="version" class="ver">v{{ version }}</span>
          </div>
          <span class="subtitle">浏览器助手</span>
        </div>
      </div>
      <button class="icon-btn" :title="'外观：' + themeLabel" @click="cycleTheme">
        <WIcon :name="themeIcon" :size="15" />
      </button>
      <button class="icon-btn" title="设置" @click="openOptions"><WIcon name="settings" :size="16" /></button>
    </header>

    <!-- 模型状态 -->
    <button class="model-chip" :class="{ unconfigured: !providerName }" title="点击进入设置" @click="openOptions">
      <span class="dot" :class="providerName ? 'ok' : 'warn'" />
      <span class="model-text">
        <template v-if="providerName">{{ providerName }} · {{ apiConfig.model || '未设置模型' }}</template>
        <template v-else>未配置 AI 服务，点击设置</template>
      </span>
      <WIcon name="external" :size="11" class="model-arrow" />
    </button>

    <!-- 快捷操作 -->
    <div class="quick-grid">
      <button class="quick" @click="openChat">
        <span class="q-ico"><WIcon name="chat" :size="18" /></span>
        <span class="q-label">AI 对话</span>
      </button>
      <button class="quick" @click="translate">
        <span class="q-ico"><WIcon name="globe" :size="18" /></span>
        <span class="q-label">翻译此页</span>
      </button>
      <button class="quick" @click="restore">
        <span class="q-ico"><WIcon name="restore" :size="18" /></span>
        <span class="q-label">显示原文</span>
      </button>
      <button class="quick" @click="savePdf">
        <span class="q-ico"><WIcon name="pdf" :size="18" /></span>
        <span class="q-label">保存 PDF</span>
      </button>
    </div>

    <!-- 更多工具 -->
    <div class="list">
      <button class="item" @click="toggleSuspend">
        <span class="i-ico"><WIcon name="moon" :size="15" /></span>
        <span class="i-label">{{ isSuspended ? '恢复此标签页' : '休眠此标签页' }}</span>
      </button>
      <button class="item" @click="suspendWhitelist">
        <span class="i-ico"><WIcon name="shieldCheck" :size="15" /></span>
        <span class="i-label">不自动休眠此网站</span>
      </button>
      <button class="item" @click="toggleAdblockWhitelist">
        <span class="i-ico"><WIcon :name="adblockWhitelisted ? 'shieldCheck' : 'shieldOff'" :size="15" /></span>
        <span class="i-label">{{ adblockWhitelisted ? '恢复屏蔽此网站广告' : '此网站不屏蔽广告' }}</span>
      </button>
      <button class="item" @click="openDanmaku">
        <span class="i-ico"><WIcon name="danmaku" :size="15" /></span>
        <span class="i-label">弹幕管理姬</span>
      </button>
      <button class="item sponsor" @click="sponsor">
        <span class="i-ico heart"><WIcon name="heart" :size="15" /></span>
        <span class="i-label">赞助作者</span>
      </button>
    </div>

    <div v-if="!hasChrome" class="dev-banner">开发者预览：未检测到扩展环境，按钮不会真正执行</div>
  </div>
</template>

<style scoped>
.popup {
  width: 324px;
  background: var(--bg-elevated);
  padding-bottom: 6px;
}

/* 顶栏 */
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px 16px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(99, 102, 241, 0.32);
  flex-shrink: 0;
}
.name-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.ver {
  font-size: 10px;
  font-weight: 600;
  color: var(--fg-3);
  background: var(--bg-soft);
  border: 1px solid var(--hairline);
  padding: 0 5px;
  border-radius: 6px;
}
.subtitle {
  font-size: 10.5px;
  color: var(--fg-3);
  display: block;
  margin-top: 1px;
}
.icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  border: none;
  background: transparent;
  color: var(--fg-3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--t);
}
.icon-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

/* 模型状态胶囊 */
.model-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  width: calc(100% - 24px);
  margin: 0 12px 10px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--hairline);
  background: var(--bg-soft);
  color: var(--fg-2);
  font-size: 11.5px;
  text-align: left;
  transition: all var(--t);
}
.model-chip:hover {
  border-color: var(--accent-line);
  color: var(--accent);
}
.model-chip .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.model-chip .dot.ok {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
}
.model-chip .dot.warn {
  background: var(--warn);
  box-shadow: 0 0 6px var(--warn);
}
.model-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-arrow {
  opacity: 0.6;
}

/* 快捷操作 2×2 */
.quick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 0 12px;
  margin-bottom: 8px;
}
.quick {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border-radius: var(--r);
  border: 1px solid var(--hairline);
  background: var(--bg-elevated);
  color: var(--fg);
  transition: all var(--t);
}
.quick:hover {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  transform: translateY(-1px);
  box-shadow: var(--shadow-1);
}
.quick:active {
  transform: scale(0.98);
}
.q-ico {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.q-label {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.1px;
}

/* 列表项 */
.list {
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--fg-2);
  font-size: 12.5px;
  font-weight: 500;
  text-align: left;
  transition: all var(--t);
}
.item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.item:hover .i-ico {
  color: var(--accent);
}
.i-ico {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-3);
  transition: color var(--t);
}
.i-ico.heart {
  color: #f59e0b;
}
.sponsor:hover .i-ico.heart {
  color: #ef4444;
}
.sponsor:hover {
  background: var(--warn-soft);
  color: #f59e0b;
}

.dev-banner {
  margin: 8px 12px 4px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 10.5px;
}
</style>
