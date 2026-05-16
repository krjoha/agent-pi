// ABOUTME: Completion Report Viewer — opens a GUI browser window showing work summary, file diffs, and rollback controls.
// ABOUTME: Gathers git diff data, renders interactive report with per-file rollback capability.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { outputLine } from "./lib/output-box.ts";
import { applyExtensionDefaults } from "./lib/themeMap.ts";
import { generateCompletionReportHTML, type ReportData, type ChangedFile } from "./lib/completion-report-html.ts";
import { createCompletionReportStandaloneExport, saveStandaloneExport } from "./lib/viewer-standalone-export.ts";
import { upsertPersistedReport } from "./lib/report-index.ts";
import { registerActiveViewer, clearActiveViewer, notifyViewerOpen } from "./lib/viewer-session.ts";

// ── Type Aliases ────────────────────────────────────────────────────

type GitRef = string;
type FilePath = string;
type DiffContent = string;
type CwdPath = string;

// ── Types ────────────────────────────────────────────────────────────

interface ReportResult {
	action: "done" | "rollback" | "closed";
	rolledBackFiles: string[];
}

// ── Git Helpers ──────────────────────────────────────────────────────

function execGit(cmd: string, cwd: CwdPath): string {
	try {
		return execSync(cmd, { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }).trim();
	} catch {
		return "";
	}
}

function isGitRepo(cwd: CwdPath): boolean {
	return execGit("git rev-parse --is-inside-work-tree", cwd) === "true";
}

/**
 * Auto-detect the best base ref to diff against.
 * Priority:
 * 1. Explicit base_ref parameter
 * 2. If there are staged/unstaged changes, diff against HEAD
 * 3. HEAD~1 (last commit)
 */
function resolveBaseRef(cwd: CwdPath, explicitRef?: GitRef): GitRef {
	if (explicitRef) return explicitRef;

	// Check if there are uncommitted changes (staged or unstaged)
	const status = execGit("git status --porcelain", cwd);
	if (status.length > 0) {
		return "HEAD";
	}

	// Default to last commit
	return "HEAD~1";
}

/**
 * Parse `git diff --numstat` output into file stats.
 */
function parseNumstat(output: string): Array<{ path: FilePath; additions: number; deletions: number }> {
	if (!output.trim()) return [];
	return output.split("\n").filter(Boolean).map((line) => {
		const [add, del, ...pathParts] = line.split("\t");
		const path = pathParts.join("\t"); // handle paths with tabs (renames show as old\tnew)
		return {
			path: path.replace(/.*=> /, "").replace(/[{}]/g, "").trim(),
			additions: add === "-" ? 0 : parseInt(add, 10),
			deletions: del === "-" ? 0 : parseInt(del, 10),
		};
	});
}

/**
 * Parse a git name-status line into { status, path, oldPath? }.
 */
function parseNameStatusLine(line: string): { status: ChangedFile["status"]; path: string; oldPath?: string } | null {
	const [rawStatus, ...parts] = line.split("\t");
	const status = rawStatus.toUpperCase();
	const filePath = parts[parts.length - 1];

	if (status.startsWith("R")) {
		return { status: "renamed", path: filePath, oldPath: parts[0] };
	}
	if (status === "A") return { status: "added", path: filePath };
	if (status === "D") return { status: "deleted", path: filePath };
	if (status === "M") return { status: "modified", path: filePath };
	return { status: "modified", path: filePath };
}

function parseGitNameStatus(output: string): Array<{ status: ChangedFile["status"]; path: string; oldPath?: string }> {
	if (!output.trim()) return [];
	return output.split("\n")
		.filter(Boolean)
		.map(parseNameStatusLine)
		.filter((r): r is NonNullable<typeof r> => r !== null);
}

function shouldSuppressReportFile(filePath: FilePath): boolean {
	const normalized = filePath.replace(/\\/g, "/");
	return normalized.startsWith(".context/test-exports/") ||
		normalized.startsWith(".context/reports/") ||
		normalized === "agent/extensions/lib/marked.min.js";
}

