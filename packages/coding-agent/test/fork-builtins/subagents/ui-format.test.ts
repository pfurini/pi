// Fork-owned: the presentation's formats (plan T7). Old pi-subagents tests at 79a7c42 this covers:
// agent-widget (formatSessionTokens, formatCost) and fleet-list (formatFleetElapsed, formatFleetTokens).
import { describe, expect, it } from "vitest";
import {
	activeTools,
	describeActivity,
	describeModel,
	fgPreservingNestedStyles,
	formatCost,
	formatFleetElapsed,
	formatFleetTokens,
	formatMs,
	formatSessionTokens,
	formatTokenCount,
	formatTurns,
	statusIcon,
} from "../../../src/core/fork-builtins/subagents/ui/format.ts";

const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>`, bold: (text: string) => text };
const ansiTheme = {
	fg: (color: string, text: string) => {
		const codes: Record<string, string> = { dim: "2", warning: "33", accent: "35" };
		return `\u001b[${codes[color] ?? "31"}m${text}\u001b[39m`;
	},
	bold: (text: string) => text,
};

describe("formatSessionTokens", () => {
	it("applies threshold colors (<70 dim, 70–85 warning, ≥85 error)", () => {
		expect(formatSessionTokens(1234, undefined, theme)).toBe("1.2k token");
		expect(formatSessionTokens(1234, 50, theme)).toBe("1.2k token (<dim>50%</dim>)");
		expect(formatSessionTokens(1234, 70, theme)).toBe("1.2k token (<warning>70%</warning>)");
		expect(formatSessionTokens(1234, 84, theme)).toBe("1.2k token (<warning>84%</warning>)");
		expect(formatSessionTokens(1234, 85, theme)).toBe("1.2k token (<error>85%</error>)");
		expect(formatSessionTokens(1234, 99, theme)).toBe("1.2k token (<error>99%</error>)");
	});

	it("annotates compaction count alongside percent", () => {
		expect(formatSessionTokens(1234, undefined, theme, 1)).toBe("1.2k token (<dim>⇊1</dim>)");
		expect(formatSessionTokens(1234, undefined, theme, 3)).toBe("1.2k token (<dim>⇊3</dim>)");
		expect(formatSessionTokens(1234, 45, theme, 2)).toBe("1.2k token (<dim>45%</dim> · <dim>⇊2</dim>)");
		expect(formatSessionTokens(1234, 88, theme, 4)).toBe("1.2k token (<error>88%</error> · <dim>⇊4</dim>)");
		expect(formatSessionTokens(1234, 45, theme, 0)).toBe("1.2k token (<dim>45%</dim>)");
	});

	it("preserves the outer style after nested annotation styles reset", () => {
		const tokens = formatSessionTokens(1234, 70, ansiTheme);
		expect(fgPreservingNestedStyles(ansiTheme, "accent", tokens)).toBe(
			"\u001b[35m1.2k token (\u001b[33m70%\u001b[39m\u001b[35m)\u001b[39m",
		);
	});
});

describe("formatCost", () => {
	it("keeps the precision that distinguishes one run from another", () => {
		expect(formatCost(0.0042)).toBe("~$0.0042");
		expect(formatCost(0.0123)).toBe("~$0.0123");
		expect(formatCost(1.239)).toBe("~$1.24");
	});

	it("never pads a round figure with noise, nor cuts it below cents", () => {
		expect(formatCost(0.05)).toBe("~$0.05");
		expect(formatCost(0.4)).toBe("~$0.40");
		expect(formatCost(12)).toBe("~$12.00");
	});

	it("shows nothing when there is nothing to show", () => {
		// Zero is what a model without pricing data reports, so `$0.00` would claim a measurement.
		expect(formatCost(0)).toBe("");
		expect(formatCost(Number.NaN)).toBe("");
		expect(formatCost(-1)).toBe("");
	});

	it("says a real but tiny cost is tiny, not zero", () => {
		expect(formatCost(0.00002)).toBe("<$0.0001");
		expect(formatCost(0)).toBe("");
	});

	it("marks the figure as an estimate", () => {
		expect(formatCost(0.5).startsWith("~")).toBe(true);
	});
});

describe("elapsed time", () => {
	it("writes tenths of a second, and FleetView's whole seconds", () => {
		expect(formatMs(1234)).toBe("1.2s");
		expect(formatFleetElapsed(0)).toBe("0s");
		expect(formatFleetElapsed(11_000)).toBe("11s");
		expect(formatFleetElapsed(11_400)).toBe("11s");
		expect(formatFleetElapsed(11_600)).toBe("12s");
	});

	it("floors FleetView's elapsed time at 0s", () => {
		expect(formatFleetElapsed(-500)).toBe("0s");
	});
});

describe("token counts", () => {
	it("writes `33.8k token`, and FleetView's `↓ 13.1k tokens`", () => {
		expect(formatTokenCount(33_800)).toBe("33.8k token");
		expect(formatTokenCount(950)).toBe("950 token");
		expect(formatTokenCount(1_200_000)).toBe("1.2M token");
		expect(formatFleetTokens(13_100)).toBe("↓ 13.1k tokens");
		expect(formatFleetTokens(950)).toBe("↓ 950 tokens");
		expect(formatFleetTokens(1_200_000)).toBe("↓ 1.2M tokens");
	});
});

describe("turns, status and activity", () => {
	it("writes turns with their limit", () => {
		expect(formatTurns(5, 30)).toBe("↻5≤30");
		expect(formatTurns(5)).toBe("↻5");
		expect(formatTurns(5, 0)).toBe("↻5");
	});

	it("gives each status its icon, the spinner frame while running", () => {
		expect(statusIcon("running", theme, 1)).toBe("<accent>⠙</accent>");
		expect(statusIcon("queued", theme)).toBe("<muted>◦</muted>");
		expect(statusIcon("completed", theme)).toBe("<success>✓</success>");
		expect(statusIcon("steered", theme)).toBe("<warning>✓</warning>");
		expect(statusIcon("stopped", theme)).toBe("<dim>■</dim>");
		expect(statusIcon("error", theme)).toBe("<error>✗</error>");
		expect(statusIcon("aborted", theme)).toBe("<error>✗</error>");
	});

	it("describes what an agent does: its running tools, else its response, else thinking", () => {
		const running = activeTools({
			activity: [
				{ type: "tool_start", toolName: "read" },
				{ type: "tool_start", toolName: "read" },
				{ type: "tool_start", toolName: "grep" },
				{ type: "tool_start", toolName: "bash" },
				{ type: "tool_end", toolName: "bash" },
				{ type: "tool_start", toolName: "custom" },
			],
		});
		expect(running).toEqual(["read", "read", "grep", "custom"]);
		expect(describeActivity(running)).toBe("reading 2 files, searching, custom…");
		expect(describeActivity(["grep", "grep"])).toBe("searching 2 patterns…");
		expect(describeActivity([], `\n  ${"x".repeat(70)}\nsecond line`)).toBe(`${"x".repeat(60)}…`);
		expect(describeActivity([], "short answer")).toBe("short answer");
		expect(describeActivity([])).toBe("thinking…");
	});

	it("labels a model briefly for rows and fully for headers", () => {
		expect(describeModel({ provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" })).toEqual({
			name: "haiku 4.5",
			id: "anthropic/claude-haiku-4-5",
		});
		expect(describeModel({ provider: "faux", id: "faux-a" })).toEqual({ name: "faux-a", id: "faux/faux-a" });
	});
});
