/**
 * `before_agent_start` rule-injection behavior: the managed rules block must
 * be injected on every agent run until it is actually present in a loaded
 * context file, not gated by a one-shot per-session flag.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { ExtensionAPI } from "../../../src/core/extensions/types.ts";
import pluginTokensave from "../../../src/core/fork-builtins/tokensave/index.ts";
import { setExecFileImplForTest } from "../../../src/core/fork-builtins/tokensave/runner.ts";

// Tests below isolate settings through a fake HOME; the env override would win over it.
delete process.env.PI_CODING_AGENT_DIR;

type Cb = (
	error: (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null,
	stdout: string,
	stderr: string,
) => void;

type Handler = (event: any, ctx: any) => any;

function fakePi() {
	const handlers: Record<string, Handler> = {};
	const tools: Record<string, unknown> = {};
	const commands: Record<string, unknown> = {};
	return {
		handlers,
		on(event: string, handler: Handler) {
			handlers[event] = handler;
		},
		registerTool(def: any) {
			tools[def.name] = def;
		},
		registerCommand(name: string, def: any) {
			commands[name] = def;
		},
		// Pi activates registered extension tools by default; tests override this for
		// sessions that leave them out (pi-subagents `tools:` lists, `ext:` selectors).
		getActiveTools() {
			return ["read", "bash", "edit", "write", ...Object.keys(tools)];
		},
	} as unknown as ExtensionAPI & { handlers: Record<string, Handler> };
}

/** Pi 0.87's normalized prompt options: `contextFiles` and `sections` are always present. */
function promptOptions(cwd: string, contextFiles: Array<{ path: string; content: string }> = []) {
	return {
		cwd,
		contextFiles,
		sections: {} as Record<string, string>,
		forceSystemPrompt: undefined as string | undefined,
	};
}

function initializedProjectDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-tokensave-index-"));
	mkdirSync(join(dir, ".tokensave"));
	return dir;
}

test("before_agent_start injects the rules block when absent from loaded context files, on every call", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	const projectDir = initializedProjectDir();

	for (const prompt of ["hello", "hello again"]) {
		const event = {
			prompt,
			systemPrompt: "base prompt",
			systemPromptOptions: promptOptions(projectDir, [{ path: "/AGENTS.md", content: "unrelated instructions" }]),
		};
		await pi.handlers.before_agent_start(event, {});
		expect(event.systemPromptOptions.sections.tokensave?.includes("pi-tokensave:start"), prompt).toBeTruthy();
	}
});

test("before_agent_start does not duplicate injection once a loaded context file already contains the block", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	const projectDir = initializedProjectDir();

	const event = {
		prompt: "hello",
		systemPrompt: "base prompt",
		systemPromptOptions: promptOptions(projectDir, [
			{
				path: "/AGENTS.md",
				content: "some text\n<!-- pi-tokensave:start -->\nalready loaded\n<!-- pi-tokensave:end -->\n",
			},
		]),
	};

	const result = await pi.handlers.before_agent_start(event, {});
	expect(result).toBe(undefined);
});

test("before_agent_start skips rule injection outside TokenSave projects", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	const projectDir = mkdtempSync(join(tmpdir(), "pi-tokensave-index-"));
	const event = {
		prompt: "hello",
		systemPrompt: "base prompt",
		systemPromptOptions: promptOptions(projectDir),
	};

	const result = await pi.handlers.before_agent_start(event, {});
	expect(result).toBe(undefined);
});

test("before_agent_start adds the rules as a prompt section instead of replacing the prompt", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	const event = {
		prompt: "hello",
		systemPrompt: "base prompt",
		systemPromptOptions: promptOptions(initializedProjectDir()),
	};

	const result = await pi.handlers.before_agent_start(event, {});
	expect(result, "no systemPrompt override").toBe(undefined);
	expect(event.systemPromptOptions.sections.tokensave?.includes("pi-tokensave:start")).toBeTruthy();
});

