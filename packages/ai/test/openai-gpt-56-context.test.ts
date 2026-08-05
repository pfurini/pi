import { describe, expect, it } from "vitest";
import { getBuiltinModel } from "../src/providers/all.ts";

const GPT_56_MODEL_IDS = ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"] as const;

describe("GPT-5.6 context windows", () => {
	it.each(GPT_56_MODEL_IDS)("uses the Codex subscription context window for %s", (modelId) => {
		expect(getBuiltinModel("openai-codex", modelId).contextWindow).toBe(372000);
		expect(getBuiltinModel("openai", modelId).contextWindow).toBe(272000);
	});
});
