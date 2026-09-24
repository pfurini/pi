import { describe, expect, it } from "vitest";
import { getBuiltinModel, getBuiltinModels, getBuiltinProviders } from "../src/providers/all.ts";

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

	it("sets every GPT-5.6 and GPT-6 catalog entry to 890k", () => {
		const models = getBuiltinProviders().flatMap((provider) =>
			getBuiltinModels(provider).filter((model) => model.id.startsWith("gpt-5.6") || model.id.startsWith("gpt-6")),
		);
		expect(models).not.toHaveLength(0);
		expect(models.every((model) => model.contextWindow === 890000)).toBe(true);
	});
});
