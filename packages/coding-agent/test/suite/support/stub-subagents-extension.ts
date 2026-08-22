/**
 * Stub subagents extension. By default it mirrors the AS-SHIPPED pi-subagents
 * v0.15.1 cross-extension surface (PROTOCOL_VERSION = 2): `subagents:rpc:ping` →
 * `{version:2}`, `subagents:rpc:spawn` → `{id}`, `subagents:rpc:stop`, and the
 * `subagents:completed` / `subagents:failed` broadcasts.
 *
 * With `protocolVersion: 3` it becomes the executable spec for Workstream 2 (the
 * pi-subagents fork): ping advertises `{version:3, capabilities:{skillAgents}}`,
 * completions arrive on the `subagents:agent-ended` event (native status set incl.
 * `steered`), and it publishes/answers the `skill-agents:rewrite-maps` /
 * `skill-agents:query` seam. v2 stays the default so existing v2 tests are
 * untouched.
 *
 * Registers on the shared harness event bus so the session's SkillForkClient and
 * SkillRuntime detect and drive it. Knobs cover the ordering race (completion
 * before vs after the spawn reply), a "no subagents present" mode, a "never reply"
 * spawn, and the `subagents:ready` presence signal.
 *
 * The reply channel (`${channel}:reply:${requestId}`) and `{success, data?}`
 * envelope match `~/Developer/ai/pi-subagents/src/cross-extension-rpc.ts`; the
 * contract-pin test cross-checks them against that source when the checkout is
 * present.
 */

import type { EventBus, ExtensionAPI, ExtensionFactory } from "../../../src/index.ts";
import {
	SKILL_AGENTS_QUERY_CHANNEL,
	SKILL_AGENTS_REWRITE_MAPS_CHANNEL,
	type SkillAgentRewriteMaps,
	skillAgentsQueryReplyChannel,
} from "../../../src/index.ts";

export const STUB_PROTOCOL_VERSION = 2;
export const STUB_PROTOCOL_VERSION_V3 = 3;
const SUBAGENTS_PING = "subagents:rpc:ping";
const SUBAGENTS_SPAWN = "subagents:rpc:spawn";
const SUBAGENTS_STOP = "subagents:rpc:stop";
const SUBAGENTS_COMPLETED = "subagents:completed";
const SUBAGENTS_FAILED = "subagents:failed";
const SUBAGENTS_AGENT_ENDED = "subagents:agent-ended";
const SUBAGENTS_READY = "subagents:ready";

export function stubReplyChannel(channel: string, requestId: string): string {
	return `${channel}:reply:${requestId}`;
}

export interface StubSpawnRecord {
	requestId: string;
	type: string;
	prompt: string;
	options: Record<string, unknown>;
	agentId: string;
}

/** Terminal fork status set (matches the pi-subagents fork's native union). */
export type StubAgentStatus = "completed" | "steered" | "error" | "aborted" | "stopped";

export interface StubCompletion {
	result?: string;
	error?: string;
	status?: StubAgentStatus;
	description?: string;
}

export interface StubSubagentsOptions {
	/** Register nothing when false → "no subagents present" (ping never replies). Default true. */
	present?: boolean;
	/** Advertised protocol version. v3 adds capabilities, agent-ended, and the rewrite-map seam. Default 2. */
	protocolVersion?: 2 | 3;
	/** Advertised `capabilities.skillAgents` (v3 only). Default false. */
	skillAgents?: boolean;
	/** Spawn handler records the spawn but never replies (spawn-reply timeout test). */
	neverReply?: boolean;
	/** Spawn handler replies with an error envelope (spawn-failure degradation test). */
	spawnError?: string;
	/**
	 * Auto-emit a completion on every spawn. `when` forces the ordering race: "before-reply"
	 * emits the completion synchronously ahead of the spawn reply (exercising the client's buffer).
	 * At v3 the completion is emitted as `agent-ended`; at v2 as the completed/failed broadcast.
	 */
	autoComplete?: { when: "before-reply" | "after-reply"; channel?: "completed" | "failed" } & StubCompletion;
	idPrefix?: string;
}

export interface StubSubagentsController {
	factory: ExtensionFactory;
	readonly spawns: StubSpawnRecord[];
	readonly stops: string[];
	/** Resolve when the Nth spawn (0-based) has been recorded. */
	waitForSpawn(index?: number): Promise<StubSpawnRecord>;
	/** Emit a `subagents:completed` broadcast for a spawned agent (v2 shape). */
	complete(agentId: string, completion?: StubCompletion): void;
	/** Emit a `subagents:failed` broadcast for a spawned agent (v2 shape). */
	fail(agentId: string, completion?: StubCompletion): void;
	/** Emit a `subagents:agent-ended` event for a spawned agent (v3 shape). */
	endAgent(agentId: string, completion?: StubCompletion): void;
	/** Publish a `skill-agents:rewrite-maps` event and cache it for query replies (v3). */
	publishRewriteMaps(maps: SkillAgentRewriteMaps, revision?: number): void;
	/** Emit the `subagents:ready` presence broadcast. */
	emitReady(): void;
	/** Emit a raw completion/failure payload (e.g. an id the client never spawned). */
	emitRaw(channel: "completed" | "failed", payload: Record<string, unknown>): void;
}

