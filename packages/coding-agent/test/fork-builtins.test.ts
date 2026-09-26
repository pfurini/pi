// Fork-owned: guards the built-in extension mechanism (ADR-0009) across upstream merges.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_COLLAPSE_KEY,
	loadConfig as loadRpivConfig,
	resolveCollapseKey,
} from "../../builtins/rpiv-ask-user-question/config.ts";
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

	it("registers the tools of rpiv-ask-user-question", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const builtIn = subject
			.getExtensions()
			.extensions.find((extension) => extension.path === "<inline:@juicesharp/rpiv-ask-user-question>");
		expect(builtIn?.tools.has("ask_user_question")).toBe(true);
	});

	it("registers vcc_recall as a fork-owned built-in", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		const subject = loader([]);
		await subject.reload();

		const builtIn = subject.getExtensions().extensions.find((extension) => extension.path === "<inline:vcc-recall>");
		expect(builtIn?.hidden).toBe(true);
		expect(builtIn?.tools.has("vcc_recall")).toBe(true);
	});

	function rpivDescription(subject: DefaultResourceLoader): string | undefined {
		return subject
			.getExtensions()
			.extensions.find((extension) => extension.path === "<inline:@juicesharp/rpiv-ask-user-question>")
			?.tools.get("ask_user_question")?.definition.description;
	}

	function writeSettings(directory: string, description: string): void {
		mkdirSync(directory, { recursive: true });
		const settings = { forkBuiltins: { "rpiv-ask-user-question": { guidance: { description } } } };
		writeFileSync(join(directory, "settings.json"), JSON.stringify(settings));
	}

	it("configures rpiv-ask-user-question from forkBuiltins in the global settings file", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		writeSettings(agentDir, "global description");
		writeSettings(join(cwd, ".pi"), "project description");
		const subject = loader([]);
		await subject.reload();

		expect(rpivDescription(subject)).toBe("global description");
	});

	it("never configures rpiv-ask-user-question from a project settings file", async () => {
		vi.stubEnv("PI_FORK_BUILTINS", "on");
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		writeSettings(join(cwd, ".pi"), "project description");
		const subject = loader([]);
		await subject.reload();

		const description = rpivDescription(subject);
		expect(description).toBeDefined();
		expect(description).not.toBe("project description");
	});

	it("keeps only well-typed rpiv-ask-user-question settings", () => {
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		const settings = {
			forkBuiltins: { "rpiv-ask-user-question": { collapseKey: 42, guidance: { description: 7 } } },
		};
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));

		const config = loadRpivConfig();
		expect(config).toEqual({ guidance: {} });
		expect(resolveCollapseKey(config)).toBe(DEFAULT_COLLAPSE_KEY);
	});

	it("reads a BOM-prefixed settings file and ignores a malformed one", () => {
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		const settings = { forkBuiltins: { "rpiv-ask-user-question": { collapseKey: "alt+o" } } };
		writeFileSync(join(agentDir, "settings.json"), `\uFEFF${JSON.stringify(settings)}`);
		expect(loadRpivConfig().collapseKey).toBe("alt+o");

		writeFileSync(join(agentDir, "settings.json"), "{ not json");
		expect(loadRpivConfig()).toEqual({});
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
