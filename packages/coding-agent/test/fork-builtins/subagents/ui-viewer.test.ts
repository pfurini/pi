// Fork-owned: the conversation viewer (plan T11), over a fake service. Old pi-subagents tests at
// 79a7c42 this covers: conversation-viewer, conversation-viewer-keybindings, agent-color-surfaces
// (the viewer header), perf/no-fs-on-render and perf/render-invariants (the viewer).
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Counters and switches for the pi-tui leaves the viewer wraps its text with. */
const tuiProbe = vi.hoisted(() => ({
	wrap: 0,
	markdownNew: 0,
	markdownRender: 0,
	markdownThrows: false,
	wrapOverride: null as ((text: string, width: number) => string[]) | null,
}));
/** Every fs entry point a frame could reach. */
const FS_CALLS: string[] = vi.hoisted(() => []);

vi.mock("@earendil-works/pi-tui", async (importOriginal) => {
	const original = await importOriginal<typeof import("@earendil-works/pi-tui")>();
	class CountingMarkdown extends original.Markdown {
		constructor(...args: ConstructorParameters<typeof original.Markdown>) {
			super(...args);
			tuiProbe.markdownNew++;
		}
		render(width: number): string[] {
			tuiProbe.markdownRender++;
			// Forced rather than reproduced: a real stack overflow is slow and depends on the platform.
			if (tuiProbe.markdownThrows) throw new RangeError("Maximum call stack size exceeded");
			return super.render(width);
		}
	}
	return {
		...original,
		Markdown: CountingMarkdown,
		wrapTextWithAnsi: (text: string, width: number) => {
			tuiProbe.wrap++;
			return tuiProbe.wrapOverride ? tuiProbe.wrapOverride(text, width) : original.wrapTextWithAnsi(text, width);
		},
	};
});

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

import { visibleWidth } from "@earendil-works/pi-tui";
import type { SubagentView } from "../../../src/core/fork-builtins/subagents/service/records.ts";
import type { SteerOutcome, SubagentEvent } from "../../../src/core/fork-builtins/subagents/service/service.ts";
import {
	DEFAULT_SUBAGENT_SETTINGS,
	type SubagentSettings,
} from "../../../src/core/fork-builtins/subagents/settings/settings.ts";
import {
	ConversationViewer,
	RESULT_MAX_CHARS,
	type ViewerSessionState,
	type ViewerSource,
} from "../../../src/core/fork-builtins/subagents/ui/viewer.ts";
import { emptyUsage } from "../../../src/core/fork-builtins/subagents/usage.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";

beforeEach(() => {
	tuiProbe.wrap = 0;
	tuiProbe.markdownNew = 0;
	tuiProbe.markdownRender = 0;
	tuiProbe.markdownThrows = false;
	tuiProbe.wrapOverride = null;
});

const KEY = {
	escape: "\x1b",
	ctrlC: "\x03",
	enter: "\r",
	up: "\x1b[A",
	down: "\x1b[B",
	pageUp: "\x1b[5~",
	pageDown: "\x1b[6~",
	home: "\x1b[H",
	end: "\x1b[F",
	ctrlP: "\x10",
	ctrlN: "\x0e",
};

const ansiTheme = {
	fg: (_color: string, text: string) => `\x1b[38;5;240m${text}\x1b[0m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};
const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

/** ANSI stripped, so an assertion reads the text and not the styling. */
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

type Message = Record<string, unknown>;
type ViewFields = Omit<Partial<SubagentView>, "usage" | "definition"> & {
	cost?: number;
	tokens?: number;
	definition?: Partial<SubagentView["definition"]>;
};

function view(fields: ViewFields = {}): SubagentView {
	const { cost = 0, tokens = 0, definition, ...rest } = fields;
	return {
		id: "agent-1",
		type: "worker",
		definition: { name: "worker", ...definition },
		description: "test agent",
		prompt: "task",
		status: "running",
		usage: { ...emptyUsage(), input: tokens, cost: { ...emptyUsage().cost, total: cost } },
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
		...rest,
	} as SubagentView;
}

/** A fake service holding one agent's conversation; `child: false` makes it an agent with no session yet. */
function source(messages: Message[] = [], settings: Partial<SubagentSettings> = {}, child = true) {
	const listeners = new Set<(event: SubagentEvent) => void>();
	const conversationListeners = new Set<() => void>();
	const fake = {
		child,
		messages,
		listeners,
		conversationListeners,
		settings: { ...DEFAULT_SUBAGENT_SETTINGS, ...settings } as SubagentSettings,
		conversation: () =>
			fake.child
				? {
						get messages() {
							return fake.messages as never;
						},
						subscribe: (listener: () => void) => {
							conversationListeners.add(listener);
							return () => conversationListeners.delete(listener);
						},
					}
				: undefined,
		contextPercent: () => undefined,
		subscribe: (listener: (event: SubagentEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		steer: vi.fn(async (): Promise<SteerOutcome> => ({ kind: "delivered" })),
		stop: vi.fn(() => true),
	};
	return fake;
}

interface MountOptions {
	messages?: Message[];
	view?: ViewFields;
	settings?: Partial<SubagentSettings>;
	keybindings?: KeybindingsManager;
	rows?: number;
	state?: ViewerSessionState;
	theme?: object;
	child?: boolean;
}

function mount(options: MountOptions = {}) {
	const tui = { terminal: { rows: options.rows ?? 30, columns: 80 }, requestRender: vi.fn() };
	const done = vi.fn();
	const fake = source(options.messages, options.settings, options.child ?? true);
	const subject = view(options.view);
	const viewer = new ConversationViewer({
		tui: tui as never,
		theme: (options.theme ?? ansiTheme) as never,
		keybindings: options.keybindings ?? new KeybindingsManager(),
		source: fake as unknown as ViewerSource,
		view: subject,
		state: options.state ?? {},
		done,
	});
	return { viewer, tui, done, fake, view: subject };
}

/** The private content builder, which the frame clamps again: the safety net must hold on its own. */
const contentLines = (viewer: ConversationViewer, width: number): string[] =>
	(viewer as unknown as { buildContentLines(width: number): string[] }).buildContentLines(width);

/** The rows between the header rule and the footer rule, without their border. */
function body(viewer: ConversationViewer, width = 80): string[] {
	const lines = viewer.render(width).map(strip);
	const rules = lines.flatMap((line, index) => (/^│ ─+ │$/.test(line) ? [index] : []));
	return lines.slice(rules[0] + 1, rules[1]).map((line) => line.slice(2, -2).trimEnd());
}

function assertAllLinesFit(lines: string[], width: number) {
	for (const [index, line] of lines.entries()) {
		expect(visibleWidth(line), `line ${index} exceeds ${width}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(width);
	}
}

