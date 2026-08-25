/**
 * 无极 — 广告过滤规则解析器
 * 从 uBlock Origin 的 static-filtering-parser.js 提取精简核心逻辑
 * 支持：基础网络过滤、元素隐藏、例外规则
 */

const AdblockParser = {
  // 支持的过滤类型
  TYPE_NETWORK: 1,
  TYPE_COSMETIC: 2,
  TYPE_EXCEPTION: 3,

  /**
   * 解析单条过滤规则
   * @param {string} line - 原始规则行
   * @returns {object|null} 解析结果
   */
  parse(line) {
    line = line.trim();
    
    // 跳过空行和注释
    if (!line || line.startsWith('!') || line.startsWith('#')) return null;
    // 跳过非标准规则头
    if (line.startsWith('[')) return null;

    const result = { raw: line, type: null };

    // === 例外规则 @@||domain ===
    if (line.startsWith('@@')) {
      result.type = this.TYPE_EXCEPTION;
      line = line.substring(2);
    }

    // === 元素隐藏规则 (cosmetic) ===
    // ## 开头：通用元素隐藏
    if (line.startsWith('##') || line.startsWith('#@#')) {
      return this._parseCosmetic(line, result);
    }
    // domain##selector：域名限定元素隐藏
    const domainCosmeticMatch = line.match(/^([^#]*?)(#@?#)(.+)$/);
    if (domainCosmeticMatch && domainCosmeticMatch[2].startsWith('#')) {
      return this._parseDomainCosmetic(domainCosmeticMatch, line, result);
    }

    // === 网络过滤规则 ===
    if (!result.type) {
      result.type = this.TYPE_NETWORK;
    }
    return this._parseNetwork(line, result);
  },

  /**
   * 解析域名限定的元素隐藏规则：domain1,domain2##selector
   */
  _parseDomainCosmetic(match, line, result) {
    const domainPart = match[1];
    const separator = match[2]; // ## 或 #@#
    const selector = match[3];
    
    if (!selector) return null;
    
    const isException = separator === '#@#';
    
    // 排除 script:inject 等脚本注入规则（MV3 支持有限）
    if (selector.includes('script:') || selector.includes(':style(')) {
      return null;
    }

    result.type = this.TYPE_COSMETIC;
    result.exception = isException;
    result.domains = domainPart ? domainPart.split(',').map(d => d.trim()) : [];
    result.selector = selector;

    return result;
  },

  /**
   * 解析通用元素隐藏规则：##selector
   */
  _parseCosmetic(line, result) {
    const isException = line.startsWith('#@#');
    const selector = isException ? line.substring(3) : line.substring(2);
    
    if (!selector) return null;
    
    // 排除脚本注入规则
    if (selector.includes('script:') || selector.includes(':style(')) {
      return null;
    }

    result.type = this.TYPE_COSMETIC;
    result.exception = isException;
    result.domains = [];
    result.selector = selector;

    return result;
  },

  /**
   * 解析网络过滤规则
   */
  _parseNetwork(line, result) {
    // ||domain.com/path^ — 域名锚定
    const domainAnchorMatch = line.match(/^\|\|([a-zA-Z0-9._*-]+)([/^].*)?$/);
    if (domainAnchorMatch) {
      result.pattern = line;
      result.urlFilter = this._toUrlFilter(line);
      return result;
    }

    // |http:// — 开头锚定
    if (line.startsWith('|') && !line.startsWith('||')) {
      result.pattern = line;
      result.urlFilter = this._toUrlFilter(line);
      return result;
    }

    // 纯域名规则（无路径）
    if (/^[a-zA-Z0-9._-]+\^?$/.test(line)) {
      result.pattern = '||' + line;
      result.urlFilter = this._toUrlFilter('||' + line);
      return result;
    }

    // 其他通用模式
    result.pattern = line;
    result.urlFilter = this._toUrlFilter(line);
    return result;
  },

  /**
   * 将过滤模式转换为 DNR urlFilter 格式
   */
  _toUrlFilter(pattern) {
    let filter = pattern;

    // ||domain.com → *://*.domain.com/*
    if (filter.startsWith('||')) {
      const rest = filter.substring(2);
      // 处理 ^ 分隔符
      const caretIdx = rest.indexOf('^');
      if (caretIdx >= 0) {
        const before = rest.substring(0, caretIdx);
        const after = rest.substring(caretIdx + 1);
        // ^ 在 DNR 中匹配分隔符，转换为 * 或 /
        filter = '*://*.' + before + '/*' + (after || '');
      } else if (rest.includes('/')) {
        filter = '*://*.' + rest;
      } else {
        filter = '*://*.' + rest + '/*';
      }
    }
    // |http:// → http://
    else if (filter.startsWith('|')) {
      filter = filter.substring(1);
    }

    // ^ 分隔符 → * （简化处理）
    filter = filter.replace(/\^/g, '*');

    return filter;
  },

  /**
   * 检查域名是否匹配规则中的域名列表
   */
  matchDomain(url, domains) {
    if (!domains || domains.length === 0) return true; // 无域名限制，全局生效
    
    try {
      const hostname = new URL(url).hostname;
      return domains.some(domain => {
        if (domain.startsWith('~')) {
          // 排除域名
          return !this._domainMatch(hostname, domain.substring(1));
        }
        return this._domainMatch(hostname, domain);
      });
    } catch (e) {
      return false;
    }
  },

  _domainMatch(hostname, domain) {
    if (hostname === domain) return true;
    if (hostname.endsWith('.' + domain)) return true;
    // www.example.com 匹配 example.com
    if (domain.startsWith('www.') && hostname === domain.substring(4)) return true;
    return false;
  },

  /**
   * 解析规则列表中的 $option 修饰符
   */
  parseOptions(rule) {
    const options = {};
    const dollarIdx = rule.lastIndexOf('$');
    if (dollarIdx < 0) return { pattern: rule, options };

    const optStr = rule.substring(dollarIdx + 1);
    const pattern = rule.substring(0, dollarIdx);

    optStr.split(',').forEach(opt => {
      const trimmed = opt.trim();
      if (trimmed === 'script' || trimmed === 'image' || trimmed === 'stylesheet' || 
          trimmed === 'xmlhttprequest' || trimmed === 'subdocument' || trimmed === 'document' ||
          trimmed === 'media' || trimmed === 'font' || trimmed === 'websocket' ||
          trimmed === 'ping' || trimmed === 'other' || trimmed === 'main_frame') {
        options.resourceType = trimmed;
      } else if (trimmed.startsWith('domain=')) {
        options.domain = trimmed.substring(7);
        const domainList = options.domain.split('|');
        options.includeDomains = domainList.filter(d => !d.startsWith('~'));
        options.excludeDomains = domainList.filter(d => d.startsWith('~')).map(d => d.substring(1));
      } else if (trimmed === 'third-party') {
        options.thirdParty = true;
      } else if (trimmed === '~third-party' || trimmed === 'first-party') {
        options.firstParty = true;
      } else if (trimmed === 'important') {
        options.priority = 2;
      } else if (trimmed === 'all') {
        // 匹配所有资源类型
      } else if (trimmed === 'csp') {
        options.csp = true;
      } else if (trimmed === 'popup') {
        options.popup = true;
      } else if (trimmed === 'badfilter') {
        options.badfilter = true;
      }
    });

    return { pattern, options };
  }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdblockParser;
}