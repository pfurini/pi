/**
 * Fork-owned: the subagent service of one `AgentSession` (D18, D21; plan T4). pi-subagents
 * `src/agent-manager.ts` and `src/index.ts` at 79a7c42 are the behavior reference.
 *
 * The service owns its records, steering, stopping, resuming and result waits. Every spawn reloads
 * agent definitions and settings first. Its parts live beside it: `queue.ts` holds the two
 * concurrency pools and the queue, `retention.ts` the eviction of finished records and their
 * tombstones, `joins.ts` the batching of background completions, and `sessions.ts` which session
 * owns which service. The service imports no tool, adapter or presentation code (F14): the wiring
 * layer injects the nested tools and the event bridge through `SubagentSessionContext`.
 *
 * The service ends with its session: the session's `dispose()` runs the cleanup hook registered
 * here, which aborts every running and queued child, reports each as `aborted`, and tears down
 * every child, finished ones included.
 *
 * An `isolation: "worktree"` run works in a git worktree of its directory (T7). Its changes land
 * on a `pi-agent-<id>` branch when the run ends, however it ends; a failed git step keeps the
 * worktree, and the result names it.
 *
 * An agent with `allowed_subagents` delegates through a `NestedRuntime` (T6). Its records live here
 * with it as their parent: they are one level deeper, carry no handle, occupy no pool slot, add
 * their usage to every ancestor, stay unreachable from the session's own lookups, and end when
 * their parent's run ends.
 */
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { registerSessionResourceCleanup, type Usage } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "../../../agent-session.ts";
import type { EventBus } from "../../../event-bus.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { getSkillSetController } from "../../../skills/skill-set-events.ts";
import type { AgentFileLoad, SkillAgentSource } from "../definitions/load.ts";
import {
	type AgentRegistry,
	buildAgentRegistry,
	loadAgentRegistry,
	resolveSpawnType,
	type SpawnTypeResolution,
} from "../definitions/registry.ts";
import type { AgentDefinition } from "../definitions/types.ts";
import type { ChildLineage } from "../runner/lineage.ts";
import {
	CHILD_SHUTDOWN_TIMEOUT_MS,
	type Child,
	type ChildRequest,
	runTurn,
	spawnChild,
	type TurnOutcome,
	teardownChild,
} from "../runner/run.ts";
import { transcriptPath } from "../runner/transcript.ts";
import { createWorktree, describeWorktreeOutcome, finishWorktree, worktreeBase } from "../runner/worktree.ts";
import {
	type InvocationConfig,
	type InvocationParams,
	resolveInvocationConfig,
	resolveModel,
	resolveSpawnModel,
} from "../settings/models.ts";
import { readSubagentSettings, type SubagentSettings } from "../settings/settings.ts";
import { addUsage, emptyUsage, PendingUsage } from "../usage.ts";
import { GroupJoin, SpawnBatch } from "./joins.ts";
import { NestedRuntime } from "./nested.ts";
import { NotificationQueue } from "./notifications.ts";
import { type Pool, SpawnQueue } from "./queue.ts";
import {
	assignHandle,
	handleBase,
	inBackground,
	isTerminal,
	type SpawnMode,
	type SubagentRecord,
	type SubagentView,
} from "./records.ts";
import { Retention, type Tombstone } from "./retention.ts";

/** The error of an agent its session's end cut short. */
export const SESSION_ENDED_ERROR = "The session ended before the agent finished.";

/** The error of a nested agent its parent's end cut short (R6). */
export const PARENT_ENDED_ERROR = "The parent agent finished before this agent did.";

/** What every lookup of an unknown or evicted agent reports. */
export function notFound(ref: string): string {
	return `Agent not found: "${ref}". It may have been cleaned up.`;
}

/** What the service needs besides its session: the per-session record `addForkBaseTools` stores (T5). */
export interface SubagentSessionContext {
	agentDir: string;
	eventBus?: EventBus;
	/** Set when the session is itself a child; its spawns then belong to the owning agent (T6). */
	lineage?: ChildLineage;
	/** The fork base tools the session registers now, read at each spawn so it follows `/reload`. */
	forkBaseToolNames(): string[];
	/** Warnings found before the service existed, such as while the tool description was built. */
	warnings?: string[];
	/** Builds the nested tools of a permitted agent; `base-tools.ts` passes `tools/nested.ts`'s builder. */
	createNestedTools?(runtime: NestedRuntime): ToolDefinition[];
	/** Called once with the service when it is built; `base-tools.ts` attaches the bus adapter's event bridge. */
	onServiceCreated?(service: SubagentService): void;
}

