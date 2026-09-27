/**
 * Fork-owned: `Agent`, `get_subagent_result` and `steer_subagent` as fork base tools (plan T5), on
 * real parent and child sessions with the faux router of `fork-subagents-fixtures.ts`.
 * Old pi-subagents tests at 79a7c42 this covers: tool-description-mode, steer-subagent-wiring,
 * agent-tool-error-rendering (the result text; rendering is phase 2).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { lineageForBus } from "../../src/core/fork-builtins/subagents/runner/lineage.ts";
import {
	type SubagentService,
	subagentServiceFor,
	subagentSessionRecord,
} from "../../src/core/fork-builtins/subagents/service/service.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import {
	agentId,
	type Behavior,
	CHILD_START,
	call,
	held,
	notices,
	router,
	say,
	sleep,
	text,
	textOf,
} from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const SUBAGENT_TOOLS = ["Agent", "get_subagent_result", "steer_subagent"];

const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

/** A session whose working and agent directory holds the `worker` agent before the session is built. */
async function session(
	subagents: Record<string, unknown> = {},
	options: HarnessOptions = {},
	builtins: "on" | "off" = "on",
): Promise<Harness> {
	vi.stubEnv("PI_FORK_BUILTINS", builtins);
	const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-tools-"));
	// A plain test agent keeps children fast: no extensions, read only.
	mkdirSync(join(cwd, "agents"), { recursive: true });
	writeFileSync(
		join(cwd, "agents", "worker.md"),
		"---\ndescription: test worker\ntools: read\nextensions: false\n---\nYou are a test worker.",
	);
	const harness = await createHarness({
		...options,
		cwd,
		settings: { forkBuiltins: { subagents } } as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	return harness;
}

async function parent(
	subagents: Record<string, unknown> = {},
	script: Record<string, Behavior[]> = {},
	main?: Behavior,
): Promise<Harness> {
	const harness = await session(subagents);
	harness.setResponses(Array.from({ length: 300 }, () => router(script, main)));
	return harness;
}

const task = (prompt: string, extra: Record<string, unknown> = {}) => ({
	subagent_type: "worker",
	prompt,
	description: prompt,
	...extra,
});

function serviceOf(harness: Harness): SubagentService {
	const service = subagentServiceFor(harness.session);
	if (!service) throw new Error("no subagent service");
	return service;
}

/** The property names of a tool's object schema. */
function parameterNames(tool: { parameters: object }): string[] {
	const { properties } = tool.parameters as { properties?: object };
	return Object.keys(properties ?? {});
}

function agentTool(harness: Harness) {
	const tool = harness.session.getAllTools().find((info) => info.name === "Agent");
	if (!tool) throw new Error("Agent is not registered");
	return tool;
}

describe("Agent", () => {
	it("runs a foreground agent from the model's tool call and returns the child's text", async () => {
		let parentCalls = 0;
		const harness = await parent({}, { alpha: [say("alpha result")] }, () =>
			++parentCalls === 1
				? fauxAssistantMessage([fauxToolCall("Agent", task("alpha task", { run_in_background: false }))], {
						stopReason: "toolUse",
					})
				: fauxAssistantMessage("parent done"),
		);
		await harness.session.prompt("delegate the alpha task");
		const result = harness.session.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "Agent",
		);
		const output = textOf(result?.role === "toolResult" ? result.content : "");
		expect(output).toMatch(/^Agent completed in \d+\.\ds \(0 tool uses, [\d.]+k? token\)\.\n\nalpha result$/);
		expect(parentCalls).toBe(2);
	});

	it("starts a background agent, returns its id at once, and notifies on completion", async () => {
		const harness = await parent({ defaultJoinMode: "async" }, { beta: [say("beta result")] });
		const result = await call(harness, "Agent", task("beta task"));
		expect(text(result)).toMatch(/^Agent started in background\.\nAgent ID: /);
		const id = agentId(result);
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1), { timeout: 5000 });
		expect(notices(harness.session)[0]).toContain(`<task-id>${id}</task-id>`);
		expect(notices(harness.session)[0]).toContain("beta result");
	});

	it("returns an unknown type under fallbackSubagent none as text naming the available types, and starts nothing", async () => {
		const harness = await parent({ fallbackSubagent: "none" });
		const refused = await call(harness, "Agent", { ...task("nothing"), subagent_type: "nobody" });
		expect(text(refused)).toBe(
			'Unknown or disabled agent type: "nobody". Available: general-purpose, Explore, Plan, worker.',
		);
		expect(serviceOf(harness).list()).toEqual([]);
	});

	it("notes an unknown type that fell back to the configured agent", async () => {
		const harness = await parent({ fallbackSubagent: "worker" });
		const result = await call(harness, "Agent", {
			...task("epsilon task", { run_in_background: false }),
			subagent_type: "nobody",
		});
		expect(text(result)).toMatch(/^Note: Unknown agent type "nobody" — using worker\.\n\nAgent completed in /);
		expect(text(result)).toContain("reply to epsilon task");
	});

	it("returns a failed foreground agent's error with its partial output", async () => {
		const harness = await parent(
			{},
			{
				iota: [
					() =>
						fauxAssistantMessage([fauxText("half done")], {
							stopReason: "error",
							errorMessage: "provider exploded",
						}),
				],
			},
		);
		const result = await call(harness, "Agent", task("iota task", { run_in_background: false }));
		expect(text(result)).toBe("Agent failed: provider exploded\n\nPartial output before the failure:\nhalf done");
	});

	it("stops a foreground agent with its call's abort signal, and lets a background agent outlive it", async () => {
		const stuck = held(() => fauxAssistantMessage("never"));
		const slow = held(() => fauxAssistantMessage("lambda result"));
		const harness = await parent({ defaultJoinMode: "async" }, { mu: [stuck.behavior], lambda: [slow.behavior] });
		const controller = new AbortController();
		const background = agentId(await call(harness, "Agent", task("lambda task"), controller.signal));
		await vi.waitFor(() => expect(slow.requests()).toBe(1), CHILD_START);
		const foreground = call(harness, "Agent", task("mu task", { run_in_background: false }), controller.signal);
		await vi.waitFor(() => expect(stuck.requests()).toBe(1), CHILD_START);
		controller.abort();
		expect(text(await foreground)).toMatch(
			/^Agent completed in .* \(STOPPED BY THE USER — everything the agent produced is above; the task is unfinished\)\.\n\nNo output\.$/s,
		);
		expect(serviceOf(harness).get(background)?.status).toBe("running");
		slow.release();
		await serviceOf(harness).waitForResult(background);
		expect(serviceOf(harness).get(background)?.status).toBe("completed");
	});

	it("resumes a finished agent in the foreground, then in the background by default", async () => {
		const harness = await parent(
			{ defaultJoinMode: "async" },
			{ kappa: [say("kappa one")], again: [say("kappa two")] },
		);
		await call(harness, "Agent", task("kappa task", { run_in_background: false }));
		const [record] = serviceOf(harness).list();
		const foreground = await call(harness, "Agent", {
			...task("again now", { run_in_background: false }),
			resume: record.id,
		});
		expect(text(foreground)).toMatch(/^Agent completed in .*\n\nkappa two$/s);
		const background = await call(harness, "Agent", { ...task("again later"), resume: record.id });
		expect(text(background)).toMatch(/^Agent resumed in background\.\nAgent ID: /);
		expect(agentId(background)).toBe(record.id);
		await serviceOf(harness).waitForResult(record.id);
		const unknown = await call(harness, "Agent", { ...task("again"), resume: "nobody" });
		expect(text(unknown)).toBe('Agent not found: "nobody". It may have been cleaned up.');
	});

	it("attaches the subagent spend to the result under reportUsage", async () => {
		const harness = await parent({ reportUsage: true }, { theta: [say("theta result")] });
		const result = await call(harness, "Agent", task("theta task", { run_in_background: false }));
		const [record] = serviceOf(harness).list();
		expect(record.usage.input + record.usage.output).toBeGreaterThan(0);
		expect(result.usage).toEqual(record.usage);
		const again = await call(harness, "get_subagent_result", { agent_id: record.id });
		expect(again.usage).toBeUndefined();
	});
});

