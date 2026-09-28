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
	| { readonly kind: "default" }
	| { readonly kind: "project"; readonly sourcePath: string }
	| { readonly kind: "global"; readonly sourcePath: string }
	| { readonly kind: "skill"; readonly sourcePath: string; readonly skillId: string };

export interface AgentDefinition {
	/** The agent type that `subagent_type` names. */
	readonly name: string;
	/** UI label; the name stands in when absent. */
	readonly displayName?: string;
	readonly color?: string;
	readonly description: string;
	/**
	 * `tools:` as written: Pi tool names, fork base tool names, `*` for every Pi built-in, and
	 * `ext:<extension>` or `ext:<extension>/<tool>` selectors. Absent means every Pi built-in.
	 */
	readonly tools?: readonly string[];
	/** Tools removed even when `tools:` or an extension provides them. */
	readonly disallowedTools?: readonly string[];
	/** `true` loads every extension, `false` none, a list only the named ones. */
	readonly extensions: boolean | readonly string[];
	/** Extension names dropped after `extensions:`; the exclusion wins. */
	readonly excludeExtensions?: readonly string[];
	/** `true` inherits the parent's skills, `false` none, a list preloads only the named ones. */
	readonly skills: boolean | readonly string[];
	readonly model?: string;
	readonly thinking?: ModelThinkingLevel;
	/** Turn limit before the wrap-up; 0 or absent means unlimited. */
	readonly maxTurns?: number;
	readonly persistSession?: boolean;
	readonly outputTranscript?: boolean;
	readonly sessionDir?: string;
	/** Nested delegation: absent means none, `all` any enabled agent, a list only those types. */
	readonly allowedSubagents?: "all" | readonly string[];
	readonly systemPrompt: string;
	readonly promptMode: "replace" | "append";
	readonly inheritContext?: boolean;
	readonly runInBackground?: boolean;
	readonly isolated?: boolean;
	readonly memory?: MemoryScope;
	/** `off` refuses a worktree even when the caller asks for one; frontmatter outranks tool parameters. */
	readonly isolation?: "worktree" | "off";
	readonly enabled: boolean;
	/** Soft scoping: absent from listings, still spawnable by exact name. Only skill agents set it. */
	readonly hidden: boolean;
	readonly source: AgentSource;
}
