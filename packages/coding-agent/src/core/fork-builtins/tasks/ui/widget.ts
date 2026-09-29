/**
 * Fork-owned: the `tasks` widget above the editor (pi-tasks `src/ui/task-widget.ts` and
 * `src/task-glyphs.ts` at 83480bd, with the default glyphs only, D49). It shows in `tui` mode, and in
 * `rpc` mode as plain lines, which RPC forwards to its client.
 *
 * A summary line counts the tasks by status. Each row shows a status glyph, the id and the subject;
 * a completed row is struck through, a pending row names its open blockers, and a task the session
 * or an agent works on now shows a spinner, its active form, its elapsed time and its tokens.
 * `sortOrder`, `collapseCompleted`, `showAll`, `maxVisible` and `hiddenAt` are read when rendering.
 *
 * No UI failure escapes. A render that throws draws nothing for one frame. A failed `setWidget`,
 * `requestRender` or removal goes to `onError` and stops the spinner, and the next change tries again:
 * an exception out of a timer or a microtask would end Pi's interactive mode.
 */
import { type Component, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import { displayText } from "../../subagents/ui/format.ts";
import type { TaskService } from "../service/service.ts";
import { sortTasks } from "../sort.ts";
import type { Task } from "../store.ts";

const WIDGET_KEY = "tasks";
/** How often the spinner advances while a task is worked on. */
const FRAME_MS = 150;
const SPINNER = ["✳", "✴", "✵", "✶", "✷", "✸", "✹", "✺", "✻", "✼", "✽"];

export interface WidgetTheme {
	fg(color: string, text: string): string;
	strikethrough(text: string): string;
}

/** The plain look RPC lines use. */
const PLAIN: WidgetTheme = { fg: (_color, text) => text, strikethrough: (text) => text };

/** What the widget reads from the service. */
export type TaskWidgetSource = Pick<
	TaskService,
	"list" | "get" | "settings" | "activity" | "workingIds" | "subscribe" | "isDisposed"
>;

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const restSeconds = seconds % 60;
	if (minutes < 60) return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function formatTokens(count: number): string {
	return count < 1000 ? String(count) : `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/** The widget's lines for one frame; empty when the list is empty. */
export function renderTaskLines(source: TaskWidgetSource, theme: WidgetTheme, frame: number): string[] {
	const settings = source.settings;
	const tasks = sortTasks(source.list(), settings.sortOrder);
	if (tasks.length === 0) return [];
	const completed = tasks.filter((task) => task.status === "completed");
	const inProgress = tasks.filter((task) => task.status === "in_progress");
	const pending = tasks.filter((task) => task.status === "pending");
	const counts = [
		completed.length > 0 ? `${completed.length} done` : "",
		inProgress.length > 0 ? `${inProgress.length} in progress` : "",
		pending.length > 0 ? `${pending.length} open` : "",
	].filter(Boolean);
	const lines = [`${theme.fg("accent", "●")} ${theme.fg("accent", `${tasks.length} tasks (${counts.join(", ")})`)}`];
	const listed = settings.collapseCompleted ? tasks.filter((task) => task.status !== "completed") : tasks;
	const top = settings.hiddenAt === "top";
	const visible = settings.showAll
		? listed
		: top
			? listed.slice(-settings.maxVisible)
			: listed.slice(0, settings.maxVisible);
	const hidden = listed.length - visible.length;
	const overflow = hidden > 0 ? theme.fg("dim", `    … and ${hidden} more`) : undefined;
	if (overflow && top) lines.push(overflow);
	const working = new Set(source.workingIds());
	for (const task of visible) lines.push(row(source, task, working.has(task.id), theme, frame));
	if (overflow && !top) lines.push(overflow);
	if (settings.collapseCompleted && completed.length > 0) {
		lines.push(`  ${theme.fg("success", "✔")} ${theme.fg("dim", `${completed.length} completed`)}`);
	}
	return lines;
}

/**
 * Task text safe for one terminal line. The model wrote it, maybe from a file holding escape sequences,
 * and ids and metadata come from an editable task file too; lookups keep the stored values.
 */
const oneLine = (text: string): string => displayText(text).replace(/\s*\n\s*/g, " ");

function row(source: TaskWidgetSource, task: Task, working: boolean, theme: WidgetTheme, frame: number): string {
	const agentId = typeof task.metadata.agentId === "string" ? oneLine(task.metadata.agentId).slice(0, 5) : undefined;
	const subject = oneLine(task.subject);
	const id = `#${oneLine(task.id)}`;
	if (working && task.status === "in_progress") {
		const spinner = theme.fg("accent", SPINNER[frame % SPINNER.length]);
		const agent = agentId ? ` (agent ${agentId})` : "";
		const activity = source.activity(task.id);
		let stats = "";
		if (activity) {
			const tokens = [
				activity.inputTokens > 0 ? `↑ ${formatTokens(activity.inputTokens)}` : "",
				activity.outputTokens > 0 ? `↓ ${formatTokens(activity.outputTokens)}` : "",
			].filter(Boolean);
			const elapsed = formatDuration(Date.now() - activity.startedAt);
			stats = ` ${theme.fg("dim", tokens.length > 0 ? `(${elapsed} · ${tokens.join(" ")})` : `(${elapsed})`)}`;
		}
		return `  ${spinner} ${theme.fg("dim", id)} ${theme.fg("accent", `${task.activeForm ? oneLine(task.activeForm) : subject}${agent}…`)}${stats}`;
	}
	if (task.status === "completed") {
		return `  ${theme.fg("success", "✔")} ${theme.fg("dim", theme.strikethrough(`${id} ${subject}`))}`;
	}
	const glyph = task.status === "in_progress" ? theme.fg("accent", "◼") : "◻";
	const agent = task.status === "in_progress" && agentId ? theme.fg("dim", ` (agent ${agentId})`) : "";
	const open =
		task.status === "pending"
			? task.blockedBy.filter((id) => {
					const blocker = source.get(id);
					return blocker && blocker.status !== "completed";
				})
			: [];
	const blocked =
		open.length > 0
			? theme.fg("dim", ` › blocked by ${open.map((blocker) => `#${oneLine(blocker)}`).join(", ")}`)
			: "";
	return `  ${glyph} ${theme.fg("dim", id)} ${subject}${agent}${blocked}`;
}

export class TaskWidget {
	private readonly source: TaskWidgetSource;
	private readonly ui: Pick<ExtensionUIContext, "setWidget">;
	/** RPC takes plain lines; the TUI takes a component. */
	private readonly plain: boolean;
	private readonly onError: (error: unknown) => void;
	private readonly unsubscribe: () => void;
	private registered = false;
	private tui?: TUI;
	private timer?: ReturnType<typeof setInterval>;
	private frame = 0;
	private pending = false;
	private disposed = false;

	constructor(
		source: TaskWidgetSource,
		ui: Pick<ExtensionUIContext, "setWidget">,
		plain: boolean,
		onError: (error: unknown) => void,
	) {
		this.source = source;
		this.ui = ui;
		this.plain = plain;
		this.onError = onError;
		this.unsubscribe = source.subscribe((event) => {
			if (event.type === "changed") this.schedule();
		});
		this.update();
	}

	dispose(): void {
		if (this.disposed) return;
		const registered = this.release();
		if (!registered) return;
		try {
			this.ui.setWidget(WIDGET_KEY, undefined);
		} catch (error) {
			this.onError(error);
		}
	}

	/** Stops reaching the UI; true when the widget was registered. */
	private release(): boolean {
		this.disposed = true;
		this.unsubscribe();
		this.stopTimer();
		const registered = this.registered;
		this.registered = false;
		this.tui = undefined;
		return registered;
	}

	/**
	 * A directly disposed session emits no `session_shutdown`, and its UI context is already invalidated,
	 * so the widget stops without touching the UI.
	 */
	private released(): boolean {
		if (this.disposed) return true;
		if (!this.source.isDisposed) return false;
		this.release();
		return true;
	}

	/** Several changes in one tick redraw once. */
	private schedule(): void {
		if (this.pending) return;
		this.pending = true;
		queueMicrotask(() => {
			this.pending = false;
			this.update();
		});
	}

	private update(): void {
		if (this.released()) return;
		try {
			this.sync();
		} catch (error) {
			this.stopTimer();
			this.onError(error);
		}
	}

	private sync(): void {
		const tasks = this.source.list();
		if (tasks.length === 0) {
			if (this.registered) this.ui.setWidget(WIDGET_KEY, undefined);
			this.registered = false;
			this.tui = undefined;
			this.stopTimer();
			return;
		}
		if (this.plain) {
			this.ui.setWidget(WIDGET_KEY, renderTaskLines(this.source, PLAIN, 0), { placement: "aboveEditor" });
			this.registered = true;
			return;
		}
		const spinning = this.source.workingIds().length > 0;
		if (spinning) this.startTimer();
		else this.stopTimer();
		if (this.registered) {
			this.tui?.requestRender();
			return;
		}
		this.ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				this.tui = tui;
				return { render: (width: number) => this.render(theme, width), invalidate: () => {} } satisfies Component;
			},
			{ placement: "aboveEditor" },
		);
		// Only a registration that succeeded counts; a failed one is tried again at the next change.
		this.registered = true;
	}

	private render(theme: WidgetTheme, width: number): string[] {
		try {
			return renderTaskLines(this.source, theme, this.frame).map((line) => truncateToWidth(line, width, "..."));
		} catch {
			return [];
		}
	}

	private startTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			if (this.released()) return;
			this.frame++;
			try {
				this.tui?.requestRender();
			} catch (error) {
				this.stopTimer();
				this.onError(error);
			}
		}, FRAME_MS);
		this.timer.unref?.();
	}

	private stopTimer(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}
}
