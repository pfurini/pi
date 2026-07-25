import type { EditorComponent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { LoadProjectPromptHistoryOptions } from "../src/core/prompt-history.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";
import {
	PromptHistoryController,
	type PromptHistorySessionSource,
	type PromptHistorySettingsSource,
} from "../src/modes/interactive/prompt-history-controller.ts";

function userMessageEntry(id: string, text: string, parentId: string | null = null): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: { role: "user", content: text },
	} as SessionEntry;
}

function assistantMessageEntry(id: string, text: string, parentId: string | null): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2025-01-01T00:00:00Z",
		message: { role: "assistant", content: [{ type: "text", text }] },
	} as SessionEntry;
}

class FakeSettings implements PromptHistorySettingsSource {
	scope: "session" | "project" = "session";
	maxEntries = 100;
	getPromptHistoryScope(): "session" | "project" {
		return this.scope;
	}
	getPromptHistoryMaxEntries(): number {
		return this.maxEntries;
	}
}

class FakeSession implements PromptHistorySessionSource {
	persisted = true;
	cwd = "/project";
	sessionDir = "/project/sessions";
	sessionFile: string | undefined = "/project/sessions/current.jsonl";
	entries: SessionEntry[] = [];

	isPersisted(): boolean {
		return this.persisted;
	}
	getCwd(): string {
		return this.cwd;
	}
	getSessionDir(): string {
		return this.sessionDir;
	}
	getSessionFile(): string | undefined {
		return this.sessionFile;
	}
	getEntries(): SessionEntry[] {
		return this.entries;
	}
}

class FakeEditor implements EditorComponent {
	text = "";
	historyCalls: string[][] = [];
	maxEntriesCalls: number[] = [];
	addToHistoryCalls: string[] = [];

	getText(): string {
		return this.text;
	}
	setText(text: string): void {
		this.text = text;
	}
	handleInput(): void {}
	render(): string[] {
		return [];
	}
	invalidate(): void {}

	setHistory = (entries: readonly string[]): void => {
		this.historyCalls.push([...entries]);
	};

	setHistoryMaxEntries = (maxEntries: number): void => {
		this.maxEntriesCalls.push(maxEntries);
	};

	addToHistory = (text: string): void => {
		this.addToHistoryCalls.push(text);
	};
}

/** Legacy custom editor: only implements addToHistory, not setHistory. */
class LegacyFakeEditor implements EditorComponent {
	text = "";
	addToHistoryCalls: string[] = [];

	getText(): string {
		return this.text;
	}
	setText(text: string): void {
		this.text = text;
	}
	handleInput(): void {}
	render(): string[] {
		return [];
	}
	invalidate(): void {}
	addToHistory(text: string): void {
		this.addToHistoryCalls.push(text);
	}
}

