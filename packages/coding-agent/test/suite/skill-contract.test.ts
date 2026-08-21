import { execSync } from "node:child_process";
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import * as mockedFs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../../src/core/extensions/loader.ts";
import { parseDeclaredArgumentNames, substituteSkillArguments } from "../../src/core/skills/arguments.ts";
import { normalizeSkillInput } from "../../src/core/skills/frontmatter.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { buildSystemPrompt } from "../../src/core/system-prompt.ts";
import {
	canonicalSkillSetJson,
	createEventBus,
	DefaultResourceLoader,
	type EventBus,
	type ExtensionAPI,
	extractSkillListingBlock,
	formatSkillsForPrompt,
	getSkillSetController,
	type LoadedSkill,
	loadSkills,
	loadSkillsFromDir,
	type ResourceLoader,
	type RpcReply,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	SKILL_LISTING_VERSION,
	SKILLS_CHANGED_CHANNEL,
	SKILLS_QUERY_CHANNEL,
	type SkillInput,
	type SkillSetSnapshot,
	skillsQueryReplyChannel,
} from "../../src/index.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { buildRpcSlashCommands } from "../../src/modes/rpc/rpc-mode.ts";
import { createTestExtensionsResult } from "../utilities.ts";
import { createHarness, getMessageText } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof nodeFs;
	return {
		...actual,
		readdirSync: vi.fn(actual.readdirSync),
		readFileSync: vi.fn(actual.readFileSync),
		statSync: vi.fn(actual.statSync),
	};
});

const readdirSyncSpy = vi.mocked(mockedFs.readdirSync);
const readFileSyncSpy = vi.mocked(mockedFs.readFileSync);
const statSyncSpy = vi.mocked(mockedFs.statSync);

let tempDir: string;

