/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: A.8 variable fixtures */
/**
 * A.8 interop tests: PI_/CLAUDE_ variable computation and config gating,
 * SkillRuntime activation/expiry semantics, rewrite-map seam, and the
 * turn-scoped bash env composition through the spawn-context seam — including
 * extension-registered replacement bash tools with their own spawnHook.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { type LoadedSkill, normalizeSkillInput } from "../../src/core/skills/frontmatter.ts";
import {
	buildSkillSubstitutionMap,
	buildSkillVariableValues,
	detectCcToolNames,
	resolveEffectiveEffort,
	substituteSkillVariables,
} from "../../src/core/skills/interop.ts";
import {
	SKILL_AGENTS_QUERY_CHANNEL,
	SKILL_AGENTS_REWRITE_MAPS_CHANNEL,
	SkillRuntime,
	skillAgentsQueryReplyChannel,
} from "../../src/core/skills/runtime.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { type BashOperations, createBashTool } from "../../src/core/tools/bash.ts";
import { createHarness, type Harness } from "./harness.ts";

function makeSkill(
	overrides: { name?: string; baseDir?: string; frontmatter?: Record<string, unknown> } = {},
): LoadedSkill {
	const baseDir = overrides.baseDir ?? "/tmp/interop-skill";
	const filePath = `${baseDir}/SKILL.md`;
	return normalizeSkillInput({
		name: overrides.name ?? "interop-skill",
		description: "Test description",
		filePath,
		baseDir,
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
		disableModelInvocation: false,
		frontmatter: overrides.frontmatter,
	}).skill;
}

function runtimeContext(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/tmp/work",
		sessionId: "session-1",
		getThinkingLevel: () => "medium",
		getSkillInterop: () => true,
		...overrides,
	};
}

describe("buildSkillVariableValues (A.8)", () => {
	it("computes native PI_* values plus CLAUDE_* aliases when interop is on", () => {
		const runtime = new SkillRuntime(runtimeContext());
		const invocation = runtime.createInvocation(makeSkill({ baseDir: "/tmp/sk" }), "");
		const values = buildSkillVariableValues(invocation, {
			cwd: "/tmp/work",
			sessionId: "session-1",
			thinkingLevel: "medium",
			skillInterop: true,
		});
		expect(values.PI_SKILL_DIR).toBe("/tmp/sk");
		expect(values.PI_SESSION_ID).toBe("session-1");
		expect(values.PI_EFFORT).toBe("medium");
		expect(values.PI_PROJECT_DIR).toBeTruthy();
		expect(values.CLAUDE_SKILL_DIR).toBe("/tmp/sk");
		expect(values.CLAUDE_PROJECT_DIR).toBe(values.PI_PROJECT_DIR);
		expect(values.CLAUDE_SESSION_ID).toBe("session-1");
		expect(values.CLAUDE_EFFORT).toBe("medium");
		runtime.dispose();
	});

	it("drops CLAUDE_* aliases when skillInterop is off", () => {
		const runtime = new SkillRuntime(runtimeContext());
		const invocation = runtime.createInvocation(makeSkill({ baseDir: "/tmp/sk" }), "");
		const values = buildSkillVariableValues(invocation, {
			cwd: "/tmp/work",
			sessionId: "session-1",
			thinkingLevel: "medium",
			skillInterop: false,
		});
		expect(values.PI_SKILL_DIR).toBe("/tmp/sk");
		expect(values.CLAUDE_SKILL_DIR).toBeUndefined();
		expect(values.CLAUDE_PROJECT_DIR).toBeUndefined();
		runtime.dispose();
	});
});

describe("resolveEffectiveEffort", () => {
	it("passes string efforts through", () => {
		expect(resolveEffectiveEffort("high", "medium")).toBe("high");
	});

	it("clamp-maps integer budgets per A.2", () => {
		expect(resolveEffectiveEffort(1024, "medium")).toBe("low");
		expect(resolveEffectiveEffort(4096, "medium")).toBe("medium");
		expect(resolveEffectiveEffort(16384, "medium")).toBe("high");
		expect(resolveEffectiveEffort(50000, "medium")).toBe("xhigh");
	});

	it("falls back to the session level", () => {
		expect(resolveEffectiveEffort(undefined, "low")).toBe("low");
	});
});

describe("substituteSkillVariables", () => {
	it("substitutes only exact braced spellings from the map", () => {
		const map = buildSkillSubstitutionMap(
			{ invocationId: "i", skillId: "s", name: "n", baseDir: "/tmp/sk", filePath: "/tmp/sk/SKILL.md", rawArgs: "" },
			{ cwd: "/tmp/work", sessionId: "s1", thinkingLevel: "high", skillInterop: true },
		);
		expect(substituteSkillVariables("${PI_SKILL_DIR}/x ${UNKNOWN} $PI_SKILL_DIR", map)).toBe(
			"/tmp/sk/x ${UNKNOWN} $PI_SKILL_DIR",
		);
	});
});

describe("detectCcToolNames", () => {
	it("detects non-identity CC tool names lexically", () => {
		expect(detectCcToolNames("Use the Task tool").map((d) => d.source)).toEqual(["Task"]);
		expect(detectCcToolNames("no special names")).toEqual([]);
		// Identifier substrings and qualified forms do not count.
		expect(detectCcToolNames("Tasklist and skill:Task")).toEqual([]);
	});
});

describe("SkillRuntime", () => {
	it("creates records with preserved execution fields", () => {
		const runtime = new SkillRuntime(runtimeContext());
		const skill = makeSkill({
			frontmatter: { model: "m1", effort: "high", "disallowed-tools": ["Bash"], shell: "powershell" },
		});
		const invocation = runtime.createInvocation(skill, "a b");
		expect(invocation.model).toBe("m1");
		expect(invocation.effort).toBe("high");
		expect(invocation.disallowedTools).toEqual(["Bash"]);
		expect(invocation.shell).toBe("powershell");
		expect(invocation.rawArgs).toBe("a b");
		expect(invocation.skillId).toBe(skill.id);
		runtime.dispose();
	});

	it("activates only on consumption and expires on the logical-turn boundary", () => {
		const runtime = new SkillRuntime(runtimeContext());
		const created = runtime.createInvocation(makeSkill(), "");
		// Created (e.g. at queue time) but not consumed: not active.
		expect(runtime.getActiveInvocation()).toBeUndefined();
		runtime.activate(created);
		expect(runtime.getActiveInvocation()).toBe(created);
		expect(runtime.getActiveExecutionEnv()?.PI_SKILL_DIR).toBe(created.baseDir);
		runtime.expireTurn();
		expect(runtime.getActiveInvocation()).toBeUndefined();
		expect(runtime.getActiveExecutionEnv()).toBeUndefined();
		runtime.dispose();
	});

	it("stacks invocations: the most recent wins env, all stay listed, conflicts diagnose", () => {
		const runtime = new SkillRuntime(runtimeContext());
		const first = runtime.createInvocation(
			makeSkill({ name: "s1", baseDir: "/tmp/s1", frontmatter: { model: "m1" } }),
			"",
		);
		const second = runtime.createInvocation(makeSkill({ name: "s2", baseDir: "/tmp/s2" }), "");
		runtime.activate(first);
		const diagnostics = runtime.activate(second);
		expect(runtime.getActiveInvocation()).toBe(second);
		expect(runtime.getActiveInvocations()).toEqual([first, second]);
		expect(runtime.getActiveExecutionEnv()?.PI_SKILL_DIR).toBe("/tmp/s2");
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("model");
		runtime.dispose();
	});

	it("stores the latest rewrite map from the bus and ignores stale revisions", () => {
		const bus = createEventBus();
		const runtime = new SkillRuntime(runtimeContext({ eventBus: bus }));
		bus.emit(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, {
			revision: 2,
			maps: { "skill-1": { agent: { qualified: "s:agent", collided: true } } },
		});
		expect(runtime.getRewriteMap("skill-1")).toEqual({ agent: { qualified: "s:agent", collided: true } });
		bus.emit(SKILL_AGENTS_REWRITE_MAPS_CHANNEL, { revision: 1, maps: {} });
		expect(runtime.getRewriteMap("skill-1")).toBeDefined();
		runtime.dispose();
	});

	it("pulls rewrite maps via the query/reply seam", async () => {
		const bus = createEventBus();
		bus.on(SKILL_AGENTS_QUERY_CHANNEL, (data) => {
			const requestId = (data as { requestId: string }).requestId;
			bus.emit(skillAgentsQueryReplyChannel(requestId), {
				success: true,
				data: { revision: 5, maps: { "skill-9": { a: { qualified: "q:a", collided: false } } } },
			});
		});
		const runtime = new SkillRuntime(runtimeContext({ eventBus: bus }));
		// The reply lands asynchronously through the bus's safe handler.
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(runtime.getRewriteMap("skill-9")).toEqual({ a: { qualified: "q:a", collided: false } });
		expect(runtime.getRewriteMapsRevision()).toBe(5);
		runtime.dispose();
	});
});

describe("turn-scoped bash env composition (session level)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		delete process.env.PI_SKILL_DIR;
		delete process.env.CLAUDE_SKILL_DIR;
	});

	interface CapturedRun {
		env: NodeJS.ProcessEnv;
		hookSawSkillDir: string | undefined;
	}

	async function createBashCaptureHarness(settings?: Partial<Settings>) {
		const runs: CapturedRun[] = [];
		const operations: BashOperations = {
			exec: async (_command, _cwd, _options) => ({ exitCode: 0 }),
		};
		const harness = await createHarness({
			settings,
			extensionFactories: [
				(pi) => {
					pi.registerTool(
						createBashTool(BASH_CWD, {
							operations,
							spawnHook: (ctx) => {
								// The replacement bash keeps its own hook; the composer runs first.
								runs.push({ env: ctx.env, hookSawSkillDir: ctx.env.PI_SKILL_DIR });
								return ctx;
							},
						}),
					);
				},
			],
		});
		harnesses.push(harness);
		return { harness, runs };
	}

	// createBashTool needs a cwd; any existing dir works because operations are faked.
	const BASH_CWD = process.cwd();
	async function runBashTurn(harness: Harness): Promise<void> {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "true" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run it");
		await harness.session.agent.waitForIdle();
	}

	it("a replacement bash with its own spawnHook still receives turn-scoped skill env", async () => {
		const { harness, runs } = await createBashCaptureHarness();
		const skill = makeSkill({ baseDir: "/tmp/turn-skill" });
		runs.length = 0;
		harness.session.skillRuntime.activate(harness.session.skillRuntime.createInvocation(skill, ""));
		const before = process.env.PI_SKILL_DIR;
		await runBashTurn(harness);
		expect(runs).toHaveLength(1);
		expect(runs[0].env.PI_SKILL_DIR).toBe("/tmp/turn-skill");
		expect(runs[0].env.CLAUDE_SKILL_DIR).toBe("/tmp/turn-skill");
		expect(runs[0].env.PI_SESSION_ID).toBe(harness.sessionManager.getSessionId());
		// The custom spawnHook observes the composed env (composer runs first).
		expect(runs[0].hookSawSkillDir).toBe("/tmp/turn-skill");
		// process.env is never mutated.
		expect(process.env.PI_SKILL_DIR).toBe(before);
	});

	it("env expires at the logical-turn boundary: the next turn's bash run has no skill env", async () => {
		const { harness, runs } = await createBashCaptureHarness();
		const skill = makeSkill({ baseDir: "/tmp/turn-skill" });
		harness.session.skillRuntime.activate(harness.session.skillRuntime.createInvocation(skill, ""));
		await runBashTurn(harness);
		expect(runs[0]?.env.PI_SKILL_DIR).toBe("/tmp/turn-skill");

		// agent_settled fired at the end of the first turn; nothing re-activated.
		expect(harness.eventsOfType("agent_settled").length).toBeGreaterThan(0);
		expect(harness.session.skillRuntime.getActiveInvocation()).toBeUndefined();

		runs.length = 0;
		await runBashTurn(harness);
		expect(runs).toHaveLength(1);
		expect(runs[0].env.PI_SKILL_DIR).toBeUndefined();
		expect(runs[0].env.CLAUDE_SKILL_DIR).toBeUndefined();
	});

	it("skillInterop: false composes PI_* only", async () => {
		const { harness, runs } = await createBashCaptureHarness({ skillInterop: false });
		const skill = makeSkill({ baseDir: "/tmp/turn-skill" });
		harness.session.skillRuntime.activate(harness.session.skillRuntime.createInvocation(skill, ""));
		await runBashTurn(harness);
		expect(runs[0].env.PI_SKILL_DIR).toBe("/tmp/turn-skill");
		expect(runs[0].env.CLAUDE_SKILL_DIR).toBeUndefined();
	});

	it("disableSkillEnvInjection: true bypasses all skill env composition", async () => {
		const { harness, runs } = await createBashCaptureHarness({ disableSkillEnvInjection: true });
		const skill = makeSkill({ baseDir: "/tmp/turn-skill" });
		harness.session.skillRuntime.activate(harness.session.skillRuntime.createInvocation(skill, ""));
		await runBashTurn(harness);
		expect(runs).toHaveLength(1);
		expect(runs[0].env.PI_SKILL_DIR).toBeUndefined();
		expect(runs[0].env.CLAUDE_SKILL_DIR).toBeUndefined();
	});

	it("an idle turn (no active invocation) composes no skill env", async () => {
		const { harness, runs } = await createBashCaptureHarness();
		await runBashTurn(harness);
		expect(runs).toHaveLength(1);
		expect(runs[0].env.PI_SKILL_DIR).toBeUndefined();
	});
});
