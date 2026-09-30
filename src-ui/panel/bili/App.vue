<script>
/**
 * 无极 — B站视频下载面板（Vue 3）
 * 数据面：引擎在 Service Worker（libs/bili-downloader.js，WBI 签名/playurl
 * 算法移植自 Bili23-Downloader），本组件经 bridge.send 调用 SW 接口；
 * 清晰度列表来自 qn=127 探测（服务端按账号权限返回，大会员自动解锁高档）。
 * 下载走 chrome.downloads 直链（CDN 鉴权在 URL 参数，SW 会话规则补 Referer）。
 * 音视频为独立 DASH 流，下载后需 ffmpeg 合并（面板内给出命令）。
 */
const QN_NAMES = {
  127: '8K 超高清', 126: '杜比视界', 125: 'HDR 真彩', 122: '4K SDR', 120: '4K 超清',
  116: '1080P 60帧', 112: '1080P 高码率', 100: '智能修复', 80: '1080P 高清',
  74: '720P 60帧', 64: '720P 高清', 32: '480P 清晰', 16: '360P 流畅'
};
const AUDIO_NAMES = { 30251: 'Hi-Res 无损', 30250: '杜比全景声', 30280: '192K 高品质', 30232: '132K 中品质', 30216: '64K 普通' };

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtDur(sec) {
  const s = Math.round(sec || 0);
  const m = Math.floor(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default {
  name: 'BiliPanelApp',
  inject: ['bridge'],
  data() {
    return {
      loading: true,
      error: '',
      info: null,          // { title, owner, pages:[{cid,part,page,duration}] }
      pageIndex: 0,        // 当前分P索引
      res: null,           // resolve 结果 { qualities, audios, timelength }
      resolving: false,
      downloads: [],       // { key, name, state: 'running'|'done'|'error', received }
      _dlListeners: [],
    };
  },
  computed: {
    pages() { return this.info?.pages || []; },
    currentPage() { return this.pages[this.pageIndex] || null; },
  },
    async mounted() {
    // 下载状态跟踪（面板运行在隔离世界，可直接用 chrome.downloads 事件）
    if (typeof chrome !== 'undefined' && chrome.downloads?.onChanged) {
      const on = (delta) => {
        const d = this.downloads.find(x => x.id === delta.id);
        if (!d) return;
        if (delta.bytesReceived) d.received = delta.bytesReceived.current;
        if (delta.state) {
          if (delta.state.current === 'complete') d.state = 'done';
          else if (delta.state.current === 'interrupted') {
            d.state = 'error';
            if (!d.retried) this.retry(d);   // 自动重试一次（网络抖动）
          }
        }
      };
      chrome.downloads.onChanged.addListener(on);
      this._dlListeners.push([chrome.downloads.onChanged, on]);
    }
    await this.load();
  },
  beforeUnmount() {
    for (const [ev, fn] of this._dlListeners) { try { ev.removeListener(fn); } catch (e) { /* ignore */ } }
    this._dlListeners = [];
  },
  methods: {
    fmtSize, fmtDur,
    qnName(id) { return QN_NAMES[id] || (id + 'P'); },
    audioName(id) { return AUDIO_NAMES[id] || String(id); },
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const bvid = this.bridge.getBvid();
        if (!bvid) throw new Error('未识别到 BV 号，请在视频页使用');
        this.info = await this.bridge.send('BILI_GET_INFO', { bvid });
        // 默认选中 URL 里 ?p= 指定的分P
        const p = this.bridge.getPage ? this.bridge.getPage() : 1;
        const idx = Math.max(0, this.pages.findIndex(x => x.page === p));
        this.pageIndex = idx < 0 ? 0 : idx;
        await this.resolve();
      } catch (e) {
        this.error = e.message;
      }
      this.loading = false;
    },
    async pickPage(i) {
      if (this.pageIndex === i) return;
      this.pageIndex = i;
      await this.resolve();
    },
    async resolve() {
      const page = this.currentPage;
      if (!page) return;
      this.resolving = true;
      this.error = '';
      try {
        this.res = await this.bridge.send('BILI_RESOLVE', { bvid: this.bridge.getBvid(), cid: page.cid });
      } catch (e) {
        this.error = e.message;
      }
      this.resolving = false;
    },
    async download(url, qualityLabel, kind, item = null) {
      const page = this.currentPage;
      if (!url || !this.info) return;
      if (!item) {
        const base = `无极下载/${this.sanitize(this.info.title)}${this.pages.length > 1 ? ` [P${page.page}]` : ''}`;
        const name = kind === 'audio'
          ? `${base} [${this.audioName(qualityLabel)}] 音频流.m4a`
          : `${base} [${qualityLabel}] 视频流.m4s`;
        item = { key: name + Date.now(), id: null, name, state: 'running', received: 0, total: 0, retried: false, url, label: qualityLabel, kind, error: '' };
        this.downloads.unshift(item);
      } else {
        item.state = 'running';
        item.error = '';
      }
      try {
        const r = await this.bridge.send('BILI_DOWNLOAD', { url: item.url, filename: item.name });
        item.id = r.id || null;
        if (!r.ok) { item.state = 'error'; item.error = r.error || '下载任务创建失败'; return; }
        // 总字节数（进度百分比用）
        if (item.id && chrome.downloads?.search) {
          chrome.downloads.search({ id: item.id }, (items) => {
            if (chrome.runtime.lastError || !items?.[0]) return;
            item.total = items[0].totalBytes || 0;
            if (items[0].state === 'complete') item.state = 'done';
          });
        }
      } catch (e) {
        item.state = 'error';
        item.error = e.message;
      }
    },
    // 自动重试一次；手动按钮可无限重试（重新走一次 downloads 任务，URL 未过期）
    retry(item, manual = false) {
      if (!manual && item.retried) return;
      item.retried = true;
      this.download(item.url, item.label, item.kind, item);
    },
    percent(d) {
      if (!d.total || d.state !== 'running') return null;
      return Math.min(100, Math.round((d.received / d.total) * 100));
    },
    sanitize(name) {
      return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').trim() || '_';
    },
    close() {
      this.bridge.close();
    },
  },
};
</script>

