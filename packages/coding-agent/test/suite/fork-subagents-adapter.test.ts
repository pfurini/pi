/**
 * Fork-owned: the `subagents:*` bus adapter and skill-fork over the typed service (plan T8), on real
 * sessions whose event bus the test shares, as a third-party extension such as pi-tasks shares it.
 * Payloads are compared with `test/fork-builtins/subagents/fixtures/lifecycle-events.json` after
 * ids, times and measured token counts are normalized.
 * Old pi-subagents tests at 79a7c42 this covers: cross-extension-rpc, rpc-lifecycle-gating,
 * rpc-result-consumption, skill-agents-e2e, skills-contract.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus, type EventBus } from "../../src/core/event-bus.ts";
import {
	bridgeServiceEvents,
	flushSpawnReply,
	markSpawnPending,
} from "../../src/core/fork-builtins/subagents/adapter/events.ts";
import type { SubagentRecord } from "../../src/core/fork-builtins/subagents/service/records.ts";
import {
	SESSION_ENDED_ERROR,
	type SubagentEvent,
	type SubagentService,
	subagentServiceFor,
} from "../../src/core/fork-builtins/subagents/service/service.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import type { LoadedSkill } from "../../src/core/skills/frontmatter.ts";
import {
	SKILL_AGENTS_QUERY_CHANNEL,
	SKILL_AGENTS_REWRITE_MAPS_CHANNEL,
	type SkillAgentRewriteMapsEvent,
	skillAgentsQueryReplyChannel,
} from "../../src/core/skills/runtime.ts";
import { normalizeAgentEnded, normalizeSubagentCompletion, SkillForkClient } from "../../src/core/skills/skill-fork.ts";
import { getSkillSetController } from "../../src/core/skills/skill-set-events.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createTestResourceLoader } from "../utilities.ts";
import {
	type Behavior,
	CHILD_START,
	call,
	held,
	notices,
	router,
	say,
	sleep,
	text,
	use,
} from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const FIXTURE = JSON.parse(
	readFileSync(new URL("../fork-builtins/subagents/fixtures/lifecycle-events.json", import.meta.url), "utf8"),
) as { events: Record<string, Record<string, unknown>> };

const LIFECYCLE = [
	"subagents:created",
	"subagents:started",
	"subagents:completed",
	"subagents:failed",
	"subagents:agent-ended",
	"subagents:steered",
	"subagents:compacted",
	"subagents:settings_loaded",
	"subagents:settings_changed",
];

/** Plain, read-only agents without extensions keep every child fast. */
const AGENTS: Record<string, string> = {
	worker: "description: test worker",
	lead: "description: delegating lead\nallowed_subagents: worker",
	hermit: "description: isolated lead\nisolated: true\nallowed_subagents: all",
};

