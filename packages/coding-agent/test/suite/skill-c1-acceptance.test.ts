/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: normative A.3/A.8 placeholder fixtures */
/**
 * C1 acceptance fixture (phase closeout). Each test quotes the clause of the
 * frozen C1 acceptance paragraph it proves, end to end through AgentSession
 * with the faux provider and committed temp fixture skills only. The focused
 * suites hold the exhaustive matrices; this file pins the integrated
 * paragraph:
 *
 *   "ASE-style fixture (args + ${CLAUDE_SKILL_DIR} includes convention +
 *   effort frontmatter) renders correctly on each supported transport;
 *   argument-grammar fixture covers the A.3.2 examples verbatim; shell-policy
 *   fixtures cover `--no-tools`, excluded `bash`, and `disallowed-tools`
 *   blocking injection; a queued steer/follow-up invocation activates its
 *   overrides when consumed; redirect fixture verifies the corrective reply
 *   for `Task`/`AskUserQuestion` misses, and that a mapped entry whose target
 *   is unregistered falls through to the nearest-name suggestion."
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionMessageEntry } from "../../src/core/session-manager.ts";
import { SHELL_MARKERS } from "../../src/core/skills/shell-injection.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ExtensionAPI, ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getAssistantTexts, getMessageText, type Harness, type HarnessOptions } from "./harness.ts";

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

// ============================================================================
// Fixtures
// ============================================================================

interface SkillFixture {
	name: string;
	/** Written verbatim to SKILL.md (no frontmatter block; frontmatter rides the loader object). */
	body: string;
	frontmatter?: Record<string, unknown>;
}

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-c1-acceptance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

function createSkillsLoader(tempDir: string, fixtures: SkillFixture[]): ResourceLoader {
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
				source: "local",
				scope: "project",
				origin: "top-level",
				baseDir,
			}),
			...(fixture.frontmatter &&
				Object.keys(fixture.frontmatter).length > 0 && { frontmatter: fixture.frontmatter }),
		};
	});
	return {
		...createTestResourceLoader(),
		getSkills: () => ({ skills, diagnostics: [] }),
	};
}

async function createSkillHarness(options: {
	fixtures: SkillFixture[];
	settings?: HarnessOptions["settings"];
	tools?: AgentTool[];
	allowedToolNames?: string[];
	excludedToolNames?: string[];
	extensionFactories?: Array<(pi: ExtensionAPI) => void>;
}): Promise<{ harness: Harness; tempDir: string }> {
	const tempDir = makeTempDir();
	// Wire extension factories INTO the resource loader: createHarness only
	// connects its own extensionsResult when it creates the loader itself.
	const extensionsResult = options.extensionFactories
		? await createTestExtensionsResult(options.extensionFactories, tempDir)
		: undefined;
	const skillsLoader = createSkillsLoader(tempDir, options.fixtures);
	const resourceLoader = {
		...skillsLoader,
		...(extensionsResult ? createTestResourceLoader({ extensionsResult }) : {}),
		getSkills: skillsLoader.getSkills,
	};
	const harness = await createHarness({
		resourceLoader,
		settings: options.settings,
		tools: options.tools,
		allowedToolNames: options.allowedToolNames,
		excludedToolNames: options.excludedToolNames,
	});
	harnesses.push(harness);
	return { harness, tempDir };
}

function flagModel(harness: Harness): void {
	const flaggedModel = { ...harness.getModel(), syntheticToolResultReplay: true as const };
	harness.session.agent.state.model = flaggedModel;
}
function messageEntries(harness: Harness): SessionMessageEntry[] {
	return harness.sessionManager.getEntries().filter((entry) => entry.type === "message");
}

/** Text carrying the rendered skill content (block text or tool result text). */
function findDeliveredText(harness: Harness, name: string): string {
	const skillResult = harness.session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "skill",
	);
	if (skillResult) {
		return getMessageText(skillResult);
	}
	const blockMessage = harness.session.messages.find(
		(message) => message.role === "user" && getMessageText(message).includes(`<skill name="${name}"`),
	);
	return blockMessage ? getMessageText(blockMessage) : "";
}

/** ASE-style fixture: args + ${CLAUDE_SKILL_DIR} includes convention + effort frontmatter. */
const ASE_FIXTURE: SkillFixture = {
	name: "ase",
	frontmatter: { effort: "high" },
	body: [
		"args=[$ARGUMENTS]",
		"include=Read ${CLAUDE_SKILL_DIR}/references/x.md for details.",
		"effort=${PI_EFFORT}",
	].join("\n"),
};

