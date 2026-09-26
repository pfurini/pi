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

test("the rules cover other projects, the direct database fallback and subagents", () => {
	const block = buildRulesBlock();
	expect(block).toContain("Pass `project` to query\nanother repository that holds `.tokensave/`.");
	expect(block).toContain("`<root>/.tokensave/tokensave.db` directly, read-only");
	expect(block).toContain(
		"Do not spawn a subagent for codebase research, exploration or analysis of a\nrepository that TokenSave has indexed",
	);
	expect(block).toContain("<!-- pi-tokensave:version=4 -->");
});
