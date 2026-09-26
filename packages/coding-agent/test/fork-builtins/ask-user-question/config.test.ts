import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/core/fork-builtins/ask-user-question/config.ts";
import {
	ASK_USER_QUESTION_KEYBINDING_IDS,
	DEFAULT_KEY_TEXTS,
	questionnaireKeyTexts,
} from "../../../src/core/fork-builtins/ask-user-question/keybindings.ts";
import {
	HINT_PART_COLLAPSE,
	HINT_PART_NOTES,
	HINT_PART_TAB,
	HINT_PART_TOGGLE,
} from "../../../src/core/fork-builtins/ask-user-question/view/dialog-builder.ts";
import { KeybindingsManager } from "../../../src/core/keybindings.ts";

function agentDirWith(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-ask-user-question-config-"));
	writeFileSync(join(dir, "settings.json"), content, "utf8");
	return dir;
}

const entry = (value: unknown) => JSON.stringify({ forkBuiltins: { "ask-user-question": value } });

describe("loadConfig", () => {
	it("reads the guidance from forkBuiltins['ask-user-question'] in the agent directory's settings.json", () => {
		const dir = agentDirWith(entry({ guidance: { description: "Custom" } }));
		expect(loadConfig(dir)).toEqual({ guidance: { description: "Custom" } });
	});

	it("returns an empty config for a missing file, a malformed file or a missing entry", () => {
		expect(loadConfig(mkdtempSync(join(tmpdir(), "pi-ask-user-question-config-")))).toEqual({});
		expect(loadConfig(agentDirWith("{ not json"))).toEqual({});
		expect(loadConfig(agentDirWith(JSON.stringify({ forkBuiltins: {} })))).toEqual({});
	});

	it("reads a BOM-prefixed file", () => {
		const dir = agentDirWith(`\uFEFF${entry({ guidance: { promptSnippet: "BOM" } })}`);
		expect(loadConfig(dir)).toEqual({ guidance: { promptSnippet: "BOM" } });
	});

	it("keeps only well-typed guidance fields", () => {
		const dir = agentDirWith(entry({ guidance: { description: 7, promptSnippet: "ok", promptGuidelines: "no" } }));
		expect(loadConfig(dir)).toEqual({ guidance: { promptSnippet: "ok" } });
	});
});

describe("questionnaire key texts", () => {
	it("render the default bindings as the upstream hint texts", () => {
		expect(DEFAULT_KEY_TEXTS).toEqual({
			collapse: "Ctrl+]",
			setAside: "a",
			nextTab: "Tab",
			previousTab: "Shift+Tab",
			notes: "n",
			toggle: "Space",
		});
		expect(HINT_PART_COLLAPSE).toBe("Ctrl+] to collapse");
		expect(HINT_PART_NOTES).toBe("n to add notes");
		expect(HINT_PART_TAB).toBe("Tab to switch questions");
		expect(HINT_PART_TOGGLE).toBe("Space to toggle");
	});

	it("follow keybindings.json, and an empty binding has no text", () => {
		const keybindings = new KeybindingsManager({
			[ASK_USER_QUESTION_KEYBINDING_IDS.collapse]: "alt+o",
			[ASK_USER_QUESTION_KEYBINDING_IDS.notes]: [],
		});
		const texts = questionnaireKeyTexts(keybindings);
		expect(texts.collapse).toBe("Alt+O");
		expect(texts.notes).toBe("");
		expect(texts.toggle).toBe("Space");
	});

	it("are part of Pi's keybinding table", () => {
		const keybindings = new KeybindingsManager();
		for (const id of Object.values(ASK_USER_QUESTION_KEYBINDING_IDS)) {
			expect(keybindings.getKeys(id).length, id).toBeGreaterThan(0);
		}
	});
});
