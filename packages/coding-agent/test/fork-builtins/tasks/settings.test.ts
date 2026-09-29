/**
 * Fork-owned: task settings under forkBuiltins.tasks (plan T1 cases 13 and 14, D48).
 */
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_TASK_SETTINGS,
	projectTaskValues,
	readTaskSettings,
	sanitizeTaskSettings,
	TASK_SETTING_KEYS,
	type TaskSettings,
	writeProjectTaskSettings,
} from "../../../src/core/fork-builtins/tasks/settings.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";

// A passthrough, so a case can make the atomic writer's rename fail.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<{ renameSync: typeof renameSync }>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	vi.mocked(renameSync).mockClear();
});

function project(global: unknown, projectSettings: unknown): { agentDir: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-task-settings-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	if (global !== undefined) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(global));
	if (projectSettings !== undefined) writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(projectSettings));
	return { agentDir, cwd };
}

const tasks = (values: unknown) => ({ forkBuiltins: { tasks: values } });

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("task settings", () => {
	it("reads the defaults, then the global values, then the project values", () => {
		expect(DEFAULT_TASK_SETTINGS).toEqual({
			taskScope: "session",
			autoClearCompleted: "on_list_complete",
			collapseCompleted: false,
			showAll: false,
			maxVisible: 10,
			sortOrder: "id",
			hiddenAt: "bottom",
		});
		expect(TASK_SETTING_KEYS).toEqual([
			"taskScope",
			"autoClearCompleted",
			"collapseCompleted",
			"showAll",
			"maxVisible",
			"sortOrder",
			"hiddenAt",
		]);
		const empty = project(undefined, undefined);
		expect(readTaskSettings(SettingsManager.create(empty.cwd, empty.agentDir))).toEqual({
			settings: DEFAULT_TASK_SETTINGS,
			warnings: [],
		});
		const { agentDir, cwd } = project(
			tasks({ maxVisible: 5, sortOrder: "recent", taskScope: "memory" }),
			tasks({ maxVisible: 3, hiddenAt: "top" }),
		);
		expect(readTaskSettings(SettingsManager.create(cwd, agentDir))).toEqual({
			settings: {
				...DEFAULT_TASK_SETTINGS,
				maxVisible: 3,
				sortOrder: "recent",
				taskScope: "memory",
				hiddenAt: "top",
			},
			warnings: [],
		});
	});

	it("applies the project values only in a trusted project", () => {
		const { agentDir, cwd } = project(tasks({ maxVisible: 5 }), tasks({ maxVisible: 3, showAll: true }));
		const untrusted = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
		expect(readTaskSettings(untrusted).settings).toEqual({ ...DEFAULT_TASK_SETTINGS, maxVisible: 5 });
		expect(projectTaskValues(untrusted)).toEqual({});
		expect(projectTaskValues(SettingsManager.create(cwd, agentDir))).toEqual({ maxVisible: 3, showAll: true });
	});

	it("drops a wrong type, an out-of-range number, an unknown key and a non-object section, each with one warning", () => {
		const { agentDir, cwd } = project(
			tasks({
				maxVisible: 0,
				showAll: "yes",
				hiddenAt: "middle",
				sortOrder: "custom",
				autoCascade: true,
				collapseCompleted: true,
			}),
			tasks(["not", "an", "object"]),
		);
		const where = "forkBuiltins.tasks in the global settings.json";
		expect(readTaskSettings(SettingsManager.create(cwd, agentDir))).toEqual({
			settings: { ...DEFAULT_TASK_SETTINGS, collapseCompleted: true },
			warnings: [
				`${where}: maxVisible must be an integer from 1 to 1000; it is ignored.`,
				`${where}: showAll must be true or false; it is ignored.`,
				`${where}: hiddenAt must be one of bottom, top; it is ignored.`,
				`${where}: sortOrder must be one of id, status, active, recent, oldest; it is ignored.`,
				`${where}: unknown key autoCascade; it is ignored.`,
				"forkBuiltins.tasks in the project settings.json must be an object; it is ignored.",
			],
		});
		const { values, warnings } = sanitizeTaskSettings(
			{ maxVisible: 1001, taskScope: "project", toString: 1, autoClearCompleted: "never" },
			"project",
		);
		expect(values).toEqual({ autoClearCompleted: "never" });
		expect(warnings).toHaveLength(3);
		expect(sanitizeTaskSettings({ maxVisible: 2.5 }, "global").warnings).toHaveLength(1);
		expect(sanitizeTaskSettings("text", "global").warnings).toHaveLength(1);
	});

	it("writes only forkBuiltins.tasks in the project settings.json, and a new manager reads it back", () => {
		const existing = {
			theme: "dark",
			forkBuiltins: {
				"pi-tokensave": { mode: "prefer" },
				subagents: { maxConcurrent: 3 },
				tasks: { showAll: true },
			},
			packages: ["../x"],
		};
		const { agentDir, cwd } = project(tasks({ maxVisible: 7 }), existing);
		const globalBefore = readFileSync(join(agentDir, "settings.json"), "utf-8");
		writeProjectTaskSettings(cwd, { maxVisible: 4, sortOrder: "active" });
		const written = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"));
		expect(written).toEqual({
			...existing,
			forkBuiltins: { ...existing.forkBuiltins, tasks: { maxVisible: 4, sortOrder: "active" } },
		});
		expect(readFileSync(join(agentDir, "settings.json"), "utf-8")).toBe(globalBefore);
		expect(readTaskSettings(SettingsManager.create(cwd, agentDir)).settings).toEqual({
			...DEFAULT_TASK_SETTINGS,
			maxVisible: 4,
			sortOrder: "active",
		});

		// A project with no settings file and no global values gets one that holds only the section.
		const fresh = project(undefined, undefined);
		rmSync(join(fresh.cwd, ".pi"), { recursive: true });
		writeProjectTaskSettings(fresh.cwd, { taskScope: "memory" });
		expect(JSON.parse(readFileSync(join(fresh.cwd, ".pi", "settings.json"), "utf-8"))).toEqual(
			tasks({ taskScope: "memory" }),
		);
		// A second save of the project's own values plus one key keeps the first value.
		const manager = SettingsManager.create(fresh.cwd, fresh.agentDir);
		writeProjectTaskSettings(fresh.cwd, { ...projectTaskValues(manager), showAll: true });
		expect(readTaskSettings(SettingsManager.create(fresh.cwd, fresh.agentDir)).settings).toEqual({
			...DEFAULT_TASK_SETTINGS,
			taskScope: "memory",
			showAll: true,
		});
	});

	it("refuses a value the reader would drop, naming its key, and leaves settings.json as it was", () => {
		const { cwd } = project(undefined, { theme: "dark", ...tasks({ maxVisible: 3 }) });
		const file = join(cwd, ".pi", "settings.json");
		const hash = sha(file);
		expect(() => writeProjectTaskSettings(cwd, { maxVisible: 0 })).toThrow(
			/^Refusing to write task settings: .*maxVisible must be an integer from 1 to 1000\.$/,
		);
		expect(sha(file)).toBe(hash);
		const unknown = { autoCascade: true } as unknown as Partial<TaskSettings>;
		expect(() => writeProjectTaskSettings(cwd, unknown)).toThrow(/unknown key autoCascade/);
		expect(sha(file)).toBe(hash);
	});

	it("refuses a symlinked .pi or settings.json, and leaves the file byte-identical when the write fails", () => {
		const outside = mkdtempSync(join(tmpdir(), "pi-task-outside-"));
		roots.push(outside);
		const outsideFile = join(outside, "settings.json");
		writeFileSync(outsideFile, JSON.stringify({ theme: "outside" }));
		const hash = sha(outsideFile);
		const linkedDir = project(undefined, undefined);
		rmSync(join(linkedDir.cwd, ".pi"), { recursive: true });
		symlinkSync(outside, join(linkedDir.cwd, ".pi"));
		expect(() => writeProjectTaskSettings(linkedDir.cwd, { showAll: true })).toThrow(
			"Refusing to write task settings through a symlink",
		);
		const linkedFile = project(undefined, undefined);
		symlinkSync(outsideFile, join(linkedFile.cwd, ".pi", "settings.json"));
		expect(() => writeProjectTaskSettings(linkedFile.cwd, { showAll: true })).toThrow(
			"Refusing to write task settings through a symlink",
		);
		expect(sha(outsideFile)).toBe(hash);
		expect(existsSync(join(outside, ".pi"))).toBe(false);

		const { cwd } = project(undefined, { theme: "dark", ...tasks({ maxVisible: 3 }) });
		const file = join(cwd, ".pi", "settings.json");
		const before = sha(file);
		vi.mocked(renameSync).mockImplementationOnce(() => {
			throw new Error("rename failed");
		});
		expect(() => writeProjectTaskSettings(cwd, { maxVisible: 6 })).toThrow("rename failed");
		expect(sha(file)).toBe(before);
		expect(readdirSync(join(cwd, ".pi"))).toEqual(["settings.json"]);
	});
});
