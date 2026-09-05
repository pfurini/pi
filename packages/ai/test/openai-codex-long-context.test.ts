import { describe, expect, it } from "vitest";
import { getBuiltinModel } from "../src/providers/all.ts";

const LONG_CONTEXT_MODEL_IDS = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra"] as const;

describe("Codex long-context models", () => {
	it.each(LONG_CONTEXT_MODEL_IDS)("uses the Codex subscription context window for %s", (modelId) => {
		// Deliberately above Codex's 272k default catalog limit, so Pi compacts well below the
		// observed subscription overflow point. See generate-models.ts CODEX_LONG_CONTEXT.
		expect(getBuiltinModel("openai-codex", modelId).contextWindow).toBe(875000);
		expect(getBuiltinModel("openai", modelId).contextWindow).toBe(272000);
	});
});