function writeSkill(directory: string, frontmatter: string, body = "Skill body"): string {
	nodeFs.mkdirSync(directory, { recursive: true });
	const filePath = join(directory, "SKILL.md");
	nodeFs.writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}`);
	return filePath;
}

function createSkillInput(overrides: Partial<SkillInput> = {}): SkillInput {
	const filePath = overrides.filePath ?? "/tmp/test-skill/SKILL.md";
	return {
		name: "test-skill",
		description: "Test description",
		filePath,
		baseDir: overrides.baseDir ?? "/tmp/test-skill",
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
		disableModelInvocation: false,
		...overrides,
	};
}

function clearFilesystemSpies(): void {
	readdirSyncSpy.mockClear();
	readFileSyncSpy.mockClear();
	statSyncSpy.mockClear();
}

beforeEach(() => {
	tempDir = nodeFs.mkdtempSync(join(tmpdir(), "pi-skill-contract-"));
	clearFilesystemSpies();
});

afterEach(() => {
	nodeFs.rmSync(tempDir, { recursive: true, force: true });
});

describe("frontmatter contract", () => {
	it.each([
		["true", true],
		["false", false],
		["yes", true],
		["no", false],
		["on", true],
		["off", false],
		["1", true],
		["0", false],
		['"TrUe"', true],
		['"YeS"', true],
		['"OFF"', false],
	])("normalizes known boolean scalar %s", (rawValue, expected) => {
		const skillDir = join(tempDir, `boolean-${rawValue.replaceAll(/[^A-Za-z0-9]/g, "-")}`);
		writeSkill(
			skillDir,
			`name: boolean-skill\ndescription: Boolean skill\ndisable-model-invocation: ${rawValue}\nuser-invocable: ${rawValue}\nbackground: ${rawValue}\nunrelated: NO`,
		);

		const result = loadSkillsFromDir({ dir: skillDir, source: "test" });
		expect(result.skills).toHaveLength(1);
		const skill = result.skills[0];
		expect(skill.disableModelInvocation).toBe(expected);
		expect(skill.userInvocable).toBe(expected);
		expect(skill.frontmatter["disable-model-invocation"]).toBe(expected);
		expect(skill.frontmatter["user-invocable"]).toBe(expected);
		expect(skill.frontmatter.background).toBe(expected);
		expect(skill.frontmatter.unrelated).toBe("NO");
		expect(result.diagnostics).toEqual([]);
	});

	it("preserves invalid known booleans and applies documented defaults", () => {
		const skillDir = join(tempDir, "invalid-booleans");
		writeSkill(
			skillDir,
			"name: invalid-booleans\ndescription: Invalid booleans\ndisable-model-invocation: maybe\nuser-invocable: perhaps\nbackground: later",
		);

		const result = loadSkillsFromDir({ dir: skillDir, source: "test" });
		const skill = result.skills[0];
		expect(skill.disableModelInvocation).toBe(false);
		expect(skill.userInvocable).toBe(true);
		expect(skill.frontmatter["disable-model-invocation"]).toBe("maybe");
		expect(skill.frontmatter["user-invocable"]).toBe("perhaps");
		expect(skill.frontmatter.background).toBe("later");
		expect(result.diagnostics.filter((item) => item.message.includes("using default"))).toHaveLength(3);
	});

	it("rejects missing descriptions and falls back to the parent directory for empty names", () => {
		const missingDir = join(tempDir, "missing-description");
		writeSkill(missingDir, "name: missing-description");
		const missing = loadSkillsFromDir({ dir: missingDir, source: "test" });
		expect(missing.skills).toEqual([]);
		expect(missing.diagnostics.map((item) => item.message)).toContain("description is required");

		const fallbackDir = join(tempDir, "Upper.Name");
		writeSkill(fallbackDir, 'name: ""\ndescription: Uses directory name');
		const fallback = loadSkillsFromDir({ dir: fallbackDir, source: "test" });
		expect(fallback.skills[0].name).toBe("Upper.Name");
		expect(fallback.skills[0].frontmatter.name).toBe("Upper.Name");
		expect(fallback.skills[0].commandNameValid).toBe(true);
		expect(fallback.diagnostics.some((item) => item.message.includes("invalid characters"))).toBe(true);
	});

	it("warns once when a declared argument name is digit-like; rendering still matches CC", () => {
		const skillDir = join(tempDir, "digit-args");
		writeSkill(skillDir, 'name: digit-args\ndescription: Digit args\narguments: [one, "2", three]');

		const result = loadSkillsFromDir({ dir: skillDir, source: "test" });
		expect(result.skills).toHaveLength(1);
		const warnings = result.diagnostics.filter((item) => item.message.includes('"2"'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0].type).toBe("warning");
		expect(warnings[0].path).toBe(join(skillDir, "SKILL.md"));
		expect(warnings[0].message).toContain("shifting later declared names down one slot");

		// Rendering matches CC (A.3.2 rule 6): "2" is dropped from the mapping,
		// so $one reads slot 0 and $three reads slot 1.
		const declaredNames = parseDeclaredArgumentNames(result.skills[0].frontmatter.arguments);
		expect(declaredNames).toEqual(["one", "three"]);
		expect(substituteSkillArguments("one=[$one] three=[$three]", "x y z", declaredNames)).toBe("one=[x] three=[y]");
	});

	it("reports no digit-name warning for ordinary declared names", () => {
		const skillDir = join(tempDir, "plain-args");
		writeSkill(skillDir, "name: plain-args\ndescription: Plain args\narguments: [one, two]");
		const result = loadSkillsFromDir({ dir: skillDir, source: "test" });
		expect(result.diagnostics).toEqual([]);
	});
	it("preserves all known and unknown metadata through DefaultResourceLoader.getSkills", async () => {
		const skillDir = join(tempDir, "full-contract");
		writeSkill(
			skillDir,
			`name: full-contract
	description: Full contract
	license: MIT
	compatibility: Pi
	metadata:
	  owner: core
	when_to_use: Use for contract tests
	argument-hint: "[path]"
	arguments: [path]
	allowed-tools: [read]
	disallowed-tools: bash
	disallowedTools: [write]
	model: inherit
	effort: high
	context: inline
	agent: general-purpose
	background: false
	paths: ["src/**"]
	shell: bash
	hooks:
	  PreToolUse: echo ignored
	unknown-scalar: value
	unknown-list: [one, two]
	unknown-map:
	  nested: true`.replaceAll("\n\t", "\n"),
		);
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			noSkills: true,
			additionalSkillPaths: [skillDir],
		});
		await loader.reload();

		const skill = loader.getSkills().skills[0];
		expect(skill.argumentHint).toBe("[path]");
		expect(skill.userInvocable).toBe(true);
		expect(skill.frontmatter).toMatchObject({
			license: "MIT",
			compatibility: "Pi",
			metadata: { owner: "core" },
			when_to_use: "Use for contract tests",
			arguments: ["path"],
			"allowed-tools": ["read"],
			"disallowed-tools": "bash",
			disallowedTools: ["write"],
			model: "inherit",
			effort: "high",
			context: "inline",
			agent: "general-purpose",
			background: false,
			paths: ["src/**"],
			shell: "bash",
			hooks: { PreToolUse: "echo ignored" },
			"unknown-scalar": "value",
			"unknown-list": ["one", "two"],
			"unknown-map": { nested: true },
		});
	});

	it.each([
		["valid-name", true, false],
		["Upper.Name", true, true],
		["trailing.", false, true],
		["skill:reserved", false, true],
	])("computes command eligibility for %s", (name, commandNameValid, hasAgentWarning) => {
		const skillDir = join(tempDir, name.replaceAll(/[.:]/g, "-"));
		writeSkill(skillDir, `name: ${name}\ndescription: Name validation`);
		const result = loadSkillsFromDir({ dir: skillDir, source: "test" });
		expect(result.skills[0].commandNameValid).toBe(commandNameValid);
		expect(result.diagnostics.some((item) => item.message.includes("invalid characters"))).toBe(hasAgentWarning);
		expect(result.diagnostics.filter((item) => item.message.includes("bare skill command namespace"))).toHaveLength(
			commandNameValid ? 0 : 1,
		);
	});

	it("deduplicates symlink aliases by canonical ID", () => {
		const realDir = join(tempDir, "real-skill");
		const aliasDir = join(tempDir, "alias-skill");
		const filePath = writeSkill(realDir, "name: canonical-skill\ndescription: Canonical skill");
		nodeFs.symlinkSync(realDir, aliasDir, "dir");

		const result = loadSkills({
			cwd: tempDir,
			agentDir: tempDir,
			skillPaths: [realDir, aliasDir],
			includeDefaults: false,
		});
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0].id).toBe(nodeFs.realpathSync(filePath));
	});

	it("normalizes SkillInput overrides and custom ResourceLoader values", async () => {
		const input = createSkillInput({
			name: "injected-skill",
			frontmatter: { "user-invocable": "NO", when_to_use: "When injected" },
		});
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			skillsOverride: () => ({ skills: [input], diagnostics: [] }),
		});
		await loader.reload();
		const loaded: LoadedSkill = loader.getSkills().skills[0];
		expect(loaded).toMatchObject({
			name: "injected-skill",
			listingName: "injected-skill",
			commandNameValid: true,
			userInvocable: false,
		});
		expect(loaded.id).toBe(input.filePath);
		expect(Object.hasOwn(loaded, "argumentHint")).toBe(true);

		const customLoader: ResourceLoader = {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills: [input], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [],
			getAppendSystemPromptSources: () => [],
			extendResources: () => {},
			reload: async () => {},
		};
		const customLoaded = normalizeSkillInput(customLoader.getSkills().skills[0]).skill;
		expect(customLoaded.listingName).toBe("injected-skill");
		expect(customLoaded.frontmatter.when_to_use).toBe("When injected");
		expect(normalizeSkillInput(customLoaded)).toEqual({ skill: customLoaded, diagnostics: [] });
	});

	it("uses top-level visibility and hint fields when frontmatter omits them", () => {
		const fallback = normalizeSkillInput(
			createSkillInput({ frontmatter: {}, argumentHint: "[path]", userInvocable: false }),
		).skill;
		expect(fallback).toMatchObject({ argumentHint: "[path]", userInvocable: false });
		expect(fallback.frontmatter).toMatchObject({ "argument-hint": "[path]", "user-invocable": false });

		const explicitFrontmatter = normalizeSkillInput(
			createSkillInput({
				argumentHint: "[top-level]",
				userInvocable: true,
				frontmatter: { "argument-hint": "[frontmatter]", "user-invocable": false },
			}),
		).skill;
		expect(explicitFrontmatter).toMatchObject({ argumentHint: "[frontmatter]", userInvocable: false });
	});
});

describe("serialization safety", () => {
	it("drops non-JSON YAML values and keeps the stored frontmatter serializable", () => {
		const skillDir = join(tempDir, "unsafe-yaml");
		writeSkill(
			skillDir,
			`name: unsafe-yaml
	description: Unsafe YAML
	cycle: &loop
	  self: *loop
	nan: .nan
	positive: .inf
	negative: -.inf
	set: !!set
	  one:
	  two:
	binary: !!binary SGVsbG8=`.replaceAll("\n\t", "\n"),
		);

		const result = loadSkillsFromDir({ dir: skillDir, source: "test" });
		const frontmatter = result.skills[0].frontmatter;
		expect(frontmatter.cycle).toEqual({});
		expect(frontmatter).not.toHaveProperty("nan");
		expect(frontmatter).not.toHaveProperty("positive");
		expect(frontmatter).not.toHaveProperty("negative");
		expect(frontmatter).not.toHaveProperty("set");
		expect(frontmatter).not.toHaveProperty("binary");
		expect(() => JSON.stringify(frontmatter)).not.toThrow();
		const serialized = JSON.stringify(frontmatter);
		expect(serialized).not.toContain(":null");
		expect(result.diagnostics.filter((item) => item.message.includes("frontmatter value at"))).toHaveLength(6);
	});
});

describe("listing v2", () => {
	it("emits exact escaped output with folded when_to_use and an always-present location", () => {
		const input = createSkillInput({
			name: "source-name",
			listingName: "list<&\"'name",
			description: "Use <this>",
			filePath: "/tmp/a&b/SKILL.md",
			frontmatter: { when_to_use: 'when "needed"' },
		});
		const listing = formatSkillsForPrompt([input]);
		expect(SKILL_LISTING_VERSION).toBe("2");
		expect(listing).toBe(
			`\n\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n${SKILL_LISTING_START_DELIMITER}\n  <skill>\n    <name>list&lt;&amp;&quot;&apos;name</name>\n    <description>Use &lt;this&gt; when &quot;needed&quot;</description>\n    <location>/tmp/a&amp;b/SKILL.md</location>\n  </skill>\n${SKILL_LISTING_END_DELIMITER}`,
		);
		expect(extractSkillListingBlock(listing)).toBe(listing.slice(listing.indexOf(SKILL_LISTING_START_DELIMITER)));
	});

	it("caps the combined unescaped description at 1,536 UTF-16 code units before escaping", () => {
		const description = "a".repeat(1534);
		const listing = formatSkillsForPrompt([createSkillInput({ description, frontmatter: { when_to_use: "&Z" } })]);
		expect(listing).toContain(`<description>${description} &amp;</description>`);
		expect(listing).not.toContain("Z</description>");
	});

	it("excludes disableModelInvocation skills", () => {
		const visible = createSkillInput({ name: "visible" });
		const hidden = createSkillInput({ name: "hidden", disableModelInvocation: true });
		const listing = formatSkillsForPrompt([visible, hidden]);
		expect(listing).toContain("<name>visible</name>");
		expect(listing).not.toContain("<name>hidden</name>");
	});

	it("extracts the last complete v2 block and rejects incomplete or unsupported blocks", () => {
		const first = `${SKILL_LISTING_START_DELIMITER}\nfirst\n${SKILL_LISTING_END_DELIMITER}`;
		const second = `${SKILL_LISTING_START_DELIMITER}\nsecond\n${SKILL_LISTING_END_DELIMITER}`;
		expect(extractSkillListingBlock(`prefix${first}middle${second}suffix`)).toBe(second);
		// A trailing unterminated opener is not a block; the walk falls back to the
		// last one that is, rather than giving up at the final delimiter.
		expect(extractSkillListingBlock(`${first}tail${SKILL_LISTING_START_DELIMITER}`)).toBe(first);
		expect(extractSkillListingBlock("no listing")).toBeUndefined();
		expect(extractSkillListingBlock(SKILL_LISTING_START_DELIMITER)).toBeUndefined();
		expect(extractSkillListingBlock(SKILL_LISTING_END_DELIMITER)).toBeUndefined();
		expect(
			extractSkillListingBlock(`${SKILL_LISTING_START_DELIMITER}${SKILL_LISTING_START_DELIMITER}`),
		).toBeUndefined();
		expect(extractSkillListingBlock('<available_skills version="3">\nwrong\n</available_skills>')).toBeUndefined();
	});

	it("returns the real listing when a context file plants a delimiter ahead of it", () => {
		const skills = [createSkillInput({ name: "probe", description: "A probe skill." })];
		const real = extractSkillListingBlock(formatSkillsForPrompt(skills, "read"))!;
		const build = (context: string) =>
			buildSystemPrompt({
				cwd: "/repo",
				selectedTools: ["read"],
				skills,
				contextFiles: [{ path: "/repo/AGENTS.md", content: context }],
			});

		// An unterminated opener in prose: the front-scanning version returned a
		// span from this opener through the real listing's terminator, swallowing
		// the intervening project context and the skills preamble.
		const prose = build(`Docs: a listing opens with ${SKILL_LISTING_START_DELIMITER} and closes later.`);
		expect(extractSkillListingBlock(prose)).toBe(real);

		// A byte-faithful copy of the emitted format, as `docs/skills.md` carries:
		// structurally valid, so only its position distinguishes it from the real one.
		const copied = build(
			`How pi lists skills:\n\n${SKILL_LISTING_START_DELIMITER}\n  <skill>\n    <name>pdf-tools</name>\n    <description>Extracts text from PDF files.</description>\n    <location>/home/user/.pi/agent/skills/pdf-tools/SKILL.md</location>\n  </skill>\n${SKILL_LISTING_END_DELIMITER}\n`,
		);
		expect(extractSkillListingBlock(copied)).toBe(real);
		expect(extractSkillListingBlock(copied)).not.toContain("pdf-tools");
	});
});

describe("isolation boundary", () => {
	it("intercepts allowed traversal and content reads as a positive mock control", () => {
		const allowedDir = join(tempDir, "allowed");
		const skillPath = writeSkill(allowedDir, "name: allowed\ndescription: Allowed skill");
		clearFilesystemSpies();

		const result = loadSkillsFromDir({ dir: allowedDir, source: "test" });
		expect(result.skills).toHaveLength(1);
		expect(readdirSyncSpy).toHaveBeenCalledWith(allowedDir, { withFileTypes: true });
		expect(readFileSyncSpy).toHaveBeenCalledWith(skillPath, "utf-8");

		const targetDir = join(tempDir, "allowed-target");
		const targetSkillPath = writeSkill(targetDir, "name: allowed-link\ndescription: Allowed link");
		const linkedDir = join(tempDir, "allowed-link");
		nodeFs.symlinkSync(targetDir, linkedDir, "dir");
		clearFilesystemSpies();

		const linkedResult = loadSkillsFromDir({ dir: tempDir, source: "test" });
		expect(linkedResult.skills.some((skill) => skill.name === "allowed-link")).toBe(true);
		expect(statSyncSpy).toHaveBeenCalledWith(linkedDir);
		expect(readFileSyncSpy).toHaveBeenCalledWith(targetSkillPath, "utf-8");
	});

	it("does not traverse or read direct .claude roots", () => {
		const forbiddenDir = join(tempDir, ".claude", "skills", "forbidden");
		writeSkill(forbiddenDir, "name: forbidden\ndescription: Forbidden skill");
		clearFilesystemSpies();

		const result = loadSkillsFromDir({ dir: forbiddenDir, source: "test" });
		expect(result.skills).toEqual([]);
		expect(result.diagnostics).toHaveLength(1);
		expect(readdirSyncSpy).not.toHaveBeenCalled();
		expect(readFileSyncSpy).not.toHaveBeenCalled();
		expect(statSyncSpy).not.toHaveBeenCalled();
	});

	it("prunes directory symlinks into .claude before followed traversal", () => {
		const allowedRoot = join(tempDir, "allowed-root");
		const forbiddenTarget = join(tempDir, ".claude", "skills", "target");
		const linkPath = join(allowedRoot, "linked-skill");
		nodeFs.mkdirSync(allowedRoot, { recursive: true });
		writeSkill(forbiddenTarget, "name: forbidden-link\ndescription: Forbidden link");
		nodeFs.symlinkSync(forbiddenTarget, linkPath, "dir");
		clearFilesystemSpies();

		const result = loadSkillsFromDir({ dir: allowedRoot, source: "test" });
		expect(result.skills).toEqual([]);
		expect(result.diagnostics).toHaveLength(1);
		expect(statSyncSpy).not.toHaveBeenCalledWith(linkPath);
		expect(readdirSyncSpy).not.toHaveBeenCalledWith(linkPath, expect.anything());
		expect(readFileSyncSpy).not.toHaveBeenCalled();
	});

	it("prunes SKILL.md symlinks into .claude before stat or content reads", () => {
		const allowedSkillDir = join(tempDir, "allowed-root", "safe-name");
		const forbiddenTarget = writeSkill(
			join(tempDir, ".claude", "skills", "target"),
			"name: forbidden-file\ndescription: Forbidden file",
		);
		nodeFs.mkdirSync(allowedSkillDir, { recursive: true });
		const linkPath = join(allowedSkillDir, "SKILL.md");
		nodeFs.symlinkSync(forbiddenTarget, linkPath, "file");
		clearFilesystemSpies();

		const result = loadSkillsFromDir({ dir: join(tempDir, "allowed-root"), source: "test" });
		expect(result.skills).toEqual([]);
		expect(result.diagnostics).toHaveLength(1);
		expect(statSyncSpy).not.toHaveBeenCalledWith(linkPath);
		expect(readFileSyncSpy).not.toHaveBeenCalledWith(linkPath, "utf-8");
	});
});

describe("skill-set events", () => {
	const FIXTURE_ROOT_PLACEHOLDER = "__SKILL_SET_FIXTURE_ROOT__";
	const FIXTURE_PATH = join(
		dirname(fileURLToPath(import.meta.url)),
		"fixtures",
		"skills-contract",
		"skill-set-snapshot.json",
	);

	/**
	 * Documented temp-root substitution for the canonical fixture: canonical skill IDs are
	 * realpath-resolved while source paths are not, so the realpath form must be replaced
	 * before the raw temp path (on macOS the raw form is a substring of the realpath form).
	 */
	function substituteFixtureRoot(serialized: string, tempRoot: string): string {
		return serialized
			.split(nodeFs.realpathSync(tempRoot))
			.join(FIXTURE_ROOT_PLACEHOLDER)
			.split(tempRoot)
			.join(FIXTURE_ROOT_PLACEHOLDER);
	}

	function writeFullContractSkill(directory: string): void {
		writeSkill(
			directory,
			`name: full-contract