function summarizeSuppressedFile(filePath: FilePath): DiffContent {
	return [
		"@@ -0,0 +1,1 @@",
		`+Diff preview suppressed for generated or bulky artifact: ${filePath}`,
		"+Use copy/save/export or open the file directly if you need to inspect the full contents.",
	].join("\n");
}

function collectUncommittedStatus(cwd: CwdPath): Array<{ status: ChangedFile["status"]; path: FilePath; oldPath?: FilePath }> {
	const entries: Array<{ status: ChangedFile["status"]; path: string; oldPath?: string }> = [];
	entries.push(...parseGitNameStatus(execGit("git diff --name-status", cwd)));
	entries.push(...parseGitNameStatus(execGit("git diff --cached --name-status", cwd)));
	for (const filePath of execGit("git ls-files --others --exclude-standard", cwd).split("\n").filter(Boolean)) {
		entries.push({ status: "added", path: filePath });
	}
	return entries;
}

function collectCommittedStatus(cwd: CwdPath, baseRef: GitRef): Array<{ status: ChangedFile["status"]; path: FilePath; oldPath?: FilePath }> {
	return parseGitNameStatus(execGit(`git diff --name-status ${baseRef}`, cwd));
}

/**
 * Detect file status (added, modified, deleted, renamed).
 */
function getFileStatuses(cwd: CwdPath, baseRef: GitRef): Map<FilePath, { status: ChangedFile["status"]; oldPath?: FilePath }> {
	const entries = baseRef === "HEAD" ? collectUncommittedStatus(cwd) : collectCommittedStatus(cwd, baseRef);
	const statusMap = new Map<string, { status: ChangedFile["status"]; oldPath?: string }>();
	for (const entry of entries) {
		if (!statusMap.has(entry.path)) {
			statusMap.set(entry.path, { status: entry.status, oldPath: entry.oldPath });
		}
	}
	return statusMap;
}

/**
 * Gather per-file diff data for the report.
 */
function collectFileDiffs(
	cwd: CwdPath,
	resolvedRef: GitRef,
	statuses: Map<FilePath, { status: ChangedFile["status"]; oldPath?: FilePath }>,
): ChangedFile[] {
	const stats = parseNumstat(
		resolvedRef === "HEAD"
			? [execGit("git diff --numstat", cwd), execGit("git diff --cached --numstat", cwd)].filter(Boolean).join("\n")
			: execGit(`git diff --numstat ${resolvedRef}`, cwd),
	);

	const files: ChangedFile[] = [];
	for (const stat of stats) {
		const statusInfo = statuses.get(stat.path) || { status: "modified" as const };
		const diff = resolvedRef === "HEAD"
			? (execGit(`git diff -- "${stat.path}"`, cwd) || execGit(`git diff --cached -- "${stat.path}"`, cwd))
			: execGit(`git diff ${resolvedRef} -- "${stat.path}"`, cwd);

		files.push({
			path: stat.path,
			status: statusInfo.status,
			additions: stat.additions,
			deletions: stat.deletions,
			diff: shouldSuppressReportFile(stat.path) ? summarizeSuppressedFile(stat.path) : diff,
			oldPath: statusInfo.oldPath,
		});
	}
	return files;
}

function collectUntrackedFiles(cwd: CwdPath): ChangedFile[] {
	const untracked = execGit("git ls-files --others --exclude-standard", cwd);
	const files: ChangedFile[] = [];
	for (const filePath of untracked.split("\n").filter(Boolean)) {
		if (shouldSuppressReportFile(filePath)) {
			files.push({ path: filePath, status: "added", additions: 1, deletions: 0, diff: summarizeSuppressedFile(filePath) });
			continue;
		}
		let content = "";
		try { content = readFileSync(join(cwd, filePath), "utf-8"); } catch { content = "(binary or unreadable)"; }
		const lines = content.split("\n");
		const diff = lines.map((l) => `+${l}`).join("\n");
		files.push({ path: filePath, status: "added", additions: lines.length, deletions: 0, diff: `@@ -0,0 +1,${lines.length} @@\n${diff}` });
	}
	return files;
}

