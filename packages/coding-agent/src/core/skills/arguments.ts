/**
 * A.3.2 argument grammar (normative). Pure module: no I/O, no session state.
 *
 * Input is one raw string `R` (everything after the command name for user
 * invocation; the `args` value for the `skill` tool). The substitution is a
 * single pass over the template; substituted values are never re-scanned.
 */

import type { SkillArguments } from "./frontmatter.ts";

/** Skill `arguments:` frontmatter: list of names, one string, or a name → description map. */
export type SkillArgumentsDeclaration = SkillArguments;

export interface SkillArgumentSubstitution {
	/** Rendered text, including the rule-7 append fallback when it applies. */
	text: string;
	/** True when at least one placeholder substituted non-empty input-derived text. */
	consumedInput: boolean;
}

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
 * Extract the declared argument names from the `arguments:` frontmatter
 * field. Accepts a list of names, a single name, or a map name → description
 * (A.3.2 rule 3). Non-string entries are ignored.
 */
export function parseDeclaredArgumentNames(declaration: SkillArgumentsDeclaration | undefined): string[] {
	if (declaration === undefined || declaration === null) {
		return [];
	}
	if (typeof declaration === "string") {
		return declaration.trim() === "" ? [] : [declaration.trim()];
	}
	if (Array.isArray(declaration)) {
		return declaration.filter((entry): entry is string => typeof entry === "string");
	}
	if (typeof declaration === "object") {
		return Object.keys(declaration);
	}
	return [];
}

interface ParsedArgs {
	/** Raw `R` verbatim (quotes, spacing, everything). */
	raw: string;
	/** Positional tokens after named binding and compaction (1-based at use sites). */
	positionals: string[];
	/** Bound named values. */
	named: Map<string, string>;
}

/**
 * Rule 3: bind declared `name=value` tokens, remove them from the positional
 * sequence, and compact (renumber) the rest. Undeclared `x=y` tokens stay
 * positional.
 */
function parseArgs(raw: string, declaredNames: readonly string[]): ParsedArgs {
	const tokens = tokenizeSkillArgs(raw);
	const declared = new Set(declaredNames);
	const named = new Map<string, string>();
	const positionals: string[] = [];
	for (const token of tokens) {
		const equalsIndex = token.indexOf("=");
		if (equalsIndex > 0) {
			const name = token.slice(0, equalsIndex);
			if (declared.has(name)) {
				named.set(name, token.slice(equalsIndex + 1));
				continue;
			}
		}
		positionals.push(token);
	}
	return { raw, positionals, named };
}

// Single-pass substitution over the template. Alternation order matters:
// escaped placeholders, braced defaults, braced slices, then simple forms.
// `$name` captures the full identifier so `$outdir` never partially matches a
// declared `$out` (longest-name-first, rule 3).
const PLACEHOLDER_PATTERN =
	/\\\$(?=[{@A-Za-z0-9_])|\$\{(@|ARGUMENTS|\d+|[A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Substitute argument placeholders in `template` per A.3.2.
 *
 * - `$ARGUMENTS` / `$@` substitute `R` verbatim (rule 1).
 * - `$N` substitutes positional token N, 1-based; out of range → empty (rule 2).
 * - `$name` substitutes a bound declared value; undeclared `$name` stays
 *   literal (rule 3).
 * - `${@:N}` / `${@:N:L}` slice the post-binding positional sequence,
 *   space-joined; N is 1-based and 0 is treated as 1 (rule 4).
 * - `${ARGUMENTS:-default}`, `${@:-default}`, `${N:-default}`,
 *   `${name:-default}` substitute the default when the value is empty/absent
 *   (rule 5). `${name:-...}` applies to any identifier ("absent" covers
 *   undeclared names).
 * - `\$` before a placeholder renders the placeholder literally, backslash
 *   removed (rule 6).
 * - If `R` is non-empty and no placeholder consumed input, appends
 *   `\n\nARGUMENTS: R` (rule 7).
 * - Single pass; substituted values are never re-scanned; repeated
 *   placeholders substitute repeatedly (rule 8).
 */
export function substituteSkillArguments(
	template: string,
	raw: string,
	declaredNames: readonly string[] = [],
): SkillArgumentSubstitution {
	const args = parseArgs(raw, declaredNames);
	const declared = new Set(declaredNames);
	let consumedInput = false;

	const positionalAt = (oneBased: number): string => {
		if (oneBased < 1) return "";
		return args.positionals[oneBased - 1] ?? "";
	};
	const allPositionals = (): string => args.positionals.join(" ");
	const namedValue = (name: string): string => args.named.get(name) ?? "";

	const mark = (value: string): string => {
		if (value !== "") consumedInput = true;
		return value;
	};

	const text = template.replace(
		PLACEHOLDER_PATTERN,
		(
			match: string,
			defaultTarget: string | undefined,
			defaultValue: string | undefined,
			sliceStart: string | undefined,
			sliceLength: string | undefined,
			simple: string | undefined,
			identifier: string | undefined,
		): string => {
			// Rule 6: `\$` escape: the match is just `\$`; the following
			// characters stay literal because no placeholder pattern can start
			// without a leading `$`.
			if (match.startsWith("\\")) {
				return "$";
			}
			if (defaultTarget !== undefined) {
				let value: string;
				if (defaultTarget === "ARGUMENTS") {
					value = args.raw;
				} else if (defaultTarget === "@") {
					value = allPositionals();
				} else if (/^\d+$/.test(defaultTarget)) {
					value = positionalAt(Number.parseInt(defaultTarget, 10));
				} else {
					value = namedValue(defaultTarget);
				}
				// Rule 5: defaults are not input; they never count as consuming.
				return value !== "" ? mark(value) : (defaultValue ?? "");
			}
			if (sliceStart !== undefined) {
				let start = Number.parseInt(sliceStart, 10) - 1;
				if (start < 0) start = 0; // bash convention: args start at 1
				const slice =
					sliceLength !== undefined
						? args.positionals.slice(start, start + Number.parseInt(sliceLength, 10))
						: args.positionals.slice(start);
				return mark(slice.join(" "));
			}
			if (simple !== undefined) {
				if (simple === "ARGUMENTS" || simple === "@") {
					return mark(args.raw);
				}
				return mark(positionalAt(Number.parseInt(simple, 10)));
			}
			if (identifier !== undefined) {
				// Undeclared `$name` stays literal so ordinary `$VAR` text
				// (e.g. shell snippets) survives; declared-but-unbound → empty.
				if (!declared.has(identifier)) {
					return match;
				}
				return mark(namedValue(identifier));
			}
			return match;
		},
	);

	// Rule 7: append fallback. Whitespace-only R counts as empty.
	if (raw.trim() !== "" && !consumedInput) {
		return { text: `${text}\n\nARGUMENTS: ${args.raw}`, consumedInput };
	}
	return { text, consumedInput };
}
