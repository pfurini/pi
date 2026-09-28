/**
 * Fork-owned: how long finished subagent records stay, and the tombstones evicted ones leave
 * (pi-subagents `src/agent-manager.ts:74` and `:1480-1500` at 79a7c42). Running and queued records
 * never leave. A finished record stays 10 minutes, then leaves and its child is torn down. A persisted
 * top-level record leaves a tombstone, so phase 3's mentions can reopen its session by handle.
 */
import { teardownChild } from "../runner/run.ts";
import { isTerminal, type SubagentRecord } from "./records.ts";

const RETENTION_MS = 10 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;

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

/** Sweeps a service's records once a minute, until `dispose()`. */
export class Retention {
	readonly tombstones = new TombstoneStore();
	private readonly records: Map<string, SubagentRecord>;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(records: Map<string, SubagentRecord>) {
		this.records = records;
		this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
		this.timer.unref?.();
	}

	/** Evicts every finished record older than the retention window. */
	sweep(now = Date.now()): void {
		for (const record of [...this.records.values()]) {
			if (!isTerminal(record) || record.run || (record.completedAt ?? now) > now - RETENTION_MS) continue;
			if (record.handle && record.sessionFile && !record.parent) {
				this.tombstones.add({
					handle: record.handle,
					alias: record.alias,
					id: record.id,
					type: record.type,
					description: record.description,
					sessionFile: record.sessionFile,
					completedAt: record.completedAt ?? now,
				});
			}
			this.records.delete(record.id);
			if (record.child) void teardownChild(record.child);
			record.child = undefined;
		}
	}

	dispose(): void {
		clearInterval(this.timer);
	}
}
