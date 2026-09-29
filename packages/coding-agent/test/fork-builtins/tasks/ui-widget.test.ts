/**
 * Fork-owned: the tasks widget (plan T4) over a fixed source: no UI failure escapes, and a failed
 * registration is tried again at the next change.
 */
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskActivity, TaskEvent } from "../../../src/core/fork-builtins/tasks/service/service.ts";
import { DEFAULT_TASK_SETTINGS, type TaskSettings } from "../../../src/core/fork-builtins/tasks/settings.ts";
import type { Task } from "../../../src/core/fork-builtins/tasks/store.ts";
import {
	renderTaskLines,
	TaskWidget,
	type TaskWidgetSource,
	type WidgetTheme,
} from "../../../src/core/fork-builtins/tasks/ui/widget.ts";

const task = (id: string, status: Task["status"] = "pending", fields: Partial<Task> = {}): Task => ({
	id,
	subject: `task ${id}`,
	description: "d",
	status,
	metadata: {},
	blocks: [],
	blockedBy: [],
	createdAt: 0,
	updatedAt: 0,
	...fields,
});

interface SourceOptions {
	settings?: Partial<TaskSettings>;
	working?: string[];
	activity?: Record<string, TaskActivity>;
}

/** A source whose list the test sets, and whose `changed` event it fires. */
function source(tasks: Task[], options: SourceOptions = {}) {
	let listener: ((event: TaskEvent) => void) | undefined;
	const value: { -readonly [K in keyof TaskWidgetSource]: TaskWidgetSource[K] } = {
		list: () => tasks,
		get: (id) => tasks.find((candidate) => candidate.id === id),
		settings: { ...DEFAULT_TASK_SETTINGS, ...options.settings },
		activity: (id) => options.activity?.[id],
		workingIds: () => options.working ?? [],
		isDisposed: false,
		subscribe: (next) => {
			listener = next;
			return () => {
				listener = undefined;
			};
		},
	};
	return { value, changed: () => listener?.({ type: "changed" }) };
}

afterEach(() => vi.useRealTimers());

describe("the tasks widget", () => {
	it("contains a failing setWidget and registers at the next change", async () => {
		const errors: unknown[] = [];
		let calls = 0;
		const ui = {
			setWidget: vi.fn(() => {
				calls++;
				if (calls === 1) throw new Error("no terminal");
			}),
		};
		const { value, changed } = source([task("1")]);
		const widget = new TaskWidget(value, ui, false, (error) => errors.push(error));
		expect(errors).toHaveLength(1);
		changed();
		await Promise.resolve();
		expect(ui.setWidget).toHaveBeenCalledTimes(2);
		widget.dispose();
		expect(ui.setWidget).toHaveBeenLastCalledWith("tasks", undefined);
	});

	it("contains a failing removal at dispose", () => {
		const errors: unknown[] = [];
		const ui = {
			setWidget: vi.fn((_key: string, content: unknown) => {
				if (content === undefined) throw new Error("gone");
			}),
		};
		const widget = new TaskWidget(source([task("1")]).value, ui, true, (error) => errors.push(error));
		expect(() => widget.dispose()).not.toThrow();
		expect(errors).toHaveLength(1);
	});
});

/** Marks colors and strikes, so rows show what the theme was asked to style. */
const MARKED: WidgetTheme = { fg: (_color, text) => text, strikethrough: (text) => `~${text}~` };

const lines = (tasks: Task[], options: SourceOptions = {}, frame = 0) =>
	renderTaskLines(source(tasks, options).value, MARKED, frame);

/** A UI that keeps the widget's component and counts its calls. */
function componentUi() {
	let component: Component | undefined;
	let renders = 0;
	const tui = { requestRender: () => renders++ } as unknown as TUI;
	const ui = {
		setWidget: vi.fn((_key: string, content: unknown) => {
			component =
				typeof content === "function"
					? (content as (tui: TUI, theme: WidgetTheme) => Component)(tui, MARKED)
					: undefined;
		}),
	};
	return { ui, render: (width = 200) => component?.render(width) ?? [], renders: () => renders };
}

