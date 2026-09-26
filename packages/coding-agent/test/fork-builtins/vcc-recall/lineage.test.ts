// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/lineage.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
import { describe, expect, it } from "vitest";
import { getActiveLineageEntryIds } from "../../../src/core/fork-builtins/vcc-recall/lineage.ts";
import { sessionOf } from "./session.ts";

const user = (text: string) => ({ role: "user", content: text, timestamp: 0 });

describe("getActiveLineageEntryIds", () => {
	it("returns the ids of the active branch only", () => {
		const session = sessionOf(
			[
				{ id: "a", message: user("root") },
				{ id: "b", message: user("first try") },
				{ id: "c", parentId: "a", message: user("retry") },
			],
			"c",
		);
		expect([...getActiveLineageEntryIds(session)].sort()).toEqual(["a", "c"]);
	});

	it("falls back to every entry for a session without a leaf", () => {
		const session = sessionOf([
			{ id: "a", message: user("root") },
			{ id: "b", message: user("reply") },
		]);
		session.resetLeaf();
		expect([...getActiveLineageEntryIds(session)].sort()).toEqual(["a", "b"]);
	});
});