describe("get_subagent_result", () => {
	it("reports a running agent, waits for its result, and consumes it so no notification arrives", async () => {
		const gate = held(() => fauxAssistantMessage("gamma result"));
		const harness = await parent({ defaultJoinMode: "async" }, { gamma: [gate.behavior] });
		const id = agentId(await call(harness, "Agent", task("gamma task")));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const running = text(await call(harness, "get_subagent_result", { agent_id: id }));
		expect(running).toMatch(/Status: running \|/);
		expect(running).toMatch(/Agent is still running\. Use wait: true or check back later\.$/);
		const waiting = call(harness, "get_subagent_result", { agent_id: id, wait: true });
		gate.release();
		const finished = text(await waiting);
		expect(finished).toMatch(new RegExp(`^Agent: ${id}\nType: worker \\| Status: completed \\| `));
		expect(finished).toMatch(/\nDescription: gamma task\n\ngamma result$/);
		await sleep(400);
		expect(notices(harness.session)).toEqual([]);
	});

	it("stops only the wait when its call is cancelled: the agent keeps running and still notifies", async () => {
		const gate = held(() => fauxAssistantMessage("delta result"));
		const harness = await parent({ defaultJoinMode: "async" }, { delta: [gate.behavior] });
		const id = agentId(await call(harness, "Agent", task("delta task")));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const controller = new AbortController();
		const waiting = call(harness, "get_subagent_result", { agent_id: id, wait: true }, controller.signal);
		controller.abort();
		expect(text(await waiting)).toBe(
			`Stopped waiting for agent ${id}. It is still running and keeps running; its completion notification will still arrive.`,
		);
		expect(serviceOf(harness).get(id)?.status).toBe("running");
		gate.release();
		await vi.waitFor(() => expect(notices(harness.session)).toHaveLength(1), { timeout: 5000 });
		expect(notices(harness.session)[0]).toContain("delta result");
	});
});

