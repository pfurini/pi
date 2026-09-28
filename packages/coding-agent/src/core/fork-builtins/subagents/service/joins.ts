/**
 * Fork-owned: how background completions join into one notification (pi-subagents
 * `src/group-join.ts` and `src/index.ts` at 79a7c42). `SpawnBatch` collects the `smart` and `group`
 * spawns of one turn: two or more spawned within 100 ms of each other form a group. `GroupJoin` holds
 * a group's completions until every member finished, or delivers the finished ones at its timeout and
 * gives the stragglers a shorter one.
 */
import { isTerminal, type SubagentRecord } from "./records.ts";

/** Background spawns this close together count as one turn's batch for `smart` joins. */
const BATCH_WINDOW_MS = 100;

interface Group {
	members: Set<string>;
	finished: Map<string, SubagentRecord>;
	timer?: ReturnType<typeof setTimeout>;
	straggling: boolean;
}

/** Holds the completions of grouped agents until all finish, or delivers the finished ones at the timeout. */
export class GroupJoin {
	private readonly groups = new Map<string, Group>();
	private readonly memberOf = new Map<string, string>();
	private readonly deliver: (records: SubagentRecord[]) => void;
	private readonly timeoutMs: number;
	private readonly stragglerTimeoutMs: number;

	constructor(deliver: (records: SubagentRecord[]) => void, timeoutMs: number, stragglerTimeoutMs: number) {
		this.deliver = deliver;
		this.timeoutMs = timeoutMs;
		this.stragglerTimeoutMs = stragglerTimeoutMs;
	}

	register(groupId: string, ids: readonly string[]): void {
		this.groups.set(groupId, { members: new Set(ids), finished: new Map(), straggling: false });
		for (const id of ids) this.memberOf.set(id, groupId);
	}

	/** `pass`: not grouped, notify alone. `held`: waiting for the group. `delivered`: this completion closed the group. */
	complete(record: SubagentRecord): "pass" | "held" | "delivered" {
		const groupId = this.memberOf.get(record.id);
		const group = groupId === undefined ? undefined : this.groups.get(groupId);
		if (!groupId || !group) return "pass";
		group.finished.set(record.id, record);
		if (group.finished.size >= group.members.size) {
			clearTimeout(group.timer);
			this.deliver([...group.finished.values()]);
			for (const id of group.members) this.memberOf.delete(id);
			this.groups.delete(groupId);
			return "delivered";
		}
		if (!group.timer) {
			group.timer = setTimeout(
				() => this.timeout(group),
				group.straggling ? this.stragglerTimeoutMs : this.timeoutMs,
			);
			group.timer.unref?.();
		}
		return "held";
	}

	private timeout(group: Group): void {
		group.timer = undefined;
		for (const id of group.finished.keys()) {
			this.memberOf.delete(id);
			group.members.delete(id);
		}
		const finished = [...group.finished.values()];
		group.finished.clear();
		group.straggling = true;
		this.deliver(finished);
	}

	dispose(): void {
		for (const group of this.groups.values()) clearTimeout(group.timer);
		this.groups.clear();
		this.memberOf.clear();
	}
}

/**
 * The open batch of `smart` and `group` spawns. Each spawn re-arms the 100 ms window. When the window
 * closes, two or more members that still exist become a group of `groups`; a single member notifies
 * alone through `notify` if it already finished. A member that finishes while the window is open
 * waits for it to close (`holds`).
 */
export class SpawnBatch {
	private ids: string[] = [];
	private timer?: ReturnType<typeof setTimeout>;
	private count = 0;
	private readonly groups: GroupJoin;
	private readonly lookup: (id: string) => SubagentRecord | undefined;
	private readonly notify: (record: SubagentRecord) => void;

	constructor(
		groups: GroupJoin,
		lookup: (id: string) => SubagentRecord | undefined,
		notify: (record: SubagentRecord) => void,
	) {
		this.groups = groups;
		this.lookup = lookup;
		this.notify = notify;
	}

	add(record: SubagentRecord): void {
		this.ids.push(record.id);
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.close(), BATCH_WINDOW_MS);
		this.timer.unref?.();
	}

	/** Whether the open batch holds the record, so its completion waits for the window to close. */
	holds(record: SubagentRecord): boolean {
		return this.ids.includes(record.id);
	}

	/** Two or more `smart` or `group` agents spawned in one window share a notification. */
	private close(): void {
		const ids = this.ids;
		this.ids = [];
		this.timer = undefined;
		const members = ids.map((id) => this.lookup(id)).filter((record) => record !== undefined);
		if (members.length >= 2) {
			this.groups.register(`batch-${++this.count}`, ids);
			for (const record of members) {
				if (isTerminal(record) && !record.run && !record.resultConsumed) this.groups.complete(record);
			}
			return;
		}
		for (const record of members) {
			if (isTerminal(record) && !record.run) this.notify(record);
		}
	}

	dispose(): void {
		clearTimeout(this.timer);
	}
}
