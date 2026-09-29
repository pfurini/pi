/**
 * Fork-owned: the mention clone (phase 3 plan T3, cases 1 to 12) on a real session. The faux provider
 * records every request the parent session makes; a request whose last user message holds the
 * reminder is the clone's. Old pi-subagents tests at 79a7c42 this covers: mention-clone,
 * e2e/mention-clone (see docs/plans/subagents-native-phase3-evidence/old-cases.md).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools, type Message, type ToolCall } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../../src/core/extensions/types.ts";
import { agentMentionReminder } from "../../src/core/fork-builtins/subagents/service/mentions.ts";
import type { SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import { runMentionClone } from "../../src/core/fork-builtins/subagents/tools/mention-clone.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { type Behavior, CHILD_START, held, say, sleep, textOf } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const harnesses: Harness[] = [];
const skillDirs: string[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const dir of skillDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const REMINDER = "<system-reminder>";

/** One request the parent session's model received. */
interface Seen {
	messages: Message[];
	options?: SimpleStreamOptions;
	model: Model<string>;
}

/** Compacts to a fixed summary, with no model call. */
const COMPACT: HarnessOptions["extensionFactories"] = [
	(pi) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: "summary of the early turns",
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
			},
		}));
	},
];

/** A resource loader with one skill, `skill-a`, and the compaction extension. */
async function skillLoader(): Promise<ResourceLoader> {
	const dir = mkdtempSync(join(tmpdir(), "pi-clone-skill-"));
	skillDirs.push(dir);
	const baseDir = join(dir, "skill-a");
	mkdirSync(baseDir, { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	writeFileSync(filePath, "Skill A instructions.");
	const skill = {
		name: "skill-a",
		description: "skill-a skill",
		filePath,
		disableModelInvocation: false,
		baseDir,
		sourceInfo: createSyntheticSourceInfo(filePath, {
			source: "local",
			scope: "project",
			origin: "top-level",
			baseDir,
		}),
	};
	const extensions = await createTestExtensionsResult(COMPACT ?? [], dir);
	return {
		...createTestResourceLoader(),
		getSkills: () => ({ skills: [skill], diagnostics: [] }),
		getExtensions: () => extensions,
	};
}

/**
 * A session with the `worker` agent, two reasoning models and an extension that compacts to a fixed
 * summary; with `withSkill`, also the skill `skill-a`. `clone` answers the clone's request; `child`
 * answers every subagent.
 */
async function session(subagents: Record<string, unknown> = {}, withSkill = false) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const state = {
		requests: [] as Seen[],
		clone: say("no tool") as Behavior,
		child: say("child done") as Behavior,
	};
	const harness = await createHarness({
		models: [
			{ id: "faux-1", reasoning: true },
			{ id: "faux-2", reasoning: true },
		],
		settings: {
			compaction: { keepRecentTokens: 1 },
			forkBuiltins: { subagents: { defaultJoinMode: "async", ...subagents } },
		} as unknown as Partial<Settings>,
		...(withSkill ? { resourceLoader: await skillLoader() } : { extensionFactories: COMPACT }),
	});
	harnesses.push(harness);
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	writeFileSync(
		join(harness.tempDir, "agents", "worker.md"),
		"---\ndescription: Test worker.\ntools: read\nextensions: false\n---\nYou are a test worker.",
	);
	const respond: FauxResponseFactory = (context, options, _state, model) => {
		if (getCurrentSystemPrompt(context.messages).includes("<active_agent")) return state.child(context, options);
		state.requests.push({ messages: context.messages, options, model });
		const last = context.messages.at(-1);
		if (last?.role === "user" && textOf(last.content).includes(REMINDER)) return state.clone(context, options);
		return fauxAssistantMessage("parent reply");
	};
	harness.setResponses(Array.from({ length: 50 }, () => respond));
	return { harness, state, subagents: service(harness) };
}

function service(harness: Harness): SubagentService {
	const subagents = subagentServiceFor(harness.session);
	if (!subagents) throw new Error("no subagent service");
	return subagents;
}

const agentCall = (args: ToolCall["arguments"], ...more: AssistantMessage["content"]) =>
	fauxAssistantMessage([fauxToolCall("Agent", args), ...more], { stopReason: "toolUse" });

const CALL = { subagent_type: "general-purpose", prompt: "written from context", description: "clone desc" };

const clone = (harness: Harness, message = "check the RPC path", signal?: AbortSignal) =>
	runMentionClone(harness.session, service(harness), "worker", message, signal);

/** Every message text of a request, in order. */
const texts = (messages: Message[]) =>
	messages.map((message) => (message.role === "user" || message.role === "assistant" ? textOf(message.content) : ""));

describe("the clone's request", () => {
	it("is exactly one model request", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		await harness.session.prompt("hello");
		const before = state.requests.length;
		expect(await clone(harness)).toMatchObject({ ok: true });
		expect(state.requests.length - before).toBe(1);
	});

	it("carries the session's projected conversation: after a compaction, the summary instead of the turns it replaced", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		await harness.session.prompt("turn alpha");
		await harness.session.prompt("turn beta");
		await harness.session.compact();
		await harness.session.prompt("turn gamma");
		await clone(harness);
		const sent = texts(state.requests.at(-1)?.messages ?? []).join("\n");
		expect(sent).toContain("summary of the early turns");
		expect(sent).toContain("turn gamma");
		expect(sent).not.toContain("turn alpha");
	});

	it("carries the skill bodies the session re-attached after a compaction, as its own requests do", async () => {
		const { harness, state } = await session({}, true);
		state.clone = () => agentCall(CALL);
		await harness.session.prompt("/skill:skill-a");
		await harness.session.prompt("turn beta");
		await harness.session.compact();
		await harness.session.prompt("turn gamma");
		const turn = texts(state.requests.at(-1)?.messages ?? []).join("\n");
		expect(turn).toContain("Skill A instructions.");
		await clone(harness);
		const sent = texts(state.requests.at(-1)?.messages ?? []).join("\n");
		expect(sent).toContain("summary of the early turns");
		expect(sent).toContain("Skill A instructions.");
	});

	it("keeps the system prompt the session sent on its last turn, byte for byte", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		await harness.session.prompt("hello");
		const turn = state.requests.at(-1);
		await clone(harness);
		const request = state.requests.at(-1);
		if (!turn || !request) throw new Error("no request");
		expect(getCurrentSystemPrompt(turn.messages)).toBeTruthy();
		expect(getCurrentSystemPrompt(request.messages)).toBe(getCurrentSystemPrompt(turn.messages));
	});

	// T8-F2: before the session's first turn its messages hold no system prompt, and the clone sent none.
	it("carries the system prompt the session's first turn sends, when the mention is the first prompt", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		expect(await clone(harness)).toMatchObject({ ok: true });
		const cloned = getCurrentSystemPrompt(state.requests.at(-1)?.messages ?? []);
		await harness.session.prompt("hello");
		const turn = getCurrentSystemPrompt(state.requests.at(-1)?.messages ?? []);
		expect(turn).toBeTruthy();
		expect(cloned).toBe(turn);
	});

	it("declares the Agent tool and nothing else", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		await harness.session.prompt("hello");
		const turn = state.requests.at(-1);
		expect(getCurrentTools(turn?.messages ?? []).length).toBeGreaterThan(1);
		await clone(harness);
		expect(getCurrentTools(state.requests.at(-1)?.messages ?? []).map((tool) => tool.name)).toEqual(["Agent"]);
	});

	it("ends with one user message: the typed message, a blank line, then the reminder", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		await clone(harness, "check the RPC path");
		const last = state.requests.at(-1)?.messages.at(-1);
		expect(last?.role).toBe("user");
		expect(textOf(last?.content)).toBe(`check the RPC path\n\n${agentMentionReminder("worker")}`);
	});

	it("uses the session's model, session id and thinking level", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		const model = harness.getModel("faux-2");
		if (!model) throw new Error("no faux-2");
		await harness.session.setModel(model);
		harness.session.setThinkingLevel("high");
		await clone(harness);
		const request = state.requests.at(-1);
		expect(request?.model.id).toBe("faux-2");
		expect(request?.options).toMatchObject({ sessionId: harness.session.sessionId, reasoning: "high" });
	});

	it("sends no reasoning level when the session thinks at off", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		harness.session.setThinkingLevel("off");
		await clone(harness);
		expect(state.requests.at(-1)?.options).not.toHaveProperty("reasoning");
	});

	it("leaves the session's projection, messages and turns unchanged", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL);
		await harness.session.prompt("hello");
		const projection = JSON.stringify(harness.sessionManager.buildSessionProjection().messages);
		const messages = harness.session.messages.length;
		const entries = harness.sessionManager.getEntries().length;
		expect(await clone(harness)).toMatchObject({ ok: true });
		expect(JSON.stringify(harness.sessionManager.buildSessionProjection().messages)).toBe(projection);
		expect(harness.session.messages).toHaveLength(messages);
		expect(harness.sessionManager.getEntries()).toHaveLength(entries);
	});
});

