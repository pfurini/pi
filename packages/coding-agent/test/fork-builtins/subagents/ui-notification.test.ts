// Fork-owned: the `subagent-notification` renderer (plan T9). Old pi-subagents tests at 79a7c42 this
// covers: cost-display ("the completion notification").
import { describe, expect, it } from "vitest";
import type { NotificationDetails } from "../../../src/core/fork-builtins/subagents/service/notifications.ts";
import { notificationRenderer, renderNotification } from "../../../src/core/fork-builtins/subagents/ui/notification.ts";
import type { Theme } from "../../../src/modes/interactive/theme/theme.ts";

const plain = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const tagged = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => text };

function agent(description: string, overrides: Partial<NotificationDetails> = {}): NotificationDetails {
	return {
		id: description,
		description,
		status: "completed",
		turnCount: 1,
		toolUses: 1,
		totalTokens: 1000,
		totalCost: 0,
		durationMs: 1000,
		resultPreview: "done",
		...overrides,
	};
}

const render = (details: NotificationDetails, showCost = false, expanded = false) =>
	renderNotification(details, expanded, plain, showCost);

describe("the notification renderer", () => {
	it("shows the result's first line up to 80 characters collapsed, and up to 30 lines expanded", () => {
		const long = `${"a".repeat(100)}\n${Array.from({ length: 40 }, (_, index) => `line ${index + 2}`).join("\n")}`;
		const collapsed = render(agent("long", { resultPreview: long }));
		expect(collapsed.split("\n")[2]).toBe(`  ⎿  ${"a".repeat(80)}`);
		expect(collapsed).not.toContain("a".repeat(81));
		expect(collapsed).not.toContain("line 2");

		const expanded = render(agent("long", { resultPreview: long }), false, true).split("\n");
		expect(expanded).toContain(`  ${"a".repeat(100)}`);
		expect(expanded).toContain("  line 30");
		expect(expanded).not.toContain("  line 31");
		expect(expanded.join("\n")).not.toContain("⎿");
	});

	// T18-F4: the preview is the child's output, which reached the terminal with its escape sequences.
	it("prints the description and the result without escape sequences", () => {
		const payload = "before\u001b]52;c;aW5qZWN0ZWQ=\u0007after";
		for (const expanded of [false, true]) {
			const out = render(agent(payload, { resultPreview: payload }), false, expanded);
			expect(out).not.toContain("\u001b");
			expect(out).not.toContain("\u0007");
			expect(out.match(/beforeafter/g)).toHaveLength(2);
		}
	});

	it("marks error, stopped and aborted with ✗, every other status with ✓, and steered as completed (steered)", () => {
		const heading = (status: string) =>
			renderNotification(agent("task", { status }), false, tagged, false).split("\n")[0];
		expect(heading("error")).toBe("<error>✗</error> task <dim>error</dim>");
		expect(heading("stopped")).toBe("<error>✗</error> task <dim>stopped</dim>");
		expect(heading("aborted")).toBe("<error>✗</error> task <dim>aborted</dim>");
		expect(heading("completed")).toBe("<success>✓</success> task <dim>completed</dim>");
		expect(heading("steered")).toBe("<success>✓</success> task <dim>completed (steered)</dim>");
	});

	it("names the transcript when the agent wrote one, and no transcript otherwise", () => {
		expect(render(agent("written", { outputFile: "/tmp/a.output" }))).toContain("\n  transcript: /tmp/a.output");
		expect(render(agent("unwritten"))).not.toContain("transcript:");
	});

	it("shows turns, tool uses, tokens and duration, and the cost only under showCost", () => {
		const details = agent("stats", {
			turnCount: 5,
			maxTurns: 30,
			toolUses: 3,
			totalTokens: 33_800,
			totalCost: 0.0123,
		});
		expect(render(details, false).split("\n")[1]).toBe("  ↻5≤30 · 3 tool uses · 33.8k token · 1.0s");
		expect(render(details, true).split("\n")[1]).toBe("  ↻5≤30 · 3 tool uses · 33.8k token · ~$0.0123 · 1.0s");
		expect(render(agent("one", { maxTurns: undefined })).split("\n")[1]).toBe(
			"  ↻1 · 1 tool use · 1.0k token · 1.0s",
		);
	});

	it("reads showCost at every render and draws nothing without details", () => {
		let showCost = false;
		const renderer = notificationRenderer(() => showCost);
		const message = { details: agent("priced", { totalCost: 0.01 }) } as Parameters<typeof renderer>[0];
		const lines = () =>
			renderer(message, { expanded: false, outputPad: 0 }, plain as unknown as Theme)?.render(200) ?? [];
		expect(lines().join("\n")).not.toContain("$");
		showCost = true;
		expect(lines().join("\n")).toContain("~$0.01");
		expect(
			renderer(
				{ details: undefined } as Parameters<typeof renderer>[0],
				{ expanded: false, outputPad: 0 },
				plain as unknown as Theme,
			),
		).toBeUndefined();
	});
});

describe("the completion notification", () => {
	it("totals a group, so nobody adds four figures by hand", () => {
		const out = render(
			{ ...agent("first", { totalCost: 0.01 }), others: [agent("second", { totalTokens: 3000, totalCost: 0.02 })] },
			true,
		);
		expect(out.split("\n")[0]).toBe("2 agents · 4.0k token · ~$0.03");
		expect(out).toContain("✓ first completed");
		expect(out).toContain("✓ second completed");
	});

	it("does not total a single agent — the line above already says it", () => {
		const out = render(agent("only", { totalCost: 0.01 }), true);
		expect(out).toContain("~$0.01");
		expect(out).not.toContain("1 agents");
	});

	it("shows no total, and no per-agent cost, when unpriced", () => {
		const out = render({ ...agent("first"), others: [agent("second", { totalTokens: 3000 })] }, true);
		expect(out).not.toContain("$");
		expect(out).not.toContain("2 agents");
	});

	it("shows nothing when the setting is off", () => {
		const out = render(
			{ ...agent("first", { totalCost: 0.01 }), others: [agent("second", { totalTokens: 3000, totalCost: 0.02 })] },
			false,
		);
		expect(out).not.toContain("$");
		expect(out).not.toContain("2 agents");
	});
});
