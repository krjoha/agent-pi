---
name: codescene-mcp-health
description: Use CodeScene Code Health tools to score, review, and safeguard source files. Tools are registered as native Pi tools — call them directly.
---

# CodeScene Code Health

## Overview

Code Health scores a file from 1.0 (severe debt) to 10.0 (optimal). Use the four native Pi tools below to measure, review, and verify code quality during refactoring or before committing.

## Tools

| Tool | Purpose |
|------|---------|
| `code_health_score` | Numeric score 1.0–10.0 for a single file |
| `code_health_review` | Detailed maintainability findings by category |
| `pre_commit_code_health_safeguard` | Score all modified/staged files in a repo |
| `analyze_change_set` | Branch-level delta vs a base ref (use before PR) |

All tools are registered directly in Pi — no scripting needed.

## Score Interpretation

| Score | Meaning |
|-------|---------|
| 10.0 | Optimal |
| 9.0–9.9 | High quality |
| 4.0–8.9 | Tech debt — worth improving |
| 1.0–3.9 | High risk — prioritise |

## Typical Workflow

1. `code_health_score` — establish a numeric baseline
2. `code_health_review` — identify the structural problems
3. Refactor one issue at a time
4. `code_health_score` again — confirm directional improvement
5. `pre_commit_code_health_safeguard` — final check before committing

## Common Findings

| Finding | Fix |
|---------|-----|
| Large Method | Extract private helpers |
| Complex Method (cc ≥ 9) | Split; reduce branching |
| Bumpy Road Ahead | Use early returns; extract condition checks |
| Deep Nested Complexity (depth > 3) | Flatten with guards or extraction |
| Code Duplication | Parameterise or extract shared function |
| Excess Function Arguments (> 4) | Use a config object or dataclass |
| Complex Conditional | Extract to a named predicate |

## Setup

Binary search order: `$CS_MCP_BINARY_PATH` → `$CS_MCP_SERVER_PATH` → `~/.local/share/codescene-mcp/cs-mcp-linux-amd64` → `~/.cache/codescene-mcp/cs-mcp-linux-amd64` → `cs-mcp` on `$PATH`.

Auth token is read by the binary from `~/.config/codehealth-mcp/config.json` (or `$CS_ACCESS_TOKEN`).

See [README.md](./README.md) for the install snippet.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Could not determine Code Health score" | File too small or not a recognised language |
| "Error reading file (No such file)" | Use an absolute path |
| "binary not found" | Check `CS_MCP_BINARY_PATH` or download the binary |
| Token missing | Check `~/.config/codehealth-mcp/config.json` |
| Status shows "CodeScene: offline" | Binary exists but failed to start — check stderr |
