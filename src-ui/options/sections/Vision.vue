<script>
import WIcon from '../../shared/WIcon.vue';
import ProviderFields from './ProviderFields.vue';
import { createStatus } from '../../shared/status.js';
import { storage } from '../../shared/chrome.js';
import { VISION_PROVIDERS, chatPath } from '../../shared/providers-bridge.js';

export default {
  name: 'VisionSection',
  components: { WIcon, ProviderFields },
  data() {
    return {
      ...createStatus(),
      providers: VISION_PROVIDERS,
      // ProviderFields 用统一键名，存取时映射到 visionX 存储键
      config: { provider: 'zhipu', apiKey: '', model: 'glm-4.6v-flash', baseUrl: 'https://open.bigmodel.cn/api/paas' },
    };
  },
  async created() {
    try {
      const r = await storage.sync.get('visionConfig');
      const c = r.visionConfig;
      if (c) {
        this.config = {
          provider: c.visionProvider || 'zhipu',
          apiKey: c.visionApiKey || '',
          model: c.visionModel || 'glm-4.6v-flash',
          baseUrl: c.visionBaseUrl || 'https://open.bigmodel.cn/api/paas',
        };
      }
    } catch { /* ignore */ }
  },
  methods: {
    async save() {
      const c = this.config;
      await storage.sync.set({
        visionConfig: { visionProvider: c.provider, visionApiKey: c.apiKey, visionModel: c.model, visionBaseUrl: c.baseUrl },
      });
      this.show('视觉模型配置已保存', 'success');
    },
    async test() {
      if (!this.config.apiKey) { this.show('请先输入 API Key（留空复用语言模型密钥的，测试时需单独填写）', 'error'); return; }
      this.show('正在测试...', 'info', 0);
      try {
        const baseUrl = (this.config.baseUrl || '').replace(/\/+$/, '');
        const resp = await fetch(`${baseUrl}${chatPath(this.config.provider, 'vision')}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({ model: this.config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) this.show('连接成功！', 'success');
        else {
          const err = await resp.text();
          this.show(`错误 ${resp.status}: ${err.substring(0, 100)}`, 'error');
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
      <div class="section-title"><WIcon name="eye" :size="19" /> 视觉模型</div>
      <div class="section-desc">图片识别、OCR 与视觉分析</div>
    </div>

    <div class="card">
      <ProviderFields
        :config="config"
        :providers="providers"
        key-placeholder="视觉模型 API Key（可留空复用语言模型）"
        key-hint="留空则调用时复用语言模型的密钥"
        @status="show"
      />
      <div class="btn-row">
        <button class="btn btn-primary" @click="save">保存</button>
        <button class="btn btn-outline" @click="test">测试连接</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
