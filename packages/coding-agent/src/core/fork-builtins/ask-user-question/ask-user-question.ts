/**
 * Fork-owned: the `ask_user_question` base tool. Ported from rpiv-ask-user-question 2.11.0
 * (github.com/juicesharp/rpiv-mono, fork pfurini/rpiv-mono `personal` at 8403bb09); MIT
 * licence, see LICENSE in this directory.
 *
 * `AgentSession` registers the definition next to `read` and the other base tools, so no
 * extension loader, jiti or custom `ResourceLoader` affects it. It stays available without
 * a UI; a call that finds none returns the `no_ui` result.
 */
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { isKeyRelease, isKeyRepeat, type OverlayHandle } from "@earendil-works/pi-tui";
import type { Theme } from "../../../modes/interactive/theme/theme.ts";
import type { EventBus } from "../../event-bus.ts";
import type { ExtensionContext, ToolDefinition } from "../../extensions/types.ts";
import { loadConfig } from "./config.ts";
import {
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
} from "./events.ts";
import { ASK_USER_QUESTION_KEYBINDING_IDS, questionnaireKeyTexts } from "./keybindings.ts";
import { type DialogUI, hasDialogUI, runRpcQuestionnaire } from "./rpc-fallback.ts";
import { editWithExternalEditor } from "./state/external-editor.ts";
import { QuestionnaireSession, type QuestionnaireSessionComponent } from "./state/questionnaire-session.ts";
import { displayLabel, sentinelsToAppend } from "./state/row-intent.ts";
import { normalizeQuestionParams } from "./tool/normalize-params.ts";
import { buildQuestionnaireResponse, buildToolResult } from "./tool/response-envelope.ts";
import {
	MAX_LABEL_LENGTH,
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionData,
	type QuestionnaireResult,
	type QuestionParams,
	QuestionParamsSchema,
	RECOMMENDED_MARKER,
} from "./tool/types.ts";
import { validateQuestionnaire } from "./tool/validate-questionnaire.ts";
import type { WrappingSelectItem } from "./view/components/wrapping-select.ts";

/** Canonical tool name, shared with `base-tool.ts`. */
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

export interface AskUserQuestionToolOptions {
	/** The session agent directory; its `settings.json` may override the guidance texts. */
	agentDir: string;
	/** The session's event bus. The prompt and blocked events go here; without a bus nothing is emitted. */
	eventBus?: EventBus;
	/** Pi's configured external editor command, read when the user opens the editor. */
	getExternalEditorCommand?: () => string | undefined;
}

type Emit = (channel: string, data: unknown) => void;

function emitAskUserPromptEvent(emit: Emit, params: QuestionParams): void {
	const payload: AskUserPromptEventPayload = {
		questions: params.questions.map((q) => ({
			question: q.question,
			header: q.header,
			multiSelect: q.multiSelect ?? false,
			options: q.options.map((o) => ({
				label: o.label,
				description: o.description,
				hasPreview: typeof o.preview === "string" && o.preview.length > 0,
			})),
			...(q.setAside !== undefined ? { setAside: q.setAside.map(({ label, reason }) => ({ label, reason })) } : {}),
		})),
	};
	emit(ASK_USER_PROMPT_EVENT, payload);
}

function emitAskUserBlockedEvent(emit: Emit, active: boolean): void {
	const payload: AskUserBlockedEventPayload = { active };
	emit(ASK_USER_BLOCKED_EVENT, payload);
}

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

const ERROR_NO_CUSTOM_UI =
	"Error: this client cannot render the questionnaire (custom UI is unavailable, e.g. RPC/ACP hosts such as Zed or Paseo). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, without using this tool.";

/** The result of a call in a session with no UI: nobody can answer, so the question fails. */
function rejectWithoutUi() {
	return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });
}

/** Standard terminal bell. */
export const BEL = "\x07";

/**
 * Emit one portable terminal attention signal without touching redirected output.
 * The `isTTY` gate both proves an interactive terminal owns the coming wait and keeps
 * the byte out of piped RPC transports (VS Code pendant, Zed).
 */
function emitTerminalAttention(): void {
	try {
		if (process.stdout.isTTY) process.stdout.write(BEL);
	} catch {
		// Terminal attention is best effort; the questionnaire must still proceed.
	}
}

/** Sequential native-dialog walker for RPC hosts; brackets it with the blocked-event pair + terminal bell. */
async function runRpcPath(emit: Emit, ui: DialogUI, typed: QuestionParams) {
	emitAskUserBlockedEvent(emit, true);
	try {
		emitTerminalAttention();
		return buildQuestionnaireResponse(await runRpcQuestionnaire(ui, typed), typed);
	} finally {
		emitAskUserBlockedEvent(emit, false);
	}
}

