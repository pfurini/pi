/**
 * Fork-owned: the `/tasks` command (pi-tasks `src/index.ts:1263-1380` and `src/ui/settings-menu.ts` at
 * 83480bd). The menu views, creates, starts, completes, deletes and clears tasks through `select` and
 * `input` dialogs, which the TUI and RPC both show. `Settings` opens a settings list in the TUI only.
 * A save writes the project's own values plus the changed key to `forkBuiltins.tasks`, never a global
 * value, then reloads the session's settings. An untrusted project shows the values read-only.
 */
import { Container, type SettingItem, SettingsList, Spacer, Text } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import type { SettingsManager } from "../../../settings-manager.ts";
import { displayText } from "../../subagents/ui/format.ts";
import { settingsListTheme } from "../../subagents/ui/settings-menu.ts";
import { CLEAR_DELAY_TURNS } from "../auto-clear.ts";
import type { TaskService } from "../service/service.ts";
import { projectTaskValues, type TaskSettings, writeProjectTaskSettings } from "../settings.ts";

export interface TasksMenuEnvironment {
	ui: Pick<ExtensionUIContext, "select" | "input" | "notify" | "custom">;
	service: TaskService;
	settingsManager: Pick<SettingsManager, "getProjectSettings" | "isProjectTrusted" | "reload">;
	cwd: string;
	/** The settings list needs the interactive TUI. */
	tui: boolean;
}

const GLYPHS: Record<string, string> = { completed: "✔", in_progress: "◼", pending: "◻" };
const BACK = "← Back";

export async function showTasksMenu(env: TasksMenuEnvironment): Promise<void> {
	const { ui, service } = env;
	for (;;) {
		const tasks = service.list();
		const done = tasks.filter((task) => task.status === "completed").length;
		const choices = [`View all tasks (${tasks.length})`, "Create task"];
		if (done > 0) choices.push(`Clear completed (${done})`);
		if (tasks.length > 0) choices.push(`Clear all (${tasks.length})`);
		if (env.tui) choices.push("Settings");
		const choice = await ui.select("Tasks", choices);
		if (!choice) return;
		if (choice.startsWith("View")) await viewTasks(env);
		else if (choice === "Create task") await createTask(env);
		else if (choice === "Settings") await showTaskSettings(env);
		else if (choice.startsWith("Clear completed")) service.clearCompleted();
		else if (choice.startsWith("Clear all")) service.clearAll();
	}
}

async function viewTasks(env: TasksMenuEnvironment): Promise<void> {
	for (;;) {
		const tasks = env.service.list();
		if (tasks.length === 0) {
			await env.ui.select("No tasks", [BACK]);
			return;
		}
		// Task text is the model's, maybe from a file holding escape sequences; so is a task file's id.
		const seen = new Set<string>();
		const choices = tasks.map((task, index) => {
			let label = `${GLYPHS[task.status]} #${displayText(task.id)} [${task.status}] ${displayText(task.subject).replace(/\n/g, " ")}`;
			// Two ids that differ only in stripped characters show alike; the row number keeps the choice unique.
			while (seen.has(label)) label += ` (row ${index + 1})`;
			seen.add(label);
			return label;
		});
		choices.push(BACK);
		const selected = await env.ui.select("Tasks", choices);
		if (!selected || selected === BACK) return;
		// By row position: a subject may contain text such as `#42`.
		const picked = tasks[choices.indexOf(selected)];
		if (picked) await taskDetail(env, picked.id);
	}
}

async function taskDetail(env: TasksMenuEnvironment, taskId: string): Promise<void> {
	const task = env.service.get(taskId);
	if (!task) return;
	const actions: string[] = [];
	if (task.status === "pending") actions.push("▸ Start (in_progress)");
	if (task.status === "in_progress") actions.push("✓ Complete");
	actions.push("✗ Delete", BACK);
	const title = `#${displayText(task.id)} [${task.status}] ${displayText(task.subject)}\n${displayText(task.description)}`;
	const action = await env.ui.select(title, actions);
	if (action === "▸ Start (in_progress)") env.service.update(taskId, { status: "in_progress" });
	else if (action === "✓ Complete") env.service.update(taskId, { status: "completed" });
	else if (action === "✗ Delete") env.service.update(taskId, { status: "deleted" });
}

async function createTask(env: TasksMenuEnvironment): Promise<void> {
	const subject = await env.ui.input("Task subject");
	if (!subject) return;
	const description = await env.ui.input("Task description");
	if (!description) return;
	env.service.create(subject, description);
}

type Row = { key: keyof TaskSettings; label: string; description: string; values: string[] };

