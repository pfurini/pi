import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadTokensaveSettings } from "../../../src/core/fork-builtins/tokensave/state.ts";

function agentDirWith(content?: string): string {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-tokensave-state-"));
	if (content !== undefined) writeFileSync(join(agentDir, "settings.json"), content, "utf8");
	return agentDir;
}

function settingsWith(entry: unknown): string {
	return JSON.stringify({ packages: ["../other"], forkBuiltins: { "pi-tokensave": entry } }, null, 2);
}

test("branch lifecycle management is opt-in", () => {
	expect(loadTokensaveSettings(agentDirWith())).toStrictEqual({
		mode: "enforce",
		autoManageBranches: false,
	});
});

test("loads autoManageBranches and the mode from forkBuiltins in settings.json", () => {
	const agentDir = agentDirWith(settingsWith({ autoManageBranches: true, mode: "prefer", futureSetting: "keep" }));
	expect(loadTokensaveSettings(agentDir)).toStrictEqual({
		mode: "prefer",
		autoManageBranches: true,
	});
});

test("mistyped settings values fall back to the defaults", () => {
	const agentDir = agentDirWith(settingsWith({ mode: "PREFER", autoManageBranches: "true" }));
	expect(loadTokensaveSettings(agentDir)).toStrictEqual({ mode: "enforce", autoManageBranches: false });

	const notAnObject = agentDirWith(settingsWith(["prefer"]));
	expect(loadTokensaveSettings(notAnObject)).toStrictEqual({ mode: "enforce", autoManageBranches: false });

	const otherKey = agentDirWith(JSON.stringify({ forkBuiltins: { tokensave: { mode: "prefer" } } }));
	expect(loadTokensaveSettings(otherKey)).toStrictEqual({ mode: "enforce", autoManageBranches: false });
});

test("a BOM-prefixed settings.json is read", () => {
	const agentDir = agentDirWith(`\uFEFF${settingsWith({ mode: "prefer", autoManageBranches: true })}`);
	expect(loadTokensaveSettings(agentDir)).toStrictEqual({ mode: "prefer", autoManageBranches: true });
});

test("a malformed settings.json yields the defaults", () => {
	const agentDir = agentDirWith('{ "forkBuiltins": { "pi-tokensave": { "mode": "prefer" } }');
	expect(loadTokensaveSettings(agentDir)).toStrictEqual({ mode: "enforce", autoManageBranches: false });
});
