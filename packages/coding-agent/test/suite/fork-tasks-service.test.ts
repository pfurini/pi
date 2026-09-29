/**
 * Fork-owned: the task base tools' registration and the task service on real sessions (plan T2).
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { type Context, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionEvent } from "../../src/core/agent-session.ts";
import { type TaskEvent, TaskService } from "../../src/core/fork-builtins/tasks/service/service.ts";
import { existingTaskService, taskServiceFor } from "../../src/core/fork-builtins/tasks/service/sessions.ts";
import { TASK_CREATE_GUIDELINES } from "../../src/core/fork-builtins/tasks/tools/descriptions.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { call, text } from "./fork-subagents-fixtures.ts";
import { TASK_TOOLS, taskSession } from "./fork-tasks-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
const dirs: string[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

async function session(...args: Parameters<typeof taskSession>): Promise<Harness> {
	const harness = await taskSession(...args);
	harnesses.push(harness);
	return harness;
}

/** A task service on a fake session that holds only what the service reads. */
function service(manager: SessionManager): TaskService {
	return new TaskService({
		sessionManager: manager,
		settingsManager: SettingsManager.inMemory(),
		subscribe: () => () => {},
		getActiveToolNames: () => [],
		sessionId: manager.getSessionId(),
		sessionFile: manager.getSessionFile(),
	} as unknown as AgentSession);
}

describe("the task service", () => {
	it("registers the task tools as active fork base tools", async () => {
		const harness = await session();
		const active = harness.session.getActiveToolNames();
		for (const name of TASK_TOOLS) expect(active).toContain(name);
	});

	it("is never built by existingTaskService", async () => {
		const harness = await session();
		expect(existingTaskService(harness.session)).toBeUndefined();
	});

	it("hands a fork of an unsaved session its list, which shares the parent's session manager", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-fork-memory-"));
		const manager = SessionManager.inMemory(cwd);
		const parent = service(manager);
		parent.create("carry me", "d");
		const unrelated = service(SessionManager.inMemory(cwd));
		unrelated.create("unrelated task", "d");
		parent.dispose();
		unrelated.dispose();
		const fork = service(manager);
		fork.onSessionStart("fork", undefined);
		expect(fork.list().map((task) => task.subject)).toEqual(["carry me"]);
	});

	it("hands a fork its parent's list even when another saved session ends first", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-fork-"));
		const parentManager = SessionManager.create(cwd, join(cwd, "sessions"));
		const parent = service(parentManager);
		parent.create("parent task", "d");
		const unrelated = service(SessionManager.create(cwd, join(cwd, "sessions")));
		unrelated.create("unrelated task", "d");
		parent.dispose();
		unrelated.dispose();
		const fork = service(SessionManager.create(cwd, join(cwd, "sessions")));
		fork.onSessionStart("fork", parentManager.getSessionFile());
		expect(fork.list().map((task) => task.subject)).toEqual(["parent task"]);
	});

	it("saves the list of a session Pi saves in <cwd>/.pi/tasks, and none of an in-memory session", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-file-"));
		const saved = SessionManager.create(cwd, join(cwd, "sessions"));
		const tasks = service(saved);
		tasks.create("persisted", "d");
		const file = join(cwd, ".pi", "tasks", `tasks-${saved.getSessionId()}.json`);
		expect(tasks.file).toBe(file);
		expect(JSON.parse(readFileSync(file, "utf8")).tasks[0].subject).toBe("persisted");
		const memory = service(SessionManager.inMemory(cwd));
		memory.create("not saved", "d");
		expect(memory.file).toBeUndefined();
		expect(existsSync(join(cwd, ".pi", "tasks", `tasks-${memory.session.sessionId}.json`))).toBe(false);
	});
});