type SessionRef = { current: QuestionnaireSession | null };
type OverlayHandleRef = { current: OverlayHandle | undefined };

/**
 * Register the raw terminal listener that toggles collapse while the overlay is hidden.
 * Returns the remover, or undefined when the collapse key is unbound or the host has no
 * raw input hook; callers derive `canReopenWhileHidden` from that.
 */
function registerCollapseKeyListener(
	ctx: ExtensionContext,
	keybindings: KeybindingsManager,
	collapseKeyText: string,
	sessionRef: SessionRef,
	overlayHandleRef: OverlayHandleRef,
): (() => void) | undefined {
	if (collapseKeyText === "" || typeof ctx.ui.onTerminalInput !== "function") return undefined;
	let hasAnnouncedHide = false;
	return ctx.ui.onTerminalInput((data) => {
		const handle = overlayHandleRef.current;
		if (!handle) return undefined;
		// Only act while the questionnaire is hidden (its handleInput is unreachable) or
		// actually focused. When another overlay is on top (e.g. `/btw`), leave the
		// keystroke to that overlay instead of toggling the questionnaire from underneath it.
		if (!handle.isHidden() && !handle.isFocused()) return undefined;
		if (!keybindings.matches(data, ASK_USER_QUESTION_KEYBINDING_IDS.collapse)) return undefined;
		// Kitty-protocol terminals report press, repeat, and release separately. Toggle
		// only on the initial press, so a tap does not immediately reopen the overlay.
		if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
		sessionRef.current?.toggleCollapsedExternal();
		if (handle.isHidden() && !hasAnnouncedHide) {
			hasAnnouncedHide = true;
			ctx.ui.notify?.(`ask_user_question hidden — press ${collapseKeyText} to reopen`, "info");
		}
		return { consume: true };
	});
}

/**
 * Build the `ctx.ui.custom` component factory. It receives the session's keybindings,
 * so it computes the key texts and registers the raw collapse listener before it
 * constructs the session. `removeListenerRef` lets `execute` remove the listener.
 */
function makeSessionFactory(config: {
	ctx: ExtensionContext;
	typed: QuestionParams;
	itemsByTab: WrappingSelectItem[][];
	sessionRef: SessionRef;
	overlayHandleRef: OverlayHandleRef;
	removeListenerRef: { current: (() => void) | undefined };
	getExternalEditorCommand?: () => string | undefined;
}) {
	const { ctx, typed, itemsByTab, sessionRef, overlayHandleRef, removeListenerRef, getExternalEditorCommand } = config;
	return (
		tui: TUI,
		theme: Theme,
		keybindings: KeybindingsManager,
		done: (result: QuestionnaireResult) => void,
	): QuestionnaireSessionComponent => {
		const keyTexts = questionnaireKeyTexts(keybindings);
		removeListenerRef.current = registerCollapseKeyListener(
			ctx,
			keybindings,
			keyTexts.collapse,
			sessionRef,
			overlayHandleRef,
		);
		const session = new QuestionnaireSession({
			tui,
			theme,
			params: typed,
			itemsByTab,
			done,
			keybindings,
			editInput: async (value) => {
				try {
					const editorCommand = getExternalEditorCommand?.();
					if (!editorCommand) throw new Error("No external editor command is configured");
					return await editWithExternalEditor(tui, editorCommand, value);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`External editor failed: ${message}`, "error");
					return undefined;
				}
			},
			keyTexts,
			// Hiding the overlay is reversible only through the raw listener, so the session
			// may hide it only when the listener exists; otherwise collapse shows one row.
			canReopenWhileHidden: removeListenerRef.current !== undefined,
		});
		sessionRef.current = session;
		return session.component;
	};
}

/**
 * A TUI questionnaire ALWAYS resolves a QuestionnaireResult (cancel included), so
 * `undefined` uniquely means "host cannot render", never "user declined". Run the dialog
 * walker when the host has the primitives; otherwise tell the model the user never saw
 * the questions.
 */
async function resolveUndefinedResult(ctx: ExtensionContext, typed: QuestionParams) {
	if (hasDialogUI(ctx.ui)) {
		return buildQuestionnaireResponse(await runRpcQuestionnaire(ctx.ui, typed), typed);
	}
	return buildToolResult(ERROR_NO_CUSTOM_UI, { answers: [], cancelled: true, error: "no_custom_ui" });
}

