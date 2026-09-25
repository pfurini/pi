// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/load-messages.test.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
// The fork reads in-memory entries, so pi-vcc's four file-reader tests are retired and one
// in-memory test replaces them (docs/plans/vcc-recall-builtin.plan.md, T1).
import { describe, expect, it } from "vitest";
import { loadAllMessages } from "../../../src/core/fork-builtins/vcc-recall/load-messages.ts";
import { type FileEntry, SessionManager } from "../../../src/core/session-manager.ts";

const sessionWith = (entries: object[]): SessionManager =>
	SessionManager.inMemory(process.cwd(), undefined, entries as FileEntry[]);

describe("loadAllMessages", () => {
	it("loads all message entries when no lineage filter is provided", () => {
		const session = sessionWith([
			{ type: "message", id: "m1", parentId: null, message: { role: "user", content: "u1" } },
			{ type: "custom", id: "c1", parentId: "m1", customType: "x", data: {} },
			{
				type: "message",
				id: "m2",
				parentId: "c1",
				message: { role: "assistant", content: [{ type: "text", text: "a1" }] },
			},
			{
				type: "message",
				id: "m3",
				parentId: "m2",
				message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "ok" }] },
			},
		]);

		const loaded = loadAllMessages(session.getEntries(), false);
		expect(loaded.rendered).toHaveLength(3);
		expect(loaded.rawMessages).toHaveLength(3);
		expect(loaded.rendered.map((e) => e.index)).toEqual([0, 1, 2]);
	});

	it("returns empty history for a session with no entries", () => {
		const loaded = loadAllMessages(SessionManager.inMemory().getEntries(), false);
		expect(loaded.rendered).toEqual([]);
		expect(loaded.rawMessages).toEqual([]);
	});

	it("filters messages by allowed lineage entry IDs and preserves original message index", () => {
		const session = sessionWith([
			{ type: "message", id: "m1", parentId: null, message: { role: "user", content: "u1" } },
			{
				type: "message",
				id: "m2",
				parentId: "m1",
				message: { role: "assistant", content: [{ type: "text", text: "a1" }] },
			},
			{ type: "message", id: "m3", parentId: "m2", message: { role: "user", content: "u2" } },
		]);

		const loaded = loadAllMessages(session.getEntries(), false, new Set(["m2"]));
		expect(loaded.rendered).toHaveLength(1);
		expect(loaded.rawMessages).toHaveLength(1);
		expect(loaded.rendered[0].index).toBe(1);
	});
});
