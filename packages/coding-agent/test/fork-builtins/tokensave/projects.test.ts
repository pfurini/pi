/**
 * The `project` parameter: every tool can target another indexed repository.
 * A fake execFile records the `--project` root and the `--args` JSON of every
 * spawned TokenSave process.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import { registerTokensaveCommands } from "../../../src/core/fork-builtins/tokensave/commands.ts";
import pluginTokensave from "../../../src/core/fork-builtins/tokensave/index.ts";
import { setExecFileImplForTest } from "../../../src/core/fork-builtins/tokensave/runner.ts";
import {
	createSessionState,
	type TokensaveMode,
	type TokensaveModeSource,
} from "../../../src/core/fork-builtins/tokensave/state.ts";
import { registerTokensaveTools } from "../../../src/core/fork-builtins/tokensave/tools.ts";

type Cb = (
	error: (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null,
	stdout: string,
	stderr: string,
) => void;

type Handler = (event: any, ctx: any) => any;

interface ToolCall {
	tool: string;
	project: string;
	args: Record<string, unknown>;
}

type Responder = (args: Record<string, unknown>) => unknown;

/** Default responses: valid shapes for every CLI tool the six tools call. */
const DEFAULT_RESPONSES: Record<string, Responder> = {
	status: () => ({ node_count: 5, edge_count: 1, file_count: 1, db_size_bytes: 1 }),
	context: () => "## Code Context\n\n- `Example` in src/example.ts:3",
	find_exact_symbol: () => ({
		count: 1,
		matches: [{ id: "n1", name: "Example", kind: "class", file: "src/example.ts", line: 3 }],
	}),
	search: () => [{ name: "Example", kind: "class", file: "src/example.ts", line: 3 }],
	body: () => "No matching symbol body found.",
	file_dependents: () => ({ count: 1, dependents: [{ file: "src/consumer.ts", name: "Consumer" }] }),
	diff_context: () => ({
		changed_files: ["src/example.ts"],
		modified_symbols: [],
		impacted_symbols_count: 1,
		impacted_symbols: [{ name: "Downstream", file: "src/downstream.ts", line: 7 }],
		affected_tests: [],
	}),
	affected: () => ({ changed_files: ["src/example.ts"], affected_tests: ["test/example.test.ts"], count: 1 }),
	impact: () => ({ node_count: 1, nodes: [{ name: "Caller", file: "src/caller.ts", line: 11 }] }),
	callers: () => [{ name: "caller_one", file: "src/a.ts", line: 3 }],
	callees: () => [{ name: "callee_one", file: "src/b.ts", line: 9 }],
	implementations: () => ({
		match_count: 1,
		implementations: [{ file: "src/impl.ts", line: 4, signature: "class Impl implements Runner" }],
	}),
	impls: () => ({
		count: 1,
		impls: [{ type: "Example", trait: "Runner", file: "src/impl.ts", start_line: 10, signature: "impl Runner" }],
	}),
};

/** Records every `tokensave tool` call; `commands` records plain subcommands (status, init, sync, branch). */
function fakeCli(overrides: Record<string, Responder> = {}) {
	const calls: ToolCall[] = [];
	const commands: string[][] = [];
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		if (args[0] === "--version") {
			cb(null, "tokensave 7.12.1", "");
			return {};
		}
		if (args[0] !== "tool") {
			commands.push(args);
			cb(null, "ok", "");
			return {};
		}
		const tool = args[1];
		const parsed = JSON.parse(args[5]) as Record<string, unknown>;
		calls.push({ tool, project: args[3], args: parsed });
		const responder = overrides[tool] ?? DEFAULT_RESPONSES[tool];
		const payload = responder ? responder(parsed) : { error: `no mock for ${tool}` };
		const text = typeof payload === "string" ? payload : JSON.stringify(payload);
		cb(null, JSON.stringify({ content: [{ type: "text", text }] }), "");
		return {};
	});
	return { calls, commands };
}

afterEach(() => setExecFileImplForTest(undefined));

