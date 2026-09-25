import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { t } from "../../state/i18n-bridge.js";
import type { QuestionData } from "../../tool/types.js";

/** Render rejected context separately from selectable rows, with an independently scrollable viewport. */
export function renderSetAside(question: QuestionData, theme: Theme, width: number, height: number, scroll: number) {
	const columns = Math.max(1, Math.floor(width));
	const rows = Math.max(1, Math.floor(height));
	const body = [
		question.question,
		"",
		...(question.setAside ?? []).flatMap(({ label, reason }) => [label, reason, ""]),
	];
	const content = body.flatMap((text) => new Text(text, 0, 0).render(columns));
	// Tiny terminals drop chrome before sacrificing their last content row.
	const headingRows = rows >= 3 ? 1 : 0;
	const footerRows = rows >= 2 ? 1 : 0;
	const available = rows - headingRows - footerRows;
	const maxScroll = Math.max(0, content.length - available);
	const start = Math.max(0, Math.min(scroll, maxScroll));
	const heading = theme.bold(t("alternatives.heading", "Alternatives considered"));
	const hint = t("alternatives.controls", "↑/↓ scroll · Esc back");
	return {
		maxScroll,
		lines: [
			...(headingRows ? [truncateToWidth(heading, columns)] : []),
			...content.slice(start, start + available),
			...(footerRows ? [truncateToWidth(theme.fg("dim", `${hint} (${start + 1}/${maxScroll + 1})`), columns)] : []),
		],
	};
}