export function buildItemsForQuestion(question: QuestionData): WrappingSelectItem[] {
	const items: WrappingSelectItem[] = question.options.map((o) => ({
		kind: "option",
		label: o.label,
		description: o.description,
	}));
	for (const kind of sentinelsToAppend(question)) {
		items.push({ kind, label: displayLabel(kind) });
	}
	return items;
}

export const DEFAULT_PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;
export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
	`Offer materially distinct, viable choices within ${MIN_OPTIONS}-${MAX_OPTIONS} options. The maximum is capacity, not a target. Each choice needs a concise label and a description of its consequences. Users can choose the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Keep reserved labels out of authored options.`,
	"Proceed with settled implementation choices and record the reason. Ask explicitly when consent, approval or a genuine preference is needed. Keep the question and consequences self-contained inside the dialog.",
	"Use optional setAside only for alternatives actually considered and rejected, with a label and reason. Omit it when none matter. A viable alternative belongs in options, never in setAside to fit the capacity. The tool presents choices; it does not invent or shortlist them.",
	`Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. The "Type something." row is appended to every question; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column. If you recommend a specific option, make that the first option and append "${RECOMMENDED_MARKER}" to its label; the marker does not count toward the ${MAX_LABEL_LENGTH}-character label limit.`,
	"Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export const DEFAULT_TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Offer ${MIN_OPTIONS}-${MAX_OPTIONS} materially distinct viable choices. The maximum is capacity, not a target; oversized requests are rejected rather than truncated.
- Keep the question and trade-offs self-contained. Optional \`setAside\` carries only alternatives actually rejected and their reasons, never viable choices omitted for space.
- Settled implementation choices need a recorded reason, not a manufactured fork. Consent and approval still require an explicit question.
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid. The "Type something." row is available on every question, including when options carry a \`preview\`; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column.
- If you recommend a specific option, make that the first option in the list and add "${RECOMMENDED_MARKER}" at the end of the label. The marker does not count toward the ${MAX_LABEL_LENGTH}-character label limit.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

export function createAskUserQuestionToolDefinition(options: AskUserQuestionToolOptions): ToolDefinition {
	const guidance = loadConfig(options.agentDir).guidance ?? {};
	const emit: Emit = (channel, data) => options.eventBus?.emit(channel, data);
	return {
		name: ASK_USER_QUESTION_TOOL_NAME,
		label: "Ask User Question",
		description: guidance.description ?? DEFAULT_TOOL_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Line-terminator normalization runs once here, ahead of validation, so every
			// downstream consumer (validator, TUI, RPC walker, envelope, prompt event)
			// sees the same clean text.
			const typed = normalizeQuestionParams(params as unknown as QuestionParams);
			if (!ctx.hasUI) return rejectWithoutUi();

			const validation = validateQuestionnaire(typed);
			if (!validation.ok) {
				return buildToolResult(validation.message, {
					answers: [],
					cancelled: true,
					error: validation.error,
				});
			}

			emitAskUserPromptEvent(emit, typed);

			// RPC hosts (VS Code pendant, ACP clients like Zed and Paseo) cannot render
			// ui.custom(), but the select/input dialog sub-protocol works there.
			if (ctx.mode === "rpc" && hasDialogUI(ctx.ui)) {
				return runRpcPath(emit, ctx.ui, typed);
			}

			const itemsByTab: WrappingSelectItem[][] = typed.questions.map((q) => buildItemsForQuestion(q));
			const sessionRef: SessionRef = { current: null };
			const overlayHandleRef: OverlayHandleRef = { current: undefined };
			const removeListenerRef: { current: (() => void) | undefined } = { current: undefined };

			emitAskUserBlockedEvent(emit, true);
			try {
				emitTerminalAttention();
				const result = await ctx.ui.custom<QuestionnaireResult>(
					makeSessionFactory({
						ctx,
						typed,
						itemsByTab,
						sessionRef,
						overlayHandleRef,
						removeListenerRef,
						getExternalEditorCommand: options.getExternalEditorCommand,
					}),
					{
						overlay: true,
						overlayOptions: {
							anchor: "bottom-center",
							width: "100%",
							maxHeight: "100%",
							margin: { left: 0, right: 0, bottom: 0 },
						},
						onHandle: (handle) => {
							overlayHandleRef.current = handle;
							sessionRef.current?.setOverlayHandle(handle);
						},
					},
				);

				if (result === undefined) {
					return resolveUndefinedResult(ctx, typed);
				}

				return buildQuestionnaireResponse(result, typed);
			} finally {
				removeListenerRef.current?.();
				emitAskUserBlockedEvent(emit, false);
			}
		},
	};
}

export { buildQuestionnaireResponse, buildToolResult };
