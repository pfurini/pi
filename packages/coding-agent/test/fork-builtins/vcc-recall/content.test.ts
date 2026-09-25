// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/content.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
import { describe, expect, it } from "vitest";
import { extractToolCallArgsText, textOf, textParts } from "../../../src/core/fork-builtins/vcc-recall/content.ts";

describe("textParts", () => {
	it("returns [] for undefined content", () => {
		expect(textParts(undefined)).toEqual([]);
	});

	it("returns [] for null content", () => {
		expect(textParts(null)).toEqual([]);
	});

	it("wraps string content", () => {
		expect(textParts("hello")).toEqual(["hello"]);
	});

	it("extracts text parts from array content", () => {
		const content = [
			{ type: "text" as const, text: "first" },
			{ type: "toolCall" as const, name: "x", id: "1", arguments: {} },
			{ type: "text" as const, text: "second" },
		];
		expect(textParts(content)).toEqual(["first", "second"]);
	});
});

describe("textOf", () => {
	it("returns empty string for undefined content", () => {
		expect(textOf(undefined)).toBe("");
	});
});

describe("extractToolCallArgsText", () => {
	it("extracts top-level string scalars (e.g. bash command)", () => {
		expect(extractToolCallArgsText({ command: "grep -rn foo src" })).toBe("grep -rn foo src");
	});

	it("extracts strings from array-of-object fields (e.g. edits[])", () => {
		const args = { path: "a.ts", edits: [{ oldText: "old", newText: "new" }] };
		const text = extractToolCallArgsText(args);
		expect(text).toContain("a.ts");
		expect(text).toContain("old");
		expect(text).toContain("new");
	});

	it("ignores non-string scalars (numbers/booleans)", () => {
		expect(extractToolCallArgsText({ limit: 50, verbose: true })).toBe("");
	});

	it("returns '' for missing/invalid args", () => {
		expect(extractToolCallArgsText(undefined)).toBe("");
		expect(extractToolCallArgsText(null)).toBe("");
	});

	it("does not clip on its own — extraction is unbounded; the caller (search-entries.ts) owns the budget", () => {
		const text = extractToolCallArgsText({ content: "x".repeat(10_000) });
		expect(text.length).toBe(10_000);
	});
});
