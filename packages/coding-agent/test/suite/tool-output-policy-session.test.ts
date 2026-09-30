/**
 * The fork's central output cap (core/tool-output-policy.ts) bounds what enters context. A call
 * another tool makes through ctx.executeTool() returns to that tool, not into context, so the cap
 * leaves it whole; the calling tool's own result is capped like any other.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { POLICY_NOTICE_PREFIX } from "../../src/core/tool-output-policy.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const FLOOD = Array.from({ length: 3000 }, (_, index) => `line ${index + 1}`).join("\n");

function floodExtension(nestedTexts: string[]) {
	return (pi: ExtensionAPI): void => {
		pi.registerTool({
			name: "flood",
			label: "flood",
			description: "Returns more lines than the output cap allows.",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: FLOOD }], details: {} }),
		});
		pi.registerTool({
			name: "relay",
			label: "relay",
			description: "Calls flood through ctx.executeTool() and returns its output.",
			parameters: Type.Object({}),
			execute: async (_id, _params, _signal, _onUpdate, ctx) => {
				const outcome = await ctx.executeTool("flood", {});
				const text = (outcome.result.content[0] as { text: string }).text;
				nestedTexts.push(text);
				return { content: [{ type: "text", text }], details: {} };
			},
		});
	};
}

describe("tool output cap and nested tool calls", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("caps results that enter context, and hands a nested call's full output to the calling tool", async () => {
		const nestedTexts: string[] = [];
		const harness = await createHarness({
			initialActiveToolNames: [],
			extensionFactories: [floodExtension(nestedTexts)],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("flood", {}), fauxToolCall("relay", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		expect(nestedTexts).toEqual([FLOOD]);
		const results = harness.session.messages.filter(
			(message): message is ToolResultMessage => message.role === "toolResult",
		);
		expect(results.map((result) => result.toolName)).toEqual(["flood", "relay"]);
		for (const result of results) {
			const text = getMessageText(result);
			expect(text).toContain(POLICY_NOTICE_PREFIX);
			expect(text.length).toBeLessThan(FLOOD.length);
		}
	});
});
