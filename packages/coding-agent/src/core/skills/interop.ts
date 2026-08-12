/**
 * A.8 interop: PI_* substitution/environment variables with config-gated
 * CLAUDE_* aliases (ADR-0007), plus the narrow ADR-0006 CC tool-name steering
 * note. Pure computation; the only side effect is the cached one-time project
 * root resolution.
 *
 * Deliberately NOT translated (ADR-0007): `${CLAUDE_PLUGIN_ROOT}`,
 * `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}`, `plugin:skill` names, hooks
 * execution, `Skill(name)` permission rules.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildSpawnShellEnv } from "../../utils/shell.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SkillInvocation } from "./runtime.ts";
import { DEFAULT_TOOL_REDIRECTS } from "./tool-redirects.ts";

/** A.8 variable table, Pi-native spelling first. */
export const SKILL_VARIABLES = [
	{ pi: "PI_SKILL_DIR", claude: "CLAUDE_SKILL_DIR" },
	{ pi: "PI_PROJECT_DIR", claude: "CLAUDE_PROJECT_DIR" },
	{ pi: "PI_SESSION_ID", claude: "CLAUDE_SESSION_ID" },
	{ pi: "PI_EFFORT", claude: "CLAUDE_EFFORT" },
] as const;

export interface SkillInteropContext {
	/** Session cwd (fallback project root). */
	cwd: string;
	/** Current session id. */
	sessionId: string;
	/** Session thinking level, used when the invocation carries no effort. */
	thinkingLevel: string;
	/** `skillInterop` setting: when false, CLAUDE_* aliases are dropped. */
	skillInterop: boolean;
	/** Optional sink for substitution diagnostics (A.2 effort clamp-map note). */
	diagnostics?: ResourceDiagnostic[];
}

const projectRootCache = new Map<string, string>();

/**
 * Resolve the project root for `cwd` (nearest ancestor containing a `.git`
 * entry, which also covers worktrees where `.git` is a file), falling back to
 * `cwd` itself. Resolved once per cwd and cached.
 */
