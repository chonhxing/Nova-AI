/**
 * 无极 — B站视频下载入口（仅 bilibili.com 注入，manifest 按 matches 收窄）
 * 视频页悬浮"下载视频"按钮 → 经 SW 中继懒注入面板 UI（ui/panel-ui.js 的
 * mountBili）→ 面板经 bridge 直连 SW 接口（BILI_GET_INFO/RESOLVE/DOWNLOAD，
 * 引擎在 Service Worker：libs/bili-downloader.js）。关闭即 unmount。
 * B 站为 SPA：1.5s 轮询路由变化控制按钮显隐（仅本页注入，开销可忽略）。
 */
(function () {
  'use strict';

  // 懒注入幂等守卫：重复执行直接退出（let/const 重声明会抛 SyntaxError）
  if (window.__WUJI_BILI_ENTRY__) return;
  window.__WUJI_BILI_ENTRY__ = true;

  const VIDEO_RE = /\/video\/(BV[0-9A-Za-z]+)/;
  let btn = null;
  let panelHost = null;

  function currentBvid() {
    const m = location.pathname.match(VIDEO_RE);
    return m ? m[1] : '';
  }

  function currentPage() {
    const m = location.search.match(/[?&]p=(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  function ensureButton() {
    const bvid = currentBvid();
    if (bvid && !btn) {
      btn = document.createElement('button');
      btn.id = 'wuji-bili-entry';
      btn.setAttribute('data-ai-browser', 'bili-entry');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>下载视频</span>';
      btn.style.cssText = 'position:fixed;z-index:99997;right:20px;bottom:20px;display:flex;align-items:center;gap:6px;padding:9px 16px;border:none;border-radius:22px;cursor:pointer;font-size:12.5px;font-weight:600;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#fff;background:linear-gradient(135deg,#6366f1,#a855f7);box-shadow:0 6px 18px rgba(99,102,241,0.4);transition:all 0.18s;';
      btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 9px 24px rgba(99,102,241,0.5)'; });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; btn.style.boxShadow = '0 6px 18px rgba(99,102,241,0.4)'; });
      btn.addEventListener('click', openPanel);
      document.body.appendChild(btn);
    } else if (!bvid && btn) {
      btn.remove();
      btn = null;
    }
  }

  async function ensurePanelUI() {
    if (window.__WUJI_PANEL__) return true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'INJECT_PANEL_UI' });
      if (resp?.success && window.__WUJI_PANEL__) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  async function openPanel() {
    if (panelHost) return;   // 已打开：幂等
    const resp = await chrome.runtime.sendMessage({ type: 'BILI_OPEN_PANEL' }).catch(() => null);
    if (!resp?.success) return;
    if (!(await ensurePanelUI())) return;
    panelHost = document.createElement('div');
    panelHost.id = 'wuji-bili-host';
    panelHost.setAttribute('data-ai-browser', 'bili-panel');
    panelHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(panelHost);
    const shadow = panelHost.attachShadow({ mode: 'open' });
    window.__WUJI_PANEL__.mountBili({
      shadowRoot: shadow,
      host: panelHost,
      bridge: {
        getBvid: () => currentBvid(),
        getPage: () => currentPage(),
        // SW 引擎接口统一走 runtime 消息（BILI_GET_INFO / BILI_RESOLVE / BILI_DOWNLOAD）
        send: async (type, payload) => {
          const r = await chrome.runtime.sendMessage({ type, payload });
          if (!r?.success) throw new Error(r?.error || '请求失败');
          return r.data;
        },
        close: () => closePanel(),
      },
    });
  }

  function closePanel() {
    try { window.__WUJI_PANEL__?.unmountBili(); } catch (e) { /* ignore */ }
    if (panelHost) { panelHost.remove(); panelHost = null; }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BILI_OPEN_PANEL') { openPanel(); }
    return false;
  });

  ensureButton();
  setInterval(ensureButton, 1500);
})();
