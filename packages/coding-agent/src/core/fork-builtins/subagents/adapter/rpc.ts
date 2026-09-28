/**
 * Fork-owned: the `subagents:rpc:*` channels (plan T8; D19). pi-subagents `src/cross-extension-rpc.ts`
 * and `docs/rpc.md` at 79a7c42 define the channels, the reply envelope `{ success, data? }` or
 * `{ success: false, error }`, the spawn options and every error string; this module keeps them.
 *
 * Every request resolves its scope then: a top-level session answers for its own agents, and a child
 * session answers for the agent it runs as (plan Section 2.1 "Child lineage"), so `allowed_subagents`,
 * `isolated` and `maxSubagentDepth` apply to a spawn from a child's bus. An RPC spawn is detached: it
 * blocks nobody, `isBackground` alone decides whether it takes a background slot, and its
 * `subagents:agent-ended` follows its reply.
 */
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "../../../agent-session.ts";
import type { EventBus } from "../../../event-bus.ts";
import type { NestedRuntime } from "../service/nested.ts";
import type { SubagentRecord } from "../service/records.ts";
import type { SpawnRequest, SubagentService } from "../service/service.ts";
import { subagentServiceFor, subagentSessionRecord } from "../service/sessions.ts";
import { flushSpawnReply, markSpawnPending } from "./events.ts";

/** Bumped when the envelope or a channel's contract changes; 3 adds `agent-ended` and `capabilities.skillAgents`. */
export const SUBAGENTS_PROTOCOL_VERSION = 3;

/** The spawn options a bus caller may set (`docs/rpc.md` "Spawn options"); anything else is ignored. */
interface RpcSpawnOptions {
	description?: unknown;
	name?: unknown;
	model?: unknown;
	maxTurns?: unknown;
	isolated?: unknown;
	inheritContext?: unknown;
	thinkingLevel?: unknown;
	isBackground?: unknown;
	isolation?: unknown;
	cwd?: unknown;
	signal?: unknown;
}

interface Scope {
	service: SubagentService;
	/** The agent a child session runs as; absent in a top-level session. */
	owner?: SubagentRecord;
	nested?: NestedRuntime;
}

function scopeOf(session: AgentSession): Scope {
	const context = subagentSessionRecord(session);
	const lineage = context?.lineage;
	if (lineage) {
		return {
			service: lineage.owner,
			owner: lineage.parentRecord,
			nested: lineage.owner.nested(lineage.parentRecord),
		};
	}
	const service = subagentServiceFor(session);
	if (!service) throw new Error("No active session");
	return { service };
}

/** A spawn's `cwd`: absent or null keeps the session's; anything else must be an existing absolute directory. */
function spawnCwd(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || !isAbsolute(value)) {
		throw new Error(`SpawnOptions.cwd must be an absolute path: "${String(value)}"`);
	}
	let isDirectory: boolean;
	try {
		isDirectory = statSync(value).isDirectory();
	} catch {
		throw new Error(`SpawnOptions.cwd does not exist: "${value}"`);
	}
	if (!isDirectory) throw new Error(`SpawnOptions.cwd is not a directory: "${value}"`);
	return value;
}

/** A `"provider/id"` string or a model object, resolved and scope-checked as a caller's choice; null inherits. */
async function spawnModel(service: SubagentService, value: unknown, type: string): Promise<Model<Api> | undefined> {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return service.resolveCallerModel(value, type);
	const model = value as { provider?: unknown; id?: unknown };
	if (typeof model.provider === "string" && typeof model.id === "string") {
		return service.resolveCallerModel(`${model.provider}/${model.id}`, type);
	}
	throw new Error('SpawnOptions.model must be a model or a "provider/modelId" string');
}

const optional = <T>(value: unknown, test: (value: unknown) => value is T): T | undefined =>
	test(value) ? value : undefined;