test("before_agent_start appends to the text when an earlier handler already replaced the prompt", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	const systemPromptOptions = promptOptions(initializedProjectDir());
	systemPromptOptions.forceSystemPrompt = "replaced prompt";
	const event = { prompt: "hello", systemPrompt: "replaced prompt", systemPromptOptions };

	const result = await pi.handlers.before_agent_start(event, {});
	expect(result?.systemPrompt.startsWith("replaced prompt")).toBeTruthy();
	expect(result?.systemPrompt.includes("pi-tokensave:start")).toBeTruthy();
	expect(systemPromptOptions.sections).toStrictEqual({});
});

test("before_agent_start does not inject twice when the prompt embeds a parent prompt that has the block", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	// pi-subagents append mode: the parent's prompt, with its AGENTS.md block, becomes the preamble.
	const event = {
		prompt: "hello",
		systemPrompt: "You are Appender.\n\n<!-- pi-tokensave:start -->\nrules\n<!-- pi-tokensave:end -->",
		systemPromptOptions: promptOptions(initializedProjectDir()),
	};

	const result = await pi.handlers.before_agent_start(event, {});
	expect(result).toBe(undefined);
	expect(event.systemPromptOptions.sections).toStrictEqual({});
});

test("guarded tool calls do not probe the TokenSave binary outside initialized projects", async () => {
	const pi = fakePi();
	pluginTokensave(pi);
	let processCount = 0;
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		processCount += 1;
		cb(null, "tokensave 7.0.0", "");
		return {};
	});

	const projectDir = mkdtempSync(join(tmpdir(), "pi-tokensave-index-"));
	const result = await pi.handlers.tool_call(
		{ toolName: "bash", input: { command: 'rg "WellModel" .' } },
		{ cwd: projectDir, ui: { notify: () => {} } },
	);

	expect(result).toBe(undefined);
	expect(processCount).toBe(0);
});

test.afterEach(() => setExecFileImplForTest(undefined));

test("enforce mode blocks a symbol search through anchor_grep but allows a config-file search", async () => {
	const fakeHome = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	const previousHome = process.env.HOME;
	process.env.HOME = fakeHome;
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		cb(null, "tokensave 7.12.1", "");
		return {};
	});

	try {
		const pi = fakePi();
		pluginTokensave(pi);
		const ctx = { cwd: initializedProjectDir(), ui: { notify: () => {} } };

		const blocked = await pi.handlers.tool_call({ toolName: "anchor_grep", input: { pattern: "WellModel" } }, ctx);
		expect(blocked?.block).toBe(true);

		const config = await pi.handlers.tool_call(
			{ toolName: "anchor_grep", input: { pattern: "WellModel", path: "config/app.yaml" } },
			ctx,
		);
		expect(config).toBe(undefined);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});

test("a session without active TokenSave tools gets neither the guard nor the rules", async () => {
	let processCount = 0;
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		processCount += 1;
		cb(null, "tokensave 7.12.1", "");
		return {};
	});

	// A pi-subagents child with `tools: read, bash`: pi-tokensave loads, its tools stay inactive.
	const pi = fakePi();
	pi.getActiveTools = () => ["read", "bash"];
	pluginTokensave(pi);
	const projectDir = initializedProjectDir();

	const search = await pi.handlers.tool_call(
		{ toolName: "bash", input: { command: 'rg "WellModel" .' } },
		{ cwd: projectDir, ui: { notify: () => {} } },
	);
	expect(search, "the block would point at a tool the session cannot call").toBe(undefined);
	expect(processCount, "no binary probe either").toBe(0);

	const event = { prompt: "hello", systemPrompt: "base prompt", systemPromptOptions: promptOptions(projectDir) };
	expect(await pi.handlers.before_agent_start(event, {})).toBe(undefined);
	expect(event.systemPromptOptions.sections).toStrictEqual({});
});

test("the guard needs only tokensave_find_symbol among the TokenSave tools", async () => {
	const previousHome = process.env.HOME;
	process.env.HOME = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		cb(null, "tokensave 7.12.1", "");
		return {};
	});

	try {
		// A pi-subagents child with `tools: bash, ext:pi-tokensave/tokensave_find_symbol`.
		const pi = fakePi();
		pi.getActiveTools = () => ["bash", "tokensave_find_symbol"];
		pluginTokensave(pi);
		const blocked = await pi.handlers.tool_call(
			{ toolName: "bash", input: { command: 'rg "WellModel" .' } },
			{ cwd: initializedProjectDir(), ui: { notify: () => {} } },
		);
		expect(blocked?.block).toBe(true);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});

