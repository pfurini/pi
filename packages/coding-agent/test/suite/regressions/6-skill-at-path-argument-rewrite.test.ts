/**
 * Regression for issue #6: a user-supplied skill argument that looks like a
 * repository-relative `@path` was rewritten during rendering as if it were a
 * skill-authored reference, so `/prp-prd @docs/handoff.md` delivered
 * `<skill baseDir>/docs/handoff.md` — a path that does not exist.
 *
 * The render-level contract lives in `test/skill-render.test.ts`; this test
 * pins the symptom the issue reported, the delivered message text.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createSyntheticSourceInfo } from "../../../src/core/source-info.ts";
import type { ResourceLoader } from "../../../src/index.ts";
import { createTestResourceLoader } from "../../utilities.ts";
import { createHarness, getMessageText, type Harness } from "../harness.ts";

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

function createLoader(tempDir: string): ResourceLoader {
	const skillPath = join(tempDir, "SKILL.md");
	writeFileSync(skillPath, "**Input**: $ARGUMENTS");
	return {
		...createTestResourceLoader(),
		getSkills: () => ({
			skills: [
				{
					name: "test",
					description: "Issue 6 skill",
					filePath: skillPath,
					disableModelInvocation: false,
					baseDir: tempDir,
					sourceInfo: createSyntheticSourceInfo(skillPath, {
						source: "local",
						scope: "project",
						origin: "top-level",
						baseDir: tempDir,
					}),
				},
			],
			diagnostics: [],
		}),
	};
}

describe("issue #6 skill @path absolutization rewrites user-supplied arguments", () => {
	it("delivers the user's @path argument exactly as typed", async () => {
		const tempDir = join(tmpdir(), `pi-6-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		tempDirs.push(tempDir);

		const harness = await createHarness({ resourceLoader: createLoader(tempDir) });
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("ok")]);

		await harness.session.prompt("/skill:test @docs/handoff.md");

		const delivered = harness.session.messages
			.filter((message) => message.role === "user")
			.map((message) => getMessageText(message))
			.find((text) => text.includes('<skill name="test"'));

		expect(delivered).toBeDefined();
		expect(delivered).toContain("**Input**: @docs/handoff.md");
		// The skill's own directory must never appear in argument-derived text.
		expect(delivered).not.toContain(join(tempDir, "docs/handoff.md"));
	});
});
