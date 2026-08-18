import type { FSWatcher } from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceDiagnostic } from "../src/core/diagnostics.ts";
import {
	createUnrefWatchTimers,
	ResourceWatcher,
	type ResourceWatchFactory,
	type WatchTimers,
} from "../src/core/skills/resource-watch.ts";

/**
 * c4d watcher mechanics, pure: an injected watch factory drives fs events
 * deterministically against real temp-dir trees (real fs reads, fake fs
 * events), and manual timers make debounce/retry synchronous to drive.
 */

class FakeWatch {
	readonly dir: string;
	readonly listener: (eventType: string, filename: string | null) => void;
	readonly onError: () => void;
	closed = false;
	unrefCount = 0;
	constructor(dir: string, listener: (eventType: string, filename: string | null) => void, onError: () => void) {
		this.dir = dir;
		this.listener = listener;
		this.onError = onError;
	}
	unref(): this {
		this.unrefCount += 1;
		return this;
	}
	close(): void {
		this.closed = true;
	}
}

class FakeWatchFactory {
	readonly watches: FakeWatch[] = [];
	readonly failDirs = new Set<string>();

	readonly factory: ResourceWatchFactory = (dir, listener, onError) => {
		if (this.failDirs.has(dir)) {
			return null;
		}
		const fake = new FakeWatch(dir, listener, onError);
		this.watches.push(fake);
		return fake as unknown as FSWatcher;
	};

	emit(dir: string, filename: string | null = null): void {
		for (const fake of this.watches.filter((w) => w.dir === dir && !w.closed)) {
			fake.listener("rename", filename);
		}
	}

	fail(dir: string): void {
		for (const fake of this.watches.filter((w) => w.dir === dir && !w.closed)) {
			fake.onError();
		}
	}

	live(): FakeWatch[] {
		return this.watches.filter((w) => !w.closed);
	}
}

interface PendingTimer {
	fn: () => void;
	ms: number;
	cancelled: boolean;
}

class ManualTimers implements WatchTimers {
	readonly pending: PendingTimer[] = [];

	set(fn: () => void, ms: number): unknown {
		const timer: PendingTimer = { fn, ms, cancelled: false };
		this.pending.push(timer);
		return timer;
	}

	clear(handle: unknown): void {
		(handle as PendingTimer).cancelled = true;
	}

	/** Fire all currently-pending, non-cancelled timers (FIFO). Returns how many fired. */
	flush(): number {
		const ready = this.pending.filter((timer) => !timer.cancelled);
		this.pending.length = 0;
		for (const timer of ready) {
			timer.fn();
		}
		return ready.length;
	}

	get pendingCount(): number {
		return this.pending.filter((timer) => !timer.cancelled).length;
	}
}

function makeWatcher(options?: { onRefreshNeeded?: () => void }) {
	const factory = new FakeWatchFactory();
	const timers = new ManualTimers();
	const refreshes: number[] = [];
	const health: Array<ResourceDiagnostic | undefined> = [];
	const watcher = new ResourceWatcher({
		onRefreshNeeded: options?.onRefreshNeeded ?? (() => refreshes.push(Date.now())),
		onHealthChange: (diagnostic) => health.push(diagnostic),
		watch: factory.factory,
		timers,
	});
	return { watcher, factory, timers, refreshes, health };
}

let tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-resource-watch-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

