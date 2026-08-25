/**
 * 无极 — 知识库核心引擎 V2.0
 * 借鉴 Everything Capture 的数据模型架构
 * 在 IndexedDB 中模拟关系型数据模型：
 *   kb_items          — 核心条目（增强版 kb_pages）
 *   kb_items_blocks   — 内容块（文本/图片混合）
 *   kb_highlights     — 高亮批注
 *   kb_page_notes     — 页面笔记
 *   kb_tags           — 标签
 *   kb_item_tag_links — 条目-标签关联
 *   kb_ai_conversations — AI 对话持久化
 *   kb_ai_memories    — AI 记忆/偏好
 *   kb_search_index   — 客户端 FTS 倒排索引
 */

const KB_DB_NAME = 'WujiKB_V2';
const KB_DB_VERSION = 1;

// ============================================================
// 数据库初始化
// ============================================================
function initKB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log('[无极 KB] 创建数据库 schema...');

      // 1. 核心条目表
      if (!db.objectStoreNames.contains('kb_items')) {
        const store = db.createObjectStore('kb_items', { keyPath: 'id', autoIncrement: true });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('source_type', 'source_type', { unique: false }); // page | chat | file
        store.createIndex('parse_status', 'parse_status', { unique: false });
        store.createIndex('is_favorite', 'is_favorite', { unique: false });
        store.createIndex('last_viewed_at', 'last_viewed_at', { unique: false });
      }

      // 2. 内容块表（文本/图片混合，借鉴 EC content_blocks）
      if (!db.objectStoreNames.contains('kb_item_blocks')) {
        const store = db.createObjectStore('kb_item_blocks', { keyPath: 'id', autoIncrement: true });
        store.createIndex('item_id', 'item_id', { unique: false });
        store.createIndex('block_type', 'block_type', { unique: false }); // text | image
        store.createIndex('display_order', 'display_order', { unique: false });
      }

      // 3. 高亮批注表（借鉴 EC Highlight）
      if (!db.objectStoreNames.contains('kb_highlights')) {
        const store = db.createObjectStore('kb_highlights', { keyPath: 'id', autoIncrement: true });
        store.createIndex('item_id', 'item_id', { unique: false });
        store.createIndex('color', 'color', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      // 4. 页面笔记表（借鉴 EC ItemPageNote）
      if (!db.objectStoreNames.contains('kb_page_notes')) {
        const store = db.createObjectStore('kb_page_notes', { keyPath: 'id', autoIncrement: true });
        store.createIndex('item_id', 'item_id', { unique: false });
        store.createIndex('conversation_id', 'conversation_id', { unique: false });
      }

      // 5. 标签表（借鉴 EC Tag）
      if (!db.objectStoreNames.contains('kb_tags')) {
        const store = db.createObjectStore('kb_tags', { keyPath: 'id', autoIncrement: true });
        store.createIndex('name', 'name', { unique: true });
      }

      // 6. 条目-标签关联表（借鉴 EC ItemTagLink）
      if (!db.objectStoreNames.contains('kb_item_tag_links')) {
        const store = db.createObjectStore('kb_item_tag_links', { keyPath: ['item_id', 'tag_id'] });
        store.createIndex('item_id', 'item_id', { unique: false });
        store.createIndex('tag_id', 'tag_id', { unique: false });
        store.createIndex('source', 'source', { unique: false }); // manual | ai
      }

      // 7. AI 对话持久化（借鉴 EC AiConversation）
      if (!db.objectStoreNames.contains('kb_ai_conversations')) {
        const store = db.createObjectStore('kb_ai_conversations', { keyPath: 'id', autoIncrement: true });
        store.createIndex('item_id', 'item_id', { unique: false });
        store.createIndex('scope', 'scope', { unique: false }); // main | item
        store.createIndex('mode', 'mode', { unique: false }); // chat | ask | agent
        store.createIndex('last_message_at', 'last_message_at', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      // 8. AI 记忆表（借鉴 EC AiMemory）
      if (!db.objectStoreNames.contains('kb_ai_memories')) {
        const store = db.createObjectStore('kb_ai_memories', { keyPath: 'id', autoIncrement: true });
        store.createIndex('type', 'type', { unique: false }); // learned | preference | correction
        store.createIndex('created_at', 'created_at', { unique: false });
      }

      // 9. FTS 倒排索引表
      if (!db.objectStoreNames.contains('kb_search_index')) {
        const store = db.createObjectStore('kb_search_index', { keyPath: 'term' });
        store.createIndex('item_ids', 'item_ids', { unique: false, multiEntry: true });
      }
    };

    request.onsuccess = (event) => {
      console.log('[无极 KB] 数据库初始化完成');
      event.target.result.close();
      resolve();
    };
    request.onerror = (event) => reject(event.target.error);
    request.onblocked = () => console.warn('[无极 KB] DB blocked');
  });
}

