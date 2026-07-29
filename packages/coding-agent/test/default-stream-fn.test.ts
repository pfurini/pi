import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";
import { type Api, type AssistantMessage, createAssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
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
		// API ids — proof the call did not route through any ModelRuntime.
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
