/**
 * C3b `context: fork` execution end-to-end (A.5 fork matrix + A.9 ordering), plus
 * focused SkillForkClient unit tests. The integration rows drive AgentSession with the
 * faux provider and the stub subagents extension registered on ONE shared event bus, and
 * assert on the delivery / tool result / recorded spawn options the session produced —
 * never `env` (v0.15.1 has none). No real APIs/keys.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type Context,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { ExtensionAPI } from "../../src/core/extensions/index.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { sessionEntryToContextMessages } from "../../src/core/session-manager.ts";
import {
	SKILL_AGENTS_QUERY_CHANNEL,
	SKILL_AGENTS_REWRITE_MAPS_CHANNEL,
	type SkillAgentRewriteMaps,
	skillAgentsQueryReplyChannel,
} from "../../src/core/skills/runtime.ts";
import { normalizeAgentEnded, normalizeSubagentCompletion, SkillForkClient } from "../../src/core/skills/skill-fork.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { canonicalizePath } from "../../src/utils/paths.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";
import {
	createStubSubagentsExtension,
	STUB_PROTOCOL_VERSION,
	STUB_PROTOCOL_VERSION_V3,
	type StubSubagentsController,
	type StubSubagentsOptions,
	stubReplyChannel,
} from "./support/stub-subagents-extension.ts";

const SENTINEL = "FORKBODYSENTINEL42";
const FAST_TIMEOUTS = { spawnReplyTimeoutMs: 80, foregroundCapMs: 200, pingTimeoutMs: 80 };

const tempDirs: string[] = [];
const harnesses: Harness[] = [];

afterEach(() => {
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-c3b-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

interface SkillFixture {
	name: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

function createSkillsLoader(
	tempDir: string,
	fixtures: SkillFixture[],
	eventBus: ReturnType<typeof createEventBus>,
): ResourceLoader {
	const skills = fixtures.map((fixture) => {
		const baseDir = join(tempDir, fixture.name);
		mkdirSync(baseDir, { recursive: true });
		const filePath = join(baseDir, "SKILL.md");
		writeFileSync(filePath, fixture.body);
		return {
			name: fixture.name,
			description: `${fixture.name} skill`,
			filePath,
			disableModelInvocation: false,
			baseDir,
			sourceInfo: createSyntheticSourceInfo(filePath, {
				source: "local" as const,
				scope: "project" as const,
				origin: "top-level" as const,
				baseDir,
			}),
			...(fixture.frontmatter &&
				Object.keys(fixture.frontmatter).length > 0 && { frontmatter: fixture.frontmatter }),
		};
	});
	return {
		...createTestResourceLoader({ eventBus }),
		getSkills: () => ({ skills, diagnostics: [] }),
	};
}

interface ForkHarnessOptions {
	stub?: StubSubagentsController;
	mode?: "tui" | "print";
	tools?: AgentTool[];
}

const MODELS = [
	{ id: "session-model", reasoning: true },
	{ id: "opus-model", reasoning: true },
];

async function createForkHarness(fixtures: SkillFixture[], options: ForkHarnessOptions = {}): Promise<Harness> {
	const tempDir = makeTempDir();
	const eventBus = createEventBus();
	const resourceLoader = createSkillsLoader(tempDir, fixtures, eventBus);
	const harness = await createHarness({
		models: MODELS,
		resourceLoader,
		eventBus,
		skillForkTimeouts: FAST_TIMEOUTS,
		...(options.tools && { tools: options.tools }),
		...(options.stub && { extensionFactories: [{ factory: options.stub.factory }] }),
	});
	harnesses.push(harness);
	// Non-print mode so fork routing does not universally degrade to inline (the default
	// mode is "print"). The headless test opts into "print" explicitly.
	await harness.session.bindExtensions({ mode: options.mode ?? "tui" });
	return harness;
}

/** All fork notice (display-only custom message) texts in the transcript. */
function forkNotices(harness: Harness): string[] {
	return harness.session.messages
		.filter((message) => message.role === "custom" && message.customType === "skill_fork")
		.map((message) => getMessageText(message));
}

/** The rendered `<skill>` delivery text, if the fork degraded to inline. */
function inlineSkillDelivery(harness: Harness, name: string): string | undefined {
	const message = harness.session.messages.find(
		(m) => m.role === "user" && getMessageText(m).includes(`<skill name="${name}"`),
	);
	return message ? getMessageText(message) : undefined;
}

function allTranscriptText(harness: Harness): string {
	return harness.session.messages.map((message) => getMessageText(message)).join("\n");
}

interface CapturedRequest {
	text: string;
	toolNames: string[];
}

function captureRequest(sink: CapturedRequest[], reply = "ok"): FauxResponseFactory {
	return (context: Context, _options: SimpleStreamOptions | undefined) => {
		sink.push({
			text: context.messages.map((message) => getMessageText(message)).join("\n"),
			toolNames: (context.tools ?? []).map((tool) => tool.name),
		});
		return fauxAssistantMessage(reply);
	};
}

function collectErrors(harness: Harness): string[] {
	const errors: string[] = [];
	harness.session.extensionRunner.onError((error) => {
		errors.push(`${error.event}: ${error.error}`);
	});
	return errors;
}

