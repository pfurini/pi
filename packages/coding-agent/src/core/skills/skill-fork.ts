/**
 * C3b fork spawn client: an event-bus client that runs a `context: fork` skill
 * in a pi-subagents subagent instead of splicing it inline (A.5 fork routing,
 * A.9 wire contract). Pure `pi.events` pub/sub — no code import of pi-subagents.
 *
 * Integration target is pi-subagents v0.15.1 AS SHIPPED (PROTOCOL_VERSION = 2):
 * feature-detect with `subagents:rpc:ping` → `{version}`, spawn via
 * `subagents:rpc:spawn {requestId,type,prompt,options} → {id}`, and consume the
 * EXISTING `subagents:completed` / `subagents:failed` broadcasts (correlated by
 * `id`). `normalizeSubagentCompletion()` is the ONE seam that names pi-subagents'
 * event/payload shape, so a later rename (or a Workstream 2 `agent-ended` event)
 * is absorbed there without touching routing.
 *
 * Spawn options carry ONLY the resolved `model` (string form) + `isBackground`;
 * v0.15.1 `SpawnOptions` has no `env`, so A.8 values are already rendered into
 * the prompt in the parent. An absent event bus === "no subagents present": every
 * subscribe/emit is guarded and the client reports not-present so routing degrades.
 */

import { randomUUID } from "node:crypto";
import type { EventBus } from "../event-bus.ts";

const SUBAGENTS_PING = "subagents:rpc:ping";
const SUBAGENTS_SPAWN = "subagents:rpc:spawn";
const SUBAGENTS_STOP = "subagents:rpc:stop";
const SUBAGENTS_COMPLETED = "subagents:completed";
const SUBAGENTS_FAILED = "subagents:failed";
/** WS2 v3 completion event (native status set incl. `steered`), correlated by `agentId`. */
const SUBAGENTS_AGENT_ENDED = "subagents:agent-ended";
const SUBAGENTS_READY = "subagents:ready";

/** Per-request scoped reply channel (matches pi-subagents `cross-extension-rpc.ts`). */
function rpcReplyChannel(channel: string, requestId: string): string {
	return `${channel}:reply:${requestId}`;
}

const PING_TIMEOUT_MS = 2_000;
const SPAWN_REPLY_TIMEOUT_MS = 10_000;
const FOREGROUND_CAP_MS = 15 * 60_000;
/** Small cap so unrelated top-level subagents' completions cannot grow the buffer. */
const COMPLETION_BUFFER_MAX = 64;

/** The `normalizeSubagentCompletion` return: the pi-subagents-shape-free view routing consumes. */
export interface NormalizedCompletion {
	agentId: string;
	/** Decided by channel: `subagents:completed` → true, `subagents:failed` → false. */
	ok: boolean;
	result?: string;
	error?: string;
	/** `completed|steered|error|stopped|aborted`, carried through for the tool-error detail. */
	status?: string;
}

/** Discriminated fork spawn outcome the AgentSession routing branches on. */
export type ForkOutcome =
	| { kind: "spawned-background"; agentId: string }
	| { kind: "completed"; agentId: string; ok: boolean; result?: string; error?: string; status?: string }
	| { kind: "foreground-timeout"; agentId: string }
	| { kind: "aborted"; agentId: string }
	| { kind: "spawn-failed"; error: string }
	| { kind: "repeat-blocked" };

/** Subagent spawn options carried on the wire: only the resolved model (no env — A.8 is baked into the prompt). */
export interface SubagentSpawnOptions {
	/** Resolved model in `provider/id` string form; omitted keeps the subagent's default. */
	model?: string;
}

export interface SkillForkSpawnParams {
	/** Canonical skill id: keys the repeat-while-running guard. */
	skillId: string;
	/** Record `agent` type; `undefined` → `general-purpose` on the wire. */
	agentType: string | undefined;
	/** Rendered skill body (A.8 substitutions + shell injection already baked in). */
	prompt: string;
	/** Resolved spawn options (`model` string only); the client adds `isBackground`. */
	options: SubagentSpawnOptions;
	background: boolean;
	/** Background completion callback (success and failure); clears the guard upstream. */
	onBackgroundComplete?: (completion: NormalizedCompletion) => void;
	foregroundCapMs?: number;
	spawnReplyTimeoutMs?: number;
	signal?: AbortSignal;
}

