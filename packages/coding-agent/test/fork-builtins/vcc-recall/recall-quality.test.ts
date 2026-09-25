// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/recall-quality.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
import { describe, expect, it } from "vitest";
import { recall, recallTool, sessionOf } from "./session.ts";

// ── Helpers (mirrors recall-tool-scope.test.ts) ──────────────────────────

const makeSession = (n: number, textOf: (i: number) => string) =>
	sessionOf(Array.from({ length: n }, (_, i) => ({ id: `m${i}`, message: { role: "user", content: textOf(i) } })));

describe("vcc_recall pagination and hard-cap truncation signaling", () => {
	it("reports a capped page count and an explicit truncation message when raw hits exceed the cap", async () => {
		// "." makes this a regex-mode query, matching every one of the 60
		// messages deterministically (no BM25/floor involved) — isolates the
		// hard cap's effect on the tool-facing header/footer.
		const session = makeSession(60, (i) => `zebra_query_tag entry number ${i}`);
		const tool = recallTool();
		const output = await recall(tool, session, { query: "zebra_query_tag.*entry" });

		// 60 raw matches capped to 50 → 10 pages of 5.
		expect(output).toContain("Page 1/10");
		expect(output).toContain("50 total matches");
		// Truthful truncation signal: must not claim 50 is the whole story.
		// Neutral wording ("showing", not "showing top") — this is the regex
		// path, which has no relevance ranking, so "top" would be a false claim.
		expect(output).toContain("showing 50 of 60 matches");
		expect(output).not.toContain("showing top");
		expect(output).toContain("refine your query");
	});

	it("does not show a truncation message when raw hits are under the cap", async () => {
		const session = makeSession(3, (i) => `zebra_query_tag entry number ${i}`);
		const tool = recallTool();
		const output = await recall(tool, session, { query: "zebra_query_tag.*entry" });

		expect(output).toContain("3 matches");
		expect(output).not.toContain("showing");
		expect(output).not.toContain("refine your query");
	});

	it("reports an explicit out-of-range page instead of a false 'no matches' when hits exist but the page isn't reachable", async () => {
		// 60 raw matches capped to 50 → pages 1-10 exist. Page 11 has no rows to
		// slice, but hits.length (50) is > 0 — must not claim "No matches".
		const session = makeSession(60, (i) => `zebra_query_tag entry number ${i}`);
		const tool = recallTool();
		const output = await recall(tool, session, { query: "zebra_query_tag.*entry", page: 11 });

		expect(output).toContain("Page 11 is outside the available range 1-10");
		expect(output).toContain("50 matches");
		expect(output).not.toContain("No matches");
		// Cosmetic: this result IS truncated, so "refine your query" comes
		// once from the truncation note — the out-of-range guidance must not
		// repeat it.
		expect(output.match(/refine your query/g)?.length).toBe(1);
	});

	it("keeps normal zero-hit behavior unchanged for an out-of-range page with no matches at all", async () => {
		const session = makeSession(3, (i) => `entry number ${i}`);
		const tool = recallTool();
		const output = await recall(tool, session, { query: "NO_SUCH_MARKER_ANYWHERE", page: 5 });

		expect(output).toContain("No matches");
		expect(output).not.toContain("is outside the available range");
	});

	it("suggests refining the query (once) for an out-of-range page on a NON-truncated result set", async () => {
		// 12 raw hits, all under the cap (not truncated) — no truncation note to
		// already say "refine your query", so the out-of-range guidance must
		// supply it, exactly once. totalPages = ceil(12/5) = 3; page 5 is out of range.
		const session = makeSession(12, (i) => `zebra_query_tag entry number ${i}`);
		const tool = recallTool();
		const output = await recall(tool, session, { query: "zebra_query_tag.*entry", page: 5 });

		expect(output).toContain("Page 5 is outside the available range 1-3");
		expect(output).toContain("12 matches");
		expect(output).not.toContain("No matches");
		expect(output).not.toContain("showing"); // not truncated — no truncation note at all
		expect(output.match(/refine your query/g)?.length).toBe(1);
	});
});
