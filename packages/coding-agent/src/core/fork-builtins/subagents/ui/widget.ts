/**
 * Fork-owned: the `agents` widget above the editor (plan T10). pi-subagents `src/ui/agent-widget.ts`
 * at 79a7c42 is the behavior reference. The factory shows it in `tui` mode only (P7).
 *
 * The widget lists the session's own agents under a `● Agents` heading: a running agent takes two
 * lines, a finished one line, and queued agents share one summary line. At most 12 lines show; past
 * that, running rows come first, then the queued summary, then finished rows, and a footer counts
 * exactly the agents it hid. A completed agent lingers one parent turn and any other outcome two; a
 * parent turn is the parent's `tool_execution_start`. `widgetMode`, `showModel` and `showCost` are
 * read when rendering. An 80 ms timer redraws the spinner only while an agent runs. One frame reads
 * `list()` once and touches no file.
 */
import { type Component, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "../../../extensions/types.ts";
import type { SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import { displayTokens } from "../usage.ts";
import { type BadgeTheme, renderAgentName } from "./colors.ts";
import {
	activeTools,
	describeActivity,
	type FormatTheme,
	fgPreservingNestedStyles,
	formatCost,
	formatMs,
	formatSessionTokens,
	formatTurns,
	invocationTags,
	promptModeLabel,
	responseText,
	SPINNER,
} from "./format.ts";

const WIDGET_KEY = "agents";
/** The most lines the widget takes, heading and footer included. */
const MAX_WIDGET_LINES = 12;
/** How often the spinner advances while an agent runs. */
const FRAME_MS = 80;
/** Parent turns a completed agent stays visible; every other outcome stays for `ERROR_LINGER_TURNS`. */
const COMPLETED_LINGER_TURNS = 1;
const ERROR_LINGER_TURNS = 2;

/** What the widget reads from the service. */
export type WidgetSource = Pick<
	SubagentService,
	"list" | "settings" | "contextPercent" | "conversation" | "subscribe" | "isDisposed"
>;

type WidgetTheme = FormatTheme & BadgeTheme;

function isFinished(view: SubagentView): boolean {
	return view.status !== "running" && view.status !== "queued" && view.completedAt !== undefined;
}

export class AgentWidget {
	private readonly source: WidgetSource;
	private readonly ui: Pick<ExtensionUIContext, "setWidget">;
	/** Parent turns each finished agent has stayed visible, by agent id. */
	private readonly finishedAge = new Map<string, number>();
	private readonly unsubscribe: () => void;
	private registered = false;
	private tui?: TUI;
	private timer?: ReturnType<typeof setInterval>;
	private pending = false;
	private disposed = false;

	constructor(source: WidgetSource, ui: Pick<ExtensionUIContext, "setWidget">) {
		this.source = source;
		this.ui = ui;
		this.unsubscribe = source.subscribe((event) => {
			// Every run's end starts its linger, so a resumed agent's completion line shows again.
			if (event.type === "ended") this.finishedAge.set(event.record.id, 0);
			this.schedule();
		});
		this.update();
	}

	/** The parent started a tool: every finished agent ages one turn. */
	onParentTurn(): void {
		for (const view of this.source.list()) {
			if (isFinished(view) && !this.finishedAge.has(view.id)) this.finishedAge.set(view.id, 0);
		}
		for (const [id, age] of this.finishedAge) this.finishedAge.set(id, age + 1);
		this.update();
	}

	/** Removes the widget and its timer; the widget draws nothing afterwards. */
	dispose(): void {
		if (this.disposed) return;
		const registered = this.registered;
		this.release();
		if (registered) this.ui.setWidget(WIDGET_KEY, undefined);
	}

	/** Stops the timer and the listener, touching no UI context. */
	private release(): void {
		this.disposed = true;
		this.unsubscribe();
		this.stopTimer();
		this.registered = false;
		this.tui = undefined;
	}

	private schedule(): void {
		if (this.pending) return;
		this.pending = true;
		queueMicrotask(() => {
			this.pending = false;
			this.update();
		});
	}

	/** The agents `widgetMode` lets through; nested agents never show. */
	private visible(views: readonly SubagentView[]): SubagentView[] {
		const mode = this.source.settings.widgetMode;
		if (mode === "off") return [];
		return views
			.filter((view) => view.parentId === undefined && (mode === "all" || view.mode !== "foreground"))
			.reverse();
	}

	private lingers(view: SubagentView): boolean {
		const limit = view.status === "completed" ? COMPLETED_LINGER_TURNS : ERROR_LINGER_TURNS;
		return (this.finishedAge.get(view.id) ?? 0) < limit;
	}

	private update(): void {
		if (this.disposed) return;
		// A directly disposed session emits no `session_shutdown`, and its context is already invalidated.
		if (this.source.isDisposed) {
			this.release();
			return;
		}
		const views = this.visible(this.source.list());
		const running = views.some((view) => view.status === "running");
		const shown =
			running || views.some((view) => view.status === "queued" || (isFinished(view) && this.lingers(view)));
		if (running) this.startTimer();
		else this.stopTimer();
		if (!shown) {
			if (this.registered) this.ui.setWidget(WIDGET_KEY, undefined);
			this.registered = false;
			this.tui = undefined;
			return;
		}
		if (this.registered) {
			this.tui?.requestRender();
			return;
		}
		this.registered = true;
		this.ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				this.tui = tui;
				return { render: (width: number) => this.render(width, theme), invalidate: () => {} } satisfies Component;
			},
			{ placement: "aboveEditor" },
		);
	}

	private startTimer(): void {
		if (this.timer) return;
		this.timer = setInterval(() => this.tui?.requestRender(), FRAME_MS);
		this.timer.unref?.();
	}

	private stopTimer(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	private runningLines(view: SubagentView, theme: WidgetTheme, frame: string, showModel: boolean, showCost: boolean) {
		const parts: string[] = [];
		if (showModel) {
			// Paired: a thinking level means nothing without the model it applies to.
			const { modelName, tags } = invocationTags(view);
			if (modelName) parts.push(modelName);
			const thinking = tags.find((tag) => tag.startsWith("thinking: "));
			if (thinking) parts.push(thinking);
		}
		if (view.turns > 0) parts.push(formatTurns(view.turns, view.maxTurns));
		if (view.toolUses > 0) parts.push(`${view.toolUses} tool use${view.toolUses === 1 ? "" : "s"}`);
		const tokens = displayTokens(view.usage);
		if (tokens > 0) {
			parts.push(formatSessionTokens(tokens, this.source.contextPercent(view.id), theme, view.compactionCount));
		}
		const cost = showCost ? formatCost(view.usage.cost.total) : "";
		if (cost) parts.push(cost);
		parts.push(formatMs(Math.max(0, Date.now() - view.startedAt)));
		const activity = describeActivity(
			activeTools(view),
			responseText(this.source.conversation(view.id)?.messages ?? []),
		);
		return [
			`${theme.fg("dim", "├─")} ${theme.fg("accent", frame)} ${renderAgentName(view.definition, theme, { bold: true })}${modeTag(view, theme)}  ${theme.fg("muted", view.description)} ${theme.fg("dim", "·")} ${fgPreservingNestedStyles(theme, "dim", parts.join(" · "))}`,
			`${theme.fg("dim", "│  ")}${theme.fg("dim", `  ⎿  ${activity}`)}`,
		];
	}

	private finishedLine(view: SubagentView, theme: WidgetTheme, showCost: boolean): string {
		let icon: string;
		let outcome: string;
		switch (view.status) {
			case "completed":
				icon = theme.fg("success", "✓");
				outcome = "";
				break;
			case "steered":
				icon = theme.fg("warning", "✓");
				outcome = theme.fg("warning", " (turn limit)");
				break;
			case "stopped":
				icon = theme.fg("dim", "■");
				outcome = theme.fg("dim", " stopped");
				break;
			case "error":
				icon = theme.fg("error", "✗");
				outcome = theme.fg("error", ` error${view.error ? `: ${view.error.slice(0, 60)}` : ""}`);
				break;
			default:
				icon = theme.fg("error", "✗");
				outcome = theme.fg("warning", " aborted");
		}
		const parts: string[] = [];
		if (view.turns > 0) parts.push(formatTurns(view.turns, view.maxTurns));
		if (view.toolUses > 0) parts.push(`${view.toolUses} tool use${view.toolUses === 1 ? "" : "s"}`);
		const cost = showCost ? formatCost(view.usage.cost.total) : "";
		if (cost) parts.push(cost);
		parts.push(formatMs((view.completedAt ?? Date.now()) - view.startedAt));
		return `${theme.fg("dim", "├─")} ${icon} ${renderAgentName(view.definition, theme, { fallbackColor: "dim" })}${modeTag(view, theme)}  ${theme.fg("dim", view.description)} ${theme.fg("dim", "·")} ${theme.fg("dim", parts.join(" · "))}${outcome}`;
	}

	/** One frame: reads `list()` once, and the settings, and nothing from disk. */
	private render(width: number, theme: WidgetTheme): string[] {
		const views = this.visible(this.source.list());
		const running = views.filter((view) => view.status === "running");
		const queued = views.filter((view) => view.status === "queued");
		const finished = views.filter((view) => isFinished(view) && this.lingers(view));
		if (running.length + queued.length + finished.length === 0) return [];

		const { showModel, showCost } = this.source.settings;
		const frame = SPINNER[Math.floor(Date.now() / FRAME_MS) % SPINNER.length];
		const active = running.length > 0 || queued.length > 0;
		const headingColor = active ? "accent" : "dim";
		const heading = `${theme.fg(headingColor, active ? "●" : "○")} ${theme.fg(headingColor, "Agents")}`;
		const runningPairs = running.map((view) => this.runningLines(view, theme, frame, showModel, showCost));
		const finishedLines = finished.map((view) => this.finishedLine(view, theme, showCost));
		const queuedLine =
			queued.length > 0
				? `${theme.fg("dim", "├─")} ${theme.fg("muted", "◦")} ${theme.fg("dim", `${queued.length} queued`)}`
				: undefined;

		const lines = [heading];
		const bodyLimit = MAX_WIDGET_LINES - 1;
		if (finishedLines.length + runningPairs.length * 2 + (queuedLine ? 1 : 0) <= bodyLimit) {
			lines.push(...finishedLines);
			for (const pair of runningPairs) lines.push(...pair);
			if (queuedLine) lines.push(queuedLine);
			// The last item closes the tree; a running pair closes both of its lines.
			const last = lines.length - 1;
			lines[last] = lines[last].replace("├─", "└─");
			if (runningPairs.length > 0 && !queuedLine) {
				lines[last - 1] = lines[last - 1].replace("├─", "└─");
				lines[last] = lines[last].replace("│  ", "   ");
			}
		} else {
			// The footer takes a line, and the queued summary keeps its own: it stands for agents with no row.
			let budget = bodyLimit - 1 - (queuedLine ? 1 : 0);
			let hiddenRunning = 0;
			let hiddenFinished = 0;
			for (const pair of runningPairs) {
				if (budget >= 2) {
					lines.push(...pair);
					budget -= 2;
				} else hiddenRunning++;
			}
			if (queuedLine) lines.push(queuedLine);
			for (const line of finishedLines) {
				if (budget >= 1) {
					lines.push(line);
					budget--;
				} else hiddenFinished++;
			}
			const hidden = [
				hiddenRunning > 0 ? `${hiddenRunning} running` : "",
				hiddenFinished > 0 ? `${hiddenFinished} finished` : "",
			].filter(Boolean);
			lines.push(
				`${theme.fg("dim", "└─")} ${theme.fg("dim", `+${hiddenRunning + hiddenFinished} more (${hidden.join(", ")})`)}`,
			);
		}
		return lines.map((line) => truncateToWidth(line, width));
	}
}

function modeTag(view: SubagentView, theme: FormatTheme): string {
	const label = promptModeLabel(view);
	return label ? ` ${theme.fg("dim", `(${label})`)}` : "";
}