/** The skills loaded on a session's event bus, whose bundled agents join its registry; none without a bus. */
export function busSkills(eventBus: EventBus | undefined): readonly SkillAgentSource[] {
	return eventBus ? getSkillSetController(eventBus).getSnapshot().skills : [];
}

/** The session's working directory, through its extension context; `process.cwd()` when that is gone. */
export function sessionCwd(session: AgentSession): string {
	try {
		return session.extensionRunner.createContext().cwd;
	} catch {
		return process.cwd();
	}
}

export interface SubagentServiceOptions {
	/** How long a group waits for late members after the first finishes. */
	groupTimeoutMs?: number;
	/** How long the rest of a partially delivered group waits. */
	stragglerTimeoutMs?: number;
	/** How long `shutdown()` waits for children still starting; `CHILD_SHUTDOWN_TIMEOUT_MS` by default. */
	startupWaitMs?: number;
}

export type SubagentEvent =
	| { type: "created" | "started" | "ended"; record: SubagentView }
	/** A run waits for a pool slot; the presentation counts it. The bus adapter bridges no event for it. */
	| { type: "queued"; record: SubagentView }
	| { type: "steered"; record: SubagentView; message: string }
	| { type: "compacted"; record: SubagentView; reason: "manual" | "threshold" | "overflow"; tokensBefore: number }
	| { type: "definitions"; registry: AgentRegistry }
	| { type: "settings"; settings: Readonly<SubagentSettings> }
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
	 * A detached spawn (RPC, skill-fork) blocks nobody and so takes no foreground slot;
	 * `detached-background` also takes a background slot. Without it, `run_in_background` decides.
	 */
	mode?: Extract<SpawnMode, "detached" | "detached-background">;
	/**
	 * Aborting it stops the agent: a foreground run, or a detached one whose caller passed it. A
	 * background `Agent` spawn outlives the tool call's signal.
	 */
	signal?: AbortSignal;
	toolCallId?: string;
	/** Called with the record as soon as it exists, before it starts; the bus adapter orders its reply with it. */
	onCreated?: (record: SubagentView) => void;
}

/** What became of a steer: `steer_subagent` and the conversation viewer report each kind. */
export type SteerOutcome =
	| { kind: "delivered" }
	| { kind: "queued" }
	| { kind: "refused"; reason: string }
	| { kind: "failed"; error: string };

/** A child session's conversation, for the viewer: the live messages and a change feed. */
export interface SubagentConversation {
	/** The child's messages now; read again after each change. */
	readonly messages: readonly AgentMessage[];
	/** Calls `listener` whenever a message starts, streams or ends; returns the unsubscriber. */
	subscribe(listener: () => void): () => void;
}

/** Each service's records, for `inspectRecord` alone. */
const recordMaps = new WeakMap<SubagentService, ReadonlyMap<string, SubagentRecord>>();

/**
 * @internal Tests only: the service's own record behind an id, with its child session, run and
 * waiters (P33). Production code reads views and the service's accessors.
 */
export function inspectRecord(service: SubagentService, id: string): SubagentRecord | undefined {
	return recordMaps.get(service)?.get(id);
}

export class SubagentService {
	private readonly session: AgentSession;
	private readonly context: SubagentSessionContext;
	private readonly records = new Map<string, SubagentRecord>();
	private readonly retention = new Retention(this.records);
	private readonly queue = new SpawnQueue(() => this.current);
	private readonly listeners = new Set<(event: SubagentEvent) => void>();
	private readonly warned = new Set<string>();
	private readonly pendingUsage = new PendingUsage();
	private readonly notifications: NotificationQueue;
	private readonly groups: GroupJoin;
	private readonly batch: SpawnBatch;
	private readonly unregisterCleanup: () => void;
	private current: Readonly<SubagentSettings>;
	private registryCache: AgentRegistry;
	private agentFilesCache?: AgentFileLoad;
	private disposed = false;
	/** The child teardowns `dispose()` and a late attach started; `shutdown()` awaits them. */
	private readonly teardowns: Promise<void>[] = [];
	private readonly startupWaitMs: number;

