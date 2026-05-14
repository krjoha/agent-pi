#!/usr/bin/env node
/**
 * ARCHIVED — superseded by extensions/codescene-mcp.ts (native Pi tools).
 * Kept for reference; not loaded by Pi.
 *
 * CodeScene MCP Client — reusable JSON-RPC client for CodeHealth analysis.
 *
 * Usage:
 *   node cs-mcp.js score <file_path>
 *   node cs-mcp.js review <file_path>
 *   node cs-mcp.js safeguard <repo_path>
 *   node cs-mcp.js list
 *   node cs-mcp.js score file1 file2 file3
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");

const DEFAULT_BINARY = resolve(
  PACKAGE_ROOT,
  "codescene-binary",
  "cs-mcp-linux-amd64"
);

const BINARY_PATH =
  process.env.CS_MCP_BINARY_PATH ||
  process.env.CS_MCP_SERVER_PATH ||
  DEFAULT_BINARY;

// ── helpers ─────────────────────────────────────────────────────────

function spawnClient() {
  const pending = new Map();
  const proc = spawn(BINARY_PATH, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CS_MCP_BINARY_PATH: BINARY_PATH },
  });

  let buf = "";
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.result && msg.id) {
          const p = pending.get(msg.id);
          if (p) {
            p.resolve(msg.result);
            pending.delete(msg.id);
          }
        } else if (msg.error && msg.id) {
          const p = pending.get(msg.id);
          if (p) {
            p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            pending.delete(msg.id);
          }
        }
      } catch {
        // Skip non-JSON lines (server logs, etc.)
      }
    }
  });

  proc.stderr.on("data", () => {
    // Drain stderr silently
  });

  proc.on("close", () => {
    // Reject all pending
    for (const [, p] of pending) {
      p.reject(new Error("Server exited"));
    }
  });

  return { proc, rpc };

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = pending.size + 1;
      const msg = { jsonrpc: "2.0", method, params };
      if (method !== "notifications/initialized") {
        msg.id = id;
        pending.set(id, { resolve, reject });
      }
      proc.stdin.write(JSON.stringify(msg) + "\n");
    });
  }
}

// ── commands ────────────────────────────────────────────────────────

async function cmdScore(filePaths) {
  const { rpc, proc } = spawnClient();

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cs-mcp-client", version: "1.0.0" },
  });
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) +
      "\n"
  );

  const results = [];
  for (const fp of filePaths) {
    const r = await rpc("tools/call", {
      name: "code_health_score",
      arguments: { file_path: fp },
    });
    results.push(r);
  }

  proc.kill();
  return results;
}

async function cmdReview(filePaths) {
  const { rpc, proc } = spawnClient();

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cs-mcp-client", version: "1.0.0" },
  });
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) +
      "\n"
  );

  const results = [];
  for (const fp of filePaths) {
    const r = await rpc("tools/call", {
      name: "code_health_review",
      arguments: { file_path: fp },
    });
    results.push(r);
  }

  proc.kill();
  return results;
}

async function cmdSafeguard(repoPath) {
  const { rpc, proc } = spawnClient();

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cs-mcp-client", version: "1.0.0" },
  });
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) +
      "\n"
  );

  const r = await rpc("tools/call", {
    name: "pre_commit_code_health_safeguard",
    arguments: { git_repository_path: repoPath },
  });

  proc.kill();
  return r;
}

async function cmdList() {
  const { rpc, proc } = spawnClient();

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cs-mcp-client", version: "1.0.0" },
  });
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) +
      "\n"
  );

  const r = await rpc("tools/list", {});

  proc.kill();
  return r;
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  if (!cmd) {
    console.log("Usage: node cs-mcp.js <command> [args...]");
    console.log("  score <file> [<file>...]  — Get Code Health scores");
    console.log("  review <file> [<file>...] — Get detailed reviews");
    console.log("  safeguard <repo>          — Pre-commit safeguard check");
    console.log("  list                      — List available tools");
    process.exit(0);
  }

  switch (cmd) {
    case "score":
      if (args.length === 0) {
        console.error("Usage: cs-mcp.js score <file_path> [<file_path>...]");
        process.exit(1);
      }
      {
        const results = await cmdScore(args);
        for (const r of results) {
          const text = r?.content?.[0]?.text || "No result";
          console.log(text);
        }
      }
      break;

    case "review":
      if (args.length === 0) {
        console.error("Usage: cs-mcp.js review <file_path> [<file_path>...]");
        process.exit(1);
      }
      {
        const results = await cmdReview(args);
        for (const r of results) {
          const text = r?.content?.[0]?.text || "No result";
          console.log(text);
        }
      }
      break;

    case "safeguard":
      if (args.length === 0) {
        console.error("Usage: cs-mcp.js safeguard <repo_path>");
        process.exit(1);
      }
      {
        const r = await cmdSafeguard(args[0]);
        console.log(JSON.stringify(r, null, 2));
      }
      break;

    case "list":
      {
        const r = await cmdList();
        console.log(JSON.stringify(r, null, 2));
      }
      break;

    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
