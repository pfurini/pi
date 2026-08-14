import { describe, expect, it } from "vitest";
import type { LoadedSkill, SkillFrontmatter } from "../src/core/skills/frontmatter.ts";
import { boostSkillsByPaths, skillPathTouchFromToolCall } from "../src/core/skills/paths-boost.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

const CWD = "/repo";

function makeSkill(options: { id: string; listingName: string; paths?: SkillFrontmatter["paths"] }): LoadedSkill {
	const frontmatter: SkillFrontmatter = options.paths === undefined ? {} : { paths: options.paths };
	return {
		id: options.id,
		name: options.id,
		description: "test skill",
		filePath: `${CWD}/.pi/skills/${options.id}/SKILL.md`,
		baseDir: `${CWD}/.pi/skills/${options.id}`,
		sourceInfo: createSyntheticSourceInfo(`${CWD}/.pi/skills/${options.id}/SKILL.md`, { source: "test" }),
		disableModelInvocation: false,
		listingName: options.listingName,
		frontmatter,
		argumentHint: undefined,
		userInvocable: true,
		commandNameValid: true,
	};
}

describe("boostSkillsByPaths", () => {
	it("boosts a skill whose paths glob matches a touched path to the front", () => {
		const api = makeSkill({ id: "api", listingName: "api-skill", paths: ["src/api/**"] });
		const other = makeSkill({ id: "other", listingName: "other-skill" });
		const result = boostSkillsByPaths([other, api], ["src/api/handler.ts"], CWD);

		expect(result.ordered.map((s) => s.id)).toEqual(["api", "other"]);
		expect(result.exemptIds).toEqual(new Set(["api"]));
	});

	it("leaves an unmatched skill in the non-boosted group", () => {
		const api = makeSkill({ id: "api", listingName: "api-skill", paths: ["src/api/**"] });
		const result = boostSkillsByPaths([api], ["src/other/file.ts"], CWD);

		expect(result.ordered.map((s) => s.id)).toEqual(["api"]);
		expect(result.exemptIds.size).toBe(0);
	});

	it("sorts two boosted skills by listingName asc within the boosted group", () => {
		const zeta = makeSkill({ id: "zeta", listingName: "zeta-skill", paths: ["src/api/**"] });
		const alpha = makeSkill({ id: "alpha", listingName: "alpha-skill", paths: ["src/api/**"] });
		const result = boostSkillsByPaths([zeta, alpha], ["src/api/handler.ts"], CWD);

		expect(result.ordered.map((s) => s.id)).toEqual(["alpha", "zeta"]);
	});

	it("sorts two non-boosted skills by listingName asc", () => {
		const zeta = makeSkill({ id: "zeta", listingName: "zeta-skill" });
		const alpha = makeSkill({ id: "alpha", listingName: "alpha-skill" });
		const result = boostSkillsByPaths([zeta, alpha], [], CWD);

		expect(result.ordered.map((s) => s.id)).toEqual(["alpha", "zeta"]);
	});

	it("returns listingName-asc order and empty exemptIds when there are no touched paths", () => {
		const zeta = makeSkill({ id: "zeta", listingName: "zeta-skill", paths: ["src/api/**"] });
		const alpha = makeSkill({ id: "alpha", listingName: "alpha-skill" });
		const result = boostSkillsByPaths([zeta, alpha], [], CWD);

		expect(result.ordered.map((s) => s.id)).toEqual(["alpha", "zeta"]);
		expect(result.exemptIds.size).toBe(0);
	});

	it("returns exemptIds equal to exactly the boosted ids", () => {
		const api = makeSkill({ id: "api", listingName: "api-skill", paths: ["src/api/**"] });
		const web = makeSkill({ id: "web", listingName: "web-skill", paths: ["src/web/**"] });
		const other = makeSkill({ id: "other", listingName: "other-skill" });
		const result = boostSkillsByPaths([api, web, other], ["src/api/foo.ts"], CWD);

		expect(result.exemptIds).toEqual(new Set(["api"]));
	});

	it("matches a cwd-relative touched path", () => {
		const api = makeSkill({ id: "api", listingName: "api-skill", paths: ["src/api/**"] });
		const result = boostSkillsByPaths([api], ["src/api/handler.ts"], CWD);
		expect(result.exemptIds.has("api")).toBe(true);
	});

	it("matches an absolute touched path", () => {
		const api = makeSkill({ id: "api", listingName: "api-skill", paths: ["src/api/**"] });
		const result = boostSkillsByPaths([api], [`${CWD}/src/api/handler.ts`], CWD);
		expect(result.exemptIds.has("api")).toBe(true);
	});

	it("matches case-insensitively (nocase)", () => {
		const api = makeSkill({ id: "api", listingName: "api-skill", paths: ["SRC/API/**"] });
		const result = boostSkillsByPaths([api], ["src/api/handler.ts"], CWD);
		expect(result.exemptIds.has("api")).toBe(true);
	});

	it("never boosts a skill with no paths", () => {
		const noPaths = makeSkill({ id: "no-paths", listingName: "no-paths-skill" });
		const result = boostSkillsByPaths([noPaths], ["src/api/handler.ts"], CWD);
		expect(result.exemptIds.size).toBe(0);
	});

	it("does not throw and skips a non-string paths scalar", () => {
		const bad = makeSkill({ id: "bad", listingName: "bad-skill" });
		bad.frontmatter.paths = 42 as unknown as string;
		const result = boostSkillsByPaths([bad], ["src/api/handler.ts"], CWD);
		expect(result.exemptIds.size).toBe(0);
	});

	it("does not throw and skips non-string entries in a mixed paths array", () => {
		const mixed = makeSkill({ id: "mixed", listingName: "mixed-skill" });
		mixed.frontmatter.paths = [123, "src/api/**"] as unknown as string[];
		const result = boostSkillsByPaths([mixed], ["src/api/handler.ts"], CWD);
		expect(result.exemptIds.has("mixed")).toBe(true);
	});

	it("does not throw and skips a pattern longer than 65536 characters", () => {
		const huge = makeSkill({ id: "huge", listingName: "huge-skill", paths: ["a".repeat(70_000)] });
		const result = boostSkillsByPaths([huge], ["src/api/handler.ts"], CWD);
		expect(result.exemptIds.size).toBe(0);
	});
});

