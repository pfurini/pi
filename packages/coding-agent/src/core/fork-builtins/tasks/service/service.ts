/**
 * Fork-owned: the task service of one `AgentSession` (D46, D47). pi-tasks `src/index.ts` at 83480bd is
 * the behavior reference. The seven task base tools and the presentation factory call it; it imports
 * no presentation code.
 *
 * - The list lives in a `TaskStore`: under `taskScope: session`, the file
 *   `<cwd>/.pi/tasks/tasks-<sessionId>.json` of a session Pi saves, otherwise memory (D50).
 * - The service follows the session's own events: turns tick the reminder cadence and the
 *   auto-clear countdowns, and a settled run marks the batch boundary.
 * - `/reload` keeps the service and its list. The session's end leaves the list for a fork of it.
 */
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "../../../agent-session.ts";
import { AutoClear } from "../auto-clear.ts";
import { TASK_CREATE_TOOL_NAME, TASK_TOOL_NAMES } from "../names.ts";
import {
	buildReminder,
	type Cadence,
	createCadence,
	drainReminder,
	onOtherToolResult,
	onTaskToolUse,
	onTurnEnd,
} from "../reminder.ts";
import { readTaskSettings, type TaskSettings } from "../settings.ts";
import { type Task, TaskStore, type TaskStoreData, type TaskUpdate, type TaskUpdateResult } from "../store.ts";

export type TaskEvent = { type: "changed" } | { type: "warning"; message: string };

/** What the widget shows for a task the session works on now. */
export interface TaskActivity {
	readonly startedAt: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
}

/**
 * The lists ended sessions leave for a fork. Pi disposes a session before it starts the fork, and other
 * sessions or children may end in between, so each keeps its own entry. A saved session's entry is keyed
 * by its file, which the fork's `session_start` names; the oldest leave past `HANDOFF_LIMIT`. A fork of
 * an unsaved session reuses the parent's session manager (`agent-session-runtime.ts`, `fork`), so that
 * entry is keyed by the manager and leaves with it.
 */
const handoffsByFile = new Map<string, () => TaskStoreData>();
const handoffsByManager = new WeakMap<object, () => TaskStoreData>();
const HANDOFF_LIMIT = 16;

export class TaskService {
	readonly session: AgentSession;
	private settingsValue: Readonly<TaskSettings>;
	private readonly store: TaskStore;
	private readonly cadence: Cadence = createCadence();
	private readonly autoClear: AutoClear;
	private readonly working = new Map<string, { startedAt: number; inputTokens: number; outputTokens: number }>();
	private readonly listeners = new Set<(event: TaskEvent) => void>();
	private readonly warned = new Set<string>();
	/** Warnings sent before a presentation listened; the first listener receives them. */
	private pendingWarnings: string[] = [];
	private readonly offSession: () => void;
	private readonly offCleanup: () => void;
	private disposed = false;

	constructor(session: AgentSession) {
		this.session = session;
		const { settings, warnings } = readTaskSettings(session.settingsManager);
		this.settingsValue = settings;
		for (const warning of warnings) this.warn(warning);
		this.store = this.openStore();
		this.autoClear = new AutoClear(
			() => this.store,
			() => this.settingsValue.autoClearCompleted,
		);
		this.offSession = session.subscribe((event) => this.onSessionEvent(event));
		this.offCleanup = registerSessionResourceCleanup((sessionId) => {
			if (sessionId === session.sessionId) this.dispose();
		});
	}

	get settings(): Readonly<TaskSettings> {
		return this.settingsValue;
	}

