// ABOUTME: Resolves provider extension file paths so subagents spawned with
// ABOUTME: --no-extensions still load Berget, SGLang, and other registered providers.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

interface PiSettings {
	packages?: string[];
}

interface PiPackageJson {
	keywords?: string[];
	pi?: { extensions?: string[] };
}

/**
 * Best-effort global node_modules directory derived from process.execPath:
 *   <prefix>/bin/node  →  <prefix>/lib/node_modules
 * Works for nvm and standard installs; falls back to `/usr/local/lib/node_modules`.
 */
function getGlobalNodeModulesDir(): string {
	try {
		return path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules");
	} catch {
		return "/usr/local/lib/node_modules";
	}
}

function loadUserPiSettings(): PiSettings | null {
	const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	if (!fs.existsSync(settingsPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(settingsPath, "utf8")) as PiSettings;
	} catch {
		return null;
	}
}

function readPackageJson(pkgDir: string): PiPackageJson | null {
	const pkgJsonPath = path.join(pkgDir, "package.json");
	if (!fs.existsSync(pkgJsonPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as PiPackageJson;
	} catch {
		return null;
	}
}

function extensionPathsFromPackage(pkgDir: string, pkg: PiPackageJson): string[] {
	const out: string[] = [];
	for (const rel of pkg.pi?.extensions || []) {
		const abs = path.resolve(pkgDir, rel);
		if (fs.existsSync(abs)) out.push(abs);
	}
	return out;
}

/**
 * Return absolute paths to provider extensions that subagents need to load
 * explicitly because they spawn with `--no-extensions`.
 *
 * Sources:
 * 1. npm-installed packages from ~/.pi/agent/settings.json `packages` array
 *    that declare the "pi-provider" keyword in their package.json.
 * 2. The local `providers-sglang.ts` shipped with this extension project
 *    (registers the local SGLang inference server).
 */
export function resolveProviderExtensions(): string[] {
	const out: string[] = [];

	// 1. npm-installed provider packages
	const settings = loadUserPiSettings();
	if (settings?.packages?.length) {
		const globalModules = getGlobalNodeModulesDir();
		for (const entry of settings.packages) {
			if (!entry.startsWith("npm:")) continue;
			const pkgName = entry.slice("npm:".length);
			const pkgDir = path.join(globalModules, pkgName);
			const pkg = readPackageJson(pkgDir);
			if (!pkg) continue;
			const keywords = pkg.keywords || [];
			if (!keywords.includes("pi-provider")) continue;
			out.push(...extensionPathsFromPackage(pkgDir, pkg));
		}
	}

	// 2. Local SGLang provider extension (shipped with agent-pi)
	const extDir = path.dirname(fileURLToPath(import.meta.url));
	const sglangProvider = path.resolve(extDir, "..", "providers-sglang.ts");
	if (fs.existsSync(sglangProvider)) out.push(sglangProvider);

	return out;
}
