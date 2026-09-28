/**
 * Fork-owned: the conversation viewer's own keys (D37). `fork-builtins/keybindings.ts` merges them into
 * `FORK_KEYBINDINGS`, which `core/keybindings.ts` spreads into `KEYBINDINGS`, so users rebind them in
 * `keybindings.json` like any other Pi key. Every other key the presentation handles reuses an
 * existing id.
 */
import type { KeybindingDefinition } from "@earendil-works/pi-tui";

export const SUBAGENT_KEYBINDING_IDS = {
	stop: "app.subagents.stop",
	markdownMode: "app.subagents.markdownMode",
	top: "app.subagents.top",
	bottom: "app.subagents.bottom",
} as const;

type SubagentKeybindingId = (typeof SUBAGENT_KEYBINDING_IDS)[keyof typeof SUBAGENT_KEYBINDING_IDS];

declare module "@earendil-works/pi-tui" {
	interface Keybindings {
		"app.subagents.stop": true;
		"app.subagents.markdownMode": true;
		"app.subagents.top": true;
		"app.subagents.bottom": true;
	}
}

export const SUBAGENT_KEYBINDINGS = {
	[SUBAGENT_KEYBINDING_IDS.stop]: { defaultKeys: "x", description: "Stop the viewed subagent (press twice)" },
	[SUBAGENT_KEYBINDING_IDS.markdownMode]: {
		defaultKeys: "m",
		description: "Cycle the subagent viewer's Markdown mode",
	},
	[SUBAGENT_KEYBINDING_IDS.top]: { defaultKeys: "home", description: "Scroll the subagent viewer to the top" },
	[SUBAGENT_KEYBINDING_IDS.bottom]: { defaultKeys: "end", description: "Scroll the subagent viewer to the bottom" },
} satisfies Record<SubagentKeybindingId, KeybindingDefinition>;