describe("the clone's spawn", () => {
	it("starts the mentioned type as the session's own detached background agent, with the call's prompt, description and name", async () => {
		const { harness, state, subagents } = await session();
		state.clone = () => agentCall({ ...CALL, name: "Clone Name" });
		const result = await clone(harness);
		if (!result.ok) throw new Error(result.error);
		expect(result.view).toMatchObject({
			type: "worker",
			mode: "detached-background",
			toolCallId: undefined,
			parentId: undefined,
			prompt: "written from context",
			description: "clone desc",
			alias: "clone-name",
		});
		expect(subagents.list().map((view) => view.id)).toEqual([result.view.id]);
		await vi.waitFor(() => expect(result.view.status).toBe("completed"), CHILD_START);
	});

	it("forwards the call's model, thinking, max_turns, inherit_context, isolated and isolation", async () => {
		const { harness, state } = await session({ worktreeIsolation: true });
		const git = (...args: string[]) => execFileSync("git", args, { cwd: harness.tempDir, stdio: "pipe" });
		git("init", "-q");
		git("config", "user.email", "test@example.com");
		git("config", "user.name", "Test");
		writeFileSync(join(harness.tempDir, "README.md"), "repo\n");
		git("add", "README.md");
		git("commit", "-q", "-m", "initial");
		state.clone = () =>
			agentCall({
				...CALL,
				model: "faux-2",
				thinking: "low",
				max_turns: 3,
				inherit_context: true,
				isolated: true,
				isolation: "worktree",
			});
		const result = await clone(harness);
		if (!result.ok) throw new Error(result.error);
		expect(result.view.invocation).toMatchObject({
			modelInput: "faux-2",
			thinking: "low",
			maxTurns: 3,
			inheritContext: true,
			isolated: true,
			isolation: "worktree",
		});
		await vi.waitFor(() => expect(result.view.status).toBe("completed"), CHILD_START);
	});

	it("starts a new detached background agent even when the call asks to resume or to run in the foreground", async () => {
		const { harness, state, subagents } = await session();
		state.clone = () => agentCall(CALL);
		const first = await clone(harness);
		if (!first.ok) throw new Error(first.error);
		await vi.waitFor(() => expect(first.view.status).toBe("completed"), CHILD_START);
		state.clone = () => agentCall({ ...CALL, resume: first.view.id, run_in_background: false });
		const second = await clone(harness);
		if (!second.ok) throw new Error(second.error);
		expect(second.view.id).not.toBe(first.view.id);
		expect(second.view).toMatchObject({ mode: "detached-background", toolCallId: undefined });
		expect(subagents.list()).toHaveLength(2);
		await vi.waitFor(() => expect(second.view.status).toBe("completed"), CHILD_START);
	});

	it("starts nothing when the mentioned type is no longer a listed agent", async () => {
		const { harness, state, subagents } = await session();
		writeFileSync(
			join(harness.tempDir, "agents", "worker.md"),
			"---\ndescription: Test worker.\nenabled: false\n---\nYou are a test worker.",
		);
		state.clone = () => agentCall(CALL);
		expect(await clone(harness)).toEqual({ ok: false, error: "The worker agent is no longer available." });
		expect(subagents.list()).toEqual([]);
	});

	it("honours only the first Agent call of the reply", async () => {
		const { harness, state } = await session();
		state.clone = () => agentCall(CALL, fauxToolCall("Agent", { ...CALL, prompt: "second call" }));
		const result = await clone(harness);
		if (!result.ok) throw new Error(result.error);
		expect(result.view.prompt).toBe("written from context");
	});

	it("applies the tool's prepareArguments before validating", async () => {
		const { harness, state } = await session();
		const real = harness.session.getToolDefinition("Agent");
		if (!real) throw new Error("no Agent tool");
		const prepared: ToolDefinition = {
			...real,
			description: real.description,
			parameters: real.parameters,
			// Fills the required prompt from a legacy field, so validation passes only after it ran.
			prepareArguments: (args) => {
				const { legacy_prompt, ...rest } = args as Record<string, unknown>;
				return { ...rest, prompt: `prepared: ${String(legacy_prompt)}` };
			},
		};
		vi.spyOn(harness.session, "getToolDefinition").mockReturnValue(prepared);
		state.clone = () =>
			agentCall({ subagent_type: "general-purpose", description: "clone desc", legacy_prompt: "old field" });
		const result = await clone(harness);
		if (!result.ok) throw new Error(result.error);
		expect(result.view.prompt).toBe("prepared: old field");
	});
});

