import { expect, test } from "vitest";
import { buildRulesBlock } from "../../../src/core/fork-builtins/tokensave/rules.ts";

test("the rules tell the model to fall back when a TokenSave tool is unavailable or blocked", () => {
	const block = buildRulesBlock();
	expect(
		block.includes(
			"When a TokenSave tool is unavailable or\nblocked in the current turn, also use Pi's normal tools directly.",
		),
	).toBeTruthy();
});
