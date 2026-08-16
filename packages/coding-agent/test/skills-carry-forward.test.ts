/**
 * A.6 compaction carry-forward (c4b): pure MRU-first derivation tests against
 * `carry-forward.ts`, independent of `AgentSession`.
 */

import { describe, expect, it } from "vitest";
import { deriveCarriedSkills } from "../src/core/skills/carry-forward.ts";
import type { BranchEntryLike } from "../src/core/skills/dedup.ts";
import { buildSkillMessageBlock } from "../src/core/skills/delivery.ts";

function block(name: string, args: string, body: string): string {
	return buildSkillMessageBlock(
		{ invocationId: "inv", skillId: name, name, baseDir: "/s", filePath: `/s/${name}/SKILL.md`, args },
		body,
	).text;
}

function messageBlockEntry(
	id: string,
	invocations: { skillId: string; args: string; body: string; fork?: true }[],
): BranchEntryLike {
	let text = "";
	const entryInvocations = invocations.map(({ skillId, args, body, fork }) => {
		const blockText = block(skillId, args, body);
		const blockStart = text.length;
		text += blockText;
		return { skillId, args, blockStart, blockEnd: text.length, ...(fork && { fork: true }) };
	});
	return { id, type: "message", message: { role: "user", content: text }, invocations: entryInvocations };
}

function boundaryEntry(id: string): BranchEntryLike {
	return { id, type: "message", message: { role: "assistant", content: "kept" } };
}

