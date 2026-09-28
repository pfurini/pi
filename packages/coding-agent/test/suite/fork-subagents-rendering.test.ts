/**
 * Fork-owned: how the `Agent` tool renders its calls and results, and its live progress (plan T8,
 * F12), on real parent and child sessions. Renderers run with a tag theme: `<color>text</color>`.
 * Old pi-subagents tests at 79a7c42 this covers: agent-model-display, cost-display (the tool
 * results), agent-color-surfaces (the call header), agent-tool-error-rendering, and
 * subagents-print-mode-e2e ("a colored agent's name badge never reaches print-mode text").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../../src/core/extensions/types.ts";
import { inspectRecord, type SubagentService } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { subagentServiceFor } from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import type { AgentToolDetails } from "../../src/core/fork-builtins/subagents/tools/details.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import type { Theme } from "../../src/modes/interactive/theme/theme.ts";
import { agentId, type Behavior, CHILD_START, call, held, router, text, use } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

/** Plain, read-only agents without extensions keep every child fast. */
const AGENTS: Record<string, string> = {
	worker: "description: test worker",
	twin: "description: appends its parent's prompt\nprompt_mode: append",
	reviewer: "description: reviews\ndisplay_name: Code Reviewer\ncolor: purple",
	leveled: "description: pins its level\nthinking: low",
	pinned: "description: pins its model\nmodel: faux-b",
	plain: "description: runs on a model without reasoning\nmodel: faux-plain",
};

async function parent(subagents: Record<string, unknown> = {}, script: Record<string, Behavior[]> = {}) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	const harness = await createHarness({
		models: [
			{ id: "faux-a", reasoning: true },
			{ id: "faux-b", reasoning: true },
			{ id: "faux-plain", reasoning: false },
		],
		settings: {
			forkBuiltins: { subagents: { defaultJoinMode: "async", ...subagents } },
		} as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	for (const [name, frontmatter] of Object.entries(AGENTS)) {
		writeFileSync(
			join(harness.tempDir, "agents", `${name}.md`),
			`---\n${frontmatter}\ntools: read\nextensions: false\n---\nYou are ${name}.`,
		);
	}
	harness.setResponses(Array.from({ length: 200 }, () => router(script)));
	return harness;
}

function serviceOf(harness: Harness): SubagentService {
	const service = subagentServiceFor(harness.session);
	if (!service) throw new Error("no subagent service");
	return service;
}

function agentDefinition(harness: Harness): ToolDefinition {
	const definition = harness.session.getToolDefinition("Agent");
	if (!definition?.renderCall || !definition.renderResult) throw new Error("Agent has no renderers");
	return definition;
}

/** Runs `Agent` as the agent loop would, with its update callback. */
function execute(
	harness: Harness,
	args: Record<string, unknown>,
	onUpdate?: (update: AgentToolResult<AgentToolDetails>) => void,
): Promise<AgentToolResult<AgentToolDetails>> {
	const ctx = harness.session.extensionRunner.createContext();
	return agentDefinition(harness).execute(`tc-${Math.random()}`, args, undefined, onUpdate as never, ctx) as Promise<
		AgentToolResult<AgentToolDetails>
	>;
}

const task = (prompt: string, extra: Record<string, unknown> = {}) => ({
	subagent_type: "worker",
	prompt,
	description: prompt,
	run_in_background: false,
	...extra,
});

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => value,
	getBgAnsi: (color: string) => `<${color}>`,
	getColorMode: () => "truecolor",
} as unknown as Theme;

/** The rendered text without the tag theme's markers. */
const plain = (value: string) => value.replace(/<\/?[a-zA-Z]+>/g, "");

