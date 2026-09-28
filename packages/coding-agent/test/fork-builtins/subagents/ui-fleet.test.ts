// Fork-owned: FleetView, the agent list below the editor (plan T12), over a fake service and UI.
// Old pi-subagents tests at 79a7c42 this covers: fleet-list (navigation, focus, rendering, overlay
// lifecycle, cost display) and agent-color-surfaces (the FleetView row).
import {
	Editor,
	getKeybindings,
	setKeybindings,
	type KeybindingsManager as TuiKeybindings,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentView } from "../../../src/core/fork-builtins/subagents/service/records.ts";
import type { SteerOutcome, SubagentEvent } from "../../../src/core/fork-builtins/subagents/service/service.ts";
import {
	DEFAULT_SUBAGENT_SETTINGS,
	type SubagentSettings,
} from "../../../src/core/fork-builtins/subagents/settings/settings.ts";
import { type FleetSource, FleetView } from "../../../src/core/fork-builtins/subagents/ui/fleet.ts";
import type { ViewerSessionState } from "../../../src/core/fork-builtins/subagents/ui/viewer.ts";
import { emptyUsage } from "../../../src/core/fork-builtins/subagents/usage.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";

const KEY = {
	down: "\x1b[B",
	up: "\x1b[A",
	left: "\x1b[D",
	right: "\x1b[C",
	ctrlB: "\x02",
	escape: "\x1b",
	enter: "\r",
	/** A kitty-protocol release of the down key; listeners receive releases too. */
	downRelease: "\x1b[1;1:3B",
};

const PURPLE_BACKGROUND = "\u001b[48;2;130;125;189m";
const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `*${text}*`,
};

