// Fork-owned: a model's vcc_recall call returns an earlier turn through the real session stack
// (docs/plans/vcc-recall-builtin.plan.md, T2). vcc_recall is a base tool since 2026-09-26 (ADR-0009),
// so the switch is turned on and no extension factory is needed.
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, getMessageText } from "./harness.ts";

afterEach(() => vi.unstubAllEnvs());

describe("vcc_recall built-in", () => {
	it("returns an earlier user turn to the model", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const harness = await createHarness();
		try {
			harness.setResponses([
				fauxAssistantMessage("Noted."),
				fauxAssistantMessage([fauxToolCall("vcc_recall", { query: "cobalt-heron" })], { stopReason: "toolUse" }),
				fauxAssistantMessage("The codename is cobalt-heron."),
			]);

			await harness.session.prompt("Remember the cobalt-heron codename.");
			await harness.session.prompt("What was the codename?");

			const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
			expect(toolResults).toHaveLength(1);
			expect(toolResults[0].toolName).toBe("vcc_recall");
			expect(toolResults[0].isError).toBe(false);
			// #0 is the system message the session persists before the first user turn.
			expect(getMessageText(toolResults[0])).toBe(
				'1 matches for "cobalt-heron":\n\n#1 [user] Remember the cobalt-heron codename.',
			);
			expect(harness.getPendingResponseCount()).toBe(0);
		} finally {
			harness.cleanup();
		}
	});
});
