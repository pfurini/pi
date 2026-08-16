/**
 * A.1 model invocation (C1c): the dedicated `skill` tool. A genuine model
 * tool call resolves a model-visible skill by name, renders it once through
 * the C1b pipeline, and returns the rendered content as its real tool result
 * (inline mode) on any provider. Hidden (`disable-model-invocation: true`)
 * and unknown names are a tool error naming the valid alternatives — the
 * description carries the "do not guess names" contract.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { SkillToolResultDetails } from "./delivery.ts";
import type { LoadedSkill } from "./frontmatter.ts";
import type { RenderedSkillInvocation } from "./render.ts";

/**
 * C3b fork tool result: when a `context: fork` skill runs as a subagent, the
 * `skill` tool returns an acknowledgment (background) or the subagent's result /
 * a tool error (foreground) instead of the rendered body. The AgentSession
 * render binding produces this; `execute` only unwraps it.
 */
export interface SkillToolForkResult {
	fork: true;
	content: TextContent[];
	isError?: boolean;
	/** The fork invocation metadata (persistence/UI read it; same shape as an inline result). */
	details: SkillToolResultDetails;
}

/**
 * A.6 re-invocation dedup (c4b): a genuine inline `skill` tool call whose
 * `(skillId, args, rendered body)` matches its last full inline delivery
 * still present in context. The AgentSession render binding decides the hit
 * (`details.emptyBody: true` requests 0/0 offsets so the note counts but is
 * never a dedup anchor); `execute` only unwraps it, mirroring the fork variant.
 */
export interface SkillToolDedupNoteResult {
	dedupNote: true;
	content: TextContent[];
	details: SkillToolResultDetails;
}

export const skillToolSchema = Type.Object({
	name: Type.String({ description: "Skill name from the <available_skills> listing." }),
	args: Type.Optional(Type.String({ description: "Raw argument string passed to the skill." })),
});

export interface SkillToolDeps {
	/** Current loaded skills (normalized); visibility filtering happens here. */
	getSkills: () => LoadedSkill[];
	/**
	 * Render one invocation through the C1b pipeline AND activate it in the
	 * session's SkillRuntime (A.5: the record governs the continuation
	 * requests after this tool result, expiring at logical-turn end).
	 */
	render: (
		skill: LoadedSkill,
		rawArgs: string,
		signal?: AbortSignal,
	) => Promise<RenderedSkillInvocation | SkillToolForkResult | SkillToolDedupNoteResult>;

	/** Sink for render/activation diagnostics; must not swallow them. */
	onDiagnostics?: (diagnostics: ResourceDiagnostic[]) => void;
}

function listValidSkillNames(skills: readonly LoadedSkill[]): string {
	return skills
		.map((skill) => skill.listingName)
		.sort()
		.join(", ");
}

export function createSkillToolDefinition(
	deps: SkillToolDeps,
): ToolDefinition<typeof skillToolSchema, SkillToolResultDetails> {
	return {
		name: "skill",
		label: "skill",
		description:
			"Invoke a skill listed in <available_skills> and receive its fully rendered instructions. " +
			"Use this when the task matches a skill's description. Do not guess skill names: " +
			"use only names from the listing. The result contains the rendered skill content; follow it.",
		parameters: skillToolSchema,
		async execute(
			_toolCallId,
			params: { name: string; args?: string },
			signal?: AbortSignal,
		): Promise<AgentToolResult<SkillToolResultDetails>> {
			// Model-visible skills only: `disable-model-invocation` excludes from
			// both the listing and the accepted names (A.1). `user-invocable:
			// false` stays model-visible; never infer one flag from the other.
			const visibleSkills = deps.getSkills().filter((skill) => !skill.disableModelInvocation);
			const skill = visibleSkills.find(
				(candidate) => candidate.name === params.name || candidate.listingName === params.name,
			);
			if (!skill) {
				const valid = listValidSkillNames(visibleSkills);
				throw new Error(
					valid.length > 0
						? `Unknown or model-hidden skill "${params.name}". Valid skills: ${valid}. Do not guess skill names.`
						: `No model-invocable skills are available; do not call the skill tool.`,
				);
			}

			const rendered = await deps.render(skill, params.args ?? "", signal);
			// A `context: fork` skill spawned a subagent: return its ack/result
			// (the AgentSession binding built it), never the rendered body. A
			// foreground failure/timeout must be reported as a tool error while
			// keeping `details.fork` (c4b, A.5/A.6): a thrown error would be
			// replaced by the agent loop's empty-`details` error result, losing
			// the fork discriminator dedup/carry-forward need. `details.forkError`
			// asks `agent.afterToolCall` (agent-session.ts) to mark the finalized
			// result `isError: true` while the merge keeps `details` intact. The
			// binding already emitted any diagnostics on the fork path.
			if ("fork" in rendered) {
				return {
					content: rendered.content,
					details: rendered.isError ? { ...rendered.details, forkError: true } : rendered.details,
				};
			}
			// A.6 dedup hit (c4b): the AgentSession binding already substituted the
			// note for the full body and set `details.emptyBody`.
			if ("dedupNote" in rendered) {
				return { content: rendered.content, details: rendered.details };
			}
			if (rendered.diagnostics.length > 0) {
				deps.onDiagnostics?.(rendered.diagnostics);
			}
			return {
				content: [{ type: "text", text: rendered.body }],
				details: { invocation: rendered.invocation },
			};
		},
	};
}