	constructor(session: AgentSession, context: SubagentSessionContext, options: SubagentServiceOptions = {}) {
		this.session = session;
		this.context = context;
		recordMaps.set(this, this.records);
		this.current = this.reloadSettings();
		for (const warning of context.warnings?.splice(0) ?? []) this.warn(warning);
		this.registryCache = buildAgentRegistry({ userAgents: new Map() });
		this.notifications = new NotificationQueue(session, {
			othersRunning: (delivered) =>
				[...this.records.values()].some(
					(record) =>
						!record.parent && inBackground(record.mode) && !delivered.has(record.id) && !isTerminal(record),
				),
			showCost: () => this.current.showCost,
			onError: (error) => this.warn(`A subagent notification failed: ${String(error)}`),
		});
		this.groups = new GroupJoin(
			(records) => this.notifications.park(`group:${records.map((record) => record.id).join(",")}`, records),
			options.groupTimeoutMs ?? 30_000,
			options.stragglerTimeoutMs ?? 15_000,
		);
		this.startupWaitMs = options.startupWaitMs ?? CHILD_SHUTDOWN_TIMEOUT_MS;
		this.batch = new SpawnBatch(
			this.groups,
			(id) => this.records.get(id),
			(record) => this.notifyIfDue(record),
		);
		// Compared at cleanup time: the session's own id is the one its dispose() reports.
		this.unregisterCleanup = registerSessionResourceCleanup((sessionId) => {
			if (sessionId === this.session.sessionId) this.dispose();
		});
	}

	get isDisposed(): boolean {
		return this.disposed;
	}

	/** The settings read at the last spawn or refresh; frozen, and replaced by each reread. */
	get settings(): Readonly<SubagentSettings> {
		return this.current;
	}

	/** The agent registry of the last reload. */
	get registry(): AgentRegistry {
		return this.registryCache;
	}

