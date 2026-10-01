import { afterEach, describe, expect, it, vi } from "vitest";
import * as anthropic from "../src/api/anthropic-messages.ts";
import * as completions from "../src/api/openai-completions.ts";
import * as responses from "../src/api/openai-responses.ts";
import * as piMessages from "../src/api/pi-messages.ts";
import type { ProviderSessionContext } from "../src/index.ts";
import type { Api, FetchFunction, Model, SimpleStreamOptions } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const sessionContext: ProviderSessionContext = {
	agentSessionId: "local-only-owner-9f41",
	cwd: "/local-only-workspace-9f41",
	agentDir: "/local-only-agent-9f41",
};
const context = normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] });

function model<TApi extends Api>(api: TApi): Model<TApi> {
	return {
		id: "test-model",
		name: "Test Model",
		api,
		provider: "test-provider",
		baseUrl: "https://upstream.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10_000,
		maxTokens: 1_000,
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("local provider session context", () => {
	for (const entry of ["stream", "streamSimple"] as const) {
		const adapters = [
			{
				name: "Anthropic",
				run: (options: SimpleStreamOptions) =>
					(entry === "stream" ? anthropic.stream : anthropic.streamSimple)(
						model("anthropic-messages"),
						context,
						options,
					),
			},
			{
				name: "OpenAI completions",
				run: (options: SimpleStreamOptions) =>
					(entry === "stream" ? completions.stream : completions.streamSimple)(
						model("openai-completions"),
						context,
						options,
					),
			},
			{
				name: "OpenAI responses",
				run: (options: SimpleStreamOptions) =>
					(entry === "stream" ? responses.stream : responses.streamSimple)(
						model("openai-responses"),
						context,
						options,
					),
			},
			{
				name: "Pi messages",
				run: (options: SimpleStreamOptions) =>
					(entry === "stream" ? piMessages.stream : piMessages.streamSimple)(
						model("pi-messages"),
						context,
						options,
					),
			},
		];
		it.each(adapters)(`${entry} excludes local metadata from $name payloads and headers`, async ({ run }) => {
			const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
			const transport = vi.fn<FetchFunction>(async (input, init) => {
				const request = new Request(input, init);
				requests.push({
					url: request.url,
					headers: Object.fromEntries(request.headers),
					body: await request.text(),
				});
				return new Response(JSON.stringify({ error: { message: "mock rejection" } }), {
					status: 401,
					headers: { "content-type": "application/json" },
				});
			});
			const ambient = vi.fn<FetchFunction>(async () => {
				throw new Error("unexpected network request");
			});
			vi.stubGlobal("fetch", ambient);
			const payloads: unknown[] = [];
			await run({
				apiKey: "test-key",
				fetch: transport,
				maxRetries: 0,
				sessionId: "vendor-routing-id",
				sessionContext,
				onPayload: (payload) => {
					payloads.push(payload);
				},
			}).result();
			expect(transport).toHaveBeenCalledOnce();
			expect(ambient).not.toHaveBeenCalled();
			expect(payloads).toHaveLength(1);
			const serialized = JSON.stringify({ requests, payloads });
			for (const forbidden of ["sessionContext", "agentSessionId", ...Object.values(sessionContext)]) {
				expect(serialized).not.toContain(forbidden);
			}
		});
	}
});
