/**
 * libs/providers.js 的 ESM 桥接
 * providers.js 是经典脚本（service-worker 通过 importScripts 加载，不能用 export），
 * 这里以副作用方式引入一次，再把全局导出转成 ES 具名导出。
 */
import '../../libs/providers.js';

export const PROVIDERS = globalThis.WUJI_PROVIDERS;
export const VISION_PROVIDERS = globalThis.WUJI_VISION_PROVIDERS;
export const chatPath = globalThis.WUJI_CHAT_PATH;
export const DEFAULT_PATH = globalThis.WUJI_DEFAULT_PATH;
