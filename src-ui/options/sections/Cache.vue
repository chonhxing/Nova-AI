<script>
import WIcon from '../../shared/WIcon.vue';
import { createStatus } from '../../shared/status.js';
import { storage } from '../../shared/chrome.js';

export default {
  name: 'CacheSection',
  components: { WIcon },
  data() {
    return { ...createStatus() };
  },
  methods: {
    async clearChat() {
      try {
        await storage.local.remove('wuji_conversation');
        this.show('聊天记录已清空', 'success');
      } catch {
        this.show('操作失败', 'error');
      }
    },
    async resetAll() {
      // 只清除配置类数据，绝不触碰用户数据（弹幕集/知识库/翻译缓存/休眠映射）
      if (!confirm('确定重置全部配置？这将清除所有 API 设置和功能开关（知识库、弹幕集等数据会保留）。此操作不可恢复！')) return;
      try {
        const r = await storage.sync.get(null);
        const syncKeys = Object.keys(r || {});
        if (syncKeys.length) await storage.sync.remove(syncKeys);
        const lr = await storage.local.get(null);
        const localConfigKeys = Object.keys(lr || {}).filter(
          (k) => k.startsWith('kb_settings') || k.startsWith('adblock_') || k === 'adblockConfig'
        );
        if (localConfigKeys.length) await storage.local.remove(localConfigKeys);
        this.show('全部配置已重置（用户数据已保留），页面即将刷新', 'success');
        setTimeout(() => window.location.reload(), 500);
      } catch (e) {
        this.show('重置失败: ' + e.message, 'error');
      }
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="refresh" :size="19" /> 聊天缓存与重置</div>
      <div class="section-desc">管理聊天记录及重置配置。重置只清除配置，知识库、弹幕集等用户数据会保留</div>
    </div>

    <div class="card">
      <div class="btn-row" style="margin-top:0;">
        <button class="btn btn-outline" @click="clearChat">清空聊天记录</button>
        <button class="btn btn-danger" @click="resetAll">重置全部配置</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
