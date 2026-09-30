/**
 * 无极 — B站视频下载引擎（Service Worker 侧）
 * 核心算法移植自开源项目 Bili23-Downloader（Python）：WBI 签名、playurl 取流、
 * 清晰度对照、文件名清洗。仅作算法移植，实现与架构为无极原创。
 *
 * 关键契约：
 *   - 接口请求 fetch(credentials:'include')：扩展有 <all_urls> host 权限，
 *     浏览器自动附带用户在 B 站的登录 Cookie（SESSDATA 等），清晰度随账号。
 *   - Referer：SW 的 fetch 不发送 Referer 且 fetch 无法手设（禁止头），
 *     用 declarativeNetRequest 会话规则对第三方（扩展发起）请求注入
 *     Referer: https://www.bilibili.com/（B 站页面自身的一/三方请求不受影响）。
 *   - CDN 下载：鉴权信息全在 URL 查询参数里，无需 Cookie；同样靠会话规则
 *     补 Referer 后交 chrome.downloads 直链下载。
 *   - WBI 签名：md5Hex 复用本文件依赖的 service-worker 侧实现（百度翻译引入）。
 */

(function () {
  'use strict';

  // ============================================================
  // WBI 签名（移植自 Bili23 src/util/parse/parser/base.py）
  // ============================================================
  const WBI_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
  ];

  const BILI_NAV_API = 'https://api.bilibili.com/x/web-interface/nav';
  const BILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/wbi/view';
  const BILI_PLAYURL_API = 'https://api.bilibili.com/x/player/wbi/playurl';

  // 清晰度/音质对照（Bili23 src/util/common/data/media_info.py）
  const BILI_QN_NAMES = {
    127: '8K 超高清', 126: '杜比视界', 125: 'HDR 真彩', 122: '4K SDR', 120: '4K 超清',
    116: '1080P 60帧', 112: '1080P 高码率', 100: '智能修复', 80: '1080P 高清',
    74: '720P 60帧', 64: '720P 高清', 32: '480P 清晰', 16: '360P 流畅'
  };
  const BILI_AUDIO_NAMES = { 30251: 'Hi-Res 无损', 30250: '杜比全景声', 30280: '192K 高品质', 30232: '132K 中品质', 30216: '64K 普通' };
  const BILI_CODEC_NAMES = { 7: 'AVC(H.264)', 12: 'HEVC(H.265)', 13: 'AV1' };

  let _wbi = { imgKey: '', subKey: '', ts: 0 };
  let _rulesReady = false;

  async function ensureRefererRules() {
    if (_rulesReady) return;
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [
          {
            id: 9001, priority: 1,
            action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' }] },
            condition: { urlFilter: '||api.bilibili.com', resourceTypes: ['xmlhttprequest'], domainType: 'thirdParty' }
          },
          {
            id: 9002, priority: 1,
            action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.bilibili.com/' }] },
            condition: { requestDomains: ['bilivideo.com', 'akamaized.net', 'hdslb.com'], resourceTypes: ['media', 'other', 'xmlhttprequest'], domainType: 'thirdParty' }
          }
        ]
      });
      _rulesReady = true;
    } catch (e) { console.warn('[无极B站] Referer 规则注入失败:', e.message); }
  }

  // nav 拉取 wbi key（会话缓存 1 小时；key 每日轮换，足够）。
  // 偶发风控/抖动（-412 等）按 Bili23 解析级重试策略重试：最多 3 次、间隔 2s
  async function ensureWbiKeys() {
    if (_wbi.imgKey && Date.now() - _wbi.ts < 3600e3) return _wbi;
    let lastMsg = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetchJSON(BILI_NAV_API, { credentials: 'include' }, 12000);
        if (!resp.ok) throw new Error('B站 nav 接口 HTTP ' + resp.status);
        const j = await resp.json();
        const img = j?.data?.wbi_img?.img_url || '';
        const sub = j?.data?.wbi_img?.sub_url || '';
        if (img && sub) {
          _wbi = {
            imgKey: img.split('/').pop().split('.')[0],
            subKey: sub.split('/').pop().split('.')[0],
            ts: Date.now()
          };
          return _wbi;
        }
        lastMsg = 'B站接口 ' + (j.code ?? '') + '：' + (j.message || '未返回 wbi_img');
      } catch (e) {
        lastMsg = e.message;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error(lastMsg || 'B站 nav 接口不可用');
  }

  function mixinKey() {
    const orig = _wbi.imgKey + _wbi.subKey;
    let out = '';
    for (const i of WBI_MIXIN_KEY_ENC_TAB) out += orig[i] || '';
    return out.slice(0, 32);
  }

  // 与 Python urlencode 对齐：encodeURIComponent 后把 %20 换回 '+'（空格）
  function formEncode(params) {
    return Object.entries(params)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v)).replace(/%20/g, '+'))
      .join('&');
  }

  // enc_wbi（移植）：加 wts → 按键排序 → 值过滤 !'()* → form 编码 → md5(query+mixinKey) → 附 w_rid
  function encWbi(params) {
    const p = { ...params, wts: Math.floor(Date.now() / 1000) };
    const sorted = {};
    for (const k of Object.keys(p).sort()) sorted[k] = String(p[k]).replace(/[!'()*]/g, '');
    const query = formEncode(sorted);
    const wRid = md5Hex(query + mixinKey());
    return formEncode({ ...sorted, w_rid: wRid });
  }

  // ============================================================
  // 元数据 / 取流
  // ============================================================
  // CDN 主机黑名单（移植自 Bili23 src/util/network/cdn.py）：mcdn/pcdn 为 P2P
  // 变体线路，浏览器直链下载不可靠，优先换备用线路
  const BILI_CDN_HOST_BLACKLIST = ['mcdn.bilivideo.cn', 'pcdn.bilivideo.cn', 'szbdyd.com', 'mountaintos.cn', 'mountaintoys.cn', 'upos-sz-mirror14b.bilivideo.com', 'nexusedgeio.com', 'ahdohpiechei.com'];
  function isBlacklistedHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return BILI_CDN_HOST_BLACKLIST.some(b => h === b || h.endsWith('.' + b));
  }

  // baseUrl + backupUrl 合并择优：首个非黑名单主机；全被过滤时退回原始首选
  function pickStreamUrl(entry) {
    const candidates = [entry.base_url || entry.baseUrl, ...(entry.backup_url || entry.backupUrl || [])].filter(Boolean);
    if (!candidates.length) return '';
    for (const u of candidates) {
      try { if (!isBlacklistedHost(new URL(u).hostname)) return u; } catch (e) { /* 非法 URL 跳过 */ }
    }
    return candidates[0];
  }

  async function getVideoInfo(bvid) {
    await ensureRefererRules();
    await ensureWbiKeys();
    const resp = await fetchJSON(BILI_VIEW_API + '?' + encWbi({ bvid }), { credentials: 'include' }, 15000);
    if (!resp.ok) throw new Error('B站视频信息接口 HTTP ' + resp.status);
    const j = await resp.json();
    if (j.code !== 0) throw new Error('B站接口 ' + j.code + '：' + (j.message || '获取失败'));
    const d = j.data || {};
    return {
      bvid: d.bvid || bvid,
      title: d.title || '',
      pic: d.pic || '',
      owner: d.owner?.name || '',
      duration: d.duration || 0,
      pages: (d.pages || []).map(p => ({ cid: p.cid, part: p.part || ('P' + p.page), page: p.page || 1, duration: p.duration || 0 }))
    };
  }

  // qn 传 127 探测账号权限上限（Bili23 parse_worker 同款做法）
  async function resolveStreams({ bvid, cid, qn }) {
    await ensureRefererRules();
    await ensureWbiKeys();
    const query = encWbi({ bvid, cid, qn: qn || 127, fnver: 0, fnval: 4048, fourk: 1 });
    const resp = await fetchJSON(BILI_PLAYURL_API + '?' + query, { credentials: 'include' }, 15000);
    if (!resp.ok) throw new Error('B站取流接口 HTTP ' + resp.status);
    const j = await resp.json();
    if (j.code !== 0) throw new Error('B站接口 ' + j.code + '：' + (j.message || '取流失败'));
    const d = j.data || {};
    const dash = d.dash || {};
    const pick = (o) => pickStreamUrl(o);
    const backups = (o) => (o?.backup_url || o?.backupUrl || []).filter(Boolean);

    const videos = (dash.video || []).map(v => ({
      id: v.id, quality: BILI_QN_NAMES[v.id] || (v.id + 'P'),
      codecId: v.codecid, codec: BILI_CODEC_NAMES[v.codecid] || (v.codecs || '').split('.')[0],
      codecs: v.codecs || '', width: v.width || 0, height: v.height || 0,
      bandwidth: v.bandwidth || 0, size: v.size || 0,
      url: pick(v), backups: backups(v)
    })).filter(v => v.url);

    const audios = (dash.audio || []).map(a => ({
      id: a.id, quality: BILI_AUDIO_NAMES[a.id] || String(a.id),
      bandwidth: a.bandwidth || 0, url: pick(a), backups: backups(a)
    })).filter(a => a.url);
    if (dash.flac?.audio) {
      const f = dash.flac.audio;
      if (pick(f)) audios.push({ id: 30251, quality: BILI_AUDIO_NAMES[30251], bandwidth: f.bandwidth || 0, url: pick(f), backups: backups(f) });
    }
    if (dash.dolby?.audio?.length) {
      const f = dash.dolby.audio[0];
      if (pick(f)) audios.push({ id: 30250, quality: BILI_AUDIO_NAMES[30250], bandwidth: f.bandwidth || 0, url: pick(f), backups: backups(f) });
    }
    audios.sort((a, b) => b.id - a.id);

    // 按清晰度去重（同 qn 多编码时保留带宽最高的一条，信息里列出编码）
    const byQn = new Map();
    for (const v of videos) {
      const cur = byQn.get(v.id);
      if (!cur || v.bandwidth > cur.bandwidth) byQn.set(v.id, v);
    }
    const qualities = [...byQn.values()].sort((a, b) => b.id - a.id).map(v => ({
      id: v.id, quality: v.quality, codec: v.codec, width: v.width, height: v.height,
      size: v.size || Math.round(v.bandwidth * (d.timelength || 0) / 8000)
    }));

    return {
      bvid: d.bvid || bvid, cid, title: d.title || '', timelength: d.timelength || 0,
      acceptDescription: (d.support_formats || []).map(s => s.new_description || s.display_desc || '').filter(Boolean),
      qualities, videos, audios
    };
  }

  // ============================================================
  // 下载（chrome.downloads 直链 + Referer 会话规则）
  // ============================================================
  // 按路径段清洗（保留 "/" 作为 chrome.downloads 的子目录分隔符；
  // 非法字符为 Windows 集合，":" 在段内替换，段首尾空格点删除）
  function sanitizeName(name) {
    return String(name || '').split('/').map(seg => {
      const cleaned = seg.replace(/[<>:"\\|?*\x00-\x1f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').trim();
      return cleaned || '_';
    }).join('/');
  }

  async function download(url, filename) {
    await ensureRefererRules();
    // 正规 upos CDN 校验 Referer（实测无 Referer 403）；downloads API 支持自定义
    // headers（Referer 非受限头），DNR 会话规则作为冗余兜底
    return new Promise((resolve) => {
      const start = (headers) => chrome.downloads.download({ url, filename: sanitizeName(filename), saveAs: false, headers }, (id) => {
        const err = chrome.runtime.lastError;
        if (err && headers) { start(undefined); return; }   // headers 被拒时退化为无自定义头重试
        resolve({ ok: id !== undefined && !err, id, error: err?.message });
      });
      start([{ name: 'Referer', value: 'https://www.bilibili.com/' }]);
    });
  }

  globalThis.BiliDownloader = { ensureInit: ensureRefererRules, getVideoInfo, resolveStreams, download, sanitizeName, BILI_QN_NAMES, BILI_AUDIO_NAMES };
})();
