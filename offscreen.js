/**
 * 无极 — Offscreen 文档（B站视频流下载）
 *
 * 为什么需要它：B站正规 CDN 校验 Referer（无则 403）。chrome.downloads 直链
 * 的 Referer 注入两条路（downloads API headers / DNR 对下载请求）都被实测证伪；
 * 而 fetch 请求是 DNR 的标准拦截对象（扩展发起的 fetch tabId=-1，会话规则必然
 * 生效），且扩展有 <all_urls> host 权限时 SW/扩展页 fetch 不受 CORS 限制。
 * 因此在 offscreen 文档里流式 fetch 整条流 → Blob → objectURL → chrome.downloads。
 *
 * 协议（chrome.runtime 消息）：
 *   收 { target:'offscreen', type:'BILI_FETCH_DOWNLOAD', url, filename, key }
 *   发 { type:'BILI_DL_PROGRESS', key, received, total }
 *   发 { type:'BILI_DL_RESULT',  key, ok, error?, id? }
 */

'use strict';

const PROGRESS_STEP = 4 * 1024 * 1024; // 每 ~4MB 上报一次进度

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'BILI_FETCH_DOWNLOAD') return false;
  doDownload(msg).catch((e) => report(msg.key, { ok: false, error: e.message }));
  return false;
});

async function doDownload({ urls, filename, key }) {
  let lastErr = '';
  for (const url of urls) {
    try {
      await fetchAndSave(url, filename, key);
      return;   // 成功即结束
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr || '全部线路均失败');
}

async function fetchAndSave(url, filename, key) {
  // Referer 由 DNR 会话规则注入（本文档 fetch 无标签页，命中 tabIds:[-1] 规则）
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('CDN HTTP ' + resp.status + (resp.status === 403 ? '（Referer 注入未生效）' : ''));
  const total = Number(resp.headers.get('content-length')) || 0;

  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  let lastReport = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received - lastReport >= PROGRESS_STEP) {
      lastReport = received;
      chrome.runtime.sendMessage({ type: 'BILI_DL_PROGRESS', key, received, total }).catch(() => {});
    }
  }
  chrome.runtime.sendMessage({ type: 'BILI_DL_PROGRESS', key, received, total }).catch(() => {});

  const blob = new Blob(chunks, { type: 'video/mp4' });
  const objUrl = URL.createObjectURL(blob);
  chrome.downloads.download({ url: objUrl, filename, saveAs: false }, (id) => {
    const err = chrome.runtime.lastError;
    setTimeout(() => URL.revokeObjectURL(objUrl), 120000);   // 下载器可能仍在读，延迟回收
    report(key, id !== undefined && !err, err?.message, id);
  });
}

function report(key, payload) {
  chrome.runtime.sendMessage({ type: 'BILI_DL_RESULT', key, ...payload }).catch(() => {});
}
