// ABOUTME: Persists the selected theme name to Pi's user settings.json
// Called by theme-cycler after each successful setTheme() call.

import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const DEFAULT_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

/**
 * Write the chosen theme name into Pi's user settings.json so it survives
 * restarts. Silently catches errors — theme persistence is non-critical.
 */
export function persistTheme(name: string, settingsPath: string = DEFAULT_SETTINGS_PATH): void {
	try {
		const raw = readFileSync(settingsPath, "utf-8");
		const settings = JSON.parse(raw);
		settings.theme = name;
		writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
	} catch {
		// Non-critical — if we can't persist, the theme still works for this session
	}
}
