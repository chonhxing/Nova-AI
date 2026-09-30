/**
 * 无极 — Offscreen 文档（B站下载落盘器）
 *
 * 面板（B站页内容脚本）本地流式 fetch CDN（Referer 天然正确 + DNR 注入 CORS
 * 放行头），按 4MB 分块经结构化克隆消息送达本文档，写入 OPFS 渐进落盘
 * （内存占用恒定，4K 大文件不爆内存）；END 后从 OPFS 文件创建磁盘后备
 * blob URL 交 chrome.downloads 落到用户目录，随后清理临时文件。
 *
 * 协议（chrome.runtime 消息，target='offscreen'）：
 *   BILI_DL_START { key, filename }   创建临时文件
 *   BILI_DL_CHUNK { key, chunk(ArrayBuffer) }  追加写入（按到达顺序串行写）
 *   BILI_DL_END   { key }             关闭 → blob → downloads → BILI_DL_RESULT
 *   BILI_DL_ABORT { key }             关闭并清理临时文件
 *   发 BILI_DL_RESULT { key, ok, error?, id? }
 */

'use strict';

// key → { writable, tempName, root, filename, queue }
const streams = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  // 面板以 callback 式 sendMessage 直发：必须同步应答，否则端口关闭被当作失败
  if (msg.type === 'BILI_DL_START') {
    startStream(msg.key, msg.filename).catch((e) => report(msg.key, { ok: false, error: e.message }));
    sendResponse({ ok: true });
  } else if (msg.type === 'BILI_DL_CHUNK') {
    const s = streams.get(msg.key);
    if (s) {
      // 按到达顺序串行写入（OPFS 写入远快于网络，无需背压）
      s.queue = s.queue.then(() => s.writable.write(new Uint8Array(msg.chunk))).catch((e) => report(msg.key, { ok: false, error: e.message }));
    }
    sendResponse({ ok: true });
  } else if (msg.type === 'BILI_DL_END') {
    const s = streams.get(msg.key);
    if (s) finishStream(msg.key, s).catch((e) => report(msg.key, { ok: false, error: e.message }));
    sendResponse({ ok: true });
  } else if (msg.type === 'BILI_DL_ABORT') {
    const s = streams.get(msg.key);
    if (s) {
      streams.delete(msg.key);
      s.queue = s.queue.then(async () => {
        try { await s.writable.close(); } catch (e) { /* ignore */ }
        await cleanup(s.tempName);
      }).catch(() => {});
    }
    sendResponse({ ok: true });
  }
  return false;
});

async function startStream(key, filename) {
  const root = await navigator.storage.getDirectory();
  const tempName = 'wuji-dl-' + String(key).replace(/[^\w-]/g, '_');
  const fh = await root.getFileHandle(tempName, { create: true });
  const writable = await fh.createWritable();
  streams.set(key, { writable, tempName, root, filename, queue: Promise.resolve() });
}

async function finishStream(key, s) {
  await s.queue;
  await s.writable.close();
  const fh = await s.root.getFileHandle(s.tempName);
  const file = await fh.getFile();
  if (file.size === 0) {
    await cleanup(s.tempName);
    throw new Error('下载内容为空');
  }
  const objUrl = URL.createObjectURL(file);
  chrome.downloads.download({ url: objUrl, filename: s.filename, saveAs: false }, (id) => {
    const err = chrome.runtime.lastError;
    setTimeout(() => URL.revokeObjectURL(objUrl), 120000);   // 下载器可能仍在读，延迟回收
    cleanup(s.tempName);                                     // blob 系统已接管数据
    streams.delete(key);
    report(key, id !== undefined && !err, err?.message, id);
  });
}

async function cleanup(tempName) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(tempName);
  } catch (e) { /* ignore */ }
}

function report(key, payload) {
  chrome.runtime.sendMessage({ type: 'BILI_DL_RESULT', key, ...payload }).catch(() => {});
}
