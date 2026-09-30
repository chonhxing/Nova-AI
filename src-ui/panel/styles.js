/**
 * 无极 — 面板样式（字符串模块）
 * CHAT_STYLES：从 libs/content.js:154-479 原样移植（light-dark() 配色 +
 * color-scheme 主题系统不变；随宿主 colorScheme 切换浅/深色）。
 * 变更点仅两处：
 *   1. 移除尾部 legacy status-bar 规则（对应的旧 DOM 已不存在）；
 *   2. 其余逐字保留 —— Vue 模板沿用同一套类名。
 * DANMAKU_STYLES：弹幕管理面板（ libs/danmaku-player.js showDanmakuPanel 的
 * 内联样式移植，类名规范化为 wdm-*，深色面板定位不变）。
 * 样式经 adoptedStyleSheets 注入 ShadowRoot（构建为 IIFE 时不产生独立 CSS 产物）。
 */

export const CHAT_STYLES = `
  :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :host {
    /* —— 色彩系统：克制、单一强调色 —— */
    --bg-primary: light-dark(#ffffff, #1a1a21);
    --bg-canvas: light-dark(#fbfbfd, #131318);
    --bg-soft: light-dark(#f5f6f8, #232331);
    --bg-input: light-dark(#f4f4f6, #262632);
    --text-primary: light-dark(#0d0d12, #f0f0f5);
    --text-secondary: light-dark(#565869, #a7a9b8);
    --text-tertiary: light-dark(#9b9ba7, #74768a);
    --text-faint: light-dark(#c8c8d0, #4a4b5c);
    --accent: light-dark(#6366f1, #818cf8);
    --accent-hover: light-dark(#4f46e5, #a5b4fc);
    --accent-soft: light-dark(rgba(99,102,241,0.07), rgba(129,140,248,0.14));
    --accent-line: light-dark(rgba(99,102,241,0.18), rgba(129,140,248,0.3));
    --border: light-dark(rgba(20,20,40,0.07), rgba(255,255,255,0.09));
    --border-strong: light-dark(rgba(20,20,40,0.12), rgba(255,255,255,0.16));
    --danger: light-dark(#ef4444, #f87171);
    --success: light-dark(#22c55e, #34d399);
    --radius-sm: 8px;
    --radius: 14px;
    --radius-lg: 20px;
    --radius-xl: 26px;
    --shadow-sm: light-dark(0 1px 2px rgba(20,20,40,0.04), 0 1px 2px rgba(0,0,0,0.4));
    --shadow-md: light-dark(0 6px 24px rgba(20,20,40,0.08), 0 6px 24px rgba(0,0,0,0.5));
    --shadow-lg: light-dark(0 18px 50px rgba(20,20,40,0.14), 0 18px 50px rgba(0,0,0,0.55));
    --shadow-accent: 0 8px 24px rgba(99,102,241,0.28);
    --t: 0.18s cubic-bezier(0.4,0,0.2,1);
    --t-slow: 0.32s cubic-bezier(0.16,1,0.3,1);
    /* 主题：light-dark() 配色随 color-scheme 解析；
       auto='light dark' 跟随系统，浅/深色由 JS 直接改 host 的 color-scheme */
    color-scheme: light dark;
  }

  /* AI 气泡底色：浅色用纯白卡片、深色压一档（随 color-scheme 自动切换） */
  .bubble-block.ai-block .msg-bubble { background: light-dark(#ffffff, #232331); }

  /* —— 面板容器：浮起、大圆角、轻盈阴影 —— */
  .panel {
    width: 440px; height: 620px; display: flex; flex-direction: column;
    background: var(--bg-primary); border-radius: var(--radius-xl);
    box-shadow: var(--shadow-lg); overflow: hidden; position: relative;
    animation: panelIn 0.32s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes panelIn { 0% { opacity: 0; transform: translateY(12px) scale(0.97); } 100% { opacity: 1; transform: translateY(0) scale(1); } }

  /* —— 顶栏：极简、无边框、悬浮高亮 —— */
  .top-bar {
    display: flex; align-items: center; gap: 4px; padding: 14px 16px 10px;
    background: var(--bg-primary); cursor: move; flex-shrink: 0; user-select: none;
  }
  .top-bar .brand { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; }
  .top-bar .brand-mark {
    width: 26px; height: 26px; border-radius: 8px; flex-shrink: 0;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 3px 10px rgba(99,102,241,0.32);
  }
  .top-bar .brand-mark svg { width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .top-bar .title { font-size: 14.5px; font-weight: 620; color: var(--text-primary); letter-spacing: -0.3px; }
  .top-bar .title .ver { font-size: 10px; font-weight: 550; color: var(--text-tertiary); margin-left: 5px; vertical-align: 1px; }
  .icon-btn {
    width: 30px; height: 30px; border-radius: 9px; border: none;
    background: transparent; cursor: pointer; display: flex;
    align-items: center; justify-content: center; transition: all var(--t); flex-shrink: 0;
  }
  .icon-btn:hover { background: var(--bg-soft); }
  .icon-btn:hover svg { stroke: var(--accent); }
  .icon-btn svg { width: 16px; height: 16px; stroke: var(--text-tertiary); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--t); }
  .icon-btn--circle {
    width: 26px; height: 26px; border-radius: 50%;
    border: 1.5px solid var(--border); opacity: 0.6;
  }
  .icon-btn--circle:hover { border-color: var(--accent-line); opacity: 1; background: var(--accent-soft); }
  .icon-btn--circle:hover svg { stroke: var(--accent); }
  .icon-btn--circle svg { width: 13px; height: 13px; }

  /* —— 标签栏：胶囊式分段控件 —— */
  .tab-bar {
    display: flex; gap: 3px; padding: 0 14px 10px; background: var(--bg-primary);
    flex-shrink: 0;
  }
  .tab-btn {
    flex: 1; padding: 7px 0; border: none; border-radius: 9px; background: transparent;
    font-size: 12px; font-weight: 560; color: var(--text-tertiary); cursor: pointer;
    transition: all var(--t); font-family: inherit; letter-spacing: -0.1px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .tab-btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .tab-btn:hover { color: var(--text-secondary); background: var(--bg-soft); }
  .tab-btn.active { color: var(--accent); background: var(--accent-soft); }

  /* —— 消息区：大留白、纯净 —— */
  .message-area {
    flex: 1; overflow-y: auto; padding: 18px 16px 10px; display: flex; flex-direction: column; gap: 22px;
    background: var(--bg-canvas); scroll-behavior: smooth;
  }
  .message-area::-webkit-scrollbar { width: 5px; }
  .message-area::-webkit-scrollbar-track { background: transparent; }
  .message-area::-webkit-scrollbar-thumb { background: var(--text-faint); border-radius: 20px; }
  .message-area::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }

  /* —— 空状态 —— */
  .empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 20px 16px; gap: 6px; text-align: center;
    animation: fadeIn 0.4s ease-out;
  }
  @keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
  .empty-state .orb {
    width: 52px; height: 52px; border-radius: 16px; margin-bottom: 14px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 10px 30px rgba(99,102,241,0.35); position: relative;
    animation: orbPulse 3.2s ease-in-out infinite;
  }
  .empty-state .orb::after {
    content: ''; position: absolute; inset: -4px; border-radius: 20px;
    background: linear-gradient(135deg, #6366f1, #d946ef); opacity: 0.25; z-index: -1;
    filter: blur(14px); animation: orbPulse 3.2s ease-in-out infinite;
  }
  @keyframes orbPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
  .empty-state .orb svg { width: 26px; height: 26px; stroke: #fff; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .empty-state .title { font-size: 19px; font-weight: 650; color: var(--text-primary); letter-spacing: -0.4px; }
  .empty-state .subtitle { font-size: 12.5px; color: var(--text-tertiary); margin-bottom: 18px; line-height: 1.5; }
  .empty-state .suggestions { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 320px; }
  .empty-state .suggestion {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 14px;
    border-radius: var(--radius); background: var(--bg-primary); border: 1px solid var(--border);
    cursor: pointer; transition: all var(--t); text-align: left; font-family: inherit;
    font-size: 12.5px; color: var(--text-secondary);
  }
  .empty-state .suggestion:hover { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
  .empty-state .suggestion .s-ico { width: 28px; height: 28px; border-radius: 8px; background: var(--bg-soft); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all var(--t); }
  .empty-state .suggestion:hover .s-ico { background: var(--accent-soft); }
  .empty-state .suggestion .s-ico svg { width: 14px; height: 14px; stroke: var(--text-tertiary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--t); }
  .empty-state .suggestion:hover .s-ico svg { stroke: var(--accent); }
  .empty-state .suggestion .s-txt { flex: 1; line-height: 1.4; }
  .empty-state .suggestion .s-txt b { display: block; font-size: 12.5px; font-weight: 600; color: var(--text-primary); margin-bottom: 1px; }
  .empty-state .suggestion:hover .s-txt b { color: var(--accent); }
  .empty-state .suggestion .s-txt span { font-size: 11px; color: var(--text-tertiary); }

  /* —— 消息行 —— */
  .msg-row { display: flex; gap: 11px; max-width: 94%; animation: msgIn 0.28s cubic-bezier(0.16,1,0.3,1); align-items: flex-start; }
  @keyframes msgIn { 0% { opacity: 0; transform: translateY(6px); } 100% { opacity: 1; transform: translateY(0); } }
  .msg-row.user { align-self: flex-end; flex-direction: row-reverse; max-width: 82%; }
  .msg-row.ai { align-self: stretch; max-width: 92%; }
  .msg-row.system { align-self: center; max-width: 88%; }

  /* 头像 */
  .msg-avatar {
    width: 28px; height: 28px; border-radius: 9px; flex-shrink: 0; margin-top: 2px;
    display: flex; align-items: center; justify-content: center; user-select: none;
  }
  .msg-avatar.ai-avatar { background: linear-gradient(135deg, #6366f1, #8b5cf6); box-shadow: 0 3px 8px rgba(99,102,241,0.28); }
  .msg-avatar.ai-avatar svg { width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .msg-avatar.user-avatar { background: var(--bg-soft); }
  .msg-avatar.user-avatar svg { width: 14px; height: 14px; stroke: var(--text-secondary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .msg-avatar.sys-avatar { background: transparent; }
  .msg-avatar.sys-avatar svg { width: 14px; height: 14px; stroke: var(--text-tertiary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  /* 气泡块 */
  .bubble-block { display: flex; flex-direction: column; min-width: 0; }
  .msg-bubble {
    padding: 11px 15px; border-radius: var(--radius); font-size: 13.5px; line-height: 1.68;
    word-break: break-word;
  }
  /* 用户：实心渐变气泡 */
  .bubble-block.user-block .msg-bubble {
    background: linear-gradient(135deg, #6366f1, #7c3aed); color: #fff;
    border-bottom-right-radius: 6px; box-shadow: var(--shadow-accent);
  }
  /* AI：轻量卡片（极淡背景+左边框），既轻盈又有清晰边界 */
  .bubble-block.ai-block .msg-bubble {
    background: var(--bg-primary); color: var(--text-primary);
    padding: 12px 15px; border-radius: var(--radius);
    border: 1px solid var(--border); border-left: 3px solid var(--accent-line);
    font-size: 14px; line-height: 1.72; box-shadow: var(--shadow-sm);
  }
  /* 系统：细线条提示卡 */
  .bubble-block.system-block .msg-bubble {
    background: var(--bg-soft); color: var(--text-secondary);
    border-radius: var(--radius-sm); font-size: 12px; padding: 8px 12px;
    border: 1px solid var(--border); line-height: 1.55;
  }
  .bubble-block.system-block { align-items: center; }
  .bubble-block.system-block .msg-avatar { display: none; }
  .msg-row.system { gap: 0; }

  /* 时间行 */
  .msg-time-row {
    display: flex; align-items: center; gap: 6px; margin-top: 5px;
    font-size: 10px; color: var(--text-faint); letter-spacing: 0.3px; padding: 0 3px;
  }
  .bubble-block.user-block .msg-time-row { justify-content: flex-end; }
  .bubble-block.ai-block .msg-time-row { padding: 0 2px; margin-top: 3px; }

  /* 打字指示器 */
  .typing-dots { display: flex; align-items: center; gap: 5px; padding: 6px 2px;
    transition: opacity 0.35s ease, transform 0.35s ease; }
  .typing-dots.hiding { opacity: 0; transform: translateY(-4px) scale(0.95); }
  .typing-dots span { display: block; width: 7px; height: 7px; background: var(--text-faint); border-radius: 50%; animation: dotBounce 1.4s infinite both; }
  .typing-dots span:nth-child(2) { animation-delay: 0.18s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes dotBounce { 0%,60%,100%{transform:translateY(0);opacity:0.35} 30%{transform:translateY(-5px);opacity:1} }

  /* 流式内容气泡入场 */
  .stream-entering { opacity: 0; transform: translateY(6px); }
  .stream-active { opacity: 1; transform: translateY(0); transition: opacity 0.3s ease, transform 0.3s ease; }

  /* 流式光标 */
  .stream-cursor { display: inline-block; width: 2px; height: 1em; vertical-align: -1px; margin-left: 1px;
    background: var(--accent); border-radius: 1px; animation: cursorPulse 0.8s steps(2) infinite; }
  @keyframes cursorPulse { 50% { opacity: 0; } }
  .stream-cursor.done { animation: cursorFade 0.4s ease forwards; }
  @keyframes cursorFade { to { opacity: 0; } }

  /* —— Markdown 渲染 —— */
  .md { font-size: 14px; line-height: 1.72; color: var(--text-primary); }
  .md > *:first-child { margin-top: 0; }
  .md > *:last-child { margin-bottom: 0; }
  .md p { margin: 7px 0; }
  .md strong { color: var(--text-primary); font-weight: 660; }
  .md em { color: var(--text-secondary); }
  .md h1, .md h2, .md h3 { margin: 14px 0 7px; font-weight: 640; letter-spacing: -0.3px; color: var(--text-primary); }
  .md h1 { font-size: 16px; } .md h2 { font-size: 15px; } .md h3 { font-size: 14px; }
  .md ul, .md ol { margin: 7px 0; padding-left: 20px; }
  .md li { margin: 3px 0; }
  .md li::marker { color: var(--accent); }
  .md code { background: var(--bg-soft); padding: 1.5px 6px; border-radius: 5px; font-size: 12.5px; font-family: 'SF Mono','JetBrains Mono','Fira Code',monospace; color: var(--accent); }
  .md pre {
    background: #1e1e2e; color: #e4e4ef; padding: 13px 15px; border-radius: var(--radius);
    overflow-x: auto; margin: 10px 0; font-size: 12.5px; line-height: 1.6;
    font-family: 'SF Mono','JetBrains Mono','Fira Code',monospace; position: relative;
  }
  .md pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
  .md blockquote { border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; color: var(--text-secondary); background: var(--accent-soft); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; font-size: 12.5px; }
  .md blockquote p { margin: 3px 0; }
  .md a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-line); }
  .md a:hover { border-bottom-color: var(--accent); }
  .md hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
  .md table { width: 100%; border-collapse: collapse; margin: 9px 0; font-size: 12px; border-radius: var(--radius-sm); overflow: hidden; }
  .md th { background: var(--bg-soft); padding: 7px 10px; text-align: left; font-weight: 620; color: var(--text-primary); border-bottom: 1px solid var(--border-strong); }
  .md td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--text-secondary); }
  .md tr:last-child td { border-bottom: none; }

  /* —— 输入栏：浮起大圆角 —— */
  .input-bar {
    display: flex; flex-direction: column; gap: 6px; padding: 8px 14px 12px;
    background: var(--bg-primary); flex-shrink: 0;
  }
  .input-pill {
    display: flex; align-items: flex-end; gap: 4px; background: var(--bg-input);
    border-radius: var(--radius-lg); padding: 6px 6px 6px 8px;
    border: 1.5px solid transparent; transition: all var(--t);
  }
  .input-pill:focus-within { background: var(--bg-primary); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }

  /* —— 快捷操作栏（输入栏上方）—— */
  .action-bar {
    display: flex; align-items: center; gap: 6px; padding: 4px 14px 0;
    background: var(--bg-primary); flex-shrink: 0;
  }
  .action-btn {
    display: flex; align-items: center; gap: 5px;
    height: 30px; padding: 4px 12px; border-radius: 8px;
    border: 1px solid var(--border); background: transparent;
    cursor: pointer; transition: all var(--t); color: var(--text-tertiary);
    font-size: 12px; font-family: inherit;
  }
  .action-btn:hover { background: var(--bg-soft); color: var(--accent); border-color: var(--accent-line); }
  .action-btn svg { width: 14px; height: 14px; stroke: var(--text-tertiary); fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: stroke var(--t); flex-shrink: 0; }
  .action-btn:hover svg { stroke: var(--accent); }
  .action-label { white-space: nowrap; }
  .input-pill textarea {
    flex: 1; min-height: 24px; max-height: 120px; padding: 6px 4px;
    border: none; background: transparent; color: var(--text-primary); font-size: 13.5px;
    font-family: inherit; resize: none; outline: none; line-height: 1.5;
  }
  .input-pill textarea::placeholder { color: var(--text-tertiary); }
  .send-btn {
    width: 34px; height: 34px; border-radius: 11px; background: var(--accent);
    border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all var(--t); flex-shrink: 0; box-shadow: 0 3px 10px rgba(99,102,241,0.32);
  }
  .send-btn:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 5px 14px rgba(99,102,241,0.4); }
  .send-btn:active { transform: translateY(0); }
  .send-btn:disabled { background: var(--text-faint); cursor: not-allowed; box-shadow: none; transform: none; }
  .send-btn svg { width: 16px; height: 16px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }

  /* 输入栏底部状态行（取代独立 status-bar） */
  .input-hint { display: flex; align-items: center; gap: 5px; padding: 0 6px; font-size: 10px; color: var(--text-faint); min-height: 13px; }
  .input-hint .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0; transition: background var(--t); }
  .input-hint .status-dot.error { background: var(--danger); }
  .input-hint .status-dot.busy { background: var(--accent); animation: blink 1s steps(2) infinite; }
  .input-hint .kbd { font-size: 9px; padding: 1px 4px; border-radius: 4px; background: var(--bg-soft); color: var(--text-tertiary); border: 1px solid var(--border); margin-left: auto; }

  /* —— 知识库 —— */
  .kb-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-canvas); }
  .kb-search { padding: 10px 12px 6px; }
  .kb-search input { width: 100%; padding: 9px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-primary); color: var(--text-primary); font-size: 12.5px; font-family: inherit; outline: none; transition: all var(--t); }
  .kb-search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .kb-list { flex: 1; overflow-y: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 7px; }
  .kb-list::-webkit-scrollbar { width: 5px; }
  .kb-list::-webkit-scrollbar-thumb { background: var(--text-faint); border-radius: 10px; }
  .kb-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-tertiary); font-size: 12px; text-align: center; padding: 30px 18px; line-height: 1.7; }
  .kb-card { padding: 11px 14px; border-radius: var(--radius); background: var(--bg-primary); border: 1px solid var(--border); cursor: default; transition: all 0.16s; }
  .kb-card:hover { border-color: var(--accent-line); box-shadow: var(--shadow-sm); transform: translateY(-1px); }
  .kb-card-title { font-size: 12.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kb-card-url { font-size: 10.5px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .kb-card-preview { font-size: 11px; color: var(--text-secondary); margin-top: 4px; line-height: 1.45; max-height: 38px; overflow: hidden; }
  .kb-card-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; font-size: 10px; color: var(--text-tertiary); }
  .kb-card-type { padding: 2px 7px; border-radius: 6px; font-size: 9.5px; font-weight: 600; background: var(--accent-soft); color: var(--accent); }
  .kb-card-del { border: none; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 11px; padding: 3px 6px; border-radius: 5px; transition: all 0.14s; }
  .kb-card-del:hover { color: var(--danger); background: rgba(239,68,68,0.08); }
`;