/** A fake session the test drives: its events, its active tools and its settings. */
function fakeSession(
	manager: SessionManager,
	settingsManager: SettingsManager = SettingsManager.inMemory(),
	active: string[] = [],
) {
	const listeners = new Set<(event: AgentSessionEvent) => void>();
	const session = {
		sessionManager: manager,
		settingsManager,
		subscribe: (listener: (event: AgentSessionEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getActiveToolNames: () => active,
		sessionId: manager.getSessionId(),
		sessionFile: manager.getSessionFile(),
	} as unknown as AgentSession;
	const emit = (event: Record<string, unknown>) => {
		for (const listener of [...listeners]) listener(event as unknown as AgentSessionEvent);
	};
	/** One model turn, with the tool it ran, if any. */
	const turn = (toolName?: string) => {
		emit({ type: "turn_start" });
		if (toolName) emit({ type: "tool_execution_end", toolName });
		emit({ type: "turn_end", message: { role: "assistant" } });
	};
	return { session, active, emit, turn, service: () => new TaskService(session) };
}

/** A workspace whose sessions Pi saves, with settings files the test may change. */
function workspace(tasks: Record<string, unknown> = {}) {
	const cwd = tempDir("pi-tasks-ws-");
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir);
	const setTasks = (values: Record<string, unknown>) =>
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ forkBuiltins: { tasks: values } }));
	setTasks(tasks);
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const saved = () => SessionManager.create(cwd, join(cwd, "sessions"));
	const taskFile = (manager: SessionManager) => join(cwd, ".pi", "tasks", `tasks-${manager.getSessionId()}.json`);
	return { cwd, settingsManager, setTasks, saved, taskFile };
}

