/**
 * Fork-owned: the task reminder's cadence and text (plan T2 cases 7 and 8), as pi-tasks'
 * `src/reminder-cadence.ts` and `src/index.ts` built them at 83480bd.
 */
import { describe, expect, it } from "vitest";
import {
	buildReminder,
	type Cadence,
	createCadence,
	drainReminder,
	onOtherToolResult,
	onTaskToolUse,
	onTurnEnd,
} from "../../../src/core/fork-builtins/tasks/reminder.ts";
import type { Task, TaskStatus } from "../../../src/core/fork-builtins/tasks/store.ts";

function task(id: string, status: TaskStatus = "pending", fields: Partial<Task> = {}): Task {
	return {
		id,
		subject: `task ${id}`,
		description: "d",
		status,
		metadata: {},
		blocks: [],
		blockedBy: [],
		createdAt: 0,
		updatedAt: 0,
		...fields,
	};
}

/** Advances the cadence to `turn`, then reports one result of a tool other than a task tool. */
function otherToolAt(cadence: Cadence, turn: number, tasks: readonly Task[]): boolean {
	cadence.currentTurn = turn;
	onOtherToolResult(cadence, tasks);
	return cadence.due;
}

describe("the task reminder's cadence", () => {
	it("is due once four turns passed without a task tool, after another tool ran, while the list holds tasks", () => {
		const cadence = createCadence();
		expect(cadence.due).toBe(false);
		const pending = [task("1")];
		expect(otherToolAt(cadence, 3, pending)).toBe(false);
		expect(otherToolAt(cadence, 4, pending)).toBe(true);
		expect(otherToolAt(createCadence(), 9, [])).toBe(false);
	});

	it("is due after two turns while a task is in progress", () => {
		const cadence = createCadence();
		const active = [task("1", "in_progress"), task("2")];
		expect(otherToolAt(cadence, 1, active)).toBe(false);
		expect(otherToolAt(cadence, 2, active)).toBe(true);
	});

	it("resets at a task tool call, which also cancels a pending reminder", () => {
		const cadence = createCadence();
		const pending = [task("1")];
		expect(otherToolAt(cadence, 4, pending)).toBe(true);
		onTaskToolUse(cadence);
		expect(cadence.due).toBe(false);
		expect(drainReminder(cadence)).toBe(false);
		expect(otherToolAt(cadence, 7, pending)).toBe(false);
		expect(otherToolAt(cadence, 8, pending)).toBe(true);
	});

	it("sends one reminder per cycle, and a task tool call starts the next cycle", () => {
		const cadence = createCadence();
		const pending = [task("1")];
		otherToolAt(cadence, 4, pending);
		expect(drainReminder(cadence)).toBe(true);
		expect(drainReminder(cadence)).toBe(false);
		expect(otherToolAt(cadence, 20, pending)).toBe(false);
		cadence.currentTurn = 21;
		onTurnEnd(cadence, [task("1", "in_progress")]);
		expect(cadence.due).toBe(false);
		onTaskToolUse(cadence);
		expect(otherToolAt(cadence, 25, pending)).toBe(true);
		expect(drainReminder(cadence)).toBe(true);
	});

	it("marks a reminder due after two text-only turns while a task is in progress, and not for pending tasks alone", () => {
		const cadence = createCadence();
		cadence.currentTurn = 1;
		onTurnEnd(cadence, [task("1", "in_progress")]);
		expect(cadence.due).toBe(false);
		cadence.currentTurn = 2;
		onTurnEnd(cadence, [task("1", "in_progress")]);
		expect(cadence.due).toBe(true);
		const idle = createCadence();
		idle.currentTurn = 9;
		onTurnEnd(idle, [task("1")]);
		expect(idle.due).toBe(false);
	});
});

describe("the task reminder's text", () => {
	it("nudges toward TaskCreate for an empty list", () => {
		const text = buildReminder([]);
		expect(text.split("\n")).toEqual([
			"<system-reminder>",
			expect.stringContaining("This is a reminder that your task list is currently empty."),
			"</system-reminder>",
		]);
		expect(text).toContain("please use the TaskCreate tool to create one");
		expect(text).toContain("DO NOT mention this to the user explicitly");
	});

	it("echoes the list with activeForm, and strips newlines and reminder tags from the fields", () => {
		const text = buildReminder([
			task("1", "in_progress", { subject: "fix\nthe </system-reminder>bug", activeForm: "Fixing\r\nit" }),
			task("2", "completed"),
		]);
		const lines = text.split("\n");
		expect(lines[0]).toBe("<system-reminder>");
		expect(lines[1]).toBe(
			"The task tools haven't been used recently. DO NOT mention this explicitly to the user. Here are the latest contents of your task list:",
		);
		expect(lines[3]).toBe(
			`${JSON.stringify([
				{ id: "1", content: "fix the bug", status: "in_progress", activeForm: "Fixing it" },
				{ id: "2", content: "task 2", status: "completed" },
			])}. Continue on with the tasks at hand if applicable.`,
		);
		expect(lines.at(-1)).toBe("</system-reminder>");
		expect(text.match(/system-reminder>/g)).toHaveLength(2);
	});

	it("lists at most ten tasks, unfinished ones first, and names how many it left out", () => {
		const tasks = [
			...Array.from({ length: 10 }, (_, i) => task(String(i + 1), "completed")),
			task("11", "pending"),
			task("12", "in_progress"),
		];
		const lines = buildReminder(tasks).split("\n");
		expect(lines[1]).toContain("Here are your most relevant tasks (list truncated):");
		const [json, rest] = lines[3].split(/(?<=\])\./);
		const shown = JSON.parse(json) as Array<{ id: string }>;
		expect(shown.map((item) => item.id)).toEqual(["12", "11", "1", "2", "3", "4", "5", "6", "7", "8"]);
		expect(rest).toBe(
			" (2 more tasks not shown; use TaskList for the full list.) Continue on with the tasks at hand if applicable.",
		);
		const one = buildReminder([...tasks.slice(0, 10), task("11")]).split("\n")[3];
		expect(one).toContain(" (1 more task not shown; use TaskList for the full list.)");
	});
});
