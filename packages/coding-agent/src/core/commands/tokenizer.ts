/**
 * A.1 mid-prompt tokenizer (normative). Scans a message left to right into an
 * ordered list of spans (`text` | `invocation`), resolving each candidate
 * against the {@link CommandRegistry}. The seven rules:
 *
 * 1. A candidate is `/` + the maximal run of `[A-Za-z0-9._:/-]`, preceded by
 *    start-of-message or whitespace. Trailing `.,;!?)` are stripped; the
 *    remainder must EXACT-match a registered prompt-producing name. Any mismatch
 *    rejects the candidate entirely (no fuzzy / prefix fallback).
 * 2. Candidates inside fenced code blocks and inline code spans are literal
 *    (shared scanner, `skills/fences.ts`).
 * 3. A candidate preceded by an odd number of backslashes is escaped (literal);
 *    backslash runs preceding a candidate `/` collapse CommonMark-style (a pair
 *    becomes one literal backslash); runs elsewhere stay verbatim.
 * 4. Argument ownership: if the message starts with an invocation token that
 *    command owns the whole raw remainder as args and no inner token expands;
 *    otherwise every recognized token is a mid-prompt invocation with no args.
 * 5. At most 6 invocations; later candidates stay literal (one diagnostic).
 * 6. Fork stop: after the first `context: fork` skill, later candidates stay
 *    literal (one diagnostic).
 * 7. Control commands are recognized message-initial only; mid-prompt they are
 *    literal (enforced by the registry's `messageInitial` gate).
 */

import type { ResourceDiagnostic } from "../diagnostics.ts";
import { scanFenceBlocks } from "../skills/fences.ts";
import type { CommandRegistry, ResolvedInvocation } from "./registry.ts";

/** Maximum prompt-producing invocations recognized per message (A.1 rule 5). */
export const MAX_INVOCATIONS_PER_MESSAGE = 6;

export interface TextSpan {
	readonly kind: "text";
	readonly text: string;
}

export interface InvocationSpan {
	readonly kind: "invocation";
	readonly invocation: ResolvedInvocation;
	/** Raw argument string (non-empty only in argument-ownership mode). */
	readonly rawArgs: string;
}

export type MessageSpan = TextSpan | InvocationSpan;

export interface TokenizeResult {
	spans: MessageSpan[];
	/** True when the message began with an invocation (argument-ownership mode). */
	messageInitial: boolean;
	diagnostics: ResourceDiagnostic[];
}

const TRAILING_PUNCTUATION = /[.,;!?)]+$/;
const NAME_RUN = /^[A-Za-z0-9._:/-]+/;

function isForkSkill(invocation: ResolvedInvocation): boolean {
	// `context` is normalized to "inline" | "fork" at load (skills/frontmatter.ts).
	return invocation.source === "skill" && invocation.skill.frontmatter.context === "fork";
}

/** Compute the inclusive char ranges of fenced code blocks (verbatim regions). */
function fencedRanges(message: string): Array<[number, number]> {
	const lines = message.split("\n");
	const lineStart: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineStart.push(offset);
		offset += line.length + 1;
	}
	const ranges: Array<[number, number]> = [];
	for (const block of scanFenceBlocks(lines)) {
		const lastLine = block.closeLine === -1 ? lines.length - 1 : block.closeLine;
		ranges.push([lineStart[block.openLine], lineStart[lastLine] + lines[lastLine].length]);
	}
	return ranges;
}

