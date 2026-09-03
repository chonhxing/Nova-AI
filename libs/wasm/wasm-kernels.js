/**
 * 无极 v3.4 — WebAssembly 内核加载器
 * 加载 libs/wasm/kernels.wasm（FNV-1a 哈希 / CJK 语言检测 / 编辑距离）。
 * 加载失败时自动降级为纯 JS 实现，功能行为完全一致，仅性能略有差异。
 * 在 content script 与 service worker 中均可使用（IIFE，无全局污染）。
 */
const WasmKernels = (function () {
  'use strict';

  let inst = null;                 // WebAssembly.Instance
  let initPromise = null;
  const encoder = new TextEncoder();
  const IN_OFFSETS = [0, 8192];    // wasm 输入区两个 8KB 槽位
  const MAX_INPUT = 4096;          // 单串字节上限（够长文本使用）

  // ============================================================
  // 纯 JS 兜底实现（与 wasm 行为逐位一致：均按 UTF-8 字节计算）
  // ============================================================
  function toBytes(str) {
    const s = String(str).length > MAX_INPUT ? String(str).substring(0, MAX_INPUT) : String(str);
    return encoder.encode(s);
  }

  function jsFnv1a(str) {
    const bytes = toBytes(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function jsLangDetect(str) {
    const han = (str.match(/[\u4e00-\u9fff]/g) || []).length;
    const kana = (str.match(/[\u3040-\u30ff]/g) || []).length;
    const hangul = (str.match(/[\uac00-\ud7af]/g) || []).length;
    const total = str.replace(/\s/g, '').length || 1;
    if (han / total > 0.25) return 1;   // zh
    if (kana / total > 0.15) return 2;  // ja
    if (hangul / total > 0.15) return 3; // ko
    return 0;                           // 其他（en 等）
  }

  function jsLevenshtein(a, b) {
    // 与 wasm 一致：UTF-8 字节级编辑距离（CJK 每字 3 字节，距离同比放大，排序单调性不变）
    const A = toBytes(a), B = toBytes(b);
    if (!A.length) return B.length;
    if (!B.length) return A.length;
    let prev = new Array(B.length + 1);
    let cur = new Array(B.length + 1);
    for (let j = 0; j <= B.length; j++) prev[j] = j;
    for (let i = 1; i <= A.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= B.length; j++) {
        const cost = A[i - 1] === B[j - 1] ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    return prev[B.length];
  }

  // ============================================================
  // 加载 wasm 模块
  // ============================================================
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const resp = await fetch(chrome.runtime.getURL('libs/wasm/kernels.wasm'));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(buf, {});
        inst = instance;
        return true;
      } catch (e) {
        console.warn('[无极] WASM 内核加载失败，使用 JS 兜底:', e?.message || e);
        inst = null;
        return false;
      }
    })();
    return initPromise;
  }

  function encodeInto(slot, str) {
    const clamped = str.length > MAX_INPUT ? str.substring(0, MAX_INPUT) : str;
    const bytes = encoder.encode(clamped);
    new Uint8Array(inst.exports.memory.buffer, IN_OFFSETS[slot], bytes.length).set(bytes);
    return bytes.length;
  }

  // ============================================================
  // 对外 API（每个都有 JS 兜底，调用方无需感知 wasm 是否可用）
  // ============================================================
  function fnv1a(str) {
    if (!inst) return jsFnv1a(String(str));
    const n = encodeInto(0, String(str));
    return inst.exports.fnv1a(IN_OFFSETS[0], n) >>> 0;
  }

  function langDetect(str) {
    if (!inst) return jsLangDetect(String(str));
    const n = encodeInto(0, String(str));
    return inst.exports.lang_detect(IN_OFFSETS[0], n) | 0;
  }

  function levenshtein(a, b) {
    a = String(a); b = String(b);
    if (!inst) return jsLevenshtein(a, b);
    const na = encodeInto(0, a);
    const nb = encodeInto(1, b);
    return inst.exports.levenshtein(IN_OFFSETS[0], na, IN_OFFSETS[1], nb) | 0;
  }

  return { init, fnv1a, langDetect, levenshtein, jsFnv1a, jsLangDetect, jsLevenshtein };
})();