describe("PromptHistoryController", () => {
	it("applies session-scope history from every raw entry of the current session", async () => {
		const settings = new FakeSettings();
		settings.scope = "session";
		const session = new FakeSession();
		session.entries = [
			userMessageEntry("m1", "first"),
			assistantMessageEntry("m2", "reply", "m1"),
			userMessageEntry("m3", "second", "m2"),
		];

		const controller = new PromptHistoryController({ settings });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		await controller.refresh(session);

		expect(editor.historyCalls.at(-1)).toEqual(["first", "second"]);
	});

	it("applies project-scope history via the injected collector", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();

		const loadProjectHistory = vi.fn(async (_options: LoadProjectPromptHistoryOptions) => ["old one", "old two"]);
		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		await controller.refresh(session);

		expect(loadProjectHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: session.cwd,
				sessionDir: session.sessionDir,
				excludeSessionFile: session.sessionFile,
				currentEntries: session.entries,
			}),
		);
		expect(editor.historyCalls.at(-1)).toEqual(["old one", "old two"]);
	});

	it("applies the configured finite limit and unlimited (0) mode", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		settings.maxEntries = 2;
		const session = new FakeSession();
		const loadProjectHistory = async () => ["p1", "p2", "p3", "p4"];
		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		await controller.refresh(session);
		expect(editor.historyCalls.at(-1)).toEqual(["p3", "p4"]);
		expect(editor.maxEntriesCalls.at(-1)).toBe(2);

		settings.maxEntries = 0;
		await controller.refresh(session);
		expect(editor.historyCalls.at(-1)).toEqual(["p1", "p2", "p3", "p4"]);
		expect(editor.maxEntriesCalls.at(-1)).toBe(0);
	});

	it("records live submissions into the cache and calls the editor's native addToHistory", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		const controller = new PromptHistoryController({ settings });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		await controller.refresh(session);
		controller.record("new prompt", editor);

		expect(editor.addToHistoryCalls).toEqual(["new prompt"]);

		// A subsequent applyToEditor (e.g. editor swap) must see the recorded entry too.
		const newEditor = new FakeEditor();
		controller.setEditor(newEditor);
		expect(newEditor.historyCalls.at(-1)).toEqual(["new prompt"]);
	});

	it("preserves the visible draft: applyToEditor never calls setText", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		session.entries = [userMessageEntry("m1", "seed")];
		const controller = new PromptHistoryController({ settings });
		const editor = new FakeEditor();
		const setTextSpy = vi.spyOn(editor, "setText");

		controller.setEditor(editor);
		await controller.refresh(session);
		controller.record("live prompt", editor);

		expect(setTextSpy).not.toHaveBeenCalled();
	});

	it("uses setHistory for a modern custom editor", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		session.entries = [userMessageEntry("m1", "hello")];
		const controller = new PromptHistoryController({ settings });
		const editor = new FakeEditor();

		controller.setEditor(editor);
		await controller.refresh(session);

		expect(editor.historyCalls.at(-1)).toEqual(["hello"]);
	});

	it("falls back to replaying addToHistory for a legacy custom editor", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		session.entries = [userMessageEntry("m1", "one"), userMessageEntry("m2", "two", "m1")];
		const controller = new PromptHistoryController({ settings });
		const legacyEditor = new LegacyFakeEditor();

		controller.setEditor(legacyEditor);
		await controller.refresh(session);

		expect(legacyEditor.addToHistoryCalls).toEqual(["one", "two"]);
	});

	it("discards a stale refresh's result once a newer refresh has started", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();

		let resolveFirst: (value: string[]) => void = () => {};
		const firstLoad = new Promise<string[]>((resolve) => {
			resolveFirst = resolve;
		});
		let callCount = 0;
		const loadProjectHistory = vi.fn(async () => {
			callCount++;
			if (callCount === 1) return firstLoad;
			return ["from second refresh"];
		});

		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		const firstRefresh = controller.refresh(session);
		const secondRefresh = controller.refresh(session);

		await secondRefresh;
		expect(editor.historyCalls.at(-1)).toEqual(["from second refresh"]);

		resolveFirst(["from first refresh, should be discarded"]);
		await firstRefresh;

		// The stale first refresh must not have overwritten the newer result.
		expect(editor.historyCalls.at(-1)).toEqual(["from second refresh"]);
	});

	it("carries a prompt recorded during a still-in-flight refresh into a second overlapping refresh", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();

		let resolveFirst: (value: string[]) => void = () => {};
		const firstLoad = new Promise<string[]>((resolve) => {
			resolveFirst = resolve;
		});
		let resolveSecond: (value: string[]) => void = () => {};
		const secondLoad = new Promise<string[]>((resolve) => {
			resolveSecond = resolve;
		});
		let callCount = 0;
		const loadProjectHistory = vi.fn(() => {
			callCount++;
			return callCount === 1 ? firstLoad : secondLoad;
		});

		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		// Refresh A starts (e.g. a /settings scope change) and its collector I/O is still pending.
		const firstRefresh = controller.refresh(session);

		// A prompt is submitted while A is in flight.
		controller.record("submitted during A", editor);

		// Refresh B starts before A resolves (e.g. cycling maxEntries right after scope in /settings).
		const secondRefresh = controller.refresh(session);

		// B must not have discarded the entry recorded during A's window.
		resolveSecond(["old one"]);
		await secondRefresh;
		expect(editor.historyCalls.at(-1)).toEqual(["old one", "submitted during A"]);

		// A's stale result must not overwrite B's once A finally resolves.
		resolveFirst(["stale result, should be discarded"]);
		await firstRefresh;
		expect(editor.historyCalls.at(-1)).toEqual(["old one", "submitted during A"]);
	});

	it("survives a prompt recorded while a refresh is in flight, reachable with the merged cache", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();

		let resolveLoad: (value: string[]) => void = () => {};
		const loadProjectHistory = vi.fn(
			() =>
				new Promise<string[]>((resolve) => {
					resolveLoad = resolve;
				}),
		);

		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		const refreshPromise = controller.refresh(session);

		// A prompt is submitted while the collector's I/O is still pending.
		controller.record("submitted during refresh", editor);
		expect(editor.addToHistoryCalls).toEqual(["submitted during refresh"]);

		resolveLoad(["old one", "old two"]);
		await refreshPromise;

		// The just-submitted prompt must not have been dropped by the completing refresh.
		expect(editor.historyCalls.at(-1)).toEqual(["old one", "old two", "submitted during refresh"]);
	});

	it("does not drop a recorded entry even when the collector returns a full unlimited result", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		settings.maxEntries = 0;
		const session = new FakeSession();

		let resolveLoad: (value: string[]) => void = () => {};
		const loadProjectHistory = vi.fn(
			() =>
				new Promise<string[]>((resolve) => {
					resolveLoad = resolve;
				}),
		);

		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		const refreshPromise = controller.refresh(session);
		controller.record("mid-refresh prompt", editor);

		const unlimitedResult = Array.from({ length: 500 }, (_, i) => `old prompt ${i}`);
		resolveLoad(unlimitedResult);
		await refreshPromise;

		expect(editor.historyCalls.at(-1)?.at(-1)).toBe("mid-refresh prompt");
		expect(editor.historyCalls.at(-1)).toHaveLength(501);
	});

	it("forces session-local behavior for an unpersisted (--no-session) session even when settings say project", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();
		session.persisted = false;
		session.entries = [userMessageEntry("m1", "ephemeral prompt")];

		const loadProjectHistory = vi.fn(async () => ["should not be used"]);
		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		await controller.refresh(session);

		expect(loadProjectHistory).not.toHaveBeenCalled();
		expect(editor.historyCalls.at(-1)).toEqual(["ephemeral prompt"]);
	});

	it("falls back to current-session history and reports a warning when the loader fails", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();
		session.entries = [userMessageEntry("m1", "fallback prompt")];

		const loadProjectHistory = vi.fn(async () => {
			throw new Error("disk read failed");
		});
		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		const result = await controller.refresh(session);

		expect(result.warning).toBeDefined();
		expect(editor.historyCalls.at(-1)).toEqual(["fallback prompt"]);
	});

	it("keeps recalling prompts that a compaction dropped from the model's context", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		// Raw entries keep everything; only the compaction-aware context view drops the early prompts.
		session.entries = [
			userMessageEntry("m1", "before compaction"),
			assistantMessageEntry("m2", "reply", "m1"),
			{
				type: "compaction",
				id: "c1",
				parentId: "m2",
				timestamp: "2025-01-01T00:00:00Z",
				firstKeptEntryId: "m3",
			} as unknown as SessionEntry,
			userMessageEntry("m3", "after compaction", "c1"),
		];

		const controller = new PromptHistoryController({ settings });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		await controller.refresh(session);

		expect(editor.historyCalls.at(-1)).toEqual(["before compaction", "after compaction"]);
	});

	it("passes the configured limit to the project loader", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		settings.maxEntries = 42;
		const session = new FakeSession();

		const loadProjectHistory = vi.fn(async (_options: LoadProjectPromptHistoryOptions) => ["one"]);
		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		controller.setEditor(new FakeEditor());

		await controller.refresh(session);

		expect(loadProjectHistory.mock.calls[0]?.[0].maxEntries).toBe(42);
	});

	it("replays only unseen entries to a legacy editor across refreshes", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		session.entries = [userMessageEntry("m1", "one"), userMessageEntry("m2", "two", "m1")];
		const controller = new PromptHistoryController({ settings });
		const legacyEditor = new LegacyFakeEditor();
		controller.setEditor(legacyEditor);

		await controller.refresh(session);
		await controller.refresh(session);
		session.entries = [...session.entries, userMessageEntry("m3", "three", "m2")];
		await controller.refresh(session);

		expect(legacyEditor.addToHistoryCalls).toEqual(["one", "two", "three"]);
	});

	it("reports a throwing editor as a warning instead of rejecting", async () => {
		const settings = new FakeSettings();
		const session = new FakeSession();
		session.entries = [userMessageEntry("m1", "prompt")];
		const controller = new PromptHistoryController({ settings });
		const editor = new FakeEditor();
		editor.setHistory = () => {
			throw new Error("extension editor exploded");
		};
		controller.setEditor(editor);

		const result = await controller.refresh(session);

		expect(result.warning).toContain("extension editor exploded");
	});

	it("does not strand the mid-refresh buffer when discovery fails completely", async () => {
		const settings = new FakeSettings();
		settings.scope = "project";
		const session = new FakeSession();
		// The project loader rejects and the session-local fallback then throws too, the path that
		// used to leave recordedDuringLoad set forever (and reject).
		let entriesCalls = 0;
		session.getEntries = () => {
			entriesCalls++;
			if (entriesCalls === 1) return [];
			throw new Error("session entries unavailable");
		};

		let rejectLoad: (error: Error) => void = () => {};
		const loadProjectHistory = vi.fn(
			() =>
				new Promise<string[]>((_resolve, reject) => {
					rejectLoad = reject;
				}),
		);
		const controller = new PromptHistoryController({ settings, loadProjectHistory });
		const editor = new FakeEditor();
		controller.setEditor(editor);

		const inFlight = controller.refresh(session);
		controller.record("live prompt", editor);
		rejectLoad(new Error("disk read failed"));
		const result = await inFlight;

		expect(result.warning).toContain("disk read failed");
		expect(editor.historyCalls.at(-1)).toEqual(["live prompt"]);

		settings.scope = "session";
		session.getEntries = () => [userMessageEntry("m1", "collected")];
		await controller.refresh(session);

		// The stranded buffer used to be re-appended to every later refresh.
		expect(editor.historyCalls.at(-1)).toEqual(["collected"]);
	});
});
