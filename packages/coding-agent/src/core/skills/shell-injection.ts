/**
 * A.3.5 shell injection executor. Recognizes inline `` !`cmd` `` spans and
 * fenced blocks whose info string is `!`, executes them sequentially in
 * document order under the session's tool policy, and inlines results or the
 * exact bracketed markers. Failures never abort the render; injected output
 * is inlined once and never re-scanned for substitution or injection syntax.
 *
 * Injection scanning runs AFTER argument substitution (single pass, A.3.1), so
 * invocation args are in scope for `` !` `` recognition. That includes the
 * rule-7 `ARGUMENTS: R` verbatim append (arguments.ts): caller-controlled text
 * can execute even when the skill author wrote no injection. This is CC parity
 * and crosses no privilege boundary (the A.3.5 gate below still requires an
 * active, non-disallowed `bash` capability), but skill consumers should know
 * the append path exists.
 *
 * The `disallowed-tools` gate canonicalizes each declared name through the
 * shared ADR-0006 redirect map (`canonicalizeToolName`) before matching, so
 * `disallowed-tools: [Bash]` blocks the registered `bash` capability and
 * `[Task]` blocks `Agent`.
 */

import { getPowerShellConfig, POWERSHELL_ARGS, type ShellConfig } from "../../utils/shell.ts";
import type { ResourceDiagnostic } from "../diagnostics.ts";
import { type BashOperations, createLocalBashOperations } from "../tools/bash.ts";
import { inlineCodeSpans, scanFenceBlocks } from "./fences.ts";
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
	return `[command timed out after ${timeoutMs / 1000}s]`;
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
	/** `skillShellTimeoutMs` in milliseconds, converted to seconds at the BashOperations boundary. */
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

