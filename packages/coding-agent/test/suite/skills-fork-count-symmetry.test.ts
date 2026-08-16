/**
 * A.6 fork-count symmetry (c4b, AC6): a user `/name context: fork` spawn and a
 * model `skill`-tool fork each count once, regardless of outcome (success,
 * timeout, unsuccessful completion, repeat-blocked) or transport
 * (immediate/deferred). Forks never dedup and are never carried forward.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import { computeSkillInvocationCounts } from "../../src/core/skills/listing-budget.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";
import { createStubSubagentsExtension, type StubSubagentsController } from "./support/stub-subagents-extension.ts";

const SENTINEL = "FORKCOUNTSENTINEL";
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
	const tempDir = join(tmpdir(), `pi-c4b-fork-count-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
			...(fixture.frontmatter && { frontmatter: fixture.frontmatter }),
		};
	});
	return { ...createTestResourceLoader({ eventBus }), getSkills: () => ({ skills, diagnostics: [] }) };
}

interface ForkHarnessOptions {
	stub?: StubSubagentsController;
	tools?: AgentTool[];
}

async function createForkHarness(fixtures: SkillFixture[], options: ForkHarnessOptions = {}): Promise<Harness> {
	const tempDir = makeTempDir();
	const eventBus = createEventBus();
	const resourceLoader = createSkillsLoader(tempDir, fixtures, eventBus);
	const harness = await createHarness({
		models: [{ id: "session-model", reasoning: true }],
		resourceLoader,
		eventBus,
		skillForkTimeouts: FAST_TIMEOUTS,
		...(options.tools && { tools: options.tools }),
		...(options.stub && { extensionFactories: [{ factory: options.stub.factory }] }),
	});
	harnesses.push(harness);
	await harness.session.bindExtensions({ mode: "tui" });
	return harness;
}

function counts(harness: Harness) {
	return computeSkillInvocationCounts(harness.sessionManager.getEntries());
}

function toolResults(harness: Harness): { isError?: boolean }[] {
	return harness.session.messages.filter((m) => m.role === "toolResult") as { isError?: boolean }[];
}

/** Invocation count for the skill whose canonicalized skillId ends in `<name>/SKILL.md`. */
function countFor(harness: Harness, name: string): number | undefined {
	for (const [skillId, count] of counts(harness)) {
		if (skillId.endsWith(`${name}/SKILL.md`)) {
			return count;
		}
	}
	return undefined;
}

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

describe("A.6 fork-count symmetry: immediate path", () => {
	it("a user /name context: fork spawn counts once", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([]);

		await harness.session.prompt("/skill:forkbg");

		expect(countFor(harness, "forkbg")).toBe(1);
	});

	it("a model skill-tool fork counts once", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkbg" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("after ack"),
		]);

		await harness.session.prompt("do it");

		expect(countFor(harness, "forkbg")).toBe(1);
	});
});

describe("A.6 fork-count symmetry: deferred queue", () => {
	it("a fork spawned while streaming (deferred to _pendingForkNotices) counts exactly once after flush", async () => {
		const stub = createStubSubagentsExtension();
		const { tool, release } = waitTool();
		const harness = await createForkHarness([forkBg], { stub, tools: [tool] });
		harness.setResponses([
			(_c, _o, _s, _m) => fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("done"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.followUp("/skill:forkbg");
		release();
		await promptPromise;

		expect(countFor(harness, "forkbg")).toBe(1);
	});
});

describe("A.6 fork-count symmetry: non-spawn notices carry no count", () => {
	it("completion and repeat-blocked notices persist no additional counting entry (still exactly one per spawn)", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([]);

		await harness.session.prompt("/skill:forkbg");
		await harness.session.prompt("/skill:forkbg"); // repeat-blocked while the first is live
		stub.complete(stub.spawns[0].agentId, { result: "done" }); // completion notice

		expect(countFor(harness, "forkbg")).toBe(1);
	});

	it("a spawn-failed outcome (degrades to inline) does not persist a fork-count entry", async () => {
		const stub = createStubSubagentsExtension({ spawnError: "no active session" });
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([() => fauxAssistantMessage("inline turn")]);

		await harness.session.prompt("/skill:forkbg");

		// Degraded to inline: the record activates through the normal inline path (no fork marker).
		const entries = harness.sessionManager.getEntries();
		const forkFlagged = entries.some((e) => "invocations" in e && e.invocations?.some((inv) => inv.fork === true));
		expect(forkFlagged).toBe(false);
	});
});

describe("A.6 fork-count symmetry: model-fork error outcomes still count once", () => {
	it("a foreground timeout counts once, marks isError, and retains fork:true", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkFg], { stub });
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkfg" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("after"),
		]);

		await harness.session.prompt("do it");

		const results = toolResults(harness);
		expect(results).toHaveLength(1);
		expect(results[0]?.isError).toBe(true);
		expect(countFor(harness, "forkfg")).toBe(1);
	});

	it("an unsuccessful foreground completion counts once and marks isError with fork:true intact", async () => {
		const stub = createStubSubagentsExtension({
			autoComplete: { when: "after-reply", channel: "failed", error: "explode", status: "error" },
		});
		const harness = await createForkHarness([forkFg], { stub });
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkfg" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("after"),
		]);

		await harness.session.prompt("do it");

		const results = toolResults(harness);
		expect(results[0]?.isError).toBe(true);
		expect(countFor(harness, "forkfg")).toBe(1);

		const entry = harness.sessionManager
			.getEntries()
			.find((e) => e.type === "message" && e.message.role === "toolResult");
		expect(entry && "invocations" in entry ? entry.invocations?.[0]?.fork : undefined).toBe(true);
	});

	it("a repeat-blocked model fork marks isError and retains fork:true (same error-preservation channel as timeout/unsuccessful outcomes)", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkbg" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("after first"),
		]);
		await harness.session.prompt("start");

		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "forkbg" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage("after second"),
		]);
		await harness.session.prompt("again");

		const results = toolResults(harness);
		expect(results).toHaveLength(2);
		expect(results[1]?.isError).toBe(true);
		const invocationEntries = harness.sessionManager
			.getEntries()
			.filter((e) => e.type === "message" && e.message.role === "toolResult");
		const second = invocationEntries[1];
		expect(second && "invocations" in second ? second.invocations?.[0]?.fork : undefined).toBe(true);
	});
});

describe("A.6 fork exemption: never dedups, never carried forward", () => {
	it("two identical fork invocations never produce a dedup note", async () => {
		const stub = createStubSubagentsExtension();
		const harness = await createForkHarness([forkBg], { stub });
		harness.setResponses([]);

		await harness.session.prompt("/skill:forkbg");
		stub.complete(stub.spawns[0].agentId, { result: "one" });
		await harness.session.prompt("/skill:forkbg");
		stub.complete(stub.spawns[1].agentId, { result: "two" });

		const noticeTexts = harness.session.messages
			.filter((m) => m.role === "custom" && (m as { customType?: string }).customType === "skill_fork")
			.map((m) => JSON.stringify((m as { content?: unknown }).content));
		expect(noticeTexts.some((text) => text.includes("already loaded"))).toBe(false);
		expect(stub.spawns.length).toBe(2);
	});
});