description: Full contract
license: MIT
compatibility: Pi
metadata:
  owner: core
when_to_use: Use for contract tests
argument-hint: "[path]"
arguments: [path]
allowed-tools: [read]
disallowed-tools: bash
disallowedTools: [write]
model: inherit
effort: high
context: inline
agent: general-purpose
background: false
paths: ["src/**"]
shell: bash
hooks:
  PreToolUse: echo ignored
unknown-scalar: value
unknown-list: [one, two]
unknown-map:
  nested: true`,
		);
	}

	/** Mirrors the fixture-generation flow: the override pins the baseDir-omission rule. */
	function createFixtureLoader(eventBus: EventBus): DefaultResourceLoader {
		return new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: ["full-contract", "minimal-skill", "removed-skill"],
			skillsOverride: (base) => ({
				skills: base.skills.map((skill) =>
					skill.name === "minimal-skill"
						? {
								...skill,
								sourceInfo: {
									path: skill.filePath,
									source: "fixture-package",
									scope: "user" as const,
									origin: "package" as const,
								},
							}
						: skill,
				),
				diagnostics: base.diagnostics,
			}),
		});
	}

	function querySkillSet(eventBus: EventBus, requestId: string): Array<RpcReply<SkillSetSnapshot>> {
		const replies: Array<RpcReply<SkillSetSnapshot>> = [];
		eventBus.on(skillsQueryReplyChannel(requestId), (data) => replies.push(data as RpcReply<SkillSetSnapshot>));
		eventBus.emit(SKILLS_QUERY_CHANNEL, { requestId });
		return replies;
	}

	it("answers pre-publication queries with the defined initial snapshot", () => {
		const eventBus = createEventBus();
		getSkillSetController(eventBus);

		const replies = querySkillSet(eventBus, "early-query");
		expect(replies).toEqual([{ success: true, data: { revision: 0, skills: [], removed: [] } }]);
	});

	it("publishes the A.9 lifecycle and matches the canonical wire fixture deep- and byte-exactly", async () => {
		writeFullContractSkill(join(tempDir, "full-contract"));
		writeSkill(join(tempDir, "minimal-skill"), "name: minimal-skill\ndescription: Minimal skill");
		writeSkill(join(tempDir, "removed-skill"), "name: removed-skill\ndescription: Removed skill");

		const eventBus = createEventBus();
		const changedEvents: SkillSetSnapshot[] = [];
		eventBus.on(SKILLS_CHANGED_CHANNEL, (data) => changedEvents.push(data as SkillSetSnapshot));
		const loader = createFixtureLoader(eventBus);

		await loader.reload();
		expect(changedEvents).toHaveLength(1);
		expect(changedEvents[0].revision).toBe(1);
		expect(changedEvents[0].skills.map((entry) => entry.name)).toEqual([
			"full-contract",
			"minimal-skill",
			"removed-skill",
		]);

		const removedId = nodeFs.realpathSync(join(tempDir, "removed-skill", "SKILL.md"));
		nodeFs.rmSync(join(tempDir, "removed-skill"), { recursive: true, force: true });
		await loader.reload();
		expect(changedEvents).toHaveLength(2);

		const snapshot = changedEvents[1];
		expect(snapshot.revision).toBe(2);
		expect(snapshot.removed).toEqual([removedId]);

		// The query round-trip produces exactly one reply carrying the same authoritative snapshot.
		const replies = querySkillSet(eventBus, "fixture-query");
		expect(replies).toHaveLength(1);
		expect(replies[0]).toEqual({ success: true, data: snapshot });

		// Every entry deep-matches the normalized getSkills() output, including the full source object.
		const loaded = loader.getSkills().skills;
		expect(snapshot.skills.map((entry) => entry.id)).toEqual(loaded.map((skill) => skill.id));
		for (const entry of snapshot.skills) {
			const skill = loaded.find((candidate) => candidate.id === entry.id);
			expect(skill).toBeDefined();
			expect(entry.name).toBe(skill?.name);
			expect(entry.listingName).toBe(skill?.listingName);
			expect(entry.baseDir).toBe(skill?.baseDir);
			expect(entry.frontmatter).toEqual(skill?.frontmatter);
			expect(entry.source).toEqual({ ...skill?.sourceInfo });
		}

		// Deep- and byte-compare against the canonical fixture after the documented substitution.
		const fixtureBytes = nodeFs.readFileSync(FIXTURE_PATH, "utf8");
		const fixture = JSON.parse(fixtureBytes) as SkillSetSnapshot;
		const substituted = substituteFixtureRoot(canonicalSkillSetJson(snapshot), tempDir);
		expect(JSON.parse(substituted)).toEqual(fixture);
		expect(substituted).toBe(fixtureBytes);
		const querySubstituted = substituteFixtureRoot(
			canonicalSkillSetJson((replies[0] as { success: true; data: SkillSetSnapshot }).data),
			tempDir,
		);
		expect(querySubstituted).toBe(fixtureBytes);
	});

	it("increments bus-scoped revisions across empty load, unchanged reload, deletion, and extension resources", async () => {
		const emptyBus = createEventBus();
		const emptyEvents: SkillSetSnapshot[] = [];
		emptyBus.on(SKILLS_CHANGED_CHANNEL, (data) => emptyEvents.push(data as SkillSetSnapshot));
		const emptyLoader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus: emptyBus,
			noSkills: true,
		});
		await emptyLoader.reload();
		expect(emptyEvents).toHaveLength(1);
		expect(emptyEvents[0]).toMatchObject({ revision: 1, skills: [], removed: [] });

		writeSkill(join(tempDir, "skill-a"), "name: skill-a\ndescription: Skill A");
		writeSkill(join(tempDir, "skill-b"), "name: skill-b\ndescription: Skill B");
		const eventBus = createEventBus();
		const changedEvents: SkillSetSnapshot[] = [];
		eventBus.on(SKILLS_CHANGED_CHANNEL, (data) => changedEvents.push(data as SkillSetSnapshot));
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: ["skill-a"],
		});

		await loader.reload();
		expect(changedEvents[0]).toMatchObject({ revision: 1, removed: [] });
		expect(changedEvents[0].skills.map((entry) => entry.name)).toEqual(["skill-a"]);

		await loader.reload();
		expect(changedEvents[1]).toMatchObject({ revision: 2, removed: [] });
		expect(changedEvents[1].skills.map((entry) => entry.name)).toEqual(["skill-a"]);

		loader.extendResources({
			skillPaths: [
				{
					path: join(tempDir, "skill-b"),
					metadata: { source: "test-extension", scope: "temporary", origin: "top-level" },
				},
			],
		});
		expect(changedEvents[2]).toMatchObject({ revision: 3, removed: [] });
		expect(changedEvents[2].skills.map((entry) => entry.name)).toEqual(["skill-a", "skill-b"]);

		const removedId = nodeFs.realpathSync(join(tempDir, "skill-a", "SKILL.md"));
		nodeFs.rmSync(join(tempDir, "skill-a"), { recursive: true, force: true });
		await loader.reload();
		expect(changedEvents[3].revision).toBe(4);
		expect(changedEvents[3].removed).toContain(removedId);
	});

	it("shares one controller and query listener across loaders on the same bus", async () => {
		writeSkill(join(tempDir, "first-skill"), "name: first-skill\ndescription: First skill");
		writeSkill(join(tempDir, "second-skill"), "name: second-skill\ndescription: Second skill");
		const eventBus = createEventBus();
		const createLoader = (skillPath: string) =>
			new DefaultResourceLoader({
				cwd: tempDir,
				agentDir: tempDir,
				eventBus,
				noSkills: true,
				additionalSkillPaths: [skillPath],
			});

		// Two concurrently alive loaders: the latest publication is authoritative.
		const first = createLoader("first-skill");
		const second = createLoader("second-skill");
		await first.reload();
		await second.reload();
		let replies = querySkillSet(eventBus, "multi-1");
		expect(replies).toHaveLength(1);
		expect(replies[0]).toMatchObject({ success: true, data: { revision: 2 } });
		expect((replies[0] as { success: true; data: SkillSetSnapshot }).data.skills.map((entry) => entry.name)).toEqual([
			"second-skill",
		]);

		// A sequential third loader keeps the bus-scoped monotonic revision going.
		const third = createLoader("first-skill");
		await third.reload();
		replies = querySkillSet(eventBus, "multi-2");
		expect(replies).toHaveLength(1);
		expect(replies[0]).toMatchObject({ success: true, data: { revision: 3 } });
		expect((replies[0] as { success: true; data: SkillSetSnapshot }).data.skills.map((entry) => entry.name)).toEqual([
			"first-skill",
		]);
	});

	it("keeps the previous authoritative snapshot when publication construction fails", async () => {
		writeSkill(join(tempDir, "stable-skill"), "name: stable-skill\ndescription: Stable skill");
		const eventBus = createEventBus();
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: ["stable-skill"],
		});
		await loader.reload();
		const controller = getSkillSetController(eventBus);
		const before = controller.getSnapshot();
		expect(before.revision).toBe(1);

		const good = loader.getSkills().skills[0];
		const evil = { ...good };
		Object.defineProperty(evil, "frontmatter", {
			get(): never {
				throw new Error("clone boom");
			},
		});
		expect(() => controller.publish([evil])).toThrow("clone boom");

		const cyclicFrontmatter: Record<string, unknown> = {};
		cyclicFrontmatter.self = cyclicFrontmatter;
		for (const [frontmatter, message] of [
			[cyclicFrontmatter, /cyclic/],
			[{ nonFinite: Number.POSITIVE_INFINITY }, /finite numbers/],
			[{ container: new Map() }, /plain objects and arrays/],
		] satisfies Array<[Record<string, unknown>, RegExp]>) {
			expect(() => controller.publish([{ ...good, frontmatter }])).toThrow(message);
			expect(controller.getSnapshot()).toBe(before);
		}

		expect(controller.getSnapshot().revision).toBe(1);
		const replies = querySkillSet(eventBus, "atomicity-query");
		expect(replies).toEqual([{ success: true, data: before }]);
	});

	it("isolates snapshots from subscriber mutation of arrays, source, and nested frontmatter", async () => {
		writeSkill(
			join(tempDir, "frozen-skill"),
			"name: frozen-skill\ndescription: Frozen skill\nmetadata:\n  owner: core\nunknown-list: [one]",
		);
		const eventBus = createEventBus();
		const changedEvents: SkillSetSnapshot[] = [];
		eventBus.on(SKILLS_CHANGED_CHANNEL, (data) => changedEvents.push(data as SkillSetSnapshot));
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: ["frozen-skill"],
		});
		await loader.reload();
		const payload = changedEvents[0];

		expect(() => (payload.skills as unknown as unknown[]).push({})).toThrow(TypeError);
		expect(() => (payload.removed as unknown as string[]).push("x")).toThrow(TypeError);
		expect(() => {
			(payload.skills[0].source as { path: string }).path = "hacked";
		}).toThrow(TypeError);
		expect(() => {
			(payload.skills[0].frontmatter.metadata as Record<string, unknown>).owner = "hacked";
		}).toThrow(TypeError);

		const replies = querySkillSet(eventBus, "mutation-query");
		expect(replies).toEqual([{ success: true, data: payload }]);
		expect(replies[0]).toMatchObject({ success: true, data: { revision: 1 } });

		// Loader-owned skills are never frozen or mutated by publication.
		const skill = loader.getSkills().skills[0];
		expect(skill.frontmatter.metadata).toEqual({ owner: "core" });
		expect(Object.isFrozen(skill.frontmatter)).toBe(false);
	});

	it("ignores malformed query payloads without throwing or emitting replies", () => {
		const eventBus = createEventBus();
		getSkillSetController(eventBus);
		const emittedChannels: string[] = [];
		const originalEmit = eventBus.emit;
		eventBus.emit = (channel, data) => {
			emittedChannels.push(channel);
			originalEmit(channel, data);
		};

		for (const payload of [null, undefined, "skills:query", 42, {}, { requestId: "" }, { requestId: 42 }]) {
			eventBus.emit(SKILLS_QUERY_CHANNEL, payload);
		}
		expect(emittedChannels.filter((channel) => channel.startsWith("skills:query:reply"))).toEqual([]);

		const replies: RpcReply<SkillSetSnapshot>[] = [];
		const replyChannel = skillsQueryReplyChannel("positive-control");
		eventBus.on(replyChannel, (data) => replies.push(data as RpcReply<SkillSetSnapshot>));
		eventBus.emit(SKILLS_QUERY_CHANNEL, { requestId: "positive-control" });
		expect(replies).toHaveLength(1);
		expect(emittedChannels.filter((channel) => channel === replyChannel)).toHaveLength(1);
	});

	it("keeps snapshots byte-stable for frontmatter that went through serialization-safety substitution", async () => {
		writeSkill(
			join(tempDir, "unsafe-yaml"),
			`name: unsafe-yaml
