import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type { ExtensionFactory, SessionShutdownEvent } from "../src/index.ts";

// session_shutdown must reach extensions on every terminal path, exactly once, via a
// single-flight seam on AgentSession. Raw dispose() stays eventless; reload() bypasses
// the seam so a post-reload quit still fires.
describe("AgentSession session_shutdown emission seam", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeHost(extensionFactory: ExtensionFactory) {
		const tempDir = join(tmpdir(), `pi-shutdown-emit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two"), fauxAssistantMessage("three")]);

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

		const runtimeOptions = {
			agentDir: tempDir,
			modelRuntime,
			model: faux.getModel(),
			resourceLoaderOptions: {
				extensionFactories: [extensionFactory],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				...runtimeOptions,
				cwd,
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtimeHost.session.bindExtensions({});

		cleanups.push(async () => {
			// Best-effort teardown: a session whose shutdown emission rejected shares
			// that rejection with every later terminal path (including this one).
			// Tests assert dispose/shutdown semantics in their own bodies; the shared
			// cleanup must not re-fail the test on the same cached rejection.
			await runtimeHost.dispose().catch(() => {});
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtimeHost, faux };
	}

	function recordShutdowns() {
		const events: SessionShutdownEvent[] = [];
		const factory: ExtensionFactory = (pi) => {
			pi.on("session_shutdown", (event) => {
				events.push(event);
			});
		};
		return { events, factory };
	}

	it("fires exactly once on shutdown(), and concurrent callers await the same ASYNC handler completion", async () => {
		// An async handler with a deferred resolution: a boolean guard that merely
		// prevents re-emission would let the second caller proceed into teardown
		// while this handler is still running — the cached promise must not.
		let handlerRuns = 0;
		let releaseHandler: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseHandler = resolve;
		});
		const factory: ExtensionFactory = (pi) => {
			pi.on("session_shutdown", async () => {
				handlerRuns++;
				await gate;
			});
		};
		const { runtimeHost } = await createRuntimeHost(factory);
		const session = runtimeHost.session;

		let firstSettled = false;
		let secondSettled = false;
		const first = session.shutdown().then(() => {
			firstSettled = true;
		});
		const second = session.shutdown().then(() => {
			secondSettled = true;
		});

		// Give both callers every chance to (wrongly) run ahead of the handler.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(handlerRuns).toBe(1);
		expect(firstSettled).toBe(false);
		expect(secondSettled).toBe(false);

		releaseHandler();
		await Promise.all([first, second]);
		// ...and a subsequent call must not re-fire the handler.
		await session.shutdown();
		expect(handlerRuns).toBe(1);
	});

	it("repeated and concurrent shutdown() runs session-resource cleanup exactly once", async () => {
		// Registered cleanups have no idempotency contract: a second dispose() must
		// not re-invoke them (I1). The spy also proves dispose() actually ran.
		const cleanupCalls: Array<string | undefined> = [];
		const unregister = registerSessionResourceCleanup((sessionId) => {
			cleanupCalls.push(sessionId);
		});
		try {
			const { events, factory } = recordShutdowns();
			const { runtimeHost } = await createRuntimeHost(factory);
			const session = runtimeHost.session;

			await Promise.all([session.shutdown(), session.shutdown()]);
			await session.shutdown();
			session.dispose(); // direct dispose after shutdown is a no-op too

			expect(events).toEqual([{ type: "session_shutdown", reason: "quit" }]);
			expect(cleanupCalls).toEqual([session.sessionId]);
		} finally {
			unregister();
		}
	});

	it("disposes the session even when the shutdown emission rejects, and later calls share the outcome", async () => {
		// emit() forwards handler throws to emitError(), whose error-listener loop
		// does not guard against a throwing listener — that rejects the emission.
		// Disposal must still happen (finally), or the session's resources and
		// in-flight streams would be leaked permanently (I4).
		const cleanupCalls: Array<string | undefined> = [];
		const unregister = registerSessionResourceCleanup((sessionId) => {
			cleanupCalls.push(sessionId);
		});
		try {
			const factory: ExtensionFactory = (pi) => {
				pi.on("session_shutdown", () => {
					throw new Error("handler boom");
				});
			};
			const { runtimeHost } = await createRuntimeHost(factory);
			const session = runtimeHost.session;
			session.extensionRunner.onError(() => {
				throw new Error("error listener boom");
			});

			await expect(session.shutdown()).rejects.toThrow("error listener boom");
			// Disposed despite the rejection: the cleanup ran, exactly once.
			expect(cleanupCalls).toEqual([session.sessionId]);
			// A later caller shares the same (rejected) operation and does not
			// re-run disposal.
			await expect(session.shutdown()).rejects.toThrow("error listener boom");
			expect(cleanupCalls).toEqual([session.sessionId]);
			// The runtime's terminal path shares the cached rejected emission too —
			// it surfaces the same failure but still cannot double-run cleanup.
			await expect(runtimeHost.dispose()).rejects.toThrow("error listener boom");
			expect(cleanupCalls).toEqual([session.sessionId]);
		} finally {
			unregister();
		}
	});

	it("fires exactly once with reason quit on the runtime dispose path, even when disposed twice", async () => {
		const { events, factory } = recordShutdowns();
		const { runtimeHost } = await createRuntimeHost(factory);

		await runtimeHost.dispose();
		// The assertion must survive a SECOND disposal (afterEach re-disposes every
		// host; asserting only before that re-dispose would miss a double-fire).
		await runtimeHost.dispose();

		expect(events).toEqual([{ type: "session_shutdown", reason: "quit" }]);
	});

	it("reload then shutdown fires twice, and the quit reaches the POST-reload runner", async () => {
		// Tag each factory instantiation: reload re-runs extension factories on a
		// fresh runner, so the terminal quit must land on generation 2's handler. A
		// quit emitted through the stale generation-1 runner would also produce
		// ["reload", "quit"] in a shared array — the tag is what tells them apart.
		let generation = 0;
		const tagged: string[] = [];
		const factory: ExtensionFactory = (pi) => {
			const g = ++generation;
			pi.on("session_shutdown", (event) => {
				tagged.push(`${g}:${event.reason}`);
			});
		};
		const { runtimeHost } = await createRuntimeHost(factory);

		await runtimeHost.session.reload();
		await runtimeHost.session.shutdown();

		expect(tagged).toEqual(["1:reload", "2:quit"]);
	});

	it("teardownCurrent-driven paths still deliver targetSessionFile", async () => {
		const { events, factory } = recordShutdowns();
		const { runtimeHost } = await createRuntimeHost(factory);

		await runtimeHost.session.prompt("hello");
		const result = await runtimeHost.newSession();
		expect(result.cancelled).toBe(false);

		const teardown = events.find((e) => e.reason === "new");
		expect(teardown).toBeDefined();
		expect(teardown?.targetSessionFile).toBeTruthy();
		expect(teardown?.targetSessionFile).toBe(runtimeHost.session.sessionFile);
	});
});
