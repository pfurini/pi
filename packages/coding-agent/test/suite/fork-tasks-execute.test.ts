/**
 * Fork-owned: tasks run by subagents through the typed service (plan T3, D19): `TaskExecute`,
 * `TaskOutput` and `TaskStop`, the session's end, and task tools in a child session (D22).
 */
import { getCurrentTools } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { inspectRecord } from "../../src/core/fork-builtins/subagents/service/service.ts";
import { TaskService } from "../../src/core/fork-builtins/tasks/service/service.ts";
import { requireTaskService } from "../../src/core/fork-builtins/tasks/service/sessions.ts";
import { type Behavior, CHILD_START, call, held, notices, say, text, textOf, use } from "./fork-subagents-fixtures.ts";
import { subagentsOf, taskSession, withRouter } from "./fork-tasks-fixtures.ts";
import { getMessageText, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];

afterEach(() => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	vi.unstubAllEnvs();
});

async function session(...args: Parameters<typeof taskSession>): Promise<Harness> {
	const harness = await taskSession(...args);
	harnesses.push(harness);
	return harness;
}

describe("tasks run by subagents", () => {
	it("TaskExecute runs a task through the subagent service, and TaskOutput hands over its result", async () => {
		const harness = withRouter(await session());
		await call(harness, "TaskCreate", { subject: "survey", description: "survey the repo", agentType: "worker" });
		const launched = text(await call(harness, "TaskExecute", { task_ids: ["1"] }));
		expect(launched).toMatch(/^Launched 1 agent\(s\):\n#1 → agent \S+/);
		const tasks = requireTaskService(harness.session);
		const agentId = tasks.get("1")?.metadata.agentId as string;
		const record = subagentsOf(harness).get(agentId);
		expect(record?.mode).toBe("detached-background");
		expect(record?.prompt).toContain('You are executing task #1: "survey"');
		const output = text(await call(harness, "TaskOutput", { task_id: "1", block: true, timeout: 8000 }));
		expect(output).toMatch(/^Task #1 \[completed\]: subagent \S+\n\nreply to You are executing task #1/);
		expect(tasks.get("1")?.status).toBe("completed");
		expect(subagentsOf(harness).get(agentId)?.resultConsumed).toBe(true);
	});

	it("a refused spawn leaves the task pending and names the reason", async () => {
		const harness = withRouter(await session({ subagents: { fallbackSubagent: "none" } }));
		await call(harness, "TaskCreate", { subject: "x", description: "x", agentType: "nope" });
		const result = text(await call(harness, "TaskExecute", { task_ids: ["1"] }));
		expect(result).toMatch(/^Skipped:\n#1: spawn failed: /);
		expect(requireTaskService(harness.session).get("1")?.status).toBe("pending");
	});

	it("TaskStop stops the agent, and the task completes", async () => {
		const hold = held();
		const harness = withRouter(await session(), { survey: [hold.behavior] });
		await call(harness, "TaskCreate", { subject: "survey", description: "survey", agentType: "worker" });
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		const tasks = requireTaskService(harness.session);
		const agentId = tasks.get("1")?.metadata.agentId as string;
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		expect(text(await call(harness, "TaskStop", { task_id: "1" }))).toBe("Task #1 stopped successfully");
		const done = await subagentsOf(harness).waitForResult(agentId);
		expect(done.status).toBe("stopped");
		expect(tasks.get("1")?.status).toBe("completed");
	});

	it("the session's end sends a task whose agent still runs back to pending", async () => {
		const hold = held();
		const harness = withRouter(await session(), { survey: [hold.behavior] });
		await call(harness, "TaskCreate", { subject: "survey", description: "survey", agentType: "worker" });
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		const tasks = requireTaskService(harness.session);
		harness.session.dispose();
		expect(tasks.isDisposed).toBe(true);
		expect(tasks.get("1")?.status).toBe("pending");
		expect(tasks.get("1")?.metadata.lastError).toBe("The session ended before the agent finished.");
	});
});

describe("task tools in a child session (D22)", () => {
	it("reach a child only when its agent names them, and a child's TaskExecute obeys its spawn rights", async () => {
		const seen = new Map<string, string[]>();
		const hold = held();
		const record: Behavior = (context) => {
			const first = context.messages.find((message) => message.role === "user");
			const task = textOf(first?.content).split(" ")[0];
			seen.set(
				task,
				getCurrentTools(context.messages).map((tool) => tool.name),
			);
			return hold.behavior(context);
		};
		const harness = withRouter(await session(), { plain: [record], keeper: [record] });
		const service = subagentsOf(harness);
		const plain = await service.spawn({ type: "worker", prompt: "plain work", description: "p", mode: "detached" });
		const keeper = await service.spawn({ type: "tasker", prompt: "keeper work", description: "k", mode: "detached" });
		await vi.waitFor(() => expect(seen.size).toBe(2), CHILD_START);
		expect(seen.get("plain")).not.toContain("TaskCreate");
		expect(seen.get("keeper")).toEqual(expect.arrayContaining(["TaskCreate", "TaskExecute"]));
		const child = inspectRecord(service, keeper.id)?.child?.session;
		if (!child) throw new Error("no child session");
		const tasks = requireTaskService(child);
		tasks.create("nested", "d", undefined, "worker");
		expect(await tasks.execute(["1"], {})).toMatch(/^Skipped:\n#1: spawn failed: .*has no allowed_subagents/);
		hold.release();
		await service.waitForResult(plain.id);
		await service.waitForResult(keeper.id);
	});
});

/** Creates the tasks with `agentType: worker`; each subject is also the keyword the router matches. */
async function workerTasks(harness: Harness, ...subjects: string[]): Promise<TaskService> {
	for (const subject of subjects) {
		await call(harness, "TaskCreate", { subject, description: `${subject} work`, agentType: "worker" });
	}
	return requireTaskService(harness.session);
}

const agentOf = (tasks: TaskService, id: string) => tasks.get(id)?.metadata.agentId as string;
const failing =
	(message: string): Behavior =>
	() =>
		fauxAssistantMessage([], { stopReason: "error", errorMessage: message });

describe("TaskExecute", () => {
	it("starts one background agent per ready task with the subject, and forwards model, thinking and max_turns", async () => {
		const harness = withRouter(await session({}, { models: [{ id: "faux-main" }, { id: "faux-task" }] }));
		const tasks = await workerTasks(harness, "alpha", "beta");
		const model = harness.models[1];
		const result = text(
			await call(harness, "TaskExecute", {
				task_ids: ["1", "2"],
				model: `${model.provider}/${model.id}`,
				thinking: "low",
				max_turns: 3,
			}),
		);
		const ids = [agentOf(tasks, "1"), agentOf(tasks, "2")];
		expect(result).toBe(
			`Launched 2 agent(s):\n#1 → agent ${ids[0]}\n#2 → agent ${ids[1]}\nUse TaskOutput to check progress. Do not spawn additional agents for these tasks.`,
		);
		for (const [index, id] of ids.entries()) {
			const record = subagentsOf(harness).get(id);
			expect(record).toMatchObject({
				type: "worker",
				mode: "detached-background",
				description: ["alpha", "beta"][index],
			});
			expect(record?.model?.id).toBe(model.id);
			expect(record?.invocation).toMatchObject({ thinking: "low", maxTurns: 3 });
			expect(tasks.get(String(index + 1))).toMatchObject({
				status: "in_progress",
				owner: id,
				metadata: { agentId: id },
			});
		}
		await subagentsOf(harness).waitForResult(ids[1]);
	});

	it("skips a missing, non-pending, untyped or blocked task, and answers No tasks to execute. when nothing is ready", async () => {
		const harness = withRouter(await session());
		const tasks = await workerTasks(harness, "done", "ready", "blocked", "working");
		await call(harness, "TaskCreate", { subject: "untyped", description: "d" });
		await call(harness, "TaskUpdate", { taskId: "1", status: "completed" });
		await call(harness, "TaskUpdate", { taskId: "4", status: "in_progress" });
		await call(harness, "TaskUpdate", { taskId: "2", addBlockedBy: ["1"] });
		await call(harness, "TaskUpdate", { taskId: "3", addBlockedBy: ["1", "4"] });
		const result = text(await call(harness, "TaskExecute", { task_ids: ["9", "1", "5", "3", "2"] }));
		expect(result).toBe(
			[
				"Launched 1 agent(s):",
				`#2 → agent ${agentOf(tasks, "2")}`,
				"Use TaskOutput to check progress. Do not spawn additional agents for these tasks.",
				"",
				"Skipped:",
				"#9: not found",
				"#1: not pending (status: completed)",
				"#5: no agentType set; create with agentType parameter or update metadata",
				"#3: blocked by #4",
			].join("\n"),
		);
		expect(text(await call(harness, "TaskExecute", { task_ids: [] }))).toBe("No tasks to execute.");
		await subagentsOf(harness).waitForResult(agentOf(tasks, "2"));
	});

	it("builds the task prompt from the task, its prerequisites' results cut at 4,000 characters, and the caller's context", async () => {
		const harness = withRouter(await session());
		const tasks = await workerTasks(harness, "short", "long", "empty", "main");
		await call(harness, "TaskUpdate", { taskId: "1", status: "completed", metadata: { result: "short result" } });
		await call(harness, "TaskUpdate", { taskId: "2", status: "completed", metadata: { result: "x".repeat(4100) } });
		await call(harness, "TaskUpdate", { taskId: "3", status: "completed" });
		await call(harness, "TaskUpdate", { taskId: "4", addBlockedBy: ["1", "2", "3"] });
		await call(harness, "TaskExecute", { task_ids: ["4"], additional_context: "Mind the tests." });
		const prompt = subagentsOf(harness).get(agentOf(tasks, "4"))?.prompt;
		expect(prompt).toBe(
			[
				'You are executing task #4: "main"',
				"",
				"main work",
				"",
				"## Prerequisite task results",
				"",
				"### Task #1: short",
				"short result",
				"",
				"### Task #2: long",
				`${"x".repeat(4000)}`,
				"",
				"[... truncated; use TaskGet for full output]",
				"",
				"Mind the tests.",
				"",
				"Complete this task fully. Do not attempt to manage tasks yourself.",
			].join("\n"),
		);
		await subagentsOf(harness).waitForResult(agentOf(tasks, "4"));
	});

	it("takes background slots, so tasks past maxConcurrent queue, and an unread result notifies the session", async () => {
		const hold = held(() => fauxAssistantMessage("held answer"));
		const harness = withRouter(await session({ subagents: { maxConcurrent: 1, defaultJoinMode: "async" } }), {
			first: [hold.behavior],
			second: [hold.behavior],
		});
		const tasks = await workerTasks(harness, "first", "second");
		await call(harness, "TaskExecute", { task_ids: ["1", "2"] });
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		expect(subagentsOf(harness).get(agentOf(tasks, "1"))?.status).toBe("running");
		expect(subagentsOf(harness).get(agentOf(tasks, "2"))?.status).toBe("queued");
		hold.release();
		await subagentsOf(harness).waitForResult(agentOf(tasks, "2"));
		await vi.waitFor(() => expect(notices(harness.session).join("\n")).toContain("held answer"), CHILD_START);
	});
});

describe("an agent's end", () => {
	it("completes the task with the result of a completed or steered agent", async () => {
		const harness = withRouter(await session(), {
			plain: [say("plain answer")],
			limited: [use("read", () => ({ path: "agents/worker.md" })), say("wrapped up")],
		});
		const tasks = await workerTasks(harness, "plain", "limited");
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		await call(harness, "TaskExecute", { task_ids: ["2"], max_turns: 1 });
		const service = subagentsOf(harness);
		expect((await service.waitForResult(agentOf(tasks, "1"))).status).toBe("completed");
		expect((await service.waitForResult(agentOf(tasks, "2"))).status).toBe("steered");
		expect(tasks.get("1")).toMatchObject({ status: "completed", metadata: { result: "plain answer" } });
		expect(tasks.get("2")).toMatchObject({ status: "completed", metadata: { result: "wrapped up" } });
	});

	it("sends the task of a failed agent back to pending, removes its result and records the error", async () => {
		const harness = withRouter(await session(), { broken: [failing("provider exploded")] });
		const tasks = await workerTasks(harness, "broken");
		await call(harness, "TaskUpdate", { taskId: "1", metadata: { result: "an earlier run's result" } });
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		expect((await subagentsOf(harness).waitForResult(agentOf(tasks, "1"))).status).toBe("error");
		expect(tasks.get("1")?.status).toBe("pending");
		expect(tasks.get("1")?.metadata.result).toBeUndefined();
		expect(tasks.get("1")?.metadata.lastError).toContain("provider exploded");
	});

	it("completes the task of a stopped agent and keeps an earlier result when the agent reports none", async () => {
		const hold = held();
		const harness = withRouter(await session(), { stoppable: [hold.behavior] });
		const tasks = await workerTasks(harness, "stoppable");
		await call(harness, "TaskUpdate", { taskId: "1", metadata: { result: "an earlier run's result" } });
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		subagentsOf(harness).stop(agentOf(tasks, "1"));
		expect((await subagentsOf(harness).waitForResult(agentOf(tasks, "1"))).status).toBe("stopped");
		await vi.waitFor(() => expect(tasks.get("1")?.status).toBe("completed"));
		expect(tasks.get("1")?.metadata.result).toBe("an earlier run's result");
	});

	it("changes no task for an agent TaskExecute did not start, or for a second end", async () => {
		const harness = withRouter(await session());
		const tasks = await workerTasks(harness, "solo");
		const service = subagentsOf(harness);
		const other = await service.spawn({
			type: "worker",
			prompt: "unrelated work",
			description: "u",
			mode: "detached",
		});
		await service.waitForResult(other.id);
		expect(tasks.get("1")?.status).toBe("pending");
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		const agentId = agentOf(tasks, "1");
		await service.waitForResult(agentId);
		await vi.waitFor(() => expect(tasks.get("1")?.status).toBe("completed"));
		await call(harness, "TaskUpdate", { taskId: "1", status: "pending", metadata: { result: null } });
		service.resume(agentId, "once more", { background: false });
		await service.waitForResult(agentId);
		expect(tasks.get("1")).toMatchObject({ status: "pending" });
		expect(tasks.get("1")?.metadata.result).toBeUndefined();
	});
});

describe("TaskOutput", () => {
	it("finds a task by id, agent id or agent id prefix, and refuses an empty id, an unknown task and a task with no agent", async () => {
		const hold = held();
		const harness = withRouter(await session(), { found: [hold.behavior] });
		const tasks = await workerTasks(harness, "found", "idle");
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		const agentId = agentOf(tasks, "1");
		for (const ref of ["1", agentId, agentId.slice(0, 6)]) {
			expect(text(await call(harness, "TaskOutput", { task_id: ref, block: false, timeout: 0 }))).toBe(
				`Task #1 [in_progress]: subagent ${agentId}`,
			);
		}
		await expect(call(harness, "TaskOutput", { task_id: "", block: false, timeout: 0 })).rejects.toThrow(
			"task_id is required",
		);
		await expect(call(harness, "TaskOutput", { task_id: "99", block: false, timeout: 0 })).rejects.toThrow(
			"No task found with ID 99",
		);
		await expect(call(harness, "TaskOutput", { task_id: "2", block: false, timeout: 0 })).rejects.toThrow(
			"No background process for task 2",
		);
		expect(subagentsOf(harness).get(agentId)?.resultConsumed).toBe(false);
		hold.release();
		await subagentsOf(harness).waitForResult(agentId);
	});

	it("waits until the agent ends, the timeout passes or the call aborts, and consumes only a result the task holds", async () => {
		const hold = held(() => fauxAssistantMessage("late answer"));
		const harness = withRouter(await session(), { waited: [hold.behavior] });
		const tasks = await workerTasks(harness, "waited");
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		const agentId = agentOf(tasks, "1");
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		const started = Date.now();
		expect(text(await call(harness, "TaskOutput", { task_id: "1", block: true, timeout: 50 }))).toBe(
			`Task #1 [in_progress]: subagent ${agentId}`,
		);
		expect(Date.now() - started).toBeLessThan(5000);
		const controller = new AbortController();
		const aborted = call(harness, "TaskOutput", { task_id: "1", block: true, timeout: 600000 }, controller.signal);
		controller.abort();
		expect(text(await aborted)).toBe(`Task #1 [in_progress]: subagent ${agentId}`);
		expect(subagentsOf(harness).get(agentId)?.resultConsumed).toBe(false);
		const waiting = call(harness, "TaskOutput", { task_id: agentId, block: true, timeout: 20000 });
		hold.release();
		expect(text(await waiting)).toBe(`Task #1 [completed]: subagent ${agentId}\n\nlate answer`);
		expect(subagentsOf(harness).get(agentId)?.resultConsumed).toBe(true);
	});

	it("reports a failed agent's error and consumes it, and consumes a result read after the fact", async () => {
		const harness = withRouter(await session(), { failed: [failing("rate limited")], read: [say("read later")] });
		const tasks = await workerTasks(harness, "failed", "read");
		await call(harness, "TaskExecute", { task_ids: ["1", "2"] });
		const service = subagentsOf(harness);
		await service.waitForResult(agentOf(tasks, "1"));
		await service.waitForResult(agentOf(tasks, "2"));
		await vi.waitFor(() => expect(tasks.get("2")?.status).toBe("completed"));
		const failure = text(await call(harness, "TaskOutput", { task_id: "1", block: false, timeout: 0 }));
		expect(failure).toMatch(
			new RegExp(`^Task #1 \\[pending\\]: subagent ${agentOf(tasks, "1")}\\n\\nError: .*rate limited`),
		);
		expect(service.get(agentOf(tasks, "1"))?.resultConsumed).toBe(true);
		expect(text(await call(harness, "TaskOutput", { task_id: "2", block: false, timeout: 0 }))).toBe(
			`Task #2 [completed]: subagent ${agentOf(tasks, "2")}\n\nread later`,
		);
		expect(service.get(agentOf(tasks, "2"))?.resultConsumed).toBe(true);
		for (const ref of [agentOf(tasks, "2"), agentOf(tasks, "2").slice(0, 8)]) {
			expect(text(await call(harness, "TaskOutput", { task_id: ref, block: false, timeout: 0 }))).toBe(
				`Task #2 [completed]: subagent ${agentOf(tasks, "2")}\n\nread later`,
			);
		}
	});
});

describe("TaskStop", () => {
	it("finds the task by id, agent id or prefix, stops its agent and completes the task at once", async () => {
		const hold = held();
		const harness = withRouter(await session(), {
			one: [hold.behavior],
			two: [hold.behavior],
			three: [hold.behavior],
		});
		const tasks = await workerTasks(harness, "one", "two", "three");
		await call(harness, "TaskExecute", { task_ids: ["1", "2", "3"] });
		await vi.waitFor(() => expect(hold.requests()).toBe(3), CHILD_START);
		const refs = ["1", agentOf(tasks, "2"), agentOf(tasks, "3").slice(0, 6)];
		for (const [index, ref] of refs.entries()) {
			const id = String(index + 1);
			expect(text(await call(harness, "TaskStop", { task_id: ref }))).toBe(`Task #${id} stopped successfully`);
			expect(tasks.get(id)?.status).toBe("completed");
			expect((await subagentsOf(harness).waitForResult(agentOf(tasks, id))).status).toBe("stopped");
		}
	});

	it("refuses a task with no running agent, an agent id only its metadata names, and an unknown id", async () => {
		const hold = held();
		const harness = withRouter(await session(), { unrelated: [hold.behavior] });
		const tasks = await workerTasks(harness, "finished", "idle");
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		await subagentsOf(harness).waitForResult(agentOf(tasks, "1"));
		await vi.waitFor(() => expect(tasks.get("1")?.status).toBe("completed"));
		const other = await subagentsOf(harness).spawn({
			type: "worker",
			prompt: "unrelated work",
			description: "u",
			mode: "detached-background",
		});
		await call(harness, "TaskCreate", { subject: "claimed", description: "d", metadata: { agentId: other.id } });
		await call(harness, "TaskUpdate", { taskId: "3", status: "in_progress" });
		for (const ref of ["1", agentOf(tasks, "1"), "2", "3", "99", ""]) {
			await expect(call(harness, "TaskStop", { task_id: ref })).rejects.toThrow(
				ref ? `No running background process for task ${ref}` : "task_id is required",
			);
		}
		expect(subagentsOf(harness).get(other.id)?.status).toBe("running");
		hold.release();
		await subagentsOf(harness).waitForResult(other.id);
	});

	it("fails schema validation for shell_id alone", async () => {
		const harness = await session();
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("TaskStop", { shell_id: "1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("stop the shell");
		const results = harness.session.messages.filter((message) => message.role === "toolResult");
		expect(results).toHaveLength(1);
		expect(getMessageText(results[0])).toContain('Validation failed for tool "TaskStop"');
	});
});

describe("the session's end and /reload", () => {
	it.each(["the task service", "the subagent service"])(
		"sends a running agent's task back to pending when %s ends first, and a fork carries it as pending",
		async (first) => {
			const hold = held();
			const harness = withRouter(await session(), { survey: [hold.behavior] });
			if (first === "the subagent service") subagentsOf(harness);
			const tasks = await workerTasks(harness, "survey");
			await call(harness, "TaskExecute", { task_ids: ["1"] });
			await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
			harness.session.dispose();
			await vi.waitFor(() => expect(tasks.isDisposed).toBe(true));
			expect(tasks.get("1")).toMatchObject({
				status: "pending",
				metadata: { lastError: "The session ended before the agent finished." },
			});
			const fork = new TaskService({
				sessionManager: harness.sessionManager,
				settingsManager: harness.settingsManager,
				subscribe: () => () => {},
				getActiveToolNames: () => [],
				sessionId: "fork",
				sessionFile: undefined,
			} as unknown as AgentSession);
			fork.onSessionStart("fork");
			expect(fork.get("1")).toMatchObject({
				status: "pending",
				metadata: { lastError: "The session ended before the agent finished." },
			});
		},
	);

	it("keeps the service, the list and the agents across /reload, so an agent's end still reaches its task", async () => {
		const hold = held(() => fauxAssistantMessage("after reload"));
		const doom = held(() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "broke after reload" }));
		const harness = withRouter(await session(), { kept: [hold.behavior], doomed: [doom.behavior] });
		const tasks = await workerTasks(harness, "kept", "doomed");
		await call(harness, "TaskCreate", { subject: "plain", description: "d" });
		await call(harness, "TaskExecute", { task_ids: ["1", "2"] });
		await vi.waitFor(() => expect(hold.requests() + doom.requests()).toBe(2), CHILD_START);
		await harness.session.reload();
		expect(requireTaskService(harness.session)).toBe(tasks);
		expect(text(await call(harness, "TaskCreate", { subject: "after", description: "d" }))).toBe(
			"Task #4 created successfully: after",
		);
		const waiting = call(harness, "TaskOutput", {
			task_id: agentOf(tasks, "1").slice(0, 6),
			block: true,
			timeout: 20000,
		});
		hold.release();
		expect(text(await waiting)).toBe(`Task #1 [completed]: subagent ${agentOf(tasks, "1")}\n\nafter reload`);
		doom.release();
		await subagentsOf(harness).waitForResult(agentOf(tasks, "2"));
		await vi.waitFor(() => expect(tasks.get("2")?.status).toBe("pending"));
		expect(tasks.get("2")?.metadata.lastError).toContain("broke after reload");
		expect(tasks.list().map((task) => task.subject)).toEqual(["kept", "doomed", "plain", "after"]);
	});
});

describe("task activity", () => {
	it("reports an agent task's own usage, and adds the parent's turn tokens to a task the session works on", async () => {
		const hold = held();
		const harness = withRouter(await session(), {
			busy: [use("read", () => ({ path: "agents/worker.md" })), hold.behavior],
		});
		const tasks = await workerTasks(harness, "busy");
		await call(harness, "TaskCreate", { subject: "mine", description: "d" });
		await call(harness, "TaskUpdate", { taskId: "2", status: "in_progress" });
		await call(harness, "TaskExecute", { task_ids: ["1"] });
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		const agent = subagentsOf(harness).get(agentOf(tasks, "1"));
		expect(agent?.usage.input).toBeGreaterThan(0);
		expect(tasks.activity("1")).toMatchObject({ inputTokens: agent?.usage.input, outputTokens: agent?.usage.output });
		expect(tasks.activity("2")).toMatchObject({ inputTokens: 0, outputTokens: 0 });
		await harness.session.prompt("hello");
		const parentTurn = harness.session.messages.filter((message) => message.role === "assistant").at(-1);
		const usage = parentTurn?.role === "assistant" ? parentTurn.usage : undefined;
		expect(usage?.input).toBeGreaterThan(0);
		expect(tasks.activity("2")).toMatchObject({ inputTokens: usage?.input, outputTokens: usage?.output });
		expect(tasks.activity("1")?.inputTokens).toBe(subagentsOf(harness).get(agentOf(tasks, "1"))?.usage.input);
		hold.release();
		await subagentsOf(harness).waitForResult(agentOf(tasks, "1"));
		await vi.waitFor(() => expect(tasks.activity("1")).toBeUndefined());
		expect(tasks.workingIds()).toEqual(["2"]);
	});
});
