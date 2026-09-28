// Fork-owned: the agent-file edits behind `/agents` (plan T13). Old pi-subagents tests at 79a7c42
// this covers: agent-file-toggle, custom-agents (eject). The loader's own parser decides what a
// file means, so every agreement check asks `parseAgentFile`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENTS } from "../../../src/core/fork-builtins/subagents/definitions/defaults.ts";
import {
	type AgentFileDirectories,
	buildNewAgentFile,
	disableInContent,
	enableInContent,
	findAgentFile,
	isDisabledContent,
	isEmptyStub,
	locateAgentFile,
	serializeAgentDefinition,
} from "../../../src/core/fork-builtins/subagents/definitions/files.ts";
import { parseAgentFile } from "../../../src/core/fork-builtins/subagents/definitions/frontmatter.ts";
import type { AgentDefinition } from "../../../src/core/fork-builtins/subagents/definitions/types.ts";
import { parseFrontmatter } from "../../../src/utils/frontmatter.ts";

const SOURCE = { kind: "project", sourcePath: "/project/.pi/agents/scout.md" } as const;

/** What the loader concludes about a file. */
function loaderSeesDisabled(content: string): boolean {
	return parseAgentFile(content, SOURCE).definition?.enabled === false;
}

const HAND_AUTHORED_DISABLED = "---\ndescription: Scout the repo\nenabled: false\n---\n\nYou are a scout.\n";
const WRITTEN_DISABLED = "---\nenabled: false\ndescription: Scout the repo\n---\n\nYou are a scout.\n";
const ENABLED = "---\ndescription: Scout the repo\n---\n\nYou are a scout.\n";

describe("enableInContent", () => {
	it("strips enabled: false when it is the first frontmatter line", () => {
		const { content, changed } = enableInContent(WRITTEN_DISABLED);
		expect(changed).toBe(true);
		expect(loaderSeesDisabled(content)).toBe(false);
	});

	it("strips enabled: false when another key precedes it", () => {
		const { content, changed } = enableInContent(HAND_AUTHORED_DISABLED);
		expect(changed).toBe(true);
		expect(loaderSeesDisabled(content)).toBe(false);
	});

	it("strips enabled: false when it is the last frontmatter line", () => {
		const { content, changed } = enableInContent(
			"---\ndescription: Scout\ndisplay_name: Scout\nenabled: false\n---\n\nBody.\n",
		);
		expect(changed).toBe(true);
		expect(loaderSeesDisabled(content)).toBe(false);
	});

	it("reports changed: false when there is nothing to strip", () => {
		expect(enableInContent(ENABLED)).toEqual({ content: ENABLED, changed: false });
	});

	// T18-F6: a key the edit cannot remove was reported as not disabled.
	it("refuses a disabled key it cannot rewrite, rather than write a file that stays disabled or no longer parses", () => {
		for (const source of [
			'---\ndescription: x\n"enabled": false\n---\nbody\n',
			"---\ndescription: x\nenabled:\n  false\n---\nbody\n",
		]) {
			expect(loaderSeesDisabled(source), JSON.stringify(source)).toBe(true);
			expect(enableInContent(source)).toEqual({ content: source, changed: false, cannotRewrite: true });
		}
	});

	it("leaves the body and other frontmatter keys untouched", () => {
		const { content } = enableInContent(
			"---\ndescription: Scout\nenabled: false\n# a comment\nmodel: haiku\n---\n\nLine 1.\n\nLine 2.\n",
		);
		expect(content).toBe("---\ndescription: Scout\n# a comment\nmodel: haiku\n---\n\nLine 1.\n\nLine 2.\n");
		expect(loaderSeesDisabled(content)).toBe(false);
	});

	it("handles CRLF line endings", () => {
		const { content, changed } = enableInContent(
			"---\r\ndescription: Scout\r\nenabled: false\r\n---\r\n\r\nBody.\r\n",
		);
		expect(changed).toBe(true);
		expect(content).toBe("---\r\ndescription: Scout\r\n---\r\n\r\nBody.\r\n");
		expect(loaderSeesDisabled(content)).toBe(false);
	});
});

