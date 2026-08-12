/**
 * A.3.5 shell injection executor tests: lexer, tool-policy gate (with
 * ADR-0006 redirect-map canonicalization), markers, timeout unit conversion,
 * output cap, abort, aggregate budget, and sequential ordering.
 */

import { describe, expect, it } from "vitest";
import type { ResourceDiagnostic } from "../../src/core/diagnostics.ts";
import {
	commandTimedOutMarker,
	DEFAULT_SKILL_SHELL_SETTINGS,
	evaluateShellGate,
	exitCodeMarker,
	injectShellCommands,
	MAX_SHELL_INJECTIONS_PER_RENDER,
	normalizeDisallowedTools,
	outputTruncatedMarker,
	SHELL_MARKERS,
	type ShellInjectionOptions,
	type SkillShellSettings,
	shellUnavailableMarker,
	splitInjectionSegments,
} from "../../src/core/skills/shell-injection.ts";
import { canonicalizeToolName, DEFAULT_TOOL_REDIRECTS } from "../../src/core/skills/tool-redirects.ts";
import type { BashOperations } from "../../src/core/tools/bash.ts";

const SETTINGS: SkillShellSettings = { ...DEFAULT_SKILL_SHELL_SETTINGS };

interface ExecRecord {
	command: string;
	cwd: string;
	timeout?: number;
	env?: NodeJS.ProcessEnv;
}

/** Fake BashOperations: deterministic, records calls, replays scripted outcomes. */
function fakeOperations(script: Array<{ output?: string; exitCode?: number | null; error?: Error }> = []): {
	operations: BashOperations;
	calls: ExecRecord[];
} {
	const calls: ExecRecord[] = [];
	let index = 0;
	const operations: BashOperations = {
		exec: async (command, cwd, options) => {
			calls.push({ command, cwd, timeout: options.timeout, env: options.env });
			const step = script[Math.min(index, script.length - 1)] ?? {};
			index++;
			if (step.error) {
				if (step.output) options.onData(Buffer.from(step.output));
				throw step.error;
			}
			if (options.signal?.aborted) {
				throw new Error("aborted");
			}
			if (step.output) options.onData(Buffer.from(step.output));
			return { exitCode: step.exitCode === undefined ? 0 : step.exitCode };
		},
	};
	return { operations, calls };
}

function injectionOptions(overrides: Partial<ShellInjectionOptions> = {}): ShellInjectionOptions {
	return {
		cwd: "/tmp/work",
		env: () => ({ FOO: "bar" }),
		activeToolNames: ["read", "bash", "edit"],
		settings: SETTINGS,
		...overrides,
	};
}

describe("splitInjectionSegments", () => {
	it("recognizes inline !`cmd` spans", () => {
		expect(splitInjectionSegments("run !`echo hi` now")).toEqual([
			{ kind: "text", text: "run " },
			{ kind: "command", command: "echo hi" },
			{ kind: "text", text: " now" },
		]);
	});

	it("recognizes fenced blocks whose info string is !", () => {
		const body = "before\n``` !\necho one\necho two\n```\nafter";
		expect(splitInjectionSegments(body)).toEqual([
			{ kind: "text", text: "before\n" },
			{ kind: "command", command: "echo one\necho two" },
			{ kind: "text", text: "\nafter" },
		]);
	});

	it("does not recognize inline spans inside non-! fenced blocks", () => {
		const body = "```bash\n!`echo hi`\n```";
		expect(splitInjectionSegments(body)).toEqual([{ kind: "text", text: body }]);
	});

	it("handles injection adjacent to backticks", () => {
		const segments = splitInjectionSegments("`code`!`echo hi``tail`");
		expect(segments).toEqual([
			{ kind: "text", text: "`code`" },
			{ kind: "command", command: "echo hi" },
			{ kind: "text", text: "`tail`" },
		]);
	});

	it("an unterminated fence runs to end of input", () => {
		expect(splitInjectionSegments("``` !\necho hi")).toEqual([{ kind: "command", command: "echo hi" }]);
	});
});

