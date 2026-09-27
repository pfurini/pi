/**
 * Fork-owned: the subagent service of one `AgentSession` (D18, D21; plan T4). pi-subagents
 * `src/agent-manager.ts` and `src/index.ts` at 79a7c42 are the behavior reference.
 *
 * The service owns its records, two concurrency pools, the queue, steering, stopping, resuming
 * and result waits. Every spawn reloads agent definitions and settings first. Only top-level
 * records occupy pool slots: the background pool counts every background record, detached ones
 * included, and the foreground pool counts only spawns a caller awaits inline. A finished record
 * stays 10 minutes, then its child is torn down and a persisted one leaves a tombstone.
 *
 * The service ends with its session: the session's `dispose()` runs the cleanup hook registered
 * here, which aborts every running and queued child, reports each as `aborted`, and tears down
 * every child, finished ones included.
 */
import { randomUUID } from "node:crypto";
import { registerSessionResourceCleanup, type Usage } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "../../../agent-session.ts";
import type { EventBus } from "../../../event-bus.ts";
import { getSkillSetController } from "../../../skills/skill-set-events.ts";
import { loadAgentFiles, loadSkillAgents } from "../definitions/load.ts";
import { type AgentRegistry, buildAgentRegistry, resolveSpawnType } from "../definitions/registry.ts";
import type { AgentDefinition } from "../definitions/types.ts";
import type { ChildLineage } from "../runner/lineage.ts";
import { type Child, type ChildRequest, runTurn, spawnChild, type TurnOutcome, teardownChild } from "../runner/run.ts";
import { type InvocationParams, resolveInvocationConfig, resolveSpawnModel } from "../settings/models.ts";
import { readSubagentSettings, type SubagentSettings } from "../settings/settings.ts";
import { GroupJoin, NotificationQueue } from "./notifications.ts";
import {
	assignHandle,
	handleBase,
	isTerminal,
	type SubagentRecord,
	type Tombstone,
	TombstoneStore,
} from "./records.ts";
import { addUsage, emptyUsage, PendingUsage } from "./usage.ts";

/** The error of an agent its session's end cut short. */
export const SESSION_ENDED_ERROR = "The session ended before the agent finished.";

const RETENTION_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
/** Background spawns this close together count as one turn's batch for `smart` joins. */
const BATCH_WINDOW_MS = 100;

/** What the service needs besides its session: the per-session record `addForkBaseTools` stores (T5). */
export interface SubagentSessionContext {
	agentDir: string;
	eventBus?: EventBus;
	/** Set when the session is itself a child; its spawns then belong to the owning agent (T6). */
	lineage?: ChildLineage;
	/** The fork base tools the session registers now, read at each spawn so it follows `/reload`. */
	forkBaseToolNames(): string[];
}

export interface SubagentServiceOptions {
	/** How long a group waits for late members after the first finishes. */
	groupTimeoutMs?: number;
	/** How long the rest of a partially delivered group waits. */
	stragglerTimeoutMs?: number;
}

export type SubagentEvent =
	| { type: "created" | "started" | "ended"; record: SubagentRecord }
	| { type: "steered"; record: SubagentRecord; message: string }
	| { type: "compacted"; record: SubagentRecord; reason: "manual" | "threshold" | "overflow"; tokensBefore: number }
	| { type: "definitions"; registry: AgentRegistry }
	| { type: "warning"; message: string };

export interface SpawnRequest {
	/** The requested agent type, resolved case-insensitively with the `fallbackSubagent` policy. */
	type: string;
	prompt: string;
	description: string;
	/** A second, memorable handle for the agent. */
	name?: string;
	/** The `Agent` tool's parameters; the agent file's frontmatter outranks each. */
	params?: InvocationParams;
	/** A model a programmatic caller already resolved; wins over `params.model`. */
	model?: Model<Api>;
	/** The working directory; defaults to the session's. */
	cwd?: string;
	/**
	 * A detached spawn (RPC, skill-fork) blocks nobody and so takes no foreground slot; `isBackground`
	 * decides whether it takes a background slot. Without it, `run_in_background` decides.
	 */
	detached?: { isBackground?: boolean };
	/** Aborting it stops the agent, as a caller's cancel stops a foreground run. */
	signal?: AbortSignal;
	toolCallId?: string;
}

