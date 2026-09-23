import type { StreamFn } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { getCurrentTools, streamSimple } from "@earendil-works/pi-ai/compat";
import { OPENAI_CODEX_AMBIENT_TOKEN_ENV } from "@earendil-works/pi-ai/providers/openai-codex";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionEvent } from "../../src/core/agent-session.ts";
import { composedDefaultStreamFn } from "../../src/core/default-stream-fn.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { createHarness, type Harness, type HarnessOptions } from "./harness.ts";

const oauthToken = "fabricated-codex-oauth";
const ambientToken = "fabricated-proxy-sentinel";
type AuthMode = "oauth" | "ambient" | "both";

function seedHistory(session: AgentSession): string {
	const target = session.sessionManager.appendMessage({
		role: "user",
		content: "old conversation",
		timestamp: Date.now() - 2000,
	});
	session.sessionManager.appendMessage(fauxAssistantMessage("old answer", { timestamp: Date.now() - 1000 }));
	session.sessionManager.appendMessage({ role: "user", content: "recent question", timestamp: Date.now() });
	session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
	return target;
}

async function summarize(session: AgentSession, kind: "compaction" | "branch", target: string): Promise<string> {
	if (kind === "compaction") return (await session.compact()).summary;
	const result = await session.navigateTree(target, { summarize: true });
	expect(result.cancelled).toBe(false);
	return result.summaryEntry?.summary ?? "";
}