	/** The agent files of the last reload; undefined before the first. A child's adapter reuses them (D34). */
	get agentFiles(): AgentFileLoad | undefined {
		return this.agentFilesCache;
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

	/** The session's event bus, where the adapter announces the session's own agents. */
	get eventBus(): EventBus | undefined {
		return this.context.eventBus;
	}

	/** Every distinct warning so far, oldest first, including those raised before anyone subscribed. */
	get warnings(): readonly string[] {
		return [...this.warned];
	}

	/** Reports each distinct warning once for the life of the service. */
	warn(message: string): void {
		if (this.warned.has(message)) return;
		this.warned.add(message);
		this.emit({ type: "warning", message });
	}

	/** Rereads the settings, as every spawn does, and returns them; a change from the last read is announced. */
	reloadSettings(): Readonly<SubagentSettings> {
		const { settings, warnings } = readSubagentSettings(this.session.settingsManager);
		for (const warning of warnings) this.warn(warning);
		// Undefined only during construction, when there is nothing to compare with.
		const previous: Readonly<SubagentSettings> | undefined = this.current;
		this.current = settings;
		if (previous && JSON.stringify(previous) !== JSON.stringify(settings)) this.emit({ type: "settings", settings });
		return settings;
	}

	/**
	 * A caller's model, by name, resolved and scope-checked as the `Agent` tool's `model` is. The bus
	 * adapter and the skill-fork client pass the result as `SpawnRequest.model`. Throws the refusal.
	 */
	async resolveCallerModel(input: string, agentLabel: string): Promise<Model<Api>> {
		this.reloadSettings();
		const resolution = resolveSpawnModel({
			modelInput: input,
			fromCaller: true,
			parentModel: this.session.model,
			available: await this.session.modelRuntime.getAvailable(),
			scopeModels: this.current.scopeModels,
			enabledModels: this.session.settingsManager.getEnabledModels(),
			agentLabel,
		});
		if (!resolution.ok) throw new Error(resolution.message);
		if (!resolution.model) throw new Error(`Model not found: "${input}".`);
		return resolution.model;
	}

	/** The session's working directory, through its extension context; `process.cwd()` when that is gone. */
	defaultCwd(): string {
		return sessionCwd(this.session);
	}

	/**
	 * Reloads settings and agent definitions: user agents, project agents when the project is
	 * trusted, and the agents the session's skills bundle. Existing records keep their definitions.
	 */
	refreshDefinitions(cwd = this.defaultCwd()): AgentRegistry {
		this.reloadSettings();
		const { registry, warnings, files } = loadAgentRegistry({
			agentDir: this.context.agentDir,
			cwd,
			projectTrusted: this.session.settingsManager.isProjectTrusted(),
			skills: busSkills(this.context.eventBus),
			settings: this.current,
		});
		for (const warning of warnings) this.warn(warning);
		this.registryCache = registry;
		this.agentFilesCache = files;
		this.emit({ type: "definitions", registry: this.registryCache });
		return this.registryCache;
	}

	/**
	 * Starts an agent, or queues it when its pool is full, and returns its record at once. Throws
	 * when the type or the caller's model is refused. A foreground caller then awaits `waitForResult`.
	 */
	async spawn(request: SpawnRequest): Promise<SubagentView> {
		return this.spawnRecord(request, (registry, settings) =>
			resolveSpawnType(registry, request.type, settings.fallbackSubagent),
		);
	}

	/**
	 * @internal `NestedRuntime` spawns through here, after its permission checks. `parent` owns the
	 * record, and `resolveType` applies the parent's allowlist instead of `fallbackSubagent`.
	 */
	async spawnOwned(
		parent: SubagentView,
		request: SpawnRequest,
		resolveType: (registry: AgentRegistry) => SpawnTypeResolution,
	): Promise<SubagentView> {
		const owner = this.records.get(parent.id);
		if (!owner) throw new Error(`Agent "${parent.definition.name}" is not running; it cannot spawn subagents.`);
		return this.spawnRecord(request, resolveType, owner);
	}

	/** The nested runtime of an agent: what it may spawn and reach. */
	nested(parent: SubagentView): NestedRuntime {
		return new NestedRuntime(this, parent);
	}

	private async spawnRecord(
		request: SpawnRequest,
		resolveType: (registry: AgentRegistry, settings: Readonly<SubagentSettings>) => SpawnTypeResolution,
		parent?: SubagentRecord,
	): Promise<SubagentRecord> {
		this.assertLive();
		// An owned spawn without a cwd (RPC or a fork skill on a child's bus) works where its delegating agent works.
		const cwd = request.cwd ?? (parent?.child ? sessionCwd(parent.child.session) : this.defaultCwd());
		// Definitions, like all configuration, come from the session's project, whatever directory the agent works in.
		const registry = this.refreshDefinitions();
		const settings = this.current;
		const resolution = resolveType(registry, settings);
		if (!resolution.ok) throw new Error(resolution.message);
		const { definition, fellBackFrom } = resolution;
		const invocation = resolveInvocationConfig(definition, request.params ?? {}, {
			worktreeAllowed: settings.worktreeIsolation,
			// A nested spawn blocks its parent's turn unless it asks for the background.
			defaultRunInBackground: parent ? false : settings.backgroundByDefault,
		});
		// A nested agent inherits the model of the agent that delegated, not the session's (R6).
		const host = parent?.child?.session ?? this.session;
		const model =
			request.model ??
			(await this.resolveModel(definition, invocation.modelInput, invocation.modelFromParams, host));
		const disclosed = await this.withHonoredModelDropped(invocation, model);
		// Outside a repository the spawn fails here, before any record exists.
		if (invocation.isolation === "worktree") await worktreeBase(cwd);
		this.assertLive();
		// A finished agent's session stays retained with its bus, and the agent may also end while this
		// spawn awaits. Either way a child started now would outlive its parent's cascade (R6).
		if (parent && parent.status !== "running") {
			throw new Error(`Agent "${parent.definition.name}" is not running; it cannot spawn subagents.`);
		}
		const mode: SpawnMode = request.mode ?? (invocation.runInBackground ? "background" : "foreground");
		const record = this.createRecord({
			definition,
			request,
			cwd,
			invocation: disclosed,
			model,
			mode,
			fellBackFrom,
			parent,
		});
		// A background Agent spawn outlives the tool call; a foreground or detached one stops with its signal.
		if (request.signal && mode !== "background") this.stopOn(request.signal, record);
		if (mode === "background") this.emit({ type: "created", record });
		if (record.joinMode === "smart" || record.joinMode === "group") this.batch.add(record);
		this.launch(record, request.prompt, invocation.inheritContext);
		return record;
	}

	/**
	 * An agent file's `model` outranked the caller's, but the caller's spelling may name the same model
	 * (`haiku` for `anthropic/claude-haiku-4-5`). Then the request was honored, and nothing discloses it
	 * (#182). A spelling that names another model, or none, stays in `overridden.model`.
	 */
	private async withHonoredModelDropped(
		invocation: InvocationConfig,
		model: Model<Api> | undefined,
	): Promise<InvocationConfig> {
		const asked = invocation.overridden?.model;
		if (!asked || !model) return invocation;
		const resolved = resolveModel(asked, await this.session.modelRuntime.getAvailable());
		if (typeof resolved === "string" || resolved.provider !== model.provider || resolved.id !== model.id) {
			return invocation;
		}
		const thinking = invocation.overridden?.thinking;
		return { ...invocation, overridden: thinking === undefined ? undefined : { thinking } };
	}

	private async resolveModel(
		definition: AgentDefinition,
		modelInput: string | undefined,
		fromCaller: boolean,
		host: AgentSession,
	): Promise<Model<Api> | undefined> {
		const resolution = resolveSpawnModel({
			modelInput,
			fromCaller,
			parentModel: host.model,
			// The scope check needs the model list even for an inherited model, or it sees no scope at all.
			available: modelInput || this.current.scopeModels ? await this.session.modelRuntime.getAvailable() : [],
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
		mode: SpawnMode;
		fellBackFrom?: string;
		parent?: SubagentRecord;
	}): SubagentRecord {
		const { parent } = input;
		// Handles name the session's own agents; a nested one is reached by id through its parent.
		let handle: string | undefined;
		let alias: string | undefined;
		if (!parent) {
			const taken = new Set(this.retention.tombstones.names());
			for (const record of this.records.values()) {
				if (record.handle) taken.add(record.handle);
				if (record.alias) taken.add(record.alias);
			}
			handle = assignHandle(handleBase(input.definition.name), taken);
			taken.add(handle);
			alias = input.request.name ? assignHandle(handleBase(input.request.name), taken) : undefined;
		}
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
			depth: parent ? parent.depth + 1 : 1,
			parent,
			parentId: parent?.id,
			mode: input.mode,
			resultConsumed: false,
			joinMode: input.mode === "background" && !parent ? this.current.defaultJoinMode : undefined,
			toolCallId: input.request.toolCallId,
			invocation: input.invocation,
			model: input.model,
			cwd: input.cwd,
			fellBackFrom: input.fellBackFrom,
			activity: [],
			effective: {},
			pendingSteers: [],
			waiters: new Set(),
		};
		// Known at once, so a background spawn's result can name it before the child exists. The
		// runner files it under the session's project, whatever directory the agent works in.
		if (input.definition.outputTranscript ?? this.current.outputTranscript) {
			record.transcriptPath = transcriptPath(this.defaultCwd(), this.session.sessionId, record.id);
		}
		this.records.set(record.id, record);
		input.request.onCreated?.(record);
		return record;
	}

	private launch(record: SubagentRecord, prompt: string, inheritContext: boolean, resuming = false): void {
		const pool = this.queue.poolFor(record, resuming);
		const start = () => this.start(record, prompt, inheritContext, pool);
		if (pool && !this.queue.hasRoom(pool)) {
			record.status = "queued";
			this.queue.enqueue(record, pool, start);
			this.emit({ type: "queued", record });
			return;
		}
		start();
	}

	private start(record: SubagentRecord, prompt: string, inheritContext: boolean, pool: Pool | undefined): void {
		record.status = "running";
		record.startedAt = Date.now();
		this.queue.take(pool);
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
		const request = this.childRequest(record, settings);
		const attach = (child: Child) => this.attachChild(record, child);
		if (record.invocation.isolation !== "worktree") return spawnChild(request, { ...turn, inheritContext }, attach);
		const creation = createWorktree(record.cwd, record.id);
		// Set before the first await, so a caller that started the run at once can wait on it (D33).
		record.worktreeStart = creation.then(
			() => undefined,
			(error: unknown) => (error instanceof Error ? error : new Error(String(error))),
		);
		try {
			record.worktree = await creation;
			record.worktreePath = record.worktree.workPath;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { status: "error", text: "", error: message, usage: emptyUsage(), turns: 0 };
		}
		const { worktree } = record;
		// The child works in the copy; configuration, memory and the transcript stay with the project.
		const outcome = await spawnChild(
			{ ...request, cwd: worktree.workPath, worktreeBase: record.cwd },
			{ ...turn, inheritContext },
			attach,
		);
		// Nested agents, children and theirs, may still work in the copy: stop them before it is saved and removed.
		await this.endDescendants(record);
		record.worktreeOutcome = await finishWorktree(worktree, `pi-agent: ${record.description.slice(0, 200)}`);
		const note = describeWorktreeOutcome(record.worktreeOutcome, worktree.repo);
		return note ? { ...outcome, text: outcome.text ? `${outcome.text}\n\n---\n${note}` : note } : outcome;
	}

	private childRequest(record: SubagentRecord, settings: SubagentSettings): ChildRequest {
		const { definition, invocation } = record;
		return {
			parent: this.session,
			inheritFrom: record.parent?.child?.session,
			agentDir: this.context.agentDir,
			definition,
			cwd: record.cwd,
			// Configuration always loads from the session's project, as pi-subagents did for a spawn's `cwd`.
			configCwd: this.defaultCwd(),
			model: record.model,
			thinking: invocation.thinking,
			isolated: invocation.isolated,
			persist: definition.persistSession ?? (record.parent ? false : settings.rememberAgents),
			sessionName: `${definition.name}#${record.id.slice(0, 8)}`,
			forkBaseToolNames: this.context.forkBaseToolNames(),
			customTools: this.nestedToolsFor(record, settings),
			lineage: { owner: this, parentRecord: record, depth: record.depth },
			transcript: { enabled: settings.outputTranscript, agentId: record.id, rootSessionId: this.session.sessionId },
			onActivity: (activity) => {
				record.activity.push(activity);
				if (activity.type === "tool_end") record.toolUses++;
			},
		};
	}

	/** The nested tools of a permitted agent below the depth cap; none otherwise (T6). */
	private nestedToolsFor(record: SubagentRecord, settings: SubagentSettings): ToolDefinition[] | undefined {
		const runtime = this.nested(record);
		return runtime.refusal(settings) === undefined ? this.context.createNestedTools?.(runtime) : undefined;
	}

	private attachChild(record: SubagentRecord, child: Child): void {
		record.child = child;
		record.sessionFile = child.session.sessionFile;
		record.transcriptPath = child.transcriptPath;
		// What the child runs with, after Pi resolved an inherited model and clamped the level (P22).
		record.effective = { model: child.session.model, thinking: child.session.thinkingLevel };
		// The owner ended while the child was being built: nothing may keep it.
		if (this.disposed) {
			this.teardowns.push(teardownChild(child));
			return;
		}
		for (const message of record.pendingSteers.splice(0)) this.deliverSteer(record, message);
	}

	/** A nested agent's spend counts in every ancestor's total, and once in the session's. */
	private addRecordUsage(record: SubagentRecord, usage: Usage): void {
		for (let owner: SubagentRecord | undefined = record; owner; owner = owner.parent) addUsage(owner.usage, usage);
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
		this.queue.release(pool);
		if (!inBackground(record.mode)) record.resultConsumed = true;
		this.finish(record);
		this.abortChildren(record);
		this.queue.drain();
	}

	/** Ends every agent below `ancestor` and waits for their runs, at most the child shutdown bound. */
	private async endDescendants(ancestor: SubagentRecord): Promise<void> {
		const descendants = [...this.records.values()].filter((record) => {
			for (let up = record.parent; up; up = up.parent) if (up === ancestor) return true;
			return false;
		});
		for (const record of descendants) this.endRecord(record, "aborted", PARENT_ENDED_ERROR);
		const runs = descendants.flatMap((record) => (record.run ? [record.run] : []));
		if (runs.length === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled(runs),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, CHILD_SHUTDOWN_TIMEOUT_MS);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
	}

	/** A parent's run ended: its running and queued children end with it, and theirs in turn as they settle (R6). */
	private abortChildren(parent: SubagentRecord): void {
		for (const record of this.records.values()) {
			if (record.parent === parent) this.endRecord(record, "aborted", PARENT_ENDED_ERROR);
		}
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
		if (record.parent || !inBackground(record.mode) || record.resultConsumed) return;
		if (this.batch.holds(record)) return;
		if (this.groups.complete(record) === "pass") this.notifications.park(record.id, [record]);
	}

	/** Any agent by id, whoever owns it: the bus adapter tells "not found" from "not yours" with it. */
	lookup(id: string): SubagentView | undefined {
		return this.records.get(id);
	}

	/**
	 * An agent by id, handle or alias among the session's own agents, or by id among the agents
	 * `owner` spawned. A nested agent is unreachable from the session (T6).
	 */
	get(ref: string, owner?: SubagentView): SubagentView | undefined {
		return this.find(ref, owner);
	}

	private find(ref: string, owner?: SubagentView): SubagentRecord | undefined {
		const byId = this.records.get(ref);
		if (byId) return byId.parent?.id === owner?.id ? byId : undefined;
		if (owner) return undefined;
		const wanted = ref.toLowerCase();
		return [...this.records.values()].find(
			(record) => !record.parent && (record.handle === wanted || record.alias === wanted),
		);
	}

	/** The session's own agents, newest first. */
	list(): SubagentView[] {
		return [...this.records.values()].filter((record) => !record.parent).sort((a, b) => b.startedAt - a.startedAt);
	}

	/** Evicted persisted agents a later phase can reopen by handle, newest first. */
	listTombstones(): Tombstone[] {
		return this.retention.tombstones.list();
	}

	/** The conversation of an agent whose child session exists; undefined for a queued or evicted one. */
	conversation(id: string): SubagentConversation | undefined {
		const session = this.records.get(id)?.child?.session;
		if (!session) return undefined;
		return {
			get messages() {
				return session.messages;
			},
			subscribe: (listener) =>
				session.subscribe((event) => {
					if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
						listener();
					}
				}),
		};
	}