export function tokenizeMessage(message: string, registry: CommandRegistry): TokenizeResult {
	const ranges = fencedRanges(message);
	const spans: MessageSpan[] = [];
	const diagnostics: ResourceDiagnostic[] = [];
	let text = "";
	let rangeIdx = 0;
	let onlyWhitespaceSoFar = true;
	let count = 0;
	let forkStopped = false;
	let capDiagnosed = false;
	let forkDiagnosed = false;
	let i = 0;

	const flush = (): void => {
		if (text !== "") {
			spans.push({ kind: "text", text });
			text = "";
		}
	};
	const appendLiteral = (chunk: string): void => {
		text += chunk;
		if (/\S/.test(chunk)) {
			onlyWhitespaceSoFar = false;
		}
	};

	while (i < message.length) {
		// Discard ranges already behind `i`: a char-based inline-code jump can
		// advance past a fence range, and the guard below must never rewind.
		while (rangeIdx < ranges.length && i >= ranges[rangeIdx][1]) rangeIdx++;
		// Fenced regions are copied verbatim; candidates inside never expand.
		if (rangeIdx < ranges.length && i >= ranges[rangeIdx][0]) {
			const [, end] = ranges[rangeIdx];
			appendLiteral(message.slice(i, end));
			i = end;
			rangeIdx++;
			continue;
		}

		const char = message[i];
		const atTokenStart = i === 0 || /\s/.test(message[i - 1]);

		if (char === "`") {
			// Inline code span: copy verbatim through the closing backtick run.
			const run = message.slice(i).match(/^`+/)?.[0] ?? "`";
			const close = message.indexOf(run, i + run.length);
			if (close === -1) {
				appendLiteral(message.slice(i));
				break;
			}
			appendLiteral(message.slice(i, close + run.length));
			i = close + run.length;
			continue;
		}

		if (atTokenStart && (char === "\\" || char === "/")) {
			let j = i;
			let backslashes = 0;
			while (message[j] === "\\") {
				backslashes++;
				j++;
			}
			if (message[j] === "/") {
				const literalBackslashes = "\\".repeat(Math.floor(backslashes / 2));
				const escaped = backslashes % 2 === 1;
				const run = message.slice(j + 1).match(NAME_RUN)?.[0] ?? "";
				if (run === "") {
					appendLiteral(`${literalBackslashes}/`);
					i = j + 1;
					continue;
				}
				const name = run.replace(TRAILING_PUNCTUATION, "");
				const trailing = run.slice(name.length);
				const runEnd = j + 1 + run.length;
				const nameEnd = j + 1 + name.length;

				if (escaped || name === "") {
					// Escaped candidate (rule 3) or an all-punctuation run: literal.
					appendLiteral(`${literalBackslashes}/${run}`);
					i = runEnd;
					continue;
				}

				if (onlyWhitespaceSoFar) {
					// Rule 4: a prompt-producing invocation at message start owns the
					// entire raw remainder as its arguments.
					const invocation = registry.resolve(name, { messageInitial: true });
					if (invocation && !invocation.control) {
						appendLiteral(literalBackslashes);
						flush();
						const rawArgs = message.slice(nameEnd).replace(/^\s+/, "");
						spans.push({ kind: "invocation", invocation, rawArgs });
						return { spans, messageInitial: true, diagnostics };
					}
					// A control or unregistered name at the start stays literal; the
					// rest of the message is scanned in mid-prompt mode.
					appendLiteral(`${literalBackslashes}/${run}`);
					i = runEnd;
					continue;
				}

				const invocation = registry.resolve(name, { messageInitial: false });
				if (invocation) {
					if (forkStopped) {
						if (!forkDiagnosed) {
							diagnostics.push({
								type: "warning",
								message: "invocations after a forking skill were left literal (A.1 fork stop)",
							});
							forkDiagnosed = true;
						}
						appendLiteral(`${literalBackslashes}/${run}`);
						i = runEnd;
						continue;
					}
					if (count >= MAX_INVOCATIONS_PER_MESSAGE) {
						if (!capDiagnosed) {
							diagnostics.push({
								type: "warning",
								message: `more than ${MAX_INVOCATIONS_PER_MESSAGE} invocations in one message; extras were left literal (A.1 cap)`,
							});
							capDiagnosed = true;
						}
						appendLiteral(`${literalBackslashes}/${run}`);
						i = runEnd;
						continue;
					}
					appendLiteral(literalBackslashes);
					flush();
					spans.push({ kind: "invocation", invocation, rawArgs: "" });
					count++;
					if (isForkSkill(invocation)) {
						forkStopped = true;
					}
					// Stripped trailing punctuation stays as literal text.
					if (trailing !== "") {
						appendLiteral(trailing);
					}
					i = runEnd;
					continue;
				}

				// Rule 1: full run unregistered → rejected entirely (literal).
				appendLiteral(`${literalBackslashes}/${run}`);
				i = runEnd;
				continue;
			}
			// Backslashes not followed by `/`: leave verbatim (fall through).
		}

		appendLiteral(char);
		i++;
	}

	flush();
	return { spans, messageInitial: false, diagnostics };
}
