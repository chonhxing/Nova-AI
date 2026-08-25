/**
 * 无极 — 弹幕管理姬 V1.0 (播放器模块)
 * 视频弹幕叠加层渲染引擎 (DOM)
 */
(function() {
  'use strict';

  const MODE_SCROLL = 1;
  const MODE_BOTTOM = 4;
  const MODE_TOP = 5;

  const MAX_POOL = 50;
  const TOP_POOL = 15;
  const BOTTOM_POOL = 15;

  const state = {
    enabled: false,
    danmaku: [],           // 全部弹幕
    sorted: [],            // 按时间排序
    currentIdx: 0,         // 当前播放到的索引
    lastTime: 0,
    // 设置
    opacity: 0.8,
    fontSize: 22,
    speed: 1.0,
    displayArea: 'full',   // full | top3 | bottom3 | topHalf | bottomHalf
    showControls: true,
    // 渲染
    overlay: null,
    pool: [],              // 滚动弹幕DOM池
    topPool: [],
    bottomPool: [],
    activeTop: [],
    activeBottom: [],
    controls: null,
    videoEl: null,
    animationId: null,
    initialized: false
  };

  const COLORS = [
    0xFFFFFF, 0xFF6666, 0x66FF66, 0x66CCFF, 0xFFFF66, 0xFF66FF,
    0x66FFFF, 0xFF9966, 0x99FF66, 0xFFCC66, 0xCC66FF, 0x66FFCC
  ];

  // ============================================================
  // 视频探测 — 非侵入式，不移动video元素
  // ============================================================
  function findVideo() {
    if (state.videoEl && state.videoEl.isConnected) {
      const r = state.videoEl.getBoundingClientRect();
      if (r.width > 400 && r.height > 200) return state.videoEl;
    }
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width > 400 && rect.height > 200 && v.duration > 0) {
        state.videoEl = v;
        return v;
      }
    }
    state.videoEl = null;
    return null;
  }

  function findVideoContainer(video) {
    // 向上查找合适的容器（有明确尺寸的父元素）
    let el = video.parentElement;
    let best = video;
    for (let i = 0; i < 8 && el; i++) {
      const cs = getComputedStyle(el);
      if (cs.position === 'relative' || cs.position === 'absolute') {
        best = el; break;
      }
      if (el.tagName === 'DIV' && (el.offsetWidth > 400 || el.offsetHeight > 200)) {
        best = el;
      }
      el = el.parentElement;
    }
    return best;
  }

  // ============================================================
  // 叠加层创建 — 非侵入式，不破坏页面DOM结构
  // ============================================================
  function createOverlay() {
    const video = findVideo();
    if (!video) return false;
    if (state.overlay) {
      // 已有overlay但video变了（SPA导航），更新引用
      syncOverlayPosition();
      return true;
    }

    const container = document.createElement('div');
    container.id = 'wuji-danmaku-overlay';
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:2147483646;font-family:"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif;';

    // 找到合适的容器并直接追加overlay（不移动video）
    const containerEl = findVideoContainer(video);
    if (!containerEl || !containerEl.parentElement) {
      document.body.appendChild(container);
      container.style.position = 'fixed';
    } else {
      const cs = getComputedStyle(containerEl);
      if (cs.position === 'static') containerEl.style.position = 'relative';
      containerEl.appendChild(container);
    }
    state.overlay = container;
    state.videoEl = video;

    syncOverlayPosition();
    return true;
  }

  function syncOverlayPosition() {
    if (!state.overlay || !state.videoEl || !state.videoEl.isConnected) return;
    const vr = state.videoEl.getBoundingClientRect();
    if (state.overlay.style.position === 'fixed') {
      state.overlay.style.left = vr.left + 'px';
      state.overlay.style.top = vr.top + 'px';
      state.overlay.style.width = vr.width + 'px';
      state.overlay.style.height = vr.height + 'px';
    } else {
      // overlay在容器内部，需要相对位置
      const parent = state.overlay.parentElement;
      if (parent && parent !== document.body) {
        const pr = parent.getBoundingClientRect();
        state.overlay.style.left = (vr.left - pr.left) + 'px';
        state.overlay.style.top = (vr.top - pr.top) + 'px';
        state.overlay.style.width = vr.width + 'px';
        state.overlay.style.height = vr.height + 'px';
      }
    }
  }

  // 定期同步位置（处理窗口大小变化、全屏切换等）
  let _syncInterval = null;
  function startSyncLoop() {
    if (_syncInterval) return;
    _syncInterval = setInterval(() => {
      const video = findVideo();
      if (video && video !== state.videoEl) {
        state.videoEl = video;
        syncOverlayPosition();
      } else {
        syncOverlayPosition();
      }
    }, 2000);
  }
  function stopSyncLoop() {
    if (_syncInterval) { clearInterval(_syncInterval); _syncInterval = null; }
  }

  // ============================================================
  // DOM池初始化
  // ============================================================
  function initPool() {
    if (!state.overlay) return;
    // 清理旧元素
    try {
      state.pool.forEach(p => { if (p.el && p.el.isConnected) p.el.remove(); });
      state.topPool.forEach(p => { if (p.el && p.el.isConnected) p.el.remove(); });
      state.bottomPool.forEach(p => { if (p.el && p.el.isConnected) p.el.remove(); });
    } catch(e) {}
    state.pool = [];
    state.topPool = [];
    state.bottomPool = [];

    // 滚动弹幕池
    for (let i = 0; i < MAX_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'wuji-dm-scroll';
      el.style.cssText = `position:absolute;white-space:nowrap;font-weight:bold;
        text-shadow:1px 1px 2px rgba(0,0,0,0.8),0 0 2px rgba(0,0,0,0.6);
        pointer-events:none;will-change:transform;left:100%;display:none;
        font-size:${state.fontSize}px;opacity:${state.opacity};`;
      state.overlay.appendChild(el);
      state.pool.push({ el, inUse: false, startTime: 0, duration: 0, y: 0 });
    }

    // 顶部弹幕池
    for (let i = 0; i < TOP_POOL; i++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:50%;white-space:nowrap;font-weight:bold;
        text-shadow:1px 1px 2px rgba(0,0,0,0.8);pointer-events:none;display:none;
        font-size:${state.fontSize}px;opacity:${state.opacity};transform:translateX(-50%);`;
      state.overlay.appendChild(el);
      state.topPool.push({ el, inUse: false, timeout: null, row: i });
    }

    // 底部弹幕池
    for (let i = 0; i < BOTTOM_POOL; i++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:50%;bottom:0;white-space:nowrap;font-weight:bold;
        text-shadow:1px 1px 2px rgba(0,0,0,0.8);pointer-events:none;display:none;
        font-size:${state.fontSize}px;opacity:${state.opacity};transform:translateX(-50%);`;
      state.overlay.appendChild(el);
      state.bottomPool.push({ el, inUse: false, timeout: null, row: i });
    }
  }

  function updatePoolStyles() {
    [...state.pool, ...state.topPool, ...state.bottomPool].forEach(item => {
      item.el.style.fontSize = state.fontSize + 'px';
      item.el.style.opacity = state.opacity;
    });
  }

  // ============================================================
  // 颜色转换
  // ============================================================
  function colorToCSS(c) {
    if (c === 0 || c === 0xFFFFFF || !c) return '#fff';
    return '#' + c.toString(16).padStart(6, '0');
  }

  // ============================================================
  // 获取可用行
  // ============================================================
  function getScrollY() {
    if (!state.overlay) return 100;
    const h = state.overlay.clientHeight || 360;
    if (h < 50) return 50;
    const rows = Math.max(8, Math.floor(h / (state.fontSize + 4)));
    let area = state.displayArea;
    let topY = state.fontSize;
    let botY = h - state.fontSize * 2;
    if (area === 'top3') botY = Math.min(botY, h * 0.4);
    else if (area === 'bottom3') topY = Math.max(topY, h * 0.7);
    else if (area === 'topHalf') botY = Math.min(botY, h * 0.5);
    else if (area === 'bottomHalf') topY = Math.max(topY, h * 0.5);
    const range = Math.max(state.fontSize, botY - topY);
    return topY + Math.random() * range;
  }

  // ============================================================
  // 弹幕调度
  // ============================================================
  function spawnDanmaku(d) {
    if (d.mode === MODE_SCROLL) return spawnScroll(d);
    else if (d.mode === MODE_TOP) return spawnFixed(d, 'top');
    else if (d.mode === MODE_BOTTOM) return spawnFixed(d, 'bottom');
    return spawnScroll(d); // 默认滚动
  }

  function spawnScroll(d) {
    if (!state.overlay || state.overlay.clientWidth < 100) return;
    const item = state.pool.find(p => !p.inUse);
    if (!item) return;
    item.inUse = true;
    const el = item.el;
    const text = d.text.substring(0, 80);
    el.textContent = text;
    el.style.color = colorToCSS(d.color);
    el.style.display = 'block';
    el.style.left = '100%';
    el.style.transition = 'none';

    const w = el.offsetWidth || text.length * state.fontSize;
    const videoRate = (state.videoEl && state.videoEl.playbackRate) || 1;
    const speedPx = (120 + Math.random() * 60) / (state.speed * videoRate);
    const duration = (w + state.overlay.clientWidth) / speedPx;
    const y = getScrollY();
    el.style.top = y + 'px';

    item.duration = duration;
    item.startTime = performance.now() / 1000;
    item.y = y;

    // 用requestAnimationFrame驱动位移，更流畅
    el._startX = state.overlay.clientWidth;
    el._endX = -w;
    el._duration = duration;
    el._startTime = performance.now();
    el.style.transform = 'translateX(0px)';
  }

  function spawnFixed(d, pos) {
    const pool = pos === 'top' ? state.topPool : state.bottomPool;
    const item = pool.find(p => !p.inUse);
    if (!item) return;
    item.inUse = true;
    const el = item.el;
    const videoRate = (state.videoEl && state.videoEl.playbackRate) || 1;
    const text = d.text.substring(0, 60);
    el.textContent = text;
    el.style.color = colorToCSS(d.color);
    el.style.display = 'block';
    if (pos === 'top') el.style.top = (item.row * (state.fontSize + 12) + 10) + 'px';
    else el.style.bottom = (item.row * (state.fontSize + 12) + 4) + 'px';
    el.style.opacity = state.opacity;
    el.style.transition = 'opacity 0.3s';

    if (item.timeout) clearTimeout(item.timeout);
    item.timeout = setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.display = 'none';
        el.style.opacity = state.opacity;
        item.inUse = false;
      }, 350 / videoRate);
    }, 4000 / videoRate);
  }

  // ============================================================
  // 渲染循环
  // ============================================================
  function tick() {
    if (!state.enabled) { state.animationId = null; return; }
    state.animationId = requestAnimationFrame(tick);

    const video = findVideo();
    if (!video) return;
    if (video !== state.videoEl) {
      state.videoEl = video;
      syncOverlayPosition();
    }
    if (video.paused) return;
    const time = video.currentTime;

    // 检查是否有弹幕需要发射
    while (state.currentIdx < state.sorted.length && state.sorted[state.currentIdx].time <= time + 0.3) {
      spawnDanmaku(state.sorted[state.currentIdx]);
      state.currentIdx++;
    }
    // 如果快进回去了，重置索引
    if (time < state.lastTime - 2) {
      state.currentIdx = 0;
      // 二分查找当前位置
      let lo = 0, hi = state.sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (state.sorted[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      state.currentIdx = lo;
    }
    state.lastTime = time;

    // 更新滚动弹幕位置
    const now = performance.now();
    for (const item of state.pool) {
      if (!item.inUse) continue;
      const elapsed = (now - item.el._startTime) / 1000;
      const progress = elapsed / item.el._duration;
      if (progress >= 1) {
        item.el.style.display = 'none';
        item.inUse = false;
      } else {
        const x = item.el._startX + (item.el._endX - item.el._startX) * progress;
        item.el.style.transform = 'translateX(' + (x - item.el._startX) + 'px)';
      }
    }
  }

  // ============================================================
  // 控制面板
  // ============================================================
  function createControls() {
    if (state.controls) return;
    const ctrl = document.createElement('div');
    ctrl.id = 'wuji-dm-controls';
    ctrl.innerHTML = `
      <style>
        .wdm-ctrl{position:absolute;bottom:36px;right:10px;z-index:2147483647;
          background:rgba(0,0,0,0.78);border-radius:10px;padding:10px 14px;
          display:none;flex-direction:column;gap:8px;font-size:12px;color:#ddd;
          min-width:160px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
          font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}
        .wdm-ctrl label{display:flex;align-items:center;gap:8px;justify-content:space-between;}
        .wdm-ctrl input[type=range]{width:80px;accent-color:#6366f1;height:4px;}
        .wdm-ctrl select{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 6px;font-size:11px;}
        .wdm-ctrl .wdm-btn{background:#6366f1;color:#fff;border:none;border-radius:6px;
          padding:6px 12px;cursor:pointer;font-size:12px;text-align:center;}
        .wdm-ctrl .wdm-btn.danger{background:rgba(239,68,68,0.6);}
        .wdm-ctrl .wdm-info{text-align:center;color:#999;font-size:10px;}
      </style>
      <div class="wdm-info" id="wdm-info">未加载弹幕</div>
      <label>透明度 <input type="range" id="wdm-opacity" min="1" max="10" value="8"></label>
      <label>字号 <input type="range" id="wdm-size" min="12" max="48" value="22"></label>
      <label>速度 <input type="range" id="wdm-speed" min="5" max="30" value="10"></label>
      <label>区域 <select id="wdm-area">
        <option value="full">全屏</option><option value="top3">上1/3</option>
        <option value="bottom3">下1/3</option><option value="topHalf">上半</option>
        <option value="bottomHalf">下半</option>
      </select></label>
      <button class="wdm-btn" id="wdm-toggle">关闭弹幕</button>
    `;
    ctrl.className = 'wdm-ctrl';
    state.overlay.appendChild(ctrl);
    state.controls = ctrl;

    // 显示/隐藏控制面板
    state.overlay.addEventListener('mouseenter', () => { ctrl.style.display = 'flex'; });
    state.overlay.addEventListener('mouseleave', () => { ctrl.style.display = 'none'; });

    // 绑定事件
    ctrl.querySelector('#wdm-opacity').addEventListener('input', function() {
      state.opacity = parseInt(this.value) / 10;
      updatePoolStyles();
      saveSettings();
    });
    ctrl.querySelector('#wdm-size').addEventListener('input', function() {
      state.fontSize = parseInt(this.value);
      updatePoolStyles();
      saveSettings();
    });
    ctrl.querySelector('#wdm-speed').addEventListener('input', function() {
      state.speed = parseInt(this.value) / 10;
      saveSettings();
    });
    ctrl.querySelector('#wdm-area').addEventListener('change', function() {
      state.displayArea = this.value;
      saveSettings();
    });
    ctrl.querySelector('#wdm-toggle').addEventListener('click', function() {
      toggleEnabled();
    });
  }

  function updateControlsUI() {
    if (!state.controls) return;
    state.controls.querySelector('#wdm-opacity').value = Math.round(state.opacity * 10);
    state.controls.querySelector('#wdm-size').value = state.fontSize;
    state.controls.querySelector('#wdm-speed').value = Math.round(state.speed * 10);
    state.controls.querySelector('#wdm-area').value = state.displayArea;
    state.controls.querySelector('#wdm-toggle').textContent = state.enabled ? '关闭弹幕' : '开启弹幕';
  }

  function toggleEnabled() {
    state.enabled = !state.enabled;
    if (state.enabled) {
      startRendering();
    } else {
      stopRendering();
    }
    updateControlsUI();
    updatePlayerButton();
    saveSettings();
  }

  // ============================================================
  // 播放器内嵌按钮 — 注入到 YouTube 等视频站的控制栏
  // ============================================================
  let _playerBtn = null;
  let _btnObserver = null;

  function getPlayerBtnSVG(active) {
    const color = active ? '#6366f1' : 'currentColor';
    return `<svg viewBox="0 0 36 36" fill="none" width="22" height="22">
      <rect x="2" y="4" width="32" height="22" rx="3" stroke="${color}" stroke-width="2"/>
      <line x1="2" y1="10" x2="9" y2="10" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="2" y1="14" x2="14" y2="14" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="2" y1="18" x2="11" y2="18" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="2" y1="22" x2="17" y2="22" stroke="${color}" stroke-width="1.8" stroke-linecap="round" opacity="0.6"/>
      <line x1="5" y1="26" x2="9" y2="26" stroke="${color}" stroke-width="1.8" stroke-linecap="round" opacity="0.4"/>
    </svg>`;
  }

  function updatePlayerButton() {
    if (!_playerBtn) return;
    const hasDanmaku = state.danmaku.length > 0;
    _playerBtn.innerHTML = getPlayerBtnSVG(state.enabled && hasDanmaku);
    _playerBtn.title = hasDanmaku
      ? (state.enabled ? '弹幕已开启 — 点击关闭' : '弹幕已关闭 — 点击开启')
      : '弹幕管理姬 — 未加载弹幕';
    _playerBtn.style.opacity = hasDanmaku ? '1' : '0.5';
  }

  function createPlayerButton() {
    if (_playerBtn && _playerBtn.isConnected) return;
    // 尝试注入到常见播放器位置
    const targets = [
      '.ytp-right-controls',           // YouTube
      '.bpx-player-ctrl-right',        // B站新版播放器
      '.bilibili-player-video-control', // B站旧版
    ];
    for (const sel of targets) {
      const bar = document.querySelector(sel);
      if (!bar) continue;
      _playerBtn = document.createElement('button');
      _playerBtn.id = 'wuji-dm-player-btn';
      _playerBtn.className = bar.className.includes('ytp') ? 'ytp-button' : (bar.querySelector('button')?.className || '');
      _playerBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:none;padding:0 6px;height:100%;transition:opacity 0.2s;vertical-align:top;';
      _playerBtn.innerHTML = getPlayerBtnSVG(false);
      _playerBtn.title = '弹幕管理姬';

      _playerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMiniSettings(e.currentTarget);
      });
      bar.insertBefore(_playerBtn, bar.firstChild);
      updatePlayerButton();
      break;
    }
  }

  function showMiniSettings(anchor) {
    let popup = document.getElementById('wuji-dm-mini-settings');
    if (popup) { popup.remove(); return; }

    const hasDanmaku = state.danmaku.length > 0;
    chrome.runtime.sendMessage({ type: 'DANMAKU_LIST' }, (resp) => {
      const sets = resp?.success ? (resp.data || []) : [];
      buildMenuPopup(anchor, sets, hasDanmaku);
    });
  }

  function buildMenuPopup(anchor, sets, hasDanmaku) {
    const popup = document.createElement('div');
    popup.id = 'wuji-dm-mini-settings';
    const setRows = sets.length > 0
      ? sets.map(s => `<div class="dm-set-row"><span class="dm-set-name" title="${escHtml(s.title)}">${escHtml(s.title.substring(0,16))}</span><span class="dm-set-count">${s.count}条</span><button class="dm-load-btn" data-bvid="${s.bvid}">加载</button></div>`).join('')
      : '<div class="dm-empty">暂无弹幕 · <a id="dms-open-manager" href="#">去提取</a></div>';

    popup.innerHTML = `
      <style>
        #wuji-dm-mini-settings{position:fixed;z-index:2147483647;background:rgba(18,18,18,0.97);
          border-radius:12px;padding:12px 14px;min-width:220px;max-width:280px;
          font-size:12px;color:#ddd;box-shadow:0 4px 24px rgba(0,0,0,0.6);
          border:1px solid rgba(255,255,255,0.1);font-family:"PingFang SC","Microsoft YaHei",sans-serif;
          max-height:70vh;overflow-y:auto;}
        #wuji-dm-mini-settings .dm-sec-title{font-size:11px;color:#888;padding:6px 0 4px;border-top:1px solid rgba(255,255,255,0.06);margin-top:6px;}
        #wuji-dm-mini-settings .dm-sec-title:first-child{border-top:none;margin-top:0;}
        .dm-set-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);}
        .dm-set-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;}
        .dm-set-count{color:#666;font-size:10px;flex-shrink:0;}
        .dm-load-btn{padding:3px 10px;border-radius:5px;border:none;cursor:pointer;font-size:11px;font-family:inherit;background:rgba(99,102,241,0.25);color:#818cf8;flex-shrink:0;}
        .dm-load-btn:hover{background:rgba(99,102,241,0.45);}
        .dm-empty{text-align:center;color:#666;padding:8px 0;font-size:11px;}
        .dm-empty a{color:#818cf8;cursor:pointer;text-decoration:none;}
        #wuji-dm-mini-settings .dm-row{display:flex;align-items:center;justify-content:space-between;padding:4px 0;}
        #wuji-dm-mini-settings .dm-row span{color:#aaa;font-size:11px;}
        #wuji-dm-mini-settings input[type=range]{width:80px;accent-color:#6366f1;height:3px;}
        #wuji-dm-mini-settings select{background:#333;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 6px;font-size:11px;}
        #wuji-dm-mini-settings .dm-btn-row{display:flex;gap:6px;margin-top:6px;}
        #wuji-dm-mini-settings .dm-btn{flex:1;padding:6px 0;border-radius:6px;border:none;cursor:pointer;font-size:11px;text-align:center;font-family:inherit;}
        .dm-btn-on{background:rgba(99,102,241,0.3);color:#818cf8;}
        .dm-btn-off{background:rgba(255,255,255,0.08);color:#666;}
        .dm-btn-manager{background:rgba(255,255,255,0.06);color:#888;}
      </style>
      <div class="dm-sec-title">🎬 已保存的弹幕</div>
      ${setRows}
      ${hasDanmaku ? `
      <div class="dm-sec-title">⚙ 显示设置</div>
      <div class="dm-row"><span>透明度</span><input type="range" id="dms-opacity" min="1" max="10" value="${Math.round(state.opacity*10)}"></div>
      <div class="dm-row"><span>字号</span><input type="range" id="dms-size" min="12" max="48" value="${state.fontSize}"></div>
      <div class="dm-row"><span>速度</span><input type="range" id="dms-speed" min="5" max="30" value="${Math.round(state.speed*10)}"></div>
      <div class="dm-row"><span>区域</span><select id="dms-area">
        <option value="full" ${state.displayArea==='full'?'selected':''}>全屏</option>
        <option value="top3" ${state.displayArea==='top3'?'selected':''}>上1/3</option>
        <option value="bottom3" ${state.displayArea==='bottom3'?'selected':''}>下1/3</option>
        <option value="topHalf" ${state.displayArea==='topHalf'?'selected':''}>上半</option>
        <option value="bottomHalf" ${state.displayArea==='bottomHalf'?'selected':''}>下半</option>
      </select></div>
      <div class="dm-btn-row">
        <button class="dm-btn ${state.enabled?'dm-btn-on':'dm-btn-off'}" id="dms-toggle">${state.enabled?'弹幕 ON':'弹幕 OFF'}</button>
      </div>
      ` : ''}
      <div class="dm-btn-row">
        <button class="dm-btn dm-btn-manager" id="dms-manager">📂 管理弹幕</button>
      </div>
    `;
    document.body.appendChild(popup);

    const rect = anchor.getBoundingClientRect();
    popup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    popup.style.right = (window.innerWidth - rect.right) + 'px';

    // 加载弹幕按钮
    popup.querySelectorAll('.dm-load-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.remove();
        chrome.runtime.sendMessage({ type: 'DANMAKU_LOAD_TO_TAB', bvid: btn.dataset.bvid });
      });
    });

    // 打开管理器
    popup.querySelector('#dms-manager').addEventListener('click', (e) => {
      e.stopPropagation();
      popup.remove();
      showDanmakuPanel();
    });
    const openMgr = popup.querySelector('#dms-open-manager');
    if (openMgr) {
      openMgr.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.remove();
        showDanmakuPanel();
      });
    }

    // 设置控件
    if (hasDanmaku) {
      const applySetting = (key, val) => {
        state[key] = val;
        updatePoolStyles();
        updateControlsUI();
        updatePlayerButton();
        saveSettings();
      };
      popup.querySelector('#dms-opacity').addEventListener('input', function() {
        applySetting('opacity', parseInt(this.value) / 10);
      });
      popup.querySelector('#dms-size').addEventListener('input', function() {
        applySetting('fontSize', parseInt(this.value));
      });
      popup.querySelector('#dms-speed').addEventListener('input', function() {
        applySetting('speed', parseInt(this.value) / 10);
      });
      popup.querySelector('#dms-area').addEventListener('change', function() {
        applySetting('displayArea', this.value);
      });
      popup.querySelector('#dms-toggle').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEnabled();
        popup.remove();
      });
    }

    setTimeout(() => {
      const closer = (ev) => {
        if (!popup || !popup.isConnected) return;
        if (!popup.contains(ev.target) && ev.target !== anchor) {
          popup.remove();
          document.removeEventListener('click', closer);
        }
      };
      document.addEventListener('click', closer);
    }, 100);
  }

  function startButtonObserver() {
    if (_btnObserver) return;
    _btnObserver = new MutationObserver(() => {
      if (!_playerBtn || !_playerBtn.isConnected) {
        createPlayerButton();
      }
    });
    _btnObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // 设置持久化
  // ============================================================
  function saveSettings() {
    chrome.storage.local.set({ danmaku_settings: {
      opacity: state.opacity,
      fontSize: state.fontSize,
      speed: state.speed,
      displayArea: state.displayArea,
      enabled: state.enabled
    }});
  }

  async function loadSettings() {
    try {
      const r = await chrome.storage.local.get('danmaku_settings');
      if (r.danmaku_settings) {
        const s = r.danmaku_settings;
        state.opacity = s.opacity != null ? s.opacity : 0.8;
        state.fontSize = s.fontSize || 22;
        state.speed = s.speed || 1.0;
        state.displayArea = s.displayArea || 'full';
        state.enabled = s.enabled !== false;
      }
    } catch(e) {}
  }

  // ============================================================
  // 生命周期
  // ============================================================
  function startRendering() {
    if (!state.danmaku.length) return;
    state.enabled = true;
    state.currentIdx = 0;
    state.lastTime = findVideo()?.currentTime || 0;
    // 二分查找当前位置
    let lo = 0, hi = state.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (state.sorted[mid].time < state.lastTime) lo = mid + 1;
      else hi = mid;
    }
    state.currentIdx = lo;
    if (!state.animationId) state.animationId = requestAnimationFrame(tick);
    updateControlsUI();
  }

  function stopRendering() {
    state.enabled = false;
    if (state.animationId) { cancelAnimationFrame(state.animationId); state.animationId = null; }
    // 清除所有弹幕
    state.pool.forEach(p => { p.el.style.display = 'none'; p.inUse = false; });
    state.topPool.forEach(p => { p.el.style.display = 'none'; p.inUse = false; if (p.timeout) clearTimeout(p.timeout); });
    state.bottomPool.forEach(p => { p.el.style.display = 'none'; p.inUse = false; if (p.timeout) clearTimeout(p.timeout); });
    updateControlsUI();
  }

  async function loadDanmaku(danmakuSet) {
    if (!danmakuSet || !danmakuSet.danmaku) return;
    state.danmaku = danmakuSet.danmaku;
    state.sorted = [...danmakuSet.danmaku].sort((a, b) => a.time - b.time);
    state.currentIdx = 0;
    if (!createOverlay()) {
      // 页面上还没有video，稍后重试
      setTimeout(() => loadDanmaku(danmakuSet), 2000);
      return;
    }
    initPool();
    createControls();
    createPlayerButton();
    startButtonObserver();
    startSyncLoop();
    if (state.controls) {
      state.controls.querySelector('#wdm-info').textContent =
        `已加载 ${danmakuSet.title.substring(0, 20)} (${danmakuSet.count}条)`;
    }
    if (state.enabled) startRendering();
    updateControlsUI();
    updatePlayerButton();
    saveSettings();
  }

  async function init() {
    await loadSettings();
    startButtonObserver();
    // 不自动加载弹幕，等用户在播放器按钮中选择
  }

  // ============================================================
  // 消息监听
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DANMAKU_LOAD') {
      loadDanmaku(message.data).then(() => sendResponse({ success: true }));
      return true;
    }
    if (message.type === 'DANMAKU_UNLOAD') {
      stopRendering();
      state.danmaku = []; state.sorted = [];
      if (state.controls) state.controls.querySelector('#wdm-info').textContent = '未加载弹幕';
      updateControlsUI();
      updatePlayerButton();
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'DANMAKU_TOGGLE') {
      toggleEnabled();
      sendResponse({ success: true, enabled: state.enabled });
      return;
    }
    if (message.type === 'DANMAKU_STATUS') {
      sendResponse({ success: true, enabled: state.enabled, count: state.danmaku.length });
      return;
    }
    if (message.type === 'OPEN_DANMAKU_PANEL') {
      showDanmakuPanel();
      sendResponse({ success: true });
      return;
    }
  });

  // ============================================================
  // 弹幕管理面板 (浮动对话框)
  // ============================================================
  function showDanmakuPanel() {
    let panel = document.getElementById('wuji-danmaku-panel');
    if (panel) { panel.style.display = 'flex'; return; }

    panel = document.createElement('div');
    panel.id = 'wuji-danmaku-panel';
    panel.innerHTML = `
      <style>
        #wuji-danmaku-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
          z-index:2147483647;width:420px;max-height:70vh;background:rgba(0,0,0,0.92);
          border-radius:16px;color:#e0e0e0;display:flex;flex-direction:column;
          font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;
          box-shadow:0 8px 40px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);
          overflow:hidden;}
        .wdm-panel-title{display:flex;align-items:center;justify-content:space-between;
          padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);
          font-size:15px;font-weight:600;}
        .wdm-panel-close{cursor:pointer;opacity:0.6;font-size:18px;line-height:1;
          background:none;border:none;color:#fff;padding:0 4px;}
        .wdm-panel-close:hover{opacity:1;}
        .wdm-panel-body{padding:16px 18px;overflow-y:auto;flex:1;}
        .wdm-input-row{display:flex;gap:8px;margin-bottom:14px;}
        .wdm-input-row input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
          background:rgba(255,255,255,0.06);color:#fff;font-size:13px;outline:none;
          font-family:inherit;}
        .wdm-input-row input:focus{border-color:#6366f1;}
        .wdm-input-row button{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;
          font-size:12px;font-weight:600;font-family:inherit;transition:all 0.15s;}
        .wdm-btn-primary{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;}
        .wdm-btn-primary:hover{opacity:0.9;}
        .wdm-btn-danger{background:rgba(239,68,68,0.2);color:#ef4444;}
        .wdm-btn-danger:hover{background:rgba(239,68,68,0.35);}
        .wdm-btn-sm{padding:5px 10px;font-size:11px;border-radius:6px;border:none;cursor:pointer;
          font-family:inherit;transition:all 0.15s;}
        .wdm-set-item{display:flex;align-items:center;justify-content:space-between;
          padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);}
        .wdm-set-info{flex:1;min-width:0;}
        .wdm-set-info .wdm-set-title{font-weight:500;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;}
        .wdm-set-info .wdm-set-meta{font-size:11px;color:#888;margin-top:2px;}
        .wdm-set-actions{display:flex;gap:6px;flex-shrink:0;}
        .wdm-status{text-align:center;color:#888;font-size:12px;padding:8px;}
      </style>
      <div class="wdm-panel-title">
        🎬 弹幕管理姬
        <button class="wdm-panel-close" id="wdm-panel-close">&times;</button>
      </div>
      <div class="wdm-panel-body">
        <div class="wdm-input-row">
          <input type="text" id="wdm-bvid-input" placeholder="输入B站视频链接或BV号" autofocus>
          <button class="wdm-btn-primary" id="wdm-crawl-btn">提取弹幕</button>
        </div>
        <div class="wdm-status" id="wdm-panel-status"></div>
        <div id="wdm-sets-list"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // 事件
    panel.querySelector('#wdm-panel-close').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.querySelector('#wdm-crawl-btn').addEventListener('click', async () => {
      const input = panel.querySelector('#wdm-bvid-input');
      const bvid = input.value.trim();
      if (!bvid) return;
      const btn = panel.querySelector('#wdm-crawl-btn');
      const status = panel.querySelector('#wdm-panel-status');
      btn.disabled = true;
      btn.textContent = '提取中...';
      status.textContent = '⏳ 正在连接B站API获取弹幕...';
      chrome.runtime.sendMessage({ type: 'DANMAKU_CRAWL', bvid }, (resp) => {
        if (resp?.success) {
          status.textContent = '⏳ 弹幕提取中，完成后将自动加载...';
          // 轮询检查弹幕是否已加载，最多等30秒
          let attempts = 0;
          const check = setInterval(() => {
            attempts++;
            chrome.runtime.sendMessage({ type: 'DANMAKU_GET_ACTIVE' }, (r) => {
              if (r?.success && r.data && r.data.bvid) {
                clearInterval(check);
                const set = r.data;
                status.textContent = `✅ 已提取 ${set.count} 条弹幕，来自：${set.title.substring(0, 30)}`;
                btn.disabled = false;
                btn.textContent = '提取弹幕';
                input.value = '';
                refreshList();
              } else if (attempts > 30) {
                clearInterval(check);
                status.textContent = '⚠️ 提取超时，请检查BV号是否正确';
                btn.disabled = false;
                btn.textContent = '提取弹幕';
              }
            });
          }, 1000);
        } else {
          status.textContent = '❌ ' + (resp?.error || '提取失败，请检查BV号或网络');
          btn.disabled = false;
          btn.textContent = '提取弹幕';
        }
      });
    });

    function refreshList() {
      chrome.runtime.sendMessage({ type: 'DANMAKU_LIST' }, (resp) => {
        const listEl = panel.querySelector('#wdm-sets-list');
        if (!resp?.success || !resp.data || resp.data.length === 0) {
          listEl.innerHTML = '<div class="wdm-status">暂无保存的弹幕</div>';
          return;
        }
        listEl.innerHTML = resp.data.map(set => `
          <div class="wdm-set-item">
            <div class="wdm-set-info">
              <div class="wdm-set-title">${escHtml(set.title)}</div>
              <div class="wdm-set-meta">${set.count}条 · ${new Date(set.createdAt).toLocaleDateString('zh-CN')}</div>
            </div>
            <div class="wdm-set-actions">
              <button class="wdm-btn-sm wdm-btn-danger" data-bvid="${set.bvid}" data-action="delete">删除</button>
            </div>
          </div>
        `).join('');

        listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
          btn.addEventListener('click', () => {
            if (confirm('确定删除此弹幕集？')) {
              chrome.runtime.sendMessage({ type: 'DANMAKU_DELETE', bvid: btn.dataset.bvid }, () => refreshList());
            }
          });
        });
      });
    }

    refreshList();
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // 启动
  init();
})();