function indexedDir(parent = mkdtempSync(join(tmpdir(), "pi-tokensave-projects-")), name = "repo"): string {
	const dir = join(parent, name);
	mkdirSync(join(dir, ".tokensave"), { recursive: true });
	return dir;
}

/** A session project and a sibling project, both indexed, under one parent. */
function twoProjects() {
	const parent = mkdtempSync(join(tmpdir(), "pi-tokensave-projects-"));
	return { parent, session: indexedDir(parent, "session"), other: indexedDir(parent, "other") };
}

function fakeTools() {
	const tools: Record<string, any> = {};
	const pi = {
		agentDir: mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-")),
		registerTool(def: any) {
			tools[def.name] = def;
		},
	} as unknown as ExtensionAPI;
	const state = createSessionState("enforce");
	registerTokensaveTools(pi, () => state);
	return { tools, state };
}

function ctxFor(cwd: string) {
	return {
		cwd,
		agentDir: mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-")),
		ui: { notify: () => {}, confirm: async () => true },
	};
}

async function run(tools: Record<string, any>, name: string, params: Record<string, unknown>, cwd: string) {
	const result = await tools[name].execute("call-1", params, undefined, () => {}, ctxFor(cwd));
	return result.content[0].text as string;
}

const SIX_TOOLS: Array<[string, Record<string, unknown>]> = [
	["tokensave_status", {}],
	["tokensave_context", { task: "explain Example" }],
	["tokensave_find_symbol", { name: "Example" }],
	["tokensave_search", { query: "Example" }],
	["tokensave_symbol", { name: "Example" }],
	["tokensave_impact", { file: "src/example.ts" }],
];

describe("six-tool table", () => {
	test.each(SIX_TOOLS)("%s takes an optional project and targets its root", async (name, params) => {
		const { session, other } = twoProjects();
		const { tools } = fakeTools();

		const schema = tools[name].parameters as { properties: Record<string, unknown>; required?: string[] };
		expect(schema.properties.project, "the schema has a project property").toBeDefined();
		expect(schema.required ?? []).not.toContain("project");

		const own = fakeCli();
		const ownText = await run(tools, name, params, session);
		expect(own.calls.length).toBeGreaterThan(0);
		expect(own.calls.every((call) => call.project === session)).toBe(true);
		expect(ownText.startsWith(`Project: ${session}\n`)).toBe(true);

		const foreign = fakeCli();
		const foreignText = await run(tools, name, { ...params, project: other }, session);
		expect(foreign.calls.length).toBeGreaterThan(0);
		expect(foreign.calls.every((call) => call.project === other)).toBe(true);
		expect(foreign.calls.some((call) => "project" in call.args)).toBe(false);
		expect(foreignText.startsWith(`Project: ${other}\n`)).toBe(true);

		const uninitializedCwd = mkdtempSync(join(tmpdir(), "pi-tokensave-projects-plain-"));
		const fromPlain = fakeCli();
		const plainText = await run(tools, name, { ...params, project: other }, uninitializedCwd);
		expect(fromPlain.calls.length, "an indexed project works from an uninitialized cwd").toBeGreaterThan(0);
		expect(fromPlain.calls.every((call) => call.project === other)).toBe(true);
		expect(plainText.startsWith(`Project: ${other}\n`)).toBe(true);
	});
});

test("a relative and an absolute project both reach the resolved root", async () => {
	const { session, other } = twoProjects();
	const { tools } = fakeTools();

	const relative = fakeCli();
	await run(tools, "tokensave_find_symbol", { name: "Example", project: "../other" }, session);
	expect(relative.calls.map((call) => call.project)).toStrictEqual([other]);

	const nested = fakeCli();
	await run(tools, "tokensave_find_symbol", { name: "Example", project: join(other, "src", "deep") }, session);
	expect(
		nested.calls.map((call) => call.project),
		"a path inside the project resolves to its root",
	).toStrictEqual([other]);
});

