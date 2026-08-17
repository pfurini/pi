import { homedir } from "os";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import type { ResourceDiagnostic } from "../src/core/diagnostics.ts";
import type { SkillFrontmatter } from "../src/core/skills/frontmatter.ts";
import { escapeXml as escapeXmlFromListing } from "../src/core/skills/listing.ts";
import { escapeXml as escapeXmlFromListingBudget } from "../src/core/skills/listing-budget.ts";
import {
	extractSkillListingBlock,
	formatSkillsForPrompt,
	loadSkills,
	loadSkillsFromDir,
	SKILL_LISTING_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER,
	SKILL_LISTING_VERSION,
	type Skill,
} from "../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import {
	SKILL_LISTING_END_DELIMITER as INDEX_END_DELIMITER,
	SKILL_LISTING_START_DELIMITER as INDEX_START_DELIMITER,
	SKILL_LISTING_VERSION as INDEX_VERSION,
} from "../src/index.ts";
import { canonicalizePath } from "../src/utils/paths.ts";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const collisionFixturesDir = resolve(__dirname, "fixtures/skills-collision");

function createTestSkill(options: {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	disableModelInvocation?: boolean;
	frontmatter?: SkillFrontmatter;
	source?: string;
}): Skill {
	return {
		name: options.name,
		description: options.description,
		filePath: options.filePath,
		baseDir: options.baseDir,
		sourceInfo: createSyntheticSourceInfo(options.filePath, { source: options.source ?? "test" }),
		...(options.frontmatter ? { frontmatter: options.frontmatter } : {}),
		disableModelInvocation: options.disableModelInvocation ?? false,
	};
}

