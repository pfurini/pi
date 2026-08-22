/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: normative A.3.2 placeholder fixtures */
/**
 * A.3.2 argument grammar conformance: one focused case per rule, plus the
 * byte-exact Claude Code corpus in test/suite/fixtures/cc-argument-grammar/
 * (all twelve probes; probe 11 is the corpus's `@path` evidence and also gets a
 * full-pipeline assertion, since argument substitution alone cannot see it).
 */

import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	digitLikeDeclaredArgumentNames,
	parseDeclaredArgumentNames,
	type SkillArgumentsDeclaration,
	substituteSkillArguments,
	tokenizeSkillArgs,
} from "../src/core/skills/arguments.ts";
import { normalizeSkillInput } from "../src/core/skills/frontmatter.ts";
import { renderSkillInvocation } from "../src/core/skills/render.ts";
import { DEFAULT_SKILL_SHELL_SETTINGS } from "../src/core/skills/shell-injection.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { parseFrontmatter } from "../src/utils/frontmatter.ts";

describe("tokenizeSkillArgs (A.3.2 tokenizer deviation)", () => {
	it("splits on whitespace", () => {
		expect(tokenizeSkillArgs("a b  c")).toEqual(["a", "b", "c"]);
	});

	it("groups double and single quotes, stripping the quotes", () => {
		expect(tokenizeSkillArgs('alpha "b c" d')).toEqual(["alpha", "b c", "d"]);
		expect(tokenizeSkillArgs("alpha 'b c' d")).toEqual(["alpha", "b c", "d"]);
	});

	it("groups quotes anywhere in a token", () => {
		expect(tokenizeSkillArgs('name="x y"')).toEqual(["name=x y"]);
		expect(tokenizeSkillArgs('a"b c"d')).toEqual(["ab cd"]);
	});

	it("backslash escapes the next character everywhere", () => {
		expect(tokenizeSkillArgs("\\$lit")).toEqual(["$lit"]);
		expect(tokenizeSkillArgs("a\\ b")).toEqual(["a b"]);
		expect(tokenizeSkillArgs('"b\\"c"')).toEqual(['b"c']);
		expect(tokenizeSkillArgs("\\\\")).toEqual(["\\"]);
	});

	it("an unterminated quote runs to end of string (no error)", () => {
		expect(tokenizeSkillArgs('a "b c')).toEqual(["a", "b c"]);
		expect(tokenizeSkillArgs("a 'b c")).toEqual(["a", "b c"]);
	});

	it("a trailing backslash has no next character and stays literal", () => {
		expect(tokenizeSkillArgs("abc\\")).toEqual(["abc\\"]);
	});

	it("empty and whitespace-only input yield no tokens", () => {
		expect(tokenizeSkillArgs("")).toEqual([]);
		expect(tokenizeSkillArgs("   \t ")).toEqual([]);
	});
});

describe("parseDeclaredArgumentNames (A.3.2 rules 5-6)", () => {
	it("accepts list and map declarations in declaration order", () => {
		expect(parseDeclaredArgumentNames(["a", "b"])).toEqual(["a", "b"]);
		expect(parseDeclaredArgumentNames({ name: "the name", out: "output" })).toEqual(["name", "out"]);
		expect(parseDeclaredArgumentNames(undefined)).toEqual([]);
	});

	it("splits a string declaration on whitespace", () => {
		expect(parseDeclaredArgumentNames("alpha beta gamma")).toEqual(["alpha", "beta", "gamma"]);
		expect(parseDeclaredArgumentNames("solo")).toEqual(["solo"]);
		expect(parseDeclaredArgumentNames("   ")).toEqual([]);
	});

	it("drops digit-like names, shifting later names down one slot", () => {
		expect(parseDeclaredArgumentNames(["one", "2", "three"])).toEqual(["one", "three"]);
		expect(parseDeclaredArgumentNames("one 2 three")).toEqual(["one", "three"]);
	});

	it("reports the dropped digit-like names for load diagnostics", () => {
		expect(digitLikeDeclaredArgumentNames(["one", "2", "three"])).toEqual(["2"]);
		expect(digitLikeDeclaredArgumentNames("one 2 three")).toEqual(["2"]);
		expect(digitLikeDeclaredArgumentNames({ 1: "doc", ok: "doc" })).toEqual(["1"]);
		expect(digitLikeDeclaredArgumentNames(["one", "two"])).toEqual([]);
	});
});

