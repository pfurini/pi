// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/format-recall.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
import { describe, expect, it } from "vitest";
import { formatRecallOutput } from "../../../src/core/fork-builtins/vcc-recall/format-recall.ts";
import type { RenderedEntry } from "../../../src/core/fork-builtins/vcc-recall/render-entries.ts";

describe("formatRecallOutput", () => {
	it("shows no-match message with query", () => {
		const r = formatRecallOutput([], "xyz");
		expect(r).toContain('No matches for "xyz"');
	});

	it("shows no-entries message without query", () => {
		expect(formatRecallOutput([])).toContain("No entries");
	});

	it("formats entries with index and role", () => {
		const entries: RenderedEntry[] = [{ index: 0, role: "user", summary: "hello" }];
		const r = formatRecallOutput(entries);
		expect(r).toContain("#0 [user] hello");
	});

	it("shows match count with query", () => {
		const entries: RenderedEntry[] = [{ index: 2, role: "assistant", summary: "done" }];
		const r = formatRecallOutput(entries, "done");
		expect(r).toContain('Found 1 matches for "done"');
	});
});
