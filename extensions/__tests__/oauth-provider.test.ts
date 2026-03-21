// ABOUTME: Tests for oauth-provider env-var bridging logic.
// ABOUTME: Ensures PI_CLAUDE_OAUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN bridge to ANTHROPIC_OAUTH_TOKEN.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bridgeOAuthEnvVar } from "../oauth-provider.ts";

describe("bridgeOAuthEnvVar", () => {
	const saved: Record<string, string | undefined> = {};

	beforeEach(() => {
		// Save and clear all relevant env vars
		for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "PI_CLAUDE_OAUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]) {
			saved[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		// Restore original env vars
		for (const [key, val] of Object.entries(saved)) {
			if (val === undefined) delete process.env[key];
			else process.env[key] = val;
		}
	});

	it("should set ANTHROPIC_OAUTH_TOKEN from PI_CLAUDE_OAUTH_TOKEN", () => {
		process.env.PI_CLAUDE_OAUTH_TOKEN = "pi-token-123";
		bridgeOAuthEnvVar();
		expect(process.env.ANTHROPIC_OAUTH_TOKEN).toBe("pi-token-123");
	});

	it("should set ANTHROPIC_OAUTH_TOKEN from CLAUDE_CODE_OAUTH_TOKEN", () => {
		process.env.CLAUDE_CODE_OAUTH_TOKEN = "cc-token-456";
		bridgeOAuthEnvVar();
		expect(process.env.ANTHROPIC_OAUTH_TOKEN).toBe("cc-token-456");
	});

	it("should prefer CLAUDE_CODE_OAUTH_TOKEN over PI_CLAUDE_OAUTH_TOKEN", () => {
		process.env.CLAUDE_CODE_OAUTH_TOKEN = "primary";
		process.env.PI_CLAUDE_OAUTH_TOKEN = "alias";
		bridgeOAuthEnvVar();
		expect(process.env.ANTHROPIC_OAUTH_TOKEN).toBe("primary");
	});

	it("should not overwrite existing ANTHROPIC_OAUTH_TOKEN", () => {
		process.env.ANTHROPIC_OAUTH_TOKEN = "already-set";
		process.env.PI_CLAUDE_OAUTH_TOKEN = "pi-token";
		bridgeOAuthEnvVar();
		expect(process.env.ANTHROPIC_OAUTH_TOKEN).toBe("already-set");
	});

	it("should do nothing when no env vars are set", () => {
		bridgeOAuthEnvVar();
		expect(process.env.ANTHROPIC_OAUTH_TOKEN).toBeUndefined();
	});
});
