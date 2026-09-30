/**
 * 无极 — Offscreen 文档（B站视频流下载）
 *
 * 为什么需要它：B站正规 CDN 校验 Referer（无则 403）。chrome.downloads 直链
 * 的 Referer 注入两条路（downloads API headers / DNR 对下载请求）都被实测证伪；
 * 而 fetch 请求是 DNR 的标准拦截对象（扩展发起的 fetch tabId=-1，会话规则必然
 * 生效），且扩展有 <all_urls> host 权限时 fetch 不受 CORS 限制。
 *
 * 落盘策略：流式 fetch → OPFS 渐进写入（内存占用恒定，4K 大文件也不爆）→
 * 完成后从 OPFS 文件创建磁盘后备 blob URL → chrome.downloads 落到用户目录 →
 * 清理 OPFS 临时文件。
 *
 * 协议（chrome.runtime 消息）：
 *   收 { target:'offscreen', type:'BILI_FETCH_DOWNLOAD', urls, filename, key }
 *   发 { type:'BILI_DL_PROGRESS', key, received, total }   （1MB / 800ms 双阈值节流）
 *   发 { type:'BILI_DL_RESULT',  key, ok, error?, id? }
 */

'use strict';

const PROGRESS_BYTES = 1024 * 1024;   // 每 1MB 上报
const PROGRESS_MS = 800;              // 或每 800ms 上报（慢速网络也能看到活着）

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'BILI_FETCH_DOWNLOAD') return false;
  doDownload(msg).catch((e) => report(msg.key, { ok: false, error: e.message }));
  return false;
});

async function doDownload({ urls, filename, key }) {
  let lastErr = '';
  for (const url of urls) {
    try {
      await fetchToOpfs(url, filename, key);
      return;   // 成功即结束
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr || '全部线路均失败');
}

async function fetchToOpfs(url, filename, key) {
  // Referer 由 DNR 会话规则注入（本文档 fetch 无标签页，命中 tabIds:[-1] 规则）
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('CDN HTTP ' + resp.status);
  const total = Number(resp.headers.get('content-length')) || 0;

  const root = await navigator.storage.getDirectory();
  const tempName = 'wuji-dl-' + String(key).replace(/[^\w-]/g, '_');
  const fh = await root.getFileHandle(tempName, { create: true });
  const writable = await fh.createWritable();

  const reader = resp.body.getReader();
  let received = 0, lastBytes = 0, lastTime = Date.now();
  const report = (force) => {
    if (force || received - lastBytes >= PROGRESS_BYTES || Date.now() - lastTime >= PROGRESS_MS) {
      lastBytes = received;
      lastTime = Date.now();
      chrome.runtime.sendMessage({ type: 'BILI_DL_PROGRESS', key, received, total }).catch(() => {});
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await writable.write(value);
    received += value.length;
    report(false);
  }
  report(true);
  await writable.close();
  chrome.runtime.sendMessage({ type: 'BILI_DL_PROGRESS', key, received, total }).catch(() => {});

  const file = await fh.getFile();
  if (file.size === 0) { await root.removeEntry(tempName).catch(() => {}); throw new Error('下载内容为空'); }

  const objUrl = URL.createObjectURL(file);
  chrome.downloads.download({ url: objUrl, filename, saveAs: false }, (id) => {
    const err = chrome.runtime.lastError;
    setTimeout(() => URL.revokeObjectURL(objUrl), 120000);   // 下载器可能仍在读，延迟回收
    root.removeEntry(tempName).catch(() => {});              // blob 系统已接管数据，清理临时文件
    report(key, id !== undefined && !err, err?.message, id);
  });
}