function readTaskMarkdown(cwd: CwdPath): string | undefined {
	const todoPath = join(cwd, ".context", "todo.md");
	if (!existsSync(todoPath)) return undefined;
	try { return readFileSync(todoPath, "utf-8"); } catch { return undefined; }
}

interface ReportOptions {
	cwd: CwdPath;
	title: string;
	summary: string;
	baseRef: GitRef;
}

/**
 * Gather all data needed for the completion report.
 */
function gatherReportData(opts: ReportOptions): ReportData {
	const { cwd, title, summary, baseRef } = opts;
	const resolvedRef = resolveBaseRef(cwd, baseRef);
	const statuses = getFileStatuses(cwd, resolvedRef);

	const files = collectFileDiffs(cwd, resolvedRef, statuses);

	if (resolvedRef === "HEAD") {
		const untracked = collectUntrackedFiles(cwd);
		for (const f of untracked) {
			if (!files.some((ef) => ef.path === f.path)) files.push(f);
		}
	}

	const statusOrder: Record<string, number> = { modified: 0, added: 1, deleted: 2, renamed: 3 };
	files.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

	const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
	const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

	return {
		title,
		summary,
		files,
		baseRef: resolvedRef,
		totalAdditions,
		totalDeletions,
		taskMarkdown: readTaskMarkdown(cwd),
	};
}

interface ReportMetaInput {
	cwd: string;
	title: string;
	summary: string;
	report: ReportData;
	result: ReportResult;
}

function buildReportMeta(input: ReportMetaInput): Record<string, unknown> {
	const { cwd, title, summary, report, result } = input;
	return {
		category: "completion",
		title,
		summary,
		sourcePath: join(cwd, ".context", "todo.md"),
		viewerPath: join(cwd, ".context", "todo.md"),
		viewerLabel: title,
		tags: ["completion", "git", "diff"],
		metadata: {
			baseRef: report.baseRef,
			fileCount: report.files.length,
			totalAdditions: report.totalAdditions,
			totalDeletions: report.totalDeletions,
			action: result.action,
			rolledBackFiles: result.rolledBackFiles,
		},
	};
}

function reportDetails(result: ReportResult, report: ReportData): Record<string, unknown> {
	return {
		action: result.action,
		rolledBackFiles: result.rolledBackFiles,
		totalFiles: report.files.length,
		totalAdditions: report.totalAdditions,
		totalDeletions: report.totalDeletions,
	};
}

function isEmptyResult(details: Record<string, unknown>): boolean {
	if (!details) return true;
	if (details.totalFiles === undefined && !details.content) return true;
	return false;
}

// ── HTTP Server ──────────────────────────────────────────────────────

