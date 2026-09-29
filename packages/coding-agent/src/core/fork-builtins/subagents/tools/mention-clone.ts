/**
 * Fork-owned: starts a mentioned agent from a clone of the session's conversation, with no visible
 * turn (pi-subagents `src/mention-clone.ts` at 79a7c42). Claude Code turns `@agent-<type>` into a
 * reminder that asks the main model to call its agent tool. The agent's prompt then carries the
 * conversation's context. The clone takes that turn off-screen, as one model request:
 *
 * - the conversation the session would send next, through `convertToLlm`: the session's messages,
 *   which hold its projection plus the skill bodies a compaction carried forward;
 * - one system message that leaves `Agent` as the only declared tool; before the session's first
 *   turn, it also carries the session's system prompt;
 * - the user's message, then the reminder.
 *
 * The live system prompt thus arrives byte for byte. The session's model, thinking level and session
 * id serve the request. Only the reply's first `Agent` call counts. Its arguments are prepared and
 * validated as Pi's agent loop does. The spawn keeps the mentioned type, with no fallback, and runs
 * detached in the background. The spawn takes the call's prompt, description, name and invocation
 * parameters, and ignores `resume` and `run_in_background`.
 */
import {
	getCurrentSystemPrompt,
	getCurrentTools,
	type Message,
	type Tool,
	type ToolCall,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import type { AgentSession } from "../../../agent-session.ts";
import { convertToLlm } from "../../../messages.ts";
import { AGENT_TOOL_NAME } from "../names.ts";
import { agentMentionReminder, describeMention } from "../service/mentions.ts";
import type { SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import { errorText } from "./common.ts";

export type MentionCloneResult = { ok: true; view: SubagentView } | { ok: false; error: string };

/** The `Agent` arguments the clone forwards; the rest of the tool's schema has no meaning here. */
interface CloneArguments {
	prompt?: string;
	description?: string;
	name?: string;
	model?: string;
	thinking?: string;
	max_turns?: number;
	inherit_context?: boolean;
	isolated?: boolean;
	isolation?: unknown;
}

/**
 * Sends the conversation plus the mention as one request that can only call `Agent`, then spawns
 * the mentioned type with the call's arguments. Never rejects: `ok: false` means nothing started,
 * so the caller may start the agent directly.
 */
export async function runMentionClone(
	session: AgentSession,
	service: SubagentService,
	type: string,
	message: string,
	signal?: AbortSignal,
): Promise<MentionCloneResult> {
	try {
		const model = session.model;
		if (!model) return { ok: false, error: "no model is selected" };
		const tool = session.getToolDefinition(AGENT_TOOL_NAME);
		if (!tool) return { ok: false, error: "the Agent tool is not registered" };
		const declaration: Tool = { name: tool.name, description: tool.description, parameters: tool.parameters };
		// The finalized state after each turn: the projection plus the carried skill bodies, as a request sends it.
		const conversation: Message[] = convertToLlm(session.messages);
		// Before its first turn the session holds no system message; the clone carries the prompt that turn would.
		const systemPrompt = getCurrentSystemPrompt(conversation) ? "" : session.systemPrompt;
		const now = Date.now();
		const request: Message[] = [
			...conversation,
			{
				role: "system",
				content: systemPrompt,
				toolsRemoved: getCurrentTools(conversation)
					.filter((current) => current.name !== declaration.name)
					.map(({ name }) => ({ name })),
				toolsAdded: [declaration],
				timestamp: now,
			},
			{
				role: "user",
				// The reminder trails the message it is about, as Claude Code's attachment renderer orders them.
				content: [{ type: "text", text: `${message}\n\n${agentMentionReminder(type)}` }],
				timestamp: now,
			},
		];
		const thinking = session.thinkingLevel;
		const reply = await session.modelRuntime
			.streamSimple(
				model,
				{ messages: request },
				{
					// The parent's id keeps provider cache routing on the parent's prefix.
					sessionId: session.sessionId,
					signal,
					...(thinking !== "off" && { reasoning: thinking }),
				},
			)
			.result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted") {
			return { ok: false, error: reply.errorMessage ?? `the clone's request ended with "${reply.stopReason}"` };
		}
		const call = reply.content.find(
			(block): block is ToolCall => block.type === "toolCall" && block.name === declaration.name,
		);
		if (!call) return { ok: false, error: "the conversation clone did not start it" };
		const prepared = tool.prepareArguments
			? { ...call, arguments: tool.prepareArguments(call.arguments) as ToolCall["arguments"] }
			: call;
		const args = validateToolArguments(declaration, prepared) as CloneArguments;
		// A provider may still answer after the abort; a cancelled clone never starts an agent.
		if (signal?.aborted) return { ok: false, error: "the clone was cancelled" };
		const view = await service.spawnListed({
			type,
			prompt: args.prompt ?? message,
			description: args.description ?? describeMention(message),
			name: args.name,
			params: {
				model: args.model,
				thinking: args.thinking,
				max_turns: args.max_turns,
				inherit_context: args.inherit_context,
				isolated: args.isolated,
				isolation: args.isolation,
			},
			mode: "detached-background",
		});
		return { ok: true, view };
	} catch (error) {
		return { ok: false, error: errorText(error) };
	}
}
