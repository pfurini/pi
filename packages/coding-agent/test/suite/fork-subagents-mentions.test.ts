/**
 * Fork-owned: agent mentions (phase 3 plan T1 to T5) on real parent and child sessions. The parent loads
 * the presentation factory through the harness; mention tests bind a fake TUI context and submit
 * prompts as a user would. Old pi-subagents tests at 79a7c42 this covers: agent-mention-wiring,
 * mention-start-notification (see docs/plans/subagents-native-phase3-evidence/old-cases.md).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import { inspectRecord, type SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import subagentsPresentation from "../../src/core/fork-builtins/subagents/ui/index.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { type Behavior, CHILD_START, call, held, router, say, text } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function parent(
	script: Record<string, Behavior[]>,
	subagents: Record<string, unknown> = {},
	parentBehavior?: Behavior,
) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const harness = await createHarness({
		eventBus: createEventBus(),
		extensionFactories: [{ name: "subagents", factory: subagentsPresentation }],
		settings: {
			forkBuiltins: { subagents: { defaultJoinMode: "async", agentMentions: "direct", ...subagents } },
		} as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	writeFileSync(
		join(harness.tempDir, "agents", "worker.md"),
		"---\ndescription: Test worker. It does work.\ntools: read\n---\nYou are a test worker.",
	);
	harness.setResponses(Array.from({ length: 50 }, () => router(script, parentBehavior)));
	return harness;
}

function service(harness: Harness) {
	const subagents = subagentServiceFor(harness.session);
	if (!subagents) throw new Error("no subagent service");
	return subagents;
}

/** What `@name` resolves to, as `live:<id>` or `tombstone:<id>`. */
function target(subagents: SubagentService, name: string): string | undefined {
	const found = subagents.resolveMention(name);
	if (!found) return undefined;
	return found.kind === "live" ? `live:${found.view.id}` : `tombstone:${found.entry.id}`;
}

/** Starts a `worker` agent the way a mention does: detached, in the background. */
function spawnWorker(subagents: SubagentService, prompt: string, name?: string) {
	return subagents.spawn({ type: "worker", prompt, description: prompt, name, mode: "detached-background" });
}

/** Gives a record another handle, so two records share a name as a reopen makes them do. */
function rename(subagents: SubagentService, id: string, handle: string): void {
	const record = inspectRecord(subagents, id);
	if (!record) throw new Error(`no record ${id}`);
	Object.assign(record, { handle });
}

/** Ends every finished record's retention window, so the sweep evicts it. */
function evict(): void {
	vi.advanceTimersByTime(11 * 60_000);
}

