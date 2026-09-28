// Fork-owned: the `agents` widget above the editor (plan T10), over a fake service. Old pi-subagents
// tests at 79a7c42 this covers: agent-widget (AgentWidget, cost display, overflow accounting,
// renderRunningAgentStatus), agent-color-surfaces (the widget), perf/no-fs-on-render and
// perf/render-invariants (the widget).
import { afterEach, describe, expect, it, vi } from "vitest";

/** Every fs entry point a render could reach; `node:fs` is replaced whole, because named ESM bindings cannot be spied on. */
const FS_CALLS: string[] = vi.hoisted(() => []);

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	const wrapped: Record<string, unknown> = { ...actual };
	for (const name of ["readFileSync", "readdirSync", "existsSync", "statSync", "lstatSync", "realpathSync"] as const) {
		const original = actual[name] as (...args: unknown[]) => unknown;
		wrapped[name] = (...args: unknown[]) => {
			FS_CALLS.push(`${name}(${String(args[0])})`);
			return original(...args);
		};
	}
	return { ...wrapped, default: wrapped };
});

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TUI } from "@earendil-works/pi-tui";
import type { ExtensionUIContext } from "../../../src/core/extensions/types.ts";
import type { SubagentView } from "../../../src/core/fork-builtins/subagents/service/records.ts";
import type { SubagentEvent } from "../../../src/core/fork-builtins/subagents/service/service.ts";
import {
	DEFAULT_SUBAGENT_SETTINGS,
	type SubagentSettings,
} from "../../../src/core/fork-builtins/subagents/settings/settings.ts";
import { AgentWidget, type WidgetSource } from "../../../src/core/fork-builtins/subagents/ui/widget.ts";
import { emptyUsage } from "../../../src/core/fork-builtins/subagents/usage.ts";

afterEach(() => {
	vi.useRealTimers();
});

const plain = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

type ViewFields = Omit<Partial<SubagentView>, "usage" | "definition"> & {
	cost?: number;
	tokens?: number;
	definition?: Partial<SubagentView["definition"]>;
};

function view(id: string, fields: ViewFields = {}): SubagentView {
	const { cost = 0, tokens = 0, definition, ...rest } = fields;
	const usage = { ...emptyUsage(), input: tokens, cost: { ...emptyUsage().cost, total: cost } };
	return {
		id,
		type: "worker",
		definition: { name: "worker", ...definition },
		description: `${id} description`,
		prompt: id,
		status: "running",
		usage,
		toolUses: 0,
		turns: 0,
		compactionCount: 0,
		startedAt: Date.now(),
		depth: 1,
		mode: "background",
		resultConsumed: false,
		invocation: { modelFromParams: false, inheritContext: false, runInBackground: true, isolated: false },
		effective: {},
		cwd: "/tmp",
		activity: [],
		...(rest.status && rest.status !== "running" && rest.status !== "queued" ? { completedAt: Date.now() } : {}),
		...rest,
	} as SubagentView;
}

