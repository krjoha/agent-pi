// ABOUTME: Agent email sending extension — enables agents to send emails via AgentMail through Commander.
// ABOUTME: Registers a send_email tool that proxies to commander_agentmail for reports, briefings, and custom emails.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";

// ── Types ────────────────────────────────────────────────────────────

interface SendEmailParams {
	to?: string;
	subject?: string;
	body?: string;
	html?: string;
	type?: "generic" | "report" | "briefing";
	report_name?: string;
	format?: "markdown" | "html" | "text";
}

interface EmailResult {
	content: Array<{ type: "text"; text: string }>;
	details: { success: false; error: string } | { success: true };
}

// ── Validation ───────────────────────────────────────────────────────

function validateCommanderAvailable(): EmailResult | null {
	const gate = (globalThis as any).__piCommanderGate;
	if (gate?.status === "available") return null;
	return {
		content: [{ type: "text", text: "Email sending failed: Commander is not connected. The send_email tool requires Commander with AgentMail configured." }],
		details: { success: false, error: "commander_not_available" },
	};
}

// ── Parameter Builders ───────────────────────────────────────────────

function addOptionalTo(
	params: Record<string, string | undefined>,
	to: string | undefined,
): Record<string, string | undefined> {
	if (to) params.to = to;
	return params;
}

function hasContent(p: SendEmailParams): boolean {
	return Boolean(p.body || p.html);
}

// ── Validation ───────────────────────────────────────────────────────

function validateReport(p: SendEmailParams): EmailResult | null {
	if (hasContent(p)) return null;
	return {
		content: [{ type: "text", text: "Email sending failed: 'body' content is required for report emails." }],
		details: { success: false, error: "missing_content" },
	};
}

function validateBriefing(p: SendEmailParams): EmailResult | null {
	if (p.body) return null;
	return {
		content: [{ type: "text", text: "Email sending failed: 'body' content is required for briefing emails." }],
		details: { success: false, error: "missing_content" },
	};
}

function validateGeneric(p: SendEmailParams): EmailResult | null {
	if (!p.subject) {
		return {
			content: [{ type: "text", text: "Email sending failed: 'subject' is required for generic emails." }],
			details: { success: false, error: "missing_subject" },
		};
	}
	if (!hasContent(p)) {
		return {
			content: [{ type: "text", text: "Email sending failed: 'body' or 'html' is required for generic emails." }],
			details: { success: false, error: "missing_body" },
		};
	}
	return null;
}

const VALIDATORS: Record<string, (p: SendEmailParams) => EmailResult | null> = {
	report: validateReport,
	briefing: validateBriefing,
	generic: validateGeneric,
};

function validateEmailParams(p: SendEmailParams): EmailResult | null {
	const emailType = (p.type || "generic").toLowerCase();
	const validator = VALIDATORS[emailType] || validateGeneric;
	return validator(p);
}

// ── Parameter Builders ───────────────────────────────────────────────

function buildReportParams(p: SendEmailParams): Record<string, string | undefined> {
	return addOptionalTo({
		operation: "send:report",
		report_name: p.report_name || p.subject || "Completion Report",
		content: p.html || p.body,
		format: p.html ? "html" : (p.format || "markdown"),
	}, p.to);
}

function buildBriefingParams(p: SendEmailParams): Record<string, string | undefined> {
	return addOptionalTo({
		operation: "send:briefing",
		content: p.body,
	}, p.to);
}

function buildGenericParams(p: SendEmailParams): Record<string, string | undefined> {
	return addOptionalTo({
		operation: "send:custom",
		subject: p.subject,
		content: p.html || p.body,
		format: p.html ? "html" : (p.format || "markdown"),
	}, p.to);
}

function buildEmailParams(p: SendEmailParams): Record<string, string | undefined> {
	const emailType = (p.type || "generic").toLowerCase();

	const builders: Record<string, (p: SendEmailParams) => Record<string, string | undefined>> = {
		report: buildReportParams,
		briefing: buildBriefingParams,
		generic: buildGenericParams,
	};

	const builder = builders[emailType] || buildGenericParams;
	return builder(p);
}

// ── Email Dispatch ───────────────────────────────────────────────────

async function callViaContext(ctx: unknown, params: Record<string, string | undefined>): Promise<unknown> {
	const context = ctx as { callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown> };
	if (typeof context?.callTool !== "function") return undefined;
	return context.callTool("commander_agentmail", params);
}

async function callViaGlobalPi(params: Record<string, string | undefined>): Promise<unknown> {
	const piGlobal = (globalThis as any).__piInstance || (globalThis as any).__pi;
	if (typeof piGlobal?.callTool !== "function") return undefined;
	return piGlobal.callTool("commander_agentmail", params);
}

