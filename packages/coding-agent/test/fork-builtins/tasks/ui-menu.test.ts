/**
 * Fork-owned: the `/tasks` menu and its settings list (plan T4 cases 7 and 8), driven through a fake
 * UI context whose dialogs answer from a script. The settings list is driven through its input.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../../../src/core/agent-session.ts";
import { TaskService } from "../../../src/core/fork-builtins/tasks/service/service.ts";
import { showTasksMenu, type TasksMenuEnvironment } from "../../../src/core/fork-builtins/tasks/ui/menu.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

const KEY = { down: "\x1b[B", space: " ", escape: "\x1b" };
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A workspace with global and project task settings, and a task service on a saved session there. */
function workspace(
	global: Record<string, unknown> = {},
	project?: Record<string, unknown>,
	trusted = true,
	seed?: unknown,
) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-menu-"));
	dirs.push(cwd);
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ forkBuiltins: { tasks: global } }));
	if (project) {
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({ theme: "dark", forkBuiltins: { tasks: project } }),
		);
	}
	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: trusted });
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const taskFile = join(cwd, ".pi", "tasks", `tasks-${manager.getSessionId()}.json`);
	if (seed !== undefined) {
		mkdirSync(join(cwd, ".pi", "tasks"), { recursive: true });
		writeFileSync(taskFile, JSON.stringify(seed));
	}
	const service = new TaskService({
		sessionManager: manager,
		settingsManager,
		subscribe: () => () => {},
		getActiveToolNames: () => [],
		sessionId: manager.getSessionId(),
		sessionFile: manager.getSessionFile(),
	} as unknown as AgentSession);
	return { cwd, agentDir, settingsManager, service, taskFile };
}

type Answer = string | undefined | ((choices: string[]) => string | undefined);

/**
 * A UI whose `select` and `input` answer from the scripts in order; a script that runs out cancels.
 * `custom` renders the settings list, presses `keys` and closes it with Escape.
 */
function scriptedUi(selects: Answer[], inputs: Array<string | undefined> = [], keys: string[] = []) {
	const asked: Array<{ title: string; choices: string[] }> = [];
	const notices: string[] = [];
	const settings: string[][] = [];
	const ui = {
		select: async (title: string, choices: string[]) => {
			asked.push({ title, choices });
			const answer = selects.shift();
			return typeof answer === "function" ? answer(choices) : answer;
		},
		input: async () => inputs.shift(),
		notify: (message: string) => {
			notices.push(message);
		},
		custom: <T>(factory: (...args: unknown[]) => Component) =>
			new Promise<T>((resolve) => {
				const component = factory({ requestRender: () => {} }, theme, undefined, (value: T) => resolve(value));
				settings.push(component.render(200));
				for (const key of keys) component.handleInput?.(key);
				settings.push(component.render(200));
				component.handleInput?.(KEY.escape);
			}),
	} as unknown as TasksMenuEnvironment["ui"];
	return { ui, asked, notices, settings };
}

function env(space: ReturnType<typeof workspace>, ui: TasksMenuEnvironment["ui"], tui = true): TasksMenuEnvironment {
	return { ui, service: space.service, settingsManager: space.settingsManager, cwd: space.cwd, tui };
}

const pick = (prefix: string) => (choices: string[]) => choices.find((choice) => choice.startsWith(prefix));