description: Unsafe YAML
cycle: &loop
  self: *loop
nan: .nan
binary: !!binary SGVsbG8=`,
		);
		const eventBus = createEventBus();
		const changedEvents: SkillSetSnapshot[] = [];
		eventBus.on(SKILLS_CHANGED_CHANNEL, (data) => changedEvents.push(data as SkillSetSnapshot));
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: ["unsafe-yaml"],
		});
		await loader.reload();

		const snapshot = changedEvents[0];
		expect(snapshot.skills[0].frontmatter).not.toHaveProperty("nan");
		expect(snapshot.skills[0].frontmatter).not.toHaveProperty("binary");
		const firstSerialization = canonicalSkillSetJson(snapshot);
		expect(canonicalSkillSetJson(snapshot)).toBe(firstSerialization);
		const replies = querySkillSet(eventBus, "safety-query");
		expect(replies[0]).toEqual({ success: true, data: snapshot });
		expect(canonicalSkillSetJson((replies[0] as { success: true; data: SkillSetSnapshot }).data)).toBe(
			firstSerialization,
		);
	});

	it("drives the seam end to end through a harness inline extension using the public pi.events API", async () => {
		writeSkill(join(tempDir, "harness-skill"), "name: harness-skill\ndescription: Harness skill");
		const eventBus = createEventBus();
		const changedEvents: SkillSetSnapshot[] = [];
		const initReplies: Array<RpcReply<SkillSetSnapshot>> = [];
		let api: ExtensionAPI | undefined;
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: ["harness-skill"],
			extensionFactories: [
				(pi) => {
					api = pi;
					pi.events.on(SKILLS_CHANGED_CHANNEL, (data) => changedEvents.push(data as SkillSetSnapshot));
					pi.events.on(skillsQueryReplyChannel("factory-init"), (data) =>
						initReplies.push(data as RpcReply<SkillSetSnapshot>),
					);
					// A query issued during factory initialization gets the defined initial reply.
					pi.events.emit(SKILLS_QUERY_CHANNEL, { requestId: "factory-init" });
				},
			],
		});
		await loader.reload();
		const harness = await createHarness({ resourceLoader: loader });
		try {
			expect(initReplies).toEqual([{ success: true, data: { revision: 0, skills: [], removed: [] } }]);
			expect(changedEvents).toHaveLength(1);
			expect(changedEvents[0].skills.map((entry) => entry.name)).toEqual(["harness-skill"]);
			expect(changedEvents[0].skills[0].source).toMatchObject({
				path: join(tempDir, "harness-skill", "SKILL.md"),
				source: "local",
				scope: "temporary",
				origin: "top-level",
			});

			expect(api).toBeDefined();
			const replies: Array<RpcReply<SkillSetSnapshot>> = [];
			api?.events.on(skillsQueryReplyChannel("after-load"), (data) =>
				replies.push(data as RpcReply<SkillSetSnapshot>),
			);
			api?.events.emit(SKILLS_QUERY_CHANNEL, { requestId: "after-load" });
			expect(replies).toEqual([{ success: true, data: changedEvents[0] }]);
		} finally {
			harness.cleanup();
		}
	});

	it("pins the A.9 source shape, fixture path, and canonical-JSON rule in the frozen plan document", () => {
		const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
		const planText = nodeFs
			.readFileSync(join(repoRoot, "docs", "plans", "pi-skill-system-plan.md"), "utf8")
			.replace(/\s+/g, " ");
		expect(planText).toContain(
			'{path: string, source: string, scope: "user" | "project" | "temporary", origin: "package" | "top-level", baseDir?: string}',
		);
		expect(planText).toContain("packages/coding-agent/test/suite/fixtures/skills-contract/skill-set-snapshot.json");
		expect(planText).toContain("canonicalSkillSetJson");
		expect(planText).toContain("sorted lexicographically");
		expect(planText).toContain("2-space indentation");
		expect(planText).toContain("trailing LF");
	});
});

describe("command visibility", () => {
	function createVisibilitySkills(): SkillInput[] {
		// Distinct canonical IDs: c4c's registry consumes one shared visibility snapshot
		// keyed by skill ID, so fixtures must not share the default filePath.
		const named = (name: string, overrides: Partial<SkillInput> = {}) =>
			createSkillInput({
				name,
				filePath: `/tmp/visibility/${name}/SKILL.md`,
				baseDir: `/tmp/visibility/${name}`,
				...overrides,
			});
		return [
			named("valid-skill", { frontmatter: { "argument-hint": "[path]" } }),
			named("hidden-skill", { frontmatter: { "user-invocable": false } }),
			named("dmi-skill", { disableModelInvocation: true }),
			named("Upper.Name"),
			named("trailing."),
			named("skill:reserved"),
		];
	}

	function createVisibilityLoader(skills: SkillInput[]): ResourceLoader {
		return {
			getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
			getSkills: () => ({ skills, diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getThemes: () => ({ themes: [], diagnostics: [] }),
			getAgentsFiles: () => ({ agentsFiles: [] }),
			getSystemPrompt: () => undefined,
			getSystemPromptSource: () => undefined,
			getAppendSystemPrompt: () => [],
			getAppendSystemPromptSources: () => [],
			extendResources: () => {},
			reload: async () => {},
		};
	}

	// A.1 / ADR-0005: every surface — extension enumerator, RPC, and interactive autocomplete —
	// exposes uncontested skills under their bare winner name, not the `skill:` qualifier; the
	// interactive provider now projects the unified `session.getCommands()` listing directly.
	const VISIBLE_BARE_COMMANDS = ["valid-skill", "dmi-skill", "Upper.Name"];
	const GATED_BARE_COMMANDS = ["hidden-skill", "trailing.", "skill:reserved"];

	function expectBareVisibility(names: string[]): void {
		for (const visible of VISIBLE_BARE_COMMANDS) {
			expect(names).toContain(visible);
		}
		for (const gated of GATED_BARE_COMMANDS) {
			expect(names).not.toContain(gated);
		}
	}

	it("gates the extension getCommands enumerator", async () => {
		let api: ExtensionAPI | undefined;
		const extensionsResult = await createTestExtensionsResult(
			[
				(pi) => {
					api = pi;
				},
			],
			tempDir,
		);
		const base = createVisibilityLoader(createVisibilitySkills());
		const harness = await createHarness({
			resourceLoader: { ...base, getExtensions: () => extensionsResult },
		});
		try {
			expect(api).toBeDefined();
			const names = (api as ExtensionAPI).getCommands().map((command) => command.name);
			expectBareVisibility(names);
		} finally {
			harness.cleanup();
		}
	});

	it("gates RPC get_commands", async () => {
		const harness = await createHarness({ resourceLoader: createVisibilityLoader(createVisibilitySkills()) });
		try {
			const names = buildRpcSlashCommands(harness.session)
				.filter((command) => command.source === "skill")
				.map((command) => command.name);
			expectBareVisibility(names);
		} finally {
			harness.cleanup();
		}
	});

	it("gates interactive autocomplete and surfaces argument hints", async () => {
		const harness = await createHarness({ resourceLoader: createVisibilityLoader(createVisibilitySkills()) });
		try {
			// Drive the real InteractiveMode provider builder against a real session so it
			// projects the unified getCommands() listing (bare winners, gated skills dropped)
			// rather than a hand-built stub.
			type FakeInteractiveMode = {
				session: Awaited<ReturnType<typeof createHarness>>["session"];
				prefixAutocompleteDescription: (description: string | undefined) => string | undefined;
				sessionManager: { getCwd: () => string };
				fdPath: null;
				getLoginProviderOptions: () => [];
			};
			const createBaseAutocompleteProvider = (
				InteractiveMode as unknown as {
					prototype: { createBaseAutocompleteProvider(this: FakeInteractiveMode): AutocompleteProvider };
				}
			).prototype.createBaseAutocompleteProvider;
			const fakeThis: FakeInteractiveMode = {
				session: harness.session,
				prefixAutocompleteDescription: (description) => description,
				sessionManager: { getCwd: () => tempDir },
				fdPath: null,
				getLoginProviderOptions: () => [],
			};

			const provider = createBaseAutocompleteProvider.call(fakeThis);
			const suggestions = await provider.getSuggestions(["/"], 0, 1, {
				signal: new AbortController().signal,
			});
			const items = suggestions?.items ?? [];
			expectBareVisibility(items.map((item) => item.value));
			const visible = items.find((item) => item.value === "valid-skill");
			expect(visible?.description).toContain("[path]");
		} finally {
			harness.cleanup();
		}
	});

	it("keeps user-hidden skills model-listable and dmi skills command-visible only", () => {
		const listing = formatSkillsForPrompt(createVisibilitySkills());
		expect(listing).toContain("<name>hidden-skill</name>");
		expect(listing).toContain("<name>Upper.Name</name>");
		expect(listing).not.toContain("<name>dmi-skill</name>");
	});
});

describe("committed fixtures", () => {
	const FIELDS_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills-contract", "fields");
	const FIXTURE_DIR_NAMES = nodeFs.readdirSync(FIELDS_FIXTURES_DIR).sort();

	it("round-trips every per-field committed fixture through DefaultResourceLoader.getSkills()", async () => {
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			noSkills: true,
			additionalSkillPaths: [FIELDS_FIXTURES_DIR],
		});
		await loader.reload();
		const { skills, diagnostics } = loader.getSkills();
		expect(skills).toHaveLength(FIXTURE_DIR_NAMES.length);

		const byName = new Map(skills.map((skill) => [skill.name, skill]));

		expect(byName.get("boolean-true")).toMatchObject({
			disableModelInvocation: true,
			userInvocable: true,
			frontmatter: expect.objectContaining({ background: true }),
		});
		expect(byName.get("boolean-false")).toMatchObject({
			disableModelInvocation: false,
			userInvocable: false,
			frontmatter: expect.objectContaining({ background: false }),
		});
		expect(byName.get("boolean-yes")).toMatchObject({ disableModelInvocation: true, userInvocable: true });
		expect(byName.get("boolean-no")).toMatchObject({ disableModelInvocation: false, userInvocable: false });
		expect(byName.get("boolean-on")).toMatchObject({ disableModelInvocation: true, userInvocable: true });
		expect(byName.get("boolean-off")).toMatchObject({ disableModelInvocation: false, userInvocable: false });
		expect(byName.get("boolean-1")).toMatchObject({ disableModelInvocation: true, userInvocable: true });
		expect(byName.get("boolean-0")).toMatchObject({ disableModelInvocation: false, userInvocable: false });

		expect(byName.get("arguments-string")?.frontmatter.arguments).toBe("path");
		expect(byName.get("arguments-list")?.frontmatter.arguments).toEqual(["path", "verbose"]);
		expect(byName.get("arguments-map")?.frontmatter.arguments).toEqual({
			path: { description: "File path to operate on", required: true },
		});

		expect(byName.get("allowed-tools-string")?.frontmatter["allowed-tools"]).toBe("read");
		expect(byName.get("allowed-tools-list")?.frontmatter["allowed-tools"]).toEqual(["read", "write"]);
		expect(byName.get("disallowed-tools-string")?.frontmatter["disallowed-tools"]).toBe("bash, write");
		expect(byName.get("disallowed-tools-list")?.frontmatter["disallowed-tools"]).toEqual(["bash", "write"]);
		expect(byName.get("disallowed-tools-alias")?.frontmatter.disallowedTools).toEqual(["bash"]);

		expect(byName.get("model")?.frontmatter.model).toBe("inherit");
		expect(byName.get("effort-integer")?.frontmatter.effort).toBe(5000);
		expect(byName.get("effort-string")?.frontmatter.effort).toBe("high");
		expect(byName.get("context-inline")?.frontmatter.context).toBe("inline");
		expect(byName.get("context-fork")?.frontmatter).toMatchObject({
			context: "fork",
			agent: "general-purpose",
			background: true,
		});
		expect(byName.get("paths")?.frontmatter.paths).toEqual(["src/**", "docs/**/*.md"]);
		expect(byName.get("shell")?.frontmatter.shell).toBe("powershell");
		expect(byName.get("hooks")?.frontmatter.hooks).toMatchObject({
			PreToolUse: [expect.objectContaining({ matcher: "Bash" })],
			PostToolUse: [expect.objectContaining({ matcher: "*" })],
		});
		expect(byName.get("license-compatibility-metadata")?.frontmatter).toMatchObject({
			license: "MIT",
			compatibility: "Pi",
			metadata: { owner: "core", tags: ["contract", "fixture"] },
		});
		expect(byName.get("unknown-nested")?.frontmatter["custom-extension-field"]).toEqual({
			nested: { deep: true },
			list: [1, 2, 3],
		});
		expect(byName.get("when-to-use")?.frontmatter.when_to_use).toBe(
			"Use this skill when testing the when_to_use listing fold.",
		);
		expect(byName.get("argument-hint")?.argumentHint).toBe("[path] [--verbose]");

		const validName = byName.get("valid-name");
		expect(validName?.commandNameValid).toBe(true);
		const warningName = byName.get("Upper.Name");
		expect(warningName?.commandNameValid).toBe(true);
		const invalidName = byName.get("trailing.");
		expect(invalidName?.commandNameValid).toBe(false);

		// The A.1-invalid fixture's namespace diagnostic fires on every load, unsuppressed. It also
		// carries an Agent Skills invalid-characters warning (the "." is not lowercase a-z0-9-),
		// alongside the separate name-warning fixture's own invalid-characters warning.
		expect(diagnostics.filter((item) => item.message.includes("bare skill command namespace"))).toHaveLength(1);
		expect(diagnostics.filter((item) => item.message.includes("invalid characters"))).toHaveLength(2);
		expect(diagnostics).toHaveLength(3);
	});

	it("deep-matches the all-fields fixture against the c0b skills:changed and skills:query payloads", async () => {
		const eventBus = createEventBus();
		const changedEvents: SkillSetSnapshot[] = [];
		eventBus.on(SKILLS_CHANGED_CHANNEL, (data) => changedEvents.push(data as SkillSetSnapshot));
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: [join(FIELDS_FIXTURES_DIR, "all-fields")],
		});
		await loader.reload();

		const allFieldsSkill = loader.getSkills().skills[0];
		expect(allFieldsSkill.name).toBe("all-fields");
		expect(changedEvents).toHaveLength(1);
		const entry = changedEvents[0].skills.find((candidate) => candidate.name === "all-fields");
		expect(entry).toBeDefined();
		expect(entry?.frontmatter).toEqual(allFieldsSkill.frontmatter);

		const replies: Array<RpcReply<SkillSetSnapshot>> = [];
		eventBus.on(skillsQueryReplyChannel("all-fields-query"), (data) =>
			replies.push(data as RpcReply<SkillSetSnapshot>),
		);
		eventBus.emit(SKILLS_QUERY_CHANNEL, { requestId: "all-fields-query" });
		expect(replies).toHaveLength(1);
		const queried = (replies[0] as { success: true; data: SkillSetSnapshot }).data;
		expect(queried.skills.find((candidate) => candidate.name === "all-fields")?.frontmatter).toEqual(
			allFieldsSkill.frontmatter,
		);
	});
});

describe("inertness matrix", () => {
	const FIELDS_FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "skills-contract", "fields");

	async function createInertnessHarness(fixtureName: string) {
		const eventBus = createEventBus();
		const spawnRequests: unknown[] = [];
		eventBus.on("subagents:rpc:spawn", (data) => spawnRequests.push(data));
		const loader = new DefaultResourceLoader({
			cwd: tempDir,
			agentDir: tempDir,
			eventBus,
			noSkills: true,
			additionalSkillPaths: [join(FIELDS_FIXTURES_DIR, fixtureName)],
		});
		await loader.reload();
		const harness = await createHarness({ resourceLoader: loader });
		return { harness, spawnRequests };
	}

	async function expandSkill(harness: Awaited<ReturnType<typeof createHarness>>, command: string): Promise<string> {
		let expanded = "";
		harness.setResponses([
			(context) => {
				const users = context.messages.filter((message) => message.role === "user");
				expanded = users.length > 0 ? getMessageText(users[users.length - 1]) : "";
				return fauxAssistantMessage("ok");
			},
		]);
		await harness.session.prompt(command);
		return expanded;
	}

	it("keeps allowed-tools advisory only: the active tool list is unchanged after expansion", async () => {
		const { harness } = await createInertnessHarness("allowed-tools-list");
		try {
			const before = harness.session.getActiveToolNames();
			await expandSkill(harness, "/skill:allowed-tools-list use tools");
			expect(harness.session.getActiveToolNames()).toEqual(before);
		} finally {
			harness.cleanup();
		}
	});

	it("keeps disallowed-tools advisory only: matching tools are neither schema-removed nor blocked", async () => {
		const { harness } = await createInertnessHarness("disallowed-tools-list");
		try {
			const before = harness.session.getActiveToolNames();
			expect(before).toContain("bash");
			await expandSkill(harness, "/skill:disallowed-tools-list use tools");
			const after = harness.session.getActiveToolNames();
			expect(after).toEqual(before);
			expect(after).toContain("bash");
		} finally {
			harness.cleanup();
		}
	});

	it("keeps model a no-op override: the session's resolved model is unchanged", async () => {
		const { harness } = await createInertnessHarness("model");
		try {
			const beforeModelId = harness.session.model?.id;
			await expandSkill(harness, "/skill:model run");
			expect(harness.session.model?.id).toBe(beforeModelId);
		} finally {
			harness.cleanup();
		}
	});

	it("keeps effort a no-op override: the session's resolved thinking level is unchanged", async () => {
		const { harness } = await createInertnessHarness("effort-string");
		try {
			const before = harness.session.thinkingLevel;
			await expandSkill(harness, "/skill:effort-string run");
			expect(harness.session.thinkingLevel).toBe(before);
		} finally {
			harness.cleanup();
		}
	});

	it.each(["context", "agent", "background"] as const)(
		"keeps %s inert for a context: fork skill: no subagents:rpc:spawn request is ever emitted",
		async () => {
			const { harness, spawnRequests } = await createInertnessHarness("context-fork");
			try {
				await expandSkill(harness, "/skill:context-fork run");
				expect(spawnRequests).toEqual([]);
			} finally {
				harness.cleanup();
			}
		},
	);

	it("keeps shell inert: no tool executes and no shell command is injected on expansion", async () => {
		const { harness } = await createInertnessHarness("shell");
		try {
			const expanded = await expandSkill(harness, "/skill:shell run");
			expect(harness.eventsOfType("tool_execution_start")).toEqual([]);
			expect(expanded).toContain('<skill name="shell" args="run">');
			expect(expanded).not.toContain("powershell.exe");
		} finally {
			harness.cleanup();
		}
	});

	it("keeps hooks parsed-never-executed: hook commands are not injected or run on expansion", async () => {
		const { harness } = await createInertnessHarness("hooks");
		try {
			const expanded = await expandSkill(harness, "/skill:hooks run");
			expect(harness.eventsOfType("tool_execution_start")).toEqual([]);
			expect(expanded).not.toContain("echo pre-tool-use");
			expect(expanded).not.toContain("echo post-tool-use");
		} finally {
			harness.cleanup();
		}
	});

	it("keeps paths a no-op for listing order: no boost promotes it ahead of an earlier-declared skill", () => {
		const { skills: pathsSkills } = loadSkillsFromDir({
			dir: join(FIELDS_FIXTURES_DIR, "paths"),
			source: "test",
		});
		const pathsSkill = pathsSkills[0];
		const earlierControl = createSkillInput({ name: "aaa-earlier-control" });
		const listing = formatSkillsForPrompt([earlierControl, pathsSkill]);
		const earlierIndex = listing.indexOf("<name>aaa-earlier-control</name>");
		const pathsIndex = listing.indexOf("<name>paths</name>");
		expect(earlierIndex).toBeGreaterThan(-1);
		expect(pathsIndex).toBeGreaterThan(earlierIndex);
	});
});
