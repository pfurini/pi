import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type ThinkingLevel as StreamThinkingLevel,
	type UserMessage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool, ThinkingLevel } from "../src/types.ts";

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

interface ProviderSwitchResult {
	requestedModels: string[];
	requestedReasoning: (StreamThinkingLevel | undefined)[];
	pinReports: string[];
}

async function runProviderSwitch(
	originModel: Model<"openai-responses">,
	selectedModel: Model<"openai-responses">,
	options: { toolTurns?: number; originReasoning?: StreamThinkingLevel; switchThinkingLevel?: ThinkingLevel } = {},
): Promise<ProviderSwitchResult> {
	// Turns 0..toolTurns-1 return toolUse; the turn after that stops. A value above
	// 1 keeps the tool chain alive so the pin's per-turn re-application is observable.
	const toolTurns = options.toolTurns ?? 1;
	const context: AgentContext = {
		systemPrompt: "Test",
		messages: [],
		tools: [echoTool],
	};
	const pinReports: string[] = [];
	const config: AgentLoopConfig = {
		model: originModel,
		reasoning: options.originReasoning,
		convertToLlm: (messages: AgentMessage[]) => messages as Message[],
		// Unconditional, mirroring AgentSession.prepareNextTurnWithContext, which returns
		// the current session model on every turn. A conditional switch would hide the
		// pin's per-turn re-application behind the harness.
		prepareNextTurn: () => ({
			model: selectedModel,
			...(options.switchThinkingLevel ? { thinkingLevel: options.switchThinkingLevel } : {}),
		}),
		onContinuationPinned: (pinned, requested) => {
			pinReports.push(`${pinned.provider}/${pinned.id}<-${requested.provider}/${requested.id}`);
		},
	};
	const requestedModels: string[] = [];
	const requestedReasoning: (StreamThinkingLevel | undefined)[] = [];
	let call = 0;
	const stream = agentLoop([createUserMessage()], context, config, undefined, (model, _llmContext, streamOptions) => {
		requestedModels.push(`${model.provider}/${model.id}`);
		requestedReasoning.push(streamOptions?.reasoning);
		const response = new MockAssistantStream();
		queueMicrotask(() => {
			if (call++ < toolTurns) {
				response.push({
					type: "done",
					reason: "toolUse",
					message: createAssistantMessage(
						model as Model<"openai-responses">,
						[
							{
								type: "toolCall",
								id: `call-${call}`,
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
	return { requestedModels, requestedReasoning, pinReports };
}

describe("tool-result continuation routing", () => {
	it("pins an opted-in tool continuation to its originating provider", async () => {
		const requested = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("other-provider", "other"),
		);

		expect(requested.requestedModels).toEqual(["cursor-bridge/cursor-a", "cursor-bridge/cursor-a"]);
	});

	it("keeps ordinary cross-provider switching behavior for models without the opt-in", async () => {
		const requested = await runProviderSwitch(
			createModel("first-provider", "first"),
			createModel("second-provider", "second"),
		);

		expect(requested.requestedModels).toEqual(["first-provider/first", "second-provider/second"]);
	});

	it("keeps same-provider model changes visible to an opted-in provider", async () => {
		const requested = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("cursor-bridge", "cursor-b", true),
		);

		expect(requested.requestedModels).toEqual(["cursor-bridge/cursor-a", "cursor-bridge/cursor-b"]);
	});

	it("holds the pin for every request of a tool-calling chain, not just the first", async () => {
		const pinned = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("other-provider", "other"),
			{ toolTurns: 2 },
		);
		const unpinned = await runProviderSwitch(
			createModel("first-provider", "first"),
			createModel("second-provider", "second"),
			{ toolTurns: 2 },
		);

		// The switch is requested on every turn. Opted in, it is deferred for the whole
		// run; without the opt-in it lands on the very next request. The pinned run only
		// reaches the new provider on a later run, which one agentLoop call cannot show.
		expect(pinned.requestedModels).toEqual([
			"cursor-bridge/cursor-a",
			"cursor-bridge/cursor-a",
			"cursor-bridge/cursor-a",
		]);
		expect(unpinned.requestedModels).toEqual([
			"first-provider/first",
			"second-provider/second",
			"second-provider/second",
		]);
	});

	it("restores the originating reasoning binding along with the pinned model", async () => {
		const requested = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("other-provider", "other"),
			{ originReasoning: "high", switchThinkingLevel: "off" },
		);

		// The pinned continuation must not carry the incoming model's thinking level
		// to the originating provider: that is the mid-run rebinding the pin prevents.
		expect(requested.requestedModels).toEqual(["cursor-bridge/cursor-a", "cursor-bridge/cursor-a"]);
		expect(requested.requestedReasoning).toEqual(["high", "high"]);
	});

	it("reports each deferred switch through onContinuationPinned", async () => {
		const requested = await runProviderSwitch(
			createModel("cursor-bridge", "cursor-a", true),
			createModel("other-provider", "other"),
			{ toolTurns: 2 },
		);

		expect(requested.pinReports).toEqual([
			"cursor-bridge/cursor-a<-other-provider/other",
			"cursor-bridge/cursor-a<-other-provider/other",
		]);
	});

	it("does not report a pin when no switch was deferred", async () => {
		const requested = await runProviderSwitch(
			createModel("first-provider", "first"),
			createModel("second-provider", "second"),
		);

		expect(requested.pinReports).toEqual([]);
	});
});
