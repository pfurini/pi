/**
 * C4a A.6 listing-budget end-to-end through AgentSession with the faux provider: every
 * rebuild trigger (model switch on every path, invocation, persisting fork delivery,
 * branch navigation) reaches the emitted `<available_skills>` block at the next user
 * prompt, counts derive live from `getBranch()` (resume/branch-safe), and the skeleton
 * skeleton-overflow diagnostic is delivered exactly once per episode without ever
 * aborting or deadlocking a prompt.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, streamSimple } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { extractSkillListingBlock } from "../../src/core/skills/listing.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ExtensionAPI, ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";
import { createStubSubagentsExtension } from "./support/stub-subagents-extension.ts";

interface SkillFixture {
	name: string;
	body?: string;
	description?: string;
}

const tempDirs: string[] = [];
const harnesses: Harness[] = [];
const sessionsToDispose: AgentSession[] = [];

afterEach(() => {
	while (sessionsToDispose.length > 0) {
		sessionsToDispose.pop()?.dispose();
	}
	while (harnesses.length > 0) {
		harnesses.pop()?.cleanup();
	}
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-c4a-listing-budget-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

function createSkillsLoader(fixturesDir: string, fixtures: SkillFixture[]): ResourceLoader {
	const skills = fixtures.map((fixture) => {
		const baseDir = join(fixturesDir, fixture.name);
		mkdirSync(baseDir, { recursive: true });
		const filePath = join(baseDir, "SKILL.md");
		writeFileSync(filePath, fixture.body ?? "skill body");
		return {
			name: fixture.name,
			description: fixture.description ?? `${fixture.name} skill`,
			filePath,
			disableModelInvocation: false,
			baseDir,
			sourceInfo: createSyntheticSourceInfo(filePath, {
				source: "local" as const,
				scope: "project" as const,
				origin: "top-level" as const,
				baseDir,
			}),
		};
	});
	return {
		...createTestResourceLoader(),
		getSkills: () => ({ skills, diagnostics: [] }),
	};
}

async function createBudgetHarness(
	fixtures: SkillFixture[],
	options: {
		models?: Array<{ id: string; contextWindow: number }>;
		settings?: Partial<Settings>;
		systemPrompt?: string;
		tools?: AgentTool[];
	},
): Promise<Harness> {
	const tempDir = makeTempDir();
	const resourceLoader = createSkillsLoader(tempDir, fixtures);
	const harness = await createHarness({
		models: options.models ?? [{ id: "session-model", contextWindow: 60_000 }],
		tools: options.tools,
		resourceLoader:
			options.systemPrompt === undefined
				? resourceLoader
				: { ...resourceLoader, getSystemPrompt: () => options.systemPrompt },
		settings: options.settings,
	});
	harnesses.push(harness);
	return harness;
}

/** Whether the emitted listing still carries a `<description>` for the named skill. */
function skillHasDescription(systemPrompt: string, name: string): boolean {
	const block = extractSkillListingBlock(systemPrompt);
	if (!block) return false;
	for (const match of block.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
		if (match[1]?.includes(`<name>${name}</name>`)) {
			return match[1].includes("<description>");
		}
	}
	return false;
}

const LONG_A = "A".repeat(2000);
const LONG_B = "B".repeat(2000);

/** Two long-description, count-0 skills over a budget where exactly one description survives. */
const TIGHT_PAIR: SkillFixture[] = [
	{ name: "aaa-skill", description: LONG_A },
	{ name: "zzz-skill", description: LONG_B },
];
const TIGHT_MODELS = [{ id: "session-model", contextWindow: 50_000 }];

