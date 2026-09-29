/**
 * Fork-owned: the tasks presentation factory on real sessions (plan T4): the `context` hook that adds
 * the task reminder to the next model request.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { createEventBus } from "../../src/core/event-bus.ts";
import type { ExtensionMode, ExtensionUIContext } from "../../src/core/extensions/types.ts";
import { inspectRecord } from "../../src/core/fork-builtins/subagents/service/service.ts";
import {
	existingTaskService,
	requireTaskService,
	taskServiceFor,
} from "../../src/core/fork-builtins/tasks/service/sessions.ts";
import tasksPresentation from "../../src/core/fork-builtins/tasks/ui/index.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { ResourceLoader } from "../../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { type Behavior, CHILD_START, held, say, textOf, use } from "./fork-subagents-fixtures.ts";
import { subagentsOf, taskSession, withRouter } from "./fork-tasks-fixtures.ts";
import type { Harness, HarnessOptions } from "./harness.ts";

const harnesses: Harness[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.unstubAllEnvs();
});

/** A session that loads the tasks presentation, bound in print mode. */
async function presented(options: HarnessOptions = {}): Promise<Harness> {
	const harness = await taskSession(
		{},
		{ ...options, eventBus: createEventBus(), extensionFactories: [{ name: "tasks", factory: tasksPresentation }] },
	);
	harnesses.push(harness);
	await harness.session.bindExtensions({ mode: "print" });
	return harness;
}

/** A parent that reads a file five times, then answers; every request is recorded. */
function reader(requests: Context[]): Behavior {
	return (context) => {
		requests.push(structuredClone(context));
		const reads = context.messages.filter((message) => message.role === "toolResult").length;
		return reads < 5
			? fauxAssistantMessage([fauxToolCall("read", { path: "agents/worker.md" })], { stopReason: "toolUse" })
			: fauxAssistantMessage("done");
	};
}

const reminded = (requests: Context[]) =>
	requests.some((request) =>
		request.messages.some(
			(message) => message.role === "user" && textOf(message.content).includes("<system-reminder>"),
		),
	);

describe("the task reminder", () => {
	it("reaches the model after four turns without a task tool, while the list holds tasks", async () => {
		const requests: Context[] = [];
		const harness = withRouter(await presented(), {}, reader(requests));
		requireTaskService(harness.session).create("open work", "d");
		await harness.session.prompt("go");
		expect(reminded(requests)).toBe(true);
		// No session keeps it.
		expect(JSON.stringify(harness.session.messages)).not.toContain("<system-reminder>");
	});

	it("never reaches a session whose model cannot call TaskCreate", async () => {
		const requests: Context[] = [];
		const harness = withRouter(await presented({ excludedToolNames: ["TaskCreate"] }), {}, reader(requests));
		requireTaskService(harness.session).create("open work", "d");
		await harness.session.prompt("go");
		expect(requests.length).toBeGreaterThan(4);
		expect(reminded(requests)).toBe(false);
	});
});

/** A UI context that keeps the widgets and notices it is given. Own properties only. */
function fakeUi() {
	const widgets = new Map<string, unknown>();
	const calls: Array<[string, unknown]> = [];
	const notices: string[] = [];
	const plain = { fg: (_color: string, text: string) => text, strikethrough: (text: string) => text };
	const tui = { requestRender: () => {} } as unknown as TUI;
	const ui = {
		notify: (message: string) => {
			notices.push(message);
		},
		setStatus: () => {},
		onTerminalInput: () => () => {},
		setWidget: (key: string, content: unknown) => {
			calls.push([key, content]);
			if (content === undefined) widgets.delete(key);
			else widgets.set(key, content);
		},
	} as unknown as ExtensionUIContext;
	const text = () => {
		const content = widgets.get("tasks");
		if (Array.isArray(content)) return content.join("\n");
		if (typeof content === "function")
			return (content as (tui: TUI, theme: unknown) => Component)(tui, plain).render(200).join("\n");
		return "";
	};
	return { ui, calls, notices, text, widgets };
}

