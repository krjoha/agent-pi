// ABOUTME: CodeScene Code Health tools exposed as native Pi tools.
// ABOUTME: Spawns the CodeScene MCP binary and proxies calls over stdio JSON-RPC.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { McpClient } from "./lib/mcp-client.ts";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";

// ── Binary resolution ───────────────────────────────────────────────
// Search order:
//   1. $CS_MCP_BINARY_PATH      — explicit override
//   2. $CS_MCP_SERVER_PATH      — legacy alias
//   3. ~/.local/share/codescene-mcp/cs-mcp-linux-amd64
//   4. ~/.cache/codescene-mcp/cs-mcp-linux-amd64
//   5. `cs-mcp` on $PATH

function resolveBinary(): string | null {
	const envPath = process.env.CS_MCP_BINARY_PATH || process.env.CS_MCP_SERVER_PATH;
	if (envPath && existsSync(envPath)) return envPath;

	const home = homedir();
	const candidates = [
		join(home, ".local", "share", "codescene-mcp", "cs-mcp-linux-amd64"),
		join(home, ".cache", "codescene-mcp", "cs-mcp-linux-amd64"),
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}

	try {
		const onPath = execSync("command -v cs-mcp", { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
		if (onPath) return onPath;
	} catch {
		// not on PATH
	}

	return envPath || null;
}

const CS_BINARY = resolveBinary();

// ── Tool definitions ────────────────────────────────────────────────

const TOOLS = [
	{
		name: "code_health_score",
		label: "Code Health Score",
		description:
			"Get a numeric Code Health score (1.0–10.0) for a source file. " +
			"10 = optimal, 9–9.9 = green, 4–8.9 = yellow (tech debt), 1–3.9 = red (high risk). " +
			"Use as a fast baseline check before and after refactoring.",
		params: Type.Object({
			file_path: Type.String({ description: "Absolute path to the source file to score" }),
		}),
	},
	{
		name: "code_health_review",
		label: "Code Health Review",
		description:
			"Get a detailed maintainability review for a source file. " +
			"Returns categorised findings: Large Method, Complex Method, Deep Nested Complexity, " +
			"Bumpy Road Ahead, Excess Function Arguments, Code Duplication, etc. " +
			"Run this first to identify the highest-leverage structural problems before refactoring.",
		params: Type.Object({
			file_path: Type.String({ description: "Absolute path to the source file to review" }),
		}),
	},
	{
		name: "pre_commit_code_health_safeguard",
		label: "Code Health Safeguard",
		description:
			"Check Code Health for all modified/staged files in a git repository. " +
			"Run before committing to catch regressions early. " +
			"Returns per-file scores and findings for every changed source file.",
		params: Type.Object({
			git_repository_path: Type.String({ description: "Absolute path to the git repository root" }),
		}),
	},
	{
		name: "analyze_change_set",
		label: "Code Health Change-set",
		description:
			"Branch-level Code Health review comparing the current branch against a base ref (e.g. 'main'). " +
			"Use before opening a PR to see the net health impact of all changes on the branch. " +
			"Returns per-file scores and a summary delta.",
		params: Type.Object({
			git_repository_path: Type.String({ description: "Absolute path to the git repository root" }),
			base_ref: Type.Optional(Type.String({ description: "Base branch or ref to compare against (default: main)" })),
		}),
	},
] as const;

// ── Extension entry point ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const binaryExists = CS_BINARY !== null && existsSync(CS_BINARY);
	const client = new McpClient("", {}, 120_000, binaryExists ? [CS_BINARY!] : ["false"]);

	async function ensureConnected(): Promise<void> {
		if (!client.isConnected()) {
			await client.connect();
		}
	}

	// Register all tools
	for (const tool of TOOLS) {
		pi.registerTool({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: tool.params,

			async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
				if (!binaryExists) {
					return {
						content: [
							{
								type: "text" as const,
								text:
									`CodeScene binary not found. Searched: $CS_MCP_BINARY_PATH, $CS_MCP_SERVER_PATH, ` +
									`~/.local/share/codescene-mcp/cs-mcp-linux-amd64, ` +
									`~/.cache/codescene-mcp/cs-mcp-linux-amd64, and \`cs-mcp\` on $PATH.\n` +
									`Set CS_MCP_BINARY_PATH or install the binary into one of those locations.`,
							},
						],
					};
				}
				try {
					await ensureConnected();
					return await client.callTool(tool.name, params as Record<string, unknown>);
				} catch (err: any) {
					// On failure, attempt a fresh reconnect once
					try {
						client.disconnect();
						await client.connect();
						return await client.callTool(tool.name, params as Record<string, unknown>);
					} catch {
						return {
							content: [{ type: "text" as const, text: `CodeScene error: ${err.message}` }],
						};
					}
				}
			},
		});
	}

	// Probe on session start
	pi.on("session_start", async (_event, ctx) => {
		if (!binaryExists) {
			ctx.ui.setStatus("CodeScene: binary missing", "codescene");
			return;
		}
		try {
			await client.connect();
			ctx.ui.setStatus("CodeScene: ready", "codescene");
		} catch {
			ctx.ui.setStatus("CodeScene: offline", "codescene");
		}
	});

	pi.on("session_shutdown", async () => {
		client.disconnect();
	});
}
