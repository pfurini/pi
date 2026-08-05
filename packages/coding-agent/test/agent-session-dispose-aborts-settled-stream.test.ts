import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";

// dispose() must abort an in-flight model stream even when the run that started it
// has already SETTLED. agent.abort() only fires the active run's controller, so a
// subagent parked at a tool boundary under a settled run would otherwise never see
// an abort — the leak this fix closes. Here the fake stream ends normally so the
// run settles via finishRun, then we assert the session signal (which the provider
// received, combined via AbortSignal.any) fires only on dispose.
describe("AgentSession.dispose aborts a settled run's session stream", () => {
	const api: Api = "openai-completions";
	let tempDir: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-dispose-settled-"));
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createModel(): Model<Api> {
		return {
			id: "capture-model",
			name: "Capture Model",
			api,
			provider: "capture-provider",
			baseUrl: "https://capture.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
	}

	function createDoneStream() {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api,
			provider: "capture-provider",
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

	// A provider that ends the stream normally but retains the signal it was given and
	// tracks a "live resource" the session signal is expected to release on abort.
	async function makeSession() {
		const model = createModel();
		const settingsManager = SettingsManager.inMemory({});
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		await authStorage.modify(model.provider, async () => ({ type: "api_key", key: "test-api-key" }));
		const modelRegistry = await createModelRegistry(authStorage, join(agentDir, "models.json"));

		const probe = {
			signal: undefined as AbortSignal | undefined,
			abortCount: 0,
			resourceLive: false,
			streamCalls: 0,
		};

		modelRegistry.registerProvider(model.provider, {
			api,
			streamSimple: (_model, _context, options?: SimpleStreamOptions) => {
				probe.streamCalls += 1;
				probe.signal = options?.signal;
				probe.resourceLive = true;
				options?.signal?.addEventListener(
					"abort",
					() => {
						probe.abortCount += 1;
						probe.resourceLive = false; // the parked child dies when the signal fires
					},
					{ once: true },
				);
				return createDoneStream();
			},
		});

		const modelRuntime = getModelRuntime(modelRegistry);
		const sessionManager = SessionManager.inMemory(cwd);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			settingsManager,
			sessionManager,
		});

		return { session, probe, cleanup: () => modelRegistry.unregisterProvider(model.provider) };
	}

	it("aborts the retained signal only on dispose, releasing the parked resource", async () => {
		const { session, probe, cleanup } = await makeSession();
		try {
			// 1. Run one turn to completion so the run settles via finishRun.
			await session.prompt("hello");

			// 2. The run has settled — the session is idle again.
			expect(session.isIdle).toBe(true);

			// 3. The provider was called and its signal is still un-aborted after settle
			//    (agent.abort() never fires on a normal settle).
			expect(probe.streamCalls).toBe(1);
			expect(probe.signal).toBeDefined();
			expect(probe.signal?.aborted).toBe(false);
			expect(probe.abortCount).toBe(0);
			expect(probe.resourceLive).toBe(true);

			// 4. Dispose the settled session.
			session.dispose();

			// 5. The retained signal is now aborted, exactly once...
			expect(probe.signal?.aborted).toBe(true);
			expect(probe.abortCount).toBe(1);

			// 6. ...and the parked resource transitioned live -> closed via the handler.
			expect(probe.resourceLive).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("does not abort a normal turn on a live (non-disposed) session", async () => {
		const { session, probe, cleanup } = await makeSession();
		try {
			await session.prompt("hello");
			expect(session.isIdle).toBe(true);
			// The turn completed and nothing aborted it: the session signal only fires on
			// dispose, not at the end of an ordinary turn.
			expect(probe.signal?.aborted).toBe(false);
			expect(probe.abortCount).toBe(0);
			expect(probe.resourceLive).toBe(true);
		} finally {
			session.dispose();
			cleanup();
		}
	});
});
