/**
 * 无极 — 元素隐藏模块 (Cosmetic Filtering)
 * 基于 CSS 选择器的广告元素隐藏
 * 在页面上注入为 content script，实时隐藏广告元素
 */
(function() {
  'use strict';

  // ============================================================
  // 状态管理
  // ============================================================
  let enabled = true;
  let globalSelectors = [];      // 全局 CSS 选择器
  let domainSelectors = {};      // 域名限定选择器: { 'example.com': ['.ad', '#banner'] }
  let styleElement = null;       // 注入的 <style> 标签
  let observer = null;           // MutationObserver
  const HIDDEN_ATTR = 'data-adblock-hidden';
  let whitelistDomains = [];
  // CSS 声明式引擎：把全部选择器分块合并成 :is() 复合选择器，
  // 一次 matches()/querySelector() 顶替逐选择器循环（O(1) 分块匹配，非 O(选择器数)）
  let selectorChunks = [];

  function isDomainWhitelisted() {
    if (whitelistDomains.length === 0) return false;
    const hostname = window.location.hostname;
    return whitelistDomains.some(d => hostname === d || hostname.endsWith('.' + d));
  }

  // ============================================================
  // 🔑 关键元素保护白名单
  // 这些元素即使在规则列表中也永不隐藏（如 YouTube 跳过按钮等）
  // ============================================================
  const PROTECTED_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-container',
    '.videoAdUiSkipButton',
    '[class*="ytp-ad-skip"]',
  ];

  const PROTECTED_PATTERNS = [
    /ytp[-_]?ad[-_]?skip/i,
    /ytp[-_]?skip[-_]?ad/i,
    /skip[-_]?ad[-_]?button/i,
    /ad[-_]?skip[-_]?button/i,
    /video[-_]?ad[-_]?skip/i,
  ];

  /**
   * 检查选择器是否匹配受保护的元素
   */
  function isProtectedSelector(sel) {
    const trimmed = sel.trim();
    if (!trimmed) return false;
    // 精确匹配
    if (PROTECTED_SELECTORS.some(ps => trimmed === ps)) return true;
    // 模式匹配
    return PROTECTED_PATTERNS.some(pat => pat.test(trimmed));
  }

  /**
   * 检查 DOM 元素是否为受保护的关键 UI 元素
   */
  function isProtectedElement(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    const cls = el.className || '';
    const id = el.id || '';
    const clsLower = (typeof cls === 'string' ? cls : cls.baseVal || '').toLowerCase();
    const combined = (clsLower + ' ' + id).toLowerCase();

    // YouTube 跳过广告按钮（精准匹配）
    if (clsLower.includes('ytp-ad-skip') ||
        clsLower.includes('ytp-skip-ad') ||
        clsLower.includes('videoadskip') ||
        clsLower.includes('ytp-ad-overlay-close')) {
      return true;
    }

    // YouTube 视频播放器控制栏区域
    if (clsLower.includes('ytp-chrome-controls') ||
        clsLower.includes('ytp-chrome-bottom') ||
        clsLower.includes('ytp-chrome-top') ||
        id === 'movie_player') {
      return false; // 不保护整个播放器，只保护跳过按钮
    }

    // 任何包含 "skip" 且有 "ad" 上下文的按钮
    if (tag === 'button' && combined.includes('skip') &&
        (combined.includes('ad') || combined.includes('ads'))) {
      return true;
    }

    // 通用保护：跳过广告按钮的容器
    if (combined.includes('skip') && combined.includes('ad') &&
        (tag === 'div' || tag === 'span' || tag === 'button' || tag === 'a')) {
      // 检查是否包含常见的广告跳过文本
      if (el.textContent && /skip\s*(ad|ads|在?\s*\d+\s*秒?\s*后?\s*(跳过|skip))/i.test(el.textContent)) {
        return true;
      }
    }

    return false;
  }

  // ============================================================
  // CSS 注入
  // ============================================================
  function injectCSS(selectors) {
    if (!selectors || selectors.length === 0) return;
    
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'wuji-adblock-cosmetic';
      styleElement.setAttribute('type', 'text/css');
      (document.head || document.documentElement).appendChild(styleElement);
    }

    // 生成 CSS 规则：跳过受保护的关键元素选择器
    const cssRules = selectors
      .filter(sel => !isProtectedSelector(sel))
      .map(sel => {
        const safeSel = sel.replace(/[{}]/g, '').trim();
        if (!safeSel) return '';
        return `${safeSel}{display:none!important;visibility:hidden!important;height:0!important;width:0!important;min-height:0!important;min-width:0!important;max-height:0!important;max-width:0!important;overflow:hidden!important;position:absolute!important;pointer-events:none!important;opacity:0!important;}`;
      }).filter(Boolean);

    if (cssRules.length > 0) {
      styleElement.textContent = cssRules.join('\n');
    } else {
      styleElement.textContent = '';
    }
  }

  /**
   * 更新当前页面的过滤规则
   */
  function updateForCurrentPage() {
    if (!enabled) {
      if (styleElement) styleElement.textContent = '';
      selectorChunks = [];
      return;
    }

    // 检查白名单 — 白名单域名跳过所有过滤
    if (isDomainWhitelisted()) {
      if (styleElement) styleElement.textContent = '';
      selectorChunks = [];
      return;
    }

    try {
      const hostname = window.location.hostname;
      let selectors = [...globalSelectors];

      // 添加域名匹配的选择器
      for (const [domainPattern, rules] of Object.entries(domainSelectors)) {
        if (matchHostname(hostname, domainPattern)) {
          selectors = selectors.concat(rules);
        }
      }

      injectCSS(selectors);
      rebuildSelectorChunks(selectors);
    } catch (e) {
      // ignore
    }
  }

  /**
   * 重建 :is() 分块复合选择器（每块 200 条，:is 宽容语法自动丢弃非法条目）
   */
  function rebuildSelectorChunks(selectors) {
    selectorChunks = [];
    const clean = selectors
      .filter(sel => !isProtectedSelector(sel))
      .map(sel => sel.replace(/[{}]/g, '').trim())
      .filter(Boolean);
    for (let i = 0; i < clean.length; i += 200) {
      selectorChunks.push(clean.slice(i, i + 200).join(', '));
    }
  }

  /**
   * 主机名匹配（支持通配符）
   */
  function matchHostname(hostname, pattern) {
    if (hostname === pattern) return true;
    if (hostname.endsWith('.' + pattern)) return true;
    // *.example.com
    if (pattern.startsWith('*.')) {
      const suffix = pattern.substring(2);
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }
    return false;
  }

  // ============================================================
  // 动态 DOM 监控
  // ============================================================
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!enabled || !styleElement) return;

      // 检查是否有新增的需要隐藏的元素
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              checkAndHideElement(node);
            }
          });
        } else if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
          // 属性变化可能导致元素匹配新规则
          checkAndHideElement(mutation.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'style', 'src']
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  /**
   * 检查单个元素是否匹配过滤规则并隐藏
   * 用 :is() 分块复合选择器做 O(分块数) 匹配；实际隐藏由注入的 CSS 样式表完成，
   * 这里仅做标记（供统计）+ 内联样式兜底。
   */
  function checkAndHideElement(element) {
    if (!enabled || element.hasAttribute(HIDDEN_ATTR)) return;
    if (element.id === 'wuji-adblock-cosmetic' || element.id === 'wuji-chat-host') return;

    // 🔑 保护关键 UI 元素（如 YouTube 跳过按钮）
    if (isProtectedElement(element)) return;

    try {
      // 1. 元素自身命中任一选择器 → 标记（CSS 样式表负责视觉隐藏）
      for (const chunk of selectorChunks) {
        try {
          if (element.matches(chunk)) {
            element.setAttribute(HIDDEN_ATTR, '1');
            return;
          }
        } catch (e) { /* 该块含非法选择器，:is 已宽容丢弃 */ }
      }
      // 2. 容器命中（后代选择器如 .ad-box .ad）：统计标记匹配的后代
      for (const chunk of selectorChunks) {
        try {
          const hit = element.querySelector(':is(' + chunk + ')');
          if (hit && !hit.hasAttribute(HIDDEN_ATTR) && !isProtectedElement(hit)) {
            hit.setAttribute(HIDDEN_ATTR, '1');
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  // ============================================================
  // 规则加载
  // ============================================================
  async function loadRules() {
    try {
      const result = await chrome.storage.local.get(['adblock_cosmetic_rules']);
      if (result.adblock_cosmetic_rules) {
        globalSelectors = result.adblock_cosmetic_rules.global || [];
        domainSelectors = result.adblock_cosmetic_rules.domain || {};
        updateForCurrentPage();
      }
    } catch (e) {
      // ignore
    }
  }

  // ============================================================
  // 监听来自 SW 的消息
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ADBLOCK_UPDATE_COSMETIC') {
      if (message.rules) {
        globalSelectors = message.rules.global || [];
        domainSelectors = message.rules.domain || {};
        updateForCurrentPage();
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'ADBLOCK_TOGGLE') {
      enabled = !!message.enabled;
      if (enabled) {
        updateForCurrentPage();
        startObserver();
      } else {
        if (styleElement) styleElement.textContent = '';
        stopObserver();
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'ADBLOCK_GET_STATS') {
      let hiddenCount = 0;
      try {
        hiddenCount = document.querySelectorAll(`[${HIDDEN_ATTR}]`).length;
      } catch (e) {}
      sendResponse({ success: true, hiddenCount });
      return true;
    }

    if (message.type === 'ADBLOCK_WHITELIST_UPDATE') {
      whitelistDomains = message.domains || [];
      updateForCurrentPage();
      sendResponse({ success: true });
      return true;
    }
  });

  // ============================================================
  // 初始化
  // ============================================================
  async function init() {
    // 读取启用状态
    try {
      const config = await chrome.storage.sync.get('adblockConfig');
      if (config.adblockConfig) {
        enabled = config.adblockConfig.enabled !== false;
      }
    } catch (e) {}

    // 读取白名单
    try {
      const wl = await chrome.storage.local.get('adblock_whitelist');
      const items = wl.adblock_whitelist?.items || [];
      whitelistDomains = items.map(i => i.domain);
    } catch (e) {}

    await loadRules();
    
    if (enabled) {
      startObserver();
    }
  }

  // 页面加载完成后检查一次
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();