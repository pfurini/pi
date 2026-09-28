/**
 * Fork-owned: how the presentation writes an agent's numbers, status, activity and model (plan T7).
 * pi-subagents `src/ui/agent-widget.ts`, `src/ui/fleet-list.ts` and `src/model-resolver.ts` at
 * 79a7c42 are the behavior reference. Every function is pure: it reads a view and a theme and
 * returns text, so the widget, FleetView, the viewer and the tool renderers agree.
 */
import type { SubagentStatus } from "../service/records.ts";
import { formatCost, formatMs } from "../tools/common.ts";

export { formatCost, formatMs };
export {
	activeTools,
	describeActivity,
	describeModel,
	invocationTags,
	promptModeLabel,
	responseText,
} from "../tools/details.ts";

/** What the formats need from Pi's theme. */
export interface FormatTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

/** Braille spinner frames for a running agent. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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
