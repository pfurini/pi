/**
 * A.1 model invocation (C1c): the dedicated `skill` tool. A genuine model
 * tool call resolves a model-visible skill by name, renders it once through
 * the C1b pipeline, and returns the rendered content as its real tool result
 * (inline mode) on any provider. Hidden (`disable-model-invocation: true`)
 * and unknown names are a tool error naming the valid alternatives — the
 * description carries the "do not guess names" contract.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { SkillToolResultDetails } from "./delivery.ts";
import type { LoadedSkill } from "./frontmatter.ts";
import type { RenderedSkillInvocation } from "./render.ts";

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
	render: (skill: LoadedSkill, rawArgs: string, signal?: AbortSignal) => Promise<RenderedSkillInvocation>;
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
