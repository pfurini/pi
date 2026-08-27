import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectProjectPromptHistoryRecords, loadProjectPromptHistory } from "../src/core/prompt-history.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";
import { resolvePath } from "../src/utils/paths.ts";

function sessionHeaderLine(id: string, cwd: string, timestamp = "2025-01-01T00:00:00Z"): string {
	return JSON.stringify({ type: "session", version: 3, id, timestamp, cwd });
}

function userMessageLine(
	id: string,
	parentId: string | null,
	timestamp: string,
	content: string | Array<{ type: string; text?: string }>,
	msgTimestamp?: number,
): string {
	const message: Record<string, unknown> = { role: "user", content };
	if (msgTimestamp !== undefined) message.timestamp = msgTimestamp;
	return JSON.stringify({ type: "message", id, parentId, timestamp, message });
}

function assistantMessageLine(id: string, parentId: string | null, timestamp: string, text: string): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId,
		timestamp,
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
}

/** Same join-with-"" logic InteractiveMode.getUserMessageText() uses, for byte-identical assertions. */
function getUserMessageTextLike(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("");
}

describe("prompt-history collector", () => {
	let tempDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `prompt-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		sessionDir = join(tempDir, "sessions");
		mkdirSync(sessionDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function writeFile(name: string, lines: string[]): string {
		const filePath = join(sessionDir, name);
		writeFileSync(filePath, `${lines.join("\n")}\n`);
		return filePath;
	}

	it("sorts prompts from multiple sessions chronologically", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd, "2025-01-01T00:00:00Z"),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "first"),
		]);
		writeFile("b.jsonl", [
			sessionHeaderLine("b", cwd, "2025-01-02T00:00:00Z"),
			userMessageLine("m1", null, "2025-01-02T00:00:01Z", "second"),
			userMessageLine("m2", "m1", "2025-01-03T00:00:01Z", "third"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["first", "second", "third"]);
	});

	it("resolves the requested cwd regardless of directory layout (default or custom flat)", async () => {
		const cwd = "/project";
		writeFile("only.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "hello"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["hello"]);
	});

	it("excludes sessions for a different cwd in the same custom directory", async () => {
		writeFile("mine.jsonl", [
			sessionHeaderLine("a", "/project-a"),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "mine"),
		]);
		writeFile("other.jsonl", [
			sessionHeaderLine("b", "/project-b"),
			userMessageLine("m1", null, "2025-01-01T00:00:02Z", "not mine"),
		]);

		const result = await loadProjectPromptHistory({ cwd: "/project-a", sessionDir, maxEntries: 0 });
		expect(result).toEqual(["mine"]);
	});

	it("extracts string content, joins multiple text blocks with '', and ignores image-only messages", async () => {
		const cwd = "/project";
		const multiBlockContent = [
			{ type: "text", text: "hello " },
			{ type: "text", text: "world" },
		];
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "plain string"),
			userMessageLine("m2", "m1", "2025-01-01T00:00:02Z", multiBlockContent),
			userMessageLine("m3", "m2", "2025-01-01T00:00:03Z", [{ type: "image" }]),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["plain string", getUserMessageTextLike(multiBlockContent)]);
		expect(result[1]).toBe("hello world");
	});

	it("prefers a persisted originalText over the expanded delivery text", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2025-01-01T00:00:01Z",
				message: { role: "user", content: '<skill name="rev" args="">\nBODY\n</skill>' },
				originalText: "/skill:rev",
			}),
		]);

		expect(await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 })).toEqual(["/skill:rev"]);
	});

	it("recalls originalText from a non-user entry (a synthetic skill pair persists no user message)", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2025-01-01T00:00:01Z",
				message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "skill", arguments: {} }] },
				originalText: "/skill:rev go",
			}),
		]);

		expect(await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 })).toEqual(["/skill:rev go"]);
	});

	it("falls back to the message text when originalText is absent (legacy session) or empty", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "legacy expanded text"),
			JSON.stringify({
				type: "message",
				id: "m2",
				parentId: "m1",
				timestamp: "2025-01-01T00:00:02Z",
				message: { role: "user", content: "torn empty field" },
				originalText: "",
			}),
		]);

		expect(await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 })).toEqual([
			"legacy expanded text",
			"torn empty field",
		]);
	});

	it("excludes assistant messages", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "user prompt"),
			assistantMessageLine("m2", "m1", "2025-01-01T00:00:02Z", "assistant reply"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["user prompt"]);
	});

	it("includes user messages from all branches regardless of active leaf", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("root", null, "2025-01-01T00:00:01Z", "root prompt"),
			userMessageLine("branch1", "root", "2025-01-01T00:00:02Z", "branch one"),
			userMessageLine("branch2", "root", "2025-01-01T00:00:03Z", "branch two"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["root prompt", "branch one", "branch two"]);
	});

	it("includes entries older than a compaction boundary", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "before compaction"),
			JSON.stringify({
				type: "compaction",
				id: "c1",
				parentId: "m1",
				timestamp: "2025-01-01T00:00:02Z",
				summary: "summary",
				firstKeptEntryId: "m2",
				tokensBefore: 100,
			}),
			userMessageLine("m2", "c1", "2025-01-01T00:00:03Z", "after compaction"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["before compaction", "after compaction"]);
	});

	it("merges unflushed current entries while excluding the current session file", async () => {
		const cwd = "/project";
		const currentFile = writeFile("current.jsonl", [
			sessionHeaderLine("current", cwd, "2025-01-01T00:00:00Z"),
			userMessageLine("stale", null, "2025-01-01T00:00:01Z", "stale on disk"),
		]);
		writeFile("older.jsonl", [
			sessionHeaderLine("older", cwd, "2024-12-31T00:00:00Z"),
			userMessageLine("m1", null, "2024-12-31T00:00:01Z", "older prompt"),
		]);

		const currentEntries: SessionEntry[] = [
			{
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2025-01-02T00:00:00Z",
				message: { role: "user", content: "fresh unflushed prompt" },
			} as SessionEntry,
		];

		const result = await loadProjectPromptHistory({
			cwd,
			sessionDir,
			// Real callers pass SessionManager.getSessionFile(), which is resolvePath(sessionFile), not a raw path.
			excludeSessionFile: resolvePath(currentFile),
			currentEntries,
			maxEntries: 0,
		});

		// "stale on disk" from the excluded current session file must not appear.
		expect(result).toEqual(["older prompt", "fresh unflushed prompt"]);
	});

	it("recalls a forked session's inherited prompts once, not twice", async () => {
		// createBranchedSession copies the parent branch's entries verbatim (same id, same timestamps)
		// into the new file and leaves the parent file in place, so both files report those prompts.
		const cwd = "/project";
		const inherited = [
			userMessageLine("p1", null, "2025-01-01T00:00:01Z", "one"),
			assistantMessageLine("a1", "p1", "2025-01-01T00:00:02Z", "reply"),
			userMessageLine("p2", "a1", "2025-01-01T00:00:03Z", "two"),
		];
		writeFile("parent.jsonl", [
			sessionHeaderLine("parent", cwd, "2025-01-01T00:00:00Z"),
			...inherited,
			userMessageLine("p3", "p2", "2025-01-01T00:00:04Z", "abandoned"),
		]);
		writeFile("fork.jsonl", [
			sessionHeaderLine("fork", cwd, "2025-01-02T00:00:00Z"),
			...inherited,
			userMessageLine("f1", "p2", "2025-01-02T00:00:01Z", "after the fork"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["one", "two", "abandoned", "after the fork"]);
	});

	it("keeps same-id prompts from unrelated sessions, since entry ids are only unique per session", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd, "2025-01-01T00:00:00Z"),
			userMessageLine("dup", null, "2025-01-01T00:00:01Z", "from a"),
		]);
		writeFile("b.jsonl", [
			sessionHeaderLine("b", cwd, "2025-01-02T00:00:00Z"),
			userMessageLine("dup", null, "2025-01-02T00:00:01Z", "from b"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["from a", "from b"]);
	});

	it("stores prompt text trimmed, matching live submissions", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "  deploy\n"),
		]);

		const records = await collectProjectPromptHistoryRecords({ cwd, sessionDir, maxEntries: 0 });
		expect(records.map((record) => record.text)).toEqual(["deploy"]);
	});

	it("collapses only consecutive duplicates, preserving non-consecutive repeats", async () => {
		const cwd = "/project";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "repeat"),
			userMessageLine("m2", "m1", "2025-01-01T00:00:02Z", "repeat"),
			userMessageLine("m3", "m2", "2025-01-01T00:00:03Z", "middle"),
			userMessageLine("m4", "m3", "2025-01-01T00:00:04Z", "repeat"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["repeat", "middle", "repeat"]);
	});

	it("keeps the newest N with a finite limit and all entries when unlimited (>100)", async () => {
		const cwd = "/project";
		const lines = [sessionHeaderLine("a", cwd)];
		for (let i = 0; i < 150; i++) {
			const iso = new Date(2025, 0, 1, 0, 0, i).toISOString();
			lines.push(userMessageLine(`m${i}`, i === 0 ? null : `m${i - 1}`, iso, `prompt ${i}`));
		}
		writeFile("a.jsonl", lines);

		const unlimited = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(unlimited).toHaveLength(150);
		expect(unlimited[0]).toBe("prompt 0");
		expect(unlimited[149]).toBe("prompt 149");

		const limited = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 10 });
		expect(limited).toHaveLength(10);
		expect(limited[0]).toBe("prompt 140");
		expect(limited[9]).toBe("prompt 149");
	});

	it("skips malformed lines, invalid headers, and unreadable/missing directories", async () => {
		const cwd = "/project";
		writeFile("bad-header.jsonl", [
			'{"type":"message","id":"1"}',
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "orphan"),
		]);
		writeFile("malformed-lines.jsonl", [
			sessionHeaderLine("a", cwd),
			"not json at all",
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "survives"),
		]);

		const result = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(result).toEqual(["survives"]);

		const missingDirResult = await loadProjectPromptHistory({
			cwd,
			sessionDir: join(tempDir, "does-not-exist"),
			maxEntries: 0,
		});
		expect(missingDirResult).toEqual([]);
	});

	it("orders deterministically when timestamps tie or are invalid", async () => {
		const cwd = "/project";
		const sameTimestamp = "2025-01-01T00:00:01Z";
		writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, sameTimestamp, "first same"),
			userMessageLine("m2", "m1", sameTimestamp, "second same"),
			userMessageLine("m3", "m2", "not-a-timestamp", "invalid timestamp"),
		]);

		const first = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		const second = await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		expect(first).toEqual(second);
		// The invalid entry timestamp falls back to the session header timestamp, which predates sameTimestamp.
		expect(first).toEqual(["invalid timestamp", "first same", "second same"]);
	});

	it("never mutates or migrates source session files", async () => {
		const cwd = "/project";
		const filePath = writeFile("a.jsonl", [
			sessionHeaderLine("a", cwd),
			userMessageLine("m1", null, "2025-01-01T00:00:01Z", "hello"),
		]);
		const before = readFileSync(filePath, "utf-8");
		const statBefore = statSync(filePath);

		await loadProjectPromptHistory({ cwd, sessionDir, maxEntries: 0 });
		await collectProjectPromptHistoryRecords({ cwd, sessionDir, maxEntries: 0 });

		const after = readFileSync(filePath, "utf-8");
		const statAfter = statSync(filePath);
		expect(after).toBe(before);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
		expect(existsSync(filePath)).toBe(true);
	});
});
