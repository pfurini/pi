/**
 * A.3.2 argument grammar (normative), CC-exact. Pure module: no I/O, no
 * session state.
 *
 * Input is one raw string `R` (everything after the command name for user
 * invocation; the `args` value for the `skill` tool). The substitution is a
 * single pass over the template; substituted values are never re-scanned.
 *
 * The grammar recognizes exactly what Claude Code recognizes (corpus:
 * test/suite/fixtures/cc-argument-grammar/): `$ARGUMENTS`, `$ARGUMENTS[N]`
 * (0-based), `$N` (0-based), and `$name` for declared names. `$@` and every
 * braced form (`${@:N}`, `${X:-d}`, …) are not placeholders and render
 * literally, so shell snippets in skill bodies survive unchanged. Anything
 * else behind a `$` that is not a declared name stays literal as well.
 */

import type { ResourceDiagnostic } from "../diagnostics.ts";
import type { SkillArguments } from "./frontmatter.ts";
/** Skill `arguments:` frontmatter: list of names, one string, or a name → description map. */
export type SkillArgumentsDeclaration = SkillArguments;

/** A declared name that is all digits can never be referenced as `$name` (rule 6). */
const DIGIT_NAME_PATTERN = /^\d+$/;

/**
 * Rule 2: positional tokenization of `R`. Splits on whitespace; double or
 * single quotes group a token (quotes stripped, grouping anywhere in a token);
 * a backslash escapes the next character everywhere; an unterminated quote
 * runs to end of string.
 */
export function tokenizeSkillArgs(raw: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let hasCurrent = false;
	let quote: string | null = null;

	for (let i = 0; i < raw.length; i++) {
		const char = raw[i];
		if (quote !== null) {
			if (char === "\\" && i + 1 < raw.length) {
				current += raw[i + 1];
				hasCurrent = true;
				i++;
			} else if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === "\\" && i + 1 < raw.length) {
			current += raw[i + 1];
			hasCurrent = true;
			i++;
		} else if (char === '"' || char === "'") {
			quote = char;
			hasCurrent = true;
		} else if (/\s/.test(char)) {
			if (hasCurrent) {
				tokens.push(current);
				current = "";
				hasCurrent = false;
			}
		} else {
			current += char;
			hasCurrent = true;
		}
	}
	if (hasCurrent) {
		tokens.push(current);
	}
	return tokens;
}

/**
 * Split the `arguments:` declaration into declared names in declaration
 * order, digit-like names included. Accepts a list of names, a
 * whitespace-separated string, or a map name → description (A.3.2 rule 5).
 * Non-string list entries are ignored.
 */
function splitDeclaredArgumentNames(declaration: SkillArgumentsDeclaration | undefined): string[] {
	if (declaration === undefined || declaration === null) {
		return [];
	}
	if (typeof declaration === "string") {
		return declaration.trim() === "" ? [] : declaration.trim().split(/\s+/);
	}
	if (Array.isArray(declaration)) {
		return declaration.filter((entry): entry is string => typeof entry === "string");
	}
	if (typeof declaration === "object") {
		return Object.keys(declaration);
	}
	return [];
}

/**
 * Extract the slot mapping from the `arguments:` frontmatter field: declared
 * names in declaration order with digit-like names dropped, so every later
 * name shifts down one slot (A.3.2 rule 6). Index in the returned array is
 * the positional slot the name aliases.
 */
export function parseDeclaredArgumentNames(declaration: SkillArgumentsDeclaration | undefined): string[] {
	return splitDeclaredArgumentNames(declaration).filter((name) => !DIGIT_NAME_PATTERN.test(name));
}

/**
 * The digit-like declared names `parseDeclaredArgumentNames` drops, in
 * declaration order. Load-time diagnostics name these (the digit-name load
 * diagnostic is a deliberate Pi deviation); rendering matches CC exactly.
 */
export function digitLikeDeclaredArgumentNames(declaration: SkillArgumentsDeclaration | undefined): string[] {
	return splitDeclaredArgumentNames(declaration).filter((name) => DIGIT_NAME_PATTERN.test(name));
}

/**
 * The load diagnostic emitted once per digit-like declared argument name, at all
 * three tiers (skill, command, prompt template). Rendering still matches CC
 * exactly; the warning exists so the author is not left debugging a silently
 * skipped slot.
 */