describe("disableInContent", () => {
	it("inserts enabled: false into a normal frontmatter block", () => {
		const { content, outcome } = disableInContent(ENABLED);
		expect(outcome).toBe("disabled");
		expect(content).toBe(`---\nenabled: false\n${ENABLED.slice(4)}`);
		expect(loaderSeesDisabled(content)).toBe(true);
	});

	it("is idempotent when the key is already first", () => {
		expect(disableInContent(WRITTEN_DISABLED)).toEqual({ content: WRITTEN_DISABLED, outcome: "already-disabled" });
	});

	it("is idempotent when the key is already present mid-block", () => {
		expect(disableInContent(HAND_AUTHORED_DISABLED).outcome).toBe("already-disabled");
	});

	it("never writes a file the loader cannot parse", () => {
		for (const source of [
			"---\ndescription: x\nenabled: false  \n---\nbody\n",
			"---\ndescription: x\nenabled: false\t\n---\nbody\n",
			HAND_AUTHORED_DISABLED,
			WRITTEN_DISABLED,
			ENABLED,
			"---\ndescription: x\nenabled: true\n---\nbody\n",
			'---\ndescription: x\n"enabled": true\n---\nbody\n',
		]) {
			const { content, outcome } = disableInContent(source);
			expect(parseAgentFile(content, SOURCE).error, JSON.stringify(source)).toBeUndefined();
			if (outcome !== "cannot-rewrite") expect(loaderSeesDisabled(content), JSON.stringify(source)).toBe(true);
		}
	});

	it("replaces an enabled: true line instead of adding a second key", () => {
		const { content, outcome } = disableInContent("---\ndescription: x\nenabled: true\n---\nbody\n");
		expect(outcome).toBe("disabled");
		expect(content).toBe("---\ndescription: x\nenabled: false\n---\nbody\n");
		expect(loaderSeesDisabled(content)).toBe(true);
	});

	it("refuses an enabled key it cannot rewrite, rather than write a file the loader cannot parse", () => {
		const source = '---\ndescription: x\n"enabled": true\n---\nbody\n';
		expect(disableInContent(source)).toEqual({ content: source, outcome: "cannot-rewrite" });
	});

	it("reports no-frontmatter rather than claiming success on a fence-less file", () => {
		const source = "Just a body, no frontmatter at all.\n";
		expect(disableInContent(source)).toEqual({ content: source, outcome: "no-frontmatter" });
	});

	it("disables a CRLF file instead of misreporting it as frontmatter-less", () => {
		const { content, outcome } = disableInContent("---\r\ndescription: Scout\r\n---\r\n\r\nBody.\r\n");
		expect(outcome).toBe("disabled");
		expect(content).toBe("---\r\nenabled: false\r\ndescription: Scout\r\n---\r\n\r\nBody.\r\n");
		expect(loaderSeesDisabled(content)).toBe(true);
	});

	it("toggles a BOM-prefixed file, and leaves the BOM where it found it", () => {
		const source = "\uFEFF---\ndescription: 侦察\n---\n\n本文。\n";
		const { content, outcome } = disableInContent(source);
		expect(outcome).toBe("disabled");
		expect(isDisabledContent(content)).toBe(true);
		expect(content.startsWith("\uFEFF---\nenabled: false\n")).toBe(true);
		expect(enableInContent(content).content).toBe(source);
	});
});