describe("steer_subagent", () => {
	it("queues a message for an agent not yet started, sends one to a running agent, and refuses a finished one", async () => {
		const gate = held(() => fauxAssistantMessage("first done"));
		const seen: string[] = [];
		const harness = await parent(
			{ maxConcurrent: 1, defaultJoinMode: "async" },
			{
				first: [gate.behavior],
				second: [
					(context) => {
						seen.push(
							...context.messages
								.filter((message) => message.role === "user")
								.map((message) => textOf(message.content)),
						);
						return fauxAssistantMessage("second done");
					},
				],
			},
		);
		const first = agentId(await call(harness, "Agent", task("first task")));
		const second = agentId(await call(harness, "Agent", task("second task")));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const queued = await call(harness, "steer_subagent", { agent_id: second, message: "also check the tests" });
		expect(text(queued)).toBe(
			`Steering message queued for agent ${second}. It will be delivered once the session initializes.`,
		);
		const sent = await call(harness, "steer_subagent", { agent_id: first, message: "hurry up" });
		expect(text(sent)).toMatch(
			new RegExp(`^Steering message sent to agent ${first}\\. .*\nCurrent state: .*0 tool uses`, "s"),
		);
		gate.release();
		await serviceOf(harness).waitForResult(second);
		expect(seen).toContain("also check the tests");
		const refused = await call(harness, "steer_subagent", { agent_id: first, message: "too late" });
		expect(text(refused)).toBe(
			`Agent "${first}" is not running (status: completed). Cannot steer a non-running agent.`,
		);
		const unknown = await call(harness, "steer_subagent", { agent_id: "nobody", message: "hello" });
		expect(text(unknown)).toBe('Agent not found: "nobody". It may have been cleaned up.');
	});
});

describe("registration", () => {
	it("registers the three tools as active builtins, and drops them with PI_FORK_BUILTINS=off or the allow and exclude lists", async () => {
		const on = await session();
		for (const name of SUBAGENT_TOOLS) {
			expect(on.session.getAllTools().find((info) => info.name === name)?.sourceInfo.path).toBe(`<builtin:${name}>`);
		}
		expect(on.session.getActiveToolNames()).toEqual(expect.arrayContaining(SUBAGENT_TOOLS));
		const names = (harness: Harness) => harness.session.getAllTools().map((info) => info.name);
		for (const harness of [
			await session({}, {}, "off"),
			await session({}, { allowedToolNames: ["read"] }),
			await session({}, { excludedToolNames: SUBAGENT_TOOLS }),
		]) {
			for (const name of SUBAGENT_TOOLS) expect(names(harness)).not.toContain(name);
		}
	});

	it("lets an extension tool named Agent override the base tool", async () => {
		const factory = (pi: ExtensionAPI) => {
			pi.registerTool({
				name: "Agent",
				label: "Extension agent",
				description: "An extension's own Agent",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "extension agent" }], details: {} }),
			});
		};
		const harness = await session({}, { extensionFactories: [{ name: "own-agent", factory }] });
		expect(agentTool(harness).sourceInfo.path).toBe("<inline:own-agent>");
		expect(text(await call(harness, "Agent", {}))).toBe("extension agent");
	});

	it("keeps one service across /reload, which still returns an agent finished before it", async () => {
		const harness = await parent({}, { zeta: [say("zeta result")] });
		await call(harness, "Agent", task("zeta task", { run_in_background: false }));
		const service = serviceOf(harness);
		const [record] = service.list();
		await harness.session.reload();
		expect(subagentServiceFor(harness.session)).toBe(service);
		const result = await call(harness, "get_subagent_result", { agent_id: record.id });
		expect(text(result)).toMatch(/\n\nzeta result$/);
	});

	it("gives a child session the lineage its loader's bus holds, and the parent none", async () => {
		const harness = await parent({}, { eta: [say("eta result")] });
		await call(harness, "Agent", task("eta task", { run_in_background: false }));
		const service = serviceOf(harness);
		const [record] = service.list();
		const child = record.child;
		if (!child) throw new Error("the child was not kept");
		const lineage = lineageForBus(child.loader.getEventBus());
		// Identity checks: a deep comparison would walk the session into its theme proxy.
		expect(lineage?.owner).toBe(service);
		expect(lineage?.parentRecord).toBe(record);
		expect([lineage?.depth, lineage?.isolated]).toEqual([1, false]);
		expect(subagentSessionRecord(child.session)?.lineage).toBe(lineage);
		expect(subagentSessionRecord(harness.session)?.lineage).toBeUndefined();
	});
});