export function digitArgumentNameDiagnostic(name: string, path: string): ResourceDiagnostic {
	return {
		type: "warning",
		message: `declared argument name "${name}" is digit-like and unusable as a placeholder; it is dropped from the argument mapping, shifting later declared names down one slot`,
		path,
	};
}

// Single-pass substitution. The optional leading backslash run feeds rule 7
// escaping: an odd run escapes the placeholder (one backslash removed), an
// even run (including none) leaves the placeholder live. A numeric bracket is
// part of the `$ARGUMENTS[N]` token; a non-numeric one is not, so `$ARGUMENTS`
// matches bare and the bracket text survives (rule 2).
const PLACEHOLDER_PATTERN = /(\\*)\$(ARGUMENTS(?:\[\d+\])?|\d+|[A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Substitute argument placeholders in `template` per A.3.2 and return the
 * rendered text:
 *
 * - `$ARGUMENTS` substitutes `R` verbatim (rule 1); a declared `ARGUMENTS`
 *   shadows the built-in and reads its positional slot instead (rule 6).
 * - `$ARGUMENTS[N]` and `$N` substitute positional token N, 0-based; out of
 *   range leaves the whole match literal (rules 2-3). Indexed access is
 *   unaffected by a declared `ARGUMENTS` (rule 6, probe 12).
 * - `$name` substitutes the declared name's positional slot; declared but
 *   unmatched renders empty, undeclared stays literal (rule 4).
 * - `\$` before a digit, `ARGUMENTS`, or a declared name renders the
 *   placeholder literally with that backslash removed; before anything else
 *   the backslash is retained; a doubled backslash retains both and the
 *   placeholder still expands (rule 7).
 * - If `R` is non-whitespace and no placeholder was substituted — a
 *   substitution producing an empty string counts, an unmatched indexed
 *   placeholder left literal does not — appends `\n\nARGUMENTS: R` (rule 8).
 * - Single pass; substituted values are never re-scanned; repeated
 *   placeholders substitute repeatedly.
 */
export function substituteSkillArguments(template: string, raw: string, declaredNames: readonly string[] = []): string {
	const positionals = tokenizeSkillArgs(raw);
	const declared = new Set(declaredNames);
	let substituted = false;

	const text = template.replace(PLACEHOLDER_PATTERN, (match: string, backslashes: string, token: string): string => {
		if (backslashes.length % 2 === 1) {
			// Rule 7 escape arm. Eligibility mirrors the substitution grammar:
			// a digit, `ARGUMENTS` (bare or indexed), or a declared name. Any
			// other token cannot substitute, so the backslash is retained.
			const escapeEligible =
				DIGIT_NAME_PATTERN.test(token) ||
				token === "ARGUMENTS" ||
				token.startsWith("ARGUMENTS[") ||
				declared.has(token);
			if (!escapeEligible) {
				return match;
			}
			return `${backslashes.slice(0, -1)}$${token}`;
		}

		if (token.startsWith("ARGUMENTS[")) {
			// Rule 2: indexed form; never shadowed by a declared ARGUMENTS.
			const index = Number.parseInt(token.slice("ARGUMENTS[".length, -1), 10);
			if (index >= positionals.length) {
				return match;
			}
			substituted = true;
			return backslashes + positionals[index];
		}
		if (token === "ARGUMENTS") {
			substituted = true;
			// Rule 6: a declared ARGUMENTS shadows the built-in.
			return (
				backslashes + (declared.has("ARGUMENTS") ? (positionals[declaredNames.indexOf("ARGUMENTS")] ?? "") : raw)
			);
		}
		if (DIGIT_NAME_PATTERN.test(token)) {
			// Rule 3: `$N` shorthand, 0-based; out of range stays literal.
			const index = Number.parseInt(token, 10);
			if (index >= positionals.length) {
				return match;
			}
			substituted = true;
			return backslashes + positionals[index];
		}
		// Rule 4: undeclared `$name` stays literal so ordinary `$VAR` text
		// (e.g. shell snippets) survives; declared-but-unmatched → empty.
		if (!declared.has(token)) {
			return match;
		}
		substituted = true;
		return backslashes + (positionals[declaredNames.indexOf(token)] ?? "");
	});

	// Rule 8: append fallback. Whitespace-only R counts as empty.
	if (raw.trim() !== "" && !substituted) {
		return `${text}\n\nARGUMENTS: ${raw}`;
	}
	return text;
}
