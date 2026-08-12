/**
 * A.3.5 shell injection executor. Recognizes inline `` !`cmd` `` spans and
 * fenced blocks whose info string is `!`, executes them sequentially in
 * document order under the session's tool policy, and inlines results or the
 * exact bracketed markers. Failures never abort the render; injected output
 * is inlined once and never re-scanned for substitution or injection syntax.
 *
 * The `disallowed-tools` gate canonicalizes each declared name through the
 * shared ADR-0006 redirect map (`canonicalizeToolName`) before matching, so
 * `disallowed-tools: [Bash]` blocks the registered `bash` capability and
 * `[Task]` blocks `Agent`.
 */

import type { ShellConfig } from "../../utils/shell.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { type BashOperations, createLocalBashOperations } from "../tools/bash.ts";
import type { SkillToolList } from "./frontmatter.ts";
import { canonicalizeToolName } from "./tool-redirects.ts";

/** Markers inlined in place of an injection block (A.3.5). */
export const SHELL_MARKERS = {
	disabledByPolicy: "[shell command execution disabled by policy]",
	disabledByToolPolicy: "[shell command execution disabled by tool policy]",
	aborted: "[command aborted]",
	injectionLimitReached: "[shell injection limit reached]",
} as const;

export function shellUnavailableMarker(shell: string): string {
	return `[shell unavailable: ${shell}]`;
}

export function commandTimedOutMarker(timeoutMs: number): string {
	return `[command timed out after ${formatTimeoutSeconds(timeoutMs)}s]`;
}

export function exitCodeMarker(exitCode: number): string {
	return `[exit code ${exitCode}]`;
}

export function outputTruncatedMarker(limitBytes: number): string {
	return `[output truncated at ${limitBytes} bytes]`;
}

export function shellExecutionFailedMarker(message: string): string {
	return `[shell execution failed: ${message}]`;
}

function formatTimeoutSeconds(timeoutMs: number): string {
	return String(timeoutMs / 1000);
}

/**
 * Aggregate per-render budget: at most this many injection blocks execute per
 * render; the remainder is replaced with the limit marker so a hostile local
 * skill cannot hold rendering for `N × timeout` or spawn an unbounded
 * child-process sequence despite each command obeying its own limits.
 */
export const MAX_SHELL_INJECTIONS_PER_RENDER = 32;

export interface SkillShellSettings {
	/** `disableSkillShellExecution` kill switch. */
	disabled: boolean;
	/** `skillShellTimeoutMs` — milliseconds, converted to seconds at the BashOperations boundary. */
	timeoutMs: number;
	/** `skillShellOutputLimitBytes`. */
	outputLimitBytes: number;
}

export const DEFAULT_SKILL_SHELL_SETTINGS: SkillShellSettings = {
	disabled: false,
	timeoutMs: 30000,
	outputLimitBytes: 16384,
};

export interface ShellInjectionOptions {
	/** Session cwd; commands run with this cwd. */
	cwd: string;
	/** Per-execution environment factory: the bash tool's per-execution env plus the A.8 skill variables. Resolved lazily on the first executed command, so renders without injections never build it. */
	env: () => NodeJS.ProcessEnv;
	/** Skill frontmatter `shell` field: `bash` (default) or `powershell`. */
	shell?: string;
	/** The session's effective active tool set (not CLI flags). */
	activeToolNames: readonly string[];
	/** Raw `disallowed-tools` frontmatter value of the invocation. */
	disallowedTools?: SkillToolList;
	settings: SkillShellSettings;
	/** One shared abort signal for the whole render. */
	signal?: AbortSignal;
	/** Execution backend override (tests, remote backends). */
	operations?: BashOperations;
	/** Optional explicit bash path from settings, honored for the default bash shell. */
	shellPath?: string;
	/** Sink for normalization diagnostics (Tool(pattern), wildcards, unknown shell). */
	diagnostics?: ResourceDiagnostic[];
}

type Segment = { kind: "text"; text: string } | { kind: "command"; command: string };