describe("the tasks widget's rows", () => {
	it("counts the tasks by status, and shows each status with its glyph, striking completed rows through", () => {
		expect(
			lines([
				task("1", "completed"),
				task("2", "in_progress"),
				task("3", "pending", { blockedBy: ["1", "2"] }),
				task("4"),
			]),
		).toEqual([
			"● 4 tasks (1 done, 1 in progress, 2 open)",
			"  ✔ ~#1 task 1~",
			"  ◼ #2 task 2",
			"  ◻ #3 task 3 › blocked by #2",
			"  ◻ #4 task 4",
		]);
		expect(lines([])).toEqual([]);
	});

	it("shows a worked-on task with the spinner, its activeForm or subject, its agent, its elapsed time and its tokens", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(10_000_000);
		const now = Date.now();
		const tasks = [
			task("1", "in_progress", { activeForm: "Surveying", metadata: { agentId: "abcdef123456" } }),
			task("2", "in_progress"),
			task("3", "in_progress"),
			task("4", "in_progress"),
		];
		const activity = {
			"1": { startedAt: now - 65_000, inputTokens: 1500, outputTokens: 999 },
			"2": { startedAt: now - 5_000, inputTokens: 0, outputTokens: 0 },
			"3": { startedAt: now - 3_600_000, inputTokens: 2000, outputTokens: 0 },
			"4": { startedAt: now - 3_660_000, inputTokens: 0, outputTokens: 0 },
		};
		expect(lines(tasks, { working: ["1", "2", "3", "4"], activity }, 1).slice(1)).toEqual([
			"  ✴ #1 Surveying (agent abcde)… (1m 5s · ↑ 1.5k ↓ 999)",
			"  ✴ #2 task 2… (5s)",
			"  ✴ #3 task 3… (1h · ↑ 2k)",
			"  ✴ #4 task 4… (1h 1m)",
		]);
		expect(
			lines([task("5", "in_progress")], {
				working: ["5"],
				activity: { "5": { startedAt: now - 120_000, inputTokens: 0, outputTokens: 0 } },
			})[1],
		).toBe("  ✳ #5 task 5… (2m)");
	});

	it("names the agent of an in-progress row, and of no pending or completed row", () => {
		const agent = { metadata: { agentId: "abcdef123456" } };
		expect(
			lines([task("1", "in_progress", agent), task("2", "pending", agent), task("3", "completed", agent)]).slice(1),
		).toEqual(["  ◼ #1 task 1 (agent abcde)", "  ◻ #2 task 2", "  ✔ ~#3 task 3~"]);
	});

	it("strips escape sequences and control characters from task text, and folds its newlines", () => {
		const text = lines(
			[
				task("1", "pending", { subject: "copy\u001b]52;c;YWJj\u0007 \u001b[31mred\u001b[0m\nnext" }),
				task("2", "in_progress", { activeForm: "Working\u0007\non it" }),
			],
			{ working: ["2"], activity: { "2": { startedAt: Date.now(), inputTokens: 0, outputTokens: 0 } } },
		);
		expect(text[1]).toBe("  ◻ #1 copy red next");
		expect(text[2]).toMatch(/^ {2}✳ #2 Working on it… \(\d+s\)$/);
		expect(text.join("\n")).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
		const hostile = lines([
			task("3\u001b[2J", "in_progress", { subject: "three", metadata: { agentId: "\u001b[2Jabcdef" } }),
			task("4", "pending", { subject: "four", blockedBy: ["3\u001b[2J"] }),
		]);
		expect(hostile.slice(1)).toEqual(["  ◼ #3 three (agent abcde)", "  ◻ #4 four › blocked by #3"]);
	});

	it("clips each line to the terminal width with three dots", () => {
		const { ui, render } = componentUi();
		const widget = new TaskWidget(
			source([task("1", "pending", { subject: "a subject far longer than the terminal" })]).value,
			ui,
			false,
			() => {},
		);
		const clipped = render(24);
		expect(clipped.every((line) => visibleWidth(line) <= 24)).toBe(true);
		expect(clipped[1].replace(/\u001b\[[0-9;]*m/g, "")).toMatch(/^ {2}◻ #1 a subject.*\.\.\.$/);
		widget.dispose();
	});
});

describe("the tasks widget's options", () => {
	const many = Array.from({ length: 6 }, (_, i) => task(String(i + 1), i < 2 ? "completed" : "pending"));

	it("replaces completed rows with one count line under collapseCompleted, and applies the limit to the rest", () => {
		expect(lines(many, { settings: { collapseCompleted: true, maxVisible: 3 } })).toEqual([
			"● 6 tasks (2 done, 4 open)",
			"  ◻ #3 task 3",
			"  ◻ #4 task 4",
			"  ◻ #5 task 5",
			"    … and 1 more",
			"  ✔ 2 completed",
		]);
		expect(lines([task("1")], { settings: { collapseCompleted: true } })).toEqual([
			"● 1 tasks (1 open)",
			"  ◻ #1 task 1",
		]);
		expect(lines([task("1", "completed")], { settings: { collapseCompleted: true } })).toEqual([
			"● 1 tasks (1 done)",
			"  ✔ 1 completed",
		]);
		expect(lines(many, { settings: { collapseCompleted: false } })).toHaveLength(7);
	});

	it("caps the rows at maxVisible with an overflow line at the hidden end, unless showAll is on", () => {
		expect(lines(many, { settings: { maxVisible: 2 } }).slice(1)).toEqual([
			"  ✔ ~#1 task 1~",
			"  ✔ ~#2 task 2~",
			"    … and 4 more",
		]);
		expect(lines(many, { settings: { maxVisible: 2, hiddenAt: "top" } }).slice(1)).toEqual([
			"    … and 4 more",
			"  ◻ #5 task 5",
			"  ◻ #6 task 6",
		]);
		expect(lines(many, { settings: { maxVisible: 2, showAll: true } })).toHaveLength(7);
		expect(lines(many, { settings: { maxVisible: 10 } })).toHaveLength(7);
	});

	it("orders the rows by sortOrder", () => {
		const mixed = [task("1", "completed"), task("2"), task("3", "in_progress")];
		const ids = (order: TaskSettings["sortOrder"]) =>
			lines(mixed, { settings: { sortOrder: order } })
				.slice(1)
				.map((line) => /#(\d+)/.exec(line)?.[1]);
		expect(ids("id")).toEqual(["1", "2", "3"]);
		expect(ids("status")).toEqual(["1", "3", "2"]);
		expect(ids("active")).toEqual(["3", "2", "1"]);
	});
});

describe("the tasks widget's lifecycle", () => {
	it("registers above the editor once the list has tasks, redraws on changes, and removes itself when the list empties", async () => {
		const tasks: Task[] = [];
		const { ui, renders } = componentUi();
		const { value, changed } = source(tasks);
		const widget = new TaskWidget(value, ui, false, () => {});
		expect(ui.setWidget).not.toHaveBeenCalled();
		tasks.push(task("1"));
		changed();
		await Promise.resolve();
		expect(ui.setWidget).toHaveBeenCalledTimes(1);
		expect(ui.setWidget).toHaveBeenLastCalledWith("tasks", expect.any(Function), { placement: "aboveEditor" });
		changed();
		changed();
		changed();
		await Promise.resolve();
		expect(ui.setWidget).toHaveBeenCalledTimes(1);
		expect(renders()).toBe(1);
		tasks.splice(0);
		changed();
		await Promise.resolve();
		expect(ui.setWidget).toHaveBeenLastCalledWith("tasks", undefined);
		widget.dispose();
		expect(ui.setWidget).toHaveBeenCalledTimes(2);
	});

	it("runs the spinner timer only while a task is worked on, one frame per tick", async () => {
		vi.useFakeTimers();
		const working: string[] = ["1"];
		const tasks = [task("1", "in_progress")];
		const { ui, render, renders } = componentUi();
		const { value, changed } = source(tasks, { working });
		const widget = new TaskWidget(value, ui, false, () => {});
		expect(render()[1]).toMatch(/^ {2}✳ /);
		vi.advanceTimersByTime(150);
		expect(renders()).toBe(1);
		expect(render()[1]).toMatch(/^ {2}✴ /);
		changed();
		await Promise.resolve();
		expect(render()[1]).toMatch(/^ {2}✴ /);
		working.splice(0);
		tasks[0].status = "pending";
		changed();
		await Promise.resolve();
		const before = renders();
		vi.advanceTimersByTime(1500);
		expect(renders()).toBe(before);
		widget.dispose();
	});

	it("stops the spinner when a redraw fails in a tick, and draws nothing for a render that throws", () => {
		vi.useFakeTimers();
		const errors: unknown[] = [];
		const tui = {
			requestRender: () => {
				throw new Error("terminal gone");
			},
		} as unknown as TUI;
		let component: Component | undefined;
		const ui = {
			setWidget: (_key: string, content: unknown) => {
				if (typeof content === "function")
					component = (content as (tui: TUI, theme: WidgetTheme) => Component)(tui, MARKED);
			},
		};
		const tasks = [task("1", "in_progress")];
		const { value } = source(tasks, { working: ["1"] });
		const widget = new TaskWidget(value, ui, false, (error) => errors.push(error));
		vi.advanceTimersByTime(600);
		expect(errors).toHaveLength(1);
		value.list = () => {
			throw new Error("broken list");
		};
		expect(component?.render(80)).toEqual([]);
		widget.dispose();
	});

	it("reaches the UI no more after dispose", async () => {
		vi.useFakeTimers();
		const tasks = [task("1", "in_progress")];
		const { ui, renders } = componentUi();
		const { value, changed } = source(tasks, { working: ["1"] });
		const widget = new TaskWidget(value, ui, false, () => {});
		widget.dispose();
		expect(vi.getTimerCount()).toBe(0);
		const calls = ui.setWidget.mock.calls.length;
		changed();
		await Promise.resolve();
		vi.advanceTimersByTime(1500);
		expect(ui.setWidget.mock.calls.length).toBe(calls);
		expect(renders()).toBe(0);
	});

	it("stops without touching the UI once its service is disposed", async () => {
		vi.useFakeTimers();
		const tasks = [task("1", "in_progress")];
		const { ui, renders } = componentUi();
		const { value, changed } = source(tasks, { working: ["1"] });
		const widget = new TaskWidget(value, ui, false, () => {});
		vi.advanceTimersByTime(150);
		expect(renders()).toBe(1);
		const calls = ui.setWidget.mock.calls.length;
		value.isDisposed = true;
		vi.advanceTimersByTime(1500);
		expect(renders()).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
		changed();
		await Promise.resolve();
		widget.dispose();
		expect(ui.setWidget.mock.calls.length).toBe(calls);
	});

	it("sends plain lines in RPC mode", () => {
		const ui = { setWidget: vi.fn() };
		const widget = new TaskWidget(source([task("1", "completed")]).value, ui, true, () => {});
		expect(ui.setWidget).toHaveBeenCalledWith("tasks", ["● 1 tasks (1 done)", "  ✔ #1 task 1"], {
			placement: "aboveEditor",
		});
		widget.dispose();
	});
});
