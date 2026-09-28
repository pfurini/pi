// Fork-owned: the settings list of the `/agents` settings menu (plan T15), rendered with a plain
// theme and driven through SettingsList.handleInput. Saving runs in the suite test
// test/suite/fork-subagents-settings-menu.test.ts, on a file-backed session.
import { describe, expect, it } from "vitest";
import {
	DEFAULT_SUBAGENT_SETTINGS,
	SUBAGENT_SETTING_KEYS,
} from "../../../src/core/fork-builtins/subagents/settings/settings.ts";
import { type SettingChange, settingsMenu } from "../../../src/core/fork-builtins/subagents/ui/settings-menu.ts";

const KEY = { down: "\x1b[B", enter: "\r", escape: "\x1b" };
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

/** pi-subagents' labels in its order (`src/index.ts:3719-3874` at 79a7c42), without scheduling and workflows. */
const LABELS = [
	"Max concurrency",
	"Max foreground concurrency",
	"Default max turns",
	"Grace turns",
	"Nested depth",
	"Join mode",
	"Background by default",
	"Scope models",
	"Strict agent files",
	"Disable defaults",
	"Fallback agent",
	"Output transcript",
	"Worktree isolation",
	"Report usage to session",
	"Show cost",
	"Show model",
	"Viewer markdown",
	"Fleet view",
	"Agent mentions",
	"Remember agents",
	"Widget",
	"Tool description",
];

function open(editable = true) {
	const changes: Array<SettingChange | undefined> = [];
	const component = settingsMenu({
		settings: DEFAULT_SUBAGENT_SETTINGS,
		agents: ["general-purpose", "worker"],
		editable,
		theme,
		done: (change) => changes.push(change),
	});
	return { component, changes, lines: () => component.render(160) };
}

function press(component: { handleInput?: (data: string) => void }, ...keys: string[]) {
	for (const key of keys) component.handleInput?.(key);
}

describe("the subagent settings list", () => {
	it("shows the 22 keys in pi-subagents' order, and a boolean toggles through the list's input", () => {
		const { component, changes, lines } = open();
		const rows = lines().filter((line) => LABELS.some((label) => line.includes(label)));
		const shown = rows.map((row) => LABELS.find((label) => row.includes(label)));
		expect(shown).toEqual(LABELS);
		expect(SUBAGENT_SETTING_KEYS).toHaveLength(22);
		expect(lines().find((line) => line.includes("Background by default"))).toMatch(/Background by default\s+on/);
		press(component, ...Array<string>(6).fill(KEY.down), KEY.enter);
		expect(changes).toEqual([{ key: "backgroundByDefault", value: "off" }]);
		expect(lines().find((line) => line.includes("Background by default"))).toMatch(/Background by default\s+off/);
	});

	it("reports a number row without a value, and cycles the fallback agent through the enabled types and none", () => {
		const { component, changes } = open();
		press(component, KEY.enter);
		press(component, ...Array<string>(10).fill(KEY.down), KEY.enter, KEY.enter, KEY.enter);
		expect(changes).toEqual([
			{ key: "maxConcurrent", value: undefined },
			{ key: "fallbackSubagent", value: "worker" },
			{ key: "fallbackSubagent", value: "none" },
			{ key: "fallbackSubagent", value: "general-purpose" },
		]);
	});

	it("changes nothing read-only, and closes on Escape", () => {
		const { component, changes, lines } = open(false);
		expect(lines().join("\n")).toContain("This project is not trusted: the effective settings are shown read-only.");
		press(component, KEY.enter, ...Array<string>(6).fill(KEY.down), KEY.enter);
		expect(changes).toEqual([]);
		press(component, KEY.escape);
		expect(changes).toEqual([undefined]);
	});
});
