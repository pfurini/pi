/**
 * Fork-owned: the task store (plan T1): pi-tasks' file format, and the memory fallback of D50.
 */
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "../../../src/core/fork-builtins/tasks/store.ts";

const dirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	vi.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const memoryWarning = (reason: string) => `Tasks are not saved: ${reason}. The list stays in memory for this session.`;

describe("the task store's memory fallback (D50)", () => {
	it("keeps the list in memory with one warning when the file cannot be written", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tasks-ro-"));
		chmodSync(dir, 0o555);
		const warnings: string[] = [];
		const store = new TaskStore(join(dir, "tasks", "tasks-1.json"), (message) => warnings.push(message), dir);
		const task = store.create("a", "b");
		store.create("c", "d");
		expect(store.get(task.id)?.subject).toBe("a");
		expect(store.file).toBeUndefined();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/^Tasks are not saved: .*\. The list stays in memory for this session\.$/);
		chmodSync(dir, 0o755);
	});

	it("saves the list again once a retried write succeeds, as /reload asks", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tasks-retry-"));
		chmodSync(dir, 0o555);
		const file = join(dir, "tasks-1.json");
		const store = new TaskStore(file, () => {}, dir);
		store.create("kept in memory", "d");
		expect(store.retryWrite()).toBe(false);
		chmodSync(dir, 0o755);
		expect(store.retryWrite()).toBe(true);
		expect(store.file).toBe(file);
		expect(JSON.parse(readFileSync(file, "utf8")).tasks[0].subject).toBe("kept in memory");
	});

	it("never overwrites a file that holds no task list", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tasks-bad-"));
		const file = join(dir, "tasks-1.json");
		writeFileSync(file, "{ not json");
		const warnings: string[] = [];
		const store = new TaskStore(file, (message) => warnings.push(message), dir);
		store.create("a", "b");
		expect(store.retryWrite()).toBe(false);
		expect(readFileSync(file, "utf8")).toBe("{ not json");
		expect(warnings[0]).toContain("is not a task list");
	});

	it("resumes a pi-tasks file, filling the fields old files lack", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tasks-old-"));
		const file = join(dir, "tasks-1.json");
		writeFileSync(
			file,
			JSON.stringify({ nextId: 2, tasks: [{ id: "1", subject: "old", description: "d", status: "pending" }] }),
		);
		const store = new TaskStore(file, () => {}, dir);
		expect(store.get("1")).toMatchObject({ subject: "old", blocks: [], blockedBy: [], metadata: {} });
		expect(store.create("new", "d").id).toBe("2");
		expect(JSON.parse(readFileSync(file, "utf8")).tasks).toHaveLength(2);
	});

	it("never writes or deletes through a symlink below the project root (D52)", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-tasks-link-"));
		const elsewhere = mkdtempSync(join(tmpdir(), "pi-tasks-elsewhere-"));
		mkdirSync(join(root, ".pi"));
		symlinkSync(elsewhere, join(root, ".pi", "tasks"));
		const warnings: string[] = [];
		const store = new TaskStore(
			join(root, ".pi", "tasks", "tasks-1.json"),
			(message) => warnings.push(message),
			root,
		);
		store.create("a", "b");
		expect(store.file).toBeUndefined();
		expect(existsSync(join(elsewhere, "tasks-1.json"))).toBe(false);
		expect(warnings[0]).toBe(
			`Tasks are not saved: ${join(root, ".pi", "tasks")} is a symlink. The list stays in memory for this session.`,
		);
	});

	it("never overwrites a file another process changed since this store read it (D53)", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tasks-shared-"));
		const file = join(dir, "tasks-1.json");
		const first = new TaskStore(file, () => {}, dir);
		const warnings: string[] = [];
		const second = new TaskStore(file, (message) => warnings.push(message), dir);
		first.create("first", "d");
		second.create("second", "d");
		expect(JSON.parse(readFileSync(file, "utf8")).tasks.map((task: { subject: string }) => task.subject)).toEqual([
			"first",
		]);
		expect(second.file).toBeUndefined();
		expect(warnings[0]).toBe(
			`Tasks are not saved: ${file} changed outside this session. The list stays in memory for this session.`,
		);
		first.delete("1");
		expect(first.deleteFileIfEmpty()).toBe(true);
		expect(existsSync(file)).toBe(false);
	});

	it("keeps the list in memory when an ancestor cannot be checked", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-tasks-notdir-"));
		writeFileSync(join(root, ".pi"), "a file where a directory belongs");
		const warnings: string[] = [];
		const store = new TaskStore(
			join(root, ".pi", "tasks", "tasks-1.json"),
			(message) => warnings.push(message),
			root,
		);
		expect(store.create("a", "b").id).toBe("1");
		expect(store.file).toBeUndefined();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/could not be checked \(ENOTDIR/);
	});

	it("retries a write whose check could not run, once the check can run again", () => {
		const root = mkdtempSync(join(tmpdir(), "pi-tasks-eacces-"));
		mkdirSync(join(root, ".pi", "tasks"), { recursive: true });
		const file = join(root, ".pi", "tasks", "tasks-1.json");
		const warnings: string[] = [];
		const store = new TaskStore(file, (message) => warnings.push(message), root);
		chmodSync(join(root, ".pi"), 0o000);
		try {
			store.create("kept", "d");
		} finally {
			chmodSync(join(root, ".pi"), 0o755);
		}
		expect(store.file).toBeUndefined();
		expect(warnings[0]).toContain("could not be checked");
		expect(store.retryWrite()).toBe(true);
		expect(JSON.parse(readFileSync(file, "utf8")).tasks[0].subject).toBe("kept");
	});
});