// ---------------------------------------------------------------------------
// SkillForkClient (unit)
// ---------------------------------------------------------------------------

function boundStub(options: StubSubagentsOptions = {}): {
	bus: ReturnType<typeof createEventBus>;
	stub: StubSubagentsController;
} {
	const bus = createEventBus();
	const stub = createStubSubagentsExtension(options);
	stub.factory({ events: bus } as unknown as ExtensionAPI);
	return { bus, stub };
}

const CLIENT_OPTIONS = { spawnReplyTimeoutMs: 80, foregroundCapMs: 200, pingTimeoutMs: 80 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 15));

describe("SkillForkClient: presence detection", () => {
	it("detects a present stub via ping and reports absent with no reply", async () => {
		const present = boundStub();
		const presentClient = new SkillForkClient(present.bus, CLIENT_OPTIONS);
		expect(await presentClient.detectPresence()).toBe(true);

		const absent = boundStub({ present: false });
		const absentClient = new SkillForkClient(absent.bus, CLIENT_OPTIONS);
		expect(await absentClient.detectPresence()).toBe(false);
	});

	it("invalidates a cached negative when subagents:ready fires, then re-probes present", async () => {
		const bus = createEventBus();
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		expect(await client.detectPresence()).toBe(false);

		// A subagents extension loads mid-session: it starts answering pings and broadcasts ready.
		bus.on("subagents:rpc:ping", (raw) => {
			const { requestId } = raw as { requestId: string };
			bus.emit(stubReplyChannel("subagents:rpc:ping", requestId), { success: true, data: { version: 2 } });
		});
		bus.emit("subagents:ready", {});
		expect(await client.detectPresence()).toBe(true);
	});

	it("re-negotiates version and capabilities when subagents:ready fires again", async () => {
		// The peer changed under the session (extension upgrade/downgrade + /reload):
		// ready must invalidate the cached probe AND the captured negotiation, or the
		// capability gate keeps a stale verdict in both directions.
		const bus = createEventBus();
		let ping: { version: number; capabilities?: { skillAgents: boolean } } = { version: 2 };
		bus.on("subagents:rpc:ping", (raw) => {
			const { requestId } = raw as { requestId: string };
			bus.emit(stubReplyChannel("subagents:rpc:ping", requestId), { success: true, data: ping });
		});
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		expect(await client.detectPresence()).toBe(true);
		expect(client.getDetectedVersion()).toBe(2);
		expect(client.isSkillAgentsCapable()).toBe(false);

		// Upgrade: the next probe must see v3 + skillAgents, not the cached v2.
		ping = { version: 3, capabilities: { skillAgents: true } };
		bus.emit("subagents:ready", {});
		expect(await client.detectPresence()).toBe(true);
		expect(client.getDetectedVersion()).toBe(3);
		expect(client.isSkillAgentsCapable()).toBe(true);

		// Downgrade: a stale capable verdict would leak qualified types to a v2 peer.
		ping = { version: 2 };
		bus.emit("subagents:ready", {});
		expect(await client.detectPresence()).toBe(true);
		expect(client.getDetectedVersion()).toBe(2);
		expect(client.isSkillAgentsCapable()).toBe(false);
	});
});

