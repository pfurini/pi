/**
 * Fork-owned: the `Agent` tool's call and result rows (plan T8, F12; P9, P10). pi-subagents
 * `src/index.ts:1846-1959` at 79a7c42 is the behavior reference. `base-tools.ts` sets them on the
 * headless definition in place: `tools/` imports no presentation code, and registration reads
 * nothing from the session. A running row computes its spinner frame and elapsed time when it
 * renders, and the tool row renders it every frame between updates.
 */
import { type Component, Text } from "@earendil-works/pi-tui";
import type { Theme } from "../../../../modes/interactive/theme/theme.ts";
import type { AgentSession } from "../../../agent-session.ts";
import type { ToolDefinition } from "../../../extensions/types.ts";
import { resolveAgentKey } from "../definitions/registry.ts";
import { existingSubagentService } from "../service/sessions.ts";
import type { AgentToolDetails } from "../tools/details.ts";
import { renderAgentNameLabel, resolveAgentColor } from "./colors.ts";
import {
	displayText,
	fgPreservingNestedStyles,
	formatCost,
	formatMs,
	formatSessionTokens,
	formatTurns,
	SPINNER,
} from "./format.ts";

/** How long one spinner frame shows. */
const SPINNER_FRAME_MS = 80;
/** Result lines an expanded row shows before it points to `get_subagent_result`. */
const MAX_EXPANDED_LINES = 50;

interface AgentCallArgs {
	description?: string;
	subagent_type?: string;
}

/** The name and color the call row shows; the result row keeps what its details said. */
interface RowState {
	agent?: { displayName: string; color?: string };
}

function textOf(content: readonly unknown[]): string {
	const first = content[0] as { type?: string; text?: unknown } | undefined;
	return first?.type === "text" && typeof first.text === "string" ? first.text : "";
}

/** `haiku 4.5 · thinking: high · ↻5≤30 · 3 tool uses · 33.8k token (45%) · ~$0.0123`, all dim. */
function stats(details: AgentToolDetails, theme: Theme): string {
	const parts: string[] = [];
	if (details.modelName) parts.push(details.modelName);
	parts.push(...details.tags);
	if (details.turns > 0) parts.push(formatTurns(details.turns, details.maxTurns));
	if (details.toolUses > 0) parts.push(`${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}`);
	if (details.tokens > 0) {
		parts.push(formatSessionTokens(details.tokens, details.contextPercent, theme, details.compactions));
	}
	const cost = details.cost === undefined ? "" : formatCost(details.cost);
	if (cost) parts.push(cost);
	return parts.map((part) => fgPreservingNestedStyles(theme, "dim", part)).join(` ${theme.fg("dim", "·")} `);
}

/** A running or queued agent: the spinner, the stats and the elapsed time, then `⎿ <activity>`. */
class RunningRow implements Component {
	private readonly details: AgentToolDetails;
	private readonly theme: Theme;

	constructor(details: AgentToolDetails, theme: Theme) {
		this.details = details;
		this.theme = theme;
	}

	render(width: number): string[] {
		const now = Date.now();
		const frame = SPINNER[Math.floor(now / SPINNER_FRAME_MS) % SPINNER.length];
		const line = [
			stats(this.details, this.theme),
			this.theme.fg("dim", formatMs(Math.max(0, now - this.details.startedAt))),
		]
			.filter(Boolean)
			.join(` ${this.theme.fg("dim", "·")} `);
		const head = new Text(`${this.theme.fg("accent", frame)} ${line}`, 0, 0);
		const activity = new Text(this.theme.fg("dim", `  ⎿  ${this.details.activity ?? "thinking…"}`), 0, 0);
		return [...head.render(width), ...activity.render(width)];
	}

	invalidate(): void {}
}

function finishedHead(icon: string, details: AgentToolDetails, theme: Theme): string {
	const line = stats(details, theme);
	const duration =
		details.durationMs === undefined
			? ""
			: ` ${theme.fg("dim", "·")} ${theme.fg("dim", formatMs(details.durationMs))}`;
	return `${icon}${line ? ` ${line}` : ""}${duration}`;
}

