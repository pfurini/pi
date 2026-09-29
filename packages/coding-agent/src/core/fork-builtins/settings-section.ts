/**
 * Fork-owned: one fork built-in's section of Pi's `settings.json`, `forkBuiltins.<section>` (D20,
 * D48). The subagents and tasks settings read and write their sections through it: the value checks,
 * the section lookup, and the project writer the settings menus save through.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../config.ts";
import { stripBom } from "../../utils/text.ts";
import { FileSettingsStorage } from "../settings-manager.ts";
import { writeFileAtomically } from "./subagents/atomic-write.ts";

export type SettingCheck =
	| { kind: "integer"; min: number; max: number }
	| { kind: "boolean" }
	| { kind: "enum"; values: string[] };

export function describeSetting(check: SettingCheck): string {
	if (check.kind === "integer") return `an integer from ${check.min} to ${check.max}`;
	if (check.kind === "boolean") return "true or false";
	return `one of ${check.values.join(", ")}`;
}

export function acceptsSetting(check: SettingCheck, value: unknown): boolean {
	if (check.kind === "integer") {
		return typeof value === "number" && Number.isInteger(value) && value >= check.min && value <= check.max;
	}
	if (check.kind === "boolean") return typeof value === "boolean";
	return typeof value === "string" && check.values.includes(value);
}

/** `forkBuiltins.<section>` of one settings object; undefined when absent. */
export function forkBuiltinSection(settings: object, section: string): unknown {
	const forkBuiltins = (settings as { forkBuiltins?: unknown }).forkBuiltins;
	return typeof forkBuiltins === "object" && forkBuiltins !== null
		? (forkBuiltins as Record<string, unknown>)[section]
		: undefined;
}

/**
 * Replaces `forkBuiltins.<section>` in `<cwd>/.pi/settings.json` with `values`, under the settings
 * file lock, and leaves every other key as it was. A session's `SettingsManager` sees the change
 * after its next `reload()`. Each caller checks its values first.
 *
 * It writes nothing when `.pi` or `settings.json` is a symlink, dangling or not, so a save never
 * reaches a file outside the project. An existing file is replaced whole through
 * `writeFileAtomically`, so a failed write leaves it byte-identical. A missing file is created by
 * the settings storage.
 */
export function writeForkBuiltinProjectSection(cwd: string, section: string, label: string, values: object): void {
	const dir = join(cwd, ".pi");
	const file = join(dir, "settings.json");
	for (const path of [dir, file]) {
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
			throw new Error(`Refusing to write ${label} settings through a symlink: ${path}`);
		}
	}
	// The storage's agent directory only locates the global file, which this never touches.
	new FileSettingsStorage(cwd, getAgentDir()).withLock("project", (current) => {
		const parsed: unknown = current ? JSON.parse(stripBom(current)) : {};
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("The project settings.json does not hold a JSON object");
		}
		const settings = parsed as Record<string, unknown>;
		const forkBuiltins =
			typeof settings.forkBuiltins === "object" && settings.forkBuiltins !== null
				? (settings.forkBuiltins as Record<string, unknown>)
				: {};
		const text = `${JSON.stringify({ ...settings, forkBuiltins: { ...forkBuiltins, [section]: values } }, null, 2)}\n`;
		if (current === undefined) return text;
		// The storage writes in place; an existing file is replaced whole instead, and the storage writes nothing.
		writeFileAtomically(file, text);
		return undefined;
	});
}
