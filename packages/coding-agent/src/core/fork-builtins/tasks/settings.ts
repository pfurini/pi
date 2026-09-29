/**
 * Fork-owned: task settings under `forkBuiltins.tasks` in Pi's global and project `settings.json`
 * (D48). The project value wins, and is read only in a trusted project. Keys and defaults follow
 * pi-tasks `src/tasks-config.ts` at 83480bd, without the dropped scopes, the auto-cascade, custom
 * sort specs and custom glyphs (D49). A value of the wrong type or out of range is dropped with one
 * warning per key.
 */
import type { SettingsManager } from "../../settings-manager.ts";
import {
	acceptsSetting,
	describeSetting,
	forkBuiltinSection,
	type SettingCheck,
	writeForkBuiltinProjectSection,
} from "../settings-section.ts";

export type TaskScope = "session" | "memory";
export type AutoClearMode = "never" | "on_list_complete" | "on_task_complete";
export type TaskSortOrder = "id" | "status" | "active" | "recent" | "oldest";

export interface TaskSettings {
	/** `session` saves one file per session in the workspace; `memory` saves nothing. */
	taskScope: TaskScope;
	autoClearCompleted: AutoClearMode;
	/** The widget shows one `N completed` line instead of the completed rows. */
	collapseCompleted: boolean;
	/** The widget shows every row, whatever `maxVisible` says. */
	showAll: boolean;
	maxVisible: number;
	sortOrder: TaskSortOrder;
	/** Which end of the list the widget hides when rows exceed `maxVisible`. */
	hiddenAt: "top" | "bottom";
}

export const DEFAULT_TASK_SETTINGS: Readonly<TaskSettings> = {
	taskScope: "session",
	autoClearCompleted: "on_list_complete",
	collapseCompleted: false,
	showAll: false,
	maxVisible: 10,
	sortOrder: "id",
	hiddenAt: "bottom",
};

const CHECKS: Record<keyof TaskSettings, SettingCheck> = {
	taskScope: { kind: "enum", values: ["session", "memory"] },
	autoClearCompleted: { kind: "enum", values: ["never", "on_list_complete", "on_task_complete"] },
	collapseCompleted: { kind: "boolean" },
	showAll: { kind: "boolean" },
	maxVisible: { kind: "integer", min: 1, max: 1000 },
	sortOrder: { kind: "enum", values: ["id", "status", "active", "recent", "oldest"] },
	hiddenAt: { kind: "enum", values: ["bottom", "top"] },
};

/** Every settings key, in the settings menu's order. */
export const TASK_SETTING_KEYS = Object.keys(CHECKS) as Array<keyof TaskSettings>;

/** The valid keys of one scope's `forkBuiltins.tasks` object; each invalid key adds one warning. */
export function sanitizeTaskSettings(
	raw: unknown,
	scope: "global" | "project",
): { values: Partial<TaskSettings>; warnings: string[] } {
	const values: Partial<TaskSettings> = {};
	const warnings: string[] = [];
	if (raw === undefined) return { values, warnings };
	const where = `forkBuiltins.tasks in the ${scope} settings.json`;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { values, warnings: [`${where} must be an object; it is ignored.`] };
	}
	for (const [key, value] of Object.entries(raw)) {
		// Own keys only: a key such as `toString` must not reach `Object.prototype`.
		const check = Object.hasOwn(CHECKS, key) ? CHECKS[key as keyof TaskSettings] : undefined;
		if (!check) warnings.push(`${where}: unknown key ${key}; it is ignored.`);
		else if (acceptsSetting(check, value)) (values as Record<string, unknown>)[key] = value;
		else warnings.push(`${where}: ${key} must be ${describeSetting(check)}; it is ignored.`);
	}
	return { values, warnings };
}

/** The effective settings: defaults, then the global values, then the project values. */
export function readTaskSettings(settingsManager: SettingsManager): {
	settings: Readonly<TaskSettings>;
	warnings: string[];
} {
	const global = sanitizeTaskSettings(forkBuiltinSection(settingsManager.getGlobalSettings(), "tasks"), "global");
	const project = sanitizeTaskSettings(forkBuiltinSection(settingsManager.getProjectSettings(), "tasks"), "project");
	return {
		settings: Object.freeze({ ...DEFAULT_TASK_SETTINGS, ...global.values, ...project.values }),
		warnings: [...global.warnings, ...project.warnings],
	};
}

/** The project's own valid task values, without defaults or global values. Empty in an untrusted project. */
export function projectTaskValues(settingsManager: Pick<SettingsManager, "getProjectSettings">): Partial<TaskSettings> {
	return sanitizeTaskSettings(forkBuiltinSection(settingsManager.getProjectSettings(), "tasks"), "project").values;
}

/** Replaces `forkBuiltins.tasks` in the project `settings.json`; refuses a value the reader would drop. */
export function writeProjectTaskSettings(cwd: string, values: Partial<TaskSettings>): void {
	const { warnings } = sanitizeTaskSettings(values, "project");
	if (warnings.length > 0) {
		const reasons = warnings.map((warning) => warning.replace(/; it is ignored\.$/, "."));
		throw new Error(`Refusing to write task settings: ${reasons.join(" ")}`);
	}
	writeForkBuiltinProjectSection(cwd, "tasks", "task", values);
}