	/** The file the list is saved to; undefined while it lives in memory. */
	get file(): string | undefined {
		return this.store.file;
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	private openStore(): TaskStore {
		const manager = this.session.sessionManager;
		// `--no-session` names a session id but never writes a session file, so its list is not saved either.
		const path =
			this.settingsValue.taskScope === "session" && manager.getSessionFile()
				? join(manager.getCwd(), ".pi", "tasks", `tasks-${manager.getSessionId()}.json`)
				: undefined;
		return new TaskStore(path, (message) => this.warn(message), manager.getCwd());
	}

	subscribe(listener: (event: TaskEvent) => void): () => void {
		this.listeners.add(listener);
		const pending = this.pendingWarnings;
		this.pendingWarnings = [];
		for (const message of pending) listener({ type: "warning", message });
		return () => this.listeners.delete(listener);
	}

	private emit(event: TaskEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	private changed(): void {
		this.emit({ type: "changed" });
	}

	/** Reports a warning once per distinct text. */
	warn(message: string): void {
		if (this.warned.has(message)) return;
		this.warned.add(message);
		if (this.listeners.size === 0) this.pendingWarnings.push(message);
		else this.emit({ type: "warning", message });
	}

	reloadSettings(): void {
		const { settings, warnings } = readTaskSettings(this.session.settingsManager);
		this.settingsValue = settings;
		for (const warning of warnings) this.warn(warning);
		this.changed();
	}

	/**
	 * The presentation calls it at each `session_start`. A fork takes the list its parent left, a
	 * resume, fork or reload shows the carried list as a finished batch, and a startup or `/new`
	 * clears a list whose tasks all completed. `/reload` retries a failed write (D50).
	 */
	onSessionStart(reason: "startup" | "reload" | "new" | "resume" | "fork", previousSessionFile?: string): void {
		if (reason === "reload") {
			this.reloadSettings();
			this.store.retryWrite();
		}
		if (reason === "fork") {
			const manager = this.session.sessionManager;
			const read = previousSessionFile ? handoffsByFile.get(previousSessionFile) : handoffsByManager.get(manager);
			if (previousSessionFile) handoffsByFile.delete(previousSessionFile);
			else handoffsByManager.delete(manager);
			if (read) this.store.seed(structuredClone(read()));
		}
		if (reason === "reload" || reason === "resume" || reason === "fork") this.autoClear.onRunEnded();
		else {
			const tasks = this.store.list();
			if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) {
				this.store.clearCompleted();
				this.store.deleteFileIfEmpty();
			}
		}
		this.changed();
	}

	private onSessionEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "turn_start":
				this.cadence.currentTurn++;
				if (this.autoClear.onTurnStart(this.cadence.currentTurn)) {
					this.store.deleteFileIfEmpty();
					this.changed();
				}
				return;
			case "turn_end": {
				const usage = (event.message as { role?: string; usage?: Usage }).usage;
				if (event.message.role === "assistant" && usage) {
					for (const activity of this.working.values()) {
						activity.inputTokens += usage.input ?? 0;
						activity.outputTokens += usage.output ?? 0;
					}
				}
				onTurnEnd(this.cadence, this.store.list());
				return;
			}
			case "tool_execution_end":
				if (TASK_TOOL_NAMES.has(event.toolName)) onTaskToolUse(this.cadence);
				else onOtherToolResult(this.cadence, this.store.list());
				return;
			case "agent_settled":
				this.autoClear.onRunEnded();
				return;
		}
	}

	/**
	 * The reminder the next model request carries, or undefined. Only a session whose model can call
	 * `TaskCreate` gets one.
	 */
	takeReminder(): string | undefined {
		if (!this.session.getActiveToolNames().includes(TASK_CREATE_TOOL_NAME)) return undefined;
		if (!drainReminder(this.cadence)) return undefined;
		return buildReminder(this.store.list());
	}

	list(): Task[] {
		return this.store.list();
	}

	get(id: string): Task | undefined {
		return this.store.get(id);
	}

	/** What the widget shows for each task the session works on now. */
	activity(taskId: string): TaskActivity | undefined {
		return this.working.get(taskId);
	}

	private markWorking(taskId: string, on: boolean): void {
		if (on) {
			if (!this.working.has(taskId))
				this.working.set(taskId, { startedAt: Date.now(), inputTokens: 0, outputTokens: 0 });
		} else this.working.delete(taskId);
	}

	/** Task ids shown with the spinner: in progress and worked on in this session. */
	workingIds(): string[] {
		for (const id of this.working.keys()) {
			if (this.store.get(id)?.status !== "in_progress") this.working.delete(id);
		}
		return [...this.working.keys()];
	}

	create(
		subject: string,
		description: string,
		activeForm?: string,
		agentType?: string,
		metadata?: Record<string, unknown>,
	): Task {
		// A finished list must not collect the batch that follows it (auto-clear.ts).
		this.autoClear.startNewBatch();
		const meta = { ...metadata };
		if (agentType) meta.agentType = agentType;
		const task = this.store.create(subject, description, activeForm, Object.keys(meta).length > 0 ? meta : undefined);
		this.changed();
		return task;
	}

	update(id: string, fields: TaskUpdate): TaskUpdateResult {
		const result = this.store.update(id, fields);
		if (fields.status === "in_progress") {
			this.markWorking(id, true);
			this.autoClear.resetBatchCountdown();
		} else if (fields.status === "pending") {
			this.autoClear.resetBatchCountdown();
		} else if (fields.status === "completed" || fields.status === "deleted") {
			this.markWorking(id, false);
			if (fields.status === "completed") this.autoClear.trackCompletion(id, this.cadence.currentTurn);
		}
		if (fields.status === "deleted") this.store.deleteFileIfEmpty();
		this.changed();
		return result;
	}

	clearCompleted(): number {
		const count = this.store.clearCompleted();
		this.store.deleteFileIfEmpty();
		this.changed();
		return count;
	}

	clearAll(): number {
		const count = this.store.clearAll();
		this.store.deleteFileIfEmpty();
		this.changed();
		return count;
	}

	/** The session ended: the list stays readable for a fork of this session. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.offSession();
		this.offCleanup();
		const store = this.store;
		const read = () => store.snapshot();
		const file = this.session.sessionFile;
		if (!file) {
			handoffsByManager.set(this.session.sessionManager, read);
		} else {
			handoffsByFile.delete(file);
			handoffsByFile.set(file, read);
			for (const oldest of handoffsByFile.keys()) {
				if (handoffsByFile.size <= HANDOFF_LIMIT) break;
				handoffsByFile.delete(oldest);
			}
		}
		this.listeners.clear();
	}
}
