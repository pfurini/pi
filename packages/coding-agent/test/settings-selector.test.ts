import { type SettingItem, setKeybindings } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createConfig(overrides: Partial<SettingsConfig> = {}): SettingsConfig {
	return {
		autoCompact: true,
		showImages: false,
		imageWidthCells: 60,
		autoResizeImages: true,
		blockImages: false,
		enableSkillCommands: true,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		transport: "auto",
		httpIdleTimeoutMs: 0,
		thinkingLevel: "off",
		availableThinkingLevels: ["off", "low", "medium", "high"],
		defaultModel: "",
		availableDefaultModels: [],
		modelThinkingLevels: {},
		currentTheme: "dark",
		terminalTheme: "dark",
		availableThemes: ["dark", "light"],
		hideThinkingBlock: false,
		showCacheMissNotices: false,
		cacheWarmingMode: "streaming",
		collapseChangelog: false,
		enableInstallTelemetry: true,
		doubleEscapeAction: "tree",
		treeFilterMode: "default",
		showHardwareCursor: false,
		editorPaddingX: 0,
		outputPad: 1,
		autocompleteMaxVisible: 5,
		promptHistoryScope: "session",
		promptHistoryMaxEntries: 100,
		quietStartup: false,
		defaultProjectTrust: "ask",
		clearOnShrink: false,
		showTerminalProgress: false,
		tuiMode: "regular",
		fullscreenExitOutput: "transcript",
		fullscreenScrollbar: "auto",
		fullscreenCopyOnSelect: true,
		fullscreenWheelScrollLines: "auto",
		mermaidRenderingMode: "streaming",
		warnings: {},
		...overrides,
	};
}

function createCallbacks(): SettingsCallbacks {
	return {
		onAutoCompactChange: vi.fn(),
		onShowImagesChange: vi.fn(),
		onImageWidthCellsChange: vi.fn(),
		onAutoResizeImagesChange: vi.fn(),
		onBlockImagesChange: vi.fn(),
		onEnableSkillCommandsChange: vi.fn(),
		onSteeringModeChange: vi.fn(),
		onFollowUpModeChange: vi.fn(),
		onTransportChange: vi.fn(),
		onHttpIdleTimeoutMsChange: vi.fn(),
		onModelThinkingLevelChange: vi.fn(),
		onModelThinkingLevelRemove: vi.fn(),
		onThemeChange: vi.fn(),
		onHideThinkingBlockChange: vi.fn(),
		onShowCacheMissNoticesChange: vi.fn(),
		onCacheWarmingModeChange: vi.fn(),
		onCollapseChangelogChange: vi.fn(),
		onEnableInstallTelemetryChange: vi.fn(),
		onDoubleEscapeActionChange: vi.fn(),
		onTreeFilterModeChange: vi.fn(),
		onShowHardwareCursorChange: vi.fn(),
		onEditorPaddingXChange: vi.fn(),
		onOutputPadChange: vi.fn(),
		onAutocompleteMaxVisibleChange: vi.fn(),
		onPromptHistoryScopeChange: vi.fn(),
		onPromptHistoryMaxEntriesChange: vi.fn(),
		onQuietStartupChange: vi.fn(),
		onDefaultProjectTrustChange: vi.fn(),
		onClearOnShrinkChange: vi.fn(),
		onShowTerminalProgressChange: vi.fn(),
		onTuiModeChange: vi.fn(),
		onFullscreenExitOutputChange: vi.fn(),
		onFullscreenScrollbarChange: vi.fn(),
		onFullscreenCopyOnSelectChange: vi.fn(),
		onFullscreenWheelScrollLinesChange: vi.fn(),
		onMermaidRenderingModeChange: vi.fn(),
		onWarningsChange: vi.fn(),
		onCancel: vi.fn(),
	};
}

/** SettingsList stores its constructed items and onChange callback as private instance fields; read them for direct assertions. */
function getInternals(selector: SettingsSelectorComponent): {
	items: SettingItem[];
	onChange: (id: string, newValue: string) => void;
} {
	const settingsList = selector.getSettingsList() as unknown as {
		items: SettingItem[];
		onChange: (id: string, newValue: string) => void;
	};
	return { items: settingsList.items, onChange: settingsList.onChange };
}

beforeAll(() => {
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
});

