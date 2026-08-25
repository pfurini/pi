import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createModel(provider: string, id: string, pinToolResultContinuation = false): Model<"openai-responses"> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider,
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
		...(pinToolResultContinuation ? { toolResultContinuation: "originating-provider" as const } : {}),
	};
}

function createAssistantMessage(
	model: Model<"openai-responses">,
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: model.api,
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
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(): UserMessage {
	return { role: "user", content: "use the tool", timestamp: Date.now() };
}

const toolSchema = Type.Object({ value: Type.String() });
const echoTool: AgentTool<typeof toolSchema, { value: string }> = {
	name: "echo",
	label: "Echo",
	description: "Echo a value",
	parameters: toolSchema,
	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: params.value }],
			details: { value: params.value },
		};
	},
};

async function runProviderSwitch(
	originModel: Model<"openai-responses">,
	selectedModel: Model<"openai-responses">,
): Promise<string[]> {
	const context: AgentContext = {
		systemPrompt: "Test",
		messages: [],
		tools: [echoTool],
	};
	const config: AgentLoopConfig = {
		model: originModel,
		convertToLlm: (messages: AgentMessage[]) => messages as Message[],
		prepareNextTurn: ({ toolResults }) => (toolResults.length > 0 ? { model: selectedModel } : undefined),
	};
	const requestedModels: string[] = [];
	let call = 0;
	const stream = agentLoop([createUserMessage()], context, config, undefined, (model) => {
		requestedModels.push(`${model.provider}/${model.id}`);
		const response = new MockAssistantStream();
		queueMicrotask(() => {
			if (call++ === 0) {
				response.push({
					type: "done",
					reason: "toolUse",
					message: createAssistantMessage(
						model as Model<"openai-responses">,
						[
							{
								type: "toolCall",
								id: "call-1",
								name: "echo",
								arguments: { value: "ok" },
							},
						],
						"toolUse",
					),
				});
				return;
			}
			response.push({
				type: "done",
				reason: "stop",
				message: createAssistantMessage(
					model as Model<"openai-responses">,
					[{ type: "text", text: "done" }],
					"stop",
				),
			});
		});
		return response;
	});

	for await (const _event of stream) {
		// Drain the loop.
	}
	return requestedModels;
}

describe("tool-result continuation routing", () => {
	it("pins an opted-in tool continuation to its originating provider", async () => {
		const requested = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("other-provider", "other"),
		);

		expect(requested).toEqual(["cursor-bridge/cursor-a", "cursor-bridge/cursor-a"]);
	});

	it("keeps ordinary cross-provider switching behavior for models without the opt-in", async () => {
		const requested = await runProviderSwitch(
			createModel("first-provider", "first"),
			createModel("second-provider", "second"),
		);

		expect(requested).toEqual(["first-provider/first", "second-provider/second"]);
	});

	it("keeps same-provider model changes visible to an opted-in provider", async () => {
		const requested = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("cursor-bridge", "cursor-b", true),
		);

		expect(requested).toEqual(["cursor-bridge/cursor-a", "cursor-bridge/cursor-b"]);
	});
});