type Pool = "background" | "foreground";

interface QueueEntry {
	record: SubagentRecord;
	pool: Pool;
	start: () => void;
}

export class SubagentService {
	private readonly session: AgentSession;
	private readonly context: SubagentSessionContext;
	private readonly records = new Map<string, SubagentRecord>();
	private readonly tombstones = new TombstoneStore();
	private readonly running: Record<Pool, number> = { background: 0, foreground: 0 };
	private queue: QueueEntry[] = [];
	private readonly listeners = new Set<(event: SubagentEvent) => void>();
	private readonly warned = new Set<string>();
	private readonly pendingUsage = new PendingUsage();
	private readonly notifications: NotificationQueue;
	private readonly groups: GroupJoin;
	private batch: string[] = [];
	private batchTimer?: ReturnType<typeof setTimeout>;
	private batchCount = 0;
	private readonly sweepTimer: ReturnType<typeof setInterval>;
	private readonly unregisterCleanup: () => void;
	private current: SubagentSettings;
	private registryCache: AgentRegistry;
	private disposed = false;

	constructor(session: AgentSession, context: SubagentSessionContext, options: SubagentServiceOptions = {}) {
		this.session = session;
		this.context = context;
		this.current = this.readSettings();
		this.registryCache = buildAgentRegistry({ userAgents: new Map() });
		this.notifications = new NotificationQueue(session, {
			othersRunning: (delivered) =>
				[...this.records.values()].some(
					(record) => !record.parent && record.isBackground && !delivered.has(record.id) && !isTerminal(record),
				),
			showCost: () => this.current.showCost,
			onError: (error) => this.warn(`A subagent notification failed: ${String(error)}`),
		});
		this.groups = new GroupJoin(
			(records) => this.notifications.park(`group:${records.map((record) => record.id).join(",")}`, records),
			options.groupTimeoutMs ?? 30_000,
			options.stragglerTimeoutMs ?? 15_000,
		);
		this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
		this.sweepTimer.unref?.();
		// Compared at cleanup time: the session's own id is the one its dispose() reports.
		this.unregisterCleanup = registerSessionResourceCleanup((sessionId) => {
			if (sessionId === this.session.sessionId) this.dispose();
		});
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	/** The settings read at the last spawn or refresh. */
	get settings(): SubagentSettings {
		return this.current;
	}

	/** The agent registry of the last reload. */
	get registry(): AgentRegistry {
		return this.registryCache;
	}

	subscribe(listener: (event: SubagentEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: SubagentEvent): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch {
				// A listener's failure must not break the service's bookkeeping.
			}
		}
	}

	/** Reports each distinct warning once for the life of the service. */
	private warn(message: string): void {
		if (this.warned.has(message)) return;
		this.warned.add(message);
		this.emit({ type: "warning", message });
	}

	private readSettings(): SubagentSettings {
		const { settings, warnings } = readSubagentSettings(this.session.settingsManager);
		for (const warning of warnings) this.warn(warning);
		return settings;
	}

	/** The session's working directory, through its extension context; `process.cwd()` when that is gone. */
	defaultCwd(): string {
		try {
			return this.session.extensionRunner.createContext().cwd;
		} catch {
			return process.cwd();
		}
	}

	/**
	 * Reloads settings and agent definitions: user agents, project agents when the project is
	 * trusted, and the agents the session's skills bundle. Existing records keep their definitions.
	 */
	refreshDefinitions(cwd = this.defaultCwd()): AgentRegistry {
		this.current = this.readSettings();
		const files = loadAgentFiles({
			agentDir: this.context.agentDir,
			cwd,
			projectTrusted: this.session.settingsManager.isProjectTrusted(),
			strict: this.current.strictAgentFiles,
		});
		const skills = this.context.eventBus ? getSkillSetController(this.context.eventBus).getSnapshot().skills : [];
		const bundled = loadSkillAgents(skills);
		for (const warning of [...files.warnings, ...bundled.warnings]) this.warn(warning);
		this.registryCache = buildAgentRegistry({
			userAgents: files.agents,
			skillAgents: bundled.agents,
			disableDefaultAgents: this.current.disableDefaultAgents,
		});
		this.emit({ type: "definitions", registry: this.registryCache });
		return this.registryCache;
	}

