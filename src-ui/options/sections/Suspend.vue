<script>
import WIcon from '../../shared/WIcon.vue';
import WToggle from '../../shared/WToggle.vue';
import { createStatus } from '../../shared/status.js';
import { sendMessage } from '../../shared/chrome.js';

export default {
  name: 'SuspendSection',
  components: { WIcon, WToggle },
  data() {
    return {
      ...createStatus(),
      settings: {
        enabled: true,
        suspendTime: 60,
        dontSuspendPinned: true,
        dontSuspendAudible: true,
        dontSuspendForms: true,
        dontSuspendActiveTabs: true,
        unsuspendOnFocus: false,
        whitelist: '',
      },
      toggleRows: [
        { key: 'dontSuspendPinned', label: '不休眠固定标签页' },
        { key: 'dontSuspendAudible', label: '不休眠播放音频的标签页' },
        { key: 'dontSuspendForms', label: '不休眠有表单输入的标签页' },
        { key: 'dontSuspendActiveTabs', label: '不休眠当前活跃标签页' },
        { key: 'unsuspendOnFocus', label: '点击休眠标签页时自动恢复' },
      ],
    };
  },
  async created() {
    try {
      const resp = await sendMessage({ type: 'TAB_SUSPEND_GET_SETTINGS' });
      if (resp?.success && resp.settings) Object.assign(this.settings, resp.settings);
    } catch { /* ignore */ }
  },
  methods: {
    async save() {
      try {
        const resp = await sendMessage({ type: 'TAB_SUSPEND_SAVE_SETTINGS', settings: { ...this.settings, screenCapture: '0' } });
        if (resp?.success) this.show('标签页休眠设置已保存', 'success');
        else this.show('保存失败: ' + (resp?.error || '未知错误'), 'error');
      } catch (e) {
        this.show('保存失败: ' + e.message, 'error');
      }
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="moon" :size="19" /> 标签页休眠</div>
      <div class="section-desc">自动挂起未使用的标签页释放内存，白名单、固定页、播放中的页面都会受到保护</div>
    </div>

    <div class="card">
      <div class="row">
        <div class="row-main">
          <div class="row-label">启用自动休眠</div>
          <div class="row-desc">闲置标签页会被替换为轻量的休眠页</div>
        </div>
        <WToggle v-model="settings.enabled" />
      </div>

      <div class="field" style="margin-top:12px;">
        <label>休眠等待时间</label>
        <select v-model="settings.suspendTime">
          <option value="1">1 分钟</option>
          <option value="5">5 分钟</option>
          <option value="10">10 分钟</option>
          <option value="20">20 分钟</option>
          <option value="30">30 分钟</option>
          <option value="60">1 小时</option>
          <option value="120">2 小时</option>
          <option value="240">4 小时</option>
          <option value="720">12 小时</option>
          <option value="0">从不</option>
        </select>
      </div>

      <div v-for="row in toggleRows" :key="row.key" class="row">
        <div class="row-main"><div class="row-label">{{ row.label }}</div></div>
        <WToggle v-model="settings[row.key]" />
      </div>
    </div>

    <div class="card">
      <div class="card-title"><WIcon name="shieldCheck" :size="14" /> 白名单</div>
      <div class="field">
        <label>匹配的页面不会自动休眠（每行一个网址或 /正则表达式/）</label>
        <textarea v-model="settings.whitelist" rows="5" placeholder="example.com&#10;/\.gov\.cn$/" style="resize:vertical;" />
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" @click="save">保存设置</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
