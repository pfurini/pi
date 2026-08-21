/**
 * C3c A.6 `paths` listing boost end-to-end through AgentSession with the faux provider:
 * a successful read/edit/write tool call touching a path matching a skill's `paths` glob
 * boosts that skill to the front of the emitted listing at the NEXT user prompt (the
 * `_promptInScope` dirty-triggered rebuild boundary), never mid-turn, and never invokes
 * the skill. Failed tool calls do not feed the window; the window trims to
 * `skillPathsWindow` (chronological last-N, no dedup).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/core/settings-manager.ts";
import { extractSkillListingBlock } from "../../src/core/skills/listing.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

interface SkillFixture {
	name: string;
	body: string;
	frontmatter?: Record<string, unknown>;
}

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

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-c3c-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
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
			...(fixture.frontmatter &&
				Object.keys(fixture.frontmatter).length > 0 && { frontmatter: fixture.frontmatter }),
		};
	});
	return {
		...createTestResourceLoader(),
		getSkills: () => ({ skills, diagnostics: [] }),
	};
}

async function createPathsHarness(fixtures: SkillFixture[], settings?: Partial<Settings>): Promise<Harness> {
	const tempDir = makeTempDir();
	const harness = await createHarness({
		models: [{ id: "session-model" }],
		resourceLoader: createSkillsLoader(tempDir, fixtures),
		settings,
	});
	harnesses.push(harness);
	return harness;
}

function listingNamesInOrder(systemPrompt: string): string[] {
	const block = extractSkillListingBlock(systemPrompt);
	if (!block) return [];
	return [...block.matchAll(/<name>([^<]*)<\/name>/g)].map((match) => match[1]);
}

describe("C3c paths boost: end-to-end", () => {
	it("boosts a touched skill to the front at the next prompt only, without invoking it", async () => {
		const harness = await createPathsHarness([
			{ name: "aaa-plain", body: "plain body" },
			{ name: "zzz-api", frontmatter: { paths: ["src/api/**"] }, body: "api body" },
		]);
		mkdirSync(join(harness.tempDir, "src", "api"), { recursive: true });
		writeFileSync(join(harness.tempDir, "src", "api", "foo.ts"), "export {};");

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "src/api/foo.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("first done"),
		]);
		await harness.session.prompt("start");

		// The touch happened during this turn; its listing was already built before the
		// touch, so ordering is unaffected mid-turn.
		expect(listingNamesInOrder(harness.session.systemPrompt)).toEqual(["aaa-plain", "zzz-api"]);

		harness.setResponses([fauxAssistantMessage("second done")]);
		await harness.session.prompt("next");

		// The next prompt rebuilds the base prompt (dirty window), boosting zzz-api first.
		expect(listingNamesInOrder(harness.session.systemPrompt)).toEqual(["zzz-api", "aaa-plain"]);

		// Boost is listing-order only: no skill tool call and no skill body was delivered.
		const skillBodyDelivered = harness.session.messages.some(
			(message) =>
				message.role === "user" &&
				typeof message.content !== "string" &&
				JSON.stringify(message.content).includes('<skill name="zzz-api"'),
		);
		expect(skillBodyDelivered).toBe(false);
	});

	it("does not record a failed tool call in the window", async () => {
		const harness = await createPathsHarness([
			{ name: "aaa-neutral", body: "neutral body" },
			{ name: "mmm-readable", frontmatter: { paths: ["ok.ts"] }, body: "readable body" },
			{ name: "zzz-unreadable", frontmatter: { paths: ["missing.ts"] }, body: "unreadable body" },
		]);
		writeFileSync(join(harness.tempDir, "ok.ts"), "export {};");
		harness.session.agent.toolExecution = "sequential";

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "ok.ts" }), fauxToolCall("read", { path: "missing.ts" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("first done"),
		]);
		await harness.session.prompt("start");

		harness.setResponses([fauxAssistantMessage("second done")]);
		await harness.session.prompt("next");

		expect(listingNamesInOrder(harness.session.systemPrompt)).toEqual([
			"mmm-readable",
			"aaa-neutral",
			"zzz-unreadable",
		]);
	});

	it("trims the window to skillPathsWindow (chronological last-N, no dedup)", async () => {
		const harness = await createPathsHarness(
			[
				{ name: "skill-p1", frontmatter: { paths: ["p1.ts"] }, body: "p1 body" },
				{ name: "skill-p2", frontmatter: { paths: ["p2.ts"] }, body: "p2 body" },
				{ name: "skill-p3", frontmatter: { paths: ["p3.ts"] }, body: "p3 body" },
			],
			{ skillPathsWindow: 2 },
		);
		writeFileSync(join(harness.tempDir, "p1.ts"), "one");
		writeFileSync(join(harness.tempDir, "p2.ts"), "two");
		writeFileSync(join(harness.tempDir, "p3.ts"), "three");
		harness.session.agent.toolExecution = "sequential";

		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("read", { path: "p1.ts" }),
					fauxToolCall("read", { path: "p2.ts" }),
					fauxToolCall("read", { path: "p3.ts" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("first done"),
		]);
		await harness.session.prompt("start");

		harness.setResponses([fauxAssistantMessage("second done")]);
		await harness.session.prompt("next");

		// p1 was evicted by the cap-2 window; p2/p3 remain boosted.
		expect(listingNamesInOrder(harness.session.systemPrompt)).toEqual(["skill-p2", "skill-p3", "skill-p1"]);
	});
});