const assistant = (text: string): Message[] => [{ role: "assistant", content: [{ type: "text", text }] }];
const result = (text: string): Message[] => [{ role: "toolResult", content: [{ type: "text", text }] }];
const users = (count: number): Message[] =>
	Array.from({ length: count }, (_, index) => ({ role: "user", content: `message ${index}` }));

describe("the viewer's invocation line", () => {
	function invocationLine(fields: ViewFields): string {
		const row = mount({ view: fields, theme: plainTheme })
			.viewer.render(200)
			.find((line) => line.includes("↳"));
		return row ? row.slice(row.indexOf("↳")).replace(/\s*│\s*$/, "") : "";
	}

	it("names the model with its provider", () => {
		expect(
			invocationLine({
				model: {
					provider: "anthropic",
					id: "claude-sonnet-4-6",
					name: "Claude Sonnet 4.6",
				} as SubagentView["model"],
				invocation: {
					modelFromParams: false,
					inheritContext: false,
					runInBackground: false,
					isolated: false,
					thinking: "high",
					maxTurns: 60,
				},
			}),
		).toBe("↳ anthropic/claude-sonnet-4-6 · thinking: high · max turns: 60");
	});

	it("falls back to the short label when the model names no provider", () => {
		expect(
			invocationLine({
				model: { provider: "", id: "sonnet-4-6", name: "Sonnet 4.6" } as SubagentView["model"],
				invocation: {
					modelFromParams: false,
					inheritContext: false,
					runInBackground: false,
					isolated: false,
					thinking: "high",
				},
			}),
		).toBe("↳ sonnet 4.6 · thinking: high");
	});

	it("discloses a model and level the run did not honor", () => {
		expect(
			invocationLine({
				effective: {
					model: {
						provider: "anthropic",
						id: "claude-haiku-4-5",
						name: "Claude Haiku 4.5",
					} as SubagentView["model"],
					thinking: "low",
				},
				invocation: {
					modelFromParams: true,
					inheritContext: false,
					runInBackground: false,
					isolated: false,
					thinking: "low",
					overridden: { model: "google/gemini-3-pro", thinking: "max" },
				},
			}),
		).toBe("↳ anthropic/claude-haiku-4-5 (asked google/gemini-3-pro) · thinking: low (asked max)");
	});

	it("renders no row at all for an agent with no model and no invocation tags", () => {
		expect(
			invocationLine({
				invocation: { modelFromParams: false, inheritContext: false, runInBackground: false, isolated: false },
			}),
		).toBe("");
	});
});

describe("the viewer's cost display", () => {
	const header = (showCost: boolean, cost: number) =>
		mount({ view: { tokens: 1200, cost }, settings: { showCost }, theme: plainTheme })
			.viewer.render(200)
			.join("\n");

	it("shows the cost beside the token count when enabled", () => {
		const out = header(true, 0.0042);
		expect(out).toContain("1.2k token · ~$0.0042");
	});

	it("shows no cost when disabled", () => {
		const out = header(false, 0.0042);
		expect(out).toContain("1.2k token");
		expect(out).not.toContain("$");
	});

	it("shows no cost for a model with no pricing data", () => {
		expect(header(true, 0)).not.toContain("$");
	});
});

