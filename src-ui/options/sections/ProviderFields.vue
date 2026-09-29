<script>
/**
 * 服务商配置字段组：服务商下拉 + API Key + 模型 + Base URL + 获取 Key 链接
 * 直接就地修改传入的 config 对象（provider/apiKey/model/baseUrl），
 * 与旧版 DOM 同步行为一致，避免跨组件 emit 样板代码。
 */
import WIcon from '../../shared/WIcon.vue';
import { chatPath } from '../../shared/providers-bridge.js';

let PF_UID = 0; // 模块级实例计数，生成 label[for] 的唯一 id

export default {
  name: 'ProviderFields',
  components: { WIcon },
  props: {
    config: { type: Object, required: true },
    providers: { type: Object, required: true },
    keyPlaceholder: { type: String, default: 'sk-xxxx' },
    keyHint: { type: String, default: '密钥仅存储在本机' },
    showBaseUrl: { type: Boolean, default: true },
  },
  data() {
    PF_UID += 1;
    return { uid: 'pf' + PF_UID + '-' + Math.random().toString(36).slice(2, 7) };
  },
  computed: {
    groups() {
      const buckets = { cn: [], overseas: [], custom: [] };
      for (const [key, p] of Object.entries(this.providers)) {
        (buckets[p.group] || buckets.custom).push({ key, ...p });
      }
      const labels = { cn: '国内', overseas: '国外', custom: '其他' };
      return ['cn', 'overseas', 'custom']
        .map((k, i) => ({ list: buckets[k], label: labels[k], i }))
        .filter((g) => g.list.length);
    },
    current() {
      return this.providers[this.config.provider] || {};
    },
    modelHint() {
      return this.current.hint || '选择服务商后可见常用模型';
    },
    siteUrl() {
      return this.current.site || '';
    },
  },
  methods: {
    onProviderChange() {
      const d = this.providers[this.config.provider];
      if (!d) return;
      if (d.baseUrl) this.config.baseUrl = d.baseUrl;
      if (d.model) this.config.model = d.model;
    },
    async test() {
      if (!this.config.apiKey) {
        this.$emit('status', '请先输入 API Key', 'error');
        return;
      }
      this.$emit('status', '正在测试连接...', 'info', 0);
      try {
        const baseUrl = (this.config.baseUrl || '').replace(/\/+$/, '');
        const path = chatPath(this.config.provider);
        const resp = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({ model: this.config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) this.$emit('status', '连接成功！API 可用', 'success');
        else {
          const err = await resp.text();
          this.$emit('status', `API 返回错误 ${resp.status}: ${err.substring(0, 100)}`, 'error');
        }
      } catch (e) {
        this.$emit('status', '连接失败: ' + e.message, 'error');
      }
    },
  },
};
</script>

<template>
  <div>
    <div class="field">
      <label :for="uid + '-provider'">服务商</label>
      <select :id="uid + '-provider'" v-model="config.provider" @change="onProviderChange">
        <optgroup v-for="g in groups" :key="g.i" :label="g.label">
          <option v-for="p in g.list" :key="p.key" :value="p.key">{{ p.name }}</option>
        </optgroup>
      </select>
    </div>

    <div class="field">
      <label :for="uid + '-key'">API Key</label>
      <input
        :id="uid + '-key'"
        v-model="config.apiKey"
        type="password"
        :placeholder="keyPlaceholder"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="hint key-hint">
        <span>{{ keyHint }}</span>
        <a v-if="siteUrl" class="link" :href="siteUrl" target="_blank" rel="noreferrer">
          获取 {{ current.name }} API Key <WIcon name="external" :size="10" />
        </a>
      </div>
    </div>

    <div class="field">
      <label :for="uid + '-model'">模型</label>
      <input :id="uid + '-model'" v-model="config.model" type="text" placeholder="deepseek-chat" autocomplete="off" spellcheck="false" />
      <div class="hint">{{ modelHint }}</div>
    </div>

    <div v-if="showBaseUrl" class="field">
      <label :for="uid + '-baseurl'">API Base URL</label>
      <input :id="uid + '-baseurl'" v-model="config.baseUrl" type="url" placeholder="https://api.deepseek.com" autocomplete="off" spellcheck="false" />
      <div class="hint">通常无需修改，走自定义网关时才需要改</div>
    </div>
  </div>
</template>

<style>
.key-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
</style>
