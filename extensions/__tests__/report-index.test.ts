// ABOUTME: Tests for report-index lazy SQLite loading and JSON fallback.
// ABOUTME: Verifies module loads without error even when node:sqlite is unavailable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const TEST_DIR = resolve(".context", "reports-test-" + process.pid);
const INDEX_PATH = join(TEST_DIR, "index.json");

describe("report-index", () => {
	describe("loads without node:sqlite", () => {
		it("should import report-index without throwing when node:sqlite is missing", async () => {
			// On Node v20, node:sqlite doesn't exist — the module should still load
			const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
			if (nodeVersion >= 22) {
				// On Node 22+, sqlite is available — just verify import works
				const mod = await import("../lib/report-index.js");
				expect(mod.loadReportIndex).toBeDefined();
				expect(mod.upsertPersistedReport).toBeDefined();
				return;
			}

			// On Node <22, verify the module loads without throwing
			const mod = await import("../lib/report-index.js");
			expect(mod.loadReportIndex).toBeDefined();
			expect(mod.upsertPersistedReport).toBeDefined();
			expect(mod.buildReportSearchText).toBeDefined();
		});

		it("should return entries from JSON fallback when sqlite is unavailable", async () => {
			const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
			if (nodeVersion >= 22) return; // skip — sqlite available

			const mod = await import("../lib/report-index.js");
			const index = mod.loadReportIndex();
			expect(index).toHaveProperty("version", 1);
			expect(index).toHaveProperty("entries");
			expect(Array.isArray(index.entries)).toBe(true);
		});
	});

	describe("buildReportSearchText (pure function)", () => {
		it("should combine fields into search text", async () => {
			const { buildReportSearchText } = await import("../lib/report-index.js");
			const text = buildReportSearchText({
				category: "plan",
				title: "Test Plan",
				summary: "A test summary",
				tags: ["tag1", "tag2"],
			});
			expect(text).toContain("plan");
			expect(text).toContain("Test Plan");
			expect(text).toContain("A test summary");
			expect(text).toContain("tag1");
		});
	});
});
