/**
 * Fork-owned: the task reminder (pi-tasks `src/reminder-cadence.ts` and `src/index.ts:60-128` at
 * 83480bd). After `REMINDER_INTERVAL` turns without a task tool call, or `ACTIVE_REMINDER_INTERVAL`
 * while a task is in progress, the next model request carries one transient user message: a nudge
 * for an empty list, or the list itself. No session keeps the message. The wording follows Claude
 * Code's todo reminders.
 */
import type { Task } from "./store.ts";

/** Turns without a task tool call before a reminder is due. */
export const REMINDER_INTERVAL = 4;
/** The shorter interval while a task is in progress, so stale work is caught sooner. */
export const ACTIVE_REMINDER_INTERVAL = 2;
/** The most tasks the reminder lists. */
const REMINDER_MAX_TASKS = 10;

export interface Cadence {
	currentTurn: number;
	lastTaskToolUseTurn: number;
	/** A reminder went out since the last task tool call. */
	injectedThisCycle: boolean;
	/** The next model request carries a reminder. */
	due: boolean;
}

export function createCadence(): Cadence {
	return { currentTurn: 0, lastTaskToolUseTurn: 0, injectedThisCycle: false, due: false };
}

export function intervalFor(tasks: readonly Task[]): number {
	return tasks.some((task) => task.status === "in_progress") ? ACTIVE_REMINDER_INTERVAL : REMINDER_INTERVAL;
}

/** A task tool call resets the cadence and cancels a pending reminder. */
export function onTaskToolUse(cadence: Cadence): void {
	cadence.lastTaskToolUseTurn = cadence.currentTurn;
	cadence.injectedThisCycle = false;
	cadence.due = false;
}

/** Another tool's result marks a reminder due once the interval has passed and the list holds tasks. */
export function onOtherToolResult(cadence: Cadence, tasks: readonly Task[]): void {
	if (cadence.injectedThisCycle || cadence.due || tasks.length === 0) return;
	if (cadence.currentTurn - cadence.lastTaskToolUseTurn >= intervalFor(tasks)) cadence.due = true;
}

/**
 * A turn ended. A text-only turn runs no tool, so an in-progress task left behind is caught here:
 * the reminder is due once the in-progress interval has passed.
 */
export function onTurnEnd(cadence: Cadence, tasks: readonly Task[]): void {
	if (cadence.injectedThisCycle || cadence.due) return;
	if (cadence.currentTurn - cadence.lastTaskToolUseTurn < ACTIVE_REMINDER_INTERVAL) return;
	if (tasks.some((task) => task.status === "in_progress")) cadence.due = true;
}

/** True when the next request carries the reminder; the cadence then waits a full interval again. */
export function drainReminder(cadence: Cadence): boolean {
	if (!cadence.due) return false;
	cadence.due = false;
	cadence.injectedThisCycle = true;
	cadence.lastTaskToolUseTurn = cadence.currentTurn;
	return true;
}

/** Collapses newlines and strips reminder tags, so a task field cannot close the reminder early. */
function sanitizeField(value: string): string {
	return value
		.replace(/[\r\n]+/g, " ")
		.replace(/<\/?system-reminder>/gi, "")
		.trim();
}

const rank = (task: Task): number => (task.status === "in_progress" ? 0 : task.status === "pending" ? 1 : 2);

export function buildReminder(tasks: readonly Task[]): string {
	if (tasks.length === 0) {
		return [
			"<system-reminder>",
			"This is a reminder that your task list is currently empty. DO NOT mention this to the user explicitly because they are already aware. If you are working on tasks that would benefit from a task list please use the TaskCreate tool to create one. If not, please feel free to ignore. Again do not mention this message to the user.",
			"</system-reminder>",
		].join("\n");
	}
	// Over the cap, unfinished tasks come first: the reminder exists to surface them.
	const shown =
		tasks.length > REMINDER_MAX_TASKS
			? [...tasks].sort((a, b) => rank(a) - rank(b)).slice(0, REMINDER_MAX_TASKS)
			: tasks;
	const hidden = tasks.length - shown.length;
	const items = shown.map((task) => ({
		id: task.id,
		content: sanitizeField(task.subject),
		status: task.status,
		...(task.activeForm && { activeForm: sanitizeField(task.activeForm) }),
	}));
	const prefix = "The task tools haven't been used recently. DO NOT mention this explicitly to the user.";
	const header =
		hidden > 0
			? `${prefix} Here are your most relevant tasks (list truncated):`
			: `${prefix} Here are the latest contents of your task list:`;
	const overflow =
		hidden > 0 ? ` (${hidden} more task${hidden === 1 ? "" : "s"} not shown; use TaskList for the full list.)` : "";
	return [
		"<system-reminder>",
		header,
		"",
		`${JSON.stringify(items)}.${overflow} Continue on with the tasks at hand if applicable.`,
		"</system-reminder>",
	].join("\n");
}
