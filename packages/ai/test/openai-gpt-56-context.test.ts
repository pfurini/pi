import { describe, expect, it } from "vitest";
import { getBuiltinModel } from "../src/providers/all.ts";

const GPT_56_MODEL_IDS = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"] as const;

describe("GPT-5.6 context windows", () => {
	it.each(GPT_56_MODEL_IDS)("uses the Codex subscription context window for %s", (modelId) => {
		// Deliberately above Codex's 272k default catalog limit, so Pi compacts well below the
		// observed subscription overflow point. See generate-models.ts CODEX_GPT_56_CONTEXT.
		expect(getBuiltinModel("openai-codex", modelId).contextWindow).toBe(875000);
		expect(getBuiltinModel("openai", modelId).contextWindow).toBe(272000);
	});
});