/** The A.3.2 spec fixture raw argument string R (declared `arguments: [name]`). */
const RAW_ARGS = 'alpha "b c" name=x \\$lit';

// ============================================================================
// Acceptance clause: ASE-style fixture renders correctly on each transport
// ============================================================================

describe("C1 acceptance: ASE-style fixture on each supported transport", () => {
	for (const transport of ["block", "synthetic"] as const) {
		it(`renders args, the \${CLAUDE_SKILL_DIR} include, and effort frontmatter on the ${transport} transport`, async () => {
			const { harness, tempDir } = await createSkillHarness({ fixtures: [ASE_FIXTURE] });
			if (transport === "synthetic") flagModel(harness);
			harness.setResponses([fauxAssistantMessage("ok")]);

			await harness.session.prompt(`/skill:ase ${RAW_ARGS}`);

			const delivered = findDeliveredText(harness, "ase");
			// A.3.2 rule 1: $ARGUMENTS substitutes R verbatim (quotes, spacing, everything).
			expect(delivered).toContain(`args=[${RAW_ARGS}]`);
			// ASE include convention: ${CLAUDE_SKILL_DIR} resolves to the skill base dir.
			expect(delivered).toContain(`include=Read ${join(tempDir, "ase")}/references/x.md for details.`);
			// Effort frontmatter is preserved into PI_EFFORT.
			expect(delivered).toContain("effort=high");

			const entries = messageEntries(harness);
			if (transport === "synthetic") {
				// Synthetic pair: two persisted entries sharing one entry-level pairId.
				const pairEntries = entries.filter((entry) => entry.pairId !== undefined);
				expect(pairEntries).toHaveLength(2);
				expect(pairEntries[0].pairId).toBe(pairEntries[1].pairId);
				expect(pairEntries[0].message.role).toBe("assistant");
				expect(pairEntries[1].message.role).toBe("toolResult");
			} else {
				expect(entries.every((entry) => entry.pairId === undefined)).toBe(true);
			}
			// B.12 invocation metadata is persisted either way.
			expect(entries.some((entry) => entry.invocations?.[0]?.name === "ase")).toBe(true);
		});
	}

	it("regression: an unflagged provider chooses the message block (never a synthetic pair)", async () => {
		const { harness } = await createSkillHarness({ fixtures: [ASE_FIXTURE] });
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:ase some args");

		const blockMessage = harness.session.messages.find(
			(message) => message.role === "user" && getMessageText(message).includes('<skill name="ase"'),
		);
		expect(blockMessage).toBeDefined();
		expect(harness.session.messages.some((m) => m.role === "toolResult" && m.toolName === "skill")).toBe(false);
		expect(messageEntries(harness).every((entry) => entry.pairId === undefined)).toBe(true);
	});
});

// ============================================================================
// Acceptance clause: argument-grammar fixture covers A.3.2 examples verbatim
// (exhaustive verbatim matrix: test/skill-arguments.test.ts; this proves the
// grammar end to end through AgentSession)
// ============================================================================

describe("C1 acceptance: A.3.2 argument grammar through AgentSession", () => {
	it("substitutes the verbatim spec fixture (declared `arguments: [name]`)", async () => {
		const { harness } = await createSkillHarness({
			fixtures: [
				{
					name: "grammar",
					frontmatter: { arguments: ["name"] },
					body: ["got: $ARGUMENTS", "pos: $1|$2|$3|$4"].join("\n"),
				},
			],
		});
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt(`/skill:grammar ${RAW_ARGS}`);

		const delivered = findDeliveredText(harness, "grammar");
		// Rule 1: $ARGUMENTS substitutes R verbatim.
		expect(delivered).toContain(`got: ${RAW_ARGS}`);
		// Rules 2+3: `name=x` binds (declared) and is removed; `\$lit` tokenizes to `$lit`.
		expect(delivered).toContain("pos: alpha|b c|$lit|");
	});
});

// ============================================================================
// Acceptance clause: shell-policy fixtures (`--no-tools`, excluded `bash`,
// `disallowed-tools`) block injection
// ============================================================================