describe("handle resolution", () => {
	it("finds a top-level agent by handle, alias or id, whatever the casing, and never a nested one", async () => {
		const gate = held();
		const harness = await parent({ "task one": [gate.behavior] });
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task one", "Scout");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		for (const name of ["worker", "WORKER", "scout", "Scout", view.id]) {
			expect(target(subagents, name)).toBe(`live:${view.id}`);
		}
		const nested = await subagents.spawnOwned(
			view,
			{ type: "worker", prompt: "nested task", description: "nested task" },
			(registry) => {
				const definition = registry.agents.get("worker");
				return definition ? { ok: true, definition } : { ok: false, message: "no worker" };
			},
		);
		expect(nested.parentId).toBe(view.id);
		expect(target(subagents, nested.id)).toBeUndefined();
		gate.release();
	});

	it("prefers a running agent over finished ones by the same name, then the newest one with a session", async () => {
		const gate = held();
		const harness = await parent({ "task a": [say("a done")], "task b": [say("b done")], "task c": [gate.behavior] });
		const subagents = service(harness);
		const a = await spawnWorker(subagents, "task a");
		await vi.waitFor(() => expect(a.status).toBe("completed"), CHILD_START);
		const c = await spawnWorker(subagents, "task c");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const b = await spawnWorker(subagents, "task b");
		await vi.waitFor(() => expect(b.status).toBe("completed"), CHILD_START);
		expect([a.handle, c.handle, b.handle]).toEqual(["worker", "worker-2", "worker-3"]);
		rename(subagents, c.id, "worker");
		rename(subagents, b.id, "worker");
		expect(target(subagents, "worker")).toBe(`live:${c.id}`);
		gate.release();
		await vi.waitFor(() => expect(c.status).toBe("completed"), CHILD_START);
		expect(target(subagents, "worker")).toBe(`live:${b.id}`);
	});

	it("finds a tombstone by handle, alias or id only when no agent with a session or a run holds the name", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ "task old": [say("old done")], "task new": [gate.behavior] });
		const subagents = service(harness);
		const old = await spawnWorker(subagents, "task old", "Keeper");
		await vi.waitFor(() => expect(old.status).toBe("completed"), CHILD_START);
		evict();
		expect(subagents.list()).toEqual([]);
		for (const name of ["worker", "WORKER", "keeper", old.id])
			expect(target(subagents, name)).toBe(`tombstone:${old.id}`);
		const next = await spawnWorker(subagents, "task new");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		rename(subagents, next.id, "worker");
		expect(target(subagents, "worker")).toBe(`live:${next.id}`);
		gate.release();
		await vi.waitFor(() => expect(next.status).toBe("completed"), CHILD_START);
		expect(target(subagents, "worker")).toBe(`live:${next.id}`);
		// A run that never reached a session yields its name to the tombstone.
		const record = inspectRecord(subagents, next.id);
		const child = record?.child;
		if (!record || !child) throw new Error("no child session");
		record.child = undefined;
		expect(target(subagents, "worker")).toBe(`tombstone:${old.id}`);
		record.child = child;
	});

	it("lets steer_subagent and get_subagent_result reach an agent by its handle and its alias", async () => {
		const gate = held();
		const harness = await parent({ "task s": [gate.behavior] });
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task s", "Scout");
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const steered: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "steered") steered.push(event.message);
		});
		expect(text(await call(harness, "steer_subagent", { agent_id: "worker", message: "by handle" }))).not.toContain(
			"Agent not found",
		);
		expect(text(await call(harness, "steer_subagent", { agent_id: "scout", message: "by alias" }))).not.toContain(
			"Agent not found",
		);
		expect(steered).toEqual(["by handle", "by alias"]);
		gate.release();
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		expect(text(await call(harness, "get_subagent_result", { agent_id: "worker" }))).toContain("released");
		expect(text(await call(harness, "get_subagent_result", { agent_id: "scout" }))).toContain("released");
	});

	it("lets the tools report an evicted agent's handle and an unknown one as not found", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task gone": [say("gone done")] });
		const subagents = service(harness);
		const view = await spawnWorker(subagents, "task gone");
		await vi.waitFor(() => expect(view.status).toBe("completed"), CHILD_START);
		evict();
		expect(target(subagents, "worker")).toBe(`tombstone:${view.id}`);
		for (const agentId of ["worker", "nobody"]) {
			expect(text(await call(harness, "steer_subagent", { agent_id: agentId, message: "hi" }))).toContain(
				"Agent not found",
			);
			expect(text(await call(harness, "get_subagent_result", { agent_id: agentId }))).toContain("Agent not found");
		}
	});

	it("frees an evicted agent's names when its tombstone is dropped, so the next agent takes the bare handle", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const harness = await parent({ "task first": [say("first done")], "task second": [say("second done")] });
		const subagents = service(harness);
		const first = await spawnWorker(subagents, "task first", "Keeper");
		await vi.waitFor(() => expect(first.status).toBe("completed"), CHILD_START);
		evict();
		subagents.dropTombstone("worker");
		expect(subagents.listTombstones()).toEqual([]);
		expect(target(subagents, "keeper")).toBeUndefined();
		const second = await spawnWorker(subagents, "task second", "Keeper");
		expect(second).toMatchObject({ handle: "worker", alias: "keeper" });
	});
});
