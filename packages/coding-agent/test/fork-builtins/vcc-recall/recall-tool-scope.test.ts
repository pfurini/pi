// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/recall-tool-scope.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
// The session is in memory: m2 is m1's child, and the leaf stays on m1, so m2 is off the lineage.
import { describe, expect, it } from "vitest";
import { recall, recallTool, sessionOf } from "./session.ts";

const makeSession = () =>
	sessionOf(
		[
			{ id: "m1", message: { role: "user", content: `active lineage token ${"x".repeat(350)} full-content-end` } },
			{ id: "m2", message: { role: "user", content: "off lineage secret" } },
		],
		"m1",
	);

describe("vcc_recall scope", () => {
	it("defaults to active lineage and opts into all-session search explicitly", async () => {
		const session = makeSession();
		const tool = recallTool();

		const lineage = await recall(tool, session, { query: "secret" });
		expect(lineage).toContain("No matches");

		const all = await recall(tool, session, { query: "secret", scope: "all" });
		expect(all).toContain("scope: all");
		expect(all).toContain("off lineage secret");
	});

	it("expands full entries even when the original query is included", async () => {
		const session = makeSession();
		const tool = recallTool();
		const output = await recall(tool, session, { query: "active", expand: [0] });

		expect(output).toContain("#0 [user]");
		expect(output).toContain("full-content-end");
		expect(output).not.toContain("matches");
	});

	it("keeps expand strict by default but allows off-lineage expand with scope all", async () => {
		const session = makeSession();
		const tool = recallTool();

		const lineage = await recall(tool, session, { expand: [1] });
		expect(lineage).toContain("Cannot expand indices outside active lineage: 1");

		const all = await recall(tool, session, { expand: [1], scope: "all" });
		expect(all).toContain("Scope: all");
		expect(all).toContain("#1 [user] off lineage secret");
	});
});
