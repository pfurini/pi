/**
 * Fork-owned: the task service of one `AgentSession` (D46, D47). pi-tasks `src/index.ts` at 83480bd is
 * the behavior reference. The seven task base tools and the presentation factory call it; it imports
 * no presentation code.
 *
 * - The list lives in a `TaskStore`: under `taskScope: session`, the file
 *   `<cwd>/.pi/tasks/tasks-<sessionId>.json` of a session Pi saves, otherwise memory (D50).
 * - The service follows the session's own events: turns tick the reminder cadence and the
 *   auto-clear countdowns, and a settled run marks the batch boundary.
 * - `TaskExecute` spawns through the typed subagent API (D19): the session's own service, or in a
 *   child the nested runtime of the agent the child runs as. The subagent service's `ended` event
 *   completes or reverts the task.
 * - `/reload` keeps the service, its list and its agents. The session's end reverts every task whose
 *   agent still runs, because the session's end aborts that agent (D21), and leaves the list for a
 *   fork of the session.
 */
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "../../../agent-session.ts";
import type { SubagentView } from "../../subagents/service/records.ts";
import { SESSION_ENDED_ERROR, type SpawnRequest, type SubagentEvent } from "../../subagents/service/service.ts";
import { type SubagentScope, subagentScope } from "../../subagents/service/sessions.ts";
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

export interface ExecuteOptions {
	additionalContext?: string;
	model?: string;
	thinking?: string;
	maxTurns?: number;
}