const harnesses: Harness[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

interface Session {
	harness: Harness;
	bus: EventBus;
}

async function session(
	subagents: Record<string, unknown> = {},
	script: Record<string, Behavior[]> = {},
	options: HarnessOptions = {},
): Promise<Session> {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-adapter-"));
	mkdirSync(join(cwd, "agents"), { recursive: true });
	for (const [name, frontmatter] of Object.entries(AGENTS)) {
		writeFileSync(
			join(cwd, "agents", `${name}.md`),
			`---\n${frontmatter}\ntools: read\nextensions: false\n---\nYou are ${name}.`,
		);
	}
	const bus = options.eventBus ?? createEventBus();
	const harness = await createHarness({
		...options,
		cwd,
		eventBus: bus,
		settings: { forkBuiltins: { subagents } } as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	harness.setResponses(Array.from({ length: 300 }, () => router(script)));
	// `subagents:ready` and the first rewrite maps go out a microtask after construction.
	await sleep(0);
	return { harness, bus };
}

function serviceOf(harness: Harness): SubagentService {
	const service = subagentServiceFor(harness.session);
	if (!service) throw new Error("no subagent service");
	return service;
}

/** Every event on `channels`, in order. */
function listen(bus: EventBus, channels: readonly string[] = LIFECYCLE) {
	const events: Array<{ channel: string; payload: Record<string, unknown> }> = [];
	for (const channel of channels) {
		bus.on(channel, (payload) => events.push({ channel, payload: payload as Record<string, unknown> }));
	}
	return {
		events,
		of: (channel: string) => events.filter((event) => event.channel === channel).map((event) => event.payload),
		ids: () => events.map((event) => event.payload.id ?? event.payload.agentId),
	};
}

type Reply = { success: true; data?: unknown } | { success: false; error: string };

/** One request on `channel`, answered on its scoped reply channel. */
function rpc(bus: EventBus, channel: string, params: Record<string, unknown> = {}): Promise<Reply> {
	const requestId = randomUUID();
	return new Promise((resolve) => {
		const off = bus.on(`${channel}:reply:${requestId}`, (reply) => {
			off();
			resolve(reply as Reply);
		});
		bus.emit(channel, { requestId, ...params });
	});
}

async function spawnId(bus: EventBus, params: Record<string, unknown>): Promise<string> {
	const reply = await rpc(bus, "subagents:rpc:spawn", params);
	if (!reply.success) throw new Error(reply.error);
	return (reply.data as { id: string }).id;
}

/** A background top-level agent whose child session stays open, held on its first request. */
async function openChild(harness: Harness, bus: EventBus, type: string, task: string): Promise<SubagentRecord> {
	const id = await spawnId(bus, { type, prompt: task, options: { description: task, isBackground: true } });
	const record = serviceOf(harness).get(id);
	if (!record) throw new Error("no record");
	await vi.waitFor(() => expect(record.child).toBeDefined(), CHILD_START);
	return record;
}

function childBus(record: SubagentRecord): EventBus {
	if (!record.child) throw new Error("no child session");
	return record.child.loader.getEventBus();
}

/** Ids, times and measured token counts replaced; `undefined` fields dropped as JSON drops them. */
function normalize(payload: unknown): unknown {
	const walk = (value: unknown, key: string, measured: boolean): unknown => {
		if (Array.isArray(value)) return value.map((item) => walk(item, key, measured));
		if (value !== null && typeof value === "object") {
			return Object.fromEntries(
				Object.entries(value).map(([name, inner]) => [
					name,
					walk(inner, name, measured || name === "tokens" || name === "usage"),
				]),
			);
		}
		if ((key === "id" || key === "agentId") && typeof value === "string") return "<id>";
		if (key === "durationMs") return "<ms>";
		if (measured && typeof value === "number") return "<n>";
		return value;
	};
	return walk(JSON.parse(JSON.stringify(payload)), "", false);
}

const example = (channel: string, variant = "default") => FIXTURE.events[channel][variant];

/** A skill the controller can publish, bundling one agent file per entry of `agents`. */
function skill(root: string, name: string, agents: Record<string, string>): LoadedSkill {
	const baseDir = join(root, "skills", name);
	mkdirSync(join(baseDir, "agents"), { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} skill\n---\n${name} body`);
	for (const [agent, frontmatter] of Object.entries(agents)) {
		writeFileSync(join(baseDir, "agents", `${agent}.md`), `---\n${frontmatter}\n---\nYou are ${agent}.`);
	}
	return {
		name,
		description: `${name} skill`,
		filePath,
		baseDir,
		sourceInfo: createSyntheticSourceInfo(filePath, {
			source: "local",
			scope: "project",
			origin: "top-level",
			baseDir,
		}),
		disableModelInvocation: false,
		id: filePath,
		listingName: name,
		frontmatter: { name, description: `${name} skill` },
		argumentHint: undefined,
		userInvocable: true,
		commandNameValid: true,
	};
}

describe("a cold session", () => {
	it("answers ping with protocol 3 before any subagent tool is called", async () => {
		const { bus } = await session();
		expect(await rpc(bus, "subagents:rpc:ping")).toEqual({
			success: true,
			data: { version: 3, capabilities: { skillAgents: true } },
		});
	});

	it("spawns over RPC, replies before the agent's terminal event, and reports subagents:completed", async () => {
		const { bus } = await session();
		const seen = listen(bus);
		const order: string[] = [];
		bus.on("subagents:agent-ended", () => order.push("agent-ended"));
		const requestId = randomUUID();
		const replied = new Promise<Reply>((resolve) => {
			bus.on(`subagents:rpc:spawn:reply:${requestId}`, (reply) => {
				order.push("reply");
				resolve(reply as Reply);
			});
		});
		bus.emit("subagents:rpc:spawn", {
			requestId,
			type: "worker",
			prompt: "rpc task",
			options: { description: "rpc" },
		});
		const reply = await replied;
		const id = reply.success ? (reply.data as { id: string }).id : "";
		expect(id).not.toBe("");
		await vi.waitFor(() => expect(seen.of("subagents:completed")).toHaveLength(1));
		expect(seen.of("subagents:completed")[0]).toMatchObject({ id, status: "completed", result: "reply to rpc task" });
		expect(seen.of("subagents:created")).toEqual([]);
		expect(order).toEqual(["reply", "agent-ended"]);
	});

	it("runs a context: fork skill through the service without pinging", async () => {
		const bus = createEventBus();
		const root = mkdtempSync(join(tmpdir(), "pi-subagent-fork-"));
		const fork = skill(root, "forkfg", {});
		const forkSkill = {
			...fork,
			frontmatter: { ...fork.frontmatter, context: "fork" as const, background: false, agent: "worker" },
		};
		const resourceLoader = {
			...createTestResourceLoader({ eventBus: bus }),
			getSkills: () => ({ skills: [forkSkill], diagnostics: [] }),
		};
		const { harness } = await session({}, {}, { eventBus: bus, resourceLoader });
		await harness.session.bindExtensions({ mode: "tui" });
		let pings = 0;
		bus.on("subagents:rpc:ping", () => pings++);
		await harness.session.prompt("/skill:forkfg");
		const forkNotices = harness.session.messages
			.filter((message) => message.role === "custom" && message.customType === "skill_fork")
			.map((message) => JSON.stringify(message.role === "custom" ? message.content : ""));
		expect(forkNotices.some((notice) => notice.includes("completed: reply to"))).toBe(true);
		expect(pings).toBe(0);
		expect(
			serviceOf(harness)
				.list()
				.map((record) => [record.type, record.description]),
		).toEqual([["worker", "skill forkfg"]]);
		rmSync(root, { recursive: true, force: true });
	});
});

describe("lifecycle payloads", () => {
	it("emits created, started, steered, completed and agent-ended as the fixture records them", async () => {
		const gate = held(() => fauxAssistantMessage("background done"));
		const { harness, bus } = await session(
			{ defaultJoinMode: "async" },
			{
				background: [gate.behavior],
				wrap: [use("read", () => ({ path: "missing.txt" })), say("wrapped up")],
			},
		);
		const seen = listen(bus);
		const launched = await call(harness, "Agent", {
			subagent_type: "worker",
			prompt: "background task",
			description: "background task",
			run_in_background: true,
		});
		const id = /Agent ID: (\S+)/.exec(text(launched))?.[1] ?? "";
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await call(harness, "steer_subagent", { agent_id: id, message: "focus on tests" });
		gate.release();
		await serviceOf(harness).waitForResult(id);
		await call(harness, "Agent", {
			subagent_type: "worker",
			prompt: "wrap task",
			description: "wrap task",
			max_turns: 1,
			run_in_background: false,
		});

		expect(normalize(seen.of("subagents:created"))).toEqual([example("subagents:created")]);
		expect(normalize(seen.of("subagents:started")[0])).toEqual(example("subagents:started"));
		expect(normalize(seen.of("subagents:steered"))).toEqual([example("subagents:steered")]);
		expect(normalize(seen.of("subagents:completed"))).toEqual([
			example("subagents:completed", "completed"),
			example("subagents:completed", "steered"),
		]);
		expect(normalize(seen.of("subagents:agent-ended"))).toEqual([
			example("subagents:agent-ended", "completed"),
			example("subagents:agent-ended", "steered"),
		]);
	});

	it("emits failed and agent-ended for an error, a stop and the session's end, as the fixture records them", async () => {
		const stopped = held(() => fauxAssistantMessage("never"));
		const ended = held(() => fauxAssistantMessage("never"));
		const { harness, bus } = await session(
			{},
			{
				failing: [() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "provider exploded" })],
				stopping: [stopped.behavior],
				ending: [ended.behavior],
			},
		);
		const seen = listen(bus);
		await call(harness, "Agent", {
			subagent_type: "worker",
			prompt: "failing task",
			description: "failing task",
			run_in_background: false,
		});
		const stopId = await spawnId(bus, {
			type: "worker",
			prompt: "stopping task",
			options: { description: "stopping task", isBackground: true },
		});
		await vi.waitFor(() => expect(stopped.requests()).toBe(1), CHILD_START);
		expect(await rpc(bus, "subagents:rpc:stop", { agentId: stopId })).toEqual({ success: true });
		await serviceOf(harness).waitForResult(stopId);
		expect(await rpc(bus, "subagents:rpc:stop", { agentId: stopId })).toEqual({
			success: false,
			error: "Agent is not running",
		});
		expect(await rpc(bus, "subagents:rpc:stop", { agentId: "nobody" })).toEqual({
			success: false,
			error: "Agent not found",
		});
		await spawnId(bus, { type: "worker", prompt: "ending task", options: { description: "ending task" } });
		await vi.waitFor(() => expect(ended.requests()).toBe(1), CHILD_START);
		harness.session.dispose();

		expect(normalize(seen.of("subagents:failed"))).toEqual([
			example("subagents:failed", "error"),
			example("subagents:failed", "stopped"),
			example("subagents:failed", "aborted"),
		]);
		expect(seen.of("subagents:failed")[2]?.error).toBe(SESSION_ENDED_ERROR);
		expect(normalize(seen.of("subagents:agent-ended"))).toEqual([
			example("subagents:agent-ended", "error"),
			example("subagents:agent-ended", "stopped"),
			example("subagents:agent-ended", "aborted"),
		]);
	});

	it("emits settings_loaded, settings_changed and compacted as the fixture records them", async () => {
		const { harness, bus } = await session({ maxConcurrent: 4 });
		const seen = listen(bus);
		const id = await spawnId(bus, {
			type: "worker",
			prompt: "settled task",
			options: { description: "settled task" },
		});
		const service = serviceOf(harness);
		const record = await service.waitForResult(id);
		vi.spyOn(harness.settingsManager, "getGlobalSettings").mockReturnValue({
			forkBuiltins: { subagents: { maxConcurrent: 5 } },
		} as unknown as Settings);
		service.refreshDefinitions();
		expect(normalize(seen.of("subagents:settings_loaded"))).toEqual([example("subagents:settings_loaded")]);
		expect(normalize(seen.of("subagents:settings_changed"))).toEqual([example("subagents:settings_changed")]);

		// A real compaction happens only inside a child's run; the bridge maps the service's event.
		const compactions = createEventBus();
		const compacted = listen(compactions, ["subagents:compacted"]);
		let emit: ((event: SubagentEvent) => void) | undefined;
		bridgeServiceEvents({
			eventBus: compactions,
			settings: service.settings,
			subscribe: (listener) => {
				emit = listener;
				return () => true;
			},
		});
		record.compactionCount = 1;
		emit?.({ type: "compacted", record, reason: "threshold", tokensBefore: 1234 });
		expect(normalize(compacted.of("subagents:compacted"))).toEqual([example("subagents:compacted")]);
	});

	it("holds an RPC-spawned agent's agent-ended until its spawn reply is out", async () => {
		const { harness, bus } = await session();
		const id = await spawnId(bus, { type: "worker", prompt: "held task", options: {} });
		const record = await serviceOf(harness).waitForResult(id);
		const gated = createEventBus();
		const ended = listen(gated, ["subagents:agent-ended"]);
		let emit: ((event: SubagentEvent) => void) | undefined;
		bridgeServiceEvents({
			eventBus: gated,
			settings: serviceOf(harness).settings,
			subscribe: (listener) => {
				emit = listener;
				return () => true;
			},
		});
		markSpawnPending(gated, id);
		emit?.({ type: "ended", record });
		expect(ended.events).toEqual([]);
		flushSpawnReply(gated, id);
		expect(ended.of("subagents:agent-ended").map((payload) => payload.agentId)).toEqual([id]);
	});

	it("maps every terminal example to skill-fork's success value", () => {
		for (const [status, payload] of Object.entries(FIXTURE.events["subagents:completed"])) {
			expect(normalizeSubagentCompletion("subagents:completed", payload), status).toMatchObject({
				ok: true,
				status,
			});
		}
		for (const [status, payload] of Object.entries(FIXTURE.events["subagents:failed"])) {
			expect(normalizeSubagentCompletion("subagents:failed", payload), status).toMatchObject({ ok: false, status });
		}
		const ok = { completed: true, steered: true, error: false, stopped: false, aborted: false };
		for (const [status, payload] of Object.entries(FIXTURE.events["subagents:agent-ended"])) {
			expect(normalizeAgentEnded(payload), status).toMatchObject({ ok: ok[status as keyof typeof ok], status });
		}
	});
});

describe("consume and pools", () => {
	it("leaves no notification when a listener consumes the result inside its subagents:completed handler", async () => {
		const gate = held(() => fauxAssistantMessage("consumed result"));
		const { harness, bus } = await session({}, { consumed: [gate.behavior] });
		const replies: Reply[] = [];
		bus.on("subagents:completed", (payload) => {
			const requestId = randomUUID();
			bus.on(`subagents:rpc:consume:reply:${requestId}`, (reply) => replies.push(reply as Reply));
			bus.emit("subagents:rpc:consume", { requestId, agentId: (payload as { id: string }).id });
		});
		const id = await spawnId(bus, {
			type: "worker",
			prompt: "consumed task",
			options: { description: "consumed", isBackground: true },
		});
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		expect(await rpc(bus, "subagents:rpc:consume", { agentId: id })).toEqual({
			success: false,
			error: "Agent not found or still running",
		});
		gate.release();
		await serviceOf(harness).waitForResult(id);
		await sleep(500);
		expect(replies).toEqual([{ success: true }]);
		expect(notices(harness.session)).toEqual([]);
	});

	it("starts an RPC spawn without isBackground while a blocking Agent call holds the only foreground slot", async () => {
		const blocking = held(() => fauxAssistantMessage("blocking done"));
		const { harness, bus } = await session({ maxConcurrentForeground: 1 }, { blocking: [blocking.behavior] });
		const foreground = call(harness, "Agent", {
			subagent_type: "worker",
			prompt: "blocking task",
			description: "blocking",
			run_in_background: false,
		});
		await vi.waitFor(() => expect(blocking.requests()).toBe(1), CHILD_START);
		const id = await spawnId(bus, { type: "worker", prompt: "detached task", options: { description: "detached" } });
		expect(serviceOf(harness).get(id)?.status).toBe("running");
		await serviceOf(harness).waitForResult(id);
		blocking.release();
		await foreground;
	});

	it("runs two background RPC spawns one at a time under maxConcurrent 1", async () => {
		const first = held(() => fauxAssistantMessage("first done"));
		const { harness, bus } = await session({ maxConcurrent: 1 }, { first: [first.behavior] });
		const background = (task: string) => ({
			type: "worker",
			prompt: task,
			options: { description: task, isBackground: true },
		});
		const firstId = await spawnId(bus, background("first task"));
		await vi.waitFor(() => expect(first.requests()).toBe(1), CHILD_START);
		const secondId = await spawnId(bus, background("second task"));
		const service = serviceOf(harness);
		expect([service.get(firstId)?.status, service.get(secondId)?.status]).toEqual(["running", "queued"]);
		first.release();
		const second = await service.waitForResult(secondId);
		expect(second.status).toBe("completed");
		expect(second.startedAt).toBeGreaterThanOrEqual(service.get(firstId)?.completedAt ?? Number.POSITIVE_INFINITY);
	});
});

describe("ownership across buses", () => {
	it("keeps a nested agent's events off the main bus and refuses its stop and consume there", async () => {
		const stuck = held(() => fauxAssistantMessage("never"));
		const lingering = held(() => fauxAssistantMessage("lead done"));
		const { harness, bus } = await session(
			{},
			{
				alpha: [
					use("Agent", () => ({
						subagent_type: "worker",
						prompt: "xray task",
						description: "xray",
						run_in_background: true,
					})),
					lingering.behavior,
				],
				xray: [stuck.behavior],
			},
		);
		const main = listen(bus);
		const lead = await openChild(harness, bus, "lead", "alpha task");
		const inChild = listen(childBus(lead));
		await vi.waitFor(() => expect(stuck.requests()).toBe(1), CHILD_START);
		const xrayId =
			/Agent ID: ([0-9a-f-]+)/.exec(
				JSON.stringify(lead.child?.session.messages.filter((message) => message.role === "toolResult")),
			)?.[1] ?? "";
		expect(serviceOf(harness).nested(lead).get(xrayId)).toBeDefined();
		const owned = { success: false, error: "Agent is owned by another agent or workflow" };
		expect(await rpc(bus, "subagents:rpc:stop", { agentId: xrayId })).toEqual(owned);
		expect(await rpc(bus, "subagents:rpc:consume", { agentId: xrayId })).toEqual(owned);
		lingering.release();
		await serviceOf(harness).waitForResult(lead.id);
		await serviceOf(harness).nested(lead).waitForResult(xrayId);
		expect(main.ids()).not.toContain(xrayId);
		expect(inChild.of("subagents:failed").map((payload) => payload.id)).toEqual([xrayId]);
	});

	it("refuses an RPC spawn from a child without allowed_subagents, an isolated child, and a child at the cap", async () => {
		const { harness, bus } = await session({}, { alpha: [held().behavior], beta: [held().behavior] });
		const worker = await openChild(harness, bus, "worker", "alpha task");
		const hermit = await openChild(harness, bus, "hermit", "beta task");
		const capped = await session({ maxSubagentDepth: 1 }, { gamma: [held().behavior] });
		const lead = await openChild(capped.harness, capped.bus, "lead", "gamma task");
		const request = { type: "worker", prompt: "nested task", options: { description: "nested" } };
		for (const [record, error] of [
			[worker, 'Agent "worker" has no allowed_subagents; it cannot spawn subagents.'],
			[hermit, 'Agent "hermit" is isolated; it cannot spawn subagents.'],
			[lead, "Nested subagent call blocked (depth=1, max=1). Complete the task directly."],
		] as const) {
			const started = listen(childBus(record), ["subagents:started"]);
			expect(await rpc(childBus(record), "subagents:rpc:spawn", request)).toEqual({ success: false, error });
			await sleep(20);
			expect(started.events).toEqual([]);
		}
	});

	it("refuses an RPC spawn on the bus of an agent whose run has ended", async () => {
		const { harness, bus } = await session();
		const id = await spawnId(bus, {
			type: "lead",
			prompt: "alpha task",
			options: { description: "alpha task", isBackground: true },
		});
		await serviceOf(harness).waitForResult(id);
		const lead = serviceOf(harness).get(id);
		if (!lead) throw new Error("no record");
		// The finished lead's session stays retained, and so does the adapter on its bus.
		const started = listen(childBus(lead), ["subagents:started"]);
		expect(
			await rpc(childBus(lead), "subagents:rpc:spawn", { type: "worker", prompt: "late task", options: {} }),
		).toEqual({ success: false, error: 'Agent "lead" is not running; it cannot spawn subagents.' });
		await sleep(20);
		expect(started.events).toEqual([]);
	});

	it("starts nothing for a spawn whose delegating agent ends while the spawn resolves its model", async () => {
		const { harness, bus } = await session({}, { alpha: [held().behavior] });
		const model = harness.getModel();
		// A worker that names its model makes the spawn resolve it, which the test holds open.
		writeFileSync(
			join(harness.tempDir, "agents", "worker.md"),
			`---\ndescription: test worker\nmodel: ${model.provider}/${model.id}\ntools: read\nextensions: false\n---\nYou are worker.`,
		);
		const lead = await openChild(harness, bus, "lead", "alpha task");
		const started = listen(childBus(lead), ["subagents:started"]);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const runtime = harness.session.modelRuntime;
		const available = runtime.getAvailable.bind(runtime);
		const resolving = vi.spyOn(runtime, "getAvailable").mockImplementation(async () => {
			await gate;
			return available();
		});
		const reply = rpc(childBus(lead), "subagents:rpc:spawn", { type: "worker", prompt: "racing task", options: {} });
		await vi.waitFor(() => expect(resolving).toHaveBeenCalled());
		serviceOf(harness).stop(lead.id);
		release();
		expect(await reply).toEqual({ success: false, error: 'Agent "lead" is not running; it cannot spawn subagents.' });
		await sleep(20);
		expect(started.events).toEqual([]);
	});

	it("spawns a nested agent from a permitted child's bus and reports it on that bus only", async () => {
		const { harness, bus } = await session(
			{},
			{
				alpha: [held().behavior],
				failing: [() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "nested exploded" })],
			},
		);
		const main = listen(bus);
		const lead = await openChild(harness, bus, "lead", "alpha task");
		const inChild = listen(childBus(lead));
		const okId = await spawnId(childBus(lead), { type: "worker", prompt: "nested task", options: {} });
		const failId = await spawnId(childBus(lead), { type: "worker", prompt: "failing task", options: {} });
		const nested = serviceOf(harness).nested(lead);
		await nested.waitForResult(okId);
		await nested.waitForResult(failId);
		expect(inChild.of("subagents:completed").map((payload) => payload.id)).toEqual([okId]);
		expect(inChild.of("subagents:failed").map((payload) => payload.id)).toEqual([failId]);
		expect(main.ids()).not.toContain(okId);
		expect(main.ids()).not.toContain(failId);
		expect(serviceOf(harness).get(okId)).toBeUndefined();
	});

	it("runs a child's RPC and fork-skill spawns in the child's directory, not the session's", async () => {
		const { harness, bus } = await session({}, { alpha: [held().behavior] });
		const work = join(harness.tempDir, "work");
		mkdirSync(work);
		const id = await spawnId(bus, {
			type: "lead",
			prompt: "alpha task",
			options: { description: "alpha task", isBackground: true, cwd: work },
		});
		const lead = serviceOf(harness).get(id);
		await vi.waitFor(() => expect(lead?.child).toBeDefined(), CHILD_START);
		const child = lead?.child;
		if (!lead || !child) throw new Error("no child session");
		const nested = serviceOf(harness).nested(lead);
		const rpcId = await spawnId(childBus(lead), { type: "worker", prompt: "nested task", options: {} });
		expect(nested.get(rpcId)?.cwd).toBe(work);
		const done = await new SkillForkClient(childBus(lead), { session: child.session }).spawn({
			skillId: "/skills/forky/SKILL.md",
			agentType: "worker",
			prompt: "fork task",
			options: {},
			background: false,
		});
		expect(done.kind === "completed" ? nested.get(done.agentId)?.cwd : done.kind).toBe(work);
	});

	it("applies the same refusals and ownership to a context: fork skill run in a child", async () => {
		const { harness, bus } = await session(
			{},
			{ alpha: [held().behavior], beta: [held().behavior], gamma: [held().behavior] },
		);
		const fork = (record: SubagentRecord) => {
			const child = record.child;
			if (!child) throw new Error("no child session");
			return new SkillForkClient(childBus(record), { session: child.session });
		};
		const spawn = (client: SkillForkClient) =>
			client.spawn({
				skillId: "/skills/forky/SKILL.md",
				agentType: "worker",
				prompt: "fork task",
				options: {},
				background: false,
			});
		const worker = await openChild(harness, bus, "worker", "alpha task");
		const hermit = await openChild(harness, bus, "hermit", "beta task");
		const lead = await openChild(harness, bus, "lead", "gamma task");
		let pings = 0;
		childBus(lead).on("subagents:rpc:ping", () => pings++);
		expect(await fork(lead).detectPresence()).toBe(true);
		expect(pings).toBe(0);
		expect(await spawn(fork(worker))).toMatchObject({
			kind: "spawn-failed",
			error: expect.stringMatching(/no allowed_subagents/),
		});
		expect(await spawn(fork(hermit))).toMatchObject({
			kind: "spawn-failed",
			error: expect.stringMatching(/is isolated/),
		});
		const done = await spawn(fork(lead));
		expect(done).toMatchObject({ kind: "completed", ok: true, result: "reply to fork task" });
		const agentId = done.kind === "completed" ? done.agentId : "";
		expect(serviceOf(harness).nested(lead).get(agentId)).toBeDefined();
		expect(serviceOf(harness).get(agentId)).toBeUndefined();

		const capped = await session({ maxSubagentDepth: 1 }, { delta: [held().behavior] });
		const cappedLead = await openChild(capped.harness, capped.bus, "lead", "delta task");
		expect(await spawn(fork(cappedLead))).toMatchObject({
			kind: "spawn-failed",
			error: expect.stringMatching(/Nested subagent call blocked/),
		});
	});
});

describe("skill-agent rewrite maps", () => {
	it("republishes when a skill change frees a bare name, and answers a query with the latest revision", async () => {
		const { harness, bus } = await session();
		const maps = listen(bus, [SKILL_AGENTS_REWRITE_MAPS_CHANNEL]);
		const audit = skill(harness.tempDir, "audit", { reviewer: "description: audit reviewer" });
		const style = skill(harness.tempDir, "style", { reviewer: "description: style reviewer" });
		getSkillSetController(bus).publish([audit, style]);
		getSkillSetController(bus).publish([audit]);
		const [claimed, freed] = maps.of(SKILL_AGENTS_REWRITE_MAPS_CHANNEL) as unknown as SkillAgentRewriteMapsEvent[];
		expect(claimed.maps[audit.id].reviewer).toEqual({ qualified: "audit:reviewer", collided: true });
		expect(freed.maps[audit.id].reviewer).toEqual({ qualified: "audit:reviewer", collided: false });
		expect(freed.revision).toBeGreaterThan(claimed.revision);
		const requestId = randomUUID();
		const answer = new Promise((resolve) => bus.on(skillAgentsQueryReplyChannel(requestId), resolve));
		bus.emit(SKILL_AGENTS_QUERY_CHANNEL, { requestId });
		expect(await answer).toEqual({ success: true, data: freed });
	});

	it("builds a child's maps from the session's project, whatever directory the child works in", async () => {
		const { harness, bus } = await session({}, { alpha: [held().behavior] });
		// The project's skill bundles `reviewer`; the child works in a directory whose own agent has that name.
		skill(join(harness.tempDir, ".pi"), "audit", { reviewer: "description: audit reviewer" });
		const elsewhere = mkdtempSync(join(tmpdir(), "pi-subagent-elsewhere-"));
		mkdirSync(join(elsewhere, ".pi", "agents"), { recursive: true });
		writeFileSync(join(elsewhere, ".pi", "agents", "reviewer.md"), "---\ndescription: elsewhere\n---\nReview.");
		const id = await spawnId(bus, {
			type: "worker",
			prompt: "alpha task",
			options: { description: "alpha", isBackground: true, cwd: elsewhere },
		});
		const record = serviceOf(harness).get(id);
		await vi.waitFor(() => expect(record?.child).toBeDefined(), CHILD_START);
		if (!record) throw new Error("no record");
		const requestId = randomUUID();
		const answer = new Promise((resolve) => childBus(record).on(skillAgentsQueryReplyChannel(requestId), resolve));
		childBus(record).emit(SKILL_AGENTS_QUERY_CHANNEL, { requestId });
		const { data } = (await answer) as { data: SkillAgentRewriteMapsEvent };
		// The child also loads skills from the user's own directories; only the project's audit skill matters here.
		const audit = Object.entries(data.maps).filter(([skillId]) => skillId.endsWith(join("audit", "SKILL.md")));
		expect(audit.map(([, map]) => map.reviewer)).toEqual([{ qualified: "audit:reviewer", collided: false }]);
		rmSync(elsewhere, { recursive: true, force: true });
	});

	it("republishes after a definition reload changes a collision, and stays quiet when nothing changes", async () => {
		const { harness, bus } = await session();
		const maps = listen(bus, [SKILL_AGENTS_REWRITE_MAPS_CHANNEL]);
		const audit = skill(harness.tempDir, "audit", { reviewer: "description: audit reviewer" });
		getSkillSetController(bus).publish([audit]);
		const service = serviceOf(harness);
		const collisions = () =>
			(maps.of(SKILL_AGENTS_REWRITE_MAPS_CHANNEL) as unknown as SkillAgentRewriteMapsEvent[]).map((event) => [
				event.revision,
				event.maps[audit.id].reviewer.collided,
			]);
		const project = join(harness.tempDir, "agents", "reviewer.md");
		writeFileSync(project, "---\ndescription: project reviewer\n---\nReview.");
		await spawnId(bus, { type: "worker", prompt: "reload task", options: {} });
		writeFileSync(project, "---\ndescription: project reviewer\nenabled: false\n---\nReview.");
		service.refreshDefinitions();
		// A switched-off agent keeps its bare name (handoff D30), so nothing changes.
		expect(collisions()).toHaveLength(2);
		rmSync(project);
		service.refreshDefinitions();
		service.refreshDefinitions();
		expect(collisions()).toEqual([
			[1, false],
			[2, true],
			[3, false],
		]);
	});
});

describe("readiness", () => {
	it("announces subagents:ready at construction and on each /reload, and answers one ping once", async () => {
		const bus = createEventBus();
		let ready = 0;
		bus.on("subagents:ready", () => ready++);
		const { harness } = await session({}, {}, { eventBus: bus });
		await harness.session.reload();
		await harness.session.reload();
		await sleep(0);
		expect(ready).toBe(3);
		const requestId = randomUUID();
		let replies = 0;
		bus.on(`subagents:rpc:ping:reply:${requestId}`, () => replies++);
		bus.emit("subagents:rpc:ping", { requestId });
		await sleep(20);
		expect(replies).toBe(1);
	});

	it("stops answering after dispose", async () => {
		const { harness, bus } = await session();
		harness.session.dispose();
		const requestId = randomUUID();
		let replies = 0;
		bus.on(`subagents:rpc:ping:reply:${requestId}`, () => replies++);
		bus.emit("subagents:rpc:ping", { requestId });
		await sleep(100);
		expect(replies).toBe(0);
	});
});
