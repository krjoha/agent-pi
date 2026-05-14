// ABOUTME: Registers the local SGLang server (Qwen3.6-35B-A3B-NVFP4) as a Pi provider.
// ABOUTME: Berget.AI is handled by the upstream @bergetai/pi-provider package, not here.
/**
 * Registers the local SGLang inference server as a Pi provider.
 *
 * Auth: none (Tailnet-only). Pi's openai-completions client still
 * sends an Authorization header, so a dummy "EMPTY" value is used.
 *
 * Berget.AI is now provided by the upstream `@bergetai/pi-provider` npm
 * package (installed globally via `pi install npm:@bergetai/pi-provider`
 * or `npx berget code init`). Do not re-register "berget" here.
 *
 * See docs/workflow-architecture.md section 3.2 for SGLang rationale.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
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
