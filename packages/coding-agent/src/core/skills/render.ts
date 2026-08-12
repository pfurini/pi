/**
 * A.3 render pipeline orchestration (ADR-0004): one async renderer with
 * deterministic stage ordering, consumed by every invocation path. Stage
 * order (A.3.1, single pass: later stages never re-scan text produced by
 * earlier stages for earlier-stage syntax):
 *
 * 1. Base-dir preamble (`Base directory for this skill: <dir>`).
 * 2. Argument substitution (A.3.2, arguments.ts).
 * 3. Variable substitution: `${PI_*}` plus `${CLAUDE_*}` aliases when enabled
 *    (A.8, interop.ts).
 * 4. `@path` references made absolute against the skill baseDir (no inlining
 *    for skills; the model reads them).
 * 5. Agent-name rewrite (A.3.4; no-op without a Workstream 2 rewrite map).
 * 6. Shell injection (A.3.5, shell-injection.ts).
 * 7. Conditional CC tool-name steering note (ADR-0006 layer 3).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stripFrontmatter } from "../../utils/frontmatter.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { BashOperations } from "../tools/bash.ts";
import { parseDeclaredArgumentNames, substituteSkillArguments } from "./arguments.ts";
import { scanFenceBlocks } from "./fences.ts";
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

	// Stage 1: base-dir preamble (skills only).
	let body = `Base directory for this skill: ${skill.baseDir}\n\n${rawBody}`;

	// Stage 2: argument substitution (A.3.2).
	body = substituteSkillArguments(
		body,
		invocation.rawArgs,
		parseDeclaredArgumentNames(skill.frontmatter.arguments),
	).text;

	// Stage 3: PI_* / CLAUDE_* variable substitution (A.8).
	body = substituteSkillVariables(body, buildSkillSubstitutionMap(invocation, { ...context, diagnostics }));

	// Stage 4: `@path` references become absolute against the skill baseDir.
	body = absolutizeSkillPaths(body, skill.baseDir);

	// Stage 5: agent-name rewrite (A.3.4), including code blocks.
	body = rewriteAgentNames(body, context.rewriteMap);

	// Stage 6: shell injection (A.3.5). Injection always carries the rendering
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

	// Stage 7: CC tool-name steering note, only when such names are present.
	const note = buildCcToolNote(body);
	if (note !== undefined) {
		body = `${body}\n\n${note}`;
	}

	return { invocation: toInvocationMetadata(invocation), body, diagnostics };
}

/**
 * A.3.4 agent-name rewrite: only names in the skill's own rewrite map with
 * `collided: true`; case-insensitive, lexical (complete identifier token, not
 * part of a qualified `skill:agent` form). Applies throughout the body,
 * including code blocks; the frontmatter is already stripped at this stage
 * and `references/` files are never read here.
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
		const pattern = new RegExp(`(?<![A-Za-z0-9_:-])${escaped}(?![A-Za-z0-9_:-])`, "gi");
		result = result.replace(pattern, entry.qualified);
	}
	return result;
}

/**
 * Make skill-relative `@path` references absolute (no inlining, A.3.1).
 * Recognition: `@` + a run of non-whitespace characters, preceded by
 * start-of-line or whitespace, outside fenced code blocks and inline code
 * spans; `\@path` escapes (backslash removed). Already-absolute tokens and
 * tokens without a path separator (prose mentions like `@user`) are left
 * untouched.
 */
export function absolutizeSkillPaths(body: string, baseDir: string): string {
	const lines = body.split("\n");
	// Fenced lines (opener through closer, inclusive) stay verbatim; the shared
	// scanner (fences.ts) keeps this stage consistent with shell injection's
	// fence recognition, including unterminated blocks running to end of input.
	const fencedLines = new Set<number>();
	for (const block of scanFenceBlocks(lines)) {
		const lastLine = block.closeLine === -1 ? lines.length - 1 : block.closeLine;
		for (let i = block.openLine; i <= lastLine; i++) {
			fencedLines.add(i);
		}
	}
	const out = lines.map((line, index) => (fencedLines.has(index) ? line : absolutizeSkillPathsInLine(line, baseDir)));
	return out.join("\n");
}

function isAbsolutePathToken(token: string): boolean {
	return token.startsWith("/") || token.startsWith("~") || /^[A-Za-z]:[\\/]/.test(token);
}

function absolutizeSkillPathsInLine(line: string, baseDir: string): string {
	let result = "";
	let i = 0;
	while (i < line.length) {
		const char = line[i];
		const atTokenStart = i === 0 || /\s/.test(line[i - 1]);
		if (char === "\\" && line[i + 1] === "@" && atTokenStart) {
			// `\@path` escape: renders a literal `@path`.
			result += "@";
			i += 2;
			continue;
		}
		if (char === "`") {
			// Inline code span: copy verbatim through the closing backtick run.
			const run = line.slice(i).match(/^`+/)?.[0] ?? "`";
			const close = line.indexOf(run, i + run.length);
			if (close === -1) {
				result += line.slice(i);
				break;
			}
			result += line.slice(i, close + run.length);
			i = close + run.length;
			continue;
		}
		if (char === "@" && atTokenStart) {
			const token = line.slice(i + 1).match(/^[^\s]+/)?.[0] ?? "";
			if (token !== "" && !isAbsolutePathToken(token) && (token.includes("/") || token.startsWith("."))) {
				result += resolve(baseDir, token);
			} else {
				result += `@${token}`;
			}
			i += 1 + token.length;
			continue;
		}
		result += char;
		i++;
	}
	return result;
}
