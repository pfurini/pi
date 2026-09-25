// Ported from pi-vcc 0.8.0 (npm @sting8k/pi-vcc), src/core/render-entries.ts.
// Copyright (c) 2026 sting8k. MIT licence: see LICENSE in this directory.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { clip, contentOf, textOf } from "./content.ts";
import { extractPath, summarizeToolArgs } from "./tool-args.ts";

export interface RenderedEntry {
	index: number;
	role: string;
	summary: string;
	files?: string[];
}

const toolCalls = (content: Message["content"] | undefined): string => {
	if (!content || typeof content === "string") return "";
	return content
		.filter((c) => c.type === "toolCall")
		.map((c) => `${c.name}(${summarizeToolArgs(c.arguments)})`)
		.join(", ");
};

const extractFilesFromContent = (content: Message["content"] | undefined): string[] => {
	if (!content || typeof content === "string") return [];
	return content
		.filter((c) => c.type === "toolCall")
		.map((c) => extractPath(c.arguments))
		.filter((p): p is string => p !== null);
};

export const renderMessage = (msg: AgentMessage, index: number, full = false): RenderedEntry => {
	if (msg.role === "user") {
		return { index, role: "user", summary: full ? textOf(msg.content) : clip(textOf(msg.content), 300) };
	}
	if (msg.role === "toolResult") {
		const text = full ? textOf(msg.content) : clip(textOf(msg.content), 200);
		return {
			index,
			role: "tool_result",
			summary: `[${msg.toolName}] ${text}`,
		};
	}
	// bashExecution has command+output instead of content
	if (msg.role === "bashExecution") {
		const cmd = msg.command ?? "";
		const out = msg.output ?? "";
		const text = full ? `$ ${cmd}\n${out}` : clip(`$ ${cmd}\n${out}`, 300);
		return { index, role: "bash", summary: text };
	}
	const content = contentOf(msg);
	const text = full ? textOf(content) : clip(textOf(content), 300);
	const tools = toolCalls(content);
	const files = extractFilesFromContent(content);
	const summary = tools ? `${tools}\n${text}` : text;
	return { index, role: "assistant", summary, ...(files.length > 0 && { files }) };
};
