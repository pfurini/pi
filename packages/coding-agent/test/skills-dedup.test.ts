/**
 * A.6 re-invocation dedup (c4b): pure identity + last-full-inline-delivery
 * scan tests against `dedup.ts`, independent of `AgentSession`.
 */

import { describe, expect, it } from "vitest";
import type { BranchEntryLike } from "../src/core/skills/dedup.ts";
import { findLastFullInlineDelivery, isDedupHit } from "../src/core/skills/dedup.ts";
import { buildSkillMessageBlock } from "../src/core/skills/delivery.ts";

function messageBlockEntry(
	id: string,
	skillId: string,
	name: string,
	args: string,
	body: string,
	options: { prefix?: string; suffix?: string; fork?: true } = {},
): BranchEntryLike {
	const block = buildSkillMessageBlock(
		{ invocationId: "inv", skillId, name, baseDir: "/s", filePath: "/s/SKILL.md", args },
		body,
	);
	const prefix = options.prefix ?? "";
	const suffix = options.suffix ?? "";
	const text = `${prefix}${block.text}${suffix}`;
	return {
		id,
		type: "message",
		message: { role: "user", content: text },
		invocations: [
			{
				skillId,
				args,
				blockStart: prefix.length,
				blockEnd: prefix.length + block.text.length,
				...(options.fork && { fork: true }),
			},
		],
	};
}

function toolResultEntry(
	id: string,
	skillId: string,
	args: string,
	body: string,
	options: { fork?: true } = {},
): BranchEntryLike {
	return {
		id,
		type: "message",
		message: { role: "toolResult", content: body },
		invocations: [{ skillId, args, blockStart: 0, blockEnd: body.length, ...(options.fork && { fork: true }) }],
	};
}

function noteEntry(id: string, skillId: string, args: string): BranchEntryLike {
	return {
		id,
		type: "message",
		message: {
			role: "user",
			content: `Skill "${skillId}" is already loaded; its instructions remain in context above.`,
		},
		invocations: [{ skillId, args, blockStart: 0, blockEnd: 0 }],
	};
}

