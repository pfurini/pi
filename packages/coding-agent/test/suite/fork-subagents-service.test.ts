/**
 * Fork-owned: the per-session subagent service (plan T4) on real parent and child sessions. The
 * faux router in `fork-subagents-fixtures.ts` answers the parent and every child regardless of order.
 * Old pi-subagents tests at 79a7c42 this covers: agent-manager, agent-manager-gc,
 * agent-ended-statuses, background-by-default, background-resume-wiring, foreground-concurrency,
 * foreground-concurrency-wiring, foreground-result-retrieval, group-join, notification-boundary,
 * wait-queued, usage, usage-reporting, e2e/usage-reaches-session-stats, abortable,
 * subagent-error-status-e2e, print-mode, subagents-print-mode-e2e,
 * foreground-concurrency-print-mode-e2e, status-note-wiring, clear-completed-wiring,
 * perf/spawn-invariants.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupSessionResources, type Usage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { NOTIFICATION_CUSTOM_TYPE } from "../../src/core/fork-builtins/subagents/service/notifications.ts";
import type { SubagentView } from "../../src/core/fork-builtins/subagents/service/records.ts";
import {
	inspectRecord,
	SESSION_ENDED_ERROR,
	SubagentService,
	type SubagentServiceOptions,
} from "../../src/core/fork-builtins/subagents/service/service.ts";
import { invocationTags } from "../../src/core/fork-builtins/subagents/ui/format.ts";
import { addUsage, emptyUsage } from "../../src/core/fork-builtins/subagents/usage.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import type { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { type Behavior, CHILD_START, held, notices, router, say, sleep, textOf } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
const services: SubagentService[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const service of services.splice(0)) service.dispose();
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.unstubAllEnvs();
});

async function parent(
	subagents: Record<string, unknown> = {},
	script: Record<string, Behavior[]> = {},
	main?: Behavior,
) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const harness = await createHarness({
		settings: { forkBuiltins: { subagents } } as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	// A plain test agent keeps children fast: no extensions, read only.
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	writeFileSync(
		join(harness.tempDir, "agents", "worker.md"),
		"---\ndescription: test worker\ntools: read\nextensions: false\n---\nYou are a test worker.",
	);
	harness.setResponses(Array.from({ length: 300 }, () => router(script, main)));
	return harness;
}

function service(harness: Harness, options: SubagentServiceOptions = {}): SubagentService {
	const created = new SubagentService(
		harness.session,
		{ agentDir: harness.tempDir, forkBaseToolNames: () => ["ask_user_question", "vcc_recall"] },
		options,
	);
	services.push(created);
	return created;
}

const background = (task: string, extra: Record<string, unknown> = {}) => ({
	type: "worker",
	prompt: task,
	description: task,
	params: { run_in_background: true, ...extra },
});

const foreground = (task: string, extra: Record<string, unknown> = {}) => ({
	type: "worker",
	prompt: task,
	description: task,
	params: { run_in_background: false, ...extra },
});

describe("notifications", () => {
	it("turns a notification that fails to deliver into a warning, never an unhandled rejection", async () => {
		const harness = await parent({ defaultJoinMode: "async" }, { stale: [say("stale result")] });
		vi.spyOn(harness.session, "sendCustomMessage").mockRejectedValue(new Error("stale context"));
		const subagents = service(harness);
		const record = await subagents.spawn(background("stale"));
		await subagents.waitForResult(record.id);
		await vi.waitFor(() => expect(harness.session.sendCustomMessage).toHaveBeenCalled(), CHILD_START);
		await vi.waitFor(() =>
			expect(subagents.warnings).toContain("A subagent notification failed: Error: stale context"),
		);
	});

	it("delivers one notification after the parent settles, and none for a result fetched first", async () => {
		const parentTurns = [
			held(() => fauxAssistantMessage("parent done")),
			held(() => fauxAssistantMessage("parent done")),
		];
		let parentCalls = 0;
		// async: each completion is parked at once, so a consumption is judged at delivery.
		const harness = await parent(
			{ defaultJoinMode: "async" },
			{ alpha: [say("alpha result")], beta: [say("beta result")] },
			(context, options) => {
				parentCalls++;
				if (parentCalls === 1) return parentTurns[0].behavior(context, options);
				if (parentCalls === 3) return parentTurns[1].behavior(context, options);
				return fauxAssistantMessage("noted");
			},
		);
		const parentTurn = parentTurns[0];
		const subagents = service(harness);
		const busy = harness.session.prompt("parent work");
		await vi.waitFor(() => expect(parentTurn.requests()).toBe(1), CHILD_START);
		const alpha = await subagents.spawn(background("alpha"));
		await subagents.waitForResult(alpha.id);
		await sleep(300);
		expect(notices(harness.session)).toEqual([]);
		parentTurn.release();
		await busy;
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1));
		expect(notices(harness.session)[0]).toContain(`<task-id>${alpha.id}</task-id>`);
		expect(notices(harness.session)[0]).toContain("alpha result");

		const secondTurn = harness.session.prompt("more parent work");
		await vi.waitFor(() => expect(parentCalls).toBe(3));
		const beta = await subagents.spawn(background("beta"));
		await subagents.waitForResult(beta.id);
		expect(subagents.consume(beta.id)).toBe(true);
		parentTurns[1].release();
		await secondTurn;
		await sleep(300);
		expect(notices(harness.session)).toHaveLength(1);
		expect(beta.resultConsumed).toBe(true);
	});

	it("notifies each agent under async, and one notification holding both under group", async () => {
		const late = held(() => fauxAssistantMessage("late result"));
		const harness = await parent(
			{ defaultJoinMode: "async" },
			{ quick: [say("quick result")], late: [late.behavior] },
		);
		const subagents = service(harness);
		const quick = await subagents.spawn(background("quick"));
		const slow = await subagents.spawn(background("late"));
		await subagents.waitForResult(quick.id);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1));
		late.release();
		await subagents.waitForResult(slow.id);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(2));

		const grouped = held(() => fauxAssistantMessage("second result"));
		const other = await parent(
			{ defaultJoinMode: "group" },
			{ first: [say("first result")], second: [grouped.behavior] },
		);
		const joined = service(other);
		const first = await joined.spawn(background("first"));
		const second = await joined.spawn(background("second"));
		await joined.waitForResult(first.id);
		await sleep(400);
		expect(notices(other.session)).toEqual([]);
		grouped.release();
		await joined.waitForResult(second.id);
		await vi.waitFor(() => expect(notices(other.session)).toHaveLength(1));
		expect(notices(other.session)[0]).toContain(first.id);
		expect(notices(other.session)[0]).toContain(second.id);
	});

	it("groups smart agents spawned together, keeps a later one apart, and delivers a late group at its timeout", async () => {
		const harness = await parent({}, { one: [say("one")], two: [say("two")], three: [say("three")] });
		const subagents = service(harness);
		const one = await subagents.spawn(background("one"));
		const two = await subagents.spawn(background("two"));
		await Promise.all([subagents.waitForResult(one.id), subagents.waitForResult(two.id)]);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1));
		expect(notices(harness.session)[0]).toContain("2 agent(s) finished");
		const three = await subagents.spawn(background("three"));
		await subagents.waitForResult(three.id);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(2));
		expect(notices(harness.session)[1]).toContain(three.id);
		expect(notices(harness.session)[1]).not.toContain(one.id);

		const straggler = held(() => fauxAssistantMessage("straggler result"));
		const other = await parent({}, { prompt: [say("prompt result")], straggler: [straggler.behavior] });
		const timed = service(other, { groupTimeoutMs: 300, stragglerTimeoutMs: 300 });
		const fast = await timed.spawn(background("prompt"));
		const slow = await timed.spawn(background("straggler"));
		await timed.waitForResult(fast.id);
		await vi.waitFor(() => expect(notices(other.session)).toHaveLength(1));
		expect(notices(other.session)[0]).toContain(fast.id);
		expect(notices(other.session)[0]).not.toContain(slow.id);
		straggler.release();
		await timed.waitForResult(slow.id);
		await vi.waitFor(() => expect(notices(other.session)).toHaveLength(2));
		expect(notices(other.session)[1]).toContain(slow.id);
	});
});

describe("the background completion notification the model reads", () => {
	/** The notice of one background run whose spend the test sets while the child is held: the faux provider prices nothing. */
	async function noticeAfterSpending(showCost: boolean, cost: number): Promise<string> {
		const gate = held(() => fauxAssistantMessage("spent"));
		const harness = await parent({ showCost, defaultJoinMode: "async" }, { spend: [gate.behavior] });
		const subagents = service(harness);
		const spawned = await subagents.spawn(background("spend"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const record = inspectRecord(subagents, spawned.id);
		if (!record) throw new Error("no record");
		record.usage.cost.total = cost;
		gate.release();
		await subagents.waitForResult(spawned.id);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1));
		return notices(harness.session)[0];
	}

	it("includes the cost in the usage block when enabled", async () => {
		expect(await noticeAfterSpending(true, 0.0123)).toContain("<estimated_cost_usd>0.0123</estimated_cost_usd>");
	});

	it("omits it when disabled, because the notice is model context, not a display", async () => {
		const text = await noticeAfterSpending(false, 0.0123);
		expect(text).toContain("<total_tokens>");
		expect(text).not.toContain("estimated_cost_usd");
	});

	it("omits it for a model with no pricing data", async () => {
		const text = await noticeAfterSpending(true, 0);
		expect(text).toContain("<total_tokens>");
		expect(text).not.toContain("estimated_cost_usd");
	});

	it("hands the renderer the run's turns and the turn limit it enforced, though the setting changed since", async () => {
		const gate = held(() => fauxAssistantMessage("limited result"));
		const harness = await parent({ defaultJoinMode: "async", defaultMaxTurns: 7 }, { limited: [gate.behavior] });
		const subagents = service(harness);
		const spawned = await subagents.spawn(background("limited"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		vi.spyOn(harness.settingsManager, "getGlobalSettings").mockReturnValue({
			forkBuiltins: { subagents: { defaultJoinMode: "async", defaultMaxTurns: 20 } },
		} as unknown as Settings);
		expect(subagents.reloadSettings().defaultMaxTurns).toBe(20);
		gate.release();
		await subagents.waitForResult(spawned.id);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1));
		const notice = harness.session.messages.find(
			(message) => message.role === "custom" && message.customType === NOTIFICATION_CUSTOM_TYPE,
		);
		expect(notice?.role === "custom" ? notice.details : undefined).toMatchObject({ turnCount: 1, maxTurns: 7 });
	});
});