const onOff = ["on", "off"];

const ROWS: readonly Row[] = [
	{
		key: "taskScope",
		label: "Task storage",
		description:
			"session: saved per session in the workspace (.pi/tasks/tasks-<sessionId>.json), survives resume. " +
			"memory: tasks live only in memory and are lost when the session ends. Takes effect on the next session.",
		values: ["session", "memory"],
	},
	{
		key: "collapseCompleted",
		label: "Collapse completed tasks",
		description:
			"When on, completed tasks are replaced by a single 'N completed' line and the visible limit applies " +
			"only to the tasks left. When off, they are listed individually.",
		values: onOff,
	},
	{
		key: "showAll",
		label: "Show all tasks in widget",
		description:
			"When on, every listed task is shown whatever the visible limit. When off, 'Max visible tasks' caps the list.",
		values: onOff,
	},
	{
		key: "maxVisible",
		label: "Max visible tasks in widget",
		description: "Only applies when 'Show all tasks' is off. Caps how many task lines the widget shows.",
		values: ["5", "10", "15", "20", "30", "50", "100"],
	},
	{
		key: "sortOrder",
		label: "Widget sort order",
		description:
			'"active" groups by in-progress, pending, completed; "status" is the reverse. "id" sorts by creation ' +
			'order. "recent" and "oldest" sort by the last change.',
		values: ["id", "status", "active", "recent", "oldest"],
	},
	{
		key: "hiddenAt",
		label: "Hidden tasks position",
		description: '"bottom" hides tasks from the end of the list; "top" hides them from the start.',
		values: ["bottom", "top"],
	},
	{
		key: "autoClearCompleted",
		label: "Auto-clear completed tasks",
		description:
			"never: completed tasks stay until cleared. on_list_complete: cleared after all tasks are done. " +
			`on_task_complete: each task cleared shortly after it completes. Clearing lags ~${CLEAR_DELAY_TURNS} ` +
			"turns, or happens at once when a later batch of work starts.",
		values: ["never", "on_list_complete", "on_task_complete"],
	},
];

function shown(value: TaskSettings[keyof TaskSettings]): string {
	return typeof value === "boolean" ? (value ? "on" : "off") : String(value);
}

function parsed(row: Row, value: string): TaskSettings[keyof TaskSettings] {
	if (row.values === onOff) return value === "on";
	// The row offers only the values the reader accepts; `writeProjectTaskSettings` checks them again.
	return row.key === "maxVisible" ? Number(value) : (value as TaskSettings[keyof TaskSettings]);
}

/** Writes the project's own values plus the changed key, then reloads the manager and the service. */
async function save(env: TasksMenuEnvironment, row: Row, value: string): Promise<void> {
	try {
		// The file may have changed since the session read it; keep what it holds now.
		await env.settingsManager.reload();
		writeProjectTaskSettings(env.cwd, { ...projectTaskValues(env.settingsManager), [row.key]: parsed(row, value) });
		await env.settingsManager.reload();
		env.service.reloadSettings();
	} catch (error) {
		env.ui.notify(`Task settings not saved: ${error instanceof Error ? error.message : String(error)}`, "warning");
	}
}

/**
 * The settings list: each change saves the project's own values plus that key. Saves run one after
 * another, so a change reads the project values the save before it reloaded.
 */
async function showTaskSettings(env: TasksMenuEnvironment): Promise<void> {
	const trusted = env.settingsManager.isProjectTrusted();
	if (!trusted) env.ui.notify("This project is not trusted: task settings are read-only here.", "info");
	let saving: Promise<void> = Promise.resolve();
	await env.ui.custom<void>((_tui, theme, _keybindings, done) => {
		const items: SettingItem[] = ROWS.map((row) => ({
			id: row.key,
			label: row.label,
			description: row.description,
			currentValue: shown(env.service.settings[row.key]),
			values: trusted ? row.values : [shown(env.service.settings[row.key])],
		}));
		const list = new SettingsList(
			items,
			10,
			settingsListTheme(theme),
			(id, value) => {
				const row = ROWS.find((candidate) => candidate.key === id);
				if (!row || !trusted) return;
				saving = saving.then(() => save(env, row, value));
			},
			() => done(undefined),
		);
		class Panel extends Container {
			handleInput(data: string): void {
				list.handleInput(data);
			}
		}
		const root = new Panel();
		root.addChild(new Text(theme.bold(theme.fg("accent", "Task Settings")), 0, 0));
		root.addChild(new Spacer(1));
		root.addChild(list);
		return root;
	});
	await saving;
}
