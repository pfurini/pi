/**
 * Fork-owned: subagent records and their handles (pi-subagents `src/types.ts`, `src/mention.ts` and
 * `src/agent-manager.ts` at 79a7c42). `retention.ts` holds the tombstones evicted records leave behind.
 */
import type { Usage } from "@earendil-works/pi-ai";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { AgentDefinition } from "../definitions/types.ts";
import type { Child, ChildActivity } from "../runner/run.ts";
import type { Worktree, WorktreeOutcome } from "../runner/worktree.ts";
import type { InvocationConfig } from "../settings/models.ts";
import type { JoinMode } from "../settings/settings.ts";

export type SubagentStatus = "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
export type TerminalStatus = Exclude<SubagentStatus, "queued" | "running">;

/**
 * How a run was spawned. An `Agent` call runs `foreground`, where its caller awaits the result inline
 * and it takes a foreground slot, or `background`, where it takes a background slot and notifies on
 * completion. A `detached` spawn (RPC, skill-fork) blocks nobody and takes no slot;
 * `detached-background` takes a background slot and notifies, but joins no batch.
 */
export type SpawnMode = "foreground" | "background" | "detached" | "detached-background";

/** Whether a run of this mode takes a background slot and notifies on completion. */
export function inBackground(mode: SpawnMode): boolean {
	return mode === "background" || mode === "detached-background";
}

export interface SubagentRecord {
	readonly id: string;
	/** The registry key the requested type resolved to. */
	readonly type: string;
	readonly definition: AgentDefinition;
	/** The typeable name of a top-level agent: its type, numbered on collision (`explore-2`). */
	readonly handle?: string;
	/** A second name from the spawn's `name`, from the same namespace as handles. */
	readonly alias?: string;
	readonly description: string;
	readonly prompt: string;
	status: SubagentStatus;
	/** The last run's final text; the partial answer when it stopped early. */
	result?: string;
	error?: string;
	/** Usage over every run of this agent, its nested children's included. */
	readonly usage: Usage;
	toolUses: number;
	turns: number;
	compactionCount: number;
	startedAt: number;
	completedAt?: number;
	/** Nesting depth: a top-level agent is 1. */
	readonly depth: number;
	/** The agent that spawned this one; absent for the session's own agents. */
	readonly parent?: SubagentRecord;
	/** How the current run was spawned: which pool it takes and whether it notifies on completion. */
	mode: SpawnMode;
	/** The model saw the result, so no notification is due. */
	resultConsumed: boolean;
	/** Set for a background run: how its notification joins others. */
	joinMode?: JoinMode;
	/** The tool call the current run answers; a resume replaces it. */
	toolCallId?: string;
	readonly invocation: InvocationConfig;
	readonly model?: Model<Api>;
	/** The working directory the child runs in. */
	readonly cwd: string;
	/** The requested type when it resolved to the fallback agent instead. */
	readonly fellBackFrom?: string;
	sessionFile?: string;
	transcriptPath?: string;
	/** The worktree an `isolation: "worktree"` run works in, from its start. */
	worktree?: Worktree;
	/** Settles once the run's worktree exists, with the error when it could not be created. */
	worktreeStart?: Promise<Error | undefined>;
	/** What happened to the worktree when the run ended. */
	worktreeOutcome?: WorktreeOutcome;
	/** Tool calls, scoping warnings and extension errors, in order. */
	readonly activity: ChildActivity[];
	/** The live child session, until the record is evicted or the owner ends. */
	child?: Child;
	/** @internal Aborts the current run. */
	abort?: AbortController;
	/** @internal Removes the caller's abort listener; called when the run ends. */
	detachSignal?: () => void;
	/** @internal Steers that arrived before the child existed. */
	pendingSteers: string[];
	/** @internal Called once when the current run ends. */
	readonly waiters: Set<() => void>;
	/** @internal The owner's end already reported this run's end. */
	endReported?: boolean;
	/** @internal The current run; never rejects. */
	run?: Promise<void>;
}

export function isTerminal(record: SubagentRecord): boolean {
	return record.status !== "queued" && record.status !== "running";
}

const MAX_HANDLE_LENGTH = 64;
/** `main` addresses the main model in a mention (phase 3), so no agent may hold it. */
const RESERVED_HANDLES = new Set(["main"]);

/** The handle a type or name slugs to. */
export function handleBase(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_HANDLE_LENGTH)
		.replace(/-+$/, "");
	return slug || "agent";
}

/** `base`, else `base-2`, `base-3` and so on: the first form neither taken nor reserved. */
export function assignHandle(base: string, taken: ReadonlySet<string>): string {
	let candidate = base;
	for (let n = 2; taken.has(candidate) || RESERVED_HANDLES.has(candidate); n++) candidate = `${base}-${n}`;
	return candidate;
}