describe("substituteSkillArguments — rules 1-5", () => {
	it("rule 1: $ARGUMENTS substitutes R verbatim (quotes, spacing, everything)", () => {
		expect(substituteSkillArguments("got: $ARGUMENTS", 'alpha "b c" name=x \\$lit')).toBe(
			'got: alpha "b c" name=x \\$lit',
		);
	});

	it("rule 2: $ARGUMENTS[N] is 0-based and accepts leading zeros", () => {
		expect(substituteSkillArguments("$ARGUMENTS[0]|$ARGUMENTS[1]|$ARGUMENTS[01]", "a b", [])).toBe("a|b|b");
	});

	it("rule 2: an out-of-range index leaves the entire match literal (and the append fallback fires)", () => {
		expect(substituteSkillArguments("v=$ARGUMENTS[99]", "a b", [])).toBe("v=$ARGUMENTS[99]\n\nARGUMENTS: a b");
	});

	it("rule 2: a non-numeric bracket is not part of the placeholder", () => {
		expect(substituteSkillArguments("$ARGUMENTS[x]", "alpha beta", [])).toBe("alpha beta[x]");
		expect(substituteSkillArguments("$ARGUMENTS[-1]", "alpha beta", [])).toBe("alpha beta[-1]");
		expect(substituteSkillArguments("$ARGUMENTS[ 0 ]", "alpha beta", [])).toBe("alpha beta[ 0 ]");
		expect(substituteSkillArguments("$ARGUMENTS[]", "alpha beta", [])).toBe("alpha beta[]");
	});

	it("rule 3: $N is 0-based shorthand; out of range stays literal", () => {
		expect(substituteSkillArguments("$0/$1", "a b", [])).toBe("a/b");
		// Both the literal $5 and the appended block (probe 2 shape).
		expect(substituteSkillArguments("only=[$5]", "alpha beta", [])).toBe("only=[$5]\n\nARGUMENTS: alpha beta");
	});

	it("rule 4: declared names are positional aliases in declaration order", () => {
		expect(substituteSkillArguments("[$alpha][$beta][$gamma]", "one two", ["alpha", "beta", "gamma"])).toBe(
			"[one][two][]",
		);
	});

	it("rule 4: an undeclared name stays literal", () => {
		expect(substituteSkillArguments("nope=[$nope]", "a b c d", ["issue"])).toBe("nope=[$nope]\n\nARGUMENTS: a b c d");
	});

	it("rule 4: there is no name=value binding and no positional compaction", () => {
		// `name=x` is an ordinary positional token, not a binding; the declared
		// name aliases its slot (declaration order), not the `x` value.
		expect(substituteSkillArguments("$0|$1|$2", "one name=x two", ["name"])).toBe("one|name=x|two");
		expect(substituteSkillArguments("[$name]", "one name=x two", ["name"])).toBe("[one]");
	});

	it("rule 5: a whitespace-separated string declaration maps names to slots in order", () => {
		const declared = parseDeclaredArgumentNames("alpha beta gamma");
		expect(substituteSkillArguments("[$alpha][$beta][$gamma]", "one two", declared)).toBe("[one][two][]");
	});
});

describe("substituteSkillArguments — rule 6 collisions", () => {
	it("a declared ARGUMENTS shadows the built-in", () => {
		expect(substituteSkillArguments("raw=[$ARGUMENTS]", "a b c d", ["issue", "ARGUMENTS", "branch"])).toBe("raw=[b]");
	});

	it("a declared ARGUMENTS does not shadow the indexed form (probe 12)", () => {
		expect(substituteSkillArguments("idx=[$ARGUMENTS[0]]", "a b c d", ["issue", "ARGUMENTS", "branch"])).toBe(
			"idx=[a]",
		);
	});

	it("a digit-like declared name is dropped and later names shift down one slot", () => {
		const declared = parseDeclaredArgumentNames(["one", "2", "three"]);
		expect(substituteSkillArguments("$one/$three", "x y z", declared)).toBe("x/y");
		// $1 keeps its positional meaning throughout.
		expect(substituteSkillArguments("$1", "x y z", declared)).toBe("y");
	});
});

