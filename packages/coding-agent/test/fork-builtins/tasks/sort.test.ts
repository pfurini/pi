/**
 * Fork-owned: the widget's five sort orders (plan T1 case 15), as pi-tasks' presets order tasks at 83480bd.
 */
import { describe, expect, it } from "vitest";
import { sortTasks } from "../../../src/core/fork-builtins/tasks/sort.ts";
import type { Task, TaskStatus } from "../../../src/core/fork-builtins/tasks/store.ts";

function task(id: string, status: TaskStatus, updatedAt: number): Task {
	return {
		id,
		subject: `task ${id}`,
		description: "d",
		status,
		metadata: {},
		blocks: [],
		blockedBy: [],
		createdAt: 0,
		updatedAt,
	};
}

/** Every status, ties on updatedAt in both directions, and an id that sorts differently as text. */
const SAMPLE: readonly Task[] = [
	task("1", "pending", 30),
	task("2", "completed", 10),
	task("3", "in_progress", 30),
	task("4", "completed", 20),
	task("5", "pending", 10),
	task("6", "in_progress", 20),
	task("10", "pending", 20),
];

const ids = (tasks: readonly Task[]) => tasks.map((each) => each.id);

describe("task sort orders", () => {
	it("id orders tasks by numeric id", () => {
		expect(ids(sortTasks(SAMPLE, "id"))).toEqual(["1", "2", "3", "4", "5", "6", "10"]);
	});

	it("status puts completed first, then in progress, then pending, by id inside each group", () => {
		expect(ids(sortTasks(SAMPLE, "status"))).toEqual(["2", "4", "3", "6", "1", "5", "10"]);
	});

	it("active puts in progress first, then pending, then completed, by id inside each group", () => {
		expect(ids(sortTasks(SAMPLE, "active"))).toEqual(["3", "6", "1", "5", "10", "2", "4"]);
	});

	it("recent puts the latest update first and breaks a tie by descending id", () => {
		expect(ids(sortTasks(SAMPLE, "recent"))).toEqual(["3", "1", "10", "6", "4", "5", "2"]);
	});

	it("oldest puts the earliest update first and breaks a tie by ascending id", () => {
		expect(ids(sortTasks(SAMPLE, "oldest"))).toEqual(["2", "5", "4", "6", "10", "1", "3"]);
	});

	it("returns a sorted copy and leaves the input as it was", () => {
		const input = [task("3", "pending", 1), task("1", "pending", 1), task("2", "pending", 1)];
		expect(ids(sortTasks(input, "id"))).toEqual(["1", "2", "3"]);
		expect(ids(input)).toEqual(["3", "1", "2"]);
	});
});