/**
 * Map a `subagents:completed` / `subagents:failed` broadcast to the shape routing
 * consumes. The ONLY function that knows pi-subagents' event names/payload; a
 * future rename is absorbed here. `ok` is decided by channel, not re-derived from
 * `status` (matches the verified upstream `isError` split).
 */
export function normalizeSubagentCompletion(channel: string, payload: unknown): NormalizedCompletion {
	const p = (typeof payload === "object" && payload !== null ? payload : {}) as {
		id?: unknown;
		result?: unknown;
		error?: unknown;
		status?: unknown;
	};
	return {
		agentId: typeof p.id === "string" ? p.id : "",
		ok: channel === SUBAGENTS_COMPLETED,
		...(typeof p.result === "string" && { result: p.result }),
		...(typeof p.error === "string" && { error: p.error }),
		...(typeof p.status === "string" && { status: p.status }),
	};
}

/**
 * Map a `subagents:agent-ended` event (WS2 v3) to the routing shape, or
 * `undefined` for a malformed payload without a string `status`: a terminal
 * event must carry the fork's native status, and guessing success for one that
 * does not would silently swallow a failure. Correlated by `agentId` (not
 * `id`), and `ok` is derived from the native status: success is everything that
 * is not a hard failure, mirroring the fork's own `isError` split
 * (`error | stopped | aborted`). So `completed` AND `steered` are successes,
 * whether or not the fork carries `steered` in this event.
 */
export function normalizeAgentEnded(payload: unknown): NormalizedCompletion | undefined {
	const p = (typeof payload === "object" && payload !== null ? payload : {}) as {
		agentId?: unknown;
		result?: unknown;
		error?: unknown;
		status?: unknown;
	};
	if (typeof p.status !== "string") {
		return undefined;
	}
	const status = p.status;
	const isError = status === "error" || status === "stopped" || status === "aborted";
	return {
		agentId: typeof p.agentId === "string" ? p.agentId : "",
		ok: !isError,
		...(typeof p.result === "string" && { result: p.result }),
		...(typeof p.error === "string" && { error: p.error }),
		status,
	};
}

/** Reply envelope `{success:true, data?} | {success:false, error}` (pi-mono RpcResponse). */
function readReplyId(data: unknown): { ok: true; id: string } | { ok: false; error: string } {
	const env = data as { success?: unknown; data?: { id?: unknown }; error?: unknown } | null;
	if (env?.success === true && env.data && typeof env.data.id === "string") {
		return { ok: true, id: env.data.id };
	}
	return { ok: false, error: typeof env?.error === "string" ? env.error : "spawn rejected" };
}

export class SkillForkClient {
	private readonly eventBus: EventBus | undefined;
	private readonly spawnReplyTimeoutMs: number;
	private readonly foregroundCapMs: number;
	private readonly pingTimeoutMs: number;
	/** Repeat-while-running guard: skillId → agentId (or a reservation placeholder). */
	private readonly liveBackgroundBySkillId = new Map<string, string>();
	/** Idempotency: a duplicate or post-settlement broadcast for a settled id is dropped. */
	private readonly settledAgentIds = new Set<string>();
	/** Per-agent one-shot completion waiter (foreground resolver or background callback). */
	private readonly waiters = new Map<string, (completion: NormalizedCompletion) => void>();
	/** Foreground abort/dispose settlers, so a pending await settles promptly on teardown. */
	private readonly foregroundSettlers = new Map<string, () => void>();
	/** Bounded completion buffer for the ordering race (completion before the spawn reply). */
	private readonly completionBuffer = new Map<string, NormalizedCompletion>();
	/** Number of spawns awaiting their reply; a completion is buffered only while > 0. */
	private awaitingSpawnReply = 0;
	private readonly unsubscribers: Array<() => void> = [];
	private presencePromise: Promise<boolean> | undefined;
	/** Negotiated protocol version from the ping reply (WS2); undefined until detection runs. */
	private detectedVersion: number | undefined;
	/** Advertised `capabilities.skillAgents` from the ping reply; undefined until detection runs. */
	private skillAgentsCapable: boolean | undefined;
	/** Placeholder value marking a synchronous reservation before the agent id is known. */
	private static readonly RESERVED = "\u0000reserved";