describe("the task store", () => {
	it("numbers tasks from 1, keeps the subject as given and starts each task pending with no edges", () => {
		const store = new TaskStore(undefined, () => {});
		const first = store.create("   ", "d");
		const second = store.create("b", "e", "Doing b", { agentType: "Explore" });
		expect(first).toMatchObject({
			id: "1",
			subject: "   ",
			description: "d",
			status: "pending",
			metadata: {},
			blocks: [],
			blockedBy: [],
		});
		expect(first.activeForm).toBeUndefined();
		expect(first.owner).toBeUndefined();
		expect(second).toMatchObject({ id: "2", activeForm: "Doing b", metadata: { agentType: "Explore" } });
	});

	it("never reuses an id, a deleted one included", () => {
		const store = new TaskStore(undefined, () => {});
		for (const subject of ["a", "b", "c"]) store.create(subject, "d");
		store.delete("3");
		store.update("2", { status: "deleted" });
		expect(store.create("d", "d").id).toBe("4");
	});

	it("finds a task by id, answers undefined for a missing one, and lists every task in numeric id order", () => {
		const store = new TaskStore(undefined, () => {});
		for (let n = 1; n <= 12; n++) store.create(`task ${n}`, "d");
		expect(store.get("5")?.subject).toBe("task 5");
		expect(store.get("99")).toBeUndefined();
		expect(store.list().map((task) => task.id)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
	});

	it("updates status, subject, description, activeForm and owner, reports them in that order and bumps updatedAt", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(1000);
		const store = new TaskStore(undefined, () => {});
		const task = store.create("a", "b");
		vi.setSystemTime(2000);
		const result = store.update(task.id, {
			owner: "me",
			activeForm: "Doing",
			description: "new",
			subject: "renamed",
			status: "in_progress",
		});
		expect(result.changedFields).toEqual(["status", "subject", "description", "activeForm", "owner"]);
		expect(result.warnings).toEqual([]);
		expect(store.get(task.id)).toMatchObject({
			status: "in_progress",
			subject: "renamed",
			description: "new",
			activeForm: "Doing",
			owner: "me",
			createdAt: 1000,
			updatedAt: 2000,
		});
	});

	it("changes nothing and reports no field for an unknown id", () => {
		const store = new TaskStore(undefined, () => {});
		store.create("a", "b");
		const before = structuredClone(store.snapshot());
		expect(store.update("9", { status: "completed", subject: "x" })).toEqual({
			task: undefined,
			changedFields: [],
			warnings: [],
		});
		expect(store.snapshot()).toEqual(before);
	});

	it("merges metadata shallowly and deletes a key set to null", () => {
		const store = new TaskStore(undefined, () => {});
		store.create("a", "b", undefined, { keep: 1, drop: 2, nested: { x: 1 } });
		const result = store.update("1", { metadata: { drop: null, added: 3, nested: { y: 2 } } });
		expect(result.changedFields).toEqual(["metadata"]);
		expect(store.get("1")?.metadata).toEqual({ keep: 1, added: 3, nested: { y: 2 } });
	});

	it("sets both edges of addBlocks and addBlockedBy once each", () => {
		const store = new TaskStore(undefined, () => {});
		for (const subject of ["a", "b", "c"]) store.create(subject, "d");
		const result = store.update("1", { addBlocks: ["2", "2"] });
		expect(result).toMatchObject({ changedFields: ["blocks"], warnings: [] });
		store.update("1", { addBlocks: ["2"] });
		expect(store.update("3", { addBlockedBy: ["1", "1"] }).changedFields).toEqual(["blockedBy"]);
		store.update("3", { addBlockedBy: ["1"] });
		expect(store.get("1")).toMatchObject({ blocks: ["2", "3"], blockedBy: [] });
		expect(store.get("2")).toMatchObject({ blocks: [], blockedBy: ["1"] });
		expect(store.get("3")).toMatchObject({ blocks: [], blockedBy: ["1"] });
	});

	it("warns for a self edge, a missing task and a cycle, and still records the edge", () => {
		const store = new TaskStore(undefined, () => {});
		store.create("a", "d");
		store.create("b", "d");
		expect(store.update("1", { addBlocks: ["1", "9"] }).warnings).toEqual(["#1 blocks itself", "#9 does not exist"]);
		expect(store.get("1")?.blocks).toEqual(["1", "9"]);
		expect(store.update("1", { addBlocks: ["2"] }).warnings).toEqual([]);
		expect(store.update("2", { addBlocks: ["1"] }).warnings).toEqual(["cycle: #2 and #1 block each other"]);
		expect(store.get("2")?.blocks).toEqual(["1"]);
		expect(store.update("2", { addBlockedBy: ["2", "8"] }).warnings).toEqual([
			"#2 blocks itself",
			"#8 does not exist",
		]);
		expect(store.get("2")?.blockedBy).toEqual(["1", "2", "8"]);
		expect(store.update("2", { addBlockedBy: ["1"] }).warnings).toEqual(["cycle: #2 and #1 block each other"]);
		expect(store.get("2")?.blockedBy).toEqual(["1", "2", "8"]);
	});

	it("removes tasks with every edge that points at them through deleted, delete, clearCompleted and clearAll", () => {
		const store = new TaskStore(undefined, () => {});
		for (const subject of ["a", "b", "c", "d", "e"]) store.create(subject, "d");
		store.update("1", { addBlocks: ["2", "3"] });
		store.update("4", { addBlockedBy: ["2"] });
		expect(store.update("2", { status: "deleted" })).toEqual({
			task: undefined,
			changedFields: ["deleted"],
			warnings: [],
		});
		expect(store.get("2")).toBeUndefined();
		expect(store.get("1")?.blocks).toEqual(["3"]);
		expect(store.get("4")?.blockedBy).toEqual([]);
		expect(store.delete("3")).toBe(true);
		expect(store.delete("3")).toBe(false);
		expect(store.get("1")?.blocks).toEqual([]);
		store.update("5", { addBlockedBy: ["1"] });
		store.update("1", { status: "completed" });
		store.update("4", { status: "completed" });
		expect(store.clearCompleted()).toBe(2);
		expect(store.list().map((task) => task.id)).toEqual(["5"]);
		expect(store.get("5")?.blockedBy).toEqual([]);
		expect(store.clearCompleted()).toBe(0);
		store.create("f", "d");
		expect(store.clearAll()).toBe(2);
		expect(store.list()).toEqual([]);
	});

	it("writes pi-tasks' format after every change, creates its directory at the first change, and reopens the same list", () => {
		const root = tempDir("pi-tasks-format-");
		const file = join(root, ".pi", "tasks", "tasks-1.json");
		const store = new TaskStore(file, () => {}, root);
		expect(existsSync(join(root, ".pi"))).toBe(false);
		const task = store.create("a", "b");
		expect(readFileSync(file, "utf8")).toBe(JSON.stringify({ nextId: 2, tasks: [task] }, null, 2));
		store.update("1", { status: "in_progress" });
		expect(JSON.parse(readFileSync(file, "utf8")).tasks[0].status).toBe("in_progress");
		store.update("1", { status: "completed" });
		store.create("c", "d");
		const reopened = new TaskStore(file, () => {}, root);
		expect(reopened.list()).toEqual(store.list());
		expect(reopened.get("1")?.status).toBe("completed");
		expect(reopened.create("e", "f").id).toBe("3");
	});

	it("resumes an old pi-tasks file: fills missing fields, replaces wrong types, skips records without a string id and repairs nextId", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(9000);
		const root = tempDir("pi-tasks-legacy-");
		const file = join(root, "tasks-1.json");
		writeFileSync(
			file,
			JSON.stringify({
				nextId: 2,
				tasks: [
					{ id: "1", subject: "no edges", description: "d", status: "pending" },
					{
						id: "7",
						subject: "wrong types",
						description: "d",
						status: "completed",
						metadata: ["x"],
						blocks: "2",
						blockedBy: null,
						createdAt: "yesterday",
						updatedAt: 5,
					},
					{ id: 30, subject: "numeric id" },
					null,
					"text",
				],
			}),
		);
		const store = new TaskStore(file, () => {}, root);
		expect(store.list().map((task) => task.id)).toEqual(["1", "7"]);
		expect(store.get("1")).toMatchObject({
			metadata: {},
			blocks: [],
			blockedBy: [],
			createdAt: 9000,
			updatedAt: 9000,
		});
		expect(store.get("7")).toMatchObject({ metadata: {}, blocks: [], blockedBy: [], createdAt: 9000, updatedAt: 5 });
		expect(store.create("new", "d").id).toBe("8");

		let files = 1;
		const ids = (data: unknown) => {
			const path = join(root, `tasks-${++files}.json`);
			writeFileSync(path, JSON.stringify(data));
			return new TaskStore(path, () => {}, root).create("next", "d").id;
		};
		expect(ids({ tasks: [{ id: "4", subject: "s", description: "d", status: "pending" }] })).toBe("5");
		expect(ids({ tasks: [] })).toBe("1");
		expect(ids({ nextId: 10, tasks: [{ id: "4", subject: "s", description: "d", status: "pending" }] })).toBe("10");
		expect(ids({ nextId: 4, tasks: [{ id: "4", subject: "s", description: "d", status: "pending" }] })).toBe("5");
	});

	it("leaves the saved file as it was when a later write fails, and keeps later changes in memory", () => {
		const root = tempDir("pi-tasks-later-");
		const file = join(root, "tasks-1.json");
		const warnings: string[] = [];
		const store = new TaskStore(file, (message) => warnings.push(message), root);
		store.create("saved", "d");
		const before = readFileSync(file, "utf8");
		chmodSync(root, 0o555);
		try {
			store.create("unsaved", "d");
			store.update("1", { status: "completed" });
		} finally {
			chmodSync(root, 0o755);
		}
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(store.list().map((task) => task.subject)).toEqual(["saved", "unsaved"]);
		expect(store.get("1")?.status).toBe("completed");
		expect(store.file).toBeUndefined();
		expect(warnings).toHaveLength(1);
	});

	it("moves the list to memory when the file cannot be read or holds no tasks array, and never replaces the file", () => {
		const root = tempDir("pi-tasks-unreadable-");
		const noArray = join(root, "tasks-a.json");
		const noArrayText = JSON.stringify({ nextId: 3, tasks: 5 });
		writeFileSync(noArray, noArrayText);
		const unreadable = join(root, "tasks-b.json");
		writeFileSync(unreadable, "{}");
		const warnings: string[] = [];
		const a = new TaskStore(noArray, (message) => warnings.push(message), root);
		expect(a.create("x", "d").id).toBe("1");
		expect(a.retryWrite()).toBe(false);
		chmodSync(unreadable, 0o000);
		try {
			const b = new TaskStore(unreadable, (message) => warnings.push(message), root);
			expect(b.create("y", "d").id).toBe("1");
			expect(b.retryWrite()).toBe(false);
			expect(b.file).toBeUndefined();
		} finally {
			chmodSync(unreadable, 0o644);
		}
		expect(readFileSync(noArray, "utf8")).toBe(noArrayText);
		expect(readFileSync(unreadable, "utf8")).toBe("{}");
		expect(warnings).toEqual([
			memoryWarning(`${noArray} is not a task list (no tasks array)`),
			expect.stringMatching(/^Tasks are not saved: .*tasks-b\.json could not be read \(EACCES/),
		]);
	});

	it("saves later changes to the file again after a retried write succeeds", () => {
		const root = tempDir("pi-tasks-retry-later-");
		const file = join(root, "tasks-1.json");
		chmodSync(root, 0o555);
		const store = new TaskStore(file, () => {}, root);
		try {
			store.create("first", "d");
		} finally {
			chmodSync(root, 0o755);
		}
		expect(store.retryWrite()).toBe(true);
		store.create("second", "d");
		store.update("1", { status: "completed" });
		const saved = JSON.parse(readFileSync(file, "utf8"));
		expect(saved.tasks.map((task: { subject: string }) => task.subject)).toEqual(["first", "second"]);
		expect(saved.tasks[0].status).toBe("completed");
	});

	it("seeds only an empty store, with copies, from a snapshot that holds the list as the file does", () => {
		const parent = new TaskStore(undefined, () => {});
		parent.create("a", "d");
		parent.create("b", "d");
		parent.delete("2");
		const snapshot = parent.snapshot();
		expect(snapshot).toEqual({ nextId: 3, tasks: [parent.get("1")] });
		const root = tempDir("pi-tasks-seed-");
		const file = join(root, "tasks-2.json");
		const child = new TaskStore(file, () => {}, root);
		child.seed(snapshot);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(snapshot)));
		child.update("1", { subject: "changed in the child" });
		expect(parent.get("1")?.subject).toBe("a");
		expect(child.create("c", "d").id).toBe("3");
		const busy = new TaskStore(undefined, () => {});
		busy.create("own", "d");
		busy.seed(snapshot);
		expect(busy.list().map((task) => task.subject)).toEqual(["own"]);
	});

	it("deletes the file of an empty file-backed list only", () => {
		const root = tempDir("pi-tasks-empty-");
		const file = join(root, "tasks-1.json");
		const store = new TaskStore(file, () => {}, root);
		store.create("a", "d");
		expect(store.deleteFileIfEmpty()).toBe(false);
		store.update("1", { status: "completed" });
		store.create("b", "d");
		expect(store.clearCompleted()).toBe(1);
		expect(store.deleteFileIfEmpty()).toBe(false);
		expect(existsSync(file)).toBe(true);
		store.clearAll();
		expect(store.deleteFileIfEmpty()).toBe(true);
		expect(existsSync(file)).toBe(false);
		expect(new TaskStore(undefined, () => {}).deleteFileIfEmpty()).toBe(false);
		store.create("c", "d");
		expect(existsSync(file)).toBe(true);
	});

	it("refuses a symlinked task file and reads, writes and deletes nothing through it (D52)", () => {
		const root = tempDir("pi-tasks-filelink-");
		const outside = tempDir("pi-tasks-outside-");
		const outsideFile = join(outside, "tasks.json");
		const outsideText = JSON.stringify({
			nextId: 2,
			tasks: [{ id: "1", subject: "outside", description: "d", status: "pending" }],
		});
		writeFileSync(outsideFile, outsideText);
		mkdirSync(join(root, ".pi", "tasks"), { recursive: true });
		const file = join(root, ".pi", "tasks", "tasks-1.json");
		symlinkSync(outsideFile, file);
		const warnings: string[] = [];
		const store = new TaskStore(file, (message) => warnings.push(message), root);
		expect(store.list()).toEqual([]);
		store.create("inside", "d");
		store.clearAll();
		expect(store.deleteFileIfEmpty()).toBe(false);
		expect(readFileSync(outsideFile, "utf8")).toBe(outsideText);
		expect(lstatSync(file).isSymbolicLink()).toBe(true);
		expect(warnings).toEqual([memoryWarning(`${file} is a symlink`)]);
	});

	it("accepts a project root that is itself a symlink", () => {
		const real = tempDir("pi-tasks-real-");
		const root = join(tempDir("pi-tasks-holder-"), "project");
		symlinkSync(real, root);
		const file = join(root, ".pi", "tasks", "tasks-1.json");
		const warnings: string[] = [];
		const store = new TaskStore(file, (message) => warnings.push(message), root);
		store.create("a", "d");
		expect(store.file).toBe(file);
		expect(warnings).toEqual([]);
		expect(existsSync(join(real, ".pi", "tasks", "tasks-1.json"))).toBe(true);
	});

	it("retries a path whose check could not run at open, and never replaces a file it never read", () => {
		const root = tempDir("pi-tasks-open-check-");
		writeFileSync(join(root, ".pi"), "a file where a directory belongs");
		const file = join(root, ".pi", "tasks", "tasks-1.json");
		const store = new TaskStore(file, () => {}, root);
		store.create("kept", "d");
		expect(store.retryWrite()).toBe(false);
		rmSync(join(root, ".pi"));
		expect(store.retryWrite()).toBe(true);
		expect(JSON.parse(readFileSync(file, "utf8")).tasks[0].subject).toBe("kept");

		const other = tempDir("pi-tasks-open-unread-");
		mkdirSync(join(other, ".pi", "tasks"), { recursive: true });
		const existing = join(other, ".pi", "tasks", "tasks-1.json");
		const existingText = JSON.stringify({
			nextId: 2,
			tasks: [{ id: "1", subject: "s", description: "d", status: "pending" }],
		});
		writeFileSync(existing, existingText);
		const warnings: string[] = [];
		chmodSync(join(other, ".pi"), 0o000);
		let unread: TaskStore;
		try {
			unread = new TaskStore(existing, (message) => warnings.push(message), other);
		} finally {
			chmodSync(join(other, ".pi"), 0o755);
		}
		unread.create("new", "d");
		expect(unread.retryWrite()).toBe(false);
		expect(readFileSync(existing, "utf8")).toBe(existingText);
		expect(warnings).toEqual([
			expect.stringContaining("could not be checked"),
			memoryWarning(`${existing} changed outside this session`),
		]);
	});

	it("never recreates a file another process deleted, and leaves a changed file to its writer (D53)", () => {
		const root = tempDir("pi-tasks-gone-");
		const file = join(root, "tasks-1.json");
		const warnings: string[] = [];
		const store = new TaskStore(file, (message) => warnings.push(message), root);
		store.create("a", "d");
		unlinkSync(file);
		store.create("b", "d");
		expect(existsSync(file)).toBe(false);
		expect(store.file).toBeUndefined();
		expect(store.retryWrite()).toBe(false);
		expect(existsSync(file)).toBe(false);
		expect(store.list()).toHaveLength(2);

		const other = join(root, "tasks-2.json");
		const second = new TaskStore(other, (message) => warnings.push(message), root);
		second.create("x", "d");
		second.delete("1");
		writeFileSync(other, "changed by another process");
		expect(second.deleteFileIfEmpty()).toBe(false);
		expect(readFileSync(other, "utf8")).toBe("changed by another process");
		expect(warnings).toEqual([
			memoryWarning(`${file} changed outside this session`),
			memoryWarning(`${other} changed outside this session`),
		]);
	});
});
