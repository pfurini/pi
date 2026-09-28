// Fork-owned: subagent service bookkeeping (plan T4): handles, tombstones, group joins,
// notification text and pending usage. The suite test test/suite/fork-subagents-service.test.ts
// runs the service on real sessions. Old pi-subagents tests at 79a7c42 this covers:
// group-join, usage, agent-manager-gc (tombstones), status-note-wiring (status notes).
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupJoin } from "../../../src/core/fork-builtins/subagents/service/joins.ts";
import {
	formatTaskNotification,
	notificationMessage,
} from "../../../src/core/fork-builtins/subagents/service/notifications.ts";
import {
	assignHandle,
	handleBase,
	type SubagentRecord,
} from "../../../src/core/fork-builtins/subagents/service/records.ts";
import { type Tombstone, TombstoneStore } from "../../../src/core/fork-builtins/subagents/service/retention.ts";
import { displayTokens, emptyUsage, PendingUsage } from "../../../src/core/fork-builtins/subagents/usage.ts";

afterEach(() => {
	vi.useRealTimers();
});

function record(id: string, overrides: Partial<SubagentRecord> = {}): SubagentRecord {
	return {
		id,
		type: "Explore",
		description: `task ${id}`,
		status: "completed",
		result: `result ${id}`,
		usage: { ...emptyUsage(), input: 10, output: 5, cacheWrite: 2, cacheRead: 100 },
		toolUses: 3,
		turns: 2,
		startedAt: 1000,
		completedAt: 3500,
		...overrides,
	} as SubagentRecord;
}

describe("handles", () => {
	it("slugs a type and numbers it on collision, never taking main", () => {
		expect(handleBase("Explore")).toBe("explore");
		expect(handleBase("Code Review!")).toBe("code-review");
		expect(handleBase("***")).toBe("agent");
		expect(handleBase("x".repeat(70))).toHaveLength(64);
		expect(assignHandle("explore", new Set())).toBe("explore");
		expect(assignHandle("explore", new Set(["explore", "explore-2"]))).toBe("explore-3");
		expect(assignHandle("main", new Set())).toBe("main-2");
	});
});

describe("tombstones", () => {
	it("keeps at most 100, dropping the oldest completion first, and holds their names", () => {
		const store = new TombstoneStore();
		const entry = (index: number): Tombstone => ({
			handle: `agent-${index}`,
			alias: index === 5 ? "named" : undefined,
			id: `id-${index}`,
			type: "Explore",
			description: "d",
			sessionFile: `/sessions/${index}.jsonl`,
			completedAt: 1000 + index,
		});
		for (let index = 0; index < 100; index++) store.add(entry(index));
		expect(store.list()).toHaveLength(100);
		store.add(entry(100));
		const handles = store.list().map((tombstone) => tombstone.handle);
		expect(handles).toHaveLength(100);
		expect(handles).not.toContain("agent-0");
		expect(handles[0]).toBe("agent-100");
		expect(store.list().find((tombstone) => tombstone.handle === "agent-1")?.sessionFile).toBe("/sessions/1.jsonl");
		expect(store.names()).toContain("named");
	});
});

describe("group join", () => {
	it("delivers a group when all finish, the finished members at the timeout, and stragglers after", () => {
		vi.useFakeTimers();
		const delivered: string[][] = [];
		const groups = new GroupJoin((records) => delivered.push(records.map((entry) => entry.id)), 1000, 500);
		groups.register("g1", ["a", "b"]);
		expect(groups.complete(record("a"))).toBe("held");
		expect(groups.complete(record("b"))).toBe("delivered");
		expect(delivered).toEqual([["a", "b"]]);
		expect(groups.complete(record("solo"))).toBe("pass");

		groups.register("g2", ["c", "d", "e"]);
		expect(groups.complete(record("c"))).toBe("held");
		vi.advanceTimersByTime(999);
		expect(delivered).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(delivered[1]).toEqual(["c"]);
		expect(groups.complete(record("d"))).toBe("held");
		vi.advanceTimersByTime(500);
		expect(delivered[2]).toEqual(["d"]);
		expect(groups.complete(record("e"))).toBe("delivered");
		expect(delivered[3]).toEqual(["e"]);
	});
});

describe("notification text", () => {
	it("formats a task notification with a status note, a truncated preview and usage", () => {
		const text = formatTaskNotification(
			record("r1", {
				status: "stopped",
				result: "x".repeat(20),
				toolCallId: "call-1",
				transcriptPath: "/tmp/r1.output",
			}),
			10,
			false,
		);
		expect(text).toContain("<task-id>r1</task-id>");
		expect(text).toContain("<tool-use-id>call-1</tool-use-id>");
		expect(text).toContain("<output-file>/tmp/r1.output</output-file>");
		expect(text).toContain("<status>Stopped</status>");
		expect(text).toContain("STOPPED BY THE USER");
		expect(text).toContain(
			`<result>${"x".repeat(10)}\n...(truncated, use get_subagent_result for full output)</result>`,
		);
		expect(text).toContain("<total_tokens>17</total_tokens><tool_uses>3</tool_uses><duration_ms>2500</duration_ms>");
		expect(formatTaskNotification(record("r2", { status: "error", error: "boom" }), 100, false)).toContain(
			"<status>Error: boom</status>",
		);
		const priced = record("r3", { usage: { ...emptyUsage(), cost: { ...emptyUsage().cost, total: 0.5 } } });
		expect(formatTaskNotification(priced, 100, true)).toContain("<estimated_cost_usd>0.5000</estimated_cost_usd>");
		expect(formatTaskNotification(priced, 100, false)).not.toContain("estimated_cost_usd");
	});

	it("keeps one agent in the individual shape and several in the group shape", () => {
		const single = notificationMessage([record("a", { transcriptPath: "/tmp/a.output" })], false, false);
		expect(single.customType).toBe("subagent-notification");
		expect(single.content).toContain("Full transcript available at: /tmp/a.output");
		expect(single.details).toMatchObject({ id: "a", resultPreview: "result a", totalTokens: 17 });
		const group = notificationMessage([record("a"), record("b")], true, false);
		expect(group.content.startsWith("Background agent group completed: 2 agent(s) finished (partial")).toBe(true);
		expect(group.details.others?.map((entry) => entry.id)).toEqual(["b"]);
	});

	it("carries each agent's turns and the turn limit its run enforced", () => {
		const limited = record("a", { turns: 4, maxTurns: 8 });
		expect(notificationMessage([limited], false, false).details).toMatchObject({ turnCount: 4, maxTurns: 8 });
		const group = notificationMessage([record("b"), limited], false, false);
		expect(group.details).toMatchObject({ turnCount: 2 });
		expect(group.details.maxTurns).toBeUndefined();
		expect(group.details.others?.[0]).toMatchObject({ turnCount: 4, maxTurns: 8 });
	});
});

describe("pending usage", () => {
	it("hands out each delta once and nothing when nothing was spent", () => {
		const pending = new PendingUsage();
		expect(pending.take()).toBeUndefined();
		pending.add({ ...emptyUsage(), input: 4, cacheRead: 9 });
		pending.add({ ...emptyUsage(), output: 6 });
		expect(pending.take()).toMatchObject({ input: 4, output: 6, cacheRead: 9 });
		expect(pending.take()).toBeUndefined();
		expect(displayTokens({ ...emptyUsage(), input: 1, output: 2, cacheWrite: 3, cacheRead: 50 })).toBe(6);
	});
});