describe("C1 acceptance: shell-policy fixtures block injection", () => {
	const SHELL_FIXTURE: SkillFixture = {
		name: "shell",
		body: "before !`echo C1_ACCEPTANCE_SHELL_RAN` after",
	};

	async function runShellFixture(
		options: Omit<Parameters<typeof createSkillHarness>[0], "fixtures">,
		fixture: SkillFixture = SHELL_FIXTURE,
	): Promise<string> {
		const { harness } = await createSkillHarness({ ...options, fixtures: [fixture] });
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/skill:shell");
		return findDeliveredText(harness, "shell");
	}

	it("`--no-tools` (empty allowed set) blocks injection with the tool-policy marker", async () => {
		const delivered = await runShellFixture({ allowedToolNames: [] });
		expect(delivered).toContain(SHELL_MARKERS.disabledByToolPolicy);
		expect(delivered).not.toContain("C1_ACCEPTANCE_SHELL_RAN");
	});

	it("excluded `bash` blocks injection with the tool-policy marker", async () => {
		const delivered = await runShellFixture({ excludedToolNames: ["bash"] });
		expect(delivered).toContain(SHELL_MARKERS.disabledByToolPolicy);
		expect(delivered).not.toContain("C1_ACCEPTANCE_SHELL_RAN");
	});

	it("`disallowed-tools` blocks injection with the tool-policy marker", async () => {
		const delivered = await runShellFixture({}, { ...SHELL_FIXTURE, frontmatter: { "disallowed-tools": ["bash"] } });
		expect(delivered).toContain(SHELL_MARKERS.disabledByToolPolicy);
		expect(delivered).not.toContain("C1_ACCEPTANCE_SHELL_RAN");
	});
});

// ============================================================================
// Acceptance clause: a queued steer/follow-up invocation activates its
// overrides when consumed
// ============================================================================

describe("C1 acceptance: queued steer/follow-up activation on consumption", () => {
	const QUEUED_FIXTURE: SkillFixture = {
		name: "queued",
		frontmatter: { effort: "high" },
		body: "Queued body.",
	};

	function createWaitTool(): { tool: AgentTool; release: () => void } {
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const tool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for release",
			parameters: Type.Object({}),
			execute: async () => {
				await toolRelease;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};
		return { tool, release: () => releaseToolExecution?.() };
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

	it("steer: overrides activate exactly when the queued invocation is consumed", async () => {
		const { tool, release } = createWaitTool();
		const { harness } = await createSkillHarness({ fixtures: [QUEUED_FIXTURE], tools: [tool] });
		let effortsAtConsumption: (string | number | undefined)[] = [];
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			() => {
				// Consumed (rendered + activated) before this next request.
				effortsAtConsumption = harness.session.skillRuntime.getActiveInvocations().map((i) => i.effort);
				return fauxAssistantMessage("after steer");
			},
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.steer("/skill:queued steer args");

		// Queued: not yet activated.
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);

		release();
		await promptPromise;

		// Consumption activated the invocation WITH its effort override.
		expect(effortsAtConsumption).toEqual(["high"]);
		// Turn expired after the run settled.
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);
	});

	it("follow-up: overrides activate exactly when the queued invocation is consumed", async () => {
		const { tool, release } = createWaitTool();
		const { harness } = await createSkillHarness({ fixtures: [QUEUED_FIXTURE], tools: [tool] });
		let effortsAtConsumption: (string | number | undefined)[] = [];
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("first turn done"),
			(context) => {
				effortsAtConsumption = harness.session.skillRuntime.getActiveInvocations().map((i) => i.effort);
				const delivered = context.messages.some(
					(message) =>
						message.role === "user" &&
						getMessageText(message).includes('<skill name="queued" args="follow args">'),
				);
				return fauxAssistantMessage(delivered ? "saw follow-up block" : "missing follow-up block");
			},
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.followUp("/skill:queued follow args");
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);

		release();
		await promptPromise;

		expect(effortsAtConsumption).toEqual(["high"]);
		expect(getAssistantTexts(harness)).toContain("saw follow-up block");
		expect(harness.session.skillRuntime.getActiveInvocations()).toHaveLength(0);
	});
});

// ============================================================================
// Genuine `skill` tool + synthetic events/persistence (C1c delivery contract,
// restated here as part of the integrated paragraph gate)
// ============================================================================

