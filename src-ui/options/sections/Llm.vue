<script>
import WIcon from '../../shared/WIcon.vue';
import ProviderFields from './ProviderFields.vue';
import { createStatus } from '../../shared/status.js';
import { storage } from '../../shared/chrome.js';
import { PROVIDERS, chatPath } from '../../shared/providers-bridge.js';

export default {
  name: 'LlmSection',
  components: { WIcon, ProviderFields },
  data() {
    return {
      ...createStatus(),
      providers: PROVIDERS,
      config: { provider: 'deepseek', apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
    };
  },
  async created() {
    try {
      const r = await storage.sync.get('apiConfig');
      if (r.apiConfig) Object.assign(this.config, r.apiConfig);
      const d = PROVIDERS[this.config.provider];
      if (!this.config.baseUrl && d?.baseUrl) this.config.baseUrl = d.baseUrl;
      if (!this.config.model && d?.model) this.config.model = d.model;
    } catch { /* ignore */ }
  },
  methods: {
    async save() {
      await storage.sync.set({ apiConfig: { ...this.config } });
      this.show('配置已保存', 'success');
    },
    async test() {
      if (!this.config.apiKey) { this.show('请先输入 API Key', 'error'); return; }
      this.show('正在测试连接...', 'info', 0);
      try {
        const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}${chatPath(this.config.provider)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({ model: this.config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) this.show('连接成功！API 可用', 'success');
        else {
          const err = await resp.text();
          this.show(`API 返回错误 ${resp.status}: ${err.substring(0, 100)}`, 'error');
        }
      } catch (e) {
        this.show('连接失败: ' + e.message, 'error');
      }
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="bot" :size="19" /> 语言模型</div>
      <div class="section-desc">文本对话与推理，所有 AI 功能共用此配置</div>
    </div>

    <div class="card">
      <ProviderFields :config="config" :providers="providers" @status="show" />
      <div class="btn-row">
        <button class="btn btn-primary" @click="save">保存</button>
        <button class="btn btn-outline" @click="test">测试连接</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