/** A session that loads the tasks presentation, not yet bound. */
async function unbound(settings: Record<string, unknown> = {}, options: HarnessOptions = {}): Promise<Harness> {
	const harness = await taskSession(settings, {
		...options,
		eventBus: createEventBus(),
		extensionFactories: [{ name: "tasks", factory: tasksPresentation }],
	});
	harnesses.push(harness);
	return harness;
}

describe("the tasks presentation factory", () => {
	it("shows the widget in tui mode, sends plain lines in rpc mode, and nothing in print and json mode", async () => {
		for (const mode of ["tui", "rpc", "print", "json"] as ExtensionMode[]) {
			const harness = await unbound();
			const { ui, calls, text } = fakeUi();
			await harness.session.bindExtensions({ uiContext: ui, mode });
			const service = existingTaskService(harness.session);
			expect(service, mode).toBeDefined();
			service?.create("shown task", "d");
			await Promise.resolve();
			if (mode === "tui") expect(typeof calls.at(-1)?.[1], mode).toBe("function");
			else if (mode === "rpc") expect(Array.isArray(calls.at(-1)?.[1]), mode).toBe(true);
			else expect(calls, mode).toEqual([]);
			if (mode === "tui" || mode === "rpc") expect(text(), mode).toContain("#1 shown task");
		}
	});

	it("tells the service a startup, so a finished list from before clears", async () => {
		const harness = await unbound();
		const service = requireTaskService(harness.session);
		service.create("finished before", "d");
		service.update("1", { status: "completed" });
		await harness.session.bindExtensions({ mode: "print" });
		expect(service.list()).toEqual([]);
	});

	it("hands a fork its parent's list through the previousSessionFile of its session_start", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const tempDir = mkdtempSync(join(tmpdir(), "pi-tasks-runtime-"));
		const faux = registerFauxProvider();
		cleanups.push(() => {
			faux.unregister();
			rmSync(tempDir, { recursive: true, force: true });
		});
		faux.setResponses(Array.from({ length: 5 }, () => fauxAssistantMessage("ok")));
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(tempDir, "models.json"),
		});
		const model = faux.getModel();
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir: tempDir,
				modelRuntime,
				resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir, join(tempDir, "sessions")),
		});
		cleanups.push(() => runtime.dispose().catch(() => {}));
		await runtime.session.bindExtensions({});
		await runtime.session.prompt("hello");
		requireTaskService(runtime.session).create("carried by the fork", "d");
		const userMessage = runtime.session.getUserMessagesForForking()[0];
		if (!userMessage) throw new Error("no user message to fork from");
		await runtime.fork(userMessage.entryId);
		await runtime.session.bindExtensions({});
		expect(
			requireTaskService(runtime.session)
				.list()
				.map((task) => task.subject),
		).toEqual(["carried by the fork"]);
	});

	it("registers no command and builds no service in a child session at its start", async () => {
		const hold = held();
		const harness = withRouter(await unbound(), { keeper: [hold.behavior] });
		writeFileSync(
			join(harness.tempDir, "agents", "keeper.md"),
			"---\ndescription: keeps tasks\ntools: read, TaskCreate\n---\nYou keep tasks.",
		);
		await harness.session.bindExtensions({ mode: "print" });
		const service = subagentsOf(harness);
		const keeper = await service.spawn({ type: "keeper", prompt: "keeper work", description: "k", mode: "detached" });
		await vi.waitFor(() => expect(hold.requests()).toBe(1), CHILD_START);
		const child = inspectRecord(service, keeper.id)?.child;
		const factory = child?.loader.getExtensions().extensions.find((extension) => extension.path === "<inline:tasks>");
		expect(factory, "the child loads the fork built-in").toBeDefined();
		expect(factory?.commands.size).toBe(0);
		expect(child && existingTaskService(child.session)).toBeUndefined();
		hold.release();
		await service.waitForResult(keeper.id);
	});

	it("sends the service's warnings to the UI as notifications, held ones included", async () => {
		const harness = await unbound({ tasks: { maxVisible: 0 } });
		const { ui, notices } = fakeUi();
		await harness.session.bindExtensions({ uiContext: ui, mode: "tui" });
		expect(notices).toEqual([
			"forkBuiltins.tasks in the global settings.json: maxVisible must be an integer from 1 to 1000; it is ignored.",
		]);
		requireTaskService(harness.session).warn("a later warning");
		expect(notices.at(-1)).toBe("a later warning");
	});

	it("removes the widget at session_shutdown", async () => {
		const harness = await unbound();
		const { ui, widgets } = fakeUi();
		await harness.session.bindExtensions({ uiContext: ui, mode: "tui" });
		const service = requireTaskService(harness.session);
		service.create("a", "d");
		service.update("1", { status: "in_progress" });
		await Promise.resolve();
		expect(widgets.has("tasks")).toBe(true);
		await harness.session.emitShutdownOnce({ type: "session_shutdown", reason: "quit" });
		expect(widgets.has("tasks")).toBe(false);
	});

	it("rebinds the widget to the same service and list when /reload loads the factory again", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		// A loader whose reload runs the factory again, as interactive mode's `/reload` does.
		const cwd = mkdtempSync(join(tmpdir(), "pi-tasks-reload-"));
		const bus = createEventBus();
		const load = () => createTestExtensionsResult([{ name: "tasks", factory: tasksPresentation }], cwd, bus);
		let extensions = await load();
		const resourceLoader: ResourceLoader = {
			...createTestResourceLoader({ eventBus: bus }),
			getExtensions: () => extensions,
			reload: async () => {
				extensions = await load();
			},
		};
		const harness = await taskSession({}, { cwd, eventBus: bus, resourceLoader });
		harnesses.push(harness);
		const { ui, calls, text } = fakeUi();
		await harness.session.bindExtensions({ uiContext: ui, mode: "tui" });
		const service = requireTaskService(harness.session);
		service.create("kept across reload", "d");
		await Promise.resolve();
		await harness.session.reload();
		expect(requireTaskService(harness.session)).toBe(service);
		expect(text()).toContain("#1 kept across reload");
		const before = calls.length;
		service.clearAll();
		await Promise.resolve();
		expect(calls.slice(before)).toEqual([["tasks", undefined]]);
	});
});

