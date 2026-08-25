/**
 * 无极 — 弹幕管理姬 V2.0 (爬虫模块)
 * B站弹幕提取 + Protobuf解码 + XML回退 + 本地存储
 */
const DanmakuCrawler = (function() {
  'use strict';

  const API_BASE = 'https://api.bilibili.com';
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.bilibili.com/'
  };

  // ============================================================
  // Protobuf 解码器
  // ============================================================
  function readVarint(buf, offset) {
    let result = 0n;
    let shift = 0n;
    while (offset < buf.length) {
      const byte = BigInt(buf[offset++]);
      result |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) break;
      shift += 7n;
    }
    return { value: result, offset };
  }

  function decodeDanmakuProtobuf(buf) {
    const danmakuList = [];
    let offset = 0;
    while (offset < buf.length - 1) {
      try {
        const tag = readVarint(buf, offset);
        offset = tag.offset;
        const fieldNumber = Number(tag.value >> 3n);
        const wireType = Number(tag.value & 0x7n);

        if (fieldNumber === 1 && wireType === 2) {
          // 嵌套消息（单个弹幕）
          const len = readVarint(buf, offset);
          offset = len.offset;
          const inner = buf.slice(offset, offset + Number(len.value));
          offset += Number(len.value);

          const dm = { time: 0, mode: 1, fontSize: 25, color: 0xFFFFFF, text: '' };
          let io = 0;
          while (io < inner.length - 1) {
            const it = readVarint(inner, io);
            io = it.offset;
            const fn = Number(it.value >> 3n);
            const wt = Number(it.value & 0x7n);
            if (wt === 0) {
              const v = readVarint(inner, io);
              io = v.offset;
              const val = Number(v.value);
              if (fn === 2) dm.time = val / 1000;
              else if (fn === 3) dm.mode = val;
              else if (fn === 4) dm.fontSize = val;
              else if (fn === 5) dm.color = val;
            } else if (wt === 2) {
              const l = readVarint(inner, io);
              io = l.offset;
              const d = inner.slice(io, io + Number(l.value));
              io += Number(l.value);
              if (fn === 7) {
                dm.text = new TextDecoder('utf-8').decode(d);
              }
            } else if (wt === 1 || wt === 5) {
              io += wt === 1 ? 8 : 4;
            }
          }
          if (dm.text) danmakuList.push(dm);
        } else if (wireType === 0) {
          const v = readVarint(buf, offset);
          offset = v.offset;
        } else if (wireType === 2) {
          const l = readVarint(buf, offset);
          offset = l.offset + Number(l.value);
        } else if (wireType === 1) {
          offset += 8;
        } else if (wireType === 5) {
          offset += 4;
        } else {
          break;
        }
      } catch (e) {
        break;
      }
    }
    return danmakuList;
  }

  // ============================================================
  // XML 弹幕解析（备用方案）
  // ============================================================
  function parseDanmakuXML(xmlText) {
    const danmakuList = [];
    const regex = /<d\s+p="([^"]*)">(.*?)<\/d>/g;
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
      const p = match[1].split(',');
      const text = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      if (text) {
        danmakuList.push({
          time: parseFloat(p[0]) || 0,
          mode: parseInt(p[1]) || 1,
          fontSize: parseInt(p[2]) || 25,
          color: parseInt(p[3]) || 0xFFFFFF,
          text: text
        });
      }
    }
    return danmakuList;
  }

  // ============================================================
  // B站API调用
  // ============================================================
  async function apiGet(path) {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: HEADERS,
      credentials: 'omit'
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  }

  async function getCidFromBvid(bvid) {
    // 判断是BV号还是AV号
    const isAv = /^[aA][vV]\d+/.test(bvid);
    let resp;
    if (isAv) {
      const aid = bvid.match(/\d+/)[0];
      resp = await apiGet(`/x/player/pagelist?aid=${aid}`);
    } else {
      resp = await apiGet(`/x/player/pagelist?bvid=${bvid}`);
    }
    const data = await resp.json();
    if (data.code !== 0 || !data.data || data.data.length === 0) throw new Error('无效的视频号或视频信息获取失败(code:' + data.code + ')');
    return { cid: data.data[0].cid, part: data.data[0].part || '' };
  }

  async function getVideoInfo(bvid) {
    try {
      const isAv = /^[aA][vV]\d+/.test(bvid);
      let path;
      if (isAv) {
        const aid = bvid.match(/\d+/)[0];
        path = `/x/web-interface/view?aid=${aid}`;
      } else {
        path = `/x/web-interface/view?bvid=${bvid}`;
      }
      const resp = await apiGet(path);
      const data = await resp.json();
      if (data.code === 0 && data.data) {
        return { title: data.data.title || bvid, pic: data.data.pic || '' };
      }
    } catch (e) { /* 降级 */ }
    return { title: bvid };
  }

  // ============================================================
  // 弹幕抓取（Protobuf 分段 API）
  // ============================================================
  async function fetchDanmakuProto(oid) {
    const allDanmaku = [];
    for (let seg = 1; seg <= 300; seg++) {
      try {
        const resp = await apiGet(`/x/v2/dm/web/seg.so?type=1&oid=${oid}&segment_index=${seg}`);
        const contentType = resp.headers.get('content-type') || '';
        // B站错误时返回JSON而非protobuf
        if (contentType.includes('json')) {
          const errData = await resp.json();
          if (errData.code !== 0) break;
          continue;
        }
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (buf.length < 20) break;
        const danmaku = decodeDanmakuProtobuf(buf);
        if (danmaku.length === 0 && seg > 1) break;
        allDanmaku.push(...danmaku);
        if (seg % 20 === 0) await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        if (allDanmaku.length === 0) console.warn('[Danmaku] proto seg error:', e.message);
        break;
      }
    }
    return allDanmaku;
  }

  // ============================================================
  // 弹幕抓取（XML 回退方案）
  // ============================================================
  async function fetchDanmakuXML(oid) {
    try {
      const resp = await apiGet(`/x/v1/dm/list.so?oid=${oid}`);
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const errData = await resp.json();
        console.warn('[Danmaku] XML fallback returned error:', errData);
        return [];
      }
      const xmlText = await resp.text();
      if (!xmlText || xmlText.length < 50) return [];
      return parseDanmakuXML(xmlText);
    } catch (e) {
      console.warn('[Danmaku] XML fallback error:', e.message);
      return [];
    }
  }

  // ============================================================
  // 主抓取流程
  // ============================================================
  async function crawlDanmaku(bvid, onProgress) {
    const { cid } = await getCidFromBvid(bvid);
    const info = await getVideoInfo(bvid);

    if (onProgress) onProgress({ status: 'fetching', message: `CID: ${cid}, 正在获取弹幕...` });

    // 首选 Protobuf 分段 API
    let danmaku = await fetchDanmakuProto(cid);

    // 如果 Protobuf 无结果，尝试 XML API
    if (danmaku.length === 0) {
      if (onProgress) onProgress({ status: 'fetching', message: 'Protobuf API 无数据，尝试 XML 回退...' });
      danmaku = await fetchDanmakuXML(cid);
    }

    // 去重排序
    const seen = new Set();
    danmaku = danmaku.filter(d => {
      const key = `${d.time.toFixed(2)}_${d.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.time - b.time);

    if (onProgress) onProgress({ status: 'done', message: `获取到 ${danmaku.length} 条弹幕`, count: danmaku.length });

    return {
      bvid,
      cid,
      title: info.title,
      count: danmaku.length,
      danmaku,
      createdAt: Date.now()
    };
  }

  // ============================================================
  // 本地存储
  // ============================================================
  async function saveDanmakuSet(danmakuSet) {
    const key = `danmaku_set_${danmakuSet.bvid}`;
    await chrome.storage.local.set({ [key]: danmakuSet });
    const idxR = await chrome.storage.local.get('danmaku_index');
    const idx = idxR.danmaku_index || [];
    const existing = idx.findIndex(e => e.bvid === danmakuSet.bvid);
    const entry = { bvid: danmakuSet.bvid, title: danmakuSet.title, count: danmakuSet.count, createdAt: danmakuSet.createdAt };
    if (existing >= 0) idx[existing] = entry;
    else idx.unshift(entry);
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

  return {
    crawlDanmaku,
    saveDanmakuSet,
    loadDanmakuSet,
    listDanmakuSets,
    deleteDanmakuSet,
    getActiveDanmaku,
    setActiveDanmaku,
    getCidFromBvid,
    getVideoInfo
  };
})();