describe("ResourceWatcher", () => {
	it("coalesces an event burst into one debounced refresh", () => {
		const root = tempDir();
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: root }]);
		expect(factory.live().map((w) => w.dir)).toEqual([root]);

		factory.emit(root, "a.md");
		factory.emit(root, "b.md");
		factory.emit(root, null);
		expect(refreshes).toHaveLength(0);
		expect(timers.flush()).toBe(1);
		expect(refreshes).toHaveLength(1);
		watcher.dispose();
	});

	it("watches skill subdirectories and re-syncs after a topology change (create-child-dir → edit-its-SKILL.md)", () => {
		const root = tempDir();
		const skills = join(root, ".pi", "skills");
		mkdirSync(join(skills, "existing"), { recursive: true });
		writeFileSync(join(skills, "existing", "SKILL.md"), "---\ndescription: x\n---\n");
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: skills }]);
		expect(
			factory
				.live()
				.map((w) => w.dir)
				.sort(),
		).toEqual([skills, join(skills, "existing")].sort());

		// Create a new child skill directory, then its SKILL.md.
		mkdirSync(join(skills, "newskill"));
		factory.emit(skills, "newskill");
		timers.flush();
		// Two refreshes: the scan that discovered the child dir, then the catch-up scan the
		// cycle runs once its watcher is attached (a write in that gap is otherwise lost).
		expect(refreshes).toHaveLength(2);
		expect(factory.live().some((w) => w.dir === join(skills, "newskill"))).toBe(true);

		writeFileSync(join(skills, "newskill", "SKILL.md"), "---\ndescription: y\n---\n");
		factory.emit(join(skills, "newskill"), "SKILL.md");
		timers.flush();
		// No new topology this time, so the edit costs exactly one refresh.
		expect(refreshes).toHaveLength(3);
		watcher.dispose();
	});

	it("re-scans after attaching a new watcher so a write landing in the attach gap is not lost", () => {
		const root = tempDir();
		const skills = join(root, ".pi", "skills");
		mkdirSync(join(skills, "existing"), { recursive: true });
		writeFileSync(join(skills, "existing", "SKILL.md"), "---\ndescription: x\n---\n");
		const newSkillDir = join(skills, "newskill");

		// Each refresh records what a loader scanning right then would have seen.
		const sawNewSkill: boolean[] = [];
		const { watcher, factory, timers } = makeWatcher({
			onRefreshNeeded: () => {
				sawNewSkill.push(existsSync(join(newSkillDir, "SKILL.md")));
				if (sawNewSkill.length === 1) {
					// The gap: the write lands after the discovering scan but before the new
					// directory's own watcher exists, so no further event will announce it.
					writeFileSync(join(newSkillDir, "SKILL.md"), "---\ndescription: y\n---\n");
				}
			},
		});
		watcher.setRoots([{ dir: skills }]);

		mkdirSync(newSkillDir);
		factory.emit(skills, "newskill");
		timers.flush();

		expect(sawNewSkill).toEqual([false, true]);
		watcher.dispose();
	});

	it("covers a not-yet-existing root via its nearest existing ancestor until it appears", () => {
		const base = tempDir();
		const missing = join(base, "later", ".pi", "skills");
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: missing }]);
		expect(factory.live().map((w) => w.dir)).toEqual([base]);

		mkdirSync(join(base, "later", ".pi", "skills"), { recursive: true });
		factory.emit(base, "later");
		timers.flush();
		// The root's own watcher is new topology, so a catch-up scan follows the first.
		expect(refreshes).toHaveLength(2);
		expect(factory.live().some((w) => w.dir === missing)).toBe(true);
		watcher.dispose();
	});

	it("watches an empty existing root directly", () => {
		const root = tempDir();
		const empty = join(root, "empty-skills");
		mkdirSync(empty);
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: empty }]);
		expect(factory.live().map((w) => w.dir)).toEqual([empty]);
		writeFileSync(join(empty, "ad-hoc.md"), "---\ndescription: z\n---\n");
		factory.emit(empty, "ad-hoc.md");
		timers.flush();
		expect(refreshes).toHaveLength(1);
		watcher.dispose();
	});

	it("filters a direct skill file's parent-directory watch to that file", () => {
		const root = tempDir();
		const file = join(root, "solo.md");
		writeFileSync(file, "---\ndescription: solo\n---\n");
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: root, file }]);

		factory.emit(root, "other.md");
		timers.flush();
		expect(refreshes).toHaveLength(0);

		factory.emit(root, "solo.md");
		timers.flush();
		expect(refreshes).toHaveLength(1);

		// Atomic save (rename over the file, inode change) is observed the same way.
		factory.emit(root, "solo.md");
		timers.flush();
		expect(refreshes).toHaveLength(2);
		watcher.dispose();
	});

	it("covers an initially-absent direct skill file via its parent and observes its creation", () => {
		const root = tempDir();
		const file = join(root, "solo.md");
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: root, file }]);
		writeFileSync(file, "---\ndescription: solo\n---\n");
		factory.emit(root, "solo.md");
		timers.flush();
		expect(refreshes).toHaveLength(1);
		watcher.dispose();
	});

	it("treats a watched directory's disappearance as a change and re-anchors to the nearest ancestor", () => {
		const base = tempDir();
		const root = join(base, "skills");
		mkdirSync(root);
		const { watcher, factory, timers, refreshes } = makeWatcher();
		watcher.setRoots([{ dir: root }]);
		rmSync(root, { recursive: true, force: true });
		factory.emit(root, null);
		timers.flush();
		// Re-anchoring attaches a watcher on the ancestor, which triggers the catch-up scan;
		// it is a no-op for state, and the loader coalesces it away.
		expect(refreshes).toHaveLength(2);
		expect(factory.live().map((w) => w.dir)).toEqual([base]);
		watcher.dispose();
	});

	it("surfaces one deduped health diagnostic on watch failure, retries, and clears on recovery after a catch-up refresh", () => {
		const root = tempDir();
		const other = tempDir();
		const { watcher, factory, timers, refreshes, health } = makeWatcher();
		watcher.setRoots([{ dir: root }, { dir: other }]);
		expect(health).toEqual([]);

		// One dir's watch errors; the other stays live (failure isolation).
		factory.fail(root);
		expect(health).toHaveLength(1);
		expect(health[0]?.type).toBe("warning");
		expect(factory.live().some((w) => w.dir === other)).toBe(true);

		// Blind interval: a change lands while the watch is down; repeated retries dedupe the diagnostic.
		writeFileSync(join(root, "catchup.md"), "---\ndescription: c\n---\n");
		timers.flush(); // retry cycle 1 (factory now reattaches)
		expect(health).toHaveLength(2); // cleared exactly once
		expect(health[1]).toBeUndefined();
		expect(refreshes.length).toBeGreaterThanOrEqual(1); // catch-up refresh ran before health cleared
		expect(factory.live().some((w) => w.dir === root)).toBe(true);
		watcher.dispose();
	});

	it("keeps health degraded and retries while the refresh itself fails, converging after two consecutive failures", () => {
		const root = tempDir();
		let failuresLeft = 2;
		const { watcher, factory, timers, refreshes, health } = makeWatcher({
			onRefreshNeeded: () => {
				if (failuresLeft > 0) {
					failuresLeft -= 1;
					throw new Error("transient refresh failure");
				}
				refreshes.push(Date.now());
			},
		});
		watcher.setRoots([{ dir: root }]);
		factory.emit(root, "a.md");
		timers.flush(); // debounce → refresh fails (1st)
		expect(refreshes).toHaveLength(0);
		expect(health.filter((h) => h !== undefined)).toHaveLength(1);
		expect(timers.pendingCount).toBe(1); // retry persists while degraded

		timers.flush(); // retry → refresh fails (2nd)
		expect(refreshes).toHaveLength(0);
		expect(health.filter((h) => h !== undefined)).toHaveLength(1); // still deduped
		expect(timers.pendingCount).toBe(1);

		timers.flush(); // retry → refresh succeeds
		expect(refreshes).toHaveLength(1);
		expect(health[health.length - 1]).toBeUndefined(); // cleared
		expect(timers.pendingCount).toBe(0); // retry stops on success
		watcher.dispose();
	});

	it("survives a partial watch-factory failure (one dir fails, the rest stay live)", () => {
		const good = tempDir();
		const bad = tempDir();
		const { watcher, factory, timers, refreshes, health } = makeWatcher();
		factory.failDirs.add(bad);
		watcher.setRoots([{ dir: good }, { dir: bad }]);
		expect(health).toHaveLength(1);
		expect(factory.live().map((w) => w.dir)).toEqual([good]);

		factory.emit(good, "x.md");
		timers.flush();
		expect(refreshes.length).toBeGreaterThanOrEqual(1);

		factory.failDirs.delete(bad);
		timers.flush(); // retry reattaches the failed dir
		expect(factory.live().some((w) => w.dir === bad)).toBe(true);
		expect(health[health.length - 1]).toBeUndefined();
		watcher.dispose();
	});

	it("contains a throwing subscriber-visible refresh error and never escapes into the fs callback", () => {
		const root = tempDir();
		const { watcher, factory, timers } = makeWatcher({
			onRefreshNeeded: () => {
				throw new Error("boom");
			},
		});
		watcher.setRoots([{ dir: root }]);
		expect(() => {
			factory.emit(root, "x.md");
			timers.flush();
		}).not.toThrow();
		watcher.dispose();
	});

	it("dispose is idempotent and cancels pending debounce and retry timers", () => {
		const root = tempDir();
		const { watcher, factory, timers, refreshes } = makeWatcher({
			onRefreshNeeded: () => {
				refreshes.push(Date.now());
				throw new Error("fail once");
			},
		});
		watcher.setRoots([{ dir: root }]);
		factory.emit(root, "x.md");
		timers.flush(); // debounce fires; refresh fails → retry pending
		expect(timers.pendingCount).toBe(1);
		factory.emit(root, "y.md"); // new debounce pending too
		watcher.dispose();
		watcher.dispose();
		expect(timers.pendingCount).toBe(0);
		expect(factory.live()).toHaveLength(0);
		expect(timers.flush()).toBe(0);
		expect(refreshes).toHaveLength(1);
	});

	it("unrefs every watcher handle", () => {
		const root = tempDir();
		const { watcher, factory } = makeWatcher();
		watcher.setRoots([{ dir: root }]);
		expect(factory.watches.length).toBeGreaterThan(0);
		for (const fake of factory.watches) {
			expect(fake.unrefCount).toBeGreaterThanOrEqual(1);
		}
		watcher.dispose();
	});

	it("unrefs the default debounce/retry timers", () => {
		const unrefSpy = vi.fn();
		const fakeTimer = { unref: unrefSpy };
		vi.stubGlobal(
			"setTimeout",
			vi.fn(() => fakeTimer),
		);
		vi.stubGlobal("clearTimeout", vi.fn());
		try {
			const timers = createUnrefWatchTimers();
			const handle = timers.set(() => {}, 10);
			expect(unrefSpy).toHaveBeenCalledTimes(1);
			timers.clear(handle);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