	/**
	 * Starts an agent, or queues it when its pool is full, and returns its record at once. Throws
	 * when the type or the caller's model is refused. A foreground caller then awaits `waitForResult`.
	 */
	async spawn(request: SpawnRequest): Promise<SubagentRecord> {
		this.assertLive();
		const cwd = request.cwd ?? this.defaultCwd();
		const registry = this.refreshDefinitions(cwd);
		const settings = this.current;
		const resolution = resolveSpawnType(registry, request.type, settings.fallbackSubagent);
		if (!resolution.ok) throw new Error(resolution.message);
		const { definition } = resolution;
		const invocation = resolveInvocationConfig(definition, request.params ?? {}, {
			worktreeAllowed: settings.worktreeIsolation,
			defaultRunInBackground: settings.backgroundByDefault,
		});
		const model =
			request.model ?? (await this.resolveModel(definition, invocation.modelInput, invocation.modelFromParams));
		this.assertLive();
		const background = request.detached ? request.detached.isBackground : invocation.runInBackground;
		const record = this.createRecord({
			definition,
			request,
			cwd,
			invocation,
			model,
			isBackground: background,
			blocking: !request.detached && !background,
		});
		if (request.signal) this.stopOn(request.signal, record);
		if (!request.detached && background) this.emit({ type: "created", record });
		if (record.joinMode === "smart" || record.joinMode === "group") this.addToBatch(record);
		this.launch(record, request.prompt, invocation.inheritContext);
		return record;
	}

	private async resolveModel(
		definition: AgentDefinition,
		modelInput: string | undefined,
		fromCaller: boolean,
	): Promise<Model<Api> | undefined> {
		const resolution = resolveSpawnModel({
			modelInput,
			fromCaller,
			parentModel: this.session.model,
			available: modelInput ? await this.session.modelRuntime.getAvailable() : [],
			scopeModels: this.current.scopeModels,
			enabledModels: this.session.settingsManager.getEnabledModels(),
			agentLabel: definition.displayName ?? definition.name,
		});
		if (!resolution.ok) throw new Error(resolution.message);
		if (resolution.warning) this.warn(resolution.warning);
		return resolution.model;
	}

	private createRecord(input: {
		definition: AgentDefinition;
		request: SpawnRequest;
		cwd: string;
		invocation: SubagentRecord["invocation"];
		model?: Model<Api>;
		isBackground?: boolean;
		blocking: boolean;
	}): SubagentRecord {
		const taken = new Set(this.tombstones.names());
		for (const record of this.records.values()) {
			if (record.handle) taken.add(record.handle);
			if (record.alias) taken.add(record.alias);
		}
		const handle = assignHandle(handleBase(input.definition.name), taken);
		taken.add(handle);
		const alias = input.request.name ? assignHandle(handleBase(input.request.name), taken) : undefined;
		const record: SubagentRecord = {
			id: randomUUID().slice(0, 17),
			type: input.definition.name,
			definition: input.definition,
			handle,
			alias,
			description: input.request.description,
			prompt: input.request.prompt,
			status: "queued",
			usage: emptyUsage(),
			toolUses: 0,
			turns: 0,
			compactionCount: 0,
			startedAt: Date.now(),
			depth: 1,
			isBackground: input.isBackground,
			blocking: input.blocking,
			resultConsumed: false,
			joinMode: input.isBackground && !input.request.detached ? this.current.defaultJoinMode : undefined,
			toolCallId: input.request.toolCallId,
			invocation: input.invocation,
			model: input.model,
			cwd: input.cwd,
			activity: [],
			pendingSteers: [],
			waiters: new Set(),
		};
		this.records.set(record.id, record);
		return record;
	}

	private poolFor(record: SubagentRecord, resuming: boolean): Pool | undefined {
		if (record.parent) return undefined;
		if (record.isBackground) return "background";
		// A foreground resume reuses its session and takes no foreground slot, as in pi-subagents.
		if (record.blocking && !resuming && this.current.maxConcurrentForeground > 0) return "foreground";
		return undefined;
	}

	private hasRoom(pool: Pool): boolean {
		const limit = pool === "background" ? this.current.maxConcurrent : this.current.maxConcurrentForeground;
		return limit === 0 || this.running[pool] < limit;
	}