describe("skills", () => {
	describe("loadSkillsFromDir", () => {
		it("should load a valid skill", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
			expect(skills[0].description).toBe("A valid skill for testing purposes.");
			expect(skills[0].sourceInfo.source).toBe("test");
			expect(diagnostics).toHaveLength(0);
		});

		it("should allow names that don't match parent directory", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "name-mismatch"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("different-name");
			expect(
				diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not match parent directory")),
			).toBe(false);
		});

		it("should warn when name contains invalid characters", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-name-chars"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("invalid characters"))).toBe(true);
		});

		it("should warn when name exceeds 64 characters", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "long-name"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("exceeds 64 characters"))).toBe(true);
		});

		it("should warn and skip skill when description is missing", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "missing-description"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
		});

		it("should ignore unknown frontmatter fields", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "unknown-field"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics).toHaveLength(0);
		});

		it("should load nested skills recursively", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "nested"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("child-skill");
			expect(diagnostics).toHaveLength(0);
		});

		it("should prefer a directory's root SKILL.md over nested SKILL.md files", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "root-skill-preferred"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("root-skill-preferred");
			expect(skills[0].description).toBe("Root skill should win.");
			expect(diagnostics).toHaveLength(0);
		});

		it("should skip files without frontmatter", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "no-frontmatter"),
				source: "test",
			});

			// no-frontmatter has no description, so it should be skipped
			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
		});

		it("should warn and skip skill when YAML frontmatter is invalid", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-yaml"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("at line"))).toBe(true);
		});

		it("should preserve multiline descriptions from YAML", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "multiline-description"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].description).toContain("\n");
			expect(skills[0].description).toContain("This is a multiline description.");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when name contains consecutive hyphens", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "consecutive-hyphens"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("consecutive hyphens"))).toBe(true);
		});

		it("should load all skills from fixture directory", () => {
			const { skills } = loadSkillsFromDir({
				dir: fixturesDir,
				source: "test",
			});

			// Should load all skills that have descriptions (even with warnings)
			// valid-skill, name-mismatch, invalid-name-chars, long-name, unknown-field, nested/child-skill, consecutive-hyphens
			// NOT: missing-description, no-frontmatter (both missing descriptions)
			expect(skills.length).toBeGreaterThanOrEqual(6);
		});

		it("should return empty for non-existent directory", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: "/non/existent/path",
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics).toHaveLength(0);
		});

		it("should use parent directory name when name not in frontmatter", () => {
			// The no-frontmatter fixture has no name in frontmatter, so it should use "no-frontmatter"
			// But it also has no description, so it won't load
			// Let's test with a valid skill that relies on directory name
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
		});

		it("should parse disable-model-invocation frontmatter field", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "disable-model-invocation"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("disable-model-invocation");
			expect(skills[0].disableModelInvocation).toBe(true);
			// Should not warn about unknown field
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("unknown frontmatter field"))).toBe(
				false,
			);
		});

		it("should default disableModelInvocation to false when not specified", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].disableModelInvocation).toBe(false);
		});
	});

	describe("formatSkillsForPrompt", () => {
		it("should return empty string for no skills", () => {
			const result = formatSkillsForPrompt([]);
			expect(result).toBe("");
		});

		it("should format skills as XML", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain('<available_skills version="2">');
			expect(result).toContain("</available_skills>");
			expect(result).toContain("<skill>");
			expect(result).toContain("<name>test-skill</name>");
			expect(result).toContain("<description>A test skill.</description>");
			expect(result).toContain("<location>/path/to/skill/SKILL.md</location>");
		});

		it("should include intro text before XML", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const result = formatSkillsForPrompt(skills);
			const xmlStart = result.indexOf('<available_skills version="2">');
			const introText = result.substring(0, xmlStart);

			expect(introText).toContain("The following skills provide specialized instructions");
			expect(introText).toContain("Use the read tool to load a skill's file");
		});

		it("should escape XML special characters", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "test-skill",
					description: 'A skill with <special> & "characters".',
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("&lt;special&gt;");
			expect(result).toContain("&amp;");
			expect(result).toContain("&quot;characters&quot;");
		});

		it("should format multiple skills", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "skill-one",
					description: "First skill.",
					filePath: "/path/one/SKILL.md",
					baseDir: "/path/one",
				}),
				createTestSkill({
					name: "skill-two",
					description: "Second skill.",
					filePath: "/path/two/SKILL.md",
					baseDir: "/path/two",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>skill-one</name>");
			expect(result).toContain("<name>skill-two</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(2);
		});

		it("keeps a paths-matched description ahead of an unmatched skill under a tight budget", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "matched-skill",
					description: "M".repeat(600),
					filePath: "/repo/matched/SKILL.md",
					baseDir: "/repo/matched",
					frontmatter: { paths: ["src/api/**"] },
				}),
				createTestSkill({
					name: "unmatched-skill",
					description: "U".repeat(600),
					filePath: "/repo/unmatched/SKILL.md",
					baseDir: "/repo/unmatched",
				}),
			];

			const result = formatSkillsForPrompt(
				skills,
				"read",
				{ touchedPaths: ["/repo/src/api/file.ts"], cwd: "/repo" },
				{ budgetCodeUnits: 210, invocationCounts: new Map() },
			);
			const block = extractSkillListingBlock(result);
			expect(block).toBeDefined();
			const matchedStart = block!.indexOf("<name>matched-skill</name>");
			const unmatchedStart = block!.indexOf("<name>unmatched-skill</name>");
			const matchedEntry = block!.slice(matchedStart, block!.indexOf("</skill>", matchedStart));
			const unmatchedEntry = block!.slice(unmatchedStart, block!.indexOf("</skill>", unmatchedStart));
			expect(matchedEntry).toContain("<description>");
			expect(unmatchedEntry).not.toContain("<description>");
		});

		it("should exclude skills with disableModelInvocation from prompt", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "visible-skill",
					description: "A visible skill.",
					filePath: "/path/visible/SKILL.md",
					baseDir: "/path/visible",
				}),
				createTestSkill({
					name: "hidden-skill",
					description: "A hidden skill.",
					filePath: "/path/hidden/SKILL.md",
					baseDir: "/path/hidden",
					disableModelInvocation: true,
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>visible-skill</name>");
			expect(result).not.toContain("<name>hidden-skill</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(1);
		});

		it("should return empty string when all skills have disableModelInvocation", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "hidden-skill",
					description: "A hidden skill.",
					filePath: "/path/hidden/SKILL.md",
					baseDir: "/path/hidden",
					disableModelInvocation: true,
				}),
			];

			const result = formatSkillsForPrompt(skills);
			expect(result).toBe("");
		});

		it("produces byte-identical output with no budget (C4a rewire regression)", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "beta-skill",
					description: "Beta desc with <special> & chars.",
					filePath: "/path/beta/SKILL.md",
					baseDir: "/path/beta",
				}),
				createTestSkill({
					name: "alpha-skill",
					description: "Alpha description.",
					filePath: "/path/alpha/SKILL.md",
					baseDir: "/path/alpha",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			const expected =
				"\n\nThe following skills provide specialized instructions for specific tasks.\n" +
				"Use the read tool to load a skill's file when the task matches its description.\n" +
				"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n" +
				"\n" +
				'<available_skills version="2">\n' +
				"  <skill>\n" +
				"    <name>alpha-skill</name>\n" +
				"    <description>Alpha description.</description>\n" +
				"    <location>/path/alpha/SKILL.md</location>\n" +
				"  </skill>\n" +
				"  <skill>\n" +
				"    <name>beta-skill</name>\n" +
				"    <description>Beta desc with &lt;special&gt; &amp; chars.</description>\n" +
				"    <location>/path/beta/SKILL.md</location>\n" +
				"  </skill>\n" +
				"</available_skills>";

			expect(result).toBe(expected);
			expect(extractSkillListingBlock(result)).toBe(
				'<available_skills version="2">\n' +
					"  <skill>\n" +
					"    <name>alpha-skill</name>\n" +
					"    <description>Alpha description.</description>\n" +
					"    <location>/path/alpha/SKILL.md</location>\n" +
					"  </skill>\n" +
					"  <skill>\n" +
					"    <name>beta-skill</name>\n" +
					"    <description>Beta desc with &lt;special&gt; &amp; chars.</description>\n" +
					"    <location>/path/beta/SKILL.md</location>\n" +
					"  </skill>\n" +
					"</available_skills>",
			);
		});

		it("keeps an empty-description skill's <description></description> tag byte-identical with no budget", () => {
			const skills: Skill[] = [
				createTestSkill({
					name: "empty-desc-skill",
					description: "",
					filePath: "/path/empty/SKILL.md",
					baseDir: "/path/empty",
				}),
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<description></description>");
			expect(extractSkillListingBlock(result)).toBe(
				'<available_skills version="2">\n' +
					"  <skill>\n" +
					"    <name>empty-desc-skill</name>\n" +
					"    <description></description>\n" +
					"    <location>/path/empty/SKILL.md</location>\n" +
					"  </skill>\n" +
					"</available_skills>",
			);
		});

		describe("A.6 visibility map (c4c)", () => {
			const visibilitySkill = (name: string) =>
				createTestSkill({
					name,
					description: `${name} description.`,
					filePath: `/path/${name}/SKILL.md`,
					baseDir: `/path/${name}`,
				});

			it("renders a name-only entry (name+location, no description) for a name-visibility skill", () => {
				const skill = visibilitySkill("named");
				const result = formatSkillsForPrompt(
					[skill],
					"tool",
					undefined,
					undefined,
					new Map([[canonicalizePath(skill.filePath), "name"]]),
				);
				const block = extractSkillListingBlock(result)!;
				expect(block).toBe(
					'<available_skills version="2">\n' +
						"  <skill>\n" +
						"    <name>named</name>\n" +
						"    <location>/path/named/SKILL.md</location>\n" +
						"  </skill>\n" +
						"</available_skills>",
				);
			});

			it("omits a no-visibility skill entirely and falls back to frontmatter for unmapped skills", () => {
				const hidden = visibilitySkill("hidden");
				const visible = visibilitySkill("visible");
				const result = formatSkillsForPrompt(
					[hidden, visible],
					"tool",
					undefined,
					undefined,
					new Map([[canonicalizePath(hidden.filePath), "no"]]),
				);
				expect(result).not.toContain("<name>hidden</name>");
				expect(result).toContain("<name>visible</name>");
				expect(result).toContain("<description>visible description.</description>");
			});

			it("returns an empty block when every skill maps to no", () => {
				const skill = visibilitySkill("solo");
				const result = formatSkillsForPrompt(
					[skill],
					"tool",
					undefined,
					undefined,
					new Map([[canonicalizePath(skill.filePath), "no"]]),
				);
				expect(result).toBe("");
			});

			it("reflects the model dimension identically in the read and tool variants (AC3)", () => {
				const full = visibilitySkill("full-skill");
				const named = visibilitySkill("named-skill");
				const hidden = visibilitySkill("hidden-skill");
				const visibility = new Map<string, "full" | "name" | "no">([
					[canonicalizePath(named.filePath), "name"],
					[canonicalizePath(hidden.filePath), "no"],
				]);
				const skills = [full, named, hidden];
				const readBlock = extractSkillListingBlock(
					formatSkillsForPrompt(skills, "read", undefined, undefined, visibility),
				);
				const toolBlock = extractSkillListingBlock(
					formatSkillsForPrompt(skills, "tool", undefined, undefined, visibility),
				);
				expect(readBlock).toBeDefined();
				expect(readBlock).toBe(toolBlock);
				expect(readBlock).toContain("<name>named-skill</name>");
				expect(readBlock).not.toContain("named-skill description.");
				expect(readBlock).not.toContain("hidden-skill");
			});

			it("never re-expands a name-only entry's description under budget truncation", () => {
				const named = visibilitySkill("named");
				const other = createTestSkill({
					name: "other",
					description: "O".repeat(600),
					filePath: "/path/other/SKILL.md",
					baseDir: "/path/other",
				});
				const result = formatSkillsForPrompt(
					[named, other],
					"tool",
					undefined,
					{ budgetCodeUnits: 400, invocationCounts: new Map() },
					new Map([[canonicalizePath(named.filePath), "name"]]),
				);
				const block = extractSkillListingBlock(result)!;
				expect(block).toContain("<name>named</name>");
				expect(block).not.toContain("named description.");
			});

			it("produces byte-identical output for an all-on visibility map and no map (AC6)", () => {
				const one = visibilitySkill("one");
				const two = createTestSkill({
					name: "two",
					description: "two description.",
					filePath: "/path/two/SKILL.md",
					baseDir: "/path/two",
					disableModelInvocation: true,
				});
				const skills = [one, two];
				const baseline = formatSkillsForPrompt(skills, "tool");
				const withMap = formatSkillsForPrompt(
					skills,
					"tool",
					undefined,
					undefined,
					new Map<string, "full" | "name" | "no">([
						[canonicalizePath(one.filePath), "full"],
						[canonicalizePath(two.filePath), "no"],
					]),
				);
				expect(withMap).toBe(baseline);
			});
		});

		it("resolves escapeXml and the SKILL_LISTING_* delimiters from every legacy import path", () => {
			expect(typeof escapeXmlFromListing).toBe("function");
			expect(escapeXmlFromListing).toBe(escapeXmlFromListingBudget);
			expect(escapeXmlFromListing("<x>")).toBe("&lt;x&gt;");

			expect(SKILL_LISTING_VERSION).toBe(INDEX_VERSION);
			expect(SKILL_LISTING_START_DELIMITER).toBe(INDEX_START_DELIMITER);
			expect(SKILL_LISTING_END_DELIMITER).toBe(INDEX_END_DELIMITER);
		});
	});

	describe("loadSkills with options", () => {
		const emptyAgentDir = resolve(__dirname, "fixtures/empty-agent");
		const emptyCwd = resolve(__dirname, "fixtures/empty-cwd");

		it("should load from explicit skillPaths", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: [join(fixturesDir, "valid-skill")],
				includeDefaults: true,
			});
			expect(skills).toHaveLength(1);
			expect(skills[0].sourceInfo.scope).toBe("temporary");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when skill path does not exist", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: ["/non/existent/path"],
				includeDefaults: true,
			});
			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not exist"))).toBe(true);
		});

		it("should expand ~ in skillPaths", () => {
			const homeSkillsDir = join(homedir(), ".pi/agent/skills");
			const { skills: withTilde } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: ["~/.pi/agent/skills"],
				includeDefaults: true,
			});
			const { skills: withoutTilde } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: [homeSkillsDir],
				includeDefaults: true,
			});
			expect(withTilde.length).toBe(withoutTilde.length);
		});
	});

	describe("collision handling", () => {
		it("should detect name collisions and keep first skill", () => {
			// Load from first directory
			const first = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "first"),
				source: "first",
			});

			const second = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "second"),
				source: "second",
			});

			// Simulate the collision behavior from loadSkills()
			const skillMap = new Map<string, Skill>();
			const collisionWarnings: Array<{ skillPath: string; message: string }> = [];

			for (const skill of first.skills) {
				skillMap.set(skill.name, skill);
			}

			for (const skill of second.skills) {
				const existing = skillMap.get(skill.name);
				if (existing) {
					collisionWarnings.push({
						skillPath: skill.filePath,
						message: `name collision: "${skill.name}" already loaded from ${existing.filePath}`,
					});
				} else {
					skillMap.set(skill.name, skill);
				}
			}

			expect(skillMap.size).toBe(1);
			expect(skillMap.get("calendar")?.sourceInfo.source).toBe("first");
			expect(collisionWarnings).toHaveLength(1);
			expect(collisionWarnings[0].message).toContain("name collision");
		});
	});
});