describe("SkillForkClient: spawn outcomes", () => {
	it("spawns a background fork and clears the guard on completion", async () => {
		const { bus, stub } = boundStub();
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		const completions: string[] = [];
		const outcome = await client.spawn({
			skillId: "s1",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: true,
			onBackgroundComplete: (c) => completions.push(c.result ?? ""),
		});
		expect(outcome.kind).toBe("spawned-background");
		expect(client.hasLiveBackground("s1")).toBe(true);
		const agentId = stub.spawns[0].agentId;
		stub.complete(agentId, { result: "bg-done" });
		expect(completions).toEqual(["bg-done"]);
		expect(client.hasLiveBackground("s1")).toBe(false);
	});

	it("blocks a concurrent second background spawn of the same skill (atomic guard)", async () => {
		const { bus, stub } = boundStub();
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		const [a, b] = await Promise.all([
			client.spawn({ skillId: "s", agentType: undefined, prompt: "p", options: {}, background: true }),
			client.spawn({ skillId: "s", agentType: undefined, prompt: "p", options: {}, background: true }),
		]);
		expect([a.kind, b.kind].sort()).toEqual(["repeat-blocked", "spawned-background"]);
		expect(stub.spawns.length).toBe(1);
	});

	it("correlates a completion emitted BEFORE the spawn reply (buffering race)", async () => {
		const fg = boundStub({ autoComplete: { when: "before-reply", result: "raced" } });
		const fgClient = new SkillForkClient(fg.bus, CLIENT_OPTIONS);
		const outcome = await fgClient.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: false,
		});
		expect(outcome).toMatchObject({ kind: "completed", ok: true, result: "raced" });

		const bg = boundStub({ autoComplete: { when: "before-reply", result: "raced-bg" } });
		const bgClient = new SkillForkClient(bg.bus, CLIENT_OPTIONS);
		const seen: string[] = [];
		const bgOutcome = await bgClient.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: true,
			onBackgroundComplete: (c) => seen.push(c.result ?? ""),
		});
		expect(bgOutcome.kind).toBe("spawned-background");
		expect(seen).toEqual(["raced-bg"]);
		expect(bgClient.hasLiveBackground("s")).toBe(false);
	});

	it("ignores a duplicate or unknown-id completion", async () => {
		const { bus, stub } = boundStub();
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		const seen: string[] = [];
		await client.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: true,
			onBackgroundComplete: (c) => seen.push(c.agentId),
		});
		const agentId = stub.spawns[0].agentId;
		stub.complete(agentId, { result: "one" });
		stub.complete(agentId, { result: "duplicate" });
		stub.emitRaw("completed", { id: "never-spawned", status: "completed" });
		expect(seen).toEqual([agentId]);
	});

	it("returns spawn-failed on an error envelope and on a spawn-reply timeout", async () => {
		const errored = boundStub({ spawnError: "no active session" });
		const erroredClient = new SkillForkClient(errored.bus, CLIENT_OPTIONS);
		const failed = await erroredClient.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: true,
		});
		expect(failed).toMatchObject({ kind: "spawn-failed" });
		expect(erroredClient.hasLiveBackground("s")).toBe(false);

		const silent = boundStub({ neverReply: true });
		const silentClient = new SkillForkClient(silent.bus, CLIENT_OPTIONS);
		const timedOut = await silentClient.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: true,
		});
		expect(timedOut.kind).toBe("spawn-failed");
		expect(silentClient.hasLiveBackground("s")).toBe(false);
	});

	it("caps a foreground wait and settles an aborted wait promptly", async () => {
		const { bus, stub } = boundStub();
		const capClient = new SkillForkClient(bus, { ...CLIENT_OPTIONS, foregroundCapMs: 40 });
		const capped = await capClient.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: false,
		});
		expect(capped.kind).toBe("foreground-timeout");

		const controller = new AbortController();
		const abortClient = new SkillForkClient(bus, { ...CLIENT_OPTIONS, foregroundCapMs: 10_000 });
		const pending = abortClient.spawn({
			skillId: "s2",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: false,
			signal: controller.signal,
		});
		await flush();
		controller.abort();
		const aborted = await pending;
		expect(aborted.kind).toBe("aborted");
		expect(stub.stops.length).toBeGreaterThan(0);
	});

	it("dispose settles a pending foreground wait as aborted", async () => {
		const { bus } = boundStub();
		const client = new SkillForkClient(bus, { ...CLIENT_OPTIONS, foregroundCapMs: 10_000 });
		const pending = client.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: false,
		});
		await flush();
		client.dispose();
		expect((await pending).kind).toBe("aborted");
	});

	it("forwards the agent type and an unknown type unchanged (spawns as requested)", async () => {
		const { bus, stub } = boundStub();
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		await client.spawn({ skillId: "a", agentType: "custom-agent", prompt: "p", options: {}, background: true });
		await client.spawn({ skillId: "b", agentType: undefined, prompt: "p", options: {}, background: true });
		expect(stub.spawns[0].type).toBe("custom-agent");
		expect(stub.spawns[1].type).toBe("general-purpose");
	});
});

describe("normalizeSubagentCompletion", () => {
	it("decides ok by channel and carries status", () => {
		expect(normalizeSubagentCompletion("subagents:completed", { id: "x", result: "r", status: "steered" })).toEqual({
			agentId: "x",
			ok: true,
			result: "r",
			status: "steered",
		});
		expect(normalizeSubagentCompletion("subagents:failed", { id: "y", error: "boom", status: "error" })).toEqual({
			agentId: "y",
			ok: false,
			error: "boom",
			status: "error",
		});
	});
});

describe("normalizeAgentEnded (WI-3)", () => {
	it("correlates by agentId and treats non-hard-failure statuses as ok", () => {
		expect(normalizeAgentEnded({ agentId: "a", status: "completed", result: "r" })).toEqual({
			agentId: "a",
			ok: true,
			result: "r",
			status: "completed",
		});
		// steered is a fork-native success emitted on the completed channel.
		expect(normalizeAgentEnded({ agentId: "b", status: "steered", result: "wrapped" })).toEqual({
			agentId: "b",
			ok: true,
			result: "wrapped",
			status: "steered",
		});
		for (const status of ["error", "aborted", "stopped"] as const) {
			expect(normalizeAgentEnded({ agentId: "c", status, error: "boom" })).toEqual({
				agentId: "c",
				ok: false,
				error: "boom",
				status,
			});
		}
		// A payload without a string status is malformed: dropped (undefined), never
		// guessed as a success.
		expect(normalizeAgentEnded(null)).toBeUndefined();
		expect(normalizeAgentEnded({ agentId: "m" })).toBeUndefined();
		expect(normalizeAgentEnded({ agentId: "m", status: 3 })).toBeUndefined();
	});
});