	constructor(
		eventBus: EventBus | undefined,
		options: { spawnReplyTimeoutMs?: number; foregroundCapMs?: number; pingTimeoutMs?: number } = {},
	) {
		this.eventBus = eventBus;
		this.spawnReplyTimeoutMs = options.spawnReplyTimeoutMs ?? SPAWN_REPLY_TIMEOUT_MS;
		this.foregroundCapMs = options.foregroundCapMs ?? FOREGROUND_CAP_MS;
		this.pingTimeoutMs = options.pingTimeoutMs ?? PING_TIMEOUT_MS;
		if (eventBus) {
			this.unsubscribers.push(
				eventBus.on(SUBAGENTS_COMPLETED, (data) =>
					this.deliverCompletion(normalizeSubagentCompletion(SUBAGENTS_COMPLETED, data)),
				),
				eventBus.on(SUBAGENTS_FAILED, (data) =>
					this.deliverCompletion(normalizeSubagentCompletion(SUBAGENTS_FAILED, data)),
				),
				eventBus.on(SUBAGENTS_AGENT_ENDED, (data) => {
					const completion = normalizeAgentEnded(data);
					if (completion) {
						this.deliverCompletion(completion);
					}
				}),
				eventBus.on(SUBAGENTS_READY, () => this.onReady()),
			);
		}
	}

	/**
	 * Feature-detect a subagents extension via `subagents:rpc:ping` (2s). Memoized
	 * as a `Promise<boolean>` so concurrent first calls single-flight; any cached
	 * result (and captured negotiation) is invalidated by a later `subagents:ready`
	 * broadcast, since the peer may have changed.
	 */
	detectPresence(): Promise<boolean> {
		if (this.presencePromise) {
			return this.presencePromise;
		}
		this.presencePromise = this.probePresence();
		return this.presencePromise;
	}

