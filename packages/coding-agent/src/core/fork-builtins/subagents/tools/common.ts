/**
 * Fork-owned: what the subagent tools share (plan T5): the text result that carries unreported
 * subagent spend, and the wording of outcomes and stats. The nested tools (T6) use it too.
 * pi-subagents `src/index.ts`, `src/status-note.ts` and `src/ui/agent-widget.ts` at 79a7c42 are
 * the behavior reference.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { SubagentStatus, SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import { displayTokens } from "../usage.ts";

/**
 * A text result. Under `reportUsage` it carries the subagent spend the session has not counted
 * yet, and Pi folds a tool result's `usage` into the session's totals.
 */
export function textResult(service: SubagentService, text: string): AgentToolResult<undefined> {
	const usage = service.takeReportedUsage();
	return { content: [{ type: "text", text }], details: undefined, ...(usage && { usage }) };
}

export function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** `33.8k token`, or "" when nothing was spent. */
export function formatTokens(record: SubagentView): string {
	const count = displayTokens(record.usage);
	if (count <= 0) return "";
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

/** `~$0.0042` as Pi estimates it from listed rates; "" for no cost or no pricing data. */
export function formatCost(cost: number): string {
	if (!(cost > 0)) return "";
	if (cost < 0.0001) return "<$0.0001";
	if (cost >= 1) return `~$${cost.toFixed(2)}`;
	const rounded = Number(cost.toFixed(4));
	const decimals = (String(rounded).split(".")[1] ?? "").length;
	return `~$${rounded.toFixed(Math.max(2, decimals))}`;
}

export function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** A foreground caller holds the whole output inline, so the note says there is nothing more to fetch. */
export function foregroundOutcomeNote(status: SubagentStatus): string {
	switch (status) {
		case "stopped":
			return " (STOPPED BY THE USER — everything the agent produced is above; the task is unfinished)";
		case "aborted":
			return " (aborted before completion — everything the agent produced is above; the task is unfinished)";
		case "steered":
			return " (wrapped up at the turn limit — everything the agent produced is above; the task may be unfinished)";
		default:
			return "";
	}
}

/** The failed run's own partial output, as a labeled suffix, or "". */
export function partialOutputSuffix(record: SubagentView): string {
	const partial = record.result?.trim();
	return partial ? `\n\nPartial output before the failure:\n${partial}` : "";
}

export function displayName(record: SubagentView): string {
	return record.definition.displayName ?? record.type;
}
