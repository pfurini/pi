/**
 * Fork-owned: reads this built-in's settings from Pi's global settings file, so every
 * ported extension is configured in one place (`~/.pi/agent/settings.json`), which the
 * fence already lets Pi read. The settings live under `forkBuiltins.<package directory>`:
 *
 *   { "forkBuiltins": { "rpiv-ask-user-question": { "collapseKey": "alt+o" } } }
 *
 * Only the global file is read, never a project's `.pi/settings.json`, because guidance
 * text reaches the model's prompt. A missing, unreadable or malformed file, or a missing
 * or non-object entry, returns undefined, and the caller uses its defaults. The entry is
 * returned unvalidated; the caller keeps only the fields whose types it checks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const FORK_SETTINGS_KEY = "forkBuiltins";

export function loadForkBuiltinSettings(directoryName: string): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		const content = readFileSync(join(getAgentDir(), "settings.json"), "utf8");
		parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
	} catch {
		return undefined;
	}
	const section = isObject(parsed) ? parsed[FORK_SETTINGS_KEY] : undefined;
	const entry = isObject(section) ? section[directoryName] : undefined;
	return isObject(entry) ? entry : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