	private probePresence(): Promise<boolean> {
		const bus = this.eventBus;
		if (!bus) {
			return Promise.resolve(false);
		}
		return new Promise<boolean>((resolve) => {
			const requestId = randomUUID();
			const replyChannel = rpcReplyChannel(SUBAGENTS_PING, requestId);
			let settled = false;
			let timer: NodeJS.Timeout | undefined;
			const settle = (present: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer) {
					clearTimeout(timer);
				}
				unsubscribe();
				resolve(present);
			};
			const unsubscribe = bus.on(replyChannel, (data) => {
				const reply = data as { success?: unknown; data?: unknown } | null;
				const present = reply?.success === true;
				if (present) {
					this.captureNegotiation(reply?.data);
				}
				settle(present);
			});
			timer = setTimeout(() => settle(false), this.pingTimeoutMs);
			if (timer.unref) {
				timer.unref();
			}
			bus.emit(SUBAGENTS_PING, { requestId });
		});
	}

	private onReady(): void {
		// A subagents extension (re)announced itself mid-session: install, upgrade,
		// downgrade, or /reload. Invalidate the memoized probe AND the captured
		// negotiation — the peer may have changed version/capabilities, and a stale
		// verdict would mis-gate qualified skill:agent types in both directions. The
		// next fork re-probes (and re-negotiates) before spawning.
		this.presencePromise = undefined;
		this.detectedVersion = undefined;
		this.skillAgentsCapable = undefined;
	}

	/** Record the negotiated protocol version and capabilities from a successful ping reply (WS2). */
	private captureNegotiation(data: unknown): void {
		if (typeof data !== "object" || data === null) {
			return;
		}
		const envelope = data as { version?: unknown; capabilities?: { skillAgents?: unknown } };
		this.detectedVersion = typeof envelope.version === "number" ? envelope.version : undefined;
		this.skillAgentsCapable = envelope.capabilities?.skillAgents === true;
	}

	/** Negotiated protocol version, or undefined before detection has run. */
	getDetectedVersion(): number | undefined {
		return this.detectedVersion;
	}

	/** Whether the peer advertised `capabilities.skillAgents` (WS2 v3). False until proven true. */
	isSkillAgentsCapable(): boolean {
		return this.skillAgentsCapable === true;
	}

	/**
	 * Spawn a fork. Reserves the repeat guard synchronously (background only) BEFORE
	 * the async spawn, installs the per-agent waiter BEFORE draining any buffered
	 * completion, and releases the guard on every terminal path.
	 */
	async spawn(params: SkillForkSpawnParams): Promise<ForkOutcome> {
		const bus = this.eventBus;
		const { skillId, agentType, prompt, options, background } = params;

		// Atomic reservation: two concurrent background forks of the same skill
		// cannot both pass (the second sees the reservation).
		let reserved = false;
		if (background) {
			if (this.liveBackgroundBySkillId.has(skillId)) {
				return { kind: "repeat-blocked" };
			}
			this.liveBackgroundBySkillId.set(skillId, SkillForkClient.RESERVED);
			reserved = true;
		}
		if (!bus) {
			if (reserved) {
				this.liveBackgroundBySkillId.delete(skillId);
			}
			return { kind: "spawn-failed", error: "no subagents extension present" };
		}

		const spawnOptions = { ...options, isBackground: background };
		let reply: { ok: true; id: string } | { ok: false; error: string };
		this.awaitingSpawnReply++;
		try {
			reply = await this.awaitSpawnReply(bus, agentType, prompt, spawnOptions, params.spawnReplyTimeoutMs);
		} finally {
			this.awaitingSpawnReply = Math.max(0, this.awaitingSpawnReply - 1);
		}

		if (!reply.ok) {
			if (reserved) {
				this.liveBackgroundBySkillId.delete(skillId);
			}
			this.maybeEvictBuffer();
			return { kind: "spawn-failed", error: reply.error };
		}
		const agentId = reply.id;

		if (background) {
			this.liveBackgroundBySkillId.set(skillId, agentId);
			// Capture only the callback, not `params`, so the long-lived waiter does
			// not retain the rendered prompt for the fork's whole lifetime.
			const { onBackgroundComplete } = params;
			this.waiters.set(agentId, (completion) => {
				this.liveBackgroundBySkillId.delete(skillId);
				onBackgroundComplete?.(completion);
			});
			this.drainBuffered(agentId);
			this.maybeEvictBuffer();
			return { kind: "spawned-background", agentId };
		}
		return this.awaitForeground(agentId, params);
	}

	private awaitSpawnReply(
		bus: EventBus,
		agentType: string | undefined,
		prompt: string,
		options: SubagentSpawnOptions & { isBackground: boolean },
		timeoutMs: number | undefined,
	): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		return new Promise((resolve) => {
			const requestId = randomUUID();
			const replyChannel = rpcReplyChannel(SUBAGENTS_SPAWN, requestId);
			let settled = false;
			let timer: NodeJS.Timeout | undefined;
			const settle = (result: { ok: true; id: string } | { ok: false; error: string }) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer) {
					clearTimeout(timer);
				}
				unsubscribe();
				resolve(result);
			};
			const unsubscribe = bus.on(replyChannel, (data) => settle(readReplyId(data)));
			timer = setTimeout(
				() => settle({ ok: false, error: "spawn reply timed out" }),
				timeoutMs ?? this.spawnReplyTimeoutMs,
			);
			if (timer.unref) {
				timer.unref();
			}
			// Subscribe-before-emit (the reply may fire synchronously in tests).
			bus.emit(SUBAGENTS_SPAWN, { requestId, type: agentType ?? "general-purpose", prompt, options });
		});
	}

	private awaitForeground(agentId: string, params: SkillForkSpawnParams): Promise<ForkOutcome> {
		return new Promise<ForkOutcome>((resolve) => {
			let settled = false;
			let timer: NodeJS.Timeout | undefined;
			const cleanup = () => {
				if (timer) {
					clearTimeout(timer);
				}
				params.signal?.removeEventListener("abort", onAbort);
				this.waiters.delete(agentId);
				this.foregroundSettlers.delete(agentId);
			};
			const finish = (outcome: ForkOutcome) => {
				if (settled) {
					return;
				}
				settled = true;
				this.settledAgentIds.add(agentId);
				cleanup();
				resolve(outcome);
			};
			const onAbort = () => this.stop(agentId);
			// Real completion resolves through the shared waiter registry.
			this.waiters.set(agentId, (completion) =>
				finish({
					kind: "completed",
					agentId,
					ok: completion.ok,
					...(completion.result !== undefined && { result: completion.result }),
					...(completion.error !== undefined && { error: completion.error }),
					...(completion.status !== undefined && { status: completion.status }),
				}),
			);
			// stop()/dispose() settle a pending wait as aborted.
			this.foregroundSettlers.set(agentId, () => finish({ kind: "aborted", agentId }));
			timer = setTimeout(
				() => finish({ kind: "foreground-timeout", agentId }),
				params.foregroundCapMs ?? this.foregroundCapMs,
			);
			if (timer.unref) {
				timer.unref();
			}
			if (params.signal) {
				if (params.signal.aborted) {
					onAbort();
					return;
				}
				params.signal.addEventListener("abort", onAbort, { once: true });
			}
			// Install-before-drain: the waiter is set above, so a completion that
			// raced ahead of the reply is delivered now, not dropped.
			this.drainBuffered(agentId);
			this.maybeEvictBuffer();
		});
	}

	/** Emit `subagents:rpc:stop` (fire-and-forget) and settle any outstanding wait once. */
	stop(agentId: string): void {
		try {
			this.eventBus?.emit(SUBAGENTS_STOP, { requestId: randomUUID(), agentId });
		} catch {
			// Fire-and-forget: a stale/throwing bus must never prevent settling the wait.
		}
		const settler = this.foregroundSettlers.get(agentId);
		if (settler) {
			settler();
		}
	}

	/** Route one normalized completion to its waiter, buffer it, or ignore it. */
	private deliverCompletion(completion: NormalizedCompletion): void {
		const { agentId } = completion;
		if (agentId === "" || this.settledAgentIds.has(agentId)) {
			return;
		}
		const waiter = this.waiters.get(agentId);
		if (waiter) {
			this.settledAgentIds.add(agentId);
			this.waiters.delete(agentId);
			waiter(completion);
			return;
		}
		// No waiter yet: buffer only while a spawn is still awaiting its reply (the
		// correlation window); otherwise it is an unrelated top-level subagent. First
		// completion per agent wins: a dual-emit (v2 broadcast + v3 agent-ended) before
		// the reply must not let the later event overwrite the earlier buffered one.
		if (
			this.awaitingSpawnReply > 0 &&
			!this.completionBuffer.has(agentId) &&
			this.completionBuffer.size < COMPLETION_BUFFER_MAX
		) {
			this.completionBuffer.set(agentId, completion);
		}
	}

	private drainBuffered(agentId: string): void {
		const buffered = this.completionBuffer.get(agentId);
		if (buffered) {
			this.completionBuffer.delete(agentId);
			this.deliverCompletion(buffered);
		}
	}

	private maybeEvictBuffer(): void {
		// No spawn is awaiting a reply, so any leftover is an unrelated subagent.
		if (this.awaitingSpawnReply === 0) {
			this.completionBuffer.clear();
		}
	}

	/** Whether a background fork of this skill is currently live (repeat guard read). */
	hasLiveBackground(skillId: string): boolean {
		return this.liveBackgroundBySkillId.has(skillId);
	}

	/**
	 * Stop and settle every pending foreground wait as aborted (session abort); keeps
	 * subscriptions. Emits `subagents:rpc:stop` per agent so an aborted foreground fork
	 * does not leave its subagent running (`stop()` also settles the wait, idempotently).
	 */
	cancelForegroundWaits(): void {
		for (const agentId of [...this.foregroundSettlers.keys()]) {
			this.stop(agentId);
		}
		this.foregroundSettlers.clear();
	}

	/** Unsubscribe listeners, settle pending foreground waits as aborted, clear state. Idempotent. */
	dispose(): void {
		for (const unsubscribe of this.unsubscribers) {
			try {
				unsubscribe();
			} catch {
				// Dispose must not throw on a stale bus.
			}
		}
		this.unsubscribers.length = 0;
		this.cancelForegroundWaits();
		this.waiters.clear();
		this.completionBuffer.clear();
		this.liveBackgroundBySkillId.clear();
	}
}
