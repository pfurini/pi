/**
 * The `skill` tool is `model-only`: the model calls it, other tools cannot. A skill invocation
 * activates the skill for the turn and is recorded on the session entry of its result, and a call
 * made through ctx.executeTool() is never persisted. Under codemode `only` mode the tool must stay
 * declared, since codemode hides the `direct` tools scripts can call.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const SENTINEL = "SKILL-BODY-SENTINEL";

describe("skill tool exposure", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const harness of harnesses.splice(0)) harness.cleanup();
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function skillHarness(factories: ExtensionFactory[], options: HarnessOptions = {}): Promise<Harness> {
		const dir = mkdtempSync(join(tmpdir(), "pi-skill-exposure-"));
		tempDirs.push(dir);
		const filePath = join(dir, "SKILL.md");
		writeFileSync(filePath, SENTINEL);
		const extensionsResult = await createTestExtensionsResult(factories, dir);
		const resourceLoader: ResourceLoader = {
			...createTestResourceLoader({ extensionsResult }),
			getSkills: () => ({
				diagnostics: [],
				skills: [
					{
						name: "helper",
						description: "helper skill",
						filePath,
						baseDir: dir,
						disableModelInvocation: false,
						sourceInfo: createSyntheticSourceInfo(filePath, { source: "local" }),
					},
				],
			}),
		};
		const harness = await createHarness({ ...options, resourceLoader });
		harnesses.push(harness);
		return harness;
	}

	it("refuses a skill call made through ctx.executeTool() and does not deliver the skill", async () => {
		const nested: Array<{ isError: boolean; text: string }> = [];
		const harness = await skillHarness([
			(pi) => {
				pi.registerTool({
					name: "run_skill",
					label: "run_skill",
					description: "Invokes a skill through ctx.executeTool(), as a codemode script would.",
					parameters: Type.Object({}),
					execute: async (_id, _params, _signal, _onUpdate, ctx) => {
						const outcome = await ctx.executeTool("skill", { name: "helper" });
						const text = (outcome.result.content[0] as { text: string }).text;
						nested.push({ isError: outcome.isError, text });
						return { content: [{ type: "text", text }], details: {} };
					},
				});
			},
		]);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("run_skill", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		expect(harness.session.getActiveToolNames()).toContain("skill");
		expect(harness.session.getCallableToolNames()).not.toContain("skill");
		await harness.session.prompt("go");

		expect(nested).toHaveLength(1);
		expect(nested[0].isError).toBe(true);
		expect(JSON.stringify(harness.session.messages)).not.toContain(SENTINEL);
	});

	it("keeps the skill tool declared to the model under codemode only mode", async () => {
		const harness = await skillHarness([createCodemodeExtension()], {
			settings: { codemode: { mode: "only" } },
			initialActiveToolNames: ["read", "codemode", "skill"],
		});
		const declared: string[][] = [];
		harness.setResponses([
			(context: TranscriptContext) => {
				declared.push(getCurrentTools(context.messages).map((tool) => tool.name));
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("go");

		// `read` is reachable from codemode scripts, so only mode leaves it out of the declarations.
		expect(declared[0]).toEqual(expect.arrayContaining(["codemode", "skill"]));
		expect(declared[0]).not.toContain("read");
	});
});