export function resolveProjectRoot(cwd: string): string {
	const start = resolve(cwd);
	const cached = projectRootCache.get(start);
	if (cached !== undefined) {
		return cached;
	}
	let current = start;
	let result = start;
	for (;;) {
		if (existsSync(join(current, ".git"))) {
			result = current;
			break;
		}
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	projectRootCache.set(start, result);
	return result;
}

/**
 * Effective effort for an invocation: the invocation's own `effort` when
 * present (integer budgets clamp-map per A.2: ≤2k→low, ≤8k→medium,
 * ≤24k→high, >24k→xhigh, with a diagnostic noting the mapping), otherwise
 * the session thinking level.
 */
export function resolveEffectiveEffort(
	invocationEffort: string | number | undefined,
	sessionLevel: string,
	diagnostics?: ResourceDiagnostic[],
): string {
	if (typeof invocationEffort === "number") {
		let mapped = "xhigh";
		if (invocationEffort <= 2048) {
			mapped = "low";
		} else if (invocationEffort <= 8192) {
			mapped = "medium";
		} else if (invocationEffort <= 24576) {
			mapped = "high";
		}
		diagnostics?.push({
			type: "warning",
			message: `effort budget ${invocationEffort} clamp-maps to "${mapped}" (A.2)`,
		});
		return mapped;
	}
	if (typeof invocationEffort === "string" && invocationEffort !== "") {
		return invocationEffort;
	}
	return sessionLevel;
}

/** Compute the PI_* values (and CLAUDE_* aliases when enabled) for an invocation. */
export function buildSkillVariableValues(
	invocation: SkillInvocation,
	context: SkillInteropContext,
): Record<string, string> {
	const values: Record<string, string> = {
		PI_SKILL_DIR: invocation.baseDir,
		PI_PROJECT_DIR: resolveProjectRoot(context.cwd),
		PI_SESSION_ID: context.sessionId,
		PI_EFFORT: resolveEffectiveEffort(invocation.effort, context.thinkingLevel, context.diagnostics),
	};
	if (context.skillInterop) {
		for (const { pi, claude } of SKILL_VARIABLES) {
			values[claude] = values[pi];
		}
	}
	return values;
}

/**
 * Text-substitution map for A.3.1 stage 3: `${PI_SKILL_DIR}` etc., with the
 * `${CLAUDE_*}` spellings accepted as aliases when interop is enabled.
 */
export function buildSkillSubstitutionMap(
	invocation: SkillInvocation,
	context: SkillInteropContext,
): Record<string, string> {
	return buildSkillVariableValues(invocation, context);
}

/**
 * Per-execution environment additions (A.8) for processes spawned during
 * skill execution. Callers copy this into a fresh env object per execution;
 * never mutate `process.env` or retain a shared env object.
 */
export function buildSkillEnvironment(invocation: SkillInvocation, context: SkillInteropContext): NodeJS.ProcessEnv {
	return buildSkillVariableValues(invocation, context);
}

/**
 * Full per-execution environment for A.3.5 shell injection: the bash tool's
 * per-execution snapshot (getShellEnv with the session PI_* variables
 * stripped, Appendix B.6) plus this invocation's A.8 skill variables (which
 * re-add PI_SESSION_ID etc. scoped to the skill). Fresh object per call.
 */
export function buildSkillExecutionEnv(invocation: SkillInvocation, context: SkillInteropContext): NodeJS.ProcessEnv {
	return { ...buildSpawnShellEnv(), ...buildSkillEnvironment(invocation, context) };
}

/**
 * Substitute `${VAR}` placeholders from the given map. Only the exact braced
 * spellings present in the map are replaced; unknown `${...}` text is left
 * untouched. Single pass; inserted values are never re-scanned.
 */
export function substituteSkillVariables(body: string, variables: Record<string, string>): string {
	const names = Object.keys(variables);
	if (names.length === 0) {
		return body;
	}
	const pattern = new RegExp(
		names.map((name) => `\\$\\{${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`).join("|"),
		"g",
	);
	return body.replace(pattern, (match) => variables[match.slice(2, -1)] ?? match);
}

// ADR-0006 layer 3: the note fires only for CC tool names whose gap is real
// (non-identity redirects); capitalized→lowercase identities like `Bash`
// resolve through the map and would false-positive on ordinary prose.
const CC_ONLY_TOOL_NAMES = Object.entries(DEFAULT_TOOL_REDIRECTS)
	.filter(([source, target]) => source.toLowerCase() !== target.toLowerCase())
	.map(([source, target]) => ({ source, target }));

/**
 * Detect CC tool names used lexically in a rendered body. Case-sensitive,
 * complete-identifier matching (not preceded or followed by `[A-Za-z0-9_-]`,
 * not part of a qualified `name:tool` form), the same boundary rule as the
 * A.3.4 agent rewrite.
 */
export function detectCcToolNames(body: string): Array<{ source: string; target: string }> {
	const detected: Array<{ source: string; target: string }> = [];
	for (const { source, target } of CC_ONLY_TOOL_NAMES) {
		const pattern = new RegExp(`(?<![A-Za-z0-9_:-])${source}(?![A-Za-z0-9_:-])`);
		if (pattern.test(body)) {
			detected.push({ source, target });
		}
	}
	return detected;
}

/**
 * The narrow ADR-0006 steering note, appended to a rendered skill only when
 * CC tool names were detected in its body. Returns undefined when no note is
 * needed.
 */
export function buildCcToolNote(body: string): string | undefined {
	const detected = detectCcToolNames(body);
	if (detected.length === 0) {
		return undefined;
	}
	const mappings = detected.map(({ source, target }) => `\`${source}\` → \`${target}\``).join(", ");
	return `> Note: this skill references Claude Code tool names. Use the Pi equivalents instead: ${mappings}.`;
}
