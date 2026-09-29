<script>
import WIcon from '../../shared/WIcon.vue';
import { createStatus } from '../../shared/status.js';
import { sendMessage } from '../../shared/chrome.js';

export default {
  name: 'KbSection',
  components: { WIcon },
  data() {
    return {
      ...createStatus(),
      stats: { total: '-', favorites: '-', tags: '-' },
      labels: { total: '条目', favorites: '收藏', tags: '标签' },
    };
  },
  async created() {
    await this.loadStats();
  },
  methods: {
    async loadStats() {
      try {
        const resp = await sendMessage({ type: 'KB_V2_STATS' });
        if (resp?.success && resp.data) {
          this.stats = { total: resp.data.total || 0, favorites: resp.data.favorites || 0, tags: resp.data.tags || 0 };
          this.labels = { total: '条目总数', favorites: '收藏', tags: '标签' };
        }
        const old = await sendMessage({ type: 'KB_STATS' });
        if (old?.success && old.data && old.data.total > 0) {
          this.stats = { total: old.data.pages || 0, favorites: old.data.chats || 0, tags: old.data.files || 0 };
          this.labels = { total: '网页', favorites: '对话', tags: '文件' };
        }
      } catch { /* ignore */ }
    },
    async clearStore(store) {
      try {
        await sendMessage({ type: 'KB_CLEAR', payload: { store } });
        this.show('已清空', 'success');
        this.loadStats();
      } catch {
        this.show('操作失败', 'error');
      }
    },
    async clearAll() {
      if (!confirm('确定清空全部知识库数据？此操作不可恢复。')) return;
      try {
        await sendMessage({ type: 'KB_CLEAR', payload: {} });
        this.show('知识库已全部清空', 'success');
        this.loadStats();
      } catch {
        this.show('操作失败', 'error');
      }
    },
  },
};
</script>

<template>
  <div>
    <div class="section-header">
      <div class="section-title"><WIcon name="book" :size="19" /> 知识库</div>
      <div class="section-desc">已保存的网页、对话和文件，支持全文搜索、标签与批注</div>
    </div>

    <div class="card">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="num" style="color:var(--accent);">{{ stats.total }}</div>
          <div class="label">{{ labels.total }}</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--ok);">{{ stats.favorites }}</div>
          <div class="label">{{ labels.favorites }}</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--warn);">{{ stats.tags }}</div>
          <div class="label">{{ labels.tags }}</div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-outline btn-sm" @click="clearStore('kb_pages')">清空网页</button>
        <button class="btn btn-outline btn-sm" @click="clearStore('kb_chats')">清空对话</button>
        <button class="btn btn-danger btn-sm" @click="clearAll">清空全部知识库</button>
      </div>
      <div v-if="status.text" class="status" :class="status.type">{{ status.text }}</div>
    </div>
  </div>
</template>
