<script>
import WIcon from '../../shared/WIcon.vue';
import { APP_VERSION } from '../../shared/chrome.js';

export default {
  name: 'AboutSection',
  components: { WIcon },
  data() {
    return {
      version: APP_VERSION,
      features: [
        '网页翻译', 'AI 对话', '图片识别', '视频摘要', 'PDF 保存', '知识库',
        '全文搜索', '标签', '高亮批注', '知识图谱', 'Agent', '广告过滤', '标签页休眠',
      ],
      techs: ['Manifest V3', 'Vue 3 + Vite', 'Shadow DOM', 'IndexedDB', 'FTS 倒排索引', 'RAG', 'OpenAI Compatible API', 'DNR', 'WebAssembly'],
    };
  },
};
</script>

<template>
  <div>
    <div class="about-hero">
      <div class="hero-logo"><WIcon name="logo" :size="30" /></div>
      <div class="hero-name">无极</div>
      <div v-if="version" class="hero-ver">v{{ version }}</div>
      <p class="hero-desc">网页翻译、AI 对话、知识库、广告过滤 — 装一个扩展就够</p>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="chat" :size="14" /> 功能</div>
      <div class="chip-wrap">
        <span v-for="f in features" :key="f" class="chip">{{ f }}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="agent" :size="14" /> 技术栈</div>
      <div class="chip-wrap">
        <span v-for="t in techs" :key="t" class="chip">{{ t }}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="heart" :size="14" /> 支持作者</div>
      <div class="hint" style="margin-top:0;">觉得有用的话给项目点个 Star，或在弹窗里「赞助作者」请作者喝杯咖啡。API Key 只存在浏览器本地，不会上传。</div>
    </div>
  </div>
</template>

<style>
.about-hero {
  text-align: center;
  padding: 26px 0 24px;
  margin-bottom: 14px;
}
.hero-logo {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  margin: 0 auto 14px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #d946ef);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 30px rgba(99, 102, 241, 0.35);
}
.hero-name {
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.4px;
}
.hero-ver {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 20px;
  padding: 2px 10px;
}
.hero-desc {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--fg-3);
}
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.chip {
  font-size: 11px;
  font-weight: 550;
  color: var(--fg-2);
  background: var(--bg-soft);
  border: 1px solid var(--hairline);
  padding: 4px 10px;
  border-radius: 20px;
}
</style>