describe("the /tasks menu", () => {
	it("offers view and create for an empty list, the clear entries with their counts, and Settings in the TUI only", async () => {
		const space = workspace();
		const empty = scriptedUi([undefined]);
		await showTasksMenu(env(space, empty.ui));
		expect(empty.asked).toEqual([{ title: "Tasks", choices: ["View all tasks (0)", "Create task", "Settings"] }]);
		space.service.create("a", "d");
		space.service.create("b", "d");
		space.service.update("1", { status: "completed" });
		const full = scriptedUi([undefined]);
		await showTasksMenu(env(space, full.ui));
		expect(full.asked[0].choices).toEqual([
			"View all tasks (2)",
			"Create task",
			"Clear completed (1)",
			"Clear all (2)",
			"Settings",
		]);
		const rpc = scriptedUi([undefined]);
		await showTasksMenu(env(space, rpc.ui, false));
		expect(rpc.asked[0].choices).not.toContain("Settings");
	});

	it("lists the tasks with status glyphs, and the detail actions start, complete and delete", async () => {
		const space = workspace();
		space.service.create("a", "first");
		space.service.create("b", "second");
		space.service.create("c", "third");
		space.service.update("2", { status: "in_progress" });
		space.service.update("3", { status: "completed" });
		const { ui, asked } = scriptedUi([
			pick("View"),
			pick("◻ #1"),
			"▸ Start (in_progress)",
			pick("◼ #1"),
			"✓ Complete",
			pick("◼ #2"),
			"✗ Delete",
			"← Back",
			undefined,
		]);
		await showTasksMenu(env(space, ui));
		expect(asked[1]).toEqual({
			title: "Tasks",
			choices: ["◻ #1 [pending] a", "◼ #2 [in_progress] b", "✔ #3 [completed] c", "← Back"],
		});
		expect(asked[2]).toEqual({
			title: "#1 [pending] a\nfirst",
			choices: ["▸ Start (in_progress)", "✗ Delete", "← Back"],
		});
		expect(asked[4].choices).toEqual(["✓ Complete", "✗ Delete", "← Back"]);
		expect(space.service.list().map((task) => [task.id, task.status])).toEqual([
			["1", "completed"],
			["3", "completed"],
		]);
	});

	it("opens the task whose row was picked when a subject holds #<n>", async () => {
		const space = workspace();
		space.service.create("fix #2 later", "d");
		space.service.create("other", "d");
		const { ui, asked } = scriptedUi([pick("View"), pick("◻ #1"), "← Back", "← Back", undefined]);
		await showTasksMenu(env(space, ui));
		expect(asked[2].title).toBe("#1 [pending] fix #2 later\nd");
	});

	it("strips escape sequences from the task text it lists and titles", async () => {
		const space = workspace();
		space.service.create("copy\u001b]52;c;YWJj\u0007 me", "line one\u001b[31m\nline two");
		const { ui, asked } = scriptedUi([pick("View"), pick("◻ #1"), "← Back", "← Back", undefined]);
		await showTasksMenu(env(space, ui));
		expect(asked[1].choices[0]).toBe("◻ #1 [pending] copy me");
		expect(asked[2].title).toBe("#1 [pending] copy me\nline one\nline two");
		const hostile = workspace({}, undefined, true, {
			nextId: 2,
			tasks: [{ id: "1\u001b[2J", subject: "odd id", description: "d", status: "pending" }],
		});
		const odd = scriptedUi([pick("View"), pick("◻ #1"), "← Back", "← Back", undefined]);
		await showTasksMenu(env(hostile, odd.ui));
		expect(odd.asked[1].choices[0]).toBe("◻ #1 [pending] odd id");
		expect(odd.asked[2].title).toBe("#1 [pending] odd id\nd");
	});

	it("keeps two tasks apart whose ids show alike once stripped", async () => {
		const space = workspace({}, undefined, true, {
			nextId: 2,
			tasks: [
				{ id: "1", subject: "same", description: "first", status: "pending" },
				{ id: "1\u001b[2J", subject: "same", description: "second", status: "pending" },
			],
		});
		const { ui, asked } = scriptedUi([pick("View"), (choices) => choices[1], "✗ Delete", "← Back", undefined]);
		await showTasksMenu(env(space, ui));
		expect(asked[1].choices).toEqual(["◻ #1 [pending] same", "◻ #1 [pending] same (row 2)", "← Back"]);
		expect(asked[2].title).toBe("#1 [pending] same\nsecond");
		expect(space.service.list().map((task) => task.description)).toEqual(["first"]);
		const three = workspace({}, undefined, true, {
			nextId: 2,
			tasks: [
				{ id: "1", subject: "same", description: "first", status: "pending" },
				{ id: "1\u001b[2J", subject: "same (row 3)", description: "second", status: "pending" },
				{ id: "1\u001b[3J", subject: "same", description: "third", status: "pending" },
			],
		});
		const picked = scriptedUi([pick("View"), (choices) => choices[2], "✗ Delete", "← Back", undefined]);
		await showTasksMenu(env(three, picked.ui));
		expect(new Set(picked.asked[1].choices).size).toBe(4);
		expect(three.service.list().map((task) => task.description)).toEqual(["first", "second"]);
	});

	it("shows a placeholder when there is nothing to view", async () => {
		const space = workspace();
		const { ui, asked } = scriptedUi([pick("View"), "← Back", undefined]);
		await showTasksMenu(env(space, ui));
		expect(asked[1]).toEqual({ title: "No tasks", choices: ["← Back"] });
	});

	it("creates a task from the subject and description prompts, and nothing when either is cancelled", async () => {
		const space = workspace();
		const created = scriptedUi(["Create task", undefined], ["Write docs", "Explain the menu"]);
		await showTasksMenu(env(space, created.ui));
		expect(space.service.list().map((task) => [task.subject, task.description])).toEqual([
			["Write docs", "Explain the menu"],
		]);
		const noSubject = scriptedUi(["Create task", undefined], [undefined]);
		await showTasksMenu(env(space, noSubject.ui));
		const noDescription = scriptedUi(["Create task", undefined], ["Subject only", undefined]);
		await showTasksMenu(env(space, noDescription.ui));
		expect(space.service.list()).toHaveLength(1);
	});

	it("clears the completed tasks, then all tasks, and deletes the emptied file", async () => {
		const space = workspace();
		for (const subject of ["a", "b", "c"]) space.service.create(subject, "d");
		space.service.update("1", { status: "completed" });
		const { ui } = scriptedUi([pick("Clear completed"), undefined]);
		await showTasksMenu(env(space, ui));
		expect(space.service.list().map((task) => task.subject)).toEqual(["b", "c"]);
		expect(existsSync(space.taskFile)).toBe(true);
		const all = scriptedUi([pick("Clear all"), undefined]);
		await showTasksMenu(env(space, all.ui));
		expect(space.service.list()).toEqual([]);
		expect(existsSync(space.taskFile)).toBe(false);
	});
});

