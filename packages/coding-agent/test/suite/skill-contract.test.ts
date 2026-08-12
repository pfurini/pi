import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as mockedFs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionRuntime } from "../../src/core/extensions/loader.ts";
import { normalizeSkillInput } from "../../src/core/skills/frontmatter.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import {
	DefaultResourceLoader,
	extractSkillListingBlock,
	formatSkillsForPrompt,
	type LoadedSkill,
	loadSkills,
	loadSkillsFromDir,
	type ResourceLoader,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	SKILL_LISTING_VERSION,
	type SkillInput,
} from "../../src/index.ts";

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

	it("extracts the first complete v2 block and rejects incomplete or unsupported blocks", () => {
		const first = `${SKILL_LISTING_START_DELIMITER}\nfirst\n${SKILL_LISTING_END_DELIMITER}`;
		const second = `${SKILL_LISTING_START_DELIMITER}\nsecond\n${SKILL_LISTING_END_DELIMITER}`;
		expect(extractSkillListingBlock(`prefix${first}middle${second}suffix`)).toBe(first);
		expect(extractSkillListingBlock("no listing")).toBeUndefined();
		expect(extractSkillListingBlock(SKILL_LISTING_START_DELIMITER)).toBeUndefined();
		expect(extractSkillListingBlock(SKILL_LISTING_END_DELIMITER)).toBeUndefined();
		expect(extractSkillListingBlock('<available_skills version="3">\nwrong\n</available_skills>')).toBeUndefined();
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