test("tool_call in prefer mode does not recommend a TokenSave tool when the binary is unavailable (ENOENT)", async () => {
	// Force pi-tokensave's persisted mode ('prefer') to load from an isolated
	// fake home directory instead of the real ~/.pi/agent/pi-tokensave.json.
	const fakeHome = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });
	writeFileSync(join(fakeHome, ".pi", "agent", "pi-tokensave.json"), JSON.stringify({ mode: "prefer" }), "utf8");
	const previousHome = process.env.HOME;
	process.env.HOME = fakeHome;

	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		const err = new Error("not found") as NodeJS.ErrnoException;
		err.code = "ENOENT";
		cb(err, "", "");
		return {};
	});

	try {
		const pi = fakePi();
		pluginTokensave(pi);

		const projectDir = mkdtempSync(join(tmpdir(), "pi-tokensave-index-"));
		mkdirSync(join(projectDir, ".tokensave"));

		const notifications: Array<{ message: string; level: string }> = [];
		const ctx = {
			cwd: projectDir,
			ui: { notify: (message: string, level = "info") => notifications.push({ message, level }) },
		};

		await pi.handlers.session_start({}, {});
		const result = await pi.handlers.tool_call({ toolName: "bash", input: { command: 'rg "WellModel" .' } }, ctx);

		expect(result).toBe(undefined);
		expect(notifications.length).toBe(0);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});

test("autoManageBranches starts reconciling at session start without blocking it, and a TokenSave tool waits for it", async () => {
	const fakeHome = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });
	writeFileSync(
		join(fakeHome, ".pi", "agent", "pi-tokensave.json"),
		JSON.stringify({ autoManageBranches: true }),
		"utf8",
	);
	const previousHome = process.env.HOME;
	process.env.HOME = fakeHome;

	const tokensaveCommands: string[][] = [];
	let releaseSync: (() => void) | undefined;
	let holdSync = true;
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		if (args[0] !== "--version") tokensaveCommands.push(args);
		if (args[0] === "sync" && holdSync) {
			releaseSync = () => cb(null, "ok", "");
			return {};
		}
		cb(null, args[0] === "--version" ? "tokensave 7.4.0" : "ok", "");
		return {};
	});
	const flush = () => new Promise((resolve) => setImmediate(resolve));
	const steps = () => tokensaveCommands.map((args) => (args[0] === "branch" ? `branch ${args[1]}` : args[0]));

	try {
		let refs = `*\trefs/heads/main\t${"a".repeat(40)}`;
		const pi = fakePi();
		pi.exec = async () => ({ code: 0, stdout: refs, stderr: "", killed: false });
		pluginTokensave(pi);

		const projectDir = initializedProjectDir();
		const ctx = { cwd: projectDir, ui: { notify: () => {} } };

		await pi.handlers.session_start({}, ctx);
		await flush();
		expect(steps(), "session start returns while the sync still runs").toStrictEqual(["branch add", "sync"]);

		let toolCallSettled = false;
		const toolCall = Promise.resolve(pi.handlers.tool_call({ toolName: "tokensave_status", input: {} }, ctx)).then(
			() => {
				toolCallSettled = true;
			},
		);
		await flush();
		expect(toolCallSettled, "a TokenSave tool call waits for the reconciliation in flight").toBe(false);

		holdSync = false;
		releaseSync?.();
		await toolCall;
		expect(steps(), "the tool call joins the run instead of starting another").toStrictEqual([
			"branch add",
			"sync",
			"branch gc",
		]);

		await pi.handlers.tool_call({ toolName: "tokensave_status", input: {} }, ctx);
		expect(tokensaveCommands.length, "unchanged refs should stay cached").toBe(3);

		refs = `*\trefs/heads/main\t${"b".repeat(40)}`;
		await pi.handlers.tool_call({ toolName: "tokensave_status", input: {} }, ctx);
		expect(tokensaveCommands.length, "a new commit should sync before the tool runs").toBe(6);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});