<template>
  <div class="bili-panel">
    <div class="bili-head">
      <span class="bili-title">⬇ B站视频下载</span>
      <button class="bili-close" @click="close">&times;</button>
    </div>

    <div class="bili-body">
      <div v-if="loading" class="bili-status">正在读取视频信息...</div>
      <div v-else-if="error" class="bili-status bili-error">{{ error }}</div>

      <template v-else-if="info">
        <div class="bili-meta">
          <div class="bili-vtitle">{{ info.title }}</div>
          <div class="bili-sub">{{ info.owner }}<template v-if="pages.length > 1"> · 共 {{ pages.length }} 个分P</template></div>
        </div>

        <!-- 分P选择 -->
        <div v-if="pages.length > 1" class="bili-pages">
          <button v-for="(p, i) in pages" :key="p.cid" class="bili-page-chip"
            :class="{ active: i === pageIndex }" :title="p.part" @click="pickPage(i)">
            P{{ p.page }}
          </button>
        </div>
        <div v-if="currentPage && pages.length > 1" class="bili-part-name">{{ currentPage.part }} · {{ fmtDur(currentPage.duration) }}</div>

        <div v-if="resolving" class="bili-status">正在解析清晰度...</div>

        <template v-else-if="res">
          <!-- 清晰度列表 -->
          <div class="bili-sec">视频流（DASH）</div>
          <div v-for="q in res.qualities" :key="q.id" class="bili-row">
            <div class="bili-row-info">
              <div class="bili-row-name">{{ qnName(q.id) }}<span class="bili-codec">{{ q.codec }}</span></div>
              <div class="bili-row-meta">{{ q.width }}×{{ q.height }}<template v-if="q.size"> · 约 {{ fmtSize(q.size) }}</template></div>
            </div>
            <button class="bili-dl" @click="download(q.id ? res.videos.find(v => v.id === q.id)?.url : '', qnName(q.id), 'video')">下载</button>
          </div>

          <div class="bili-sec">音频流</div>
          <div v-for="a in res.audios" :key="a.id" class="bili-row">
            <div class="bili-row-info">
              <div class="bili-row-name">{{ audioName(a.id) }}</div>
              <div class="bili-row-meta">{{ a.bandwidth ? (Math.round(a.bandwidth / 1000) + ' kbps') : '' }}</div>
            </div>
            <button class="bili-dl" @click="download(a.url, audioName(a.id), 'audio')">下载</button>
          </div>

          <!-- 下载队列 -->
          <template v-if="downloads.length">
            <div class="bili-sec">下载队列</div>
            <div v-for="d in downloads" :key="d.key" class="bili-dl-row">
              <div class="bili-dl-main">
                <div class="bili-dl-name" :title="d.name">{{ d.name }}</div>
                <div v-if="percent(d) !== null" class="bili-bar"><div class="bili-bar-in" :style="{ width: percent(d) + '%' }"></div></div>
              </div>
              <span class="bili-dl-state" :class="d.state">
                {{ d.state === 'done' ? '✓ 完成' : d.state === 'error' ? (d.retried ? '✗ 失败' : '重试中…') : (percent(d) !== null ? percent(d) + '%' : (d.received ? fmtSize(d.received) : '进行中')) }}
              </span>
              <button v-if="d.state === 'error'" class="bili-dl bili-dl-retry" @click="retry(d, true)">重试</button>
            </div>
          </template>

          <div class="bili-hint">
            B站音视频为独立 DASH 流：视频 .m4s + 音频 .m4a 下载后可用 ffmpeg 合并——
            <code>ffmpeg -i 视频.m4s -i 音频.m4s -c copy 输出.mp4</code>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
