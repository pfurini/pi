/**
 * Fork-owned: the subagent child-session runner (plan T3) on real parent and child sessions.
 * Children read the parent's model runtime, so the faux provider scripts both. Child extensions
 * are files under the parent's agent directory, which the child's DefaultResourceLoader loads.
 * Old pi-subagents tests at 79a7c42 this covers: agent-runner, agent-runner-e2e, prompts, context,
 * env, memory, isolation-param, output-file, output-file-path, output-transcript-wiring,
 * ext-templates-e2e, e2e/loader-lifecycle, e2e/tool-veto-reachability, e2e/turn-limit-steer,
 * e2e/output-transcript, e2e/isolated-provider, output-file-compaction-e2e, agent-startup-error,
 * child-session-shutdown.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { type Context, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "../../src/core/fork-builtins/subagents/definitions/types.ts";
import { lineageForBus } from "../../src/core/fork-builtins/subagents/runner/lineage.ts";
import {
	type Child,
	type ChildActivity,
	type ChildRequest,
	createChild,
	runTurn,
	spawnChild,
	TURN_LIMIT_STEER,
	teardownChild,
} from "../../src/core/fork-builtins/subagents/runner/run.ts";
import type { SubagentRecord } from "../../src/core/fork-builtins/subagents/service/records.ts";
import type { SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import type { Skill } from "../../src/core/skills/frontmatter.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

type Probe = { shutdowns: number; stuck: boolean; late?: () => void };
const probe = (): Probe => (globalThis as { __snRunner?: Probe }).__snRunner as Probe;

const harnesses: Harness[] = [];
const children: Child[] = [];
const skillDirs: string[] = [];

afterEach(async () => {
	// Mocks first: a spy on a faked timer would otherwise restore the fake after the real timers return.
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const child of children.splice(0)) await teardownChild(child);
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const dir of skillDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	delete (globalThis as { __snRunner?: Probe }).__snRunner;
});

async function parent(options: HarnessOptions = {}): Promise<Harness> {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	(globalThis as { __snRunner?: Probe }).__snRunner = { shutdowns: 0, stuck: false };
	const harness = await createHarness(options);
	harnesses.push(harness);
	return harness;
}

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name: "worker",
		description: "worker",
		extensions: true,
		skills: true,
		systemPrompt: "You are the worker agent.",
		promptMode: "replace",
		enabled: true,
		hidden: false,
		source: { kind: "default" },
		...overrides,
	};
}

function request(harness: Harness, definition: AgentDefinition, overrides: Partial<ChildRequest> = {}): ChildRequest {
	return {
		parent: harness.session,
		agentDir: harness.tempDir,
		definition,
		cwd: harness.tempDir,
		model: harness.getModel(),
		// The call's own isolation; the runner adds the agent file's.
		isolated: false,
		persist: false,
		sessionName: `${definition.name}#test`,
		forkBaseToolNames: ["ask_user_question", "vcc_recall"],
		lineage: { owner: {} as SubagentService, parentRecord: {} as SubagentRecord, depth: 1 },
		transcript: { enabled: false, agentId: "agent-test", rootSessionId: harness.session.sessionId },
		...overrides,
	};
}

async function create(harness: Harness, definition: AgentDefinition, overrides: Partial<ChildRequest> = {}) {
	const activity: ChildActivity[] = [];
	const child = await createChild({ ...request(harness, definition, overrides), onActivity: (a) => activity.push(a) });
	children.push(child);
	return { child, activity };
}

/** A response that records the tools and system prompt the child's request carried. */
function capture(seen: { tools: string[]; system: string; user: string }, reply = "done") {
	return (context: Context) => {
		seen.tools = getCurrentTools(context.messages).map((tool) => tool.name);
		seen.system = getCurrentSystemPrompt(context.messages);
		const users = context.messages.filter((message) => message.role === "user");
		seen.user = JSON.stringify(users.at(-1)?.content ?? "");
		return fauxAssistantMessage(reply);
	};
}

const seen = () => ({ tools: [] as string[], system: "", user: "" });