describe("deriveCarriedSkills", () => {
	it("returns empty with no compaction boundary (nothing dropped)", () => {
		const entries = [messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "A body." }])];
		const result = deriveCarriedSkills(entries, undefined);
		expect(result).toEqual({ entries: [], keys: new Set(), diagnostics: [] });
	});

	it("carries the most-recent inline body of a dropped skill, MRU-first", () => {
		const entries = [
			messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "A body." }]),
			messageBlockEntry("e2", [{ skillId: "/b/SKILL.md", args: "y", body: "B body." }]),
			boundaryEntry("boundary"),
		];
		const result = deriveCarriedSkills(entries, "boundary");
		expect(result.entries).toEqual([
			{ skillId: "/b/SKILL.md", args: "y", body: "B body." },
			{ skillId: "/a/SKILL.md", args: "x", body: "A body." },
		]);
		expect(result.keys).toEqual(new Set(["/a/SKILL.md", "/b/SKILL.md"]));
	});

	it("one skill invoked with several arg strings around the boundary yields exactly one (newest) carried entry", () => {
		const entries = [
			messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "first", body: "First body." }]),
			messageBlockEntry("e2", [{ skillId: "/a/SKILL.md", args: "second", body: "Second body." }]),
			boundaryEntry("boundary"),
		];
		const result = deriveCarriedSkills(entries, "boundary");
		expect(result.entries).toEqual([{ skillId: "/a/SKILL.md", args: "second", body: "Second body." }]);
	});

	it("a skill whose most-recent inline delivery is after the boundary is not carried (still in context)", () => {
		const entries = [
			messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "Dropped." }]),
			boundaryEntry("boundary"),
			messageBlockEntry("e2", [{ skillId: "/a/SKILL.md", args: "x", body: "Still present." }]),
		];
		const result = deriveCarriedSkills(entries, "boundary");
		expect(result.entries).toEqual([]);
	});

	it("excludes fork:true deliveries (inline-only)", () => {
		const entries = [
			messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "Inline body." }]),
			messageBlockEntry("e2", [{ skillId: "/a/SKILL.md", args: "x", body: '{"agentId":"a1"}', fork: true }]),
			boundaryEntry("boundary"),
		];
		const result = deriveCarriedSkills(entries, "boundary");
		expect(result.entries).toEqual([{ skillId: "/a/SKILL.md", args: "x", body: "Inline body." }]);
	});

	it("recovers a message-block body byte-exact without the wrapper, including a mid-prompt composed block at a non-zero offset", () => {
		const entries: BranchEntryLike[] = [
			{
				id: "e1",
				type: "message",
				message: { role: "user", content: `Leading text. ${block("/a/SKILL.md", "x", "Composed body.")}` },
				invocations: [
					{
						skillId: "/a/SKILL.md",
						args: "x",
						blockStart: "Leading text. ".length,
						blockEnd: "Leading text. ".length + block("/a/SKILL.md", "x", "Composed body.").length,
					},
				],
			},
			boundaryEntry("boundary"),
		];
		const result = deriveCarriedSkills(entries, "boundary");
		expect(result.entries).toEqual([{ skillId: "/a/SKILL.md", args: "x", body: "Composed body." }]);
	});

	describe("budget", () => {
		it("skips a body whose est() exceeds the per-skill budget", () => {
			const entries = [
				messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "x".repeat(4001) }]), // est = 1001 > 1000
				boundaryEntry("boundary"),
			];
			const result = deriveCarriedSkills(entries, "boundary", { perSkill: 1000, total: 25000 });
			expect(result.entries).toEqual([]);
		});

		it("skips-and-continues past a large skill to admit a smaller later one under the combined cap", () => {
			const entries = [
				messageBlockEntry("e1", [{ skillId: "/small/SKILL.md", args: "x", body: "x".repeat(400) }]), // est = 100
				messageBlockEntry("e2", [{ skillId: "/large/SKILL.md", args: "x", body: "x".repeat(4000) }]), // est = 1000 > perSkill
				boundaryEntry("boundary"),
			];
			const result = deriveCarriedSkills(entries, "boundary", { perSkill: 500, total: 25000 });
			expect(result.keys).toEqual(new Set(["/small/SKILL.md"]));
		});

		it("includes a body at exactly the per-skill budget and rejects one code unit over", () => {
			const atLimit = messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "x".repeat(20000) }]); // est = 5000
			const overLimit = messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "x".repeat(20004) }]); // est = 5001
			const boundary = boundaryEntry("boundary");
			expect(deriveCarriedSkills([atLimit, boundary], "boundary").keys).toEqual(new Set(["/a/SKILL.md"]));
			expect(deriveCarriedSkills([overLimit, boundary], "boundary").keys).toEqual(new Set());
		});

		it("includes a running combined total at exactly 25,000 and rejects 25,001", () => {
			// est=5000 each; five skills sum to exactly 25000.
			const bodies = ["a", "b", "c", "d", "e"].map((n) => ({
				skillId: `/${n}/SKILL.md`,
				args: "x",
				body: "x".repeat(20000),
			}));
			const entriesAtLimit = [...bodies.map((b, i) => messageBlockEntry(`e${i}`, [b])), boundaryEntry("boundary")];
			const atLimit = deriveCarriedSkills(entriesAtLimit, "boundary");
			expect(atLimit.keys.size).toBe(5);

			const overBody = { skillId: "/f/SKILL.md", args: "x", body: "x".repeat(20004) }; // est=5001, pushes combined to 25001
			const entriesOverLimit = [
				...bodies.map((b, i) => messageBlockEntry(`e${i}`, [b])),
				messageBlockEntry("e5", [overBody]),
				boundaryEntry("boundary"),
			];
			const overLimit = deriveCarriedSkills(entriesOverLimit, "boundary");
			expect(overLimit.keys.has("/f/SKILL.md")).toBe(false);
			expect(overLimit.keys.size).toBe(5);
		});
	});

	it("same-entry MRU tie: two skills composed into one message resolve by span position (higher blockStart wins under a tight budget)", () => {
		const entries = [
			messageBlockEntry("e1", [
				{ skillId: "/older-span/SKILL.md", args: "x", body: "x".repeat(20000) }, // est=5000, blockStart 0
				{ skillId: "/newer-span/SKILL.md", args: "x", body: "x".repeat(20000) }, // est=5000, later blockStart
			]),
			boundaryEntry("boundary"),
		];
		// Budget admits only one 5000-cost skill.
		const result = deriveCarriedSkills(entries, "boundary", { perSkill: 5000, total: 5000 });
		expect(result.keys).toEqual(new Set(["/newer-span/SKILL.md"]));
	});

	it("a malformed most-recent delivery drops that skill (diagnostic, never an older stale body)", () => {
		const entries: BranchEntryLike[] = [
			messageBlockEntry("e1", [{ skillId: "/a/SKILL.md", args: "x", body: "Older valid body." }]),
			{
				id: "e2",
				type: "message",
				message: { role: "user", content: "torn" },
				invocations: [{ skillId: "/a/SKILL.md", args: "x", blockStart: 0, blockEnd: 9999 }],
			},
			boundaryEntry("boundary"),
		];
		const result = deriveCarriedSkills(entries, "boundary");
		expect(result.entries).toEqual([]);
		expect(result.diagnostics).toHaveLength(1);
	});
});
