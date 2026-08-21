import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import type { SkillManagementRow } from "../../../core/agent-session.ts";
import type { SettingsScope } from "../../../core/settings-manager.ts";
import {
	type ResolvedSkillVisibility,
	resolveSkillVisibility,
	SKILL_VISIBILITY_STATES,
	type SkillVisibilityState,
} from "../../../core/skills/visibility.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyText } from "./keybinding-hints.ts";

export interface SkillsSelectorConfig {
	/** Snapshot of `AgentSession.getSkillsManagementView()`; refresh via `updateRows`. */
	rows: SkillManagementRow[];
	/** Scope newly cycled states persist to. */
	initialScope: SettingsScope;
}

export interface SkillsSelectorCallbacks {
	/** Apply a state change for one skill at the given scope (host persists + applies; failures surface via `setStatus`). */
	onChange: (id: string, state: SkillVisibilityState, scope: SettingsScope) => void;
	onCancel: () => void;
}

function nextState(state: SkillVisibilityState): SkillVisibilityState {
	const index = SKILL_VISIBILITY_STATES.indexOf(state);
	return SKILL_VISIBILITY_STATES[(index + 1) % SKILL_VISIBILITY_STATES.length]!;
}

function scopeBadge(scope: SettingsScope | undefined): string {
	return scope === "project" ? "proj" : scope === "global" ? "glob" : "—";
}

/**
 * `/skills` management overlay (c4c): lists every loaded skill with its
 * estimated listing cost, effective A.6 visibility, and the scope its
 * persisted state comes from. The configurable `app.skills.*` actions cycle
 * the four states, toggle cost sort, and toggle the persist scope (all
 * modified keys, so the text filter can receive every character); changes
 * apply through `onChange` (the host owns persistence). A cycle derives its
 * next state from an optimistic pending state, not the last committed row, so
 * two quick presses advance two steps instead of repeating one while the
 * async persist is in flight; cancel leaves persisted state intact.
 */
export class SkillsSelectorComponent extends Container implements Focusable {
	private rows: SkillManagementRow[];
	private filteredRows: SkillManagementRow[] = [];
	/** Optimistic per-skill states requested since the last host reconcile, so a rapid re-cycle advances from the requested state rather than a stale committed row. */
	private pending: Map<string, SkillVisibilityState> = new Map();
	private selectedIndex = 0;
	private sortByCost = false;
	private scope: SettingsScope;
	private searchInput: Input;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	private listContainer: Container;
	private footerText: Text;
	private statusText: Text;
	private callbacks: SkillsSelectorCallbacks;
	private maxVisible = 10;

