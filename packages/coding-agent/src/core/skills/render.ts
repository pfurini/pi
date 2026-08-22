/**
 * A.3 render pipeline orchestration (ADR-0004): one async renderer with
 * deterministic stage ordering, consumed by every invocation path. Stage
 * order (A.3.1):
 *
 * 1. Agent-name rewrite (A.3.4; no-op without a Workstream 2 rewrite map).
 * 2. Base-dir preamble (`Base directory for this skill: <dir>`).
 * 3. Argument substitution (A.3.2, arguments.ts).
 * 4. Variable substitution: `${PI_*}` plus `${CLAUDE_*}` aliases when enabled
 *    (A.8, interop.ts).
 * 5. Shell injection (A.3.5, shell-injection.ts).
 * 6. Conditional CC tool-name steering note (ADR-0006 layer 3).
 *
 * No stage reinterprets introduced text as a skill-authored *reference*: the
 * agent-name rewrite sees only what the author wrote, and there is no `@path`
 * stage at all (a skill-local reference is written `@${PI_SKILL_DIR}/x.md`, so
 * ordinary variable substitution makes exactly what the author marked
 * absolute). Two stages do read substituted argument text, by design: shell
 * injection (CC parity, see the A.3.5 security note) and variable
 * substitution.
 */

import { readFile } from "node:fs/promises";
import { stripFrontmatter } from "../../utils/frontmatter.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { BashOperations } from "../tools/bash.ts";
import { parseDeclaredArgumentNames, substituteSkillArguments } from "./arguments.ts";
import type { LoadedSkill } from "./frontmatter.ts";
import {
	buildCcToolNote,
	buildSkillExecutionEnv,
	buildSkillSubstitutionMap,
	type SkillInteropContext,
	substituteSkillVariables,
} from "./interop.ts";
import {
	type SkillAgentRewriteMap,
	type SkillInvocation,
	type SkillInvocationMetadata,
	toInvocationMetadata,
} from "./runtime.ts";
import { injectShellCommands, type SkillShellSettings } from "./shell-injection.ts";

export interface RenderSkillContext extends SkillInteropContext {
	/** The session's effective active tool set (A.3.5 gate input). */
	activeToolNames: readonly string[];
	/** Shell injection settings (kill switch, timeout ms, output cap). */
	shellSettings: SkillShellSettings;
	/** Optional explicit bash path from settings. */
	shellPath?: string;
	/** One shared abort signal for the render's shell executions. */
	signal?: AbortSignal;
	/** Execution backend override (tests, remote backends). */
	bashOperations?: BashOperations;
	/** This skill's rewrite map; absence = rewrite stage no-ops (A.3.4). */
	rewriteMap?: SkillAgentRewriteMap;
}

export interface RenderedSkillInvocation {
	/** Detached, JSON-serializable invocation metadata (no runtime references). */
	invocation: SkillInvocationMetadata;
	/** Final rendered body, exactly what gets delivered (A.4). */
	body: string;
	diagnostics: ResourceDiagnostic[];
}

/**
 * Render one skill invocation exactly once through the A.3 stage order.
 * Never throws for shell-injection failures (they inline markers); a file
 * read failure propagates to the caller.
 */
export async function renderSkillInvocation(
	skill: LoadedSkill,
	invocation: SkillInvocation,
	context: RenderSkillContext,
): Promise<RenderedSkillInvocation> {
	const diagnostics: ResourceDiagnostic[] = [];

	const content = await readFile(skill.filePath, "utf-8");
	const rawBody = stripFrontmatter(content).trim();

	// Stage 1: agent-name rewrite (A.3.4), on the authored body alone.
	const authoredBody = rewriteAgentNames(rawBody, context.rewriteMap);

	// Stage 2: base-dir preamble (skills only).
	let body = `Base directory for this skill: ${skill.baseDir}\n\n${authoredBody}`;

	// Stage 3: argument substitution (A.3.2).
	body = substituteSkillArguments(body, invocation.rawArgs, parseDeclaredArgumentNames(skill.frontmatter.arguments));

	// Stage 4: PI_* / CLAUDE_* variable substitution (A.8).
	body = substituteSkillVariables(body, buildSkillSubstitutionMap(invocation, { ...context, diagnostics }));

	// Stage 5: shell injection (A.3.5). Injection always carries the rendering
	// skill's OWN values (A.8), independent of any turn-scoped bash env.
	body = await injectShellCommands(body, {
		cwd: context.cwd,
		env: () => buildSkillExecutionEnv(invocation, context),
		shell: invocation.shell,
		activeToolNames: context.activeToolNames,
		disallowedTools: invocation.disallowedTools,
		settings: context.shellSettings,
		signal: context.signal,
		operations: context.bashOperations,
		shellPath: context.shellPath,
		diagnostics,
	});

	// Stage 6: CC tool-name steering note, only when such names are present.
	const note = buildCcToolNote(body);
	if (note !== undefined) {
		body = `${body}\n\n${note}`;
	}

	return { invocation: toInvocationMetadata(invocation), body, diagnostics };
}

/**
 * A.3.4 agent-name rewrite: only names in the skill's own rewrite map with
 * `collided: true`; case-insensitive, lexical (complete identifier token, not
 * part of a qualified `skill:agent` form). Applies throughout the authored
 * body, including code blocks; the frontmatter is already stripped at this
 * stage and `references/` files are never read here.
 *
 * Runs first (A.3.1), so it sees only what the skill author wrote: the base-dir
 * preamble, substituted arguments, and substituted variable values are all
 * introduced later and are never scanned for agent names. A `$`-prefixed token
 * is excluded too — `$reviewer` is an A.3.2 placeholder, not an agent mention,
 * and rewriting it would stop the placeholder from expanding.
 */
export function rewriteAgentNames(body: string, rewriteMap: SkillAgentRewriteMap | undefined): string {
	if (!rewriteMap) {
		return body;
	}
	let result = body;
	for (const [bareName, entry] of Object.entries(rewriteMap)) {
		if (!entry.collided) {
			continue;
		}
		const escaped = bareName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const pattern = new RegExp(`(?<![A-Za-z0-9_:$-])${escaped}(?![A-Za-z0-9_:-])`, "gi");
		result = result.replace(pattern, entry.qualified);
	}
	return result;
}