describe("findLastFullInlineDelivery", () => {
	it("finds the last delivery of the skill (message-block)", () => {
		const entries = [messageBlockEntry("e1", "/s/SKILL.md", "simplify", "x", "Body one.")];
		const result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(result).toEqual({ kind: "found", args: "x", body: "Body one." });
	});

	it("recovers a byte-exact bare body from a tool-result entry (no wrapper)", () => {
		const entries = [toolResultEntry("e1", "/s/SKILL.md", "x", "Bare tool body.")];
		const result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(result).toEqual({ kind: "found", args: "x", body: "Bare tool body." });
	});

	it("recovers a byte-exact bare body from a mid-prompt composed block at a non-zero offset", () => {
		const entries = [
			messageBlockEntry("e1", "/s/SKILL.md", "simplify", "x", "Composed body.", { prefix: "Leading text. " }),
		];
		const result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(result).toEqual({ kind: "found", args: "x", body: "Composed body." });
	});

	it("returns absent when the skill was never delivered", () => {
		const entries = [messageBlockEntry("e1", "/other/SKILL.md", "other", "x", "Body.")];
		expect(findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md")).toEqual({ kind: "absent" });
	});

	it("anchors on the LAST delivery of the skill: A(args) -> B(args) -> A(args) anchors on B, not the first A", () => {
		const entries = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "same-args", "Body A (first)."),
			messageBlockEntry("e2", "/s/SKILL.md", "s", "same-args", "Body B (middle)."),
			messageBlockEntry("e3", "/s/SKILL.md", "s", "same-args", "Body A again (last)."),
		];
		const result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(result).toEqual({ kind: "found", args: "same-args", body: "Body A again (last)." });
	});

	it("skips a fork:true entry as an anchor, falling through to an older inline delivery", () => {
		const entries = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Inline body."),
			toolResultEntry("e2", "/s/SKILL.md", "x", '{"agentId":"a1"}', { fork: true }),
		];
		const result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(result).toEqual({ kind: "found", args: "x", body: "Inline body." });
	});

	it("skips an empty-offset (dedup note) entry as an anchor, falling through to the last full delivery", () => {
		const entries = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Full body."),
			noteEntry("e2", "/s/SKILL.md", "x"),
		];
		const result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(result).toEqual({ kind: "found", args: "x", body: "Full body." });
	});

	it("invalidates when the anchor is before the compaction boundary", () => {
		const entries = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Dropped body."),
			{ id: "boundary", type: "message", message: { role: "user", content: "kept" } } satisfies BranchEntryLike,
		];
		expect(findLastFullInlineDelivery(entries, "boundary", "/s/SKILL.md")).toEqual({ kind: "absent" });
	});

	it("keeps an anchor at/after the boundary (inclusive)", () => {
		const entries = [
			{ id: "before", type: "message", message: { role: "user", content: "x" } } satisfies BranchEntryLike,
			messageBlockEntry("boundary", "/s/SKILL.md", "s", "x", "Kept body."),
		];
		expect(findLastFullInlineDelivery(entries, "boundary", "/s/SKILL.md")).toEqual({
			kind: "found",
			args: "x",
			body: "Kept body.",
		});
	});

	it("reports malformed for out-of-range offsets, emitting a diagnostic and never throwing", () => {
		const entries: BranchEntryLike[] = [
			{
				id: "e1",
				type: "message",
				message: { role: "user", content: "short" },
				invocations: [{ skillId: "/s/SKILL.md", args: "x", blockStart: 0, blockEnd: 9999 }],
			},
		];
		const diagnostics: unknown[] = [];
		let result: ReturnType<typeof findLastFullInlineDelivery> | undefined;
		expect(() => {
			result = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md", (d) => diagnostics.push(d));
		}).not.toThrow();
		expect(result).toEqual({ kind: "malformed" });
		expect(diagnostics).toHaveLength(1);
	});

	it("terminal malformed newest anchor never falls through to an older valid delivery", () => {
		const entries: BranchEntryLike[] = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Older valid body."),
			{
				id: "e2",
				type: "message",
				message: { role: "user", content: "torn" },
				invocations: [{ skillId: "/s/SKILL.md", args: "x", blockStart: 0, blockEnd: 9999 }],
			},
		];
		expect(findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md")).toEqual({ kind: "malformed" });
	});

	it("treats a reversed newest offset as malformed (terminal), not an empty marker", () => {
		const entries: BranchEntryLike[] = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Older valid body."),
			{
				id: "e2",
				type: "message",
				message: { role: "user", content: "torn" },
				invocations: [{ skillId: "/s/SKILL.md", args: "x", blockStart: 3, blockEnd: 1 }],
			},
		];
		const diagnostics: unknown[] = [];
		expect(findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md", (d) => diagnostics.push(d))).toEqual({
			kind: "malformed",
		});
		expect(diagnostics).toHaveLength(1);
	});

	it("skips a null invocation element without throwing, falling through to a valid delivery", () => {
		const entries: BranchEntryLike[] = [
			messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Valid body."),
			{
				id: "e2",
				type: "message",
				message: { role: "user", content: "corrupt" },
				invocations: [null] as unknown as BranchEntryLike["invocations"],
			},
		];
		expect(() => findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md")).not.toThrow();
		expect(findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md")).toEqual({
			kind: "found",
			args: "x",
			body: "Valid body.",
		});
	});
});

describe("isDedupHit", () => {
	it("is byte-identical strict equality", () => {
		expect(isDedupHit("same", "same")).toBe(true);
		expect(isDedupHit("same", "different")).toBe(false);
		expect(isDedupHit("Same", "same")).toBe(false);
	});
});

describe("dedup tuple comparison (caller invariant)", () => {
	it("a tuple change (args or body) misses even when the skill matches", () => {
		const entries = [messageBlockEntry("e1", "/s/SKILL.md", "s", "x", "Body.")];
		const anchor = findLastFullInlineDelivery(entries, undefined, "/s/SKILL.md");
		expect(anchor.kind).toBe("found");
		if (anchor.kind !== "found") throw new Error("unreachable");
		// Changed args: not a hit even though skillId matched.
		expect(anchor.args === "y").toBe(false);
		// Changed rendered body (fixed args): not a hit.
		expect(isDedupHit("Different body.", anchor.body)).toBe(false);
		// Identical tuple: a hit.
		expect(anchor.args === "x" && isDedupHit("Body.", anchor.body)).toBe(true);
	});
});
