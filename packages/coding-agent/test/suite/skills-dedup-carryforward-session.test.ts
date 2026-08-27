/**
 * A.6 re-invocation dedup + compaction carry-forward (c4b) end-to-end through
 * AgentSession with the faux provider: identical inline re-invocations note
 * instead of re-pasting the full body across all three inline delivery paths
 * (sole-skill and the `skill` tool carry the note as their payload; a
 * mid-prompt composed span keeps the user's message verbatim and delivers the
 * note as a display-only notice beside it); a compaction (manual or
 * auto) re-attaches the most-recent inline body of each invoked skill,
 * MRU-first, budget-capped; carry-forward keeps dedup valid for a carried
 * skill and invalidates it for a dropped-and-not-carried one; reconstruction
 * after resume and `navigateTree` is side-effect-free and restores the
 * carried body itself; malformed persisted metadata degrades to full
 * delivery instead of a false note.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type Context,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxToolCall,
	streamSimple,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { convertToLlm } from "../../src/core/messages.ts";
import { computeSkillInvocationCounts } from "../../src/core/skills/listing-budget.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness, type HarnessOptions } from "./harness.ts";

type SessionWithCompactionInternals = {
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

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
	const tempDir = join(tmpdir(), `pi-c4b-dedup-cf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

interface SkillFixture {
	name: string;
	body: string;
}

function createSkillsLoader(fixturesDir: string, fixtures: SkillFixture[]): ResourceLoader {
	const skills = fixtures.map((fixture) => {
		const baseDir = join(fixturesDir, fixture.name);
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
		};
	});
	return { ...createTestResourceLoader(), getSkills: () => ({ skills, diagnostics: [] }) };
}

async function createDedupHarness(
	fixtures: SkillFixture[],
	options: {
		contextWindow?: number;
		settings?: { compaction?: { keepRecentTokens?: number } };
		extensionFactories?: HarnessOptions["extensionFactories"];
		tools?: AgentTool[];
	} = {},
): Promise<{ harness: Harness; tempDir: string }> {
	const tempDir = makeTempDir();
	const baseLoader = createSkillsLoader(tempDir, fixtures);
	// A custom resourceLoader bypasses harness.ts's own extensionFactories wiring
	// (it only applies to the DEFAULT resourceLoader), so build the extensionsResult here.
	const extensionsResult = options.extensionFactories
		? await createTestExtensionsResult(options.extensionFactories, tempDir)
		: undefined;
	const resourceLoader: ResourceLoader = {
		...baseLoader,
		...(extensionsResult && { getExtensions: () => extensionsResult }),
	};
	const harness = await createHarness({
		models: [{ id: "session-model", contextWindow: options.contextWindow ?? 200_000 }],
		resourceLoader,
		settings: options.settings,
		...(options.tools && { tools: options.tools }),
	});
	harnesses.push(harness);
	return { harness, tempDir };
}

function skillIdFor(harness: Harness, name: string): string {
	for (const [skillId] of computeSkillInvocationCounts(harness.sessionManager.getEntries())) {
		if (skillId.endsWith(`${name}/SKILL.md`)) {
			return skillId;
		}
	}
	throw new Error(`no persisted invocation found for skill "${name}"`);
}

function lastUserText(harness: Harness): string {
	const userMessages = harness.session.messages.filter((m) => m.role === "user");
	return getMessageText(userMessages[userMessages.length - 1]);
}

function lastToolResultText(harness: Harness): string {
	const toolResults = harness.session.messages.filter((m) => m.role === "toolResult");
	return getMessageText(toolResults[toolResults.length - 1]);
}

function isNote(text: string): boolean {
	return text.includes("is already loaded");
}

/** Display-only A.6 dedup notices (`skill_note` custom messages), in transcript order. */
function skillNotes(harness: Harness): string[] {
	return harness.session.messages
		.filter((m) => m.role === "custom" && m.customType === "skill_note")
		.map((m) => getMessageText(m));
}

/** Transcript index of a message, for asserting the notice follows its user message. */
function indexOf(harness: Harness, predicate: (message: AgentMessage) => boolean): number {
	return harness.session.messages.findIndex(predicate);
}

/** A faux response that records the LLM-converted context text the provider received. */
function captureRequest(sink: string[], reply = "ok"): FauxResponseFactory {
	return (context: Context) => {
		sink.push(context.messages.map((message) => getMessageText(message)).join("\n"));
		return fauxAssistantMessage(reply);
	};
}

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

