/**
 * The per-root empty-index check: an index whose `status` reports 0 nodes gets no
 * rules injection and no guard. A fake execFile answers `status` per root and
 * records every probe.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import pluginTokensave from "../../../src/core/fork-builtins/tokensave/index.ts";
import { setExecFileImplForTest } from "../../../src/core/fork-builtins/tokensave/runner.ts";

type Cb = (
	error: (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null,
	stdout: string,
	stderr: string,
) => void;

type Handler = (event: any, ctx: any) => any;

/** A root's `status` answer: a node count, a failed process, or a killed (timed out) one. */
type StatusAnswer = number | "error" | "timeout";

function fakeTokensave(answers: Map<string, StatusAnswer>) {
	const probes: string[] = [];
	const probeTimeouts: number[] = [];
	setExecFileImplForTest((_file, args: string[], options, cb: Cb) => {
		if (args[0] === "--version") {
			cb(null, "tokensave 7.12.1", "");
			return {};
		}
		if (args[0] === "tool" && args[1] === "status") {
			const root = args[3];
			probes.push(root);
			probeTimeouts.push(options.timeout);
			const answer = answers.get(root) ?? 5;
			if (answer === "error") {
				cb(new Error("status failed"), "", "status failed");
			} else if (answer === "timeout") {
				cb(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }), "", "");
			} else {
				const text = JSON.stringify({ node_count: answer, edge_count: 0, file_count: 0 });
				cb(null, JSON.stringify({ content: [{ type: "text", text }] }), "");
			}
			return {};
		}
		cb(null, "ok", "");
		return {};
	});
	return { probes, probeTimeouts };
}

afterEach(() => setExecFileImplForTest(undefined));

function plugin(options: { agentDir?: string; refs?: () => string } = {}) {
	const handlers: Record<string, Handler> = {};
	const tools: Record<string, unknown> = {};
	const commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> }> = {};
	const pi = {
		agentDir: options.agentDir ?? mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-")),
		on(event: string, handler: Handler) {
			handlers[event] = handler;
		},
		registerTool(def: any) {
			tools[def.name] = def;
		},
		registerCommand(name: string, def: any) {
			commands[name] = def;
		},
		getActiveTools: () => ["bash", ...Object.keys(tools)],
		getCallableTools: () => ["bash", ...Object.keys(tools)],
		exec: async () => ({ code: 0, stdout: options.refs?.() ?? "", stderr: "", killed: false }),
	};
	pluginTokensave(pi as unknown as ExtensionAPI);
	return { handlers, commands, agentDir: pi.agentDir };
}

/** Indexed sibling projects under one parent, named by `names`. */
function projects(...names: string[]): Record<string, string> {
	const parent = mkdtempSync(join(tmpdir(), "pi-tokensave-index-state-"));
	const roots: Record<string, string> = {};
	for (const name of names) {
		roots[name] = join(parent, name);
		mkdirSync(join(roots[name], ".tokensave"), { recursive: true });
	}
	return roots;
}

function ctxFor(cwd: string, agentDir: string) {
	return { cwd, agentDir, ui: { notify: () => {}, confirm: async () => true } };
}

function prompt(cwd: string) {
	return {
		prompt: "hello",
		systemPrompt: "base prompt",
		systemPromptOptions: {
			cwd,
			contextFiles: [] as Array<{ path: string; content: string }>,
			sections: {} as Record<string, string>,
			forceSystemPrompt: undefined as string | undefined,
		},
	};
}

const rg = (target: string) => ({ toolName: "bash", input: { command: `rg WellModel ${target}` } });

test("an index whose status reports node_count 0 gets no rules section and no block", async () => {
	const { a } = projects("a");
	fakeTokensave(new Map([[a, 0]]));
	const { handlers, agentDir } = plugin();
	const ctx = ctxFor(a, agentDir);
	await handlers.session_start({}, ctx);

	const event = prompt(a);
	expect(await handlers.before_agent_start(event, ctx)).toBe(undefined);
	expect(event.systemPromptOptions.sections).toStrictEqual({});
	expect(await handlers.tool_call(rg("."), ctx)).toBe(undefined);
});

