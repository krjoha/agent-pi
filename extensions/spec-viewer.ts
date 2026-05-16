// ABOUTME: Spec Viewer — opens a multi-page browser GUI for reviewing, commenting, and approving specifications.
// ABOUTME: Wizard-style navigation between spec docs, inline comment threads, visual asset gallery, markdown editing.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname, extname, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { outputLine } from "./lib/output-box.ts";
import { applyExtensionDefaults } from "./lib/themeMap.ts";
import { generateSpecViewerHTML, type SpecDocument } from "./lib/spec-viewer-html.ts";
import { createSpecStandaloneExport, loadVisualAsExportAsset, saveStandaloneExport, type SpecExportDocument } from "./lib/viewer-standalone-export.ts";
import { upsertPersistedReport } from "./lib/report-index.ts";
import { registerActiveViewer, clearActiveViewer, notifyViewerOpen } from "./lib/viewer-session.ts";

// ── Types ────────────────────────────────────────────────────────────

interface SpecComment {
	id: string;
	document: string;
	sectionId: string;
	sectionText: string;
	text: string;
	timestamp: string;
}

interface SpecViewerResult {
	action: "approved" | "changes_requested" | "declined";
	comments: SpecComment[];
	markdownChanges: Record<string, string>;
	modified: boolean;
}

// ── Type Aliases (reduce primitive obsession) ────────────────────────

type FolderPath = string;
type SpecAction = "approved" | "changes_requested" | "declined";
type DocumentKey = string;

// ── MIME Types ────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".html": "text/html",
	".htm": "text/html",
	".md": "text/markdown",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
};

// ── Folder Discovery ─────────────────────────────────────────────────

function discoverSpecDocument(
	key: string,
	label: string,
	path: string,
	filePath: string,
): SpecDocument | null {
	if (!existsSync(path)) return null;
	return { key, label, markdown: readFileSync(path, "utf-8"), filePath };
}

function discoverSpecMain(folderPath: string): SpecDocument | null {
	const specPath = join(folderPath, "spec.md");
	if (!existsSync(specPath)) return null;
	return { key: "spec", label: "Spec", markdown: readFileSync(specPath, "utf-8"), filePath: "spec.md" };
}

function discoverRequirements(folderPath: string): SpecDocument | null {
	const reqPath = join(folderPath, "planning", "requirements.md");
	if (!existsSync(reqPath)) return null;
	return { key: "requirements", label: "Requirements", markdown: readFileSync(reqPath, "utf-8"), filePath: "planning/requirements.md" };
}

function discoverTasks(folderPath: string): SpecDocument | null {
	const tasksPath = join(folderPath, "planning", "tasks.md");
	if (existsSync(tasksPath)) {
		return { key: "tasks", label: "Tasks", markdown: readFileSync(tasksPath, "utf-8"), filePath: "planning/tasks.md" };
	}
	try {
		const rootFiles = readdirSync(folderPath);
		const taskFile = rootFiles.find((f) => f.startsWith("tasks") && f.endsWith(".md"));
		if (taskFile) {
			return { key: "tasks", label: "Tasks", markdown: readFileSync(join(folderPath, taskFile), "utf-8"), filePath: taskFile };
		}
	} catch {}
	return null;
}

function discoverVisuals(folderPath: string): SpecDocument | null {
	const visualsDir = join(folderPath, "planning", "visuals");
	if (!existsSync(visualsDir)) return null;
	try {
		const visualFiles = readdirSync(visualsDir)
			.filter((f) => {
				const ext = extname(f).toLowerCase();
				return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".html", ".htm"].includes(ext);
			})
			.map((f) => join("planning", "visuals", f));
		if (visualFiles.length > 0) {
			return { key: "visuals", label: "Visuals", markdown: "", filePath: "planning/visuals/", isVisuals: true, visualFiles };
		}
	} catch {}
	return null;
}