describe("SkillForkClient: v3 negotiation and agent-ended (WI-3)", () => {
	it("captures version and skillAgents capability from a v3 ping", async () => {
		const v3 = boundStub({ protocolVersion: 3, skillAgents: true });
		const v3Client = new SkillForkClient(v3.bus, CLIENT_OPTIONS);
		expect(await v3Client.detectPresence()).toBe(true);
		expect(v3Client.getDetectedVersion()).toBe(STUB_PROTOCOL_VERSION_V3);
		expect(v3Client.isSkillAgentsCapable()).toBe(true);

		const v2 = boundStub();
		const v2Client = new SkillForkClient(v2.bus, CLIENT_OPTIONS);
		expect(await v2Client.detectPresence()).toBe(true);
		expect(v2Client.getDetectedVersion()).toBe(STUB_PROTOCOL_VERSION);
		expect(v2Client.isSkillAgentsCapable()).toBe(false);
	});

	it("settles a foreground fork from agent-ended alone, deriving ok from status", async () => {
		for (const [status, expectedOk] of [
			["completed", true],
			["steered", true],
			["error", false],
			["aborted", false],
			["stopped", false],
		] as const) {
			const { bus } = boundStub({
				protocolVersion: 3,
				skillAgents: true,
				autoComplete: { when: "after-reply", status, result: "r", error: "e" },
			});
			const client = new SkillForkClient(bus, CLIENT_OPTIONS);
			const outcome = await client.spawn({
				skillId: `s-${status}`,
				agentType: undefined,
				prompt: "p",
				options: {},
				background: false,
			});
			expect(outcome).toMatchObject(
				expectedOk
					? { kind: "completed", ok: true, status, result: "r" }
					: { kind: "completed", ok: false, status, error: "e" },
			);
		}
	});

	it("buffers an agent-ended emitted BEFORE the spawn reply (ordering race)", async () => {
		const { bus } = boundStub({
			protocolVersion: 3,
			skillAgents: true,
			autoComplete: { when: "before-reply", status: "completed", result: "raced-v3" },
		});
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		const outcome = await client.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: false,
		});
		expect(outcome).toMatchObject({ kind: "completed", ok: true, result: "raced-v3" });
	});

	it("keeps the first buffered completion when two channels race before the reply", async () => {
		// A v3 fork that also emits the v2 broadcast: before the reply the client
		// buffers, and the first event must win (not be overwritten by the second).
		const bus = createEventBus();
		let spawnRequestId: string | undefined;
		bus.on("subagents:rpc:ping", (raw) => {
			const { requestId } = raw as { requestId: string };
			bus.emit(stubReplyChannel("subagents:rpc:ping", requestId), {
				success: true,
				data: { version: STUB_PROTOCOL_VERSION_V3, capabilities: { skillAgents: true } },
			});
		});
		bus.on("subagents:rpc:spawn", (raw) => {
			const { requestId } = raw as { requestId: string };
			spawnRequestId = requestId;
			// Two channels for the same agent, BEFORE the spawn reply. First wins.
			bus.emit("subagents:completed", { id: "race-agent", status: "completed", result: "first" });
			bus.emit("subagents:agent-ended", { agentId: "race-agent", status: "completed", result: "second" });
			bus.emit(stubReplyChannel("subagents:rpc:spawn", requestId), { success: true, data: { id: "race-agent" } });
		});
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		const outcome = await client.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: false,
		});
		expect(spawnRequestId).toBeDefined();
		expect(outcome).toMatchObject({ kind: "completed", ok: true, result: "first" });
	});

	it("delivers a pre-reply dual-emit exactly once to a background collector", async () => {
		// Same dual-emit race, observed through the background callback: the
		// collector must see exactly ONE delivery, carrying the FIRST payload (a
		// foreground promise can only observe one resolution, so it cannot
		// distinguish one delivery from two).
		const bus = createEventBus();
		bus.on("subagents:rpc:ping", (raw) => {
			const { requestId } = raw as { requestId: string };
			bus.emit(stubReplyChannel("subagents:rpc:ping", requestId), {
				success: true,
				data: { version: STUB_PROTOCOL_VERSION_V3, capabilities: { skillAgents: true } },
			});
		});
		bus.on("subagents:rpc:spawn", (raw) => {
			const { requestId } = raw as { requestId: string };
			bus.emit("subagents:completed", { id: "race-bg", status: "completed", result: "first" });
			bus.emit("subagents:agent-ended", { agentId: "race-bg", status: "completed", result: "second" });
			bus.emit(stubReplyChannel("subagents:rpc:spawn", requestId), { success: true, data: { id: "race-bg" } });
		});
		const client = new SkillForkClient(bus, CLIENT_OPTIONS);
		const delivered: string[] = [];
		const outcome = await client.spawn({
			skillId: "s",
			agentType: undefined,
			prompt: "p",
			options: {},
			background: true,
			onBackgroundComplete: (completion) => delivered.push(completion.result ?? ""),
		});
		expect(outcome).toMatchObject({ kind: "spawned-background", agentId: "race-bg" });
		await flush();
		expect(delivered).toEqual(["first"]);
	});
});

