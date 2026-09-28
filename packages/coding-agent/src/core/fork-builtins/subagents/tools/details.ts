/**
 * Fork-owned: the details an `Agent` result carries, for its renderer (plan T8, F12). pi-subagents
 * `src/index.ts:1868-1959` and `:2320-2360` at 79a7c42 are the behavior reference. The details are
 * data, not text: `ui/tool-renderers.ts` draws them, and the result's text stays plain for the model
 * and for print mode. The model label, the tags and the activity text come from the helpers here,
 * which `ui/format.ts` re-exports for the other surfaces.
 */
import type { AgentMessage, AgentToolResult } from "@earendil-works/pi-agent-core";
import { stripAnsi } from "../../../../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../../../../utils/shell.ts";
import type { SubagentStatus, SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import { displayTokens } from "../usage.ts";

/**
 * Text a child produced, safe to print: no escape sequence, control character or carriage return,
 * as Pi's own tool rows show tool output (`core/tools/render-utils.ts`). A child can read a file
 * holding, say, an OSC 52 clipboard write; the model-facing text keeps it (T18-F4).
 */
export function displayText(text: string): string {
	return sanitizeBinaryOutput(stripAnsi(text)).replace(/\r/g, "");
}

/** Tool names as the activity text reads them. */
const TOOL_ACTIONS: Readonly<Record<string, string>> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

const MAX_ACTIVITY_LENGTH = 60;

/** The tools an agent runs now: each started and not yet ended, in start order. */
export function activeTools(view: Pick<SubagentView, "activity">): string[] {
	const active: string[] = [];
	for (const entry of view.activity) {
		if (entry.type === "tool_start") active.push(entry.toolName);
		else if (entry.type === "tool_end") {
			const index = active.indexOf(entry.toolName);
			if (index !== -1) active.splice(index, 1);
		}
	}
	return active;
}

/**
 * What an agent does now: its running tools by action, a repeated action grouped (`reading 3
 * files`); else the first non-empty line of its response, cut at 60 characters; else `thinking…`.
 */
export function describeActivity(tools: readonly string[], responseText?: string): string {
	if (tools.length > 0) {
		const groups = new Map<string, number>();
		for (const tool of tools) {
			// A child's model names its tool calls; an unknown name prints safely.
			const action = TOOL_ACTIONS[tool] ?? displayText(tool);
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}
		const parts = [...groups].map(([action, count]) =>
			count > 1 ? `${action} ${count} ${action === "searching" ? "patterns" : "files"}` : action,
		);
		return `${parts.join(", ")}…`;
	}
	const line = (responseText === undefined ? undefined : displayText(responseText))
		?.split("\n")
		.find((candidate) => candidate.trim())
		?.trim();
	if (line) return line.length <= MAX_ACTIVITY_LENGTH ? line : `${line.slice(0, MAX_ACTIVITY_LENGTH)}…`;
	return "thinking…";
}

/** The text of the newest assistant message, the agent's response so far. */
export function responseText(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;
		return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
	}
	return undefined;
}

/**
 * A model's short label for tight rows (`haiku 4.5`) and its `provider/id` for roomy ones; a model
 * that names no provider has no canonical id, and roomy rows fall back to the short label.
 */
export function describeModel(model: { provider: string; id: string; name?: string }): { name: string; id?: string } {
	return {
		name: (model.name ?? model.id).replace(/^Claude\s+/i, "").toLowerCase(),
		id: model.provider ? `${model.provider}/${model.id}` : undefined,
	};
}

/** `twin` for an agent whose prompt appends to its parent's, nothing for one that replaces it. */
export function promptModeLabel(view: Pick<SubagentView, "definition">): string | undefined {
	return view.definition.promptMode === "append" ? "twin" : undefined;
}

/**
 * The model an agent runs on and its invocation tags (P22). The model and thinking level are the
 * child session's once it attached, else the resolved request. A value the run did not honor says
 * what was asked: `thinking: off (asked high)`, a model an agent file pinned over the caller's
 * `model` parameter likewise.
 */
