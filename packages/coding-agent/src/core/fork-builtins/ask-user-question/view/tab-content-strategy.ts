import { type Component, Container, type Editor, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "../../../../modes/interactive/theme/theme.ts";
import type { QuestionnaireKeyTexts } from "../keybindings.ts";
import { formatAnswerScalar } from "../tool/format-answer.ts";
import type { QuestionData } from "../tool/types.ts";
import type { PreviewPane, PreviewPaneProps } from "./components/preview/preview-pane.ts";
import {
	type DialogState,
	HINT_PART_CANCEL,
	HINT_PART_CLEAR,
	HINT_PART_COLLAPSE_TEMPLATE,
	HINT_PART_ENTER,
	HINT_PART_NAV,
	HINT_PART_NEW_LINE,
	HINT_PART_NOTES_TEMPLATE,
	HINT_PART_TAB_TEMPLATE,
	HINT_PART_TOGGLE_TEMPLATE,
	hintPart,
	INCOMPLETE_WARNING_PREFIX,
	READY_PROMPT,
	REVIEW_GLOBAL_HINT_TEMPLATE,
	REVIEW_HEADING,
	SET_ASIDE_HINT_TEMPLATE,
} from "./dialog-builder.ts";
import type { StatefulView } from "./stateful-view.ts";
import type { TabComponents } from "./tab-components.ts";

const NOTES_HEADER = "Notes:";
const GLOBAL_NOTES_HEADER = "Global note:";
const REVIEW_NOTE_LABEL = "Note";

/**
 * Single-row, width-clipped chrome cell. Footer height stays independent of width.
 * pi-tui's `Text` word-wraps when
 * the styled hint exceeds `width`, inflating that row count and desyncing the
 * `bodyHeight + footerRowCount` math in `DialogView.render`. Clipping with
 * `truncateToWidth` (ANSI-aware, matches `multi-select-view.ts` usage) keeps
 * the hint on one line; the collapse affordance falls off the right edge with
 * `…` on terminals too narrow to advertise it.
 */
class OneLineClippedText implements Component {
	private readonly text: string;
	private readonly paddingLeft: number;

	constructor(text: string, paddingLeft = 0) {
		this.text = text;
		this.paddingLeft = paddingLeft;
	}

	render(width: number): string[] {
		const pad = " ".repeat(this.paddingLeft);
		const avail = Math.max(0, width - this.paddingLeft);
		return [pad + truncateToWidth(this.text, avail, "…", false)];
	}

	invalidate(): void {}

	handleInput(_data: string): void {}
}

/**
 * Per-tab content provider. Pure functional — closes over construction-time
 * config; per-tick state threads through method args. The chrome wrapper
 * enforces height equality across tabs via `bodyHeight + footerRowCount`.
 */
export interface TabContentStrategy {
	/** Total RENDERED footer rows — MUST equal what `footerRows()` actually emits. Drives residual math. */
	readonly footerRowCount: number;

	/** Variable rows above the body, after top chrome (border + tabBar + Spacer). */
	headingRows(state: DialogState): Component[];

	/** Body Component placed at the body slot. */
	bodyComponent(state: DialogState): Component;

	/** Natural rendered height of `bodyComponent(state)` at given width. */
	bodyHeight(width: number, state: DialogState): number;

	/** Optional rows between body's trailing Spacer and the bottom border. */
	midRows(state: DialogState): Component[];

	/** Footer rows below the bottom border. Rendered row count MUST equal `footerRowCount`. */
	footerRows(state: DialogState): Component[];

	/** Row range of the focused item within the body's rendered output, or undefined if no interactive focus. */
	focusedItemRowRange(width: number, state: DialogState): [number, number] | undefined;
}

export interface QuestionTabStrategyConfig {
	theme: Theme;
	questions: readonly QuestionData[];
	getPreviewPane: () => StatefulView<PreviewPaneProps>;
	tabsByIndex: ReadonlyArray<TabComponents>;
	notesInput: Editor;
	isMulti: boolean;
	getCurrentBodyHeight: (width: number) => number;
	/** Resolved collapse key spec (`"ctrl+]"`, `"alt+o"`, or `"off"`). Drives the footer's collapse hint. */
	keyTexts: QuestionnaireKeyTexts;
}

export class QuestionTabStrategy implements TabContentStrategy {
	/** Keep legacy footer height when no question carries rejected alternatives. */
	get footerRowCount(): number {
		return this.config.questions.some((question) => question.setAside?.length) ? 3 : 2;
	}

	private readonly config: QuestionTabStrategyConfig;

	constructor(config: QuestionTabStrategyConfig) {
		this.config = config;
	}

	headingRows(state: DialogState): Component[] {
		const out: Component[] = [];
		const question = this.config.questions[state.currentTab];
		// In multi-question mode the tab bar already shows the header; suppress the inline badge.
		if (!this.config.isMulti && question?.header && question.header.length > 0) {
			out.push(new Text(this.config.theme.bg("selectedBg", ` ${question.header} `), 1, 0));
			out.push(new Spacer(1));
		}
		if (question) {
			out.push(new Text(this.config.theme.bold(question.question), 1, 0));
			out.push(new Spacer(1));
		}
		return out;
	}

	bodyComponent(state: DialogState): Component {
		const question = this.config.questions[state.currentTab];
		const mso = this.config.tabsByIndex[state.currentTab]?.multiSelect;
		if (question?.multiSelect === true && mso) return mso;
		return this.config.getPreviewPane();
	}

	bodyHeight(width: number, _state: DialogState): number {
		return this.config.getCurrentBodyHeight(width);
	}

	midRows(state: DialogState): Component[] {
		if (!state.notesVisible) return [];
		return [new Text(this.config.theme.fg("muted", NOTES_HEADER), 1, 0), this.config.notesInput, new Spacer(1)];
	}

	footerRows(state: DialogState): Component[] {
		const question = this.config.questions[state.currentTab];
		// OneLineClippedText (not pi-tui `Text`) — `buildHintText` includes the collapse
		// affordance, pushing the rendered string past 80 columns; `Text` would wrap and
		// break the strategy's fixed row budget. Clipping on narrow terminals
		// drops the trailing parts (collapse hint first, then cancel) with `…`.
		return [
			...(this.footerRowCount === 3
				? [
						new OneLineClippedText(
							question?.setAside?.length && !state.notesVisible && !state.inputMode
								? this.config.theme.fg(
										"muted",
										hintPart(SET_ASIDE_HINT_TEMPLATE, this.config.keyTexts.setAside),
									)
								: "",
							1,
						),
					]
				: []),
			new Spacer(1),
			new OneLineClippedText(
				this.config.theme.fg("dim", buildHintText(question, this.config.isMulti, state, this.config.keyTexts)),
				1,
			),
		];
	}

	focusedItemRowRange(width: number, state: DialogState): [number, number] | undefined {
		const question = this.config.questions[state.currentTab];
		const mso = this.config.tabsByIndex[state.currentTab]?.multiSelect;
		if (question?.multiSelect === true && mso) return mso.focusedItemRowRange(width);
		return (this.config.getPreviewPane() as unknown as PreviewPane).focusedItemRowRange(width);
	}
}

export interface SubmitTabStrategyConfig {
	theme: Theme;
	questions: readonly QuestionData[];
	submitPicker: Component | undefined;
	/** Shared notes Editor — mounted into midRows while the global-note editor is open on this tab. */
	notesInput: Editor;
	keyTexts: QuestionnaireKeyTexts;
}

export class SubmitTabStrategy implements TabContentStrategy {
	/** Spacer(1) + Text(prompt, 1) + submitPicker(2) + OneLineClippedText(hint, 1) = 5 rendered rows. Fallback path lands at 5 via 2 Spacer(1)s in the picker slot. */
	readonly footerRowCount = 5;

	private readonly config: SubmitTabStrategyConfig;

	constructor(config: SubmitTabStrategyConfig) {
		this.config = config;
	}

	headingRows(_state: DialogState): Component[] {
		return [new Text(this.config.theme.bold(this.config.theme.fg("accent", REVIEW_HEADING)), 1, 0), new Spacer(1)];
	}

	bodyComponent(state: DialogState): Component {
		const c = new Container();
		for (let i = 0; i < this.config.questions.length; i++) {
			const q = this.config.questions[i];
			const a = state.answers.get(i);
			if (!a) continue;
			const label = q.header && q.header.length > 0 ? q.header : `Q${i + 1}`;
			const answerText = formatAnswerScalar(a, "summary");
			c.addChild(new Text(this.config.theme.fg("muted", ` ● ${label}`), 1, 0));
			c.addChild(
				new Text(`   ${this.config.theme.fg("muted", "→")} ${this.config.theme.fg("text", answerText)}`, 1, 0),
			);
			if (a.notes && a.notes.length > 0) {
				c.addChild(new Text(this.config.theme.fg("dim", `     notes: ${a.notes}`), 1, 0));
			}
		}
		// Committed global note (#182) as a review entry — pressing `n` gets visible
		// feedback and the note is reviewable before submit. Same presence predicate as
		// the reducer's doneFor lift. Hidden while the editor is open: the midRows editor
		// (seeded with this text) is the live surface then, and a stale copy above it
		// would read as a second note.
		const globalNote = state.notesByTab.get(this.config.questions.length);
		if (!state.notesVisible && globalNote && globalNote.length > 0) {
			c.addChild(new Text(this.config.theme.fg("muted", ` ● ${REVIEW_NOTE_LABEL}`), 1, 0));
			c.addChild(
				new Text(`   ${this.config.theme.fg("muted", "→")} ${this.config.theme.fg("text", globalNote)}`, 1, 0),
			);
		}
		return c;
	}

	bodyHeight(width: number, state: DialogState): number {
		return this.bodyComponent(state).render(width).length;
	}

	midRows(state: DialogState): Component[] {
		// notesVisible-gated mirror of QuestionTabStrategy.midRows: while the global-note
		// editor is open, the shared notesInput mounts below the answer summary under its
		// own header. The pseudo-index draft (notesByTab[questions.length]) is reducer-owned
		// state; the strategy only renders.
		if (!state.notesVisible) return [];
		return [
			new Text(this.config.theme.fg("muted", GLOBAL_NOTES_HEADER), 1, 0),
			this.config.notesInput,
			new Spacer(1),
		];
	}

	footerRows(state: DialogState): Component[] {
		const missing: string[] = [];
		for (let i = 0; i < this.config.questions.length; i++) {
			const q = this.config.questions[i];
			if (!state.answers.has(i)) {
				missing.push(q.header && q.header.length > 0 ? q.header : `Q${i + 1}`);
			}
		}
		const promptText =
			missing.length === 0
				? this.config.theme.fg("muted", READY_PROMPT)
				: this.config.theme.fg("warning", `${INCOMPLETE_WARNING_PREFIX} ${missing.join(", ")}`);
		const out: Component[] = [new Spacer(1), new Text(promptText, 1, 0)];
		if (this.config.submitPicker) {
			out.push(this.config.submitPicker);
		} else {
			// Padding when the picker isn't wired — keeps rendered row count at footerRowCount=5.
			out.push(new Spacer(1));
			out.push(new Spacer(1));
		}
		// Bottom key-hint row, mirroring QuestionTabStrategy's footer idiom (one dim
		// `·`-joined line below everything) — the prompt reads straight into its picker
		// with no hint wedged between them. Always present so footerRowCount stays
		// exactly 5. OneLineClippedText (not pi-tui Text) — a wrapped hint would inflate
		// the footer past footerRowCount and desync the chrome's cross-tab height math.
		out.push(
			new OneLineClippedText(this.config.theme.fg("dim", buildSubmitHintText(state, this.config.keyTexts)), 1),
		);
		return out;
	}

	focusedItemRowRange(_width: number, _state: DialogState): [number, number] | undefined {
		return undefined;
	}
}

/**
 * Build the controls hint line. Order:
 *   Enter · ↑/↓ [· Space toggle] [· n notes] [· Tab switch] · Esc [· <key> collapse]
 *   [· Shift+Enter newline] [· Ctrl+U clear]
 *
 * `NOTES` is part of the resting (notes-closed) core — it drops while the notes
 * editor or custom-answer input has the keyboard. Ctrl+G is Pi's global external-
 * editor shortcut and needs no local hint; the context-specific clear shortcut is
 * appended at the far right while input mode is active.
 *
 * The collapse part interpolates the configured `keyTexts` (display-cased)
 * and is omitted entirely when the shortcut is `"off"` — `routeKey` and the raw
 * terminal listener both refuse to collapse in that case, so advertising a key
 * would be a lie.
 */
export function buildHintText(
	question: QuestionData | undefined,
	isMulti: boolean,
	state: DialogState,
	keyTexts: QuestionnaireKeyTexts,
): string {
	const parts: string[] = [HINT_PART_ENTER, HINT_PART_NAV];
	if (question?.multiSelect === true && keyTexts.toggle)
		parts.push(hintPart(HINT_PART_TOGGLE_TEMPLATE, keyTexts.toggle));
	if (question && !state.notesVisible && !state.inputMode && keyTexts.notes) {
		parts.push(hintPart(HINT_PART_NOTES_TEMPLATE, keyTexts.notes));
	}
	if (isMulti && keyTexts.nextTab) parts.push(hintPart(HINT_PART_TAB_TEMPLATE, keyTexts.nextTab));
	parts.push(HINT_PART_CANCEL);
	if (keyTexts.collapse) parts.push(hintPart(HINT_PART_COLLAPSE_TEMPLATE, keyTexts.collapse));
	if (state.notesVisible || state.inputMode) parts.push(HINT_PART_NEW_LINE);
	if (state.inputMode) parts.push(HINT_PART_CLEAR);
	return parts.join(" · ");
}

/**
 * Submit-tab counterpart of `buildHintText` — the same `·`-joined bottom-row idiom.
 * Resting: Enter · ↑/↓ · `n to add a note` · Esc. While the global-note editor is
 * open the note part drops (the editor is the affordance then) and the Shift+Enter
 * newline hint is appended after cancel, mirroring the question tabs' notes-open shape.
 */
export function buildSubmitHintText(state: DialogState, keyTexts: QuestionnaireKeyTexts): string {
	const parts: string[] = [HINT_PART_ENTER, HINT_PART_NAV];
	if (!state.notesVisible && keyTexts.notes) parts.push(hintPart(REVIEW_GLOBAL_HINT_TEMPLATE, keyTexts.notes));
	parts.push(HINT_PART_CANCEL);
	if (state.notesVisible) parts.push(HINT_PART_NEW_LINE);
	return parts.join(" · ");
}