describe("the read-only surface", () => {
	it("hands out frozen settings, and a reread replaces them with a new frozen object", async () => {
		const harness = await parent();
		const subagents = service(harness);
		const first = subagents.settings;
		expect(Object.isFrozen(first)).toBe(true);
		vi.spyOn(harness.settingsManager, "getGlobalSettings").mockReturnValue({
			forkBuiltins: { subagents: { maxConcurrent: 5 } },
		} as unknown as Settings);
		const second = subagents.reloadSettings();
		expect(second).not.toBe(first);
		expect(Object.isFrozen(second)).toBe(true);
		expect(subagents.settings).toBe(second);
		expect([first.maxConcurrent, second.maxConcurrent]).toEqual([10, 5]);
	});

	it("hands out a running child's conversation and its changes, and none for a queued agent", async () => {
		const gate = held(() => fauxAssistantMessage("talk done"));
		const harness = await parent({ maxConcurrent: 1, defaultJoinMode: "async" }, { talk: [gate.behavior] });
		const subagents = service(harness);
		const talking = await subagents.spawn(background("talk task"));
		const waiting = await subagents.spawn(background("wait task"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect(subagents.conversation(waiting.id)).toBeUndefined();
		const conversation = subagents.conversation(talking.id);
		if (!conversation) throw new Error("no conversation for a running agent");
		const texts = () =>
			conversation.messages.map((message) =>
				message.role === "user" || message.role === "assistant" ? textOf(message.content) : "",
			);
		expect(texts().join("\n")).toContain("talk task");
		let changes = 0;
		const unsubscribe = conversation.subscribe(() => {
			changes++;
		});
		gate.release();
		await subagents.waitForResult(talking.id);
		expect(changes).toBeGreaterThan(0);
		expect(texts()).toContain("talk done");
		unsubscribe();
		await subagents.waitForResult(waiting.id);
	});

	// T18-F2: the conversation lacked the streaming message, so no surface showed a reply until it ended.
	it("includes the message a child is streaming, so its text grows before the message ends", async () => {
		const reply = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");
		const gate = held(() => fauxAssistantMessage(reply));
		const harness = await parent({ defaultJoinMode: "async" }, { stream: [gate.behavior] });
		const subagents = service(harness);
		const streaming = await subagents.spawn(background("stream task"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const conversation = subagents.conversation(streaming.id);
		if (!conversation) throw new Error("no conversation for a running agent");
		const snapshots: string[] = [];
		const inFlight = new Set<object>();
		const unsubscribe = conversation.subscribe(() => {
			const last = conversation.messages.at(-1);
			if (last?.role !== "assistant") return;
			const text = textOf(last.content);
			snapshots.push(text);
			// One object for the whole stream, so a reader's cache by identity holds (T18-F2 review).
			if (text.length > 0 && text.length < reply.length) inFlight.add(last);
		});
		gate.release();
		await subagents.waitForResult(streaming.id);
		unsubscribe();
		const partial = snapshots.filter((snapshot) => snapshot.length > 0 && snapshot.length < reply.length);
		expect(partial.length).toBeGreaterThan(0);
		for (const snapshot of partial) expect(reply.startsWith(snapshot)).toBe(true);
		expect(inFlight.size).toBe(1);
		expect(conversation.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
	});

	it("numbers queued agents by their place in the queue, and a running one not at all", async () => {
		const gate = held();
		const harness = await parent({ maxConcurrent: 1, defaultJoinMode: "async" }, { hold: [gate.behavior] });
		const subagents = service(harness);
		const running = await subagents.spawn(background("hold running"));
		const next = await subagents.spawn(background("hold next"));
		const last = await subagents.spawn(background("hold last"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect([running, next, last].map((record) => subagents.queuePosition(record.id))).toEqual([undefined, 1, 2]);
		gate.release();
		await subagents.waitForResult(last.id);
		expect(subagents.queuePosition(last.id)).toBeUndefined();
	});
});

describe("pools", () => {
	it("queues the eleventh background spawn at maxConcurrent 10, detached background spawns included", async () => {
		const gate = held();
		const harness = await parent({ defaultJoinMode: "async" }, { busy: [gate.behavior] });
		const subagents = service(harness);
		const running: SubagentView[] = [];
		for (let index = 0; index < 9; index++) running.push(await subagents.spawn(background(`busy ${index}`)));
		running.push(
			await subagents.spawn({
				type: "worker",
				prompt: "busy detached",
				description: "d",
				mode: "detached-background",
			}),
		);
		await vi.waitFor(() => expect(gate.requests()).toBe(10));
		const eleventh = await subagents.spawn(background("busy last"));
		expect(running.every((record) => record.status === "running")).toBe(true);
		expect(eleventh.status).toBe("queued");
		gate.release();
		await subagents.waitForResult(eleventh.id);
		expect(eleventh.status).toBe("completed");
	});

	it("queues a second blocking spawn at maxConcurrentForeground 1, and starts a detached spawn at once", async () => {
		const gate = held();
		const harness = await parent({ maxConcurrentForeground: 1 }, { hold: [gate.behavior] });
		const subagents = service(harness);
		const first = await subagents.spawn(foreground("hold one"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const second = await subagents.spawn(foreground("hold two"));
		const detached = await subagents.spawn({ type: "worker", prompt: "free", description: "free", mode: "detached" });
		expect(first.status).toBe("running");
		expect(second.status).toBe("queued");
		expect(detached.status).toBe("running");
		await subagents.waitForResult(detached.id);
		gate.release();
		await subagents.waitForResult(second.id);
		expect(second.status).toBe("completed");
	});
});

describe("waits, steering, stopping and resuming", () => {
	it("cancels only the wait on a running or queued agent, and leaves no listener behind", async () => {
		const gate = held(() => fauxAssistantMessage("waited result"));
		const harness = await parent({ maxConcurrent: 1, defaultJoinMode: "async" }, { hold: [gate.behavior] });
		const subagents = service(harness);
		const runningRecord = await subagents.spawn(background("hold running"));
		const queuedRecord = await subagents.spawn(background("hold queued"));
		expect(queuedRecord.status).toBe("queued");
		const laterWaits: Array<{ wait: Promise<SubagentView>; removed: ReturnType<typeof vi.spyOn> }> = [];
		for (const record of [runningRecord, queuedRecord]) {
			const controller = new AbortController();
			const wait = subagents.waitForResult(record.id, controller.signal);
			controller.abort(new Error("wait cancelled"));
			await expect(wait).rejects.toThrow("wait cancelled");
			expect(inspectRecord(subagents, record.id)?.waiters.size).toBe(0);
			expect(record.status).toBe(record === runningRecord ? "running" : "queued");
			// A wait that ends normally leaves nothing on its signal either.
			const kept = new AbortController();
			laterWaits.push({
				removed: vi.spyOn(kept.signal, "removeEventListener"),
				wait: subagents.waitForResult(record.id, kept.signal),
			});
		}
		gate.release();
		for (const { wait, removed } of laterWaits) {
			await wait;
			expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
		}
		expect(runningRecord.resultConsumed).toBe(false);
		expect(queuedRecord.resultConsumed).toBe(false);
		const waiters = (record: SubagentView) => inspectRecord(subagents, record.id)?.waiters.size;
		expect((waiters(runningRecord) ?? 0) + (waiters(queuedRecord) ?? 0)).toBe(0);
		await vi.waitFor(() => {
			expect(notices(harness.session).join("\n")).toContain(runningRecord.id);
			expect(notices(harness.session).join("\n")).toContain(queuedRecord.id);
		});
	});

	it("steers a running child, and stops one with its partial output", async () => {
		const gate = held(() =>
			fauxAssistantMessage([fauxToolCall("read", { path: "missing.txt" })], { stopReason: "toolUse" }),
		);
		let steeredText = "";
		const stopGate = held();
		const harness = await parent(
			{},
			{
				steerable: [
					gate.behavior,
					(context) => {
						steeredText = JSON.stringify(context.messages.filter((message) => message.role === "user"));
						return fauxAssistantMessage("changed course");
					},
				],
				stoppable: [
					() =>
						fauxAssistantMessage([fauxText("partial result"), fauxToolCall("read", { path: "x" })], {
							stopReason: "toolUse",
						}),
					stopGate.behavior,
				],
			},
		);
		const subagents = service(harness);
		const steered = await subagents.spawn(foreground("steerable"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect((await subagents.steer(steered.id, "switch to plan B")).kind).toBe("delivered");
		gate.release();
		await subagents.waitForResult(steered.id);
		expect(steeredText).toContain("switch to plan B");
		expect(steered.result).toBe("changed course");

		const stopped = await subagents.spawn(foreground("stoppable"));
		await vi.waitFor(() => expect(stopGate.requests()).toBe(1), CHILD_START);
		expect(subagents.stop(stopped.id)).toBe(true);
		await subagents.waitForResult(stopped.id);
		expect(stopped.status).toBe("stopped");
		expect(stopped.result).toBe("partial result");
		expect((await subagents.steer(stopped.id, "too late")).kind).toBe("refused");
	});

	it("resumes a finished persisted agent in its session file", async () => {
		const harness = await parent({}, { question: [say("first answer")], follow: [say("second answer")] });
		const subagents = service(harness);
		const record = await subagents.spawn(foreground("question one"));
		await subagents.waitForResult(record.id);
		const file = record.sessionFile as string;
		expect(file).toContain(".subagents");
		expect(readFileSync(file, "utf-8")).toContain("first answer");
		const resumed = subagents.resume(record.id, "follow up", { background: false });
		expect(resumed).toBe(record);
		await subagents.waitForResult(record.id);
		expect(record).toMatchObject({ status: "completed", result: "second answer" });
		const contents = readFileSync(file, "utf-8");
		expect(contents).toContain("first answer");
		expect(contents).toContain("follow up");
		expect(contents).toContain("second answer");
		expect(record.sessionFile).toBe(file);
		expect(() => subagents.resume("nobody", "x", { background: false })).toThrow('Agent not found: "nobody"');
	});
});

describe("definitions, usage and statuses", () => {
	it("keeps a caller's model the agent file outranked only when it names another model", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const harness = await createHarness({ models: [{ id: "faux-a" }, { id: "faux-b" }] });
		harnesses.push(harness);
		mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, "agents", "pinned.md"),
			"---\ndescription: pinned\ntools: read\nextensions: false\nmodel: faux-b\n---\nPinned.",
		);
		harness.setResponses(Array.from({ length: 20 }, () => router({})));
		const subagents = service(harness);
		const spawn = (model: string) =>
			subagents.spawn({
				type: "pinned",
				prompt: `pinned for ${model}`,
				description: "pinned",
				params: { run_in_background: false, model },
			});
		const honored = await spawn("FAUX-B");
		const other = await spawn("faux-a");
		const unknown = await spawn("no-such-model");
		for (const record of [honored, other, unknown]) await subagents.waitForResult(record.id);
		expect(honored.invocation.overridden).toBeUndefined();
		expect(other.invocation.overridden?.model).toBe("faux-a");
		expect(unknown.invocation.overridden?.model).toBe("no-such-model");
		expect(invocationTags(honored).modelName).toBe("faux-b");
		expect(invocationTags(other).modelName).toBe("faux-b (asked faux-a)");
	});

	it("records the model and thinking level the child session runs with", async () => {
		const harness = await parent({ defaultJoinMode: "async" });
		// No model: the child inherits the parent's. The faux model has no reasoning, so Pi clamps `high` to `off`.
		writeFileSync(
			join(harness.tempDir, "agents", "thinker.md"),
			"---\ndescription: thinks\ntools: read\nextensions: false\nthinking: high\n---\nThink.",
		);
		const subagents = service(harness);
		const record = await subagents.spawn(foreground("think hard"));
		const thinker = await subagents.spawn({ ...foreground("think deep"), type: "thinker" });
		await subagents.waitForResult(record.id);
		await subagents.waitForResult(thinker.id);
		const parentModel = harness.session.model;
		expect(parentModel).toBeDefined();
		expect(record.effective.model?.id).toBe(parentModel?.id);
		expect(thinker.effective.model?.id).toBe(parentModel?.id);
		expect([thinker.invocation.thinking, thinker.effective.thinking]).toEqual(["high", "off"]);
		expect(invocationTags(thinker)).toMatchObject({
			modelId: `${parentModel?.provider}/${parentModel?.id}`,
			tags: ["thinking: off (asked high)"],
		});
	});

	it("warns when an agent inherits a parent model outside enabledModels, and still runs it", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const harness = await createHarness({
			models: [{ id: "faux-parent" }, { id: "faux-allowed" }],
			settings: { forkBuiltins: { subagents: { scopeModels: true } } } as unknown as Partial<Settings>,
		});
		harnesses.push(harness);
		mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, "agents", "worker.md"),
			"---\ndescription: test worker\ntools: read\nextensions: false\n---\nYou are a test worker.",
		);
		harness.setResponses(Array.from({ length: 10 }, () => router({})));
		const [inherited, allowed] = harness.models;
		harness.settingsManager.setEnabledModels([`${allowed.provider}/${allowed.id}`]);
		const subagents = service(harness);
		const record = await subagents.spawn(foreground("scoped task"));
		await subagents.waitForResult(record.id);
		expect(record.status).toBe("completed");
		expect(record.model?.id).toBe(inherited.id);
		expect(subagents.warnings).toContain(
			`Agent "worker" using out-of-scope model "${inherited.provider}/${inherited.id}"`,
		);
	});

	it("spawns an agent file added after the service started, and refreshes a disabled one, without touching records", async () => {
		const harness = await parent({ fallbackSubagent: "none" }, { review: [say("reviewed")] });
		const subagents = service(harness);
		const before = await subagents.spawn(foreground("first task"));
		await subagents.waitForResult(before.id);
		const snapshot = { type: before.type, result: before.result, status: before.status };
		await expect(subagents.spawn({ ...foreground("review"), type: "reviewer" })).rejects.toThrow(
			'Unknown or disabled agent type: "reviewer"',
		);
		mkdirSync(join(harness.tempDir, ".pi", "agents"), { recursive: true });
		const file = join(harness.tempDir, ".pi", "agents", "reviewer.md");
		writeFileSync(file, "---\ndescription: reviews\nextensions: false\n---\nReview.");
		const reviewer = await subagents.spawn({ ...foreground("review"), type: "reviewer" });
		await subagents.waitForResult(reviewer.id);
		expect(reviewer).toMatchObject({ type: "reviewer", result: "reviewed" });
		writeFileSync(file, "---\ndescription: reviews\nenabled: false\n---\nReview.");
		const registry = subagents.refreshDefinitions();
		expect(registry.agents.get("reviewer")?.enabled).toBe(false);
		expect({ type: before.type, result: before.result, status: before.status }).toEqual(snapshot);
		expect(reviewer).toMatchObject({ type: "reviewer", result: "reviewed", status: "completed" });
	});

	it("sums each assistant message once across resumes, and reports it to the session under reportUsage", async () => {
		const harness = await parent({ reportUsage: true }, {});
		const subagents = service(harness);
		const record = await subagents.spawn(foreground("count me"));
		await subagents.waitForResult(record.id);
		const sum = (records: AgentSession["messages"]) => {
			const total = emptyUsage();
			for (const message of records) if (message.role === "assistant") addUsage(total, message.usage);
			return total;
		};
		const first = sum(inspectRecord(subagents, record.id)?.child?.session.messages ?? []);
		expect(first.input + first.output).toBeGreaterThan(0);
		expect(record.usage).toEqual(first);
		expect(subagents.takeReportedUsage()).toEqual(first);
		expect(subagents.takeReportedUsage()).toBeUndefined();
		subagents.resume(record.id, "count again", { background: false });
		await subagents.waitForResult(record.id);
		const total = sum(inspectRecord(subagents, record.id)?.child?.session.messages ?? []);
		expect(record.usage).toEqual(total);
		const delta = subagents.takeReportedUsage() as Usage;
		expect(delta.input + first.input).toBe(total.input);

		const quiet = await parent({}, {});
		const unreported = service(quiet);
		const other = await unreported.spawn(foreground("count me"));
		await unreported.waitForResult(other.id);
		expect(unreported.takeReportedUsage()).toBeUndefined();
	});

	it("records each terminal status", async () => {
		const stopGate = held();
		const readCall = () =>
			fauxAssistantMessage([fauxText("working"), fauxToolCall("read", { path: "x" })], { stopReason: "toolUse" });
		const harness = await parent(
			{ graceTurns: 1 },
			{
				done: [say("done")],
				wrap: [readCall, say("wrapped")],
				runaway: [readCall],
				halt: [stopGate.behavior],
				broken: [() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "provider boom" })],
			},
		);
		const subagents = service(harness);
		const run = async (task: string, extra: Record<string, unknown> = {}) => {
			const record = await subagents.spawn(foreground(task, extra));
			if (task === "halt") {
				await vi.waitFor(() => expect(stopGate.requests()).toBe(1), CHILD_START);
				subagents.stop(record.id);
			}
			await subagents.waitForResult(record.id);
			return record;
		};
		expect((await run("done")).status).toBe("completed");
		expect((await run("wrap", { max_turns: 1 })).status).toBe("steered");
		expect((await run("runaway", { max_turns: 1 })).status).toBe("aborted");
		expect((await run("halt")).status).toBe("stopped");
		const broken = await run("broken");
		expect(broken).toMatchObject({ status: "error", error: "provider boom" });
	});
});

describe("ownership", () => {
	it("ends running and queued children with the session, tears down every child, and leaves no cleanup hook", async () => {
		const gate = held();
		const harness = await parent({ maxConcurrent: 1, defaultJoinMode: "async" }, { hold: [gate.behavior] });
		const subagents = service(harness);
		const finished = await subagents.spawn(foreground("done first"));
		await subagents.waitForResult(finished.id);
		const running = await subagents.spawn(background("hold running"));
		const queued = await subagents.spawn(background("hold queued"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const ended: string[] = [];
		subagents.subscribe((event) => {
			if (event.type === "ended") ended.push(`${event.record.id}:${event.record.status}`);
		});
		const finishedLoader = vi.spyOn(
			inspectRecord(subagents, finished.id)?.child?.loader as DefaultResourceLoader,
			"dispose",
		);
		const runningLoader = vi.spyOn(
			inspectRecord(subagents, running.id)?.child?.loader as DefaultResourceLoader,
			"dispose",
		);
		const sessionId = harness.session.sessionId;
		harness.session.dispose();
		expect(subagents.isDisposed).toBe(true);
		expect(running).toMatchObject({ status: "aborted", error: SESSION_ENDED_ERROR });
		expect(queued).toMatchObject({ status: "aborted", error: SESSION_ENDED_ERROR });
		expect(ended.sort()).toEqual([`${queued.id}:aborted`, `${running.id}:aborted`].sort());
		await vi.waitFor(() => {
			expect(finishedLoader).toHaveBeenCalledTimes(1);
			expect(runningLoader).toHaveBeenCalledTimes(1);
		});
		const again = vi.spyOn(subagents, "dispose");
		cleanupSessionResources(sessionId);
		expect(again).not.toHaveBeenCalled();
		await expect(subagents.spawn(background("late"))).rejects.toThrow("has ended");
	});

	it("ends the children of a session that the runtime replaces", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const tempDir = mkdtempSync(join(tmpdir(), "pi-sn-runtime-"));
		const faux = registerFauxProvider();
		const gate = held();
		faux.setResponses(Array.from({ length: 20 }, () => router({ hold: [gate.behavior] })));
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(tempDir, "models.json"),
		});
		const model = faux.getModel();
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});
		mkdirSync(join(tempDir, "agents"), { recursive: true });
		writeFileSync(join(tempDir, "agents", "worker.md"), "---\ntools: read\nextensions: false\n---\nWork.");
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: tempDir,
				modelRuntime,
				resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(tempDir),
		});
		cleanups.push(async () => {
			await runtime.dispose().catch(() => {});
			faux.unregister();
			rmSync(tempDir, { recursive: true, force: true });
		});
		const first = runtime.session;
		const subagents = new SubagentService(first, { agentDir: tempDir, forkBaseToolNames: () => [] });
		const record = await subagents.spawn(background("hold"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const loader = vi.spyOn(inspectRecord(subagents, record.id)?.child?.loader as DefaultResourceLoader, "dispose");
		await runtime.newSession();
		expect(runtime.session).not.toBe(first);
		expect(subagents.isDisposed).toBe(true);
		expect(record).toMatchObject({ status: "aborted", error: SESSION_ENDED_ERROR });
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
		expect(existsSync(tempDir)).toBe(true);
	});

	it("waits for a starting child only up to its bound, and tears it down when it attaches later", async () => {
		const harness = await parent();
		let open!: () => void;
		const opened = new Promise<void>((resolve) => {
			open = resolve;
		});
		const gate = { opened, shutdowns: 0 };
		(globalThis as { __sn2Gate?: typeof gate }).__sn2Gate = gate;
		cleanups.push(() => {
			open();
			delete (globalThis as { __sn2Gate?: typeof gate }).__sn2Gate;
		});
		// Extensions load for this agent, so its child's loader runs the gated extension below.
		writeFileSync(
			join(harness.tempDir, "agents", "gated.md"),
			"---\ndescription: gated\ntools: read\n---\nYou are gated.",
		);
		mkdirSync(join(harness.tempDir, "extensions"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, "extensions", "gate.ts"),
			'export default async function (pi) {\n\tawait globalThis.__sn2Gate.opened;\n\tpi.on("session_shutdown", () => {\n\t\tglobalThis.__sn2Gate.shutdowns++;\n\t});\n}\n',
		);
		const subagents = service(harness, { startupWaitMs: 200 });
		const record = await subagents.spawn({
			type: "gated",
			prompt: "gated task",
			description: "gated task",
			params: { run_in_background: true },
		});
		const started = Date.now();
		await subagents.shutdown();
		expect(Date.now() - started).toBeLessThan(2000);
		expect(inspectRecord(subagents, record.id)?.child, "the child is still starting").toBeUndefined();
		expect(gate.shutdowns).toBe(0);
		open();
		await vi.waitFor(() => expect(gate.shutdowns).toBe(1), CHILD_START);
	});

	it("never evicts a queued record, however long it waits", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ defaultJoinMode: "async", maxConcurrent: 1 }, { hold: [gate.behavior] });
		const subagents = service(harness);
		await subagents.spawn(background("hold on"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const queued = await subagents.spawn(background("wait in line"));
		expect(queued.status).toBe("queued");
		vi.advanceTimersByTime(11 * 60_000);
		expect(subagents.get(queued.id)).toBe(queued);
		expect(queued.status).toBe("queued");
		gate.release();
		expect((await subagents.waitForResult(queued.id)).status).toBe("completed");
	});

	it("keeps a finished record 10 minutes, then evicts it with a tombstone, and never evicts a running one", async () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const gate = held();
		const harness = await parent({ defaultJoinMode: "async" }, { hold: [gate.behavior] });
		const subagents = service(harness);
		const finished = await subagents.spawn(foreground("finish me"));
		await subagents.waitForResult(finished.id);
		const running = await subagents.spawn(background("hold on"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const loader = vi.spyOn(inspectRecord(subagents, finished.id)?.child?.loader as DefaultResourceLoader, "dispose");
		vi.advanceTimersByTime(9 * 60_000);
		expect(subagents.get(finished.id)).toBe(finished);
		vi.advanceTimersByTime(2 * 60_000);
		expect(subagents.get(finished.id)).toBeUndefined();
		expect(subagents.get(running.id)).toBe(running);
		await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
		expect(subagents.listTombstones()).toEqual([
			expect.objectContaining({ id: finished.id, handle: finished.handle, sessionFile: finished.sessionFile }),
		]);
		expect(existsSync(finished.sessionFile as string)).toBe(true);
		gate.release();
		await subagents.waitForResult(running.id);
	});
});

