// ABOUTME: Pure functions for context compaction gate — determines when to warn, prep, or force-compact.
// ABOUTME: Two-phase proactive compaction: prep at 70%, hard stop at 80%. Core framework handles actual compaction.

export const PREP_THRESHOLD = 70;
export const COMPACT_THRESHOLD = 80;

export interface CompactionGateResult {
	block: boolean;
	reason?: string;
	level: "ok" | "warn";
}

export type CompactionPhase = "ok" | "prep" | "compact";

export interface ProactiveCompactionResult {
	phase: CompactionPhase;
	percent: number;
}

/**
 * Check context usage and return warning status.
 * Never blocks — the core auto-compaction handles compaction properly
 * with auto_compaction_start/end events that trigger UI rebuild.
 */
export function shouldWarnForCompaction(percent: number | undefined): CompactionGateResult {
	if (percent == null) return { block: false, level: "ok" };
	if (percent >= PREP_THRESHOLD) return {
		block: false,
		level: "warn",
	};
	return { block: false, level: "ok" };
}

/**
 * Two-phase proactive compaction check:
 *   70%+ → "prep"    — LLM should wrap up current work, commit progress
 *   80%+ → "compact" — LLM must call cycle_memory immediately
 *   <70% → "ok"      — no action needed
 */
export function getProactiveCompactionPhase(percent: number | undefined): ProactiveCompactionResult {
	if (percent == null) return { phase: "ok", percent: 0 };
	if (percent >= COMPACT_THRESHOLD) return { phase: "compact", percent };
	if (percent >= PREP_THRESHOLD) return { phase: "prep", percent };
	return { phase: "ok", percent };
}
