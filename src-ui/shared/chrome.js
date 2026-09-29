/**
 * 无极 — chrome.* 访问封装
 * 扩展环境外（file:// 预览、视觉验收）自动降级为内存 mock，
 * 页面能正常渲染并显示"开发者预览"横幅，不影响扩展内真实行为。
 */

export const HAS_CHROME =
  typeof chrome !== 'undefined' && !!chrome.storage?.sync && !!chrome.runtime?.id;

export const APP_VERSION = (() => {
  try {
    return chrome?.runtime?.getManifest?.().version || '';
  } catch {
    return '';
  }
})();

const memStore = { sync: {}, local: {} };

function mockArea(area) {
  return {
    get: async (keys) => {
      const r = {};
      const list = keys === null || keys === undefined ? Object.keys(memStore[area]) : [].concat(keys);
      for (const k of list) if (k in memStore[area]) r[k] = memStore[area][k];
      return r;
    },
    set: async (obj) => Object.assign(memStore[area], obj),
    remove: async (keys) => [].concat(keys).forEach((k) => delete memStore[area][k]),
  };
}

export const storage = {
  sync: HAS_CHROME ? chrome.storage.sync : mockArea('sync'),
  local: HAS_CHROME ? chrome.storage.local : mockArea('local'),
};

export async function sendMessage(payload) {
  if (HAS_CHROME) return chrome.runtime.sendMessage(payload);
  console.info('[无极预览] sendMessage 已拦截:', payload.type);
  return { success: true, data: {}, stats: {}, settings: {}, lists: [], items: [] };
}

export async function getActiveTab() {
  if (!HAS_CHROME) return { id: 1, url: 'https://example.com/page' };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || {};
}

/** 向当前标签页发消息（失败静默，如 chrome:// 页） */
export async function tabMessage(payload) {
  try {
    const tab = await getActiveTab();
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, payload);
  } catch {
    /* chrome:// 等页面无 content script */
  }
}
