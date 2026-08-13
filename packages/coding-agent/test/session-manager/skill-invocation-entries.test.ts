/**
 * B.12/A.4 persistence tests: invocation metadata on message entries, the
 * batched synthetic-pair write, and load-time repair of crash-torn pairs.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type FileEntry,
	loadEntriesFromFile,
	repairTornSkillPairs,
	SessionManager,
	type SessionMessageEntry,
} from "../../src/core/session-manager.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop() as string, { recursive: true, force: true });
	}
});

function makeTempDir(): string {
	const tempDir = join(tmpdir(), `pi-skill-entries-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	tempDirs.push(tempDir);
	return tempDir;
}

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function pairAssistant(pairIdMarker: string): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: `skill_${pairIdMarker}`,
				name: "skill",
				arguments: { name: "test", args: "a b" },
			},
		],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: zeroUsage(),
		stopReason: "toolUse",
		timestamp: 2,
	};
}

function pairToolResult(marker: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: `skill_${marker}`,
		toolName: "skill",
		content: [{ type: "text", text: "Rendered body." }],
		details: { invocation: { name: "test" } },
		isError: false,
		timestamp: 3,
	};
}

describe("SessionManager skill invocation entries (B.12)", () => {
	it("round-trips invocations metadata through appendMessage", () => {
		const sm = SessionManager.inMemory();
		sm.appendMessage(
			{
				role: "user",
				content: [{ type: "text", text: '<skill name="test" args="x">\nBody\n</skill>' }],
				timestamp: 1,
			},
			{ invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "x", blockStart: 0, blockEnd: 41 }] },
		);
		const entries = sm.getEntries();
		const entry = entries.find((e) => e.type === "message");
		expect(entry?.invocations).toEqual([
			{ skillId: "/s/SKILL.md", name: "test", args: "x", blockStart: 0, blockEnd: 41 },
		]);
		expect(entry?.pairId).toBeUndefined();
	});

	it("writes the synthetic pair as one batched unit sharing an entry-level pairId", () => {
		const dir = makeTempDir();
		const sm = SessionManager.create(dir);
		const sessionFile = sm.getSessionFile();
		expect(sessionFile).toBeTruthy();

		sm.appendMessage({ role: "user", content: "hi", timestamp: 1 });
		sm.appendSkillMessagePair(
			pairAssistant("p1"),
			pairToolResult("p1"),
			{
				pairId: "pair-1",
				invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "a b", blockStart: 0, blockEnd: 0 }],
			},
			{
				pairId: "pair-1",
				invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "a b", blockStart: 0, blockEnd: 14 }],
			},
		);

		const entries = sm.getEntries().filter((e): e is SessionMessageEntry => e.type === "message");
		const assistantEntry = entries.find((e) => e.message.role === "assistant");
		const resultEntry = entries.find((e) => e.message.role === "toolResult");
		expect(assistantEntry?.pairId).toBe("pair-1");
		expect(resultEntry?.pairId).toBe("pair-1");
		expect(resultEntry?.parentId).toBe(assistantEntry?.id);

		// Both lines are present in the file (single batched append).
		const lines = readFileSync(sessionFile!, "utf-8").trim().split("\n");
		const parsed = lines.map((line) => JSON.parse(line) as FileEntry);
		const pairLines = parsed.filter(
			(line) => line.type === "message" && "pairId" in line && line.pairId === "pair-1",
		);
		expect(pairLines).toHaveLength(2);

		// No enumerable pairId leaks onto the messages themselves (C1a wire contract).
		for (const line of pairLines) {
			expect(JSON.stringify((line as SessionMessageEntry).message)).not.toContain("pairId");
		}
	});
});

describe("repairTornSkillPairs", () => {
	it("downgrades a lone assistant half to a message-block user entry with a loss notice", () => {
		const entries: FileEntry[] = [
			{
				type: "message",
				id: "a1",
				parentId: null,
				timestamp: "t",
				message: pairAssistant("torn"),
				pairId: "torn-pair",
				invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "a b", blockStart: 0, blockEnd: 0 }],
			} satisfies SessionMessageEntry,
		];
		const { entries: repaired, repaired: count } = repairTornSkillPairs(entries);
		expect(count).toBe(1);
		const entry = repaired[0] as SessionMessageEntry;
		expect(entry.message.role).toBe("user");
		expect(entry.pairId).toBeUndefined();
		const text =
			entry.message.role === "user" && typeof entry.message.content !== "string"
				? entry.message.content[0]
				: undefined;
		expect(text).toMatchObject({ type: "text" });
		const body = text?.type === "text" ? text.text : "";
		expect(body).toContain('<skill name="test" args="a b">');
		expect(body).toContain("session write was interrupted");
		expect(entry.invocations?.[0]).toMatchObject({ name: "test", args: "a b", blockStart: 0, blockEnd: body.length });
	});

	it("downgrades a lone toolResult half to a message-block user entry keeping its body", () => {
		const entries: FileEntry[] = [
			{
				type: "message",
				id: "r1",
				parentId: null,
				timestamp: "t",
				message: pairToolResult("torn"),
				pairId: "torn-pair",
				invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "a b", blockStart: 0, blockEnd: 14 }],
			} satisfies SessionMessageEntry,
		];
		const { entries: repaired, repaired: count } = repairTornSkillPairs(entries);
		expect(count).toBe(1);
		const entry = repaired[0] as SessionMessageEntry;
		expect(entry.message.role).toBe("user");
		const content = entry.message.role === "user" ? entry.message.content : [];
		const body =
			typeof content === "string"
				? content
				: content.map((part) => (part.type === "text" ? part.text : "")).join("");
		expect(body).toContain("Rendered body.");
		expect(body).toContain('<skill name="test" args="a b">');
	});

	it("leaves complete pairs and ordinary entries untouched", () => {
		const entries: FileEntry[] = [
			{
				type: "message",
				id: "a1",
				parentId: null,
				timestamp: "t",
				message: pairAssistant("ok"),
				pairId: "ok-pair",
			} satisfies SessionMessageEntry,
			{
				type: "message",
				id: "r1",
				parentId: "a1",
				timestamp: "t",
				message: pairToolResult("ok"),
				pairId: "ok-pair",
			} satisfies SessionMessageEntry,
			{
				type: "message",
				id: "u1",
				parentId: "r1",
				timestamp: "t",
				message: { role: "user", content: "plain", timestamp: 4 } satisfies UserMessage,
			} satisfies SessionMessageEntry,
		];
		const { entries: repaired, repaired: count } = repairTornSkillPairs(entries);
		expect(count).toBe(0);
		expect((repaired[0] as SessionMessageEntry).message.role).toBe("assistant");
		expect((repaired[1] as SessionMessageEntry).message.role).toBe("toolResult");
		expect((repaired[2] as SessionMessageEntry).message.role).toBe("user");
	});

	it("repairs a crash-torn pair at load time", () => {
		const dir = makeTempDir();
		const sessionFile = join(dir, "session.jsonl");
		const header = { type: "session", id: "s1", timestamp: "t", cwd: dir };
		const torn = {
			type: "message",
			id: "a1",
			parentId: null,
			timestamp: "t",
			message: pairAssistant("crash"),
			pairId: "crash-pair",
			invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "", blockStart: 0, blockEnd: 0 }],
		};
		writeFileSync(sessionFile, `${JSON.stringify(header)}\n${JSON.stringify(torn)}\n`);

		const entries = loadEntriesFromFile(sessionFile);
		const entry = entries.find((e) => e.type === "message") as SessionMessageEntry;
		expect(entry.message.role).toBe("user");
		expect(entry.pairId).toBeUndefined();
		expect(entry.invocations?.[0].name).toBe("test");
	});

	it("skips entries with a missing or malformed message without throwing", () => {
		// Hand-edited or corrupt files can carry a pairId on an entry whose
		// message object is null/invalid; grouping must not dereference it.
		const entries: FileEntry[] = [
			{
				type: "message",
				id: "bad",
				parentId: null,
				timestamp: "t",
				pairId: "orphan",
				message: null,
			} as unknown as FileEntry,
			{
				type: "message",
				id: "a1",
				parentId: null,
				timestamp: "t",
				message: pairAssistant("torn"),
				pairId: "torn-pair",
				invocations: [{ skillId: "/s/SKILL.md", name: "test", args: "a b", blockStart: 0, blockEnd: 0 }],
			} satisfies SessionMessageEntry,
		];
		let result: ReturnType<typeof repairTornSkillPairs> | undefined;
		expect(() => {
			result = repairTornSkillPairs(entries);
		}).not.toThrow();
		// The valid torn half is still repaired; the malformed entry is left as-is.
		expect(result?.repaired).toBe(1);
		expect((result?.entries[1] as SessionMessageEntry).message.role).toBe("user");
	});
});