/** The longest prerequisite result a task prompt carries in full. */
const PREREQUISITE_RESULT_LIMIT = 4000;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
	/** Agent id to task id, for every agent `TaskExecute` started that has not reported back. */
	private readonly agentTasks = new Map<string, string>();
	private readonly working = new Map<string, { startedAt: number; inputTokens: number; outputTokens: number }>();
	private readonly listeners = new Set<(event: TaskEvent) => void>();
	private readonly warned = new Set<string>();
	/** Warnings sent before a presentation listened; the first listener receives them. */
	private pendingWarnings: string[] = [];
	private scope: SubagentScope | undefined;
	private offSubagents: (() => void) | undefined;
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
					for (const [taskId, activity] of this.working) {
						if (this.agentOf(taskId)) continue;
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

	/** What the widget shows for each task the session or one of its agents works on now. */
	activity(taskId: string): TaskActivity | undefined {
		const working = this.working.get(taskId);
		if (!working) return undefined;
		const agent = this.agentOf(taskId);
		return agent
			? { startedAt: working.startedAt, inputTokens: agent.usage.input, outputTokens: agent.usage.output }
			: working;
	}

	/** The running agent `TaskExecute` started for the task. */
	private agentOf(taskId: string): SubagentView | undefined {
		const agentId = this.store.get(taskId)?.metadata.agentId;
		if (typeof agentId !== "string" || !this.agentTasks.has(agentId)) return undefined;
		return this.scope?.service.lookup(agentId);
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

	/** The subagent scope, subscribed once; throws when the session has no subagent service. */
	private subagents(): SubagentScope {
		if (!this.scope) {
			const scope = subagentScope(this.session);
			if (!scope) throw new Error("This session has no subagent service.");
			this.scope = scope;
			this.offSubagents = scope.service.subscribe((event) => this.onSubagentEvent(event));
		}
		return this.scope;
	}

	/** The prompt of a task an agent runs: the task, its prerequisites' results, and the caller's context. */
	private taskPrompt(task: Task, additionalContext?: string): string {
		let prompt = `You are executing task #${task.id}: "${task.subject}"\n\n${task.description}`;
		const results: string[] = [];
		for (const id of task.blockedBy) {
			const prerequisite = this.store.get(id);
			const result = prerequisite?.metadata.result;
			if (typeof result !== "string" || !result) continue;
			const text =
				result.length > PREREQUISITE_RESULT_LIMIT
					? `${result.slice(0, PREREQUISITE_RESULT_LIMIT)}\n\n[... truncated; use TaskGet for full output]`
					: result;
			results.push(`### Task #${id}: ${prerequisite?.subject}\n${text}`);
		}
		if (results.length > 0) prompt += `\n\n## Prerequisite task results\n\n${results.join("\n\n")}`;
		if (additionalContext) prompt += `\n\n${additionalContext}`;
		return `${prompt}\n\nComplete this task fully. Do not attempt to manage tasks yourself.`;
	}

	/** Starts one background agent per ready task; the text lists what started and what was skipped. */
	async execute(taskIds: readonly string[], options: ExecuteOptions): Promise<string> {
		const scope = this.subagents();
		const skipped: string[] = [];
		const launched: string[] = [];
		for (const id of taskIds) {
			const task = this.store.get(id);
			if (!task) {
				skipped.push(`#${id}: not found`);
				continue;
			}
			if (task.status !== "pending") {
				skipped.push(`#${id}: not pending (status: ${task.status})`);
				continue;
			}
			const agentType = task.metadata.agentType;
			if (typeof agentType !== "string" || !agentType) {
				skipped.push(`#${id}: no agentType set; create with agentType parameter or update metadata`);
				continue;
			}
			const open = task.blockedBy.filter((blocker) => this.store.get(blocker)?.status !== "completed");
			if (open.length > 0) {
				skipped.push(`#${id}: blocked by ${open.map((blocker) => `#${blocker}`).join(", ")}`);
				continue;
			}
			this.store.update(id, { status: "in_progress" });
			try {
				const request: SpawnRequest = {
					type: agentType,
					prompt: this.taskPrompt(task, options.additionalContext),
					description: task.subject,
					model: options.model ? await scope.service.resolveCallerModel(options.model, agentType) : undefined,
					params: { max_turns: options.maxTurns, thinking: options.thinking },
					mode: "detached-background",
					// Mapped before the run starts, so even an instant end finds its task.
					onCreated: (view) => this.agentTasks.set(view.id, id),
				};
				const view = scope.nested ? await scope.nested.spawn(request) : await scope.service.spawn(request);
				this.store.update(id, { owner: view.id, metadata: { agentId: view.id } });
				this.markWorking(id, true);
				launched.push(`#${id} → agent ${view.id}`);
			} catch (error) {
				this.store.update(id, { status: "pending" });
				skipped.push(`#${id}: spawn failed: ${errorText(error)}`);
			}
		}
		this.changed();
		const lines: string[] = [];
		if (launched.length > 0) {
			lines.push(
				`Launched ${launched.length} agent(s):\n${launched.join("\n")}\nUse TaskOutput to check progress. Do not spawn additional agents for these tasks.`,
			);
		}
		if (skipped.length > 0) lines.push(`Skipped:\n${skipped.join("\n")}`);
		return lines.length > 0 ? lines.join("\n\n") : "No tasks to execute.";
	}

	/** An agent `TaskExecute` started ended: its task completes, keeps a stopped agent's partial output, or goes back to pending. */
	private onSubagentEvent(event: SubagentEvent): void {
		if (event.type !== "ended") return;
		const { id: agentId, status, result, error } = event.record;
		const taskId = this.agentTasks.get(agentId);
		if (!taskId) return;
		this.agentTasks.delete(agentId);
		const task = this.store.get(taskId);
		if (!task) return;
		if (status === "completed" || status === "steered") {
			this.store.update(taskId, { status: "completed", metadata: { result: result ?? null } });
			this.autoClear.trackCompletion(taskId, this.cadence.currentTurn);
		} else if (status === "stopped") {
			this.store.update(taskId, {
				status: "completed",
				metadata: { result: result || task.metadata.result || null },
			});
			this.autoClear.trackCompletion(taskId, this.cadence.currentTurn);
		} else {
			// A task back to pending has no current result; an earlier run's would outrank this error.
			this.store.update(taskId, { status: "pending", metadata: { result: null, lastError: error || status } });
			this.autoClear.resetBatchCountdown();
		}
		this.markWorking(taskId, false);
		this.changed();
	}

	/** A task id, or the id or id prefix of an agent `TaskExecute` started; undefined when neither matches. */
	private resolve(ref: string): Task | undefined {
		const task = this.store.get(ref);
		if (task) return task;
		const matches = (agentId: unknown) => typeof agentId === "string" && agentId.startsWith(ref);
		for (const [agentId, taskId] of this.agentTasks) {
			if (matches(agentId)) return this.store.get(taskId);
		}
		// An agent that already ended is found through the task that records it.
		return this.store.list().find((each) => matches(each.metadata.agentId));
	}

	/**
	 * The task's agent outcome. With `block`, waits up to `timeout` ms for a running agent. A result
	 * handed over here is consumed, so its completion notification is dropped.
	 */
	async output(ref: string, block: boolean, timeout: number, signal?: AbortSignal): Promise<string> {
		// An empty id would prefix-match whichever agent comes first.
		if (!ref) throw new Error("task_id is required");
		const task = this.resolve(ref);
		if (!task) throw new Error(`No task found with ID ${ref}`);
		const agentId = task.metadata.agentId;
		if (typeof agentId !== "string") throw new Error(`No background process for task ${ref}`);
		const scope = this.subagents();
		if (block && task.status === "in_progress" && this.agentTasks.has(agentId)) {
			const signals = [AbortSignal.timeout(timeout), ...(signal ? [signal] : [])];
			await scope.service.waitForResult(agentId, AbortSignal.any(signals), scope.owner).catch(() => undefined);
		}
		const current = this.store.get(task.id) ?? task;
		// Consume only an outcome the task holds; a status alone leaves the notification to announce it.
		if (!this.agentTasks.has(agentId) && current.status !== "in_progress")
			scope.service.consume(agentId, scope.owner);
		const result = current.metadata.result;
		const lastError = current.metadata.lastError;
		const output = typeof result === "string" ? result : lastError ? `Error: ${String(lastError)}` : undefined;
		return `Task #${current.id} [${current.status}]: subagent ${agentId}${output ? `\n\n${output}` : ""}`;
	}

	/** Stops the task's running agent; the task completes and keeps the agent's partial output. */
	stop(ref: string): string {
		if (!ref) throw new Error("task_id is required");
		const task = this.resolve(ref);
		const agentId = task?.metadata.agentId;
		// Only an agent this service started and still maps to the task is stopped; the metadata alone is editable.
		if (
			!task ||
			typeof agentId !== "string" ||
			task.status !== "in_progress" ||
			this.agentTasks.get(agentId) !== task.id
		) {
			throw new Error(`No running background process for task ${ref}`);
		}
		this.store.update(task.id, { status: "completed" });
		this.autoClear.trackCompletion(task.id, this.cadence.currentTurn);
		const scope = this.subagents();
		scope.service.stop(agentId, scope.owner);
		this.markWorking(task.id, false);
		this.changed();
		return `Task #${task.id} stopped successfully`;
	}

	/**
	 * The session ended. Its agents end with it (D21), so every task whose agent still runs goes back to
	 * pending. The list stays readable for a fork of this session until the next session ends.
	 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		// The subagent service may end the agents first; either way the task carries the same error.
		for (const taskId of this.agentTasks.values()) {
			if (this.store.get(taskId)?.status !== "in_progress") continue;
			this.store.update(taskId, { status: "pending", metadata: { result: null, lastError: SESSION_ENDED_ERROR } });
		}
		this.agentTasks.clear();
		this.offSubagents?.();
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