describe("SettingsSelectorComponent", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("cycles through fullscreen settings", () => {
		const onExitOutputChange = vi.fn();
		const onScrollbarChange = vi.fn();
		const onCopyOnSelectChange = vi.fn();
		const onWheelScrollLinesChange = vi.fn();
		const config = {
			fullscreenExitOutput: "transcript",
			fullscreenScrollbar: "auto",
			fullscreenCopyOnSelect: true,
			fullscreenWheelScrollLines: 7,
			warnings: {},
			defaultModel: "not set",
			availableDefaultModels: [],
			availableThinkingLevels: [],
			modelThinkingLevels: {},
			availableThemes: [],
		} as unknown as SettingsConfig;
		const callbacks = {
			onFullscreenExitOutputChange: onExitOutputChange,
			onFullscreenScrollbarChange: onScrollbarChange,
			onFullscreenCopyOnSelectChange: onCopyOnSelectChange,
			onFullscreenWheelScrollLinesChange: onWheelScrollLinesChange,
		} as unknown as SettingsCallbacks;

		const cycle = (label: string, count: number) => {
			const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();
			for (const character of label) list.handleInput(character);
			for (let i = 0; i < count; i++) list.handleInput("\r");
		};

		cycle("Fullscreen exit output", 2);
		expect(onExitOutputChange.mock.calls.flat()).toEqual(["resume-hint", "transcript"]);
		cycle("Fullscreen scrollbar", 3);
		expect(onScrollbarChange.mock.calls.flat()).toEqual(["always", "hidden", "auto"]);
		cycle("Fullscreen copy on select", 2);
		expect(onCopyOnSelectChange.mock.calls.flat()).toEqual([false, true]);
		// #9758: custom values from settings.json stay in the cycle.
		cycle("Fullscreen wheel scrolling", 3);
		expect(onWheelScrollLinesChange.mock.calls.flat()).toEqual([10, "auto", 1]);
	});

	it("keeps the configured fixed theme marked while browsing", () => {
		const config = {
			defaultModel: "not set",
			availableDefaultModels: [],
			modelThinkingLevels: {},
			currentTheme: "dark",
			terminalTheme: "dark",
			availableThemes: ["system", "dark", "light"],
			warnings: {},
		} as unknown as SettingsConfig;
		const callbacks = { onThemePreview: vi.fn(), onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("theme");
		list.handleInput("\r");
		let output = stripAnsi(list.render(120).join("\n"));
		expect(output).toMatch(
			/ {4}system +Theme created from your terminal's colors\n {4}automatic +Use separate themes/,
		);
		expect(output).toContain("→ ✓ dark");

		list.handleInput("\x1b[B");
		output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("  ✓ dark");
		expect(output).toContain("→   light");
	});

	it("keeps a configured automatic theme marked while browsing", () => {
		const config = {
			defaultModel: "not set",
			availableDefaultModels: [],
			modelThinkingLevels: {},
			currentTheme: "light/dark",
			terminalTheme: "dark",
			availableThemes: ["dark", "light", "other"],
			warnings: {},
		} as unknown as SettingsConfig;
		const callbacks = { onThemePreview: vi.fn(), onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("theme");
		list.handleInput("\r");
		list.handleInput("\r");
		let output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("→ ✓ light");

		list.handleInput("\x1b[B");
		output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("  ✓ light");
		expect(output).toContain("→   other");
	});

	it("keeps the configured per-model thinking level marked while browsing", async () => {
		harness = await createHarness({
			models: [{ id: "thinking-model", reasoning: true }],
		});
		const model = harness.getModel("thinking-model")!;
		const modelKey = `${model.provider}/${model.id}`;
		const config = {
			defaultModel: modelKey,
			availableDefaultModels: [model],
			thinkingLevel: "high",
			modelThinkingLevels: { [modelKey]: "medium" },
		} as unknown as SettingsConfig;
		const callbacks = { onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("model-thinking");
		list.handleInput("\r");
		list.handleInput("\r");

		let output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("→ ✓ medium");
		expect(output).toContain("    (clear override)");

		list.handleInput("\x1b[B");
		output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("  ✓ medium");
		expect(output).toContain("→   high");
	});
});

describe("SettingsSelectorComponent prompt history entries", () => {
	it("includes a prompt history scope item with session/project values", () => {
		const callbacks = createCallbacks();
		const selector = new SettingsSelectorComponent(createConfig({ promptHistoryScope: "project" }), callbacks);
		const { items } = getInternals(selector);

		const scopeItem = items.find((item) => item.id === "prompt-history-scope");
		expect(scopeItem).toBeDefined();
		expect(scopeItem?.currentValue).toBe("project");
		expect(scopeItem?.values).toEqual(["session", "project"]);
	});

	it("includes a prompt history max entries item whose currentValue matches one of its values, including 0", () => {
		const callbacks = createCallbacks();
		const selector = new SettingsSelectorComponent(createConfig({ promptHistoryMaxEntries: 0 }), callbacks);
		const { items } = getInternals(selector);

		const maxEntriesItem = items.find((item) => item.id === "prompt-history-max-entries");
		expect(maxEntriesItem).toBeDefined();
		expect(maxEntriesItem?.currentValue).toBe("0");
		expect(maxEntriesItem?.values).toEqual(["100", "500", "1000", "0"]);
		// The "0 = unlimited" case must be a plain value, not a decorated string like "0 (unlimited)",
		// or cycling would never land on it since currentValue wouldn't match any entry in values.
		expect(maxEntriesItem?.values).toContain(maxEntriesItem?.currentValue);
		expect(maxEntriesItem?.description?.toLowerCase()).toContain("unlimited");
	});

	it("reflects a finite configured max entries value", () => {
		const callbacks = createCallbacks();
		const selector = new SettingsSelectorComponent(createConfig({ promptHistoryMaxEntries: 500 }), callbacks);
		const { items } = getInternals(selector);

		const maxEntriesItem = items.find((item) => item.id === "prompt-history-max-entries");
		expect(maxEntriesItem?.currentValue).toBe("500");
	});

	it("calls onPromptHistoryScopeChange with the selected scope", () => {
		const callbacks = createCallbacks();
		const selector = new SettingsSelectorComponent(createConfig(), callbacks);
		const { onChange } = getInternals(selector);

		onChange("prompt-history-scope", "project");

		expect(callbacks.onPromptHistoryScopeChange).toHaveBeenCalledWith("project");
	});

	it("calls onPromptHistoryMaxEntriesChange with the parsed integer, including 0 for unlimited", () => {
		const callbacks = createCallbacks();
		const selector = new SettingsSelectorComponent(createConfig(), callbacks);
		const { onChange } = getInternals(selector);

		onChange("prompt-history-max-entries", "500");
		expect(callbacks.onPromptHistoryMaxEntriesChange).toHaveBeenCalledWith(500);

		onChange("prompt-history-max-entries", "0");
		expect(callbacks.onPromptHistoryMaxEntriesChange).toHaveBeenCalledWith(0);
	});
});
