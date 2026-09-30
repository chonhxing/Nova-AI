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
      downloads: [],       // { key, id, name, state: 'running'|'saving'|'done'|'error', received, total, retried, urls, label, kind, error, startedAt }
      now: Date.now(),     // 心跳：驱动"进行中"项的速度/耗时刷新
      _ticker: null,
    };
  },
  computed: {
    pages() { return this.info?.pages || []; },
    currentPage() { return this.pages[this.pageIndex] || null; },
  },
    async mounted() {
    // 每秒心跳：驱动进行中项的速度/耗时刷新（Vue 响应式）
    this._ticker = setInterval(() => { this.now = Date.now(); }, 1000);
    await this.load();
  },
  beforeUnmount() {
    if (this._ticker) { clearInterval(this._ticker); this._ticker = null; }
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
    // 主选 + 备用线路依次尝试（主选 403/失效时自动换备用）
    dlVideo(q) {
      if (this.resolving || this.processing) return;
      const v = this.res?.videos.find(x => x.id === q.id);
      if (!v?.url) return;
      const expected = Math.round(v.size || (v.bandwidth || 0) * (this.res.timelength || 0) / 8000) || 0;
      this.download([v.url, ...v.backups], this.qnName(q.id), 'video', expected);
    },
    dlAudio(a) {
      const s = this.res?.audios.find(x => x.id === a.id);
      if (!s?.url) return;
      const expected = Math.round((s.bandwidth || 0) * (this.res.timelength || 0) / 8000) || 0;
      this.download([s.url, ...s.backups], this.audioName(a.id), 'audio', expected);
    },
    async download(urls, qualityLabel, kind, expectedSize = 0, item = null) {
      const page = this.currentPage;
      if (!urls?.length || !this.info) return;
      if (!item) {
        const base = `无极下载/${this.sanitize(this.info.title)}${this.pages.length > 1 ? ` [P${page.page}]` : ''}`;
        const name = kind === 'audio'
          ? `${base} [${qualityLabel}] 音频流.m4a`
          : `${base} [${qualityLabel}] 视频流.m4s`;
        item = {
          key: name + Date.now(), id: null, name, state: 'running',
          received: 0, total: expectedSize, retried: false,
          urls, label: qualityLabel, kind, error: '', startedAt: Date.now(),
        };
        this.downloads.unshift(item);
      } else {
        item.state = 'running';
        item.error = '';
        item.startedAt = Date.now();
      }
      try {
        await this.fetchToDisk(item);   // 面板直 fetch（Referer 天然正确 + DNR 注 ACAO 放行）→ Blob → SW downloads 落盘
      } catch (e) {
        item.state = 'error';
        item.error = e.message;
        if (!item.retried) this.retry(item);
      }
    },
    // 多线路依次尝试
    async fetchToDisk(item) {
      let lastErr = '';
      for (const url of item.urls) {
        try { await this.fetchOne(url, item); return; }
        catch (e) { lastErr = e.message; }
      }
      throw new Error(lastErr || '全部线路均失败');
    },
    // 同页面 fetch：Referer 天然为 B 站页面（CDN 认可），DNR 注入 ACAO 放行 CORS；
    // 进度即本地响应式状态（不经过任何消息中转，不会丢）
    async fetchOne(url, item) {
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) throw new Error('CDN HTTP ' + resp.status);
      if (resp.headers.get('content-length')) item.total = Number(resp.headers.get('content-length'));
      const reader = resp.body.getReader();
      const chunks = [];
      let received = 0, lastB = 0, lastT = Date.now();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        item.received = received;
        if (received - lastB >= 1048576 || Date.now() - lastT >= 500) { lastB = received; lastT = Date.now(); }
      }
      if (received === 0) throw new Error('下载内容为空');
      item.received = received;
      item.state = 'saving';
      // Blob URL（页面源）交给 SW 的 chrome.downloads 落盘——内容脚本没有 downloads API，
      // 但浏览器下载子系统可以解析页面源 blob URL（内容脚本下载的标准模式）
      const blob = new Blob(chunks, { type: item.kind === 'audio' ? 'audio/mp4' : 'video/mp4' });
      const objUrl = URL.createObjectURL(blob);
      try {
        const r = await this.bridge.send('BILI_SAVE_BLOB', { blobUrl: objUrl, filename: item.name });
        if (!r?.ok) throw new Error(r?.error || '保存失败');
        item.id = r.id || null;
        item.state = 'done';
        setTimeout(() => URL.revokeObjectURL(objUrl), 600000);   // 下载器落盘可能较慢，延迟回收
      } catch (e) {
        URL.revokeObjectURL(objUrl);
        throw e;
      }
    },
    // 自动重试一次；手动按钮可无限重试（重新走一次 downloads 任务，URL 未过期）
    retry(item, manual = false) {
      if (!manual && item.retried) return;
      item.retried = true;
      this.download(item.urls, item.label, item.kind, item.total, item);
    },
    percent(d) {
      if (!d.total || d.state !== 'running') return null;
      return Math.min(100, Math.round((d.received / d.total) * 100));
    },
    // 进行中项的状态文案：百分比 / 已下载 / 速度（心跳驱动，永不显成"卡住"）
    runningText(d) {
      const bits = [];
      const p = this.percent(d);
      if (p !== null) bits.push(p + '%');
      if (d.received > 0) bits.push(this.fmtSize(d.received));
      const elapsed = (this.now - d.startedAt) / 1000;
      if (elapsed >= 2 && d.received > 0) bits.push(this.fmtSize(d.received / elapsed) + '/s');
      return bits.length ? bits.join(' · ') : '连接中…';
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
            <button class="bili-dl" @click="dlVideo(q)">下载</button>
          </div>

          <div class="bili-sec">音频流</div>
          <div v-for="a in res.audios" :key="a.id" class="bili-row">
            <div class="bili-row-info">
              <div class="bili-row-name">{{ audioName(a.id) }}</div>
              <div class="bili-row-meta">{{ a.bandwidth ? (Math.round(a.bandwidth / 1000) + ' kbps') : '' }}</div>
            </div>
            <button class="bili-dl" @click="dlAudio(a)">下载</button>
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
                {{ d.state === 'done' ? '✓ 完成' : d.state === 'saving' ? '保存中…' : d.state === 'error' ? (d.retried ? '✗ 失败' : '重试中…') : runningText(d) }}
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