function discoverPlanningExtras(folderPath: string): SpecDocument[] {
	const docs: SpecDocument[] = [];
	const planningDir = join(folderPath, "planning");
	if (!existsSync(planningDir)) return docs;
	try {
		const knownFiles = new Set(["requirements.md", "tasks.md", "initialization.md", "questions.md"]);
		const planningFiles = readdirSync(planningDir).filter((f) => f.endsWith(".md") && !knownFiles.has(f)).sort();
		for (const file of planningFiles) {
			docs.push({
				key: "other-" + file.replace(".md", ""),
				label: basename(file, ".md").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
				markdown: readFileSync(join(planningDir, file), "utf-8"),
				filePath: join("planning", file),
			});
		}
	} catch {}
	return docs;
}

function discoverSpecDocuments(folderPath: string): SpecDocument[] {
	const docs: SpecDocument[] = [];
	const push = (doc: SpecDocument | null) => { if (doc) docs.push(doc); };
	push(discoverSpecMain(folderPath));
	push(discoverRequirements(folderPath));
	push(discoverTasks(folderPath));
	push(discoverVisuals(folderPath));
	docs.push(...discoverPlanningExtras(folderPath));
	return docs;
}

// ── HTTP Server ──────────────────────────────────────────────────────

function buildStandaloneSpecDocuments(folderPath: string, documents: SpecDocument[], markdownChanges?: Record<string, string>): SpecExportDocument[] {
	return documents.map((doc) => {
		if (doc.isVisuals) {
			return {
				label: doc.label,
				filePath: doc.filePath,
				isVisuals: true,
				visuals: (doc.visualFiles || []).map((file) => loadVisualAsExportAsset(folderPath, file)),
			};
		}

		return {
			label: doc.label,
			filePath: doc.filePath,
			markdown: markdownChanges?.[doc.filePath] ?? doc.markdown,
		};
	});
}

function startSpecViewerServer(
	folderPath: string,
	documents: SpecDocument[],
	title: string,
	existingComments: SpecComment[],
): Promise<{ port: number; server: Server; waitForResult: () => Promise<SpecViewerResult> }> {
	return new Promise((resolveSetup) => {
		let resolveResult: (result: SpecViewerResult) => void;
		const resultPromise = new Promise<SpecViewerResult>((res) => {
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
				const html = generateSpecViewerHTML({
					documents,
					title,
					port,
					existingComments: JSON.stringify(existingComments),
				});
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(html);
				return;
			}

			// Serve the logo
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

			// Serve files from spec folder (path-restricted)
			if (req.method === "GET" && url.pathname === "/file") {
				const relPath = url.searchParams.get("path");
				if (!relPath) {
					res.writeHead(400);
					res.end("Missing path parameter");
					return;
				}

				// Security: prevent directory traversal
				const absPath = resolve(folderPath, relPath);
				const normalizedFolder = resolve(folderPath);
				if (!absPath.startsWith(normalizedFolder)) {
					res.writeHead(403);
					res.end("Access denied");
					return;
				}

				try {
					const data = readFileSync(absPath);
					const ext = extname(absPath).toLowerCase();
					const contentType = MIME_TYPES[ext] || "application/octet-stream";
					res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "public, max-age=300" });
					res.end(data);
				} catch {
					res.writeHead(404);
					res.end("File not found");
				}
				return;
			}

			// Handle result submission
			if (req.method === "POST" && url.pathname === "/result") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const data = JSON.parse(body);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: true }));
						resolveResult!({
							action: data.action || "declined",
							comments: data.comments || [],
							markdownChanges: data.markdownChanges || {},
							modified: data.modified || false,
						});
					} catch {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Invalid JSON" }));
					}
				});
				return;
			}

			// Save comments
			if (req.method === "POST" && url.pathname === "/save") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const data = JSON.parse(body);
						const commentsPath = join(folderPath, "spec-comments.json");
						writeFileSync(commentsPath, JSON.stringify({ comments: data.comments || [] }, null, 2), "utf-8");
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: true }));
					} catch (err: any) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: err.message }));
					}
				});
				return;
			}

			if (req.method === "POST" && url.pathname === "/export-standalone") {
				let body = "";
				req.on("data", (chunk) => { body += chunk; });
				req.on("end", () => {
					try {
						const data = JSON.parse(body || "{}");
						const exportDocs = buildStandaloneSpecDocuments(folderPath, documents, data.markdownChanges || {});
						const html = createSpecStandaloneExport({ title, documents: exportDocs });
						const saved = saveStandaloneExport({ filePrefix: "spec-readonly", html });
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: true, message: `Standalone export saved to ~/Desktop/${saved.fileName}` }));
					} catch (err: any) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: err.message }));
					}
				});
				return;
			}

			res.writeHead(404);
			res.end("Not found");
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