// 弹幕管理面板样式（danmaku-player.js showDanmakuPanel 内联样式移植，深色定位不变）
export const DANMAKU_STYLES = `
  :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .wdm-panel {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
    pointer-events: auto; /* 宿主 pointer-events:none（不挡页面点击），面板自身可交互 */
    z-index: 2147483647; width: 420px; max-height: 70vh; background: rgba(0,0,0,0.92);
    border-radius: 16px; color: #e0e0e0; display: flex; flex-direction: column;
    font-size: 13px; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.1); overflow: hidden;
    animation: wdmIn 0.28s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes wdmIn { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.96); } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
  .wdm-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 15px; font-weight: 600; }
  .wdm-close { cursor: pointer; opacity: 0.6; font-size: 18px; line-height: 1; background: none; border: none; color: #fff; padding: 0 4px; }
  .wdm-close:hover { opacity: 1; }
  .wdm-body { padding: 16px 18px; overflow-y: auto; flex: 1; }
  .wdm-row { display: flex; gap: 8px; margin-bottom: 14px; }
  .wdm-row input { flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #fff; font-size: 13px; outline: none; font-family: inherit; }
  .wdm-row input:focus { border-color: #6366f1; }
  .wdm-btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; transition: all 0.15s; }
  .wdm-btn-primary { background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; }
  .wdm-btn-primary:hover { opacity: 0.9; }
  .wdm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .wdm-btn-danger { background: rgba(239,68,68,0.2); color: #ef4444; }
  .wdm-btn-danger:hover { background: rgba(239,68,68,0.35); }
  .wdm-btn-sm { padding: 5px 10px; font-size: 11px; border-radius: 6px; border: none; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .wdm-adv { margin-bottom: 10px; }
  .wdm-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #aaa; cursor: pointer; margin-bottom: 8px; user-select: none; }
  .wdm-check input { accent-color: #6366f1; }
  .wdm-adv input[type=text] { width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #fff; font-size: 11px; outline: none; font-family: inherit; }
  .wdm-adv input[type=text]:focus { border-color: #6366f1; }
  .wdm-status { text-align: center; color: #888; font-size: 12px; padding: 8px; white-space: pre-wrap; }
  .wdm-set { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .wdm-set-info { flex: 1; min-width: 0; }
  .wdm-set-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wdm-set-meta { font-size: 11px; color: #888; margin-top: 2px; }
  .wdm-set-actions { display: flex; gap: 6px; flex-shrink: 0; }
`;