describe("when the clone cannot start the agent", () => {
	it("reports a reply that never called the tool", async () => {
		const { harness, state, subagents } = await session();
		state.clone = () => fauxAssistantMessage([fauxText("I would start the worker.")]);
		expect(await clone(harness)).toEqual({ ok: false, error: "the conversation clone did not start it" });
		expect(subagents.list()).toEqual([]);
	});

	it("reports a provider error", async () => {
		const { harness, state, subagents } = await session();
		state.clone = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "rate limited" });
		expect(await clone(harness)).toEqual({ ok: false, error: "rate limited" });
		expect(subagents.list()).toEqual([]);
	});

	it("rejects arguments that do not match the tool schema", async () => {
		const { harness, state, subagents } = await session();
		state.clone = () => agentCall({ subagent_type: "general-purpose", description: "no prompt" });
		const result = await clone(harness);
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.error).toContain("prompt");
		expect(subagents.list()).toEqual([]);
	});

	it("reports a missing model without sending a request", async () => {
		const { harness, state, subagents } = await session();
		vi.spyOn(harness.session, "model", "get").mockReturnValue(undefined);
		expect(await clone(harness)).toEqual({ ok: false, error: "no model is selected" });
		expect(state.requests).toEqual([]);
		expect(subagents.list()).toEqual([]);
	});

	it("returns a thrown error rather than rejecting", async () => {
		const { harness, subagents } = await session();
		vi.spyOn(harness.session.modelRuntime, "streamSimple").mockImplementation(() => {
			throw new Error("no credentials");
		});
		await expect(clone(harness)).resolves.toEqual({ ok: false, error: "no credentials" });
		expect(subagents.list()).toEqual([]);
	});

	it("ends the request when its signal aborts, and starts no agent", async () => {
		const { harness, state, subagents } = await session();
		// Held until released, or answered empty once its request's signal aborts.
		const gate = held(() => agentCall(CALL));
		state.clone = gate.behavior;
		const controller = new AbortController();
		const pending = clone(harness, "check the RPC path", controller.signal);
		await vi.waitFor(() => expect(gate.requests()).toBe(1));
		controller.abort();
		const result = await Promise.race([pending, sleep(5000).then(() => "still waiting" as const)]);
		expect(result).toMatchObject({ ok: false });
		gate.release();
		await sleep(50);
		expect(subagents.list()).toEqual([]);
	});
});
