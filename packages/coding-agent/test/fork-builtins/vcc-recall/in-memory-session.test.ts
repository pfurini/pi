// Fork-owned: the port reads the live SessionManager, so compacted and off-branch messages stay
// recallable without a session file (docs/plans/vcc-recall-builtin.plan.md, T1).
import { describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { assistantText, userMsg } from "./fixtures.ts";
import { recall, recallTool } from "./session.ts";

describe("vcc_recall after compaction", () => {
	it("reaches a message from before the compaction with a query and with expand", async () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMsg("The quartz-lantern token was chosen before compaction."));
		session.appendMessage(assistantText("Noted."));
		const keptId = session.appendMessage(userMsg("Later work."));
		session.appendCompaction("Summary of the early turns.", keptId, 5000);
		session.appendMessage(assistantText("Continuing after compaction."));
		expect(session.getSessionFile()).toBeUndefined();
		const contextText = JSON.stringify(session.buildSessionProjection().messages);
		expect(contextText).not.toContain("quartz-lantern");

		const tool = recallTool();
		const found = await recall(tool, session, { query: "quartz-lantern" });
		expect(found).toContain("#0 [user]");
		expect(found).toContain("quartz-lantern");

		const expanded = await recall(tool, session, { expand: [0] });
		expect(expanded).toContain("#0 [user] The quartz-lantern token was chosen before compaction.");
	});
});

describe("vcc_recall across branches", () => {
	const branchedSession = () => {
		const session = SessionManager.inMemory();
		const rootId = session.appendMessage(userMsg("Pick a caching strategy."));
		session.appendMessage(assistantText("Option one: beta cache with a short TTL."));
		session.branch(rootId);
		session.appendMessage(assistantText("Option two: no cache."));
		return session;
	};

	it("excludes the off-branch message under scope lineage", async () => {
		const output = await recall(recallTool(), branchedSession(), { query: "beta", scope: "lineage" });
		expect(output).toBe('No matches for "beta" in session history.');
	});

	it("returns the off-branch message under scope all", async () => {
		const output = await recall(recallTool(), branchedSession(), { query: "beta", scope: "all" });
		expect(output).toContain("#1 [assistant] Option one: beta cache with a short TTL.");
	});

	it("falls back to all entries under the default scope after resetLeaf()", async () => {
		const session = branchedSession();
		session.resetLeaf();
		expect(session.getBranch()).toEqual([]);
		const output = await recall(recallTool(), session, { query: "beta" });
		expect(output).toContain("#1 [assistant] Option one: beta cache with a short TTL.");
	});
});
