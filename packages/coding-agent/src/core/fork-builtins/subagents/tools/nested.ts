/**
 * Fork-owned: the three nested tools a permitted agent's child session receives (plan T6), bound to
 * one `NestedRuntime`. `base-tools.ts` hands `createNestedToolDefinitions` to the service through the
 * session context, so the service layer builds no tool definition itself.
 */
import { type TSchema, Type } from "typebox";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { AGENT_TOOL_NAME, GET_RESULT_TOOL_NAME, STEER_TOOL_NAME } from "../names.ts";
import type { NestedRuntime } from "../service/nested.ts";
import { statusNote } from "../service/notifications.ts";
import { isTerminal, type SubagentRecord } from "../service/records.ts";
import { THINKING_LEVELS } from "../settings/models.ts";
import { errorText, foregroundOutcomeNote, partialOutputSuffix } from "./common.ts";

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
			if (record.mode === "background")
				return nestedText(`Nested agent started in background. Agent ID: ${record.id}`);
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