describe("canonicalizeToolName (shared redirect resolver)", () => {
	it("maps CC names to Pi names", () => {
		expect(canonicalizeToolName("Bash")).toBe("bash");
		expect(canonicalizeToolName("Task")).toBe("Agent");
		expect(canonicalizeToolName("AskUserQuestion")).toBe("ask_user_question");
		expect(canonicalizeToolName("Glob")).toBe("find");
	});

	it("matches case-insensitively", () => {
		expect(canonicalizeToolName("bash")).toBe("bash");
		expect(canonicalizeToolName("BASH")).toBe("bash");
		expect(canonicalizeToolName("task")).toBe("Agent");
	});

	it("passes unmapped names through unchanged", () => {
		expect(canonicalizeToolName("read")).toBe("read");
		expect(canonicalizeToolName("custom_tool")).toBe("custom_tool");
	});

	it("ships the A.8 default map", () => {
		expect(DEFAULT_TOOL_REDIRECTS.Task).toBe("Agent");
		expect(DEFAULT_TOOL_REDIRECTS.SlashCommand).toBe("slash_command");
	});
});

describe("normalizeDisallowedTools", () => {
	it("accepts a YAML list or one comma-separated string", () => {
		expect(normalizeDisallowedTools(["Bash", "Task"])).toEqual(["Bash", "Task"]);
		expect(normalizeDisallowedTools("Bash, Task")).toEqual(["Bash", "Task"]);
		expect(normalizeDisallowedTools(undefined)).toEqual([]);
	});

	it("reduces Tool(pattern) entries to the bare name with a diagnostic", () => {
		const diagnostics: ResourceDiagnostic[] = [];
		expect(normalizeDisallowedTools(["Bash(rm *)"], diagnostics)).toEqual(["Bash"]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("parenthesized pattern");
	});

	it("skips wildcards with a diagnostic", () => {
		const diagnostics: ResourceDiagnostic[] = [];
		expect(normalizeDisallowedTools(["Ba*"], diagnostics)).toEqual([]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("wildcard");
	});
});

describe("evaluateShellGate (A.3.5 tool-policy gate)", () => {
	it("allows when bash is active and not disallowed", () => {
		expect(evaluateShellGate({ activeToolNames: ["bash"], settings: SETTINGS })).toEqual({ allowed: true });
	});

	it("kill switch produces the policy marker", () => {
		const gate = evaluateShellGate({
			activeToolNames: ["bash"],
			settings: { ...SETTINGS, disabled: true },
		});
		expect(gate).toEqual({ allowed: false, marker: SHELL_MARKERS.disabledByPolicy });
	});

	it("no bash in the active set (--no-tools / excluded) produces the tool-policy marker", () => {
		expect(evaluateShellGate({ activeToolNames: ["read"], settings: SETTINGS }).marker).toBe(
			SHELL_MARKERS.disabledByToolPolicy,
		);
		expect(evaluateShellGate({ activeToolNames: [], settings: SETTINGS }).marker).toBe(
			SHELL_MARKERS.disabledByToolPolicy,
		);
	});

	it("disallowed-tools: [bash] blocks injection", () => {
		const gate = evaluateShellGate({ activeToolNames: ["bash"], disallowedTools: ["bash"], settings: SETTINGS });
		expect(gate.marker).toBe(SHELL_MARKERS.disabledByToolPolicy);
	});

	it("disallowed-tools: [Bash] blocks bash after redirect-map canonicalization", () => {
		// A raw case-sensitive comparison would let this through.
		const gate = evaluateShellGate({ activeToolNames: ["bash"], disallowedTools: ["Bash"], settings: SETTINGS });
		expect(gate.allowed).toBe(false);
		expect(gate.marker).toBe(SHELL_MARKERS.disabledByToolPolicy);
	});

	it("disallowed-tools: [Task] canonicalizes to Agent and does NOT block bash injection", () => {
		const gate = evaluateShellGate({ activeToolNames: ["bash"], disallowedTools: ["Task"], settings: SETTINGS });
		expect(gate.allowed).toBe(true);
	});

	it("kill switch and tool policy produce different markers", () => {
		expect(SHELL_MARKERS.disabledByPolicy).not.toBe(SHELL_MARKERS.disabledByToolPolicy);
	});
});

describe("injectShellCommands", () => {
	it("executes inline and fenced injections sequentially in document order", async () => {
		const { operations, calls } = fakeOperations([{ output: "one\n" }, { output: "two\n" }]);
		const body = "first: !`cmd1`\n``` !\ncmd2\n```\ndone";
		const result = await injectShellCommands(body, injectionOptions({ operations }));
		expect(calls.map((call) => call.command)).toEqual(["cmd1", "cmd2"]);
		expect(result).toBe("first: one\n\ntwo\n\ndone");
	});

	it("passes cwd and the scoped env through", async () => {
		const { operations, calls } = fakeOperations([{}]);
		await injectShellCommands("!`cmd`", injectionOptions({ operations }));
		expect(calls[0].cwd).toBe("/tmp/work");
		expect(calls[0].env).toEqual({ FOO: "bar" });
	});

	it("converts skillShellTimeoutMs (milliseconds) to seconds at the adapter boundary", async () => {
		const { operations, calls } = fakeOperations([{}]);
		await injectShellCommands(
			"!`cmd`",
			injectionOptions({ operations, settings: { ...SETTINGS, timeoutMs: 30000 } }),
		);
		// 30000ms → 30 seconds; passing 30000 through would be ~8.3 hours.
		expect(calls[0].timeout).toBe(30);
	});

	it("a timeout inlines the exact marker", async () => {
		const { operations } = fakeOperations([{ error: new Error("timeout:30") }]);
		const result = await injectShellCommands("!`cmd`", injectionOptions({ operations }));
		expect(result).toBe(commandTimedOutMarker(30000));
		expect(result).toBe("[command timed out after 30s]");
	});

	it("a non-zero exit inlines the output plus the exit marker", async () => {
		const { operations } = fakeOperations([{ output: "boom", exitCode: 3 }]);
		const result = await injectShellCommands("!`cmd`", injectionOptions({ operations }));
		expect(result).toBe(`boom\n${exitCodeMarker(3)}`);
	});

	it("a non-zero exit without output inlines just the marker", async () => {
		const { operations } = fakeOperations([{ exitCode: 1 }]);
		const result = await injectShellCommands("!`cmd`", injectionOptions({ operations }));
		expect(result).toBe(exitCodeMarker(1));
	});

	it("caps output at the byte limit with a truncation marker", async () => {
		const { operations } = fakeOperations([{ output: "x".repeat(100) }]);
		const result = await injectShellCommands(
			"!`cmd`",
			injectionOptions({ operations, settings: { ...SETTINGS, outputLimitBytes: 10 } }),
		);
		expect(result).toBe(`${"x".repeat(10)}\n${outputTruncatedMarker(10)}`);
	});

	it("decodes a multibyte sequence cut by the cap without crashing", async () => {
		const snowman = "☃".repeat(10); // 3 bytes each
		const { operations } = fakeOperations([{ output: snowman }]);
		const result = await injectShellCommands(
			"!`cmd`",
			injectionOptions({ operations, settings: { ...SETTINGS, outputLimitBytes: 8 } }),
		);
		expect(result).toContain(outputTruncatedMarker(8));
		expect(result.length).toBeLessThan(snowman.length + 40);
	});

	it("an unavailable shell inlines the unavailable marker", async () => {
		const enoent = Object.assign(new Error("spawn pwsh ENOENT"), { code: "ENOENT" });
		const { operations } = fakeOperations([{ error: enoent }]);
		const result = await injectShellCommands("!`cmd`", injectionOptions({ operations, shell: "powershell" }));
		expect(result).toBe(shellUnavailableMarker("powershell"));
	});

	it("an aborted session inlines the aborted marker and does not execute further blocks", async () => {
		const controller = new AbortController();
		controller.abort();
		const { operations, calls } = fakeOperations([{}, {}]);
		const result = await injectShellCommands(
			"!`cmd1` and !`cmd2`",
			injectionOptions({ operations, signal: controller.signal }),
		);
		expect(calls).toHaveLength(0);
		expect(result).toBe(`${SHELL_MARKERS.aborted} and ${SHELL_MARKERS.aborted}`);
	});

	it("an abort error from the backend becomes the aborted marker", async () => {
		const { operations } = fakeOperations([{ error: new Error("aborted") }]);
		const result = await injectShellCommands("!`cmd`", injectionOptions({ operations }));
		expect(result).toBe(SHELL_MARKERS.aborted);
	});

	it("an unexpected backend error inlines a failure marker and the render continues", async () => {
		const { operations } = fakeOperations([{ error: new Error("spawn blew up") }, { output: "ok" }]);
		const result = await injectShellCommands("!`cmd1` then !`cmd2`", injectionOptions({ operations }));
		expect(result).toBe("[shell execution failed: spawn blew up] then ok");
	});

	it("replaces each injection with the policy marker when the kill switch is set", async () => {
		const { operations, calls } = fakeOperations();
		const result = await injectShellCommands(
			"!`a` !`b`",
			injectionOptions({ operations, settings: { ...SETTINGS, disabled: true } }),
		);
		expect(calls).toHaveLength(0);
		expect(result).toBe(`${SHELL_MARKERS.disabledByPolicy} ${SHELL_MARKERS.disabledByPolicy}`);
	});

	it("replaces each injection with the tool-policy marker when bash is not active", async () => {
		const { operations, calls } = fakeOperations();
		const result = await injectShellCommands("!`a`", injectionOptions({ operations, activeToolNames: ["read"] }));
		expect(calls).toHaveLength(0);
		expect(result).toBe(SHELL_MARKERS.disabledByToolPolicy);
	});

	it("injected output is never re-scanned for injection syntax", async () => {
		const { operations, calls } = fakeOperations([{ output: "!`echo nested`" }]);
		const result = await injectShellCommands("!`cmd`", injectionOptions({ operations }));
		expect(calls).toHaveLength(1);
		expect(result).toBe("!`echo nested`");
	});

	it("enforces the aggregate injection budget with an explicit marker", async () => {
		const blockCount = MAX_SHELL_INJECTIONS_PER_RENDER + 2;
		const body = Array.from({ length: blockCount }, (_, i) => `!` + `\`cmd${i}\``).join("\n");
		const { operations, calls } = fakeOperations([{ output: "x" }]);
		const result = await injectShellCommands(body, injectionOptions({ operations }));
		expect(calls).toHaveLength(MAX_SHELL_INJECTIONS_PER_RENDER);
		const limitMarkers = result.split(SHELL_MARKERS.injectionLimitReached).length - 1;
		expect(limitMarkers).toBe(2);
		const successCount = result.split("\n").filter((line) => line === "x").length;
		expect(successCount).toBe(MAX_SHELL_INJECTIONS_PER_RENDER);
	});

	it("emits disallowed-tools normalization diagnostics while gating", async () => {
		const diagnostics: ResourceDiagnostic[] = [];
		const { operations, calls } = fakeOperations([{ output: "ok" }]);
		const result = await injectShellCommands(
			"!`cmd`",
			injectionOptions({ operations, disallowedTools: ["Task(*)"], diagnostics }),
		);
		expect(result).toBe("ok");
		expect(calls).toHaveLength(1);
		expect(diagnostics.some((d) => d.message.includes("parenthesized pattern"))).toBe(true);
	});
});

describe("injectShellCommands with the real local backend", () => {
	it("executes a real command and inlines stdout", async () => {
		const result = await injectShellCommands("!`echo c1b-real`", injectionOptions({ cwd: process.cwd() }));
		expect(result).toBe("c1b-real\n");
	});

	it("aborts a running command's process tree on session abort", async () => {
		const controller = new AbortController();
		const started = Date.now();
		const promise = injectShellCommands(
			"!`sleep 30`",
			injectionOptions({ cwd: process.cwd(), signal: controller.signal }),
		);
		setTimeout(() => controller.abort(), 100);
		const result = await promise;
		expect(result).toBe(SHELL_MARKERS.aborted);
		expect(Date.now() - started).toBeLessThan(10000);
	}, 15000);
});