describe("isDisabledContent", () => {
	it("sees the key at the first frontmatter line", () => {
		expect(isDisabledContent(WRITTEN_DISABLED)).toBe(true);
	});

	it("sees the key mid-block", () => {
		expect(isDisabledContent(HAND_AUTHORED_DISABLED)).toBe(true);
	});

	it("sees the key in a CRLF file", () => {
		expect(isDisabledContent("---\r\ndescription: Scout\r\nenabled: false\r\n---\r\n\r\nBody.\r\n")).toBe(true);
	});

	it("is false for an enabled file", () => {
		expect(isDisabledContent(ENABLED)).toBe(false);
	});

	it.each([
		["lowercase bare false", "---\ndescription: x\nenabled: false\n---\nbody\n", true],
		["False", "---\ndescription: x\nenabled: False\n---\nbody\n", true],
		["FALSE", "---\ndescription: x\nenabled: FALSE\n---\nbody\n", true],
		["trailing comment", "---\ndescription: x\nenabled: false # off for now\n---\nbody\n", true],
		["quoted key", '---\ndescription: x\n"enabled": false\n---\nbody\n', true],
		["trailing whitespace", "---\ndescription: x\nenabled: false  \n---\nbody\n", true],
		["'----' closes the block early", "---\ndescription: x\n----\nenabled: false\n---\nbody\n", false],
		["quoted string, not a boolean", '---\ndescription: x\nenabled: "false"\n---\nbody\n', false],
		["YAML 1.1 'no' is a string here", "---\ndescription: x\nenabled: no\n---\nbody\n", false],
		["key only in the body", "---\ndescription: x\n---\nenabled: false\n", false],
	])("agrees with the loader: %s", (_label, content, expected) => {
		expect(loaderSeesDisabled(content)).toBe(expected);
		expect(isDisabledContent(content)).toBe(expected);
	});
});

describe("read and write paths agree", () => {
	const shapes: Array<[string, string]> = [
		["key first", WRITTEN_DISABLED],
		["key after description", HAND_AUTHORED_DISABLED],
		["key last", "---\ndescription: Scout\ndisplay_name: S\nenabled: false\n---\n\nBody.\n"],
		["CRLF", "---\r\ndescription: Scout\r\nenabled: false\r\n---\r\n\r\nBody.\r\n"],
		// T18-F6: a comment or another YAML spelling of false left the agent disabled.
		["key with a comment", "---\ndescription: Scout\nenabled: false # off for now\n---\n\nBody.\n"],
		["capitalized False", "---\ndescription: Scout\nenabled: False\n---\n\nBody.\n"],
	];

	for (const [label, content] of shapes) {
		it(`a file the loader reads as disabled can be enabled: ${label}`, () => {
			expect(loaderSeesDisabled(content)).toBe(true);
			const enabled = enableInContent(content);
			expect(enabled.changed).toBe(true);
			expect(loaderSeesDisabled(enabled.content)).toBe(false);
		});
	}

	it("disable then enable round-trips to the original hand-authored file", () => {
		const disabled = disableInContent(ENABLED);
		expect(disabled.outcome).toBe("disabled");
		expect(enableInContent(disabled.content).content).toBe(ENABLED);
	});
});

describe("isEmptyStub", () => {
	it("recognizes the stub behind a BOM", () => {
		expect(isEmptyStub("\uFEFF---\n---")).toBe(true);
	});

	it("recognizes the stub /agents writes to disable a default agent, once enabled", () => {
		expect(isEmptyStub("---\n---\n")).toBe(true);
		expect(isEmptyStub(enableInContent("---\nenabled: false\n---\n").content)).toBe(true);
	});

	it("is false for a file with real frontmatter", () => {
		expect(isEmptyStub(ENABLED)).toBe(false);
	});
});