test("the guard stands down while a skill disallows tokensave_find_symbol, but the rules stay", async () => {
	const previousHome = process.env.HOME;
	process.env.HOME = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		cb(null, "tokensave 7.12.1", "");
		return {};
	});

	try {
		// The Pi fork: the skill's `disallowed-tools` keeps the tool active but not callable.
		const pi = fakePi() as ExtensionAPI & { handlers: Record<string, Handler>; getCallableTools: () => string[] };
		pi.getCallableTools = () => pi.getActiveTools().filter((name) => name !== "tokensave_find_symbol");
		pluginTokensave(pi);
		const projectDir = initializedProjectDir();

		const search = await pi.handlers.tool_call(
			{ toolName: "bash", input: { command: 'rg "WellModel" .' } },
			{ cwd: projectDir, ui: { notify: () => {} } },
		);
		expect(search, "the block would point at a tool the skill blocks").toBe(undefined);

		const event = { prompt: "hello", systemPrompt: "base prompt", systemPromptOptions: promptOptions(projectDir) };
		await pi.handlers.before_agent_start(event, {});
		expect(event.systemPromptOptions.sections.tokensave?.includes("pi-tokensave:start")).toBeTruthy();
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});

test("a subagent session in the same process reuses the parent's branch reconciliation", async () => {
	const fakeHome = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });
	writeFileSync(
		join(fakeHome, ".pi", "agent", "pi-tokensave.json"),
		JSON.stringify({ autoManageBranches: true }),
		"utf8",
	);
	const previousHome = process.env.HOME;
	process.env.HOME = fakeHome;

	const tokensaveCommands: string[][] = [];
	setExecFileImplForTest((_file, args: string[], _options, cb: Cb) => {
		if (args[0] !== "--version") tokensaveCommands.push(args);
		cb(null, args[0] === "--version" ? "tokensave 7.12.1" : "ok", "");
		return {};
	});

	try {
		const refs = `*\trefs/heads/main\t${"a".repeat(40)}`;
		const projectDir = initializedProjectDir();
		const ctx = { cwd: projectDir, ui: { notify: () => {} } };

		const parent = fakePi();
		parent.exec = async () => ({ code: 0, stdout: refs, stderr: "", killed: false });
		pluginTokensave(parent);
		await parent.handlers.session_start({}, ctx);
		await parent.handlers.tool_call({ toolName: "tokensave_status", input: {} }, ctx);
		expect(tokensaveCommands.length, "the parent reconciles once").toBe(3);

		// pi-subagents loads a fresh copy of the extension for each child session.
		const child = fakePi();
		child.exec = async () => ({ code: 0, stdout: refs, stderr: "", killed: false });
		pluginTokensave(child);
		await child.handlers.session_start({}, ctx);
		await child.handlers.tool_call({ toolName: "tokensave_status", input: {} }, ctx);
		expect(tokensaveCommands.length, "the child starts no TokenSave command").toBe(3);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});

test("a session with its own agentDir reads settings and installs rules there, not under HOME", async () => {
	const fakeHome = mkdtempSync(join(tmpdir(), "pi-tokensave-home-"));
	const agentDir = mkdtempSync(join(tmpdir(), "pi-tokensave-agentdir-"));
	writeFileSync(join(agentDir, "pi-tokensave.json"), JSON.stringify({ mode: "prefer" }), "utf8");
	const previousHome = process.env.HOME;
	process.env.HOME = fakeHome;
	setExecFileImplForTest((_file, _args: string[], _options, cb: Cb) => {
		cb(null, "tokensave 7.12.1", "");
		return {};
	});

	try {
		const pi = fakePi() as ExtensionAPI & { handlers: Record<string, Handler>; agentDir: string };
		pi.agentDir = agentDir;
		pluginTokensave(pi);
		const ctx = { cwd: initializedProjectDir(), agentDir, ui: { notify: () => {} } };
		const search = { toolName: "bash", input: { command: 'rg "WellModel" .' } };

		expect(await pi.handlers.tool_call(search, ctx), "load-time settings come from pi.agentDir").toBe(undefined);

		await pi.handlers.session_start({}, ctx);
		expect(await pi.handlers.tool_call(search, ctx), "session settings come from ctx.agentDir").toBe(undefined);
		expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8").includes("pi-tokensave:start")).toBeTruthy();
		expect(existsSync(join(fakeHome, ".pi", "agent", "AGENTS.md"))).toBe(false);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
	}
});
