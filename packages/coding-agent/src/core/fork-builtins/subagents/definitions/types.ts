/**
 * Fork-owned: the agent definition shared by the subagent loader, registry, runner and tools.
 * pi-subagents' `AgentConfig` (`src/types.ts` at 79a7c42) is the behavior reference.
 */
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

/** Separates a skill's listing name from its agent name (`skill:agent`). No agent file may use it (ADR-0008). */
export const QUALIFIED_SEPARATOR = ":";

/** Persistent memory scope of an agent. */
export type MemoryScope = "user" | "project" | "local";

/** Where a definition came from. Project and global sources name their file; a skill source also names its skill. */
export type AgentSource =
	| { kind: "default" }
	| { kind: "project"; sourcePath: string }
	| { kind: "global"; sourcePath: string }
	| { kind: "skill"; sourcePath: string; skillId: string };

export interface AgentDefinition {
	/** The agent type that `subagent_type` names. */
	name: string;
	/** UI label; the name stands in when absent. */
	displayName?: string;
	color?: string;
	description: string;
	/**
	 * `tools:` as written: Pi tool names, fork base tool names, `*` for every Pi built-in, and
	 * `ext:<extension>` or `ext:<extension>/<tool>` selectors. Absent means every Pi built-in.
	 */
	tools?: string[];
	/** Tools removed even when `tools:` or an extension provides them. */
	disallowedTools?: string[];
	/** `true` loads every extension, `false` none, a list only the named ones. */
	extensions: boolean | string[];
	/** Extension names dropped after `extensions:`; the exclusion wins. */
	excludeExtensions?: string[];
	/** `true` inherits the parent's skills, `false` none, a list preloads only the named ones. */
	skills: boolean | string[];
	model?: string;
	thinking?: ModelThinkingLevel;
	/** Turn limit before the wrap-up; 0 or absent means unlimited. */
	maxTurns?: number;
	persistSession?: boolean;
	outputTranscript?: boolean;
	sessionDir?: string;
	/** Nested delegation: absent means none, `all` any enabled agent, a list only those types. */
	allowedSubagents?: "all" | string[];
	systemPrompt: string;
	promptMode: "replace" | "append";
	inheritContext?: boolean;
	runInBackground?: boolean;
	isolated?: boolean;
	memory?: MemoryScope;
	/** `off` refuses a worktree even when the caller asks for one; frontmatter outranks tool parameters. */
	isolation?: "worktree" | "off";
	enabled: boolean;
	/** Soft scoping: absent from listings, still spawnable by exact name. Only skill agents set it. */
	hidden: boolean;
	source: AgentSource;
}
