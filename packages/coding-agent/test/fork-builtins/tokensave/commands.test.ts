import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { registerTokensaveCommands } from "../../../src/core/fork-builtins/tokensave/commands.ts";
import { setExecFileImplForTest } from "../../../src/core/fork-builtins/tokensave/runner.ts";
import type { TokensaveMode } from "../../../src/core/fork-builtins/tokensave/state.ts";

type Cb = (
	error: (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null,
	stdout: string,
	stderr: string,
) => void;

function fakePi() {
	const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> }> = {};
	return {
		commands,
		agentDir: mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-")),
		registerCommand(name: string, def: any) {
			commands[name] = def;
		},
		getActiveTools(): string[] {
			return [];
		},
		getCallableTools(): string[] {
			return this.getActiveTools();
		},
	} as any;
}

function fakeCtx(cwd: string, confirmAnswer = true) {
	const notifications: Array<{ message: string; level: string }> = [];
	return {
		cwd,
		agentDir: mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-")),
		ui: {
			notify: (message: string, level = "info") => notifications.push({ message, level }),
			confirm: async () => confirmAnswer,
		},
		notifications,
	} as any;
}

test.afterEach(() => setExecFileImplForTest(undefined));

test("tokensave-status notifies binary-missing when TokenSave is absent", async () => {
	setExecFileImplForTest((_f, _a, _o, cb: Cb) => {
		const err = new Error("not found") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		cb(err, "", "");
		return {};
	});

	const pi = fakePi();
	const state = { mode: "enforce" as TokensaveMode };
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
	);

	const ctx = fakeCtx(mkdtempSync(join(tmpdir(), "pi-tokensave-cmd-")));
	await pi.commands["tokensave-status"].handler("", ctx);

	expect(ctx.notifications.some((n: any) => /not found/i.test(n.message))).toBeTruthy();
});

test("tokensave-init asks for confirmation before running init", async () => {
	let ranInit = false;
	setExecFileImplForTest((_f, args: string[], _o, cb: Cb) => {
		if (args[0] === "init") ranInit = true;
		cb(null, "Initialized TokenSave", "");
		return {};
	});

	const pi = fakePi();
	const state = { mode: "enforce" as TokensaveMode };
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
	);

	const dir = mkdtempSync(join(tmpdir(), "pi-tokensave-cmd-"));
	const ctx = fakeCtx(dir, true);
	await pi.commands["tokensave-init"].handler("", ctx);

	expect(ranInit).toBe(true);
});

test("tokensave-init does not run when the user declines confirmation", async () => {
	let ranInit = false;
	setExecFileImplForTest((_f, args: string[], _o, cb: Cb) => {
		if (args[0] === "init") ranInit = true;
		cb(null, "", "");
		return {};
	});

	const pi = fakePi();
	const state = { mode: "enforce" as TokensaveMode };
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
	);

	const dir = mkdtempSync(join(tmpdir(), "pi-tokensave-cmd-"));
	const ctx = fakeCtx(dir, false);
	await pi.commands["tokensave-init"].handler("", ctx);

	expect(ranInit).toBe(false);
	expect(ctx.notifications.some((n: any) => /cancelled/i.test(n.message))).toBeTruthy();
});

test("tokensave-mode reports current mode with no args and persists a new one", async () => {
	const pi = fakePi();
	const state = { mode: "enforce" as TokensaveMode };
	const modePath = join(mkdtempSync(join(tmpdir(), "pi-tokensave-mode-")), "mode.json");
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
		modePath,
	);

	const ctx = fakeCtx("/tmp");
	await pi.commands["tokensave-mode"].handler("", ctx);
	expect(ctx.notifications.some((n: any) => /Current mode: enforce/.test(n.message))).toBeTruthy();

	await pi.commands["tokensave-mode"].handler("prefer", ctx);
	expect(state.mode).toBe("prefer");
	expect(existsSync(modePath)).toBeTruthy();
	expect(JSON.parse(readFileSync(modePath, "utf8"))).toStrictEqual({ mode: "prefer" });
});

test("tokensave-mode rejects invalid values", async () => {
	const pi = fakePi();
	const state = { mode: "enforce" as TokensaveMode };
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
	);

	const ctx = fakeCtx("/tmp");
	await pi.commands["tokensave-mode"].handler("bogus", ctx);
	expect(state.mode).toBe("enforce");
	expect(ctx.notifications.some((n: any) => n.level === "error")).toBeTruthy();
});

test("tokensave-doctor reports the mode and no rules-block line", async () => {
	setExecFileImplForTest((_f, args: string[], _o, cb: Cb) => {
		cb(args[0] === "--version" ? null : new Error("unused"), "tokensave 7.0.3", "");
		return {};
	});

	const pi = fakePi();
	const state = { mode: "prefer" as TokensaveMode };
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
	);

	const ctx = fakeCtx(mkdtempSync(join(tmpdir(), "pi-tokensave-cmd-")));
	await pi.commands["tokensave-doctor"].handler("", ctx);

	const report = ctx.notifications[0]?.message ?? "";
	expect(report.includes("Mode: prefer")).toBeTruthy();
	expect(report).not.toMatch(/AGENTS\.md|rules block/);
});

test("mode and doctor commands use the session agentDir when no override is given", async () => {
	setExecFileImplForTest((_f, _args: string[], _o, cb: Cb) => {
		cb(null, "tokensave 7.12.1", "");
		return {};
	});

	const agentDir = mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-"));
	const pi = fakePi();
	const state = { mode: "enforce" as TokensaveMode };
	registerTokensaveCommands(
		pi,
		() => state,
		(m) => {
			state.mode = m;
		},
	);

	const ctx = Object.assign(fakeCtx(mkdtempSync(join(tmpdir(), "pi-tokensave-cmd-"))), { agentDir });

	await pi.commands["tokensave-mode"].handler("prefer", ctx);
	expect(JSON.parse(readFileSync(join(agentDir, "pi-tokensave.json"), "utf8"))).toStrictEqual({ mode: "prefer" });

	await pi.commands["tokensave-doctor"].handler("", ctx);
	const report = ctx.notifications.at(-1)?.message ?? "";
	expect(report.includes("Mode: prefer")).toBeTruthy();
	expect(existsSync(join(agentDir, "AGENTS.md"))).toBe(false);
});
