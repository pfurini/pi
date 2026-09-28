/**
 * Fork-owned: the subagents presentation factory (plan T6) on real parent and child sessions. The
 * parent loads the factory through the harness with its own event bus, as a DefaultResourceLoader
 * would; children load it through their own DefaultResourceLoader from FORK_OWNED_BUILTINS.
 * Old pi-subagents tests at 79a7c42 this covers: child-session-shutdown ("quit waits for the child's
 * shutdown handlers to finish").
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { createEventBus, type EventBus } from "../../src/core/event-bus.ts";
import type { ExtensionMode, ExtensionUIContext, MessageRenderer } from "../../src/core/extensions/types.ts";
import { NOTIFICATION_CUSTOM_TYPE } from "../../src/core/fork-builtins/subagents/service/notifications.ts";
import { inspectRecord } from "../../src/core/fork-builtins/subagents/service/service.ts";
import {
	existingSubagentService,
	subagentServiceFor,
} from "../../src/core/fork-builtins/subagents/service/sessions.ts";
import subagentsPresentation from "../../src/core/fork-builtins/subagents/ui/index.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import type { Theme } from "../../src/modes/interactive/theme/theme.ts";
import { agentId, type Behavior, CHILD_START, call, held, router, sleep } from "./fork-subagents-fixtures.ts";
import { createHarness, type Harness } from "./harness.ts";

type Probe = { shutdownDone: boolean };
const probe = (): Probe => (globalThis as { __sn2Presentation?: Probe }).__sn2Presentation as Probe;

const harnesses: Harness[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	// Last in, first out: a runtime is disposed before the directory and the provider it uses go.
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.unstubAllEnvs();
	delete (globalThis as { __sn2Presentation?: Probe }).__sn2Presentation;
});

async function parent(
	script: Record<string, Behavior[]>,
	subagents: Record<string, unknown> = {},
	eventBus: EventBus = createEventBus(),
) {
	vi.stubEnv("PI_FORK_BUILTINS", "on");
	(globalThis as { __sn2Presentation?: Probe }).__sn2Presentation = { shutdownDone: false };
	const harness = await createHarness({
		eventBus,
		extensionFactories: [{ name: "subagents", factory: subagentsPresentation }],
		settings: {
			forkBuiltins: { subagents: { defaultJoinMode: "async", ...subagents } },
		} as unknown as Partial<Settings>,
	});
	harnesses.push(harness);
	mkdirSync(join(harness.tempDir, "agents"), { recursive: true });
	// Extensions load, so the child's loader runs its fork built-ins and the extensions below.
	writeFileSync(
		join(harness.tempDir, "agents", "worker.md"),
		"---\ndescription: test worker\ntools: read\n---\nYou are a test worker.",
	);
	harness.setResponses(Array.from({ length: 50 }, () => router(script)));
	return harness;
}

/** A child extension whose `session_shutdown` handler takes 300 ms, then records that it finished. */
function writeSlowShutdownExtension(harness: Harness): void {
	const dir = join(harness.tempDir, "extensions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "slow-shutdown.ts"),
		'export default function (pi) {\n\tpi.on("session_shutdown", async () => {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\t\tglobalThis.__sn2Presentation.shutdownDone = true;\n\t});\n}\n',
	);
}

/** A child extension that takes 300 ms to load, so its child is still starting when the parent quits. */
function writeSlowStartExtension(harness: Harness): void {
	const dir = join(harness.tempDir, "extensions");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "slow-start.ts"),
		'export default async function (pi) {\n\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\tpi.on("session_shutdown", async () => {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 100));\n\t\tglobalThis.__sn2Presentation.shutdownDone = true;\n\t});\n}\n',
	);
}

/** A UI context that records the `subagents` status. Own properties only: the runner spreads the context it wraps. */
function recordingUi() {
	const statuses: Array<string | undefined> = [];
	const ui = {
		notify: () => {},
		setWidget: () => {},
		onTerminalInput: () => () => {},
		setStatus: (key: string, text: string | undefined) => {
			if (key === "subagents") statuses.push(text);
		},
	} as unknown as ExtensionUIContext;
	return { ui, statuses };
}

async function bound(harness: Harness, mode: ExtensionMode) {
	const { ui, statuses } = recordingUi();
	await harness.session.bindExtensions({ uiContext: ui, mode });
	return statuses;
}

const background = (task: string) => ({
	prompt: task,
	description: task,
	subagent_type: "worker",
	run_in_background: true,
});