/** A fake service over `views`, oldest first, with the settings the test gives. */
function source(views: SubagentView[], settings: Partial<SubagentSettings> = {}) {
	const listeners = new Set<(event: SubagentEvent) => void>();
	const conversations = new Map<string, AgentMessage[]>();
	const counters = { list: 0 };
	const fake = {
		views,
		counters,
		conversations,
		settings: { ...DEFAULT_SUBAGENT_SETTINGS, widgetMode: "all", ...settings } as SubagentSettings,
		isDisposed: false,
		// The service lists newest first.
		list: () => {
			counters.list++;
			return [...fake.views].reverse();
		},
		contextPercent: () => undefined,
		conversation: (id: string) => {
			const messages = conversations.get(id);
			return messages ? { messages, subscribe: () => () => {} } : undefined;
		},
		subscribe: (listener: (event: SubagentEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit: (event: SubagentEvent) => {
			for (const listener of listeners) listener(event);
		},
		listeners,
	};
	return fake;
}

type Fake = ReturnType<typeof source>;

/** Mounts a widget over `fake`; `lines()` renders what the widget currently shows. */
function mount(fake: Fake, width = 200, theme: object = plain) {
	const calls: Array<{ key: string; content: unknown; placement?: string }> = [];
	const ui = {
		setWidget: (key: string, content: unknown, options?: { placement?: string }) => {
			calls.push({ key, content, placement: options?.placement });
		},
	} as unknown as Pick<ExtensionUIContext, "setWidget">;
	const tui = { requestRender: vi.fn() };
	const widget = new AgentWidget(fake as unknown as WidgetSource, ui);
	const lines = (): string[] => {
		const content = calls.at(-1)?.content as
			| ((tui: TUI, theme: unknown) => { render(width: number): string[] })
			| undefined;
		return content ? content(tui as unknown as TUI, theme).render(width) : [];
	};
	return { widget, calls, tui, lines, text: () => lines().join("\n") };
}

/** Lets the widget's coalesced update run. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("the agents widget", () => {
	it("renders running status as separate component lines", () => {
		const running = view("run", {
			toolUses: 4,
			turns: 2,
			tokens: 1234,
			activity: [{ type: "tool_start", toolName: "read" } as SubagentView["activity"][number]],
		});
		const lines = mount(source([running])).lines();
		expect(lines[0]).toBe("● Agents");
		expect(lines[1]).toMatch(
			/^└─ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] worker {2}run description · ↻2 · 4 tool uses · 1\.2k token · \d+\.\ds$/,
		);
		expect(lines[2]).toBe("     ⎿  reading…");
		expect(lines).toHaveLength(3);
	});

	it("shows a running agent's latest response when no tool runs, and marks a fleet with nothing active", () => {
		const fake = source([view("talk")]);
		fake.conversations.set("talk", [
			{ role: "assistant", content: [{ type: "text", text: "Looking at the parser now" }] } as AgentMessage,
		]);
		expect(mount(fake).text()).toContain("⎿  Looking at the parser now");
		const done = mount(source([view("done", { status: "completed" })])).lines();
		expect(done[0]).toBe("○ Agents");
	});

	it("shows foreground agents in 'all' mode (and by default)", () => {
		const foreground = view("foreground", { mode: "foreground" });
		expect(mount(source([foreground], { widgetMode: "all" })).text()).toContain("foreground description");
	});

	it("hides nested children in every coordinator widget mode", () => {
		const nested = view("nested", { parentId: "parent" });
		for (const widgetMode of ["all", "background"] as const) {
			const mounted = mount(source([nested], { widgetMode }));
			expect(mounted.text()).toBe("");
			expect(mounted.calls).toEqual([]);
		}
	});

	it("excludes foreground agents in 'background' mode", () => {
		const mounted = mount(source([view("foreground", { mode: "foreground" })], { widgetMode: "background" }));
		expect(mounted.text()).toBe("");
		expect(mounted.calls).toEqual([]);
	});

	it("renders background agents in 'background' mode", () => {
		const text = mount(source([view("background")], { widgetMode: "background" })).text();
		expect(text).toContain("Agents");
		expect(text).toContain("background description");
	});

	it("keeps detached agents, spawned over RPC, in 'background' mode", () => {
		const fake = source([view("rpc", { mode: "detached" }), view("rpc-bg", { mode: "detached-background" })], {
			widgetMode: "background",
		});
		const text = mount(fake).text();
		expect(text).toContain("rpc description");
		expect(text).toContain("rpc-bg description");
	});

	it("renders nothing in 'off' mode", () => {
		const mounted = mount(source([view("background")], { widgetMode: "off" }));
		expect(mounted.text()).toBe("");
		expect(mounted.calls).toEqual([]);
	});

	describe("under showModel", () => {
		const modeled = (fields: ViewFields = {}) =>
			view("bg", {
				model: {
					provider: "anthropic",
					id: "claude-sonnet-4-6",
					name: "Claude Sonnet 4.6",
				} as SubagentView["model"],
				invocation: {
					modelFromParams: false,
					inheritContext: false,
					runInBackground: true,
					isolated: false,
					thinking: "high",
				},
				...fields,
			});

		it("names the model and thinking on a running row under showModel", () => {
			expect(mount(source([modeled()], { showModel: true })).text()).toContain("sonnet 4.6 · thinking: high");
		});

		it("renders the row exactly as before when showModel is off", () => {
			const off = mount(source([modeled()], { showModel: false })).text();
			expect(off).toContain("bg description");
			expect(off).not.toContain("sonnet 4.6");
			expect(off).not.toContain("thinking:");
		});

		it("carries the short label, never the canonical id, onto the row", () => {
			expect(mount(source([modeled()], { showModel: true })).text()).not.toContain("anthropic/claude-sonnet-4-6");
		});

		it("discloses a level the run did not honor", () => {
			const clamped = modeled({ effective: { thinking: "low" } });
			expect(mount(source([clamped], { showModel: true })).text()).toContain(
				"sonnet 4.6 · thinking: low (asked high)",
			);
		});
	});

	it("keeps queued agents on one summary line and finished agents visible", () => {
		const views = [
			...[1, 2, 3].map((index) => view(`run${index}`)),
			...[1, 2, 3, 4, 5, 6, 7].map((index) => view(`q${index}`, { status: "queued" })),
			...[1, 2, 3].map((index) => view(`fin${index}`, { status: "completed" })),
		];
		const text = mount(source(views, { widgetMode: "background", showModel: true })).text();
		expect(text).toContain("7 queued");
		expect(text).not.toContain("q1 description");
		for (const index of [1, 2, 3]) expect(text).toContain(`fin${index} description`);
		expect(text).not.toContain("more (");
	});

	it("draws each finished outcome: completed, turn limit, stopped, error and aborted", () => {
		const lines = mount(
			source([
				view("ok", { status: "completed", toolUses: 2 }),
				view("limit", { status: "steered" }),
				view("halt", { status: "stopped" }),
				view("fail", { status: "error", error: `boom ${"x".repeat(80)}` }),
				view("cut", { status: "aborted" }),
			]),
		).lines();
		expect(lines[1]).toMatch(/^├─ ✓ worker {2}ok description · 2 tool uses · \d+\.\ds$/);
		expect(lines[2]).toMatch(/^├─ ✓ worker {2}limit description · \d+\.\ds \(turn limit\)$/);
		expect(lines[3]).toMatch(/^├─ ■ worker {2}halt description · \d+\.\ds stopped$/);
		expect(lines[4]).toMatch(
			new RegExp(`^├─ ✗ worker {2}fail description · \\d+\\.\\ds error: boom ${"x".repeat(55)}$`),
		);
		expect(lines[5]).toMatch(/^└─ ✗ worker {2}cut description · \d+\.\ds aborted$/);
	});

	// T18-F4 review: a child's provider error reached the terminal with its escape sequences.
	it("prints a finished agent's error without its escape sequences", () => {
		const lines = mount(
			source([view("fail", { status: "error", error: "before\u001b]52;c;aW5qZWN0ZWQ=\u0007after" })]),
		).lines();
		expect(lines[1]).toMatch(/error: beforeafter$/);
		expect(lines.join("\n")).not.toContain("\u001b]52");
	});

	it("keeps a completed agent for one parent turn and an error for two", async () => {
		const fake = source([view("ok", { status: "completed" }), view("fail", { status: "error" })]);
		const mounted = mount(fake);
		for (const record of fake.views) fake.emit({ type: "ended", record });
		await settle();
		expect(mounted.text()).toContain("ok description");
		mounted.widget.onParentTurn();
		expect(mounted.text()).not.toContain("ok description");
		expect(mounted.text()).toContain("fail description");
		mounted.widget.onParentTurn();
		expect(mounted.text()).toBe("");
		expect(mounted.calls.at(-1)?.content).toBeUndefined();
	});

	it("shows a running agent's display name in its color", () => {
		const colored = view("paint", {
			definition: { name: "reviewer", displayName: "Code Reviewer", color: "purple" },
		});
		const ansi = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
			getColorMode: () => "truecolor" as const,
		};
		const text = mount(source([colored]), 200, ansi).text();
		expect(text).toContain("\u001b[48;2;130;125;189m");
		expect(text).toContain(" Code Reviewer ");
	});

	it("touches no file while it renders a frame", () => {
		const mounted = mount(
			source([view("run"), view("q", { status: "queued" }), view("fin", { status: "completed" })]),
		);
		mounted.lines();
		FS_CALLS.length = 0;
		mounted.lines();
		mounted.lines();
		expect(FS_CALLS).toEqual([]);
	});

	it("asks the service for the agent list a constant number of times per frame", () => {
		const callsPerFrame = (count: number) => {
			const fake = source(Array.from({ length: count }, (_, index) => view(`run${index}`)));
			const mounted = mount(fake);
			mounted.lines();
			fake.counters.list = 0;
			mounted.lines();
			return fake.counters.list;
		};
		expect(callsPerFrame(1)).toBe(1);
		expect(callsPerFrame(40)).toBe(1);
	});

	it("runs its 80 ms timer only while an agent runs, and unbinding removes the widget and the timer", async () => {
		vi.useFakeTimers();
		const running = view("run");
		const fake = source([running]);
		const mounted = mount(fake);
		mounted.lines();
		vi.advanceTimersByTime(400);
		expect(mounted.tui.requestRender).toHaveBeenCalledTimes(5);

		fake.views = [view("run", { status: "completed" })];
		fake.emit({ type: "ended", record: fake.views[0] });
		await settle();
		mounted.tui.requestRender.mockClear();
		vi.advanceTimersByTime(400);
		expect(mounted.tui.requestRender).not.toHaveBeenCalled();
		expect(mounted.text()).toContain("run description");

		fake.views = [running];
		fake.emit({ type: "started", record: running });
		await settle();
		expect(vi.getTimerCount()).toBe(1);
		mounted.widget.dispose();
		expect(vi.getTimerCount()).toBe(0);
		expect(mounted.calls.at(-1)).toEqual({ key: "agents", content: undefined, placement: undefined });
		expect(fake.listeners.size).toBe(0);
	});

	it("stops its timer and listener, touching no UI, once the session is disposed directly", async () => {
		vi.useFakeTimers();
		const running = view("run");
		const fake = source([running]);
		const mounted = mount(fake);
		mounted.lines();
		expect(vi.getTimerCount()).toBe(1);
		fake.isDisposed = true;
		fake.emit({ type: "ended", record: running });
		await settle();
		expect(vi.getTimerCount()).toBe(0);
		expect(fake.listeners.size).toBe(0);
		expect(mounted.calls).toHaveLength(1);
		mounted.widget.dispose();
		expect(mounted.calls).toHaveLength(1);
	});
});

describe("the agents widget's cost display", () => {
	const spending = (showCost: boolean | undefined, cost: number, fields: ViewFields = {}) =>
		mount(
			source(
				[view("a1", { description: "spending agent", toolUses: 1, tokens: 1200, cost, ...fields })],
				showCost === undefined ? {} : { showCost },
			),
		).text();

	it("shows the cost beside the token count when enabled", () => {
		const line = spending(true, 0.0042);
		expect(line).toContain("1.2k token · ~$0.0042");
	});

	it("shows no cost when disabled", () => {
		const line = spending(false, 0.0042);
		expect(line).toContain("1.2k token");
		expect(line).not.toContain("$");
	});

	it("shows no cost for an unpriced model, even when enabled", () => {
		const line = spending(true, 0);
		expect(line).toContain("1.2k token");
		expect(line).not.toContain("$");
	});

	it("keeps the cost visible after the agent finishes", () => {
		const out = spending(true, 0.0042, { description: "done agent", status: "completed", toolUses: 2 });
		expect(out).toContain("done agent");
		expect(out).toContain("~$0.0042");
	});

	it("shows stats for an agent whose child session does not exist yet", () => {
		// No conversation: the child has not attached, and the row still carries the record's numbers.
		const out = spending(true, 0.0042);
		expect(out).toContain("1.2k token");
		expect(out).toContain("~$0.0042");
		expect(out).toContain("⎿  thinking…");
	});

	it("defaults to hiding it", () => {
		expect(spending(undefined, 0.5)).not.toContain("$");
	});
});

describe("the agents widget's overflow accounting", () => {
	function renderFleet(counts: { running: number; queued: number; finished: number }): string[] {
		const views = [
			...Array.from({ length: counts.running }, (_, index) => view(`run${index}`)),
			...Array.from({ length: counts.queued }, (_, index) => view(`q${index}`, { status: "queued" })),
			...Array.from({ length: counts.finished }, (_, index) => view(`fin${index}`, { status: "completed" })),
		];
		return mount(source(views)).lines();
	}

	const footer = (lines: string[]) => lines.find((line) => line.includes("more ("));

	const SHAPES: { running: number; queued: number; finished: number }[] = [];
	for (let running = 0; running <= 8; running++)
		for (let queued = 0; queued <= 8; queued++)
			for (let finished = 0; finished <= 8; finished++) SHAPES.push({ running, queued, finished });

	it("never exceeds the line cap, for any fleet shape", () => {
		for (const counts of SHAPES) {
			expect(renderFleet(counts).length, JSON.stringify(counts)).toBeLessThanOrEqual(12);
		}
	});

	it("never prints a footer that miscounts what it hid, for any fleet shape", () => {
		for (const counts of SHAPES) {
			const line = footer(renderFleet(counts));
			if (!line) continue;
			const total = Number(/\+(\d+) more/.exec(line)?.[1]);
			const where = `${JSON.stringify(counts)} → ${line}`;
			expect(total, where).toBeGreaterThan(0);
			expect(total, where).toBeLessThanOrEqual(counts.running + counts.finished);
		}
	});

	it("keeps the queued summary visible when the running agents fill the widget", () => {
		expect(renderFleet({ running: 5, queued: 3, finished: 1 }).join("\n")).toContain("3 queued");
	});

	it("counts everything it hid — the footer total matches what is missing", () => {
		const counts = { running: 5, queued: 3, finished: 1 };
		const lines = renderFleet(counts);
		const body = lines.join("\n");
		const hiddenRunning = [...Array(counts.running).keys()].filter(
			(index) => !body.includes(`run${index} description`),
		);
		const hiddenFinished = [...Array(counts.finished).keys()].filter(
			(index) => !body.includes(`fin${index} description`),
		);
		const reported = Number(/\+(\d+) more/.exec(footer(lines) ?? "")?.[1] ?? -1);
		expect(reported).toBe(hiddenRunning.length + hiddenFinished.length);
		expect(footer(lines)).toContain(`${hiddenRunning.length} running`);
	});

	it("gives the queued summary priority over finished lines", () => {
		expect(renderFleet({ running: 4, queued: 2, finished: 3 }).join("\n")).toContain("2 queued");
	});

	it("renders everything with no footer when the fleet fits", () => {
		const lines = renderFleet({ running: 2, queued: 1, finished: 1 });
		expect(lines.join("\n")).toContain("1 queued");
		expect(footer(lines)).toBeUndefined();
	});

	it("shows the completion line again after a finished agent is resumed", async () => {
		const agent = view("resumed", { status: "completed" });
		const fake = source([agent]);
		const mounted = mount(fake);
		fake.emit({ type: "ended", record: agent });
		await settle();
		mounted.widget.onParentTurn();
		mounted.widget.onParentTurn();
		expect(mounted.text()).not.toContain("resumed description");

		const resumed = view("resumed");
		fake.views = [resumed];
		fake.emit({ type: "started", record: resumed });
		await settle();
		expect(mounted.text()).toContain("resumed description");

		const finished = view("resumed", { status: "completed" });
		fake.views = [finished];
		fake.emit({ type: "ended", record: finished });
		await settle();
		expect(mounted.text()).toContain("resumed description");
	});
});