describe("skillPathTouchFromToolCall", () => {
	it("returns the path for a successful read call", () => {
		expect(skillPathTouchFromToolCall("read", { path: "src/api/foo.ts" })).toBe("src/api/foo.ts");
	});

	it("returns the path for a successful edit call", () => {
		expect(skillPathTouchFromToolCall("edit", { path: "src/api/foo.ts" })).toBe("src/api/foo.ts");
	});

	it("returns the path for a successful write call", () => {
		expect(skillPathTouchFromToolCall("write", { path: "src/api/foo.ts" })).toBe("src/api/foo.ts");
	});

	it("returns undefined for grep (search root, not a touch)", () => {
		expect(skillPathTouchFromToolCall("grep", { path: "src/api" })).toBeUndefined();
	});

	it("returns undefined for find (search root, not a touch)", () => {
		expect(skillPathTouchFromToolCall("find", { path: "src/api" })).toBeUndefined();
	});

	it("returns undefined for ls (search root, not a touch)", () => {
		expect(skillPathTouchFromToolCall("ls", { path: "src/api" })).toBeUndefined();
	});

	it("returns undefined for bash", () => {
		expect(skillPathTouchFromToolCall("bash", { command: "ls" })).toBeUndefined();
	});

	it("returns undefined for missing args", () => {
		expect(skillPathTouchFromToolCall("read", undefined)).toBeUndefined();
	});

	it("returns undefined for a non-string path", () => {
		expect(skillPathTouchFromToolCall("read", { path: 42 })).toBeUndefined();
	});

	it("returns undefined for nested/non-object args", () => {
		expect(skillPathTouchFromToolCall("read", "src/api/foo.ts")).toBeUndefined();
	});

	it("returns undefined for null args", () => {
		expect(skillPathTouchFromToolCall("read", null)).toBeUndefined();
	});
});