	/** How full the agent's context window is, in percent; undefined when no child session reports it. */
	contextPercent(id: string): number | undefined {
		try {
			return this.records.get(id)?.child?.session.getSessionStats().contextUsage?.percent ?? undefined;
		} catch {
			return undefined;
		}
	}

	/** A queued agent's place in its pool's queue, 1 for the next to start; undefined when it is not queued. */
	queuePosition(id: string): number | undefined {
		const record = this.records.get(id);
		return record ? this.queue.position(record) : undefined;
	}

	/**
	 * The event bus of whoever owns the agent: the session's own bus for a top-level agent, the bus of
	 * the child session its parent runs in for a nested one. The adapter emits the agent's events there.
	 */
	ownerBusOf(view: SubagentView): EventBus | undefined {
		return view.parentId ? this.records.get(view.parentId)?.child?.loader.getEventBus() : this.context.eventBus;
	}

	/**
	 * Resolves with the record once its current run ends. Aborting `signal` rejects only this wait:
	 * the agent keeps running, its result stays unread, and its notification still arrives.
	 */
	waitForResult(ref: string, signal?: AbortSignal, owner?: SubagentView): Promise<SubagentView> {
		const record = this.find(ref, owner);
		if (!record) return Promise.reject(new Error(notFound(ref)));
		if (isTerminal(record) && !record.run) return Promise.resolve(record);
		if (signal?.aborted) return Promise.reject(signal.reason);
		return new Promise<SubagentView>((resolve, reject) => {
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

	/**
	 * Waits for a run that started at once to create its worktree, and throws the error when it could
	 * not (D33). The caller reports that error, so the record's own notification is dropped. A queued
	 * run, or one without a worktree, returns at once.
	 */
	async worktreeStarted(view: SubagentView): Promise<void> {
		const record = this.records.get(view.id);
		const error = await record?.worktreeStart;
		if (!record || !error) return;
		record.resultConsumed = true;
		throw error;
	}

	/** Marks a finished agent's result as read, which drops its notification. False for a running or unknown agent. */
	consume(ref: string, owner?: SubagentView): boolean {
		const record = this.find(ref, owner);
		if (!record || !isTerminal(record) || record.run) return false;
		record.resultConsumed = true;
		return true;
	}

	/**
	 * Steers a running or queued agent (F11). `delivered`: the child's `session.steer` resolved while the
	 * agent still runs. `queued`: the child does not exist yet and receives the message when it starts.
	 * `refused`: the agent is unknown, not the caller's, or finished, also when it ended while the steer
	 * was being delivered. `failed`: the child's steer rejected, as it does for extension-command text.
	 * Only `delivered` and `queued` announce `steered`.
	 */
	async steer(ref: string, message: string, owner?: SubagentView): Promise<SteerOutcome> {
		const record = this.find(ref, owner);
		if (!record) return { kind: "refused", reason: notFound(ref) };
		const notRunning = (): SteerOutcome => ({
			kind: "refused",
			reason: `Agent "${ref}" is not running (status: ${record.status}).`,
		});
		if (isTerminal(record)) return notRunning();
		if (!record.child) {
			record.pendingSteers.push(message);
			this.emit({ type: "steered", record, message });
			return { kind: "queued" };
		}
		try {
			await record.child.session.steer(message);
		} catch (error) {
			return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
		}
		// A stop or the owner's end during the delivery leaves the message with a run that no longer runs.
		if (this.disposed || isTerminal(record)) return notRunning();
		this.emit({ type: "steered", record, message });
		return { kind: "delivered" };
	}

	/** Delivers a steer that waited for the child; no caller waits, so a failure is recorded as activity. */
	private deliverSteer(record: SubagentRecord, message: string): void {
		record.child?.session.steer(message).catch((error: unknown) => {
			record.activity.push({ type: "extension-error", message: `steer failed: ${String(error)}` });
		});
	}

	/** Stops a running or queued agent; it ends `stopped`, keeping any partial output. */
	stop(ref: string, owner?: SubagentView): boolean {
		const record = this.find(ref, owner);
		return record ? this.endRecord(record, "stopped") : false;
	}

	/** Ends a running or queued agent as `stopped` (a caller) or `aborted` (an owner's end), keeping partial output. */
	private endRecord(record: SubagentRecord, status: "stopped" | "aborted", error?: string): boolean {
		if (record.status === "queued" && !record.run) {
			this.queue.remove(record);
			this.detachSignal(record);
			record.status = status;
			record.error = error;
			record.completedAt = Date.now();
			if (record.mode === "foreground") record.resultConsumed = true;
			this.finish(record);
			return true;
		}
		if (record.status !== "running") return false;
		record.status = status;
		record.error = error;
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
			queueMicrotask(() => this.endRecord(record, "stopped"));
			return;
		}
		const onAbort = () => this.endRecord(record, "stopped");
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
		options: { background: boolean; signal?: AbortSignal; toolCallId?: string; owner?: SubagentView },
	): SubagentView {
		this.assertLive();
		const record = this.find(ref, options.owner);
		if (!record) throw new Error(notFound(ref));
		if (!isTerminal(record) || record.run) throw new Error(`Agent "${ref}" is still running; steer it instead.`);
		if (!record.child) throw new Error(`Agent "${ref}" has no session to resume.`);
		// Its session's working directory was the worktree, which the run's end removed or handed over.
		if (record.worktree)
			throw new Error(`Agent "${ref}" ran in an isolated worktree and cannot be resumed; start a new agent.`);
		record.status = "queued";
		record.result = undefined;
		record.error = undefined;
		record.completedAt = undefined;
		record.resultConsumed = false;
		record.endReported = undefined;
		record.mode = options.background ? "background" : "foreground";
		// The new run answers a new tool call, and joins this turn's batch like a fresh spawn.
		record.toolCallId = options.toolCallId;
		record.joinMode = options.background && !record.parent ? this.current.defaultJoinMode : undefined;
		this.detachSignal(record);
		if (options.signal) this.stopOn(options.signal, record);
		if (options.background) this.emit({ type: "created", record });
		if (record.joinMode === "smart" || record.joinMode === "group") this.batch.add(record);
		this.launch(record, prompt, false, true);
		return record;
	}

	/** Subagent spend not yet reported to the session, when `reportUsage` is on. */
	takeReportedUsage(): Usage | undefined {
		return this.pendingUsage.take();
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
		this.retention.dispose();
		this.batch.dispose();
		this.groups.dispose();
		this.notifications.dispose();
		const ended = [...this.records.values()].filter((record) => !isTerminal(record) || record.run);
		this.queue.clear();
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
			if (record.child) this.teardowns.push(teardownChild(record.child));
			record.child = undefined;
			if (!record.run) {
				for (const waiter of [...record.waiters]) waiter();
				record.waiters.clear();
			}
		}
		this.listeners.clear();
	}

	/**
	 * Ends every agent as `dispose()` does, then waits at most `startupWaitMs` for children still
	 * starting, and resolves once every teardown started by then has settled: each child's
	 * `session_shutdown` handlers ran or hit their 3 s bound, and its session and loader are disposed.
	 * A child that attaches after the wait is torn down when it attaches; `shutdown()` does not wait
	 * for it. The presentation factory awaits `shutdown()` from the parent's `session_shutdown` (D21).
	 */
	async shutdown(): Promise<void> {
		const starting = [...this.records.values()].flatMap((record) =>
			record.run && !record.child ? [record.run] : [],
		);
		this.dispose();
		// A child still being built attaches after dispose(), which starts its teardown there (attachChild).
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			Promise.allSettled(starting),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, this.startupWaitMs);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
		// Read after the wait, so it holds the teardowns of children that attached during it.
		await Promise.allSettled(this.teardowns);
	}
}
