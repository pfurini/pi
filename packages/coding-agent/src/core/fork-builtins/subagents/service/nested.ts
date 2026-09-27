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
 * The runner injects the three nested tools into a permitted agent's child session as custom
 * tools, so they override the child's own base tools of the same names. T8 serves a child
 * session's RPC and skill-fork spawns through the same runtime.
 */
import { type TSchema, Type } from "typebox";
import type { ToolDefinition } from "../../../extensions/types.ts";
import {
	type AgentRegistry,
	listedAgentTypes,
	resolveAgentKey,
	type SpawnTypeResolution,
} from "../definitions/registry.ts";
import { THINKING_LEVELS } from "../settings/models.ts";
import type { SubagentSettings } from "../settings/settings.ts";
import { errorText, foregroundOutcomeNote, partialOutputSuffix } from "../tools/common.ts";
import { AGENT_TOOL_NAME, GET_RESULT_TOOL_NAME, STEER_TOOL_NAME } from "../tools/names.ts";
import { statusNote } from "./notifications.ts";
import { isTerminal, type SubagentRecord } from "./records.ts";
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
	async spawn(request: Omit<SpawnRequest, "detached">): Promise<SubagentRecord> {
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

function nestedText(text: string) {
	return { content: [{ type: "text" as const, text }], details: undefined };
}

/**
 * A nested result has no headline, so a note on a short outcome leads the text. `inline` is a
 * foreground spawn or a resume, which hands back everything; `fetched` is a background child's
 * result, which the parent may poll again.
 */
function formatNested(record: SubagentRecord, position: "inline" | "fetched"): string {
	if (record.status === "error")
		return `Agent failed: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}`;
	if (!isTerminal(record)) return `Agent ${record.id} is ${record.status}.`;
	const text = record.result?.trim() || record.error?.trim() || "No output.";
	const note = position === "inline" ? foregroundOutcomeNote(record.status) : statusNote(record.status);
	return note ? `Nested agent${note}.\n\n${text}` : text;
}

function notOwned(ref: string): string {
	return `Nested agent not found or not owned by this parent: "${ref}".`;
}

/** The arguments Pi validates against the nested `Agent` schema. */
interface NestedAgentParams {
	prompt: string;
	description: string;
	subagent_type: string;
	model?: string;
	thinking?: string;
	max_turns?: number;
	run_in_background?: boolean;
	resume?: string;
	isolated?: boolean;
	inherit_context?: boolean;
	isolation?: "off" | "worktree";
}

function nestedAgentParameters(types: string[], worktreeIsolation: boolean): TSchema {
	return Type.Object({
		prompt: Type.String({ description: "Self-contained task for the nested agent." }),
		description: Type.String({ description: "Short 3-5 word task description." }),
		subagent_type: Type.String({
			description: `Allowed nested agent type. Available: ${types.join(", ") || "none"}.`,
		}),
		model: Type.Optional(Type.String({ description: "Optional provider/model override." })),
		thinking: Type.Optional(Type.String({ description: `Optional thinking level: ${THINKING_LEVELS.join(", ")}.` })),
		max_turns: Type.Optional(Type.Number({ minimum: 1 })),
		run_in_background: Type.Optional(
			Type.Boolean({
				description:
					"Defaults to false for nested spawns — the call blocks and returns the child's result inline. Set true only for work you will collect later with get_subagent_result; a detached child is stopped when you finish.",
			}),
		),
		resume: Type.Optional(Type.String({ description: "Resume a nested agent owned by this parent." })),
		isolated: Type.Optional(Type.Boolean()),
		inherit_context: Type.Optional(Type.Boolean()),
		...(worktreeIsolation && {
			isolation: Type.Optional(
				Type.Union([Type.Literal("off"), Type.Literal("worktree")], {
					description: 'Isolation mode. Default "off". "worktree" gives the nested agent its own git worktree.',
				}),
			),
		}),
	});
}

const NESTED_RESULT_PARAMETERS = Type.Object({
	agent_id: Type.String(),
	wait: Type.Optional(Type.Boolean()),
});

const NESTED_STEER_PARAMETERS = Type.Object({
	agent_id: Type.String(),
	message: Type.String(),
});

/** The three tools a permitted agent's child session receives, bound to `runtime`'s parent record. */
export function createNestedToolDefinitions(runtime: NestedRuntime): ToolDefinition[] {
	const settings = runtime.service.settings;
	const agent: ToolDefinition = {
		name: AGENT_TOOL_NAME,
		label: "Agent",
		description:
			"Launch a child-safe nested subagent for bounded delegated work. " +
			"Only use agent types allowed by this parent agent; nesting is depth-limited.",
		parameters: nestedAgentParameters(runtime.allowedTypes(runtime.service.registry), settings.worktreeIsolation),
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const args = params as NestedAgentParams;
			if (args.resume) {
				if (!runtime.get(args.resume)) return nestedText(notOwned(args.resume));
				try {
					const record = runtime.resume(args.resume, args.prompt, { background: false, signal });
					await runtime.waitForResult(record.id);
					return nestedText(formatNested(record, "inline"));
				} catch (error) {
					return nestedText(errorText(error));
				}
			}
			let record: SubagentRecord;
			try {
				record = await runtime.spawn({
					type: args.subagent_type,
					prompt: args.prompt,
					description: args.description,
					params: args,
					cwd: ctx.cwd,
					signal,
					toolCallId,
				});
			} catch (error) {
				return nestedText(errorText(error));
			}
			if (record.isBackground) return nestedText(`Nested agent started in background. Agent ID: ${record.id}`);
			await runtime.waitForResult(record.id);
			return nestedText(formatNested(record, "inline"));
		},
	};

	const result: ToolDefinition<typeof NESTED_RESULT_PARAMETERS> = {
		name: GET_RESULT_TOOL_NAME,
		label: "Get Nested Agent Result",
		description: "Check or wait for a background nested agent owned by this parent.",
		parameters: NESTED_RESULT_PARAMETERS,
		async execute(_toolCallId, params, signal) {
			const record = runtime.get(params.agent_id);
			if (!record) return nestedText(notOwned(params.agent_id));
			if (params.wait) {
				try {
					await runtime.waitForResult(record.id, signal);
				} catch (error) {
					if (!signal?.aborted) return nestedText(errorText(error));
					return nestedText(`Stopped waiting for nested agent ${record.id}; it is still ${record.status}.`);
				}
			}
			return nestedText(formatNested(record, "fetched"));
		},
	};

	const steer: ToolDefinition<typeof NESTED_STEER_PARAMETERS> = {
		name: STEER_TOOL_NAME,
		label: "Steer Nested Agent",
		description: "Send guidance to a running nested agent owned by this parent.",
		parameters: NESTED_STEER_PARAMETERS,
		async execute(_toolCallId, params) {
			const record = runtime.get(params.agent_id);
			if (!record || isTerminal(record)) {
				return nestedText(`Running nested agent not found or not owned by this parent: "${params.agent_id}".`);
			}
			const waiting = !record.child;
			runtime.steer(record.id, params.message);
			return nestedText(
				waiting
					? `Steering message queued for nested agent ${record.id}.`
					: `Steering message sent to nested agent ${record.id}.`,
			);
		},
	};

	return [agent, result, steer];
}