	private launch(record: SubagentRecord, prompt: string, inheritContext: boolean, resuming = false): void {
		const pool = this.poolFor(record, resuming);
		const start = () => this.start(record, prompt, inheritContext, pool);
		if (pool && !this.hasRoom(pool)) {
			record.status = "queued";
			this.queue.push({ record, pool, start });
			return;
		}
		start();
	}

	private start(record: SubagentRecord, prompt: string, inheritContext: boolean, pool: Pool | undefined): void {
		record.status = "running";
		record.startedAt = Date.now();
		if (pool) this.running[pool]++;
		const abort = new AbortController();
		record.abort = abort;
		this.emit({ type: "started", record });
		record.run = this.run(record, prompt, inheritContext, abort.signal).then(
			(outcome) => this.settle(record, outcome, pool),
			(error: unknown) =>
				this.settle(
					record,
					{
						status: "error",
						text: "",
						error: error instanceof Error ? error.message : String(error),
						usage: emptyUsage(),
						turns: 0,
					},
					pool,
				),
		);
	}

	private async run(
		record: SubagentRecord,
		prompt: string,
		inheritContext: boolean,
		signal: AbortSignal,
	): Promise<TurnOutcome> {
		const settings = this.current;
		const turn = {
			prompt,
			maxTurns: record.invocation.maxTurns ?? settings.defaultMaxTurns,
			graceTurns: settings.graceTurns,
			signal,
			onUsage: (usage: Usage) => this.addRecordUsage(record, usage),
			onTurnEnd: (turns: number) => {
				record.turns = turns;
			},
			onCompaction: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => {
				record.compactionCount++;
				this.emit({ type: "compacted", record, ...info });
			},
		};
		if (record.child) return runTurn(record.child, turn);
		return spawnChild(this.childRequest(record, settings), { ...turn, inheritContext }, (child) =>
			this.attachChild(record, child),
		);
	}

	private childRequest(record: SubagentRecord, settings: SubagentSettings): ChildRequest {
		const { definition, invocation } = record;
		return {
			parent: this.session,
			agentDir: this.context.agentDir,
			definition,
			cwd: record.cwd,
			model: record.model,
			thinking: invocation.thinking,
			isolated: invocation.isolated,
			persist: definition.persistSession ?? (record.parent ? false : settings.rememberAgents),
			sessionName: `${definition.name}#${record.id.slice(0, 8)}`,
			forkBaseToolNames: this.context.forkBaseToolNames(),
			lineage: { owner: this, parentRecord: record, depth: record.depth },
			transcript: { enabled: settings.outputTranscript, agentId: record.id, rootSessionId: this.session.sessionId },
			onActivity: (activity) => {
				record.activity.push(activity);
				if (activity.type === "tool_end") record.toolUses++;
			},
		};
	}

	private attachChild(record: SubagentRecord, child: Child): void {
		record.child = child;
		record.sessionFile = child.session.sessionFile;
		record.transcriptPath = child.transcriptPath;
		// The owner ended while the child was being built: nothing may keep it.
		if (this.disposed) {
			void teardownChild(child);
			return;
		}
		for (const message of record.pendingSteers.splice(0)) this.deliverSteer(record, message);
	}

	private addRecordUsage(record: SubagentRecord, usage: Usage): void {
		addUsage(record.usage, usage);
		if (this.current.reportUsage) this.pendingUsage.add(usage);
	}

	private settle(record: SubagentRecord, outcome: TurnOutcome, pool: Pool | undefined): void {
		if (record.status === "running") {
			record.status = outcome.status;
			record.error = outcome.error;
		}
		record.result = outcome.text;
		record.completedAt ??= Date.now();
		record.abort = undefined;
		this.detachSignal(record);
		if (pool) this.running[pool]--;
		if (!record.isBackground) record.resultConsumed = true;
		this.finish(record);
		this.drain();
	}

	/** Reports a run's end, notifies when due, and wakes the waiters. */
	private finish(record: SubagentRecord): void {
		record.run = undefined;
		if (!record.endReported) this.emit({ type: "ended", record });
		if (!this.disposed) this.notifyIfDue(record);
		for (const waiter of [...record.waiters]) waiter();
		record.waiters.clear();
	}

	private notifyIfDue(record: SubagentRecord): void {
		if (record.parent || !record.isBackground || record.resultConsumed) return;
		if (this.batch.includes(record.id)) return;
		if (this.groups.complete(record) === "pass") this.notifications.park(record.id, [record]);
	}