describe("the conversation viewer", () => {
	it("closes on tui.select.cancel when not composing, and stops listening", () => {
		for (const key of [KEY.ctrlC, KEY.escape]) {
			const { viewer, done, fake } = mount();
			viewer.handleInput(key);
			expect(done).toHaveBeenCalledOnce();
			expect(fake.listeners.size).toBe(0);
			expect(fake.conversationListeners.size).toBe(0);
		}
	});

	it("shows the header with the status, the display name in its color, and the stats", () => {
		const { viewer } = mount({
			view: {
				toolUses: 3,
				tokens: 1200,
				definition: { name: "reviewer", displayName: "Code Reviewer", color: "purple" },
			},
			theme: { ...plainTheme, getColorMode: () => "truecolor" },
		});
		const header = viewer.render(120)[1];
		expect(header).toContain("\u001b[48;2;130;125;189m");
		expect(header).toContain(" Code Reviewer ");
		expect(strip(header)).toMatch(/● {2}Code Reviewer {3}test agent · 3 tools · \d+\.\ds \(running\) · 1\.2k token/);
	});

	// T18-F4: a child's output reached the terminal with its escape sequences.
	it("prints a child's messages without their escape sequences, in every Markdown mode", () => {
		const payload = "before\u001b]52;c;aW5qZWN0ZWQ=\u0007mid\u001b[2Aafter";
		const messages: Message[] = [
			{ role: "user", content: payload },
			...assistant(payload),
			...result(payload),
			{ role: "bashExecution", command: "cat", output: payload } as unknown as Message,
		];
		for (const viewerMarkdown of ["off", "assistant", "all"] as const) {
			const { viewer } = mount({ messages, settings: { viewerMarkdown }, rows: 200, theme: plainTheme });
			const out = viewer.render(120).join("\n");
			expect(out, viewerMarkdown).not.toContain("\u001b]52");
			expect(out, viewerMarkdown).not.toContain("\u0007");
			expect(out, viewerMarkdown).not.toContain("\u001b[2A");
			expect(out.match(/beforemidafter/g)?.length, viewerMarkdown).toBeGreaterThanOrEqual(4);
		}
	});

	describe("render width safety", () => {
		const widths = [40, 80, 120, 216];
		const fits = (messages: Message[], fields: ViewFields = {}, sizes = widths) => {
			for (const width of sizes) assertAllLinesFit(mount({ messages, view: fields }).viewer.render(width), width);
		};

		it("no line exceeds width with empty messages", () => fits([]));

		it("no line exceeds width with plain text messages", () =>
			fits([{ role: "user", content: "Hello, how are you?" }, ...assistant("I am fine, thank you for asking.")]));

		it("keeps bordered rows exact-width at a double-width truncation boundary", () => {
			const width = 40;
			for (let prefix = 0; prefix < width; prefix++) {
				for (const line of mount({ view: { description: `${"a".repeat(prefix)}界more` } }).viewer.render(width)) {
					expect(visibleWidth(line), `prefix ${prefix}: ${JSON.stringify(line)}`).toBe(width);
				}
			}
		});

		it("no line exceeds width when text is longer than viewport", () => {
			const long = "A".repeat(500);
			fits([{ role: "user", content: long }, ...assistant(long), ...result(long)]);
		});

		it("no line exceeds width with embedded ANSI escape codes in content", () =>
			fits(result(`\x1b[1mBold heading\x1b[22m and \x1b[31mred text\x1b[0m ${"X".repeat(300)}`)));

		it("no line exceeds width with long URLs", () =>
			fits(assistant(`Check this link: https://example.com/${"a/b/c/d/e/".repeat(30)}?q=${"x".repeat(100)}`)));

		it("no line exceeds width with wide table-like content", () => {
			const header = `| ${Array.from({ length: 20 }, (_, index) => `Column${index}`).join(" | ")} |`;
			const row = `| ${Array.from({ length: 20 }, () => "value123").join(" | ")} |`;
			fits(result([header, row, row, row].join("\n")));
		});

		it("no line exceeds width with bashExecution messages", () =>
			fits([
				{ role: "bashExecution", command: `cat ${"/very/long/path/".repeat(20)}file.txt`, output: "O".repeat(600) },
			]));

		it("no line exceeds width with running activity indicator", () =>
			fits([{ role: "user", content: "do the thing" }, ...assistant("R".repeat(400))], {
				activity: [
					{ type: "tool_start", toolName: "read" },
					{ type: "tool_start", toolName: "grep" },
				] as SubagentView["activity"],
			}));

		it("no line exceeds width with tool calls", () =>
			fits([
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Let me check that." },
						{ type: "toolCall", id: "t1", name: `very_long_tool_name_${"x".repeat(200)}`, arguments: {} },
					],
				},
			]));

		it("no line exceeds width at narrow terminal", () =>
			fits(
				[
					{ role: "user", content: "Hello world, this is a normal sentence." },
					...assistant("Sure, here's the answer."),
				],
				{},
				[8, 10, 15, 20],
			));

		it("no line exceeds width with mixed ANSI + unicode content", () =>
			fits(result(`\x1b[32m✓\x1b[0m Test passed — 日本語テスト ${"あ".repeat(50)} \x1b[33m⚠\x1b[0m`)));
	});

	describe("safety net against an overwidth wrap", () => {
		// Raw mode, so assistant text too takes the literal wrap the override replaces.
		const clamps = (messages: Message[], line: string) => {
			tuiProbe.wrapOverride = () => [line];
			assertAllLinesFit(contentLines(mount({ messages, settings: { viewerMarkdown: "off" } }).viewer, 80), 80);
		};

		it("clamps overwidth lines from toolResult content", () => clamps(result("output"), "X".repeat(130)));
		it("clamps overwidth lines from user message content", () =>
			clamps([{ role: "user", content: "hello" }], "Y".repeat(180)));
		it("clamps overwidth lines from assistant message content", () => clamps(assistant("response"), "Z".repeat(180)));
		it("clamps overwidth lines from bashExecution output", () =>
			clamps([{ role: "bashExecution", command: "ls", output: "out" }], "B".repeat(180)));
		it("clamps overwidth lines that also contain ANSI codes", () =>
			clamps(result("output"), `\x1b[1m\x1b[31m${"W".repeat(110)}\x1b[0m`));
	});

	describe("Markdown rendering", () => {
		const text = (messages: Message[], viewerMarkdown?: "off" | "assistant" | "all", rows = 200) =>
			strip(
				mount({
					messages,
					rows,
					view: { status: "completed", completedAt: Date.now() },
					settings: viewerMarkdown ? { viewerMarkdown } : {},
				})
					.viewer.render(80)
					.join("\n"),
			);

		it("renders assistant Markdown by default instead of raw source markers", () => {
			const out = text(assistant("# Heading\n\n- first\n- second\n\n**bold**"));
			expect(out).toContain("Heading");
			expect(out).not.toContain("# Heading");
			expect(out).not.toContain("**bold**");
			expect(out).toContain("bold");
		});

		it("leaves assistant text verbatim under `off`", () => {
			const out = text(assistant("# Heading\n\n**bold**"), "off");
			expect(out).toContain("# Heading");
			expect(out).toContain("**bold**");
		});

		it("leaves tool results byte-exact under the default mode", () => {
			const raw = ["#!/bin/sh", "# section", "3) alpha", "7) beta", "9) gamma", "Section", "---", "next"].join("\n");
			const out = text(result(raw));
			for (const line of raw.split("\n")) expect(out).toContain(line);
		});

		it("renders tool-result Markdown under `all`", () => {
			const out = text(result("## ctx_execute\n\n- one\n- two"), "all");
			expect(out).toContain("ctx_execute");
			expect(out).not.toContain("## ctx_execute");
		});

		it("does not renumber ordered lists even when it does render them", () => {
			const out = text(result("3) alpha\n7) beta\n9) gamma"), "all");
			expect(out).toContain("3) alpha");
			expect(out).not.toContain("4. beta");
		});

		it("keeps tool results dim even when rendering them as Markdown", () => {
			const { viewer } = mount({ messages: result("plain result text"), settings: { viewerMarkdown: "all" } });
			const line = contentLines(viewer, 76).find((entry) => strip(entry).includes("plain result text"));
			expect(line).toContain("\x1b[38;5;240m");
		});

		it("keeps tool results dim on the literal path too", () => {
			const { viewer } = mount({ messages: result("plain result text") });
			const line = contentLines(viewer, 76).find((entry) => strip(entry).includes("plain result text"));
			expect(line).toContain("\x1b[38;5;240m");
		});

		it("renders Markdown to fit, so the overwidth clamp never has to cut it", () => {
			const source = `# ${"Heading ".repeat(20)}\n\n| a | b |\n|---|---|\n| ${"x".repeat(90)} | 2 |\n\n\`\`\`js\nconst x = ${"1".repeat(120)};\n\`\`\``;
			for (const width of [20, 40, 80, 120]) {
				const finished = { status: "completed" as const, completedAt: Date.now() };
				const content = contentLines(mount({ messages: assistant(source), view: finished }).viewer, width);
				assertAllLinesFit(content, width);
				expect(content.filter((line) => strip(line).endsWith("..."))).toEqual([]);
			}
		});

		it("cycles the mode with its key for the session, and shows it in the footer", () => {
			const state: ViewerSessionState = {};
			const { viewer } = mount({
				messages: assistant("# Heading"),
				state,
				view: { status: "completed" },
				rows: 200,
			});
			expect(strip(viewer.render(80).join("\n"))).toContain("m md");
			viewer.handleInput("m");
			expect(state.markdownMode).toBe("all");
			expect(strip(viewer.render(80).join("\n"))).toContain("m md+");
			viewer.handleInput("m");
			const off = strip(viewer.render(80).join("\n"));
			expect(off).toContain("m raw");
			expect(off).toContain("# Heading");
			viewer.handleInput("m");
			expect(state.markdownMode).toBe("assistant");
		});

		it("opens a later viewer of the session in the mode the key chose, over the setting", () => {
			const state: ViewerSessionState = {};
			mount({ state }).viewer.handleInput("m");
			mount({ state }).viewer.handleInput("m");
			const later = mount({
				messages: assistant("# Heading"),
				state,
				settings: { viewerMarkdown: "assistant" },
				view: { status: "completed", completedAt: Date.now() },
				rows: 200,
			});
			expect(strip(later.viewer.render(80).join("\n"))).toContain("# Heading");
		});

		it("keeps the footer's navigation hints intact at 80 columns", () => {
			const lines = mount({ messages: assistant("hi"), rows: 200 }).viewer.render(80);
			const footer = strip(lines[lines.length - 2]);
			for (const hint of ["Enter steer", "x stop", "m md", "↑↓ scroll", "PgUp/PgDn", "Esc close"]) {
				expect(footer).toContain(hint);
			}
		});

		it("caps a tool result at RESULT_MAX_CHARS, not 500, and says what it dropped", () => {
			const lines = Array.from({ length: 3000 }, (_, index) => `line ${index}`);
			const out = text(result(lines.join("\n")), undefined, 4000);
			expect(out).toContain("line 100");
			expect(out).not.toContain("line 2999");
			expect(out).toMatch(/\.\.\. \(truncated, [\d.]+[kM]? more characters\)/);
		});

		it("puts the truncation notice outside the code fence it cut into", () => {
			const { viewer } = mount({
				messages: result(`\`\`\`js\n${"const a = 1;\n".repeat(2000)}\`\`\``),
				settings: { viewerMarkdown: "all" },
			});
			const note = contentLines(viewer, 76)
				.map(strip)
				.find((line) => line.includes("... (truncated"));
			expect(note).toMatch(/^\.\.\. \(truncated, [\d.]+[kM]? more characters\)$/);
		});

		it("reports the exact omitted character count", () => {
			const { viewer } = mount({ messages: result(`${"x".repeat(RESULT_MAX_CHARS)}😀x`) });
			expect(contentLines(viewer, 76).map(strip)).toContain("... (truncated, 3 more characters)");
		});

		it("abbreviates a large omitted count so the notice fits a narrow frame", () => {
			const { viewer } = mount({ messages: result(`${"x".repeat(RESULT_MAX_CHARS)}${"y".repeat(1_100_000)}`) });
			const note = viewer
				.render(50)
				.map(strip)
				.find((line) => line.includes("truncated,"));
			expect(note).toContain("1.1M more characters)");
		});

		it("rounds into the M bracket rather than reporting 1000k", () => {
			const { viewer } = mount({ messages: result(`${"x".repeat(RESULT_MAX_CHARS)}${"y".repeat(999_999)}`) });
			const note = strip(viewer.render(80).join("\n"))
				.split("\n")
				.find((line) => line.includes("truncated,"));
			expect(note).toContain("1M more characters");
		});

		it("tracks a tool result that keeps growing past the cap", () => {
			const message = { role: "toolResult", content: [{ type: "text", text: "row\n".repeat(4500) }] };
			const { viewer } = mount({ messages: [message] });
			const elided = () => {
				const match = strip(contentLines(viewer, 76).join("\n")).match(/truncated, ([\d.]+)([kM]?) more/);
				return Number(match?.[1]) * (match?.[2] === "M" ? 1e6 : match?.[2] === "k" ? 1e3 : 1);
			};
			const before = elided();
			message.content[0].text += "row\n".repeat(1000);
			expect(before).toBeGreaterThan(0);
			expect(elided()).toBeGreaterThan(before);
			expect(tuiProbe.markdownNew).toBe(0);
		});

		it("leaves a result under the cap untouched", () => {
			const source = `head\n${"filler line\n".repeat(200)}tail`;
			const out = text(result(source), undefined, 600);
			expect(source.length).toBeLessThan(RESULT_MAX_CHARS);
			expect(out).toContain("head");
			expect(out).toContain("tail");
			expect(out).not.toContain("truncated");
		});

		it("caps bash output with the same rule as a tool result", () => {
			const out = text([{ role: "bashExecution", command: "yes", output: "y\n".repeat(20000) }]);
			expect(out).toMatch(/\.\.\. \(truncated, [\d.]+[kM]? more characters\)/);
		});

		it("falls back to literal wrapping once for an unsafe streaming prefix", () => {
			const messages = result("# heading");
			const { viewer } = mount({ messages, settings: { viewerMarkdown: "all" }, rows: 200 });
			tuiProbe.markdownThrows = true;
			expect(() => viewer.render(80)).not.toThrow();
			expect(strip(viewer.render(80).join("\n"))).toContain("# heading");

			const content = (messages[0].content as Array<{ text: string }>)[0];
			content.text += "\nmore";
			expect(strip(viewer.render(80).join("\n"))).toContain("more");
			expect(tuiProbe.markdownRender).toBe(1);

			tuiProbe.markdownThrows = false;
			expect(strip(viewer.render(80).join("\n"))).toContain("# heading");
			expect(tuiProbe.markdownRender).toBe(1);

			content.text = "## safe";
			const replaced = strip(viewer.render(80).join("\n"));
			expect(tuiProbe.markdownRender).toBe(2);
			expect(replaced).toContain("safe");
			expect(replaced).not.toContain("## safe");
		});

		it("reuses one Markdown per message across renders", () => {
			const { viewer } = mount({ messages: assistant("# Heading") });
			viewer.render(80);
			const afterFirst = tuiProbe.markdownNew;
			viewer.render(80);
			viewer.render(80);
			expect(afterFirst).toBe(1);
			expect(tuiProbe.markdownNew).toBe(afterFirst);
		});

		it("re-renders a message whose text is still streaming", () => {
			const messages = assistant("# One");
			const { viewer } = mount({ messages, rows: 200 });
			expect(strip(viewer.render(80).join("\n"))).toContain("One");
			(messages[0].content as Array<{ text: string }>)[0].text = "# Two";
			const out = strip(viewer.render(80).join("\n"));
			expect(out).toContain("Two");
			expect(out).not.toContain("One");
			expect(tuiProbe.markdownNew).toBe(1);
		});
	});

	describe("stop key", () => {
		it("stops a running agent on the second press of app.subagents.stop", () => {
			const { viewer, tui, fake } = mount();
			expect(strip(viewer.render(80).join("\n"))).toContain("x stop");
			viewer.handleInput("x");
			expect(fake.stop).not.toHaveBeenCalled();
			expect(tui.requestRender).toHaveBeenCalled();
			expect(strip(viewer.render(80).join("\n"))).toContain("x again to STOP");
			viewer.handleInput("x");
			expect(fake.stop).toHaveBeenCalledExactlyOnceWith("agent-1");
		});

		it("any other key disarms the confirm", () => {
			const { viewer, fake } = mount();
			viewer.handleInput("x");
			viewer.handleInput(KEY.down);
			const out = strip(viewer.render(80).join("\n"));
			expect(out).toContain("x stop");
			expect(out).not.toContain("x again to STOP");
			viewer.handleInput("x");
			expect(fake.stop).not.toHaveBeenCalled();
		});

		it("the Markdown key disarms a pending stop rather than confirming it", () => {
			const { viewer, fake } = mount();
			viewer.handleInput("x");
			viewer.handleInput("m");
			viewer.handleInput("x");
			expect(fake.stop).not.toHaveBeenCalled();
		});

		it("forgets a pending stop when the run ends, so a resumed run needs both presses", () => {
			const { viewer, fake, view: subject } = mount();
			const record = subject as { status: SubagentView["status"] };
			viewer.handleInput("x");
			record.status = "completed";
			for (const listener of fake.listeners) listener({ type: "ended", record: subject });
			record.status = "running";
			for (const listener of fake.listeners) listener({ type: "started", record: subject });
			expect(strip(viewer.render(80).join("\n"))).toContain("x stop");
			viewer.handleInput("x");
			expect(fake.stop).not.toHaveBeenCalled();
			viewer.handleInput("x");
			expect(fake.stop).toHaveBeenCalledOnce();
		});

		it("does not offer or perform stop once the agent is no longer running", () => {
			const { viewer, fake } = mount({ view: { status: "completed", completedAt: Date.now() } });
			expect(strip(viewer.render(80).join("\n"))).not.toContain("x stop");
			viewer.handleInput("x");
			viewer.handleInput("x");
			expect(fake.stop).not.toHaveBeenCalled();
		});
	});

	describe("steer composer", () => {
		it("offers the steer affordance for a running agent and opens on Enter", () => {
			const { viewer } = mount();
			expect(strip(viewer.render(80).join("\n"))).toContain("Enter steer");
			viewer.handleInput(KEY.enter);
			const out = strip(viewer.render(80).join("\n"));
			expect(out).toContain("Enter send · Esc cancel");
			expect(out).not.toContain("Enter steer");
		});

		it("typing then Enter sends the trimmed message and closes the composer", () => {
			const { viewer, fake } = mount();
			viewer.handleInput(KEY.enter);
			for (const character of "  hello  ") viewer.handleInput(character);
			viewer.handleInput(KEY.enter);
			expect(fake.steer).toHaveBeenCalledExactlyOnceWith("agent-1", "hello");
			expect(strip(viewer.render(80).join("\n"))).not.toContain("Enter send");
		});

		it("Esc cancels the composer without sending", () => {
			const { viewer, fake } = mount();
			viewer.handleInput(KEY.enter);
			for (const character of "draft") viewer.handleInput(character);
			viewer.handleInput(KEY.escape);
			expect(fake.steer).not.toHaveBeenCalled();
			expect(strip(viewer.render(80).join("\n"))).not.toContain("Enter send");
		});

		it("an empty submit just returns, without steering", () => {
			const { viewer, fake } = mount();
			viewer.handleInput(KEY.enter);
			viewer.handleInput(KEY.enter);
			expect(fake.steer).not.toHaveBeenCalled();
			expect(strip(viewer.render(80).join("\n"))).not.toContain("Enter send");
		});

		it("scroll keys are inert while composing (input owns them)", () => {
			const { viewer } = mount({ messages: users(60), rows: 20 });
			const before = body(viewer);
			viewer.handleInput(KEY.enter);
			viewer.handleInput(KEY.up);
			viewer.handleInput(KEY.pageUp);
			expect(strip(viewer.render(80).join("\n"))).toContain("Enter send · Esc cancel");
			viewer.handleInput(KEY.escape);
			expect(body(viewer)).toEqual(before);
		});

		it("no steer affordance once the agent is no longer running", () => {
			const { viewer, fake } = mount({ view: { status: "completed", completedAt: Date.now() } });
			expect(strip(viewer.render(80).join("\n"))).not.toContain("Enter steer");
			viewer.handleInput(KEY.enter);
			expect(strip(viewer.render(80).join("\n"))).not.toContain("Enter send");
			expect(fake.steer).not.toHaveBeenCalled();
		});

		it("composer rows never exceed width", () => {
			for (const width of [40, 80, 120]) {
				const { viewer } = mount();
				viewer.handleInput(KEY.enter);
				for (const character of "x".repeat(200)) viewer.handleInput(character);
				assertAllLinesFit(viewer.render(width), width);
			}
		});

		it("shows the error of a steer that failed to deliver, until the next key", async () => {
			const { viewer, fake, tui } = mount();
			fake.steer.mockResolvedValueOnce({ kind: "failed", error: "Extension command not allowed" });
			viewer.handleInput(KEY.enter);
			for (const character of "/probe-cmd") viewer.handleInput(character);
			viewer.handleInput(KEY.enter);
			tui.requestRender.mockClear();
			await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalled());
			expect(strip(viewer.render(80).join("\n"))).toContain("Failed to steer agent: Extension command not allowed");
			viewer.handleInput(KEY.down);
			expect(strip(viewer.render(80).join("\n"))).not.toContain("Failed to steer agent");
		});

		// T18-F4 review: a steer's failure is the child's text, which kept its escape sequences.
		it("shows a failed steer's error without its escape sequences", async () => {
			const { viewer, fake, tui } = mount({ theme: plainTheme });
			fake.steer.mockResolvedValueOnce({ kind: "failed", error: "before\u001b]52;c;aW5qZWN0ZWQ=\u0007after" });
			viewer.handleInput(KEY.enter);
			for (const character of "hurry") viewer.handleInput(character);
			viewer.handleInput(KEY.enter);
			tui.requestRender.mockClear();
			await vi.waitFor(() => expect(tui.requestRender).toHaveBeenCalled());
			const out = viewer.render(80).join("\n");
			expect(out).toContain("Failed to steer agent: beforeafter");
			expect(out).not.toContain("\u001b]52");
		});
	});

	describe("keys from the keybinding manager", () => {
		const emacs = () =>
			new KeybindingsManager({ "tui.select.up": ["up", "ctrl+p"], "tui.select.down": ["down", "ctrl+n"] });

		it("honors user keybindings when a manager has them", () => {
			const { viewer } = mount({ messages: users(60), rows: 20, keybindings: emacs() });
			const bottom = body(viewer);
			viewer.handleInput(KEY.ctrlP);
			const up = body(viewer);
			expect(up).not.toEqual(bottom);
			expect(up.slice(1)).toEqual(bottom.slice(0, -1));
			viewer.handleInput(KEY.up);
			viewer.handleInput(KEY.ctrlN);
			viewer.handleInput(KEY.down);
			expect(body(viewer)).toEqual(bottom);
		});

		it("a manager with no user overrides behaves as the defaults", () => {
			const { viewer } = mount({ messages: users(60), rows: 20 });
			const bottom = body(viewer);
			viewer.handleInput(KEY.ctrlP);
			expect(body(viewer)).toEqual(bottom);
			viewer.handleInput(KEY.pageUp);
			const page = body(viewer);
			expect(page).not.toEqual(bottom);
			viewer.handleInput(KEY.pageDown);
			expect(body(viewer)).toEqual(bottom);
		});

		it("respects a rebinding that removes a default key", () => {
			const { viewer } = mount({
				messages: users(60),
				rows: 20,
				keybindings: new KeybindingsManager({ "tui.select.up": "ctrl+p" }),
			});
			const bottom = body(viewer);
			viewer.handleInput(KEY.up);
			expect(body(viewer)).toEqual(bottom);
			viewer.handleInput(KEY.ctrlP);
			expect(body(viewer)).not.toEqual(bottom);
		});

		it("stops with app.subagents.stop rebound to s, and names the key in the footer", () => {
			const { viewer, fake } = mount({ keybindings: new KeybindingsManager({ "app.subagents.stop": "s" }) });
			expect(strip(viewer.render(80).join("\n"))).toContain("s stop");
			viewer.handleInput("x");
			viewer.handleInput("x");
			expect(fake.stop).not.toHaveBeenCalled();
			viewer.handleInput("s");
			viewer.handleInput("s");
			expect(fake.stop).toHaveBeenCalledOnce();
		});
	});

	describe("scrolling", () => {
		it("jumps to the top and the bottom with app.subagents.top and app.subagents.bottom", () => {
			const { viewer } = mount({ messages: users(60), rows: 20 });
			expect(body(viewer).join("\n")).toContain("message 59");
			viewer.handleInput(KEY.home);
			expect(body(viewer)[0]).toBe("[User]");
			expect(body(viewer)[1]).toBe("message 0");
			viewer.handleInput(KEY.end);
			expect(body(viewer).join("\n")).toContain("message 59");
		});

		it("follows new messages until the user scrolls up, and again from the bottom", () => {
			const { viewer, fake } = mount({ messages: users(60), rows: 20 });
			viewer.render(80);
			fake.messages.push({ role: "user", content: "message 60" });
			expect(body(viewer).join("\n")).toContain("message 60");
			viewer.handleInput(KEY.up);
			fake.messages.push({ role: "user", content: "message 61" });
			expect(body(viewer).join("\n")).not.toContain("message 61");
			viewer.handleInput(KEY.end);
			fake.messages.push({ role: "user", content: "message 62" });
			expect(body(viewer).join("\n")).toContain("message 62");
		});
	});

	describe("live updates", () => {
		it("renders a new child message without reopening", () => {
			const { viewer, fake, tui } = mount({ messages: assistant("first answer"), rows: 200 });
			expect(strip(viewer.render(80).join("\n"))).toContain("first answer");
			fake.messages.push(...assistant("second answer"));
			for (const listener of fake.conversationListeners) listener();
			expect(tui.requestRender).toHaveBeenCalled();
			expect(strip(viewer.render(80).join("\n"))).toContain("second answer");
		});

		it("follows a queued agent's conversation once its child attaches", () => {
			const { viewer, fake, tui, view: subject } = mount({ child: false, view: { status: "queued" }, rows: 200 });
			expect(strip(viewer.render(80).join("\n"))).toContain("(waiting for first message...)");
			fake.child = true;
			fake.messages.push(...assistant("started now"));
			for (const listener of fake.listeners) listener({ type: "progress", record: subject });
			expect(fake.conversationListeners.size).toBe(1);
			tui.requestRender.mockClear();
			for (const listener of fake.conversationListeners) listener();
			expect(tui.requestRender).toHaveBeenCalled();
			expect(strip(viewer.render(80).join("\n"))).toContain("started now");
		});
	});
});

