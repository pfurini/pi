/**
 * Fork-owned: the `/agents` settings menu (plan T15). pi-subagents `src/index.ts:3701-4139` at 79a7c42
 * (`showSettings`) is the behavior reference, without its scheduling and workflow rows.
 *
 * A `SettingsList` shows the 22 keys of `SubagentSettings` in pi-subagents' order. Booleans and enums
 * cycle; a number is typed and asked again until it passes the reader's checks; the fallback agent
 * cycles through the enabled types and `none`. Each change closes the list, saves, and reopens it at
 * the same row. `saveSubagentSetting` writes the project's own values plus the changed key, never a
 * global value, then reloads the session's settings and the agent definitions (P17, P19). An
 * untrusted project shows the effective values read-only, with a notice.
 */
import {
	type Component,
	Container,
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import type { SettingsManager } from "../../../settings-manager.ts";
import { GENERAL_PURPOSE_AGENT } from "../definitions/defaults.ts";
import { listedAgentTypes, NO_FALLBACK } from "../definitions/registry.ts";
import type { SubagentService } from "../service/service.ts";
import {
	projectSubagentValues,
	type SubagentSettings,
	sanitizeSubagentSettings,
	writeProjectSubagentSettings,
} from "../settings/settings.ts";
import type { FormatTheme } from "./format.ts";
import type { ViewerSessionState } from "./viewer.ts";

/** What the settings menu works with: the command's UI, the session's service and settings, and its viewer state. */
export interface SettingsMenuEnvironment {
	ui: Pick<ExtensionUIContext, "custom" | "input" | "notify">;
	service: Pick<SubagentService, "defaultCwd" | "refreshDefinitions" | "registry" | "reloadSettings">;
	settingsManager: Pick<SettingsManager, "getProjectSettings" | "isProjectTrusted" | "reload">;
	viewerState: ViewerSessionState;
}

/** Pi's settings-list look, built from the theme `ctx.ui.custom` passes. */
export function settingsListTheme(theme: FormatTheme): SettingsListTheme {
	return {
		label: (text, selected) => (selected ? theme.fg("accent", text) : text),
		value: (text, selected) => (selected ? theme.fg("accent", text) : theme.fg("muted", text)),
		description: (text) => theme.fg("dim", text),
		cursor: theme.fg("accent", "→ "),
		hint: (text) => theme.fg("dim", text),
	};
}

type SettingKey = keyof SubagentSettings;
type SettingValue = SubagentSettings[SettingKey];

type SettingRow = { key: SettingKey; label: string; description: string } & (
	| { kind: "number"; prompt: string }
	| { kind: "boolean" }
	| { kind: "enum"; values: readonly string[] }
	| { kind: "agent" }
);

/** The rows in pi-subagents' order (`src/index.ts:3719-3874`), without scheduling and workflows. */
export const SETTING_ROWS: readonly SettingRow[] = [
	{
		key: "maxConcurrent",
		label: "Max concurrency",
		description: "Max concurrent background agents (Enter to type)",
		kind: "number",
		prompt: "Max concurrency (1+)",
	},
	{
		key: "maxConcurrentForeground",
		label: "Max foreground concurrency",
		description: "Max concurrent foreground (blocking) agents (0 = unlimited, Enter to type)",
		kind: "number",
		prompt: "Max foreground concurrency (0 = unlimited)",
	},
	{
		key: "defaultMaxTurns",
		label: "Default max turns",
		description: "Default max turns before wrap-up (0 = unlimited, Enter to type)",
		kind: "number",
		prompt: "Default max turns (0 = unlimited)",
	},
	{
		key: "graceTurns",
		label: "Grace turns",
		description: "Grace turns after the wrap-up steer (Enter to type)",
		kind: "number",
		prompt: "Grace turns (1+)",
	},
	{
		key: "maxSubagentDepth",
		label: "Nested depth",
		description: "Hard cap on nested delegation: main is 0, its subagents 1 (0 or 1 = nesting off, Enter to type)",
		kind: "number",
		prompt: "Nested depth (0/1 = nesting off)",
	},
	{
		key: "defaultJoinMode",
		label: "Join mode",
		description: "Default join mode for background agents",
		kind: "enum",
		values: ["smart", "async", "group"],
	},
	{
		key: "backgroundByDefault",
		label: "Background by default",
		description: "An Agent call that does not say runs in the background (off = blocks the turn and returns inline)",
		kind: "boolean",
	},
	{
		key: "scopeModels",
		label: "Scope models",
		description: "Validate subagent models against the scoped models (enabledModels)",
		kind: "boolean",
	},
	{
		key: "strictAgentFiles",
		label: "Strict agent files",
		description: "Fail the agent load on an unreadable agent file or an unknown frontmatter key instead of warning",
		kind: "boolean",
	},
	{
		key: "disableDefaultAgents",
		label: "Disable defaults",
		description: "Hide the default agents (general-purpose, Explore, Plan); custom agents are unaffected",
		kind: "boolean",
	},
	{
		key: "fallbackSubagent",
		label: "Fallback agent",
		description: `Agent used when subagent_type is unknown, disabled or ambiguous; "${NO_FALLBACK}" rejects the call instead (strict dispatch)`,
		kind: "agent",
	},
	{
		key: "outputTranscript",
		label: "Output transcript",
		description: "Write each subagent's .output transcript by default; an agent's output_transcript overrides it",
		kind: "boolean",
	},
	{
		key: "worktreeIsolation",
		label: "Worktree isolation",
		description:
			"Allow isolation: worktree to copy the repo. Off refuses every worktree at once, and the Agent tool drops its isolation parameter from the next session on",
		kind: "boolean",
	},
	{
		key: "reportUsage",
		label: "Report usage to session",
		description: "Add subagent tokens and cost to this session's own totals, so the footer and /cost count them",
		kind: "boolean",
	},
	{
		key: "showCost",
		label: "Show cost",
		description:
			"Show an estimated cost beside subagent token counts in the widget, fleet view, results and notifications",
		kind: "boolean",
	},
	{
		key: "showModel",
		label: "Show model",
		description: "Name each running agent's model and thinking level on the widget's rows",
		kind: "boolean",
	},
	{
		key: "viewerMarkdown",
		label: "Viewer markdown",
		description:
			"How much of the conversation viewer renders as Markdown: assistant = assistant text only; all = tool results too; off = everything verbatim. The viewer's Markdown key changes it for the session",
		kind: "enum",
		values: ["off", "assistant", "all"],
	},
	{
		key: "fleetView",
		label: "Fleet view",
		description: "Main and subagents list below the editor (↓ or ← at an empty prompt to navigate, Enter to view)",
		kind: "boolean",
	},
	{
		key: "agentMentions",
		label: "Agent mentions",
		description:
			"Route `@handle message` at the prompt to that agent. model = an off-screen clone of this conversation calls the Agent tool; direct = the agent starts here from your text, with no model call",
		kind: "enum",
		values: ["model", "direct", "off"],
	},
	{
		key: "rememberAgents",
		label: "Remember agents",
		description:
			"Persist subagent sessions so an agent can be resumed long after it finished (they also appear in /resume)",
		kind: "boolean",
	},
	{
		key: "widgetMode",
		label: "Widget",
		description:
			"Agent widget above the editor: all = every agent; background = hides foreground agents, which render inline; off = no widget",
		kind: "enum",
		values: ["all", "background", "off"],
	},
	{
		key: "toolDescriptionMode",
		label: "Tool description",
		description:
			"Agent tool description sent to the model: full (default), compact (fewer tokens, for small models), or custom (agent-tool-description.md with {{placeholders}})",
		kind: "enum",
		values: ["full", "compact", "custom"],
	},
];

const UNTRUSTED_NOTICE = "This project is not trusted: the effective settings are shown read-only.";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function rowOf(key: SettingKey): SettingRow {
	const row = SETTING_ROWS.find((candidate) => candidate.key === key);
	if (!row) throw new Error(`Unknown subagent setting: ${key}`);
	return row;
}

function displayValue(row: SettingRow, settings: Readonly<SubagentSettings>): string {
	if (row.kind === "boolean") return settings[row.key] ? "on" : "off";
	// Unset targets general-purpose, so showing "none" would advertise strict dispatch.
	if (row.kind === "agent") return settings.fallbackSubagent ?? GENERAL_PURPOSE_AGENT;
	return String(settings[row.key]);
}

/** The list's rows. A read-only row cycles nothing; a number row has one value, so Enter only reports it. */
export function settingItems(
	settings: Readonly<SubagentSettings>,
	agents: readonly string[],
	editable: boolean,
): SettingItem[] {
	return SETTING_ROWS.map((row) => {
		const currentValue = displayValue(row, settings);
		let values: string[] | undefined;
		if (editable) {
			if (row.kind === "number") values = [currentValue];
			else if (row.kind === "boolean") values = ["on", "off"];
			else if (row.kind === "enum") values = [...row.values];
			else values = [...new Set([...agents, NO_FALLBACK])];
		}
		return { id: row.key, label: row.label, description: row.description, currentValue, values };
	});
}

/** A row the user changed: a number row carries no value, because the number is asked next. */
export interface SettingChange {
	key: SettingKey;
	value?: string;
}

export interface SettingsMenuOptions {
	settings: Readonly<SubagentSettings>;
	/** The enabled agent types the fallback row offers. */
	agents: readonly string[];
	editable: boolean;
	theme: FormatTheme;
	/** The row to select when the list opens. */
	selected?: SettingKey;
	done: (change: SettingChange | undefined) => void;
}

/** The settings list with its title and, in an untrusted project, the read-only notice. */
export function settingsMenu(options: SettingsMenuOptions): Component {
	const listTheme = settingsListTheme(options.theme);
	const items = settingItems(options.settings, options.agents, options.editable);
	const list = new SettingsList(
		items,
		items.length,
		listTheme,
		(id, value) => {
			const key = id as SettingKey;
			options.done({ key, value: rowOf(key).kind === "number" ? undefined : value });
		},
		() => options.done(undefined),
	);
	if (options.selected) list.selectItem(options.selected);
	const container = new Container();
	container.addChild(new Text("Subagent settings", 0, 0));
	if (!options.editable) container.addChild(new Text(listTheme.hint(UNTRUSTED_NOTICE), 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(list);
	return {
		render: (width: number) => container.render(width),
		invalidate: () => container.invalidate(),
		handleInput: (data: string) => list.handleInput(data),
	};
}

/** pi-subagents' toast for a saved change (`src/index.ts:3901-4054`). */
export function settingToast(key: SettingKey, value: SettingValue): string {
	const state = value ? "enabled" : "disabled";
	switch (key) {
		case "maxConcurrent":
			return `Max concurrency set to ${value}`;
		case "maxConcurrentForeground":
			return value === 0
				? "Max foreground concurrency set to unlimited"
				: `Max foreground concurrency set to ${value}`;
		case "defaultMaxTurns":
			return value === 0 ? "Default max turns set to unlimited" : `Default max turns set to ${value}`;
		case "graceTurns":
			return `Grace turns set to ${value}`;
		case "maxSubagentDepth":
			return Number(value) <= 1
				? "Nested delegation disabled"
				: `Nested depth set to ${value}. Applies to agents started from now on.`;
		case "defaultJoinMode":
			return `Default join mode set to ${value}`;
		case "backgroundByDefault":
			return value
				? "Agent calls run in the background unless they pass run_in_background: false"
				: "Agent calls block and return inline unless they pass run_in_background: true";
		case "scopeModels":
			return `Scope models ${state}`;
		case "strictAgentFiles":
			// The next definitions load applies it, and the save itself reloads them.
			return `Strict agent files ${state}`;
		case "disableDefaultAgents":
			return `Default agents ${value ? "disabled" : "enabled"}. Tool spec change takes effect on next pi session.`;
		case "fallbackSubagent":
			return value === NO_FALLBACK
				? "Unknown or disabled agent types will now be rejected"
				: `Unknown agent types will fall back to ${value}`;
		case "outputTranscript":
			return `Output transcript ${state} by default`;
		case "worktreeIsolation":
			return `Worktree isolation ${state}. Tool parameter updates on next pi session.`;
		case "reportUsage":
			return value
				? "Subagent usage now counted in this session's totals"
				: "Subagent usage no longer counted in this session's totals";
		case "showCost":
			return `Cost display ${state}`;
		case "showModel":
			return `Model display ${state}`;
		case "viewerMarkdown":
			return `Viewer markdown set to ${value}`;
		case "fleetView":
			return `Fleet view ${state}`;
		case "agentMentions":
			if (value === "off") return "Agent mentions disabled";
			return value === "model"
				? "Agent mentions on: a conversation clone starts a mentioned agent off-screen"
				: "Agent mentions on: a mentioned agent starts here, with no model call";
		case "rememberAgents":
			return `Remember agents ${state}`;
		case "widgetMode":
			return `Widget set to ${value}`;
		case "toolDescriptionMode":
			return `Tool description set to ${value}. Takes effect on next pi session.`;
	}
}

/**
 * Saves one key into the project `settings.json` (P17): the project's own values as the file holds
 * them now, plus the change; a global value is never copied. Then the session's `SettingsManager`
 * and the service reread the files, and the agent definitions reload (P19). Returns whether it saved.
 * An untrusted project, a refused value or a failed write warns and changes nothing.
 */
export async function saveSubagentSetting<K extends SettingKey>(
	env: SettingsMenuEnvironment,
	key: K,
	value: SubagentSettings[K],
): Promise<boolean> {
	if (!env.settingsManager.isProjectTrusted()) {
		env.ui.notify(UNTRUSTED_NOTICE, "warning");
		return false;
	}
	try {
		// The file may have changed since the session read it; keep what it holds now.
		await env.settingsManager.reload();
		writeProjectSubagentSettings(env.service.defaultCwd(), {
			...projectSubagentValues(env.settingsManager),
			[key]: value,
		});
	} catch (error) {
		env.ui.notify(`Subagent settings not saved: ${errorText(error)}`, "warning");
		return false;
	}
	await env.settingsManager.reload();
	// A saved mode replaces the one the viewer's key chose for this session.
	if (key === "viewerMarkdown") env.viewerState.markdownMode = undefined;
	try {
		// Rereads the settings first, so the service announces the change once.
		env.service.refreshDefinitions();
	} catch (error) {
		env.ui.notify(`Agent definitions did not reload: ${errorText(error)}`, "warning");
	}
	env.ui.notify(settingToast(key, value), "info");
	return true;
}

/** Asks for a number until it passes the reader's checks; undefined when the user cancels. */
async function askNumber(env: SettingsMenuEnvironment, row: SettingRow & { kind: "number" }, current: number) {
	let input = await env.ui.input(row.prompt, String(current));
	while (input !== undefined) {
		const text = input.trim();
		const value = text === "" ? Number.NaN : Number(text);
		const [warning] = sanitizeSubagentSettings({ [row.key]: value }, "project").warnings;
		if (!warning) return value;
		const reason = warning.slice(warning.indexOf(": ") + 2).replace(/; it is ignored\.$/, "");
		input = await env.ui.input(`${row.prompt}: ${reason}`, text);
	}
	return undefined;
}

export async function showSettingsMenu(env: SettingsMenuEnvironment): Promise<void> {
	let selected: SettingKey | undefined;
	for (;;) {
		const settings = env.service.reloadSettings();
		const editable = env.settingsManager.isProjectTrusted();
		const agents = listedAgentTypes(env.service.registry);
		const change = await env.ui.custom<SettingChange | undefined>((_tui, theme, _keybindings, done) =>
			settingsMenu({ settings, agents, editable, theme, selected, done }),
		);
		if (!change) return;
		selected = change.key;
		const row = rowOf(change.key);
		let value: SettingValue | undefined;
		if (row.kind === "number") value = await askNumber(env, row, settings[row.key] as number);
		else if (row.kind === "boolean") value = change.value === "on";
		else value = change.value;
		if (value !== undefined) await saveSubagentSetting(env, change.key, value);
	}
}
