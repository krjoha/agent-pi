// ARCHIVED — superseded by:
//   - @bergetai/pi-provider (upstream Berget.AI provider, installed globally)
//   - extensions/providers-sglang.ts (SGLang half only)
// Kept for reference; not loaded by Pi.
//
// ABOUTME: Registers two custom OpenAI-compatible providers — Berget.AI (EU cloud) and
// ABOUTME: local SGLang at http://10.99.99.85:8003 — alongside Pi's built-in providers.
/**
 * Registers Berget.AI and the local SGLang server as Pi providers.
 *
 * Berget auth: store the key in ~/.pi/agent/auth.json under the "berget"
 * entry (Pi's standard auth file format), or set BERGET_API_KEY in the
 * environment. Pi resolves the key via either path automatically.
 *
 * SGLang auth: none (Tailnet-only). Pi's openai-completions client still
 * sends an Authorization header, so a dummy "EMPTY" value is used.
 *
 * See docs/workflow-architecture.md sections 3.1 and 3.2 for the full
 * rationale and model assignments.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	// Berget.AI — EU cloud, OpenAI-compatible
	pi.registerProvider("berget", {
		name: "Berget.AI",
		baseUrl: "https://api.berget.ai/v1",
		apiKey: "BERGET_API_KEY",
		api: "openai-completions",
		authHeader: true,
		models: [
			{
				id: "zai-org/GLM-4.7-FP8",
				name: "GLM 4.7 FP8 (Berget)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 8192,
				compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
			},
			{
				id: "google/gemma-4-31B-it",
				name: "Gemma 4 31B IT (Berget)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 8192,
				compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
			},
			{
				id: "mistralai/Mistral-Medium-3.5-128B",
				name: "Mistral Medium 3.5 128B (Berget)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256_000,
				maxTokens: 8192,
				compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
			},
		],
	});

	// SGLang — local at 10.99.99.85:8003 over Tailnet (no auth)
	if (!process.env.SGLANG_API_KEY) {
		process.env.SGLANG_API_KEY = "EMPTY";
	}

	pi.registerProvider("sglang", {
		name: "SGLang (local Qwen3.6)",
		baseUrl: "http://10.99.99.85:8003/v1",
		apiKey: "SGLANG_API_KEY",
		api: "openai-completions",
		authHeader: true,
		models: [
			{
				id: "RedHatAI/Qwen3.6-35B-A3B-NVFP4",
				name: "Qwen3.6 35B A3B NVFP4 (local)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 262_000,
				maxTokens: 8192,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					thinkingFormat: "qwen-chat-template",
				},
			},
		],
	});
}
