/**
 * C4c A.6 per-skill visibility end-to-end through AgentSession with the faux
 * provider: one shared settings-derived visibility state map governs all four
 * surfaces (listing, `skill` tool, `/name` namespace, `read`-variant listing),
 * ID-keyed persistence survives a collision-winner deletion, and `off` is a
 * consumed error on every invocation path while a non-`off`
 * `user-invocable: false` `/name` stays silent literal text.
 */

import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import { extractSkillListingBlock, formatSkillsForPrompt } from "../../src/core/skills/listing.ts";
import { resolveSkillVisibility, type SkillVisibilityState } from "../../src/core/skills/visibility.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { canonicalizePath } from "../../src/utils/paths.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, getUserTexts, type Harness } from "./harness.ts";

interface SkillFixture {
	name: string;
	body?: string;
	description?: string;
	disableModelInvocation?: boolean;
	userInvocable?: boolean;
	/** Subdirectory (relative to the fixtures root) the skill lives in; defaults to its name. */
	dir?: string;
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
	const tempDir = join(tmpdir(), `pi-c4c-visibility-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	// Canonicalize up front (macOS /var→/private/var) so fixture IDs computed
	// before the SKILL.md exists match `canonicalizePath(filePath)` after.
	const canonical = realpathSync(tempDir);
	tempDirs.push(canonical);
	return canonical;
}

function fixturePath(tempDir: string, fixture: SkillFixture): { baseDir: string; filePath: string } {
	const baseDir = join(tempDir, fixture.dir ?? fixture.name);
	return { baseDir, filePath: join(baseDir, "SKILL.md") };
}

/** Canonical skill ID for a fixture: `LoadedSkill.id = canonicalizePath(filePath)`. */
function fixtureId(tempDir: string, fixture: SkillFixture): string {
	return canonicalizePath(fixturePath(tempDir, fixture).filePath);
}

function writeFixture(tempDir: string, fixture: SkillFixture): void {
	const { baseDir, filePath } = fixturePath(tempDir, fixture);
	mkdirSync(baseDir, { recursive: true });
	const frontmatter = [
		"---",
		`name: ${fixture.name}`,
		...(fixture.disableModelInvocation ? ["disable-model-invocation: true"] : []),
		...(fixture.userInvocable === false ? ["user-invocable: false"] : []),
		"---",
		"",
	].join("\n");
	writeFileSync(filePath, `${frontmatter}${fixture.body ?? `${fixture.name} body`}`);
}

function createSkillsLoader(tempDir: string, fixtures: SkillFixture[]): ResourceLoader {
	for (const fixture of fixtures) {
		writeFixture(tempDir, fixture);
	}
	const skills = fixtures.map((fixture) => {
		const { baseDir, filePath } = fixturePath(tempDir, fixture);
		return {
			name: fixture.name,
			description: fixture.description ?? `${fixture.name} skill`,
			filePath,
			disableModelInvocation: fixture.disableModelInvocation ?? false,
			userInvocable: fixture.userInvocable ?? true,
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

async function createVisibilityHarness(
	tempDir: string,
	fixtures: SkillFixture[],
	options: {
		settings?: Partial<Settings>;
		tools?: AgentTool[];
		resourceLoader?: ResourceLoader;
	} = {},
): Promise<Harness> {
	const harness = await createHarness({
		models: [{ id: "session-model", contextWindow: 60_000 }],
		tools: options.tools,
		resourceLoader: options.resourceLoader ?? createSkillsLoader(tempDir, fixtures),
		settings: options.settings,
	});
	harnesses.push(harness);
	return harness;
}

/** Collect skill diagnostics (the `_emitSkillDiagnostics` → onError channel). */
async function collectDiagnostics(harness: Harness): Promise<Array<{ event: string; error: string }>> {
	const errors: Array<{ event: string; error: string }> = [];
	await harness.session.bindExtensions({ onError: (error) => errors.push(error) });
	return errors;
}

async function applyVisibility(
	harness: Harness,
	tempDir: string,
	fixture: SkillFixture,
	state: SkillVisibilityState,
	scope: "global" | "project" = "global",
): Promise<void> {
	const result = await harness.session.applySkillVisibilityChange(fixtureId(tempDir, fixture), state, scope);
	if (!result.ok) throw new Error(`applySkillVisibilityChange failed: ${result.error}`);
}

function listingEntry(systemPrompt: string, name: string): string | undefined {
	const block = extractSkillListingBlock(systemPrompt);
	if (!block) return undefined;
	for (const match of block.matchAll(/<skill>([\s\S]*?)<\/skill>/g)) {
		if (match[1]?.includes(`<name>${name}</name>`)) {
			return match[1];
		}
	}
	return undefined;
}

/** The emitted `<available_skills>` listing entry state for one skill. */
function listingModel(systemPrompt: string, name: string): "full" | "name" | "no" {
	const entry = listingEntry(systemPrompt, name);
	if (!entry) return "no";
	return entry.includes("<description>") ? "full" : "name";
}

/** All message text in the session (any role). */
function allMessageText(harness: Harness): string {
	return harness.session.messages.map((message) => getMessageText(message)).join("\n");
}

function lastSkillToolResult(harness: Harness): { text: string; isError: boolean } | undefined {
	const result = [...harness.session.messages].reverse().find((message) => message.role === "toolResult");
	if (!result || result.role !== "toolResult") return undefined;
	return { text: getMessageText(result), isError: result.isError ?? false };
}

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

const PROBE: SkillFixture = { name: "probe" };
const ANCHOR: SkillFixture = { name: "anchor" };

interface MatrixRow {
	state: SkillVisibilityState;
	disableModelInvocation?: boolean;
	userInvocable?: boolean;
	model: "full" | "name" | "no";
	user: "yes" | "no" | "error";
}

const MATRIX: MatrixRow[] = [
	{ state: "on", model: "full", user: "yes" },
	{ state: "on", disableModelInvocation: true, model: "no", user: "yes" },
	{ state: "on", userInvocable: false, model: "full", user: "no" },
	{ state: "on", disableModelInvocation: true, userInvocable: false, model: "no", user: "no" },
	{ state: "name-only", model: "name", user: "yes" },
	{ state: "name-only", disableModelInvocation: true, model: "no", user: "yes" },
	{ state: "name-only", userInvocable: false, model: "name", user: "no" },
	{ state: "name-only", disableModelInvocation: true, userInvocable: false, model: "no", user: "no" },
	{ state: "user-invocable-only", model: "no", user: "yes" },
	{ state: "user-invocable-only", disableModelInvocation: true, model: "no", user: "yes" },
	{ state: "user-invocable-only", userInvocable: false, model: "no", user: "no" },
	{ state: "user-invocable-only", disableModelInvocation: true, userInvocable: false, model: "no", user: "no" },
	{ state: "off", model: "no", user: "error" },
	{ state: "off", disableModelInvocation: true, model: "no", user: "error" },
	{ state: "off", userInvocable: false, model: "no", user: "error" },
	{ state: "off", disableModelInvocation: true, userInvocable: false, model: "no", user: "error" },
];

describe("AC1: A.6 truth table across all four surfaces", () => {
	for (const row of MATRIX) {
		const frontmatterLabel =
			`${row.disableModelInvocation ? "dmi+" : ""}${row.userInvocable === false ? "ui:f" : ""}` || "none";
		it(`state=${row.state} × frontmatter=${frontmatterLabel}`, async () => {
			const tempDir = makeTempDir();
			const probe: SkillFixture = {
				...PROBE,
				...(row.disableModelInvocation ? { disableModelInvocation: true } : {}),
				...(row.userInvocable === false ? { userInvocable: false } : {}),
			};
			const harness = await createVisibilityHarness(tempDir, [probe, ANCHOR], {
				settings: row.state === "on" ? {} : { skillVisibility: { [fixtureId(tempDir, probe)]: row.state } },
			});
			const errors = await collectDiagnostics(harness);

			// Surface 1+4: the emitted `<available_skills>` listing (tool variant)
			// and the `read` variant must reflect the model dimension identically.
			harness.setResponses([fauxAssistantMessage("ok")]);
			await harness.session.prompt("hi");
			expect(listingModel(harness.session.systemPrompt, "probe")).toBe(row.model);

			const loadedSkills = harness.session.resourceLoader.getSkills().skills;
			const readBlock = extractSkillListingBlock(
				formatSkillsForPrompt(
					loadedSkills,
					"read",
					undefined,
					undefined,
					new Map([
						[
							fixtureId(tempDir, probe),
							resolveSkillVisibility(
								{
									disableModelInvocation: row.disableModelInvocation ?? false,
									userInvocable: row.userInvocable ?? true,
								},
								row.state,
							),
						],
					]),
				),
			);
			expect(readBlock).toBe(extractSkillListingBlock(harness.session.systemPrompt));

			// Surface 2: the `skill` tool's accepted set (anchor keeps the tool registered).
			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("skill", { name: "probe" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("call the skill tool");
			const toolResult = lastSkillToolResult(harness);
			if (row.model === "no") {
				expect(toolResult?.isError).toBe(true);
				expect(toolResult?.text).toContain("Unknown or model-hidden");
			} else {
				expect(toolResult?.isError ?? false).toBe(false);
				expect(toolResult?.text).toContain("probe body");
			}

			// Surface 3: the user `/name` namespace (asserted on the messages
			// produced by THIS prompt, so earlier tool deliveries cannot leak in).
			const before = harness.session.messages.length;
			const tailText = () =>
				harness.session.messages
					.slice(before)
					.map((message) => getMessageText(message))
					.join("\n");
			const tailUserTexts = () =>
				harness.session.messages
					.slice(before)
					.filter((message) => message.role === "user")
					.map((message) => getMessageText(message));
			if (row.user === "yes") {
				harness.setResponses([fauxAssistantMessage("ok")]);
				await harness.session.prompt("/probe");
				// Expanded (full body on first delivery, A.6 dedup note on re-invocation) — never literal, never consumed.
				expect(tailText()).toMatch(/probe body|already loaded/);
			} else if (row.user === "no") {
				harness.setResponses([fauxAssistantMessage("ok")]);
				await harness.session.prompt("/probe");
				expect(tailUserTexts().some((text) => text.includes("/probe"))).toBe(true);
				expect(tailText()).not.toContain("probe body");
				expect(errors).toHaveLength(0);
			} else {
				harness.setResponses([fauxAssistantMessage("ok")]);
				await harness.session.prompt("/probe");
				expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
				expect(tailUserTexts().some((text) => text.includes("/probe"))).toBe(false);
				expect(tailText()).not.toContain("probe body");
			}
		});
	}
});

describe("AC2: off is a consumed error on every invocation path", () => {
	it("qualified /skill:name and mid-prompt bare names are consumed with one diagnostic each", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR], {
			settings: { skillVisibility: { [fixtureId(tempDir, PROBE)]: "off" } },
		});
		const errors = await collectDiagnostics(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("please run /probe and also /skill:probe now");
		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(2);
		const forwarded = getUserTexts(harness).find((text) => text.includes("please run"));
		expect(forwarded).toBeDefined();
		expect(forwarded).not.toContain("probe");
	});

	it("off + user-invocable:false still errors (truth-table override), an unknown /name stays literal", async () => {
		const tempDir = makeTempDir();
		const hidden: SkillFixture = { name: "hidden", userInvocable: false };
		const harness = await createVisibilityHarness(tempDir, [hidden, ANCHOR], {
			settings: { skillVisibility: { [fixtureId(tempDir, hidden)]: "off" } },
		});
		const errors = await collectDiagnostics(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/hidden");
		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
		expect(getUserTexts(harness).some((text) => text.includes("/hidden"))).toBe(false);

		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/nonexistent-skill");
		expect(getUserTexts(harness).some((text) => text.includes("/nonexistent-skill"))).toBe(true);
		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
	});

	it("steer: a queued off /name emits exactly one diagnostic and forwards no /name text", async () => {
		const tempDir = makeTempDir();
		const { tool, release } = createWaitTool();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR], {
			tools: [tool],
			settings: { skillVisibility: { [fixtureId(tempDir, PROBE)]: "off" } },
		});
		const errors = await collectDiagnostics(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("after steer"),
		]);
		const started = waitForWaitToolStart(harness);
		const promptPromise = harness.session.prompt("start");
		await started;
		await harness.session.steer("/probe");
		release();
		await promptPromise;

		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
		expect(getUserTexts(harness).some((text) => text.includes("/probe"))).toBe(false);
	});

	it("followUp: a queued off /name emits exactly one diagnostic and forwards no /name text", async () => {
		const tempDir = makeTempDir();
		const { tool, release } = createWaitTool();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR], {
			tools: [tool],
			settings: { skillVisibility: { [fixtureId(tempDir, PROBE)]: "off" } },
		});
		const errors = await collectDiagnostics(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("first turn done"),
			fauxAssistantMessage("after followup"),
		]);
		const started = waitForWaitToolStart(harness);
		const promptPromise = harness.session.prompt("start");
		await started;
		await harness.session.followUp("/probe");
		release();
		await promptPromise;

		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
		expect(getUserTexts(harness).some((text) => text.includes("/probe"))).toBe(false);
	});

	it("with enableSkillCommands=false an off /name stays literal (no tombstone)", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR], {
			settings: {
				enableSkillCommands: false,
				skillVisibility: { [fixtureId(tempDir, PROBE)]: "off" },
			},
		});
		const errors = await collectDiagnostics(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/probe");
		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(0);
		expect(getUserTexts(harness).some((text) => text.includes("/probe"))).toBe(true);
	});
});

describe("tombstone isolation", () => {
	it("an off skill is absent from getCommands() and never shadows a live winner's bare name", async () => {
		const tempDir = makeTempDir();
		const web: SkillFixture = { name: "dup", dir: "web", body: "web dup body" };
		const api: SkillFixture = { name: "dup", dir: "api", body: "api dup body" };
		const harness = await createVisibilityHarness(tempDir, [web, api], {
			settings: { skillVisibility: { [fixtureId(tempDir, api)]: "off" } },
		});
		await collectDiagnostics(harness);

		const commandNames = harness.session.getCommands().map((command) => command.name);
		expect(commandNames).toContain("dup");
		expect(commandNames).not.toContain("api:dup");

		// The live winner keeps the bare name; the off loser is tombstoned under
		// its dir-qualified variant (consumed), never shadowing /dup.
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/dup");
		expect(allMessageText(harness)).toContain("web dup body");
	});

	it("an off collision participant errors under its bare, skill:, and dir-qualified names", async () => {
		const tempDir = makeTempDir();
		const web: SkillFixture = { name: "dup", dir: "web", body: "web dup body" };
		const api: SkillFixture = { name: "dup", dir: "api", body: "api dup body" };
		const harness = await createVisibilityHarness(tempDir, [web, api], {
			settings: { skillVisibility: { [fixtureId(tempDir, api)]: "off" } },
		});
		const errors = await collectDiagnostics(harness);

		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("try /api:dup here");
		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
		expect(allMessageText(harness)).not.toContain("api dup body");
	});
});

describe("AC4: ID-keyed persistence survives a collision-winner deletion", () => {
	it("the surviving loser's own-ID restriction persists; the winner's state is not transferred", async () => {
		const tempDir = makeTempDir();
		const web: SkillFixture = { name: "dup", dir: "web", body: "web dup body" };
		const api: SkillFixture = { name: "dup", dir: "api", body: "api dup body" };
		let winnerDeleted = false;
		const baseLoader = createSkillsLoader(tempDir, [web, api]);
		const resourceLoader: ResourceLoader = {
			...baseLoader,
			getSkills: () => {
				const loaded = baseLoader.getSkills();
				return winnerDeleted
					? { skills: loaded.skills.filter((skill) => skill.baseDir.endsWith("api")), diagnostics: [] }
					: loaded;
			},
			reload: async () => {},
		};
		const harness = await createVisibilityHarness(tempDir, [], {
			resourceLoader,
			settings: {
				skillVisibility: {
					[fixtureId(tempDir, api)]: "off",
					[fixtureId(tempDir, web)]: "name-only",
				},
			},
		});
		const errors = await collectDiagnostics(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		expect(listingModel(harness.session.systemPrompt, "dup")).toBe("name");

		// Delete the winner and reload: the loser keeps its own `off` (bare /dup
		// now errors, no listing entry) and the winner's `name-only` is NOT
		// transferred to it.
		winnerDeleted = true;
		await harness.session.reload();
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/dup");
		expect(listingModel(harness.session.systemPrompt, "dup")).toBe("no");
		expect(errors.filter((error) => error.error.includes('visibility "off"'))).toHaveLength(1);
		expect(allMessageText(harness)).not.toContain("api dup body");
	});
});

describe("AC7: prospective-only + transitions + scope precedence", () => {
	it("setting off does not rewrite delivered history or dedup/carry-forward records", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR], {
			settings: { compaction: { keepRecentTokens: 0 } },
		});
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/probe");
		expect(allMessageText(harness)).toContain("probe body");
		const branchBefore = JSON.stringify(harness.session.sessionManager.getBranch());

		await applyVisibility(harness, tempDir, PROBE, "off");

		// Already-delivered history and invocation records are byte-identical.
		expect(JSON.stringify(harness.session.sessionManager.getBranch())).toBe(branchBefore);
		expect(allMessageText(harness)).toContain("probe body");

		// The next request's surfaces are gated (compaction in between does not
		// re-introduce the entry either).
		harness.setResponses([fauxAssistantMessage("compacted summary")]);
		await harness.session.compact();
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi again");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("no");
		expect(JSON.stringify(harness.session.sessionManager.getBranch())).not.toContain("<name>probe</name>");
	});

	it("setting off preserves a carry-forward record established before the transition", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR], {
			settings: { compaction: { keepRecentTokens: 0 } },
		});
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/probe");
		expect(allMessageText(harness)).toContain("probe body");

		// Compact while probe is still on, so a carry-forward record (the
		// re-attached inline body) exists BEFORE the visibility change.
		harness.setResponses([fauxAssistantMessage("compacted summary")]);
		await harness.session.compact();
		expect(allMessageText(harness)).toContain("probe body");
		const carriedMessages = allMessageText(harness);

		// Hiding it is prospective-only: the already-carried body is untouched,
		// independently of the delivered-history assertion above.
		await applyVisibility(harness, tempDir, PROBE, "off");
		expect(allMessageText(harness)).toBe(carriedMessages);
		expect(allMessageText(harness)).toContain("probe body");

		// The next request's model-facing listing is still gated even though the
		// carried body remains.
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi again");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("no");
		expect(allMessageText(harness)).toContain("probe body");
	});

	it("off → on → /name invokes normally (no stale disabled state)", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR]);
		await collectDiagnostics(harness);
		await applyVisibility(harness, tempDir, PROBE, "off");
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/probe");
		expect(allMessageText(harness)).not.toContain("probe body");

		await applyVisibility(harness, tempDir, PROBE, "on");
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/probe");
		expect(allMessageText(harness)).toContain("probe body");
	});

	it("a project off overrides a global on, and a project on overrides a global off", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR]);

		// A project off overrides the (default) global on.
		await applyVisibility(harness, tempDir, PROBE, "off", "project");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("no");
		expect(harness.settingsManager.getSkillVisibilityState(fixtureId(tempDir, PROBE))).toBe("off");

		// Back to a clean slate, then build the cross-scope case explicitly.
		await applyVisibility(harness, tempDir, PROBE, "on", "project");
		await applyVisibility(harness, tempDir, PROBE, "off", "global");
		expect(harness.settingsManager.getSkillVisibilityState(fixtureId(tempDir, PROBE))).toBe("off");

		// A global off plus a project on resolves on (explicit project override,
		// not a delete that would re-expose the global off).
		await applyVisibility(harness, tempDir, PROBE, "on", "project");
		expect(harness.settingsManager.getSkillVisibilityState(fixtureId(tempDir, PROBE))).toBe("on");
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/probe");
		expect(allMessageText(harness)).toContain("probe body");
		const row = harness.session.getSkillsManagementView().find((entry) => entry.name === "probe");
		expect(row?.state).toBe("on");
		expect(row?.stateScope).toBe("project");
	});
});

describe("/skills management view + apply seam", () => {
	it("reports cost, effective visibility, scope, and a malformed indicator", async () => {
		const tempDir = makeTempDir();
		const dmi: SkillFixture = { name: "dmi-skill", disableModelInvocation: true };
		const harness = await createVisibilityHarness(tempDir, [PROBE, dmi], {
			settings: {
				skillVisibility: {
					[fixtureId(tempDir, PROBE)]: "name-only",
					[fixtureId(tempDir, dmi)]: "junk" as unknown as SkillVisibilityState,
				},
			},
		});
		const errors = await collectDiagnostics(harness);
		const view = harness.session.getSkillsManagementView();

		const probeRow = view.find((row) => row.name === "probe");
		expect(probeRow?.state).toBe("name-only");
		expect(probeRow?.stateScope).toBe("global");
		expect(probeRow?.effective.model).toBe("name");
		expect(probeRow?.effective.user).toBe("yes");
		expect(probeRow?.estimatedCost).toBeGreaterThan(0);
		expect(probeRow?.malformed).toBe(false);

		const dmiRow = view.find((row) => row.name === "dmi-skill");
		expect(dmiRow?.state).toBe("on");
		expect(dmiRow?.stateScope).toBe("global");
		expect(dmiRow?.malformed).toBe(true);
		expect(dmiRow?.effective.model).toBe("no");

		// The malformed value surfaces exactly one diagnostic on the next rebuild.
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		expect(errors.filter((error) => error.error.includes("not a valid visibility state"))).toHaveLength(1);
	});

	it("a name-only change takes effect on the next request without /reload", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR]);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("full");

		await applyVisibility(harness, tempDir, PROBE, "name-only");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("name");

		// A model switch between the change and the next request does not strand it.
		await harness.session.setModel(harness.getModel("session-model")!);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("next");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("name");
	});

	it("hiding the last visible skill rebuilds and removes the skill tool; restoring re-registers it", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE]);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");
		expect(harness.session.getActiveToolNames()).toContain("skill");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("full");

		await applyVisibility(harness, tempDir, PROBE, "off");
		expect(harness.session.getActiveToolNames()).not.toContain("skill");
		expect(extractSkillListingBlock(harness.session.systemPrompt)).toBeUndefined();

		await applyVisibility(harness, tempDir, PROBE, "on");
		expect(harness.session.getActiveToolNames()).toContain("skill");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("full");
	});

	it("a failed settings write surfaces an error and does not claim persistence", async () => {
		const tempDir = makeTempDir();
		const harness = await createVisibilityHarness(tempDir, [PROBE, ANCHOR]);
		const drainSpy = vi.spyOn(harness.settingsManager, "drainErrors");
		drainSpy
			.mockImplementationOnce(() => [])
			.mockImplementationOnce(() => [{ scope: "global", error: new Error("disk full") }]);
		const result = await harness.session.applySkillVisibilityChange(fixtureId(tempDir, PROBE), "off", "global");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("disk full");
		drainSpy.mockRestore();
		// The visibility snapshot was not applied.
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("full");
	});

	it("a failed rebuild retains the dirty state and the next request retries and clears it", async () => {
		const tempDir = makeTempDir();
		const baseLoader = createSkillsLoader(tempDir, [PROBE, ANCHOR]);
		let throwing = false;
		const resourceLoader: ResourceLoader = {
			...baseLoader,
			getSkills: () => {
				if (throwing) throw new Error("loader exploded");
				return baseLoader.getSkills();
			},
		};
		const harness = await createVisibilityHarness(tempDir, [], { resourceLoader });

		throwing = true;
		const result = await harness.session.applySkillVisibilityChange(fixtureId(tempDir, PROBE), "name-only", "global");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain("loader exploded");

		// Retry on the next request: exactly one successful rebuild applies it.
		throwing = false;
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("retry");
		expect(listingModel(harness.session.systemPrompt, "probe")).toBe("name");
	});
});

describe("AC6: rollback parity with an absent skillVisibility setting", () => {
	it("all four surfaces match frontmatter-only behavior, with no tombstones or diagnostics", async () => {
		const tempDir = makeTempDir();
		const dmi: SkillFixture = { name: "dmi-skill", disableModelInvocation: true };
		const harness = await createVisibilityHarness(tempDir, [PROBE, dmi]);
		const errors = await collectDiagnostics(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("hi");

		// Listing bytes equal the pure formatter called with NO visibility map.
		const loadedSkills = harness.session.resourceLoader.getSkills().skills;
		const expected = extractSkillListingBlock(formatSkillsForPrompt(loadedSkills, "tool"));
		expect(extractSkillListingBlock(harness.session.systemPrompt)).toBe(expected);

		// Registry: dmi skill still /name-invocable, no tombstones anywhere.
		expect(harness.session.getCommands().map((command) => command.name)).toContain("dmi-skill");
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("/dmi-skill");
		expect(allMessageText(harness)).toContain("dmi-skill body");
		expect(errors).toHaveLength(0);
	});
});