	constructor(config: SkillsSelectorConfig, callbacks: SkillsSelectorCallbacks) {
		super();
		this.callbacks = callbacks;
		this.rows = [...config.rows];
		this.scope = config.initialScope;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("Skills")), 0, 0));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`${keyText("app.skills.cycle")} cycle · ${keyText("app.skills.sort")} sort by cost · ${keyText("app.skills.scope")} scope — applies on the next request`,
				),
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));
		this.statusText = new Text("", 0, 0);
		this.addChild(this.statusText);
		this.footerText = new Text(this.getFooterText(), 0, 0);
		this.addChild(this.footerText);
		this.addChild(new DynamicBorder());

		this.refresh();
	}

	/** Replace the row snapshot (host re-reads the view after an applied change). */
	updateRows(rows: SkillManagementRow[]): void {
		const selectedId = this.filteredRows[this.selectedIndex]?.id;
		this.rows = [...rows];
		// Drop optimistic states the host has now reconciled; keep any still in flight.
		for (const row of this.rows) {
			if (this.pending.get(row.id) === row.state) {
				this.pending.delete(row.id);
			}
		}
		this.refresh();
		const refreshedIndex = selectedId ? this.filteredRows.findIndex((row) => row.id === selectedId) : -1;
		if (refreshedIndex >= 0) {
			this.selectedIndex = refreshedIndex;
			this.updateList();
		}
	}

	/** Discard a still-in-flight optimistic state whose persist failed, reverting the row to its committed state. */
	revertPending(id: string): void {
		if (this.pending.delete(id)) {
			this.updateList();
		}
	}

	/** Surface a host-side outcome (e.g. a failed persist/rebuild). */
	setStatus(message: string, kind: "muted" | "success" | "warning" = "muted"): void {
		this.statusText.setText(message === "" ? "" : theme.fg(kind, `  ${message}`));
	}

	private orderedRows(): SkillManagementRow[] {
		if (!this.sortByCost) {
			return this.rows;
		}
		return [...this.rows].sort(
			(a, b) => b.estimatedCost - a.estimatedCost || a.listingName.localeCompare(b.listingName),
		);
	}

	private getFooterText(): string {
		const parts = [
			`${keyText("app.skills.cycle")} cycle`,
			`${keyText("app.skills.sort")} sort${this.sortByCost ? " (cost)" : ""}`,
			`${keyText("app.skills.scope")} scope: ${this.scope}`,
			`${this.rows.length} skills`,
		];
		return theme.fg("dim", `  ${parts.join(" · ")}`);
	}

	private refresh(): void {
		const query = this.searchInput.getValue();
		const ordered = this.orderedRows();
		this.filteredRows = query
			? fuzzyFilter(ordered, query, (row) => `${row.listingName} ${row.name} ${row.location} ${row.source}`)
			: ordered;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredRows.length - 1));
		this.updateList();
		this.footerText.setText(this.getFooterText());
	}

	/** Display state and effective visibility, reflecting an optimistic pending cycle until the host reconciles it. */
	private displayState(row: SkillManagementRow): SkillVisibilityState {
		return this.pending.get(row.id) ?? row.state;
	}
	private displayEffective(row: SkillManagementRow): ResolvedSkillVisibility {
		const pendingState = this.pending.get(row.id);
		return pendingState === undefined
			? row.effective
			: resolveSkillVisibility(
					{ disableModelInvocation: row.disableModelInvocation, userInvocable: row.userInvocable },
					pendingState,
				);
	}

	private renderRow(row: SkillManagementRow, isSelected: boolean): string {
		const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
		const name = isSelected ? theme.fg("accent", row.listingName) : row.listingName;
		const displayState = this.displayState(row);
		const stateColor = displayState === "off" ? "error" : displayState === "on" ? "success" : "warning";
		const state = theme.fg(stateColor, ` ${displayState}`);
		const scope = theme.fg("muted", ` (${scopeBadge(row.stateScope)})`);
		const cost = theme.fg("muted", ` ~${row.estimatedCost} cu`);
		const invalid = row.malformed ? theme.fg("error", " ⚠ invalid") : "";
		const frontmatter = theme.fg(
			"dim",
			`${row.disableModelInvocation ? " dmi" : ""}${row.userInvocable ? "" : " ui:f"}`,
		);
		return `${prefix}${name}${state}${scope}${cost}${invalid}${frontmatter}`;
	}

	private updateList(): void {
		this.listContainer.clear();

		if (this.rows.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No skills loaded"), 0, 0));
			return;
		}
		if (this.filteredRows.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching skills"), 0, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredRows.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredRows.length);
		for (let i = startIndex; i < endIndex; i++) {
			this.listContainer.addChild(new Text(this.renderRow(this.filteredRows[i]!, i === this.selectedIndex), 0, 0));
		}
		if (startIndex > 0 || endIndex < this.filteredRows.length) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredRows.length})`), 0, 0),
			);
		}

		const selected = this.filteredRows[this.selectedIndex];
		if (selected) {
			const effective = this.displayEffective(selected);
			const detail = `  ${selected.location} · model: ${effective.model} · user: ${effective.user}${
				effective.userInvokeError ? " (invocation errors)" : ""
			}`;
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(new Text(theme.fg("muted", detail), 0, 0));
		}
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		const hasSelection = this.filteredRows.length > 0;

		if (kb.matches(data, "tui.select.up")) {
			if (!hasSelection) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredRows.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (!hasSelection) return;
			this.selectedIndex = this.selectedIndex === this.filteredRows.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}

		// Cycle the selected skill's visibility state (applies via the host).
		if (kb.matches(data, "app.skills.cycle")) {
			if (!hasSelection) return;
			const row = this.filteredRows[this.selectedIndex];
			if (row) {
				// Derive from the optimistic pending state, not the committed row,
				// so a second press before the host reconciles advances one more
				// step instead of repeating the same transition.
				const next = nextState(this.pending.get(row.id) ?? row.state);
				this.pending.set(row.id, next);
				this.updateList();
				this.callbacks.onChange(row.id, next, this.scope);
			}
			return;
		}

		// Toggle cost sort.
		if (kb.matches(data, "app.skills.sort")) {
			if (!hasSelection) return;
			this.sortByCost = !this.sortByCost;
			this.refresh();
			return;
		}

		// Toggle the persist scope for subsequent cycles.
		if (kb.matches(data, "app.skills.scope")) {
			if (!hasSelection) return;
			this.scope = this.scope === "global" ? "project" : "global";
			this.footerText.setText(this.getFooterText());
			return;
		}

		// Ctrl+C - clear filter or cancel if empty
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refresh();
			} else {
				this.callbacks.onCancel();
			}
			return;
		}

		// Escape - cancel
		if (matchesKey(data, Key.escape)) {
			this.callbacks.onCancel();
			return;
		}

		// Pass everything else to the filter input
		this.searchInput.handleInput(data);
		this.refresh();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
