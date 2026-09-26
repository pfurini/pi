import { describe, expect, it } from "vitest";
import { getBuiltinModel } from "../src/providers/all.ts";

const LONG_CONTEXT_MODEL_IDS = [
	"gpt-5.6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-6-astra",
	"gpt-6-luna",
	"gpt-6-sol",
] as const;

describe("Codex long-context models", () => {
	it.each(LONG_CONTEXT_MODEL_IDS)("uses the Codex subscription context window for %s", (modelId) => {
		// The static catalog must outrank pi.dev's stale 272k Codex metadata, so Pi compacts
		// below the observed subscription overflow point.
		expect(getBuiltinModel("openai-codex", modelId).contextWindow).toBe(890000);
		expect(getBuiltinModel("openai", modelId).contextWindow).toBe(890000);
	});

	it("leaves other providers at their own catalog limits", () => {
		// GitHub Copilot advertises 1M for GPT-6 Sol and Luna; model-catalog-types.test.ts asserts it.
		expect(getBuiltinModel("github-copilot", "gpt-6-sol").contextWindow).not.toBe(890000);
		expect(getBuiltinModel("azure-openai-responses", "gpt-5.6-sol").contextWindow).toBe(1050000);
	});
});