const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** Listens on `channel`, runs `handle`, and replies on `<channel>:reply:<requestId>`. */
function serve<P extends { requestId: string }>(
	bus: EventBus,
	channel: string,
	handle: (params: P) => unknown | Promise<unknown>,
	afterReply?: (params: P) => void,
): () => void {
	return bus.on(channel, async (raw) => {
		const params = raw as P;
		try {
			const data = await handle(params);
			bus.emit(
				`${channel}:reply:${params.requestId}`,
				data === undefined ? { success: true } : { success: true, data },
			);
		} catch (error) {
			bus.emit(`${channel}:reply:${params.requestId}`, {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			afterReply?.(params);
		}
	});
}

/** Answers ping, spawn, stop and consume for `session` on `bus`; returns the unsubscriber. */
export function serveRpc(session: AgentSession, bus: EventBus): () => void {
	const spawnedBy = new Map<string, string>();
	const offs = [
		serve(bus, "subagents:rpc:ping", () => ({
			version: SUBAGENTS_PROTOCOL_VERSION,
			capabilities: { skillAgents: true },
		})),
		serve<{ requestId: string; type?: unknown; prompt?: unknown; options?: unknown }>(
			bus,
			"subagents:rpc:spawn",
			async ({ requestId, type, prompt, options }) => {
				const scope = scopeOf(session);
				const raw = (typeof options === "object" && options !== null ? options : {}) as RpcSpawnOptions;
				const agentType = typeof type === "string" ? type : "";
				const isolation = raw.isolation === "worktree" ? "worktree" : undefined;
				const request: SpawnRequest = {
					type: agentType,
					prompt: typeof prompt === "string" ? prompt : "",
					description: optional(raw.description, isString) ?? "",
					name: optional(raw.name, isString),
					params: {
						max_turns: optional(raw.maxTurns, isNumber),
						isolated: optional(raw.isolated, isBoolean),
						inherit_context: optional(raw.inheritContext, isBoolean),
						thinking: optional(raw.thinkingLevel, isString),
						isolation,
					},
					model: await spawnModel(scope.service, raw.model, agentType),
					cwd: spawnCwd(raw.cwd),
					mode: optional(raw.isBackground, isBoolean) ? "detached-background" : "detached",
					signal: raw.signal instanceof AbortSignal ? raw.signal : undefined,
					// Held so the spawn's reply reaches the bus before the agent's terminal event.
					onCreated: (record) => {
						spawnedBy.set(requestId, record.id);
						markSpawnPending(bus, record.id);
					},
				};
				const record = scope.nested ? await scope.nested.spawn(request) : await scope.service.spawn(request);
				return { id: record.id };
			},
			({ requestId }) => {
				const id = spawnedBy.get(requestId);
				spawnedBy.delete(requestId);
				if (id) flushSpawnReply(bus, id);
			},
		),
		serve<{ requestId: string; agentId?: unknown }>(bus, "subagents:rpc:stop", ({ agentId }) => {
			const scope = scopeOf(session);
			const id = typeof agentId === "string" ? agentId : "";
			const record = scope.service.lookup(id);
			if (!record) throw new Error("Agent not found");
			// A nested agent is its parent's to stop; aborting it would fail the parent's own step.
			if (record.parent !== scope.owner) throw new Error("Agent is owned by another agent or workflow");
			if (!scope.service.stop(id, scope.owner)) throw new Error("Agent is not running");
		}),
		serve<{ requestId: string; agentId?: unknown }>(bus, "subagents:rpc:consume", ({ agentId }) => {
			const scope = scopeOf(session);
			const ref = typeof agentId === "string" ? agentId : "";
			const record = scope.service.lookup(ref);
			if (record && record.parent !== scope.owner) throw new Error("Agent is owned by another agent or workflow");
			if (!scope.service.consume(ref, scope.owner)) throw new Error("Agent not found or still running");
		}),
	];
	return () => {
		for (const off of offs) off();
	};
}