describe("the viewer's render cost", () => {
	const PARAGRAPH = "Some prose that wraps across a few lines at 120 columns. ".repeat(4);
	function transcript(count: number): Message[] {
		return Array.from({ length: count }, (_, index) =>
			index % 3 === 0
				? { role: "user", content: `Message ${index}: ${PARAGRAPH}` }
				: index % 3 === 1
					? {
							role: "assistant",
							content: [
								{ type: "text", text: `## Step ${index}\n\n- one\n- **two**\n\n\`code\`` },
								{ type: "toolCall", id: `t${index}`, name: "read", arguments: {} },
							],
						}
					: { role: "toolResult", content: [{ type: "text", text: `${PARAGRAPH}(result ${index})` }] },
		);
	}
	function workFor(count: number, viewerMarkdown: "off" | "assistant"): number {
		const { viewer } = mount({ messages: transcript(count), settings: { viewerMarkdown }, rows: 40 });
		viewer.render(120);
		tuiProbe.wrap = 0;
		tuiProbe.markdownRender = 0;
		viewer.render(120);
		return tuiProbe.wrap + tuiProbe.markdownRender;
	}

	it("does ~10x the work for 10x the messages (raw wrap path)", () => {
		const small = workFor(30, "off");
		expect(small).toBeGreaterThan(0);
		expect(workFor(300, "off") / small).toBeLessThanOrEqual(11);
	});

	it("does ~10x the work for 10x the messages (markdown path)", () => {
		const small = workFor(30, "assistant");
		expect(small).toBeGreaterThan(0);
		expect(workFor(300, "assistant") / small).toBeLessThanOrEqual(11);
	});

	it("re-renders without re-parsing: the Markdown cache survives a frame", () => {
		const { viewer } = mount({ messages: transcript(30), rows: 40 });
		viewer.render(120);
		const constructed = tuiProbe.markdownNew;
		viewer.render(120);
		expect(constructed).toBeGreaterThan(0);
		expect(tuiProbe.markdownNew).toBe(constructed);
	});

	it("touches no file while it renders a frame", () => {
		const { viewer } = mount({ messages: transcript(40), rows: 40 });
		viewer.render(120);
		FS_CALLS.length = 0;
		viewer.render(120);
		viewer.render(120);
		expect(FS_CALLS).toEqual([]);
	});
});