describe("presentation factory", () => {
	it("registers nothing in a child session", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] });
		const started = await call(harness, "Agent", background("hold"));
		const service = subagentServiceFor(harness.session);
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const child = service && inspectRecord(service, agentId(started))?.child;
		const factory = child?.loader
			.getExtensions()
			.extensions.find((extension) => extension.path === "<inline:subagents>");
		expect(factory, "the child loads the fork built-in").toBeDefined();
		expect(factory?.commands.size).toBe(0);
		expect(factory?.handlers.size).toBe(0);
		expect(factory?.messageRenderers.size).toBe(0);
		gate.release();
	});

	it("shows how many agents run and wait in the tui status line, and clears it when none does", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] }, { maxConcurrent: 2 });
		const statuses = await bound(harness, "tui");
		const first = agentId(await call(harness, "Agent", background("hold one")));
		await vi.waitFor(() => expect(statuses.at(-1)).toBe("1 running agent"), CHILD_START);
		agentId(await call(harness, "Agent", background("hold two")));
		const last = agentId(await call(harness, "Agent", background("hold three")));
		await vi.waitFor(() => expect(statuses.at(-1)).toBe("2 running, 1 queued agents"), CHILD_START);
		gate.release();
		const service = subagentServiceFor(harness.session);
		await service?.waitForResult(first);
		await service?.waitForResult(last);
		await vi.waitFor(() => expect(statuses.at(-1)).toBeUndefined());
		// Set only on a change: no text repeats the one before it.
		expect(statuses.filter((text, index) => index > 0 && text === statuses[index - 1])).toEqual([]);
	});

	it("counts a foreground agent that waits for a slot", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] }, { maxConcurrentForeground: 1 });
		const statuses = await bound(harness, "tui");
		const service = subagentServiceFor(harness.session);
		if (!service) throw new Error("no subagent service");
		const foreground = (task: string) => ({
			type: "worker",
			prompt: task,
			description: task,
			params: { run_in_background: false },
		});
		await service.spawn(foreground("hold one"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		const second = await service.spawn(foreground("hold two"));
		expect(second.status).toBe("queued");
		await vi.waitFor(() => expect(statuses.at(-1)).toBe("1 running, 1 queued agents"));
		gate.release();
		await service.waitForResult(second.id);
	});

	it("writes no status through the context of a session disposed directly", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] });
		const statuses = await bound(harness, "tui");
		agentId(await call(harness, "Agent", background("hold")));
		await vi.waitFor(() => expect(statuses.at(-1)).toBe("1 running agent"), CHILD_START);
		// The service's end emits `ended` after the session invalidated its extension context.
		const errors: unknown[] = [];
		const onError = (error: unknown) => errors.push(error);
		process.on("uncaughtException", onError);
		try {
			harness.session.dispose();
			await sleep(20);
		} finally {
			process.off("uncaughtException", onError);
		}
		expect(errors).toEqual([]);
		expect(statuses.at(-1)).toBe("1 running agent");
	});

	it("shows the same status in rpc mode, and none in print mode", async () => {
		const rpcGate = held();
		const rpc = await parent({ hold: [rpcGate.behavior] });
		const rpcStatuses = await bound(rpc, "rpc");
		agentId(await call(rpc, "Agent", background("hold rpc")));
		await vi.waitFor(() => expect(rpcStatuses.at(-1)).toBe("1 running agent"), CHILD_START);
		rpcGate.release();

		const printGate = held();
		const print = await parent({ hold: [printGate.behavior] });
		const printStatuses = await bound(print, "print");
		agentId(await call(print, "Agent", background("hold print")));
		await vi.waitFor(() => expect(printGate.requests()).toBe(1), CHILD_START);
		expect(printStatuses).toEqual([]);
		printGate.release();
	});

	it("draws a notification's cost from the bound session's service, and builds no service to draw one", async () => {
		const details = {
			id: "a",
			description: "priced task",
			status: "completed",
			turnCount: 1,
			toolUses: 0,
			totalTokens: 1000,
			totalCost: 0.0123,
			durationMs: 1000,
			resultPreview: "done",
		};
		const drawn = (harness: Harness) =>
			harness.session.extensionRunner
				.getMessageRenderer(NOTIFICATION_CUSTOM_TYPE)?.(
					{ details } as Parameters<MessageRenderer>[0],
					{ expanded: false, outputPad: 0 },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme,
				)
				?.render(200)
				.join("\n");

		const shown = await parent({}, { showCost: true });
		await bound(shown, "tui");
		expect(drawn(shown)).toContain("1.0k token · ~$0.0123 · 1.0s");

		const hidden = await parent({}, { showCost: false });
		await bound(hidden, "tui");
		expect(drawn(hidden)).toContain("1.0k token · 1.0s");

		// Print mode builds no service at session_start, and a render builds none either.
		const unbuilt = await parent({}, { showCost: true });
		await bound(unbuilt, "print");
		expect(drawn(unbuilt)).toContain("1.0k token · 1.0s");
		expect(existingSubagentService(unbuilt.session)).toBeUndefined();
	});

	it("binds each of two sessions on one event bus to its own agents", async () => {
		const bus = createEventBus();
		const gate = held();
		const alpha = await parent({ hold: [gate.behavior] }, {}, bus);
		const beta = await parent({ hold: [gate.behavior] }, {}, bus);
		const alphaStatuses = await bound(alpha, "tui");
		const betaStatuses = await bound(beta, "tui");
		agentId(await call(alpha, "Agent", background("hold alpha")));
		agentId(await call(beta, "Agent", background("hold beta one")));
		agentId(await call(beta, "Agent", background("hold beta two")));
		await vi.waitFor(() => expect(gate.requests()).toBe(3), CHILD_START);
		await vi.waitFor(() => {
			expect(alphaStatuses.at(-1)).toBe("1 running agent");
			expect(betaStatuses.at(-1)).toBe("2 running agents");
		});
		gate.release();
	});

	it("makes quit wait for every child's session_shutdown handlers", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] });
		writeSlowShutdownExtension(harness);
		await harness.session.bindExtensions({ mode: "print" });
		await call(harness, "Agent", background("hold"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await harness.session.shutdown();
		expect(probe().shutdownDone).toBe(true);
	});

	it("makes quit wait for a child that is still starting", async () => {
		const harness = await parent({});
		writeSlowStartExtension(harness);
		await harness.session.bindExtensions({ mode: "print" });
		const started = await call(harness, "Agent", background("start"));
		const service = subagentServiceFor(harness.session);
		expect(service && inspectRecord(service, agentId(started))?.child, "the child is still starting").toBeUndefined();
		await harness.session.shutdown();
		expect(probe().shutdownDone).toBe(true);
	});

	it("makes quit wait for the children of a session that never started", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] });
		writeSlowShutdownExtension(harness);
		await call(harness, "Agent", background("hold"));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await harness.session.shutdown();
		expect(probe().shutdownDone).toBe(true);
	});

	it("keeps the service and its running agent across /reload, and its status afterwards", async () => {
		const gate = held();
		const harness = await parent({ hold: [gate.behavior] });
		const statuses = await bound(harness, "tui");
		const started = agentId(await call(harness, "Agent", background("hold")));
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await vi.waitFor(() => expect(statuses.at(-1)).toBe("1 running agent"));
		const service = subagentServiceFor(harness.session);
		await harness.session.reload();
		expect(subagentServiceFor(harness.session)).toBe(service);
		expect(service?.isDisposed).toBe(false);
		expect(service?.get(started)?.status).toBe("running");
		const afterReload = statuses.length;
		gate.release();
		await expect(service?.waitForResult(started)).resolves.toMatchObject({ status: "completed" });
		await vi.waitFor(() => expect(statuses.at(-1)).toBeUndefined());
		expect(statuses.length).toBeGreaterThan(afterReload);
	});

	it("makes a runtime's new session wait for the old session's children", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		(globalThis as { __sn2Presentation?: Probe }).__sn2Presentation = { shutdownDone: false };
		const tempDir = mkdtempSync(join(tmpdir(), "pi-sn2-runtime-"));
		const outside = mkdtempSync(join(tmpdir(), "pi-sn2-extension-"));
		const faux = registerFauxProvider();
		cleanups.push(() => {
			faux.unregister();
			rmSync(tempDir, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		});
		const gate = held();
		faux.setResponses(Array.from({ length: 20 }, () => router({ hold: [gate.behavior] })));
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
		// The parent's DefaultResourceLoader loads `<agentDir>/extensions/`, so the child's extension lives
		// outside it and only the agent file names it.
		const extension = join(outside, "slow-shutdown.ts");
		writeFileSync(
			extension,
			'export default function (pi) {\n\tpi.on("session_shutdown", async () => {\n\t\tawait new Promise((resolve) => setTimeout(resolve, 300));\n\t\tglobalThis.__sn2Presentation.shutdownDone = true;\n\t});\n}\n',
		);
		mkdirSync(join(tempDir, "agents"), { recursive: true });
		writeFileSync(
			join(tempDir, "agents", "worker.md"),
			`---\ntools: read\nextensions: [${JSON.stringify(extension)}]\n---\nWork.`,
		);
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
			sessionManager: SessionManager.inMemory(tempDir),
		});
		cleanups.push(() => runtime.dispose().catch(() => {}));
		const first = runtime.session;
		const service = subagentServiceFor(first);
		if (!service) throw new Error("no subagent service");
		await service.spawn({ type: "worker", prompt: "hold", description: "hold", params: { run_in_background: true } });
		await vi.waitFor(() => expect(gate.requests()).toBe(1), CHILD_START);
		await runtime.newSession();
		expect(runtime.session).not.toBe(first);
		expect(probe().shutdownDone).toBe(true);
	});
});
