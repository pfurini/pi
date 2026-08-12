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
 * Resolve a declared tool name to its canonical Pi name through the redirect
 * map. Matching is exact first, then case-insensitive over map keys; names
 * with no mapping pass through unchanged (comparison against the active tool
 * set is itself case-insensitive at the call site).
 */
export function canonicalizeToolName(
	name: string,
	redirects: Readonly<Record<string, string>> = DEFAULT_TOOL_REDIRECTS,
): string {
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
	return name;
}
