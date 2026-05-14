// ABOUTME: Output formatting utility for extension output
// ABOUTME: Used by renderCall/renderResult and widgets for consistent text formatting

/** Theme interface for output formatting */
export interface OutputBoxTheme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
	inverse?: (text: string) => string;
}

export type BarColor = "accent" | "success" | "error" | "dim" | "warning";

export interface ToolCallSummary {
	name: string;
	count: number;
	hint?: string;
}

/**
 * Render a single output line (plain, no colored bar).
 */
export function outputLine(_theme: OutputBoxTheme, _bar: BarColor, content: string): string {
	return content;
}

/**
 * Wrap multiple lines — returns them as-is (no colored bar).
 */
export function outputBox(_theme: OutputBoxTheme, _bar: BarColor, lines: string[]): string[] {
	return lines;
}

/**
 * Format a compact TOOLBOX summary line.
 * Example: `TOOLBOX: GREP (3x) src/auth.ts, READ (1x) config.json`
 */
export function formatToolbox(theme: OutputBoxTheme, tools: ToolCallSummary[]): string {
	const parts = tools.map(t => {
		const entry = `${t.name} (${t.count}x)`;
		return t.hint ? `${entry} ${t.hint}` : entry;
	});
	return theme.bold("TOOLBOX") + ": " + parts.join(", ");
}

// ── Status Button ─────────

export type AgentStatus = "idle" | "running" | "done" | "error";
export type PhaseStatus = "pending" | "active" | "done" | "error";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Theme type compatible with Pi's Theme — accepts any color type for fg */
interface StatusButtonTheme {
	fg: (color: any, text: string) => string;
	bold: (text: string) => string;
	inverse?: (text: string) => string;
}

/**
 * Generates a status button label with solid background color and bold white text.
 * Shows the agent/phase name inside the pill. For running/active status, includes animated braille spinner.
 */
export function statusButton(
	status: AgentStatus | PhaseStatus,
	label: string,
	theme: StatusButtonTheme,
	showAnimation: boolean = true,
): string {
	const inv = theme.inverse ? (t: string) => theme.inverse!(t) : (t: string) => t;

	switch (status) {
		case "running":
		case "active": {
			if (showAnimation) {
				const frame = BRAILLE_FRAMES[Math.floor(Date.now() / 80) % BRAILLE_FRAMES.length];
				return inv(theme.fg("accent", theme.bold(` ${frame} ${label} `)));
			} else {
				return inv(theme.fg("accent", theme.bold(` ${label} `)));
			}
		}
		case "done":
			return inv(theme.fg("success", theme.bold(` ${label} `)));
		case "error":
			return inv(theme.fg("error", theme.bold(` ${label} `)));
		case "idle":
		case "pending":
		default:
			return inv(theme.fg("dim", theme.bold(` ${label} `)));
	}
}
