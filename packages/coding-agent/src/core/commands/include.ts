/**
 * A.7.1 command include inlining (normative). Pure module: filesystem reads
 * only, no session state. A command body is scanned for `@path` references and
 * each is replaced by the referenced file's text (recursively), BEFORE argument
 * substitution (A.3.1) so arguments can never introduce include directives and
 * includes can never be built from substituted values.
 *
 * Recognition mirrors `skills/render.ts:absolutizeSkillPathsInLine`: `@` plus a
 * run of non-whitespace characters, preceded by start-of-line or whitespace,
 * outside code fences (shared scanner, `skills/fences.ts`) and inline code
 * spans; `\@path` escapes to a literal `@path` (backslash removed).
 *
 * Every failure inlines a bracketed marker in place of the reference and never
 * aborts the render: recursion depth cap 10 (root body is depth 0), canonical
 * cycle detection, missing file, directory, non-UTF-8, per-file 64 KiB / total
 * 256 KiB size caps, and — beyond the spec's six named markers — permission and
 * read failures and stat/read races (mapped to not-found or a read-failed
 * marker). Total decoded bytes are counted across the whole recursion.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { canonicalizePath } from "../../utils/paths.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { scanFenceBlocks } from "../skills/fences.ts";

/** Root command body is depth 0; an include that would sit at depth 11 is not inlined. */
const MAX_INCLUDE_DEPTH = 10;
/** Per-file cap: a file whose raw bytes exceed this is not inlined. */
const MAX_FILE_BYTES = 64 * 1024;
/** Total cap across the whole recursion. */
const MAX_TOTAL_BYTES = 256 * 1024;

/** Bracketed markers inlined in place of an unresolvable `@path` reference. */
export const INCLUDE_MARKERS = {
	depthExceeded: (path: string): string => `[include depth exceeded: ${path}]`,
	cycle: (path: string): string => `[include cycle: ${path}]`,
	notFound: (path: string): string => `[include not found: ${path}]`,
	directory: (path: string): string => `[include is a directory: ${path}]`,
	notText: (path: string): string => `[include not text: ${path}]`,
	tooLarge: (path: string): string => `[include too large: ${path}]`,
	readFailed: (path: string): string => `[include read failed: ${path}]`,
} as const;

export interface IncludeInlineResult {
	/** Body with every `@path` reference inlined or replaced by a marker. */
	text: string;
	diagnostics: ResourceDiagnostic[];
}

interface InlineState {
	totalBytes: number;
	diagnostics: ResourceDiagnostic[];
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function warn(state: InlineState, message: string, path: string): void {
	state.diagnostics.push({ type: "warning", message, path });
}

/**
 * Inline A.7.1 `@path` includes in `rootBody`, resolving relative paths against
 * `rootFilePath`'s directory. Never throws; unresolvable references become
 * bracketed markers with an accompanying warning diagnostic.
 */
export function inlineCommandIncludes(rootBody: string, rootFilePath: string): IncludeInlineResult {
	const state: InlineState = { totalBytes: 0, diagnostics: [] };
	const visited = new Set<string>([canonicalizePath(rootFilePath)]);
	const text = inlineBody(rootBody, rootFilePath, 0, visited, state);
	return { text, diagnostics: state.diagnostics };
}

function inlineBody(body: string, filePath: string, depth: number, visited: Set<string>, state: InlineState): string {
	const lines = body.split("\n");
	const fencedLines = new Set<number>();
	for (const block of scanFenceBlocks(lines)) {
		const lastLine = block.closeLine === -1 ? lines.length - 1 : block.closeLine;
		for (let i = block.openLine; i <= lastLine; i++) {
			fencedLines.add(i);
		}
	}
	const out = lines.map((line, index) =>
		fencedLines.has(index) ? line : inlineLine(line, filePath, depth, visited, state),
	);
	return out.join("\n");
}

function inlineLine(line: string, filePath: string, depth: number, visited: Set<string>, state: InlineState): string {
	let result = "";
	let i = 0;
	while (i < line.length) {
		const char = line[i];
		const atTokenStart = i === 0 || /\s/.test(line[i - 1]);
		if (char === "\\" && line[i + 1] === "@" && atTokenStart) {
			// `\@path` escape: renders a literal `@path`.
			result += "@";
			i += 2;
			continue;
		}
		if (char === "`") {
			// Inline code span: copy verbatim through the closing backtick run.
			const run = line.slice(i).match(/^`+/)?.[0] ?? "`";
			const close = line.indexOf(run, i + run.length);
			if (close === -1) {
				result += line.slice(i);
				break;
			}
			result += line.slice(i, close + run.length);
			i = close + run.length;
			continue;
		}
		if (char === "@" && atTokenStart) {
			const token = line.slice(i + 1).match(/^\S+/)?.[0] ?? "";
			if (token === "") {
				result += "@";
				i += 1;
				continue;
			}
			result += resolveInclude(token, filePath, depth, visited, state);
			i += 1 + token.length;
			continue;
		}
		result += char;
		i++;
	}
	return result;
}

function resolveInclude(
	token: string,
	filePath: string,
	depth: number,
	visited: Set<string>,
	state: InlineState,
): string {
	// Depth is checked before any I/O: an include inside a depth-10 body would
	// sit at depth 11 and is not inlined.
	if (depth + 1 > MAX_INCLUDE_DEPTH) {
		warn(state, `include depth exceeded for "${token}"`, filePath);
		return INCLUDE_MARKERS.depthExceeded(token);
	}
	const resolved = isAbsolute(token) ? token : resolve(dirname(filePath), token);

	let stats: ReturnType<typeof statSync>;
	try {
		stats = statSync(resolved);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			warn(state, `include not found: "${token}"`, filePath);
			return INCLUDE_MARKERS.notFound(token);
		}
		warn(state, `include read failed: "${token}"`, filePath);
		return INCLUDE_MARKERS.readFailed(token);
	}
	if (stats.isDirectory()) {
		warn(state, `include is a directory: "${token}"`, filePath);
		return INCLUDE_MARKERS.directory(token);
	}

	let buffer: Buffer;
	try {
		buffer = readFileSync(resolved);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			warn(state, `include not found: "${token}"`, filePath);
			return INCLUDE_MARKERS.notFound(token);
		}
		warn(state, `include read failed: "${token}"`, filePath);
		return INCLUDE_MARKERS.readFailed(token);
	}

	if (buffer.byteLength > MAX_FILE_BYTES || state.totalBytes + buffer.byteLength > MAX_TOTAL_BYTES) {
		warn(state, `include too large: "${token}"`, filePath);
		return INCLUDE_MARKERS.tooLarge(token);
	}

	let content: string;
	try {
		content = utf8Decoder.decode(buffer);
	} catch {
		warn(state, `include not text (invalid UTF-8): "${token}"`, filePath);
		return INCLUDE_MARKERS.notText(token);
	}

	const canonical = canonicalizePath(resolved);
	if (visited.has(canonical)) {
		warn(state, `include cycle: "${token}"`, filePath);
		return INCLUDE_MARKERS.cycle(token);
	}

	state.totalBytes += buffer.byteLength;
	visited.add(canonical);
	const inlined = inlineBody(content, resolved, depth + 1, visited, state);
	visited.delete(canonical);
	return inlined;
}