function countFor(harness: Harness, name: string): number | undefined {
	for (const [skillId, count] of computeSkillInvocationCounts(harness.sessionManager.getEntries())) {
		if (skillId.endsWith(`${name}/SKILL.md`)) {
			return count;
		}
	}
	return undefined;
}

/** Simulates a resume: a fresh AgentSession's construction seam that runs before `bindExtensions`. */
function resumeSession(harness: Harness): AgentSession {
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: streamSimple,
		initialState: { model: harness.getModel(), systemPrompt: "You are a test assistant.", tools: [] },
		convertToLlm,
	});
	agent.state.messages = harness.sessionManager.buildSessionContext().messages;
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
	resumed.reattachCarriedSkills();
	return resumed;
}

const A = { name: "skill-a", body: "Skill A instructions." };
const B = { name: "skill-b", body: "Skill B instructions." };
const C = { name: "skill-c", body: "Skill C instructions." };

describe("A.6 dedup delivered form (AC1, AC2)", () => {
	it("sole-skill: an identical re-invocation delivers the note, not the full body", async () => {
		const { harness } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("ack1"), fauxAssistantMessage("ack2")]);

		await harness.session.prompt("/skill:skill-a");
		expect(lastUserText(harness)).toContain("Skill A instructions.");

		await harness.session.prompt("/skill:skill-a");
		expect(isNote(lastUserText(harness))).toBe(true);
		expect(countFor(harness, "skill-a")).toBe(2);
	});

	it("skill tool: three consecutive identical invocations each return a note (never a stray anchor)", async () => {
		const { harness } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("ack1")]);
		await harness.session.prompt("/skill:skill-a");

		for (let i = 0; i < 3; i++) {
			harness.setResponses([
				(_c, _o, _s, _m) =>
					fauxAssistantMessage([fauxToolCall("skill", { name: "skill-a" })], { stopReason: "toolUse" }),
				() => fauxAssistantMessage(`after ${i}`),
			]);
			await harness.session.prompt("go");
			expect(isNote(lastToolResultText(harness))).toBe(true);
		}
	});

	it("mid-prompt composed: an identical re-invocation preserves the prompt verbatim and notes out of band", async () => {
		const { harness } = await createDedupHarness([A]);
		const requests: string[] = [];
		harness.setResponses([fauxAssistantMessage("ack1")]);

		await harness.session.prompt("please read /skill:skill-a now");
		expect(lastUserText(harness)).toContain("Skill A instructions.");

		harness.setResponses([captureRequest(requests, "ack2")]);
		await harness.session.prompt("please read /skill:skill-a now");

		// The user's own message is preserved byte-for-byte, token included: the
		// model still sees that the skill was explicitly re-invoked.
		expect(lastUserText(harness)).toBe("please read /skill:skill-a now");
		expect(isNote(lastUserText(harness))).toBe(false);
		// The note is a display-only notice, never spliced into the prompt and
		// never sent to the model.
		expect(skillNotes(harness).filter(isNote)).toHaveLength(1);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain("please read /skill:skill-a now");
		expect(isNote(requests[0])).toBe(false);
		// It still counts as an invocation (A.6 counting-only 0/0 entry).
		expect(countFor(harness, "skill-a")).toBe(2);
	});

	it("mid-prompt composed: the notice follows the user message it belongs to", async () => {
		const { harness } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("ack1"), fauxAssistantMessage("ack2")]);

		await harness.session.prompt("please read /skill:skill-a now");
		await harness.session.prompt("please read /skill:skill-a now");

		const promptIndex = indexOf(
			harness,
			(message) => message.role === "user" && getMessageText(message) === "please read /skill:skill-a now",
		);
		const noticeIndex = indexOf(
			harness,
			(message) => message.role === "custom" && message.customType === "skill_note",
		);
		expect(promptIndex).toBeGreaterThanOrEqual(0);
		expect(noticeIndex).toBe(promptIndex + 1);
	});

	it("mid-prompt composed (queued): a follow-up re-invocation is preserved and notes out of band", async () => {
		const { tool, release } = waitTool();
		const { harness } = await createDedupHarness([A], { tools: [tool] });
		const requests: string[] = [];
		harness.setResponses([fauxAssistantMessage("ack1")]);
		await harness.session.prompt("please read /skill:skill-a now");

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("first turn done"),
			captureRequest(requests, "after follow-up"),
		]);
		const promptPromise = harness.session.prompt("start");
		await waitForWaitToolStart(harness);
		await harness.session.followUp("please read /skill:skill-a now");
		release();
		await promptPromise;

		expect(lastUserText(harness)).toBe("please read /skill:skill-a now");
		expect(skillNotes(harness).filter(isNote)).toHaveLength(1);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain("please read /skill:skill-a now");
		expect(isNote(requests[0])).toBe(false);
		expect(countFor(harness, "skill-a")).toBe(2);
	});

	it("changed args re-delivers the full body", async () => {
		const { harness } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("ack1"), fauxAssistantMessage("ack2")]);

		await harness.session.prompt("/skill:skill-a");
		await harness.session.prompt("/skill:skill-a with different args");

		expect(lastUserText(harness)).toContain("Skill A instructions.");
		expect(isNote(lastUserText(harness))).toBe(false);
	});

	it("changed rendered body with fixed args re-delivers the full body and becomes the new anchor", async () => {
		const { harness, tempDir } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("ack1")]);
		await harness.session.prompt("/skill:skill-a");
		expect(lastUserText(harness)).toContain("Skill A instructions.");

		// Edit the skill file on disk: the next render produces a different body
		// even though args are unchanged (A.6: identity compares the rendered body).
		writeFileSync(join(tempDir, "skill-a", "SKILL.md"), "Skill A instructions v2.");

		harness.setResponses([fauxAssistantMessage("ack2")]);
		await harness.session.prompt("/skill:skill-a");
		expect(lastUserText(harness)).toContain("Skill A instructions v2.");
		expect(isNote(lastUserText(harness))).toBe(false);

		// The changed delivery is the new anchor: a further identical invocation notes.
		harness.setResponses([fauxAssistantMessage("ack3")]);
		await harness.session.prompt("/skill:skill-a");
		expect(isNote(lastUserText(harness))).toBe(true);
	});

	it("transition chain: full(old) -> note -> full(new) -> identical(new) notes", async () => {
		const { harness, tempDir } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a"); // full(old)

		harness.setResponses([fauxAssistantMessage("a2")]);
		await harness.session.prompt("/skill:skill-a"); // note
		expect(isNote(lastUserText(harness))).toBe(true);

		writeFileSync(join(tempDir, "skill-a", "SKILL.md"), "Skill A instructions v2.");
		harness.setResponses([fauxAssistantMessage("a3")]);
		await harness.session.prompt("/skill:skill-a"); // full(new)
		expect(lastUserText(harness)).toContain("v2.");
		expect(isNote(lastUserText(harness))).toBe(false);

		harness.setResponses([fauxAssistantMessage("a4")]);
		await harness.session.prompt("/skill:skill-a"); // identical(new) -> notes
		expect(isNote(lastUserText(harness))).toBe(true);
	});
});

