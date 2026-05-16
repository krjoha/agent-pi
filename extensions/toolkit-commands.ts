// ABOUTME: Registers toolkit .md files from .pi/commands/ as dynamic Pi slash commands.
// ABOUTME: Supports inline (inject as user message) and fork (spawn subprocess) execution modes.
/**
 * Toolkit Commands — Register toolkit command .md files as Pi slash commands
 *
 * Scans ~/.pi/commands/ (including symlinked toolkit/commands) for .md files.
 * Parses frontmatter (description, argument-hint, allowed-tools, context) and registers
 * each as a Pi slash command. When invoked:
 * - Inline (no context: fork): injects body with $ARGUMENTS replaced as user message
 * - Fork (context: fork): spawns a pi subprocess with the command body as system prompt
 *
 * Usage: loaded via packages in settings.json
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "child_process";
import { applyExtensionDefaults } from "./lib/themeMap.ts";
import { DEFAULT_SUBAGENT_MODEL } from "./lib/defaults.ts";
import { TOOLKIT_WORKER_MODEL } from "./lib/toolkit-cli.ts";

// ── Type Aliases ─────────────────────────────────

type CommandName = string;
type ToolName = string;
type FilePath = string;

// ── Types ────────────────────────────────────────

interface CommandDef {
	name: string;
	nameFromFrontmatter: boolean;
	description: string;
	argumentHint: string;
	allowedTools: string[];
	context: "fork" | "inline";
	agent: string;
	body: string;
	file: string;
}

// Map toolkit tool names to Pi tool names
const TOOL_MAP: Record<string, string> = {
	Bash: "bash", bash: "bash",
	Read: "read", read: "read",
	Write: "write", write: "write",
	Edit: "edit", edit: "edit",
	Grep: "grep", grep: "grep",
	Glob: "find", find: "find",
	Ls: "ls", ls: "ls",
	"file-system": "read,write,edit",
	"AskUserQuestion": "ask_user",
	Task: "dispatch_agent",
	Skill: "skill",
	Python: "bash", python: "bash",
	terminal: "bash",
	"claude-code-sdk": "read,grep,bash",
	"SlashCommand": "skill",
	"mcp__commander__commander_task": "commander_task",
	"mcp__commander__commander_session": "commander_session",
	"mcp__commander__commander_workflow": "commander_workflow",
	"mcp__commander__commander_spec": "commander_spec",
	"mcp__commander__commander_jira": "commander_jira",
	"mcp__commander__commander_mailbox": "commander_mailbox",
	"mcp__commander__commander_orchestration": "commander_orchestration",
	"mcp__commander__commander_dependency": "commander_dependency",
	"mcp__commander__commander_agentmail": "commander_agentmail",
	"mcp__commander__commander_session_cleanup": "commander_session",
	"mcp__commander__commander_terminal_sessions": "commander_session",
	"mcp__commander__commander_task_lifecycle": "commander_task",
	"mcp__commander__commander_task_group": "commander_task",
	"mcp__commander__commander_comment": "commander_task",
	"mcp__commander__commander_log": "commander_task",
};

function mapToolEntry(raw: ToolName): ToolName[] {
	const clean = (raw.match(/^([A-Za-z_-]+)\(.*\)$/) || [])[1] || raw;
	const mapped = TOOL_MAP[clean] ?? clean.toLowerCase().replace(/-/g, "_");
	return mapped.split(",").map((m) => m.trim()).filter(Boolean);
}

export function mapTools(toolList: ToolName[]): ToolName[] {
	const result: ToolName[] = [];
	for (const t of toolList) {
		for (const mapped of mapToolEntry(t)) {
			if (!result.includes(mapped)) result.push(mapped);
		}
	}
	return result.length > 0 ? result : ["read", "grep", "find", "ls", "bash"];
}

// ── Parser ───────────────────────────────────────

function parseFrontmatter(raw: string): Record<string, string> {
	const fm: Record<string, string> = {};
	const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
	if (!match) return fm;
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) { fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim(); }
	}
	return { ...fm, __body__: match[2].trim() };
}

function parseAllowedTools(raw: string | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw.replace(/'/g, '"'));
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		return raw.split(",").map((s) => s.trim()).filter(Boolean);
	}
}

function resolveCommandName(fm: Record<string, string>, filePath: FilePath): { name: CommandName; nameFromFrontmatter: boolean } {
	if (fm.name) return { name: fm.name, nameFromFrontmatter: true };
	const fallback = filePath.split("/").pop()?.replace(/\.md$/, "") || "unknown";
	return { name: fallback, nameFromFrontmatter: false };
}

function buildCommandDefFromFrontmatter(fm: Record<string, string>, filePath: FilePath): CommandDef {
	const { name, nameFromFrontmatter } = resolveCommandName(fm, filePath);
	return {
		name,
		nameFromFrontmatter,
		description: fm.description,
		argumentHint: fm["argument-hint"] || "",
		allowedTools: parseAllowedTools(fm["allowed-tools"]),
		context: (fm.context || "").toLowerCase() === "fork" ? "fork" : "inline",
		agent: fm.agent || "general-purpose",
		body: fm.__body__ || "",
		file: filePath,
	};
}

function parseCommandFile(filePath: FilePath): CommandDef | null {
	try {
		const fm = parseFrontmatter(readFileSync(filePath, "utf-8"));
		if (!fm.description) return null;
		return buildCommandDefFromFrontmatter(fm, filePath);
	} catch {
		return null;
	}
}

function isDirectory(path: string): boolean {
	try {
		const st = statSync(path);
		return st.isDirectory();
	} catch { return false; }
}

function collectCommandFiles(dir: string): FilePath[] {
	const files: FilePath[] = [];
	if (!existsSync(dir)) return files;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(fullPath));
		if (isDir) {
			files.push(...collectCommandFiles(fullPath));
		} else if (entry.name.endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

function resolveCommandNameWithDir(def: CommandDef, baseDir: string, fileDir: string): CommandDef {
	if (def.nameFromFrontmatter) return def;
	const relDir = relative(baseDir, fileDir);
	if (relDir) {
		return { ...def, name: `${relDir.replace(/[\\/]/g, "-")}-${def.name}` };
	}
	return def;
}

export function scanCommandDirs(baseDir: string): CommandDef[] {
	const commands: CommandDef[] = [];
	const seen = new Set<string>();

	for (const filePath of collectCommandFiles(baseDir)) {
		const def = parseCommandFile(filePath);
		if (!def) continue;
		const resolved = resolveCommandNameWithDir(def, baseDir, dirname(filePath));
		const key = resolved.name.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			commands.push(resolved);
		}
	}

	return commands;
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const extDir = dirname(fileURLToPath(import.meta.url));
	const agentRoot = resolve(extDir, "..");
	let commandsDir = join(agentRoot, ".pi", "commands");
	if (!existsSync(commandsDir)) {
		commandsDir = join(agentRoot, "commands");
	}
	const commands = scanCommandDirs(commandsDir);

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
	});

	// Create fork handler: spawns a pi subprocess
	function createForkHandler(cmdDef: CommandDef) {
		return async (args: string, _ctx: any) => {
			const body = cmdDef.body.replace(/\$ARGUMENTS/g, (args ?? "").trim());
			const proc = spawn("pi", [
				"--mode", "json", "-p", "--no-extensions",
				"-e", join(dirname(fileURLToPath(import.meta.url)), "tasks.ts"),
				"--model", TOOLKIT_WORKER_MODEL || DEFAULT_SUBAGENT_MODEL,
				"--tools", mapTools(cmdDef.allowedTools).join(","),
				"--thinking", "off", "--append-system-prompt", body,
				args || "",
			], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PI_SUBAGENT: "1" } });

			let output = "";
			proc.stdout?.setEncoding("utf-8");
			proc.stdout?.on("data", (chunk: string) => { output += chunk; });
			await new Promise<void>((res) => proc.on("close", () => res()));

			pi.sendMessage(
				{ customType: "toolkit-command-result", content: output.length > 8000 ? output.slice(0, 8000) + "\n\n... [truncated]" : output || "(no output)", display: true },
				{ deliverAs: "followUp", triggerTurn: true },
			);
		};
	}

	// Create inline handler: injects body as user message
	function createInlineHandler(cmdDef: CommandDef) {
		return async (args: string, _ctx: any) => {
			const body = cmdDef.body.replace(/\$ARGUMENTS/g, (args ?? "").trim());
			const tools = mapTools(cmdDef.allowedTools);
			if (tools.length > 0) { pi.setActiveTools(tools); }
			pi.sendMessage(
				{ customType: "toolkit-command", content: body, display: true },
				{ deliverAs: "user", triggerTurn: true },
			);
		};
	}

	for (const cmd of commands) {
		const desc = cmd.argumentHint ? `${cmd.description} — ${cmd.argumentHint}` : cmd.description;
		pi.registerCommand(cmd.name, {
			description: desc,
			handler: cmd.context === "fork" ? createForkHandler(cmd) : createInlineHandler(cmd),
		});
	}
}
