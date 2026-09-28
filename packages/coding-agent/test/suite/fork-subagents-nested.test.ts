/**
 * Fork-owned: nested subagents (plan T6) on real parent, child and grandchild sessions. The faux
 * router of `fork-subagents-fixtures.ts` answers each agent by its task keyword; an agent's script
 * calls its nested tools through ordinary tool calls.
 * Old pi-subagents tests at 79a7c42 this covers: nested-tools, nested-delegation-e2e,
 * subagents-nested-print-mode-e2e.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { SubagentRecord } from "../../src/core/fork-builtins/subagents/service/records.ts";
import {
	inspectRecord,
	PARENT_ENDED_ERROR,
	type SubagentService,
} from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import { addUsage, emptyUsage } from "../../src/core/fork-builtins/subagents/usage.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { type Behavior, CHILD_START, call, held, router, say, text, textOf, use } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const SUBAGENT_TOOLS = ["Agent", "get_subagent_result", "steer_subagent"];

/** Plain, read-only agents without extensions keep every child fast. */
const AGENTS: Record<string, string> = {
	worker: "description: test worker",
	// `ghost` names no agent: a refusal lists only agents that exist and are enabled.
	lead: "description: delegating lead\nallowed_subagents: worker, ghost",
	hermit: "description: isolated lead\nisolated: true\nallowed_subagents: all",
	mentor: "description: mentor on its own model\nmodel: faux-b\nallowed_subagents: echo",
	echo: "description: appends its parent's prompt\nprompt_mode: append",
};

const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

