/**
 * ADR-0006 tool-name redirect map: the pure default map plus the
 * canonicalization helper every consumer shares. C1b's shell-injection gate
 * canonicalizes `disallowed-tools` entries through this map before matching
 * (so `Bash` blocks the registered `bash` capability and `Task` blocks
 * `Agent`); C1d merges user settings over these defaults for the unknown-tool
 * redirect site.
 */

/**
 * A.8 redirect-map defaults. Keys are CC-side spellings, values are the Pi
 * tool name they resolve to. An entry is only *active* when its target is
 * registered; that check lives with the consumers, not in this map.
 */
export const DEFAULT_TOOL_REDIRECTS: Readonly<Record<string, string>> = {
	AskUserQuestion: "ask_user_question",
	Task: "Agent",
	Glob: "find",
	Skill: "skill",
	SlashCommand: "slash_command",
	Read: "read",
	Grep: "grep",
	Edit: "edit",
	Write: "write",
	Bash: "bash",
	Ls: "ls",
};

/**
 * Look up a declared tool name in the redirect map. Matching is exact first,
 * then case-insensitive over map keys.
 */
function findToolRedirect(name: string, redirects: Readonly<Record<string, string>>): string | undefined {
	const direct = redirects[name];
	if (direct !== undefined) {
		return direct;
	}
	const lowered = name.toLowerCase();
	for (const [key, target] of Object.entries(redirects)) {
		if (key.toLowerCase() === lowered) {
			return target;
		}
	}
	return undefined;
}

/**
 * Resolve a declared tool name to its canonical Pi name through the redirect
 * map. Names with no mapping pass through unchanged (comparison against the
 * active tool set is itself case-insensitive at the call site).
 */
export function canonicalizeToolName(
	name: string,
	redirects: Readonly<Record<string, string>> = DEFAULT_TOOL_REDIRECTS,
): string {
	return findToolRedirect(name, redirects) ?? name;
}

/** Options for the C1d unknown-tool redirect policy (ADR-0006). */
export interface ToolRedirectOptions {
	/** The tool name the model attempted to call. */
	attemptedName: string;
	/** Names of tools currently registered and active in the agent context. */
	registeredToolNames: string[];
	/** User/project settings map merged over {@link DEFAULT_TOOL_REDIRECTS} (per-key override wins). */
	redirects?: Readonly<Record<string, string>>;
	/** `disableToolRedirects` setting: skip both the mapped target and the nearest-name suggestion. */
	disabled?: boolean;
}

/** Corrective wording for a mapped redirect whose target is currently active. */
export function formatToolRedirectMessage(attemptedName: string, target: string): string {
	return `Tool ${attemptedName} is not available — use ${target} instead`;
}

/** Corrective wording for the nearest-name fallback (no active mapped target). */
export function formatToolSuggestionMessage(attemptedName: string, candidate: string): string {
	return `Tool ${attemptedName} not found — did you mean ${candidate}?`;
}

/** Case-insensitive Levenshtein distance (callers lowercase both inputs). */
function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[b.length];
}

/**
 * Resolve corrective text for an unknown tool call. Order (ADR-0006):
 *
 * 1. `disabled` returns undefined (the loop keeps the plain not-found error).
 * 2. The merged map is matched by exact key first, then case-insensitively
 *    (same key semantics as {@link canonicalizeToolName}); the mapped target is
 *    suggested only when it is currently registered and active.
 * 3. Otherwise the nearest registered name within case-insensitive edit
 *    distance 2 is suggested, with a deterministic tie break (smaller
 *    distance, then name ascending).
 * 4. Otherwise undefined.
 *
 * The result is corrective prose only; the agent loop never executes the
 * target, so argument-schema differences (Glob → find) cannot leak.
 */
export function resolveToolRedirect(options: ToolRedirectOptions): string | undefined {
	if (options.disabled) {
		return undefined;
	}
	const { attemptedName, registeredToolNames } = options;
	const registered = new Set(registeredToolNames);
	const redirects: Record<string, string> = { ...DEFAULT_TOOL_REDIRECTS, ...options.redirects };

	const mapped = findToolRedirect(attemptedName, redirects);
	if (mapped !== undefined && registered.has(mapped)) {
		return formatToolRedirectMessage(attemptedName, mapped);
	}

	let best: { name: string; distance: number } | undefined;
	for (const name of registeredToolNames) {
		const distance = editDistance(attemptedName.toLowerCase(), name.toLowerCase());
		if (distance > 2) {
			continue;
		}
		if (!best || distance < best.distance || (distance === best.distance && name < best.name)) {
			best = { name, distance };
		}
	}
	return best ? formatToolSuggestionMessage(attemptedName, best.name) : undefined;
}
