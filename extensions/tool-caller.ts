// ABOUTME: Tool Caller — meta-tool that lets the agent invoke other tools programmatically by name.
// ABOUTME: Enables dynamic tool composition and conditional tool usage.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import { getToolRegistry } from "./tool-registry.ts";
import { applyExtensionDefaults } from "./lib/themeMap.ts";

// ── Tool Parameters ────────────────────────────────────────────────────

const CallToolParams = Type.Object({
	tool_name: Type.String({ description: "Name of the tool to invoke (e.g. 'read', 'commander_task', 'web_remote')" }),
	arguments: Type.Record(Type.String(), Type.Unknown(), { description: "Arguments to pass to the tool — must match the tool's parameter schema" }),
	reason: Type.Optional(Type.String({ description: "Brief description of why this tool is being called (for audit trail)" })),
});

// ── Self-reference prevention ──────────────────────────────────────────

const BLOCKED_TOOLS = new Set(["call_tool", "tool_search"]);

// ── Types ──────────────────────────────────────────────────────────────

interface BuiltinResult {
	content: { type: string; text?: string }[];
	details?: Record<string, unknown>;
}

// ── Helper: Render error messages ──────────────────────────────────────

function errorResult(message: string, details: Record<string, unknown> = {}): BuiltinResult {
	return { content: [{ type: "text" as const, text: message }], details };
}

// ── Helper: Find similar tool names ────────────────────────────────────

function findSimilarTools(toolName: string, registry: ReturnType<typeof getToolRegistry>): string[] {
	return registry.search(toolName).slice(0, 3).map((s) => s.name);
}

// ── Helper: Render call display ────────────────────────────────────────

function renderCallToolCall(args: Record<string, unknown>, theme: any): Text {
	let text = theme.fg("toolTitle", theme.bold("call_tool "));
	text += theme.fg("accent", args.tool_name || "?");
	if (args.reason) { text += theme.fg("dim", ` — ${args.reason}`); }
	return new Text(text, 0, 0);
}

// ── Helper: Render call result ─────────────────────────────────────────

function formatError(details: Record<string, unknown>, theme: any): string {
	if (details.error === "not_found") return `✗ Tool not found: ${details.tool_name}`;
	if (details.error === "blocked_self_reference") return `✗ Cannot call ${details.tool_name} recursively`;
	return `✗ Error: ${details.message || details.error}`;
}

function formatSuccess(details: Record<string, unknown>, theme: any): string {
	let summary = theme.fg("success", `✓ ${details.tool_name}`);
	if (details.reason) summary += theme.fg("dim", ` — ${details.reason}`);
	return summary;
}

function renderExpanded(result: any, summary: string, theme: any): Text {
	const body = (result.content[0] as any)?.text || "";
	const truncated = body.length > 500 ? body.slice(0, 500) + "..." : body;
	return new Text(summary + "\n" + theme.fg("muted", truncated), 0, 0);
}

function renderCallResult(result: any, { expanded }: { expanded: boolean }, theme: any): Text {
	const details = result.details as any;
	if (!details) { return new Text((result.content[0] as any)?.text || "", 0, 0); }
	if (details.error) { return new Text(theme.fg("error", formatError(details, theme)), 0, 0); }
	if (details.proxied) {
		const summary = formatSuccess(details, theme);
		if (expanded) { return renderExpanded(result, summary, theme); }
		return new Text(summary, 0, 0);
	}
	return new Text(theme.fg("dim", "call_tool completed"), 0, 0);
}

// ── Helper: Tool description ───────────────────────────────────────────

const TOOL_DESCRIPTION = (
	"Invoke any registered tool programmatically by name. " +
	"Use tool_search first to discover available tools and their parameters. " +
	"This enables dynamic tool composition — call tools based on runtime conditions.\n\n" +
	"Parameters:\n" +
	"- tool_name: The exact name of the tool to call\n" +
	"- arguments: Object with the tool's expected parameters\n" +
	"- reason: (optional) Why this tool is being called\n\n" +
	"Examples:\n" +
	'{ "tool_name": "read", "arguments": { "path": "package.json" }, "reason": "Check project dependencies" }\n' +
	'{ "tool_name": "bash", "arguments": { "command": "git status" }, "reason": "Check repo state" }\n' +
	"Note: Cannot call 'call_tool' or 'tool_search' recursively."
);

// ── Helper: Validate tool ──────────────────────────────────────────────

