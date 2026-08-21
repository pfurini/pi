/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: normative A.3.2 placeholder fixtures */
/**
 * A.3.2 argument grammar conformance. Every normative example from the
 * frozen spec is copied verbatim into a fixture below.
 */

import { describe, expect, it } from "vitest";
import {
	parseDeclaredArgumentNames,
	substituteSkillArguments,
	tokenizeSkillArgs,
} from "../src/core/skills/arguments.ts";

describe("tokenizeSkillArgs (A.3.2 rule 2)", () => {
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

describe("substituteSkillArguments — verbatim A.3.2 examples", () => {
	// Spec fixture: declared `arguments: [name]`, R = alpha "b c" name=x \$lit
	const R = 'alpha "b c" name=x \\$lit';
	const declared = ["name"];

	it("rule 1: $ARGUMENTS substitutes R verbatim (quotes, spacing, everything)", () => {
		expect(substituteSkillArguments("got: $ARGUMENTS", R, declared).text).toBe('got: alpha "b c" name=x \\$lit');
	});

	it("rule 1: $@ is an alias of $ARGUMENTS", () => {
		expect(substituteSkillArguments("got: $@", R, declared).text).toBe('got: alpha "b c" name=x \\$lit');
	});

	it("rules 2+3: positionals after named binding and compaction", () => {
		// `name=x` binds (declared) and is removed; `\$lit` tokenizes to `$lit`.
		expect(substituteSkillArguments("$1|$2|$3|$4", R, declared).text).toBe("alpha|b c|$lit|");
	});

	it("rule 3: $name substitutes the bound value", () => {
		expect(substituteSkillArguments("name=$name", R, declared).text).toBe("name=x");
	});

	it("rule 4: ${@:2} slices the post-binding positional sequence", () => {
		expect(substituteSkillArguments("rest: ${@:2}", R, declared).text).toBe("rest: b c $lit");
	});

	it("rule 6: a literal \\$1 in the body renders $1", () => {
		// No real placeholder consumed input, so the rule-7 append fallback also fires.
		expect(substituteSkillArguments("literal \\$1 here", R, declared).text).toBe(
			'literal $1 here\n\nARGUMENTS: alpha "b c" name=x \\$lit',
		);
	});
});

describe("substituteSkillArguments — named arguments (rule 3)", () => {
	it("binds declared names and removes them from positionals", () => {
		const result = substituteSkillArguments("$1 $2 [$name]", "one name=x two", ["name"]);
		expect(result.text).toBe("one two [x]");
	});

	it("matches longest-name-first ($outdir before $out)", () => {
		const result = substituteSkillArguments("$outdir/$out", "outdir=a out=b", ["out", "outdir"]);
		expect(result.text).toBe("a/b");
	});

	it("never partially matches a declared name inside a longer identifier", () => {
		// Only `out` declared: `$outdir` is not `$out` + `dir`. Undeclared →
		// literal, and nothing consumed → append fallback fires.
		const result = substituteSkillArguments("$outdir", "out=b", ["out"]);
		expect(result.text).toBe("$outdir\n\nARGUMENTS: out=b");
	});

	it("keeps undeclared x=y tokens positional", () => {
		const result = substituteSkillArguments("$1|$2", "a x=y", ["name"]);
		expect(result.text).toBe("a|x=y");
	});

	it("binds quoted values", () => {
		const result = substituteSkillArguments("[$name]", 'name="x y"', ["name"]);
		expect(result.text).toBe("[x y]");
	});

	it("declared-but-unbound names render empty (and consume nothing → append fallback)", () => {
		expect(substituteSkillArguments("[$name]", "a", ["name"]).text).toBe("[]\n\nARGUMENTS: a");
	});

	it("accepts a map declaration (name → description)", () => {
		expect(parseDeclaredArgumentNames({ name: "the name", out: "output" })).toEqual(["name", "out"]);
		expect(substituteSkillArguments("$name", "name=z", parseDeclaredArgumentNames({ name: "the name" })).text).toBe(
			"z",
		);
	});

	it("accepts list and single-string declarations", () => {
		expect(parseDeclaredArgumentNames(["a", "b"])).toEqual(["a", "b"]);
		expect(parseDeclaredArgumentNames("solo")).toEqual(["solo"]);
		expect(parseDeclaredArgumentNames(undefined)).toEqual([]);
	});
});

describe("substituteSkillArguments — slices (rule 4)", () => {
	const declared: string[] = [];

	it("${@:N} substitutes tokens N onward, space-joined", () => {
		expect(substituteSkillArguments("${@:2}", "a b c d", declared).text).toBe("b c d");
	});

	it("${@:N:L} substitutes L tokens starting at N", () => {
		expect(substituteSkillArguments("${@:2:2}", "a b c d", declared).text).toBe("b c");
	});

	it("treats 0 as 1 (bash convention)", () => {
		expect(substituteSkillArguments("${@:0}", "a b", declared).text).toBe("a b");
	});

	it("out-of-range slices render empty (and consume nothing → append fallback)", () => {
		expect(substituteSkillArguments("[${@:5}]", "a b", declared).text).toBe("[]\n\nARGUMENTS: a b");
	});
});

describe("substituteSkillArguments — defaults (rule 5)", () => {
	it("${ARGUMENTS:-default} substitutes R verbatim when non-empty", () => {
		expect(substituteSkillArguments("${ARGUMENTS:-d}", 'a "b c"', []).text).toBe('a "b c"');
	});

	it("${ARGUMENTS:-default} substitutes the default when R is empty", () => {
		expect(substituteSkillArguments("${ARGUMENTS:-d}", "", []).text).toBe("d");
	});

	it("${@:-default} looks at the post-binding positional sequence", () => {
		// R is non-empty but every token bound → positional sequence empty; the
		// default is not input, so the append fallback fires.
		expect(substituteSkillArguments("${@:-d}", "name=x", ["name"]).text).toBe("d\n\nARGUMENTS: name=x");
		expect(substituteSkillArguments("${@:-d}", "a name=x", ["name"]).text).toBe("a");
	});

	it("${N:-default} substitutes the default when the positional is empty/absent", () => {
		expect(substituteSkillArguments("${2:-d}", "a", []).text).toBe("d\n\nARGUMENTS: a");
		expect(substituteSkillArguments("${1:-d}", "a", []).text).toBe("a");
	});

	it("${name:-default} substitutes the default when the name is unbound or undeclared", () => {
		expect(substituteSkillArguments("${name:-d}", "", ["name"]).text).toBe("d");
		expect(substituteSkillArguments("${other:-d}", "", []).text).toBe("d");
	});

	it("defaults containing placeholder syntax stay literal", () => {
		expect(substituteSkillArguments("${2:-$1}", "a", []).text).toBe("$1\n\nARGUMENTS: a");
	});
});

describe("substituteSkillArguments — escaping (rule 6)", () => {
	it("escaped placeholders render literally, backslash removed", () => {
		// Empty R keeps the rule-7 append fallback out of these rule-6 cases.
		expect(substituteSkillArguments("\\$ARGUMENTS", "", []).text).toBe("$ARGUMENTS");
		expect(substituteSkillArguments("\\$@", "", []).text).toBe("$@");
		expect(substituteSkillArguments("\\$1", "", []).text).toBe("$1");
		expect(substituteSkillArguments("\\$name", "", ["name"]).text).toBe("$name");
	});
});

describe("substituteSkillArguments — append fallback (rule 7)", () => {
	it("appends ARGUMENTS when R is non-empty and no placeholder consumed anything", () => {
		const result = substituteSkillArguments("body text", "a b", []);
		expect(result.text).toBe("body text\n\nARGUMENTS: a b");
		expect(result.consumedInput).toBe(false);
	});

	it("does not append when a placeholder consumed input", () => {
		const result = substituteSkillArguments("body $1", "a b", []);
		expect(result.text).toBe("body a");
		expect(result.consumedInput).toBe(true);
	});

	it("appends when a placeholder was present but consumed nothing", () => {
		const result = substituteSkillArguments("body [$4]", "a b", []);
		expect(result.text).toBe("body []\n\nARGUMENTS: a b");
		expect(result.consumedInput).toBe(false);
	});

	it("still appends when only a default fired (defaults are not input)", () => {
		const result = substituteSkillArguments("body ${2:-d}", "a", []);
		expect(result.text).toBe("body d\n\nARGUMENTS: a");
		expect(result.consumedInput).toBe(false);
	});

	it("appends nothing when R is empty or whitespace-only", () => {
		expect(substituteSkillArguments("body", "", []).text).toBe("body");
		expect(substituteSkillArguments("body $1", "", []).text).toBe("body ");
		expect(substituteSkillArguments("body", "   ", []).text).toBe("body");
	});
});

describe("substituteSkillArguments — single pass (rule 8)", () => {
	it("substituted values are never re-scanned for placeholders", () => {
		// R is literal `$1`; substituting $ARGUMENTS must not then expand the $1.
		expect(substituteSkillArguments("$ARGUMENTS", "$1", []).text).toBe("$1");
	});

	it("values injected through named bindings are not re-scanned", () => {
		expect(substituteSkillArguments("$name", "name=$ARGUMENTS", ["name"]).text).toBe("$ARGUMENTS");
	});

	it("repeated placeholders substitute repeatedly", () => {
		expect(substituteSkillArguments("$1 and $1", "x", []).text).toBe("x and x");
	});
});
