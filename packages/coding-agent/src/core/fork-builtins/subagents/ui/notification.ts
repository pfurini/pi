/**
 * Fork-owned: the renderer of `subagent-notification` messages (plan T9). pi-subagents
 * `src/index.ts:342-404` at 79a7c42 is the behavior reference. Each agent takes a heading with its
 * status, a stats line, the result's first line (or up to 30 lines expanded) and its transcript path.
 * A group under `showCost` opens with a total line, derived from the rows so it never disagrees with
 * them. The factory passes `showCost`, which it reads from the bound session's existing service at
 * render time.
 */
import { Text } from "@earendil-works/pi-tui";
import type { MessageRenderer } from "../../../extensions/types.ts";
import type { NotificationDetails } from "../service/notifications.ts";
import { type FormatTheme, formatCost, formatMs, formatTokenCount, formatTurns } from "./format.ts";

/** Characters of the result's first line a collapsed notification shows. */
const COLLAPSED_PREVIEW = 80;
/** Result lines an expanded notification shows. */
const EXPANDED_LINES = 30;

function renderOne(details: NotificationDetails, expanded: boolean, theme: FormatTheme, showCost: boolean): string {
	const failed = details.status === "error" || details.status === "stopped" || details.status === "aborted";
	const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const statusText = failed ? details.status : details.status === "steered" ? "completed (steered)" : "completed";
	let text = `${icon} ${theme.bold(details.description)} ${theme.fg("dim", statusText)}`;

	const parts: string[] = [];
	if (details.turnCount > 0) parts.push(formatTurns(details.turnCount, details.maxTurns));
	if (details.toolUses > 0) parts.push(`${details.toolUses} tool use${details.toolUses === 1 ? "" : "s"}`);
	if (details.totalTokens > 0) parts.push(formatTokenCount(details.totalTokens));
	const cost = showCost ? formatCost(details.totalCost) : "";
	if (cost) parts.push(cost);
	if (details.durationMs > 0) parts.push(formatMs(details.durationMs));
	if (parts.length > 0) {
		text += `\n  ${parts.map((part) => theme.fg("dim", part)).join(` ${theme.fg("dim", "·")} `)}`;
	}

	if (expanded) {
		for (const line of details.resultPreview.split("\n").slice(0, EXPANDED_LINES)) {
			text += `\n${theme.fg("dim", `  ${line}`)}`;
		}
	} else {
		const preview = details.resultPreview.split("\n")[0]?.slice(0, COLLAPSED_PREVIEW) ?? "";
		text += `\n  ${theme.fg("dim", `⎿  ${preview}`)}`;
	}

	if (details.outputFile) text += `\n  ${theme.fg("muted", `transcript: ${details.outputFile}`)}`;
	return text;
}

/** The notification's text: every agent of it, after a total line for a priced group under `showCost`. */
export function renderNotification(
	details: NotificationDetails,
	expanded: boolean,
	theme: FormatTheme,
	showCost: boolean,
): string {
	const all = [details, ...(details.others ?? [])];
	const rendered = all.map((entry) => renderOne(entry, expanded, theme, showCost));
	if (showCost && all.length > 1) {
		const total = formatCost(all.reduce((sum, entry) => sum + entry.totalCost, 0));
		if (total) {
			const tokens = all.reduce((sum, entry) => sum + entry.totalTokens, 0);
			rendered.unshift(theme.fg("dim", `${all.length} agents · ${formatTokenCount(tokens)} · ${total}`));
		}
	}
	return rendered.join("\n");
}

/** The message renderer; `showCost` is read on every render, so a settings change shows at once. */
export function notificationRenderer(showCost: () => boolean): MessageRenderer<NotificationDetails> {
	return (message, { expanded }, theme) => {
		const details = message.details;
		if (!details) return undefined;
		return new Text(renderNotification(details, expanded, theme, showCost()), 0, 0);
	};
}
