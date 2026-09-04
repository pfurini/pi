// A.4 replay gate (docs/plans/pi-skill-system-plan.md): the exact synthetic skill
// tool-call/tool-result pair must replay correctly through every KnownApi's converter before
// `Model.syntheticToolResultReplay` may be set for that (api, provider) class. See
// SKILL_SYNTHETIC_REPLAY_CLASSES in packages/ai/src/types.ts for the canonical matrix shared
// with scripts/generate-models.ts.

const openAICompletionsMock = vi.hoisted(() => ({
	lastParams: undefined as Record<string, unknown> | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: Record<string, unknown>) => {
					openAICompletionsMock.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								id: "chatcmpl-test",
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{ data: typeof stream; response: { status: number; headers: Headers } }>;
					};
					promise.withResponse = async () => ({ data: stream, response: { status: 200, headers: new Headers() } });
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

const anthropicMock = vi.hoisted(() => ({
	lastParams: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@anthropic-ai/sdk", () => {
	function createSseResponse(): Response {
		const body = [
			`event: message_start\ndata: ${JSON.stringify({
				type: "message_start",
				message: { id: "msg_test", usage: { input_tokens: 1, output_tokens: 0 } },
			})}\n`,
			`event: message_delta\ndata: ${JSON.stringify({
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 1 },
			})}\n`,
			`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n`,
		].join("\n");
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	}
	class FakeAnthropic {
		messages = {
			create: (params: Record<string, unknown>) => {
				anthropicMock.lastParams = params;
				return { asResponse: async () => createSseResponse() };
			},
		};
	}
	return { default: FakeAnthropic };
});

const bedrockMock = vi.hoisted(() => ({
	lastInput: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	class BedrockRuntimeServiceException extends Error {}
	class BedrockRuntimeClient {
		middlewareStack = { add: () => undefined };
		async send(): Promise<unknown> {
			return {
				$metadata: { httpStatusCode: 200, requestId: "request-id" },
				stream: (async function* () {
					yield { messageStart: { role: "assistant" } };
					yield { messageStop: { stopReason: "end_turn" } };
				})(),
			};
		}
	}
	class ConverseStreamCommand {
		readonly input: unknown;
		constructor(input: unknown) {
			bedrockMock.lastInput = input as Record<string, unknown>;
			this.input = input;
		}
	}
	return {
		BedrockRuntimeClient,
		BedrockRuntimeServiceException,
		ConverseStreamCommand,
		StopReason: {
			END_TURN: "end_turn",
			STOP_SEQUENCE: "stop_sequence",
			MAX_TOKENS: "max_tokens",
			MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
			TOOL_USE: "tool_use",
		},
		CachePointType: { DEFAULT: "default" },
		CacheTTL: { ONE_HOUR: "ONE_HOUR" },
		ConversationRole: { ASSISTANT: "assistant", USER: "user" },
		ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
		ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
	};
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { AZURE_TOOL_CALL_PROVIDERS } from "../src/api/azure-openai-responses.ts";
import { stream as streamBedrock } from "../src/api/bedrock-converse-stream.ts";
import { convertMessages as convertGoogleMessages } from "../src/api/google-shared.ts";
import { stream as streamMistral } from "../src/api/mistral-conversations.ts";
import { CODEX_TOOL_CALL_PROVIDERS } from "../src/api/openai-codex-responses.ts";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { OPENAI_TOOL_CALL_PROVIDERS } from "../src/api/openai-responses.ts";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import { stream as streamPiMessages } from "../src/api/pi-messages.ts";
import { getModel } from "../src/compat.ts";
import { MODELS } from "../src/models.generated.ts";
import type { Api, AssistantMessage, Context, FetchFunction, Model, ToolResultMessage } from "../src/types.ts";
import { matchesSkillSyntheticReplayClass, SKILL_SYNTHETIC_REPLAY_CLASSES } from "../src/types.ts";

const SKILL_TOOL_CALL_ID = "skill_00000000-0000-4000-8000-000000000001";
// XML-ish and shell-ish text: proves the rendered result is carried verbatim, not interpreted.
const RENDERED_TEXT = '<result status="ok">details</result>\n$(echo hi) `backtick`';

// Every (api, provider) pair exercised by an `it` below. Checked against
// SKILL_SYNTHETIC_REPLAY_CLASSES so a matrix entry can't go unexercised.
const TESTED_REPLAY_CLASSES: ReadonlyArray<{ api: string; provider: string }> = [
	{ api: "openai-completions", provider: "groq" },
	{ api: "openai-completions", provider: "zai" },
	{ api: "openai-responses", provider: "openai" },
	{ api: "azure-openai-responses", provider: "azure-openai-responses" },
	{ api: "openai-codex-responses", provider: "openai-codex" },
	{ api: "anthropic-messages", provider: "anthropic" },
	{ api: "bedrock-converse-stream", provider: "amazon-bedrock" },
	{ api: "google-generative-ai", provider: "google" },
	{ api: "google-vertex", provider: "google-vertex" },
	{ api: "mistral-conversations", provider: "mistral" },
	{ api: "pi-messages", provider: "radius" },
];

function sortedClassKeys(classes: ReadonlyArray<{ api: string; provider: string }>): string[] {
	return classes.map((cls) => `${cls.api}/${cls.provider}`).sort();
}

function buildSyntheticPair(model: { api: string; provider: string; id: string }): {
	assistant: AssistantMessage;
	result: ToolResultMessage;
} {
	const timestamp = Date.now();
	const assistant: AssistantMessage = {
		role: "assistant",
		content: [
			{ type: "toolCall", id: SKILL_TOOL_CALL_ID, name: "skill", arguments: { name: "code-review", args: "" } },
		],
		api: model.api as Api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp,
	};
	const result: ToolResultMessage = {
		role: "toolResult",
		toolCallId: SKILL_TOOL_CALL_ID,
		toolName: "skill",
		content: [{ type: "text", text: RENDERED_TEXT }],
		isError: false,
		timestamp: timestamp + 1,
	};
	return { assistant, result };
}

beforeEach(() => {
	openAICompletionsMock.lastParams = undefined;
	anthropicMock.lastParams = undefined;
	bedrockMock.lastInput = undefined;
});

describe("skill synthetic pair replay — A.4 fixture matrix", () => {
	it("openai-completions (groq): replays skill call/result via chat.completions.create", async () => {
		const model: Model<"openai-completions"> = {
			id: "llama-4-maverick",
			name: "Llama 4 Maverick",
			api: "openai-completions",
			provider: "groq",
			baseUrl: "https://api.groq.com/openai/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		await streamOpenAICompletions(model, context, { apiKey: "test" }).result();

		const params = openAICompletionsMock.lastParams as {
			messages: Array<{
				role: string;
				tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
				tool_call_id?: string;
				content?: unknown;
			}>;
		};
		const assistantMsg = params.messages.find((m) => m.role === "assistant");
		const toolMsg = params.messages.find((m) => m.role === "tool");
		expect(assistantMsg?.tool_calls).toHaveLength(1);
		const call = assistantMsg!.tool_calls![0];
		expect(call.id).toBe(SKILL_TOOL_CALL_ID);
		expect(call.function.name).toBe("skill");
		expect(JSON.parse(call.function.arguments)).toEqual({ name: "code-review", args: "" });
		expect(toolMsg?.tool_call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(toolMsg?.content).toBe(RENDERED_TEXT);
	});

	it("openai-completions (zai): replays skill call/result via chat.completions.create", async () => {
		const model: Model<"openai-completions"> = {
			id: "glm-5.3-flash",
			name: "GLM-5.3-Flash",
			api: "openai-completions",
			provider: "zai",
			baseUrl: "https://api.z.ai/api/coding/paas/v4",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0.075, output: 0.25, cacheRead: 0.015, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 131072,
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: true,
				maxTokensField: "max_tokens",
				thinkingFormat: "zai",
				zaiToolStream: true,
			},
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		await streamOpenAICompletions(model, context, { apiKey: "test" }).result();

		const params = openAICompletionsMock.lastParams as {
			messages: Array<{
				role: string;
				tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
				tool_call_id?: string;
				content?: unknown;
			}>;
		};
		const assistantMsg = params.messages.find((m) => m.role === "assistant");
		const toolMsg = params.messages.find((m) => m.role === "tool");
		expect(assistantMsg?.tool_calls).toHaveLength(1);
		const call = assistantMsg!.tool_calls![0];
		expect(call.id).toBe(SKILL_TOOL_CALL_ID);
		expect(call.function.name).toBe("skill");
		expect(JSON.parse(call.function.arguments)).toEqual({ name: "code-review", args: "" });
		expect(toolMsg?.tool_call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(toolMsg?.content).toBe(RENDERED_TEXT);
	});

	it("openai-responses (openai): replays skill call/result via convertResponsesMessages", () => {
		const model: Model<"openai-responses"> = {
			id: "gpt-5.4",
			name: "GPT-5.4",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		const items = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS);

		const call = items.find((item) => item.type === "function_call") as {
			type: "function_call";
			call_id: string;
			name: string;
			arguments: string;
		};
		const output = items.find((item) => item.type === "function_call_output") as {
			type: "function_call_output";
			call_id: string;
			output: string;
		};
		expect(call.call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(call.name).toBe("skill");
		expect(JSON.parse(call.arguments)).toEqual({ name: "code-review", args: "" });
		expect(output.call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(output.output).toBe(RENDERED_TEXT);
		expect(items.indexOf(call)).toBeLessThan(items.indexOf(output));
	});

	it("azure-openai-responses: replays skill call/result via convertResponsesMessages", () => {
		const model: Model<"azure-openai-responses"> = {
			id: "gpt-5.4",
			name: "GPT-5.4",
			api: "azure-openai-responses",
			provider: "azure-openai-responses",
			baseUrl: "",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		const items = convertResponsesMessages(model, context, AZURE_TOOL_CALL_PROVIDERS);

		const call = items.find((item) => item.type === "function_call") as {
			type: "function_call";
			call_id: string;
			name: string;
			arguments: string;
		};
		const output = items.find((item) => item.type === "function_call_output") as {
			type: "function_call_output";
			call_id: string;
			output: string;
		};
		expect(call.call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(call.name).toBe("skill");
		expect(JSON.parse(call.arguments)).toEqual({ name: "code-review", args: "" });
		expect(output.call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(output.output).toBe(RENDERED_TEXT);
	});

	it("openai-codex-responses: replays skill call/result via convertResponsesMessages", () => {
		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.5",
			name: "GPT-5.5",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		const items = convertResponsesMessages(model, context, CODEX_TOOL_CALL_PROVIDERS, {
			includeSystemPrompt: false,
		});

		const call = items.find((item) => item.type === "function_call") as {
			type: "function_call";
			call_id: string;
			name: string;
			arguments: string;
		};
		const output = items.find((item) => item.type === "function_call_output") as {
			type: "function_call_output";
			call_id: string;
			output: string;
		};
		expect(call.call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(call.name).toBe("skill");
		expect(JSON.parse(call.arguments)).toEqual({ name: "code-review", args: "" });
		expect(output.call_id).toBe(SKILL_TOOL_CALL_ID);
		expect(output.output).toBe(RENDERED_TEXT);
	});

	it("anthropic-messages: replays skill call/result via messages.create", async () => {
		const model: Model<"anthropic-messages"> = {
			id: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 8192,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		await streamAnthropic(model, context, { apiKey: "test" }).result();

		const params = anthropicMock.lastParams as {
			messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
		};
		const assistantMsg = params.messages.find((m) => m.role === "assistant");
		const userMsg = params.messages.find((m) => m.role === "user");
		const toolUse = assistantMsg?.content.find((b) => b.type === "tool_use") as
			| { id: string; name: string; input: unknown }
			| undefined;
		const toolResult = userMsg?.content.find((b) => b.type === "tool_result") as
			| { tool_use_id: string; content: unknown; is_error: boolean }
			| undefined;
		expect(toolUse?.id).toBe(SKILL_TOOL_CALL_ID);
		expect(toolUse?.name).toBe("skill");
		expect(toolUse?.input).toEqual({ name: "code-review", args: "" });
		expect(toolResult?.tool_use_id).toBe(SKILL_TOOL_CALL_ID);
		expect(toolResult?.is_error).toBe(false);
		expect(toolResult?.content).toBe(RENDERED_TEXT);
	});

	it("bedrock-converse-stream: replays skill call/result via ConverseStreamCommand", async () => {
		const model = getModel("amazon-bedrock", "us.anthropic.claude-sonnet-4-5-20250929-v1:0");
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		await streamBedrock(model, context, { cacheRetention: "none" }).result();

		const input = bedrockMock.lastInput as {
			messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
		};
		const assistantMsg = input.messages.find((m) => m.role === "assistant");
		const userMsg = input.messages.find((m) => m.role === "user");
		const toolUse = assistantMsg?.content.find((b) => "toolUse" in b) as
			| { toolUse: { toolUseId: string; name: string; input: unknown } }
			| undefined;
		const toolResult = userMsg?.content.find((b) => "toolResult" in b) as
			| { toolResult: { toolUseId: string; content: Array<{ text?: string }>; status: string } }
			| undefined;
		expect(toolUse?.toolUse.toolUseId).toBe(SKILL_TOOL_CALL_ID);
		expect(toolUse?.toolUse.name).toBe("skill");
		expect(toolUse?.toolUse.input).toEqual({ name: "code-review", args: "" });
		expect(toolResult?.toolResult.toolUseId).toBe(SKILL_TOOL_CALL_ID);
		expect(toolResult?.toolResult.status).toBe("success");
		expect(toolResult?.toolResult.content).toEqual([{ text: RENDERED_TEXT }]);
	});

	it("google-generative-ai: preserves call/result IDs for the Gemini 3 ID-required branch", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 65536,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		const contents = convertGoogleMessages(model, context);

		const modelTurn = contents.find((c) => c.role === "model");
		const call = modelTurn?.parts?.find((p) => p.functionCall)?.functionCall;
		expect(call?.id).toBe(SKILL_TOOL_CALL_ID);
		expect(call?.name).toBe("skill");
		expect(call?.args).toEqual({ name: "code-review", args: "" });

		const responseTurn = contents.find((c) => c.parts?.some((p) => p.functionResponse));
		const response = responseTurn?.parts?.find((p) => p.functionResponse)?.functionResponse;
		expect(response?.id).toBe(SKILL_TOOL_CALL_ID);
		expect(response?.name).toBe("skill");
		expect(response?.response).toEqual({ output: RENDERED_TEXT });
	});

	it("google-generative-ai: correlates by name/order for the Gemini 2.5 non-ID branch", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 65536,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		const contents = convertGoogleMessages(model, context);

		const modelTurn = contents.find((c) => c.role === "model");
		const call = modelTurn?.parts?.find((p) => p.functionCall)?.functionCall;
		expect(call?.id).toBeUndefined();
		expect(call?.name).toBe("skill");
		expect(call?.args).toEqual({ name: "code-review", args: "" });

		const responseTurn = contents.find((c) => c.parts?.some((p) => p.functionResponse));
		const response = responseTurn?.parts?.find((p) => p.functionResponse)?.functionResponse;
		expect(response?.id).toBeUndefined();
		expect(response?.name).toBe("skill");
		expect(response?.response).toEqual({ output: RENDERED_TEXT });
	});

	it("google-vertex: preserves call/result IDs for the Gemini 3 ID-required branch", () => {
		const model: Model<"google-vertex"> = {
			id: "gemini-3-flash-preview",
			name: "Gemini 3 Flash Preview",
			api: "google-vertex",
			provider: "google-vertex",
			baseUrl: "https://aiplatform.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 65536,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		const contents = convertGoogleMessages(model, context);

		const modelTurn = contents.find((c) => c.role === "model");
		const call = modelTurn?.parts?.find((p) => p.functionCall)?.functionCall;
		expect(call?.id).toBe(SKILL_TOOL_CALL_ID);
		expect(call?.name).toBe("skill");

		const responseTurn = contents.find((c) => c.parts?.some((p) => p.functionResponse));
		const response = responseTurn?.parts?.find((p) => p.functionResponse)?.functionResponse;
		expect(response?.id).toBe(SKILL_TOOL_CALL_ID);
		expect(response?.name).toBe("skill");
		expect(response?.response).toEqual({ output: RENDERED_TEXT });
	});

	it("mistral-conversations: replays skill call/result via the chat completions wire format", async () => {
		const model = getModel("mistral", "mistral-large-latest");
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		let requestInit: RequestInit | undefined;
		const fetchMock: FetchFunction = async (_input, init) => {
			requestInit = init;
			return new Response("mock error", { status: 500 });
		};
		await streamMistral(model, context, { apiKey: "test", fetch: fetchMock }).result();

		const wirePayload = JSON.parse(String(requestInit?.body)) as { messages: unknown[] };
		expect(wirePayload.messages).toEqual([
			{
				role: "assistant",
				prefix: false,
				tool_calls: [
					{
						id: SKILL_TOOL_CALL_ID,
						type: "function",
						function: { name: "skill", arguments: JSON.stringify({ name: "code-review", args: "" }) },
						index: 0,
					},
				],
			},
			{
				role: "tool",
				tool_call_id: SKILL_TOOL_CALL_ID,
				name: "skill",
				content: [{ type: "text", text: RENDERED_TEXT }],
			},
		]);
	});

	it("pi-messages (radius): native passthrough leaves context.messages unchanged", async () => {
		const model: Model<"pi-messages"> = {
			id: "auto",
			name: "Radius Auto",
			api: "pi-messages",
			provider: "radius",
			baseUrl: "https://example.test/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		};
		const { assistant, result } = buildSyntheticPair(model);
		const context: Context = { messages: [assistant, result] };
		let capturedContext: unknown;
		const fetchMock: FetchFunction = async (_input, init) => {
			capturedContext = (JSON.parse(String(init?.body)) as { context: unknown }).context;
			return new Response("mock error", { status: 500 });
		};
		await streamPiMessages(model, context, { apiKey: "test", fetch: fetchMock }).result();

		expect(capturedContext).toEqual(context);
	});

	it("does not infer support for a custom/unknown provider or API", () => {
		expect(matchesSkillSyntheticReplayClass({ api: "openai-completions", provider: "some-self-hosted-proxy" })).toBe(
			false,
		);
		expect(matchesSkillSyntheticReplayClass({ api: "totally-custom-api", provider: "totally-custom-provider" })).toBe(
			false,
		);
	});

	it("exercises exactly the SKILL_SYNTHETIC_REPLAY_CLASSES matrix (guards against drift)", () => {
		expect(sortedClassKeys(TESTED_REPLAY_CLASSES)).toEqual(sortedClassKeys(SKILL_SYNTHETIC_REPLAY_CLASSES));
	});
});

describe("generated model catalog — skill synthetic replay provenance", () => {
	const allModels = Object.values(MODELS).flatMap((catalog) => Object.values(catalog));

	it("actually flags at least one built-in model (guards against a vacuous matrix)", () => {
		expect(allModels.some((model) => model.syntheticToolResultReplay === true)).toBe(true);
	});

	it("every built-in model's flag agrees with matchesSkillSyntheticReplayClass", () => {
		for (const model of allModels) {
			expect(Boolean(model.syntheticToolResultReplay)).toBe(matchesSkillSyntheticReplayClass(model));
		}
	});
});
