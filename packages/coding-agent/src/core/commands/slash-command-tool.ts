/**
 * A.7 model invocation: the canonical `slash_command` tool. Mirrors
 * `skills/skill-tool.ts`. A genuine model call resolves a model-visible command
 * by exact name, renders it once through the A.7 pipeline, and returns the
 * rendered text as its real tool result. Hidden (`disable-model-invocation:
 * true`) and unknown names are a tool error naming the valid alternatives.
 *
 * The name is canonical — there is no `SlashCommand` alias. CC's `SlashCommand`
 * reaches this tool only through the ADR-0006 redirect map when `slash_command`
 * is the active, registered target.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { LoadedCommand } from "./loader.ts";

export const SLASH_COMMAND_TOOL_NAME = "slash_command";

export const slashCommandToolSchema = Type.Object({
	command: Type.String({ description: "Command name from the available commands." }),
	args: Type.Optional(Type.String({ description: "Raw argument string passed to the command." })),
});

export interface SlashCommandToolResultDetails {
	command: string;
}

export interface SlashCommandToolDeps {
	/** Current loaded commands (native + adapted templates); visibility filtering happens here. */
	getCommands: () => readonly LoadedCommand[];
	/** Render one command invocation through the A.7 pipeline. */
	render: (
		command: LoadedCommand,
		rawArgs: string,
		signal?: AbortSignal,
	) => Promise<{ text: string; diagnostics: ResourceDiagnostic[] }>;
	/** Sink for render diagnostics; must not swallow them. */
	onDiagnostics?: (diagnostics: readonly ResourceDiagnostic[]) => void;
}

function listValidCommandNames(commands: readonly LoadedCommand[]): string {
	return commands
		.map((command) => command.name)
		.sort()
		.join(", ");
}

export function createSlashCommandToolDefinition(
	deps: SlashCommandToolDeps,
): ToolDefinition<typeof slashCommandToolSchema, SlashCommandToolResultDetails> {
	return {
		name: SLASH_COMMAND_TOOL_NAME,
		label: "slash_command",
		description:
			"Invoke a slash command by name and receive its fully rendered text. " +
			"Use this when the task matches a command's purpose. Do not guess command names: " +
			"use only names from the available commands. The result contains the rendered command text; follow it.",
		parameters: slashCommandToolSchema,
		async execute(
			_toolCallId,
			params: { command: string; args?: string },
			signal?: AbortSignal,
		): Promise<AgentToolResult<SlashCommandToolResultDetails>> {
			// Model-visible commands only: `disable-model-invocation` excludes from
			// both the listing and the accepted names (A.7). Exact name match.
			const visible = deps.getCommands().filter((command) => !command.disableModelInvocation);
			const command = visible.find((candidate) => candidate.name === params.command);
			if (!command) {
				const valid = listValidCommandNames(visible);
				throw new Error(
					valid.length > 0
						? `Unknown or model-hidden command "${params.command}". Valid commands: ${valid}. Do not guess command names.`
						: `No model-invocable commands are available; do not call the slash_command tool.`,
				);
			}

			const rendered = await deps.render(command, params.args ?? "", signal);
			if (rendered.diagnostics.length > 0) {
				deps.onDiagnostics?.(rendered.diagnostics);
			}
			return {
				content: [{ type: "text", text: rendered.text }],
				details: { command: command.name },
			};
		},
	};
}
