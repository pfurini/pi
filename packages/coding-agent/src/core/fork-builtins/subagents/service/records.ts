/**
 * Fork-owned: subagent records, their handles and the tombstones evicted records leave behind
 * (pi-subagents `src/types.ts`, `src/mention.ts` and `src/agent-manager.ts` at 79a7c42).
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
	/** Occupies the background pool and notifies on completion. Undefined for a detached spawn that did not say. */
	isBackground?: boolean;
	/** A caller awaits this agent inline; occupies the foreground pool. */
	readonly blocking: boolean;
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

/** What an evicted persisted agent leaves, so phase 3's mentions can reopen its session by handle. */
export interface Tombstone {
	handle: string;
	alias?: string;
	id: string;
	type: string;
	description: string;
	sessionFile: string;
	completedAt: number;
}

/** At most 100 tombstones, keyed by handle; the oldest completion leaves first. */
export class TombstoneStore {
	static readonly LIMIT = 100;
	private readonly entries = new Map<string, Tombstone>();

	add(entry: Tombstone): void {
		this.entries.set(entry.handle, entry);
		while (this.entries.size > TombstoneStore.LIMIT) {
			const oldest = [...this.entries.values()].reduce((a, b) => (a.completedAt <= b.completedAt ? a : b));
			this.entries.delete(oldest.handle);
		}
	}

	/** Newest first. */
	list(): Tombstone[] {
		return [...this.entries.values()].sort((a, b) => b.completedAt - a.completedAt);
	}

	/** Names the tombstones still hold, so a new agent never takes one. */
	names(): string[] {
		return [...this.entries.values()].flatMap((entry) =>
			entry.alias ? [entry.handle, entry.alias] : [entry.handle],
		);
	}
}