describe("the Agent description", () => {
	it("follows toolDescriptionMode, and offers isolation only while worktrees are on", async () => {
		const full = agentTool(await session());
		expect(full.description).toContain("## Usage notes");
		expect(full.description).toContain("\n- worker: test worker (Tools: read)\n");
		expect(full.description).toContain('Use isolation: "worktree"');
		expect(parameterNames(full)).toContain("isolation");
		expect(JSON.stringify(full.parameters)).toContain("Available types: general-purpose, Explore, Plan, worker.");

		const compact = agentTool(await session({ toolDescriptionMode: "compact" }));
		expect(compact.description).toMatch(/^Launch an autonomous agent for complex, multi-step tasks\./);
		expect(compact.description).toContain("\n- worker: test worker (Tools: read)\n");
		expect(compact.description).not.toContain("## Usage notes");

		const noWorktrees = agentTool(await session({ worktreeIsolation: false }));
		expect(noWorktrees.description).not.toContain("isolation");
		expect(parameterNames(noWorktrees)).not.toContain("isolation");
	});

	it("renders a custom template from the project, then the agent directory, and falls back to full", async () => {
		const harness = await session({ toolDescriptionMode: "custom" }, {});
		const projectFile = join(harness.tempDir, ".pi", "agent-tool-description.md");
		const globalFile = join(harness.tempDir, "agent-tool-description.md");
		mkdirSync(join(harness.tempDir, ".pi"), { recursive: true });
		writeFileSync(projectFile, "Project agents:\n{{compactTypeList}}\nfrom {{agentDir}} {{scheduleGuideline}}");
		writeFileSync(globalFile, "Global agents:\n{{typeList}}");
		await harness.session.reload();
		const rendered = agentTool(harness).description;
		expect(rendered).toMatch(/^Project agents:\n- general-purpose: [^\n]* \(Tools: \*\)\n/);
		expect(rendered).toContain(
			`\n- worker: test worker (Tools: read)\nfrom ${harness.tempDir} {{scheduleGuideline}}`,
		);
		expect(serviceOf(harness).warnings).toContain(
			"agent-tool-description.md: unknown placeholder {{scheduleGuideline}} is left as written.",
		);
		rmSync(projectFile);
		await harness.session.reload();
		expect(agentTool(harness).description).toMatch(/^Global agents:\n- general-purpose: /);
		rmSync(globalFile);
		await harness.session.reload();
		expect(agentTool(harness).description).toContain("## Usage notes");
		expect(serviceOf(harness).warnings).toContain(
			'toolDescriptionMode is "custom", but no agent-tool-description.md was found; the full description is used.',
		);
	});

	it("keeps a session whose strict agent file fails to load: the description lists the defaults, and a spawn fails as text", async () => {
		const harness = await parent({ strictAgentFiles: true });
		writeFileSync(join(harness.tempDir, "agents", "bad.md"), "---\ndescription: bad\nbogus: 1\n---\nBad.");
		await harness.session.reload();
		const description = agentTool(harness).description;
		expect(description).toContain("\n- general-purpose: ");
		expect(description).not.toContain("- worker:");
		const refused = await call(harness, "Agent", task("anything"));
		expect(text(refused)).toContain('has unknown frontmatter key "bogus"');
		expect(serviceOf(harness).warnings.filter((warning) => warning.includes('"bogus"'))).toEqual([
			expect.stringMatching(
				/^The Agent tool lists only the default agents: Agent file .*bad\.md has unknown frontmatter key "bogus"$/,
			),
		]);
	});

	it("ignores an untrusted project's custom template", async () => {
		const harness = await session({ toolDescriptionMode: "custom" });
		mkdirSync(join(harness.tempDir, ".pi"), { recursive: true });
		writeFileSync(join(harness.tempDir, ".pi", "agent-tool-description.md"), "Project text");
		writeFileSync(join(harness.tempDir, "agent-tool-description.md"), "Global text");
		await harness.session.reload();
		expect(agentTool(harness).description).toBe("Project text");
		harness.settingsManager.setProjectTrusted(false);
		await harness.session.reload();
		expect(agentTool(harness).description).toBe("Global text");
	});
});
