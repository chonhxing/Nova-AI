/**
 * 无极 — 弹幕管理姬 V3.0 (爬虫模块)
 * B站弹幕提取：完整 Protobuf 解码 + 按视频时长精确分段 + dmid 去重
 * 参考开源项目 https://github.com/HengXin666/BiLiBiLi_DanMu_Crawling 的抓取算法
 *
 * 关键修复：
 *  1. seg.so 按 6 分钟分段，用视频 duration 精确计算段数（不再固定 300 次）
 *  2. 不再因「空段」提前 break —— 弹幕分布不均，中间空段会导致后续弹幕全部丢失
 *  3. 完整解码 DanmakuElem 全部字段，用 dmid 去重（而非 time+text）
 *  4. 支持 history/seg.so 历史弹幕接口 + 可选 SESSDATA cookie
 */
const DanmakuCrawler = (function() {
  'use strict';

  const API_BASE = 'https://api.bilibili.com';
  const SEG_MS = 6 * 60 * 1000;      // 每段 6 分钟
  const SEG_MAX = 6000;              // 每段最多 6000 条弹幕

  function buildHeaders(cookie) {
    const h = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/'
    };
    if (cookie) h['Cookie'] = cookie;
    return h;
  }

  // ============================================================
  // Protobuf 解码器（完整字段）
  //   DmSegMobileReply { repeated DanmakuElem elems = 1; }
  //   DanmakuElem:
  //     1 id(int64) 2 progress(int32,ms) 3 mode(int32) 4 fontsize(int32)
  //     5 color(uint32) 6 midHash(str) 7 content(str) 8 ctime(int64)
  //     9 weight(int32) 10 action(str) 11 pool(int32) 12 idStr(str)
  //     13 attr(int32) 22 animation(str) 24 colorful(int32)
  // ============================================================
  function readVarint(buf, offset) {
    let result = 0n;
    let shift = 0n;
    const end = buf.length;
    while (offset < end) {
      const byte = BigInt(buf[offset++]);
      result |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) return { value: result, offset };
      shift += 7n;
    }
    return { value: result, offset };
  }

  function decodeDanmakuProtobuf(buf) {
    const list = [];
    let offset = 0;
    const end = buf.length;

    while (offset < end - 1) {
      let tag;
      try {
        tag = readVarint(buf, offset);
      } catch (e) { break; }
      offset = tag.offset;
      const fieldNumber = Number(tag.value >> 3n);
      const wireType = Number(tag.value & 0x7n);

      if (fieldNumber === 1 && wireType === 2) {
        // 嵌套消息：单个弹幕 DanmakuElem
        const len = readVarint(buf, offset);
        offset = len.offset;
        const innerEnd = offset + Number(len.value);
        const dm = decodeDanmakuElem(buf, offset, innerEnd);
        offset = innerEnd;
        if (dm && dm.text) list.push(dm);
      } else {
        // 跳过非目标字段
        const skipped = skipField(buf, offset, wireType);
        if (skipped < 0) break;
        offset = skipped;
      }
    }
    return list;
  }

  function decodeDanmakuElem(buf, start, end) {
    const dm = {
      id: 0, time: 0, mode: 1, fontSize: 25, color: 0xFFFFFF,
      text: '', weight: 0, pool: 0, attr: 0, ctime: 0
    };
    let io = start;
    while (io < end - 1) {
      let it;
      try { it = readVarint(buf, io); } catch (e) { break; }
      io = it.offset;
      const fn = Number(it.value >> 3n);
      const wt = Number(it.value & 0x7n);

      if (wt === 0) {
        const v = readVarint(buf, io);
        io = v.offset;
        const val = Number(v.value);
        if (fn === 1) dm.id = val;
        else if (fn === 2) dm.time = val / 1000;      // progress(ms) -> 秒
        else if (fn === 3) dm.mode = val;
        else if (fn === 4) { if (val > 0) dm.fontSize = val; }
        else if (fn === 5) dm.color = val >>> 0;        // uint32 颜色
        else if (fn === 8) dm.ctime = val;
        else if (fn === 9) dm.weight = val;
        else if (fn === 11) dm.pool = val;
        else if (fn === 13) dm.attr = val;
        else if (fn === 24) { /* colorful 忽略 */ }
      } else if (wt === 2) {
        const l = readVarint(buf, io);
        io = l.offset;
        const dEnd = io + Number(l.value);
        if (fn === 7) {                                  // content
          try { dm.text = new TextDecoder('utf-8').decode(buf.subarray(io, dEnd)); } catch (e) {}
        } else if (fn === 12 && !dm.id) {                // idStr -> id
          try {
            const idStr = new TextDecoder('utf-8').decode(buf.subarray(io, dEnd));
            dm.id = Number(idStr);
          } catch (e) {}
        }
        io = dEnd;
      } else if (wt === 1) {
        io += 8;
      } else if (wt === 5) {
        io += 4;
      } else {
        break;
      }
    }
    return dm;
  }

  function skipField(buf, offset, wireType) {
    try {
      if (wireType === 0) return readVarint(buf, offset).offset;
      if (wireType === 1) return offset + 8;
      if (wireType === 2) {
        const l = readVarint(buf, offset);
        return l.offset + Number(l.value);
      }
      if (wireType === 5) return offset + 4;
    } catch (e) {}
    return -1;
  }

  // ============================================================
  // XML 弹幕解析（兜底方案，仅用于降级）
  // ============================================================
  function parseDanmakuXML(xmlText) {
    const list = [];
    const regex = /<d\s+p="([^"]*)"[^>]*>(.*?)<\/d>/g;
    let match;
    const unescape = (s) => s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    while ((match = regex.exec(xmlText)) !== null) {
      const p = match[1].split(',');
      const text = unescape(match[2]);
      if (!text) continue;
      list.push({
        id: 0,
        time: parseFloat(p[0]) || 0,
        mode: parseInt(p[1]) || 1,
        fontSize: parseInt(p[2]) || 25,
        color: parseInt(p[3]) || 0xFFFFFF,
        text,
        weight: 0, pool: 0, attr: 0, ctime: 0
      });
    }
    return list;
  }

  // ============================================================
  // B站 API 调用（15s 超时，防止挂起的 fetch 永久卡住抓取流程）
  // ============================================================
  async function apiGet(path, cookie) {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: buildHeaders(cookie),
      credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  }

  function parseBvid(input) {
    // BV 号
    const bv = input.match(/BV[0-9A-Za-z]{10}/);
    if (bv) return { type: 'bv', value: bv[0] };
    // AV 号
    const av = input.match(/(?:^|[^0-9])[aA][vV](\d+)/);
    if (av) return { type: 'av', value: av[1] };
    return null;
  }

  /**
   * 获取视频分P列表（含 cid、时长）
   */
  async function getParts(bvidOrAv, cookie) {
    const parsed = parseBvid(bvidOrAv);
    if (!parsed) throw new Error('无法识别 BV/AV 号');
    const q = parsed.type === 'av' ? `aid=${parsed.value}` : `bvid=${parsed.value}`;
    const resp = await apiGet(`/x/player/pagelist?${q}`, cookie);
    const data = await resp.json();
    if (data.code !== 0 || !data.data || data.data.length === 0) {
      throw new Error('无效的视频号 (code:' + data.code + ')');
    }
    return data.data.map(p => ({
      cid: p.cid,
      page: p.page,
      part: p.part || ('P' + p.page),
      duration: p.duration || 0   // 秒
    }));
  }

  async function getVideoInfo(bvidOrAv, cookie) {
    try {
      const parsed = parseBvid(bvidOrAv);
      if (!parsed) return { title: bvidOrAv, duration: 0 };
      const q = parsed.type === 'av' ? `aid=${parsed.value}` : `bvid=${parsed.value}`;
      const resp = await apiGet(`/x/web-interface/view?${q}`, cookie);
      const data = await resp.json();
      if (data.code === 0 && data.data) {
        return {
          title: data.data.title || bvidOrAv,
          pic: data.data.pic || '',
          duration: data.data.duration || 0,   // 秒
          pubdate: data.data.pubdate || 0      // 发布时间(秒)
        };
      }
    } catch (e) { /* 降级 */ }
    return { title: bvidOrAv, duration: 0, pubdate: 0 };
  }

  async function getCidFromBvid(bvid) {
    const parts = await getParts(bvid);
    return { cid: parts[0].cid, part: parts[0].part };
  }

  // ============================================================
  // 弹幕抓取：seg.so 分段接口（精确分段）
  // ============================================================
  async function fetchDanmakuSeg(cid, durationSec, cookie, onProgress) {
    const all = [];
    // 预期段数（仅用于进度提示；duration 字段可能不准，不作为终止依据）
    const expectedSegs = durationSec > 0
      ? Math.ceil((durationSec * 1000) / SEG_MS) + 1
      : 0;
    const MAX_SEGS = 500;               // 绝对上限（约 50 小时视频），防止无限循环
    const MAX_EMPTY_STREAK = 8;         // 连续 8 个空段（48 分钟）视为弹幕结束

    let emptyStreak = 0;                // 连续空段计数

    for (let seg = 1; seg <= MAX_SEGS; seg++) {
      try {
        const resp = await apiGet(`/x/v2/dm/web/seg.so?type=1&oid=${cid}&segment_index=${seg}`);
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('json')) {
          // B站返回 JSON = 出错或被风控
          const errData = await resp.json().catch(() => ({ code: -1 }));
          if (errData.code === -412) {
            // 风控：停止并提示
            if (all.length > 0) break;
            throw new Error('请求被B站风控拦截(-412)，建议稍后重试或配置 SESSDATA Cookie');
          }
          // 其他 code（如 -1 段不存在）视为正常结束
          break;
        }
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (buf.length < 20) {
          emptyStreak++;
          if (emptyStreak >= MAX_EMPTY_STREAK) break;
          continue;
        }
        const segList = decodeDanmakuProtobuf(buf);
        if (segList.length === 0) {
          emptyStreak++;
          if (emptyStreak >= MAX_EMPTY_STREAK) break;
        } else {
          emptyStreak = 0;
          all.push(...segList);
        }

        if (onProgress && seg % 10 === 0) {
          const hint = expectedSegs > 0 ? ` /${expectedSegs}段` : '';
          onProgress({ status: 'fetching', message: `已抓取 ${seg}${hint} · ${all.length} 条弹幕` });
        }
        // 轻量限速，避免触发风控
        if (seg % 20 === 0) await new Promise(r => setTimeout(r, 120));
      } catch (e) {
        if (all.length === 0) throw e;
        break;
      }
    }
    return all;
  }

  // ============================================================
  // 历史弹幕：history/seg.so 按日期逐日抓取（完整模式，需 cookie）
  // ============================================================
  function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function fetchDanmakuHistory(cid, pubdate, cookie, onProgress) {
    if (!cookie) throw new Error('历史弹幕需要 SESSDATA Cookie');
    const all = [];
    // 从视频发布日爬到今天（最多 365 天，保护请求量）
    const today = new Date();
    let day = new Date((pubdate || 0) * 1000);
    if (!pubdate || isNaN(day.getTime())) day = today;
    // 限制最早 1 年前
    const earliest = new Date(today.getTime() - 365 * 24 * 3600 * 1000);
    if (day < earliest) day = earliest;

    let emptyStreak = 0;
    for (let i = 0; i < 400; i++) {
      if (day > today) break;
      const dateStr = formatDate(day);
      try {
        const resp = await apiGet(`/x/v2/dm/web/history/seg.so?type=1&oid=${cid}&date=${dateStr}`, cookie);
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('json')) break;
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (buf.length < 20) { emptyStreak++; if (emptyStreak > 3) break; }
        else {
          const segList = decodeDanmakuProtobuf(buf);
          if (segList.length === 0) { emptyStreak++; if (emptyStreak > 3) break; }
          else { emptyStreak = 0; all.push(...segList); }
        }
        if (onProgress && i % 10 === 0) {
          onProgress({ status: 'fetching', message: `历史弹幕 ${dateStr} · ${all.length} 条` });
        }
        await new Promise(r => setTimeout(r, 80));
      } catch (e) {
        break;
      }
      day.setDate(day.getDate() + 1);
    }
    return all;
  }

  // ============================================================
  // 去重 & 排序（按 dmid 去重）
  // ============================================================
  function dedupeAndSort(list) {
    const byId = new Map();
    const byKey = new Map();
    const out = [];
    for (const d of list) {
      if (d.id > 0) {
        if (byId.has(d.id)) continue;
        byId.set(d.id, true);
      } else {
        // 无 id 的兜底：time+text+mode 组合键
        const key = `${d.time.toFixed(2)}_${d.mode}_${d.text}`;
        if (byKey.has(key)) continue;
        byKey.set(key, true);
      }
      out.push(d);
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  // ============================================================
  // 主抓取流程
  // ============================================================
  /**
   * @param {string} bvidOrUrl  BV 号 / AV 号 / 链接
   * @param {object} options    { cookie?: string, useHistory?: boolean, pageIndex?: number }
   * @param {function} onProgress
   */
  async function crawlDanmaku(bvidOrUrl, options, onProgress) {
    if (typeof options === 'function') { onProgress = options; options = {}; }
    options = options || {};
    const cookie = options.cookie || '';
    const pageIndex = options.pageIndex || 0;

    const report = (status, message, extra) => {
      if (onProgress) onProgress(Object.assign({ status, message }, extra));
    };

    // 1. 解析分P，确定目标 cid 与时长
    const parts = await getParts(bvidOrUrl, cookie);
    const target = parts[pageIndex] || parts[0];
    if (!target) throw new Error('未找到视频分P信息');

    // 2. 获取视频信息（标题、总时长）
    const info = await getVideoInfo(bvidOrUrl, cookie);
    const durationSec = target.duration || info.duration || 0;
    report('fetching', `CID: ${target.cid} (${target.part})，正在获取弹幕...`);

    // 3. seg.so 全量分段抓取
    let danmaku = await fetchDanmakuSeg(target.cid, durationSec, cookie, report);

    // 4. 完整模式：补充历史弹幕
    let historyCount = 0;
    if (options.useHistory) {
      report('fetching', '正在补充历史弹幕（完整模式）...');
      try {
        const hist = await fetchDanmakuHistory(target.cid, info.pubdate, cookie, report);
        danmaku = danmaku.concat(hist);
        historyCount = hist.length;
      } catch (e) {
        report('fetching', '历史弹幕获取失败：' + e.message);
      }
    }

    // 5. 去重排序
    danmaku = dedupeAndSort(danmaku);

    report('done', `获取到 ${danmaku.length} 条弹幕${historyCount ? `（含历史 ${historyCount} 条）` : ''}`, {
      count: danmaku.length
    });

    return {
      bvid: bvidOrUrl,
      cid: target.cid,
      part: target.part,
      title: info.title || target.part,
      duration: durationSec,
      pages: parts.map(p => ({ cid: p.cid, page: p.page, part: p.part, duration: p.duration })),
      count: danmaku.length,
      danmaku,
      createdAt: Date.now()
    };
  }

  // ============================================================
  // 本地存储（配额保护 + LRU 淘汰：超 10MB 时清理最旧弹幕集）
  // ============================================================
  const MAX_DANMAKU_SETS = 12; // 最多保留的弹幕集数量

  async function evictOldestDanmakuSets(keepBvid) {
    const idxR = await chrome.storage.local.get('danmaku_index');
    const idx = (idxR.danmaku_index || []).filter(e => e.bvid !== keepBvid);
    // 按 createdAt 升序，最旧的在前
    idx.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const victims = idx.slice(0, Math.max(1, idx.length - MAX_DANMAKU_SETS + 1));
    if (victims.length > 0) {
      await chrome.storage.local.remove(victims.map(e => `danmaku_set_${e.bvid}`));
    }
    return victims;
  }

  async function saveDanmakuSet(danmakuSet) {
    const key = `danmaku_set_${danmakuSet.bvid}`;
    try {
      await chrome.storage.local.set({ [key]: danmakuSet });
    } catch (e) {
      // 配额超限：淘汰最旧弹幕集后重试一次
      if (e && /quota|exceeded/i.test(String(e.message || e.name || ''))) {
        try { await evictOldestDanmakuSets(danmakuSet.bvid); } catch (e2) {}
        await chrome.storage.local.set({ [key]: danmakuSet });
      } else {
        throw e;
      }
    }
    const idxR = await chrome.storage.local.get('danmaku_index');
    const idx = idxR.danmaku_index || [];
    const existing = idx.findIndex(e => e.bvid === danmakuSet.bvid);
    const entry = { bvid: danmakuSet.bvid, title: danmakuSet.title, count: danmakuSet.count, createdAt: danmakuSet.createdAt };
    if (existing >= 0) idx[existing] = entry;
    else idx.unshift(entry);
    // 索引本身也做容量保护
    if (idx.length > 50) idx.length = 50;
    await chrome.storage.local.set({ danmaku_index: idx });
    return entry;
  }

  async function loadDanmakuSet(bvid) {
    const key = `danmaku_set_${bvid}`;
    const r = await chrome.storage.local.get(key);
    return r[key] || null;
  }

  async function listDanmakuSets() {
    const r = await chrome.storage.local.get('danmaku_index');
    return r.danmaku_index || [];
  }

  async function deleteDanmakuSet(bvid) {
    const key = `danmaku_set_${bvid}`;
    await chrome.storage.local.remove(key);
    const idxR = await chrome.storage.local.get('danmaku_index');
    const idx = (idxR.danmaku_index || []).filter(e => e.bvid !== bvid);
    await chrome.storage.local.set({ danmaku_index: idx });
  }

  async function getActiveDanmaku() {
    const r = await chrome.storage.local.get('danmaku_active');
    const bvid = r.danmaku_active || null;
    if (!bvid) return null;
    return loadDanmakuSet(bvid);
  }

  async function setActiveDanmaku(bvid) {
    await chrome.storage.local.set({ danmaku_active: bvid || '' });
  }

  // 保存/读取 SESSDATA cookie 配置
  async function getCookie() {
    const r = await chrome.storage.local.get('danmaku_sessdata');
    return r.danmaku_sessdata || '';
  }
  async function setCookie(sessdata) {
    await chrome.storage.local.set({ danmaku_sessdata: sessdata || '' });
  }

  return {
    crawlDanmaku,
    saveDanmakuSet,
    loadDanmakuSet,
    listDanmakuSets,
    deleteDanmakuSet,
    getActiveDanmaku,
    setActiveDanmaku,
    getCidFromBvid,
    getVideoInfo,
    getParts,
    getCookie,
    setCookie
  };
})();
