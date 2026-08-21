import { describe, expect, it } from "vitest";
import {
	escapeXml,
	est,
	MAX_LISTING_DESCRIPTION_LENGTH,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	skillListingBudgetCodeUnits,
} from "../../src/harness/listing-budget.ts";
import { formatSkillsForSystemPrompt } from "../../src/harness/system-prompt.ts";
import type { Skill } from "../../src/harness/types.ts";

function skill(overrides: Partial<Skill> & { name: string }): Skill {
	return {
		description: "",
		content: `${overrides.name} content`,
		filePath: `/skills/${overrides.name}/SKILL.md`,
		...overrides,
	};
}

const PREAMBLE = [
	"The following skills provide specialized instructions for specific tasks.",
	"Read the full skill file when the task matches its description.",
	"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
	"",
].join("\n");

/** Mirrors the production budgeted `render()` shape exactly (LISTING_EMIT_LOOP): the documented A.6 emit contract. */
function renderBudgetedBlock(
	entries: readonly { name: string; description: string; filePath: string }[],
	dropped: readonly boolean[],
): string {
	const lines: string[] = [SKILL_LISTING_START_DELIMITER];
	entries.forEach((entryItem, i) => {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(entryItem.name)}</name>`);
		if (!dropped[i]) {
			lines.push(`    <description>${escapeXml(entryItem.description)}</description>`);
		}
		lines.push(`    <location>${escapeXml(entryItem.filePath)}</location>`);
		lines.push("  </skill>");
	});
	lines.push(SKILL_LISTING_END_DELIMITER);
	return lines.join("\n");
}

describe("formatSkillsForSystemPrompt listing budget (c4d)", () => {
	it("is byte-identical to the v1 listing when no options are given", () => {
		const skills = [
			skill({ name: "visible", description: "Use <this> & that" }),
			skill({ name: "hidden", description: "Hidden", disableModelInvocation: true }),
			skill({ name: "second", description: "Second skill" }),
		];
		expect(formatSkillsForSystemPrompt(skills)).toBe(
			`${PREAMBLE}\n` +
				"<available_skills>\n" +
				"  <skill>\n" +
				"    <name>visible</name>\n" +
				"    <description>Use &lt;this&gt; &amp; that</description>\n" +
				"    <location>/skills/visible/SKILL.md</location>\n" +
				"  </skill>\n" +
				"  <skill>\n" +
				"    <name>second</name>\n" +
				"    <description>Second skill</description>\n" +
				"    <location>/skills/second/SKILL.md</location>\n" +
				"  </skill>\n" +
				"</available_skills>",
		);
	});

	it("keeps the v1 bytes for a non-positive or omitted context window (unbudgeted passthrough)", () => {
		expect(skillListingBudgetCodeUnits(0, 0.01)).toBeUndefined();
		expect(skillListingBudgetCodeUnits(-100, 0.01)).toBeUndefined();
		const skills = [skill({ name: "alpha", description: "Alpha" })];
		const unbudgeted = formatSkillsForSystemPrompt(skills);
		expect(unbudgeted).toContain("<available_skills>\n");
		expect(formatSkillsForSystemPrompt(skills, { contextWindow: 0 })).toBe(unbudgeted);
		expect(formatSkillsForSystemPrompt(skills, { contextWindow: -1 })).toBe(unbudgeted);
	});

	it("emits the byte-exact v2 block name-sorted when a context window is supplied", () => {
		const skills = [
			skill({ name: "zeta", description: "Zeta description." }),
			skill({ name: "alpha", description: "Alpha description." }),
		];
		const sorted = [skills[1]!, skills[0]!];
		const expected = `${PREAMBLE}\n${renderBudgetedBlock(sorted, [false, false])}`;
		// Generous budget: 1,000,000-window × default 0.01 = 10,000 code units.
		expect(formatSkillsForSystemPrompt(skills, { contextWindow: 1_000_000 })).toBe(expected);
	});

	it("produces exact bytes for XML-escaped and non-ASCII descriptions under a budget", () => {
		const skills = [
			skill({ name: "esc", description: `<tag> & "quoted" 'apos'` }),
			skill({ name: "intl", description: "😀你好世界" }),
		];
		const expected = `${PREAMBLE}\n${renderBudgetedBlock(skills, [false, false])}`;
		const result = formatSkillsForSystemPrompt(skills, { contextWindow: 1_000_000 });
		expect(result).toBe(expected);
		expect(result).toContain("&lt;tag&gt; &amp; &quot;quoted&quot; &apos;apos&apos;");
		expect(result).toContain("😀你好世界");
	});

	it("truncates descriptions in listingName asc order (no exemptions, no invocation counts)", () => {
		const alpha = skill({ name: "alpha", description: "A".repeat(200) });
		const beta = skill({ name: "beta", description: "B".repeat(200) });
		const gamma = skill({ name: "gamma", description: "G".repeat(200) });
		const skills = [gamma, alpha, beta];
		const sorted = [alpha, beta, gamma];
		// Name-asc truncation: alpha and beta are dropped before gamma (name-last) is touched.
		const expectedBlock = renderBudgetedBlock(sorted, [true, true, false]);
		const budget = est(expectedBlock);
		// fraction 0.01 with contextWindow = budget × 100 yields B = budget exactly.
		const contextWindow = budget * 100;
		const result = formatSkillsForSystemPrompt(skills, { contextWindow });
		expect(skillListingBudgetCodeUnits(contextWindow, 0.01)).toBe(budget);
		expect(result).toBe(`${PREAMBLE}\n${expectedBlock}`);
	});

	it("drops a description trimmed below 64 code units into a name+location-only entry", () => {
		const short = skill({ name: "short", description: "S".repeat(300) });
		const keep = skill({ name: "zzzzz", description: "K".repeat(50) });
		const skills = [short, keep];
		const expectedBlock = renderBudgetedBlock(skills, [true, false]);
		const budget = est(expectedBlock);
		const contextWindow = budget * 100;
		const result = formatSkillsForSystemPrompt(skills, { contextWindow });
		expect(result).toBe(`${PREAMBLE}\n${expectedBlock}`);
		const shortIndex = result.indexOf("<name>short</name>");
		const keepIndex = result.indexOf("<name>zzzzz</name>");
		expect(result.slice(shortIndex, keepIndex)).not.toContain("<description>");
	});

	it("emits every name+location skeleton entry when the skeleton alone exceeds the budget", () => {
		const skills = Array.from({ length: 20 }, (_, i) =>
			skill({ name: `skill-${String(i).padStart(2, "0")}`, description: "D".repeat(500) }),
		);
		// B floors to 0: every description drops to the skeleton floor.
		const result = formatSkillsForSystemPrompt(skills, { contextWindow: 50 });
		expect(skillListingBudgetCodeUnits(50, 0.01)).toBe(0);
		expect(result).toBe(
			`${PREAMBLE}\n${renderBudgetedBlock(
				skills,
				skills.map(() => true),
			)}`,
		);
		expect(result).not.toContain("<description>");
		for (const s of skills) {
			expect(result).toContain(`<name>${s.name}</name>`);
			expect(result).toContain(`<location>${s.filePath}</location>`);
		}
	});

	it("caps descriptions at the A.6 maximum before budgeting", () => {
		const skills = [skill({ name: "long", description: "L".repeat(MAX_LISTING_DESCRIPTION_LENGTH + 500) })];
		const result = formatSkillsForSystemPrompt(skills, { contextWindow: 1_000_000 });
		expect(result).toContain(`<description>${"L".repeat(MAX_LISTING_DESCRIPTION_LENGTH)}</description>`);
		expect(result).not.toContain("L".repeat(MAX_LISTING_DESCRIPTION_LENGTH + 1));
	});

	it("honors an explicit budgetFraction override", () => {
		const skills = [skill({ name: "alpha", description: "A".repeat(200) })];
		const loose = formatSkillsForSystemPrompt(skills, { contextWindow: 100_000, budgetFraction: 0.5 });
		expect(loose).toContain("A".repeat(200));
		const tight = formatSkillsForSystemPrompt(skills, { contextWindow: 100_000, budgetFraction: 0.000001 });
		expect(tight).not.toContain("<description>");
		expect(tight).toContain("<name>alpha</name>");
	});
});
