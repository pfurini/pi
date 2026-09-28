/**
 * Fork-owned: the subagent service's two concurrency pools and their queue (pi-subagents
 * `src/agent-manager.ts:100-158` at 79a7c42). Only top-level records occupy pool slots. The
 * background pool (`maxConcurrent`) counts every background run, detached ones included; the
 * foreground pool (`maxConcurrentForeground`) counts only spawns a caller awaits inline. A limit of
 * 0 means no limit. A run whose pool is full waits in the queue, which starts runs in arrival order
 * as slots free; a run whose pool is still full never holds back a later run of the other pool.
 */
import type { SubagentSettings } from "../settings/settings.ts";
import { inBackground, type SubagentRecord } from "./records.ts";

export type Pool = "background" | "foreground";

type PoolLimits = Pick<SubagentSettings, "maxConcurrent" | "maxConcurrentForeground">;

interface QueueEntry {
	record: SubagentRecord;
	pool: Pool;
	start: () => void;
}

export class SpawnQueue {
	/** The limits in force now; read at every check, so a settings change applies to the next start. */
	private readonly limits: () => PoolLimits;
	private readonly running: Record<Pool, number> = { background: 0, foreground: 0 };
	private entries: QueueEntry[] = [];

	constructor(limits: () => PoolLimits) {
		this.limits = limits;
	}

	/** The pool a run takes, or undefined when it takes none. */
	poolFor(record: SubagentRecord, resuming: boolean): Pool | undefined {
		if (record.parent) return undefined;
		if (inBackground(record.mode)) return "background";
		// A foreground resume reuses its session and takes no foreground slot, as in pi-subagents.
		if (record.mode === "foreground" && !resuming && this.limits().maxConcurrentForeground > 0) return "foreground";
		return undefined;
	}

	/** Whether a run of `pool` may start now; a run that takes no pool always may. */
	hasRoom(pool: Pool | undefined): boolean {
		if (!pool) return true;
		const limits = this.limits();
		const limit = pool === "background" ? limits.maxConcurrent : limits.maxConcurrentForeground;
		return limit === 0 || this.running[pool] < limit;
	}

	/** Holds a run until its pool has room; `drain()` calls `start` then. */
	enqueue(record: SubagentRecord, pool: Pool, start: () => void): void {
		this.entries.push({ record, pool, start });
	}

	/** Counts a started run in its pool. */
	take(pool: Pool | undefined): void {
		if (pool) this.running[pool]++;
	}

	/** Frees the slot of a run that ended. */
	release(pool: Pool | undefined): void {
		if (pool) this.running[pool]--;
	}

	/** Starts every queued run whose pool now has room, in arrival order. */
	drain(): void {
		for (let index = 0; index < this.entries.length; ) {
			const entry = this.entries[index];
			if (!this.hasRoom(entry.pool)) {
				index++;
				continue;
			}
			this.entries.splice(index, 1);
			entry.start();
		}
	}

	/** A queued run's place among the queued runs of its pool, 1 for the next to start; undefined when not queued. */
	position(record: SubagentRecord): number | undefined {
		const entry = this.entries.find((candidate) => candidate.record === record);
		if (!entry) return undefined;
		const samePool = this.entries.filter((candidate) => candidate.pool === entry.pool);
		return samePool.indexOf(entry) + 1;
	}

	/** Drops a queued run that will never start. */
	remove(record: SubagentRecord): void {
		this.entries = this.entries.filter((entry) => entry.record !== record);
	}

	/** Drops every queued run. */
	clear(): void {
		this.entries = [];
	}
}
