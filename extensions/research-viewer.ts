// ABOUTME: Research sessions browser for autoresearch lifecycle tracking.
// ABOUTME: Opens a web viewer to browse, search, and resume saved research sessions.

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { outputLine } from "./lib/output-box.ts";
import { applyExtensionDefaults } from "./lib/themeMap.ts";
import { generateResearchViewerHTML } from "./lib/research-viewer-html.ts";
import {
	listResearchSessions,
	loadResearchSession,
	listResearchSessionsFull,
	type ResearchSessionSummary,
} from "./lib/research-session.ts";

function openBrowser(url: string): void {
	try { execSync(`open "${url}"`, { stdio: "ignore" }); } catch {
		try { execSync(`xdg-open "${url}"`, { stdio: "ignore" }); } catch {
			try { execSync(`start "${url}"`, { stdio: "ignore" }); } catch {}
		}
	}
}

function startResearchServer(title: string): Promise<{ port: number; server: Server; waitForResult: () => Promise<void> }> {
	return new Promise((resolveSetup) => {
		let resolveResult: () => void;
		const resultPromise = new Promise<void>((res) => { resolveResult = res; });
		let lastHeartbeat = Date.now();
		const heartbeatCheck = setInterval(() => {
			if (Date.now() - lastHeartbeat > 15_000) {
				clearInterval(heartbeatCheck);
				resolveResult!();
			}
		}, 5_000);

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type");
			if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
			const url = new URL(req.url || "/", "http://localhost");

			// Main page
			if (req.method === "GET" && url.pathname === "/") {
				const port = (server.address() as any)?.port || 0;
				const sessions = listResearchSessions();
				const html = generateResearchViewerHTML({ title, port, sessions });
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(html);
				return;
			}

			// Logo
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

			// Heartbeat
			if (req.method === "POST" && url.pathname === "/heartbeat") {
				lastHeartbeat = Date.now();
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
				return;
			}

			// API: List all sessions (summaries)
			if (req.method === "GET" && url.pathname === "/api/sessions") {
				const sessions = listResearchSessions();
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(sessions));
				return;
			}

			// API: Get single session (full detail)
			if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
				const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
				const session = loadResearchSession(id);
				if (session) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(session));
				} else {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Session not found" }));
				}
				return;
			}

			// Close
			if (req.method === "POST" && url.pathname === "/result") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
				resolveResult!();
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
				waitForResult: () => resultPromise.finally(() => clearInterval(heartbeatCheck)),
			});
		});
	});
}

const ShowResearchParams = Type.Object({
	title: Type.Optional(Type.String({ description: "Title for the research browser view" })),
	session_id: Type.Optional(Type.String({ description: "Open directly to a specific session's detail view" })),
});

export default function (pi: ExtensionAPI) {
	let activeServer: Server | null = null;
	function cleanupServer() {
		if (activeServer) {
			try { activeServer.close(); } catch {}
			activeServer = null;
		}
	}

	async function runViewer(ctx: ExtensionContext, title: string) {
		cleanupServer();
		const { port, server, waitForResult } = await startResearchServer(title);
		activeServer = server;
		const url = `http://127.0.0.1:${port}`;
		openBrowser(url);
		if (ctx.hasUI) ctx.ui.notify(`Research browser opened at ${url}`, "info");
		try {
			await waitForResult();
		} finally {
			cleanupServer();
		}
	}

	// ── show_research tool ───────────────────────────────────────────

	pi.registerTool({
		name: "show_research",
		label: "Show Research",
		description:
			"Open the research sessions browser. Browse, search, and resume saved autoresearch sessions.\n\n" +
			"Each session tracks the full lifecycle: goal → clarifying questions → plan → research iterations → findings → implementation.",
		parameters: ShowResearchParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = params as { title?: string; session_id?: string };
			await runViewer(ctx, p.title || "Research Sessions");
			return { content: [{ type: "text" as const, text: "Research browser closed." }] };
		},
		renderCall(args, theme) {
			const text = theme.fg("toolTitle", theme.bold("show_research ")) + theme.fg("accent", (args as any).title || "Research Sessions");
			return new Text(outputLine(theme, "accent", text), 0, 0);
		},
	});

	// ── /research command ────────────────────────────────────────────

	pi.registerCommand("research", {
		description: "Open the research sessions browser in the web viewer",
		handler: async (_args, ctx) => {
			await runViewer(ctx, "Research Sessions");
		},
	});

	// ── Lifecycle ────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
	});

	pi.on("session_shutdown", async () => {
		cleanupServer();
	});
}