function renderResultRow(
	details: AgentToolDetails,
	text: string,
	expanded: boolean,
	isPartial: boolean,
	theme: Theme,
): Component {
	if (isPartial || details.status === "running" || details.status === "queued") return new RunningRow(details, theme);
	switch (details.status) {
		case "background":
			return new Text(theme.fg("dim", `  ⎿  Running in background (ID: ${details.agentId})`), 0, 0);
		case "completed":
		case "steered": {
			const steered = details.status === "steered";
			let line = finishedHead(theme.fg(steered ? "warning" : "success", "✓"), details, theme);
			if (!expanded) {
				line += `\n${theme.fg("dim", `  ⎿  ${steered ? "Wrapped up (turn limit)" : "Done"}`)}`;
			} else if (text) {
				const lines = text.split("\n");
				for (const shown of lines.slice(0, MAX_EXPANDED_LINES)) line += `\n${theme.fg("dim", `  ${shown}`)}`;
				if (lines.length > MAX_EXPANDED_LINES) {
					line += `\n${theme.fg("muted", "  ... (use get_subagent_result with verbose for full output)")}`;
				}
			}
			return new Text(line, 0, 0);
		}
		case "stopped":
			return new Text(
				`${finishedHead(theme.fg("dim", "■"), details, theme)}\n${theme.fg("dim", "  ⎿  Stopped")}`,
				0,
				0,
			);
		case "error":
			return new Text(
				`${finishedHead(theme.fg("error", "✗"), details, theme)}\n${theme.fg("error", `  ⎿  Error: ${displayText(details.error ?? "unknown")}`)}`,
				0,
				0,
			);
		case "aborted":
			return new Text(
				`${finishedHead(theme.fg("error", "✗"), details, theme)}\n${theme.fg("warning", `  ⎿  Aborted${details.error ? `: ${displayText(details.error)}` : ""}`)}`,
				0,
				0,
			);
	}
}

/**
 * Sets `renderCall` and `renderResult` on the `Agent` definition in place and returns it. The call
 * row finds the agent's display name and color in `session`'s registry when the row renders, or
 * in the details its result row last drew.
 */
export function withAgentToolRenderers(definition: ToolDefinition, session: AgentSession): ToolDefinition {
	definition.renderCall = (args, theme, context) => {
		const { description, subagent_type } = args as AgentCallArgs;
		const state = context.state as RowState | undefined;
		const registry = existingSubagentService(session)?.registry;
		const key = subagent_type && registry ? resolveAgentKey(registry, subagent_type) : undefined;
		const found = key === undefined ? undefined : registry?.agents.get(key);
		const agent = state?.agent ?? (found && { displayName: found.displayName ?? found.name, color: found.color });
		// A badge closes its own background, so it reopens the tool row's tint behind it.
		const background = resolveAgentColor(agent?.color)
			? theme.getBgAnsi(context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg")
			: "";
		const name = renderAgentNameLabel(agent?.displayName ?? subagent_type ?? "Agent", agent?.color, theme, {
			fallbackColor: "toolTitle",
			restoreBackground: background,
			bold: true,
		});
		return new Text(`${background}▸ ${name}${description ? `  ${theme.fg("muted", description)}` : ""}`, 0, 0);
	};
	definition.renderResult = (result, { expanded, isPartial }, theme, context) => {
		const details = result.details as AgentToolDetails | undefined;
		// The result carries the agent's output as the model reads it; the row prints it safely (T18-F4).
		const text = displayText(textOf(result.content));
		// A failure before the agent started, or a result without details, shows its text (#199).
		if (context.isError || !details?.status) return new Text(text, 0, 0);
		const state = context.state as RowState | undefined;
		if (state && typeof state === "object") state.agent = { displayName: details.displayName, color: details.color };
		return renderResultRow(details, text, expanded, isPartial, theme);
	};
	return definition;
}