test("an uninitialized target returns an error naming its root and spawns no process", async () => {
	const { session, parent } = twoProjects();
	const plain = join(parent, "plain");
	mkdirSync(join(plain, ".git"), { recursive: true });
	const { tools } = fakeTools();
	const cli = fakeCli();

	for (const [name, params] of SIX_TOOLS) {
		const text = await run(tools, name, { ...params, project: plain }, session);
		expect(text).toMatch(`TokenSave is not initialized at ${plain}. Run /tokensave-init ${plain} or omit project.`);
	}
	expect(cli.calls).toStrictEqual([]);
});

describe("structured file paths", () => {
	const ambiguous: Responder = () => ({
		count: 2,
		matches: [
			{ id: "a1", name: "Twin", kind: "class", file: "src/twin_a.ts", line: 1 },
			{ id: "b1", name: "Twin", kind: "class", file: "src/twin_b.ts", line: 2 },
		],
	});
	const literal: Responder = () => ({
		literal: true,
		query: "boom",
		count: 1,
		matches: [{ file: "src/literal.ts", line: 5, text: "boom" }],
	});
	const iface: Responder = () => ({
		count: 1,
		matches: [{ id: "r1", name: "Runner", kind: "interface", file: "src/runner.ts", line: 2 }],
	});

	/** Every structured output site except the plain-text search fallback, one text per site. */
	async function allSites(project: string | undefined, cwd: string): Promise<Record<string, string>> {
		const { tools } = fakeTools();
		const p = project === undefined ? {} : { project };
		const texts: Record<string, string> = {};
		fakeCli();
		texts.findSymbol = await run(tools, "tokensave_find_symbol", { name: "Example", ...p }, cwd);
		texts.searchArray = await run(tools, "tokensave_search", { query: "Example", ...p }, cwd);
		fakeCli({ search: literal });
		texts.searchLiteral = await run(tools, "tokensave_search", { query: "boom", literal: true, ...p }, cwd);
		fakeCli({ find_exact_symbol: ambiguous });
		texts.symbolAmbiguity = await run(tools, "tokensave_symbol", { name: "Twin", ...p }, cwd);
		texts.impactAmbiguity = await run(tools, "tokensave_impact", { name: "Twin", ...p }, cwd);
		fakeCli();
		texts.symbolRelations = await run(
			tools,
			"tokensave_symbol",
			{ name: "Example", includeCallers: true, includeCallees: true, includeImplementations: true, ...p },
			cwd,
		);
		fakeCli({ find_exact_symbol: iface });
		texts.traitImplementations = await run(
			tools,
			"tokensave_symbol",
			{ name: "Runner", includeImplementations: true, ...p },
			cwd,
		);
		fakeCli();
		texts.impactByName = await run(tools, "tokensave_impact", { name: "Example", includeTests: true, ...p }, cwd);
		texts.impactByFile = await run(tools, "tokensave_impact", { file: "src/example.ts", ...p }, cwd);
		return texts;
	}

	const EXPECTED: Record<string, string[]> = {
		findSymbol: ["- file: <root>src/example.ts:3", "Next step: read <root>src/example.ts before"],
		searchArray: ["— <root>src/example.ts:3"],
		searchLiteral: ["- <root>src/literal.ts:5 — boom"],
		symbolAmbiguity: ["— <root>src/twin_a.ts:1", "— <root>src/twin_b.ts:2"],
		impactAmbiguity: ["— <root>src/twin_a.ts:1", "— <root>src/twin_b.ts:2"],
		symbolRelations: [
			"- file: <root>src/example.ts:3",
			"caller_one — <root>src/a.ts:3",
			"callee_one — <root>src/b.ts:9",
			"impl Runner — <root>src/impl.ts:10",
		],
		traitImplementations: ["class Impl implements Runner — <root>src/impl.ts:4"],
		impactByName: ["Caller — <root>src/caller.ts:11", "- <root>test/example.test.ts"],
		impactByFile: ["Consumer — <root>src/consumer.ts", "Downstream — <root>src/downstream.ts:7"],
	};

	test("a foreign root makes every structured file absolute", async () => {
		const { session, other } = twoProjects();
		const texts = await allSites(other, session);
		for (const [site, lines] of Object.entries(EXPECTED)) {
			for (const line of lines) expect(texts[site], site).toContain(line.replace("<root>", `${other}/`));
		}
	});

	test("the session root keeps relative files", async () => {
		const { session } = twoProjects();
		const texts = await allSites(undefined, session);
		for (const [site, lines] of Object.entries(EXPECTED)) {
			for (const line of lines) expect(texts[site], site).toContain(line.replace("<root>", ""));
			expect(texts[site].split("\n").slice(1).join("\n"), site).not.toContain(`${session}/`);
		}
	});
});