describe("stub v3 mode (WI-4)", () => {
	it("advertises v3 with capabilities and answers the rewrite-map query", async () => {
		const bus = createEventBus();
		const stub = createStubSubagentsExtension({ protocolVersion: 3, skillAgents: true });
		stub.factory({ events: bus } as unknown as ExtensionAPI);

		let ping: unknown;
		bus.on(stubReplyChannel("subagents:rpc:ping", "p1"), (data) => {
			ping = data;
		});
		bus.emit("subagents:rpc:ping", { requestId: "p1" });
		expect(ping).toEqual({
			success: true,
			data: { version: STUB_PROTOCOL_VERSION_V3, capabilities: { skillAgents: true } },
		});

		const maps: SkillAgentRewriteMaps = { "/id/a": { reviewer: { qualified: "a:reviewer", collided: true } } };
		const rewriteEvents: unknown[] = [];
		bus.on(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, (data) => rewriteEvents.push(data));
		stub.publishRewriteMaps(maps, 5);
		expect(rewriteEvents).toEqual([{ revision: 5, maps }]);

		let queryReply: unknown;
		bus.on(skillAgentsQueryReplyChannel("q1"), (data) => {
			queryReply = data;
		});
		bus.emit(SKILL_AGENTS_QUERY_CHANNEL, { requestId: "q1" });
		expect(queryReply).toEqual({ success: true, data: { revision: 5, maps } });
	});

	it("emits agent-ended with the requested status via endAgent", () => {
		const bus = createEventBus();
		const stub = createStubSubagentsExtension({ protocolVersion: 3, skillAgents: true });
		stub.factory({ events: bus } as unknown as ExtensionAPI);
		const ended: unknown[] = [];
		bus.on("subagents:agent-ended", (data) => ended.push(data));
		// The no-completion default is a bare completed event (the common WS2 path).
		stub.endAgent("agent-0");
		stub.endAgent("agent-1", { status: "steered", result: "wrapped" });
		expect(ended).toEqual([
			{ agentId: "agent-0", status: "completed" },
			{ agentId: "agent-1", status: "steered", result: "wrapped" },
		]);
	});
});

// ---------------------------------------------------------------------------
// Fork routing through AgentSession (integration)
// ---------------------------------------------------------------------------

const forkBg: SkillFixture = {
	name: "forkbg",
	body: `${SENTINEL} background body`,
	frontmatter: { context: "fork", background: true },
};
const forkFg: SkillFixture = {
	name: "forkfg",
	body: `${SENTINEL} foreground body`,
	frontmatter: { context: "fork", background: false },
};

describe("C3b fork routing: user/synthetic sole-skill delivery", () => {
	it("background: spawn notice, no parent request over the content, follow-up on completion", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkbg");

		expect(stub.spawns.length).toBe(1);
		expect(stub.spawns[0].options.isBackground).toBe(true);
		expect(harness.faux.state.callCount).toBe(0);
		const notices = forkNotices(harness);
		expect(notices.some((text) => text.includes("running in a background subagent"))).toBe(true);
		// The rendered fork body never reaches the parent transcript.
		expect(allTranscriptText(harness)).not.toContain(SENTINEL);

		stub.complete(stub.spawns[0].agentId, { result: "bg result" });
		expect(forkNotices(harness).some((text) => text.includes("completed: bg result"))).toBe(true);
	});

	it("foreground: awaits and delivers the result as a follow-up notice (not a tool error)", async () => {
		const stub = createStubSubagentsExtension({ autoComplete: { when: "after-reply", result: "fg result" } });
		const harness = await createForkHarness([forkFg], { stub });
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkfg");

		expect(harness.faux.state.callCount).toBe(0);
		expect(stub.spawns[0].options.isBackground).toBe(false);
		expect(forkNotices(harness).some((text) => text.includes("completed: fg result"))).toBe(true);
		expect(allTranscriptText(harness)).not.toContain(SENTINEL);
	});

	it("foreground failure (user): the error/status arrives as a follow-up notice", async () => {
		const stub = createStubSubagentsExtension({
			autoComplete: { when: "after-reply", channel: "failed", error: "kaboom", status: "error" },
		});
		const harness = await createForkHarness([forkFg], { stub });
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkfg");

		expect(harness.faux.state.callCount).toBe(0);
		const notices = forkNotices(harness);
		expect(notices.some((text) => text.includes("failed") && text.includes("kaboom"))).toBe(true);
	});

	it("blocks a repeat background fork while one is live, then allows it after completion", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([]);

		await harness.session.prompt("/skill:forkbg");
		await harness.session.prompt("/skill:forkbg");
		expect(stub.spawns.length).toBe(1);
		expect(forkNotices(harness).some((text) => text.includes("already running"))).toBe(true);

		stub.complete(stub.spawns[0].agentId, { result: "done" });
		await harness.session.prompt("/skill:forkbg");
		expect(stub.spawns.length).toBe(2);
	});
});