describe("substituteSkillArguments — rule 7 escaping", () => {
	it("\\$ before a digit, ARGUMENTS, or a declared name renders literally, backslash removed", () => {
		expect(substituteSkillArguments("\\$1", "", [])).toBe("$1");
		expect(substituteSkillArguments("\\$ARGUMENTS", "", [])).toBe("$ARGUMENTS");
		expect(substituteSkillArguments("\\$100.00", "", [])).toBe("$100.00");
		expect(substituteSkillArguments("\\$issue", "", ["issue"])).toBe("$issue");
	});

	it("\\$ before anything else retains the backslash", () => {
		expect(substituteSkillArguments("\\$nope", "", ["issue"])).toBe("\\$nope");
	});

	it("a doubled backslash retains both and the placeholder still expands", () => {
		expect(substituteSkillArguments("\\\\$1", "a b", [])).toBe("\\\\b");
	});

	it("an escaped placeholder does not count as substituted (append fallback still fires)", () => {
		expect(substituteSkillArguments("literal \\$1 here", "a b", [])).toBe("literal $1 here\n\nARGUMENTS: a b");
	});
});

describe("substituteSkillArguments — rule 8 append fallback", () => {
	it("appends when R is non-empty and no placeholder was substituted", () => {
		expect(substituteSkillArguments("body text", "a b", [])).toBe("body text\n\nARGUMENTS: a b");
	});

	it("a substitution producing an empty string still counts as substituted", () => {
		expect(substituteSkillArguments("[$gamma]", "one two", ["alpha", "beta", "gamma"])).toBe("[]");
	});

	it("an unmatched indexed placeholder left literal does not count", () => {
		expect(substituteSkillArguments("body [$4]", "a b", [])).toBe("body [$4]\n\nARGUMENTS: a b");
	});

	it("appends nothing when R is empty or whitespace-only", () => {
		expect(substituteSkillArguments("body", "", [])).toBe("body");
		expect(substituteSkillArguments("body $1", "", [])).toBe("body $1");
		expect(substituteSkillArguments("body", "   ", [])).toBe("body");
	});
});

describe("substituteSkillArguments — rule 10: nothing outside the grammar is touched", () => {
	const raw = "a b";
	it.each(["$@", "${@:1}", "${@:1:2}", "${@:-d}", "${ARGUMENTS:1}", "${ARGUMENTS:-d}", "${1:-d}", "${name:-d}"])(
		"%s renders verbatim, inline and inside fenced code blocks",
		(snippet) => {
			const body = `inline ${snippet} here\n\`\`\`bash\nf ${snippet}\n\`\`\``;
			// No placeholder substituted, so the append fallback fires; the snippets
			// themselves must be byte-for-byte unchanged.
			expect(substituteSkillArguments(body, raw, ["name"])).toBe(`${body}\n\nARGUMENTS: ${raw}`);
		},
	);
});

describe("substituteSkillArguments — single pass", () => {
	it("substituted values are never re-scanned for placeholders", () => {
		expect(substituteSkillArguments("$ARGUMENTS", "$1", [])).toBe("$1");
	});

	it("repeated placeholders substitute repeatedly", () => {
		expect(substituteSkillArguments("$0 and $0", "x", [])).toBe("x and x");
	});
});

describe("substituteSkillArguments — no-substitution shell fixtures", () => {
	// Real repository migration fixture: the PRP store resolver line carried by
	// .pi/skills/prp-*/SKILL.md. Over-substitution of its `${...:-...}` forms is
	// the defect this grammar removes.
	const PRP_RESOLVER_LINE =
		'PRP_DIR="${PRP_HOME:-$HOME/.prp}/${_name:-project}-$(printf %s "$_root" | git hash-object --stdin | cut -c1-8)"';
	// Constructed grammar case (does not occur verbatim under .pi/): bare $@.
	const FOR_LOOP = 'for f in "$@"; do echo "$f"; done';

	it.each([
		["PRP store resolver", PRP_RESOLVER_LINE],
		["for over $@", FOR_LOOP],
	])("%s renders byte-for-byte unchanged, then the append fallback fires", (_label, snippet) => {
		const args = "plan some args";
		const body = `Header\n\n\`\`\`bash\n${snippet}\n\`\`\`\n\nFooter`;
		const rendered = substituteSkillArguments(body, args, []);
		// (a) The protected snippet region is unchanged.
		expect(rendered).toContain(snippet);
		// (b) The output is exactly the body plus the appended block.
		expect(rendered).toBe(`${body}\n\nARGUMENTS: ${args}`);
	});
});