function validateTool(
	toolName: string,
	reason: string | undefined,
	registry: ReturnType<typeof getToolRegistry>,
	pi: ExtensionAPI,
): BuiltinResult | null {
	if (BLOCKED_TOOLS.has(toolName)) {
		return errorResult(`Error: Cannot call '${toolName}' through call_tool — use it directly.`, { toolName, error: "blocked_self_reference", reason });
	}
	const entry = registry.getByName(toolName);
	if (!entry) {
		const similar = findSimilarTools(toolName, registry);
		const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(", ")}?` : "";
		return errorResult(`Error: Tool "${toolName}" not found.${suggestion}`, { toolName, error: "not_found", reason });
	}
	const allTools = pi.getAllTools();
	if (!allTools.find((t: any) => t.name === toolName)) {
		return errorResult(`Error: Tool "${toolName}" is indexed but not currently registered.`, { toolName, error: "not_registered", reason });
	}
	return null;
}

// ── Builtin Tool Execution ─────────────────────────────────────────────

function execBash(
	args: Record<string, unknown>,
	cwd: string,
	pi: ExtensionAPI,
): BuiltinResult | null {
	const command = args.command as string;
	if (!command) return { content: [{ type: "text", text: "Error: 'command' parameter required" }] };
	const timeout = (args.timeout as number) || undefined;
	try {
		const result = pi.exec("bash", ["-c", command], {
			signal: undefined,
			timeout: timeout ? timeout * 1000 : undefined,
			cwd,
		});
		const output = result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : "");
		return {
			content: [{ type: "text", text: output || "(no output)" }],
			details: { exitCode: result.code, command },
		};
	} catch (err: unknown) {
		return { content: [{ type: "text", text: `Bash error: ${(err as Error).message}` }], details: { error: true, command } };
	}
}

function execRead(
	args: Record<string, unknown>,
	cwd: string,
): BuiltinResult | null {
	const path = (args.path as string) || "";
	if (!path) return { content: [{ type: "text", text: "Error: 'path' parameter required" }] };
	try {
		const { readFileSync } = require("node:fs");
		const { resolve } = require("node:path");
		const fullPath = resolve(cwd, path);
		const content = readFileSync(fullPath, "utf-8");
		const offset = (args.offset as number) || 1;
		const limit = (args.limit as number) || 2000;
		const lines = content.split("\n");
		const sliced = lines.slice(offset - 1, offset - 1 + limit);
		return {
			content: [{ type: "text", text: sliced.join("\n") }],
			details: { path: fullPath, totalLines: lines.length },
		};
	} catch (err: unknown) {
		return { content: [{ type: "text", text: `Read error: ${(err as Error).message}` }], details: { error: true, path } };
	}
}

function execWrite(
	args: Record<string, unknown>,
	cwd: string,
): BuiltinResult | null {
	const path = (args.path as string) || "";
	const content = (args.content as string) || "";
	if (!path) return { content: [{ type: "text", text: "Error: 'path' parameter required" }] };
	try {
		const { writeFileSync, mkdirSync } = require("node:fs");
		const { resolve, dirname } = require("node:path");
		const fullPath = resolve(cwd, path);
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, content, "utf-8");
		return {
			content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
			details: { path: fullPath, bytes: content.length },
		};
	} catch (err: unknown) {
		return { content: [{ type: "text", text: `Write error: ${(err as Error).message}` }], details: { error: true, path } };
	}
}

const BUILTIN_MAP: Record<string, (args: Record<string, unknown>, cwd: string, pi?: ExtensionAPI) => BuiltinResult | null> = {
	bash: execBash as any,
	read: execRead,
	write: execWrite,
};

function executeBuiltinTool(name: string, args: Record<string, unknown>, ctx: Record<string, unknown>, pi?: ExtensionAPI): BuiltinResult | null {
	const cwd = (ctx.cwd as string) || process.cwd();
	const handler = BUILTIN_MAP[name];
	if (!handler) return null;
	return handler(args, cwd, pi);
}

// ── Helper: Try proxied execution ──────────────────────────────────────

interface ExecutorContext {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	ctx: Record<string, unknown>;
	toolExecutors: Map<string, any>;
}

function tryProxiedExecute(ctx: ExecutorContext): BuiltinResult | null {
	const { toolCallId, toolName, args, ctx: execCtx, toolExecutors } = ctx;
	const executor = toolExecutors.get(toolName);
	if (!executor) return null;
	try {
		return executor(`${toolCallId}-proxy-${toolName}`, args, undefined, undefined, execCtx);
	} catch {
		return null;
	}
}

// ── Execution Core ─────────────────────────────────────────────────────

interface ExecuteContext {
	toolCallId: string;
	params: Record<string, unknown>;
	ctx: Record<string, unknown>;
	registry: ReturnType<typeof getToolRegistry>;
	pi: ExtensionAPI;
	toolExecutors: Map<string, any>;
}

function doExecute(execCtx: ExecuteContext): BuiltinResult {
	const { toolCallId, params, ctx, registry, pi, toolExecutors } = execCtx;
	const { tool_name, reason } = params;

	const validation = validateTool(tool_name as string, reason as string | undefined, registry, pi);
	if (validation) return validation;

	const proxied = tryProxiedExecute({
		toolCallId,
		toolName: tool_name as string,
		args: params.arguments as Record<string, unknown>,
		ctx,
		toolExecutors,
	});
	if (proxied) {
		return {
			content: proxied.content || [{ type: "text", text: "Tool returned no content" }],
			details: { tool_name, reason, proxied: true, originalDetails: proxied.details },
		};
	}

	const builtin = executeBuiltinTool(tool_name as string, params.arguments as Record<string, unknown>, ctx, pi);
	if (builtin) {
		return {
			content: builtin.content || [{ type: "text", text: "Tool returned no content" }],
			details: { tool_name, reason, proxied: true, executionMethod: "builtin", originalDetails: builtin.details },
		};
	}

	return errorResult(
		`Tool "${tool_name}" exists but programmatic execution is not available. Call it directly instead.`,
		{ tool_name, reason, error: "no_executor" },
	);
}

// ── Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const registry = getToolRegistry();
	const toolExecutors: Map<string, any> = new Map();

	pi.registerTool({
		name: "call_tool",
		label: "Call Tool",
		description: TOOL_DESCRIPTION,
		parameters: CallToolParams,

		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			return doExecute({ toolCallId, params, ctx, registry, pi, toolExecutors });
		},

		renderCall: renderCallToolCall,
		renderResult: renderCallResult,
	});

	pi.on("session_start", async () => {
		const g = globalThis as any;
		if (g.__piRegisteredToolExecutors) {
			for (const [name, executor] of Object.entries(g.__piRegisteredToolExecutors)) {
				toolExecutors.set(name, executor);
			}
		}
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		applyExtensionDefaults(import.meta.url, ctx);
	});
}
