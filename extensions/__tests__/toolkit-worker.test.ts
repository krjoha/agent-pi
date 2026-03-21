// ABOUTME: Tests toolkit CLI worker helpers and routing behavior.

import { describe, it, expect } from "vitest";
import { 
	isToolkitCliAgent,
	resolveToolkitWorkerModel,
	TOOLKIT_WORKER_MODEL,
	getToolkitWorkerArgs,
} from "../lib/toolkit-cli.ts";
import { resolveAgentModelString, type AgentModelsConfig } from "../lib/agent-defs.ts";

describe("toolkit CLI agent detection", () => {
	it("detects toolkit agents", () => {
		expect(isToolkitCliAgent("codex-agent")).toBe(true);
		expect(isToolkitCliAgent("CURSOR-AGENT")).toBe(true);
		expect(isToolkitCliAgent("builder")).toBe(false);
	});
});

describe("toolkit worker model resolution", () => {
	it("forces toolkit agents onto the shared worker model", () => {
		expect(resolveToolkitWorkerModel("codex-agent", "openai/gpt-4o")).toBe(TOOLKIT_WORKER_MODEL);
	});

	it("preserves non-toolkit fallback models", () => {
		expect(resolveToolkitWorkerModel("reviewer", "anthropic/claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
	});
});

describe("toolkit worker args", () => {
	it("builds pi args with the shared worker model", () => {
		const args = getToolkitWorkerArgs({
			name: "codex-agent",
			tools: "bash,read",
			systemPrompt: "Use Codex CLI",
		}, {
			task: "Analyze this project",
			sessionFile: "/tmp/session.jsonl",
		});

		expect(args).toContain("--model");
		expect(args).toContain(TOOLKIT_WORKER_MODEL);
		expect(args).toContain("--tools");
		expect(args).toContain("bash,read");
		expect(args).toContain("Analyze this project");
	});
});

describe("agent model config split", () => {
	const config: AgentModelsConfig = {
		default: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
		agents: {
			reviewer: { provider: "anthropic", model: "claude-opus-4-6" },
			"codex-agent": { provider: "openai-codex", model: "gpt-5.4" },
		},
	};

	it("still resolves normal agents from standard config", () => {
		expect(resolveAgentModelString("reviewer", config)).toBe("anthropic/claude-opus-4-6");
	});

	it("overrides toolkit agents to the shared worker model even if config differs", () => {
		expect(resolveAgentModelString("codex-agent", config)).toBe(TOOLKIT_WORKER_MODEL);
	});
});
