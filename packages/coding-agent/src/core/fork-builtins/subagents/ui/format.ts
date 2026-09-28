/**
 * Fork-owned: how the presentation writes an agent's numbers, status, activity and model (plan T7).
 * pi-subagents `src/ui/agent-widget.ts`, `src/ui/fleet-list.ts` and `src/model-resolver.ts` at
 * 79a7c42 are the behavior reference. Every function is pure: it reads a view and a theme and
 * returns text, so the widget, FleetView, the viewer and the tool renderers agree.
 */
import type { SubagentStatus, SubagentView } from "../service/records.ts";
import { formatCost, formatMs } from "../tools/common.ts";

export { formatCost, formatMs };

/** What the formats need from Pi's theme. */
export interface FormatTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

/** Braille spinner frames for a running agent. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

function compactCount(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return `${count}`;
}

/** `33.8k token`, `1.2M token`, `950 token`. */
export function formatTokenCount(count: number): string {
	return `${compactCount(count)} token`;
}

/** FleetView's form: `↓ 13.1k tokens`. */
export function formatFleetTokens(count: number): string {
	return `↓ ${compactCount(count)} tokens`;
}

/**
 * The token count with the context fill and the compaction count: `12.3k token (45% · ⇊2)`. The
 * percent is dim below 70, `warning` from 70 and `error` from 85; the compactions are dim.
 */
export function formatSessionTokens(
	tokens: number,
	percent: number | undefined,
	theme: FormatTheme,
	compactions = 0,
): string {
	const annotations: string[] = [];
	if (percent !== undefined) {
		const color = percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim";
		annotations.push(theme.fg(color, `${Math.round(percent)}%`));
	}
	if (compactions > 0) annotations.push(theme.fg("dim", `⇊${compactions}`));
	const count = formatTokenCount(tokens);
	return annotations.length === 0 ? count : `${count} (${annotations.join(" · ")})`;
}

/**
 * `theme.fg(color, text)`, where a nested foreground reset (`39`) or full reset (`0`) inside `text`
 * returns to `color` instead of dropping it.
 */
export function fgPreservingNestedStyles(theme: FormatTheme, color: string, text: string): string {
	const start = theme.fg(color, "").replace(/\u001b\[(?:0|39)m/g, "");
	return theme.fg(
		color,
		text.replace(/\u001b\[(?:0|39)m/g, (reset) => `${reset}${start}`),
	);
}

/** `↻5≤30` with a turn limit, `↻5` without. */
export function formatTurns(turns: number, maxTurns?: number): string {
	return maxTurns ? `↻${turns}≤${maxTurns}` : `↻${turns}`;
}

/** FleetView's elapsed time: whole seconds, never below `0s`. */
export function formatFleetElapsed(ms: number): string {
	return `${Math.max(0, Math.round(ms / 1000))}s`;
}

/** The icon of a status: the spinner frame while running, `◦` queued, then `✓`, `■` or `✗`. */
export function statusIcon(status: SubagentStatus, theme: FormatTheme, frame = 0): string {
	switch (status) {
		case "running":
			return theme.fg("accent", SPINNER[frame % SPINNER.length]);
		case "queued":
			return theme.fg("muted", "◦");
		case "completed":
			return theme.fg("success", "✓");
		case "steered":
			return theme.fg("warning", "✓");
		case "stopped":
			return theme.fg("dim", "■");
		default:
			return theme.fg("error", "✗");
	}
}

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
			const action = TOOL_ACTIONS[tool] ?? tool;
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}
		const parts = [...groups].map(([action, count]) =>
			count > 1 ? `${action} ${count} ${action === "searching" ? "patterns" : "files"}` : action,
		);
		return `${parts.join(", ")}…`;
	}
	const line = responseText
		?.split("\n")
		.find((candidate) => candidate.trim())
		?.trim();
	if (line) return line.length <= MAX_ACTIVITY_LENGTH ? line : `${line.slice(0, MAX_ACTIVITY_LENGTH)}…`;
	return "thinking…";
}

/** A model's short label for tight rows (`haiku 4.5`) and its `provider/id` for roomy ones. */
export function describeModel(model: { provider: string; id: string; name?: string }): { name: string; id: string } {
	return {
		name: (model.name ?? model.id).replace(/^Claude\s+/i, "").toLowerCase(),
		id: `${model.provider}/${model.id}`,
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