// ============================================================
// 通用 DB 辅助函数
// ============================================================
function openKBDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KB_DB_NAME, KB_DB_VERSION);
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function _dbAdd(storeName, record) {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.add(record);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

function _dbPut(storeName, record) {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(record);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

function _dbGetAll(storeName, limit = 50, offset = 0, indexName = 'timestamp', direction = 'prev') {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      const results = [];
      let skipped = 0;
      try {
        const objectStore = db.transaction(storeName, 'readonly').objectStore(storeName);
        const cursorReq = (indexName && objectStore.indexNames.contains(indexName))
          ? objectStore.index(indexName).openCursor(null, direction)
          : objectStore.openCursor(null, direction);
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor || results.length >= limit) { db.close(); resolve(results); return; }
          if (skipped < offset) { skipped++; cursor.continue(); return; }
          results.push(cursor.value);
          cursor.continue();
        };
        cursorReq.onerror = () => { db.close(); reject(cursorReq.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

function _dbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      try {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

function _dbDelete(storeName, id) {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      try {
        const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id);
        req.onsuccess = () => { db.close(); resolve(); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

function _dbClear(storeName) {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      try {
        const req = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
        req.onsuccess = () => { db.close(); resolve(); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

function _dbCount(storeName) {
  return new Promise((resolve, reject) => {
    openKBDB().then(db => {
      try {
        const req = db.transaction(storeName, 'readonly').objectStore(storeName).count();
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch(e) { db.close(); reject(e); }
    }).catch(reject);
  });
}

// ============================================================
// 1. 核心条目操作（Item CRUD）
// ============================================================
const KBItem = {
  /**
   * 保存条目（保存页面时自动提取内容块）
   * @param {Object} data - { url, title, content, source_type: 'page'|'chat'|'file', metadata }
   */
  async save(data) {
    const record = {
      url: data.url || '',
      title: data.title || '未命名',
      content: (data.content || '').substring(0, 50000),
      source_type: data.source_type || 'page',
      timestamp: data.timestamp || Date.now(),
      last_viewed_at: Date.now(),
      is_favorite: false,
      parse_status: 'idle', // idle | parsing | done | failed
      parse_error: null,
      parsed_at: null,
      metadata: data.metadata || {},
      tag_ids: [],
      extracted_urls: [],
      image_urls: [],
      content_summary: '',
      word_count: (data.content || '').length,
    };

    const id = await _dbAdd('kb_items', record);

    // 提取内容块
    try {
      await KBBlock.extract(id, data.content || '', data.content);
    } catch(e) { /* non-critical */ }

    // 更新 FTS 索引
    try {
      await KBIndex.updateIndex(id, record.title, record.content, record.url);
    } catch(e) { /* non-critical */ }

    return id;
  },

  async get(id) {
    return await _dbGet('kb_items', id);
  },

  async getAll(limit = 50, offset = 0) {
    return await _dbGetAll('kb_items', limit, offset, 'timestamp', 'prev');
  },

  async update(id, updates) {
    const existing = await _dbGet('kb_items', id);
    if (!existing) throw new Error('条目不存在');
    const updated = { ...existing, ...updates, id: existing.id };
    await _dbPut('kb_items', updated);
    return updated;
  },

  async delete(id) {
    // 级联删除关联数据
    await _dbDelete('kb_items', id);
    // 删除内容块
    const blocks = await _dbGetAll('kb_item_blocks', 1000, 0, 'item_id');
    for (const b of blocks.filter(b => b.item_id === id)) {
      await _dbDelete('kb_item_blocks', b.id);
    }
    // 删除高亮
    const highlights = await _dbGetAll('kb_highlights', 1000, 0, 'item_id');
    for (const h of highlights.filter(h => h.item_id === id)) {
      await _dbDelete('kb_highlights', h.id);
    }
    // 删除笔记
    const notes = await _dbGetAll('kb_page_notes', 1000, 0, 'item_id');
    for (const n of notes.filter(n => n.item_id === id)) {
      await _dbDelete('kb_page_notes', n.id);
    }
    // 删除标签关联
    const links = await _dbGetAll('kb_item_tag_links', 1000, 0, 'item_id');
    for (const l of links.filter(l => l.item_id === id)) {
      await _dbDelete('kb_item_tag_links', [l.item_id, l.tag_id]);
    }
  },

  async toggleFavorite(id) {
    const item = await _dbGet('kb_items', id);
    if (!item) throw new Error('条目不存在');
    return await KBItem.update(id, { is_favorite: !item.is_favorite });
  },

  async markViewed(id) {
    return await KBItem.update(id, { last_viewed_at: Date.now() });
  },

  async getStats() {
    const [total, favorites, unparsed] = await Promise.all([
      _dbCount('kb_items'),
      // count favorites via query (simplified: count all and filter)
      _dbGetAll('kb_items', 10000).then(items => items.filter(i => i.is_favorite).length),
      _dbGetAll('kb_items', 10000).then(items => items.filter(i => i.parse_status === 'idle').length),
    ]);
    return { total, favorites, unparsed };
  }
};

// ============================================================
// 2. 内容块操作（借鉴 EC content_blocks）
// ============================================================
const KBBlock = {
  async extract(itemId, content, htmlContent = '') {
    const blocks = [];
    let order = 0;
    
    // 提取图片 URL
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    const imgMatches = [...(htmlContent || '').matchAll(imgRegex)];
    const seenUrls = new Set();
    
    imgMatches.forEach(match => {
      const url = match[1];
      if (!seenUrls.has(url) && !url.startsWith('data:image/svg')) {
        seenUrls.add(url);
        blocks.push({
          item_id: itemId,
          block_type: 'image',
          content: url,
          alt_text: '',
          display_order: order++,
        });
      }
    });

    // 提取文本段落
    const paragraphs = (content || '').split(/\n\n+/).filter(p => p.trim().length > 20);
    paragraphs.slice(0, 20).forEach(para => {
      blocks.push({
        item_id: itemId,
        block_type: 'text',
        content: para.trim(),
        display_order: order++,
      });
    });

    // 批量插入
    const db = await openKBDB();
    try {
      const tx = db.transaction('kb_item_blocks', 'readwrite');
      const store = tx.objectStore('kb_item_blocks');
      for (const block of blocks) {
        store.add(block);
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    } catch(e) {
      db.close();
      throw e;
    }

    // 更新条目的 image_urls 和 word_count
    try {
      await KBItem.update(itemId, {
        image_urls: blocks.filter(b => b.block_type === 'image').map(b => b.content),
        word_count: content.length,
        content_summary: content.substring(0, 500),
      });
    } catch(e) { /* non-critical */ }
  },

  async getByItem(itemId) {
    const all = await _dbGetAll('kb_item_blocks', 200, 0, 'item_id');
    return all.filter(b => b.item_id === itemId).sort((a, b) => a.display_order - b.display_order);
  }
};

// ============================================================
// 3. FTS 倒排索引（模拟 FTS5 trigram + 中文分词）
// ============================================================
const KBIndex = {
  /**
   * 简易中文分词 + trigram 索引
   */
  _tokenize(text) {
    if (!text) return [];
    const tokens = new Set();
    const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    
    // 中文：逐字 bigram（模拟分词）
    const cnChars = cleaned.match(/[\u4e00-\u9fa5]+/g);
    if (cnChars) {
      cnChars.forEach(word => {
        if (word.length >= 2) {
          for (let i = 0; i < word.length - 1; i++) {
            tokens.add(word.substring(i, i + 2));
          }
        }
        // 单字也保留
        if (word.length === 1) tokens.add(word);
      });
    }

    // 英文/数字：单词 + trigram
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    words.forEach(word => {
      if (/^[a-zA-Z0-9]+$/.test(word)) {
        tokens.add(word); // 完整单词
        // trigram
        if (word.length >= 3) {
          for (let i = 0; i <= word.length - 3; i++) {
            tokens.add(word.substring(i, i + 3));
          }
        }
      }
    });

    return [...tokens];
  },

  /**
   * 更新条目的搜索索引
   */
  async updateIndex(itemId, title, content, url) {
    const fullText = [title || '', content || '', url || ''].join(' ');
    const tokens = KBIndex._tokenize(fullText);
    
    const db = await openKBDB();
    try {
      const tx = db.transaction('kb_search_index', 'readwrite');
      const store = tx.objectStore('kb_search_index');
      
      for (const token of tokens) {
        const existing = await new Promise(resolve => {
          const req = store.get(token);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
        
        if (existing) {
          const ids = existing.item_ids || [];
          if (!ids.includes(itemId)) {
            ids.push(itemId);
            store.put({ term: token, item_ids: ids.slice(0, 10000) });
          }
        } else {
          store.put({ term: token, item_ids: [itemId] });
        }
      }
      
      await new Promise((resolve) => { tx.oncomplete = () => resolve(); });
      db.close();
    } catch(e) {
      db.close();
      throw e;
    }
  },

  /**
   * FTS 搜索
   */
  async search(query, limit = 20) {
    if (!query || query.trim().length < 2) return [];
    
    const tokens = KBIndex._tokenize(query);
    if (tokens.length === 0) return [];
    
    const db = await openKBDB();
    try {
      const store = db.transaction('kb_search_index', 'readonly').objectStore('kb_search_index');
      
      // 对每个 token 查找匹配的 item_ids
      const itemScores = new Map();
      for (const token of tokens) {
        const entry = await new Promise(resolve => {
          const req = store.get(token);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
        if (entry && entry.item_ids) {
          entry.item_ids.forEach(itemId => {
            itemScores.set(itemId, (itemScores.get(itemId) || 0) + 1);
          });
        }
      }

      // 按分数排序
      const sorted = [...itemScores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

      // 获取完整条目
      const results = [];
      for (const [itemId, score] of sorted) {
        const item = await _dbGet('kb_items', itemId);
        if (item) {
          results.push({
            ...item,
            _score: score,
            _store: 'kb_items',
            preview: (item.content || '').substring(0, 200),
          });
        }
      }

      db.close();
      return results;
    } catch(e) {
      db.close();
      return [];
    }
  },

  /**
   * 删除条目的索引
   */
  async removeFromIndex(itemId) {
    const db = await openKBDB();
    try {
      const store = db.transaction('kb_search_index', 'readwrite').objectStore('kb_search_index');
      const allTerms = await new Promise(resolve => {
        const results = [];
        store.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) { resolve(results); return; }
          results.push(cursor.value);
          cursor.continue();
        };
      });
      
      for (const entry of allTerms) {
        if (entry.item_ids && entry.item_ids.includes(itemId)) {
          const newIds = entry.item_ids.filter(id => id !== itemId);
          if (newIds.length > 0) {
            store.put({ term: entry.term, item_ids: newIds });
          } else {
            store.delete(entry.term);
          }
        }
      }
      
      await new Promise(resolve => { db.transaction; setTimeout(resolve, 100); });
      db.close();
    } catch(e) {
      db.close();
    }
  }
};

// ============================================================
// 4. 高亮批注系统（借鉴 EC Highlight）
// ============================================================
const KBHighlight = {
  async create(data) {
    const record = {
      item_id: data.item_id,
      color: data.color || 'yellow', // yellow | green | blue | red
      text: data.text || '',
      selector_path: data.selector_path || '',
      start_text_node_index: data.start_text_node_index || 0,
      start_offset: data.start_offset || 0,
      end_selector_path: data.end_selector_path || '',
      end_text_node_index: data.end_text_node_index || 0,
      end_offset: data.end_offset || 0,
      context_before: data.context_before || '',
      context_after: data.context_after || '',
      page_note_id: data.page_note_id || null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    return await _dbAdd('kb_highlights', record);
  },

  async getByItem(itemId) {
    const all = await _dbGetAll('kb_highlights', 500, 0, 'item_id');
    return all.filter(h => h.item_id === itemId);
  },

  async update(id, updates) {
    const existing = await _dbGet('kb_highlights', id);
    if (!existing) throw new Error('高亮不存在');
    const updated = { ...existing, ...updates, id: existing.id, updated_at: Date.now() };
    await _dbPut('kb_highlights', updated);
    return updated;
  },

  async delete(id) {
    await _dbDelete('kb_highlights', id);
  }
};

// ============================================================
// 5. 页面笔记系统（借鉴 EC ItemPageNote）
// ============================================================
const KBPageNote = {
  async create(data) {
    const record = {
      item_id: data.item_id,
      conversation_id: data.conversation_id || null,
      ai_message_index: data.ai_message_index || null,
      title: data.title || `笔记 ${new Date().toLocaleString('zh-CN')}`,
      content: data.content || '',
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    return await _dbAdd('kb_page_notes', record);
  },

  async getByItem(itemId) {
    const all = await _dbGetAll('kb_page_notes', 200, 0, 'item_id');
    return all.filter(n => n.item_id === itemId);
  },

  async update(id, updates) {
    const existing = await _dbGet('kb_page_notes', id);
    if (!existing) throw new Error('笔记不存在');
    const updated = { ...existing, ...updates, id: existing.id, updated_at: Date.now() };
    await _dbPut('kb_page_notes', updated);
    return updated;
  },

  async delete(id) {
    await _dbDelete('kb_page_notes', id);
  }
};

// ============================================================
// 6. 标签系统（借鉴 EC Tag + ItemTagLink）
// ============================================================
const KBTag = {
  async create(name, color = null) {
    const existing = await KBTag.getByName(name);
    if (existing) return existing.id;
    const record = {
      name,
      color: color || KBTag._randomColor(),
      created_at: Date.now(),
    };
    return await _dbAdd('kb_tags', record);
  },

  async getByName(name) {
    const all = await _dbGetAll('kb_tags', 500);
    return all.find(t => t.name === name) || null;
  },

  async getAll() {
    return await _dbGetAll('kb_tags', 200);
  },

  async linkItem(itemId, tagId, source = 'manual') {
    try {
      await _dbAdd('kb_item_tag_links', { item_id: itemId, tag_id: tagId, source, created_at: Date.now() });
      
      // 更新条目的 tag_ids
      const item = await KBItem.get(itemId);
      if (item) {
        const tagIds = [...(item.tag_ids || []), tagId];
        await KBItem.update(itemId, { tag_ids: [...new Set(tagIds)] });
      }
    } catch(e) {
      // 忽略重复关联错误
    }
  },

  async unlinkItem(itemId, tagId) {
    await _dbDelete('kb_item_tag_links', [itemId, tagId]);
    const item = await KBItem.get(itemId);
    if (item) {
      await KBItem.update(itemId, { tag_ids: (item.tag_ids || []).filter(id => id !== tagId) });
    }
  },

  async getItemTags(itemId) {
    const allLinks = await _dbGetAll('kb_item_tag_links', 500, 0, 'item_id');
    const links = allLinks.filter(l => l.item_id === itemId);
    const tags = [];
    for (const link of links) {
      const tag = await _dbGet('kb_tags', link.tag_id);
      if (tag) {
        tags.push({ ...tag, source: link.source });
      }
    }
    return tags;
  },

  async getItemsByTag(tagId, limit = 50) {
    const allLinks = await _dbGetAll('kb_item_tag_links', 5000, 0, 'tag_id');
    const itemIds = allLinks.filter(l => l.tag_id === tagId).map(l => l.item_id);
    const items = [];
    for (const id of itemIds.slice(0, limit)) {
      const item = await KBItem.get(id);
      if (item) items.push(item);
    }
    return items;
  },

  async delete(id) {
    // 删除关联
    const allLinks = await _dbGetAll('kb_item_tag_links', 5000, 0, 'tag_id');
    for (const link of allLinks.filter(l => l.tag_id === id)) {
      await _dbDelete('kb_item_tag_links', [link.item_id, link.tag_id]);
    }
    await _dbDelete('kb_tags', id);
  },

  _randomColor() {
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
};

// ============================================================
// 7. AI 对话持久化（借鉴 EC AiConversation）
// ============================================================
const KBAiConversation = {
  async create(data) {
    const record = {
      title: data.title || `对话 ${new Date().toLocaleString('zh-CN')}`,
      mode: data.mode || 'chat', // chat | ask | agent
      scope: data.scope || 'main', // main | item
      item_id: data.item_id || null,
      messages_json: JSON.stringify(data.messages || []),
      search_text: (data.messages || []).map(m => m.content).join(' ').substring(0, 5000),
      last_message_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    return await _dbAdd('kb_ai_conversations', record);
  },

  async update(id, messages, title = null) {
    const existing = await _dbGet('kb_ai_conversations', id);
    if (!existing) throw new Error('对话不存在');
    const updated = {
      ...existing,
      id: existing.id,
      messages_json: JSON.stringify(messages),
      search_text: messages.map(m => m.content).join(' ').substring(0, 5000),
      last_message_at: Date.now(),
      updated_at: Date.now(),
      title: title || existing.title,
    };
    await _dbPut('kb_ai_conversations', updated);
    return updated;
  },

  async get(id) {
    const conv = await _dbGet('kb_ai_conversations', id);
    if (conv) {
      conv.messages = JSON.parse(conv.messages_json || '[]');
    }
    return conv;
  },

  async getAll(limit = 50) {
    const convs = await _dbGetAll('kb_ai_conversations', limit, 0, 'last_message_at', 'prev');
    return convs.map(c => ({
      ...c,
      messages: JSON.parse(c.messages_json || '[]'),
      message_count: JSON.parse(c.messages_json || '[]').length,
    }));
  },

  async getByItem(itemId) {
    const all = await _dbGetAll('kb_ai_conversations', 100, 0, 'item_id');
    return all.filter(c => c.item_id === itemId);
  },

  async delete(id) {
    await _dbDelete('kb_ai_conversations', id);
  }
};

// ============================================================
// 8. AI 记忆系统（借鉴 EC AiMemory）
// ============================================================
const KBAiMemory = {
  async remember(type, content) {
    const record = {
      type, // learned | preference | correction
      content,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    return await _dbAdd('kb_ai_memories', record);
  },

  async recall(query = null, limit = 5) {
    const all = await _dbGetAll('kb_ai_memories', 100);
    if (!query) return all.slice(0, limit);
    const keyword = query.toLowerCase();
    return all
      .filter(m => m.content.toLowerCase().includes(keyword))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit);
  },

  async forget(id) {
    await _dbDelete('kb_ai_memories', id);
  }
};

// ============================================================
// 9. 知识图谱引擎
// ============================================================
const KBGraph = {
  /**
   * 基于标签共现构建知识图谱
   */
  async buildGraph() {
    const nodes = [];
    const edges = [];
    const nodeIds = new Set();
    
    // 获取所有带标签的条目
    const allLinks = await _dbGetAll('kb_item_tag_links', 5000);
    const allItems = await _dbGetAll('kb_items', 500);
    
    // 构建节点
    for (const item of allItems) {
      if (nodeIds.has(item.id)) continue;
      nodeIds.add(item.id);
      
      const tags = await KBTag.getItemTags(item.id);
      nodes.push({
        id: item.id,
        title: item.title || '未命名',
        source_type: item.source_type || 'page',
        url: item.url || '',
        tag_ids: tags.map(t => t.id),
        tag_names: tags.map(t => t.name),
        created_at: item.timestamp,
        media_url: item.image_urls && item.image_urls.length > 0 ? item.image_urls[0] : null,
      });
    }

    // 基于标签共现构建边
    const tagToItems = new Map();
    for (const link of allLinks) {
      if (!tagToItems.has(link.tag_id)) tagToItems.set(link.tag_id, new Set());
      tagToItems.get(link.tag_id).add(link.item_id);
    }

    const edgeSet = new Set();
    for (const [, itemIds] of tagToItems) {
      const items = [...itemIds];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const key = [items[i], items[j]].sort().join('::');
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({
              source: items[i],
              target: items[j],
              score: 1,
            });
          }
        }
      }
    }

    // 基于 URL 域名共现补充边
    const domainToItems = new Map();
    for (const item of allItems) {
      if (!item.url) continue;
      try {
        const domain = new URL(item.url).hostname;
        if (!domainToItems.has(domain)) domainToItems.set(domain, new Set());
        domainToItems.get(domain).add(item.id);
      } catch(e) {}
    }

    for (const [, itemIds] of domainToItems) {
      const items = [...itemIds];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const key = [items[i], items[j]].sort().join('::');
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({
              source: items[i],
              target: items[j],
              score: 0.5,
            });
          }
        }
      }
    }

    return {
      nodes,
      edges,
      node_count: nodes.length,
      edge_count: edges.length,
    };
  },

  /**
   * 获取与某个条目相关的条目（用于"相关推荐"）
   */
  async getRelated(itemId, limit = 5) {
    const graph = await KBGraph.buildGraph();
    const relatedEdges = graph.edges.filter(e => e.source === itemId || e.target === itemId);
    const relatedIds = relatedEdges.map(e => e.source === itemId ? e.target : e.source);
    
    const results = [];
    for (const id of [...new Set(relatedIds)].slice(0, limit)) {
      const item = await KBItem.get(id);
      if (item) {
        results.push({
          ...item,
          preview: (item.content || '').substring(0, 200),
        });
      }
    }
    return results;
  }
};

// ============================================================
// 10. 数据迁移（从旧版 DB 到新版 KB）
// ============================================================
async function migrateFromOldDB() {
  try {
    // 检查是否已经迁移
    const count = await _dbCount('kb_items');
    if (count > 0) {
      console.log('[无极 KB] 数据已存在，跳过迁移');
      return;
    }

    console.log('[无极 KB] 开始从旧版数据库迁移...');
    const oldDB = await new Promise((resolve, reject) => {
      const req = indexedDB.open('AIBrowserDB', 2);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });

    try {
      // 迁移 kb_pages
      if (oldDB.objectStoreNames.contains('kb_pages')) {
        const oldPages = await new Promise(resolve => {
          const tx = oldDB.transaction('kb_pages', 'readonly');
          const req = tx.objectStore('kb_pages').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve([]);
        });

        for (const page of oldPages) {
          await KBItem.save({
            url: page.url || '',
            title: page.title || '未命名',
            content: page.content || '',
            source_type: 'page',
            timestamp: page.timestamp || Date.now(),
          });
        }
        console.log(`[无极 KB] 迁移了 ${oldPages.length} 个页面`);
      }

      // 迁移 kb_chats
      if (oldDB.objectStoreNames.contains('kb_chats')) {
        const oldChats = await new Promise(resolve => {
          const tx = oldDB.transaction('kb_chats', 'readonly');
          const req = tx.objectStore('kb_chats').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve([]);
        });

        for (const chat of oldChats) {
          const messages = chat.messages || [];
          await KBAiConversation.create({
            title: chat.pageTitle || '旧对话',
            mode: 'chat',
            scope: 'main',
            messages: messages.map(m => ({ role: m.role || 'user', content: m.content || '' })),
          });
        }
        console.log(`[无极 KB] 迁移了 ${oldChats.length} 个对话`);
      }

      // 迁移 kb_files
      if (oldDB.objectStoreNames.contains('kb_files')) {
        const oldFiles = await new Promise(resolve => {
          const tx = oldDB.transaction('kb_files', 'readonly');
          const req = tx.objectStore('kb_files').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve([]);
        });

        for (const file of oldFiles) {
          await KBItem.save({
            url: '',
            title: file.name || '未命名文件',
            content: file.content || '',
            source_type: 'file',
            timestamp: file.timestamp || Date.now(),
          });
        }
        console.log(`[无极 KB] 迁移了 ${oldFiles.length} 个文件`);
      }
    } finally {
      oldDB.close();
    }

    console.log('[无极 KB] 数据迁移完成');
  } catch(e) {
    console.error('[无极 KB] 迁移失败:', e);
  }
}

// ============================================================
// 初始化
// ============================================================
async function initKBEngine() {
  try {
    await initKB();
    await migrateFromOldDB();
    console.log('[无极 KB] 知识库引擎初始化完成');
    return true;
  } catch(e) {
    console.error('[无极 KB] 初始化失败:', e);
    return false;
  }
}

// 导出为全局变量（Service Worker 中可用）
if (typeof self !== 'undefined') {
  self.KBItem = KBItem;
  self.KBBlock = KBBlock;
  self.KBIndex = KBIndex;
  self.KBHighlight = KBHighlight;
  self.KBPageNote = KBPageNote;
  self.KBTag = KBTag;
  self.KBAiConversation = KBAiConversation;
  self.KBAiMemory = KBAiMemory;
  self.KBGraph = KBGraph;
  self.initKBEngine = initKBEngine;
}