/**
 * Fork-owned: nested subagents (plan T6; R6). pi-subagents `src/nested-tools.ts` and
 * `src/agent-runner.ts:915-945` at 79a7c42 are the behavior reference.
 *
 * `NestedRuntime` is one agent's delegation surface. The agent may spawn only when it names
 * `allowed_subagents`, is not isolated, and sits below `maxSubagentDepth` (main session 0, its
 * agents 1). Types resolve strictly against the allowlist, never through `fallbackSubagent`. Every
 * lookup sees only the records this agent spawned. A nested spawn blocks unless it asks for the
 * background, occupies no pool slot, and ends when its parent's run ends.
 *
 * `tools/nested.ts` builds the three nested tools; the runner injects them into a permitted agent's child session as custom
 * tools, so they override the child's own base tools of the same names. T8 serves a child
 * session's RPC and skill-fork spawns through the same runtime.
 */
import {
	type AgentRegistry,
	listedAgentTypes,
	resolveAgentKey,
	type SpawnTypeResolution,
} from "../definitions/registry.ts";
import type { SubagentSettings } from "../settings/settings.ts";
import type { SubagentRecord } from "./records.ts";
import type { SpawnRequest, SubagentService } from "./service.ts";

export class NestedRuntime {
	readonly service: SubagentService;
	/** The agent that delegates; every record this runtime reaches has it as its parent. */
	readonly parent: SubagentRecord;

	constructor(service: SubagentService, parent: SubagentRecord) {
		this.service = service;
		this.parent = parent;
	}

	/** Why the agent may not spawn, or undefined when it may. */
	refusal(settings: SubagentSettings = this.service.settings): string | undefined {
		const { definition, invocation, depth } = this.parent;
		if (invocation.isolated) return `Agent "${definition.name}" is isolated; it cannot spawn subagents.`;
		if (!definition.allowedSubagents) {
			return `Agent "${definition.name}" has no allowed_subagents; it cannot spawn subagents.`;
		}
		if (depth >= settings.maxSubagentDepth) {
			return `Nested subagent call blocked (depth=${depth}, max=${settings.maxSubagentDepth}). Complete the task directly.`;
		}
		return undefined;
	}

	/** Registry keys the allowlist names, or undefined under `all`. */
	private allowedKeys(registry: AgentRegistry): Set<string> | undefined {
		const allowed = this.parent.definition.allowedSubagents;
		if (allowed === undefined || allowed === "all") return undefined;
		return new Set(allowed.map((name) => resolveAgentKey(registry, name) ?? name));
	}

	/** The enabled agent types this parent may spawn, for descriptions and refusals. */
	allowedTypes(registry: AgentRegistry): string[] {
		const allowed = this.allowedKeys(registry);
		return allowed ? [...allowed].filter((key) => registry.agents.get(key)?.enabled) : listedAgentTypes(registry);
	}

	/** Strict resolution: an unknown, disabled or unlisted type is refused, naming what is allowed. */
	resolveType(registry: AgentRegistry, requested: string): SpawnTypeResolution {
		const raw = requested.trim();
		const key = resolveAgentKey(registry, raw);
		const definition = key === undefined ? undefined : registry.agents.get(key);
		const allowed = this.allowedKeys(registry);
		const list = this.allowedTypes(registry).join(", ") || "none";
		if (key === undefined || !definition?.enabled) {
			return { ok: false, message: `Unknown or disabled nested agent type: "${raw}". Allowed: ${list}.` };
		}
		if (allowed && !allowed.has(key)) {
			return { ok: false, message: `Nested agent type "${key}" is not allowed for this parent. Allowed: ${list}.` };
		}
		return { ok: true, definition };
	}

	/** Spawns an agent this parent owns. Throws the refusal, or the type or model error, as the service does. */
	async spawn(request: Omit<SpawnRequest, "mode">): Promise<SubagentRecord> {
		const refusal = this.refusal(this.service.reloadSettings());
		if (refusal) throw new Error(refusal);
		return this.service.spawnOwned(this.parent, request, (registry) => this.resolveType(registry, request.type));
	}

	get(ref: string): SubagentRecord | undefined {
		return this.service.get(ref, this.parent);
	}

	waitForResult(ref: string, signal?: AbortSignal): Promise<SubagentRecord> {
		return this.service.waitForResult(ref, signal, this.parent);
	}

	steer(ref: string, message: string): boolean {
		return this.service.steer(ref, message, this.parent);
	}

	stop(ref: string): boolean {
		return this.service.stop(ref, this.parent);
	}

	consume(ref: string): boolean {
		return this.service.consume(ref, this.parent);
	}

	resume(ref: string, prompt: string, options: { background: boolean; signal?: AbortSignal }): SubagentRecord {
		return this.service.resume(ref, prompt, { ...options, owner: this.parent });
	}
}
