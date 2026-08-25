/**
 * 无极 Popup 菜单控制器 V3.3
 */
document.addEventListener('DOMContentLoaded', () => {
  // ============================================================
  // 💬 打开对话窗
  // ============================================================
  document.getElementById('btn-chat').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CHAT_PANEL' });
      }
    } catch (e) {
      console.warn('[Popup] 打开对话窗失败:', e.message);
    }
    setTimeout(() => window.close(), 80);
  });

  // ============================================================
  // 🌐 翻译此页为中文
  // ============================================================
  document.getElementById('btn-translate').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_START', config: { targetLang: 'zh-CN', displayMode: 'bilingual' } });
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // ↩️ 显示原文
  // ============================================================
  document.getElementById('btn-restore').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_RESTORE' });
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // 💤 休眠 / 恢复标签页
  // ============================================================
  document.getElementById('btn-suspend').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        if (tab.url && tab.url.includes('suspended.html')) {
          await chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_UNSUSPEND', tabId: tab.id });
        } else {
          await chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_NOW', tabId: tab.id, forceLevel: 1 });
        }
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // ✅ 加入白名单
  // ============================================================
  document.getElementById('btn-whitelist').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const domain = new URL(tab.url).hostname;
        await chrome.runtime.sendMessage({ type: 'TAB_SUSPEND_WHITELIST_ADD', domain: domain });
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // 🛡 广告屏蔽白名单
  // ============================================================
  document.getElementById('btn-adblock-whitelist').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const domain = new URL(tab.url).hostname;
        await chrome.runtime.sendMessage({ type: 'ADBLOCK_WHITELIST_TOGGLE', domain: domain });
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // 🎬 弹幕管理姬
  // ============================================================
  document.getElementById('btn-danmaku').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_DANMAKU_PANEL' });
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // 📄 保存为 PDF
  // ============================================================
  document.getElementById('btn-pdf').addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_AS_PDF' });
    } catch (e) {
      console.error('[Popup] PDF error:', e);
    }
    window.close();
  });

  // ============================================================
  // ⚙️ 设置
  // ============================================================
  document.getElementById('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ============================================================
  // ❤️ 赞助作者
  // ============================================================
  document.getElementById('btn-sponsor').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const imgUrl = chrome.runtime.getURL('icons/sponsor.jpg');
        chrome.tabs.sendMessage(tab.id, { type: 'SHOW_SPONSOR_IMAGE', imgUrl }).catch(() => {});
      }
    } catch (e) {}
    window.close();
  });

  // ============================================================
  // 初始化：根据当前标签页状态更新按钮文案
  // ============================================================
  (async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const label = document.getElementById('suspend-label');
      if (tab?.url && tab.url.includes('suspended.html')) {
        label.textContent = '恢复此标签页';
      } else {
        label.textContent = '休眠此标签页';
      }
    } catch (e) {}
  })();
});