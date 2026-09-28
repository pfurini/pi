/**
 * Fork-owned: FleetView, the agent list below the editor (plan T12). pi-subagents
 * `src/ui/fleet-list.ts` at 79a7c42 is the behavior reference, without its workflow rows. The
 * factory shows it in `tui` mode only (P7).
 *
 * The `fleet` widget lists `main`, then the session's agents that have a session, oldest first: those
 * running or waiting, the one the viewer shows, and for 4 s those that finished. At most five agent
 * rows show, with `↑ N more` and `↓ N more`, and each row ends with its elapsed time, tokens and,
 * under `showCost`, cost. The widget shows only while `fleetView` is on and an agent has a session.
 *
 * All keys arrive through `onTerminalInput`, before the focused editor, and match through
 * `getKeybindings()` (P15). `tui.editor.cursorDown` or `tui.editor.cursorLeft` at an empty, focused
 * editor activates the list; `tui.select.*` then move, open the viewer and close. The list steals
 * no key while another component has focus. A 200 ms tick keeps the stats current while it shows.
 */
import {
	type Component,
	Editor,
	getKeybindings,
	isKeyRelease,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ExtensionUIContext, TerminalInputHandler } from "../../../extensions/types.ts";
import type { SubagentView } from "../service/records.ts";
import type { SubagentService } from "../service/service.ts";
import { displayTokens } from "../usage.ts";
import { type BadgeTheme, renderAgentName, resolveAgentColor } from "./colors.ts";
import { type FormatTheme, formatCost, formatFleetElapsed, formatFleetTokens } from "./format.ts";
import { keyLabel, openConversationViewer, type ViewerSessionState, type ViewerSource } from "./viewer.ts";

const FLEET_KEY = "fleet";
/** Agent rows shown at once; the rest collapse into `↑ N more` and `↓ N more`. */
const MAX_AGENT_ROWS = 5;
/** How often the stats refresh while the list shows. */
const TICK_MS = 200;
/** How long a finished agent stays in the list. */
const FINISHED_LINGER_MS = 4000;

/** What FleetView reads from the service, the viewer's needs included. */
export type FleetSource = ViewerSource & Pick<SubagentService, "list" | "isDisposed">;

/** What FleetView needs from the UI context. */
export type FleetUi = Pick<ExtensionUIContext, "setWidget" | "onTerminalInput" | "getEditorText" | "custom">;

type FleetTheme = FormatTheme & BadgeTheme;

type FocusReporter = { getFocusedComponent?(): Component | null };

/** `right` flush to `width`, cutting `left` first so the stats survive; never wider than `width`. */
function rightAlign(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	const clamped = truncateToWidth(left, Math.max(0, width - rightWidth - 1));
	const gap = Math.max(1, width - visibleWidth(clamped) - rightWidth);
	return truncateToWidth(clamped + " ".repeat(gap) + right, width);
}

export class FleetView {
	private readonly source: FleetSource;
	private readonly ui: FleetUi;
	private readonly state: ViewerSessionState;
	private readonly unsubscribeService: () => void;
	private readonly unsubscribeInput: () => void;
	private registered = false;
	private tui?: TUI;
	private timer?: ReturnType<typeof setInterval>;
	private disposed = false;
	/** Whether the arrow keys move through the list instead of reaching the editor. */
	private active = false;
	/** 0 is `main`; 1 to N are the agents. */
	private selected = 0;
	private viewingId?: string;
	private closeViewer?: () => void;

	constructor(source: FleetSource, ui: FleetUi, state: ViewerSessionState) {
		this.source = source;
		this.ui = ui;
		this.state = state;
		this.unsubscribeService = source.subscribe(() => this.update());
		const handler: TerminalInputHandler = (data) => this.handleKey(data);
		this.unsubscribeInput = ui.onTerminalInput(handler);
		this.update();
	}

	/** Removes the widget, the tick, the input handler and an open viewer. */
	dispose(): void {
		if (this.disposed) return;
		const registered = this.registered;
		this.release();
		this.closeViewer?.();
		this.closeViewer = undefined;
		if (registered) this.ui.setWidget(FLEET_KEY, undefined);
	}

	/** Stops the tick and every listener, touching no UI context. */
	private release(): void {
		this.disposed = true;
		this.unsubscribeService();
		this.unsubscribeInput();
		this.stopTimer();
		this.registered = false;
		this.tui = undefined;
		this.active = false;
	}

	private enabled(): boolean {
		return this.source.settings.fleetView;
	}

	/** The listed agents, oldest first. An agent without a session is hidden, so every row opens. */
	private agents(): SubagentView[] {
		const now = Date.now();
		return this.source
			.list()
			.filter(
				(view) =>
					view.parentId === undefined &&
					this.source.conversation(view.id) !== undefined &&
					(view.status === "running" ||
						view.status === "queued" ||
						view.id === this.viewingId ||
						(view.completedAt !== undefined && now - view.completedAt < FINISHED_LINGER_MS)),
			)
			.sort((a, b) => a.startedAt - b.startedAt);
	}

	private update(): void {
		if (this.disposed) return;
		// A directly disposed session emits no `session_shutdown`, and its context is already invalidated.
		if (this.source.isDisposed) {
			const closeViewer = this.closeViewer;
			this.closeViewer = undefined;
			this.release();
			closeViewer?.();
			return;
		}
		const count = this.enabled() ? this.agents().length : 0;
		if (count === 0) {
			if (this.registered) this.ui.setWidget(FLEET_KEY, undefined);
			this.registered = false;
			this.tui = undefined;
			this.stopTimer();
			this.active = false;
			this.selected = 0;
			return;
		}
		this.selected = Math.min(this.selected, count);
		if (!this.timer) {
			this.timer = setInterval(() => this.update(), TICK_MS);
			this.timer.unref?.();
		}
		if (this.registered) {
			this.tui?.requestRender();
			return;
		}
		this.registered = true;
		this.ui.setWidget(
			FLEET_KEY,
			(tui, theme) => {
				this.tui = tui;
				return { render: (width: number) => this.render(width, theme), invalidate: () => {} };
			},
			{ placement: "belowEditor" },
		);
	}