test("tokensave_context on a foreign root keeps TokenSave's text under a relative-path header", async () => {
	const { session, other } = twoProjects();
	const { tools } = fakeTools();
	fakeCli();

	const text = await run(tools, "tokensave_context", { task: "explain Example", project: other }, session);
	expect(text).toBe(
		`Project: ${other}\nFile paths below are relative to ${other}.\n\n## Code Context\n\n- \`Example\` in src/example.ts:3`,
	);

	const own = await run(tools, "tokensave_context", { task: "explain Example" }, session);
	expect(own).toBe(`Project: ${session}\n\n## Code Context\n\n- \`Example\` in src/example.ts:3`);
});

test("tokensave_impact sends an absolute file inside the foreign root to the CLI root-relative", async () => {
	const { session, other } = twoProjects();
	const { tools } = fakeTools();
	const cli = fakeCli();

	await run(
		tools,
		"tokensave_impact",
		{ file: join(other, "src", "example.ts"), includeTests: true, project: other },
		session,
	);
	const argsOf = (tool: string) => cli.calls.find((call) => call.tool === tool)?.args;
	expect(argsOf("file_dependents")).toMatchObject({ file: "src/example.ts" });
	expect(argsOf("diff_context")).toMatchObject({ files: ["src/example.ts"] });
	expect(argsOf("affected")).toMatchObject({ files: ["src/example.ts"] });
});

test("an absolute pathInclude inside the foreign root filters and reaches the CLI root-relative", async () => {
	const { session, other } = twoProjects();
	const { tools } = fakeTools();
	fakeCli();

	const found = await run(
		tools,
		"tokensave_find_symbol",
		{ name: "Example", pathInclude: [join(other, "src")], project: other },
		session,
	);
	expect(found, "the local filter keeps a match under the stripped path").toContain(
		`- file: ${other}/src/example.ts:3`,
	);

	const cli = fakeCli();
	await run(
		tools,
		"tokensave_search",
		{ query: "Example", pathInclude: [join(other, "src")], project: other },
		session,
	);
	expect(cli.calls.find((call) => call.tool === "search")?.args).toMatchObject({ path_include: ["src"] });
});

describe("commands take an optional path", () => {
	function commands() {
		const registered: Record<string, { handler: (args: string, ctx: any) => Promise<void> }> = {};
		const pi = {
			registerCommand(name: string, def: any) {
				registered[name] = def;
			},
		} as unknown as ExtensionAPI;
		const state = { mode: "enforce" as TokensaveMode, modeSource: "settings" as TokensaveModeSource };
		registerTokensaveCommands(
			pi,
			() => state,
			() => {},
			() => ({ mode: state.mode, autoManageBranches: false }),
			() => {},
		);
		return registered;
	}

	test("/tokensave-status and /tokensave-sync run tokensave on a relative foreign path", async () => {
		const { session, other } = twoProjects();
		const registered = commands();
		const cli = fakeCli();

		await registered["tokensave-status"].handler("../other", ctxFor(session));
		await registered["tokensave-sync"].handler(" ../other ", ctxFor(session));
		expect(cli.commands).toStrictEqual([
			["status", other],
			["sync", other, "--doctor"],
		]);
	});

	test("/tokensave-init asks for confirmation naming the foreign root, then initializes it", async () => {
		const { session, parent } = twoProjects();
		const fresh = join(parent, "fresh");
		mkdirSync(join(fresh, ".git"), { recursive: true });
		const registered = commands();
		const cli = fakeCli();
		const prompts: string[] = [];
		const ctx = {
			...ctxFor(session),
			ui: { notify: () => {}, confirm: async (_t: string, m: string) => prompts.push(m) > 0 },
		};

		await registered["tokensave-init"].handler("../fresh", ctx);
		expect(prompts).toStrictEqual([`Run 'tokensave init' in ${fresh}?`]);
		expect(cli.commands).toStrictEqual([["init", fresh]]);
	});
});