describe("C3b fork routing: model skill tool", () => {
	it("background: the tool result is an ack, never the rendered content", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkbg" })], { stopReason: "toolUse" }),
			captureRequest(requests, "after ack"),
		]);

		await harness.session.prompt("do it");

		const toolResult = harness.session.messages.find((m) => m.role === "toolResult");
		const toolText = toolResult ? getMessageText(toolResult) : "";
		expect(toolText).toContain(stub.spawns[0].agentId);
		expect(toolText).toContain("background");
		expect(toolText).not.toContain(SENTINEL);
		// The continuation request never carries the fork body either.
		expect(requests.every((request) => !request.text.includes(SENTINEL))).toBe(true);
	});

	it("foreground success: the tool result is the subagent result", async () => {
		const stub = createStubSubagentsExtension({ autoComplete: { when: "after-reply", result: "the result" } });
		const harness = await createForkHarness([forkFg], { stub });
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkfg" })], { stopReason: "toolUse" }),
			captureRequest([], "done"),
		]);

		await harness.session.prompt("do it");

		const toolResult = harness.session.messages.find((m) => m.role === "toolResult");
		expect(toolResult ? getMessageText(toolResult) : "").toContain("the result");
	});

	it("foreground failure: the tool result is a tool error carrying the status", async () => {
		const stub = createStubSubagentsExtension({
			autoComplete: { when: "after-reply", channel: "failed", error: "explode", status: "error" },
		});
		const harness = await createForkHarness([forkFg], { stub });
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkfg" })], { stopReason: "toolUse" }),
			captureRequest([], "done"),
		]);

		await harness.session.prompt("do it");

		const toolResult = harness.session.messages.find((m) => m.role === "toolResult");
		expect(toolResult).toBeDefined();
		expect((toolResult as { isError?: boolean }).isError).toBe(true);
		expect(getMessageText(toolResult!)).toContain("explode");
	});
});

describe("C3b fork routing: degradation", () => {
	it("degrades to inline delivery + one diagnostic when no subagents extension is present", async () => {
		const harness = await createForkHarness([forkBg]);
		const errors = collectErrors(harness);
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkbg");

		// Inline delivery runs a normal parent turn over the rendered body.
		expect(harness.faux.state.callCount).toBe(1);
		expect(inlineSkillDelivery(harness, "forkbg")).toContain(SENTINEL);
		expect(errors.filter((message) => message.includes("running inline instead of forking")).length).toBe(1);
	});

	it("degrades in headless-print mode even when a subagents extension is present", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub, mode: "print" });
		const errors = collectErrors(harness);
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkbg");

		expect(stub.spawns.length).toBe(0);
		expect(harness.faux.state.callCount).toBe(1);
		expect(errors.some((message) => message.includes("running inline instead of forking"))).toBe(true);
	});

	it("degrades to inline on a spawn-error envelope", async () => {
		const stub = createStubSubagentsExtension({ spawnError: "no active session" });
		const harness = await createForkHarness([forkBg], { stub });
		const errors = collectErrors(harness);
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkbg");

		expect(harness.faux.state.callCount).toBe(1);
		expect(inlineSkillDelivery(harness, "forkbg")).toContain(SENTINEL);
		expect(errors.some((message) => message.includes("fork spawn failed"))).toBe(true);
	});

	it("degrades to inline when the spawn is never acknowledged (reply timeout)", async () => {
		const stub = createStubSubagentsExtension({ neverReply: true });
		const harness = await createForkHarness([forkBg], { stub });
		const errors = collectErrors(harness);
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkbg");

		expect(harness.faux.state.callCount).toBe(1);
		expect(errors.some((message) => message.includes("running inline instead of forking"))).toBe(true);
	});
});

