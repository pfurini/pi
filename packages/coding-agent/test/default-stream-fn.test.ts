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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createAgentSession } from "../src/core/sdk.ts";
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
		options: { modelRuntime?: ReturnType<typeof getModelRuntime> } = {},
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
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			settingsManager: SettingsManager.inMemory({}),
			sessionManager: SessionManager.inMemory(cwd),
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

	it("last-created session wins; disposal restores the previous runtime, then the compat fallback", async () => {
		const agent = bareAgent();
		const markerA = { calls: 0 };
		const markerB = { calls: 0 };
		const { session: sessionA, model } = await createSessionWithOverlayProvider("capture-provider", markerA);
		const { session: sessionB } = await createSessionWithOverlayProvider("capture-provider", markerB);

		await (await agent.streamFunction(model, { messages: [] }, {})).result();
		expect(markerB.calls).toBe(1);
		expect(markerA.calls).toBe(0);

		sessionB.dispose();
		await (await agent.streamFunction(model, { messages: [] }, {})).result();
		expect(markerA.calls).toBe(1);
		expect(markerB.calls).toBe(1);

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
		await createSessionWithOverlayProvider("capture-provider", markerR2);
		await createSessionWithOverlayProvider("capture-provider", markerR1, { modelRuntime: runtime1 });

		// Stack is [runtime1, runtime2, runtime1]; disposing the first session must remove
		// its own entry, leaving the third session's runtime1 entry on top.
		sessionA.dispose();

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
});