const subjects = (tasks: TaskService) => tasks.list().map((task) => task.subject);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("the task tools", () => {
	it("registers no task tool when PI_FORK_BUILTINS=off", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const harness = await createHarness();
		harnesses.push(harness);
		const names = harness.session.getAllTools().map((info) => info.name);
		for (const name of TASK_TOOLS) expect(names).not.toContain(name);
		expect(taskServiceFor(harness.session)).toBeUndefined();
	});

	it("never activates a caller's base tool of the same name", async () => {
		const callers = {
			name: "TaskList",
			label: "Caller's tool",
			description: "A caller's own tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text" as const, text: "caller" }], details: {} }),
		};
		const harness = await session({}, { tools: [callers], initialActiveToolNames: [] });
		expect(harness.session.getAllTools().some((info) => info.name === "TaskList")).toBe(true);
		expect(harness.session.getActiveToolNames()).not.toContain("TaskList");
		expect(harness.session.getActiveToolNames()).toContain("TaskCreate");
	});

	it("TaskCreate answers with the new task, stores agentType as metadata and merges the metadata", async () => {
		const harness = await session();
		expect(text(await call(harness, "TaskCreate", { subject: "Write docs", description: "d" }))).toBe(
			"Task #1 created successfully: Write docs",
		);
		const created = await call(harness, "TaskCreate", {
			subject: "Run agent",
			description: "d",
			activeForm: "Running agent",
			agentType: "Explore",
			metadata: { priority: 1 },
		});
		expect(text(created)).toBe("Task #2 created successfully: Run agent");
		const tasks = existingTaskService(harness.session);
		expect(tasks?.get("1")?.metadata).toEqual({});
		expect(tasks?.get("2")).toMatchObject({
			activeForm: "Running agent",
			metadata: { priority: 1, agentType: "Explore" },
		});
	});

	it("sends the model Claude Code's task tool descriptions and TaskCreate's prompt guidelines verbatim", async () => {
		const harness = await session();
		let request: Context | undefined;
		harness.setResponses([
			(context: Context) => {
				request = context;
				return fauxAssistantMessage("ok");
			},
		]);
		await harness.session.prompt("hello");
		const tools = new Map(getCurrentTools(request?.messages ?? []).map((tool) => [tool.name, tool.description]));
		// SHA-256 of the texts in pi-tasks `src/index.ts` at 83480bd, which copies Claude Code's tools.
		expect(sha(tools.get("TaskCreate") ?? "")).toBe(
			"016220f44f67900e4a9e591c3cce2b7af97a4a49a4fe689c65e844b5e403328f",
		);
		expect(sha(tools.get("TaskList") ?? "")).toBe("b0add1533ad84f5758fcb5a9e89eecb3893c4186a21b513fa7259d9abcf61981");
		expect(sha(tools.get("TaskGet") ?? "")).toBe("31f71d8dcbf849682ef19d923c450d8f057ad7a8ac8f0ad7982c149e09a7c9b6");
		expect(sha(tools.get("TaskUpdate") ?? "")).toBe(
			"08ec7119069f85c2d8149dc1c8ae2894651f194b16ad122f863a74e2471ab204",
		);
		expect(sha(TASK_CREATE_GUIDELINES.join("\n"))).toBe(
			"2366faf9161c5017a3b87926435471fb82ed2a4ac2f3348ad8f9fcb1b42dd72b",
		);
		const systemPrompt = getCurrentSystemPrompt(request?.messages ?? []);
		for (const guideline of TASK_CREATE_GUIDELINES) expect(systemPrompt).toContain(guideline);
	});

	it("TaskList answers No tasks found, or pending, in-progress and completed tasks with owners and open blockers", async () => {
		const harness = await session();
		expect(text(await call(harness, "TaskList", {}))).toBe("No tasks found");
		for (const subject of ["done", "working", "waiting", "blocked by done"]) {
			await call(harness, "TaskCreate", { subject, description: "d" });
		}
		await call(harness, "TaskUpdate", { taskId: "1", status: "completed" });
		await call(harness, "TaskUpdate", { taskId: "2", status: "in_progress", owner: "agent-1" });
		await call(harness, "TaskUpdate", { taskId: "3", addBlockedBy: ["2"] });
		await call(harness, "TaskUpdate", { taskId: "4", addBlockedBy: ["1"] });
		expect(text(await call(harness, "TaskList", {})).split("\n")).toEqual([
			"#3 [pending] waiting [blocked by #2]",
			"#4 [pending] blocked by done",
			"#2 [in_progress] working (agent-1)",
			"#1 [completed] done",
		]);
	});

	it("TaskGet answers Task not found, or the task's fields, open blockers, blocks and metadata", async () => {
		const harness = await session();
		expect(text(await call(harness, "TaskGet", { taskId: "1" }))).toBe("Task not found");
		await call(harness, "TaskCreate", { subject: "first", description: "d" });
		await call(harness, "TaskCreate", { subject: "second", description: "d" });
		await call(harness, "TaskCreate", {
			subject: "Main",
			description: "line one\\nline two",
			agentType: "Explore",
		});
		await call(harness, "TaskCreate", { subject: "after", description: "d" });
		await call(harness, "TaskUpdate", { taskId: "3", owner: "me", addBlockedBy: ["1", "2"], addBlocks: ["4"] });
		await call(harness, "TaskUpdate", { taskId: "1", status: "completed" });
		expect(text(await call(harness, "TaskGet", { taskId: "3" })).split("\n")).toEqual([
			"Task #3: Main",
			"Status: pending",
			"Owner: me",
			"Description: line one",
			"line two",
			"Blocked by: #2",
			"Blocks: #4",
			'Metadata: {"agentType":"Explore"}',
		]);
		expect(text(await call(harness, "TaskGet", { taskId: "1" })).split("\n")).toEqual([
			"Task #1: first",
			"Status: completed",
			"Description: d",
			"Blocks: #3",
		]);
	});

	it("TaskUpdate answers the changed fields with warnings, or Task not found, and deleted removes the task", async () => {
		const harness = await session();
		await call(harness, "TaskCreate", { subject: "a", description: "d" });
		await call(harness, "TaskCreate", { subject: "b", description: "d" });
		expect(text(await call(harness, "TaskUpdate", { taskId: "1", status: "in_progress", owner: "me" }))).toBe(
			"Updated task #1 status, owner",
		);
		expect(text(await call(harness, "TaskUpdate", { taskId: "1", addBlocks: ["1", "7"] }))).toBe(
			"Updated task #1 blocks (warning: #1 blocks itself; #7 does not exist)",
		);
		expect(text(await call(harness, "TaskUpdate", { taskId: "9", status: "completed" }))).toBe("Task #9 not found");
		expect(text(await call(harness, "TaskUpdate", { taskId: "2", status: "deleted" }))).toBe(
			"Updated task #2 deleted",
		);
		expect(text(await call(harness, "TaskGet", { taskId: "2" }))).toBe("Task not found");
	});
});