const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const INLINE_INJECTION = /!`([^`\n]+)`/g;

/**
 * Split a body into text and command segments. Fenced blocks whose info
 * string is `!` become one command segment (fences excluded); inline
 * `` !`cmd` `` spans are recognized only outside fenced blocks. Everything
 * else is literal text.
 */
export function splitInjectionSegments(body: string): Segment[] {
	// Line table with exact offsets so text between segments keeps its bytes.
	const lineStarts: number[] = [0];
	for (let i = 0; i < body.length; i++) {
		if (body[i] === "\n") {
			lineStarts.push(i + 1);
		}
	}
	const lines = lineStarts.map((start, index) => {
		const end = index + 1 < lineStarts.length ? lineStarts[index + 1] - 1 : body.length;
		return body.slice(start, end);
	});
	// End of a fence block: up to and including the closing fence line's bytes,
	// but not its terminating newline — the replacement keeps the separator.
	const blockEndOffset = (closeLine: number): number =>
		closeLine === -1 ? body.length : closeLine + 1 < lineStarts.length ? lineStarts[closeLine + 1] - 1 : body.length;

	// Pass 1: classify every fence block. `!` blocks become commands; other
	// fences stay literal text (inline spans inside them never execute).
	type Block =
		| { kind: "outside"; start: number; end: number }
		| { kind: "literal"; start: number; end: number }
		| { kind: "command"; start: number; end: number };
	const blocks: Block[] = [];
	let cursor = 0;
	let i = 0;
	while (i < lines.length) {
		const open = lines[i].match(FENCE_OPEN);
		if (!open) {
			i++;
			continue;
		}
		const fence = open[2];
		const closePattern = new RegExp(`^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
		let closeLine = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (closePattern.test(lines[j])) {
				closeLine = j;
				break;
			}
		}
		const isInjection = open[3].trim() === "!";
		if (lineStarts[i] > cursor) {
			blocks.push({ kind: "outside", start: cursor, end: lineStarts[i] });
		}
		if (isInjection) {
			const contentStart = lineStarts[i + 1] ?? body.length;
			const contentEnd =
				closeLine === -1 ? body.length : closeLine === i + 1 ? contentStart : lineStarts[closeLine] - 1;
			blocks.push({ kind: "command", start: contentStart, end: contentEnd });
		} else {
			blocks.push({
				kind: "literal",
				start: lineStarts[i],
				end: blockEndOffset(closeLine),
			});
		}
		cursor = blockEndOffset(closeLine);
		i = closeLine === -1 ? lines.length : closeLine + 1;
	}
	if (cursor < body.length) {
		blocks.push({ kind: "outside", start: cursor, end: body.length });
	}

	// Pass 2: inline spans are recognized in outside ranges only.
	const segments: Segment[] = [];
	for (const block of blocks) {
		const text = body.slice(block.start, block.end);
		if (block.kind === "command") {
			segments.push({ kind: "command", command: text });
			continue;
		}
		if (block.kind === "literal") {
			segments.push({ kind: "text", text });
			continue;
		}
		let last = 0;
		for (const match of text.matchAll(INLINE_INJECTION)) {
			if (match.index > last) {
				segments.push({ kind: "text", text: text.slice(last, match.index) });
			}
			segments.push({ kind: "command", command: match[1] });
			last = match.index + match[0].length;
		}
		if (last < text.length) {
			segments.push({ kind: "text", text: text.slice(last) });
		}
	}
	return segments;
}

/**
 * Normalize a raw `disallowed-tools` frontmatter value into declared tool
 * names (A.2): YAML list or one comma-separated string; CC `Tool(pattern)`
 * entries reduce to the bare tool name with a diagnostic (Pi has no
 * per-command gating); wildcards are unsupported (diagnostic, entry skipped).
 */
export function normalizeDisallowedTools(
	value: SkillToolList | undefined,
	diagnostics?: ResourceDiagnostic[],
): string[] {
	if (value === undefined) {
		return [];
	}
	const entries = (typeof value === "string" ? value.split(",") : value)
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
	const names: string[] = [];
	for (const entry of entries) {
		const patternMatch = entry.match(/^([A-Za-z][A-Za-z0-9_-]*)\((.*)\)$/);
		if (patternMatch) {
			diagnostics?.push({
				type: "warning",
				message: `disallowed-tools entry "${entry}" carries a parenthesized pattern; Pi has no per-command gating, matching against "${patternMatch[1]}" only`,
			});
			names.push(patternMatch[1]);
			continue;
		}
		if (entry.includes("*")) {
			diagnostics?.push({
				type: "warning",
				message: `disallowed-tools entry "${entry}" uses a wildcard; wildcards are unsupported and the entry was ignored`,
			});
			continue;
		}
		names.push(entry);
	}
	return names;
}

/**
 * The A.3.5 tool-policy gate: injection executes only when the session's
 * active tool set includes a shell-capable execution tool (`bash`) that is
 * not blocked by the effective `disallowed-tools` union after redirect-map
 * canonicalization. Returns the marker to inline when blocked.
 */
export function evaluateShellGate(options: {
	activeToolNames: readonly string[];
	disallowedTools?: SkillToolList;
	settings: SkillShellSettings;
	diagnostics?: ResourceDiagnostic[];
}): { allowed: boolean; marker?: string } {
	if (options.settings.disabled) {
		return { allowed: false, marker: SHELL_MARKERS.disabledByPolicy };
	}
	const active = new Set(options.activeToolNames.map((name) => name.toLowerCase()));
	if (!active.has("bash")) {
		return { allowed: false, marker: SHELL_MARKERS.disabledByToolPolicy };
	}
	const declared = normalizeDisallowedTools(options.disallowedTools, options.diagnostics);
	for (const name of declared) {
		if (canonicalizeToolName(name).toLowerCase() === "bash") {
			return { allowed: false, marker: SHELL_MARKERS.disabledByToolPolicy };
		}
	}
	return { allowed: true };
}