async function parent(
	subagents: Record<string, unknown>,
	script: Record<string, Behavior[]>,
	options: HarnessOptions = {},
): Promise<Harness> {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-nested-"));
	mkdirSync(join(cwd, "agents"), { recursive: true });
	for (const [name, frontmatter] of Object.entries(AGENTS)) {
		writeFileSync(
			join(cwd, "agents", `${name}.md`),
			`---\n${frontmatter}\ntools: read\nextensions: false\n---\nYou are ${name}.`,
		);
	}
	const harness = await createHarness({
		...options,
		cwd,
		settings: { forkBuiltins: { subagents } } as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	harness.setResponses(Array.from({ length: 300 }, () => router(script)));
	return harness;
}

function serviceOf(harness: Harness): SubagentService {
	const service = subagentServiceFor(harness.session);
	if (!service) throw new Error("no subagent service");
	return service;
}

/** The text of every tool result a session received from `name`, in order. */
function toolResults(session: AgentSession | undefined, name: string): string[] {
	return (session?.messages ?? []).flatMap((message) =>
		message.role === "toolResult" && message.toolName === name ? [textOf(message.content)] : [],
	);
}

/** The nested id the agent's latest background spawn reported, read from its own conversation. */
function spawnedId(context: Context): string {
	const ids = context.messages.flatMap((message) => {
		const match = message.role === "toolResult" ? /Agent ID: (\S+)/.exec(textOf(message.content)) : null;
		return match ? [match[1]] : [];
	});
	const id = ids.at(-1);
	if (!id) throw new Error("no nested agent id in the conversation");
	return id;
}

function lastResult(context: Context): string {
	const results = context.messages.filter((message) => message.role === "toolResult");
	return textOf(results.at(-1)?.content);
}

/** Runs a top-level agent in the foreground and returns its record. */
async function runLead(harness: Harness, type: string, prompt: string): Promise<SubagentRecord> {
	await call(harness, "Agent", { subagent_type: type, prompt, description: prompt, run_in_background: false });
	const record = serviceOf(harness)
		.list()
		.find((candidate) => candidate.prompt === prompt);
	const internal = record && inspectRecord(serviceOf(harness), record.id);
	if (!internal) throw new Error(`no record for ${prompt}`);
	return internal;
}

function sum(session: AgentSession | undefined) {
	const total = emptyUsage();
	for (const message of session?.messages ?? []) if (message.role === "assistant") addUsage(total, message.usage);
	return total;
}

const subagentTools = (record: SubagentRecord) =>
	(record.child?.session.getAllTools() ?? []).filter((tool) => SUBAGENT_TOOLS.includes(tool.name));

describe("nested tools", () => {
	it("gives an agent with allowed_subagents the three nested tools as SDK tools, and an isolated one none", async () => {
		const harness = await parent({}, {});
		const lead = await runLead(harness, "lead", "lead task");
		expect(subagentTools(lead).map((tool) => tool.sourceInfo.path)).toEqual(
			SUBAGENT_TOOLS.map((name) => `<sdk:${name}>`),
		);
		expect(lead.child?.session.getActiveToolNames()).toEqual(expect.arrayContaining(SUBAGENT_TOOLS));
		const hermit = await runLead(harness, "hermit", "hermit task");
		expect(subagentTools(hermit)).toEqual([]);
	});

	it("removes the nested tools at the depth cap", async () => {
		const harness = await parent({ maxSubagentDepth: 1 }, {});
		const lead = await runLead(harness, "lead", "lead task");
		expect(subagentTools(lead)).toEqual([]);
	});

	it("refuses a nested type outside allowed_subagents, naming the allowed list", async () => {
		const harness = await parent(
			{},
			{
				refused: [
					use("Agent", () => ({ subagent_type: "Explore", prompt: "explore", description: "explore" })),
					use("Agent", () => ({ subagent_type: "nobody", prompt: "nobody", description: "nobody" })),
					say("lead done"),
				],
			},
		);
		const lead = await runLead(harness, "lead", "refused task");
		expect(toolResults(lead.child?.session, "Agent")).toEqual([
			'Nested agent type "Explore" is not allowed for this parent. Allowed: worker.',
			'Unknown or disabled nested agent type: "nobody". Allowed: worker.',
		]);
	});
});

describe("nested inheritance", () => {
	it("gives a nested agent the model, conversation and system prompt of the agent that delegated", async () => {
		const harness = await parent(
			{},
			{
				mentor: [
					use("Agent", () => ({
						subagent_type: "echo",
						prompt: "echo task",
						description: "echo",
						inherit_context: true,
						run_in_background: true,
					})),
					use("get_subagent_result", (context) => ({ agent_id: spawnedId(context), wait: true })),
					say("mentor done"),
				],
				echo: [say("echo done")],
			},
			{ models: [{ id: "faux-a" }, { id: "faux-b" }] },
		);
		await harness.session.prompt("main secret");
		const mentor = await runLead(harness, "mentor", "mentor task");
		const id = /Agent ID: (\S+)/.exec(toolResults(mentor.child?.session, "Agent")[0])?.[1] ?? "";
		const owned = serviceOf(harness).nested(mentor).get(id);
		const echo = owned && inspectRecord(serviceOf(harness), owned.id);
		if (!echo?.child) throw new Error("the nested child was not kept");
		expect([mentor.model?.id, echo.model?.id]).toEqual(["faux-b", "faux-b"]);
		const first = echo.child.session.messages.find((message) => message.role === "user");
		const inherited = textOf(first?.role === "user" ? first.content : "");
		expect(inherited).toContain("mentor task");
		expect(inherited).not.toContain("main secret");
		expect(echo.child.session.systemPrompt).toContain("You are mentor.");
	});
});

describe("nested ownership", () => {
	it("steers a running nested agent, and aborts it when the parent's run ends", async () => {
		const stuck = held(() => fauxAssistantMessage("never"));
		const harness = await parent(
			{},
			{
				ending: [
					use("Agent", () => ({
						subagent_type: "worker",
						prompt: "xray task",
						description: "xray",
						run_in_background: true,
					})),
					use("steer_subagent", (context) => ({ agent_id: spawnedId(context), message: "focus" })),
					say("lead done"),
				],
				xray: [stuck.behavior],
			},
		);
		const lead = await runLead(harness, "lead", "ending task");
		const [spawned, steered] = [
			toolResults(lead.child?.session, "Agent")[0],
			toolResults(lead.child?.session, "steer_subagent")[0],
		];
		const id = /Agent ID: (\S+)/.exec(spawned)?.[1] ?? "";
		expect(steered).toMatch(new RegExp(`^Steering message (sent to|queued for) nested agent ${id}\\.$`));
		const nested = serviceOf(harness).nested(lead);
		const child = await nested.waitForResult(id);
		// Picked fields: a deep comparison would walk the record into its session's theme proxy.
		expect({ status: child.status, error: child.error, depth: child.depth, handle: child.handle }).toEqual({
			status: "aborted",
			error: PARENT_ENDED_ERROR,
			depth: 2,
			handle: undefined,
		});
		expect(inspectRecord(serviceOf(harness), child.id)?.parent).toBe(lead);
	});

	it("reports a nested steer the child refuses as a failed delivery", async () => {
		const stuck = held(() => fauxAssistantMessage("never"));
		const harness = await parent(
			{},
			{
				directing: [
					use("Agent", () => ({
						subagent_type: "commander",
						prompt: "orders task",
						description: "orders",
						run_in_background: true,
					})),
					// Steers once the nested child runs, so the steer reaches its session instead of waiting.
					async (context) => {
						await vi.waitFor(() => expect(stuck.requests()).toBe(1), CHILD_START);
						return fauxAssistantMessage(
							[fauxToolCall("steer_subagent", { agent_id: spawnedId(context), message: "/probe-cmd" })],
							{ stopReason: "toolUse" },
						);
					},
					say("director done"),
				],
				orders: [stuck.behavior],
			},
		);
		const agents = join(harness.tempDir, "agents");
		writeFileSync(
			join(agents, "director.md"),
			"---\ndescription: directs\ntools: read\nextensions: false\nallowed_subagents: commander\n---\nYou direct.",
		);
		// The commander loads the agent directory's extensions, which register the command `probe-cmd`.
		writeFileSync(join(agents, "commander.md"), "---\ndescription: loads extensions\ntools: read\n---\nYou command.");
		mkdirSync(join(harness.tempDir, "extensions"), { recursive: true });
		writeFileSync(
			join(harness.tempDir, "extensions", "probe-cmd.ts"),
			'export default function (pi) {\n\tpi.registerCommand("probe-cmd", { description: "probe", handler: async () => {} });\n}\n',
		);
		const director = await runLead(harness, "director", "directing task");
		const id = /Agent ID: (\S+)/.exec(toolResults(director.child?.session, "Agent")[0])?.[1] ?? "";
		expect(toolResults(director.child?.session, "steer_subagent")[0]).toMatch(
			new RegExp(`^Failed to steer nested agent ${id}: \\S`),
		);
	});

	it("lets no agent reach a nested agent it does not own, and hides it from the session", async () => {
		const stuck = held(() => fauxAssistantMessage("never"));
		const lingering = held(() => fauxAssistantMessage("alpha done"));
		let xrayId = "";
		const harness = await parent(
			{ defaultJoinMode: "async" },
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
				beta: [
					() =>
						fauxAssistantMessage(
							[
								fauxToolCall("get_subagent_result", { agent_id: xrayId }),
								fauxToolCall("steer_subagent", { agent_id: xrayId, message: "hello" }),
								fauxToolCall("Agent", {
									subagent_type: "worker",
									prompt: "again",
									description: "again",
									resume: xrayId,
								}),
							],
							{ stopReason: "toolUse" },
						),
					say("beta done"),
				],
			},
		);
		await call(harness, "Agent", { subagent_type: "lead", prompt: "alpha task", description: "alpha" });
		await vi.waitFor(() => expect(stuck.requests()).toBe(1), CHILD_START);
		const alphaView = serviceOf(harness)
			.list()
			.find((record) => record.prompt === "alpha task");
		const alpha = alphaView && inspectRecord(serviceOf(harness), alphaView.id);
		xrayId = /Agent ID: (\S+)/.exec(toolResults(alpha?.child?.session, "Agent")[0])?.[1] ?? "";
		expect(xrayId).not.toBe("");

		const beta = await runLead(harness, "lead", "beta task");
		const notOwned = `Nested agent not found or not owned by this parent: "${xrayId}".`;
		expect(toolResults(beta.child?.session, "get_subagent_result")).toEqual([notOwned]);
		expect(toolResults(beta.child?.session, "steer_subagent")).toEqual([
			`Running nested agent not found or not owned by this parent: "${xrayId}".`,
		]);
		expect(toolResults(beta.child?.session, "Agent")).toEqual([notOwned]);

		const unknown = `Agent not found: "${xrayId}". It may have been cleaned up.`;
		expect(text(await call(harness, "get_subagent_result", { agent_id: xrayId }))).toBe(unknown);
		expect(text(await call(harness, "steer_subagent", { agent_id: xrayId, message: "hello" }))).toBe(unknown);
		const resumed = await call(harness, "Agent", {
			subagent_type: "worker",
			prompt: "again",
			description: "again",
			resume: xrayId,
		});
		expect(text(resumed)).toBe(unknown);
		expect(serviceOf(harness).nested(beta).get(xrayId)).toBeUndefined();
		expect(serviceOf(harness).get(xrayId)).toBeUndefined();
		expect(alpha && serviceOf(harness).nested(alpha).get(xrayId)?.status).toBe("running");
	});
});

describe("nested accounting", () => {
	it("counts a nested agent's usage once in its parent's total and files its transcript beside the parent's", async () => {
		const harness = await parent(
			{ reportUsage: true },
			{
				gamma: [
					use("Agent", () => ({
						subagent_type: "worker",
						prompt: "delta task",
						description: "delta",
						run_in_background: true,
					})),
					use("get_subagent_result", (context) => ({ agent_id: spawnedId(context), wait: true })),
					use("Agent", (context) => ({
						subagent_type: "worker",
						prompt: "delta again",
						description: "delta again",
						resume: spawnedId(context),
					})),
					say("lead done"),
				],
				delta: [say("delta done")],
			},
		);
		const result = await call(harness, "Agent", {
			subagent_type: "lead",
			prompt: "gamma task",
			description: "gamma",
			run_in_background: false,
		});
		const [leadView] = serviceOf(harness).list();
		const lead = inspectRecord(serviceOf(harness), leadView.id);
		if (!lead) throw new Error("no lead record");
		const id = /Agent ID: (\S+)/.exec(toolResults(lead.child?.session, "Agent")[0])?.[1] ?? "";
		const owned = serviceOf(harness).nested(lead).get(id);
		const nested = owned && inspectRecord(serviceOf(harness), owned.id);
		if (!nested) throw new Error("the nested record is gone");
		expect(toolResults(lead.child?.session, "get_subagent_result")).toEqual(["delta done"]);
		expect(toolResults(lead.child?.session, "Agent")[1]).toBe("delta done");

		expect(nested.usage).toEqual(sum(nested.child?.session));
		const own = sum(lead.child?.session);
		expect(own.input + nested.usage.input).toBe(lead.usage.input);
		expect(own.output + nested.usage.output).toBe(lead.usage.output);
		expect(result.usage).toEqual(lead.usage);
		expect(nested.transcriptPath && dirname(nested.transcriptPath)).toBe(
			lead.transcriptPath && dirname(lead.transcriptPath),
		);
	});

	it("finishes a foreground parent that delegates in the foreground when both pools hold one slot", async () => {
		const harness = await parent(
			{ maxConcurrentForeground: 1, maxConcurrent: 1 },
			{
				epsilon: [
					use("Agent", () => ({ subagent_type: "worker", prompt: "zeta task", description: "zeta" })),
					(context) => fauxAssistantMessage(`lead got: ${lastResult(context)}`),
				],
				zeta: [say("zeta done")],
			},
		);
		const result = await call(harness, "Agent", {
			subagent_type: "lead",
			prompt: "epsilon task",
			description: "epsilon",
			run_in_background: false,
		});
		expect(text(result)).toMatch(/\n\nlead got: zeta done$/);
	});
});