const INLINE_INJECTION = /!`([^`\n]+)`/g;

/**
 * Split a body into text and command segments. Fenced blocks whose info
 * string is `!` become one command segment (fences excluded); inline
 * `` !`cmd` `` spans are recognized only outside fenced blocks and outside
 * inline code spans (a documented `` ``!`cmd` `` `` example never executes).
 * Everything else is literal text. Newlines are normalized to LF first, so
 * CRLF bodies parse exactly like LF (fence patterns anchor at line end).
 */
export function splitInjectionSegments(body: string): Segment[] {
	const normalized = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	// Line table with exact offsets so text between segments keeps its bytes.
	const lineStarts: number[] = [0];
	for (let i = 0; i < normalized.length; i++) {
		if (normalized[i] === "\n") {
			lineStarts.push(i + 1);
		}
	}
	const lines = lineStarts.map((start, index) => {
		const end = index + 1 < lineStarts.length ? lineStarts[index + 1] - 1 : normalized.length;
		return normalized.slice(start, end);
	});
	// End of a fence block: up to and including the closing fence line's bytes,
	// but not its terminating newline (the replacement keeps the separator).
	const blockEndOffset = (closeLine: number): number =>
		closeLine === -1
			? normalized.length
			: closeLine + 1 < lineStarts.length
				? lineStarts[closeLine + 1] - 1
				: normalized.length;

	// Pass 1: classify every fence block with the shared scanner (fences.ts).
	// `!` blocks become commands; other fences stay literal text (inline spans
	// inside them never execute).
	type Block =
		| { kind: "outside"; start: number; end: number }
		| { kind: "literal"; start: number; end: number }
		| { kind: "command"; start: number; end: number };
	const blocks: Block[] = [];
	let cursor = 0;
	for (const fence of scanFenceBlocks(lines)) {
		if (lineStarts[fence.openLine] > cursor) {
			blocks.push({ kind: "outside", start: cursor, end: lineStarts[fence.openLine] });
		}
		if (fence.info === "!") {
			const contentStart = lineStarts[fence.openLine + 1] ?? normalized.length;
			const contentEnd =
				fence.closeLine === -1
					? normalized.length
					: fence.closeLine === fence.openLine + 1
						? contentStart
						: lineStarts[fence.closeLine] - 1;
			blocks.push({ kind: "command", start: contentStart, end: contentEnd });
		} else {
			blocks.push({
				kind: "literal",
				start: lineStarts[fence.openLine],
				end: blockEndOffset(fence.closeLine),
			});
		}
		cursor = blockEndOffset(fence.closeLine);
	}
	if (cursor < normalized.length) {
		blocks.push({ kind: "outside", start: cursor, end: normalized.length });
	}

	// Pass 2: inline spans are recognized in outside ranges only, and never
	// inside inline code spans.
	const segments: Segment[] = [];
	for (const block of blocks) {
		const text = normalized.slice(block.start, block.end);
		if (block.kind === "command") {
			segments.push({ kind: "command", command: text });
			continue;
		}
		if (block.kind === "literal") {
			segments.push({ kind: "text", text });
			continue;
		}
		const spans = inlineCodeSpans(text);
		let last = 0;
		for (const match of text.matchAll(INLINE_INJECTION)) {
			if (spans.some((span) => match.index >= span.start && match.index < span.end)) {
				continue;
			}
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
		// On Windows defer to the same resolver the powershell tool uses, so a skill and
		// an equivalent tool call get the same interpreter (PowerShell 7 when present) and
		// the same flags. Without this a skill ran 5.1 under the host execution policy while
		// the tool ran 7 with it bypassed, so a skill could fail where the tool succeeded.
		if (process.platform === "win32") {
			try {
				return getPowerShellConfig();
			} catch {
				// Throws only when no PowerShell is on PATH. Returning undefined here would
				// mean "use the default shell" and run PowerShell source under bash, so hand
				// back the conventional executable instead: the spawn fails with ENOENT and
				// executeCommand emits the shell-unavailable marker without running anything,
				// exactly as it did before this delegation.
				return { shell: "powershell.exe", args: [...POWERSHELL_ARGS] };
			}
		}
		// Off Windows PowerShell is always pwsh and execution policy does not exist, so
		// getPowerShellConfig() throws by design. Resolve pwsh from PATH as before, without
		// the Windows-only -ExecutionPolicy flag that POWERSHELL_ARGS carries.
		return {
			shell: "pwsh",
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
	// multiplies by 1000); skillShellTimeoutMs is milliseconds. Convert here:
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
		// Extension-provided BashOperations can reject with anything; only Error
		// rejections carry a message/code.
		const err = error instanceof Error ? (error as NodeJS.ErrnoException) : undefined;
		if (err?.message === "aborted") {
			return SHELL_MARKERS.aborted;
		}
		const commandLabel = command.split("\n", 1)[0].slice(0, 120);
		if (err?.message.startsWith("timeout:")) {
			options.diagnostics?.push({
				type: "warning",
				message: `shell injection timed out after ${settings.timeoutMs}ms: ${commandLabel}`,
			});
			return finishOutput(chunks, truncated, settings.outputLimitBytes, commandTimedOutMarker(settings.timeoutMs));
		}
		if (err?.code === "ENOENT") {
			options.diagnostics?.push({
				type: "warning",
				message: `shell unavailable: ${shellName} (command: ${commandLabel})`,
			});
			return shellUnavailableMarker(shellName);
		}
		const message = err ? err.message : String(error);
		options.diagnostics?.push({
			type: "warning",
			message: `shell execution failed: ${message} (command: ${commandLabel})`,
		});
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
	const markers = [truncated ? outputTruncatedMarker(limitBytes) : undefined, marker];
	for (const m of markers) {
		if (m === undefined) {
			continue;
		}
		// Markers start on their own line unless the output is empty or already ends with one.
		output += `${output.endsWith("\n") || output === "" ? "" : "\n"}${m}`;
	}
	return output;
}

/**
 * Execute all injection blocks in `body` sequentially in document order,
 * inlining each result or marker. Never throws for command failures.
 */
export async function injectShellCommands(body: string, options: ShellInjectionOptions): Promise<string> {
	// Cheap guard: no `!` anywhere means no injection syntax can match, so the
	// common injection-free render skips segment parsing entirely.
	if (!body.includes("!")) {
		return body;
	}
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
