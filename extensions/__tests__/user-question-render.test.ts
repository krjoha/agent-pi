// ABOUTME: Tests for ask_user renderCall/renderResult and AskUserDetails structure
// ABOUTME: Validates details are populated correctly for each mode (select, input, confirm, cancelled)

import { describe, it, expect } from "vitest";

// ── Import the details builder ────────────────────────────────────────
import { buildAskUserDetails, type AskUserDetails } from "../lib/ask-user-details.ts";

// ── buildAskUserDetails Tests ─────────────────────────────────────────

describe("buildAskUserDetails", () => {
	describe("select mode", () => {
		it("should include mode, question, and selected answer", () => {
			const details = buildAskUserDetails({
				mode: "select",
				question: "Which approach?",
				answer: "Option A",
			});
			expect(details).toEqual({
				mode: "select",
				question: "Which approach?",
				answer: "Option A",
			});
		});

		it("should include selectedMarkdown when option has markdown", () => {
			const details = buildAskUserDetails({
				mode: "select",
				question: "Which layout?",
				answer: "Grid",
				selectedMarkdown: "## Grid Layout\nColumns with responsive breakpoints",
			});
			expect(details.selectedMarkdown).toBe("## Grid Layout\nColumns with responsive breakpoints");
		});

		it("should not include selectedMarkdown when option has no markdown", () => {
			const details = buildAskUserDetails({
				mode: "select",
				question: "Pick one",
				answer: "A",
			});
			expect(details.selectedMarkdown).toBeUndefined();
		});

		it("should mark cancelled when user cancels select", () => {
			const details = buildAskUserDetails({
				mode: "select",
				question: "Choose",
				cancelled: true,
			});
			expect(details.cancelled).toBe(true);
			expect(details.answer).toBeUndefined();
		});
	});

	describe("input mode", () => {
		it("should include mode, question, and user text", () => {
			const details = buildAskUserDetails({
				mode: "input",
				question: "Enter your name",
				answer: "Ricardo",
			});
			expect(details).toEqual({
				mode: "input",
				question: "Enter your name",
				answer: "Ricardo",
			});
		});

		it("should mark cancelled when user cancels input", () => {
			const details = buildAskUserDetails({
				mode: "input",
				question: "Enter value",
				cancelled: true,
			});
			expect(details.cancelled).toBe(true);
			expect(details.answer).toBeUndefined();
		});
	});

	describe("confirm mode", () => {
		it("should set answer to 'Yes' when confirmed", () => {
			const details = buildAskUserDetails({
				mode: "confirm",
				question: "Are you sure?",
				answer: "Yes",
			});
			expect(details.answer).toBe("Yes");
		});

		it("should set answer to 'No' when declined", () => {
			const details = buildAskUserDetails({
				mode: "confirm",
				question: "Delete file?",
				answer: "No",
			});
			expect(details.answer).toBe("No");
		});
	});

	describe("structure", () => {
		it("should always include mode and question", () => {
			const details = buildAskUserDetails({
				mode: "select",
				question: "Test?",
				answer: "X",
			});
			expect(details.mode).toBe("select");
			expect(details.question).toBe("Test?");
		});

		it("should omit undefined fields", () => {
			const details = buildAskUserDetails({
				mode: "input",
				question: "What?",
				answer: "Something",
			});
			expect("cancelled" in details).toBe(false);
			expect("selectedMarkdown" in details).toBe(false);
		});
	});
});
