/**
 * 无极 — 标签页休眠引擎 V1.0
 * 借鉴 The Great Suspender 架构，适配 Manifest V3 Service Worker
 */
const TabSuspender = (function() {
  'use strict';

  const _timers = {}; // tabId -> { tabId, suspendTime, timerId }

  // ============================================================
  // 设置管理
  // ============================================================
  const DEFAULT_SETTINGS = {
    enabled: true,
    suspendTime: 60,           // 分钟
    dontSuspendPinned: true,
    dontSuspendAudible: true,
    dontSuspendForms: true,
    dontSuspendActiveTabs: true,
    unsuspendOnFocus: false,
    whitelist: '',
    screenCapture: '0'
  };

  async function loadSettings() {
    const r = await chrome.storage.sync.get('tabSuspenderSettings');
    return Object.assign({ ...DEFAULT_SETTINGS }, r.tabSuspenderSettings || {});
  }

  async function saveSettings(settings) {
    await chrome.storage.sync.set({ tabSuspenderSettings: settings });
  }

  // ============================================================
  // URL 工具
  // ============================================================
  function generateSuspendedUrl(url, title) {
    const args = '#ttl=' + encodeURIComponent(title || url) +
      '&uri=' + encodeURIComponent(url);
    return chrome.runtime.getURL('ui/suspended.html' + args);
  }

  function getHashVariable(key, urlStr) {
    if (!urlStr || urlStr.indexOf('#') === -1) return null;
    const hashStr = urlStr.substring(urlStr.indexOf('#') + 1);
    let result = null;
    // uri 可能在最后且未编码，特殊处理
    if (key === 'uri') {
      const uriIdx = hashStr.indexOf('uri=');
      if (uriIdx >= 0) {
        result = decodeURIComponent(hashStr.substring(uriIdx + 4));
      }
    } else {
      const pairs = hashStr.split('&');
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0 && pair.substring(0, eqIdx) === key) {
          result = decodeURIComponent(pair.substring(eqIdx + 1));
          break;
        }
      }
    }
    return result || null;
  }

  function getOriginalUrl(suspendedUrl) {
    return getHashVariable('uri', suspendedUrl) || '';
  }

  function getSuspendedTitle(suspendedUrl) {
    return getHashVariable('ttl', suspendedUrl) || '';
  }

  function isSuspendedTab(tab) {
    if (!tab || !tab.url) return false;
    return tab.url.indexOf('suspended.html') > 0;
  }

  function isSpecialTab(tab) {
    const url = tab.url || tab.pendingUrl || '';
    if (isSuspendedTab(tab)) return false;
    return url.indexOf('about:') === 0 || url.indexOf('chrome:') === 0 ||
           url.indexOf('chrome-extension:') === 0 || url.indexOf('edge:') === 0;
  }

  function isNormalTab(tab) {
    return !isSpecialTab(tab) && !isSuspendedTab(tab);
  }

  // ============================================================
  // 白名单检查
  // ============================================================
  function checkWhitelist(url, whitelistString) {
    if (!whitelistString) return false;
    const items = whitelistString.split(/[\s\n]+/).filter(Boolean);
    return items.some(item => {
      if (item.length < 1) return false;
      if (item.startsWith('/') && item.lastIndexOf('/') > 0) {
        try {
          const re = new RegExp(item.slice(1, item.lastIndexOf('/')));
          return re.test(url);
        } catch (e) { return false; }
      }
      return url.indexOf(item) >= 0;
    });
  }

  // ============================================================
  // 标签页休眠数据存储 (chrome.storage.local)
  // ============================================================
  async function saveTabInfo(tab) {
    const key = 'suspend_data_' + tab.url;
    const data = {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl || '',
      pinned: tab.pinned,
      index: tab.index,
      windowId: tab.windowId,
      date: Date.now()
    };
    await chrome.storage.local.set({ [key]: data });
    // 定期清理旧数据
    const metaKey = 'suspend_meta';
    const metaR = await chrome.storage.local.get(metaKey);
    const meta = metaR[metaKey] || { count: 0, lastClean: 0 };
    meta.count++;
    if (meta.count > 500 || (Date.now() - meta.lastClean > 86400000)) {
      await cleanOldSuspendData();
      meta.count = 0; meta.lastClean = Date.now();
    }
    await chrome.storage.local.set({ [metaKey]: meta });
  }

  async function fetchTabInfo(url) {
    const key = 'suspend_data_' + url;
    const r = await chrome.storage.local.get(key);
    return r[key] || null;
  }

  async function cleanOldSuspendData() {
    const all = await chrome.storage.local.get(null);
    const suspendKeys = Object.keys(all).filter(k => k.startsWith('suspend_data_'));
    if (suspendKeys.length <= 1000) return;
    // 按时间排序，删除最旧的
    const entries = suspendKeys.map(k => ({ key: k, date: all[k]?.date || 0 }));
    entries.sort((a, b) => a.date - b.date);
    const toRemove = entries.slice(0, entries.length - 1000).map(e => e.key);
    if (toRemove.length > 0) await chrome.storage.local.remove(toRemove);
  }

  // ============================================================
  // 定时器管理
  // ============================================================
  function clearTimerForTabId(tabId) {
    const t = _timers[tabId];
    if (t && t.timerId) {
      clearTimeout(t.timerId);
      delete _timers[tabId];
    }
  }

  async function resetTimerForTab(tab) {
    clearTimerForTabId(tab.id);
    const settings = await loadSettings();
    if (!settings.enabled) return;
    if (settings.suspendTime <= 0) return;
    if (isSpecialTab(tab) || isSuspendedTab(tab)) return;

    // 检查保护状态
    if (settings.dontSuspendActiveTabs && tab.active) return;
    if (settings.dontSuspendPinned && tab.pinned) return;
    if (settings.dontSuspendAudible && tab.audible) return;
    if (checkWhitelist(tab.url, settings.whitelist)) return;

    const timeoutMs = settings.suspendTime * 60 * 1000;
    const timerDetails = {
      tabId: tab.id,
      suspendTime: Date.now() + timeoutMs,
      timerId: setTimeout(async () => {
        try {
          const updatedTab = await chrome.tabs.get(timerDetails.tabId);
          if (updatedTab) suspendTab(updatedTab, 3);
        } catch (e) { /* 标签页可能已关闭 */ }
        delete _timers[timerDetails.tabId];
      }, timeoutMs)
    };
    _timers[tab.id] = timerDetails;
  }

  function resetTimerForAllTabs() {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (isNormalTab(tab)) resetTimerForTab(tab);
      });
    });
  }

  // ============================================================
  // 休眠操作
  // ============================================================
  async function checkTabEligibility(tab, forceLevel) {
    if (forceLevel >= 1) {
      if (isSpecialTab(tab)) return false;
    }
    if (forceLevel >= 2) {
      const settings = await loadSettings();
      if (settings.dontSuspendActiveTabs && tab.active) return false;
      if (settings.dontSuspendPinned && tab.pinned) return false;
      if (settings.dontSuspendAudible && tab.audible) return false;
      if (checkWhitelist(tab.url, settings.whitelist)) return false;
    }
    if (forceLevel >= 3) {
      const settings = await loadSettings();
      if (!settings.enabled || settings.suspendTime <= 0) return false;
    }
    return true;
  }

  async function suspendTab(tab, forceLevel) {
    forceLevel = forceLevel || 2;
    if (isSuspendedTab(tab)) return false;

    const eligible = await checkTabEligibility(tab, forceLevel);
    if (!eligible) return false;

    // 保存元数据
    await saveTabInfo(tab);

    // 更新标签页描述为"已休眠"提示
    const settings = await loadSettings();
    const suspendedUrl = generateSuspendedUrl(tab.url, tab.title);

    clearTimerForTabId(tab.id);

    return new Promise(resolve => {
      chrome.tabs.update(tab.id, { url: suspendedUrl }, updatedTab => {
        resolve(!!updatedTab);
      });
    });
  }

  async function unsuspendTab(tab) {
    if (!isSuspendedTab(tab)) return false;
    const originalUrl = getOriginalUrl(tab.url);
    if (!originalUrl) return false;

    return new Promise(resolve => {
      chrome.tabs.update(tab.id, { url: originalUrl }, updatedTab => {
        if (updatedTab) resetTimerForTab(updatedTab);
        resolve(!!updatedTab);
      });
    });
  }

  // ============================================================
  // 批量操作
  // ============================================================
  async function suspendAllTabs(forceLevel) {
    const tabs = await chrome.tabs.query({});
    let count = 0;
    for (const tab of tabs) {
      if (isNormalTab(tab) && !tab.active) {
        const ok = await suspendTab(tab, forceLevel || 2);
        if (ok) count++;
      }
    }
    return count;
  }

  async function unsuspendAllTabs() {
    const tabs = await chrome.tabs.query({});
    let count = 0;
    for (const tab of tabs) {
      if (isSuspendedTab(tab)) {
        const ok = await unsuspendTab(tab);
        if (ok) count++;
      }
    }
    return count;
  }

  async function getSuspendedCount() {
    const tabs = await chrome.tabs.query({});
    return tabs.filter(t => isSuspendedTab(t)).length;
  }

  async function getStats() {
    const tabs = await chrome.tabs.query({});
    const suspended = tabs.filter(t => isSuspendedTab(t)).length;
    const normal = tabs.filter(t => isNormalTab(t)).length;
    const settings = await loadSettings();
    return {
      totalTabs: tabs.length,
      suspendedTabs: suspended,
      normalTabs: normal,
      enabled: settings.enabled,
      suspendTime: settings.suspendTime,
      activeTimers: Object.keys(_timers).length
    };
  }

  // ============================================================
  // 安全网：定期闹钟检查过期定时器
  // ============================================================
  async function runSafetyCheck() {
    const settings = await loadSettings();
    if (!settings.enabled || settings.suspendTime <= 0) return;

    const now = Date.now();
    const timeoutMs = settings.suspendTime * 60 * 1000;

    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!isNormalTab(tab)) continue;
      if (settings.dontSuspendActiveTabs && tab.active) continue;
      if (settings.dontSuspendPinned && tab.pinned) continue;
      if (settings.dontSuspendAudible && tab.audible) continue;
      if (checkWhitelist(tab.url, settings.whitelist)) continue;

      // 如果此标签页没有定时器，重新设置
      if (!_timers[tab.id]) {
        await resetTimerForTab(tab);
      }
    }
  }

  // ============================================================
  // 初始化
  // ============================================================
  async function init() {
    const settings = await loadSettings();
    if (!settings.enabled) return;

    // 为所有打开的标签页设置定时器
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (isNormalTab(tab)) await resetTimerForTab(tab);
    }

    // 安全网闹钟（每5分钟）
    chrome.alarms.create('wuji-tab-suspend-check', { periodInMinutes: 5 });

    console.log('[TabSuspender] 已初始化，监控 ' + tabs.filter(t => isNormalTab(t)).length + ' 个标签页');
  }

  return {
    loadSettings,
    saveSettings,
    generateSuspendedUrl,
    getOriginalUrl,
    getSuspendedTitle,
    isSuspendedTab,
    isSpecialTab,
    isNormalTab,
    checkWhitelist,
    resetTimerForTab,
    clearTimerForTabId,
    resetTimerForAllTabs,
    suspendTab,
    unsuspendTab,
    suspendAllTabs,
    unsuspendAllTabs,
    getSuspendedCount,
    getStats,
    runSafetyCheck,
    saveTabInfo,
    fetchTabInfo,
    init
  };
})();
