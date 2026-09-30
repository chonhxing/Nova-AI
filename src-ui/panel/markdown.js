/**
 * 无极 — 面板 Markdown 渲染
 * 从 libs/content.js 原样移植（本回合 Read 核对过原文）：
 *   esc()                 ← content.js:1284
 *   escHtml()             ← content.js:1289-1291
 *   safeHref()            ← content.js:1294-1297
 *   renderMarkdown()      ← content.js:1302-1319
 *   cleanToolCallsFromText() ← content.js:1035-1043
 * 安全策略与原实现一致：先整体 HTML 转义再套 Markdown 语法；链接只允许 http/https。
 */

// content.js:1284 原样（KB 列表等纯文本转义）
export function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// content.js:1289-1291 原样
export function escHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// content.js:1294-1297 原样 —— 链接只允许 http/https，杜绝 javascript: 等协议注入
export function safeHref(href) {
  const h = String(href || '').trim();
  return /^https?:\/\//i.test(h) ? escHtml(h) : '#';
}

// ============================================================
// Markdown 渲染（content.js:1300-1319 原样：先整体 HTML 转义，再套 Markdown 语法）
// ============================================================
export function renderMarkdown(text) {
  let h = escHtml(text);
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^# (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${safeHref(href)}" target="_blank" style="color:var(--accent)">${label}</a>`);
  h = h.replace(/^- (.+)$/gm, '<li>$1</li>');
  h = h.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^---$/gm, '<hr>');
  h = h.replace(/\n\n/g, '<br><br>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

/**
 * 从流式文本中剥离工具调用 JSON 及其 markdown 代码块包裹。
 * 多轮工具调用下，第一轮的 {"tool":...} 不应显示在最终答案里。
 * 保留 > 🔧 工具状态行（blockquote）和正常文本。
 *
 * v3.7.1 修复：原正则 \{"tool"...[\s\S]*?\}\s*\} 懒匹配到"第一个 }}",
 * 当 params 里是含花括号的 JS 代码（如 console_eval 的表达式）时会提前
 * 截断，尾部残片（如 `)(Date.now())"}}`）漏进正文。改为花括号配对扫描：
 * 正确处理嵌套对象与字符串内的引号/转义。
 */

// 花括号配对扫描：返回 s 中所有顶层 {"tool"...} 片段被移除后的文本；
// 未闭合的 {"tool" 连同其后内容一并隐藏（流式期间工具 JSON 尚未收完时不应露出）
function stripToolJsonSpans(s) {
  let result = '';
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{"tool"', i);
    if (start < 0) { result += s.slice(i); break; }
    result += s.slice(i, start);
    let depth = 0, k = start, inStr = false, esc = false, end = -1;
    for (; k < s.length; k++) {
      const c = s[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) { end = k + 1; break; }
      }
    }
    if (end < 0) break;   // 未闭合：隐藏剩余（闭合后由下一轮 delta 完整剥离）
    i = end;
  }
  return result;
}

export function cleanToolCallsFromText(text) {
  // 1. 剥离包裹工具 JSON 的 markdown 代码块：```json\n{...}\n``` 或 ```\n{...}\n```
  let out = text.replace(/```(?:json)?\s*\n?\s*\{"tool"[\s\S]*?\n?\s*```/g, '');
  // 2. 剥离裸露的工具调用 JSON（花括号配对扫描，兼容 params 内含嵌套花括号）
  out = stripToolJsonSpans(out);
  // 3. 清理多余空行
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out || text; // 若清理后为空（极端情况），返回原文
}