// B站视频下载面板样式（与弹幕面板同一定位：深色悬浮面板）
export const BILI_STYLES = `
  :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .bili-panel {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
    pointer-events: auto; /* 宿主 pointer-events:none（不挡页面点击），面板自身可交互 */
    z-index: 2147483647; width: 440px; max-height: 76vh; background: rgba(0,0,0,0.92);
    border-radius: 16px; color: #e0e0e0; display: flex; flex-direction: column;
    font-size: 13px; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.1); overflow: hidden;
    animation: biliIn 0.28s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes biliIn { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.96); } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
  .bili-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 15px; font-weight: 600; flex-shrink: 0; }
  .bili-close { cursor: pointer; opacity: 0.6; font-size: 18px; line-height: 1; background: none; border: none; color: #fff; padding: 0 4px; }
  .bili-close:hover { opacity: 1; }
  .bili-body { padding: 14px 18px 16px; overflow-y: auto; flex: 1; }
  .bili-status { text-align: center; color: #888; font-size: 12px; padding: 14px 0; white-space: pre-wrap; }
  .bili-error { color: #f87171; }
  .bili-meta { margin-bottom: 10px; }
  .bili-vtitle { font-size: 14px; font-weight: 600; line-height: 1.5; }
  .bili-sub { font-size: 11px; color: #888; margin-top: 3px; }
  .bili-pages { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 6px; }
  .bili-page-chip { padding: 4px 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color: #aaa; font-size: 11px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .bili-page-chip:hover { border-color: #6366f1; color: #c7d2fe; }
  .bili-page-chip.active { background: rgba(99,102,241,0.3); border-color: #6366f1; color: #c7d2fe; font-weight: 600; }
  .bili-part-name { font-size: 11px; color: #888; margin-bottom: 8px; }
  .bili-sec { font-size: 11px; color: #888; padding: 10px 0 4px; border-top: 1px solid rgba(255,255,255,0.06); margin-top: 10px; }
  .bili-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .bili-row-info { flex: 1; min-width: 0; }
  .bili-row-name { font-weight: 500; }
  .bili-codec { font-size: 10px; color: #818cf8; margin-left: 8px; }
  .bili-row-meta { font-size: 11px; color: #888; margin-top: 2px; }
  .bili-dl { padding: 5px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 11px; font-family: inherit; background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; flex-shrink: 0; transition: opacity 0.15s; }
  .bili-dl:hover { opacity: 0.88; }
  .bili-dl-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .bili-dl-main { flex: 1; min-width: 0; }
  .bili-dl-name { font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bili-bar { height: 3px; border-radius: 2px; background: rgba(255,255,255,0.1); margin-top: 4px; overflow: hidden; }
  .bili-bar-in { height: 100%; background: linear-gradient(135deg, #6366f1, #a855f7); transition: width 0.3s; }
  .bili-dl-retry { background: rgba(255,255,255,0.12) !important; }
  .bili-dl-state { font-size: 11px; flex-shrink: 0; color: #888; }
  .bili-dl-state.done { color: #34d399; }
  .bili-dl-state.error { color: #f87171; }
  .bili-hint { margin-top: 12px; padding: 9px 12px; border-radius: 8px; background: rgba(99,102,241,0.1); font-size: 11px; color: #9ca3af; line-height: 1.7; }
  .bili-hint code { background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 4px; font-size: 10px; color: #a5b4fc; }
`;
