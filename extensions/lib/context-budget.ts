// ABOUTME: Pure functions for context window budget monitoring and error detection.
// ABOUTME: Provides budget level thresholds and identifies context-loss API errors.

export type BudgetLevel = "ok" | "warn" | "critical";

export function contextBudgetLevel(pct: number): BudgetLevel {
	if (pct >= 90) return "critical";
	if (pct >= 80) return "warn";
	return "ok";
}

export function isContextLossError(stderr: string): boolean {
	return /unexpected tool_use_id found in tool_result blocks/.test(stderr);
}