/** Visible text: ANSI, the theme's `<color>` tags and its `*bold*` markers stripped. */
const plain = (row: string) => row.replace(/\u001b\[[0-9;]*m/g, "").replace(/<\/?[a-zA-Z]+>|\*/g, "");

let previousKeybindings: TuiKeybindings;
beforeEach(() => {
	previousKeybindings = getKeybindings();
	setKeybindings(new KeybindingsManager());
});
afterEach(() => {
	setKeybindings(previousKeybindings);
	vi.useRealTimers();
});

type ViewFields = Omit<Partial<SubagentView>, "usage" | "definition"> & {
	cost?: number;
	definition?: Partial<SubagentView["definition"]>;
};

let started = 1_000;
function view(id: string, fields: ViewFields = {}): SubagentView {
	const { cost = 0, definition, ...rest } = fields;
	return {
		id,
		type: "worker",
		definition: { name: "worker", ...definition },
		description: `${id} description`,
		prompt: id,
		status: "running",
		usage: { ...emptyUsage(), input: 13_100, cost: { ...emptyUsage().cost, total: cost } },
		toolUses: 0,
		turns: 0,
		compactionCount: 0,
		startedAt: Date.now() - 60_000 + started++,
		depth: 1,
		mode: "background",
		resultConsumed: false,
		invocation: { modelFromParams: false, inheritContext: false, runInBackground: true, isolated: false },
		effective: {},
		cwd: "/tmp",
		activity: [],
		...rest,
	} as SubagentView;
}

/** A fake service over `views`; an agent has a session unless its id is in `sessionless`. */
function source(views: SubagentView[], settings: Partial<SubagentSettings> = {}, sessionless: string[] = []) {
	const listeners = new Set<(event: SubagentEvent) => void>();
	const fake = {
		views,
		sessionless: new Set(sessionless),
		listeners,
		listCalls: 0,
		settings: { ...DEFAULT_SUBAGENT_SETTINGS, ...settings } as SubagentSettings,
		isDisposed: false,
		list: () => {
			fake.listCalls++;
			return [...fake.views].sort((a, b) => b.startedAt - a.startedAt);
		},
		conversation: (id: string) =>
			fake.sessionless.has(id) ? undefined : { messages: [], subscribe: () => () => {} },
		contextPercent: () => undefined,
		subscribe: (listener: (event: SubagentEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit: () => {
			for (const listener of listeners) listener({ type: "settings", settings: fake.settings });
		},
		steer: vi.fn(async (): Promise<SteerOutcome> => ({ kind: "delivered" })),
		stop: vi.fn(() => true),
	};
	return fake;
}

type Fake = ReturnType<typeof source>;
type Overlay = { handleInput(data: string): void };

function mount(fake: Fake, state: ViewerSessionState = {}) {
	let input: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let widget: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
	const widgetCalls: unknown[] = [];
	let editorText = "";
	const overlays: Array<{ component: Overlay; closed: boolean; close(): void }> = [];
	const tui = {
		requestRender: vi.fn(),
		terminal: { rows: 40, columns: 120 },
		focused: undefined as unknown,
		getFocusedComponent() {
			return this.focused;
		},
	};
	const ui = {
		setWidget: (key: string, content: typeof widget) => {
			if (key !== "fleet") return;
			widgetCalls.push(content);
			widget = content;
		},
		onTerminalInput: (handler: typeof input) => {
			input = handler;
			return () => {
				input = undefined;
			};
		},
		getEditorText: () => editorText,
		custom: (
			factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (result: undefined) => void) => Overlay,
		) =>
			new Promise<undefined>((resolve) => {
				const overlay = {
					component: undefined as unknown as Overlay,
					closed: false,
					close: () => {
						overlay.closed = true;
						resolve(undefined);
					},
				};
				overlay.component = factory(tui, theme, new KeybindingsManager(), () => overlay.close());
				overlays.push(overlay);
			}),
	};
	const fleet = new FleetView(fake as unknown as FleetSource, ui as never, state);
	return {
		fleet,
		tui,
		overlays,
		widgetCalls,
		press: (data: string) => input?.(data),
		hasInput: () => input !== undefined,
		render: (width = 120) => (widget ? widget(tui, theme).render(width) : []),
		setEditorText: (text: string) => {
			editorText = text;
		},
		/** Lets a closed overlay's promise settle. */
		settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
	};
}

const rowOf = (lines: string[], text: string) => lines.find((line) => plain(line).includes(text)) ?? "";

describe("FleetView navigation", () => {
	it("registers no widget when no agent has a session", () => {
		const empty = mount(source([]));
		expect(empty.render()).toEqual([]);
		expect(empty.widgetCalls).toEqual([]);
		expect(mount(source([view("pending")], {}, ["pending"])).render()).toEqual([]);
	});

	it("hides nested agents from the session's fleet", () => {
		const lines = mount(source([view("top"), view("nested", { parentId: "top" })])).render();
		expect(lines.some((line) => plain(line).includes("top description"))).toBe(true);
		expect(lines.some((line) => plain(line).includes("nested description"))).toBe(false);
	});

	it("activates on tui.editor.cursorDown at an empty prompt, consuming the key", () => {
		const fleet = mount(source([view("a1")]));
		expect(fleet.press(KEY.down)).toEqual({ consume: true });
		expect(plain(fleet.render()[0])).toContain("↑↓ select · Enter view · Esc back");
	});

	it("also activates on tui.editor.cursorLeft, ctrl+b included", () => {
		expect(mount(source([view("a1")])).press(KEY.left)).toEqual({ consume: true });
		expect(mount(source([view("a1")])).press(KEY.ctrlB)).toEqual({ consume: true });
	});

	it("does not activate when the prompt holds text, so typing is preserved", () => {
		const fleet = mount(source([view("a1")]));
		fleet.setEditorText("hello");
		expect(fleet.press(KEY.down)).toBeUndefined();
	});

	it("ignores key-release events so one tap moves exactly one row", () => {
		const fleet = mount(source([view("a1"), view("a2")]));
		fleet.press(KEY.down);
		fleet.press(KEY.downRelease);
		expect(rowOf(fleet.render(), "main")).toContain("<accent>●</accent>");
		fleet.press(KEY.down);
		fleet.press(KEY.downRelease);
		expect(rowOf(fleet.render(), "a1 description")).toContain("<accent>●</accent>");
		expect(rowOf(fleet.render(), "a2 description")).toContain("<dim>○</dim>");
	});

	it("moves the selection down and up and clamps at the ends", () => {
		const fleet = mount(source([view("a1"), view("a2")]));
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		expect(rowOf(fleet.render(), "a1 description")).toContain("●");
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		expect(rowOf(fleet.render(), "a2 description")).toContain("●");
		expect(rowOf(fleet.render(), "a1 description")).toContain("○");
		fleet.press(KEY.up);
		expect(rowOf(fleet.render(), "a1 description")).toContain("●");
	});

	it("closes on tui.select.up above main, returning to the prompt", () => {
		const fleet = mount(source([view("a1")]));
		fleet.press(KEY.down);
		expect(fleet.press(KEY.up)).toEqual({ consume: true });
		expect(plain(fleet.render()[0])).toContain("← for agents");
	});

	it("closes on tui.select.cancel", () => {
		const fleet = mount(source([view("a1")]));
		fleet.press(KEY.down);
		expect(fleet.press(KEY.escape)).toEqual({ consume: true });
		expect(plain(fleet.render()[0])).toContain("← for agents");
	});

	it("passes other keys through and closes", () => {
		const fleet = mount(source([view("a1")]));
		fleet.press(KEY.down);
		expect(fleet.press(KEY.right)).toBeUndefined();
		expect(plain(fleet.render()[0])).toContain("← for agents");
	});

	it("ignores all input and hides while fleetView is off", () => {
		const fake = source([view("a1")]);
		const fleet = mount(fake);
		fake.settings = { ...fake.settings, fleetView: false };
		fake.emit();
		expect(fleet.press(KEY.down)).toBeUndefined();
		expect(fleet.render()).toEqual([]);
	});

	it("re-arms its refresh tick when the list shows again", () => {
		vi.useFakeTimers();
		const fake = source([view("a1")]);
		mount(fake);
		expect(vi.getTimerCount()).toBe(1);
		fake.settings = { ...fake.settings, fleetView: false };
		fake.emit();
		expect(vi.getTimerCount()).toBe(0);
		fake.settings = { ...fake.settings, fleetView: true };
		fake.emit();
		const before = fake.listCalls;
		vi.advanceTimersByTime(250);
		expect(fake.listCalls).toBeGreaterThan(before);
	});
});

describe("FleetView vs other focused components", () => {
	const editor = () =>
		new Editor(
			{ requestRender: () => {} } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
		);

	it("does not steal the activation key from a focused selector", () => {
		const fleet = mount(source([view("a1")]));
		fleet.tui.focused = { kind: "selector" };
		fleet.render();
		expect(fleet.press(KEY.down)).toBeUndefined();
	});

	it("does not steal navigation keys from a selector opened while the list was active", () => {
		const fleet = mount(source([view("a1")]));
		fleet.tui.focused = editor();
		fleet.render();
		expect(fleet.press(KEY.down)).toEqual({ consume: true });
		fleet.tui.focused = { kind: "selector" };
		expect(fleet.press(KEY.down)).toBeUndefined();
		expect(fleet.press(KEY.enter)).toBeUndefined();
		expect(fleet.press(KEY.escape)).toBeUndefined();
		expect(plain(fleet.render()[0])).toContain("← for agents");
	});

	it("still activates when the prompt editor has focus", () => {
		const fleet = mount(source([view("a1")]));
		fleet.tui.focused = editor();
		fleet.render();
		expect(fleet.press(KEY.down)).toEqual({ consume: true });
	});

	it("assumes the editor when focus is unknown (no TUI yet, or nothing focused)", () => {
		expect(mount(source([view("a1")])).press(KEY.down)).toEqual({ consume: true });
		const rendered = mount(source([view("a1")]));
		rendered.render();
		expect(rendered.press(KEY.down)).toEqual({ consume: true });
	});
});

describe("FleetView rendering", () => {
	it("renders main and agent rows with markers, name, description and right-aligned stats", () => {
		const lines = mount(source([view("a1", { description: "Sleep then report 1" })])).render(120);
		expect(plain(lines[0])).toContain("Esc to interrupt · ← for agents · ↓ to manage");
		expect(rowOf(lines, "main")).toContain("<accent>●</accent>");
		const row = rowOf(lines, "Sleep then report 1");
		expect(plain(row)).toMatch(/^ {2}○ worker {2}Sleep then report 1 +\d+s · ↓ 13\.1k tokens$/);
		// Flush right: the theme's tags count as width here, as escapes would not.
		expect(visibleWidth(row)).toBe(120);
	});

	it("orders agents earliest-launched first", () => {
		const lines = mount(source([view("newest", { startedAt: 2000 }), view("oldest", { startedAt: 1000 })])).render();
		const oldest = lines.findIndex((line) => plain(line).includes("oldest description"));
		expect(oldest).toBeGreaterThanOrEqual(0);
		expect(oldest).toBeLessThan(lines.findIndex((line) => plain(line).includes("newest description")));
	});

	it("collapses overflow into a '↓ N more' indicator", () => {
		const lines = mount(source(Array.from({ length: 8 }, (_, index) => view(`a${index}`)))).render(120);
		expect(lines.some((line) => plain(line).includes("↓ 3 more"))).toBe(true);
		expect(lines.filter((line) => plain(line).includes("description"))).toHaveLength(5);
	});

	it("never emits a line wider than the terminal", () => {
		const fleet = mount(
			source(
				Array.from({ length: 8 }, (_, index) =>
					view(`a${index}`, { description: `a very long agent description number ${index} that keeps going` }),
				),
			),
		);
		for (const width of [4, 8, 12, 20, 40, 80, 200]) {
			for (const line of fleet.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("windows the visible agents so the selection stays on screen", () => {
		const fleet = mount(source(Array.from({ length: 8 }, (_, index) => view(`a${index}`))));
		fleet.press(KEY.down);
		for (let index = 0; index < 8; index++) fleet.press(KEY.down);
		const lines = fleet.render(120);
		expect(rowOf(lines, "a7 description")).toContain("●");
		expect(lines.some((line) => plain(line).includes("↑ 3 more"))).toBe(true);
	});

	it("renders the whole selected row in the theme's text color", () => {
		const fleet = mount(source([view("a1"), view("a2")]));
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		const selected = rowOf(fleet.render(), "a1 description");
		expect(selected).toContain("<accent>●</accent>");
		expect(selected).toContain("<text>a1 description</text>");
		expect(selected).toMatch(/<text>\d+s · ↓ 13\.1k tokens<\/text>/);
		expect(selected).toContain("<text>worker</text>");
		const unselected = rowOf(fleet.render(), "a2 description");
		expect(unselected).toContain("<dim>○</dim>");
		expect(unselected).toContain("<muted>worker</muted>");
		expect(unselected).toMatch(/<dim>\d+s · ↓ 13\.1k tokens<\/dim>/);
		expect(unselected).not.toContain("<text>");
	});

	it("keeps a color badge on the selected row, bolded, without shifting it", () => {
		const badged = { name: "reviewer", displayName: "Code Reviewer", color: "purple" };
		const fleet = mount(source([view("a1", { definition: badged }), view("a2", { definition: badged })]));
		fleet.press(KEY.down);
		const before = rowOf(fleet.render(), "a1 description");
		expect(before).toContain(PURPLE_BACKGROUND);
		expect(before).toContain(" Code Reviewer ");
		fleet.press(KEY.down);
		const selected = rowOf(fleet.render(), "a1 description");
		expect(selected).toContain(PURPLE_BACKGROUND);
		expect(selected).toContain("* Code Reviewer *");
		expect(selected).not.toContain("<text>Code Reviewer");
		expect(plain(selected).indexOf("a1 description")).toBe(plain(before).indexOf("a1 description"));
	});
});

describe("FleetView and the viewer", () => {
	it("closes the list on tui.select.confirm at main, opening no viewer", () => {
		const fleet = mount(source([view("a1")]));
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		expect(fleet.overlays).toHaveLength(0);
		expect(plain(fleet.render()[0])).toContain("← for agents");
	});

	it("returns the cursor to the viewed agent after the viewer closes, even when the list reordered", async () => {
		const fake = source([view("a1"), view("a2"), view("a3")]);
		const fleet = mount(fake);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		expect(fleet.overlays).toHaveLength(1);
		fake.views.splice(0, 1);
		fleet.overlays[0].component.handleInput(KEY.escape);
		await fleet.settle();
		expect(rowOf(fleet.render(), "a2 description")).toContain("●");
		expect(rowOf(fleet.render(), "a3 description")).toContain("○");
	});

	it("leaves the viewer its keys, and resumes navigation at the viewed agent once it closes", async () => {
		const fleet = mount(source([view("a1"), view("a2"), view("a3")]));
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		// Input listeners run before the focused overlay: the list must let the viewer's keys through.
		fleet.tui.focused = fleet.overlays[0].component;
		expect(fleet.press(KEY.escape)).toBeUndefined();
		fleet.overlays[0].component.handleInput(KEY.escape);
		await fleet.settle();
		fleet.tui.focused = undefined;
		expect(rowOf(fleet.render(), "a2 description")).toContain("●");
		expect(fleet.press(KEY.down)).toEqual({ consume: true });
		expect(rowOf(fleet.render(), "a3 description")).toContain("●");
	});

	it("closes an open viewer when the session is disposed directly", () => {
		const fake = source([view("live")]);
		const fleet = mount(fake);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		fake.isDisposed = true;
		fake.emit();
		expect(fleet.overlays[0].closed).toBe(true);
		expect(fleet.hasInput()).toBe(false);
	});

	it("steers through the service with the agent's id", async () => {
		const fake = source([view("live")]);
		const fleet = mount(fake);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		const viewer = fleet.overlays[0].component;
		viewer.handleInput(KEY.enter);
		for (const character of "go left") viewer.handleInput(character);
		viewer.handleInput(KEY.enter);
		expect(fake.steer).toHaveBeenCalledExactlyOnceWith("live", "go left");
	});

	it("hands the viewer the Markdown setting and the session's viewer state", () => {
		const state: ViewerSessionState = {};
		const fleet = mount(source([view("live")], { viewerMarkdown: "all" }), state);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		fleet.overlays[0].component.handleInput("m");
		expect(state.markdownMode).toBe("off");
	});

	it("keeps the viewer open and the agent listed when the viewed agent finishes", () => {
		const fake = source([view("live")]);
		const fleet = mount(fake);
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		fake.views[0] = view("live", { status: "completed", completedAt: Date.now() - 60_000 });
		fake.emit();
		expect(fleet.overlays[0].closed).toBe(false);
		expect(fleet.render().some((line) => plain(line).includes("live description"))).toBe(true);
	});

	it("lingers a finished agent for 4 s, then drops it", () => {
		const recent = view("recent", { status: "completed", completedAt: Date.now() });
		expect(
			mount(source([recent]))
				.render()
				.some((line) => plain(line).includes("recent description")),
		).toBe(true);
		const old = view("old", { status: "completed", completedAt: Date.now() - 4_100 });
		expect(mount(source([old])).render()).toEqual([]);
	});

	it("closes an open viewer and removes the widget and the input handler on dispose", () => {
		const fleet = mount(source([view("live")]));
		fleet.press(KEY.down);
		fleet.press(KEY.down);
		fleet.press(KEY.enter);
		fleet.fleet.dispose();
		expect(fleet.overlays[0].closed).toBe(true);
		expect(fleet.widgetCalls.at(-1)).toBeUndefined();
		expect(fleet.hasInput()).toBe(false);
	});
});

describe("FleetView cost display", () => {
	const row = (showCost: boolean, cost: number, fields: ViewFields = {}) =>
		plain(rowOf(mount(source([view("a1", { cost, ...fields })], { showCost })).render(120), "a1 description"));

	it("appends the cost after the token count when enabled", () => {
		expect(row(true, 0.0042)).toMatch(/↓ 13\.1k tokens · ~\$0\.0042$/);
	});

	it("shows no cost when disabled, and none for an unpriced model", () => {
		expect(row(false, 0.0042)).not.toContain("$");
		expect(row(true, 0)).not.toContain("$");
	});

	it("keeps its figures when the agent finishes", () => {
		const startedAt = Date.now() - 5_000;
		const running = row(true, 0.0042, { startedAt, completedAt: startedAt + 5_000, status: "running" });
		const finished = row(true, 0.0042, { startedAt, completedAt: startedAt + 5_000, status: "completed" });
		expect(finished).toBe(running);
		expect(finished).toMatch(/5s · ↓ 13\.1k tokens · ~\$0\.0042$/);
	});
});