describe("session summary authentication ownership", () => {
	const harnesses: Harness[] = [];
	const sessions: AgentSession[] = [];

	afterEach(() => {
		while (sessions.length) sessions.pop()?.dispose();
		while (harnesses.length) harnesses.pop()?.cleanup();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function setup(
		auth: AuthMode = "oauth",
		options: Pick<HarnessOptions, "extensionFactories" | "modelsJson"> = {},
	) {
		vi.stubEnv(OPENAI_CODEX_AMBIENT_TOKEN_ENV, auth === "oauth" ? undefined : ambientToken);
		const harness = await createHarness({
			...options,
			withConfiguredAuth: false,
			settings: {
				compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 1024 },
				retry: { enabled: true, maxRetries: 2, baseDelayMs: 0 },
			},
		});
		harnesses.push(harness);
		const runtime = harness.session.modelRuntime;
		if (auth !== "ambient") {
			await harness.authStorage.modify("openai-codex", async () => ({
				type: "oauth",
				access: oauthToken,
				refresh: "fabricated-refresh",
				expires: Date.now() + 60 * 60_000,
			}));
		}
		await runtime.refresh({ providers: ["openai-codex"], allowNetwork: false });
		const provider = runtime.getProvider("openai-codex")!;
		const model = { ...runtime.getModels("openai-codex")[0], contextWindow: 100_000 };
		const faux = fauxProvider({ provider: model.provider, api: model.api });
		// Keep real Codex auth and the SDK stream; replace only the provider transport.
		const transport = vi.spyOn(provider, "streamSimple").mockImplementation(faux.provider.streamSimple);
		const { session } = await createAgentSession({
			cwd: harness.tempDir,
			agentDir: harness.tempDir,
			model,
			modelRuntime: runtime,
			settingsManager: harness.settingsManager,
			sessionManager: harness.sessionManager,
			resourceLoader: harness.session.resourceLoader,
			tools: [],
		});
		sessions.push(session);
		const events: AgentSessionEvent[] = [];
		session.subscribe((event) => events.push(event));
		return { harness, session, runtime, model, faux, transport, events };
	}

	it.each(["oauth", "ambient", "both"] as const)("resolves ordinary Codex auth with %s credentials", async (auth) => {
		const { runtime, model } = await setup(auth);
		const result = await runtime.getAuth(model);
		expect(result?.auth.apiKey).toBe(auth === "ambient" ? ambientToken : oauthToken);
		expect(result?.source).toBe(auth === "ambient" ? OPENAI_CODEX_AMBIENT_TOKEN_ENV : "OAuth");
	});

	describe.each(["compaction", "branch"] as const)("%s", (kind) => {
		it.each(["oauth", "ambient", "both"] as const)(
			"summarizes through the canonical stream with %s auth",
			async (auth) => {
				const { session, faux, transport } = await setup(auth);
				const canonicalStream = session.agent.streamFunction;
				const target = seedHistory(session);
				faux.setResponses([fauxAssistantMessage("authenticated summary")]);

				expect(await summarize(session, kind, target)).toContain("authenticated summary");
				expect(session.agent.streamFunction).toBe(canonicalStream);
				expect(transport).toHaveBeenCalledTimes(1);
				expect(transport.mock.calls[0][2]?.apiKey).toBe(auth === "ambient" ? ambientToken : oauthToken);
				expect(session.sessionManager.getLeafEntry()?.type).toBe(
					kind === "branch" ? "branch_summary" : "compaction",
				);
			},
		);

		it("re-resolves OAuth on a transient summary retry", async () => {
			const { session, harness, faux, transport, events } = await setup();
			const target = seedHistory(session);
			faux.setResponses([
				async () => {
					await harness.authStorage.modify("openai-codex", async () => ({
						type: "oauth",
						access: "rotated-fabricated-oauth",
						refresh: "fabricated-refresh",
						expires: Date.now() + 60 * 60_000,
					}));
					return fauxAssistantMessage("", { stopReason: "error", errorMessage: "terminated" });
				},
				fauxAssistantMessage("retried summary"),
			]);

			expect(await summarize(session, kind, target)).toContain("retried summary");
			expect(transport.mock.calls.map((call) => call[2]?.apiKey)).toEqual([oauthToken, "rotated-fabricated-oauth"]);
			expect(events.filter((event) => event.type === "summarization_retry_scheduled")).toHaveLength(1);
			expect(events.filter((event) => event.type === "summarization_retry_finished")).toHaveLength(1);
		});

		it("cancels an in-flight canonical summary without persisting it", async () => {
			const { session, faux, transport } = await setup();
			const target = seedHistory(session);
			const leaf = session.sessionManager.getLeafId();
			faux.setResponses([
				(_context, options) => {
					expect(options?.signal?.aborted).toBe(false);
					if (kind === "compaction") session.abortCompaction();
					else session.abortBranchSummary();
					expect(options?.signal?.aborted).toBe(true);
					return fauxAssistantMessage("must not persist");
				},
			]);

			if (kind === "compaction") {
				await expect(session.compact()).rejects.toThrow("Compaction cancelled");
			} else {
				await expect(session.navigateTree(target, { summarize: true })).resolves.toMatchObject({
					cancelled: true,
					aborted: true,
				});
			}
			expect(transport).toHaveBeenCalledTimes(1);
			expect(session.sessionManager.getLeafId()).toBe(leaf);
			expect(session.isIdle).toBe(true);
		});
	});

	it.each([false, true])("preserves compaction hooks (cancel: %s)", async (cancel) => {
		const { session, transport } = await setup("oauth", {
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", (event) =>
						cancel
							? { cancel: true }
							: {
									compaction: {
										summary: "hook summary",
										firstKeptEntryId: event.preparation.firstKeptEntryId,
										tokensBefore: event.preparation.tokensBefore,
									},
								},
					);
				},
			],
		});
		seedHistory(session);
		if (cancel) await expect(session.compact()).rejects.toThrow("Compaction cancelled");
		else expect((await session.compact()).summary).toBe("hook summary");
		expect(transport).not.toHaveBeenCalled();
	});

	it.each([false, true])("preserves branch summary hooks (cancel: %s)", async (cancel) => {
		const { session, transport } = await setup("oauth", {
			extensionFactories: [
				(pi) => {
					pi.on("session_before_tree", () =>
						cancel ? { cancel: true } : { summary: { summary: "hook branch summary" } },
					);
				},
			],
		});
		const target = seedHistory(session);
		const result = await session.navigateTree(target, { summarize: true });
		expect(result.cancelled).toBe(cancel);
		expect(result.summaryEntry?.summary).toBe(cancel ? undefined : "hook branch summary");
		expect(transport).not.toHaveBeenCalled();
	});

	it("keeps models.json routing and headers for canonical summaries", async () => {
		const { session, faux, transport } = await setup("oauth", {
			modelsJson: {
				providers: {
					"openai-codex": {
						baseUrl: "https://configured-models.invalid",
						headers: { "x-config-file": "present" },
					},
				},
			},
		});
		seedHistory(session);
		faux.setResponses([fauxAssistantMessage("configured summary")]);

		expect((await session.compact()).summary).toBe("configured summary");
		expect(transport.mock.calls[0][0].baseUrl).toBe("https://configured-models.invalid");
		expect(transport.mock.calls[0][2]?.headers).toMatchObject({ "x-config-file": "present" });
	});

	it.each([
		{ reason: "threshold", contextWindow: 10_000, reserveTokens: 9500 },
		{ reason: "overflow", contextWindow: 500, reserveTokens: 0 },
	])(
		"compacts a successful $reason response without retrying the answer",
		async ({ reason, contextWindow, reserveTokens }) => {
			const { session, harness, model, faux, events } = await setup();
			session.agent.state.model = { ...model, contextWindow };
			harness.settingsManager.applyOverrides({ compaction: { enabled: true, reserveTokens, keepRecentTokens: 1 } });
			faux.setResponses([fauxAssistantMessage("completed answer"), fauxAssistantMessage("automatic summary")]);

			await session.prompt("x".repeat(4000));

			expect(faux.state.callCount).toBe(2);
			expect(events.filter((event) => event.type === "compaction_end")).toEqual([
				expect.objectContaining({
					reason,
					aborted: false,
					willRetry: false,
					result: expect.objectContaining({ summary: expect.stringContaining("automatic summary") }),
				}),
			]);
			expect(session.getLastAssistantText()).toBe("completed answer");
		},
	);

	it.each([false, true])(
		"retries an overflow once after canonical compaction (repeated overflow: %s)",
		async (repeated) => {
			const { session, harness, faux, events } = await setup();
			seedHistory(session);
			harness.settingsManager.applyOverrides({ compaction: { enabled: true } });
			faux.setResponses([
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long" }),
				fauxAssistantMessage("overflow summary"),
				fauxAssistantMessage("turn prefix"),
				(context) => {
					expect(JSON.stringify(context.messages)).toContain("overflow summary");
					expect(context.messages.at(-1)?.role).toBe("user");
					return repeated
						? fauxAssistantMessage("", {
								stopReason: "error",
								errorMessage: "prompt is too long",
								timestamp: Date.now() + 1000,
							})
						: fauxAssistantMessage("recovered answer");
				},
			]);

			await session.prompt("continue");

			expect(faux.state.callCount).toBe(4);
			expect(events.filter((event) => event.type === "compaction_start")).toHaveLength(1);
			expect(events.find((event) => event.type === "compaction_end")).toMatchObject({
				reason: "overflow",
				aborted: false,
				willRetry: true,
				result: expect.objectContaining({ summary: expect.stringContaining("overflow summary") }),
			});
			if (repeated) {
				expect(events.filter((event) => event.type === "compaction_end").at(-1)).toMatchObject({
					willRetry: false,
					errorMessage: expect.stringContaining("after one compact-and-retry attempt"),
				});
			} else {
				expect(session.getLastAssistantText()).toBe("recovered answer");
			}
		},
	);

	it("preserves configured routing, headers, request settings, and summary hook isolation", async () => {
		const { session, harness, runtime, model, faux } = await setup();
		const payloadHook = vi.spyOn(session.extensionRunner, "emitBeforeProviderRequest");
		const headerHook = vi
			.spyOn(session.extensionRunner, "emitBeforeProviderHeaders")
			.mockImplementation(async (headers) => ({
				...headers,
				"x-summary-hook": "present",
			}));
		vi.spyOn(session.extensionRunner, "hasHandlers").mockImplementation(
			(name) =>
				name === "before_provider_request" ||
				name === "after_provider_response" ||
				name === "before_provider_headers",
		);
		const transport = vi.fn(faux.provider.streamSimple);
		runtime.registerProvider(model.provider, {
			api: model.api,
			baseUrl: "https://summary-routing.invalid/v1",
			headers: { "x-configured": "provider-header" },
			streamSimple: transport,
		});
		await runtime.refresh({ providers: [model.provider], allowNetwork: false });
		await session.setModel(runtime.getModel(model.provider, model.id)!);
		harness.settingsManager.applyOverrides({
			httpIdleTimeoutMs: 4321,
			websocketConnectTimeoutMs: 1234,
			retry: { provider: { maxRetries: 3, maxRetryDelayMs: 4567 } },
		});
		seedHistory(session);
		faux.setResponses([fauxAssistantMessage("configured summary")]);

		await session.compact();

		expect(transport).toHaveBeenCalledTimes(1);
		const [requestModel, context, options] = transport.mock.calls[0];
		expect(requestModel.baseUrl).toBe("https://summary-routing.invalid/v1");
		expect(getCurrentTools(context.messages)).toEqual([]);
		expect(options).toMatchObject({
			apiKey: oauthToken,
			headers: { "x-configured": "provider-header", "x-summary-hook": "present" },
			timeoutMs: 4321,
			websocketConnectTimeoutMs: 1234,
			maxRetries: 3,
			maxRetryDelayMs: 4567,
			cacheRetention: "none",
		});
		expect(options?.sessionId).toBeTruthy();
		expect(options?.sessionId).not.toBe(session.sessionId);
		expect(options?.onPayload).toBeUndefined();
		expect(options?.onResponse).toBeUndefined();
		expect(headerHook).toHaveBeenCalledTimes(1);
		expect(payloadHook).not.toHaveBeenCalled();
	});

	it.each(["sdk", "direct"] as const)(
		"forwards stored OAuth to a custom stream in a %s session",
		async (construction) => {
			const { session, harness, model, faux } = await setup();
			const targetSession = construction === "sdk" ? session : harness.session;
			targetSession.agent.state.model = model;
			const customStream: StreamFn = vi.fn(faux.provider.streamSimple);
			targetSession.agent.streamFunction = customStream;
			seedHistory(targetSession);
			faux.setResponses([
				(_context, options) => {
					expect(options?.apiKey).toBe(oauthToken);
					return fauxAssistantMessage("custom summary");
				},
			]);

			expect((await targetSession.compact()).summary).toBe("custom summary");
			expect(customStream).toHaveBeenCalledTimes(1);
		},
	);

	it("preserves a custom stream's fallback after auth resolution throws", async () => {
		const { session, runtime, faux } = await setup();
		vi.spyOn(runtime, "getAuth").mockRejectedValue(new Error("custom auth unavailable"));
		session.agent.streamFunction = faux.provider.streamSimple;
		seedHistory(session);
		faux.setResponses([
			(_context, options) => {
				expect(options?.apiKey).toBeUndefined();
				return fauxAssistantMessage("self-authenticated summary");
			},
		]);

		expect((await session.compact()).summary).toBe("self-authenticated summary");
	});

	it("cancels canonical credential resolution before invoking transport", async () => {
		const { session, harness, transport } = await setup();
		seedHistory(session);
		const read = vi.spyOn(harness.authStorage, "read").mockImplementation(async (_provider, options) => {
			expect(options?.signal).toBeDefined();
			session.abortCompaction();
			options?.signal?.throwIfAborted();
			return undefined;
		});

		await expect(session.compact()).rejects.toThrow(/aborted/i);
		expect(read).toHaveBeenCalledTimes(1);
		expect(transport).not.toHaveBeenCalled();
		expect(session.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
	});

	it("surfaces canonical credential failures without persisting a summary", async () => {
		const { session, harness, transport, events } = await setup();
		seedHistory(session);
		vi.spyOn(harness.authStorage, "read").mockRejectedValue(new Error("credential storage unavailable"));

		await expect(session.compact()).rejects.toThrow("credential storage unavailable");
		expect(transport).not.toHaveBeenCalled();
		expect(events.filter((event) => event.type === "compaction_end")).toEqual([
			expect.objectContaining({
				aborted: false,
				errorMessage: expect.stringContaining("credential storage unavailable"),
			}),
		]);
		expect(session.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
	});

	it.each(["canonical", "custom"] as const)(
		"preserves header-only auth, environment, and credential routing for %s streams",
		async (kind) => {
			const { session, runtime, harness } = await setup();
			const model = harness.getModel();
			const faux = fauxProvider({ provider: model.provider, api: model.api });
			runtime.registerNativeProvider({
				...faux.provider,
				auth: {
					apiKey: {
						name: "Header-only test auth",
						resolve: async () => ({
							auth: {
								baseUrl: "https://credential-routing.invalid",
								headers: { Authorization: "Bearer fabricated", "x-deleted": null },
							},
							env: { SUMMARY_ROUTE: "fixture" },
							source: "fixture",
						}),
					},
				},
			});
			await runtime.refresh({ providers: [model.provider], allowNetwork: false });
			session.agent.state.model = model;
			if (kind === "custom") session.agent.streamFunction = faux.provider.streamSimple;
			seedHistory(session);
			faux.setResponses([
				(_context, options, _state, requestModel) => {
					expect(requestModel.baseUrl).toBe("https://credential-routing.invalid");
					expect(options?.apiKey).toBeUndefined();
					expect(options?.headers?.Authorization).toBe("Bearer fabricated");
					expect(options?.headers?.["x-deleted"]).toBe(kind === "canonical" ? null : undefined);
					expect(options?.env).toEqual({ SUMMARY_ROUTE: "fixture" });
					return fauxAssistantMessage("header-authenticated summary");
				},
			]);

			expect((await session.compact()).summary).toBe("header-authenticated summary");
		},
	);

	it.each([streamSimple, composedDefaultStreamFn])(
		"retains raw/default auth forwarding in direct sessions (%#)",
		async (stream) => {
			const harness = await createHarness({ settings: { compaction: { keepRecentTokens: 1 } } });
			harnesses.push(harness);
			harness.session.agent.streamFunction = stream;
			seedHistory(harness.session);
			harness.setResponses([
				(_context, options) => {
					expect(options?.apiKey).toBe("faux-key");
					return fauxAssistantMessage("default summary");
				},
			]);

			expect((await harness.session.compact()).summary).toBe("default summary");
		},
	);

	it("keeps required auth validation for a raw stream after replacing the SDK stream", async () => {
		const { session, runtime } = await setup();
		vi.spyOn(runtime, "getAuth").mockResolvedValue(undefined);
		session.agent.streamFunction = streamSimple;
		seedHistory(session);

		await expect(session.compact()).rejects.toThrow('Authentication failed for "openai-codex"');
	});
});
