/**
 * Fork-owned: the `steer_subagent` base tool (plan T5). pi-subagents `src/index.ts:3027-3080` at
 * 79a7c42 is the behavior reference. A message to an agent whose child session does not exist yet
 * waits on the record and reaches the child when it starts. A finished agent cannot be steered.
 */
import { Type } from "typebox";
import type { AgentSession } from "../../../agent-session.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { STEER_TOOL_NAME } from "../names.ts";
import { isTerminal } from "../service/records.ts";
import { notFound } from "../service/service.ts";
import { requireService } from "../service/sessions.ts";
import { formatCost, formatTokens, textResult } from "./common.ts";

const STEER_PARAMETERS = Type.Object({
	agent_id: Type.String({
		description:
			"The agent ID to steer (must be currently running). The agent's handle also works — its `name` if you gave it one, otherwise its type (`explore`, `explore-2`).",
	}),
	message: Type.String({
		description: "The steering message to send. This will appear as a user message in the agent's conversation.",
	}),
});

export function createSteerToolDefinition(session: AgentSession): ToolDefinition<typeof STEER_PARAMETERS> {
	return {
		name: STEER_TOOL_NAME,
		label: "Steer Agent",
		description:
			"Send a steering message to a running agent. The message will interrupt the agent after its current tool execution " +
			"and be injected into its conversation, allowing you to redirect its work mid-run. Only works on running agents.",
		promptSnippet: "Send a steering message to redirect a running background agent",
		parameters: STEER_PARAMETERS,

		async execute(_toolCallId, params) {
			const service = requireService(session);
			const record = service.get(params.agent_id);
			if (!record) return textResult(service, notFound(params.agent_id));
			if (isTerminal(record)) {
				return textResult(
					service,
					`Agent "${params.agent_id}" is not running (status: ${record.status}). Cannot steer a non-running agent.`,
				);
			}
			const outcome = await service.steer(record.id, params.message);
			if (outcome.kind === "refused") return textResult(service, outcome.reason);
			if (outcome.kind === "failed") return textResult(service, `Failed to steer agent: ${outcome.error}`);
			if (outcome.kind === "queued") {
				return textResult(
					service,
					`Steering message queued for agent ${record.id}. It will be delivered once the session initializes.`,
				);
			}
			const state: string[] = [];
			const tokens = formatTokens(record);
			if (tokens) state.push(tokens);
			const cost = service.settings.showCost ? formatCost(record.usage.cost.total) : "";
			if (cost) state.push(cost);
			state.push(`${record.toolUses} tool ${record.toolUses === 1 ? "use" : "uses"}`);
			const context = service.contextPercent(record.id);
			if (context !== undefined) state.push(`context ${Math.round(context)}% full`);
			if (record.compactionCount) {
				state.push(`${record.compactionCount} compaction${record.compactionCount === 1 ? "" : "s"}`);
			}
			return textResult(
				service,
				`Steering message sent to agent ${record.id}. The agent will process it after its current tool execution.\n` +
					`Current state: ${state.join(" · ")}`,
			);
		},
	};
}