describe("locating agent files", () => {
	let project: string;
	let agentDir: string;
	let directories: AgentFileDirectories;

	beforeEach(() => {
		project = mkdtempSync(join(tmpdir(), "sn2-files-project-"));
		agentDir = mkdtempSync(join(tmpdir(), "sn2-files-agentdir-"));
		directories = { cwd: project, agentDir, projectTrusted: true };
	});

	afterEach(() => {
		rmSync(project, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	});

	function write(dir: string, name: string) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${name}.md`), ENABLED);
	}

	it("prefers .pi/agents over .agents/agents and the personal directory", () => {
		write(join(project, ".pi", "agents"), "scout");
		write(join(project, ".agents", "agents"), "scout");
		write(join(agentDir, "agents"), "scout");
		expect(findAgentFile("scout", directories)).toEqual({
			path: join(project, ".pi", "agents", "scout.md"),
			location: "project",
		});
	});

	it("falls back to the workspace .agents/agents directory", () => {
		write(join(project, ".agents", "agents"), "scout");
		write(join(agentDir, "agents"), "scout");
		expect(findAgentFile("scout", directories)).toEqual({
			path: join(project, ".agents", "agents", "scout.md"),
			location: "workspace",
		});
	});

	it("falls back to the personal agent directory", () => {
		write(join(agentDir, "agents"), "scout");
		expect(findAgentFile("scout", directories)).toEqual({
			path: join(agentDir, "agents", "scout.md"),
			location: "personal",
		});
	});

	it("returns undefined when the agent has no file anywhere", () => {
		expect(findAgentFile("nope", directories)).toBeUndefined();
	});

	it("looks in no project location of an untrusted project", () => {
		write(join(project, ".pi", "agents"), "scout");
		write(join(agentDir, "agents"), "scout");
		expect(findAgentFile("scout", { ...directories, projectTrusted: false })).toEqual({
			path: join(agentDir, "agents", "scout.md"),
			location: "personal",
		});
	});

	it("skips a probed file that declares another agent's name", () => {
		mkdirSync(join(project, ".pi", "agents"), { recursive: true });
		writeFileSync(join(project, ".pi", "agents", "Explore.md"), `---\nname: scout\n${ENABLED.slice(4)}`);
		expect(findAgentFile("Explore", directories)).toBeUndefined();
		expect(locateAgentFile("Explore", undefined, directories)).toBeUndefined();
		write(join(agentDir, "agents"), "Explore");
		expect(findAgentFile("Explore", directories)).toEqual({
			path: join(agentDir, "agents", "Explore.md"),
			location: "personal",
		});
	});

	it("uses the file the loader read, whatever it is called", () => {
		write(join(project, ".pi", "agents"), "reviewer");
		const sourcePath = join(project, ".pi", "agents", "reviewer.md");
		expect(locateAgentFile("code-reviewer", sourcePath, directories)).toEqual({
			path: sourcePath,
			location: "project",
		});
	});

	it("classifies a workspace and a personal source path", () => {
		write(join(project, ".agents", "agents"), "reviewer");
		write(join(agentDir, "agents"), "auditor");
		expect(
			locateAgentFile("code-reviewer", join(project, ".agents", "agents", "reviewer.md"), directories),
		).toMatchObject({ location: "workspace" });
		expect(locateAgentFile("code-auditor", join(agentDir, "agents", "auditor.md"), directories)).toMatchObject({
			location: "personal",
		});
	});

	it("falls back to the <type>.md probe for a default agent with no source file", () => {
		write(join(project, ".pi", "agents"), "scout");
		expect(locateAgentFile("scout", undefined, directories)).toEqual({
			path: join(project, ".pi", "agents", "scout.md"),
			location: "project",
		});
	});

	it("falls back when the recorded path has since been deleted", () => {
		write(join(project, ".pi", "agents"), "scout");
		expect(locateAgentFile("scout", join(project, ".pi", "agents", "gone.md"), directories)).toEqual({
			path: join(project, ".pi", "agents", "scout.md"),
			location: "project",
		});
	});

	it("finds nothing when neither the source path nor the probe resolves", () => {
		expect(locateAgentFile("nope", join(project, ".pi", "agents", "gone.md"), directories)).toBeUndefined();
	});
});

describe("serializeAgentDefinition", () => {
	/** A definition's fields as the parser reads them back, the source aside. */
	function roundTrip(definition: AgentDefinition) {
		const parsed = parseAgentFile(serializeAgentDefinition(definition), {
			kind: "global",
			sourcePath: `/agents/${definition.name}.md`,
		});
		expect(parsed.unknownKeys).toEqual([]);
		expect(parsed.invalidValues).toEqual([]);
		const { source: _parsedSource, ...fields } = parsed.definition ?? ({} as AgentDefinition);
		const { source: _source, ...expected } = definition;
		return { fields, expected };
	}

	it("ejects every default agent into a file that parses back to the same definition", () => {
		for (const definition of DEFAULT_AGENTS) {
			const { fields, expected } = roundTrip(definition);
			expect(fields, definition.name).toEqual({ ...expected, systemPrompt: expected.systemPrompt.trim() });
		}
	});

	it("round-trips a definition that sets every frontmatter key", () => {
		const everything: AgentDefinition = {
			name: "everything",
			displayName: "Every Key",
			color: "#12ab34",
			description: "Sets: every key # all of them",
			tools: ["read", "ext:tokensave/tokensave_search"],
			disallowedTools: ["bash"],
			extensions: ["tokensave"],
			excludeExtensions: ["other"],
			skills: ["simplify"],
			model: "anthropic/claude-haiku-4-5:high",
			thinking: "high",
			maxTurns: 12,
			persistSession: true,
			outputTranscript: false,
			sessionDir: "/tmp/sessions",
			allowedSubagents: ["Explore"],
			systemPrompt: "Line 1.\n\nLine 2.",
			promptMode: "append",
			inheritContext: true,
			runInBackground: false,
			isolated: true,
			memory: "project",
			isolation: "worktree",
			enabled: false,
			hidden: false,
			source: { kind: "global", sourcePath: "/agents/everything.md" },
		};
		const { fields, expected } = roundTrip(everything);
		expect(fields).toEqual(expected);
		const none = roundTrip({ ...everything, tools: [], extensions: false, skills: false, allowedSubagents: "all" });
		expect(none.fields).toEqual(none.expected);
	});
});

describe("buildNewAgentFile", () => {
	const base = { tools: "read, grep", systemPrompt: "Do the thing.", description: "Scout" };
	const parse = (content: string) => parseFrontmatter<Record<string, unknown>>(content).frontmatter;

	it("round-trips an ordinary description", () => {
		expect(parse(buildNewAgentFile(base)).description).toBe("Scout");
	});

	it("survives a description containing a colon", () => {
		const content = buildNewAgentFile({ ...base, description: "Scout: find things" });
		expect(parseAgentFile(content, SOURCE).definition?.description).toBe("Scout: find things");
	});

	it("keeps a description containing a # instead of truncating it", () => {
		expect(parse(buildNewAgentFile({ ...base, description: "audit #security" })).description).toBe("audit #security");
	});

	it("leaves a `provider/model:thinking` suffix intact", () => {
		expect(parse(buildNewAgentFile({ ...base, model: "anthropic/claude-sonnet-4-6:high" })).model).toBe(
			"anthropic/claude-sonnet-4-6:high",
		);
	});

	it("survives a custom model containing a colon-space or a #", () => {
		for (const model of ["anthropic/foo: bar", "anthropic/x #c"]) {
			expect(parseAgentFile(buildNewAgentFile({ ...base, model }), SOURCE).definition?.model, model).toBe(model);
		}
	});

	it("emits the fields the wizard collects, and omits the ones left on inherit", () => {
		expect(parse(buildNewAgentFile({ ...base, model: "anthropic/x", thinking: "high" }))).toEqual({
			description: "Scout",
			tools: "read, grep",
			model: "anthropic/x",
			thinking: "high",
			prompt_mode: "replace",
		});
		expect(parse(buildNewAgentFile(base))).toEqual({
			description: "Scout",
			tools: "read, grep",
			prompt_mode: "replace",
		});
	});

	it("keeps the system prompt as the body", () => {
		const content = buildNewAgentFile({ ...base, systemPrompt: "Line 1.\n\nLine 2." });
		expect(parseAgentFile(content, SOURCE).definition?.systemPrompt).toBe("Line 1.\n\nLine 2.");
	});
});