	private addToBatch(record: SubagentRecord): void {
		this.batch.push(record.id);
		clearTimeout(this.batchTimer);
		this.batchTimer = setTimeout(() => this.finalizeBatch(), BATCH_WINDOW_MS);
		this.batchTimer.unref?.();
	}

	/** Two or more `smart` or `group` agents spawned in one window share a notification. */
	private finalizeBatch(): void {
		const ids = this.batch;
		this.batch = [];
		this.batchTimer = undefined;
		const members = ids.map((id) => this.records.get(id)).filter((record) => record !== undefined);
		if (members.length >= 2) {
			this.groups.register(`batch-${++this.batchCount}`, ids);
			for (const record of members) {
				if (isTerminal(record) && !record.run && !record.resultConsumed) this.groups.complete(record);
			}
			return;
		}
		for (const record of members) {
			if (isTerminal(record) && !record.run) this.notifyIfDue(record);
		}
	}

	private drain(): void {
		for (let index = 0; index < this.queue.length; ) {
			const entry = this.queue[index];
			if (!this.hasRoom(entry.pool)) {
				index++;
				continue;
			}
			this.queue.splice(index, 1);
			entry.start();
		}
	}

	/** A top-level record by id, handle or alias; nested records are unreachable from the session (T6). */
	get(ref: string): SubagentRecord | undefined {
		const byId = this.records.get(ref);
		if (byId) return byId.parent ? undefined : byId;
		const wanted = ref.toLowerCase();
		return [...this.records.values()].find(
			(record) => !record.parent && (record.handle === wanted || record.alias === wanted),
		);
	}

	/** The session's own records, newest first. */
	list(): SubagentRecord[] {
		return [...this.records.values()].filter((record) => !record.parent).sort((a, b) => b.startedAt - a.startedAt);
	}

	/** Evicted persisted agents a later phase can reopen by handle, newest first. */
	listTombstones(): Tombstone[] {
		return this.tombstones.list();
	}

