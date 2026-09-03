/**
 * 无极 — 网页翻译模块 V5.0
 * 借鉴 FluentRead (github.com/Bistutu/FluentRead) 核心架构：
 *   1. TreeWalker + grabNode 节点发现（内联元素递归找父节点）
 *   2. bilingualAppendChild 非破坏性译文追加
 *   3. IntersectionObserver 懒加载（只翻译可见区域）
 *   4. MutationObserver 动态内容实时翻译
 *   5. 文本过滤（纯数字/超长文本/header-footer 跳过）
 */
(function () {
  'use strict';

  const PREFIX = 'wjt' + Math.random().toString(36).substring(2, 6);
  const CLS_BILINGUAL = PREFIX + '-bl';      // 双语父节点标记
  const CLS_BILINGUAL_CT = PREFIX + '-blct'; // 译文内容标记
  const ATTR_TRANSLATED = 'data-' + PREFIX + '-td';
  const ATTR_NODE_ID = 'data-' + PREFIX + '-nid';

  let config = {
    enabled: false,
    realtime: false,
    targetLang: 'zh-CN',
    srcLang: 'auto',
    displayMode: 'bilingual',
    fontSize: '12px',
    transColor: '#6366f1',
    cacheEnabled: true,
    hoverEnabled: true,
  };

  const transCache = new Map();              // text → translation
  const originalContents = new Map();        // nodeId → original innerHTML
  const htmlSet = new Set();                 // 防抖去重
  const MAX_CACHE = 5000;
  let nodeIdCounter = 0;
  let isAutoTranslating = false;
  let intersectionObserver = null;
  let mutationObserver = null;
  let hoverPopup = null, hoverTimer = null;

  // ============================================================
  // 常量和工具
  // ============================================================
  const DIRECT_SET = new Set(['h1','h2','h3','h4','h5','h6','p','li','dd','blockquote','figcaption','dt']);
  const SKIP_TAGS = new Set(['html','body','script','style','noscript','iframe','input','textarea','select','button','code','pre','kbd','svg','canvas','video','audio','img','object','embed','math','time','abbr']);
  const INLINE_SET = new Set(['a','b','strong','span','em','i','u','small','sub','sup','font','mark','cite','q','abbr','ruby','bdi','bdo','label','time','code','var','samp']);

  function escHtml(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
  function detectLang(text) {
    // 优先 WebAssembly 内核（手写 WAT，字节级统计），加载失败自动降级 JS 实现
    if (typeof WasmKernels !== 'undefined' && WasmKernels.langDetect) {
      const code = WasmKernels.langDetect(text);
      if (code === 1) return 'zh';
      if (code === 2) return 'ja';
      if (code === 3) return 'ko';
      return 'en';
    }
    const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const total = text.replace(/\s/g, '').length || 1;
    if (cn / total > 0.25) return 'zh';
    const jp = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    if (jp / total > 0.15) return 'ja';
    const ko = (text.match(/[\uac00-\ud7af]/g) || []).length;
    if (ko / total > 0.15) return 'ko';
    return 'en';
  }

  function shouldSkipLang(text) {
    if (config.srcLang === 'auto') {
      const lang = detectLang(text);
      if ((lang === 'zh' && config.targetLang.startsWith('zh')) ||
          (lang === 'ja' && config.targetLang === 'ja') ||
          (lang === 'ko' && config.targetLang === 'ko')) return true;
    }
    return false;
  }

  // ============================================================
  // 节点检查 (借鉴 FluentRead shouldSkipNode)
  // ============================================================
  function checkTextSize(node) {
    const t = node.textContent || '';
    return t.length > 3072 || t.length < 3;
  }

  function isNumericContent(node) {
    const t = (node.textContent || '').trim();
    if (!t) return false;
    if (t.length < 30 && /^[\d\s.,;:!?/()+\-=*%#@&~\-•·]+$/.test(t)) return true;
    if (/^[\d\s]*$/.test(t) && t.replace(/\s/g,'').length > 5) return true;
    return false;
  }

  function shouldSkipNode(node) {
    if (!node || !node.tagName) return true;
    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return true;
    if (node.classList?.contains('notranslate') || node.classList?.contains('sr-only') || node.isContentEditable) return true;
    if (node.getAttribute('aria-hidden') === 'true' || node.hasAttribute('hidden')) return true;
    if (node.hasAttribute(ATTR_TRANSLATED) || node.getAttribute('translate') === 'no') return true;
    if (checkTextSize(node) || isNumericContent(node)) return true;
    if (node.closest('#' + PREFIX + '-popup') || node.closest('#wuji-chat-host')) return true;
    try { const s = getComputedStyle(node); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true; } catch (e) {}
    return false;
  }

  // ============================================================
  // 原子块判定：直接子节点只含文本/行内元素（br 除外）的"原子文本块"
  // 翻译以原子块为最小单位，任何外层容器若嵌有块级子节点一律不整体翻译
  // （否则父容器与子节点重复翻译，出现截图中的乱序堆叠）
  // ============================================================
  function hasBlockChild(el) {
    if (!el.childNodes) return false;
    for (const c of el.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) continue;
      if (c.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = c.tagName.toLowerCase();
      if (tag === 'br' || tag === 'wbr') continue;
      if (!INLINE_SET.has(tag)) return true;
    }
    return false;
  }

  function isAtomicBlock(node) {
    return node ? !hasBlockChild(node) : false;
  }

  // ============================================================
  // 核心：grabNode (借鉴 FluentRead)
  // ============================================================
  function findTranslatableParent(node) {
    let current = node.parentElement;
    while (current) {
      if (shouldSkipNode(current)) return null;
      const tag = current.tagName.toLowerCase();
      if (DIRECT_SET.has(tag)) {
        // 只有原子文本块才整体翻译；含块级子节点（如 li 内嵌 ul）交给子块
        return isAtomicBlock(current) ? current : null;
      }
      if (!INLINE_SET.has(tag)) {
        if (isAtomicBlock(current) && current.textContent?.trim().length > 3) return current;
        return null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function grabNode(node) {
    if (!node) return null;
    // 文本节点
    if (node.nodeType === Node.TEXT_NODE) {
      return findTranslatableParent(node);
    }
    if (!node.tagName) return null;
    const tag = node.tagName.toLowerCase();
    if (shouldSkipNode(node)) return null;
    if (node.hasAttribute(ATTR_TRANSLATED)) return null;
    for (let anc = node.parentElement; anc; anc = anc.parentElement) {
      if (anc.hasAttribute && anc.hasAttribute(ATTR_TRANSLATED)) return null;
    }

    const atomic = isAtomicBlock(node);

    // 块级元素：仅原子块可翻译
    if (DIRECT_SET.has(tag)) return atomic ? node : null;

    // 内联元素 → 向上找原子块父节点
    if (INLINE_SET.has(tag)) return findTranslatableParent(node);

    // td/div 等容器：只有原子文本块才翻译，含块级子节点的交给子节点
    return atomic && node.textContent?.trim().length > 2 ? node : null;
  }

  // ============================================================
  // grabAllNode (借鉴 FluentRead TreeWalker)
  // ============================================================
  function grabAllNode(root) {
    const result = [];
    const seen = new WeakSet();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_SKIP;
          const p = node.parentElement;
          if (!p || shouldSkipNode(p)) return NodeFilter.FILTER_SKIP;
          // 检查父元素的父元素是否为已处理的块
          let anc = p;
          while (anc) {
            if (anc.hasAttribute && anc.hasAttribute(ATTR_TRANSLATED)) return NodeFilter.FILTER_REJECT;
            anc = anc.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        if (!(node instanceof Element)) return NodeFilter.FILTER_SKIP;
        const tag = node.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag) || tag === 'header' || tag === 'footer') return NodeFilter.FILTER_REJECT;
        if (node.classList?.contains('notranslate') || node.classList?.contains('sr-only')) return NodeFilter.FILTER_REJECT;
        if (node.hasAttribute(ATTR_TRANSLATED)) return NodeFilter.FILTER_REJECT;
        if (checkTextSize(node) || isNumericContent(node)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const translateNode = grabNode(currentNode);
      if (translateNode && !seen.has(translateNode) && !translateNode.hasAttribute(ATTR_TRANSLATED)) {
        seen.add(translateNode);
        result.push(translateNode);
      }
    }
    return result;
  }

  // ============================================================
  // 双语翻译追加 (借鉴 FluentRead bilingualAppendChild)
  // ============================================================
  function bilingualAppendChild(node, text) {
    node.classList.add(CLS_BILINGUAL);
    const wrapper = document.createElement('span');
    wrapper.className = CLS_BILINGUAL_CT;
    wrapper.style.cssText = `display:block;margin-top:2px;padding:4px 0 4px 10px;border-left:2px solid ${config.transColor};font-size:${config.fontSize};color:${config.transColor};line-height:1.6;border-radius:0 4px 4px 0;`;
    wrapper.textContent = text;
    // 破解可能的 overflow:hidden 截断
    if (getComputedStyle(node).overflow === 'hidden') {
      node.style.overflow = 'visible';
    }
    node.appendChild(wrapper);
  }

  function insertTranslation(node, translation) {
    if (!translation || !translation.trim()) return;
    if (node.hasAttribute(ATTR_TRANSLATED)) return;

    const nodeId = 'wj-' + (nodeIdCounter++);
    node.setAttribute(ATTR_NODE_ID, nodeId);
    // 保存原文 innerHTML 以便恢复
    originalContents.set(nodeId, node.innerHTML);
    node.setAttribute(ATTR_TRANSLATED, 'true');

    if (config.displayMode === 'translation') {
      node.innerHTML = escHtml(translation);
      return;
    }
    if (config.displayMode === 'bilingual') {
      bilingualAppendChild(node, translation);
    }
  }

  // ============================================================
  // 批量翻译
  // ============================================================
  function prepareBatches(nodes) {
    const batches = [];
    let cur = { texts: [], nodes: [] };
    for (const node of nodes) {
      if (node.hasAttribute(ATTR_TRANSLATED)) continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3 || shouldSkipLang(text)) continue;
      if (config.cacheEnabled && transCache.has(text)) {
        insertTranslation(node, transCache.get(text));
        continue;
      }
      cur.texts.push(text); cur.nodes.push(node);
      if (cur.texts.length >= 8 || cur.texts.join('|||').length > 2000) {
        batches.push(cur); cur = { texts: [], nodes: [] };
      }
    }
    if (cur.texts.length) batches.push(cur);
    return batches;
  }

  async function translateBatch(batch) {
    try {
      const delimiter = '|||';
      const resp = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        payload: { texts: batch.texts, sourceLang: config.srcLang, targetLang: config.targetLang, delimiter }
      });
      if (resp?.success && resp.translations) {
        for (let i = 0; i < batch.texts.length; i++) {
          if (config.cacheEnabled && batch.texts[i] && resp.translations[i]) {
            if (transCache.size >= MAX_CACHE) { const first = transCache.keys().next().value; transCache.delete(first); }
            transCache.set(batch.texts[i], resp.translations[i]);
          }
        }
        return resp.translations;
      }
    } catch (e) { console.error('[无极翻译] 批次失败:', e.message); }
    return batch.texts.map(() => '');
  }

  // ============================================================
  // 主翻译流程 (使用 IntersectionObserver 懒加载)
  // ============================================================
  function startFullPageTranslation() {
    if (isAutoTranslating) return;
    const nodes = grabAllNode(document.body);
    if (!nodes.length) return;
    isAutoTranslating = true;

    if (intersectionObserver) intersectionObserver.disconnect();

    intersectionObserver = new IntersectionObserver((entries) => {
      if (!isAutoTranslating) return;
      const visibleNodes = [];
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const node = entry.target;
          if (!node.hasAttribute(ATTR_TRANSLATED)) visibleNodes.push(node);
          intersectionObserver.unobserve(node);
        }
      }
      if (visibleNodes.length === 0) return;
      (async () => {
        const batches = prepareBatches(visibleNodes);
        for (const batch of batches) {
          const trans = await translateBatch(batch);
          for (let j = 0; j < batch.nodes.length; j++) {
            if (batch.nodes[j].isConnected) insertTranslation(batch.nodes[j], trans[j] || '');
          }
        }
      })();
    }, { root: null, rootMargin: '100px', threshold: 0.05 });

    nodes.forEach(node => intersectionObserver.observe(node));

    // MutationObserver 动态内容
    if (mutationObserver) mutationObserver.disconnect();
    let pendingTimer = null, pendingNodes = new Set();
    mutationObserver = new MutationObserver((mutations) => {
      if (!isAutoTranslating) return;
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === 1 && !shouldSkipNode(node)) {
              const children = grabAllNode(node);
              children.forEach(c => {
                if (!c.hasAttribute(ATTR_TRANSLATED)) {
                  pendingNodes.add(c);
                  intersectionObserver.observe(c);
                }
              });
            }
          });
        }
      }
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        if (pendingNodes.size === 0) return;
        const nodes = [...pendingNodes].filter(n => n.isConnected);
        pendingNodes.clear();
        (async () => {
          const batches = prepareBatches(nodes.slice(0, 30));
          for (const batch of batches) {
            const trans = await translateBatch(batch);
            for (let j = 0; j < batch.nodes.length; j++) {
              if (batch.nodes[j].isConnected) insertTranslation(batch.nodes[j], trans[j] || '');
            }
          }
        })();
      }, 800);
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopTranslation() {
    isAutoTranslating = false;
    if (intersectionObserver) { intersectionObserver.disconnect(); intersectionObserver = null; }
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
  }

  function restoreOriginal() {
    stopTranslation();
    document.querySelectorAll('.' + CLS_BILINGUAL_CT).forEach(el => el.remove());
    document.querySelectorAll('.' + CLS_BILINGUAL).forEach(el => el.classList.remove(CLS_BILINGUAL));
    document.querySelectorAll('[' + ATTR_TRANSLATED + ']').forEach(el => {
      const nodeId = el.getAttribute(ATTR_NODE_ID);
      if (nodeId && originalContents.has(nodeId)) {
        el.innerHTML = originalContents.get(nodeId);
      }
      el.removeAttribute(ATTR_TRANSLATED);
      el.removeAttribute(ATTR_NODE_ID);
      el.style.overflow = '';
    });
    originalContents.clear();
    htmlSet.clear();
    nodeIdCounter = 0;
  }

  // ============================================================
  // 鼠标悬停翻译
  // ============================================================
  function initHoverTranslate() {
    if (hoverPopup) return;
    hoverPopup = document.createElement('div');
    hoverPopup.id = PREFIX + '-popup';
    hoverPopup.style.cssText = 'position:fixed;z-index:100002;display:none;max-width:360px;padding:10px 14px;background:#fff;border:1px solid rgba(99,102,241,0.2);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.15);font-size:13px;color:#1a1a2e;line-height:1.6;word-break:break-word;';
    document.body.appendChild(hoverPopup);

    document.addEventListener('mouseover', e => {
      if (!config.hoverEnabled || isAutoTranslating) return;
      const target = e.target;
      if (!target || target.closest('#' + PREFIX + '-popup') || target.closest('#wuji-chat-host')) return;
      const text = (target.textContent || '').trim();
      if (text.length < 10 || text.length > 500) return;
      if (shouldSkipLang(text)) return;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(async () => {
        if (config.cacheEnabled && transCache.has(text)) {
          showHoverPopup(e.clientX + 10, e.clientY + 10, text, transCache.get(text));
          return;
        }
        try {
          const resp = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_SELECTION_SYNC',
            payload: { text, sourceLang: 'auto', targetLang: config.targetLang }
          });
          if (resp?.success && resp.translation) {
            if (config.cacheEnabled) transCache.set(text, resp.translation);
            showHoverPopup(e.clientX + 10, e.clientY + 10, text, resp.translation);
          }
        } catch (e) {}
      }, 800);
    });

    document.addEventListener('mouseout', e => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (!e.relatedTarget || !e.relatedTarget.closest('#' + PREFIX + '-popup')) {
        setTimeout(() => { if (!hoverPopup.matches(':hover')) hideHoverPopup(); }, 200);
      }
    });
    hoverPopup.addEventListener('mouseleave', hideHoverPopup);
  }

  function showHoverPopup(x, y, orig, trans) {
    let fx = x, fy = y;
    if (fx + 360 > window.innerWidth) fx = window.innerWidth - 370;
    if (fy + 120 > window.innerHeight) fy = y - 130;
    if (fx < 10) fx = 10; if (fy < 10) fy = 10;
    hoverPopup.style.left = fx + 'px'; hoverPopup.style.top = fy + 'px';
    hoverPopup.innerHTML = `<div style="color:#9ca3af;font-size:11px;margin-bottom:4px;">原文</div><div style="color:#374151;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #eee;">${escHtml(orig.substring(0, 200))}</div><div style="color:#9ca3af;font-size:11px;margin-bottom:4px;">译文</div><div style="color:${config.transColor};">${escHtml(trans.substring(0, 300))}</div>`;
    hoverPopup.style.display = 'block';
  }

  function hideHoverPopup() { if (hoverPopup) hoverPopup.style.display = 'none'; }

  // ============================================================
  // 消息监听
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRANSLATE_START') {
      config = { ...config, ...message.config };
      startFullPageTranslation();
      sendResponse({ success: true }); return true;
    }
    if (message.type === 'TRANSLATE_STOP') {
      stopTranslation();
      sendResponse({ success: true }); return true;
    }
    if (message.type === 'TRANSLATE_RESTORE') {
      restoreOriginal();
      sendResponse({ success: true }); return true;
    }
    if (message.type === 'TRANSLATE_CLEAR_CACHE') { transCache.clear(); sendResponse({ success: true }); return true; }
    return false;
  });

  // ============================================================
  // 初始化
  // ============================================================
  async function init() {
    // 预加载 WASM 内核（语言检测加速；失败自动降级 JS 实现）
    try { if (typeof WasmKernels !== 'undefined' && WasmKernels.init) WasmKernels.init(); } catch (e) {}
    try {
      const r = await chrome.storage.sync.get('translatorConfig');
      if (r.translatorConfig) config = { ...config, ...r.translatorConfig };
      const cr = await chrome.storage.local.get('translatorCache');
      if (cr.translatorCache && Array.isArray(cr.translatorCache)) {
        cr.translatorCache.forEach(([k, v]) => { if (transCache.size < MAX_CACHE) transCache.set(k, v); });
      }
    } catch (e) {}
    initHoverTranslate();
    window.addEventListener('beforeunload', () => {
      if (transCache.size > 0) {
        const arr = [...transCache.entries()].slice(-1000);
        chrome.storage.local.set({ translatorCache: arr }).catch(() => {});
      }
    });
  }

  init();
})();