describe("the task service's storage", () => {
	it("saves the list in the session's workspace, never in the agent directory, keyed by cwd and session id", () => {
		const first = workspace();
		const second = workspace();
		const manager = first.saved();
		const tasks = fakeSession(manager, first.settingsManager).service();
		tasks.create("in the first workspace", "d");
		expect(tasks.file).toBe(first.taskFile(manager));
		expect(existsSync(join(first.cwd, "agent", ".pi"))).toBe(false);
		const twin = SessionManager.create(second.cwd, join(second.cwd, "sessions"), { id: manager.getSessionId() });
		expect(twin.getSessionId()).toBe(manager.getSessionId());
		const other = fakeSession(twin, second.settingsManager).service();
		other.create("in the second workspace", "d");
		expect(other.file).toBe(second.taskFile(twin));
		expect(JSON.parse(readFileSync(first.taskFile(manager), "utf8")).tasks[0].subject).toBe("in the first workspace");
		expect(JSON.parse(readFileSync(second.taskFile(twin), "utf8")).tasks[0].subject).toBe("in the second workspace");
	});

	it("saves nothing under taskScope memory, and a changed taskScope takes effect at the next session", async () => {
		const ws = workspace({ taskScope: "memory" });
		const manager = ws.saved();
		const memory = fakeSession(manager, ws.settingsManager).service();
		memory.create("kept in memory", "d");
		expect(memory.file).toBeUndefined();
		ws.setTasks({ taskScope: "session" });
		await ws.settingsManager.reload();
		memory.onSessionStart("reload");
		memory.create("still in memory", "d");
		expect(memory.file).toBeUndefined();
		expect(existsSync(join(ws.cwd, ".pi"))).toBe(false);
		const next = fakeSession(ws.saved(), ws.settingsManager).service();
		next.create("saved", "d");
		expect(next.file).toBeDefined();
		expect(existsSync(next.file ?? "")).toBe(true);
	});
});

describe("the task service's reminder", () => {
	it("gives a due reminder only while TaskCreate is active", () => {
		const fake = fakeSession(SessionManager.inMemory(tempDir("pi-tasks-rem-")));
		const tasks = fake.service();
		tasks.create("a", "d");
		for (let i = 0; i < 3; i++) fake.turn("read");
		expect(tasks.takeReminder()).toBeUndefined();
		fake.turn("read");
		expect(tasks.takeReminder()).toBeUndefined();
		fake.active.push("TaskCreate");
		expect(tasks.takeReminder()).toContain('"content":"a"');
		expect(tasks.takeReminder()).toBeUndefined();
		fake.turn("TaskList");
		for (let i = 0; i < 4; i++) fake.turn("read");
		expect(tasks.takeReminder()).toContain("<system-reminder>");
	});
});

describe("the task service's auto-clear and files", () => {
	it("deletes the file of a list that auto-clear, a deletion or a clear empties, and keeps .pi/tasks", () => {
		const ws = workspace();
		const cleared = ws.saved();
		const fake = fakeSession(cleared, ws.settingsManager);
		const tasks = fake.service();
		tasks.create("a", "d");
		fake.turn("TaskCreate");
		tasks.update("1", { status: "completed" });
		for (let i = 0; i < 3; i++) fake.turn();
		expect(existsSync(ws.taskFile(cleared))).toBe(true);
		fake.turn();
		expect(tasks.list()).toEqual([]);
		expect(existsSync(ws.taskFile(cleared))).toBe(false);
		expect(existsSync(join(ws.cwd, ".pi", "tasks"))).toBe(true);

		const deleted = ws.saved();
		const byDeletion = fakeSession(deleted, ws.settingsManager).service();
		byDeletion.create("a", "d");
		byDeletion.update("1", { status: "deleted" });
		expect(existsSync(ws.taskFile(deleted))).toBe(false);

		const clearing = ws.saved();
		const byClear = fakeSession(clearing, ws.settingsManager).service();
		byClear.create("a", "d");
		byClear.create("b", "d");
		byClear.update("1", { status: "completed" });
		expect(byClear.clearCompleted()).toBe(1);
		expect(existsSync(ws.taskFile(clearing))).toBe(true);
		expect(byClear.clearAll()).toBe(1);
		expect(existsSync(ws.taskFile(clearing))).toBe(false);
		expect(existsSync(join(ws.cwd, ".pi", "tasks"))).toBe(true);
	});
});

