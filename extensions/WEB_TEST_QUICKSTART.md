# Web Remote Extension - Quick Start

## What's Included

A REMOTE web testing extension for Pi that captures screenshots, extracts content, checks accessibility, and tests responsive layouts using Cloudflare's Browser Rendering.

**IMPORTANT:** This is a remote service — it CANNOT access localhost, 127.0.0.1, or local network addresses. For localhost testing, use the `agent-browser` skill instead.

## Quick Start

### 1. Setup Cloudflare
If not already done:
```bash
npm install -g wrangler
wrangler login
```

### 2. Deploy Worker
The extension auto-deploys on first use, or manually:
```bash
cd ~/.pi/agent/extensions/web-test-worker
npm install
npm run deploy
```

### 3. Start Using

**Via Commands:**
```bash
/web-remote screenshot https://example.com
/web-remote content https://example.com
/web-remote a11y https://example.com
```

**Via AI Tool:**
```
Ask: "Take a screenshot of example.com and describe it"
The AI will use the web_remote tool automatically.
```

**For localhost testing, use agent-browser:**
```bash
agent-browser open http://localhost:3000
agent-browser snapshot -i
agent-browser screenshot
```

## Command Reference

```
/web-remote screenshot <url>     - Capture full page screenshot
/web-remote content <url>        - Extract HTML and text
/web-remote a11y <url>           - Check accessibility violations
/web-remote responsive <url>     - Test responsive layouts
```

## File Locations

- Extension: `~/.pi/agent/extensions/web-test.ts`
- Worker: `~/.pi/agent/extensions/web-test-worker/`
- Captures: `~/.pi/web-test-captures/` (auto-created)
- Config: `~/.pi/agent/settings.json`

## Troubleshooting

**Worker not deploying?**
- Check `wrangler login` status
- Verify Cloudflare account has Browser Rendering enabled
- Check account_id in wrangler.toml

**Screenshots not saving?**
- Check permissions on ~/.pi/web-test-captures/
- Verify disk space available

**Timeout errors?**
- Network may be slow
- Target URL may be slow to load
- Try with waitFor parameter (ms)

## API Documentation

### web_remote Tool (for AI)

```typescript
{
  action: "screenshot" | "content" | "a11y" | "responsive",
  url: string,
  width?: number (default: 1280),
  height?: number (default: 720),
  fullPage?: boolean (default: false),
  waitFor?: number (default: 2000)
}
```

### Worker Endpoints

- POST `/screenshot` - Returns PNG binary
- POST `/content` - Returns {html, text}
- POST `/accessibility` - Returns {violations[], passes[]}
- POST `/responsive` - Returns {viewports[]}
- POST `/ping` - Health check

## Example Responses

**Screenshot:**
```json
{
  "success": true,
  "path": "/Users/user/.pi/web-test-captures/screenshot-2024-03-03T19-05-30.png"
}
```

**Content:**
```json
{
  "success": true,
  "text": "Page content...",
  "html": "<html>...</html>",
  "textLength": 5000,
  "htmlLength": 45000
}
```

**Accessibility:**
```json
{
  "success": true,
  "violations": [
    {
      "id": "color-contrast",
      "impact": "serious",
      "nodes": 5
    }
  ],
  "passes": [
    {
      "id": "aria-required-attr",
      "nodes": 100
    }
  ]
}
```

## Important Notes

1. First run will deploy the worker - takes 30-60 seconds
2. Screenshots are saved with timestamps, not overwritten
3. Full page screenshots may timeout on very long pages
4. Accessibility checks require internet (loads axe-core from CDN)

## Clean Up

Remove the extension:
```bash
# 1. Edit ~/.pi/agent/settings.json and remove "extensions/web-test.ts"
# 2. rm ~/.pi/agent/extensions/web-test.ts
# 3. rm -rf ~/.pi/agent/extensions/web-test-worker/
# 4. rm -rf ~/.pi/web-test-captures/
```