describe("guard and reconciliation per root", () => {
	function plugin(agentDir = mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-"))) {
		const handlers: Record<string, Handler> = {};
		const tools: Record<string, any> = {};
		const pi = {
			agentDir,
			on(event: string, handler: Handler) {
				handlers[event] = handler;
			},
			registerTool(def: any) {
				tools[def.name] = def;
			},
			registerCommand() {},
			getActiveTools: () => ["bash", ...Object.keys(tools)],
			getCallableTools: () => ["bash", ...Object.keys(tools)],
			exec: async () => ({ code: 0, stdout: `*\trefs/heads/main\t${"a".repeat(40)}`, stderr: "", killed: false }),
		};
		pluginTokensave(pi as unknown as ExtensionAPI);
		return { handlers, tools };
	}

	const rg = (target: string) => ({ toolName: "bash", input: { command: `rg WellModel ${target}` } });

	test("a consultation in root A does not unblock a search in root B", async () => {
		const { session } = twoProjects();
		const { handlers, tools } = plugin();
		const ctx = ctxFor(session);
		fakeCli({
			find_exact_symbol: () => ({
				count: 1,
				matches: [{ id: "w1", name: "WellModel", kind: "class", file: "src/well.ts", line: 1 }],
			}),
		});

		await tools.tokensave_find_symbol.execute("c1", { name: "WellModel" }, undefined, () => {}, ctx);
		expect(await handlers.tool_call(rg("."), ctx), "consulted in the session root").toBe(undefined);
		expect((await handlers.tool_call(rg("../other"), ctx))?.block, "not consulted in the other root").toBe(true);

		await tools.tokensave_find_symbol.execute(
			"c2",
			{ name: "WellModel", project: "../other" },
			undefined,
			() => {},
			ctx,
		);
		expect(await handlers.tool_call(rg("../other"), ctx)).toBe(undefined);
	});

	test("rg WellModel ../other follows the target root, and names project when it is indexed", async () => {
		const { parent, session } = twoProjects();
		const plain = join(parent, "plain");
		mkdirSync(plain);
		const { handlers } = plugin();
		const ctx = ctxFor(session);
		fakeCli();

		expect(await handlers.tool_call(rg("../plain"), ctx), "a target without .tokensave is not guarded").toBe(
			undefined,
		);

		const blocked = await handlers.tool_call(rg("../other"), ctx);
		expect(blocked?.block).toBe(true);
		expect(blocked?.reason).toContain(`Pass project: "${join(parent, "other")}"`);

		const own = await handlers.tool_call(rg("."), ctx);
		expect(own?.block).toBe(true);
		expect(own?.reason).not.toContain("Pass project");
	});

	test("a tokensave_* call with project reconciles that root", async () => {
		const { session, other } = twoProjects();
		const agentDir = mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-"));
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ forkBuiltins: { "pi-tokensave": { autoManageBranches: true } } }),
		);
		const { handlers } = plugin(agentDir);
		const cli = fakeCli();

		await handlers.tool_call({ toolName: "tokensave_status", input: { project: "../other" } }, ctxFor(session));
		expect(cli.commands).toContainEqual(["branch", "add", "--path", other]);
		expect(cli.commands).toContainEqual(["sync", other]);
		expect(cli.commands.some((args) => args.includes(session))).toBe(false);
	});
});