describe("the task reminder in other modes and in a child", () => {
	it("adds a due reminder as the last message of the request in tui and rpc mode", async () => {
		for (const mode of ["tui", "rpc"] as ExtensionMode[]) {
			const requests: Context[] = [];
			const harness = withRouter(await unbound(), {}, reader(requests));
			await harness.session.bindExtensions({ uiContext: fakeUi().ui, mode });
			requireTaskService(harness.session).create("open work", "d");
			await harness.session.prompt("go");
			const last = requests.map((request) => request.messages.at(-1));
			expect(
				last.some((message) => message?.role === "user" && textOf(message.content).includes("<system-reminder>")),
				mode,
			).toBe(true);
			expect(JSON.stringify(harness.session.messages), mode).not.toContain("<system-reminder>");
		}
	});

	it("reaches a child whose service exists", async () => {
		const requests: Context[] = [];
		const steps: Behavior[] = [
			use("TaskCreate", () => ({ subject: "child work", description: "d" })),
			...Array.from({ length: 5 }, () => use("read", () => ({ path: "agents/worker.md" }))),
			say("child done"),
		];
		const recorded: Behavior[] = steps.map((step) => (context, options) => {
			requests.push(structuredClone(context));
			return step(context, options);
		});
		const harness = withRouter(await unbound(), { keeper: recorded });
		writeFileSync(
			join(harness.tempDir, "agents", "keeper.md"),
			"---\ndescription: keeps tasks\ntools: read, TaskCreate\n---\nYou keep tasks.",
		);
		await harness.session.bindExtensions({ mode: "print" });
		const service = subagentsOf(harness);
		const keeper = await service.spawn({ type: "keeper", prompt: "keeper work", description: "k", mode: "detached" });
		await service.waitForResult(keeper.id);
		expect(
			requests.some((request) => {
				const message = request.messages.at(-1);
				return message?.role === "user" && textOf(message.content).includes('"content":"child work"');
			}),
		).toBe(true);
		expect(taskServiceFor(harness.session)?.list()).toEqual([]);
	});
});
