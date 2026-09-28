// Fork-owned: guards the built-in extension mechanism (ADR-0009) across upstream merges.
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InlineExtension } from "../src/core/extensions/types.ts";
import { createForkBuiltInExtensions, FORK_BUILTIN_PACKAGES, FORK_OWNED_BUILTINS } from "../src/core/fork-builtins.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import type { ExtensionAPI } from "../src/index.ts";

const noop: (pi: ExtensionAPI) => void = () => {};

describe("fork built-in extensions", () => {
	let root: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		root = join(tmpdir(), `pi-fork-builtins-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(root, "project");
		agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function loader(extensionFactories: InlineExtension[] = [noop]) {
		return new DefaultResourceLoader({
			cwd,
			agentDir,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			extensionFactories,
		});
	}

	it("loads every listed package after the caller's factories, hidden, under noExtensions", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader();
		await subject.reload();

		const { extensions, errors } = subject.getExtensions();
		expect(errors).toEqual([]);
		expect(extensions.map((extension) => extension.path)).toEqual([
			"<inline:1>",
			...FORK_BUILTIN_PACKAGES.map((name) => `<inline:${name}>`),
			...FORK_OWNED_BUILTINS.map((builtIn) => `<inline:${builtIn.name}>`),
		]);
		expect(extensions.slice(1).every((extension) => extension.hidden === true)).toBe(true);
	});

	it("leaves ask_user_question and vcc_recall to AgentSession, which registers them as base tools", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const tools = subject.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
		expect(tools).not.toContain("ask_user_question");
		expect(tools).not.toContain("vcc_recall");
	});

	it("registers the TokenSave tools and commands as a fork-owned built-in", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const builtIn = subject.getExtensions().extensions.find((extension) => extension.path === "<inline:tokensave>");
		expect(builtIn?.hidden).toBe(true);
		expect([...(builtIn?.tools.keys() ?? [])].sort()).toEqual([
			"tokensave_context",
			"tokensave_find_symbol",
			"tokensave_impact",
			"tokensave_search",
			"tokensave_status",
			"tokensave_symbol",
		]);
		expect(builtIn?.commands.has("tokensave-mode")).toBe(true);
	});

	it("registers the subagents presentation as a fork-owned built-in, with no tool", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const builtIn = subject.getExtensions().extensions.find((extension) => extension.path === "<inline:subagents>");
		expect(builtIn?.hidden).toBe(true);
		expect(builtIn?.tools.size).toBe(0);
	});

	it("loads no built-in when PI_FORK_BUILTINS is off", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const subject = loader();
		await subject.reload();

		expect(subject.getExtensions().extensions.map((extension) => extension.path)).toEqual(["<inline:1>"]);
	});

	it("reads the switch when the loader is constructed, not when it reloads", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const constructedOn = loader([]);
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const constructedOff = loader([]);
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		await constructedOff.reload();
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		await constructedOn.reload();

		expect(constructedOn.getExtensions().extensions).toHaveLength(
			FORK_BUILTIN_PACKAGES.length + FORK_OWNED_BUILTINS.length,
		);
		expect(constructedOff.getExtensions().extensions).toEqual([]);
	});

	it("reports a missing package by name and keeps loading the factories after it", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "off");
		const subject = loader([
			noop,
			...createForkBuiltInExtensions(["@pi-fork/missing-builtin"]),
			{ name: "sentinel", factory: noop },
		]);
		await subject.reload();

		const { extensions, errors } = subject.getExtensions();
		expect(extensions.map((extension) => extension.path)).toEqual(["<inline:1>", "<inline:sentinel>"]);
		expect(errors).toHaveLength(1);
		expect(errors[0].path).toBe("<inline:@pi-fork/missing-builtin>");
		expect(errors[0].error).toContain("@pi-fork/missing-builtin");
	});
});
