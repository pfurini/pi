/**
 * Fork-owned: subagent settings under `forkBuiltins.subagents` in Pi's global and project
 * `settings.json` (D20). The project value wins, and is read only in a trusted project. Keys,
 * defaults and ranges follow pi-subagents `src/settings.ts` at 79a7c42, without `workflowsEnabled`
 * and `schedulingEnabled` (D17) and without the boolean spelling of `agentMentions`. A value of the
 * wrong type or out of range is dropped with one warning per key.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../../../config.ts";
import { stripBom } from "../../../../utils/text.ts";
import { FileSettingsStorage, type SettingsManager } from "../../../settings-manager.ts";
import { writeFileAtomically } from "../atomic-write.ts";

export type JoinMode = "async" | "group" | "smart";
export type ToolDescriptionMode = "full" | "compact" | "custom";
export type AgentMentionMode = "model" | "direct" | "off";
export type WidgetMode = "all" | "background" | "off";
export type ViewerMarkdownMode = "off" | "assistant" | "all";

export interface SubagentSettings {
	/** Background pool size. */
	maxConcurrent: number;
	/** Foreground pool size; 0 means unlimited. */
	maxConcurrentForeground: number;
	/** Turn limit for agents that set none; 0 means unlimited. */
	defaultMaxTurns: number;
	/** Turns an agent gets after the wrap-up message before a hard abort. */
	graceTurns: number;
	defaultJoinMode: JoinMode;
	/** What an `Agent` call that does not set `run_in_background` means, at the top level. */
	backgroundByDefault: boolean;
	/** Validate each spawn's model against `enabledModels`. */
	scopeModels: boolean;
	/** An unreadable agent file or an unknown frontmatter key fails the load. */
	strictAgentFiles: boolean;
	disableDefaultAgents: boolean;
	toolDescriptionMode: ToolDescriptionMode;
	fleetView: boolean;
	agentMentions: AgentMentionMode;
	/** Persist top-level subagent sessions unless an agent's `persist_session` says otherwise. */
	rememberAgents: boolean;
	widgetMode: WidgetMode;
	/** Write each subagent's `.output` transcript unless an agent's `output_transcript` says otherwise. */
	outputTranscript: boolean;
	/** Whether `isolation: "worktree"` may create a worktree. */
	worktreeIsolation: boolean;
	/** Nesting ceiling counted from the main session (main 0). */
	maxSubagentDepth: number;
	/** Agent for an unresolved type: absent means `general-purpose`, `none` refuses. */
	fallbackSubagent?: string;
	/** Attach subagent spend to tool results, so the session's own totals count it. */
	reportUsage: boolean;
	showCost: boolean;
	showModel: boolean;
	viewerMarkdown: ViewerMarkdownMode;
}

export const DEFAULT_SUBAGENT_SETTINGS: Readonly<SubagentSettings> = {
	maxConcurrent: 10,
	maxConcurrentForeground: 0,
	defaultMaxTurns: 0,
	graceTurns: 5,
	defaultJoinMode: "smart",
	backgroundByDefault: true,
	scopeModels: false,
	strictAgentFiles: false,
	disableDefaultAgents: false,
	toolDescriptionMode: "full",
	fleetView: true,
	agentMentions: "model",
	rememberAgents: true,
	widgetMode: "background",
	outputTranscript: true,
	worktreeIsolation: true,
	maxSubagentDepth: 2,
	reportUsage: false,
	showCost: false,
	showModel: false,
	viewerMarkdown: "assistant",
};

type Check = { kind: "integer"; min: number; max: number } | { kind: "boolean" } | { kind: "enum"; values: string[] };

const CHECKS: Record<Exclude<keyof SubagentSettings, "fallbackSubagent">, Check> = {
	maxConcurrent: { kind: "integer", min: 1, max: 1024 },
	maxConcurrentForeground: { kind: "integer", min: 0, max: 1024 },
	defaultMaxTurns: { kind: "integer", min: 0, max: 10_000 },
	graceTurns: { kind: "integer", min: 1, max: 1000 },
	defaultJoinMode: { kind: "enum", values: ["async", "group", "smart"] },
	backgroundByDefault: { kind: "boolean" },
	scopeModels: { kind: "boolean" },
	strictAgentFiles: { kind: "boolean" },
	disableDefaultAgents: { kind: "boolean" },
	toolDescriptionMode: { kind: "enum", values: ["full", "compact", "custom"] },
	fleetView: { kind: "boolean" },
	agentMentions: { kind: "enum", values: ["model", "direct", "off"] },
	rememberAgents: { kind: "boolean" },
	widgetMode: { kind: "enum", values: ["all", "background", "off"] },
	outputTranscript: { kind: "boolean" },
	worktreeIsolation: { kind: "boolean" },
	maxSubagentDepth: { kind: "integer", min: 0, max: 16 },
	reportUsage: { kind: "boolean" },
	showCost: { kind: "boolean" },
	showModel: { kind: "boolean" },
	viewerMarkdown: { kind: "enum", values: ["off", "assistant", "all"] },
};