// ── Browser Helper ───────────────────────────────────────────────────

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

// ── Comment Formatting ───────────────────────────────────────────────

function formatCommentsForAgent(comments: SpecComment[]): string {
	if (comments.length === 0) return "(no comments)";

	const lines: string[] = [];
	for (const c of comments) {
		const docLabel = c.document.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
		lines.push(`[${docLabel}] ${c.sectionText}`);
		lines.push(`  → ${c.text}`);
		lines.push("");
	}
	return lines.join("\n").trim();
}

// ── Result Handling ────────────────────────────────────────────────────

function buildApprovedResponse(result: SpecViewerResult, folderPath: FolderPath, pi: ExtensionAPI) {
	const note = result.modified ? " (spec was edited by user — use the updated version)" : "";
	pi.sendMessage(
		{ customType: "spec-approved", content: `Spec approved! Proceed with implementation.${note}`, display: true },
		{ deliverAs: "followUp" as any, triggerTurn: true },
	);
	return {
		content: [{ type: "text" as const, text: `Spec approved by user.${note} Modified files have been saved.` }],
		details: { action: "approved" as const, modified: result.modified, folderPath },
	};
}

function buildChangesResponse(result: SpecViewerResult, folderPath: FolderPath, pi: ExtensionAPI) {
	const commentSummary = formatCommentsForAgent(result.comments);
	const note = result.modified ? "\n\nNote: Some documents were also edited inline — check the updated files." : "";
	pi.sendMessage(
		{ customType: "spec-changes-requested", content: `Changes requested on the spec. Here are the comments:\n\n${commentSummary}${note}`, display: true },
		{ deliverAs: "followUp" as any, triggerTurn: true },
	);
	return {
		content: [{ type: "text" as const, text: `User requested changes to the spec. Comments:\n\n${commentSummary}${note}` }],
		details: { action: "changes_requested" as const, comments: result.comments, modified: result.modified, folderPath },
	};
}

function buildDeclinedResponse(folderPath: FolderPath) {
	return {
		content: [{ type: "text" as const, text: "User closed the spec viewer without approving. Ask if they want changes or have feedback." }],
		details: { action: "declined" as const, folderPath },
	};
}

function handleSpecResult(
	result: SpecViewerResult,
	folderPath: FolderPath,
	pi: ExtensionAPI,
): { content: { type: string; text?: string }[]; details?: Record<string, unknown> } {
	if (result.action === "approved") return buildApprovedResponse(result, folderPath, pi);
	if (result.action === "changes_requested") return buildChangesResponse(result, folderPath, pi);
	return buildDeclinedResponse(folderPath);
}

// ── Render Helpers ───────────────────────────────────────────────────

function renderNoDetails(result: any): Text {
	const text = result.content[0];
	return new Text(text?.type === "text" ? text.text : "", 0, 0);
}

function renderApproved(details: any, theme: any): Text {
	const modNote = details.modified ? " (edited)" : "";
	return new Text(outputLine(theme, "success", `Spec approved${modNote}`), 0, 0);
}

function renderChangesRequested(details: any, theme: any): Text {
	const count = details.comments?.length || 0;
	return new Text(
		outputLine(theme, "warning", `Changes requested (${count} comment${count !== 1 ? "s" : ""})`),
		0, 0,
	);
}

function renderDeclined(theme: any): Text {
	return new Text(outputLine(theme, "warning", "Spec viewer closed without action"), 0, 0);
}

function renderSpecResult(result: any, theme: any): Text {
	const details = result.details as any;
	if (!details) return renderNoDetails(result);
	if (details.action === "approved") return renderApproved(details, theme);
	if (details.action === "changes_requested") return renderChangesRequested(details, theme);
	return renderDeclined(theme);
}

// ── Tool Execution Helper ────────────────────────────────────────────