const compactionExtensionFactories: HarnessOptions["extensionFactories"] = [
	(pi) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary: "compacted",
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	},
];

/** A body large enough that `est()` exceeds the 5,000-code-unit per-skill carry-forward budget. */
const OVERSIZED = { name: "skill-big", body: `Skill BIG instructions. ${"x".repeat(20100)}` };

async function seedThreeSkillDeliveries(harness: Harness): Promise<void> {
	harness.setResponses([fauxAssistantMessage("a1")]);
	await harness.session.prompt("/skill:skill-a");
	harness.setResponses([fauxAssistantMessage("b1")]);
	await harness.session.prompt("/skill:skill-b");
	harness.setResponses([fauxAssistantMessage("c1")]);
	await harness.session.prompt("/skill:skill-c");
}

describe("A.6 compaction carry-forward (AC3, AC4)", () => {
	it("manual compact(): re-attaches the most-recent inline body of each invoked skill, MRU-first, after the summary", async () => {
		const { harness } = await createDedupHarness([A, B, C], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		await seedThreeSkillDeliveries(harness);

		await harness.session.compact();

		const messages = harness.session.messages;
		expect(messages[0]?.role).toBe("compactionSummary");
		const texts = messages.map((m) => getMessageText(m));
		const cIdx = texts.findIndex((t) => t.includes("Skill C instructions."));
		const bIdx = texts.findIndex((t) => t.includes("Skill B instructions."));
		const aIdx = texts.findIndex((t) => t.includes("Skill A instructions."));
		expect(cIdx).toBeGreaterThan(0);
		expect(bIdx).toBeGreaterThan(cIdx);
		expect(aIdx).toBeGreaterThan(bIdx);
	});

	it("auto _runAutoCompaction(): re-attaches the same MRU-first bodies as the manual path", async () => {
		const { harness } = await createDedupHarness([A, B, C], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		await seedThreeSkillDeliveries(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		await sessionInternals._runAutoCompaction("threshold", false);

		const texts = harness.session.messages.map((m) => getMessageText(m));
		expect(texts.some((t) => t.includes("Skill A instructions."))).toBe(true);
		expect(texts.some((t) => t.includes("Skill B instructions."))).toBe(true);
		expect(texts.some((t) => t.includes("Skill C instructions."))).toBe(true);
	});

	it("skips a body over the per-skill budget, admitting the smaller skills", async () => {
		const { harness } = await createDedupHarness([A, OVERSIZED], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a");
		harness.setResponses([fauxAssistantMessage("big1")]);
		await harness.session.prompt("/skill:skill-big");

		await harness.session.compact();

		const texts = harness.session.messages.map((m) => getMessageText(m));
		expect(texts.some((t) => t.includes("Skill A instructions."))).toBe(true);
		expect(texts.some((t) => t.includes("Skill BIG instructions."))).toBe(false);
	});

	it("a carried skill still dedups (note) on re-invocation after compaction", async () => {
		const { harness } = await createDedupHarness([A, B, C], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		await seedThreeSkillDeliveries(harness);
		await harness.session.compact();

		harness.setResponses([fauxAssistantMessage("a2")]);
		await harness.session.prompt("/skill:skill-a");

		expect(isNote(lastUserText(harness))).toBe(true);
	});

	it("a dropped-and-not-carried skill (over budget) re-delivers full on re-invocation after compaction", async () => {
		const { harness } = await createDedupHarness([A, OVERSIZED], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a");
		harness.setResponses([fauxAssistantMessage("big1")]);
		await harness.session.prompt("/skill:skill-big");
		await harness.session.compact();

		harness.setResponses([fauxAssistantMessage("big2")]);
		await harness.session.prompt("/skill:skill-big");

		expect(isNote(lastUserText(harness))).toBe(false);
		expect(lastUserText(harness)).toContain("Skill BIG instructions.");
	});

	it("carried re-attachments are ephemeral: absent from getBranch(), not double-carried on a second compaction", async () => {
		const { harness } = await createDedupHarness([A, B], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a");
		harness.setResponses([fauxAssistantMessage("b1")]);
		await harness.session.prompt("/skill:skill-b");
		await harness.session.compact();

		const branchOccurrences = harness.sessionManager
			.getBranch()
			.filter(
				(e) =>
					e.type === "message" && "message" in e && getMessageText(e.message).includes("Skill A instructions."),
			).length;
		const stateOccurrences = harness.session.messages.filter((m) =>
			getMessageText(m).includes("Skill A instructions."),
		).length;
		// The compaction drops the original delivery from context (that is why carry-forward
		// exists); the branch still holds the original persisted entry, but agent state now
		// holds only the ephemeral carried copy — never both, and the branch never gains a
		// new entry for it.
		expect(branchOccurrences).toBe(1);
		expect(stateOccurrences).toBe(1);

		// A second compaction (new content first, since an already-compacted leaf rejects an
		// immediate re-compact) must not accumulate duplicates: each compaction fully replaces
		// agent.state.messages before re-deriving carry-forward from the persisted branch.
		harness.setResponses([fauxAssistantMessage("b2")]);
		await harness.session.prompt("/skill:skill-b more-args"); // new content (changed args, not a dedup hit)
		await harness.session.compact();

		const stateOccurrencesAfter = harness.session.messages.filter((m) =>
			getMessageText(m).includes("Skill A instructions."),
		).length;
		expect(stateOccurrencesAfter).toBe(1);
	});
});

describe("A.6 resume/branch reconstruction (AC5)", () => {
	it("resume: reconstruction is side-effect-free, restores the carried body once, then a re-invocation notes and increments the count by exactly one", async () => {
		const { harness } = await createDedupHarness([A, B], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a");
		harness.setResponses([fauxAssistantMessage("b1")]);
		await harness.session.prompt("/skill:skill-b");
		await harness.session.compact();
		const countBeforeResume = countFor(harness, "skill-a");

		const resumed = resumeSession(harness);

		// Reconstruction is side-effect-free: the count is unchanged before any re-invocation.
		expect(countFor(harness, "skill-a")).toBe(countBeforeResume);
		// The carried body is present exactly once in the resumed agent state...
		const carriedOccurrences = resumed.messages.filter((m) =>
			getMessageText(m).includes("Skill A instructions."),
		).length;
		expect(carriedOccurrences).toBe(1);
		// ...and absent from getBranch() (ephemeral, never persisted).
		const branchOccurrences = harness.sessionManager
			.getBranch()
			.filter(
				(e) =>
					e.type === "message" && "message" in e && getMessageText(e.message).includes("Skill A instructions."),
			).length;
		expect(branchOccurrences).toBe(1); // only the original pre-compaction delivery
	});

	it("resume: re-invoking a carried skill notes and the count increments by exactly one, chaining to a further note", async () => {
		const { harness } = await createDedupHarness([A], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a");
		await harness.session.compact();
		const countBefore = countFor(harness, "skill-a");

		const resumed = resumeSession(harness);
		harness.faux.setResponses([fauxAssistantMessage("resumed-1")]);
		await resumed.prompt("/skill:skill-a");
		const lastUser = resumed.messages.filter((m) => m.role === "user").at(-1);
		expect(lastUser ? isNote(getMessageText(lastUser)) : false).toBe(true);
		expect(countFor(harness, "skill-a")).toBe((countBefore ?? 0) + 1);

		harness.faux.setResponses([fauxAssistantMessage("resumed-2")]);
		await resumed.prompt("/skill:skill-a");
		const lastUser2 = resumed.messages.filter((m) => m.role === "user").at(-1);
		expect(lastUser2 ? isNote(getMessageText(lastUser2)) : false).toBe(true);
	});
});

describe("A.6 navigateTree reconstruction (AC5)", () => {
	it("navigating to the compacted leaf restores the carried body and dedup stays valid", async () => {
		const { harness } = await createDedupHarness([A], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a");
		await harness.session.compact();
		const compactedLeaf = harness.sessionManager.getLeafId();
		expect(compactedLeaf).toBeTruthy();

		// Navigate away (to root) then back to the compacted leaf, forcing a rebuild.
		await harness.session.navigateTree(harness.sessionManager.getBranch()[0]!.id);
		await harness.session.navigateTree(compactedLeaf!);

		const carriedOccurrences = harness.session.messages.filter((m) =>
			getMessageText(m).includes("Skill A instructions."),
		).length;
		expect(carriedOccurrences).toBe(1);

		harness.setResponses([fauxAssistantMessage("a2")]);
		await harness.session.prompt("/skill:skill-a");
		expect(isNote(lastUserText(harness))).toBe(true);
	});

	it("navigating to a non-compacted branch clears carried keys (a subsequent invocation re-delivers full)", async () => {
		const { harness } = await createDedupHarness([A], {
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: compactionExtensionFactories,
		});
		harness.setResponses([fauxAssistantMessage("a1")]);
		const rootId = harness.sessionManager.getBranch()[0]?.id;
		await harness.session.prompt("/skill:skill-a");
		await harness.session.compact();

		// Navigate to the root (no compaction on this path): carried state must clear.
		await harness.session.navigateTree(rootId ?? harness.sessionManager.getBranch()[0]!.id);

		harness.setResponses([fauxAssistantMessage("a2")]);
		await harness.session.prompt("/skill:skill-a");
		expect(isNote(lastUserText(harness))).toBe(false);
		expect(lastUserText(harness)).toContain("Skill A instructions.");
	});
});

describe("A.6 malformed metadata (completeness, no false note)", () => {
	it("a malformed newest delivery is terminal: degrades to full delivery, never falling through to the older valid body", async () => {
		const { harness } = await createDedupHarness([A]);
		harness.setResponses([fauxAssistantMessage("a1")]);
		await harness.session.prompt("/skill:skill-a"); // valid full delivery
		const skillId = skillIdFor(harness, "skill-a");

		const errors: string[] = [];
		// _deliverSkillListingDiagnostics buffers until a real onError listener is bound.
		await harness.session.bindExtensions({ onError: (e) => errors.push(e.error) });

		// Hand-craft a torn/malformed entry as the new most-recent candidate.
		harness.sessionManager.appendMessage(
			{
				role: "user",
				content: '<skill name="skill-a" args="">\nSkill A instructions.\n</skill>',
				timestamp: Date.now(),
			},
			{ invocations: [{ skillId, name: "skill-a", args: "", blockStart: 0, blockEnd: 99999 }] },
		);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		harness.setResponses([fauxAssistantMessage("a2")]);
		await harness.session.prompt("/skill:skill-a");

		expect(isNote(lastUserText(harness))).toBe(false);
		expect(lastUserText(harness)).toContain("Skill A instructions.");
		expect(errors.some((message) => message.includes("malformed"))).toBe(true);
	});
});
