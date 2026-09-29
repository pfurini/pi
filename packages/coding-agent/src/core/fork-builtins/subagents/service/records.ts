/**
 * Fork-owned: subagent records and their handles (pi-subagents `src/types.ts`, `src/mention.ts` and
 * `src/agent-manager.ts` at 79a7c42). `retention.ts` holds the tombstones evicted records leave behind.
 */
import type { ModelThinkingLevel, Usage } from "@earendil-works/pi-ai";
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

/** A usage total nobody outside the service may change. */
export type ReadonlyUsage = Readonly<Omit<Usage, "cost">> & { readonly cost: Readonly<Usage["cost"]> };

/** What a child session runs with; empty until the child attaches. */
export interface EffectiveInvocation {
	readonly model?: Model<Api>;
	readonly thinking?: ModelThinkingLevel;
}

/**
 * What the service hands out for an agent (F13): its public methods and events carry this read-only
 * view of the record. The internal `SubagentRecord` satisfies it, so a view is the live record seen
 * through a type that neither assigns its fields nor reaches its child session, run or waiters.
 */
export interface SubagentView {
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
	readonly status: SubagentStatus;
	/** The last run's final text; the partial answer when it stopped early. */
	readonly result?: string;
	readonly error?: string;
	/** Usage over every run of this agent, its nested children's included. */
	readonly usage: ReadonlyUsage;
	readonly toolUses: number;
	readonly turns: number;
	readonly compactionCount: number;
	readonly startedAt: number;
	readonly completedAt?: number;
	/** Nesting depth: a top-level agent is 1. */
	readonly depth: number;
	/** The id of the agent that spawned this one; absent for the session's own agents. */
	readonly parentId?: string;
	/** How the current run was spawned: which pool it takes and whether it notifies on completion. */
	readonly mode: SpawnMode;
	/** The model saw the result, so no notification is due. */
	readonly resultConsumed: boolean;
	/** Set for a background run: how its notification joins others. */
	readonly joinMode?: JoinMode;
	/** The tool call the current run answers; a resume replaces it. */
	readonly toolCallId?: string;
	readonly invocation: Readonly<InvocationConfig>;
	/** The model the spawn resolved; absent when the child inherits its parent's. */
	readonly model?: Model<Api>;
	/** The model and thinking level the child session runs with, read when it attaches (P22). */
	readonly effective: EffectiveInvocation;
	/** The turn limit the current run enforces, fixed when it starts; absent before a run and for a run without one. */
	readonly maxTurns?: number;
	/** The working directory the child runs in. */
	readonly cwd: string;
	/** The requested type when it resolved to the fallback agent instead. */
	readonly fellBackFrom?: string;
	readonly sessionFile?: string;
	readonly transcriptPath?: string;
	/** The worktree copy an `isolation: "worktree"` run works in, from its start. */
	readonly worktreePath?: string;
	/** What happened to the worktree when the run ended. */
	readonly worktreeOutcome?: Readonly<WorktreeOutcome>;
	/** Tool calls, scoping warnings and extension errors, in order. */
	readonly activity: readonly ChildActivity[];
}

/** The service's own record of an agent. Only `service/` holds it; everyone else gets a `SubagentView`. */
export interface SubagentRecord extends SubagentView {
	status: SubagentStatus;
	result?: string;
	error?: string;
	readonly usage: Usage;
	toolUses: number;
	turns: number;
	compactionCount: number;
	startedAt: number;
	completedAt?: number;
	/** The agent that spawned this one; absent for the session's own agents. */
	readonly parent?: SubagentRecord;
	mode: SpawnMode;
	resultConsumed: boolean;
	joinMode?: JoinMode;
	toolCallId?: string;
	sessionFile?: string;
	transcriptPath?: string;
	worktreePath?: string;
	worktreeOutcome?: WorktreeOutcome;
	readonly activity: ChildActivity[];
	effective: EffectiveInvocation;
	maxTurns?: number;
	/** The worktree an `isolation: "worktree"` run works in, from its start. */
	worktree?: Worktree;
	/** Settles once the run's worktree exists, with the error when it could not be created. */
	worktreeStart?: Promise<Error | undefined>;
	/** The live child session, until the record is evicted or the owner ends. */
	child?: Child;
	/** Aborts the current run. */
	abort?: AbortController;
	/** Removes the caller's abort listener; called when the run ends. */
	detachSignal?: () => void;
	/** Steers that arrived before the child existed. */
	pendingSteers: string[];
	/** The session file a mention reopens from a tombstone; the first start passes it to the runner. */
	reopenFrom?: string;
	/** Called once when the current run ends. */
	readonly waiters: Set<() => void>;
	/** The owner's end already reported this run's end. */
	endReported?: boolean;
	/** The current run; never rejects. */
	run?: Promise<void>;
}

export function isTerminal(record: Pick<SubagentView, "status">): boolean {
	return record.status !== "queued" && record.status !== "running";
}

const MAX_HANDLE_LENGTH = 64;
/** `main` addresses the main model in a mention (phase 3), so no agent may hold it. */
const RESERVED_HANDLES = new Set(["main"]);

/** Whether a mention's handle names the main conversation, whatever its casing. */
export function isReservedHandle(handle: string): boolean {
	return RESERVED_HANDLES.has(handle.toLowerCase());
}

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