/** An extension file under the agent directory, loaded by every child's DefaultResourceLoader. */
function writeExtension(harness: Harness, name: string, body: string): string {
	const dir = join(harness.tempDir, "extensions");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${name}.ts`);
	writeFileSync(path, `import { Type } from "typebox";\nexport default function (pi) {\n${body}\n}\n`);
	return path;
}

const tool = (name: string, execute = 'async () => ({ content: [{ type: "text", text: "ok" }], details: {} })') =>
	`pi.registerTool({ name: ${JSON.stringify(name)}, label: ${JSON.stringify(name)}, description: "test tool", parameters: Type.Object({}), execute: ${execute} });`;

const countShutdown = 'pi.on("session_shutdown", () => { globalThis.__snRunner.shutdowns++; });';

describe("child tool scope", () => {
	it("gives a child a fork base tool only when tools: names it", async () => {
		const harness = await parent();
		const plain = seen();
		const named = seen();
		harness.setResponses([capture(plain), capture(named)]);
		const first = await create(harness, agent());
		await runTurn(first.child, { prompt: "go", graceTurns: 5 });
		const second = await create(harness, agent({ tools: ["read", "vcc_recall"] }));
		await runTurn(second.child, { prompt: "go", graceTurns: 5 });
		expect(plain.tools).toContain("read");
		expect(plain.tools).not.toContain("ask_user_question");
		expect(plain.tools).not.toContain("vcc_recall");
		expect(named.tools).toContain("vcc_recall");
		expect(named.tools).not.toContain("ask_user_question");
		expect(named.tools).not.toContain("bash");
		// Excluded from the registry, not only kept inactive (D22).
		const registered = (child: Child) => child.session.getAllTools().map((entry) => entry.name);
		expect(registered(first.child)).not.toContain("vcc_recall");
		expect(registered(first.child)).not.toContain("ask_user_question");
		expect(registered(second.child)).toContain("vcc_recall");
	});

	it("never gives a child Agent, even when tools: names it, and warns about the naming", async () => {
		const harness = await parent();
		writeExtension(harness, "orchestrator", tool("Agent"));
		const request = seen();
		harness.setResponses([capture(request)]);
		const { child, activity } = await create(harness, agent({ tools: ["read", "Agent"] }));
		await runTurn(child, { prompt: "go", graceTurns: 5 });
		expect(child.session.getAllTools().some((entry) => entry.name === "Agent")).toBe(false);
		expect(request.tools).not.toContain("Agent");
		expect(activity).toContainEqual({
			type: "tools-error",
			message: 'agent "worker" names "Agent" in tools:, but a subagent receives it only through allowed_subagents',
		});
	});

	it("drops inline built-ins, path extensions and skills under isolated", async () => {
		const skillDir = await skillFixture();
		const harness = await parent({ resourceLoader: loaderWithSkill(skillDir) });
		const path = writeExtension(harness, "tracker", tool("tracker_tool"));
		const loose = await create(harness, agent());
		const paths = loose.child.loader.getExtensions().extensions.map((extension) => extension.path);
		expect(paths).toContain("<inline:tokensave>");
		expect(paths.some((entry) => entry.endsWith("tracker.ts"))).toBe(true);

		const request = seen();
		harness.setResponses([capture(request)]);
		const { child } = await create(harness, agent({ isolated: true, skills: ["demo"] }));
		await runTurn(child, { prompt: "go", graceTurns: 5 });
		expect(child.loader.getExtensions().extensions).toEqual([]);
		expect(request.tools).not.toContain("tracker_tool");
		expect(request.system).not.toContain("SKILL BODY MARKER");
		expect(path).toBeTruthy();
	});

	it("drops an extension named by exclude_extensions", async () => {
		const harness = await parent();
		writeExtension(harness, "tracker", tool("tracker_tool"));
		const { child } = await create(harness, agent({ excludeExtensions: ["tokensave"] }));
		const paths = child.loader.getExtensions().extensions.map((extension) => extension.path);
		expect(paths).not.toContain("<inline:tokensave>");
		expect(paths.some((entry) => entry.endsWith("tracker.ts"))).toBe(true);
	});

	it("blocks an out-of-scope tool call at run time, and hands an in-scope one to the hook installed before", async () => {
		const harness = await parent();
		writeExtension(
			harness,
			"veto",
			`${tool("keep_me")}\n${tool("drop_me")}\npi.on("tool_call", (event) => (event.toolName === "keep_me" ? { block: true, reason: "extension veto" } : undefined));`,
		);
		const { child } = await create(harness, agent({ tools: ["read", "ext:veto/keep_me"] }));
		// Pi's own hook reads only the tool call and its arguments.
		const call = (name: string) =>
			child.session.agent.beforeToolCall?.({
				toolCall: { type: "toolCall", id: `call-${name}`, name, arguments: {} },
				args: {},
			} as unknown as BeforeToolCallContext);
		expect(await call("drop_me")).toEqual({
			block: true,
			reason: 'Tool "drop_me" is not available to this subagent.',
		});
		expect(await call("keep_me")).toMatchObject({ block: true, reason: "extension veto" });
		expect(await call("read")).toBeUndefined();
	});

	it("narrows extension tools to the ext: selectors, including a tool registered after bind", async () => {
		const harness = await parent();
		writeExtension(
			harness,
			"narrow",
			`${tool("keep_me")}\n${tool("drop_me")}\nglobalThis.__snRunner.late = () => { ${tool("late_one")} };`,
		);
		const request = seen();
		harness.setResponses([capture(request)]);
		const { child } = await create(harness, agent({ tools: ["read", "ext:narrow/keep_me"] }));
		probe().late?.();
		expect(child.session.getAllTools().some((entry) => entry.name === "late_one")).toBe(true);
		await runTurn(child, { prompt: "go", graceTurns: 5 });
		expect(request.tools).toContain("keep_me");
		expect(request.tools).toContain("read");
		expect(request.tools).not.toContain("drop_me");
		expect(request.tools).not.toContain("late_one");
	});
});

describe("child turns", () => {
	it("sends the wrap-up at the turn limit, then stops with the partial result", async () => {
		const harness = await parent();
		writeFileSync(join(harness.tempDir, "notes.txt"), "notes");
		const readCall = () => fauxToolCall("read", { path: join(harness.tempDir, "notes.txt") });
		harness.setResponses([
			fauxAssistantMessage([fauxText("first part"), readCall()], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("second part"), readCall()], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("never reached"), readCall()], { stopReason: "toolUse" }),
		]);
		const { child } = await create(harness, agent());
		const outcome = await runTurn(child, { prompt: "go", maxTurns: 1, graceTurns: 1 });
		expect(outcome.status).toBe("aborted");
		expect(outcome.text).toBe("second part");
		expect(JSON.stringify(child.session.messages)).toContain(TURN_LIMIT_STEER);

		harness.setResponses([
			fauxAssistantMessage([fauxText("working"), readCall()], { stopReason: "toolUse" }),
			fauxAssistantMessage("wrapped up"),
		]);
		const second = await create(harness, agent());
		const steered = await runTurn(second.child, { prompt: "go", maxTurns: 1, graceTurns: 3 });
		expect(steered).toMatchObject({ status: "steered", text: "wrapped up" });
	});

	it("omits the parent prompt in replace mode, includes it in append mode, and inherits the conversation", async () => {
		const harness = await parent();
		harness.setResponses([fauxAssistantMessage("parent answer")]);
		await harness.session.prompt("parent question");
		const parentPrompt = harness.session.systemPrompt;
		expect(parentPrompt.length).toBeGreaterThan(0);
		const replace = seen();
		const append = seen();
		const inherited = seen();
		harness.setResponses([capture(replace), capture(append), capture(inherited)]);
		const base = agent();
		await spawnChild(request(harness, base), { prompt: "task one", graceTurns: 5, inheritContext: false }, (c) =>
			children.push(c),
		);
		await spawnChild(
			request(harness, agent({ promptMode: "append" })),
			{ prompt: "task two", graceTurns: 5, inheritContext: false },
			(c) => children.push(c),
		);
		await spawnChild(request(harness, base), { prompt: "task three", graceTurns: 5, inheritContext: true }, (c) =>
			children.push(c),
		);
		expect(replace.system).not.toContain(parentPrompt);
		expect(replace.system).toContain("You are the worker agent.");
		expect(append.system.startsWith(parentPrompt)).toBe(true);
		expect(append.system).toContain("<agent_instructions>\nYou are the worker agent.\n</agent_instructions>");
		expect(replace.user).not.toContain("parent question");
		expect(inherited.user).toContain("[User]: parent question");
		expect(inherited.user).toContain("[Assistant]: parent answer");
		expect(inherited.user).toContain("task three");
	});

	it("preloads a skills: list from the parent's loaded skills into the system prompt", async () => {
		const skillDir = await skillFixture();
		const harness = await parent({ resourceLoader: loaderWithSkill(skillDir) });
		const request = seen();
		harness.setResponses([capture(request)]);
		const { child } = await create(harness, agent({ skills: ["demo"] }));
		await runTurn(child, { prompt: "go", graceTurns: 5 });
		expect(request.system).toContain("# Preloaded Skill: demo");
		expect(request.system).toContain("SKILL BODY MARKER");
		expect(request.system).not.toContain("description: the demo skill");
	});

	it("gives an agent with write tools a memory directory it writes, and a read-only agent the read-only block", async () => {
		const harness = await parent();
		const memoryFile = join(harness.tempDir, ".pi", "agent-memory", "keeper", "MEMORY.md");
		const writer = seen();
		harness.setResponses([
			(context: Context) => {
				writer.system = getCurrentSystemPrompt(context.messages);
				return fauxAssistantMessage([fauxToolCall("write", { path: memoryFile, content: "remember this" })], {
					stopReason: "toolUse",
				});
			},
			fauxAssistantMessage("saved"),
		]);
		const { child } = await create(harness, agent({ name: "keeper", memory: "project" }));
		expect((await runTurn(child, { prompt: "save", graceTurns: 5 })).text).toBe("saved");
		expect(readFileSync(memoryFile, "utf-8")).toBe("remember this");
		expect(writer.system).toContain("# Agent Memory\n");
		expect(writer.system).toContain(join(harness.tempDir, ".pi", "agent-memory", "keeper"));

		const reader = seen();
		harness.setResponses([capture(reader)]);
		const second = await create(harness, agent({ name: "looker", memory: "project", tools: ["read", "grep"] }));
		await runTurn(second.child, { prompt: "look", graceTurns: 5 });
		expect(reader.system).toContain("# Agent Memory (read-only)");
		expect(existsSync(join(harness.tempDir, ".pi", "agent-memory", "looker"))).toBe(false);
	});
});

describe("child transcripts and sessions", () => {
	it("writes the child's messages to its .output transcript, and nothing under output_transcript: false", async () => {
		const harness = await parent();
		harness.setResponses([fauxAssistantMessage("transcribed answer")]);
		const { child } = await create(harness, agent(), {
			transcript: { enabled: true, agentId: "agent-out", rootSessionId: harness.session.sessionId },
		});
		await runTurn(child, { prompt: "transcribe me", graceTurns: 5 });
		const path = child.transcriptPath as string;
		expect(path).toMatch(/pi-subagents-\d+\/.+\/tasks\/agent-out\.output$/);
		const entries = readFileSync(path, "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(entries.map((entry) => entry.type)).toEqual(["user", "assistant"]);
		expect(JSON.stringify(entries)).toContain("transcribe me");
		expect(JSON.stringify(entries)).toContain("transcribed answer");

		const quiet = await create(harness, agent({ outputTranscript: false }), {
			transcript: { enabled: true, agentId: "agent-quiet", rootSessionId: harness.session.sessionId },
		});
		expect(quiet.child.transcriptPath).toBeUndefined();
		expect(readdirSync(join(path, "..")).filter((name) => name.startsWith("agent-quiet"))).toEqual([]);
	});

	it("keeps the transcript going across a compaction without repeating a message", async () => {
		const harness = await parent();
		writeFileSync(
			join(harness.tempDir, "settings.json"),
			JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 500 }, retry: { enabled: false } }),
		);
		const respond = (context: Context) => {
			const last = context.messages.at(-1);
			const text = JSON.stringify(last?.content ?? "");
			if (text.includes("conversation to summarize") || text.includes("PREFIX of a turn")) {
				return fauxAssistantMessage("summary of everything so far");
			}
			if (text.includes("final question")) return fauxAssistantMessage("POST-COMPACTION-ANSWER");
			const question = /question (\d+)/.exec(text);
			return fauxAssistantMessage(`answer-${question?.[1]} ${"filler ".repeat(200)}`);
		};
		harness.setResponses(Array.from({ length: 16 }, () => respond));
		const { child } = await create(harness, agent(), {
			transcript: { enabled: true, agentId: "agent-compact", rootSessionId: harness.session.sessionId },
		});
		for (let index = 0; index < 6; index++) await runTurn(child, { prompt: `question ${index}`, graceTurns: 5 });
		const before = child.session.messages.length;
		await child.session.compact();
		expect(child.session.messages.length).toBeLessThan(before);
		await runTurn(child, { prompt: "final question", graceTurns: 5 });
		const all = readFileSync(child.transcriptPath as string, "utf-8");
		expect(all).toContain("final question");
		expect(all).toContain("POST-COMPACTION-ANSWER");
		for (let index = 0; index < 6; index++) expect(all.split(`answer-${index} `).length - 1).toBe(1);
	}, 30_000);

	it("persists a child's session under .subagents/, or exactly at session_dir:", async () => {
		const harness = await parent();
		harness.setResponses([fauxAssistantMessage("kept"), fauxAssistantMessage("kept too")]);
		const { child } = await create(harness, agent(), { persist: true });
		await runTurn(child, { prompt: "persist", graceTurns: 5 });
		const file = child.session.sessionFile as string;
		expect(file.split("/").at(-2)).toBe(".subagents");
		expect(existsSync(file)).toBe(true);

		const custom = await create(harness, agent({ sessionDir: "custom-sessions" }), { persist: true });
		await runTurn(custom.child, { prompt: "persist", graceTurns: 5 });
		expect(custom.child.session.sessionFile?.startsWith(`${join(harness.tempDir, "custom-sessions")}/`)).toBe(true);
		expect(custom.child.session.sessionFile).not.toContain(".subagents");
	});

	it("persists a child's session under .subagents/ below the parent's own session directory", async () => {
		const harness = await parent();
		vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", "");
		const parentSessions = join(harness.tempDir, "parent-sessions");
		vi.spyOn(harness.session.sessionManager, "getSessionDir").mockReturnValue(parentSessions);
		harness.setResponses([fauxAssistantMessage("kept")]);
		const { child } = await create(harness, agent(), { persist: true });
		await runTurn(child, { prompt: "persist", graceTurns: 5 });
		expect(child.session.sessionFile?.startsWith(`${join(parentSessions, ".subagents")}/`)).toBe(true);
	});

	it("reports a failing startup as an error with its cause and disposes the child's loader", async () => {
		const harness = await parent();
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockRejectedValueOnce(new Error("loader boom"));
		const dispose = vi.spyOn(DefaultResourceLoader.prototype, "dispose");
		const outcome = await spawnChild(request(harness, agent()), {
			prompt: "go",
			graceTurns: 5,
			inheritContext: false,
		});
		expect(outcome).toMatchObject({ status: "error", error: "loader boom" });
		expect(outcome.child).toBeUndefined();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("records the child's lineage for its loader's event bus", async () => {
		const harness = await parent();
		const owner = {} as SubagentService;
		const parentRecord = {} as SubagentRecord;
		// The agent file's isolation and allowed_subagents reach the lineage even when the call sets neither.
		const { child } = await create(harness, agent({ isolated: true, allowedSubagents: ["Explore"] }), {
			lineage: { owner, parentRecord, depth: 2 },
		});
		const lineage = lineageForBus(child.loader.getEventBus());
		expect(lineage?.owner).toBe(owner);
		expect(lineage?.parentRecord).toBe(parentRecord);
		expect(lineage).toMatchObject({ depth: 2, isolated: true, allowedSubagents: ["Explore"] });
		expect(lineageForBus(harness.session.resourceLoader.getEventBus?.())).toBeUndefined();
	});
});

describe("child teardown", () => {
	it("delivers session_shutdown to a child extension, then disposes the session and its loader", async () => {
		const harness = await parent();
		writeExtension(harness, "shutdown", countShutdown);
		const { child } = await create(harness, agent());
		const disposeSession = vi.spyOn(child.session, "dispose");
		const disposeLoader = vi.spyOn(child.loader, "dispose");
		await teardownChild(child);
		await teardownChild(child);
		expect(probe().shutdowns).toBe(1);
		expect(disposeSession).toHaveBeenCalledTimes(1);
		expect(disposeLoader).toHaveBeenCalledTimes(1);
	});

	it("cuts a session_shutdown handler that never settles at 3 s, and still disposes", async () => {
		const harness = await parent();
		writeExtension(harness, "hang", 'pi.on("session_shutdown", () => new Promise(() => {}));');
		const { child } = await create(harness, agent());
		const disposeSession = vi.spyOn(child.session, "dispose");
		const disposeLoader = vi.spyOn(child.loader, "dispose");
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const timers = vi.spyOn(globalThis, "setTimeout");
		let done = false;
		const teardown = teardownChild(child).then(() => {
			done = true;
		});
		await vi.advanceTimersByTimeAsync(2999);
		expect(done).toBe(false);
		// The bound never holds the process open.
		expect((timers.mock.results.at(-1)?.value as NodeJS.Timeout).hasRef()).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await teardown;
		expect(disposeSession).toHaveBeenCalledTimes(1);
		expect(disposeLoader).toHaveBeenCalledTimes(1);
	});

	it("delivers session_shutdown once within 3 s while a tool ignores its abort signal", async () => {
		const harness = await parent();
		writeExtension(
			harness,
			"stuck",
			`${countShutdown}\n${tool("stuck", "() => { globalThis.__snRunner.stuck = true; return new Promise(() => {}); }")}`,
		);
		harness.setResponses([fauxAssistantMessage([fauxToolCall("stuck", {})], { stopReason: "toolUse" })]);
		const { child } = await create(harness, agent());
		const disposeSession = vi.spyOn(child.session, "dispose");
		void runTurn(child, { prompt: "hang", graceTurns: 5 });
		await vi.waitFor(() => expect(probe().stuck).toBe(true));
		const started = Date.now();
		await teardownChild(child);
		expect(Date.now() - started).toBeLessThan(3000);
		expect(probe().shutdowns).toBe(1);
		expect(disposeSession).toHaveBeenCalledTimes(1);
	}, 10_000);

	it("disposes and records an extension-error when the shutdown handler and the error listener both throw", async () => {
		const harness = await parent();
		writeExtension(harness, "throws", 'pi.on("session_shutdown", () => { throw new Error("handler boom"); });');
		const { child, activity } = await create(harness, agent());
		child.session.extensionRunner.onError(() => {
			throw new Error("listener boom");
		});
		const disposeSession = vi.spyOn(child.session, "dispose");
		const disposeLoader = vi.spyOn(child.loader, "dispose");
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			await expect(teardownChild(child)).resolves.toBeUndefined();
			await new Promise((resolve) => setTimeout(resolve, 20));
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
		expect(disposeSession).toHaveBeenCalledTimes(1);
		expect(disposeLoader).toHaveBeenCalledTimes(1);
		expect(activity).toContainEqual({
			type: "extension-error",
			message: "session_shutdown failed at teardown: listener boom",
		});
		expect(unhandled).toEqual([]);
	});

	it("still disposes the loader and resolves when disposing the session throws", async () => {
		const harness = await parent();
		const { child, activity } = await create(harness, agent());
		const disposeSession = child.session.dispose.bind(child.session);
		vi.spyOn(child.session, "dispose").mockImplementationOnce(() => {
			disposeSession();
			throw new Error("cleanup boom");
		});
		const disposeLoader = vi.spyOn(child.loader, "dispose");
		await expect(teardownChild(child)).resolves.toBeUndefined();
		expect(disposeLoader).toHaveBeenCalledTimes(1);
		expect(activity).toContainEqual({ type: "extension-error", message: "dispose failed at teardown: cleanup boom" });
	});
});

async function skillFixture(): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "pi-sn-skill-"));
	skillDirs.push(dir);
	writeFileSync(join(dir, "SKILL.md"), "---\nname: demo\ndescription: the demo skill\n---\nSKILL BODY MARKER\n");
	return dir;
}

function loaderWithSkill(dir: string) {
	const skill = {
		name: "demo",
		description: "the demo skill",
		filePath: join(dir, "SKILL.md"),
		baseDir: dir,
		sourceInfo: { path: join(dir, "SKILL.md"), source: "local", scope: "project", origin: "top-level" },
		disableModelInvocation: false,
	} as Skill;
	return { ...createTestResourceLoader(), getSkills: () => ({ skills: [skill], diagnostics: [] }) };
}