async function callViaMcpClient(params: Record<string, string | undefined>): Promise<unknown> {
	const McpClientModule = await import("./lib/mcp-client.ts");
	const serverPath = "/Users/ricardo/Workshop/Github-Work/commander/services/commander-mcp/dist/server.js";
	const client = new McpClientModule.McpClient(serverPath, {
		COMMANDER_WS_URL: process.env.COMMANDER_WS_URL || "ws://localhost:9002",
		AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY || "",
	});

	try {
		await client.connect();
		return await client.callTool("commander_agentmail", params);
	} finally {
		try { client.disconnect(); } catch { /* ignore */ }
	}
}

async function dispatchEmail(
	ctx: unknown,
	params: Record<string, string | undefined>,
): Promise<EmailResult> {
	try {
		const result = await callViaContext(ctx, params);
		if (result !== undefined) return result as EmailResult;

		const piResult = await callViaGlobalPi(params);
		if (piResult !== undefined) return piResult as EmailResult;

		return await callViaMcpClient(params) as EmailResult;
	} catch (err: any) {
		return {
			content: [{ type: "text", text: `Email sending failed: ${err.message}` }],
			details: { success: false, error: err.message },
		};
	}
}

// ── Result Rendering ───────────────────────────────────────────────

function isFailedResult(details: unknown, textStr: string): boolean {
	if ((details as any)?.error) return true;
	const lower = textStr.toLowerCase();
	return lower.includes("fail") || lower.includes("error");
}

function buildResultMessage(details: unknown, textStr: string): string {
	const error = (details as any)?.error;
	return `send_email failed: ${error || textStr}`;
}

// ── Tool Handlers ────────────────────────────────────────────────────

async function handleSendEmail(params: unknown, ctx: unknown): Promise<EmailResult> {
	const p = params as SendEmailParams;

	const commanderError = validateCommanderAvailable();
	if (commanderError) return commanderError;

	const validationError = validateEmailParams(p);
	if (validationError) return validationError;

	const agentmailParams = buildEmailParams(p);
	return dispatchEmail(ctx, agentmailParams);
}

function renderSendEmailCall(args: unknown, theme: any): Text {
	const p = args as SendEmailParams;
	const type = p.type || "generic";
	const to = p.to || "default";
	const label = `${type} → ${to}`;
	return new Text(theme.fg("toolTitle", theme.bold("send_email ")) + theme.fg("accent", label), 0, 0);
}

function renderSendEmailResult(result: any, theme: any): Text {
	const details = result.details;
	const text = result.content?.[0];
	const textStr = text?.type === "text" ? text.text : "";

	if (isFailedResult(details, textStr)) {
		return new Text(theme.fg("error", buildResultMessage(details, textStr)), 0, 0);
	}

	return new Text(theme.fg("success", `send_email ✓ ${textStr || "sent"}`), 0, 0);
}

// ── Tool Registration ────────────────────────────────────────────────

export default function registerSendEmail(pi: ExtensionAPI) {
	pi.registerTool({
		name: "send_email",
		label: "Send Email",
		description: [
			"Send an email via AgentMail through the Commander assistant.",
			"Uses the same email system as Commander reports and briefings.",
			"Default recipient: ruizrica2@gmail.com",
			"",
			"Three modes:",
			"  generic  — send a custom email with subject and body/content",
			"  report   — send a formatted report (markdown auto-converted to styled HTML)",
			"  briefing — send a morning briefing email",
			"",
			"Content supports markdown (auto-converted to HTML), raw HTML, or plain text.",
			"",
			"Examples:",
			'  { type: "report", report_name: "Feature Complete", body: "## Summary\\nAdded auth..." }',
			'  { type: "generic", subject: "Build Results", body: "All 42 tests passed." }',
			'  { type: "generic", to: "team@example.com", subject: "Deploy Done", body: "v2.1 is live" }',
		].join("\n"),
		parameters: Type.Object({
			to: Type.Optional(Type.String({ description: "Recipient email address. Default: ruizrica2@gmail.com" })),
			subject: Type.Optional(Type.String({ description: "Email subject line (required for generic, auto-generated for report/briefing)." })),
			body: Type.Optional(Type.String({ description: "Email body content — markdown (default), HTML, or plain text." })),
			html: Type.Optional(Type.String({ description: "Raw HTML email body (overrides body)." })),
			type: Type.Optional(Type.String({ description: "Email type: 'generic' (default), 'report', or 'briefing'." })),
			report_name: Type.Optional(Type.String({ description: "Report name for subject line (for report type)." })),
			format: Type.Optional(Type.String({ description: "Content format: 'markdown' (default), 'html', 'text'." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return handleSendEmail(params, ctx);
		},

		renderCall(args, theme) {
			return renderSendEmailCall(args, theme);
		},

		renderResult(result, _options, theme) {
			return renderSendEmailResult(result, theme);
		},
	});
}
