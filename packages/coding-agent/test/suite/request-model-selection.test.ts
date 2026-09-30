/**
 * The model each request goes to, where main's request preparation (virtual models) meets the
 * fork's skill turn overrides: a model an extension selects at `turn_start` applies to that
 * request, and virtual routing classifies a synthetic skill submission (A.4) as a user turn.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

const MODELS = [{ id: "small" }, { id: "large" }];

describe("request model selection", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const harness of harnesses.splice(0)) harness.cleanup();
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	it("sends the request to a model an extension selects at turn_start", async () => {
		const dispatched: string[] = [];
		const harness = await createHarness({
			models: MODELS,
			extensionFactories: [
				(pi) => {
					pi.on("turn_start", async (_event, ctx) => {
						const large = ctx.modelRegistry.find("faux", "large");
						if (large) await pi.setModel(large);
					});
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			(_context, _options, _state, model) => {
				dispatched.push(model.id);
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("go");

		expect(dispatched).toEqual(["large"]);
	});

	it("routes a skill delivered as a synthetic pair as a user turn", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-request-model-"));
		tempDirs.push(dir);
		const filePath = join(dir, "SKILL.md");
		writeFileSync(filePath, "Answer with the model the router picks for user requests.");
		const reasons: string[] = [];
		const extensionsResult = await createTestExtensionsResult(
			[
				(pi) =>
					pi.registerVirtualModel({
						provider: "router",
						id: "auto",
						name: "Auto",
						route(request, ctx) {
							reasons.push(request.reason);
							const model = ctx.modelRegistry.find("faux", request.reason === "user" ? "large" : "small");
							if (!model) throw new Error("faux model missing");
							return { model, thinkingLevel: "off" };
						},
					}),
			],
			dir,
		);
		const resourceLoader: ResourceLoader = {
			...createTestResourceLoader({ extensionsResult }),
			getSkills: () => ({
				diagnostics: [],
				skills: [
					{
						name: "routed",
						description: "routed skill",
						filePath,
						baseDir: dir,
						disableModelInvocation: false,
						sourceInfo: createSyntheticSourceInfo(filePath, { source: "local" }),
						// The skill's turn goes to the virtual model.
						frontmatter: { model: "router/auto" },
					},
				],
			}),
		};
		const harness = await createHarness({ models: MODELS, resourceLoader });
		harnesses.push(harness);
		// A model that replays synthetic pairs, so the skill arrives with no user message.
		harness.session.agent.state.model = { ...harness.getModel(), syntheticToolResultReplay: true };
		harness.setResponses([fauxAssistantMessage("done")]);

		await harness.session.prompt("/skill:routed");

		expect(harness.session.messages.map((message) => message.role)).not.toContain("user");
		expect(reasons).toEqual(["user"]);
		expect(harness.session.messages.at(-1)).toMatchObject({ role: "assistant", model: "large" });
	});
});