function startReportServer(
	report: ReportData,
	cwd: string,
): Promise<{ port: number; server: Server; waitForResult: () => Promise<ReportResult> }> {
	return new Promise((resolveSetup) => {
		let resolveResult: (result: ReportResult) => void;
		let settled = false;
		const settle = (result: ReportResult) => {
			if (settled) return;
			settled = true;
			resolveResult!(result);
		};
		const resultPromise = new Promise<ReportResult>((res) => {
			resolveResult = res;
		});

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type");

			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			const url = new URL(req.url || "/", `http://localhost`);

			// Serve the main HTML page
			if (req.method === "GET" && url.pathname === "/") {
				const port = (server.address() as any)?.port || 0;
				const html = generateCompletionReportHTML({ report, port });
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(html);
				return;
			}

			// Serve the logo image
			if (req.method === "GET" && url.pathname === "/logo.png") {
				try {
					const logoPath = join(dirname(fileURLToPath(import.meta.url)), "assets", "agent-logo.png");
					const logoData = readFileSync(logoPath);
					res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" });
					res.end(logoData);
				} catch {
					res.writeHead(404);
					res.end();
				}
				return;
			}

			// Handle rollback
			if (req.method === "POST" && url.pathname === "/rollback") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const data = JSON.parse(body);
						const files: string[] = data.files || [];
						const baseRef: string = data.baseRef || "HEAD";
						const errors: string[] = [];

						for (const filePath of files) {
							try {
								if (baseRef === "HEAD") {
									// For uncommitted changes, checkout from HEAD
									execSync(`git checkout HEAD -- "${filePath}"`, { cwd, encoding: "utf-8" });
								} else {
									// For committed changes, checkout from the base ref
									execSync(`git checkout ${baseRef} -- "${filePath}"`, { cwd, encoding: "utf-8" });
								}
							} catch (err: any) {
								errors.push(`${filePath}: ${err.message}`);
							}
						}

						if (errors.length > 0) {
							res.writeHead(200, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ ok: false, error: errors.join("; ") }));
						} else {
							res.writeHead(200, { "Content-Type": "application/json" });
							res.end(JSON.stringify({ ok: true }));
						}
					} catch {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Invalid JSON" }));
					}
				});
				return;
			}

			// Handle result (done)
			if (req.method === "POST" && url.pathname === "/result") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const data = JSON.parse(body);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: true }));
						settle({
							action: data.action || "done",
							rolledBackFiles: data.rolledBackFiles || [],
						});
					} catch {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Invalid JSON" }));
					}
				});
				return;
			}

			// Handle save to desktop
			if (req.method === "POST" && url.pathname === "/save") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const data = JSON.parse(body);
						const desktop = join(homedir(), "Desktop");
						if (!existsSync(desktop)) mkdirSync(desktop, { recursive: true });
						const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
						const fileName = `report-${ts}.md`;
						const filePath = join(desktop, fileName);
						writeFileSync(filePath, data.content, "utf-8");
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: true, message: `Saved to ~/Desktop/${fileName}` }));
					} catch (err: any) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: err.message }));
					}
				});
				return;
			}

			if (req.method === "POST" && url.pathname === "/export-standalone") {
				try {
					const html = createCompletionReportStandaloneExport(report);
					const saved = saveStandaloneExport({ filePrefix: "report-readonly", html });
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: true, message: `Standalone export saved to ~/Desktop/${saved.fileName}` }));
				} catch (err: any) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: err.message }));
				}
				return;
			}

			// 404
			res.writeHead(404);
			res.end("Not found");
		});

		server.on("close", () => {
			settle({ action: "closed", rolledBackFiles: [] });
		});

		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as any;
			resolveSetup({
				port: addr.port,
				server,
				waitForResult: () => resultPromise,
			});
		});
	});
}

function openBrowser(url: string): void {
	try {
		execSync(`open "${url}"`, { stdio: "ignore" });
	} catch {
		try {
			execSync(`xdg-open "${url}"`, { stdio: "ignore" });
		} catch {
			try {
				execSync(`start "${url}"`, { stdio: "ignore" });
			} catch {}
		}
	}
}

// ── Tool Parameters ──────────────────────────────────────────────────

const ShowReportParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Title for the report (default: 'Completion Report')" })),
	summary: Type.Optional(Type.String({ description: "Markdown summary of the work done" })),
	base_ref: Type.Optional(Type.String({ description: "Git ref to diff against (default: auto-detect — HEAD for uncommitted changes, HEAD~1 for committed)" })),
});

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let activeServer: Server | null = null;
	let activeSession: { kind: "report"; title: string; url: string; server: Server; onClose: () => void } | null = null;

	function cleanupServer() {
		const server = activeServer;
		activeServer = null;
		if (server) {
			try { server.close(); } catch {}
		}
		if (activeSession) {
			clearActiveViewer(activeSession);
			activeSession = null;
		}
	}

	// ── show_report tool ─────────────────────────────────────────────

	pi.registerTool({
		name: "show_report",
		label: "Show Report",
		description:
			"Open a completion report viewer in the browser. Shows a summary of work done, " +
			"files changed with unified diffs, and per-file rollback controls.\n\n" +
			"Automatically gathers git diff data from the working directory. " +
			"Includes task completion data from .context/todo.md if available.\n\n" +
			"The user can review diffs, rollback individual files or all changes, " +
			"copy the report, or save it to the desktop.",
		parameters: ShowReportParams,

		async execute(...args: any[]) {
			const [, params, , , ctx] = args;
			const cwd = (ctx.cwd || process.cwd()) as CwdPath;

			if (!isGitRepo(cwd)) {
				return { content: [{ type: "text" as const, text: "Error: Not a git repository." }] };
			}

			const report = gatherReportData({
				cwd,
				title: (params as any).title || "Completion Report",
				summary: (params as any).summary || "",
				baseRef: (params as any).base_ref || "",
			});

			if (report.files.length === 0) {
				return { content: [{ type: "text" as const, text: "No file changes detected." }] };
			}

			cleanupServer();
			const { port, server, waitForResult } = await startReportServer(report, cwd);
			activeServer = server;

			const url = `http://127.0.0.1:${port}`;
			activeSession = { kind: "report", title: report.title, url, server, onClose: () => { activeServer = null; activeSession = null; } };
			registerActiveViewer(activeSession);
			openBrowser(url);
			notifyViewerOpen(ctx, activeSession);

			try {
				const result = await waitForResult();
				try { upsertPersistedReport(buildReportMeta({ cwd, title: report.title, summary: report.summary, report, result })); } catch {}
				const rolledBack = result.rolledBackFiles.length;
				const summary = rolledBack > 0
					? `Report closed. ${rolledBack} file${rolledBack > 1 ? "s" : ""} rolled back: ${result.rolledBackFiles.join(", ")}`
					: "Report closed. No files were rolled back.";
				return { content: [{ type: "text" as const, text: summary }], details: reportDetails(result, report) };
			} finally {
				cleanupServer();
			}
		},

		renderCall(args, theme) {
			const titleArg = (args as any).title || "Completion Report";
			const text =
				theme.fg("toolTitle", theme.bold("show_report ")) +
				theme.fg("success", titleArg);
			return new Text(outputLine(theme, "success", text), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = ((result as any).details || result) as any;
			if (isEmptyResult(details)) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const fileCount = details.totalFiles ?? 0;
			const totalAdditions = details.totalAdditions ?? 0;
			const totalDeletions = details.totalDeletions ?? 0;
			const rolledBack = (details.rolledBackFiles || []).length;
			const info = `Report closed — ${fileCount} files · +${totalAdditions} -${totalDeletions}`;

			if (rolledBack > 0) {
				return new Text(outputLine(theme, "warning", `${info} · ${rolledBack} rolled back`), 0, 0);
			}
			return new Text(outputLine(theme, "success", info), 0, 0);
		},
	});

	// ── /report command ──────────────────────────────────────────────

	pi.registerCommand("report", {
		description: "Open the completion report viewer for current git changes",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/report requires interactive mode", "error");
				return;
			}

			const cwd = ctx.cwd || process.cwd();

			if (!isGitRepo(cwd)) {
				ctx.ui.notify("Not a git repository", "error");
				return;
			}

			// Parse optional base ref from args
			const baseRef = args.trim() || "";
			const report = gatherReportData({ cwd, title: "Completion Report", summary: "", baseRef });

			if (report.files.length === 0) {
				ctx.ui.notify("No file changes detected", "info");
				return;
			}

			cleanupServer();

			const { port, server, waitForResult } = await startReportServer(report, cwd);
			activeServer = server;

			const url = `http://127.0.0.1:${port}`;
			activeSession = {
				kind: "report",
				title: "Completion Report",
				url,
				server,
				onClose: () => {
					activeServer = null;
					activeSession = null;
				},
			};
			registerActiveViewer(activeSession);
			openBrowser(url);
			notifyViewerOpen(ctx, activeSession);

			const result = await waitForResult();
			cleanupServer();

			if (result.rolledBackFiles.length > 0) {
				ctx.ui.notify(
					`Report closed — ${result.rolledBackFiles.length} file(s) rolled back`,
					"info",
				);
			} else {
				ctx.ui.notify("Report closed", "info");
			}
		},
	});

	// ── Session lifecycle ────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
	});

	pi.on("session_shutdown", async () => {
		cleanupServer();
	});
}
