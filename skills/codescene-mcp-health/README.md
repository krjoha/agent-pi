# CodeScene MCP — Code Health Analysis

Measure, review, and improve code maintainability with CodeScene's Code Health engine, exposed as native Pi tools.

See [SKILL.md](./SKILL.md) for the full workflow and troubleshooting. The four tools — `code_health_score`, `code_health_review`, `pre_commit_code_health_safeguard`, `analyze_change_set` — are registered by `extensions/codescene-mcp.ts` and called directly from the agent. No script wrapper.

## Binary

The extension resolves the binary in this order:

1. `$CS_MCP_BINARY_PATH`
2. `$CS_MCP_SERVER_PATH` (legacy alias)
3. `~/.local/share/codescene-mcp/cs-mcp-linux-amd64`
4. `~/.cache/codescene-mcp/cs-mcp-linux-amd64`
5. `cs-mcp` on `$PATH`

Install (any of these — option 1 is simplest and cross-platform):

```bash
# 1. npm (recommended) — puts cs-mcp on PATH
npm install -g @codescene/codehealth-mcp

# 2. Direct binary download (Linux x64)
mkdir -p ~/.local/share/codescene-mcp
curl -L -o /tmp/cs-mcp.zip "https://github.com/codescene-oss/codescene-mcp-server/releases/download/MCP-1.1.7/cs-mcp-linux-amd64.zip"
unzip /tmp/cs-mcp.zip -d ~/.local/share/codescene-mcp/
chmod +x ~/.local/share/codescene-mcp/cs-mcp-linux-amd64

# 3. Homebrew
brew tap codescene-oss/codescene-mcp-server https://github.com/codescene-oss/codescene-mcp-server
brew install cs-mcp
```

## Token

The binary reads its access token from `~/.config/codehealth-mcp/config.json`, or from `CS_ACCESS_TOKEN` if set.