async function executeShowSpec(
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	piRef: ExtensionAPI,
	runSpecViewer: (ctx: ExtensionContext, folderPath: FolderPath, title: string) => Promise<SpecViewerResult>,
) {
	const { folder_path, title: titleParam } = params as { folder_path: string; title?: string };
	const folderPath = resolve(folder_path);
	if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
		return { content: [{ type: "text" as const, text: `Error: folder not found: ${folder_path}` }] };
	}

	const displayTitle = titleParam || basename(folderPath);
	try {
		const result = await runSpecViewer(ctx, folderPath, displayTitle);
		return handleSpecResult(result, folder_path, piRef);
	} catch (err: any) {
		return { content: [{ type: "text" as const, text: `Spec viewer error: ${err.message}` }] };
	}
}

// ── Tool Parameters ──────────────────────────────────────────────────

const ShowSpecParams = Type.Object({
	folder_path: Type.String({ description: "Path to the spec folder (e.g. context-os/specs/2025-06-25-feature/)" }),
	title: Type.Optional(Type.String({ description: "Title to display in the viewer header" })),
});

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let piRef = pi;
	let activeServer: Server | null = null;
	let activeSession: { kind: "spec"; title: string; url: string; server: Server; onClose: () => void } | null = null;

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

	// ── Core viewer logic ────────────────────────────────────────────

	function loadExistingComments(folderPath: FolderPath): SpecComment[] {
		const commentsPath = join(folderPath, "spec-comments.json");
		if (!existsSync(commentsPath)) return [];
		try {
			const data = JSON.parse(readFileSync(commentsPath, "utf-8"));
			return data.comments || [];
		} catch { return []; }
	}

	function saveMarkdownChanges(changes: Record<string, string>, folderPath: FolderPath) {
		for (const [relPath, content] of Object.entries(changes)) {
			try {
				const absPath = resolve(folderPath, relPath);
				if (absPath.startsWith(resolve(folderPath))) {
					writeFileSync(absPath, content, "utf-8");
				}
			} catch { /* skip */ }
		}
	}

	function saveComments(comments: SpecComment[], folderPath: FolderPath) {
		if (!comments.length) return;
		try {
			const commentsPath = join(folderPath, "spec-comments.json");
			writeFileSync(commentsPath, JSON.stringify({ comments }, null, 2), "utf-8");
		} catch { /* skip */ }
	}

	function persistSpecReview(
		result: SpecViewerResult,
		folderPath: FolderPath,
		title: string,
		documentCount: number,
	) {
		const editedDocCount = result.markdownChanges ? Object.keys(result.markdownChanges).length : 0;
		try {
			upsertPersistedReport({
				category: "spec",
				title,
				summary: `${documentCount} document(s) reviewed${result.comments.length ? `, ${result.comments.length} comment(s)` : ""}`,
				sourcePath: folderPath,
				viewerPath: folderPath,
				viewerLabel: title,
				tags: ["spec", "review"],
				metadata: {
					action: result.action,
					modified: result.modified,
					commentCount: result.comments.length,
					editedDocCount,
					documentCount,
				},
			});
		} catch { /* skip */ }
	}

	interface ViewerSetup {
		ctx: ExtensionContext;
		folderPath: FolderPath;
		documents: SpecDocument[];
		title: string;
		existingComments: SpecComment[];
	}

	async function startAndRegisterViewer(setup: ViewerSetup) {
		const { ctx, folderPath, documents, title, existingComments } = setup;
		const { port, server, waitForResult } = await startSpecViewerServer(
			folderPath, documents, title, existingComments,
		);
		activeServer = server;

		const url = `http://127.0.0.1:${port}`;
		activeSession = {
			kind: "spec",
			title: "Spec viewer",
			url,
			server,
			onClose: () => { activeServer = null; activeSession = null; },
		};
		registerActiveViewer(activeSession);
		openBrowser(url);
		notifyViewerOpen(ctx, activeSession);
		return waitForResult;
	}

	async function runSpecViewer(
		ctx: ExtensionContext,
		folderPath: FolderPath,
		title: string,
	): Promise<SpecViewerResult> {
		cleanupServer();

		const documents = discoverSpecDocuments(folderPath);
		if (documents.length === 0) {
			throw new Error(`No spec documents found in ${folderPath}`);
		}

		const existingComments = loadExistingComments(folderPath);
		const waitForResult = await startAndRegisterViewer({ ctx, folderPath, documents, title, existingComments });

		try {
			const result = await waitForResult();

			if (result.modified && result.markdownChanges) {
				saveMarkdownChanges(result.markdownChanges, folderPath);
			}
			saveComments(result.comments, folderPath);
			persistSpecReview(result, folderPath, title, documents.length);

			return result;
		} finally {
			cleanupServer();
		}
	}

	// ── show_spec tool ───────────────────────────────────────────────

	pi.registerTool({
		name: "show_spec",
		label: "Show Spec",
		description:
			"Open a multi-page spec viewer in the browser. Displays all spec documents " +
			"(spec.md, requirements, tasks, visuals) as wizard steps with inline comment " +
			"threads and markdown editing. Takes a spec folder path and auto-discovers documents.\n\n" +
			"The user can:\n" +
			"- Navigate between documents using wizard steps\n" +
			"- Add inline comments on any section (Google Docs-style)\n" +
			"- Edit markdown in raw mode\n" +
			"- View visual assets in a gallery\n" +
			"- Approve the spec or request changes with comment feedback",
		parameters: ShowSpecParams,

		async execute(...args: any[]) {
			const [, params, , , ctx] = args;
			return executeShowSpec(params, ctx, piRef, runSpecViewer);
		},

		renderCall(args, theme) {
			const folderPath = (args as any).folder_path || "?";
			const titleArg = (args as any).title || "";
			const text =
				theme.fg("toolTitle", theme.bold("show_spec ")) +
				theme.fg("accent", folderPath) +
				(titleArg ? theme.fg("dim", ` — ${titleArg}`) : "");
			return new Text(outputLine(theme, "accent", text), 0, 0);
		},

		renderResult(result, _options, theme) {
			return renderSpecResult(result, theme);
		},
	});

	// ── /spec command ────────────────────────────────────────────────

	function notifySpecApproved(result: SpecViewerResult, ctx: ExtensionContext) {
		piRef.sendMessage(
			{
				customType: "spec-approved",
				content: `Spec approved! Proceed with implementation.${result.modified ? " (spec was edited)" : ""}`,
				display: true,
			},
			{ deliverAs: "followUp" as any, triggerTurn: true },
		);
		ctx.ui.notify("Spec approved — continuing...", "info");
	}

	function notifySpecChangesRequested(result: SpecViewerResult, ctx: ExtensionContext) {
		const commentSummary = formatCommentsForAgent(result.comments);
		piRef.sendMessage(
			{
				customType: "spec-changes-requested",
				content: `Changes requested:\n\n${commentSummary}`,
				display: true,
			},
			{ deliverAs: "followUp" as any, triggerTurn: true },
		);
		ctx.ui.notify("Changes requested — reviewing comments...", "info");
	}

	function handleSpecCommandResult(result: SpecViewerResult, ctx: ExtensionContext) {
		if (result.action === "approved") {
			notifySpecApproved(result, ctx);
		} else if (result.action === "changes_requested") {
			notifySpecChangesRequested(result, ctx);
		} else if (result.modified) {
			ctx.ui.notify("Spec was modified but no action taken.", "info");
		}
	}

	pi.registerCommand("spec", {
		description: "Open the spec viewer for a spec folder (e.g. /spec context-os/specs/2025-06-25-feature/)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/spec requires interactive mode", "error");
				return;
			}

			const folderPath = args.trim();
			if (!folderPath) {
				ctx.ui.notify("Usage: /spec <folder-path>", "error");
				return;
			}

			const resolved = resolve(folderPath);
			if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
				ctx.ui.notify(`Not a folder: ${folderPath}`, "error");
				return;
			}

			const displayTitle = basename(resolved);

			try {
				const result = await runSpecViewer(ctx, resolved, displayTitle);
				handleSpecCommandResult(result, ctx);
			} catch (err: any) {
				ctx.ui.notify(`Error: ${err.message}`, "error");
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