describe("C3b fork routing: spawn options + parent isolation", () => {
	it("passes the resolved model and isBackground but never env", async () => {
		const stub = createStubSubagentsExtension();
		const fixture: SkillFixture = {
			name: "forkmodel",
			body: `${SENTINEL} model body`,
			frontmatter: { context: "fork", background: true, model: "opus-model" },
		};
		const harness = await createForkHarness([fixture], { stub });
		harness.setResponses([]);

		await harness.session.prompt("/skill:forkmodel");

		const options = stub.spawns[0].options;
		expect(options.model).toBe("faux/opus-model");
		expect(options.isBackground).toBe(true);
		expect("env" in options).toBe(false);
	});

	it("forwards the agent type and spawns an unknown type without degrading to inline", async () => {
		const stub = createStubSubagentsExtension();
		const fixture: SkillFixture = {
			name: "forkagent",
			body: `${SENTINEL} agent body`,
			frontmatter: { context: "fork", background: true, agent: "mystery-agent" },
		};
		const harness = await createForkHarness([fixture], { stub });
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkagent");

		expect(stub.spawns.length).toBe(1);
		expect(stub.spawns[0].type).toBe("mystery-agent");
		// No inline fallback: the parent never runs a turn over the body.
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("does not activate a fork record in the parent runtime (no override union leak)", async () => {
		const stub = createStubSubagentsExtension();
		const fixture: SkillFixture = {
			name: "forkoverride",
			body: `${SENTINEL} override body`,
			frontmatter: { context: "fork", background: true, model: "opus-model", "disallowed-tools": "read" },
		};
		const harness = await createForkHarness([fixture], { stub });
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("/skill:forkoverride");

		// A fork never enters the runtime, so no active invocation governs the parent turn.
		expect(harness.session.skillRuntime.getActiveInvocations().length).toBe(0);
		expect(harness.session.agent.pendingTurnOverride).toBeUndefined();
	});

	it("keeps a persisted fork notice out of LLM context after reconstruction (excludeFromContext round-trip)", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([]);

		await harness.session.prompt("/skill:forkbg");
		stub.complete(stub.spawns[0].agentId, { result: "secret-bg-result" });

		// The completion notice was recorded and persisted as a skill_fork custom_message entry.
		expect(forkNotices(harness).some((text) => text.includes("secret-bg-result"))).toBe(true);
		const persisted = harness.sessionManager
			.getEntries()
			.filter((entry) => entry.type === "custom_message" && entry.customType === "skill_fork");
		expect(persisted.length).toBeGreaterThan(0);

		// Reconstructing the session (the reload path) must not leak the notice into LLM context.
		const contextMessages = harness.sessionManager.getEntries().flatMap(sessionEntryToContextMessages);
		const llmText = JSON.stringify(convertToLlm(contextMessages));
		expect(llmText).not.toContain("secret-bg-result");
		expect(llmText).not.toContain("running in a background subagent");
	});

	it("warns (not silently inline) for a non-sole mid-prompt fork", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		const errors = collectErrors(harness);
		harness.setResponses([captureRequest([])]);

		await harness.session.prompt("please run /skill:forkbg now");

		expect(stub.spawns.length).toBe(0);
		expect(errors.some((message) => message.includes("only for a sole message-initial skill"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Fork routing through the queued (steer/followUp) sole-skill path
// ---------------------------------------------------------------------------

/** A tool that blocks until released, holding the turn streaming so a queued message is consumed. */
function waitTool(): { tool: AgentTool; release: () => void } {
	let releaseExecution: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		releaseExecution = resolve;
	});
	const tool: AgentTool = {
		name: "wait",
		label: "Wait",
		description: "Wait for release",
		parameters: Type.Object({}),
		execute: async () => {
			await gate;
			return { content: [{ type: "text", text: "released" }], details: {} };
		},
	};
	return { tool, release: () => releaseExecution?.() };
}

function waitForWaitToolStart(harness: Harness): Promise<void> {
	return new Promise<void>((resolve) => {
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "wait") {
				unsubscribe();
				resolve();
			}
		});
	});
}

describe("C3b fork routing: queued (steer/followUp) sole-skill delivery", () => {
	it("background: a queued fork spawns without delivering the body to the parent", async () => {
		const stub = createStubSubagentsExtension();
		const { tool, release } = waitTool();
		const harness = await createForkHarness([forkBg], { stub, tools: [tool] });
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			(_c, _o, _s, _m) => fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			captureRequest(requests, "done"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.followUp("/skill:forkbg");
		release();
		await promptPromise;

		expect(stub.spawns.length).toBe(1);
		expect(stub.spawns[0].options.isBackground).toBe(true);
		expect(forkNotices(harness).some((text) => text.includes("running in a background subagent"))).toBe(true);
		// The queued fork body reaches neither the transcript nor the continuation request.
		expect(allTranscriptText(harness)).not.toContain(SENTINEL);
		expect(requests.every((request) => !request.text.includes(SENTINEL))).toBe(true);
	});

	it("foreground: a queued fork awaits and stays foreground (not narrowed to background)", async () => {
		const stub = createStubSubagentsExtension({ autoComplete: { when: "after-reply", result: "queued fg" } });
		const { tool, release } = waitTool();
		const harness = await createForkHarness([forkFg], { stub, tools: [tool] });
		const requests: CapturedRequest[] = [];
		harness.setResponses([
			(_c, _o, _s, _m) => fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			captureRequest(requests, "done"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.steer("/skill:forkfg");
		release();
		await promptPromise;

		expect(stub.spawns.length).toBe(1);
		// The acceptance criterion: a queued foreground fork is NOT narrowed to background.
		expect(stub.spawns[0].options.isBackground).toBe(false);
		expect(forkNotices(harness).some((text) => text.includes("completed: queued fg"))).toBe(true);
		expect(allTranscriptText(harness)).not.toContain(SENTINEL);
		expect(requests.every((request) => !request.text.includes(SENTINEL))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Contract pin: the stub matches the real cross-extension-rpc.ts
// ---------------------------------------------------------------------------

describe("C3b fork: stub contract pin", () => {
	it("uses the AS-SHIPPED reply channel + envelope + protocol version", async () => {
		// Independently drive a ping through the stub and assert the wire shape.
		const bus = createEventBus();
		createStubSubagentsExtension().factory({ events: bus } as unknown as ExtensionAPI);
		let reply: unknown;
		bus.on(stubReplyChannel("subagents:rpc:ping", "req-1"), (data) => {
			reply = data;
		});
		bus.emit("subagents:rpc:ping", { requestId: "req-1" });
		expect(reply).toEqual({ success: true, data: { version: STUB_PROTOCOL_VERSION } });
	});

	it("matches the real pi-subagents cross-extension-rpc.ts when the checkout is present", () => {
		const realPath = join(homedir(), "Developer/ai/pi-subagents/src/cross-extension-rpc.ts");
		if (!existsSync(realPath)) {
			// Developer-local checkout, absent in CI: skip visibly rather than silently
			// asserting nothing (the previous pin pointed at a checkout that no longer exists).
			console.warn(`[skills-fork contract pin] skipped: ${realPath} not present`);
			return;
		}
		const source = readFileSync(realPath, "utf-8");
		expect(source).toContain(`PROTOCOL_VERSION = ${STUB_PROTOCOL_VERSION}`);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on the real source's literal reply-channel template
		expect(source).toContain("`${channel}:reply:${params.requestId}`");
		expect(source).toContain("subagents:rpc:ping");
		expect(source).toContain("subagents:rpc:spawn");
		expect(source).toContain("subagents:rpc:stop");
	});
});

// ---------------------------------------------------------------------------
// Frontmatter `agent:` resolution through the skill's own rewrite map (WS1)
// ---------------------------------------------------------------------------

/** Canonical skill ID (A.9 key) for a loaded fixture — what createInvocation stamps as skillId. */
function skillIdFor(harness: Harness, name: string): string {
	const skill = harness.session.resourceLoader.getSkills().skills.find((s) => s.name === name);
	if (!skill) {
		throw new Error(`skill "${name}" not loaded`);
	}
	return canonicalizePath(skill.filePath);
}

/** Publish an A.9 rewrite-maps event on the harness's shared bus (what Workstream 2 will emit). */
function publishRewriteMaps(harness: Harness, maps: SkillAgentRewriteMaps, revision = 1): void {
	const bus = harness.session.resourceLoader.getEventBus?.();
	if (!bus) {
		throw new Error("harness has no event bus");
	}
	bus.emit(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, { revision, maps });
}

function forkAgentFixture(name: string, agent: string): SkillFixture {
	return { name, body: `${SENTINEL} ${name} body`, frontmatter: { context: "fork", background: true, agent } };
}

describe("C3b fork routing: frontmatter agent resolution (A.3.4 applied to `agent:`)", () => {
	it("rewrites a collided bare name to its qualified form on the wire", async () => {
		const stub = createStubSubagentsExtension({ protocolVersion: 3, skillAgents: true });
		const harness = await createForkHarness([forkAgentFixture("skillone", "reviewer")], { stub });
		harness.setResponses([]);
		publishRewriteMaps(harness, {
			[skillIdFor(harness, "skillone")]: { reviewer: { qualified: "skillone:reviewer", collided: true } },
		});

		await harness.session.prompt("/skill:skillone");

		expect(stub.spawns[0].type).toBe("skillone:reviewer");
	});

	it("forwards a non-collided bare name unchanged", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkAgentFixture("skilltwo", "reviewer")], { stub });
		harness.setResponses([]);
		publishRewriteMaps(harness, {
			[skillIdFor(harness, "skilltwo")]: { reviewer: { qualified: "skilltwo:reviewer", collided: false } },
		});

		await harness.session.prompt("/skill:skilltwo");

		expect(stub.spawns[0].type).toBe("reviewer");
	});

	it("leaves an already-qualified value untouched (never double-qualifies)", async () => {
		const stub = createStubSubagentsExtension({ protocolVersion: 3, skillAgents: true });
		const harness = await createForkHarness([forkAgentFixture("skillthree", "someskill:someagent")], { stub });
		harness.setResponses([]);
		publishRewriteMaps(harness, {
			[skillIdFor(harness, "skillthree")]: {
				"someskill:someagent": { qualified: "skillthree:someskill:someagent", collided: true },
			},
		});

		await harness.session.prompt("/skill:skillthree");

		expect(stub.spawns[0].type).toBe("someskill:someagent");
	});

	it("gates a qualified value to general-purpose on a peer without skillAgents (WI-3)", async () => {
		// v2 stub: no skill-agent capability. An authored qualified `agent:` must NOT
		// reach the wire (A.9); core degrades it to general-purpose with a diagnostic.
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkAgentFixture("skillgate", "someskill:someagent")], { stub });
		const errors = collectErrors(harness);
		harness.setResponses([]);

		await harness.session.prompt("/skill:skillgate");

		expect(stub.spawns[0].type).toBe("general-purpose");
		expect(errors.some((message) => message.includes("does not support skill-scoped agents"))).toBe(true);
	});

	it("matches the map key case-insensitively (ADR-0008 reference case)", async () => {
		const stub = createStubSubagentsExtension({ protocolVersion: 3, skillAgents: true });
		const harness = await createForkHarness([forkAgentFixture("skillfour", "Reviewer")], { stub });
		harness.setResponses([]);
		publishRewriteMaps(harness, {
			[skillIdFor(harness, "skillfour")]: { reviewer: { qualified: "skillfour:reviewer", collided: true } },
		});

		await harness.session.prompt("/skill:skillfour");

		expect(stub.spawns[0].type).toBe("skillfour:reviewer");
	});

	it("forwards unchanged when no map exists or the map is keyed by a different skill id", async () => {
		const noMapStub = createStubSubagentsExtension();
		const noMap = await createForkHarness([forkAgentFixture("skillfive", "reviewer")], { stub: noMapStub });
		noMap.setResponses([]);
		await noMap.session.prompt("/skill:skillfive");
		expect(noMapStub.spawns[0].type).toBe("reviewer");

		const wrongKeyStub = createStubSubagentsExtension();
		const wrongKey = await createForkHarness([forkAgentFixture("skillsix", "reviewer")], { stub: wrongKeyStub });
		wrongKey.setResponses([]);
		publishRewriteMaps(wrongKey, {
			"/some/other/skill/id": { reviewer: { qualified: "other:reviewer", collided: true } },
		});
		await wrongKey.session.prompt("/skill:skillsix");
		expect(wrongKeyStub.spawns[0].type).toBe("reviewer");
	});
});
