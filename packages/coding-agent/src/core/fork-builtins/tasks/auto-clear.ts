/**
 * Fork-owned: turn-based clearing of completed tasks (pi-tasks `src/auto-clear.ts` at 83480bd).
 *
 * - `on_task_complete`: each completed task leaves after `CLEAR_DELAY_TURNS` turns.
 * - `on_list_complete`: the whole list leaves `CLEAR_DELAY_TURNS` turns after its last task completed.
 * - `never`: nothing leaves on its own.
 *
 * The countdowns tick at a turn's start, so they stop with the agent. A run that ends right after
 * its last completion freezes one. `startNewBatch` therefore retires a finished list when the first
 * task of a later run is created: work added after the run that finished the list is a new batch.
 */
import type { AutoClearMode } from "./settings.ts";
import type { TaskStore } from "./store.ts";

/** Turns a completed task lingers before it leaves. */
export const CLEAR_DELAY_TURNS = 4;

export class AutoClear {
	private readonly store: () => TaskStore;
	private readonly mode: () => AutoClearMode;
	/** `on_task_complete`: the turn each task completed at. */
	private readonly completedAtTurn = new Map<string, number>();
	/** `on_list_complete`: the turn the whole list completed at. */
	private allCompletedAtTurn: number | undefined;
	/** A run ended since the list was last added to. */
	private runEnded = false;

	constructor(store: () => TaskStore, mode: () => AutoClearMode) {
		this.store = store;
		this.mode = mode;
	}

	trackCompletion(taskId: string, currentTurn: number): void {
		const mode = this.mode();
		if (mode === "on_task_complete") this.completedAtTurn.set(taskId, currentTurn);
		else if (mode === "on_list_complete") {
			const tasks = this.store().list();
			if (tasks.length > 0 && tasks.every((task) => task.status === "completed"))
				this.allCompletedAtTurn ??= currentTurn;
			else this.allCompletedAtTurn = undefined;
		}
	}

	/** A task went back to work, so the list is no longer complete. */
	resetBatchCountdown(): void {
		this.allCompletedAtTurn = undefined;
	}

	/** The run ended: the list as it stands is that run's last one. A list a resume or fork carried in counts too. */
	onRunEnded(): void {
		this.runEnded = true;
	}

	/** A task is about to be created; a finished list from an ended run leaves first. */
	startNewBatch(): void {
		this.allCompletedAtTurn = undefined;
		const afterFinishedRun = this.runEnded;
		this.runEnded = false;
		if (!afterFinishedRun || this.mode() === "never") return;
		const tasks = this.store().list();
		if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) {
			this.store().clearCompleted();
			this.completedAtTurn.clear();
		}
	}

	/** Clears tasks whose linger period ended; true when any left. */
	onTurnStart(currentTurn: number): boolean {
		const mode = this.mode();
		const store = this.store();
		let cleared = false;
		if (mode === "on_task_complete") {
			for (const [taskId, turn] of this.completedAtTurn) {
				if (store.get(taskId)?.status !== "completed") this.completedAtTurn.delete(taskId);
				else if (currentTurn - turn >= CLEAR_DELAY_TURNS) {
					store.delete(taskId);
					this.completedAtTurn.delete(taskId);
					cleared = true;
				}
			}
		} else if (mode === "on_list_complete" && this.allCompletedAtTurn !== undefined) {
			if (currentTurn - this.allCompletedAtTurn >= CLEAR_DELAY_TURNS) {
				store.clearCompleted();
				this.allCompletedAtTurn = undefined;
				cleared = true;
			}
		}
		return cleared;
	}
}
