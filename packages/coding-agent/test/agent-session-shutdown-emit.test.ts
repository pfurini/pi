import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
			await runtimeHost.dispose();
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

	it("fires exactly once on shutdown(), and concurrent/subsequent shutdowns await the same emission", async () => {
		const { events, factory } = recordShutdowns();
		const { runtimeHost } = await createRuntimeHost(factory);
		const session = runtimeHost.session;

		// Concurrent shutdowns must share the single emission...
		await Promise.all([session.shutdown(), session.shutdown()]);
		// ...and a subsequent one must not re-fire.
		await session.shutdown();

		expect(events).toEqual([{ type: "session_shutdown", reason: "quit" }]);
	});

	it("fires exactly once with reason quit on the runtime dispose path", async () => {
		const { events, factory } = recordShutdowns();
		const { runtimeHost } = await createRuntimeHost(factory);

		await runtimeHost.dispose();

		expect(events).toEqual([{ type: "session_shutdown", reason: "quit" }]);
	});

	it("reload then shutdown fires twice (reload then quit): the terminal seam does not swallow the post-reload quit", async () => {
		const { events, factory } = recordShutdowns();
		const { runtimeHost } = await createRuntimeHost(factory);

		await runtimeHost.session.reload();
		await runtimeHost.session.shutdown();

		expect(events.map((e) => e.reason)).toEqual(["reload", "quit"]);
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