	private stopTimer(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	/**
	 * Whether the prompt editor owns the keyboard. Pi's editor extends `Editor` and no dialog does;
	 * before the first render the list has seen no TUI, and an unknown focus counts as the editor.
	 * The `TUI` interface omits `getFocusedComponent()`, which pi-tui's implementation makes public.
	 */
	private editorHasFocus(): boolean {
		const focused = (this.tui as (TUI & FocusReporter) | undefined)?.getFocusedComponent?.();
		return focused == null || focused instanceof Editor;
	}

	/** Consumes a key the list handles; any other key reaches the editor. */
	private handleKey(data: string): { consume: true } | undefined {
		if (this.disposed || !this.enabled() || isKeyRelease(data)) return undefined;
		// The viewer owns every key while it is open; the list resumes at the viewed agent afterwards.
		if (this.viewingId !== undefined) return undefined;
		if (!this.editorHasFocus()) {
			if (this.active) this.deactivate();
			return undefined;
		}
		const keybindings = getKeybindings();
		if (!this.active) {
			const activator =
				keybindings.matches(data, "tui.editor.cursorDown") || keybindings.matches(data, "tui.editor.cursorLeft");
			if (!activator || this.ui.getEditorText() !== "" || this.agents().length === 0) return undefined;
			this.active = true;
			this.selected = 0;
			this.update();
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.select.down")) {
			// update() clamps the selection to the last agent.
			this.selected++;
			this.update();
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.select.up")) {
			if (this.selected === 0) this.deactivate();
			else {
				this.selected--;
				this.update();
			}
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.select.cancel")) {
			this.deactivate();
			return { consume: true };
		}
		if (keybindings.matches(data, "tui.select.confirm")) {
			this.openSelected();
			return { consume: true };
		}
		this.deactivate();
		return undefined;
	}

	private deactivate(): void {
		this.active = false;
		this.selected = 0;
		this.update();
	}

	private openSelected(): void {
		const view = this.agents()[this.selected - 1];
		if (!view) {
			this.deactivate();
			return;
		}
		this.viewingId = view.id;
		const closed = () => {
			// The cursor returns to the viewed agent, wherever the list moved it meanwhile.
			const index = this.agents().findIndex((agent) => agent.id === view.id);
			if (index >= 0) this.selected = index + 1;
			this.viewingId = undefined;
			this.closeViewer = undefined;
			this.update();
		};
		openConversationViewer(this.ui, this.source, view, this.state, (close) => {
			this.closeViewer = close;
		}).then(closed, closed);
	}

	private render(width: number, theme: FleetTheme): string[] {
		const agents = this.agents();
		if (agents.length === 0) return [];
		const selected = Math.min(this.selected, agents.length);
		const keys = getKeybindings();
		const hint = this.active
			? `${keyLabel(keys, "tui.select.up")}${keyLabel(keys, "tui.select.down")} select · ${keyLabel(keys, "tui.select.confirm")} view · ${keyLabel(keys, "tui.select.cancel")} back`
			: `${keyLabel(keys, "app.interrupt")} to interrupt · ${keyLabel(keys, "tui.editor.cursorLeft")} for agents · ${keyLabel(keys, "tui.editor.cursorDown")} to manage`;
		const bullet = (index: number) => (index === selected ? theme.fg("accent", "●") : theme.fg("dim", "○"));
		const lines = [
			truncateToWidth(`  ${theme.fg("dim", hint)}`, width),
			"",
			truncateToWidth(`  ${bullet(0)} main`, width),
		];

		// The window keeps the selected agent on screen.
		const visible = Math.min(MAX_AGENT_ROWS, agents.length);
		const selectedRow = Math.max(0, selected - 1);
		const start = selectedRow < visible ? 0 : selectedRow - visible + 1;
		const below = agents.length - (start + visible);
		if (start > 0) lines.push(rightAlign("", theme.fg("dim", `↑ ${start} more`), width));
		for (let row = start; row < start + visible; row++) {
			lines.push(this.agentRow(agents[row], row + 1 === selected, bullet(row + 1), width, theme));
		}
		if (below > 0) lines.push(rightAlign("", theme.fg("dim", `↓ ${below} more`), width));
		return lines;
	}

	private agentRow(view: SubagentView, selected: boolean, bullet: string, width: number, theme: FleetTheme): string {
		// The selected row takes the text color; a color badge stays, bolded, so the row never shifts.
		const name = renderAgentName(
			view.definition,
			theme,
			selected
				? { fallbackColor: "text", bold: resolveAgentColor(view.definition.color) !== undefined }
				: { fallbackColor: "muted" },
		);
		const description = selected ? theme.fg("text", view.description) : view.description;
		const cost = this.source.settings.showCost ? formatCost(view.usage.cost.total) : "";
		const elapsed = (view.completedAt ?? Date.now()) - view.startedAt;
		const stats = `${formatFleetElapsed(elapsed)} · ${formatFleetTokens(displayTokens(view.usage))}${cost ? ` · ${cost}` : ""}`;
		return rightAlign(`  ${bullet} ${name}  ${description}`, theme.fg(selected ? "text" : "dim", stats), width);
	}
}