describe("C4a listing budget: model-switch re-budget", () => {
	it("re-budgets at the next prompt via setModel", async () => {
		const harness = await createBudgetHarness([{ name: "solo", description: LONG_A }], {
			models: [
				{ id: "small", contextWindow: 2_000 },
				{ id: "large", contextWindow: 2_000_000 },
			],
		});

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(false);

		await harness.session.setModel(harness.getModel("large")!);
		harness.setResponses([fauxAssistantMessage("second")]);
		await harness.session.prompt("next");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(true);
	});

	it("re-budgets at the next prompt via cycleModel", async () => {
		const harness = await createBudgetHarness([{ name: "solo", description: LONG_A }], {
			models: [
				{ id: "small", contextWindow: 2_000 },
				{ id: "large", contextWindow: 2_000_000 },
			],
		});

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(false);

		await harness.session.cycleModel();
		harness.setResponses([fauxAssistantMessage("second")]);
		await harness.session.prompt("next");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(true);
	});

	it("re-budgets at the next prompt via an availability refresh (pi.registerProvider)", async () => {
		let capturedPi: ExtensionAPI | undefined;
		const tempDir = makeTempDir();
		const extensionsResult = await createTestExtensionsResult([
			(pi) => {
				capturedPi = pi;
			},
		]);
		const soloFixtureDir = join(tempDir, "solo");
		mkdirSync(soloFixtureDir, { recursive: true });
		const soloFilePath = join(soloFixtureDir, "SKILL.md");
		writeFileSync(soloFilePath, "solo body");
		const skills = [
			{
				name: "solo",
				description: LONG_A,
				filePath: soloFilePath,
				disableModelInvocation: false,
				baseDir: soloFixtureDir,
				sourceInfo: createSyntheticSourceInfo(soloFilePath, {
					source: "local" as const,
					scope: "project" as const,
					origin: "top-level" as const,
					baseDir: soloFixtureDir,
				}),
			},
		];
		const harness = await createHarness({
			models: [{ id: "session-model", contextWindow: 2_000 }],
			resourceLoader: {
				...createTestResourceLoader({ extensionsResult }),
				getSkills: () => ({ skills, diagnostics: [] }),
			},
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(false);

		const currentModel = harness.getModel();
		capturedPi?.registerProvider(currentModel.provider, {
			baseUrl: currentModel.baseUrl,
			apiKey: "faux-key",
			api: harness.faux.api,
			models: harness.faux.models.map((registeredModel) => ({
				id: registeredModel.id,
				name: registeredModel.name,
				api: registeredModel.api,
				reasoning: registeredModel.reasoning,
				input: registeredModel.input,
				cost: registeredModel.cost,
				contextWindow: registeredModel.id === currentModel.id ? 2_000_000 : registeredModel.contextWindow,
				maxTokens: registeredModel.maxTokens,
				baseUrl: registeredModel.baseUrl,
			})),
		});

		harness.setResponses([fauxAssistantMessage("second")]);
		await harness.session.prompt("next");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(true);
	});
});

describe("C4a listing budget: invocation-count reorder", () => {
	it("reorders truncation priority at the next prompt after an activation", async () => {
		const harness = await createBudgetHarness(TIGHT_PAIR, { models: TIGHT_MODELS });

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		// Both count 0: tie-break drops the alphabetically-first (aaa-skill) first.
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-skill")).toBe(false);
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-skill")).toBe(true);

		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:aaa-skill go");

		harness.setResponses([fauxAssistantMessage("after")]);
		await harness.session.prompt("check");
		// aaa-skill is now count 1: least-invoked-first flips priority to zzz-skill.
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-skill")).toBe(true);
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-skill")).toBe(false);
	});

	it("refreshes the listing after a queued skill before a later queued prompt", async () => {
		let releaseWait: (() => void) | undefined;
		const waitRelease = new Promise<void>((resolve) => {
			releaseWait = resolve;
		});
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await waitRelease;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};
		const readTool: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read a file",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "unused" }], details: {} }),
		};
		const harness = await createBudgetHarness(TIGHT_PAIR, {
			models: TIGHT_MODELS,
			tools: [waitTool, readTool],
		});
		harness.session.setFollowUpMode("one-at-a-time");
		const waitForToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});
		let laterPromptSystemPrompt = "";
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("initial turn done"),
			(context) => {
				if (
					context.messages.some(
						(message) => message.role === "user" && JSON.stringify(message.content).includes("check listing"),
					)
				) {
					laterPromptSystemPrompt = context.systemPrompt ?? "";
				}
				return fauxAssistantMessage("skill follow-up done");
			},
			(context) => {
				laterPromptSystemPrompt = context.systemPrompt ?? "";
				return fauxAssistantMessage("plain follow-up done");
			},
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForToolStart;
		await harness.session.followUp("/skill:aaa-skill queued");
		await harness.session.followUp("check listing");
		releaseWait?.();
		await promptPromise;

		expect(laterPromptSystemPrompt).toContain("<available_skills");
		expect({
			aaa: skillHasDescription(laterPromptSystemPrompt, "aaa-skill"),
			zzz: skillHasDescription(laterPromptSystemPrompt, "zzz-skill"),
		}).toEqual({ aaa: true, zzz: false });
	});
});