export function invocationTags(view: Pick<SubagentView, "effective" | "invocation" | "model">): {
	modelName?: string;
	modelId?: string;
	tags: string[];
} {
	const { invocation, effective } = view;
	const asked = (value: string | undefined, requested: string | undefined) =>
		value && requested && requested !== value ? `${value} (asked ${requested})` : value;
	const tags: string[] = [];
	const thinking = effective.thinking ?? invocation.thinking;
	const requestedThinking = invocation.overridden?.thinking ?? invocation.thinking;
	const thinkingTag = asked(thinking, requestedThinking);
	if (thinkingTag) tags.push(`thinking: ${thinkingTag}`);
	if (invocation.isolated) tags.push("isolated");
	if (invocation.isolation === "worktree") tags.push("worktree");
	if (invocation.inheritContext) tags.push("inherit context");
	if (invocation.runInBackground) tags.push("background");
	if (invocation.maxTurns) tags.push(`max turns: ${invocation.maxTurns}`);
	const model = effective.model ?? view.model;
	const labels = model ? describeModel(model) : undefined;
	return {
		modelName: asked(labels?.name, invocation.overridden?.model),
		modelId: asked(labels?.id, invocation.overridden?.model),
		tags,
	};
}

/** What an `Agent` result's renderer draws; every field is data, and the text stays plain. */
export interface AgentToolDetails {
	/** The run's status; `background` marks a background call's launch result. */
	status: SubagentStatus | "background";
	agentId: string;
	displayName: string;
	/** The agent file's `color:`, for the name badge. */
	color?: string;
	description: string;
	/** The short model label, with what was asked when the run did not honor it. */
	modelName?: string;
	/** The prompt mode label and the invocation tags. */
	tags: string[];
	toolUses: number;
	turns: number;
	maxTurns?: number;
	tokens: number;
	contextPercent?: number;
	compactions: number;
	/** Set only under `showCost`. */
	cost?: number;
	startedAt: number;
	/** Set once the run ended. */
	durationMs?: number;
	/** What a running or queued agent does now. */
	activity?: string;
	queuePosition?: number;
	error?: string;
}

/** The details of `view` now; `status` overrides the view's for a background launch. */
export function agentToolDetails(
	service: SubagentService,
	view: SubagentView,
	status: AgentToolDetails["status"] = view.status,
): AgentToolDetails {
	const settings = service.settings;
	const { modelName, tags } = invocationTags(view);
	const mode = promptModeLabel(view);
	const queuePosition = view.status === "queued" ? service.queuePosition(view.id) : undefined;
	const ahead = queuePosition === undefined ? 0 : queuePosition - 1;
	// A queued agent has no run yet; a started one shows the limit its run enforces.
	const maxTurns = view.status === "queued" ? (view.invocation.maxTurns ?? settings.defaultMaxTurns) : view.maxTurns;
	const activity =
		view.status === "queued"
			? view.mode === "foreground"
				? `queued — waiting for a foreground slot${ahead > 0 ? ` (${ahead} ahead)` : ""}`
				: "queued"
			: view.status === "running"
				? describeActivity(activeTools(view), responseText(service.conversation(view.id)?.messages ?? []))
				: undefined;
	return {
		status,
		agentId: view.id,
		displayName: view.definition.displayName ?? view.type,
		color: view.definition.color,
		description: view.description,
		modelName,
		tags: mode ? [mode, ...tags] : tags,
		toolUses: view.toolUses,
		turns: view.turns,
		maxTurns: maxTurns !== undefined && maxTurns > 0 ? maxTurns : undefined,
		tokens: displayTokens(view.usage),
		contextPercent: service.contextPercent(view.id),
		compactions: view.compactionCount,
		cost: settings.showCost ? view.usage.cost.total : undefined,
		startedAt: view.startedAt,
		durationMs: view.completedAt === undefined ? undefined : view.completedAt - view.startedAt,
		activity,
		queuePosition,
		error: view.error,
	};
}

/** A text result with details; under `reportUsage` it also carries the subagent spend the session has not counted. */
export function detailedResult(
	service: SubagentService,
	text: string,
	details: AgentToolDetails,
): AgentToolResult<AgentToolDetails> {
	const usage = service.takeReportedUsage();
	return { content: [{ type: "text", text }], details, ...(usage && { usage }) };
}
