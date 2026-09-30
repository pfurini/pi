import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentOptions } from "@earendil-works/pi-agent-core";
import {
	fauxAssistantMessage,
	fauxProvider,
	getCurrentSystemPrompt,
	normalizeContext,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const forcedPrompt = "Only return OK. No workspace information belongs in this prompt.";

describe("provider session context", () => {
	const sessions: AgentSession[] = [];
	const loaders: DefaultResourceLoader[] = [];
	let tempDir: string;

	afterEach(() => {
		while (sessions.length) sessions.pop()?.dispose();
		while (loaders.length) loaders.pop()?.dispose();
		if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	});

	async function setup() {
		tempDir = mkdtempSync(join(tmpdir(), "pi-provider-session-context-"));
		const faux = fauxProvider();
		const model = faux.getModel();
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		runtime.registerNativeProvider({
			...faux.provider,
			auth: {
				apiKey: {
					name: "Faux",
					resolve: async () => ({ auth: { apiKey: "faux-key" } }),
				},
			},
		});
		await runtime.refresh({ allowNetwork: false });
		async function createSession(name: string, extensionFactories: ExtensionFactory[] = []) {
			const cwd = join(tempDir, name, "project");
			const agentDir = join(tempDir, name, "agent");
			mkdirSync(cwd, { recursive: true });
			mkdirSync(agentDir, { recursive: true });
			const settingsManager = SettingsManager.inMemory({
				compaction: { enabled: false },
				retry: { enabled: false },
			});
			const resourceLoader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				extensionFactories,
				systemPromptOverride: () => forcedPrompt,
				appendSystemPromptOverride: () => [],
				agentsFilesOverride: () => ({ agentsFiles: [] }),
			});
			loaders.push(resourceLoader);
			await resourceLoader.reload();
			const { session } = await createAgentSession({
				cwd,
				agentDir,
				model,
				modelRuntime: runtime,
				resourceLoader,
				settingsManager,
				sessionManager: SessionManager.inMemory(cwd),
				tools: [],
			});
			sessions.push(session);
			return { session, cwd, agentDir, resourceLoader };
		}
		return { faux, model, runtime, createSession };
	}

	it("isolates a parent's scoped bare calls from an extension-free child on a shared native runtime", async () => {
		const { faux, model, createSession } = await setup();
		const captured: SimpleStreamOptions[] = [];
		const bare = new Agent({ initialState: { model } } as AgentOptions);
		const parent = await createSession("parent", [
			(pi) => {
				pi.on("agent_settled", async () => {
					await (
						await bare.streamFunction(model, normalizeContext({ messages: [] }), { sessionId: "bare-route" })
					).result();
				});
			},
		]);
		const child = await createSession("child");
		expect(child.resourceLoader.getExtensions().extensions).toEqual([]);
		expect(child.session.modelRuntime).toBe(parent.session.modelRuntime);
		expect(child.session.sessionId).not.toBe(parent.session.sessionId);
		faux.setResponses([
			(context, options) => {
				expect(getCurrentSystemPrompt(context.messages)).toContain(forcedPrompt);
				captured.push(options ?? {});
				return fauxAssistantMessage("OK");
			},
			(_context, options) => {
				captured.push(options ?? {});
				return fauxAssistantMessage("OK");
			},
		]);
		await child.session.prompt("test");
		expect(child.session.getLastAssistantText()).toBe("OK");
		await parent.session.extensionRunner.emit({ type: "agent_settled" });
		expect(captured).toHaveLength(2);
		expect(captured[0].sessionContext).toEqual({
			ownerSessionId: child.session.sessionId,
			cwd: child.cwd,
			agentDir: child.agentDir,
		});
		expect(captured[0].sessionId).toBe(child.session.sessionId);
		expect(captured[1].sessionContext).toEqual({
			ownerSessionId: parent.session.sessionId,
			cwd: parent.cwd,
			agentDir: parent.agentDir,
		});
		expect(captured[1].sessionId).toBe("bare-route");
	});

	it("refreshes the owner snapshot after session replacement and preserves it through virtual routing", async () => {
		const { faux, model, runtime, createSession } = await setup();
		const { session, cwd, agentDir } = await createSession("owner");
		runtime.registerVirtualModel({
			provider: "virtual-context",
			id: "virtual",
			name: "Virtual",
			route: () => ({ model, thinkingLevel: "off" }),
		});
		const virtual = runtime.getModel("virtual-context", "virtual")!;
		const captured: SimpleStreamOptions[] = [];
		const capture = (_context: unknown, options?: SimpleStreamOptions) => {
			captured.push(options ?? {});
			return fauxAssistantMessage("OK");
		};
		faux.setResponses([capture, capture, capture]);
		const requestOptions: SimpleStreamOptions = {
			sessionId: "summary-route",
			sessionContext: { ownerSessionId: "fake", cwd: "/fake", agentDir: "/fake-agent" },
		};
		const stream = () => session.agent.streamFunction(virtual, normalizeContext({ messages: [] }), requestOptions);
		expect((await (await stream()).result()).stopReason).toBe("stop");
		expect((await (await stream()).result()).stopReason).toBe("stop");
		const oldOwner = session.sessionId;
		session.sessionManager.newSession();
		await (await stream()).result();
		expect(captured).toHaveLength(3);
		expect(captured[0].sessionContext).toEqual({ ownerSessionId: oldOwner, cwd, agentDir });
		expect(captured[1].sessionContext).toEqual(captured[0].sessionContext);
		expect(captured[1].sessionContext).not.toBe(captured[0].sessionContext);
		expect(session.sessionId).not.toBe(oldOwner);
		expect(captured[2].sessionContext).toEqual({ ownerSessionId: session.sessionId, cwd, agentDir });
		expect(captured.map((options) => options.sessionId)).toEqual(["summary-route", "summary-route", "summary-route"]);
		expect(requestOptions.sessionContext?.ownerSessionId).toBe("fake");
	});
});
