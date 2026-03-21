// ABOUTME: Self-contained HTML template for the web chat interface.
// ABOUTME: Mobile-first responsive design with SSE streaming, markdown rendering, and dark theme.

export function generateWebChatHTML(opts: { port: number }): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0f1117">
<title>Pi Agent — Web Chat</title>
<style>
  /* ── Reset & Variables ────────────────────────────── */
  :root {
    --bg: #0f1117;
    --surface: #161922;
    --surface2: #1c2030;
    --surface3: #232838;
    --border: #2a3040;
    --text: #e4e8f0;
    --text-muted: #8892a8;
    --text-dim: #505868;
    --accent: #6c8cff;
    --accent-glow: rgba(108, 140, 255, 0.15);
    --accent-dim: rgba(108, 140, 255, 0.08);
    --user-bg: #1a3a5c;
    --user-border: #2a5a8c;
    --assistant-bg: #1c2030;
    --assistant-border: #2a3040;
    --success: #48d889;
    --warning: #f0b429;
    --error: #e85858;
    --tool-bg: rgba(108, 140, 255, 0.06);
    --tool-border: rgba(108, 140, 255, 0.15);
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --mono: "SF Mono", "Fira Code", "JetBrains Mono", Consolas, monospace;
    --radius: 12px;
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-top: env(safe-area-inset-top, 0px);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 16px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }

  /* ── Layout ───────────────────────────────────────── */
  #app {
    display: flex;
    flex-direction: column;
    height: 100%;
    height: 100dvh;
    max-width: 800px;
    margin: 0 auto;
  }

  /* ── Header ───────────────────────────────────────── */
  #header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    padding-top: calc(12px + var(--safe-top));
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    z-index: 10;
  }

  #header .title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    font-size: 17px;
    letter-spacing: -0.01em;
  }

  #header .logo {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, var(--accent), #4a6cdf);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
    color: #fff;
  }

  #header .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    transition: background 0.3s;
  }
  .status-dot.disconnected { background: var(--error); }
  .status-dot.busy { background: var(--warning); animation: pulse 1.2s infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .header-btn {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .header-btn:hover { background: var(--surface3); color: var(--text); }
  .header-btn:active { transform: scale(0.97); }

  /* ── Messages Area ────────────────────────────────── */
  #messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    padding-bottom: 8px;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  }

  #messages::-webkit-scrollbar { width: 4px; }
  #messages::-webkit-scrollbar-track { background: transparent; }
  #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .message {
    margin-bottom: 16px;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .message-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
    padding-left: 2px;
  }

  .message-label.user-label { color: var(--accent); }
  .message-label.assistant-label { color: var(--success); }

  .message-bubble {
    padding: 12px 16px;
    border-radius: var(--radius);
    border: 1px solid;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }

  .user-bubble {
    background: var(--user-bg);
    border-color: var(--user-border);
  }

  .assistant-bubble {
    background: var(--assistant-bg);
    border-color: var(--assistant-border);
  }

  .message-time {
    font-size: 11px;
    color: var(--text-dim);
    margin-top: 4px;
    padding-left: 2px;
  }

  /* ── Tool Indicator ───────────────────────────────── */
  .tool-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    margin: 4px 0;
    background: var(--tool-bg);
    border: 1px solid var(--tool-border);
    border-radius: 6px;
    font-size: 12px;
    color: var(--accent);
    font-family: var(--mono);
  }

  .tool-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--tool-border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Thinking Indicator ───────────────────────────── */
  .thinking {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    color: var(--text-muted);
    font-size: 14px;
    animation: fadeIn 0.2s ease;
  }

  .thinking-dots {
    display: flex;
    gap: 4px;
  }

  .thinking-dots span {
    width: 6px;
    height: 6px;
    background: var(--text-muted);
    border-radius: 50%;
    animation: bounce 1.4s infinite;
  }
  .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-6px); }
  }

  /* ── Welcome Screen ───────────────────────────────── */
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 16px;
    color: var(--text-muted);
    text-align: center;
    padding: 20px;
  }

  .welcome-logo {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    background: linear-gradient(135deg, var(--accent), #4a6cdf);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 8px;
  }

  .welcome h2 {
    color: var(--text);
    font-size: 20px;
    font-weight: 600;
  }

  .welcome p {
    font-size: 14px;
    max-width: 320px;
    line-height: 1.6;
  }

  .welcome-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 8px;
  }

  .suggestion {
    padding: 8px 14px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 20px;
    font-size: 13px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
  }
  .suggestion:hover { background: var(--surface3); color: var(--text); border-color: var(--accent); }
  .suggestion:active { transform: scale(0.97); }

  /* ── Input Area ───────────────────────────────────── */
  #input-area {
    padding: 12px 16px;
    padding-bottom: calc(12px + var(--safe-bottom));
    background: var(--surface);
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  #input-wrapper {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px;
    transition: border-color 0.2s;
  }

  #input-wrapper:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }

  #message-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: var(--font);
    font-size: 16px;
    line-height: 1.5;
    padding: 8px 12px;
    resize: none;
    outline: none;
    max-height: 120px;
    min-height: 24px;
  }

  #message-input::placeholder {
    color: var(--text-dim);
  }

  #send-btn {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--accent);
    border: none;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  #send-btn:hover { filter: brightness(1.15); }
  #send-btn:active { transform: scale(0.93); }
  #send-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    filter: none;
    transform: none;
  }

  /* ── Markdown Content Styles ──────────────────────── */
  .assistant-bubble p { margin: 0.4em 0; }
  .assistant-bubble p:first-child { margin-top: 0; }
  .assistant-bubble p:last-child { margin-bottom: 0; }

  .assistant-bubble strong { color: #fff; font-weight: 600; }
  .assistant-bubble em { color: var(--text-muted); font-style: italic; }

  .assistant-bubble code {
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 0.88em;
    color: #e8b4f8;
  }

  .assistant-bubble pre {
    background: #0d0f14;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    margin: 8px 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .assistant-bubble pre code {
    background: none;
    padding: 0;
    color: var(--text);
    font-size: 13px;
    line-height: 1.5;
  }

  .assistant-bubble ul, .assistant-bubble ol {
    padding-left: 1.5em;
    margin: 0.4em 0;
  }

  .assistant-bubble li { margin: 0.2em 0; }

  .assistant-bubble blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 12px;
    margin: 8px 0;
    color: var(--text-muted);
  }

  .assistant-bubble h1, .assistant-bubble h2, .assistant-bubble h3,
  .assistant-bubble h4, .assistant-bubble h5, .assistant-bubble h6 {
    color: #fff;
    margin: 0.8em 0 0.4em;
    font-weight: 600;
  }
  .assistant-bubble h1 { font-size: 1.3em; }
  .assistant-bubble h2 { font-size: 1.15em; }
  .assistant-bubble h3 { font-size: 1.05em; }

  .assistant-bubble a {
    color: var(--accent);
    text-decoration: none;
  }
  .assistant-bubble a:hover { text-decoration: underline; }

  .assistant-bubble hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 12px 0;
  }

  .assistant-bubble table {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 14px;
  }
  .assistant-bubble th, .assistant-bubble td {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }
  .assistant-bubble th {
    background: var(--surface3);
    color: #fff;
    font-weight: 600;
  }

  /* ── Cursor blink for streaming ───────────────────── */
  .cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--accent);
    margin-left: 2px;
    vertical-align: text-bottom;
    animation: blink 1s step-end infinite;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }

  /* ── Connection banner ────────────────────────────── */
  .connection-banner {
    padding: 8px 16px;
    background: rgba(232, 88, 88, 0.1);
    border-bottom: 1px solid rgba(232, 88, 88, 0.2);
    color: var(--error);
    font-size: 13px;
    text-align: center;
    display: none;
  }
  .connection-banner.visible { display: block; }

  /* ── Directory Picker ─────────────────────────────── */
  .dir-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    max-width: 180px;
    overflow: hidden;
  }
  .dir-pill:hover { background: var(--surface3); color: var(--text); border-color: var(--accent); }
  .dir-pill:active { transform: scale(0.97); }
  .dir-pill .dir-icon { font-size: 13px; flex-shrink: 0; }
  .dir-pill .dir-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--mono);
    font-weight: 500;
  }
  .dir-pill .dir-chevron { font-size: 10px; flex-shrink: 0; opacity: 0.5; }

  #dir-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 100;
    display: none;
    animation: fadeOverlay 0.2s ease;
  }
  #dir-overlay.visible { display: block; }
  @keyframes fadeOverlay {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  #dir-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 75vh;
    background: var(--surface);
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    z-index: 101;
    display: none;
    flex-direction: column;
    animation: slideUp 0.25s ease;
    padding-bottom: var(--safe-bottom);
  }
  #dir-panel.visible { display: flex; }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .dir-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .dir-panel-header h3 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
  }
  .dir-panel-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .dir-panel-close:hover { background: var(--surface3); color: var(--text); }

  .dir-search-wrapper {
    padding: 12px 16px;
    flex-shrink: 0;
  }
  .dir-search {
    width: 100%;
    padding: 10px 12px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    font-family: var(--font);
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s;
  }
  .dir-search:focus { border-color: var(--accent); }
  .dir-search::placeholder { color: var(--text-dim); }

  .dir-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 16px;
    -webkit-overflow-scrolling: touch;
  }
  .dir-list::-webkit-scrollbar { width: 4px; }
  .dir-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .dir-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .dir-item:hover { background: var(--surface2); }
  .dir-item:active { background: var(--surface3); transform: scale(0.99); }
  .dir-item.active {
    background: var(--accent-dim);
    border: 1px solid var(--tool-border);
  }

  .dir-item-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--surface3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }
  .dir-item.active .dir-item-icon {
    background: var(--accent-glow);
  }

  .dir-item-info {
    flex: 1;
    min-width: 0;
  }
  .dir-item-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dir-item-path {
    font-size: 12px;
    color: var(--text-dim);
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .dir-item-badges {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .dir-badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .dir-badge.git { background: rgba(240, 80, 50, 0.15); color: #f05032; }
  .dir-badge.pkg { background: rgba(72, 216, 137, 0.12); color: var(--success); }

  .dir-empty {
    text-align: center;
    padding: 32px 16px;
    color: var(--text-dim);
    font-size: 14px;
  }

  .dir-loading {
    text-align: center;
    padding: 32px 16px;
    color: var(--text-muted);
    font-size: 14px;
  }
</style>
</head>
<body>

<div id="app">
  <div id="header">
    <div class="title">
      <div class="logo">π</div>
      <span>Pi Agent</span>
    </div>
    <div class="actions">
      <div class="dir-pill" id="dir-pill" onclick="openDirPicker()" title="Change working directory">
        <span class="dir-icon">📁</span>
        <span class="dir-name" id="dir-pill-name">loading...</span>
        <span class="dir-chevron">▼</span>
      </div>
      <div class="status-dot" id="status-dot" title="Connected"></div>
      <button class="header-btn" onclick="resetChat()" title="New conversation">New</button>
    </div>
  </div>

  <div class="connection-banner" id="conn-banner">
    Connection lost. Reconnecting...
  </div>

  <div id="messages">
    <div class="welcome" id="welcome">
      <div class="welcome-logo">π</div>
      <h2>Pi Agent</h2>
      <p>Chat with your Pi agent from anywhere on your network. Full tool access included.</p>
      <div class="welcome-suggestions">
        <div class="suggestion" onclick="sendSuggestion('What files are in the current directory?')">📁 List files</div>
        <div class="suggestion" onclick="sendSuggestion('What is the current git status?')">🔀 Git status</div>
        <div class="suggestion" onclick="sendSuggestion('Give me a summary of this project')">📋 Project summary</div>
      </div>
    </div>
  </div>

  <div id="input-area">
    <div id="input-wrapper">
      <textarea
        id="message-input"
        placeholder="Message Pi agent..."
        rows="1"
        autocomplete="off"
        autocorrect="on"
        spellcheck="true"
      ></textarea>
      <button id="send-btn" onclick="sendMessage()" title="Send">↑</button>
    </div>
  </div>
</div>

<!-- Directory Picker Overlay -->
<div id="dir-overlay" onclick="closeDirPicker()"></div>
<div id="dir-panel">
  <div class="dir-panel-header">
    <h3>Working Directory</h3>
    <button class="dir-panel-close" onclick="closeDirPicker()">✕</button>
  </div>
  <div class="dir-search-wrapper">
    <input type="text" class="dir-search" id="dir-search" placeholder="Search projects..." oninput="filterDirs()">
  </div>
  <div class="dir-list" id="dir-list">
    <div class="dir-loading">Loading projects...</div>
  </div>
</div>

<script>
(function() {
  // ── State ───────────────────────────────────────────
  let eventSource = null;
  let connected = false;
  let busy = false;
  let currentStreamBubble = null;
  let currentStreamText = '';
  let reconnectTimer = null;
  let reconnectDelay = 1000;

  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const statusDot = document.getElementById('status-dot');
  const connBanner = document.getElementById('conn-banner');
  const welcomeEl = document.getElementById('welcome');

  // ── Auto-resize textarea ────────────────────────────
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // ── Keyboard handling ───────────────────────────────
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Markdown renderer (lightweight) ─────────────────
  function renderMarkdown(text) {
    // Escape HTML first
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks (triple backtick)
    html = html.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
      return '<pre><code class="language-' + (lang || '') + '">' + code.trim() + '</code></pre>';
    });

    // Inline code
    html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^######\\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');

    // Bold
    html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');

    // Italic
    html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

    // Horizontal rules
    html = html.replace(/^---+$/gm, '<hr>');

    // Unordered lists
    html = html.replace(/^[\\s]*[-*]\\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>');
    // Remove nested <ul> tags
    html = html.replace(/<\\/ul>\\s*<ul>/g, '');

    // Ordered lists
    html = html.replace(/^[\\s]*\\d+\\.\\s+(.+)$/gm, '<li>$1</li>');

    // Blockquotes
    html = html.replace(/^&gt;\\s*(.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/<\\/blockquote>\\n<blockquote>/g, '<br>');

    // Links
    html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Paragraphs — wrap lines not already in block elements
    html = html.replace(/^(?!<[hupbol]|<li|<blockquote|<pre|<hr)(.+)$/gm, '<p>$1</p>');

    // Clean up empty paragraphs
    html = html.replace(/<p><\\/p>/g, '');

    return html;
  }

  // ── Scroll to bottom ───────────────────────────────
  function scrollToBottom(force) {
    const el = messagesEl;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (force || nearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  // ── Time formatter ─────────────────────────────────
  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  // ── Add message bubble ─────────────────────────────
  function addUserMessage(text, timestamp) {
    if (welcomeEl) welcomeEl.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML =
      '<div class="message-label user-label">You</div>' +
      '<div class="message-bubble user-bubble">' + escapeHtml(text) + '</div>' +
      '<div class="message-time">' + formatTime(timestamp || new Date().toISOString()) + '</div>';
    messagesEl.appendChild(div);
    scrollToBottom(true);
  }

  function startAssistantMessage() {
    if (welcomeEl) welcomeEl.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'message';

    const label = document.createElement('div');
    label.className = 'message-label assistant-label';
    label.textContent = 'Pi';
    div.appendChild(label);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble assistant-bubble';
    div.appendChild(bubble);

    messagesEl.appendChild(div);
    currentStreamBubble = bubble;
    currentStreamText = '';
    scrollToBottom(true);
    return div;
  }

  function appendToStream(text) {
    if (!currentStreamBubble) startAssistantMessage();
    currentStreamText += text;
    // Render markdown and add cursor
    currentStreamBubble.innerHTML = renderMarkdown(currentStreamText) + '<span class="cursor"></span>';
    scrollToBottom(false);
  }

  function finalizeStream() {
    if (currentStreamBubble) {
      currentStreamBubble.innerHTML = renderMarkdown(currentStreamText);
      // Add timestamp
      const timeDiv = document.createElement('div');
      timeDiv.className = 'message-time';
      timeDiv.textContent = formatTime(new Date().toISOString());
      currentStreamBubble.parentElement.appendChild(timeDiv);
      currentStreamBubble = null;
      currentStreamText = '';
      scrollToBottom(true);
    }
  }

  function addToolIndicator(name) {
    if (!currentStreamBubble) startAssistantMessage();
    const indicator = document.createElement('div');
    indicator.className = 'tool-indicator';
    indicator.id = 'tool-active';
    indicator.innerHTML = '<div class="tool-spinner"></div> ' + escapeHtml(name);
    currentStreamBubble.appendChild(indicator);
    scrollToBottom(false);
  }

  function removeToolIndicator() {
    const el = document.getElementById('tool-active');
    if (el) el.remove();
  }

  function showThinking() {
    // Remove any existing thinking indicator
    hideThinking();
    const div = document.createElement('div');
    div.className = 'thinking';
    div.id = 'thinking-indicator';
    div.innerHTML =
      '<div class="thinking-dots"><span></span><span></span><span></span></div>' +
      'Pi is thinking...';
    messagesEl.appendChild(div);
    scrollToBottom(true);
  }

  function hideThinking() {
    const el = document.getElementById('thinking-indicator');
    if (el) el.remove();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Send message ───────────────────────────────────
  window.sendMessage = async function() {
    const text = inputEl.value.trim();
    if (!text || busy) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    setBusy(true);
    addUserMessage(text);
    showThinking();

    try {
      const res = await fetch('/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        hideThinking();
        addSystemMessage('Error: ' + (data.error || 'Failed to send'));
        setBusy(false);
      }
    } catch (err) {
      hideThinking();
      addSystemMessage('Network error: ' + err.message);
      setBusy(false);
    }
  };

  window.sendSuggestion = function(text) {
    inputEl.value = text;
    sendMessage();
  };

  window.resetChat = async function() {
    try {
      await fetch('/reset', { method: 'POST' });
      // Clear UI
      messagesEl.innerHTML = '';
      if (welcomeEl) {
        messagesEl.appendChild(welcomeEl);
        welcomeEl.style.display = '';
      }
      currentStreamBubble = null;
      currentStreamText = '';
      setBusy(false);
    } catch (err) {
      addSystemMessage('Error resetting: ' + err.message);
    }
  };

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message';
    div.innerHTML =
      '<div class="message-bubble" style="background:rgba(232,88,88,0.1);border-color:rgba(232,88,88,0.2);color:var(--error);font-size:14px;">' +
      escapeHtml(text) + '</div>';
    messagesEl.appendChild(div);
    scrollToBottom(true);
  }

  // ── Busy state ─────────────────────────────────────
  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    inputEl.disabled = b;
    if (!b) inputEl.focus();
    updateStatusDot();
  }

  function updateStatusDot() {
    statusDot.className = 'status-dot' +
      (!connected ? ' disconnected' : busy ? ' busy' : '');
    statusDot.title = !connected ? 'Disconnected' : busy ? 'Agent is working...' : 'Connected';
  }

  // ── SSE Connection ─────────────────────────────────
  function connectSSE() {
    if (eventSource) {
      try { eventSource.close(); } catch {}
    }

    eventSource = new EventSource('/events');

    eventSource.addEventListener('connected', (e) => {
      connected = true;
      reconnectDelay = 1000;
      connBanner.classList.remove('visible');
      updateStatusDot();

      const data = JSON.parse(e.data);
      if (data.busy) setBusy(true);
      if (data.cwdName) {
        currentCwd = data.cwd || '';
        updateDirPill(data.cwdName);
      }
    });

    eventSource.addEventListener('user_message', (e) => {
      // Only render if this is replay from history
      // Live messages are rendered immediately in sendMessage()
    });

    eventSource.addEventListener('assistant_message', (e) => {
      const data = JSON.parse(e.data);
      // This is a history replay of a complete assistant message
      if (welcomeEl) welcomeEl.style.display = 'none';
      const div = document.createElement('div');
      div.className = 'message';
      div.innerHTML =
        '<div class="message-label assistant-label">Pi</div>' +
        '<div class="message-bubble assistant-bubble">' + renderMarkdown(data.content) + '</div>' +
        '<div class="message-time">' + formatTime(data.timestamp) + '</div>';
      messagesEl.appendChild(div);
      scrollToBottom(true);
    });

    eventSource.addEventListener('text_delta', (e) => {
      hideThinking();
      const data = JSON.parse(e.data);
      appendToStream(data.text);
    });

    eventSource.addEventListener('tool_start', (e) => {
      hideThinking();
      const data = JSON.parse(e.data);
      addToolIndicator(data.name);
    });

    eventSource.addEventListener('tool_end', () => {
      removeToolIndicator();
    });

    eventSource.addEventListener('done', (e) => {
      hideThinking();
      finalizeStream();
      setBusy(false);
    });

    eventSource.addEventListener('error_event', (e) => {
      hideThinking();
      const data = JSON.parse(e.data);
      addSystemMessage(data.message);
      setBusy(false);
    });

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setBusy(data.busy);
    });

    eventSource.addEventListener('dir_changed', (e) => {
      const data = JSON.parse(e.data);
      currentCwd = data.cwd || '';
      updateDirPill(data.name);
    });

    eventSource.addEventListener('reset', () => {
      messagesEl.innerHTML = '';
      if (welcomeEl) {
        messagesEl.appendChild(welcomeEl);
        welcomeEl.style.display = '';
      }
      currentStreamBubble = null;
      currentStreamText = '';
      setBusy(false);
    });

    eventSource.onerror = () => {
      connected = false;
      updateStatusDot();
      connBanner.classList.add('visible');

      // Reconnect with backoff
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
        connectSSE();
      }, reconnectDelay);
    };
  }

  // ── Handle error event name collision ──────────────
  // SSE 'error' is reserved, so we use 'error_event'

  // ── Directory Picker ─────────────────────────────────
  let allDirs = [];
  let currentCwd = '';
  const dirPillName = document.getElementById('dir-pill-name');
  const dirOverlay = document.getElementById('dir-overlay');
  const dirPanel = document.getElementById('dir-panel');
  const dirList = document.getElementById('dir-list');
  const dirSearch = document.getElementById('dir-search');

  window.openDirPicker = async function() {
    dirOverlay.classList.add('visible');
    dirPanel.classList.add('visible');
    dirSearch.value = '';
    dirSearch.focus();

    // Load directories
    dirList.innerHTML = '<div class="dir-loading">Loading projects...</div>';
    try {
      const res = await fetch('/directories');
      const data = await res.json();
      allDirs = data.directories || [];
      currentCwd = data.current || '';
      renderDirList(allDirs);
    } catch (err) {
      dirList.innerHTML = '<div class="dir-empty">Failed to load directories</div>';
    }
  };

  window.closeDirPicker = function() {
    dirOverlay.classList.remove('visible');
    dirPanel.classList.remove('visible');
  };

  window.filterDirs = function() {
    const q = dirSearch.value.toLowerCase().trim();
    if (!q) {
      renderDirList(allDirs);
      return;
    }
    const filtered = allDirs.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.path.toLowerCase().includes(q)
    );
    renderDirList(filtered);
  };

  function renderDirList(dirs) {
    if (dirs.length === 0) {
      dirList.innerHTML = '<div class="dir-empty">No projects found</div>';
      return;
    }
    // Shorten paths for display (replace home with ~)
    const home = currentCwd.split('/').slice(0, 3).join('/'); // rough guess
    dirList.innerHTML = dirs.map(d => {
      const isActive = d.path === currentCwd;
      const shortPath = d.path.replace(/^\\/Users\\/[^\\/]+/, '~');
      const badges = [];
      if (d.hasGit) badges.push('<span class="dir-badge git">git</span>');
      if (d.hasPackageJson) badges.push('<span class="dir-badge pkg">npm</span>');
      return '<div class="dir-item' + (isActive ? ' active' : '') + '" onclick="selectDir(\\''+d.path.replace(/'/g, "\\\\'")+'\\')">'+
        '<div class="dir-item-icon">' + (d.hasGit ? '📂' : '📁') + '</div>' +
        '<div class="dir-item-info">' +
          '<div class="dir-item-name">' + escapeHtml(d.name) + '</div>' +
          '<div class="dir-item-path">' + escapeHtml(shortPath) + '</div>' +
        '</div>' +
        '<div class="dir-item-badges">' + badges.join('') + '</div>' +
      '</div>';
    }).join('');
  }

  window.selectDir = async function(dirPath) {
    try {
      const res = await fetch('/set-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();
      if (data.ok) {
        currentCwd = dirPath;
        updateDirPill(data.name);
        closeDirPicker();
        // Clear the chat since we switched directories
        messagesEl.innerHTML = '';
        if (welcomeEl) {
          messagesEl.appendChild(welcomeEl);
          welcomeEl.style.display = '';
        }
        currentStreamBubble = null;
        currentStreamText = '';
        setBusy(false);
      } else {
        addSystemMessage('Error: ' + (data.error || 'Failed to switch directory'));
      }
    } catch (err) {
      addSystemMessage('Error switching directory: ' + err.message);
    }
  };

  function updateDirPill(name) {
    dirPillName.textContent = name || 'unknown';
    dirPillName.title = currentCwd;
  }

  // ── Initialize ─────────────────────────────────────
  connectSSE();
  inputEl.focus();

  // ── Prevent zoom on double-tap (iOS) ───────────────
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) e.preventDefault();
    lastTap = now;
  }, { passive: false });

})();
</script>

</body>
</html>`;
}
