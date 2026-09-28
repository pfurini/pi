/**
 * Fork-owned: the conversation viewer (plan T11). pi-subagents `src/ui/conversation-viewer.ts` at
 * 79a7c42 is the behavior reference. It opens as an overlay through `ctx.ui.custom` and shows one
 * agent: a header with its status, name, stats and invocation, its child's conversation, and a
 * footer with the keys that apply.
 *
 * The body reads `service.conversation(id)` at every render and renders again on each child
 * message. Each message keeps one `Markdown` component, so a frame reuses its parse. Tool results
 * and bash output are capped at 16,000 characters, with the notice outside any code fence.
 *
 * Keys come from the keybinding manager `ctx.ui.custom` passes (P15): `tui.select.*` scroll,
 * confirm and close; `app.subagents.*` stop (two presses), cycle the Markdown mode, and jump to the
 * top or bottom. The Markdown mode holds for the rest of the session (P16). Stop and steer go to the
 * service, and both disappear once the agent stops running; a failed steer shows its error.
 */
import {
	type Component,
	Input,
	type Keybinding,
	type KeybindingsManager,
	Markdown,
	type MarkdownOptions,
	type MarkdownTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { formatKeyText } from "../../../../modes/interactive/components/keybinding-hints.ts";
import { getMarkdownTheme } from "../../../../modes/interactive/theme/theme.ts";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import type { SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import type { ViewerMarkdownMode } from "../settings/settings.ts";
import { displayTokens } from "../usage.ts";
import { type BadgeTheme, renderAgentName } from "./colors.ts";
import {
	activeTools,
	describeActivity,
	displayText,
	type FormatTheme,
	fgPreservingNestedStyles,
	formatCost,
	formatMs,
	formatSessionTokens,
	invocationTags,
	promptModeLabel,
	responseText,
} from "./format.ts";
import { SUBAGENT_KEYBINDING_IDS } from "./keybindings.ts";

/** Rows the frame takes: top border, header, header rule, footer rule, footer and bottom border. */
const CHROME_LINES = 6;
const MIN_VIEWPORT = 3;
/** The overlay's height, and the viewer's own viewport cap, in percent of the terminal. */
const VIEWPORT_HEIGHT_PCT = 70;

/**
 * The most characters of one tool result or bash output the viewer shows. The cap bounds render
 * cost: every frame and every scroll key rebuilds the content.
 */
export const RESULT_MAX_CHARS = 16_000;

const MARKDOWN_MODES: readonly ViewerMarkdownMode[] = ["off", "assistant", "all"];
/** Short, because the idle footer is already full at 80 columns. */
const MARKDOWN_MODE_LABELS: Record<ViewerMarkdownMode, string> = { off: "raw", assistant: "md", all: "md+" };

/** Keep the renderer from rewriting source that only looks like Markdown: list numbers and escapes. */
const MARKDOWN_OPTIONS: MarkdownOptions = { preserveOrderedListMarkers: true, preserveBackslashEscapes: true };

/** Hint labels for keys whose own name reads poorly in a footer. */
const KEY_LABELS: Record<string, string> = {
	escape: "Esc",
	enter: "Enter",
	up: "↑",
	down: "↓",
	left: "←",
	right: "→",
	pageUp: "PgUp",
	pageDown: "PgDn",
	home: "Home",
	end: "End",
};

/** The first key bound to `id`, as a hint names it: `Esc`, `↓`, `x`. */
export function keyLabel(keybindings: Pick<KeybindingsManager, "getKeys">, id: Keybinding): string {
	const key = keybindings.getKeys(id)[0];
	return key === undefined ? "?" : (KEY_LABELS[key] ?? formatKeyText(key));
}

/** What the viewer reads from the service and asks it to do. */
export type ViewerSource = Pick<
	SubagentService,
	"conversation" | "contextPercent" | "settings" | "subscribe" | "steer" | "stop"
>;

/** What the viewer needs from Pi's theme. */
export type ViewerTheme = FormatTheme & BadgeTheme;

/** The keybinding manager `ctx.ui.custom` passes; the viewer only matches keys and names them. */
export type ViewerKeybindings = Pick<KeybindingsManager, "matches" | "getKeys">;

/** Viewer state that outlives one overlay: the Markdown mode chosen with its key, for the session (P16). */
export interface ViewerSessionState {
	markdownMode?: ViewerMarkdownMode;
}

export interface ConversationViewerOptions {
	tui: Pick<TUI, "requestRender" | "terminal">;
	theme: ViewerTheme;
	keybindings: ViewerKeybindings;
	source: ViewerSource;
	view: SubagentView;
	state: ViewerSessionState;
	done: () => void;
}

type ContentPart = { type?: string; text?: string; name?: string };
type ViewerMessage = { role: string; content?: unknown; command?: string; output?: string };

/** A message's text, safe to print: the child's output keeps no escape sequence (T18-F4). */
function textOf(content: unknown): string {
	if (typeof content === "string") return displayText(content);
	if (!Array.isArray(content)) return "";
	return displayText(
		(content as ContentPart[])
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n"),
	);
}

/**
 * Pi's Markdown theme when the process has one, else one built from the viewer's theme. Pi's theme
 * reads a global lazily, so an uninitialized one throws inside a later render; the probe finds out now.
 */
function resolveMarkdownTheme(theme: ViewerTheme): MarkdownTheme {
	try {
		const piTheme = getMarkdownTheme();
		piTheme.heading("probe");
		return piTheme;
	} catch {
		const sgr = (on: number, off: number) => (text: string) => `\x1b[${on}m${text}\x1b[${off}m`;
		return {
			heading: (text) => theme.bold(theme.fg("accent", text)),
			link: (text) => theme.fg("accent", text),
			linkUrl: (text) => theme.fg("muted", text),
			code: (text) => theme.fg("muted", text),
			codeBlock: (text) => theme.fg("muted", text),
			codeBlockBorder: (text) => theme.fg("dim", text),
			quote: (text) => theme.fg("muted", text),
			quoteBorder: (text) => theme.fg("dim", text),
			hr: (text) => theme.fg("dim", text),
			listBullet: (text) => theme.fg("accent", text),
			bold: (text) => theme.bold(text),
			italic: sgr(3, 23),
			underline: sgr(4, 24),
			strikethrough: sgr(9, 29),
		};
	}
}

/** The first `RESULT_MAX_CHARS` of `text`, with the count left out; the notice is the viewer's, not the tool's. */
function capResult(text: string): { text: string; elided: number } {
	if (text.length <= RESULT_MAX_CHARS) return { text, elided: 0 };
	return { text: text.slice(0, RESULT_MAX_CHARS), elided: text.length - RESULT_MAX_CHARS };
}

/** `999`, `1.5k`, `8.4M`; the bracket is chosen on the rounded value, so 999,999 reads `1M`. */
function humanCount(count: number): string {
	if (count < 1_000) return `${count}`;
	const thousands = count < 999_950;
	const value = thousands ? count / 1_000 : count / 1_000_000;
	return `${value.toFixed(1).replace(/\.0$/, "")}${thousands ? "k" : "M"}`;
}

function truncationNote(elided: number): string {
	return `... (truncated, ${humanCount(elided)} more character${elided === 1 ? "" : "s"})`;
}

export class ConversationViewer implements Component {
	private readonly tui: ConversationViewerOptions["tui"];
	private readonly theme: ViewerTheme;
	private readonly keybindings: ViewerKeybindings;
	private readonly source: ViewerSource;
	private readonly view: SubagentView;
	private readonly state: ViewerSessionState;
	private readonly done: () => void;
	private readonly markdownTheme: MarkdownTheme;
	/** One `Markdown` per message, so its own cache serves every frame; weak, so a compacted message frees it. */
	private readonly markdownCache = new WeakMap<object, { md: Markdown; text: string; failed?: boolean }>();
	private readonly unsubscribeService: () => void;
	private unsubscribeConversation?: () => void;
	private scrollOffset = 0;
	private autoScroll = true;
	private lastInnerWidth = 0;
	private closed = false;
	/** The first stop press arms; the second stops. Any other key disarms. */
	private stopArmed = false;
	/** The steer composer, while the user types a message to the agent. */
	private composer?: Input;
	/** The last steer's failure, shown until the next key. */
	private steerError?: string;

	constructor(options: ConversationViewerOptions) {
		this.tui = options.tui;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.source = options.source;
		this.view = options.view;
		this.state = options.state;
		this.done = options.done;
		this.markdownTheme = resolveMarkdownTheme(options.theme);
		this.unsubscribeService = options.source.subscribe((event) => {
			if (this.closed || !("record" in event) || event.record.id !== this.view.id) return;
			// A queued agent's conversation exists once its child attaches.
			this.followConversation();
			// A confirmation and a draft belong to one run: a resumed run needs both presses again, and a
			// stopped agent takes no steer (T18-F5).
			if (!this.isActive()) {
				this.stopArmed = false;
				this.composer = undefined;
			}
			this.tui.requestRender();
		});
		this.followConversation();
	}

	private followConversation(): void {
		if (this.unsubscribeConversation) return;
		this.unsubscribeConversation = this.source.conversation(this.view.id)?.subscribe(() => {
			if (!this.closed) this.tui.requestRender();
		});
	}

	private matches(data: string, id: Keybinding): boolean {
		return this.keybindings.matches(data, id);
	}

	handleInput(data: string): void {
		// The composer owns every key while it is open: confirm sends, cancel returns.
		if (this.composer) {
			this.composer.handleInput(data);
			this.tui.requestRender();
			return;
		}
		this.steerError = undefined;

		if (this.matches(data, "tui.select.cancel")) {
			this.close();
			return;
		}
		if (this.matches(data, "tui.select.confirm") && this.isActive()) {
			this.stopArmed = false;
			this.openComposer();
			return;
		}
		if (this.matches(data, SUBAGENT_KEYBINDING_IDS.stop)) {
			if (this.isActive()) {
				if (this.stopArmed) {
					this.stopArmed = false;
					this.source.stop(this.view.id);
				} else this.stopArmed = true;
				this.tui.requestRender();
			}
			return;
		}
		this.stopArmed = false;
		if (this.matches(data, SUBAGENT_KEYBINDING_IDS.markdownMode)) {
			const mode = this.markdownMode();
			this.state.markdownMode = MARKDOWN_MODES[(MARKDOWN_MODES.indexOf(mode) + 1) % MARKDOWN_MODES.length];
			this.tui.requestRender();
			return;
		}

		const viewport = this.viewportHeight();
		const maxScroll = Math.max(0, this.buildContentLines(this.lastInnerWidth).length - viewport);
		if (this.matches(data, "tui.select.up")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.matches(data, "tui.select.down")) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.matches(data, "tui.select.pageUp")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - viewport);
			this.autoScroll = false;
		} else if (this.matches(data, "tui.select.pageDown")) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewport);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.matches(data, SUBAGENT_KEYBINDING_IDS.top)) {
			this.scrollOffset = 0;
			this.autoScroll = false;
		} else if (this.matches(data, SUBAGENT_KEYBINDING_IDS.bottom)) {
			this.scrollOffset = maxScroll;
			this.autoScroll = true;
		} else return;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		// Too narrow for a frame.
		if (width < 6) return [];
		const theme = this.theme;
		const innerWidth = width - 4;
		this.lastInnerWidth = innerWidth;
		const row = (content: string) => {
			const padded = content + " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
			return `${theme.fg("border", "│")} ${truncateToWidth(padded, innerWidth, "...", true)} ${theme.fg("border", "│")}`;
		};
		const rule = row(theme.fg("dim", "─".repeat(innerWidth)));
		const lines = [theme.fg("border", `╭${"─".repeat(width - 2)}╮`), row(this.header())];
		const invocation = this.invocationLine();
		if (invocation) lines.push(row(invocation));
		lines.push(rule);

		const content = this.buildContentLines(innerWidth);
		const viewport = this.viewportHeight();
		const maxScroll = Math.max(0, content.length - viewport);
		if (this.autoScroll) this.scrollOffset = maxScroll;
		const start = Math.min(this.scrollOffset, maxScroll);
		const visible = content.slice(start, start + viewport);
		for (let index = 0; index < viewport; index++) lines.push(row(visible[index] ?? ""));

		lines.push(rule);
		if (this.steerError) lines.push(row(theme.fg("error", this.steerError)));
		if (this.composer) {
			lines.push(row(this.composer.render(innerWidth)[0] ?? ""));
			const left = theme.fg("accent", "✎ steer");
			const hint = theme.fg(
				"dim",
				`${this.keyLabel("tui.select.confirm")} send · ${this.keyLabel("tui.select.cancel")} cancel`,
			);
			lines.push(row(left + " ".repeat(Math.max(1, innerWidth - visibleWidth(left) - visibleWidth(hint))) + hint));
		} else {
			lines.push(row(this.footer(content.length, start, viewport, innerWidth)));
		}
		lines.push(theme.fg("border", `╰${"─".repeat(width - 2)}╯`));
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.closed = true;
		this.unsubscribeService();
		this.unsubscribeConversation?.();
		this.unsubscribeConversation = undefined;
	}

	private close(): void {
		this.dispose();
		this.done();
	}

	private keyLabel(id: Keybinding): string {
		return keyLabel(this.keybindings, id);
	}

	/** Stop and steer apply only while the agent runs or waits. */
	private isActive(): boolean {
		return this.view.status === "running" || this.view.status === "queued";
	}

	private markdownMode(): ViewerMarkdownMode {
		return this.state.markdownMode ?? this.source.settings.viewerMarkdown;
	}

	private header(): string {
		const theme = this.theme;
		const view = this.view;
		const icon =
			view.status === "running"
				? theme.fg("accent", "●")
				: view.status === "completed"
					? theme.fg("success", "✓")
					: view.status === "error"
						? theme.fg("error", "✗")
						: theme.fg("dim", "○");
		const parts: string[] = [];
		if (view.toolUses > 0) parts.push(`${view.toolUses} tool${view.toolUses === 1 ? "" : "s"}`);
		parts.push(
			view.completedAt === undefined
				? `${formatMs(Math.max(0, Date.now() - view.startedAt))} (running)`
				: formatMs(view.completedAt - view.startedAt),
		);
		const tokens = displayTokens(view.usage);
		if (tokens > 0) {
			parts.push(formatSessionTokens(tokens, this.source.contextPercent(view.id), theme, view.compactionCount));
		}
		const cost = this.source.settings.showCost ? formatCost(view.usage.cost.total) : "";
		if (cost) parts.push(cost);
		const mode = promptModeLabel(view);
		const modeTag = mode ? ` ${theme.fg("dim", `(${mode})`)}` : "";
		return `${icon} ${renderAgentName(view.definition, theme, { bold: true })}${modeTag}  ${theme.fg("muted", view.description)} ${theme.fg("dim", "·")} ${fgPreservingNestedStyles(theme, "dim", parts.join(" · "))}`;
	}

	/** `↳ provider/model · tags`: the canonical id here, because the overlay inspects one agent and has the width. */
	private invocationLine(): string | undefined {
		const { modelName, modelId, tags } = invocationTags(this.view);
		const model = modelId ?? modelName;
		const parts = model ? [model, ...tags] : tags;
		return parts.length === 0 ? undefined : this.theme.fg("dim", `  ↳ ${parts.join(" · ")}`);
	}

	private footer(total: number, start: number, viewport: number, innerWidth: number): string {
		const theme = this.theme;
		const separator = theme.fg("dim", " · ");
		const actions: string[] = [];
		if (this.isActive()) {
			actions.push(theme.fg("dim", `${this.keyLabel("tui.select.confirm")} steer`));
			const stop = this.keyLabel(SUBAGENT_KEYBINDING_IDS.stop);
			actions.push(this.stopArmed ? theme.fg("error", `${stop} again to STOP`) : theme.fg("dim", `${stop} stop`));
		}
		actions.push(
			theme.fg(
				"dim",
				`${this.keyLabel(SUBAGENT_KEYBINDING_IDS.markdownMode)} ${MARKDOWN_MODE_LABELS[this.markdownMode()]}`,
			),
		);
		const right = theme.fg(
			"dim",
			`${this.keyLabel("tui.select.up")}${this.keyLabel("tui.select.down")} scroll · ${this.keyLabel("tui.select.pageUp")}/${this.keyLabel("tui.select.pageDown")} · ${this.keyLabel("tui.select.cancel")} close`,
		);
		// The line count goes first when the width runs out, so it never crowds out a key hint.
		const percent = total <= viewport ? "100%" : `${Math.round(((start + viewport) / total) * 100)}%`;
		const withCount = [theme.fg("dim", `${total} lines · ${percent}`), ...actions].join(separator);
		const left =
			visibleWidth(withCount) + visibleWidth(right) + 1 <= innerWidth ? withCount : actions.join(separator);
		return left + " ".repeat(Math.max(1, innerWidth - visibleWidth(left) - visibleWidth(right))) + right;
	}

	private viewportHeight(): number {
		// Mirrors the overlay's height, so the viewer never renders past the frame and clips its footer.
		const rows = Math.floor((this.tui.terminal.rows * VIEWPORT_HEIGHT_PCT) / 100);
		const chrome =
			CHROME_LINES + (this.invocationLine() ? 1 : 0) + (this.composer ? 1 : 0) + (this.steerError ? 1 : 0);
		return Math.max(MIN_VIEWPORT, rows - chrome);
	}

	private openComposer(): void {
		const input = new Input();
		input.focused = true;
		input.onSubmit = (value) => {
			const message = value.trim();
			this.composer = undefined;
			if (message) this.steer(message);
			this.tui.requestRender();
		};
		input.onEscape = () => {
			this.composer = undefined;
			this.tui.requestRender();
		};
		this.composer = input;
		this.tui.requestRender();
	}

	private steer(message: string): void {
		void this.source.steer(this.view.id, message).then((outcome) => {
			if (this.closed) return;
			if (outcome.kind === "failed") this.steerError = `Failed to steer agent: ${displayText(outcome.error)}`;
			else if (outcome.kind === "refused") this.steerError = `Could not steer agent: ${outcome.reason}`;
			else return;
			this.tui.requestRender();
		});
	}

	private rawLines(text: string, width: number, dim: boolean): string[] {
		const lines = wrapTextWithAnsi(text, width);
		return dim ? lines.map((line) => this.theme.fg("dim", line)) : lines;
	}

	/** `text` as Markdown through this message's cached component; literal once the parser has thrown on it. */
	private markdownLines(message: object, text: string, width: number, dim: boolean): string[] {
		let entry = this.markdownCache.get(message);
		if (!entry) {
			entry = {
				md: new Markdown(
					text,
					0,
					0,
					this.markdownTheme,
					dim ? { color: (value: string) => this.theme.fg("dim", value) } : undefined,
					MARKDOWN_OPTIONS,
				),
				text,
			};
			this.markdownCache.set(message, entry);
		} else if (entry.text !== text) {
			// A streamed message grows; an unsafe prefix stays unsafe, so only replaced text retries.
			const retry = !text.startsWith(entry.text);
			entry.md.setText(text);
			entry.text = text;
			if (retry) entry.failed = false;
		}
		if (entry.failed) return this.rawLines(text, width, dim);
		try {
			return entry.md.render(width);
		} catch {
			// The recursive parser overflows on deep nesting in arbitrary tool output; a frame must not throw.
			entry.failed = true;
			return this.rawLines(text, width, dim);
		}
	}

	private buildContentLines(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.theme;
		const messages = this.source.conversation(this.view.id)?.messages ?? [];
		if (messages.length === 0) return [theme.fg("dim", "(waiting for first message...)")];

		const mode = this.markdownMode();
		const lines: string[] = [];
		let separate = false;
		for (const entry of messages) {
			// Core messages and Pi's custom `bashExecution` message share these fields.
			const message = entry as unknown as ViewerMessage;
			const start = lines.length;
			if (separate) lines.push(theme.fg("dim", "───"));
			if (message.role === "user") {
				const text = textOf(message.content).trim();
				if (!text) {
					lines.length = start;
					continue;
				}
				lines.push(theme.fg("accent", "[User]"), ...wrapTextWithAnsi(text, width));
			} else if (message.role === "assistant") {
				const parts = (message.content ?? []) as ContentPart[];
				const text = textOf(parts).trim();
				lines.push(theme.bold("[Assistant]"));
				if (text) {
					lines.push(
						...(mode === "off"
							? this.rawLines(text, width, false)
							: this.markdownLines(message, text, width, false)),
					);
				}
				for (const part of parts) {
					if (part.type === "toolCall")
						lines.push(theme.fg("muted", `  [Tool: ${displayText(part.name ?? "unknown")}]`));
				}
			} else if (message.role === "toolResult") {
				const { text, elided } = capResult(textOf(message.content).trim());
				if (!text) {
					lines.length = start;
					continue;
				}
				lines.push(theme.fg("dim", "[Result]"));
				lines.push(
					...(mode === "all" ? this.markdownLines(message, text, width, true) : this.rawLines(text, width, true)),
				);
				if (elided) lines.push(theme.fg("dim", truncationNote(elided)));
			} else if (message.role === "bashExecution") {
				lines.push(theme.fg("muted", `  $ ${displayText(message.command ?? "")}`));
				const output = message.output === undefined ? undefined : displayText(message.output).trim();
				if (output) {
					// Command output is never Markdown; it takes the same cap as a tool result.
					const { text, elided } = capResult(output);
					lines.push(...this.rawLines(text, width, true));
					if (elided) lines.push(theme.fg("dim", truncationNote(elided)));
				}
			} else {
				lines.length = start;
				continue;
			}
			separate = true;
		}

		if (this.view.status === "running") {
			const activity = describeActivity(activeTools(this.view), responseText(messages));
			lines.push("", `${theme.fg("accent", "▍ ")}${theme.fg("dim", activity)}`);
		}
		// The last guard: a wrap that returns an overwidth line must not break the frame.
		return lines.map((line) => truncateToWidth(line, width));
	}
}

/**
 * Opens the viewer for `view` as a centered overlay; resolves when it closes. `onOpen` receives a
 * handle that closes the overlay from outside, as quit does.
 */
export function openConversationViewer(
	ui: Pick<ExtensionUIContext, "custom">,
	source: ViewerSource,
	view: SubagentView,
	state: ViewerSessionState,
	onOpen?: (close: () => void) => void,
): Promise<void> {
	return ui.custom<void>(
		(tui, theme, keybindings, done) => {
			const viewer = new ConversationViewer({
				tui,
				theme,
				keybindings,
				source,
				view,
				state,
				done: () => done(undefined),
			});
			onOpen?.(() => {
				viewer.dispose();
				done(undefined);
			});
			return viewer;
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" } },
	);
}
