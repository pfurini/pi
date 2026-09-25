// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), tests/fixtures.ts.
// Copyright (c) 2026 sting8k. MIT licence: see src/core/fork-builtins/vcc-recall/LICENSE.
import type { Message, ToolCall, Usage } from "@earendil-works/pi-ai";

const ts = Date.now();
const assistBase = {
	api: "messages",
	provider: "anthropic",
	model: "test",
	// pi-vcc's usage shape predates Pi's current Usage; the recall code never reads it.
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } as unknown as Usage,
	timestamp: ts,
};

export const userMsg = (text: string): Message => ({
	role: "user",
	content: text,
	timestamp: ts,
});

export const assistantText = (text: string): Message => ({
	role: "assistant",
	content: [{ type: "text", text }],
	...assistBase,
	stopReason: "stop",
});

export const assistantWithThinking = (text: string, thinking: string): Message => ({
	role: "assistant",
	content: [
		{ type: "thinking", thinking },
		{ type: "text", text },
	],
	...assistBase,
	stopReason: "stop",
});

export const assistantWithToolCall = (name: string, args: ToolCall["arguments"]): Message => ({
	role: "assistant",
	content: [{ type: "toolCall", id: "tc_1", name, arguments: args }],
	...assistBase,
	stopReason: "toolUse",
});

export const toolResult = (name: string, text: string): Message => ({
	role: "toolResult",
	toolCallId: "tc_1",
	toolName: name,
	content: [{ type: "text", text }],
	isError: false,
	timestamp: ts,
});
