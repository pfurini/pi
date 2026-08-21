import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	// c4d: the extractor is name-agnostic and resolves `path` against the session cwd,
	// so it needs a real filesystem to recognize an authoritative single-file touch.
	function withTempTree(run: (cwd: string) => void): void {
		const cwd = mkdtempSync(join(tmpdir(), "pi-paths-boost-"));
		try {
			mkdirSync(join(cwd, "src/api"), { recursive: true });
			writeFileSync(join(cwd, "src/api/foo.ts"), "export {};\n");
			run(cwd);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}

	it("returns the resolved absolute path for an authoritative single-file touch, name-agnostic", () => {
		withTempTree((cwd) => {
			const expected = join(cwd, "src/api/foo.ts");
			// The tool name plays no role (c4d): the built-in read/edit/write, override
			// setups' `replace`, and Hypa/lens single-file readers all carry a `path`.
			expect(skillPathTouchFromToolCall({ path: "src/api/foo.ts" }, cwd)).toBe(expected);
			expect(skillPathTouchFromToolCall({ path: join(cwd, "src/api/foo.ts") }, cwd)).toBe(expected);
		});
	});

	it("resolves a relative path against the session cwd, not process.cwd()", () => {
		withTempTree((cwd) => {
			expect(cwd).not.toBe(process.cwd());
			expect(skillPathTouchFromToolCall({ path: "src/api/foo.ts" }, cwd)).toBe(join(cwd, "src/api/foo.ts"));
		});
	});

	it("returns undefined for directory/multi-file scanners (path is a directory)", () => {
		withTempTree((cwd) => {
			expect(skillPathTouchFromToolCall({ path: "src/api" }, cwd)).toBeUndefined();
		});
	});

	it("returns undefined when the path does not exist", () => {
		withTempTree((cwd) => {
			expect(skillPathTouchFromToolCall({ path: "src/api/missing.ts" }, cwd)).toBeUndefined();
		});
	});

	it("returns undefined for calls without a string path argument", () => {
		withTempTree((cwd) => {
			expect(skillPathTouchFromToolCall({ command: "ls" }, cwd)).toBeUndefined();
			expect(skillPathTouchFromToolCall(undefined, cwd)).toBeUndefined();
			expect(skillPathTouchFromToolCall({ path: 42 }, cwd)).toBeUndefined();
			expect(skillPathTouchFromToolCall("src/api/foo.ts", cwd)).toBeUndefined();
			expect(skillPathTouchFromToolCall(null, cwd)).toBeUndefined();
			expect(skillPathTouchFromToolCall({ path: "" }, cwd)).toBeUndefined();
		});
	});
});