/** Every settings key, in documentation order. */
export const SUBAGENT_SETTING_KEYS: readonly (keyof SubagentSettings)[] = [
	...(Object.keys(CHECKS) as Array<keyof SubagentSettings>),
	"fallbackSubagent",
];

function describe(check: Check): string {
	if (check.kind === "integer") return `an integer from ${check.min} to ${check.max}`;
	if (check.kind === "boolean") return "true or false";
	return `one of ${check.values.join(", ")}`;
}

function accepts(check: Check, value: unknown): boolean {
	if (check.kind === "integer") {
		return typeof value === "number" && Number.isInteger(value) && value >= check.min && value <= check.max;
	}
	if (check.kind === "boolean") return typeof value === "boolean";
	return typeof value === "string" && check.values.includes(value);
}

/** The valid keys of one scope's `forkBuiltins.subagents` object; each invalid key adds one warning. */
export function sanitizeSubagentSettings(
	raw: unknown,
	scope: "global" | "project",
): { values: Partial<SubagentSettings>; warnings: string[] } {
	const values: Partial<SubagentSettings> = {};
	const warnings: string[] = [];
	if (raw === undefined) return { values, warnings };
	const where = `forkBuiltins.subagents in the ${scope} settings.json`;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { values, warnings: [`${where} must be an object; it is ignored.`] };
	}
	const record = raw as Record<string, unknown>;
	for (const [key, value] of Object.entries(record)) {
		if (key === "fallbackSubagent") {
			// `false` means `none`: dropping it as the wrong type would silently keep the permissive default.
			if (value === false) values.fallbackSubagent = "none";
			else if (typeof value === "string" && value.trim()) values.fallbackSubagent = value.trim();
			else warnings.push(`${where}: fallbackSubagent must be an agent name, "none" or false; it is ignored.`);
			continue;
		}
		// Own keys only: a key such as `toString` must not reach `Object.prototype`.
		const check = Object.hasOwn(CHECKS, key) ? CHECKS[key as keyof typeof CHECKS] : undefined;
		if (!check) {
			warnings.push(`${where}: unknown key ${key}; it is ignored.`);
			continue;
		}
		if (accepts(check, value)) (values as Record<string, unknown>)[key] = value;
		else warnings.push(`${where}: ${key} must be ${describe(check)}; it is ignored.`);
	}
	return { values, warnings };
}

function subagentsSection(settings: object): unknown {
	const forkBuiltins = (settings as { forkBuiltins?: unknown }).forkBuiltins;
	return typeof forkBuiltins === "object" && forkBuiltins !== null
		? (forkBuiltins as Record<string, unknown>).subagents
		: undefined;
}

/**
 * The effective settings: defaults, then the global values, then the project values. The manager
 * holds no project settings in an untrusted project, so project values apply only when trusted.
 */
export function readSubagentSettings(settingsManager: SettingsManager): {
	settings: Readonly<SubagentSettings>;
	warnings: string[];
} {
	const global = sanitizeSubagentSettings(subagentsSection(settingsManager.getGlobalSettings()), "global");
	const project = sanitizeSubagentSettings(subagentsSection(settingsManager.getProjectSettings()), "project");
	return {
		// Frozen: the service hands these out, and no reader may change what the next one sees (F13).
		settings: Object.freeze({ ...DEFAULT_SUBAGENT_SETTINGS, ...global.values, ...project.values }),
		warnings: [...global.warnings, ...project.warnings],
	};
}

/**
 * Replaces `forkBuiltins.subagents` in `<cwd>/.pi/settings.json` with `values`, under the settings
 * file lock, and leaves every other key as it was (P12). The `/agents` settings menu writes through it.
 * A session's `SettingsManager` sees the change after its next `reload()`.
 *
 * It writes nothing when a value fails the reader's checks, naming the key, or when `.pi` or
 * `settings.json` is a symlink, dangling or not, so a save never reaches a file outside the project.
 * An existing file is replaced whole through `writeFileAtomically`, so a failed write leaves it
 * byte-identical. A missing file is created by the settings storage.
 */
export function writeProjectSubagentSettings(cwd: string, values: Partial<SubagentSettings>): void {
	const { warnings } = sanitizeSubagentSettings(values, "project");
	if (warnings.length > 0) {
		const reasons = warnings.map((warning) => warning.replace(/; it is ignored\.$/, "."));
		throw new Error(`Refusing to write subagent settings: ${reasons.join(" ")}`);
	}
	const dir = join(cwd, ".pi");
	const file = join(dir, "settings.json");
	for (const path of [dir, file]) {
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
			throw new Error(`Refusing to write subagent settings through a symlink: ${path}`);
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
		const text = `${JSON.stringify({ ...settings, forkBuiltins: { ...forkBuiltins, subagents: values } }, null, 2)}\n`;
		if (current === undefined) return text;
		// The storage writes in place; an existing file is replaced whole instead, and the storage writes nothing.
		writeFileAtomically(file, text);
		return undefined;
	});
}
