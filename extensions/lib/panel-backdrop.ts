// ABOUTME: Panel backdrop utility for fullscreen overlay UIs
// ABOUTME: Centers a panel vertically, fills dark background, and clamps output to terminal height

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleWidth(s: string): number {
	return s.replace(ANSI_RE, "").length;
}

function truncateToVisible(s: string, maxWidth: number): string {
	let vis = 0;
	let result = "";
	let inEsc = false;
	for (const ch of s) {
		if (ch === "\x1b") { inEsc = true; result += ch; continue; }
		if (inEsc) { result += ch; if (/[A-Za-z]/.test(ch)) inEsc = false; continue; }
		if (vis >= maxWidth) break;
		result += ch;
		vis++;
	}
	return result;
}

/**
 * Renders a panel centered on a dark backdrop, always returning exactly `height` lines.
 * Truncates panelLines if they exceed available space.
 */
export function renderPanelBackdrop(
	panelLines: string[],
	panelW: number,
	width: number,
	height: number,
): string[] {
	if (height <= 0) return [];

	const dimBg = "\x1b[48;2;10;10;15m";
	const reset = "\x1b[0m";
	const darkRow = dimBg + " ".repeat(width) + reset;
	const padLeft = Math.max(0, Math.floor((width - panelW) / 2));
	const padLeftStr = dimBg + " ".repeat(padLeft);
	const padRightCount = Math.max(0, width - panelW - padLeft);
	const padRightStr = " ".repeat(padRightCount) + reset;

	// Clamp panel to available height (reserve at least 1 line top + 1 bottom padding)
	const maxPanel = Math.max(0, height - 2);
	const visible = panelLines.length > maxPanel ? panelLines.slice(0, maxPanel) : panelLines;

	const topPad = Math.max(1, Math.floor((height - visible.length) / 2));
	const result: string[] = [];

	for (let i = 0; i < topPad; i++) result.push(darkRow);
	for (const line of visible) {
		let assembled = padLeftStr + line + padRightStr;
		if (visibleWidth(assembled) > width) {
			assembled = truncateToVisible(assembled, width);
		}
		result.push(assembled);
	}
	while (result.length < height) result.push(darkRow);

	return result.slice(0, height);
}
