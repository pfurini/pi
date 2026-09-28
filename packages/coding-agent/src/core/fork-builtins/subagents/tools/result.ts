/**
 * Fork-owned: the `get_subagent_result` base tool (plan T5). pi-subagents `src/index.ts:2943-3025`
 * at 79a7c42 is the behavior reference.
 *
 * `agent_id` takes an id, a handle or an alias of one of the session's own agents; a nested agent's
 * id is unknown here. With `wait`, the call waits through the queue and the run. Cancelling the
 * call ends only the wait: the agent keeps running, its result stays unread and its notification
 * still arrives. Reading a finished agent's result consumes it, which drops its notification.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { AgentSession } from "../../../agent-session.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { GET_RESULT_TOOL_NAME } from "../names.ts";
import { statusNote } from "../service/notifications.ts";
import { isTerminal, type SubagentView } from "../service/records.ts";
import { notFound } from "../service/service.ts";
import { requireService } from "../service/sessions.ts";
import {
	displayName,
	errorText,
	formatCost,
	formatMs,
	formatTokens,
	partialOutputSuffix,
	textResult,
} from "./common.ts";

const RESULT_PARAMETERS = Type.Object({
	agent_id: Type.String({
		description:
			"The agent ID to check. The agent's handle also works — its `name` if you gave it one, otherwise its type (`explore`, `explore-2`).",
	}),
	wait: Type.Optional(
		Type.Boolean({ description: "If true, wait for the agent to complete before returning. Default: false." }),
	),
	verbose: Type.Optional(
		Type.Boolean({
			description: "If true, include the agent's full conversation (messages + tool calls). Default: false.",
		}),
	),
});

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

/** The child's conversation: user prompts, assistant text, tool calls and truncated tool results. */
function conversationOf(messages: readonly AgentMessage[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const text = textOf(message.content).trim();
			if (text) parts.push(`[User]: ${text}`);
		} else if (message.role === "assistant") {
			const text = textOf(message.content);
			const calls = message.content.filter((part) => part.type === "toolCall").map((part) => `  Tool: ${part.name}`);
			if (text) parts.push(`[Assistant]: ${text}`);
			if (calls.length > 0) parts.push(`[Tool Calls]:\n${calls.join("\n")}`);
		} else if (message.role === "toolResult") {
			const text = textOf(message.content);
			parts.push(`[Tool Result (${message.toolName})]: ${text.length > 200 ? `${text.slice(0, 200)}...` : text}`);
		}
	}
	return parts.join("\n\n");
}

function reportOf(record: SubagentView, showCost: boolean, context: number | undefined): string {
	const stats = [`Tool uses: ${record.toolUses}`];
	const tokens = formatTokens(record);
	if (tokens) stats.push(tokens);
	const cost = showCost ? formatCost(record.usage.cost.total) : "";
	if (cost) stats.push(`Cost: ${cost}`);
	if (context !== undefined) stats.push(`Context: ${Math.round(context)}%`);
	if (record.compactionCount) stats.push(`Compactions: ${record.compactionCount}`);
	stats.push(
		record.completedAt === undefined
			? `Duration: ${formatMs(Date.now() - record.startedAt)} (running)`
			: `Duration: ${formatMs(record.completedAt - record.startedAt)}`,
	);
	const head =
		`Agent: ${record.id}\n` +
		`Type: ${displayName(record)} | Status: ${record.status}${statusNote(record.status)} | ${stats.join(" | ")}\n` +
		`Description: ${record.description}\n\n`;
	if (!isTerminal(record)) return `${head}Agent is still ${record.status}. Use wait: true or check back later.`;
	if (record.status === "error")
		return `${head}Error: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}`;
	return head + (record.result?.trim() || "No output.");
}

export function createResultToolDefinition(session: AgentSession): ToolDefinition<typeof RESULT_PARAMETERS> {
	return {
		name: GET_RESULT_TOOL_NAME,
		label: "Get Agent Result",
		description:
			"Check status and retrieve a background agent's full result — its completion notification carries only a preview. Use the agent ID returned by Agent.",
		promptSnippet: "Check status and retrieve results from a background agent",
		parameters: RESULT_PARAMETERS,

		async execute(_toolCallId, params, signal) {
			const service = requireService(session);
			const record = service.get(params.agent_id);
			if (!record) return textResult(service, notFound(params.agent_id));
			if (params.wait) {
				try {
					await service.waitForResult(record.id, signal);
				} catch (error) {
					if (!signal?.aborted) return textResult(service, errorText(error));
					return textResult(
						service,
						`Stopped waiting for agent ${record.id}. It is still ${record.status} and keeps running; its completion notification will still arrive.`,
					);
				}
			}
			let output = reportOf(record, service.settings.showCost, service.contextPercent(record.id));
			service.consume(record.id);
			const child = params.verbose ? service.conversation(record.id) : undefined;
			if (child) {
				const conversation = conversationOf(child.messages);
				if (conversation) output += `\n\n--- Agent Conversation ---\n${conversation}`;
			}
			return textResult(service, output);
		},
	};
}
