import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("export HTML skill block rendering", () => {
	const templateJs = readFileSync(new URL("../src/core/export-html/template.js", import.meta.url), "utf-8");

	it("strips skill wrapper XML from user message rendering", () => {
		// Skill commands store a structural wrapper in the raw user message:
		//   <skill name="..." location="...">\n...\n</skill>\n\nactual prompt
		// The export renderer must detect that wrapper and render only the user-visible prompt,
		// not the Pi-generated <skill>...</skill> XML tags.
		expect(templateJs).toMatch(/parseSkillBlock/);
		expect(templateJs).toMatch(/skillBlock\.userMessage/);
	});

	it("renders skill invocation and user message as separate sibling blocks", () => {
		// The skill block and user message should render as separate entry-level elements,
		// matching the TUI layout where SkillInvocationMessageComponent and
		// UserMessageComponent are siblings, not nested.
		expect(templateJs).toMatch(/skill-invocation/);

		// When a skill block has a userMessage, the user-message div must be emitted
		// as a separate block after the skill-invocation div, containing the user-authored text.
		// Verify the code checks hasUserContent so the user-message div is only omitted
		// when the skill block has no user prompt and no images.
		expect(templateJs).toMatch(/hasUserContent/);
	});

	it("renders skill content as markdown, not raw text", () => {
		// The skill block body is markdown (from the SKILL.md file).
		// It should be rendered through safeMarkedParse, not escaped as raw text.
		expect(templateJs).toMatch(/safeMarkedParse\(skillBlock\.content\)/);
	});

	it("shows skill name and user message in the sidebar tree", () => {
		// The sidebar tree should display both the skill name and the user prompt,
		// not just one or the other.
		expect(templateJs).toMatch(/tree-role-skill/);
	});
});

describe("export HTML B.12 metadata-first rendering (C1c)", () => {
	const templateJs = readFileSync(new URL("../src/core/export-html/template.js", import.meta.url), "utf-8");

	// Extract the self-contained pure slicer for behavioral tests.
	function loadSlicer(): (
		text: string,
		invocations: Array<{ name: string; blockStart: number; blockEnd: number }>,
	) => Array<{ type: string; text?: string; content?: string; invocation?: unknown }> | null {
		const match = templateJs.match(/function sliceSkillInvocations\(text, invocations\) \{[\s\S]*?\n {6}\}/);
		expect(match).toBeTruthy();
		return new Function(`"use strict"; ${match![0]}; return sliceSkillInvocations;`)() as ReturnType<
			typeof loadSlicer
		>;
	}

	it("consults the metadata branch before the legacy parser in both consumers", () => {
		// Tree view and transcript view: the Array.isArray(entry.invocations)
		// guard must precede the parseSkillBlock fallback so a present field wins
		// even over conflicting legacy-shaped XML text.
		const treeBranch = templateJs.indexOf("if (Array.isArray(entry.invocations))");
		expect(treeBranch).toBeGreaterThan(-1);
		const transcriptGuard = templateJs.indexOf("if (Array.isArray(entry.invocations))", treeBranch + 1);
		expect(transcriptGuard).toBeGreaterThan(-1);
		// Both guards come before their respective legacy parseSkillBlock calls.
		const firstParser = templateJs.indexOf("parseSkillBlock(rawContent)");
		expect(treeBranch).toBeLessThan(firstParser);
		const secondParser = templateJs.indexOf("const skillBlock = parseSkillBlock(text);");
		expect(transcriptGuard).toBeLessThan(secondParser);
	});

	it("keeps the legacy regex only for absent-metadata messages", () => {
		expect(templateJs).toMatch(/parseSkillBlock/);
		// Malformed present-metadata renders a diagnostic instead of parsing.
		expect(templateJs).toMatch(/metadata malformed; showing raw message/);
	});

	it("slices multiple blocks by UTF-16 offsets, including astral characters", () => {
		const slice = loadSlicer();
		const text = `pre 💡 <skill name="a" args="">A</skill> mid <skill name="b" args="x">B</skill> post`;
		const startA = text.indexOf("<skill");
		const endA = text.indexOf("</skill>", startA) + 8;
		const startB = text.indexOf("<skill", endA);
		const endB = text.indexOf("</skill>", startB) + 8;
		const segments = slice(text, [
			{ name: "a", blockStart: startA, blockEnd: endA },
			{ name: "b", blockStart: startB, blockEnd: endB },
		]);
		expect(segments).toEqual([
			{ type: "text", text: "pre 💡 " },
			{
				type: "block",
				invocation: { name: "a", blockStart: startA, blockEnd: endA },
				content: '<skill name="a" args="">A</skill>',
			},
			{ type: "text", text: " mid " },
			{
				type: "block",
				invocation: { name: "b", blockStart: startB, blockEnd: endB },
				content: '<skill name="b" args="x">B</skill>',
			},
			{ type: "text", text: " post" },
		]);
	});

	it("returns null for malformed metadata so consumers render plain text plus a diagnostic", () => {
		const slice = loadSlicer();
		expect(slice("text", [{ name: "a", blockStart: 2, blockEnd: 99 }])).toBeNull();
		expect(slice("text", [{ name: "a", blockStart: 3, blockEnd: 1 }])).toBeNull();
		expect(slice("text", [{ name: "a", blockStart: -1, blockEnd: 2 }])).toBeNull();
		expect(
			slice("text", [
				{ name: "a", blockStart: 1, blockEnd: 3 },
				{ name: "b", blockStart: 2, blockEnd: 4 },
			]),
		).toBeNull();
	});
});