test("a status error or timeout still injects the rules", async () => {
	const { failing, slow } = projects("failing", "slow");
	const cli = fakeTokensave(
		new Map<string, StatusAnswer>([
			[failing, "error"],
			[slow, "timeout"],
		]),
	);

	for (const root of [failing, slow]) {
		const { handlers, agentDir } = plugin();
		const event = prompt(root);
		await handlers.before_agent_start(event, ctxFor(root, agentDir));
		expect(event.systemPromptOptions.sections.tokensave, root).toContain("pi-tokensave:start");
		expect((await handlers.tool_call(rg("."), ctxFor(root, agentDir)))?.block, root).toBe(true);
	}
	expect(cli.probes).toStrictEqual([failing, slow]);
	expect(cli.probeTimeouts).toStrictEqual([4000, 4000]);
});

test("a root is probed at most once until it is reset", async () => {
	const { a } = projects("a");
	const cli = fakeTokensave(new Map());
	const { handlers, agentDir } = plugin();
	const ctx = ctxFor(a, agentDir);
	await handlers.session_start({}, ctx);

	for (let i = 0; i < 2; i++) await handlers.before_agent_start(prompt(a), ctx);
	for (let i = 0; i < 3; i++) expect((await handlers.tool_call(rg("."), ctx))?.block).toBe(true);
	expect(cli.probes).toStrictEqual([a]);
});

test("a foreign root with node_count 0 is not guarded while the session root is ready", async () => {
	const { session, empty } = projects("session", "empty");
	fakeTokensave(new Map([[empty, 0]]));
	const { handlers, agentDir } = plugin();
	const ctx = ctxFor(session, agentDir);

	expect(await handlers.tool_call(rg("../empty"), ctx)).toBe(undefined);
	expect((await handlers.tool_call(rg("."), ctx))?.block).toBe(true);
});

test("two roots keep independent index states, probes and resets", async () => {
	const { a, b } = projects("a", "b");
	const answers = new Map<string, StatusAnswer>([
		[a, 0],
		[b, 5],
	]);
	const cli = fakeTokensave(answers);
	const { handlers, commands, agentDir } = plugin();
	const ctx = ctxFor(a, agentDir);

	expect(await handlers.tool_call(rg("."), ctx), "a is empty").toBe(undefined);
	expect((await handlers.tool_call(rg("../b"), ctx))?.block, "b is ready").toBe(true);
	expect(cli.probes).toStrictEqual([a, b]);

	answers.set(a, 5);
	await commands["tokensave-sync"].handler("", ctx);
	expect((await handlers.tool_call(rg("."), ctx))?.block, "a was reset and probed again").toBe(true);
	expect((await handlers.tool_call(rg("../b"), ctx))?.block).toBe(true);
	expect(cli.probes, "resetting a leaves b's entry in place").toStrictEqual([a, b, a]);
});

test("empty to ready: a successful /tokensave-sync turns the guard on without a new prompt", async () => {
	const { a } = projects("a");
	const answers = new Map<string, StatusAnswer>([[a, 0]]);
	fakeTokensave(answers);
	const { handlers, commands, agentDir } = plugin();
	const ctx = ctxFor(a, agentDir);

	expect(await handlers.tool_call(rg("."), ctx)).toBe(undefined);
	answers.set(a, 5);
	await commands["tokensave-sync"].handler("", ctx);
	expect((await handlers.tool_call(rg("."), ctx))?.block).toBe(true);
});

test("a reconciliation that ran sync resets the root; one that skipped sync does not", async () => {
	for (const [label, head, resets] of [
		["on a branch", `*\trefs/heads/main\t${"a".repeat(40)}`, true],
		["detached HEAD", `*\t(HEAD detached at bbbbbbb)\t${"b".repeat(40)}`, false],
	] as const) {
		const { a } = projects("a");
		const answers = new Map<string, StatusAnswer>([[a, 0]]);
		const cli = fakeTokensave(answers);
		const agentDir = mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-"));
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ forkBuiltins: { "pi-tokensave": { autoManageBranches: true } } }),
		);
		const { handlers } = plugin({ agentDir, refs: () => head });
		const ctx = ctxFor(a, agentDir);

		expect(await handlers.tool_call(rg("."), ctx), label).toBe(undefined);
		answers.set(a, 5);
		await handlers.tool_call({ toolName: "tokensave_status", input: {} }, ctx);
		const search = await handlers.tool_call(rg("."), ctx);
		expect(search?.block === true, label).toBe(resets);
		expect(cli.probes.length, label).toBe(resets ? 2 : 1);
	}
});
