/**
 * Fork-owned: the `/agents` menu (plan T13). pi-subagents `src/index.ts` (`showAgentsMenu` and the
 * functions after it) at 79a7c42 is the behavior reference, without its workflow and schedule entries.
 *
 * The top menu offers `Running agents (N)` while any exist, `Agent types (N)`, `Create new agent` and
 * `Settings` (`settings-menu.ts`); every submenu returns to it. Running agents open the conversation
 * viewer. Agent types list in a `SettingsList`: `•` a project file, `◦` a global one, `✕` a disabled
 * agent, and the model on the right; skill agents never show (ADR-0008). Each agent offers the
 * actions that apply: edit, delete, reset to default, eject, disable and enable.
 *
 * The menu reloads the definitions before it shows the roster, and after every file change (P19).
 * A reload that fails warns and keeps the last good roster. File changes refuse any symlink on the
 * path and replace files whole (P27); project locations exist only in a trusted project (P18).
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Container, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import { DEFAULT_AGENTS } from "../definitions/defaults.ts";
import {
	type AgentFile,
	type AgentFileDirectories,
	type AgentFileLocation,
	agentDirectory,
	DISABLED_STUB,
	disableInContent,
	enableInContent,
	isEmptyStub,
	locateAgentFile,
	removeAgentFile,
	serializeAgentDefinition,
	writeAgentFile,
} from "../definitions/files.ts";
import type { AgentRegistry } from "../definitions/registry.ts";
import type { AgentDefinition } from "../definitions/types.ts";
import type { SubagentService } from "../service/service.ts";
import { type CreateWizardEnvironment, runCreateWizard } from "./create-wizard.ts";
import { formatMs } from "./format.ts";
import { type SettingsMenuEnvironment, settingsListTheme, showSettingsMenu } from "./settings-menu.ts";
import { openConversationViewer, type ViewerSessionState } from "./viewer.ts";

/** What the menu works with: the command's UI, the session's service and settings, its project trust and its models. */
export interface AgentsMenuEnvironment extends CreateWizardEnvironment, SettingsMenuEnvironment {
	ui: Pick<ExtensionUIContext, "select" | "input" | "confirm" | "editor" | "notify" | "custom">;
	service: SubagentService;
	projectTrusted(): boolean;
	viewerState: ViewerSessionState;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function directories(env: AgentsMenuEnvironment): AgentFileDirectories {
	return { cwd: env.service.defaultCwd(), agentDir: env.service.agentDir, projectTrusted: env.projectTrusted() };
}

/** Reloads the definitions; a failure warns and keeps the last good registry (P19). */
function reload(env: AgentsMenuEnvironment): AgentRegistry {
	try {
		return env.service.refreshDefinitions();
	} catch (error) {
		env.ui.notify(`Agent definitions did not reload: ${errorText(error)}`, "warning");
		return env.service.registry;
	}
}

/**
 * Runs one file change and reports it. A failed change notifies the error and changes nothing else;
 * after a change that landed, a failed reload warns that the file is saved (P27).
 */
function change(env: AgentsMenuEnvironment, path: string, done: string, action: () => void): void {
	try {
		action();
	} catch (error) {
		env.ui.notify(errorText(error), "error");
		return;
	}
	try {
		env.service.refreshDefinitions();
	} catch (error) {
		env.ui.notify(`Saved ${path}, but agent definitions did not reload: ${errorText(error)}`, "warning");
		return;
	}
	env.ui.notify(done, "info");
}

export async function showAgentsMenu(env: AgentsMenuEnvironment): Promise<void> {
	for (;;) {
		const registry = reload(env);
		const agents = env.service.list();
		const options: string[] = [];
		if (agents.length > 0) options.push(`Running agents (${agents.length})`);
		options.push(`Agent types (${roster(registry).length})`, "Create new agent", "Settings");
		const choice = await env.ui.select("Agents", options);
		if (!choice) return;
		if (choice.startsWith("Running agents")) await showRunningAgents(env);
		else if (choice.startsWith("Agent types")) await showAgentTypes(env);
		else if (choice === "Settings") await showSettingsMenu(env);
		else await createAgent(env);
	}
}

async function showRunningAgents(env: AgentsMenuEnvironment): Promise<void> {
	for (;;) {
		const agents = env.service.list();
		if (agents.length === 0) {
			env.ui.notify("No agents.", "info");
			return;
		}
		// Numbered, so two agents of one type with one description stay apart.
		const labels = agents.map((view, index) => {
			const name = view.definition.displayName ?? view.type;
			const duration = formatMs((view.completedAt ?? Date.now()) - view.startedAt);
			return `${index + 1}. ${name} (${view.description}) · ${view.toolUses} tools · ${view.status} · ${duration}`;
		});
		const choice = await env.ui.select("Running agents", labels);
		if (!choice) return;
		const view = agents[labels.indexOf(choice)];
		if (!view) return;
		if (!env.service.conversation(view.id)) {
			env.ui.notify(`Agent is ${view.status}: no session is available.`, "info");
			continue;
		}
		await openConversationViewer(env.ui, env.service, view, env.viewerState);
	}
}

/** The listed agents: every registry entry but skill agents, which stay hidden (ADR-0008). */
function roster(registry: AgentRegistry): Array<[string, AgentDefinition]> {
	return [...registry.agents].filter(([, definition]) => !definition.hidden);
}

function marker(definition: AgentDefinition): string {
	const origin = definition.source.kind === "project" ? "•" : definition.source.kind === "global" ? "◦" : " ";
	return definition.enabled ? `${origin}  ` : `✕${origin} `;
}

async function showAgentTypes(env: AgentsMenuEnvironment): Promise<void> {
	for (;;) {
		const registry = reload(env);
		const agents = roster(registry);
		if (agents.length === 0) {
			env.ui.notify("No agents.", "info");
			return;
		}
		const items: SettingItem[] = agents.map(([name, definition]) => {
			const model = definition.model ?? "inherit";
			return {
				id: name,
				label: `${marker(definition)}${name}`,
				currentValue: model,
				description: definition.enabled ? definition.description : "(disabled)",
				// One value, so Enter selects the row and cycles nothing.
				values: [model],
			};
		});
		const legend = [
			agents.some(([, definition]) => definition.source.kind !== "default") ? "• = project  ◦ = global" : "",
			agents.some(([, definition]) => !definition.enabled) ? "✕ = disabled" : "",
		].filter(Boolean);
		const selected = await env.ui.custom<string | undefined>((_tui, theme, _keybindings, done) => {
			const listTheme = settingsListTheme(theme);
			const list = new SettingsList(
				items,
				Math.min(items.length, 12),
				listTheme,
				(id) => done(id),
				() => done(undefined),
			);
			const container = new Container();
			container.addChild(new Text("Agent types", 0, 0));
			if (legend.length > 0) container.addChild(new Text(listTheme.hint(legend.join("  ")), 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(list);
			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => list.handleInput(data),
			};
		});
		if (!selected) return;
		const definition = registry.agents.get(selected);
		if (definition) await showAgentActions(env, selected, definition);
	}
}

async function showAgentActions(env: AgentsMenuEnvironment, name: string, definition: AgentDefinition): Promise<void> {
	const dirs = directories(env);
	const sourcePath = definition.source.kind === "default" ? undefined : definition.source.sourcePath;
	const file = locateAgentFile(name, sourcePath, dirs);
	const isDefault = DEFAULT_AGENTS.some((agent) => agent.name === name);
	let options: string[];
	if (!definition.enabled && file) {
		options = isDefault
			? ["Enable", "Edit", "Reset to default", "Delete", "Back"]
			: ["Enable", "Edit", "Delete", "Back"];
	} else if (isDefault && !file) {
		options = ["Eject (export as .md)", "Disable", "Back"];
	} else if (isDefault) {
		options = ["Edit", "Disable", "Reset to default", "Delete", "Back"];
	} else {
		options = ["Edit", "Disable", "Delete", "Back"];
	}
	const choice = await env.ui.select(name, options);
	if (!choice || choice === "Back") return;

	if (choice === "Edit" && file) {
		const content = readFileSync(file.path, "utf8");
		const edited = await env.ui.editor(`Edit ${name}`, content);
		if (edited === undefined || edited === content) return;
		change(env, file.path, `Updated ${file.path}`, () => writeAgentFile(file, edited, dirs));
	} else if ((choice === "Delete" || choice === "Reset to default") && file) {
		const confirmed =
			choice === "Delete"
				? await env.ui.confirm("Delete agent", `Delete ${name} from ${file.location} (${file.path})?`)
				: await env.ui.confirm("Reset to default", `Delete override ${file.path} and restore the default ${name}?`);
		if (!confirmed) return;
		const done = choice === "Delete" ? `Deleted ${file.path}` : `Restored default ${name}`;
		change(env, file.path, done, () => removeAgentFile(file, dirs));
	} else if (choice.startsWith("Eject")) {
		await eject(env, name, definition, dirs);
	} else if (choice === "Disable") {
		await disable(env, name, file, dirs);
	} else if (choice === "Enable" && file) {
		enable(env, name, file, dirs);
	}
}

/** The create wizard (T14): the location here, the rest in `create-wizard.ts`; the write here, per P27. */
async function createAgent(env: AgentsMenuEnvironment): Promise<void> {
	const dirs = directories(env);
	const location = await chooseLocation(env, dirs);
	if (!location) return;
	const created = await runCreateWizard(env, agentDirectory(location, dirs), location);
	if (!created) return;
	const file: AgentFile = { path: created.path, location };
	change(env, file.path, `Created ${file.path}`, () => writeAgentFile(file, created.text, dirs));
}

/** Asks where a new file goes; a project location only in a trusted project (P18). */
async function chooseLocation(
	env: AgentsMenuEnvironment,
	dirs: AgentFileDirectories,
): Promise<AgentFileLocation | undefined> {
	const personal = `Personal (${agentDirectory("personal", dirs)})`;
	const options = dirs.projectTrusted ? ["Project (.pi/agents/)", personal] : [personal];
	const choice = await env.ui.select("Choose location", options);
	if (!choice) return undefined;
	return choice === personal ? "personal" : "project";
}

async function eject(
	env: AgentsMenuEnvironment,
	name: string,
	definition: AgentDefinition,
	dirs: AgentFileDirectories,
): Promise<void> {
	const location = await chooseLocation(env, dirs);
	if (!location) return;
	const target: AgentFile = { path: join(agentDirectory(location, dirs), `${name}.md`), location };
	if (statSync(target.path, { throwIfNoEntry: false })) {
		if (!(await env.ui.confirm("Overwrite", `${target.path} already exists. Overwrite?`))) return;
	}
	const text = serializeAgentDefinition(definition);
	change(env, target.path, `Ejected ${name} to ${target.path}`, () => writeAgentFile(target, text, dirs));
}

/** Sets `enabled: false` in the agent's file; a default agent with no file gets a disabling stub. */
async function disable(
	env: AgentsMenuEnvironment,
	name: string,
	file: AgentFile | undefined,
	dirs: AgentFileDirectories,
): Promise<void> {
	if (file) {
		const { content, outcome } = disableInContent(readFileSync(file.path, "utf8"));
		if (outcome === "already-disabled") {
			env.ui.notify(`${name} is already disabled.`, "info");
			return;
		}
		if (outcome === "no-frontmatter") {
			env.ui.notify(`Cannot disable ${name}: ${file.path} has no frontmatter block.`, "error");
			return;
		}
		if (outcome === "cannot-rewrite") {
			env.ui.notify(
				`Cannot disable ${name}: ${file.path} spells its enabled key in a way this menu cannot rewrite.`,
				"error",
			);
			return;
		}
		change(env, file.path, `Disabled ${name} (${file.path})`, () => writeAgentFile(file, content, dirs));
		return;
	}
	const location = await chooseLocation(env, dirs);
	if (!location) return;
	const stub: AgentFile = { path: join(agentDirectory(location, dirs), `${name}.md`), location };
	// The path can hold another agent's file, one whose `name:` differs from its base name.
	if (statSync(stub.path, { throwIfNoEntry: false })) {
		if (!(await env.ui.confirm("Overwrite", `${stub.path} already exists. Overwrite?`))) return;
	}
	change(env, stub.path, `Disabled ${name} (${stub.path})`, () => writeAgentFile(stub, DISABLED_STUB, dirs));
}

/** Removes `enabled: false`; a stub that then says nothing is deleted, which restores the default. */
function enable(env: AgentsMenuEnvironment, name: string, file: AgentFile, dirs: AgentFileDirectories): void {
	const { content, changed, cannotRewrite } = enableInContent(readFileSync(file.path, "utf8"));
	if (cannotRewrite) {
		env.ui.notify(
			`Cannot enable ${name}: ${file.path} spells its enabled key in a way this menu cannot rewrite.`,
			"error",
		);
	} else if (isEmptyStub(content)) {
		change(env, file.path, `Enabled ${name} (removed ${file.path})`, () => removeAgentFile(file, dirs));
	} else if (changed) {
		change(env, file.path, `Enabled ${name} (${file.path})`, () => writeAgentFile(file, content, dirs));
	} else {
		env.ui.notify(`${name} is not disabled in ${file.path}.`, "info");
	}
}
