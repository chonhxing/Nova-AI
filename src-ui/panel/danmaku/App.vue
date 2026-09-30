<script>
/**
 * 无极 — 弹幕管理面板（Vue 3）
 * 从 libs/danmaku-player.js showDanmakuPanel(844-1005) 忠实移植：
 * BV 输入/提取弹幕（轮询等待由引擎侧 bridge.crawl 承载，含 30 秒上限）、
 * 完整模式+SESSDATA Cookie、状态行、已存列表（删除确认）。
 * 关闭即 unmount——DOM/监听全部释放（原实现只是 display:none 常驻）。
 * 提取弹幕的抓取与轮询属于业务逻辑，保留在 danmaku-player.js 引擎侧。
 */
export default {
  name: 'DanmakuPanelApp',
  inject: ['bridge'],
  data() {
    return {
      bvid: '',
      useHistory: false,
      cookie: '',
      status: '',
      crawling: false,
      sets: [],
    };
  },
  mounted() {
    this.refreshList();
  },
  methods: {
    fmtDate(ts) {
      try { return new Date(ts).toLocaleDateString('zh-CN'); } catch (e) { return ''; }
    },
    async refreshList() {
      this.sets = await this.bridge.getSets();
    },
    async crawl() {
      const bvid = this.bvid.trim();
      if (!bvid || this.crawling) return;
      this.crawling = true;
      this.status = this.useHistory
        ? '⏳ 完整模式：正在抓取实时 + 历史弹幕，可能需要较长时间...'
        : '⏳ 正在连接B站API获取弹幕...';
      try {
        const r = await this.bridge.crawl(bvid, this.useHistory, this.cookie.trim());
        if (r.ok) {
          this.status = `✅ 已提取 ${r.count} 条弹幕，来自：${(r.title || '').substring(0, 30)}`;
          this.bvid = '';
          this.refreshList();
        } else {
          this.status = '❌ ' + (r.error || '提取失败，请检查BV号或网络');
        }
      } catch (e) {
        this.status = '❌ ' + (e?.message || '提取失败');
      }
      this.crawling = false;
    },
    async del(set) {
      if (!confirm('确定删除此弹幕集？')) return;
      await this.bridge.deleteSet(set.bvid);
      this.refreshList();
    },
    close() {
      this.bridge.close();
    },
  },
};
</script>

<template>
  <div class="wdm-panel">
    <div class="wdm-head">
      🎬 弹幕管理姬
      <button class="wdm-close" @click="close">&times;</button>
    </div>
    <div class="wdm-body">
      <div class="wdm-row">
        <input v-model="bvid" type="text" placeholder="输入B站视频链接或BV号" @keydown.enter="crawl" />
        <button class="wdm-btn wdm-btn-primary" :disabled="crawling" @click="crawl">{{ crawling ? '提取中...' : '提取弹幕' }}</button>
      </div>
      <div class="wdm-adv">
        <label class="wdm-check"><input v-model="useHistory" type="checkbox" /> 完整模式（含历史弹幕，弹幕更全）</label>
        <input v-model="cookie" type="text" placeholder="SESSDATA Cookie（可选，完整模式/被风控时需要）" />
      </div>
      <div class="wdm-status">{{ status }}</div>
      <div>
        <div v-if="!sets.length" class="wdm-status">暂无保存的弹幕</div>
        <div v-for="s in sets" :key="s.bvid" class="wdm-set">
          <div class="wdm-set-info">
            <div class="wdm-set-title">{{ s.title }}</div>
            <div class="wdm-set-meta">{{ s.count }}条 · {{ fmtDate(s.createdAt) }}</div>
          </div>
          <div class="wdm-set-actions">
            <button class="wdm-btn-sm wdm-btn-danger" @click="del(s)">删除</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
