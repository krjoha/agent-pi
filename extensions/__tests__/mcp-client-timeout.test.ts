// ABOUTME: Tests for per-call timeout parameter in McpClient.callTool.
// ABOUTME: Validates that callTool respects explicit timeout overrides vs default.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

let McpClient: typeof import("../lib/mcp-client.ts").McpClient;

// ── Mock child_process ──────────────────────────────────────────────

function createMockProcess(): ChildProcess & {
	stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
	stdout: EventEmitter;
	stderr: EventEmitter;
} {
	const proc = new EventEmitter() as any;
	proc.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
	proc.stdout = new EventEmitter();
	(proc.stdout as any).setEncoding = vi.fn();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();
	proc.pid = 12345;
	return proc;
}

let lastMockProc: ReturnType<typeof createMockProcess>;

vi.mock("child_process", () => ({
	spawn: (..._args: any[]) => {
		lastMockProc = createMockProcess();
		return lastMockProc;
	},
}));

beforeEach(async () => {
	const mod = await import("../lib/mcp-client.ts");
	McpClient = mod.McpClient;
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── Helper: connect a client ─────────────────────────────────────────

async function connectClient(timeoutMs?: number): Promise<InstanceType<typeof McpClient>> {
	const client = new McpClient("/path/to/server.js", {}, timeoutMs);
	const p = client.connect();
	lastMockProc.stdout.emit("data", JSON.stringify({
		jsonrpc: "2.0", id: 1,
		result: { protocolVersion: "2024-11-05", capabilities: {} },
	}) + "\n");
	await p;
	return client;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("McpClient per-call timeout", () => {
	it("should use per-call timeout when provided", async () => {
		vi.useFakeTimers();

		const client = await connectClient(60_000); // default 60s

		// Call with explicit 100ms per-call timeout
		const callPromise = client.callTool("commander_add_log", { message: "test" }, 100);

		// Advance past per-call timeout but under default
		vi.advanceTimersByTime(200);

		await expect(callPromise).rejects.toThrow(/timeout/i);

		vi.useRealTimers();
	});

	it("should use default timeout when per-call timeout is not provided", async () => {
		vi.useFakeTimers();

		const client = await connectClient(500); // default 500ms

		const callPromise = client.callTool("commander_task", { operation: "list" });

		// Advance past default timeout
		vi.advanceTimersByTime(600);

		await expect(callPromise).rejects.toThrow(/timeout/i);

		vi.useRealTimers();
	});

	it("should not timeout before per-call timeout expires", async () => {
		vi.useFakeTimers();

		const client = await connectClient(100); // default 100ms

		const callPromise = client.callTool("commander_task", { operation: "list" }, 5000);

		// Advance past default timeout but under per-call timeout
		vi.advanceTimersByTime(200);

		// Should NOT have rejected yet — per-call timeout is 5000ms
		let rejected = false;
		callPromise.catch(() => { rejected = true; });
		await vi.advanceTimersByTimeAsync(0); // flush microtasks

		expect(rejected).toBe(false);

		vi.useRealTimers();
	});
});
