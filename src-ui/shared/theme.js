/**
 * 无极 — 全局外观主题（跟随系统 / 浅色 / 深色）
 * 实现方式：所有颜色用 CSS light-dark() 声明，切换只需改根元素的 color-scheme。
 * 偏好存 chrome.storage.sync 的 uiConfig.theme，扩展各页 + 页内悬浮窗共用一份。
 */
import { HAS_CHROME, storage } from './chrome.js';

export const THEMES = ['auto', 'light', 'dark'];

let listeners = [];

function applyColorScheme(theme) {
  // auto = 'light dark'（跟随系统），其余强制单色
  const cs = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : 'light dark';
  document.documentElement.style.colorScheme = cs;
}

function normalize(theme) {
  return THEMES.includes(theme) ? theme : 'auto';
}

/** 页面挂载前调用：读取偏好并应用，返回当前值 */
export async function initTheme() {
  let theme = 'auto';
  try {
    const r = await storage.sync.get('uiConfig');
    theme = normalize(r.uiConfig?.theme);
  } catch { /* ignore */ }
  applyColorScheme(theme);

  // 其他页面改了主题时实时跟随
  if (HAS_CHROME && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.uiConfig) {
        const t = normalize(changes.uiConfig.newValue?.theme);
        applyColorScheme(t);
        listeners.forEach((fn) => fn(t));
      }
    });
  }
  return theme;
}

/** 切换主题：立即生效并持久化 */
export function setTheme(theme) {
  const t = normalize(theme);
  applyColorScheme(t);
  storage.sync.set({ uiConfig: { theme: t } }).catch(() => {});
  listeners.forEach((fn) => fn(t));
}

/** 主题在自动/浅色/深色间循环，返回切换后的值 */
export function cycleTheme(current) {
  const next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
  setTheme(next);
  return next;
}

export function onThemeChange(fn) {
  listeners.push(fn);
}