describe("C1 acceptance: genuine skill tool and synthetic events/persistence", () => {
	it("a genuine model `skill` tool call returns the rendered body as its real tool result", async () => {
		const { harness } = await createSkillHarness({
			fixtures: [{ name: "genuine", body: "Genuine rendered body." }],
		});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("skill", { name: "genuine", args: "genuine args" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("ok"),
		]);

		await harness.session.prompt("invoke the skill");

		const toolResult = harness.session.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "skill",
		);
		expect(getMessageText(toolResult!)).toContain("Genuine rendered body.");
		const resultEntry = messageEntries(harness).find((entry) => entry.message.role === "toolResult");
		expect(resultEntry?.invocations?.[0]).toMatchObject({ name: "genuine", args: "genuine args" });
	});

	it("synthetic delivery emits synthetic-flagged events and persists the pair atomically", async () => {
		const syntheticFlags: boolean[] = [];
		const { harness } = await createSkillHarness({
			fixtures: [{ name: "syn", body: "Synthetic body." }],
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("tool_result", (event) => {
						syntheticFlags.push(event.synthetic === true);
						return undefined;
					});
				},
			],
		});
		flagModel(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:syn syn args");

		// The synthetic pair's tool_result event was flagged synthetic.
		expect(syntheticFlags).toContain(true);
		// Persistence: two entries sharing one pairId, assistant then toolResult.
		const pairEntries = messageEntries(harness).filter((entry) => entry.pairId !== undefined);
		expect(pairEntries).toHaveLength(2);
		expect(pairEntries[0].pairId).toBe(pairEntries[1].pairId);
		expect(pairEntries[0].message.role).toBe("assistant");
		expect(pairEntries[1].message.role).toBe("toolResult");
		expect(getMessageText(pairEntries[1].message)).toContain("Synthetic body.");
	});
});

// ============================================================================
// Acceptance clause: redirect fixture — corrective replies for
// `Task`/`AskUserQuestion` misses, and mapped-unregistered fallthrough to the
// nearest-name suggestion
// ============================================================================

describe("C1 acceptance: unknown-tool redirects through AgentSession", () => {
	function trackerTool(name: string, executed: string[]): AgentTool {
		return {
			name,
			label: name,
			description: `${name} tracker`,
			parameters: Type.Object({}),
			execute: async () => {
				executed.push(name);
				return { content: [{ type: "text", text: `${name} ran` }], details: {} };
			},
		};
	}

	async function runUnknownCall(
		attemptedName: string,
		tools: AgentTool[],
		settings?: HarnessOptions["settings"],
	): Promise<{ toolResultText: string; isError: boolean }> {
		const { harness } = await createSkillHarness({ fixtures: [], tools, settings });
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall(attemptedName, {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("recovered"),
		]);

		await harness.session.prompt("call the tool");

		const toolResult = harness.session.messages.find((message) => message.role === "toolResult");
		expect(getAssistantTexts(harness)).toContain("recovered");
		return {
			toolResultText: toolResult ? getMessageText(toolResult) : "",
			isError: toolResult?.role === "toolResult" ? toolResult.isError : false,
		};
	}

	it("`Task` miss replies with the corrective redirect and never executes the target", async () => {
		const executed: string[] = [];
		const { toolResultText, isError } = await runUnknownCall("Task", [trackerTool("Agent", executed)]);
		expect(toolResultText).toBe("Tool Task is not available — use Agent instead");
		expect(isError).toBe(true);
		expect(executed).toEqual([]);
	});

	it("`AskUserQuestion` miss replies with the corrective redirect", async () => {
		const executed: string[] = [];
		const { toolResultText } = await runUnknownCall("AskUserQuestion", [trackerTool("ask_user_question", executed)]);
		expect(toolResultText).toBe("Tool AskUserQuestion is not available — use ask_user_question instead");
		expect(executed).toEqual([]);
	});

	it("a mapped entry whose target is unregistered falls through to the nearest-name suggestion", async () => {
		const executed: string[] = [];
		// Task maps to Agent, which is not registered here; tack is distance 1.
		const { toolResultText, isError } = await runUnknownCall("Task", [trackerTool("tack", executed)]);
		expect(toolResultText).toBe("Tool Task not found — did you mean tack?");
		expect(isError).toBe(true);
		expect(executed).toEqual([]);
	});

	it("`disableToolRedirects` yields the plain not-found for a mapped miss", async () => {
		const executed: string[] = [];
		const { toolResultText } = await runUnknownCall("Task", [trackerTool("Agent", executed)], {
			disableToolRedirects: true,
		});
		expect(toolResultText).toBe("Tool Task not found");
		expect(executed).toEqual([]);
	});

	it("a `toolRedirects` override replaces a default target", async () => {
		const executed: string[] = [];
		const { toolResultText } = await runUnknownCall("Task", [trackerTool("custom_agent", executed)], {
			toolRedirects: { Task: "custom_agent" },
		});
		expect(toolResultText).toBe("Tool Task is not available — use custom_agent instead");
		expect(executed).toEqual([]);
	});
});