describe("the task service's batches", () => {
	it("retires a list an earlier run finished when a later run creates a task, and keeps it under never", () => {
		for (const [mode, expected] of [
			["on_list_complete", ["b"]],
			["never", ["a", "b"]],
		] as const) {
			const ws = workspace({ autoClearCompleted: mode });
			const fake = fakeSession(ws.saved(), ws.settingsManager);
			const tasks = fake.service();
			tasks.create("a", "d");
			tasks.update("1", { status: "completed" });
			fake.emit({ type: "agent_settled" });
			tasks.create("b", "d");
			expect(subjects(tasks), mode).toEqual(expected);
		}
	});
});

describe("the task service at session start", () => {
	it.each(["startup", "new"] as const)("clears an all-completed list at %s and deletes its file", (reason) => {
		const ws = workspace();
		const manager = ws.saved();
		const before = fakeSession(manager, ws.settingsManager).service();
		before.create("a", "d");
		before.update("1", { status: "completed" });
		const after = fakeSession(manager, ws.settingsManager).service();
		after.onSessionStart(reason);
		expect(after.list()).toEqual([]);
		expect(existsSync(ws.taskFile(manager))).toBe(false);
		expect(existsSync(join(ws.cwd, ".pi", "tasks"))).toBe(true);

		const partial = ws.saved();
		const open = fakeSession(partial, ws.settingsManager).service();
		open.create("done", "d");
		open.create("open", "d");
		open.update("1", { status: "completed" });
		const reopened = fakeSession(partial, ws.settingsManager).service();
		reopened.onSessionStart(reason);
		expect(subjects(reopened)).toEqual(["done", "open"]);
	});

	it.each(["resume", "fork", "reload"] as const)(
		"keeps an all-completed list at %s and treats it as a finished run",
		(reason) => {
			const ws = workspace();
			const manager = ws.saved();
			const before = fakeSession(manager, ws.settingsManager).service();
			before.create("a", "d");
			before.update("1", { status: "completed" });
			const after = reason === "reload" ? before : fakeSession(manager, ws.settingsManager).service();
			after.onSessionStart(reason);
			expect(subjects(after)).toEqual(["a"]);
			after.create("next batch", "d");
			expect(subjects(after)).toEqual(["next batch"]);
		},
	);

	it("rereads the settings at /reload, so a changed auto-clear mode applies from the next completion and turn", async () => {
		const ws = workspace({ autoClearCompleted: "never" });
		const fake = fakeSession(ws.saved(), ws.settingsManager);
		const tasks = fake.service();
		tasks.create("a", "d");
		tasks.create("b", "d");
		tasks.update("1", { status: "completed" });
		for (let i = 0; i < 5; i++) fake.turn();
		ws.setTasks({ autoClearCompleted: "on_task_complete" });
		await ws.settingsManager.reload();
		tasks.onSessionStart("reload");
		expect(tasks.settings.autoClearCompleted).toBe("on_task_complete");
		tasks.update("2", { status: "completed" });
		for (let i = 0; i < 4; i++) fake.turn();
		expect(subjects(tasks)).toEqual(["a"]);
	});

	it("retries a failed write at /reload", () => {
		const ws = workspace();
		const manager = ws.saved();
		const warnings: string[] = [];
		mkdirSync(join(ws.cwd, ".pi"));
		chmodSync(join(ws.cwd, ".pi"), 0o555);
		const tasks = fakeSession(manager, ws.settingsManager).service();
		tasks.subscribe((event: TaskEvent) => {
			if (event.type === "warning") warnings.push(event.message);
		});
		try {
			tasks.create("kept", "d");
		} finally {
			chmodSync(join(ws.cwd, ".pi"), 0o755);
		}
		expect(tasks.file).toBeUndefined();
		expect(warnings).toHaveLength(1);
		tasks.onSessionStart("reload");
		expect(tasks.file).toBe(ws.taskFile(manager));
		expect(JSON.parse(readFileSync(ws.taskFile(manager), "utf8")).tasks[0].subject).toBe("kept");
	});
});

