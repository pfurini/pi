// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/recall-expand.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
import { describe, expect, it } from "vitest";
import { invalidExpandIndices } from "../../../src/core/fork-builtins/vcc-recall/recall.ts";

describe("invalidExpandIndices", () => {
	it("returns indices that are not in available lineage index set", () => {
		const available = new Set([0, 2, 5]);
		expect(invalidExpandIndices([0, 2], available)).toEqual([]);
		expect(invalidExpandIndices([1, 2, 7], available)).toEqual([1, 7]);
	});

	it("rejects non-integer indices", () => {
		const available = new Set([0, 1, 2]);
		expect(invalidExpandIndices([1.5, 2], available)).toEqual([1.5]);
	});
});