export function createStubSubagentsExtension(options: StubSubagentsOptions = {}): StubSubagentsController {
	const present = options.present ?? true;
	const protocolVersion = options.protocolVersion ?? 2;
	const idPrefix = options.idPrefix ?? "stub-agent-";
	const spawns: StubSpawnRecord[] = [];
	const stops: string[] = [];
	const spawnWaiters: Array<{ index: number; resolve: (record: StubSpawnRecord) => void }> = [];
	let events: EventBus | undefined;
	let counter = 0;
	let lastRewriteMaps: { revision: number; maps: SkillAgentRewriteMaps } = { revision: 0, maps: {} };

	function resolveSpawnWaiters(): void {
		for (let i = spawnWaiters.length - 1; i >= 0; i--) {
			const waiter = spawnWaiters[i];
			if (spawns.length > waiter.index) {
				spawnWaiters.splice(i, 1);
				waiter.resolve(spawns[waiter.index]);
			}
		}
	}

	function buildPayload(agentId: string, completion: StubCompletion): Record<string, unknown> {
		const record = spawns.find((spawn) => spawn.agentId === agentId);
		return {
			id: agentId,
			type: record?.type ?? "general-purpose",
			description: completion.description ?? "stub fork",
			result: completion.result,
			error: completion.error,
			status: completion.status ?? "completed",
			toolUses: 0,
			durationMs: 1,
			tokens: undefined,
		};
	}

	function emitCompletion(channel: "completed" | "failed", agentId: string, completion: StubCompletion): void {
		events?.emit(channel === "failed" ? SUBAGENTS_FAILED : SUBAGENTS_COMPLETED, buildPayload(agentId, completion));
	}

	function emitAgentEnded(agentId: string, completion: StubCompletion): void {
		events?.emit(SUBAGENTS_AGENT_ENDED, {
			agentId,
			status: completion.status ?? "completed",
			...(completion.result !== undefined && { result: completion.result }),
			...(completion.error !== undefined && { error: completion.error }),
		});
	}

	/** Emit an auto-completion in the shape the negotiated protocol uses. */
	function emitAuto(agentId: string, auto: NonNullable<StubSubagentsOptions["autoComplete"]>): void {
		if (protocolVersion === 3) {
			emitAgentEnded(agentId, auto);
		} else {
			emitCompletion(auto.channel ?? "completed", agentId, auto);
		}
	}

	const factory: ExtensionFactory = (pi: ExtensionAPI) => {
		events = pi.events;
		if (!present) {
			return;
		}
		pi.events.on(SUBAGENTS_PING, (raw) => {
			const { requestId } = raw as { requestId: string };
			const data =
				protocolVersion === 3
					? { version: STUB_PROTOCOL_VERSION_V3, capabilities: { skillAgents: options.skillAgents ?? false } }
					: { version: STUB_PROTOCOL_VERSION };
			pi.events.emit(stubReplyChannel(SUBAGENTS_PING, requestId), { success: true, data });
		});
		pi.events.on(SUBAGENTS_SPAWN, (raw) => {
			const params = raw as { requestId: string; type: string; prompt: string; options?: Record<string, unknown> };
			const agentId = `${idPrefix}${++counter}`;
			spawns.push({
				requestId: params.requestId,
				type: params.type,
				prompt: params.prompt,
				options: params.options ?? {},
				agentId,
			});
			resolveSpawnWaiters();
			if (options.neverReply) {
				return;
			}
			if (options.spawnError !== undefined) {
				pi.events.emit(stubReplyChannel(SUBAGENTS_SPAWN, params.requestId), {
					success: false,
					error: options.spawnError,
				});
				return;
			}
			const auto = options.autoComplete;
			// Emit BEFORE the reply to force the client's completion-before-reply buffer path.
			if (auto?.when === "before-reply") {
				emitAuto(agentId, auto);
			}
			pi.events.emit(stubReplyChannel(SUBAGENTS_SPAWN, params.requestId), {
				success: true,
				data: { id: agentId },
			});
			if (auto?.when === "after-reply") {
				emitAuto(agentId, auto);
			}
		});
		pi.events.on(SUBAGENTS_STOP, (raw) => {
			const { requestId, agentId } = raw as { requestId: string; agentId: string };
			stops.push(agentId);
			pi.events.emit(stubReplyChannel(SUBAGENTS_STOP, requestId), { success: true });
		});
		// The rewrite-map seam is a v3 fork feature: only a v3 stub answers pulls.
		if (protocolVersion === 3) {
			pi.events.on(SKILL_AGENTS_QUERY_CHANNEL, (raw) => {
				const requestId = (raw as { requestId?: unknown }).requestId;
				if (typeof requestId !== "string" || requestId.length === 0) {
					return;
				}
				pi.events.emit(skillAgentsQueryReplyChannel(requestId), { success: true, data: lastRewriteMaps });
			});
		}
	};

	return {
		factory,
		spawns,
		stops,
		waitForSpawn(index = 0) {
			if (spawns.length > index) {
				return Promise.resolve(spawns[index]);
			}
			return new Promise((resolve) => spawnWaiters.push({ index, resolve }));
		},
		complete(agentId, completion = {}) {
			emitCompletion("completed", agentId, { status: "completed", ...completion });
		},
		fail(agentId, completion = {}) {
			emitCompletion("failed", agentId, { status: "error", ...completion });
		},
		endAgent(agentId, completion = {}) {
			emitAgentEnded(agentId, { status: "completed", ...completion });
		},
		publishRewriteMaps(maps, revision = lastRewriteMaps.revision + 1) {
			lastRewriteMaps = { revision, maps };
			events?.emit(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, lastRewriteMaps);
		},
		emitReady() {
			events?.emit(SUBAGENTS_READY, {});
		},
		emitRaw(channel, payload) {
			events?.emit(channel === "failed" ? SUBAGENTS_FAILED : SUBAGENTS_COMPLETED, payload);
		},
	};
}