describe("the task service's fork handoff", () => {
	it("gives a new or resumed session nothing, even when a parent left a list", () => {
		const ws = workspace();
		const parentManager = ws.saved();
		const parent = fakeSession(parentManager, ws.settingsManager).service();
		parent.create("parent task", "d");
		parent.dispose();
		for (const reason of ["new", "resume", "startup"] as const) {
			const other = fakeSession(ws.saved(), ws.settingsManager).service();
			other.onSessionStart(reason, parentManager.getSessionFile());
			expect(other.list()).toEqual([]);
		}
		const memory = SessionManager.inMemory(ws.cwd);
		const unsaved = fakeSession(memory).service();
		unsaved.create("unsaved parent task", "d");
		unsaved.dispose();
		const renewed = fakeSession(memory).service();
		renewed.onSessionStart("new");
		expect(renewed.list()).toEqual([]);
	});

	it("writes the carried list to the fork's own file, independent of its parent", () => {
		const ws = workspace();
		const parentManager = ws.saved();
		const parent = fakeSession(parentManager, ws.settingsManager).service();
		parent.create("shared start", "d");
		parent.dispose();
		const parentText = readFileSync(ws.taskFile(parentManager), "utf8");
		const forkManager = ws.saved();
		const fork = fakeSession(forkManager, ws.settingsManager).service();
		fork.onSessionStart("fork", parentManager.getSessionFile());
		expect(JSON.parse(readFileSync(ws.taskFile(forkManager), "utf8")).tasks[0].subject).toBe("shared start");
		fork.update("1", { subject: "changed in the fork" });
		fork.create("fork only", "d");
		expect(readFileSync(ws.taskFile(parentManager), "utf8")).toBe(parentText);
		expect(subjects(parent)).toEqual(["shared start"]);
		const second = fakeSession(ws.saved(), ws.settingsManager).service();
		second.onSessionStart("fork", parentManager.getSessionFile());
		expect(second.list()).toEqual([]);
	});

	it("hands a fork the list its parent's session left last", () => {
		const ws = workspace({ taskScope: "memory" });
		const parentManager = ws.saved();
		const first = fakeSession(parentManager, ws.settingsManager).service();
		first.create("first end", "d");
		first.dispose();
		const again = fakeSession(parentManager, ws.settingsManager).service();
		again.create("second end", "d");
		again.dispose();
		const fork = fakeSession(ws.saved(), ws.settingsManager).service();
		fork.onSessionStart("fork", parentManager.getSessionFile());
		expect(subjects(fork)).toEqual(["second end"]);
	});

	it("carries a memory-scope list into a fork", () => {
		const ws = workspace({ taskScope: "memory" });
		const parentManager = ws.saved();
		const parent = fakeSession(parentManager, ws.settingsManager).service();
		parent.create("in memory", "d");
		parent.dispose();
		const fork = fakeSession(ws.saved(), ws.settingsManager).service();
		fork.onSessionStart("fork", parentManager.getSessionFile());
		expect(subjects(fork)).toEqual(["in memory"]);
		expect(fork.file).toBeUndefined();
	});
});

describe("the task service's warnings", () => {
	it("holds warnings until the first listener subscribes, and sends each text once", () => {
		const ws = workspace({ maxVisible: 0 });
		const tasks = fakeSession(ws.saved(), ws.settingsManager).service();
		tasks.warn("second warning");
		const first: string[] = [];
		const later: string[] = [];
		tasks.subscribe((event) => {
			if (event.type === "warning") first.push(event.message);
		});
		tasks.subscribe((event) => {
			if (event.type === "warning") later.push(event.message);
		});
		expect(first).toEqual([
			"forkBuiltins.tasks in the global settings.json: maxVisible must be an integer from 1 to 1000; it is ignored.",
			"second warning",
		]);
		expect(later).toEqual([]);
		tasks.warn("second warning");
		tasks.warn("third warning");
		tasks.warn("third warning");
		expect(first.slice(2)).toEqual(["third warning"]);
		expect(later).toEqual(["third warning"]);
	});
});
