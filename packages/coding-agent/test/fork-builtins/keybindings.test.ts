/**
 * Fork-owned: the fork's keybindings reach Pi's keybinding table through `FORK_KEYBINDINGS` (D37), so
 * users rebind them in `keybindings.json` like any other Pi key.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FORK_KEYBINDINGS } from "../../src/core/fork-builtins/keybindings.ts";
import { KEYBINDINGS, KeybindingsManager } from "../../src/core/keybindings.ts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fork keybindings", () => {
	it("puts every fork id into Pi's keybinding table with its default", () => {
		for (const [id, definition] of Object.entries(FORK_KEYBINDINGS)) {
			expect(KEYBINDINGS[id as keyof typeof KEYBINDINGS], id).toEqual(definition);
		}
		const manager = new KeybindingsManager();
		expect(manager.getKeys("app.subagents.stop")).toEqual(["x"]);
		expect(manager.getKeys("app.subagents.markdownMode")).toEqual(["m"]);
		expect(manager.getKeys("app.subagents.top")).toEqual(["home"]);
		expect(manager.getKeys("app.subagents.bottom")).toEqual(["end"]);
		expect(manager.getKeys("app.askUserQuestion.notes")).toEqual(["n"]);
	});

	it("takes a user's binding for a subagent key from keybindings.json", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-fork-keys-"));
		dirs.push(agentDir);
		writeFileSync(join(agentDir, "keybindings.json"), JSON.stringify({ "app.subagents.stop": "s" }));
		const manager = KeybindingsManager.create(agentDir);
		expect(manager.getKeys("app.subagents.stop")).toEqual(["s"]);
		expect(manager.matches("s", "app.subagents.stop")).toBe(true);
		expect(manager.matches("x", "app.subagents.stop")).toBe(false);
	});
});
