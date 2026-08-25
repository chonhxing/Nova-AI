/**
 * 无极 — 休眠标签页占位页逻辑
 */
(function() {
  'use strict';

  function getParam(key) {
    var hash = location.hash.substring(1);
    if (key === 'uri') {
      var idx = hash.indexOf('uri=');
      if (idx >= 0) return decodeURIComponent(hash.substring(idx + 4));
      return '';
    }
    var pairs = hash.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf('=');
      if (eq > 0 && pairs[i].substring(0, eq) === key) {
        return decodeURIComponent(pairs[i].substring(eq + 1));
      }
    }
    return '';
  }

  var title = getParam('ttl') || '已休眠';
  var url = getParam('uri') || '';
  document.title = title;
  var pageTitleEl = document.getElementById('pageTitle');
  var tabTitleEl = document.getElementById('tabTitle');
  var tabUrlEl = document.getElementById('tabUrl');
  if (pageTitleEl) pageTitleEl.textContent = title;
  if (tabTitleEl) tabTitleEl.textContent = title;
  if (tabUrlEl) tabUrlEl.textContent = url;

  if (url && typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_FETCH_ICON', url: url }, function(resp) {
      if (resp && resp.favIconUrl) {
        var tabIcon = document.getElementById('tabIcon');
        var favicon = document.getElementById('favicon');
        if (tabIcon) tabIcon.src = resp.favIconUrl;
        if (favicon) favicon.href = resp.favIconUrl;
      }
    });
  }

  function createRipple(e) {
    var ripple = document.createElement('div');
    ripple.className = 'ripple';
    var size = Math.max(window.innerWidth, window.innerHeight);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - size / 2) + 'px';
    ripple.style.top = (e.clientY - size / 2) + 'px';
    document.body.appendChild(ripple);
    setTimeout(function() { ripple.remove(); }, 800);
  }

  function restoreTab() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return;
    chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_RESTORE_CURRENT' }, function(resp) {
      if (!resp || !resp.success) {
        // 消息失败时回退到直接导航
        if (url) location.href = url;
      }
    });
  }

  var mainCard = document.getElementById('mainCard');
  if (mainCard) {
    mainCard.addEventListener('click', function(e) {
      createRipple(e);
      setTimeout(restoreTab, 150);
    });
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      restoreTab();
    }
  });
})();
