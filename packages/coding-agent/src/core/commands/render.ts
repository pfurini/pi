/**
 * A.7 command render pipeline. Reuses the C1 primitives (`skills/arguments.ts`,
 * `skills/interop.ts`, `skills/shell-injection.ts`) with the command-specific
 * stage set, in a single pass (later stages never re-scan earlier output):
 *
 * 1. A.7.1 `@path` include inlining (`include.ts`) — before arguments, so
 *    arguments can never introduce includes.
 * 2. Argument substitution (A.3.2).
 * 3. `${PI_*}` / `${CLAUDE_*}` variable substitution (A.8).
 * 4. Shell injection (A.3.5) — always invoked; an omitted `shell` means default
 *    bash, not disabled injection.
 *
 * The skill-only stages (base-dir preamble, `@path` absolutization, agent-name
 * rewrite, CC tool-note) are omitted. Commands splice plain rendered text and
 * carry no B.12 skill invocation metadata.
 */

import { buildSpawnShellEnv } from "../../utils/shell.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import {
	parseDeclaredArgumentNames,
	type SkillArgumentsDeclaration,
	substituteSkillArguments,
} from "../skills/arguments.ts";
import type { SkillToolList } from "../skills/frontmatter.ts";
import {
	resolveEffectiveEffort,
	resolveProjectRoot,
	SKILL_VARIABLES,
	substituteSkillVariables,
} from "../skills/interop.ts";
import { injectShellCommands, type SkillShellSettings } from "../skills/shell-injection.ts";
import type { BashOperations } from "../tools/bash.ts";
import { inlineCommandIncludes } from "./include.ts";
import type { LoadedCommand } from "./loader.ts";

export interface RenderCommandContext {
	/** Session cwd; shell injection runs with this cwd. */
	cwd: string;
	sessionId: string;
	/** Session thinking level, used when the command carries no `effort`. */
	thinkingLevel: string;
	/** `skillInterop` setting: when false, `${CLAUDE_*}` aliases are dropped. */
	skillInterop: boolean;
	/** Effective active tool set (A.3.5 gate input). */
	activeToolNames: readonly string[];
	/** Shell injection settings (kill switch, timeout, output cap). */
	shellSettings: SkillShellSettings;
	shellPath?: string;
	signal?: AbortSignal;
	/** Execution backend override (tests, remote backends). */
	bashOperations?: BashOperations;
}

export interface RenderedCommand {
	/** Final rendered text, spliced verbatim into the message. */
	text: string;
	diagnostics: ResourceDiagnostic[];
}

/** Render one command invocation through the A.7 stage order. Never throws for shell failures. */
export async function renderCommand(
	command: LoadedCommand,
	rawArgs: string,
	context: RenderCommandContext,
): Promise<RenderedCommand> {
	const diagnostics: ResourceDiagnostic[] = [];

	// Stage 1: A.7.1 include inlining (before arguments).
	const included = inlineCommandIncludes(command.body, command.filePath);
	diagnostics.push(...included.diagnostics);
	let body = included.text;

	// Stage 2: argument substitution (A.3.2).
	body = substituteSkillArguments(
		body,
		rawArgs,
		parseDeclaredArgumentNames(command.frontmatter.arguments as SkillArgumentsDeclaration | undefined),
	);

	// Stage 3: PI_* / CLAUDE_* variable substitution (A.8).
	const effortField = command.frontmatter.effort;
	const values: Record<string, string> = {
		PI_SKILL_DIR: command.baseDir,
		PI_PROJECT_DIR: resolveProjectRoot(context.cwd),
		PI_SESSION_ID: context.sessionId,
		PI_EFFORT: resolveEffectiveEffort(
			typeof effortField === "string" || typeof effortField === "number" ? effortField : undefined,
			context.thinkingLevel,
			diagnostics,
		),
	};
	if (context.skillInterop) {
		for (const { pi, claude } of SKILL_VARIABLES) {
			values[claude] = values[pi];
		}
	}
	body = substituteSkillVariables(body, values);

	// Stage 4: shell injection (A.3.5). Always invoked; omitted `shell` = default bash.
	body = await injectShellCommands(body, {
		cwd: context.cwd,
		env: () => ({ ...buildSpawnShellEnv(), ...values }),
		shell: typeof command.frontmatter.shell === "string" ? command.frontmatter.shell : undefined,
		activeToolNames: context.activeToolNames,
		disallowedTools: command.frontmatter["disallowed-tools"] as SkillToolList | undefined,
		settings: context.shellSettings,
		signal: context.signal,
		operations: context.bashOperations,
		shellPath: context.shellPath,
		diagnostics,
	});

	return { text: body, diagnostics };
}
