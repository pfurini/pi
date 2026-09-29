/**
 * Fork-owned: turn-based clearing of completed tasks (plan T2 cases 10 to 12), as pi-tasks'
 * `src/auto-clear.ts` cleared them at 83480bd. The service's file deletion is covered in
 * `test/suite/fork-tasks-service.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { AutoClear } from "../../../src/core/fork-builtins/tasks/auto-clear.ts";
import type { AutoClearMode } from "../../../src/core/fork-builtins/tasks/settings.ts";
import { TaskStore } from "../../../src/core/fork-builtins/tasks/store.ts";

/** A store and its auto-clear under a mode the test may change. */
function setup(initial: AutoClearMode) {
	const store = new TaskStore(undefined, () => {});
	let mode = initial;
	const autoClear = new AutoClear(
		() => store,
		() => mode,
	);
	/** Completes a task at `turn`, as the service does. */
	const complete = (id: string, turn: number) => {
		store.update(id, { status: "completed" });
		autoClear.trackCompletion(id, turn);
	};
	const subjects = () => store.list().map((task) => task.subject);
	const setMode = (next: AutoClearMode) => {
		mode = next;
	};
	return { store, autoClear, complete, subjects, setMode };
}

describe("auto-clear on_list_complete", () => {
	it("clears the whole list four turns after its last task completed, and never while a task is open", () => {
		const { store, autoClear, complete, subjects } = setup("on_list_complete");
		store.create("a", "d");
		store.create("b", "d");
		complete("1", 1);
		expect(autoClear.onTurnStart(9)).toBe(false);
		expect(subjects()).toEqual(["a", "b"]);
		complete("2", 10);
		expect(autoClear.onTurnStart(11)).toBe(false);
		expect(autoClear.onTurnStart(13)).toBe(false);
		expect(subjects()).toEqual(["a", "b"]);
		expect(autoClear.onTurnStart(14)).toBe(true);
		expect(subjects()).toEqual([]);
	});

	it("cancels the countdown when a task goes back to work or a new task is created", () => {
		const { store, autoClear, complete, subjects } = setup("on_list_complete");
		store.create("a", "d");
		complete("1", 1);
		store.update("1", { status: "in_progress" });
		autoClear.resetBatchCountdown();
		expect(autoClear.onTurnStart(5)).toBe(false);
		complete("1", 6);
		autoClear.startNewBatch();
		store.create("b", "d");
		expect(autoClear.onTurnStart(20)).toBe(false);
		expect(subjects()).toEqual(["a", "b"]);
	});

	it("counts the new batch's own countdown from its last completion", () => {
		const { store, autoClear, complete, subjects } = setup("on_list_complete");
		store.create("old", "d");
		complete("1", 1);
		autoClear.onRunEnded();
		autoClear.startNewBatch();
		store.create("new", "d");
		expect(subjects()).toEqual(["new"]);
		complete("2", 8);
		expect(autoClear.onTurnStart(11)).toBe(false);
		expect(subjects()).toEqual(["new"]);
		expect(autoClear.onTurnStart(12)).toBe(true);
		expect(subjects()).toEqual([]);
	});
});

describe("auto-clear on_task_complete", () => {
	it("clears each completed task four turns after it completed, and leaves open tasks alone", () => {
		const { store, autoClear, complete, subjects } = setup("on_task_complete");
		for (const subject of ["a", "b", "c"]) store.create(subject, "d");
		store.update("3", { status: "in_progress" });
		complete("1", 1);
		complete("2", 3);
		expect(autoClear.onTurnStart(4)).toBe(false);
		expect(autoClear.onTurnStart(5)).toBe(true);
		expect(subjects()).toEqual(["b", "c"]);
		expect(autoClear.onTurnStart(6)).toBe(false);
		expect(autoClear.onTurnStart(7)).toBe(true);
		expect(subjects()).toEqual(["c"]);
		expect(autoClear.onTurnStart(50)).toBe(false);
	});

	it("forgets a task that went back to work or was deleted", () => {
		const { store, autoClear, complete, subjects } = setup("on_task_complete");
		store.create("reverted", "d");
		store.create("deleted", "d");
		complete("1", 1);
		complete("2", 1);
		store.update("1", { status: "pending" });
		store.delete("2");
		expect(autoClear.onTurnStart(2)).toBe(false);
		store.create("recreated", "d");
		expect(autoClear.onTurnStart(9)).toBe(false);
		expect(subjects()).toEqual(["reverted", "recreated"]);
	});

	it("follows a mode change from the next completion and turn", () => {
		const { store, autoClear, complete, subjects, setMode } = setup("never");
		store.create("a", "d");
		store.create("b", "d");
		complete("1", 1);
		expect(autoClear.onTurnStart(10)).toBe(false);
		setMode("on_task_complete");
		complete("2", 10);
		expect(autoClear.onTurnStart(14)).toBe(true);
		expect(subjects()).toEqual(["a"]);
	});
});

describe("auto-clear never, and new batches", () => {
	it("never clears anything in never mode, whatever the turns or runs", () => {
		const { store, autoClear, complete, subjects } = setup("never");
		store.create("a", "d");
		complete("1", 1);
		expect(autoClear.onTurnStart(100)).toBe(false);
		autoClear.onRunEnded();
		autoClear.startNewBatch();
		store.create("b", "d");
		expect(subjects()).toEqual(["a", "b"]);
	});

	it.each(["on_list_complete", "on_task_complete"] as const)(
		"retires a finished list when a later run creates a task (%s)",
		(mode) => {
			const { store, autoClear, complete, subjects } = setup(mode);
			store.create("a", "d");
			store.create("b", "d");
			complete("1", 1);
			complete("2", 1);
			autoClear.onRunEnded();
			autoClear.startNewBatch();
			store.create("next", "d");
			expect(subjects()).toEqual(["next"]);
			expect(autoClear.onTurnStart(30)).toBe(false);
		},
	);

	it("keeps a list built within the same run, and arms once per run", () => {
		const { store, autoClear, complete, subjects } = setup("on_list_complete");
		autoClear.startNewBatch();
		store.create("a", "d");
		complete("1", 1);
		autoClear.startNewBatch();
		store.create("b", "d");
		expect(subjects()).toEqual(["a", "b"]);
		autoClear.onRunEnded();
		complete("2", 2);
		autoClear.startNewBatch();
		store.create("c", "d");
		expect(subjects()).toEqual(["c"]);
		complete("3", 3);
		autoClear.startNewBatch();
		store.create("d", "d");
		expect(subjects()).toEqual(["c", "d"]);
	});

	it("leaves a list with unfinished work alone, and does nothing on an empty list", () => {
		const { store, autoClear, complete, subjects } = setup("on_list_complete");
		autoClear.onRunEnded();
		autoClear.startNewBatch();
		expect(subjects()).toEqual([]);
		store.create("done", "d");
		store.create("open", "d");
		complete("1", 1);
		autoClear.onRunEnded();
		autoClear.startNewBatch();
		store.create("next", "d");
		expect(subjects()).toEqual(["done", "open", "next"]);
	});
});
