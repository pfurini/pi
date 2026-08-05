import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession, type ExtensionFactory } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

describe("composed default stream function", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;
	let sessions: AgentSession[];

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-default-stream-fn-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		sessions = [];
	});

	afterEach(() => {
		// Leave the process-default stack empty for the next test.
		for (const session of sessions) session.dispose();
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createModel(provider: string, api: Api): Model<Api> {
		return {
			id: "capture-model",
			name: "Capture Model",
			api,
			provider,
			baseUrl: "https://capture.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
	}

	function createDoneStream(api: Api, provider: string) {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api,
			provider,
			model: "capture-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		stream.end(message);
		return stream;
	}

	function bareAgent(): Agent {
		// Mirrors extensions that construct Agent instances without supplying streamFn.
		return new Agent({} as AgentOptions);
	}

	/**
	 * Create an AgentSession whose ModelRuntime carries an extension-composed provider.
	 * The overlay's streamSimple bumps `marker.calls`, so a call that reaches it proves
	 * the composed provider pipeline ran (not pi-ai's raw compat path).
	 */
	async function createSessionWithOverlayProvider(
		provider: string,
		marker: { calls: number },
		options: { modelRuntime?: ReturnType<typeof getModelRuntime>; extensionFactory?: ExtensionFactory } = {},
	) {
		const model = createModel(provider, "openai-completions");
		let modelRuntime = options.modelRuntime;
		if (!modelRuntime) {
			const authStorage = AuthStorage.create(join(agentDir, `${provider}-auth.json`));
			await authStorage.modify(provider, async () => ({ type: "api_key", key: "test-api-key" }));
			const modelRegistry = await createModelRegistry(authStorage, join(agentDir, `${provider}-models.json`));
			modelRegistry.registerProvider(provider, {
				api: "openai-completions",
				streamSimple: () => {
					marker.calls++;
					return createDoneStream("openai-completions", provider);
				},
			});
			modelRuntime = getModelRuntime(modelRegistry);
		}
		const settingsManager = SettingsManager.inMemory({});
		let resourceLoader: DefaultResourceLoader | undefined;
		if (options.extensionFactory) {
			resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager,
				extensionFactories: [options.extensionFactory],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			});
			await resourceLoader.reload();
		}
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
			resourceLoader,
		});
		sessions.push(session);
		return { session, model, modelRuntime };
	}

	it("falls back to raw compat before any runtime exists", async () => {
		const agent = bareAgent();
		const model = createModel("no-runtime-provider", "test-unregistered-api");

		// The raw compat path resolves the global API registry and throws for unknown
		// API ids (proof the call did not route through any ModelRuntime).
		await expect(async () => {
			const stream = await agent.streamFunction(model, { messages: [] }, {});
			await stream.result();
		}).rejects.toThrow(/No API provider registered/);
	});

	it("routes a bare Agent through the composed provider once a runtime exists", async () => {
		// Constructed before the runtime: the default must bind late, at call time.
		const agent = bareAgent();
		const marker = { calls: 0 };
		const { model } = await createSessionWithOverlayProvider("capture-provider", marker);

		const stream = await agent.streamFunction(model, { messages: [] }, {});
		const message = await stream.result();

		expect(marker.calls).toBe(1);
		expect(message.stopReason).toBe("stop");
	});

	it("keeps the raw compat path for models no installed runtime knows", async () => {
		const marker = { calls: 0 };
		await createSessionWithOverlayProvider("capture-provider", marker);

		const agent = bareAgent();
		const unknownModel = createModel("unrelated-provider", "test-unregistered-api");
		await expect(async () => {
			const stream = await agent.streamFunction(unknownModel, { messages: [] }, {});
			await stream.result();
		}).rejects.toThrow(/No API provider registered/);
		expect(marker.calls).toBe(0);
	});

	it("ambiguous unscoped dispatch fails; disposal resolves it to the remaining session, then compat", async () => {
		const agent = bareAgent();
		const markerA = { calls: 0 };
		const markerB = { calls: 0 };
		const { session: sessionA, model } = await createSessionWithOverlayProvider("capture-provider", markerA);
		const { session: sessionB } = await createSessionWithOverlayProvider("capture-provider", markerB);

		// Two live sessions can serve the model and no scope applies: never guess which
		// session's settings, auth, hooks, and abort signal the caller meant.
		await expect(async () => {
			await (await agent.streamFunction(model, { messages: [] }, {})).result();
		}).rejects.toThrow(/Ambiguous default-stream dispatch/);
		expect(markerA.calls).toBe(0);
		expect(markerB.calls).toBe(0);

		sessionB.dispose();
		await (await agent.streamFunction(model, { messages: [] }, {})).result();
		expect(markerA.calls).toBe(1);
		expect(markerB.calls).toBe(0);

		sessionA.dispose();
		const unknownModel = createModel("capture-provider", "test-unregistered-api");
		await expect(async () => {
			const stream = await agent.streamFunction(unknownModel, { messages: [] }, {});
			await stream.result();
		}).rejects.toThrow(/No API provider registered/);
	});

	it("gives bare Agents the session stream wrapper: settings, header hook, payload hook", async () => {
		const provider = "wrapper-provider";
		const extensionsDir = join(agentDir, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(
			join(extensionsDir, "hooks.ts"),
			`export default function (pi) {
				pi.on("before_provider_headers", (event) => {
					event.headers["x-hook"] = "on";
				});
				pi.on("before_provider_request", (event) => ({ ...event.payload, hooked: true }));
			}`,
		);

		let captured: SimpleStreamOptions | undefined;
		const authStorage = AuthStorage.create(join(agentDir, "wrapper-auth.json"));
		await authStorage.modify(provider, async () => ({ type: "api_key", key: "test-api-key" }));
		const modelRegistry = await createModelRegistry(authStorage, join(agentDir, "wrapper-models.json"));
		modelRegistry.registerProvider(provider, {
			api: "openai-completions",
			streamSimple: (_model, _context, providerOptions) => {
				captured = providerOptions;
				return createDoneStream("openai-completions", provider);
			},
		});
		const model = createModel(provider, "openai-completions");
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime: getModelRuntime(modelRegistry),
			settingsManager: SettingsManager.inMemory({ httpIdleTimeoutMs: 1234 }),
			sessionManager: SessionManager.inMemory(cwd),
		});
		sessions.push(session);

		const agent = bareAgent();
		await (await agent.streamFunction(model, { messages: [] }, {})).result();

		expect(captured?.timeoutMs).toBe(1234);
		expect(captured?.headers).toMatchObject({ "x-hook": "on" });
		expect(typeof captured?.onPayload).toBe("function");
		await expect(captured?.onPayload?.({ base: true }, model)).resolves.toMatchObject({
			base: true,
			hooked: true,
		});

		// Direct calls to the session stream function (how compaction and branch
		// summarization invoke it) must stay extension-hook-free.
		await (await session.agent.streamFunction(model, { messages: [] }, {})).result();
		expect(captured?.onPayload).toBeUndefined();

		// An untyped caller-supplied transformHeaders wins over the session transform.
		const customTransform = async () => ({ "x-custom": "1" });
		await (
			await agent.streamFunction(model, { messages: [] }, {
				transformHeaders: customTransform,
			} as SimpleStreamOptions)
		).result();
		expect(captured?.headers).toMatchObject({ "x-custom": "1" });
		expect(captured?.headers?.["x-hook"]).toBeUndefined();
	});

	it("provider events carry the request's model, not the session's selected model", async () => {
		const sessionProvider = "session-provider";
		const otherProvider = "other-provider";
		const extensionsDir = join(agentDir, "extensions");
		mkdirSync(extensionsDir, { recursive: true });
		writeFileSync(
			join(extensionsDir, "record-model.ts"),
			`export default function (pi) {
				pi.on("before_provider_headers", (event) => {
					event.headers["x-event-model"] = event.model.provider + "/" + event.model.id;
				});
				pi.on("before_provider_request", (event) => ({
					...event.payload,
					eventModel: event.model.provider + "/" + event.model.id,
				}));
			}`,
		);

		let captured: SimpleStreamOptions | undefined;
		const authStorage = AuthStorage.create(join(agentDir, "model-events-auth.json"));
		await authStorage.modify(sessionProvider, async () => ({ type: "api_key", key: "test-api-key" }));
		await authStorage.modify(otherProvider, async () => ({ type: "api_key", key: "test-api-key" }));
		const modelRegistry = await createModelRegistry(authStorage, join(agentDir, "model-events-models.json"));
		modelRegistry.registerProvider(sessionProvider, {
			api: "openai-completions",
			streamSimple: () => createDoneStream("openai-completions", sessionProvider),
		});
		modelRegistry.registerProvider(otherProvider, {
			api: "openai-completions",
			streamSimple: (_model, _context, providerOptions) => {
				captured = providerOptions;
				return createDoneStream("openai-completions", otherProvider);
			},
		});
		const sessionModel = createModel(sessionProvider, "openai-completions");
		const otherModel: Model<Api> = { ...createModel(otherProvider, "openai-completions"), id: "other-model" };
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: sessionModel,
			modelRuntime: getModelRuntime(modelRegistry),
			settingsManager: SettingsManager.inMemory({}),
			sessionManager: SessionManager.inMemory(cwd),
		});
		sessions.push(session);

		// A bare Agent streams a different provider's model through this session's pipeline:
		// the events must scope to the request's model, never the session's selected one.
		const agent = bareAgent();
		await (await agent.streamFunction(otherModel, { messages: [] }, {})).result();

		expect(captured?.headers).toMatchObject({ "x-event-model": "other-provider/other-model" });
		expect(captured?.headers?.["x-event-model"]).not.toContain(sessionProvider);
		await expect(captured?.onPayload?.({ base: true }, otherModel)).resolves.toMatchObject({
			base: true,
			eventModel: "other-provider/other-model",
		});
	});

	it("keeps raw compat for ad-hoc models a builtin provider's catalog cannot serve", async () => {
		const marker = { calls: 0 };
		const authStorage = AuthStorage.create(join(agentDir, "builtin-auth.json"));
		await authStorage.modify("openai", async () => ({ type: "api_key", key: "test-api-key" }));
		const modelRegistry = await createModelRegistry(authStorage, join(agentDir, "builtin-models.json"));
		modelRegistry.registerProvider("capture-provider", {
			api: "openai-completions",
			streamSimple: () => {
				marker.calls++;
				return createDoneStream("openai-completions", "capture-provider");
			},
		});
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: createModel("capture-provider", "openai-completions"),
			modelRuntime: getModelRuntime(modelRegistry),
			settingsManager: SettingsManager.inMemory({}),
			sessionManager: SessionManager.inMemory(cwd),
		});
		sessions.push(session);

		// "openai" has configured auth in this runtime and its untouched builtin provider is
		// registered, but its catalog does not serve this model's api: the call must stay on
		// the raw compat path instead of streaming through the wrong-protocol provider.
		const agent = bareAgent();
		const adHocModel = createModel("openai", "test-unregistered-api");
		await expect(async () => {
			const stream = await agent.streamFunction(adHocModel, { messages: [] }, {});
			await stream.result();
		}).rejects.toThrow(/No API provider registered/);
		expect(marker.calls).toBe(0);
	});

	it("release removes only its own installation when the same runtime is installed repeatedly", async () => {
		const agent = bareAgent();
		const markerR1 = { calls: 0 };
		const markerR2 = { calls: 0 };
		const {
			session: sessionA,
			model,
			modelRuntime: runtime1,
		} = await createSessionWithOverlayProvider("capture-provider", markerR1);
		const { session: session2 } = await createSessionWithOverlayProvider("capture-provider", markerR2);
		await createSessionWithOverlayProvider("capture-provider", markerR1, { modelRuntime: runtime1 });

		// Stack is [runtime1, runtime2, runtime1]; disposing the first session must remove
		// only its own entry. Disposing session2 as well leaves exactly the third session's
		// runtime1 entry: if sessionA's release had wrongly dropped that entry too, nothing
		// would remain and dispatch would fall back to compat instead of routing.
		sessionA.dispose();
		session2.dispose();

		await (await agent.streamFunction(model, { messages: [] }, {})).result();
		expect(markerR1.calls).toBe(1);
		expect(markerR2.calls).toBe(0);
	});

	it("double dispose does not release another session's installation of the same runtime", async () => {
		const agent = bareAgent();
		const marker = { calls: 0 };
		const {
			session: sessionA,
			model,
			modelRuntime,
		} = await createSessionWithOverlayProvider("capture-provider", marker);
		await createSessionWithOverlayProvider("capture-provider", marker, { modelRuntime });

		sessionA.dispose();
		sessionA.dispose();

		await (await agent.streamFunction(model, { messages: [] }, {})).result();
		expect(marker.calls).toBe(1);
	});

	it("scopes extension-handler bare Agents to the emitting session, not the newest", async () => {
		const markerA = { calls: 0 };
		const markerB = { calls: 0 };
		const agent = bareAgent();
		let runInHandler: (() => Promise<void>) | undefined;
		const { session: sessionA, model } = await createSessionWithOverlayProvider("capture-provider", markerA, {
			extensionFactory: (pi) => {
				pi.on("agent_settled", async () => {
					await runInHandler?.();
				});
			},
		});
		await createSessionWithOverlayProvider("capture-provider", markerB);

		runInHandler = async () => {
			await (await agent.streamFunction(model, { messages: [] }, {})).result();
		};
		await sessionA.extensionRunner.emit({ type: "agent_settled" });

		expect(markerA.calls).toBe(1);
		expect(markerB.calls).toBe(0);
	});

	it("falls through to the stack when the scoped session was disposed (released target)", async () => {
		// A detached promise chain created inside a session scope keeps that scope's
		// AsyncLocalStorage context after the session is gone. Removal from the
		// installation stack only stops UN-scoped routing; without the released flag
		// the late bare call would still route through the disposed session and
		// stream against its already-aborted session signal.
		const markerA = { calls: 0 };
		const markerB = { calls: 0 };
		const agent = bareAgent();
		let detached: Promise<unknown> | undefined;
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { session: sessionA, model } = await createSessionWithOverlayProvider("capture-provider", markerA, {
			extensionFactory: (pi) => {
				pi.on("agent_settled", () => {
					// Started inside the scope, resumed after disposal.
					detached = gate
						.then(() => agent.streamFunction(model, { messages: [] }, {}))
						.then((stream) => stream.result());
				});
			},
		});
		await createSessionWithOverlayProvider("capture-provider", markerB);

		await sessionA.extensionRunner.emit({ type: "agent_settled" });
		sessionA.dispose();
		release?.();
		await detached;

		expect(markerA.calls).toBe(0);
		expect(markerB.calls).toBe(1);
	});

	it("falls through to the stack when the scoped session cannot serve the model", async () => {
		const markerA = { calls: 0 };
		const markerB = { calls: 0 };
		const agent = bareAgent();
		let runInHandler: (() => Promise<void>) | undefined;
		const { session: sessionA } = await createSessionWithOverlayProvider("capture-provider", markerA, {
			extensionFactory: (pi) => {
				pi.on("agent_settled", async () => {
					await runInHandler?.();
				});
			},
		});
		const { model: modelB } = await createSessionWithOverlayProvider("b-only-provider", markerB);

		runInHandler = async () => {
			await (await agent.streamFunction(modelB, { messages: [] }, {})).result();
		};
		await sessionA.extensionRunner.emit({ type: "agent_settled" });

		expect(markerB.calls).toBe(1);
		expect(markerA.calls).toBe(0);
	});

	it("scopes extension-tool bare Agents to the prompting session (full run tree)", async () => {
		const markerA = { calls: 0 };
		const markerB = { calls: 0 };
		const agent = bareAgent();
		const faux = registerFauxProvider();
		try {
			faux.setResponses([fauxAssistantMessage([fauxToolCall("spawn_bare", {})]), fauxAssistantMessage("done")]);
			const fauxModel = faux.getModel();
			const bareModel = createModel("capture-provider", "openai-completions");

			const authStorage = AuthStorage.inMemory();
			await authStorage.modify(fauxModel.provider, async () => ({ type: "api_key", key: "faux-key" }));
			await authStorage.modify("capture-provider", async () => ({ type: "api_key", key: "test-api-key" }));
			const modelRuntime = await ModelRuntime.create({
				credentials: authStorage,
				modelsPath: join(agentDir, "faux-models.json"),
				allowModelNetwork: false,
			});
			modelRuntime.registerProvider(fauxModel.provider, {
				baseUrl: fauxModel.baseUrl,
				api: fauxModel.api,
				models: [
					{
						id: fauxModel.id,
						name: fauxModel.name,
						api: fauxModel.api,
						reasoning: fauxModel.reasoning,
						input: fauxModel.input,
						cost: fauxModel.cost,
						contextWindow: fauxModel.contextWindow,
						maxTokens: fauxModel.maxTokens,
						baseUrl: fauxModel.baseUrl,
					},
				],
			});
			modelRuntime.registerProvider("capture-provider", {
				api: "openai-completions",
				streamSimple: () => {
					markerA.calls++;
					return createDoneStream("openai-completions", "capture-provider");
				},
			});

			const settingsManager = SettingsManager.inMemory({});
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager,
				extensionFactories: [
					(pi) => {
						pi.registerTool({
							name: "spawn_bare",
							label: "spawn_bare",
							description: "spawns a bare agent",
							parameters: { type: "object", properties: {} },
							execute: async () => {
								await (await agent.streamFunction(bareModel, { messages: [] }, {})).result();
								return { content: [{ type: "text", text: "spawned" }], details: {} };
							},
						} as never);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			});
			await resourceLoader.reload();

			const { session: sessionA } = await createAgentSession({
				cwd,
				agentDir,
				model: fauxModel,
				modelRuntime,
				settingsManager,
				sessionManager: SessionManager.inMemory(cwd),
				resourceLoader,
			});
			sessions.push(sessionA);
			await sessionA.bindExtensions({});

			await createSessionWithOverlayProvider("capture-provider", markerB);

			await sessionA.prompt("run the spawn_bare tool");

			expect(markerA.calls).toBe(1);
			expect(markerB.calls).toBe(0);
		} finally {
			faux.unregister();
		}
	});
});