describe("the task settings list", () => {
	const LABELS = [
		"Task storage",
		"Collapse completed tasks",
		"Show all tasks in widget",
		"Max visible tasks in widget",
		"Widget sort order",
		"Hidden tasks position",
		"Auto-clear completed tasks",
	];

	it("shows seven rows with their values, and a change writes the project's own values plus that key and reloads", async () => {
		const space = workspace({ sortOrder: "active" }, { maxVisible: 5 });
		const { ui, settings, notices } = scriptedUi(["Settings", undefined], [], [KEY.space]);
		await showTasksMenu(env(space, ui));
		const before = settings[0];
		expect(before[0].trim()).toBe("Task Settings");
		const rows = before.filter((line) => LABELS.some((label) => line.includes(label)));
		expect(rows.map((row) => LABELS.find((label) => row.includes(label)))).toEqual(LABELS);
		expect(rows[0]).toMatch(/Task storage\s+session/);
		expect(rows[3]).toMatch(/Max visible tasks in widget\s+5/);
		expect(rows[4]).toMatch(/Widget sort order\s+active/);
		expect(settings[1].find((line) => line.includes("Task storage"))).toMatch(/Task storage\s+memory/);
		expect(JSON.parse(readFileSync(join(space.cwd, ".pi", "settings.json"), "utf8"))).toEqual({
			theme: "dark",
			forkBuiltins: { tasks: { maxVisible: 5, taskScope: "memory" } },
		});
		expect(space.service.settings).toMatchObject({ taskScope: "memory", maxVisible: 5, sortOrder: "active" });
		expect(notices).toEqual([]);
	});

	it("keeps a project value another process wrote after the session read the file", async () => {
		const space = workspace({}, { maxVisible: 5 });
		writeFileSync(
			join(space.cwd, ".pi", "settings.json"),
			JSON.stringify({ theme: "dark", forkBuiltins: { tasks: { maxVisible: 5, sortOrder: "recent" } } }),
		);
		const { ui } = scriptedUi(["Settings", undefined], [], [KEY.space]);
		await showTasksMenu(env(space, ui));
		expect(JSON.parse(readFileSync(join(space.cwd, ".pi", "settings.json"), "utf8")).forkBuiltins.tasks).toEqual({
			maxVisible: 5,
			sortOrder: "recent",
			taskScope: "memory",
		});
	});

	it("saves two quick changes one after another, so the second keeps the first", async () => {
		const space = workspace({}, { maxVisible: 5 });
		const { ui } = scriptedUi(["Settings", undefined], [], [KEY.space, KEY.down, KEY.space]);
		await showTasksMenu(env(space, ui));
		expect(JSON.parse(readFileSync(join(space.cwd, ".pi", "settings.json"), "utf8")).forkBuiltins.tasks).toEqual({
			maxVisible: 5,
			taskScope: "memory",
			collapseCompleted: true,
		});
		expect(space.service.settings).toMatchObject({ taskScope: "memory", collapseCompleted: true, maxVisible: 5 });
	});

	it("shows an untrusted project's values read-only with a notice, and writes nothing", async () => {
		const space = workspace({ maxVisible: 7 }, { maxVisible: 5 }, false);
		const before = readFileSync(join(space.cwd, ".pi", "settings.json"), "utf8");
		const { ui, settings, notices } = scriptedUi(["Settings", undefined], [], [KEY.space, KEY.down, KEY.space]);
		await showTasksMenu(env(space, ui));
		expect(notices).toEqual(["This project is not trusted: task settings are read-only here."]);
		expect(settings[1].find((line) => line.includes("Task storage"))).toMatch(/Task storage\s+session/);
		expect(settings[1].find((line) => line.includes("Max visible"))).toMatch(/Max visible tasks in widget\s+7/);
		expect(readFileSync(join(space.cwd, ".pi", "settings.json"), "utf8")).toBe(before);
	});

	it("strips escape sequences from the reason a failed save notifies", async () => {
		const space = workspace({}, undefined);
		mkdirSync(join(space.cwd, ".pi"));
		writeFileSync(join(space.cwd, ".pi", "settings.json"), '{ "a": \u001b[2J }');
		const { ui, notices } = scriptedUi(["Settings", undefined], [], [KEY.space]);
		await showTasksMenu(env(space, ui));
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/^Task settings not saved: /);
		expect(notices[0]).not.toContain("\u001b");
	});

	it("warns when the write fails and changes nothing", async () => {
		const space = workspace({}, undefined);
		mkdirSync(join(space.cwd, ".pi"));
		writeFileSync(join(space.cwd, ".pi", "settings.json"), "[1, 2]");
		const { ui, notices } = scriptedUi(["Settings", undefined], [], [KEY.space]);
		await showTasksMenu(env(space, ui));
		expect(notices).toEqual(["Task settings not saved: The project settings.json does not hold a JSON object"]);
		expect(readFileSync(join(space.cwd, ".pi", "settings.json"), "utf8")).toBe("[1, 2]");
		expect(space.service.settings.taskScope).toBe("session");
	});
});
