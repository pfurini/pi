/**
 * Fork-owned: the widget's sort orders (pi-tasks `src/task-sort.ts` at 83480bd). The five presets
 * stay; custom JSON sort specs are dropped (D49).
 */
import type { TaskSortOrder } from "./settings.ts";
import type { Task, TaskStatus } from "./store.ts";

const byId = (a: Task, b: Task): number => Number(a.id) - Number(b.id);

function byStatus(rank: readonly TaskStatus[]): (a: Task, b: Task) => number {
	return (a, b) => rank.indexOf(a.status) - rank.indexOf(b.status) || byId(a, b);
}

const COMPARATORS: Record<TaskSortOrder, (a: Task, b: Task) => number> = {
	id: byId,
	status: byStatus(["completed", "in_progress", "pending"]),
	active: byStatus(["in_progress", "pending", "completed"]),
	recent: (a, b) => b.updatedAt - a.updatedAt || byId(b, a),
	oldest: (a, b) => a.updatedAt - b.updatedAt || byId(a, b),
};

/** A sorted copy. */
export function sortTasks(tasks: readonly Task[], order: TaskSortOrder): Task[] {
	return [...tasks].sort(COMPARATORS[order]);
}
