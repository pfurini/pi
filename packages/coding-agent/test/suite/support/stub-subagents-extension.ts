/**
 * Stub subagents extension mirroring the AS-SHIPPED pi-subagents v0.15.1 cross-extension
 * surface (PROTOCOL_VERSION = 2): `subagents:rpc:ping` → `{version:2}`, `subagents:rpc:spawn`
 * → `{id}`, `subagents:rpc:stop`, and the `subagents:completed` / `subagents:failed`
 * broadcasts. Registers on the shared harness event bus so the session's SkillForkClient
 * detects and drives it. Knobs cover the ordering race (completion before vs after the spawn
 * reply), a "no subagents present" mode, a "never reply" spawn, and the `subagents:ready`
 * presence signal.
 *
 * The reply channel (`${channel}:reply:${requestId}`) and `{success, data?}` envelope match
 * `~/Developer/ai/pi-subagents-tintin/src/cross-extension-rpc.ts` exactly; the contract-pin
 * test cross-checks them against that source when the checkout is present.
 */

import type { EventBus, ExtensionAPI, ExtensionFactory } from "../../../src/index.ts";

export const STUB_PROTOCOL_VERSION = 2;
const SUBAGENTS_PING = "subagents:rpc:ping";
const SUBAGENTS_SPAWN = "subagents:rpc:spawn";
const SUBAGENTS_STOP = "subagents:rpc:stop";
const SUBAGENTS_COMPLETED = "subagents:completed";
const SUBAGENTS_FAILED = "subagents:failed";
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

export interface StubCompletion {
	result?: string;
	error?: string;
	status?: string;
	description?: string;
}

export interface StubSubagentsOptions {
	/** Register nothing when false → "no subagents present" (ping never replies). Default true. */
	present?: boolean;
	/** Spawn handler records the spawn but never replies (spawn-reply timeout test). */
	neverReply?: boolean;
	/** Spawn handler replies with an error envelope (spawn-failure degradation test). */
	spawnError?: string;
	/**
	 * Auto-emit a completion on every spawn. `when` forces the ordering race: "before-reply"
	 * emits the completion synchronously ahead of the spawn reply (exercising the client's buffer).
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
	/** Emit a `subagents:completed` broadcast for a spawned agent. */
	complete(agentId: string, completion?: StubCompletion): void;
	/** Emit a `subagents:failed` broadcast for a spawned agent. */
	fail(agentId: string, completion?: StubCompletion): void;
	/** Emit the `subagents:ready` presence broadcast. */
	emitReady(): void;
	/** Emit a raw completion/failure payload (e.g. an id the client never spawned). */
	emitRaw(channel: "completed" | "failed", payload: Record<string, unknown>): void;
}

export function createStubSubagentsExtension(options: StubSubagentsOptions = {}): StubSubagentsController {
	const present = options.present ?? true;
	const idPrefix = options.idPrefix ?? "stub-agent-";
	const spawns: StubSpawnRecord[] = [];
	const stops: string[] = [];
	const spawnWaiters: Array<{ index: number; resolve: (record: StubSpawnRecord) => void }> = [];
	let events: EventBus | undefined;
	let counter = 0;

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

	const factory: ExtensionFactory = (pi: ExtensionAPI) => {
		events = pi.events;
		if (!present) {
			return;
		}
		pi.events.on(SUBAGENTS_PING, (raw) => {
			const { requestId } = raw as { requestId: string };
			pi.events.emit(stubReplyChannel(SUBAGENTS_PING, requestId), {
				success: true,
				data: { version: STUB_PROTOCOL_VERSION },
			});
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
				emitCompletion(auto.channel ?? "completed", agentId, auto);
			}
			pi.events.emit(stubReplyChannel(SUBAGENTS_SPAWN, params.requestId), {
				success: true,
				data: { id: agentId },
			});
			if (auto?.when === "after-reply") {
				emitCompletion(auto.channel ?? "completed", agentId, auto);
			}
		});
		pi.events.on(SUBAGENTS_STOP, (raw) => {
			const { requestId, agentId } = raw as { requestId: string; agentId: string };
			stops.push(agentId);
			pi.events.emit(stubReplyChannel(SUBAGENTS_STOP, requestId), { success: true });
		});
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
		emitReady() {
			events?.emit(SUBAGENTS_READY, {});
		},
		emitRaw(channel, payload) {
			events?.emit(channel === "failed" ? SUBAGENTS_FAILED : SUBAGENTS_COMPLETED, payload);
		},
	};
}
