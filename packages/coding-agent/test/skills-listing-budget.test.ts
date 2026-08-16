import { describe, expect, it } from "vitest";
import {
	type BranchEntryLike,
	buildBudgetedListingBlock,
	computeSkillInvocationCounts,
	escapeXml,
	est,
	type ListingBudgetEntry,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	skillListingBudgetCodeUnits,
} from "../src/core/skills/listing-budget.ts";

function makeEntry(overrides: Partial<ListingBudgetEntry> & { listingName: string }): ListingBudgetEntry {
	return {
		description: "",
		location: `/skills/${overrides.listingName}/SKILL.md`,
		isExempt: false,
		invocationCount: 0,
		...overrides,
	};
}

/** Mirrors the production `render()` shape exactly (LISTING_EMIT_LOOP): the documented A.6 emit contract. */
function renderBlock(entries: readonly ListingBudgetEntry[], dropped: readonly boolean[]): string {
	const lines: string[] = [SKILL_LISTING_START_DELIMITER];
	entries.forEach((entryItem, i) => {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(entryItem.listingName)}</name>`);
		if (!dropped[i]) {
			lines.push(`    <description>${escapeXml(entryItem.description)}</description>`);
		}
		lines.push(`    <location>${escapeXml(entryItem.location)}</location>`);
		lines.push("  </skill>");
	});
	lines.push(SKILL_LISTING_END_DELIMITER);
	return lines.join("\n");
}

describe("est", () => {
	it("computes ceil(len / 4) in UTF-16 code units", () => {
		expect(est("")).toBe(0);
		expect(est("abcd")).toBe(1);
		expect(est("abcde")).toBe(2);
	});
});

describe("buildBudgetedListingBlock", () => {
	it("emits every skill at full description when the block fits the budget", () => {
		const entries = [
			makeEntry({ listingName: "alpha", description: "Alpha description." }),
			makeEntry({ listingName: "beta", description: "Beta description." }),
		];
		const expected = renderBlock(entries, [false, false]);

		const result = buildBudgetedListingBlock(entries, est(expected) + 100);

		expect(result.block).toBe(expected);
		expect(result.diagnostics).toEqual([]);
	});

	it("treats undefined as the only passthrough (full emission, no truncation)", () => {
		const entries = [makeEntry({ listingName: "alpha", description: "Alpha description." })];
		const expected = renderBlock(entries, [false]);

		const result = buildBudgetedListingBlock(entries, undefined);

		expect(result.block).toBe(expected);
		expect(result.diagnostics).toEqual([]);
	});

	it("runs the truncation algorithm for a computed B of 0 (not a passthrough)", () => {
		const entries = [makeEntry({ listingName: "alpha", description: "Alpha description that is reasonably long." })];

		const result = buildBudgetedListingBlock(entries, 0);

		expect(result.block).toBe(renderBlock(entries, [true]));
		expect(result.block).not.toContain("<description>");
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.type).toBe("warning");
	});

	it("truncates non-exempt entries in (invocationCount asc, listingName asc) order", () => {
		const alpha = makeEntry({ listingName: "alpha", description: "Y".repeat(200), invocationCount: 0 });
		const beta = makeEntry({ listingName: "beta", description: "Z".repeat(200), invocationCount: 5 });
		const gamma = makeEntry({ listingName: "gamma", description: "Y".repeat(200), invocationCount: 0 });
		const entries = [alpha, beta, gamma];

		// Both count-0 entries (alpha, gamma) must be fully dropped before beta (count 5)
		// is ever touched; alpha (name-asc first among ties) is dropped ahead of gamma.
		const expected = renderBlock(entries, [true, false, true]);
		const budget = est(expected);

		const result = buildBudgetedListingBlock(entries, budget);

		expect(result.block).toBe(expected);
		expect(result.diagnostics).toEqual([]);
	});

	it("trims (not drops) a description that stays >= 64 code units, appending an ellipsis", () => {
		const description = "Q".repeat(300);
		const entries = [makeEntry({ listingName: "solo", description })];
		const full = renderBlock(entries, [false]);
		const budget = est(full) - 30;

		const result = buildBudgetedListingBlock(entries, budget);

		const match = result.block.match(/<description>([\s\S]*?)<\/description>/);
		expect(match).not.toBeNull();
		const finalDescription = match?.[1] ?? "";
		expect(finalDescription.endsWith("…")).toBe(true);
		expect(finalDescription.length).toBeGreaterThanOrEqual(64);
		expect(finalDescription.length).toBeLessThan(description.length);
		expect(est(result.block)).toBeLessThanOrEqual(budget);
		expect(result.diagnostics).toEqual([]);
	});

	it("drops a description below 64 code units into a name+location-only entry", () => {
		const short = makeEntry({ listingName: "short", description: "S".repeat(300), invocationCount: 0 });
		const keep = makeEntry({ listingName: "zzzzz", description: "K".repeat(50), invocationCount: 10 });
		const entries = [short, keep];
		const expected = renderBlock(entries, [true, false]);
		const budget = est(expected);

		const result = buildBudgetedListingBlock(entries, budget);

		expect(result.block).toBe(expected);
		const shortIndex = result.block.indexOf("<name>short</name>");
		const keepIndex = result.block.indexOf("<name>zzzzz</name>");
		expect(result.block.slice(shortIndex, keepIndex)).not.toContain("<description>");
		expect(result.block).toContain(`<description>${"K".repeat(50)}</description>`);
	});

	it("keeps an un-dropped empty description as an empty tag (byte-preserving)", () => {
		const entries = [makeEntry({ listingName: "empty", description: "" })];

		const undefinedResult = buildBudgetedListingBlock(entries, undefined);
		expect(undefinedResult.block).toContain("<description></description>");

		const generousResult = buildBudgetedListingBlock(entries, 100_000);
		expect(generousResult.block).toContain("<description></description>");
	});

	it("drops an empty description under a tight budget and terminates", () => {
		const entries = [makeEntry({ listingName: "empty", description: "" })];

		const result = buildBudgetedListingBlock(entries, 0);

		expect(result.block).toBe(renderBlock(entries, [true]));
		expect(result.block).not.toContain("<description>");
	});

	it("escapes XML special characters in the full (untruncated) render", () => {
		const description = `<tag> & "quoted" 'apos'`;
		const entries = [makeEntry({ listingName: "esc", description })];
		const expected = renderBlock(entries, [false]);

		const result = buildBudgetedListingBlock(entries, undefined);

		expect(result.block).toBe(expected);
		expect(result.block).toContain("&lt;tag&gt; &amp; &quot;quoted&quot; &apos;apos&apos;");
	});

	it("keeps XML escaping correct after truncation shrinks an escaped description", () => {
		const description = `<tag> & "quoted" 'apos' ${"X".repeat(200)}`;
		const entries = [makeEntry({ listingName: "esc", description })];
		const full = renderBlock(entries, [false]);
		const budget = est(full) - 20;

		const result = buildBudgetedListingBlock(entries, budget);

		const match = result.block.match(/<description>([\s\S]*?)<\/description>/);
		expect(match).not.toBeNull();
		const escapedDescription = match?.[1] ?? "";
		expect(escapedDescription).not.toMatch(/[<>]/);
		expect(escapedDescription.endsWith("…")).toBe(true);
	});

	it("produces exact bytes for a full non-ASCII description (emoji + CJK)", () => {
		const description = "😀你好世界";
		const entries = [makeEntry({ listingName: "intl", description })];
		const expected = renderBlock(entries, [false]);

		const result = buildBudgetedListingBlock(entries, undefined);

		expect(result.block).toBe(expected);
	});

	it("drops a non-ASCII description exceeding the budget without corrupting a surrogate pair", () => {
		const description = "😀".repeat(50);
		const entries = [makeEntry({ listingName: "intl", description })];

		const result = buildBudgetedListingBlock(entries, 0);

		expect(result.block).toBe(renderBlock(entries, [true]));
	});

	it("truncates a non-ASCII description at a UTF-16 code-unit boundary (surrogate-pair splitting is spec-faithful)", () => {
		const description = `${"😀".repeat(50)}${"你好世界".repeat(20)}`;
		const entries = [makeEntry({ listingName: "intl", description })];
		const full = renderBlock(entries, [false]);
		const budget = est(full) - 20;

		const result = buildBudgetedListingBlock(entries, budget);

		const match = result.block.match(/<description>([\s\S]*?)<\/description>/);
		expect(match).not.toBeNull();
		expect(match?.[1]?.endsWith("…")).toBe(true);
		expect(est(result.block)).toBeLessThanOrEqual(budget);
	});

	it("touches an exempt entry only after every non-exempt entry is exhausted", () => {
		const exempt = makeEntry({ listingName: "exempt", description: "E".repeat(70), isExempt: true });
		const nonExempt = makeEntry({ listingName: "regular", description: "N".repeat(300), isExempt: false });
		const entries = [nonExempt, exempt];

		// Dropping nonExempt alone must already satisfy the budget, so exempt never loses
		// so much as a byte, even though it has the shorter original description.
		const expected = renderBlock(entries, [true, false]);
		const budget = est(expected);

		const result = buildBudgetedListingBlock(entries, budget);

		expect(result.block).toBe(expected);
		expect(result.block).toContain(`<description>${"E".repeat(70)}</description>`);
	});

	it("still emits every name+location skeleton entry when the skeleton alone exceeds the budget, with one diagnostic", () => {
		const entries = Array.from({ length: 20 }, (_, i) =>
			makeEntry({ listingName: `skill-${i}`, description: "D".repeat(500) }),
		);

		const result = buildBudgetedListingBlock(entries, 1);

		for (const entryItem of entries) {
			expect(result.block).toContain(`<name>${entryItem.listingName}</name>`);
			expect(result.block).toContain(`<location>${entryItem.location}</location>`);
		}
		expect(result.block).not.toContain("<description>");
		expect(result.block.startsWith(SKILL_LISTING_START_DELIMITER)).toBe(true);
		expect(result.block.endsWith(SKILL_LISTING_END_DELIMITER)).toBe(true);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]?.type).toBe("warning");
		expect(result.diagnostics[0]?.path).toBeUndefined();
		expect(result.diagnostics[0]?.message).toContain("budget");
	});
});

describe("computeSkillInvocationCounts", () => {
	it("counts a synthetic pair once and combines it with a separate message-block entry for the same skill", () => {
		const entries: BranchEntryLike[] = [
			{ type: "message", pairId: "p1", invocations: [{ skillId: "review" }] },
			{ type: "message", pairId: "p1", invocations: [{ skillId: "review" }] },
			{ type: "message", invocations: [{ skillId: "review" }] },
		];

		const counts = computeSkillInvocationCounts(entries);

		expect(counts.get("review")).toBe(2);
	});

	it("does not throw on malformed persisted metadata and skips it", () => {
		const entries = [
			{ type: "message", invocations: {} },
			{ type: "message", invocations: [null] },
			{ type: "message", invocations: [{}] },
		] as unknown as BranchEntryLike[];

		expect(() => computeSkillInvocationCounts(entries)).not.toThrow();
		expect(computeSkillInvocationCounts(entries).size).toBe(0);
	});

	it("counts a fork-style genuine entry (single entry, no pairId) once", () => {
		const entries: BranchEntryLike[] = [{ type: "message", invocations: [{ skillId: "deploy" }] }];

		expect(computeSkillInvocationCounts(entries).get("deploy")).toBe(1);
	});
});

describe("skillListingBudgetCodeUnits", () => {
	it("returns undefined for a non-positive context window", () => {
		expect(skillListingBudgetCodeUnits(0, 0.01)).toBeUndefined();
		expect(skillListingBudgetCodeUnits(-100, 0.01)).toBeUndefined();
	});

	it("returns a real numeric budget for a positive window, even when it floors to 0", () => {
		expect(skillListingBudgetCodeUnits(50, 0.01)).toBe(0);
		expect(skillListingBudgetCodeUnits(100_000, 0.01)).toBe(1000);
	});
});
