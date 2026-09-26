import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadPersistedConfig, savePersistedMode } from "../../../src/core/fork-builtins/tokensave/state.ts";

function parseJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		expect.unreachable(`Failed to parse ${path}: ${String(error)}`);
	}
}

test("branch lifecycle management is opt-in", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pi-tokensave-state-")), "missing.json");
	expect(loadPersistedConfig(path)).toStrictEqual({
		mode: "enforce",
		autoManageBranches: false,
	});
});

test("loads autoManageBranches and preserves it when changing mode", () => {
	const path = join(mkdtempSync(join(tmpdir(), "pi-tokensave-state-")), "config.json");
	writeFileSync(path, JSON.stringify({ autoManageBranches: true, futureSetting: "keep" }), "utf8");

	expect(loadPersistedConfig(path)).toStrictEqual({
		mode: "enforce",
		autoManageBranches: true,
	});

	savePersistedMode("prefer", path);
	expect(parseJsonFile(path)).toStrictEqual({
		autoManageBranches: true,
		futureSetting: "keep",
		mode: "prefer",
	});
});