function context(overrides: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args: {},
		toolCallId: "tc",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/tmp",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}

function renderResult(
	harness: Harness,
	result: AgentToolResult<unknown>,
	options: { expanded?: boolean; isPartial?: boolean; isError?: boolean } = {},
): string {
	const definition = agentDefinition(harness);
	return (
		definition
			.renderResult?.(
				result,
				{ expanded: options.expanded ?? false, isPartial: options.isPartial ?? false },
				theme,
				context({ isError: options.isError ?? false }),
			)
			.render(200)
			.map((line) => line.trimEnd())
			.join("\n") ?? ""
	);
}

/** A finished result's details, for the renderer cases that need a given status. */
function details(overrides: Partial<AgentToolDetails>): AgentToolDetails {
	return {
		status: "completed",
		agentId: "a1",
		displayName: "worker",
		description: "d",
		tags: [],
		toolUses: 2,
		turns: 1,
		tokens: 1234,
		compactions: 0,
		startedAt: 0,
		durationMs: 1500,
		...overrides,
	};
}

describe("Agent progress", () => {
	it("sends a running update after the child's first tool call, then one per window with a burst's last change", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
		const second = held(() =>
			fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" })], { stopReason: "toolUse" }),
		);
		const last = held(() => fauxAssistantMessage("progress done"));
		const harness = await parent(
			{},
			{
				"progress task": [use("read", () => ({ path: "a.txt" })), second.behavior, last.behavior],
			},
		);
		const updates: Array<{ at: number; details: AgentToolDetails }> = [];
		const pending = execute(harness, task("progress task"), (update) => {
			if (update.details) updates.push({ at: Date.now(), details: update.details });
		});
		await vi.waitFor(() => expect(second.requests()).toBe(1), CHILD_START);
		await vi.advanceTimersByTimeAsync(150);
		expect(updates.some(({ details }) => details.status === "running" && details.toolUses === 1)).toBe(true);
		const before = updates.length;
		second.release();
		await vi.waitFor(() => expect(last.requests()).toBe(1), CHILD_START);
		await vi.advanceTimersByTimeAsync(150);
		expect(updates.length).toBeGreaterThan(before);
		expect(updates.at(-1)?.details).toMatchObject({ status: "running", toolUses: 2 });
		for (let index = 1; index < updates.length; index++) {
			expect(updates[index].at - updates[index - 1].at).toBeGreaterThanOrEqual(100);
		}
		last.release();
		expect((await pending).details?.status).toBe("completed");
	});

	it("reports a queued foreground call's place in the queue", async () => {
		const gate = held(() => fauxAssistantMessage("held done"));
		const harness = await parent({ maxConcurrentForeground: 1 }, { hold: [gate.behavior] });
		const first = execute(harness, task("hold first"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const next: AgentToolDetails[] = [];
		const behind: AgentToolDetails[] = [];
		const second = execute(harness, task("hold second"), (update) => next.push(update.details as AgentToolDetails));
		const third = execute(harness, task("hold third"), (update) => behind.push(update.details as AgentToolDetails));
		await vi.waitFor(() => {
			expect(next[0]).toMatchObject({ status: "queued", queuePosition: 1 });
			expect(behind[0]).toMatchObject({ status: "queued", queuePosition: 2 });
		});
		expect(next[0].activity).toBe("queued — waiting for a foreground slot");
		expect(behind[0].activity).toBe("queued — waiting for a foreground slot (1 ahead)");
		// The call ahead stops while the slot stays taken: the last call moves up without an event of its own.
		const ahead = serviceOf(harness)
			.list()
			.find((view) => view.prompt === "hold second");
		expect(ahead && serviceOf(harness).stop(ahead.id)).toBe(true);
		await vi.waitFor(() => expect(behind.at(-1)?.activity).toBe("queued — waiting for a foreground slot"));
		gate.release();
		await Promise.all([first, second, third]);
	});

	it("keeps the turn limit the run enforces in its details, though the setting changed since", async () => {
		const gate = held(() => fauxAssistantMessage("limited done"));
		const harness = await parent({ defaultMaxTurns: 7 }, { limited: [gate.behavior] });
		const pending = execute(harness, task("limited task"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		vi.spyOn(harness.settingsManager, "getGlobalSettings").mockReturnValue({
			forkBuiltins: { subagents: { defaultJoinMode: "async", defaultMaxTurns: 20 } },
		} as unknown as Settings);
		expect(serviceOf(harness).reloadSettings().defaultMaxTurns).toBe(20);
		gate.release();
		expect((await pending).details).toMatchObject({ status: "completed", maxTurns: 7 });
	});
});

describe("Agent result rendering", () => {
	it("renders an error result's text, and a result without details as its raw text", async () => {
		const harness = await parent();
		expect(
			renderResult(
				harness,
				{ content: [{ type: "text", text: "blocked by an extension" }], details: {} },
				{ isError: true },
			),
		).toBe("blocked by an extension");
		expect(
			renderResult(harness, { content: [{ type: "text", text: "Unknown agent type" }], details: undefined }),
		).toBe("Unknown agent type");
	});

	// T18-F4: the row printed the agent's output with its escape sequences.
	it("prints a result's text without its escape sequences", async () => {
		const harness = await parent();
		const payload = "before\u001b]52;c;aW5qZWN0ZWQ=\u0007after";
		const out = renderResult(
			harness,
			{ content: [{ type: "text", text: payload }], details: details({}) },
			{ expanded: true },
		);
		expect(out).not.toContain("\u001b]52");
		expect(out).not.toContain("\u0007");
		expect(plain(out)).toContain("beforeafter");
		expect(
			renderResult(harness, { content: [{ type: "text", text: payload }], details: {} }, { isError: true }),
		).toBe("beforeafter");
		// A child's provider error becomes the run's error, and the row prints it (T18-F4 review).
		for (const status of ["error", "aborted"] as const) {
			const failed = renderResult(harness, {
				content: [{ type: "text", text: "failed" }],
				details: details({ status, error: payload }),
			});
			expect(failed, status).not.toContain("\u001b]52");
			expect(plain(failed), status).toContain(": beforeafter");
		}
	});

	it("names the model even when the child inherited the parent's", async () => {
		const harness = await parent();
		const result = await execute(harness, task("inherit task"));
		const model = harness.session.model;
		expect(result.details?.modelName).toBe(model?.name ?? model?.id);
		expect(plain(renderResult(harness, result))).toContain(model?.id ?? "no model");
	});

	it("names the inherited model while streaming, before a session exists", async () => {
		const harness = await parent();
		const updates: AgentToolDetails[] = [];
		await execute(harness, task("stream task"), (update) => updates.push(update.details as AgentToolDetails));
		const model = harness.session.model;
		expect(updates[0]?.modelName).toBe(model?.name ?? model?.id);
		expect(plain(renderResult(harness, { content: [], details: updates[0] }, { isPartial: true }))).toContain(
			model?.id ?? "no model",
		);
	});

	it("keeps the twin label beside the model", async () => {
		const harness = await parent();
		const result = await execute(harness, task("twin task", { subagent_type: "twin" }));
		expect(result.details?.tags).toContain("twin");
		expect(plain(renderResult(harness, result))).toMatch(/faux-a · twin/);
	});

	it("reports the session's level, and what was asked for, when pi clamps it", async () => {
		const harness = await parent();
		const result = await execute(harness, task("clamp task", { subagent_type: "plain", thinking: "high" }));
		expect(result.details?.tags).toContain("thinking: off (asked high)");
		expect(plain(renderResult(harness, result))).toContain("thinking: off (asked high)");
	});

	it("discloses a level an agent file pinned over the caller's (#182)", async () => {
		const harness = await parent();
		const result = await execute(harness, task("level task", { subagent_type: "leveled", thinking: "max" }));
		expect(result.details?.tags).toContain("thinking: low (asked max)");
	});

	it("discloses a model an agent file pinned over the caller's (#182)", async () => {
		const harness = await parent();
		const result = await execute(harness, task("model task", { subagent_type: "pinned", model: "faux-a" }));
		expect(result.details?.modelName).toBe("faux-b (asked faux-a)");
	});

	it("stays quiet when the caller's spelling names the model that won", async () => {
		const harness = await parent();
		const result = await execute(harness, task("spelling task", { subagent_type: "pinned", model: "FAUX-B" }));
		expect(result.details?.modelName).toBe("faux-b");
	});

	it("discloses a spelling that names no available model at all", async () => {
		const harness = await parent();
		const result = await execute(harness, task("unknown task", { subagent_type: "pinned", model: "gpt-9" }));
		expect(result.details?.modelName).toBe("faux-b (asked gpt-9)");
	});

	it("says nothing about a request that was honored", async () => {
		const harness = await parent();
		const result = await execute(harness, task("honored task", { thinking: "low" }));
		expect(result.details?.tags).toContain("thinking: low");
		expect(renderResult(harness, result)).not.toContain("asked");
	});

	it("renders the reopened session's settings, not the resume call's", async () => {
		const harness = await parent();
		// The first run's session clamps `high` to `off`, so its settings differ from any request.
		const first = await execute(harness, task("resume task", { subagent_type: "plain", thinking: "high" }));
		const resumed = await execute(
			harness,
			task("resume again", { resume: first.details?.agentId, model: "faux-b", thinking: "medium" }),
		);
		expect(resumed.details?.modelName).toBe("faux-plain");
		expect(resumed.details?.tags).toContain("thinking: off (asked high)");
		expect(renderResult(harness, resumed)).not.toContain("faux-b");
	});

	it("draws each finished status with its icon and outcome", async () => {
		const harness = await parent();
		const drawn = (overrides: Partial<AgentToolDetails>) =>
			plain(renderResult(harness, { content: [{ type: "text", text: "the result" }], details: details(overrides) }));
		expect(drawn({ status: "completed" })).toMatch(/^✓ .*1\.5s\n {2}⎿ {2}Done$/);
		expect(drawn({ status: "steered" })).toMatch(/^✓ [^\n]*\n {2}⎿ {2}Wrapped up \(turn limit\)$/);
		expect(drawn({ status: "stopped" })).toMatch(/^■ [^\n]*\n {2}⎿ {2}Stopped$/);
		expect(drawn({ status: "error", error: "boom" })).toMatch(/^✗ [^\n]*\n {2}⎿ {2}Error: boom$/);
		expect(drawn({ status: "aborted", error: "The session ended before the agent finished." })).toMatch(
			/⎿ {2}Aborted: The session ended before the agent finished\.$/,
		);
		expect(drawn({ status: "background", agentId: "bg-1" })).toBe("  ⎿  Running in background (ID: bg-1)");
	});

	it("expands a completed result to at most 50 lines, pointing to get_subagent_result for the rest", async () => {
		const harness = await parent();
		const long = Array.from({ length: 55 }, (_, index) => `line ${index}`).join("\n");
		const shown = plain(
			renderResult(harness, { content: [{ type: "text", text: long }], details: details({}) }, { expanded: true }),
		);
		expect(shown).toContain("line 49");
		expect(shown).not.toContain("line 50");
		expect(shown).toContain("... (use get_subagent_result with verbose for full output)");
		const short = plain(
			renderResult(
				harness,
				{ content: [{ type: "text", text: "line 0\nline 1" }], details: details({}) },
				{ expanded: true },
			),
		);
		expect(short).not.toContain("get_subagent_result");
	});

	it("shows another spinner frame when the running row renders 100 ms later", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(1_000_000);
		const harness = await parent();
		const definition = agentDefinition(harness);
		const row = definition.renderResult?.(
			{ content: [], details: details({ status: "running", durationMs: undefined, startedAt: 999_000 }) },
			{ expanded: false, isPartial: true },
			theme,
			context({ isPartial: true }),
		);
		// Wide: the tag theme's markers count toward the width.
		const first = row?.render(400)[0]?.trimEnd();
		vi.setSystemTime(1_000_100);
		const later = row?.render(400)[0]?.trimEnd();
		expect(plain(first ?? "")).toContain("1.0s");
		expect(plain(later ?? "")).toContain("1.1s");
		expect(plain(first ?? "").charAt(0)).not.toBe(plain(later ?? "").charAt(0));
	});
});

describe("Agent result text", () => {
	/** A foreground run whose record's spend the test sets while the child is held: the faux provider prices nothing. */
	async function spend(showCost: boolean, cost: number) {
		const gate = held(() => fauxAssistantMessage("spent"));
		const harness = await parent({ showCost }, { spend: [gate.behavior] });
		const pending = execute(harness, task("spend task"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const [view] = serviceOf(harness).list();
		const record = inspectRecord(serviceOf(harness), view.id);
		if (!record) throw new Error("no record");
		record.usage.cost.total = cost;
		gate.release();
		return { harness, result: await pending, id: view.id };
	}

	it("names the cost in the stats it already reports", async () => {
		const { result } = await spend(true, 0.0123);
		expect(text(result)).toMatch(/token, ~\$0\.0123\)/);
	});

	it("says nothing about cost when the setting is off", async () => {
		const { result } = await spend(false, 0.0123);
		expect(text(result)).not.toContain("$");
	});

	it("says nothing about cost for a model with no pricing data", async () => {
		const { result } = await spend(true, 0);
		expect(text(result)).toContain("token");
		expect(text(result)).not.toContain("$");
	});

	it("reports the cost as its own labelled field in get_subagent_result", async () => {
		const { harness, id } = await spend(true, 0.0123);
		expect(text(await call(harness, "get_subagent_result", { agent_id: id }))).toContain("Cost: ~$0.0123");
	});

	it("omits the cost field from get_subagent_result when unpriced", async () => {
		const { harness, id } = await spend(true, 0);
		expect(text(await call(harness, "get_subagent_result", { agent_id: id }))).not.toContain("Cost:");
	});

	it("keeps a colored agent's name badge out of the result text, so print mode shows none", async () => {
		const harness = await parent();
		const foreground = await execute(harness, task("plain text task", { subagent_type: "reviewer" }));
		const background = await call(harness, "Agent", {
			...task("plain background task", { subagent_type: "reviewer" }),
			run_in_background: true,
		});
		expect(text(foreground)).not.toContain("\u001b");
		expect(text(background)).not.toContain("\u001b");
		await serviceOf(harness).waitForResult(agentId(background));
	});
});

describe("Agent call rendering", () => {
	it("renders the call header with the agent's display name in its color", async () => {
		const harness = await parent();
		// The service loads agent files at its first spawn.
		await execute(harness, task("warm up"));
		const header = agentDefinition(harness)
			.renderCall?.({ subagent_type: "reviewer", description: "Review this change" }, theme, context())
			.render(200)
			.map((line) => line.trimEnd())
			.join("\n");
		expect(header).toContain(" Code Reviewer ");
		expect(header).toContain("\u001b[48;2;130;125;189m");
		expect(header?.indexOf("<toolSuccessBg>")).toBeLessThan(header?.indexOf("\u001b[48;2;130;125;189m") ?? -1);
		expect(plain(header ?? "")).toContain("Review this change");
		const uncolored = agentDefinition(harness)
			.renderCall?.({ subagent_type: "worker", description: "work" }, theme, context())
			.render(200)
			.map((line) => line.trimEnd())
			.join("\n");
		expect(uncolored).toBe("▸ <toolTitle>worker</toolTitle>  <muted>work</muted>");
	});
});
