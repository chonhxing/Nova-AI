<script>
import { defineAsyncComponent } from 'vue';
import WIcon from '../shared/WIcon.vue';
import { APP_VERSION, HAS_CHROME } from '../shared/chrome.js';
import { initTheme, setTheme, onThemeChange } from '../shared/theme.js';

// 分区懒加载：defineAsyncComponent + 动态 import，Vite 按分区自动分包，
// 首屏只加载当前分区（其余 8 个分区代码在导航到时才拉取）
const LlmSection = defineAsyncComponent(() => import('./sections/Llm.vue'));
const VisionSection = defineAsyncComponent(() => import('./sections/Vision.vue'));
const TranslateSection = defineAsyncComponent(() => import('./sections/Translate.vue'));
const KbSection = defineAsyncComponent(() => import('./sections/Kb.vue'));
const AdblockSection = defineAsyncComponent(() => import('./sections/Adblock.vue'));
const AgentSection = defineAsyncComponent(() => import('./sections/Agent.vue'));
const SuspendSection = defineAsyncComponent(() => import('./sections/Suspend.vue'));
const CacheSection = defineAsyncComponent(() => import('./sections/Cache.vue'));
const AboutSection = defineAsyncComponent(() => import('./sections/About.vue'));

const NAV = [
  { id: 'llm', icon: 'bot', label: '语言模型' },
  { id: 'vision', icon: 'eye', label: '视觉模型' },
  { id: 'translate', icon: 'globe', label: '网页翻译' },
  { id: 'kb', icon: 'book', label: '知识库' },
  { id: 'adblock', icon: 'shieldCheck', label: '广告过滤' },
  { id: 'agent', icon: 'agent', label: 'Agent 权限' },
  { id: 'suspend', icon: 'moon', label: '标签页休眠' },
  { id: 'cache', icon: 'refresh', label: '聊天与重置' },
];

export default {
  name: 'OptionsApp',
  components: {
    WIcon,
    LlmSection,
    VisionSection,
    TranslateSection,
    KbSection,
    AdblockSection,
    AgentSection,
    SuspendSection,
    CacheSection,
    AboutSection,
  },
  data() {
    return {
      version: APP_VERSION,
      hasChrome: HAS_CHROME,
      active: 'llm',
      nav: NAV,
      theme: 'auto',
      themeOptions: [
        { value: 'auto', icon: 'monitor', label: '跟随系统' },
        { value: 'light', icon: 'sun', label: '浅色' },
        { value: 'dark', icon: 'moon', label: '深色' },
      ],
      sections: {
        llm: LlmSection,
        vision: VisionSection,
        translate: TranslateSection,
        kb: KbSection,
        adblock: AdblockSection,
        agent: AgentSection,
        suspend: SuspendSection,
        cache: CacheSection,
        about: AboutSection,
      },
    };
  },
  computed: {
    activeSection() {
      return this.sections[this.active] || LlmSection;
    },
  },
  async created() {
    this.theme = await initTheme();
    onThemeChange((t) => { this.theme = t; });
  },
  methods: {
    pickTheme(t) {
      setTheme(t);
      this.theme = t;
    },
  },
};
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo"><WIcon name="logo" :size="18" /></div>
        <div>
          <div class="brand-name">无极</div>
          <div v-if="version" class="brand-ver">v{{ version }}</div>
        </div>
      </div>

      <nav class="nav">
        <button
          v-for="item in nav"
          :key="item.id"
          class="nav-item"
          :class="{ active: active === item.id }"
          @click="active = item.id"
        >
          <WIcon :name="item.icon" :size="15" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-foot">
        <div class="appearance">
          <span class="appearance-label"><WIcon name="sun" :size="13" /> 外观</span>
          <div class="seg" role="radiogroup" aria-label="外观主题">
            <button
              v-for="t in themeOptions"
              :key="t.value"
              class="seg-btn"
              :class="{ active: theme === t.value }"
              :title="t.label"
              @click="pickTheme(t.value)"
            >
              <WIcon :name="t.icon" :size="13" />
            </button>
          </div>
        </div>
        <button class="nav-item about" :class="{ active: active === 'about' }" @click="active = 'about'">
          <WIcon name="info" :size="15" />
          <span>关于</span>
        </button>
      </div>
    </aside>

    <main class="content">
      <div v-if="!hasChrome" class="dev-banner">开发者预览：未检测到扩展环境，读取/保存不会真正生效</div>
      <KeepAlive>
        <component :is="activeSection" :key="active" />
      </KeepAlive>
    </main>
  </div>
</template>

<style>
body {
  height: 100vh;
  overflow: hidden;
}

.layout {
  display: flex;
  height: 100vh;
}

/* ===== 侧边栏 ===== */
.sidebar {
  width: 224px;
  flex-shrink: 0;
  background: var(--bg-elevated);
  border-right: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  padding: 18px 0 12px;
  overflow-y: auto;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px 16px;
}
.logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(99, 102, 241, 0.3);
  flex-shrink: 0;
}
.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.2px;
}
.brand-ver {
  font-size: 10px;
  color: var(--fg-3);
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin: 0 8px;
  border: none;
  border-radius: 8px;
  background: none;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-2);
  text-align: left;
  transition: all var(--t);
}
.nav-item:hover {
  background: var(--bg-soft);
  color: var(--fg);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.nav-item.active .wicon {
  color: var(--accent);
}
.sidebar-foot {
  border-top: 1px solid var(--hairline);
  padding-top: 10px;
  margin-top: 8px;
}

/* ===== 外观切换 ===== */
.appearance {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 12px 8px;
}
.appearance-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--fg-2);
}
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--bg-soft);
  border: 1px solid var(--hairline);
}
.seg-btn {
  width: 26px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-3);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--t);
}
.seg-btn:hover {
  color: var(--fg);
}
.seg-btn.active {
  background: var(--bg-elevated);
  color: var(--accent);
  box-shadow: var(--shadow-1);
}

/* ===== 内容区 ===== */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 30px 40px 48px;
}
.content > * {
  max-width: 640px;
}

.dev-banner {
  padding: 9px 14px;
  border-radius: var(--r-sm);
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
  margin-bottom: 14px;
}

/* ===== 区块标题 ===== */
.section-header {
  margin-bottom: 18px;
}
.section-title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.3px;
  display: flex;
  align-items: center;
  gap: 9px;
}
.section-title .wicon {
  color: var(--accent);
}
.section-desc {
  font-size: 12.5px;
  color: var(--fg-3);
  margin-top: 5px;
  line-height: 1.55;
}
</style>