/** Shell selection (A.2 `shell` field): default bash, or powershell. */
function resolveSkillShellConfig(
	shell: string | undefined,
	diagnostics?: ResourceDiagnostic[],
): ShellConfig | undefined {
	if (shell === undefined || shell === "bash") {
		return undefined;
	}
	if (shell === "powershell") {
		return {
			shell: process.platform === "win32" ? "powershell.exe" : "pwsh",
			args: ["-NoProfile", "-NonInteractive", "-Command"],
		};
	}
	diagnostics?.push({
		type: "warning",
		message: `unknown shell "${shell}"; falling back to bash`,
	});
	return undefined;
}

async function executeCommand(
	command: string,
	env: NodeJS.ProcessEnv,
	options: ShellInjectionOptions,
): Promise<string> {
	const { settings, signal } = options;
	if (signal?.aborted) {
		return SHELL_MARKERS.aborted;
	}
	const shellName = options.shell ?? "bash";
	const operations =
		options.operations ??
		createLocalBashOperations(
			options.shell === undefined || options.shell === "bash"
				? { shellPath: options.shellPath }
				: { shellConfig: resolveSkillShellConfig(options.shell, options.diagnostics) },
		);

	const chunks: Buffer[] = [];
	let keptBytes = 0;
	let truncated = false;
	const onData = (data: Buffer) => {
		if (truncated) {
			return;
		}
		if (keptBytes + data.length > settings.outputLimitBytes) {
			const remaining = settings.outputLimitBytes - keptBytes;
			if (remaining > 0) {
				chunks.push(data.subarray(0, remaining));
				keptBytes += remaining;
			}
			truncated = true;
			return;
		}
		chunks.push(data);
		keptBytes += data.length;
	};

	// BashOperations.exec interprets `timeout` as SECONDS (resolveTimeoutMs
	// multiplies by 1000); skillShellTimeoutMs is milliseconds. Convert here —
	// passing 30000 straight through would yield an ~8.3-hour timeout.
	const timeoutSeconds = settings.timeoutMs / 1000;

	let exitCode: number | null;
	try {
		const result = await operations.exec(command, options.cwd, {
			onData,
			signal,
			timeout: timeoutSeconds,
			env,
		});
		exitCode = result.exitCode;
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err instanceof Error && err.message === "aborted") {
			return SHELL_MARKERS.aborted;
		}
		if (err instanceof Error && err.message.startsWith("timeout:")) {
			return finishOutput(chunks, truncated, settings.outputLimitBytes, commandTimedOutMarker(settings.timeoutMs));
		}
		if (err.code === "ENOENT") {
			return shellUnavailableMarker(shellName);
		}
		const message = err instanceof Error ? err.message : String(err);
		return shellExecutionFailedMarker(message);
	}

	if (exitCode !== null && exitCode !== 0) {
		return finishOutput(chunks, truncated, settings.outputLimitBytes, exitCodeMarker(exitCode));
	}
	return finishOutput(chunks, truncated, settings.outputLimitBytes, undefined);
}

function finishOutput(chunks: Buffer[], truncated: boolean, limitBytes: number, marker: string | undefined): string {
	// stdout/stderr in arrival order; a cap cutting a multibyte sequence decodes
	// to U+FFFD at the boundary (non-fatal decoder) and is covered by the marker.
	let output = new TextDecoder().decode(Buffer.concat(chunks));
	if (truncated) {
		output += `${output.endsWith("\n") || output === "" ? "" : "\n"}${outputTruncatedMarker(limitBytes)}`;
	}
	if (marker !== undefined) {
		output += `${output.endsWith("\n") || output === "" ? "" : "\n"}${marker}`;
	}
	return output;
}

/**
 * Execute all injection blocks in `body` sequentially in document order,
 * inlining each result or marker. Never throws for command failures.
 */
export async function injectShellCommands(body: string, options: ShellInjectionOptions): Promise<string> {
	const segments = splitInjectionSegments(body);
	if (!segments.some((segment) => segment.kind === "command")) {
		return body;
	}
	const gate = evaluateShellGate(options);
	const out: string[] = [];
	let executed = 0;
	let env: NodeJS.ProcessEnv | undefined;
	for (const segment of segments) {
		if (segment.kind === "text") {
			out.push(segment.text);
			continue;
		}
		if (!gate.allowed) {
			out.push(gate.marker ?? SHELL_MARKERS.disabledByToolPolicy);
			continue;
		}
		if (executed >= MAX_SHELL_INJECTIONS_PER_RENDER) {
			out.push(SHELL_MARKERS.injectionLimitReached);
			continue;
		}
		executed++;
		env ??= options.env();
		out.push(await executeCommand(segment.command, env, options));
	}
	return out.join("");
}