describe("C4a listing budget: fork delivery re-budget", () => {
	it("a successful fork delivery reorders truncation priority (bypasses activateSkill)", async () => {
		const tempDir = makeTempDir();
		const forkFixtureDir = join(tempDir, "aaa-fork");
		mkdirSync(forkFixtureDir, { recursive: true });
		const forkFilePath = join(forkFixtureDir, "SKILL.md");
		writeFileSync(forkFilePath, "fork body");
		const otherFixtureDir = join(tempDir, "zzz-plain");
		mkdirSync(otherFixtureDir, { recursive: true });
		const otherFilePath = join(otherFixtureDir, "SKILL.md");
		writeFileSync(otherFilePath, "plain body");

		const skills = [
			{
				name: "aaa-fork",
				description: LONG_A,
				filePath: forkFilePath,
				disableModelInvocation: false,
				baseDir: forkFixtureDir,
				sourceInfo: createSyntheticSourceInfo(forkFilePath, {
					source: "local" as const,
					scope: "project" as const,
					origin: "top-level" as const,
					baseDir: forkFixtureDir,
				}),
				frontmatter: { context: "fork" as const, background: false },
			},
			{
				name: "zzz-plain",
				description: LONG_B,
				filePath: otherFilePath,
				disableModelInvocation: false,
				baseDir: otherFixtureDir,
				sourceInfo: createSyntheticSourceInfo(otherFilePath, {
					source: "local" as const,
					scope: "project" as const,
					origin: "top-level" as const,
					baseDir: otherFixtureDir,
				}),
			},
		];
		const resourceLoader: ResourceLoader = {
			...createTestResourceLoader(),
			getSkills: () => ({ skills, diagnostics: [] }),
		};

		const stub = createStubSubagentsExtension({ autoComplete: { when: "after-reply", result: "the result" } });

		const harness = await createHarness({
			models: TIGHT_MODELS,
			resourceLoader,
			extensionFactories: [{ factory: stub.factory }],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({ mode: "tui" });

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-fork")).toBe(false);
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-plain")).toBe(true);

		harness.setResponses([
			(_c, _o, _s, _m) =>
				fauxAssistantMessage([fauxToolCall("skill", { name: "aaa-fork" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("fork it");

		harness.setResponses([fauxAssistantMessage("after")]);
		await harness.session.prompt("check");
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-fork")).toBe(true);
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-plain")).toBe(false);
	});
});

describe("C4a listing budget: branch navigation reorder", () => {
	it("navigateTree marks the listing dirty; the next prompt reflects the navigated branch's counts", async () => {
		const harness = await createBudgetHarness(TIGHT_PAIR, { models: TIGHT_MODELS });

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		const rootLeafId = harness.sessionManager.getLeafId() as string;

		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:aaa-skill go");
		const branchALeafId = harness.sessionManager.getLeafId() as string;

		await harness.session.navigateTree(rootLeafId);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:zzz-skill go");

		harness.setResponses([fauxAssistantMessage("after-b")]);
		await harness.session.prompt("check b");
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-skill")).toBe(true);
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-skill")).toBe(false);

		await harness.session.navigateTree(branchALeafId);
		harness.setResponses([fauxAssistantMessage("after-a")]);
		await harness.session.prompt("check a");
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-skill")).toBe(true);
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-skill")).toBe(false);
	});
});

describe("C4a listing budget: resume count reconstruction", () => {
	it("a fresh AgentSession over the same session branch reflects the seeded count on its first listing", async () => {
		const harness = await createBudgetHarness(TIGHT_PAIR, { models: TIGHT_MODELS });
		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:aaa-skill go");

		const agent = new Agent({
			getApiKey: () => "faux-key",
			streamFn: streamSimple,
			initialState: { model: harness.getModel(), systemPrompt: "You are a test assistant.", tools: [] },
			convertToLlm,
		});
		const resumed = new AgentSession({
			agent,
			sessionManager: harness.sessionManager,
			settingsManager: harness.settingsManager,
			cwd: harness.tempDir,
			agentDir: harness.tempDir,
			resourceLoader: harness.session.resourceLoader,
			modelRuntime: harness.session.modelRuntime,
		});
		sessionsToDispose.push(resumed);

		expect(skillHasDescription(resumed.systemPrompt, "aaa-skill")).toBe(true);
		expect(skillHasDescription(resumed.systemPrompt, "zzz-skill")).toBe(false);
	});
});

describe("C4a listing budget: synthetic-pair vs message-block count parity", () => {
	it("counts a synthetic-pair delivery and a message-block delivery equally (transport-independent)", async () => {
		const harness = await createBudgetHarness(
			[
				{ name: "aaa-synth", description: LONG_A },
				{ name: "zzz-block", description: LONG_B },
			],
			{ models: TIGHT_MODELS },
		);

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");

		const plainModel = harness.session.agent.state.model;
		harness.session.agent.state.model = { ...plainModel, syntheticToolResultReplay: true } as typeof plainModel;
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:aaa-synth go");

		harness.session.agent.state.model = plainModel;
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:zzz-block go");

		harness.setResponses([fauxAssistantMessage("final")]);
		await harness.session.prompt("check");

		// Equal (deduped) counts: the alphabetically-first skill (aaa-synth) is trimmed
		// first; a double-count regression would give aaa-synth the higher count and
		// reverse the winner.
		expect(skillHasDescription(harness.session.systemPrompt, "zzz-block")).toBe(true);
		expect(skillHasDescription(harness.session.systemPrompt, "aaa-synth")).toBe(false);
	});
});

describe("C4a listing budget: custom-prompt branch budgeted", () => {
	it("budgets the listing on the customPrompt formatSkillsForPrompt call site too", async () => {
		const harness = await createBudgetHarness([{ name: "solo", description: LONG_A }], {
			models: [{ id: "small", contextWindow: 2_000 }],
			systemPrompt: "You are a custom test assistant.",
		});

		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");

		expect(harness.session.systemPrompt.startsWith("You are a custom test assistant.")).toBe(true);
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(false);
	});
});

describe("C4a listing budget: startup skeleton-overflow diagnostic", () => {
	it("delivers the diagnostic once per overflow episode, buffered past the pre-bind gap, and re-arms on recovery", async () => {
		const tempDir = makeTempDir();
		const harness = await createHarness({
			models: [
				{ id: "tiny", contextWindow: 50 },
				{ id: "huge", contextWindow: 2_000_000 },
			],
			resourceLoader: createSkillsLoader(tempDir, [{ name: "solo", description: "short description" }]),
		});
		harnesses.push(harness);

		const errors: Array<{ event: string; error: string }> = [];
		await harness.session.bindExtensions({ onError: (error) => errors.push(error) });
		// The construction-time overflow (before bindExtensions ran) is flushed here.
		expect(errors).toHaveLength(1);
		expect(errors[0]?.event).toBe("skill_render");
		expect(errors[0]?.error).toContain("budget");

		// Still overflowing: re-dirtying without changing the budget outcome must not
		// redeliver within the same episode.
		await harness.session.setModel(harness.getModel("tiny")!);
		harness.setResponses([fauxAssistantMessage("still overflowing")]);
		await harness.session.prompt("x");
		expect(errors).toHaveLength(1);

		// Recover (widen the budget), then re-overflow: a fresh episode delivers again.
		await harness.session.setModel(harness.getModel("huge")!);
		harness.setResponses([fauxAssistantMessage("recovered")]);
		await harness.session.prompt("y");
		expect(errors).toHaveLength(1);

		await harness.session.setModel(harness.getModel("tiny")!);
		harness.setResponses([fauxAssistantMessage("overflow again")]);
		await harness.session.prompt("z");
		expect(errors).toHaveLength(2);
	});

	it("a throwing onError listener does not abort the prompt or deadlock the next one", async () => {
		const tempDir = makeTempDir();
		const harness = await createHarness({
			models: [
				{ id: "tiny", contextWindow: 50 },
				{ id: "huge", contextWindow: 2_000_000 },
			],
			resourceLoader: createSkillsLoader(tempDir, [{ name: "solo", description: "short description" }]),
		});
		harnesses.push(harness);

		// Flush (at bind) the construction-time overflow through a throwing listener;
		// bindExtensions itself must not throw.
		await harness.session.bindExtensions({
			onError: () => {
				throw new Error("boom");
			},
		});

		// Recover, then re-overflow so a NEW episode's diagnostic is delivered (and
		// throws) from inside a `_promptInScope`-triggered rebuild.
		await harness.session.setModel(harness.getModel("huge")!);
		harness.setResponses([fauxAssistantMessage("recovered")]);
		await harness.session.prompt("recover");

		await harness.session.setModel(harness.getModel("tiny")!);
		harness.setResponses([fauxAssistantMessage("first")]);
		await expect(harness.session.prompt("first")).resolves.toBeUndefined();
		expect(harness.session.getLastAssistantText()).toBe("first");

		// Not deadlocked: a follow-up prompt still succeeds.
		harness.setResponses([fauxAssistantMessage("second")]);
		await expect(harness.session.prompt("second")).resolves.toBeUndefined();
		expect(harness.session.getLastAssistantText()).toBe("second");
	});
});

describe("C4a listing budget: invalid skillListingBudgetFraction", () => {
	it("degrades session construction to the 0.01 default instead of throwing", async () => {
		const harness = await createBudgetHarness([{ name: "solo", description: LONG_A }], {
			models: [{ id: "small", contextWindow: 100 }],
			settings: { skillListingBudgetFraction: 50 },
		});

		// An un-degraded invalid fraction (50) would compute B = 5000, comfortably
		// fitting the full description; the 0.01 default computes B = 1 (skeleton).
		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("start");
		expect(skillHasDescription(harness.session.systemPrompt, "solo")).toBe(false);
	});
});