	/**
	 * Resolves with the record once its current run ends. Aborting `signal` rejects only this wait:
	 * the agent keeps running, its result stays unread, and its notification still arrives.
	 */
	waitForResult(ref: string, signal?: AbortSignal): Promise<SubagentRecord> {
		const record = this.get(ref);
		if (!record) return Promise.reject(new Error(`Agent not found: "${ref}"`));
		if (isTerminal(record) && !record.run) return Promise.resolve(record);
		if (signal?.aborted) return Promise.reject(signal.reason);
		return new Promise<SubagentRecord>((resolve, reject) => {
			const onAbort = () => {
				record.waiters.delete(done);
				reject(signal?.reason);
			};
			const done = () => {
				signal?.removeEventListener("abort", onAbort);
				resolve(record);
			};
			record.waiters.add(done);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	/** Marks a finished agent's result as read, which drops its notification. False for a running or unknown agent. */
	consume(ref: string): boolean {
		const record = this.get(ref);
		if (!record || !isTerminal(record) || record.run) return false;
		record.resultConsumed = true;
		return true;
	}

	/** Steers a running or queued agent; a queued one receives the message when its child starts. */
	steer(ref: string, message: string): boolean {
		const record = this.get(ref);
		if (!record || isTerminal(record)) return false;
		if (record.child) this.deliverSteer(record, message);
		else record.pendingSteers.push(message);
		this.emit({ type: "steered", record, message });
		return true;
	}

	private deliverSteer(record: SubagentRecord, message: string): void {
		record.child?.session.steer(message).catch((error: unknown) => {
			record.activity.push({ type: "extension-error", message: `steer failed: ${String(error)}` });
		});
	}

	/** Stops a running or queued agent; it ends `stopped`, keeping any partial output. */
	stop(ref: string): boolean {
		const record = this.get(ref);
		return record ? this.stopRecord(record) : false;
	}

	private stopRecord(record: SubagentRecord): boolean {
		if (record.status === "queued" && !record.run) {
			this.queue = this.queue.filter((entry) => entry.record !== record);
			this.detachSignal(record);
			record.status = "stopped";
			record.completedAt = Date.now();
			if (record.blocking) record.resultConsumed = true;
			this.finish(record);
			return true;
		}
		if (record.status !== "running") return false;
		record.status = "stopped";
		record.completedAt = Date.now();
		record.abort?.abort();
		return true;
	}

	/**
	 * Stops the agent when a caller's signal aborts, for this run only. Pi hands a tool the parent
	 * run's signal, so a listener left behind would stop a later background resume on the next Esc.
	 */
	private stopOn(signal: AbortSignal, record: SubagentRecord): void {
		this.detachSignal(record);
		if (signal.aborted) {
			queueMicrotask(() => this.stopRecord(record));
			return;
		}
		const onAbort = () => this.stopRecord(record);
		signal.addEventListener("abort", onAbort, { once: true });
		record.detachSignal = () => signal.removeEventListener("abort", onAbort);
	}

	private detachSignal(record: SubagentRecord): void {
		record.detachSignal?.();
		record.detachSignal = undefined;
	}

	/**
	 * Continues a finished agent's session with a new prompt. A background resume notifies on
	 * completion like a background spawn; a foreground caller awaits `waitForResult`.
	 */
	resume(
		ref: string,
		prompt: string,
		options: { background: boolean; signal?: AbortSignal; toolCallId?: string },
	): SubagentRecord {
		this.assertLive();
		const record = this.get(ref);
		if (!record) throw new Error(`Agent not found: "${ref}"`);
		if (!isTerminal(record) || record.run) throw new Error(`Agent "${ref}" is still running; steer it instead.`);
		if (!record.child) throw new Error(`Agent "${ref}" has no session to resume.`);
		record.status = "queued";
		record.result = undefined;
		record.error = undefined;
		record.completedAt = undefined;
		record.resultConsumed = false;
		record.endReported = undefined;
		record.isBackground = options.background;
		// The new run answers a new tool call, and joins this turn's batch like a fresh spawn.
		record.toolCallId = options.toolCallId;
		record.joinMode = options.background ? this.current.defaultJoinMode : undefined;
		this.detachSignal(record);
		if (options.signal) this.stopOn(options.signal, record);
		if (options.background) this.emit({ type: "created", record });
		if (record.joinMode === "smart" || record.joinMode === "group") this.addToBatch(record);
		this.launch(record, prompt, false, true);
		return record;
	}

	/** Subagent spend not yet reported to the session, when `reportUsage` is on. */
	takeReportedUsage(): Usage | undefined {
		return this.pendingUsage.take();
	}

	private sweep(now = Date.now()): void {
		for (const record of [...this.records.values()]) {
			if (!isTerminal(record) || record.run || (record.completedAt ?? now) > now - RETENTION_MS) continue;
			if (record.handle && record.sessionFile && !record.parent) {
				this.tombstones.add({
					handle: record.handle,
					alias: record.alias,
					id: record.id,
					type: record.type,
					description: record.description,
					sessionFile: record.sessionFile,
					completedAt: record.completedAt ?? now,
				});
			}
			this.records.delete(record.id);
			if (record.child) void teardownChild(record.child);
			record.child = undefined;
		}
	}

	private assertLive(): void {
		if (this.disposed) throw new Error("The session that owns this subagent service has ended.");
	}

	/**
	 * Ends every agent with the session (D21). Running and queued ones are reported `aborted` now,
	 * while listeners can still deliver the report; their runs settle later without reporting
	 * again. Every child is torn down, and the cleanup hook is removed.
	 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unregisterCleanup();
		clearInterval(this.sweepTimer);
		clearTimeout(this.batchTimer);
		this.groups.dispose();
		this.notifications.dispose();
		const ended = [...this.records.values()].filter((record) => !isTerminal(record) || record.run);
		this.queue = [];
		for (const record of ended) {
			if (!isTerminal(record)) {
				record.status = "aborted";
				record.error = SESSION_ENDED_ERROR;
			}
			record.completedAt ??= Date.now();
			record.resultConsumed = true;
			record.endReported = true;
			this.emit({ type: "ended", record });
		}
		for (const record of ended) record.abort?.abort();
		for (const record of this.records.values()) this.detachSignal(record);
		for (const record of this.records.values()) {
			if (record.child) void teardownChild(record.child);
			record.child = undefined;
			if (!record.run) {
				for (const waiter of [...record.waiters]) waiter();
				record.waiters.clear();
			}
		}
		this.listeners.clear();
	}
}