// ============================================================================
// CC conformance corpus (test/suite/fixtures/cc-argument-grammar/)
// ============================================================================

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "suite", "fixtures", "cc-argument-grammar");

interface ManifestEntry {
	skill: string;
	args: string;
	covers: string;
}

/** README normalization: frontmatter + separator removed, the blank line before the body removed, trailing newline retained. */
function extractProbeBody(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const match = normalized.match(/^---\n[\s\S]*?\n---\n/);
	const withoutFrontmatter = match ? normalized.slice(match[0].length) : normalized;
	return withoutFrontmatter.startsWith("\n") ? withoutFrontmatter.slice(1) : withoutFrontmatter;
}

describe("cc-argument-grammar corpus", () => {
	const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(CORPUS_DIR, "manifest.json"), "utf-8"));
	const probeDirs = readdirSync(join(CORPUS_DIR, "probes"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	it("fixture integrity: manifest and directory listing agree; every probe has SKILL.md and expected.txt", () => {
		expect(probeDirs).toEqual(manifest.map((entry) => entry.skill).sort());
		for (const dir of probeDirs) {
			expect(readFileSync(join(CORPUS_DIR, "probes", dir, "SKILL.md"), "utf-8")).toContain("---");
			expect(readFileSync(join(CORPUS_DIR, "probes", dir, "expected.txt"), "utf-8").length).toBeGreaterThan(0);
		}
	});

	for (const entry of manifest) {
		it(`${entry.skill} reproduces CC byte-for-byte (${entry.covers})`, () => {
			const probeDir = join(CORPUS_DIR, "probes", entry.skill);
			const skillContent = readFileSync(join(probeDir, "SKILL.md"), "utf-8");
			const expected = readFileSync(join(probeDir, "expected.txt"), "utf-8");
			const { frontmatter } = parseFrontmatter<Record<string, unknown>>(skillContent);
			const declaredNames = parseDeclaredArgumentNames(frontmatter.arguments as SkillArgumentsDeclaration);
			const rendered = substituteSkillArguments(extractProbeBody(skillContent), entry.args, declaredNames);
			expect(rendered).toBe(expected);
		});
	}

	it("probe11 reproduces CC through the whole render pipeline, not just argument substitution", async () => {
		// The loop above exercises `substituteSkillArguments` only. Probe 11 is
		// the corpus's `@path` evidence, so it needs the full renderer: CC leaves
		// authored and argument-derived `@path` tokens alone, and so must Pi.
		const probeDir = join(CORPUS_DIR, "probes", "probe11");
		const expected = readFileSync(join(probeDir, "expected.txt"), "utf-8");
		const args = manifest.find((entry) => entry.skill === "probe11")?.args ?? "";

		const dir = mkdtempSync(join(tmpdir(), "pi-probe11-"));
		try {
			const filePath = join(dir, "SKILL.md");
			copyFileSync(join(probeDir, "SKILL.md"), filePath);
			const { skill } = normalizeSkillInput({
				name: "probe11",
				description: "Corpus probe",
				filePath,
				baseDir: dir,
				sourceInfo: createSyntheticSourceInfo(filePath, { source: "test" }),
				disableModelInvocation: false,
				frontmatter: {},
			});
			const result = await renderSkillInvocation(
				skill,
				{
					invocationId: "inv-probe11",
					skillId: skill.id,
					name: skill.name,
					baseDir: skill.baseDir,
					filePath: skill.filePath,
					rawArgs: args,
				},
				{
					cwd: dir,
					sessionId: "session-1",
					thinkingLevel: "medium",
					skillInterop: true,
					activeToolNames: [],
					shellSettings: { ...DEFAULT_SKILL_SHELL_SETTINGS },
				},
			);
			// The renderer trims the raw body and prepends the base-dir preamble.
			expect(result.body).toBe(`Base directory for this skill: ${dir}\n\n${expected.trimEnd()}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("public surface (AC8)", () => {
	it("SkillArgumentSubstitution is no longer exported from the package", () => {
		const indexSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts"), "utf-8");
		expect(indexSource).not.toContain("SkillArgumentSubstitution");
	});
});