describe("resumes and interrupted turns", () => {
	it("forgets a caller's signal when its run ends, so a later background resume outlives it", async () => {
		const gate = held(() => fauxAssistantMessage("resumed"));
		const harness = await parent({ defaultJoinMode: "async" }, { hold: [gate.behavior] });
		const subagents = service(harness);
		const controller = new AbortController();
		const record = await subagents.spawn({ ...foreground("first run"), signal: controller.signal });
		await subagents.waitForResult(record.id);
		subagents.resume(record.id, "hold again", { background: true });
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		controller.abort();
		await sleep(50);
		expect(record.status).toBe("running");
		gate.release();
		await subagents.waitForResult(record.id);
		expect(record).toMatchObject({ status: "completed", result: "resumed" });
	});

	it("gives a background resume its own tool call and joins resumes of one turn", async () => {
		const later = held(() => fauxAssistantMessage("beta later"));
		const harness = await parent({}, { alpha: [say("alpha")], beta: [say("beta")], later: [later.behavior] });
		const subagents = service(harness);
		const alpha = await subagents.spawn({ ...background("alpha"), toolCallId: "call-old-a" });
		const beta = await subagents.spawn({ ...background("beta"), toolCallId: "call-old-b" });
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1));
		subagents.resume(alpha.id, "alpha again", { background: true, toolCallId: "call-new-a" });
		subagents.resume(beta.id, "then later", { background: true, toolCallId: "call-new-b" });
		await subagents.waitForResult(alpha.id);
		// Joined: the finished resume waits for its batch mate.
		await sleep(400);
		expect(notices(harness.session)).toHaveLength(1);
		later.release();
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(2));
		const second = notices(harness.session)[1];
		expect(second).toContain("2 agent(s) finished");
		expect(second).toContain("<tool-use-id>call-new-a</tool-use-id>");
		expect(second).toContain("<tool-use-id>call-new-b</tool-use-id>");
		expect(second).not.toContain("call-old-a");
	});

	it("drops a notification held for the next prompt once the result is read", async () => {
		const parentTurn = held();
		const late = held(() => fauxAssistantMessage("late result"));
		let parentCalls = 0;
		const harness = await parent({ defaultJoinMode: "async" }, { late: [late.behavior] }, (context, options) => {
			parentCalls++;
			return parentCalls === 1 ? parentTurn.behavior(context, options) : fauxAssistantMessage("noted");
		});
		const subagents = service(harness);
		const busy = harness.session.prompt("parent work");
		await vi.waitFor(() => expect(parentTurn.requests()).toBe(1), CHILD_START);
		const record = await subagents.spawn(background("late"));
		await vi.waitFor(() => expect(late.requests()).toBe(1), CHILD_START);
		await harness.session.abort();
		await busy;
		late.release();
		await subagents.waitForResult(record.id);
		// Interrupted: the notice waits for the next prompt instead of starting a turn.
		await sleep(300);
		expect(parentCalls).toBe(1);
		expect(subagents.consume(record.id)).toBe(true);
		await harness.session.prompt("next question");
		expect(notices(harness.session)).toEqual([]);
	});
});
